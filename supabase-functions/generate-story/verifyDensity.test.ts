// Unit tests for the density verifier logic.
// Run from supabase-functions/:  deno test --allow-read generate-story/verifyDensity.test.ts
//
// The verifier lives inside index.ts (which boots a server via Deno.serve and
// makes network calls), so we re-declare a copy of the PURE logic here to test
// it in isolation — BUT we import the real CEFR lexicon helpers so the
// deterministic level lookups are exercised for real. If verifyDensity is later
// extracted into its own module, import it directly instead of duplicating.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { lemmaLevel, isAtOrBelowLevel } from "../_shared/lexicon.ts";

// ---- copy of the pure logic under test (keep in sync with index.ts) ----
type Token = { i?: number; surface?: string; lemma?: string | null; pos?: string; cefr?: string | null };
type ParsedStory = { title: string; body: string; tokens?: Token[]; grammar?: unknown[] };

const CONTENT_POS = new Set(["noun", "verb", "adj", "adv", "propn", "num"]);
function isContentToken(t: Token): boolean {
  if (!t.lemma) return false;
  if (!/\p{L}/u.test(t.surface ?? t.lemma)) return false;
  if (t.pos) return CONTENT_POS.has(t.pos.toLowerCase());
  return true;
}
const TARGET_MIN_PCT = 1.5;
const TARGET_MAX_PCT = 8.0;
const MIN_TARGET_OCCURRENCES = 2;

function verifyDensity(parsed: ParsedStory, targetLemmas: Set<string>, knownLemmas: Set<string>, userLevel: string) {
  const tokens = Array.isArray(parsed.tokens) ? parsed.tokens : [];
  const lemmaCounts = new Map<string, number>();
  const cefrCounts = new Map<string, number>();
  let contentWordCount = 0, knownCount = 0, atLevelCount = 0;
  for (const t of tokens) {
    if (!isContentToken(t)) continue;
    contentWordCount++;
    const lemma = (t.lemma as string).toLowerCase();
    lemmaCounts.set(lemma, (lemmaCounts.get(lemma) ?? 0) + 1);
    const atLevel = isAtOrBelowLevel(lemma, userLevel);
    if (atLevel) atLevelCount++;
    if (knownLemmas.has(lemma) || targetLemmas.has(lemma) || atLevel) knownCount++;
    const lvl = lemmaLevel(lemma) ?? "?";
    cefrCounts.set(lvl, (cefrCounts.get(lvl) ?? 0) + 1);
  }
  if (contentWordCount === 0) {
    return { pass: true, targetPct: 0, knownPct: 0, atLevelPct: 0, contentWordCount: 0, unmetTargets: [] as string[], cefrBreakdown: null as Record<string, number> | null, reason: "no-tokens" };
  }
  const unmetTargets: string[] = [];
  let targetOccurrences = 0;
  for (const tgt of targetLemmas) {
    const c = lemmaCounts.get(tgt) ?? 0;
    targetOccurrences += c;
    if (c < MIN_TARGET_OCCURRENCES) unmetTargets.push(tgt);
  }
  const targetPct = (targetOccurrences / contentWordCount) * 100;
  const knownPct = (knownCount / contentWordCount) * 100;
  const atLevelPct = (atLevelCount / contentWordCount) * 100;
  const cefrBreakdown: Record<string, number> = {};
  for (const [lvl, n] of cefrCounts) cefrBreakdown[lvl] = Math.round((n / contentWordCount) * 1000) / 10;
  const hasTargets = targetLemmas.size > 0;
  const doubleExposureOk = unmetTargets.length === 0;
  const densityOk = !hasTargets || (targetPct >= TARGET_MIN_PCT && targetPct <= TARGET_MAX_PCT);
  const pass = !hasTargets ? true : doubleExposureOk && densityOk;
  return { pass, targetPct, knownPct, atLevelPct, contentWordCount, unmetTargets, cefrBreakdown, reason: pass ? "ok" : "fail" };
}
// ---- end copy ----

const word = (surface: string, lemma: string, pos = "noun"): Token => ({ surface, lemma, pos });
const space = (): Token => ({ surface: " ", lemma: null, pos: "other" });

Deno.test("counts only content words, excludes spaces/punct/function words", () => {
  const story: ParsedStory = {
    title: "t", body: "x",
    tokens: [
      { surface: "Il", lemma: "il", pos: "det" }, space(),
      word("gatto", "gatto"), space(),
      { surface: ".", lemma: null, pos: "punct" },
    ],
  };
  const r = verifyDensity(story, new Set(), new Set(), "A2");
  assertEquals(r.contentWordCount, 1);
});

Deno.test("double exposure: target appearing once fails", () => {
  const story: ParsedStory = {
    title: "t", body: "x",
    tokens: [word("cane", "cane"), space(), word("correre", "correre", "verb"), space(), word("cane", "cane")],
  };
  const r = verifyDensity(story, new Set(["correre"]), new Set(), "A2");
  assert(!r.pass);
  assertEquals(r.unmetTargets, ["correre"]);
});

Deno.test("double exposure: target appearing twice passes", () => {
  const toks: Token[] = [word("xqztarget", "xqztarget", "verb"), word("xqztarget", "xqztarget", "verb")];
  for (let i = 0; i < 48; i++) toks.push(word(`zzfiller${i}`, `zzfiller${i}`));
  const r = verifyDensity({ title: "t", body: "x", tokens: toks }, new Set(["xqztarget"]), new Set(), "A2");
  assert(r.pass, `expected pass, got reason=${r.reason} targetPct=${r.targetPct}`);
  assertEquals(r.unmetTargets, []);
});

Deno.test("target too dense fails", () => {
  const toks: Token[] = [word("x", "x", "verb"), word("x", "x", "verb"), word("x", "x", "verb")];
  for (let i = 0; i < 7; i++) toks.push(word(`w${i}`, `w${i}`));
  const r = verifyDensity({ title: "t", body: "x", tokens: toks }, new Set(["x"]), new Set(), "A2");
  assert(!r.pass);
});

// ---- lexicon-backed tests (real Profilo della lingua italiana data) ----

Deno.test("lexicon: real levels match the Profilo dataset (sanity check)", () => {
  assertEquals(lemmaLevel("casa"), "A1");
  assertEquals(lemmaLevel("mangiare"), "A1");
  assertEquals(lemmaLevel("gatto"), "A1");
  assertEquals(lemmaLevel("correre"), "A2");
  assert(isAtOrBelowLevel("casa", "A1"));    // A1 <= A1
  assert(isAtOrBelowLevel("mangiare", "A2")); // A1 <= A2
  assert(isAtOrBelowLevel("gatto", "A1"));    // A1 <= A1
  assert(!isAtOrBelowLevel("correre", "A1")); // A2 > A1 → not at level
});

Deno.test("lexicon: word not in list counts as above-level / unknown", () => {
  assertEquals(lemmaLevel("xqztnotaword"), null);
  assert(!isAtOrBelowLevel("xqztnotaword", "C2")); // miss → not at-level even at C2
});

Deno.test("atLevelPct: real lexicon words at/below user level count as known", () => {
  // casa=A1 and mangiare=A2 → both at-level for A2; nonsense word is not.
  const toks = [word("casa", "casa", "noun"), word("mangiare", "mangiare", "verb"), word("xqztnotaword", "xqztnotaword", "noun")];
  const r = verifyDensity({ title: "t", body: "x", tokens: toks }, new Set(), new Set(), "A2");
  assertEquals(r.atLevelPct, (2 / 3) * 100); // 2/3 at level (raw, unrounded)
  // knownPct == atLevelPct here (no saved vocab, no targets).
  assertEquals(r.knownPct, r.atLevelPct);
});

Deno.test("knownPct also counts saved vocab and targets beyond at-level", () => {
  // A nonsense word that's NOT in the lexicon, but IS in the user's saved vocab.
  const toks = [word("xqztsaved", "xqztsaved", "noun"), word("xqzttarget", "xqzttarget", "noun"), word("xqztother", "xqztother", "noun")];
  const r = verifyDensity({ title: "t", body: "x", tokens: toks }, new Set(["xqzttarget"]), new Set(["xqztsaved"]), "A1");
  // saved + target = 2 of 3 familiar; none at-level (all out of lexicon).
  assertEquals(r.atLevelPct, 0);
  assertEquals(r.knownPct, (2 / 3) * 100); // raw, unrounded
});

Deno.test("cefrBreakdown buckets unknown words under '?'", () => {
  const toks = [word("casa", "casa", "noun"), word("xqztnotaword", "xqztnotaword", "noun")];
  const r = verifyDensity({ title: "t", body: "x", tokens: toks }, new Set(), new Set(), "A2");
  assert(r.cefrBreakdown !== null);
  assertEquals(r.cefrBreakdown!["A1"], 50);  // casa
  assertEquals(r.cefrBreakdown!["?"], 50);   // nonsense word
});

Deno.test("no targets → passes vacuously", () => {
  const r = verifyDensity({ title: "t", body: "x", tokens: [word("a", "a")] }, new Set(), new Set(), "A2");
  assert(r.pass);
});

Deno.test("no tokens → passes by default", () => {
  const r = verifyDensity({ title: "t", body: "x", tokens: [] }, new Set(["x"]), new Set(), "A2");
  assert(r.pass);
  assertEquals(r.reason, "no-tokens");
});
