# Implementation Plan — Three Improvements

This document specifies three improvements to **Letture** in enough detail to be implemented directly. Each section is self-contained: scope, files to touch, exact code changes, and acceptance criteria.

**Conventions for the implementer:**
- All UI text is in **Italian** to match the existing app. Suggested strings are given; keep the register casual/encouraging like the existing copy.
- Use existing shadcn/ui components from [`src/components/ui/`](src/components/ui/) — do not add new dependencies.
- Use the `cn()` helper from [`src/lib/utils.ts`](src/lib/utils.ts) for conditional classes.
- Match the existing code style: `React.useState`/`React.useEffect` (namespace import), `supabase` from [`src/integrations/supabase/client.ts`](src/integrations/supabase/client.ts), `toast` from `sonner`.
- Color tokens available: `primary`, `stretch`, `grammar`, `muted-foreground`, `destructive`, `border`, `card`. See [`src/styles.css`](src/styles.css).
- After each feature, run `npm run lint` and `npm run build` and fix any errors before considering it done.

---

## Improvement 1 — Fix Vocab Search Bug + Add Filters & Sorting

### Problem
In [`src/routes/vocab.tsx:82-84`](src/routes/vocab.tsx#L82-L84) the search filter has a **case-sensitivity bug**:

```ts
const filtered = rows?.filter(
  (r) => !q || r.lemma.includes(q.toLowerCase()) || r.translation?.toLowerCase().includes(q.toLowerCase()),
);
```

`r.lemma` is compared against a lowercased query without itself being lowercased. Lemmas are stored lowercased on save ([`story.$id.tsx:175`](src/routes/story.$id.tsx#L175) does `tok.lemma.toLowerCase()`), but Anki-imported words may not be — so search silently misses them. Beyond the bug, the page has no way to filter by status/theme/due or to sort.

### Scope
File: [`src/routes/vocab.tsx`](src/routes/vocab.tsx) only. No DB or schema changes.

### Changes

**1.1 — Fix the search bug.** Lowercase both sides:

```ts
const query = q.trim().toLowerCase();
const filtered = rows?.filter((r) => {
  if (!query) return true;
  return (
    r.lemma.toLowerCase().includes(query) ||
    (r.translation?.toLowerCase().includes(query) ?? false) ||
    (r.theme_tag?.toLowerCase().includes(query) ?? false)
  );
});
```
(Also extend search to match theme tags, as shown.)

**1.2 — Add filter + sort state.** Near the other `useState` declarations (around [line 33-35](src/routes/vocab.tsx#L33-L35)):

```ts
const [statusFilter, setStatusFilter] = React.useState<"all" | "learning" | "mastering">("all");
const [themeFilter, setThemeFilter] = React.useState<string>("all");
const [dueOnly, setDueOnly] = React.useState(false);
const [sortBy, setSortBy] = React.useState<"recent" | "alpha" | "due">("recent");
```

**1.3 — Derive the theme list** for the theme dropdown. After `rows` is loaded, compute distinct non-null themes (memoized):

```ts
const themes = React.useMemo(() => {
  const set = new Set<string>();
  for (const r of rows ?? []) if (r.theme_tag) set.add(r.theme_tag);
  return Array.from(set).sort();
}, [rows]);
```

**1.4 — Apply filters + sort.** Replace the single `filtered` expression with a filter chain, then a sort. `due` is computed from `r.due_at` (already merged into rows at [line 54](src/routes/vocab.tsx#L54)):

```ts
const now = Date.now();
const filtered = React.useMemo(() => {
  let out = (rows ?? []).filter((r) => {
    if (query) {
      const hit =
        r.lemma.toLowerCase().includes(query) ||
        (r.translation?.toLowerCase().includes(query) ?? false) ||
        (r.theme_tag?.toLowerCase().includes(query) ?? false);
      if (!hit) return false;
    }
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (themeFilter !== "all" && r.theme_tag !== themeFilter) return false;
    if (dueOnly) {
      const isDue = !r.due_at || new Date(r.due_at).getTime() <= now;
      if (!isDue) return false;
    }
    return true;
  });
  out = out.sort((a, b) => {
    if (sortBy === "alpha") return a.lemma.localeCompare(b.lemma, "it");
    if (sortBy === "due") {
      const da = a.due_at ? new Date(a.due_at).getTime() : 0;
      const db = b.due_at ? new Date(b.due_at).getTime() : 0;
      return da - db; // soonest/overdue first
    }
    // recent (default): created_at desc
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  return out;
}, [rows, query, statusFilter, themeFilter, dueOnly, sortBy, now]);
```
Note: `query` must be defined before this memo. Move the `const query = q.trim().toLowerCase();` line above it (or inline `q` into the dep array and compute inside).

**1.5 — Render the controls.** Below the search `<Input>` (after [line 104](src/routes/vocab.tsx#L104)), add a filter bar. Import `Select, SelectContent, SelectItem, SelectTrigger, SelectValue` from [`@/components/ui/select`](src/components/ui/select.tsx) and `Toggle` from [`@/components/ui/toggle`](src/components/ui/toggle.tsx):

```tsx
<div className="mt-3 flex flex-wrap items-center gap-2">
  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
    <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
    <SelectContent>
      <SelectItem value="all">Tutti gli stati</SelectItem>
      <SelectItem value="learning">Learning</SelectItem>
      <SelectItem value="mastering">Mastering</SelectItem>
    </SelectContent>
  </Select>

  {themes.length > 0 && (
    <Select value={themeFilter} onValueChange={setThemeFilter}>
      <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Tutti i temi</SelectItem>
        {themes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
      </SelectContent>
    </Select>
  )}

  <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
    <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
    <SelectContent>
      <SelectItem value="recent">Più recenti</SelectItem>
      <SelectItem value="alpha">Alfabetico</SelectItem>
      <SelectItem value="due">Da ripassare prima</SelectItem>
    </SelectContent>
  </Select>

  <Toggle
    pressed={dueOnly}
    onPressedChange={setDueOnly}
    size="sm"
    className="h-8 text-xs data-[state=on]:bg-stretch/15 data-[state=on]:text-stretch"
  >
    Solo da ripassare
  </Toggle>

  <span className="ml-auto text-xs text-muted-foreground">
    {filtered?.length ?? 0} parole
  </span>
</div>
```

**1.6 — Empty-state nuance.** The existing empty state ([line 107-111](src/routes/vocab.tsx#L107-L111)) only handles `rows?.length === 0`. Add a separate message when `rows` has items but `filtered` is empty (filters too narrow): `"Nessuna parola corrisponde ai filtri."`

### Acceptance criteria
- Searching an uppercase-stored lemma now matches (bug fixed).
- Status, theme, and "due only" filters each narrow the list correctly and compose together.
- Sort options reorder correctly; `localeCompare(..., "it")` handles accented characters.
- Count reflects the filtered set.
- `npm run lint` and `npm run build` pass.

---

## Improvement 2 — Real Shadowing Mode

### Problem
The landing page ([`src/routes/index.tsx:56`](src/routes/index.tsx#L56)) and root meta ([`__root.tsx:40`](src/routes/__root.tsx#L40)) advertise **shadowing**, but the actual feature ([`story.$id.tsx:130-147`](src/routes/story.$id.tsx#L130-L147)) just dumps the whole `story.body` into one `SpeechSynthesisUtterance`. Problems:
1. **No sentence segmentation** — you can't repeat a sentence, the core of shadowing practice.
2. **No synced highlighting** — the reader can't follow along.
3. **`getVoices()` race** — on Chromium the voice list is empty on first call, so the Italian voice often isn't applied.
4. **No rate control** — shadowing needs adjustable (usually slower) speed.

### Scope
- New file: `src/lib/speech.ts` (voice loading + sentence segmentation helpers).
- New file: `src/components/ShadowingBar.tsx` (the player UI + logic).
- Edit: [`src/routes/story.$id.tsx`](src/routes/story.$id.tsx) — replace the inline `speak()` and Play button with `<ShadowingBar>`, and add sentence highlighting to the rendered text.

This is the most involved of the three. Implement helpers first, then the component, then wire highlighting.

### 2.1 — `src/lib/speech.ts`

```ts
// Robust browser-TTS helpers for Italian shadowing practice.

/**
 * Resolve available voices, waiting for the async `voiceschanged` event that
 * Chromium fires on first load (getVoices() is empty synchronously there).
 */
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

export function pickItalianVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  // Prefer it-IT, then any it*, preferring local (offline) voices for stability.
  const italian = voices.filter((v) => v.lang.toLowerCase().startsWith("it"));
  if (!italian.length) return undefined;
  const exact = italian.filter((v) => v.lang.toLowerCase() === "it-it");
  const pool = exact.length ? exact : italian;
  return pool.find((v) => v.localService) ?? pool[0];
}

export type Sentence = { text: string; start: number; end: number }; // char offsets into source

/**
 * Split text into sentences while preserving character offsets so the reader
 * can highlight the active sentence. Splits on . ! ? … and newlines, keeping
 * the terminator with the sentence. Good enough for Italian prose/dialogue.
 */
export function segmentSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  // Match runs ending at sentence punctuation (optionally followed by closing
  // quotes/brackets) OR at a newline OR at end of string.
  const re = /[^.!?…\n]*(?:[.!?…]+["»”’)\]]*|\n+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    if (m.index === re.lastIndex) { re.lastIndex++; continue; } // avoid zero-length loop
    if (!raw.trim()) continue;
    out.push({ text: raw.trim(), start: m.index, end: m.index + raw.length });
  }
  return out;
}
```

### 2.2 — `src/components/ShadowingBar.tsx`

A self-contained player. Props: the full `body` string, the segmented sentences, and an `onActiveSentence(index | null)` callback so the parent can highlight.

```tsx
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Play, Pause, SkipBack, SkipForward, Repeat } from "lucide-react";
import { loadVoices, pickItalianVoice, type Sentence } from "@/lib/speech";

const RATES = [0.6, 0.75, 0.9, 1.0] as const;

export function ShadowingBar({
  sentences,
  onActiveSentence,
}: {
  sentences: Sentence[];
  onActiveSentence: (i: number | null) => void;
}) {
  const [playing, setPlaying] = React.useState(false);
  const [idx, setIdx] = React.useState(0);
  const [rate, setRate] = React.useState<number>(0.9);
  const [loop, setLoop] = React.useState(false);
  const [voice, setVoice] = React.useState<SpeechSynthesisVoice | undefined>(undefined);

  const idxRef = React.useRef(idx);
  const playingRef = React.useRef(playing);
  const loopRef = React.useRef(loop);
  const rateRef = React.useRef(rate);
  React.useEffect(() => { idxRef.current = idx; onActiveSentence(playing ? idx : null); }, [idx, playing, onActiveSentence]);
  React.useEffect(() => { playingRef.current = playing; }, [playing]);
  React.useEffect(() => { loopRef.current = loop; }, [loop]);
  React.useEffect(() => { rateRef.current = rate; }, [rate]);

  React.useEffect(() => {
    loadVoices().then((vs) => setVoice(pickItalianVoice(vs)));
    return () => window.speechSynthesis.cancel();
  }, []);

  const speakAt = React.useCallback((i: number) => {
    if (i < 0 || i >= sentences.length) { stop(); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(sentences[i].text);
    u.lang = "it-IT";
    u.rate = rateRef.current;
    if (voice) u.voice = voice;
    u.onend = () => {
      if (!playingRef.current) return;
      if (loopRef.current) { speakAt(idxRef.current); return; } // repeat same sentence
      const next = idxRef.current + 1;
      if (next < sentences.length) { setIdx(next); speakAt(next); }
      else stop();
    };
    u.onerror = () => stop();
    window.speechSynthesis.speak(u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentences, voice]);

  const start = () => { setPlaying(true); playingRef.current = true; speakAt(idxRef.current); };
  const stop = () => { setPlaying(false); playingRef.current = false; window.speechSynthesis.cancel(); onActiveSentence(null); };

  const toggle = () => (playing ? stop() : start());
  const prev = () => { const i = Math.max(0, idxRef.current - 1); setIdx(i); if (playingRef.current) speakAt(i); };
  const next = () => { const i = Math.min(sentences.length - 1, idxRef.current + 1); setIdx(i); if (playingRef.current) speakAt(i); };

  if (!sentences.length) return null;

  return (
    <div className="sticky top-14 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-2 border-b border-border bg-paper/90 px-4 py-2 backdrop-blur">
      <Button variant="ghost" size="icon" onClick={prev} aria-label="Frase precedente"><SkipBack className="h-4 w-4" /></Button>
      <Button size="icon" onClick={toggle} aria-label={playing ? "Pausa" : "Ascolta"}>
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>
      <Button variant="ghost" size="icon" onClick={next} aria-label="Frase successiva"><SkipForward className="h-4 w-4" /></Button>

      <Button
        variant={loop ? "secondary" : "ghost"}
        size="icon"
        onClick={() => setLoop((l) => !l)}
        aria-label="Ripeti frase"
        title="Ripeti la frase corrente"
      >
        <Repeat className="h-4 w-4" />
      </Button>

      <Select value={String(rate)} onValueChange={(v) => setRate(Number(v))}>
        <SelectTrigger className="h-8 w-[88px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {RATES.map((r) => <SelectItem key={r} value={String(r)}>{r.toFixed(2)}×</SelectItem>)}
        </SelectContent>
      </Select>

      <span className="ml-auto text-xs text-muted-foreground">
        Frase {Math.min(idx + 1, sentences.length)} / {sentences.length}
      </span>
    </div>
  );
}
```

**Important behavioral notes for the implementer:**
- The refs (`idxRef`, `playingRef`, etc.) are required because `utterance.onend` is a closure captured at speak time; without refs it reads stale state. This is the crux of getting chained playback right.
- Changing `rate` mid-playback applies on the **next** sentence (reads `rateRef`), which is acceptable. If you want it to apply immediately, call `speakAt(idxRef.current)` inside the `rate` effect when `playingRef.current`.
- `window.speechSynthesis.cancel()` on unmount prevents audio bleeding into other routes.

### 2.3 — Wire into `story.$id.tsx`

1. **Remove** the old `playing` state ([line 59](src/routes/story.$id.tsx#L59)), the `speak()` function ([lines 130-147](src/routes/story.$id.tsx#L130-L147)), and the Play/Pause `<Button>` in the header ([lines 222-225](src/routes/story.$id.tsx#L222-L225)). Remove now-unused `Play, Pause` imports from lucide ([line 10](src/routes/story.$id.tsx#L10)).

2. **Add** state for the active sentence and compute sentences:
```ts
import { segmentSentences } from "@/lib/speech";
import { ShadowingBar } from "@/components/ShadowingBar";
// ...
const [activeSentence, setActiveSentence] = React.useState<number | null>(null);
const sentences = React.useMemo(() => story ? segmentSentences(story.body) : [], [story]);
```

3. **Render** `<ShadowingBar>` just above the `<article>` ([line 228](src/routes/story.$id.tsx#L228)):
```tsx
<ShadowingBar sentences={sentences} onActiveSentence={setActiveSentence} />
<article className="mt-4 font-body text-lg leading-relaxed text-ink">
```

4. **Highlight the active sentence.** Both renderers (`renderParagraphs` and `renderPlainParagraphs`) build text from offsets, but tokens don't currently carry char offsets. The pragmatic approach that works for **both** tokenized and plain modes:

   - Pass `activeSentence` and `sentences` down to the renderers.
   - In `renderPlainParagraphs`, you already have the paragraph text; wrap the substring `[sentences[active].start, end)` — but offsets are into the *full body*, not per-paragraph, so simpler: compare each rendered sentence's trimmed text against `sentences[active].text` and add a class when equal. Since `renderPlainParagraphs` splits on newlines (not sentences), **switch it to render sentence-wrapped spans**: split each paragraph into its sentences using the same `segmentSentences`, and mark the one whose text matches.
   - For the **tokenized** renderer, add a CSS class to the whole containing `<p>` when any token in it falls within the active sentence's char range. Tokens lack offsets, so add a lightweight running offset: as you iterate tokens building paragraphs, accumulate `surface.length` to get each token's start offset, then a token is "active" if its offset is within `[start, end)`. Add class `sentence-active` to active tokens.

   Add to [`src/styles.css`](src/styles.css):
```css
.sentence-active {
  background: color-mix(in oklab, var(--color-primary) 12%, transparent);
  border-radius: 2px;
}
```

   > Implementer note: If wiring per-token offsets proves fiddly, ship highlighting for the **plain renderer only** in this pass (most stories that lack annotations use it) and apply a paragraph-level highlight for the tokenized renderer (highlight the `<p>` containing the active sentence). Sentence-accurate token highlighting can be a follow-up. The playback + repeat + rate controls are the primary deliverable; highlighting is the enhancement.

5. **Auto-scroll** the active sentence into view (optional but recommended). In `story.$id.tsx`, after `activeSentence` changes, scroll the `.sentence-active` element:
```ts
React.useEffect(() => {
  if (activeSentence == null) return;
  const el = document.querySelector(".sentence-active");
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
}, [activeSentence]);
```

### Acceptance criteria
- Pressing play reads the story **sentence by sentence**; sentences advance automatically.
- Prev/Next skip sentences; the counter updates.
- The repeat toggle loops the current sentence until turned off.
- Rate selector changes playback speed (applies from the next sentence).
- The Italian voice is reliably selected even on first page load (voice race fixed).
- Navigating away from the story stops audio.
- At minimum, the plain-text renderer highlights and auto-scrolls the active sentence.
- `npm run lint` and `npm run build` pass.

---

## Improvement 3 — Review Stats & Streaks

### Problem
The app collects rich SRS data (`reps`, `lapses`, `ease`, `interval_days`, `last_reviewed_at`, `due_at` in the `srs_reviews` table — see [`types.ts:50-96`](src/integrations/supabase/types.ts#L50-L96)) but surfaces none of it. Learners have no sense of progress, which is the main motivator for SRS apps.

### Scope
- New file: `src/lib/stats.ts` (pure functions to compute stats from raw rows — keep DB-fetching out so it's testable).
- New file: `src/routes/stats.tsx` (new `/stats` route).
- Edit: [`src/routeTree.gen.ts`](src/routeTree.gen.ts) is **auto-generated** by the TanStack Router plugin — do **not** hand-edit it. Creating the route file and running `npm run dev` (or `npm run build`) regenerates it. If it doesn't regenerate, the plugin runs on dev server start; just start the dev server once.
- Edit: [`src/components/AppHeader.tsx`](src/components/AppHeader.tsx) — add a nav link to `/stats`.
- Edit: [`src/routes/vocab.tsx`](src/routes/vocab.tsx) — optionally add a small "Statistiche" link near the "Ripassa" button.

### 3.1 — `src/lib/stats.ts`

Define input row shapes loosely (only the fields used) so it works with the data the routes already fetch.

```ts
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
  reviewedTotal: number;       // sum of reps across all cards
  mastering: number;           // status === "mastering"
  learning: number;
  mature: number;              // interval_days >= 21 (Anki's "mature" threshold)
  young: number;               // reviewed but interval < 21
  newCards: number;            // never reviewed (no srs row or reps === 0)
  retention: number | null;    // % good answers ≈ reps / (reps + lapses), null if no data
  streakDays: number;          // consecutive days up to today with >=1 review
  reviewsByDay: { date: string; count: number }[]; // last 30 days, oldest→newest
  byLevel: { level: string; count: number }[];
  byTheme: { theme: string; count: number }[];
};

const DAY = 86_400_000;
const MATURE_DAYS = 21;

function dayKey(d: Date): string {
  // Local-date key YYYY-MM-DD
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function computeStats(vocab: VocabLite[], srs: SrsLite[], now = new Date()): Stats {
  const srsByVocab = new Map(srs.map((s) => [s.vocab_id, s]));
  const nowMs = now.getTime();

  let due = 0, reviewedTotal = 0, mastering = 0, learning = 0;
  let mature = 0, young = 0, newCards = 0, totalReps = 0, totalLapses = 0;

  for (const v of vocab) {
    const s = srsByVocab.get(v.id);
    if (v.status === "mastering") mastering++; else learning++;
    if (!s || s.reps === 0) {
      newCards++;
      due++; // never-reviewed counts as due (matches review.tsx logic)
      continue;
    }
    reviewedTotal += s.reps;
    totalReps += s.reps;
    totalLapses += s.lapses;
    if (new Date(s.due_at).getTime() <= nowMs) due++;
    if (s.interval_days >= MATURE_DAYS) mature++; else young++;
  }

  const retention =
    totalReps + totalLapses > 0
      ? Math.round((totalReps / (totalReps + totalLapses)) * 100)
      : null;

  // reviewsByDay over last 30 days, keyed by last_reviewed_at (one review event
  // per card per its last review — approximation, since we don't log full history).
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

  // Streak: consecutive days ending today (or yesterday) with >=1 review.
  let streakDays = 0;
  for (let i = 0; ; i++) {
    const d = new Date(nowMs - i * DAY);
    const k = dayKey(d);
    if ((counts.get(k) ?? 0) > 0) streakDays++;
    else if (i === 0) continue; // allow today to be empty without breaking a prior streak
    else break;
  }

  const levelMap = new Map<string, number>();
  for (const v of vocab) {
    const lv = v.cefr_level ?? "—";
    levelMap.set(lv, (levelMap.get(lv) ?? 0) + 1);
  }
  const byLevel = Array.from(levelMap, ([level, count]) => ({ level, count }))
    .sort((a, b) => a.level.localeCompare(b.level));

  const themeMap = new Map<string, number>();
  for (const v of vocab) {
    if (!v.theme_tag) continue;
    themeMap.set(v.theme_tag, (themeMap.get(v.theme_tag) ?? 0) + 1);
  }
  const byTheme = Array.from(themeMap, ([theme, count]) => ({ theme, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    total: vocab.length, due, reviewedTotal, mastering, learning,
    mature, young, newCards, retention, streakDays, reviewsByDay, byLevel, byTheme,
  };
}
```

> **Honesty note for the implementer:** `reviewsByDay` and `streakDays` are *approximations* because the schema stores only the **latest** `last_reviewed_at` per card, not a full review log. A card reviewed 5 times shows as one event on its last date. This is acceptable for a v1 dashboard. If you want accurate history, that requires a new `review_log` table — out of scope here. **Label the chart honestly** (e.g. "Attività recente (ultima revisione per parola)") so it isn't misread as a complete history.

### 3.2 — `src/routes/stats.tsx`

```tsx
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import * as React from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { computeStats, type Stats, type VocabLite, type SrsLite } from "@/lib/stats";
import { Flame, Brain, Sparkles } from "lucide-react";

export const Route = createFileRoute("/stats")({
  component: StatsPage,
  head: () => ({ meta: [{ title: "Statistiche — Letture" }] }),
});

function StatsPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [stats, setStats] = React.useState<Stats | null>(null);

  React.useEffect(() => {
    if (!loading && !user) nav({ to: "/auth" });
  }, [user, loading, nav]);

  React.useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: vocab } = await supabase
        .from("vocab_items")
        .select("id,status,cefr_level,theme_tag,created_at")
        .eq("user_id", user.id);
      const { data: srs } = await supabase
        .from("srs_reviews")
        .select("vocab_id,interval_days,ease,reps,lapses,due_at,last_reviewed_at")
        .eq("user_id", user.id);
      setStats(computeStats((vocab ?? []) as VocabLite[], (srs ?? []) as SrsLite[]));
    })();
  }, [user]);

  if (!stats) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <p className="mx-auto max-w-3xl px-4 py-10 text-muted-foreground">Caricamento…</p>
      </div>
    );
  }

  const masteryPct = stats.total ? Math.round((stats.mature / stats.total) * 100) : 0;
  const maxDay = Math.max(1, ...stats.reviewsByDay.map((d) => d.count));

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-4xl">Statistiche</h1>
          <Link to="/review"><Button className="gap-2"><Brain className="h-4 w-4" /> Ripassa ({stats.due})</Button></Link>
        </div>

        {/* Top metric cards */}
        <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={<Flame className="h-4 w-4 text-stretch" />} label="Streak" value={`${stats.streakDays}g`} />
          <StatCard label="Parole totali" value={String(stats.total)} />
          <StatCard label="Da ripassare" value={String(stats.due)} />
          <StatCard label="Ritenzione" value={stats.retention == null ? "—" : `${stats.retention}%`} />
        </div>

        {/* Mastery progress */}
        <section className="mt-8 rounded-xl border border-border bg-card p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-2xl">Padronanza</h2>
            <span className="text-sm text-muted-foreground">{masteryPct}% mature</span>
          </div>
          <Progress value={masteryPct} className="mt-3" />
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
            <span>Nuove: {stats.newCards}</span>
            <span>Giovani: {stats.young}</span>
            <span>Mature: {stats.mature}</span>
          </div>
        </section>

        {/* Activity bar chart (simple CSS bars, no chart lib needed) */}
        <section className="mt-6 rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-2xl">Attività recente</h2>
          <p className="text-xs text-muted-foreground">Ultima revisione per parola, ultimi 30 giorni.</p>
          <div className="mt-4 flex items-end gap-[3px] h-28">
            {stats.reviewsByDay.map((d) => (
              <div
                key={d.date}
                className="flex-1 rounded-t bg-primary/70"
                style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: d.count ? "3px" : "0" }}
                title={`${d.date}: ${d.count}`}
              />
            ))}
          </div>
        </section>

        {/* By level + by theme */}
        <div className="mt-6 grid sm:grid-cols-2 gap-6">
          <BreakdownCard title="Per livello" rows={stats.byLevel.map((r) => ({ label: r.level, count: r.count }))} total={stats.total} />
          <BreakdownCard title="Per tema" rows={stats.byTheme.map((r) => ({ label: r.theme, count: r.count }))} total={stats.total} />
        </div>

        {stats.total === 0 && (
          <div className="mt-10 text-center rounded-xl border border-dashed border-border p-10">
            <Sparkles className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="mt-3 text-muted-foreground">Nessun dato ancora. Salva parole leggendo e ripassale!</p>
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">{icon}{label}</div>
      <p className="mt-1 font-display text-3xl">{value}</p>
    </div>
  );
}

function BreakdownCard({ title, rows, total }: { title: string; rows: { label: string; count: number }[]; total: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-display text-2xl">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nessun dato.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.label} className="text-sm">
              <div className="flex justify-between"><span>{r.label}</span><span className="text-muted-foreground">{r.count}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary/60" style={{ width: `${total ? (r.count / total) * 100 : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Note: this uses plain CSS bars rather than the `recharts`-based [`chart.tsx`](src/components/ui/chart.tsx) to keep it dependency-light and avoid recharts SSR quirks. If richer charts are desired later, swap the activity section for a recharts `<BarChart>`.

### 3.3 — Add nav link in `AppHeader.tsx`

In the authed nav block ([`AppHeader.tsx:18-54`](src/components/AppHeader.tsx#L18-L54)), add after the Vocabolario link, importing an icon (e.g. `BarChart3` from lucide-react):

```tsx
<Link to="/stats">
  <Button variant="ghost" size="sm" className="gap-1">
    <BarChart3 className="h-4 w-4" />
    <span className="hidden sm:inline">Statistiche</span>
  </Button>
</Link>
```

### 3.4 — Regenerate the route tree
After creating `src/routes/stats.tsx`, run `npm run dev` once (or `npm run build`). The TanStack Router plugin will add `/stats` to [`src/routeTree.gen.ts`](src/routeTree.gen.ts) automatically. Verify the file now references `StatsRoute`. Do not edit it by hand.

### Acceptance criteria
- `/stats` is reachable from the header (when logged in) and shows: streak, totals, due count, retention, a mastery progress bar with new/young/mature breakdown, a 30-day activity bar chart, and per-level + per-theme breakdowns.
- All numbers derive from real data via `computeStats`; with zero data the empty state shows and no NaN/`Infinity` appears (guarded by `maxDay = Math.max(1, …)` and `total ?` checks).
- The activity chart is honestly labeled as "last review per word."
- Route tree regenerated by the plugin (not hand-edited).
- `npm run lint` and `npm run build` pass.

---

---

## Status Tracker

Updated: 2026-06-24

| # | Improvement | Status | Notes |
|---|-------------|--------|-------|
| 1 | Vocab search bug fix + filters & sorting | **DONE** | Implemented 2026-06-24. See [CHANGES_VOCAB_SEARCH.md](../summaries/CHANGES_VOCAB_SEARCH.md). Bug fixed, filters/sort/count/empty-state all added. Type-checks and builds clean. Not yet click-tested in browser with live data. |
| 2 | Real shadowing mode | **NOT STARTED** | Most complex. New files: `src/lib/speech.ts`, `src/components/ShadowingBar.tsx`. Edits `story.$id.tsx`. |
| 3 | Review stats & streaks | **DONE** | Implemented 2026-06-24. New files: `src/lib/stats.ts`, `src/routes/stats.tsx`. Nav link added to `AppHeader.tsx`. Type-checks and builds clean. |

### Suggested next order

1. **Improvement 2** (shadowing) — the last remaining item; most complex.

Commit each improvement separately with a clear message. Run `npm run lint && npm run build` after each.

---

## Additional completed work (outside this plan)

### CEFR Lexicon replacement (2026-06-24)
Replaced the `it_m3.xlsx`-derived CEFR lexicon (5,035 translator-corpus entries) with a scraped pedagogical lexicon from "Profilo della lingua italiana" (2,127 entries, A1–B2). Drop-in replacement — same flat JSON format, no code changes to `lexicon.ts` or `index.ts`. Tests updated. See [EXE_Sum.md](../summaries/EXE_Sum.md) and the `scripts/` directory at project root.
