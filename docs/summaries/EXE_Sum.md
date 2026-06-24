# Executive Summary

## 2026-06-24 — Phrase/Expression Saving Feature

**What:** Added the ability to select multi-word expressions (idioms, phrasal verbs, collocations) from stories and save them to the vocabulary with LLM-generated analysis.

**Why:** The vocab system only supported saving single tokens. Language learners need to capture multi-word expressions like "in bocca al lupo", "farcela", "darsi da fare" as whole units, with their meaning and structural explanation.

### Components

1. **`explain-phrase` Edge Function** (`supabase-functions/explain-phrase/index.ts`)
   - Accepts a phrase + surrounding sentence context
   - Calls Gemini to analyze: returns lemma form, POS category (locuzione, verbo pronominale, espressione idiomatica, collocazione, etc.), English meaning, and a structural note explaining why/how the expression works
   - Validates that at least 2 words are selected
   - Returns null-result with user-friendly error if selection isn't a recognizable expression
   - Same auth pattern and Gemini retry logic as existing Edge Functions

2. **`PhraseSelectionPopover` component** (`src/components/PhraseSelectionPopover.tsx`)
   - Listens for text selection (mouseup) inside the story article
   - Only triggers when 2+ words are selected
   - Shows a floating "Analizza espressione" button above the selection
   - On click, calls the Edge Function, then shows the analysis result card
   - User can save to vocab with one click — stored with `pos` (e.g. "locuzione"), `translation` (meaning), and `notes` (structural explanation)
   - CEFR level assigned via lexicon lookup, falling back to story level
   - Dismisses on click outside

3. **Story page integration** (`src/routes/story.$id.tsx`)
   - Wrapped article in a ref-bearing `<div>` for the selection listener
   - PhraseSelectionPopover rendered inside that container
   - Works for both tokenized and plain-text renderers

4. **Vocab page enhancements** (`src/routes/vocab.tsx`)
   - Multi-word lemmas now show an "espressione" badge (olive green) to distinguish them from single words
   - The `notes` field is now rendered below the translation (shows the structural explanation from Gemini)

5. **CSS** (`src/styles.css`)
   - Added `.phrase-popover` positioning class for the floating popover

### Deploy notes

- Deploy the new `explain-phrase` Edge Function: `supabase functions deploy explain-phrase`
- No DB schema changes needed — phrases use existing `vocab_items` columns (`lemma`, `pos`, `translation`, `notes`)
- Build passes clean

---

## 2026-06-24 — Profilo della lingua italiana CEFR Lexicon Scraper + Integration

**What:** Created a standalone Python scraper (`scripts/`) that extracts the complete A1–B2 vocabulary lists from the Università per Stranieri di Perugia's "Profilo della lingua italiana" website and outputs a structured JSON lexicon. Then wired it into the density verifier as a drop-in replacement for the old `it_m3.xlsx`-derived lexicon.

**Why:** The existing `it_m3.xlsx` lexicon (5,035 lemmas from a translator word list) had pedagogically unintuitive CEFR levels (e.g., "gatto" at B2, "cane" at B1). The Profilo lists are a standard pedagogical CEFR source designed for Italian language learners, making them a better fit for the i+1 comprehension rule in the DCI platform.

### Part 1: Scraper

**Output:** `scripts/data/profilo_lexicon.json` (rich schema, 227 KB)

- **2,127 unique lemmas**, **2,386 entries** (after dedup to lowest CEFR level per word+POS)
- A1: 543, A2: 662, B1: 578, B2: 603 entries
- 242 multi-POS collisions handled (e.g., "piacere" as verb + noun)
- Zero unmapped POS codes

**Key design decisions:**

1. **Collision-safe schema:** Each word key maps to an array of entry objects, supporting words at multiple levels/POS (e.g., `"stato": [{"pos": "noun", ...}, {"pos": "verb", ...}]`).
2. **Deduplication:** Since Profilo lists are cumulative (B2 includes all A1–B1 words), duplicates are collapsed to the earliest CEFR level per word+POS. Pass `--keep-all-levels` to preserve all.
3. **Word expansion:** Handles slash variants (`amico/a` → amico + amica), compound truncations (`metro(politana)` → metropolitana), spaced compounds (`auto (mobile)` → automobile), synonyms (`aereo(aeroplano)` → aereo + aeroplano), reflexives (`chiamare/si` → chiamarsi).
4. **POS normalization:** All Italian grammar codes (`s.m.`, `v.int.pron.`, `agg.`, etc.) mapped to structured metadata with pos, gender, transitivity, form fields. Handles inconsistent whitespace in the source data.

### Part 2: Integration into density verifier

**Replaced:** `supabase-functions/_shared/it_cefr_lexicon.json`

- Old: 5,035 entries from `it_m3.xlsx` (translator corpus, 80 KB)
- New: 2,127 entries from Profilo (pedagogical word lists, 32 KB)
- Format: identical flat `{"lemma": "CEFR_level"}` — no code changes needed in `lexicon.ts` or `index.ts`
- Updated comments in `lexicon.ts` and `index.ts` to reference the new data source
- Updated `verifyDensity.test.ts` assertions to match the Profilo levels (gatto=A1, mangiare=A1, correre=A2)

**Level comparison (key words):**

| Word | Old (it_m3) | New (Profilo) |
|------|-------------|---------------|
| casa | A1 | A1 |
| gatto | B2 | A1 |
| cane | B1 | A1 |
| mangiare | A2 | A1 |
| correre | A1 | A2 |

**Trade-offs:**

- **Smaller coverage:** 2,127 vs 5,035 lemmas. More words will fall into the "?" (unknown level) bucket in `cefrBreakdown`. The conservative policy (unknown = above level) still protects comprehension, but `atLevelPct` may read lower.
- **No C1/C2 data:** Profilo only covers A1–B2. The `CefrLevel` type still includes C1/C2 for future extension, but no words currently map to those levels.
- **Better pedagogical fit:** Levels now match learner intuition. The `atLevelPct` metric is more meaningful for gating decisions.

**Not yet done:**

- Deno not installed on this machine — tests were verified via Node.js JSON validation but not via `deno test`. Run `deno test --allow-read generate-story/verifyDensity.test.ts` after deployment to confirm.
- Live run against real Gemini output (needs deployment).
- Consider supplementing the Profilo lexicon with additional sources to increase coverage beyond 2,127 lemmas (C1/C2 gap, specialized vocabulary).
