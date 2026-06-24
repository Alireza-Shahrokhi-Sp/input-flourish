"""
Scrape the "Profilo della lingua italiana" CEFR vocabulary lists (A1–B2)
from Università per Stranieri di Perugia, preserving POS and morphological
metadata.

Output: data/profilo_lexicon.json — a collision-safe dict where each key
is a lemma string and each value is an array of entry objects, supporting
words that appear at multiple levels or with multiple POS tags.

Usage:
    cd input-flourish/scripts
    python scrape_profilo_lexicon.py
    python scrape_profilo_lexicon.py --output custom_path.json
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import time
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

LEVELS: dict[str, str] = {
    "A1": "https://www.unistrapg.it/profilo_lingua_italiana/site/liste_lessicali_a1.html",
    "A2": "https://www.unistrapg.it/profilo_lingua_italiana/site/liste_lessicali_a2.html",
    "B1": "https://www.unistrapg.it/profilo_lingua_italiana/site/liste_lessicali_b1.html",
    "B2": "https://www.unistrapg.it/profilo_lingua_italiana/site/liste_lessicali_b2.html",
}

RETRY_ATTEMPTS = 3
RETRY_BACKOFF = 2.0  # seconds, multiplied by attempt number
REQUEST_TIMEOUT = 30
POLITENESS_DELAY = 1.5  # seconds between page fetches

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# POS normalisation map
# ---------------------------------------------------------------------------

POS_MAP: dict[str, dict[str, str]] = {
    # Nouns
    "s.m.":             {"pos": "noun", "gender": "m"},
    "s.m":              {"pos": "noun", "gender": "m"},
    "s.f.":             {"pos": "noun", "gender": "f"},
    "s.f":              {"pos": "noun", "gender": "f"},
    "s.m. pl.":         {"pos": "noun", "gender": "m", "number": "pl"},
    "s.m. agg.":        {"pos": "noun", "gender": "m"},
    # Verbs — transitive
    "v.t.":             {"pos": "verb", "transitivity": "transitive"},
    "v.t":              {"pos": "verb", "transitivity": "transitive"},
    "v. t.":            {"pos": "verb", "transitivity": "transitive"},
    "v. t":             {"pos": "verb", "transitivity": "transitive"},
    # Verbs — intransitive
    "v.int.":           {"pos": "verb", "transitivity": "intransitive"},
    "v.int":            {"pos": "verb", "transitivity": "intransitive"},
    "v. int.":          {"pos": "verb", "transitivity": "intransitive"},
    "v. int":           {"pos": "verb", "transitivity": "intransitive"},
    "v.intr.":          {"pos": "verb", "transitivity": "intransitive"},
    # Verbs — reflexive
    "v.rifl.":          {"pos": "verb", "form": "reflexive"},
    "v. rifl.":         {"pos": "verb", "form": "reflexive"},
    "v.rif.":           {"pos": "verb", "form": "reflexive"},
    # Verbs — reflexive reciprocal
    "v.rifl. recip.":   {"pos": "verb", "form": "reflexive_reciprocal"},
    "v. rifl. recip.":  {"pos": "verb", "form": "reflexive_reciprocal"},
    "v.rifl.recip.":    {"pos": "verb", "form": "reflexive_reciprocal"},
    # Verbs — pronominal (intransitive + pron.)
    "v.int. pron.":     {"pos": "verb", "form": "pronominal"},
    "v. int. pron.":    {"pos": "verb", "form": "pronominal"},
    "v.int.pron.":      {"pos": "verb", "form": "pronominal"},
    # Verbs — pronominal (transitive + pron.)
    "v.t. pron.":       {"pos": "verb", "form": "pronominal_transitive"},
    "v.t.pron.":        {"pos": "verb", "form": "pronominal_transitive"},
    "v. t. pron.":      {"pos": "verb", "form": "pronominal_transitive"},
    # Verbs — bare
    "v.":               {"pos": "verb"},
    # Other POS
    "agg.":             {"pos": "adjective"},
    "avv.":             {"pos": "adverb"},
    "prep.":            {"pos": "preposition"},
    "cong.":            {"pos": "conjunction"},
    "art.":             {"pos": "article"},
    "pron.":            {"pos": "pronoun"},
    "inter.":           {"pos": "interjection"},
    # Particles
    "part. pron. luogo": {"pos": "particle", "subtype": "locative_pronoun"},
    "part.pron.luogo":   {"pos": "particle", "subtype": "locative_pronoun"},
    "part. pron.":       {"pos": "particle", "subtype": "pronoun"},
    # Phrases (locutions)
    "loc.sost.m.":      {"pos": "noun_phrase", "gender": "m"},
    "loc.sost.f.":      {"pos": "noun_phrase", "gender": "f"},
    "loc.avv.":         {"pos": "adverbial_phrase"},
    "loc.agg.":         {"pos": "adjectival_phrase"},
    "loc.cong.":        {"pos": "conjunctive_phrase"},
    "loc.prep.":        {"pos": "prepositional_phrase"},
    "locuz.":           {"pos": "locution"},
}

# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------

def fetch_page(url: str) -> str:
    """Fetch a page with retries and explicit UTF-8 encoding."""
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        try:
            log.info("  Fetching %s (attempt %d/%d)", url, attempt, RETRY_ATTEMPTS)
            resp = requests.get(url, timeout=REQUEST_TIMEOUT, headers={
                "User-Agent": "Mozilla/5.0 (DCI-Lexicon-Scraper/1.0; academic-research)"
            })
            resp.encoding = "utf-8"
            resp.raise_for_status()
            return resp.text
        except requests.RequestException as exc:
            wait = RETRY_BACKOFF * attempt
            log.warning("  Request failed: %s — retrying in %.1fs", exc, wait)
            if attempt == RETRY_ATTEMPTS:
                raise
            time.sleep(wait)
    raise RuntimeError("unreachable")

# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

# Splits the normalised text into individual entry chunks at each "N. " boundary
ENTRY_SPLIT_RE = re.compile(r"(?=\b\d+\.\s)")

# Parses a single entry chunk like "184. gatto (s.m.)" or "83. auto (mobile) (s.f.)"
# The POS parenthetical is the LAST set of parens containing a dot.
# Trailing text (e.g., section headers) is tolerated.
ENTRY_PARSE_RE = re.compile(
    r"^(\d+)\.\s+"         # entry number
    r"(.+)\s+"             # word / lemma (greedy — safe because chunk is bounded)
    r"\(([^)]*\.[^)]*)\)", # last parenthetical containing a dot = POS block
)

# Matches abbreviated compound forms: "moto(cicletta)", "metro(politana)"
COMPOUND_PAREN_RE = re.compile(r"^(\w+)\((\w+)\)$")

# Matches "word (variant)" with a space: "auto (mobile)", "poco (po')"
WORD_VARIANT_RE = re.compile(r"^(.+?)\s+\(([^)]+)\)$")

# Slash that separates gender variants: "amico/a", "ragazzo/a", "zio/a"
GENDER_SLASH_RE = re.compile(r"^(.+)/([a-zA-Zàèéìòù]{1,4})$")


def normalise_pos(raw: str) -> dict[str, str]:
    """Map a raw POS code like 's.m.' to a structured dict."""
    stripped = raw.strip()

    # Try exact match first, then without trailing dot, then with trailing dot
    for key in (stripped, stripped.rstrip("."), stripped.rstrip(".") + "."):
        if key in POS_MAP:
            return dict(POS_MAP[key])

    # Collapse multiple spaces to single and retry — the site has inconsistent
    # spacing like "v.  int. pron." vs "v. int. pron."
    collapsed = re.sub(r"\s+", " ", stripped)
    for key in (collapsed, collapsed.rstrip("."), collapsed.rstrip(".") + "."):
        if key in POS_MAP:
            return dict(POS_MAP[key])

    # Remove all spaces and retry — handles "v.int.pron." vs "v. int. pron."
    no_spaces = stripped.replace(" ", "")
    for key in (no_spaces, no_spaces.rstrip("."), no_spaces.rstrip(".") + "."):
        if key in POS_MAP:
            return dict(POS_MAP[key])

    return {"pos_raw": stripped}


def parse_pos_block(block: str) -> list[dict[str, str]]:
    """
    Parse the parenthetical tag block which may contain multiple POS
    separated by ' – ', ' - ', or ' — '.

    Examples:
        "s.m."           -> [{"pos": "noun", "gender": "m"}]
        "v.t. – v.int."  -> [{"pos": "verb", ...}, {"pos": "verb", ...}]
        "agg. - s.m."    -> [{"pos": "adjective"}, {"pos": "noun", "gender": "m"}]
    """
    parts = re.split(r"\s*[–—-]\s*", block)
    results = []
    for part in parts:
        part = part.strip()
        if part:
            results.append(normalise_pos(part))
    return results


def expand_word(raw_word: str) -> list[str]:
    """
    Expand word forms into one or more lemma strings.

    Handles:
      - "amico/a"            -> ["amico", "amica"]
      - "bici/cletta"        -> ["bicicletta"]  (compound abbreviation)
      - "metro(politana)"    -> ["metropolitana"]  (no-space compound)
      - "auto (mobile)"      -> ["automobile"]  (space-separated compound)
      - "aereo(aeroplano)"   -> ["aereo", "aeroplano"]  (synonym in parens)
      - "poco (po')"         -> ["poco", "po'"]  (variant/alias)
      - "un/o/a"             -> ["un", "uno", "una"]
      - "chiamare/si"        -> ["chiamarsi"]  (reflexive)
    """
    word = raw_word.strip()

    # Handle no-space parenthetical compounds: "metro(politana)" -> "metropolitana"
    m = COMPOUND_PAREN_RE.match(word)
    if m:
        base, rest = m.group(1), m.group(2)
        # If rest starts with a letter that continues the base, it's a truncation:
        #   metro(politana) -> metropolitana
        #   moto(cicletta) -> motocicletta
        #   bici(cletta) -> bicicletta (base ends in 'i', rest starts with 'c')
        # If rest is a standalone alternative word, it's a synonym:
        #   aereo(aeroplano) -> [aereo, aeroplano]
        # Heuristic: truncation if rest[0] != base[0] (rest continues, not repeats)
        # and combined form doesn't repeat the base.
        if not rest.startswith(base[:2]):
            return [base + rest]
        else:
            return [base, rest]

    # Handle "word (variant)" with space: "auto (mobile)", "poco (po')"
    mv = WORD_VARIANT_RE.match(word)
    if mv:
        base_word = mv.group(1).strip()
        variant = mv.group(2).strip()
        # If variant is alphabetic and doesn't repeat the base prefix → compound
        #   "auto" + "mobile" -> "automobile"
        # If variant starts like the base → synonym pair
        #   "aereo" + "aeroplano" -> ["aereo", "aeroplano"]
        # If variant has non-alpha chars → alias
        #   "poco" + "po'" -> ["poco", "po'"]
        if variant.isalpha() and not variant.startswith(base_word[:2]):
            return [base_word + variant]
        return [base_word, variant]

    # Handle slash patterns
    if "/" in word:
        segments = word.split("/")

        # Multi-slash like "un/o/a"
        if len(segments) > 2:
            base = segments[0]
            results = [base]
            for suffix in segments[1:]:
                if len(suffix) <= 4 and suffix != base:
                    results.append(base[:-len(suffix)] + suffix if len(suffix) < len(base) else suffix)
                else:
                    results.append(suffix)
            return results

        base, suffix = segments

        # Compound abbreviation: "bici/cletta" -> "bicicletta"
        if len(suffix) > 4:
            return [base + suffix]

        # Reflexive: "chiamare/si" -> "chiamarsi"
        if suffix == "si" and base.endswith(("are", "ere", "ire")):
            return [base[:-1] + suffix]

        # Gender variant: "amico/a" -> ["amico", "amica"]
        gm = GENDER_SLASH_RE.match(word)
        if gm:
            base_word = gm.group(1)
            ending = gm.group(2)
            if len(ending) <= len(base_word):
                variant = base_word[: -len(ending)] + ending
                return [base_word, variant]

        # Fallback: "poco/po'" -> ["poco", "po'"]
        return [base, suffix]

    return [word]


def normalise_page_text(html: str) -> str:
    """
    Extract text from HTML and collapse each numbered entry onto one line.

    The site renders entries across multiple lines/elements like:
        83.\\t\\n
        auto (mobile)\\n
         (s.f.)\\n

    We collapse all whitespace between a number and the closing POS paren
    so the regex can match the full entry.
    """
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(separator=" ")
    # Collapse all whitespace runs (newlines, tabs, multiple spaces) into single space
    text = re.sub(r"\s+", " ", text)
    return text


def parse_entries(html: str, level: str) -> list[dict[str, Any]]:
    """
    Parse all vocabulary entries from a page's HTML.

    Returns a list of dicts, each with keys:
        word:    str   — the clean lemma
        pos_tags: list — array of POS metadata dicts
        level:   str   — CEFR level
        index:   int   — original numbering on the page
    """
    text = normalise_page_text(html)

    entries: list[dict[str, Any]] = []
    chunks = ENTRY_SPLIT_RE.split(text)
    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk:
            continue
        match = ENTRY_PARSE_RE.match(chunk)
        if not match:
            continue
        idx = int(match.group(1))
        raw_word = match.group(2).strip()
        pos_block = match.group(3).strip()

        pos_tags = parse_pos_block(pos_block)
        words = expand_word(raw_word)

        for w in words:
            clean = w.strip().lower()
            if not clean:
                continue
            entries.append({
                "word": clean,
                "pos_tags": pos_tags,
                "level": level,
                "index": idx,
            })

    return entries


# ---------------------------------------------------------------------------
# Merging into collision-safe schema
# ---------------------------------------------------------------------------

def merge_into_lexicon(
    lexicon: dict[str, list[dict[str, Any]]],
    entries: list[dict[str, Any]],
) -> int:
    """
    Merge parsed entries into the master lexicon dict.

    Each entry may produce multiple output records if it has multiple POS
    tags (e.g., "piacere" as both verb and noun).

    Returns count of records added.
    """
    added = 0
    for entry in entries:
        word = entry["word"]
        level = entry["level"]

        if word not in lexicon:
            lexicon[word] = []

        for pos_data in entry["pos_tags"]:
            record: dict[str, Any] = {**pos_data, "level": level}

            # Deduplicate: skip if an identical record already exists
            if record not in lexicon[word]:
                lexicon[word].append(record)
                added += 1

    return added


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

CEFR_ORDER = {"A1": 0, "A2": 1, "B1": 2, "B2": 3, "C1": 4, "C2": 5}


def deduplicate_to_lowest_level(
    lexicon: dict[str, list[dict[str, Any]]],
) -> dict[str, list[dict[str, Any]]]:
    """
    Since the Profilo lists are cumulative (B2 includes all A1–B1 words),
    each word+POS combo appears redundantly at every level at or above its
    introduction. This collapses to the LOWEST (earliest) level per unique
    word+POS signature, which is what the SRS system needs.
    """
    deduped: dict[str, list[dict[str, Any]]] = {}
    for word, records in lexicon.items():
        seen: dict[str, dict[str, Any]] = {}
        for rec in records:
            # Build a signature from everything except level
            sig_parts = {k: v for k, v in rec.items() if k != "level"}
            sig = json.dumps(sig_parts, sort_keys=True)
            level = rec["level"]
            if sig not in seen or CEFR_ORDER.get(level, 99) < CEFR_ORDER.get(seen[sig]["level"], 99):
                seen[sig] = rec
        deduped[word] = list(seen.values())
    return deduped


def print_stats(lexicon: dict[str, list[dict[str, Any]]]) -> None:
    """Print summary statistics of the scraped lexicon."""
    total_entries = sum(len(v) for v in lexicon.values())
    unique_words = len(lexicon)

    level_counts: dict[str, int] = {}
    pos_counts: dict[str, int] = {}
    collision_count = 0

    for word, records in lexicon.items():
        if len(records) > 1:
            collision_count += 1
        for rec in records:
            lv = rec.get("level", "?")
            level_counts[lv] = level_counts.get(lv, 0) + 1
            pos = rec.get("pos", rec.get("pos_raw", "?"))
            pos_counts[pos] = pos_counts.get(pos, 0) + 1

    log.info("=" * 60)
    log.info("LEXICON SUMMARY")
    log.info("=" * 60)
    log.info("  Unique lemmas:         %d", unique_words)
    log.info("  Total entries (w/POS): %d", total_entries)
    log.info("  Multi-entry collisions:%d", collision_count)
    log.info("")
    log.info("  Entries by CEFR level:")
    for lv in sorted(level_counts):
        log.info("    %-4s  %d", lv, level_counts[lv])
    log.info("")
    log.info("  Entries by POS:")
    for pos, count in sorted(pos_counts.items(), key=lambda x: -x[1]):
        log.info("    %-22s  %d", pos, count)
    log.info("=" * 60)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scrape CEFR vocabulary from Profilo della lingua italiana"
    )
    parser.add_argument(
        "--output", "-o",
        type=Path,
        default=Path(__file__).resolve().parent / "data" / "profilo_lexicon.json",
        help="Output JSON file path (default: data/profilo_lexicon.json)",
    )
    parser.add_argument(
        "--keep-all-levels",
        action="store_true",
        help="Keep redundant entries from cumulative lists instead of "
             "deduplicating to lowest CEFR level per word+POS",
    )
    args = parser.parse_args()
    output_path: Path = args.output

    log.info("Profilo della lingua italiana — CEFR Lexicon Scraper")
    log.info("Output: %s", output_path)
    log.info("")

    lexicon: dict[str, list[dict[str, Any]]] = {}

    for level, url in LEVELS.items():
        log.info("[%s] Scraping level %s ...", level, level)
        html = fetch_page(url)
        entries = parse_entries(html, level)
        log.info("[%s] Parsed %d raw entries from page", level, len(entries))

        added = merge_into_lexicon(lexicon, entries)
        log.info("[%s] Merged %d records into lexicon (%d unique lemmas so far)",
                 level, added, len(lexicon))
        log.info("")

        # Be polite to the university server
        if level != list(LEVELS)[-1]:
            time.sleep(POLITENESS_DELAY)

    if not args.keep_all_levels:
        before = sum(len(v) for v in lexicon.values())
        lexicon = deduplicate_to_lowest_level(lexicon)
        after = sum(len(v) for v in lexicon.values())
        log.info("Deduplicated to lowest CEFR level per word+POS: %d -> %d entries",
                 before, after)
        log.info("")

    print_stats(lexicon)

    # Write output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(lexicon, f, ensure_ascii=False, indent=2)

    log.info("Written %s (%.1f KB)", output_path, output_path.stat().st_size / 1024)
    log.info("Done.")


if __name__ == "__main__":
    main()
