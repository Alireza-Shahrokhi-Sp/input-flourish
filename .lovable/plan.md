
# Italian Comprehensible Input App — Updated Plan

## Changes from previous plan

**1. Smarter grammar annotation**
- Inline markers (subtle underline + click-to-explain) are reserved for **complex / non-obvious structures only**: subjunctive, conditional, hypothetical periods, pronominal verbs, ne/ci particles, passive si, gerund constructions, etc.
- Simple/expected structures for the level (e.g. present indicative at A1, passato prossimo at A2) are NOT inlined.
- Instead, each story ends with a **"Grammatica di questa storia"** section listing all grammar points used, with intuitive naming, a one-line explanation, the sentence from the story where it appeared, and 2–3 extra examples.
- Verbs still get conjugation tables on click (tense used + optional full table) regardless of complexity — that part is unchanged.

**2. Level + stretch choice before generation**
- On the generate screen, the user picks a level **and** a difficulty mode:
  - **Standard** (e.g. B1) — content stays strictly within the chosen CEFR level.
  - **Stretch / "+"** (e.g. B1+) — content is mostly at the chosen level, but deliberately seeds **one or two elements** from exactly one level above (B2). Never two levels up.
- The "+" elements are picked from a curated stretch-feature pool per level pair (e.g. for B1→B2: congiuntivo presente, periodo ipotetico II tipo, relative pronouns cui/il quale, ne particle in compound tenses).
- Stretch elements are **always inline-marked** (since they're above level, they qualify as complex by definition) and also called out at the top of the end-of-story grammar section under "Elementi di sfida (B2)".
- The user's level setting in profile = default; the per-generation choice can override it for that story only.

## Implementation deltas

- `stories` table: add `mode` ("standard" | "stretch") and `stretch_level` (nullable, e.g. "B2").
- `story_annotations`: grammar entries gain `complexity` ("simple" | "complex") and `is_stretch` (bool) so the reader knows which to inline-underline vs. only list at the end.
- Generate screen UI: level dropdown (A1–C2) + a toggle "Sfidami (+)" that appears next to it, with a small tooltip explaining what "+" does.
- Reader: only renders inline grammar markers where `complexity === "complex" || is_stretch`. End-of-story section renders all entries, with stretch entries grouped first under a "Challenge" heading.
- LLM prompt updates:
  - Receives `level`, `mode`, and (if stretch) `stretch_level` + the allowed stretch-feature pool for that pair.
  - Instructed to keep the bulk of the text at `level`, introduce at most 1–2 stretch features in natural context (not forced), and tag every grammar entry it returns with `complexity` and `is_stretch`.
  - Same single batched JSON call as before — no extra round trips.

Everything else from the previous plan (auth, formats, vocab/SRS, embedded reinforcement, ElevenLabs TTS shadowing, flashcard review, library, serialized chapters) stays the same.
