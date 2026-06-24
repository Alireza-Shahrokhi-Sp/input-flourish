import lexicon from "./it_cefr_lexicon.json";

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

const LEX = lexicon as Record<string, string>;

export function lemmaLevel(lemma: string): CefrLevel | null {
  return (LEX[lemma.toLowerCase()] as CefrLevel) ?? null;
}
