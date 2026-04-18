// SM-2 lite. Quality: 0=again, 1=hard, 2=good, 3=easy.
export type Quality = 0 | 1 | 2 | 3;

export type SrsState = {
  interval_days: number;
  ease: number;
  reps: number;
  lapses: number;
  due_at: string;
  last_reviewed_at: string | null;
};

export function nextSrs(prev: Partial<SrsState> | null, q: Quality): SrsState {
  const now = new Date();
  let ease = prev?.ease ?? 2.5;
  let reps = prev?.reps ?? 0;
  let lapses = prev?.lapses ?? 0;
  let interval = prev?.interval_days ?? 0;

  if (q === 0) {
    lapses += 1;
    reps = 0;
    interval = 0; // due again today
    ease = Math.max(1.3, ease - 0.2);
  } else {
    reps += 1;
    if (reps === 1) interval = q === 1 ? 1 : q === 2 ? 2 : 4;
    else if (reps === 2) interval = q === 1 ? 3 : q === 2 ? 6 : 10;
    else interval = Math.round(interval * (q === 1 ? 1.2 : q === 2 ? ease : ease * 1.3));
    ease = Math.max(1.3, ease + (q === 3 ? 0.1 : q === 1 ? -0.15 : 0));
  }
  const due = new Date(now.getTime() + interval * 86_400_000);
  return {
    interval_days: interval,
    ease,
    reps,
    lapses,
    due_at: due.toISOString(),
    last_reviewed_at: now.toISOString(),
  };
}
