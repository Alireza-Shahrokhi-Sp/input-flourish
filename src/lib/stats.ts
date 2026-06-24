export type VocabLite = {
  id: string;
  status: string;
  cefr_level: string | null;
  theme_tag: string | null;
  created_at: string;
};

export type SrsLite = {
  vocab_id: string;
  interval_days: number;
  ease: number;
  reps: number;
  lapses: number;
  due_at: string;
  last_reviewed_at: string | null;
};

export type Stats = {
  total: number;
  due: number;
  reviewedTotal: number;
  mastering: number;
  learning: number;
  mature: number;
  young: number;
  newCards: number;
  retention: number | null;
  streakDays: number;
  reviewsByDay: { date: string; count: number }[];
  byLevel: { level: string; count: number }[];
  byTheme: { theme: string; count: number }[];
};

const DAY = 86_400_000;
const MATURE_DAYS = 21;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function computeStats(vocab: VocabLite[], srs: SrsLite[], now = new Date()): Stats {
  const srsByVocab = new Map(srs.map((s) => [s.vocab_id, s]));
  const nowMs = now.getTime();

  let due = 0,
    reviewedTotal = 0,
    mastering = 0,
    learning = 0;
  let mature = 0,
    young = 0,
    newCards = 0,
    totalReps = 0,
    totalLapses = 0;

  for (const v of vocab) {
    const s = srsByVocab.get(v.id);
    if (v.status === "mastering") mastering++;
    else learning++;
    if (!s || s.reps === 0) {
      newCards++;
      due++;
      continue;
    }
    reviewedTotal += s.reps;
    totalReps += s.reps;
    totalLapses += s.lapses;
    if (new Date(s.due_at).getTime() <= nowMs) due++;
    if (s.interval_days >= MATURE_DAYS) mature++;
    else young++;
  }

  const retention =
    totalReps + totalLapses > 0
      ? Math.round((totalReps / (totalReps + totalLapses)) * 100)
      : null;

  const counts = new Map<string, number>();
  for (const s of srs) {
    if (!s.last_reviewed_at) continue;
    const d = new Date(s.last_reviewed_at);
    if (nowMs - d.getTime() > 30 * DAY) continue;
    const k = dayKey(d);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const reviewsByDay: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(nowMs - i * DAY);
    const k = dayKey(d);
    reviewsByDay.push({ date: k, count: counts.get(k) ?? 0 });
  }

  let streakDays = 0;
  for (let i = 0; ; i++) {
    const d = new Date(nowMs - i * DAY);
    const k = dayKey(d);
    if ((counts.get(k) ?? 0) > 0) streakDays++;
    else if (i === 0) continue;
    else break;
  }

  const levelMap = new Map<string, number>();
  for (const v of vocab) {
    const lv = v.cefr_level ?? "—";
    levelMap.set(lv, (levelMap.get(lv) ?? 0) + 1);
  }
  const byLevel = Array.from(levelMap, ([level, count]) => ({ level, count })).sort(
    (a, b) => a.level.localeCompare(b.level),
  );

  const themeMap = new Map<string, number>();
  for (const v of vocab) {
    if (!v.theme_tag) continue;
    themeMap.set(v.theme_tag, (themeMap.get(v.theme_tag) ?? 0) + 1);
  }
  const byTheme = Array.from(themeMap, ([theme, count]) => ({ theme, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    total: vocab.length,
    due,
    reviewedTotal,
    mastering,
    learning,
    mature,
    young,
    newCards,
    retention,
    streakDays,
    reviewsByDay,
    byLevel,
    byTheme,
  };
}
