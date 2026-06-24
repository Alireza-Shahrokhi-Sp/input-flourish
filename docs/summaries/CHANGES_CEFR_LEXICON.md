# Change Summary — Deterministic CEFR Lexicon (it_m3) Wired into the Verifier

**Date:** 2026-06-24
**Status:** Implemented, type-checked (Deno), and unit-tested **11/11 passing** against the real lexicon data. Not yet run live.

This upgrades the NLP density verifier ([`CHANGES_NLP_DENSITY_VERIFIER.md`](CHANGES_NLP_DENSITY_VERIFIER.md)) from **model-estimated** CEFR levels to **deterministic lexicon lookups**, using the `it_m3.xlsx` CEFR word list the user supplied. This removes the "no frequency lexicon available" blocker noted earlier and makes the i+1 "known/at-level" side of the rule actually measurable.

---

## Files

| File | What |
|---|---|
| `it_m3.xlsx` (repo root) | Source data the user added: 6,865 rows of `Lemma \| Pos \| CEFR level` ("Italian for Translators"). |
| [`supabase-functions/_shared/it_cefr_lexicon.json`](../../supabase-functions/_shared/it_cefr_lexicon.json) | **New.** Cleaned lexicon: 5,035 unique lemmas → CEFR level. Generated from the xlsx. |
| [`supabase-functions/_shared/lexicon.ts`](../../supabase-functions/_shared/lexicon.ts) | **New.** Loads the JSON; exports `lemmaLevel()`, `isAtOrBelowLevel()`. |
| [`supabase-functions/generate-story/index.ts`](../../supabase-functions/generate-story/index.ts) | `verifyDensity` now uses the lexicon (deterministic `cefrBreakdown` + `atLevelPct`). Removed the model `cefr` token field (superseded). |
| [`supabase-functions/generate-story/verifyDensity.test.ts`](../../supabase-functions/generate-story/verifyDensity.test.ts) | Updated: now imports the real lexicon and tests level lookups against actual data. |

---

## How the xlsx was converted (decisions made)

- **Dropped blank-level rows** (~1,516 of 6,865 had no level → unusable as level data).
- **Split comma-separated variants** (`"il, lo, la"` → `il`, `lo`, `la`) — only 4 such rows.
- **Resolved duplicates by keeping the EASIEST level** (231 lemmas appeared at >1 level; if a word is introduced at A1, a B1 learner is assumed to know it).
- Result: **5,035 unique lowercase lemmas**, balanced across A1–C1 (~1000 each) with C2 sparse (~130).
- Output as compact JSON (~80 KB) — small enough to bundle directly in the Edge Function (imported via `with { type: "json" }`).

---

## What changed in the verifier

Per the user's decisions: **"known" = known to the user** (their vocab) **OR at/below their level** per the lexicon; and **a word NOT in the lexicon counts as above-level / unknown** (conservative — protects the comprehension guarantee).

- **`cefrBreakdown`** is now a **deterministic** histogram from the lexicon, e.g. `{ A1: 41, A2: 18, B1: 12, B2: 9, "?": 20 }`. The `"?"` bucket is the share of content words not in the lexicon. (Previously this was a model estimate.)
- **`atLevelPct`** (new): % of content words with lexicon level ≤ the story's level. This is the lexicon half of the "95–98% known" rule.
- **`knownPct`** now = saved vocab **OR** target word **OR** at-level. Both `knownPct` and `atLevelPct` are **logged and returned** (`density.known_pct`, `density.at_level_pct`, `density.cefr_breakdown`) but are **NOT hard pass/fail gates yet** — gating them is a one-line change once lemma-match rates against real generations are confirmed.
- The hard gates remain **double-exposure** + **target-density**.
- The model `cefr` token field and its prompt instruction were **removed** (the lexicon supersedes them); the prompt now just stresses accurate lemmas, since the backend matches them against the lexicon.

---

## ⚠️ Important finding about this dataset (read this)

`it_m3` is a **translator's** word list, and its levels are **not always intuitive**. Verified examples from the actual data:

| Word | Level in it_m3 |
|------|------|
| casa | A1 |
| mangiare | A2 |
| cane | **B1** |
| gatto | **B2** |
| correre | A1 |

`gatto` ("cat") being B2 and `cane` ("dog") being B1 is surprising for a beginner vocabulary — this list ranks by translation-corpus frequency, not pedagogical "first words." **Consequence:** with the conservative "miss = above level" policy, `atLevelPct` for a genuine A1 story may read **lower than it feels**, because ordinary concrete nouns can sit at B1/B2 or be absent.

This is exactly why `atLevelPct`/`knownPct` are **reported, not gated** for now. Before hard-gating, you should look at real `density` logs and decide whether: (a) this list's levels suit the app, (b) the "miss = above level" policy is too strict, or (c) a more pedagogical word list is wanted. The infrastructure supports swapping the lexicon JSON without code changes.

---

## Verification performed

| Check | Result |
|---|---|
| xlsx → JSON conversion (openpyxl) | ✅ 5,035 entries, levels validated |
| `deno check` index.ts + lexicon.ts (incl. JSON import) | ✅ Clean (exit 0) |
| `deno test verifyDensity.test.ts` (11 tests, incl. real-lexicon lookups) | ✅ **11 passed, 0 failed** |
| Live run against real Gemini output | ⚠️ **Not done** — needs deployment. |

**Note:** the unit-test process caught my own wrong assumptions about the data (I initially assumed `gatto`=A1) — the tests now assert the *actual* values. Logic was correct; my expectations weren't. Good example of why the tests matter.

---

## Honest remaining limitations

- **Lemma-match dependency.** Accuracy hinges on the model's token `lemma` matching the lexicon's lemma form (lowercase, infinitive, masc. singular). Mismatches → false "unknown." Not yet measured against real generations.
- **Coverage.** 5,035 lemmas is core vocabulary; many valid words fall in the `"?"` bucket. The conservative policy then marks them above-level.
- **Dataset suitability** — see the finding above. The levels may need review for a *learner* app vs. a *translator* list.
- **Not run live.** Type-checked + unit-tested only.
- **Test duplicates the pure logic** (verifyDensity lives in index.ts). Recommended follow-up: extract `verifyDensity` to its own module so the test imports it directly.

---

## To deploy
The lexicon JSON + `_shared/lexicon.ts` must be deployed alongside the function. With the Supabase CLI, `supabase functions deploy generate-story` bundles imported files. Via the Dashboard, ensure the `_shared` files are included. After deploy, generate a story and check logs for `density attempt … atLevelPct=… cefr={…}`.

Re-run local checks: `pwsh -File supabase-functions/check.ps1` (type) and `deno test --allow-read --allow-net supabase-functions/generate-story/verifyDensity.test.ts` (unit).
