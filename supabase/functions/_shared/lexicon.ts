// CEFR-graded Italian lexicon lookup, derived from the "Profilo della lingua
// italiana" word lists (Università per Stranieri di Perugia, A1–B2).
//
// 2,127 unique lemmas, each mapped to the LOWEST CEFR level at which it first
// appears (if a lemma is introduced at A1, a B1 learner is assumed to know it).
// Scraped and converted by profilo-scraper/scrape_profilo_lexicon.py.
//
// Replaces the earlier it_m3.xlsx translator list which had counter-intuitive
// pedagogical levels (e.g. gatto=B2). The Profilo list is designed for learners.

import lexicon from "./it_cefr_lexicon.json" with { type: "json" };

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

const LEX = lexicon as Record<string, CefrLevel>;

const LEVEL_ORDER: Record<CefrLevel, number> = {
  A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6,
};

/** CEFR level of a lemma, or null if it's not in the lexicon. */
export function lemmaLevel(lemma: string): CefrLevel | null {
  return LEX[lemma.toLowerCase()] ?? null;
}

/**
 * Is `lemma` at or below the user's level (i.e. expected to be "known" by level)?
 *
 * Per the chosen policy, a lemma NOT in the lexicon is treated as ABOVE level
 * (conservative: unknown words are assumed harder than the user's level, which
 * protects the comprehension guarantee). Callers typically OR this with "is in
 * the user's saved vocab" to get the full known signal.
 */
export function isAtOrBelowLevel(lemma: string, userLevel: string): boolean {
  const lvl = lemmaLevel(lemma);
  if (!lvl) return false; // not in lexicon → assume above level
  const user = LEVEL_ORDER[userLevel as CefrLevel];
  if (!user) return false; // unknown user level → don't claim "known"
  return LEVEL_ORDER[lvl] <= user;
}

export const LEXICON_SIZE = Object.keys(LEX).length;
