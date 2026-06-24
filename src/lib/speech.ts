export function loadVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const existing = window.speechSynthesis.getVoices();
    if (existing.length) return resolve(existing);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.speechSynthesis.removeEventListener("voiceschanged", finish);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", finish);
    window.setTimeout(finish, timeoutMs);
  });
}

export function pickItalianVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | undefined {
  const italian = voices.filter((v) => v.lang.toLowerCase().startsWith("it"));
  if (!italian.length) return undefined;
  const exact = italian.filter((v) => v.lang.toLowerCase() === "it-it");
  const pool = exact.length ? exact : italian;
  return pool.find((v) => v.localService) ?? pool[0];
}

export type Sentence = { text: string; start: number; end: number };

export function segmentSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /[^.!?…\n]*(?:[.!?…]+["»"')\]]*|\n+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    if (m.index === re.lastIndex) {
      re.lastIndex++;
      continue;
    }
    if (!raw.trim()) continue;
    out.push({ text: raw.trim(), start: m.index, end: m.index + raw.length });
  }
  return out;
}
