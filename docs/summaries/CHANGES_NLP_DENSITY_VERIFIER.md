# Change Summary — NLP Density Verifier (Deterministic Output Check)

**Date:** 2026-06-24
**Files touched:**
- [`supabase-functions/generate-story/index.ts`](../../supabase-functions/generate-story/index.ts) — the verifier + retry loop
- [`supabase-functions/generate-story/verifyDensity.test.ts`](../../supabase-functions/generate-story/verifyDensity.test.ts) — unit tests (new)
- [`supabase-functions/deno.jsonc`](../../supabase-functions/deno.jsonc), [`supabase-functions/check.ps1`](../../supabase-functions/check.ps1) — local Deno tooling (new)

**Status:** Implemented, **type-checked with Deno, and unit-tested (8/8 passing).** Not yet deployed/run live.

Implements the deterministic verification step from [`CLAUDE.md`](../../../CLAUDE.md):

> **NLP Verification:** ...parse the LLM's output, calculate the exact percentage of known vs. target lemmas, and trigger a retry or fallback if the text violates the 95-98% constraint.
> **Double Exposure:** Target SRS words MUST appear at least twice.

---

## What "known" means here (corrected per user)

**"Known" = known to THIS user** — their saved vocabulary (`vocab_items`), **not** "at/below a CEFR level." The verifier builds the known set from the user's *full* saved vocab (previously the function only kept the first 30 lemmas, for a prompt hint; now the complete set feeds verification).

---

## What the verifier checks

`verifyDensity()` re-derives numbers from the model's **own per-token lemmas**, independent of its self-report:

1. **Double Exposure (hard gate):** every SRS-due target lemma must appear **≥ 2×** among content words. Unmet ones are listed and trigger a retry.
2. **Target density (hard gate):** due words must be ~2–5% of content words (enforced 1.5%–8%, with slack for short A1 texts). Over/under-use is flagged.
3. **Known coverage (reported, not gated):** `knownPct` = % of content words the user already knows (their vocab + the target words, which they're actively learning). This is the real i+1 signal. It is **logged and returned but NOT a hard pass/fail gate** — a brand-new user with an almost-empty vocab would otherwise fail every story through no fault of generation. It becomes meaningful as their vocab grows; hard-gating it later is a one-line change.
4. **CEFR-level density (`cefrBreakdown`):** the "density of each word's CEFR level" you asked about — e.g. `{ A1: 70, A2: 22, B1: 8 }`.

Function words (articles, prepositions, pronouns, punctuation, spaces) are excluded so percentages reflect meaningful vocabulary.

---

## The CEFR breakdown — how it's sourced (be aware)

Token lemmas don't inherently carry a CEFR level. So the breakdown is built from an **optional `cefr` field the model is now asked to emit per content token** (added to the prompt's token schema + instructions). Therefore:

- It is the **model's estimate**, surfaced for insight — **not a deterministic measurement.** It's clearly labeled as such in code and only computed when the model tags ≥50% of content words (else `cefrBreakdown` is `null`).
- A truly deterministic CEFR breakdown would need a CEFR-graded Italian frequency lexicon (the spaCy approach). That remains a possible follow-up; this gives you the insight now without that data dependency, honestly labeled.

---

## How it behaves (retry loop)

Generation is wrapped in a max-2-attempt loop. If attempt 1 fails the hard gates, a **specific Italian corrective instruction** (e.g. "these target words don't appear twice: … rewrite so each appears ≥2×") is appended and it regenerates once. Each `density attempt N: pass=… targetPct=… knownPct=… cefr=… reason=…` line is logged.

**Soft fail-safe:** if it still fails after 2 attempts, the story is **served anyway** (a generated story beats an error). The *hard* fail-safe — serving a cached pre-annotated story instead — is the separate [`docs/plans/CACHED_FALLBACK_PLAN.md`](../plans/CACHED_FALLBACK_PLAN.md).

The success response now includes `density: { pass, target_pct, known_pct, unmet_targets, cefr_breakdown }`.

---

## Verification performed (this time it WAS verified)

| Check | Result |
|---|---|
| Deno installed locally (`winget install DenoLand.Deno`) → `deno 2.8.3` | ✅ |
| `deno check generate-story/index.ts` (type-check, resolves remote imports) | ✅ **Clean** |
| `deno test verifyDensity.test.ts` (8 unit tests: counting, double-exposure, density bands, knownPct, cefr threshold, edge cases) | ✅ **8 passed, 0 failed** |
| Live run against real Gemini output | ⚠️ **Not done** — needs deployment + a real generation. |

**Local check tooling added** so this is repeatable:
- `supabase-functions/check.ps1` — finds Deno (even pre-PATH-refresh) and type-checks the functions.
- `supabase-functions/deno.jsonc` — Deno config + `check` task.

**Test caveat:** the unit test re-declares a copy of the pure `verifyDensity` logic, because it currently lives inside `index.ts` (which starts a server via `Deno.serve`). The copy is kept in sync by hand. If `verifyDensity` is later extracted to its own module, the test should import it directly instead. (Recommended small follow-up.)

---

## Remaining honest limitations

- **Relies on the LLM's own lemmatization + CEFR estimate.** A real lemmatizer/lexicon (spaCy + frequency list, via a separate Python service) would be more robust. Same root constraint: this is a Deno Edge Function, not Python.
- **knownPct isn't gated yet** (see above) — intentional for new users.
- **Each retry costs a Gemini call** (latency/quota); capped at 2.
- **Not run live.** Type-checked and unit-tested, but not yet exercised end-to-end against the real model.

---

## To deploy
Paste into **Supabase Dashboard → Edge Functions → generate-story**, or `supabase functions deploy generate-story`. Then generate a story with SRS-due target words and check logs for the `density attempt …` line. Re-run local checks anytime with `pwsh -File supabase-functions/check.ps1`.
