# Implementation Plan — Cached Story Fallback (Fail-Safe)

**Goal:** When live story generation fails (Gemini overloaded/erroring, or — later — the NLP density verifier rejects the output), serve a **pre-annotated cached story** instead of an error, so the user always gets a readable, fully interactive story.

**Source of cached stories:** existing Italian texts (public-domain / CC / owned), annotated **once** at seeding time so they render with clickable words + grammar like normal stories.

**This satisfies the CLAUDE.md "Fail-Safe" principle:**
> If the LLM hallucinates or fails the density constraint, the system must gracefully fall back to a pre-generated cached text. Do not serve decipherable/dense text to the user.

**Scope note:** This is a robustness feature, separate from and larger than the 503 retry fix already applied to [`supabase-functions/generate-story/index.ts`](supabase-functions/generate-story/index.ts). The retry fix handles *most* transient overload; this is the safety net for when retries still fail.

**Decisions already made:**
- Storage: a **dedicated `cached_stories` table** (not user-owned rows).
- Fallback stories render **fully annotated** (tokens + grammar).
- Seeding source: **web/existing texts**, annotated once.

---

## Architecture overview

```
SEEDING (offline, run by an admin, one-time + when adding stories)
  [{ text, level, format, theme? }, …]
      → annotate-text step (LLM → tokens[] + grammar[], same schema as generate-story)
      → INSERT into cached_stories (body, tokens, grammar, level, format, theme)

LIVE (generate-story Edge Function)
  try Gemini (existing retry logic)
    success           → insert personalized story → return story_id      ✅
    retries exhausted → serveCachedFallback(level, format, theme)
    (future) NLP fail → serveCachedFallback(level, format, theme)
        serveCachedFallback:
          pick a cached_stories row matching level (+ format/theme if possible)
          COPY it into the user's stories + story_annotations (target_word_ids = [])
          return its story_id                                            ✅
```

A cached story is just a pre-made `(body, tokens, grammar)` triple — exactly what `generate-story` already produces. The reader ([`src/routes/story.$id.tsx`](src/routes/story.$id.tsx)) renders it with zero changes.

---

## Piece 1 — Database: `cached_stories` table

### 1.1 Migration SQL (FOR REVIEW — do not run without confirmation)

> ⚠️ Per CLAUDE.md ("Do NOT execute Supabase migrations without asking; output SQL for review first"), this SQL must be reviewed and run manually by the user in the Supabase SQL editor. Do not auto-apply.

```sql
-- Cached fallback stories: pre-annotated Italian texts not owned by any user.
create table if not exists public.cached_stories (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text not null,
  summary      text,
  topic        text,
  level        public.cefr_level not null,           -- A1..C2 (existing enum)
  format       public.story_format not null,         -- news | short_story | novel_chapter | dialogue (existing enum)
  theme_tag    text,
  tokens       jsonb not null default '[]'::jsonb,    -- same shape as story_annotations.tokens
  grammar      jsonb not null default '[]'::jsonb,    -- same shape as story_annotations.grammar
  source       text,                                  -- provenance, e.g. "Liber Liber: <title>" (licensing trail)
  word_count   integer,
  is_active    boolean not null default true,         -- soft-disable without deleting
  created_at   timestamptz not null default now()
);

-- Fast lookup by difficulty/format when choosing a fallback.
create index if not exists cached_stories_level_format_idx
  on public.cached_stories (level, format) where is_active;

-- RLS: readable by any authenticated user (templates are shared, not private);
-- writes restricted to service role (seeding runs with the service key).
alter table public.cached_stories enable row level security;

create policy "cached_stories readable by authenticated"
  on public.cached_stories for select
  to authenticated
  using (true);

-- No insert/update/delete policies for normal users → only service_role can write.
```

**Notes for the implementer:**
- Reuses the **existing enums** `public.cefr_level` and `public.story_format` (confirmed in [`types.ts:286-287`](src/integrations/supabase/types.ts#L286-L287)), so cached rows are type-consistent with `stories`.
- `tokens`/`grammar` are `jsonb` matching [`story_annotations`](src/integrations/supabase/types.ts#L162-L196).
- `source` column exists specifically to keep a **licensing/provenance trail** — populate it for every seeded story.
- After running, regenerate the TS types (`supabase gen types typescript`) or hand-add `cached_stories` to [`src/integrations/supabase/types.ts`](src/integrations/supabase/types.ts) so the Edge Function and any client code are typed. The Edge Function uses the service-role client and can operate untyped, so this is optional for function correctness but recommended.

---

## Piece 2 — Annotation step (`annotate-text`)

The annotator takes existing Italian text and returns `tokens[]` + `grammar[]` in the **exact same schema** the reader expects. It is essentially `generate-story`'s prompt with the *story-writing* removed and the *body supplied as input*.

### 2.1 New Edge Function: `supabase/functions/annotate-text/index.ts`

Reuse, almost verbatim from [`generate-story/index.ts`](supabase-functions/generate-story/index.ts):
- the `corsHeaders`, `json()` helper, and `callGeminiWithRetry()` (copy as-is — same resilience benefits).
- the **TOKENIZZAZIONE** and **GRAMMATICA** instruction blocks and the JSON-syntax warnings from the existing `user_prompt`.

**Differences from generate-story:**
- Input body shape: `{ text: string, level: string }`.
- The prompt says *"Annota il TESTO FORNITO"* (annotate the provided text) rather than *"Genera una storia"*. It must **not** rewrite or alter the text — only tokenize + tag grammar over it.
- Output JSON shape is trimmed to: `{ title?, summary?, topic?, tokens, grammar }` (no need to re-emit `body`; we already have it). If reusing the existing schema is simpler, keep `body` in the output and assert it equals the input (reject if the model altered it).
- **Auth:** seeding is admin-run. Either (a) require the caller to be an admin via the existing `user_roles` table + `has_role()` function (see [`types.ts:276-282`](src/integrations/supabase/types.ts#L276-L282)), or (b) protect it by requiring the service-role key / a shared secret in a header. Recommend (a) if you have an admin user; (b) if seeding from a local script.

**Prompt skeleton (Italian, mirroring existing style):**
```
Sei un linguista applicato. Ti fornisco un TESTO in italiano già scritto.
NON riscriverlo e NON modificarlo. Producine SOLO l'annotazione in JSON:
tokens[] (parola per parola, copre tutto il testo, con lemma/pos/translation)
e grammar[] (strutture rilevanti con complexity/is_stretch/token_indices),
secondo le stesse regole sotto.

TESTO:
"""<text>"""

<<< incolla qui i blocchi ISTRUZIONI TOKENIZZAZIONE / GRAMMATICA / SINTASSI JSON
    presi da generate-story, invariati >>>
```

### 2.2 Why a separate function, not inline
Keeping annotation separate means: (a) seeding doesn't touch the live generate path, (b) you can re-run annotation on a failed story without regenerating, (c) the live function stays focused. The shared `callGeminiWithRetry` can be duplicated (simplest for Edge Functions, which don't share modules easily) or extracted into a shared file imported by both.

---

## Piece 3 — Seeding tool

A script/function you run to load web stories into `cached_stories`.

### 3.1 Input format
A JSON (or TS array) of stories you've collected, e.g. `scripts/seed-stories.json`:
```json
[
  { "title": "Pinocchio (estratto)", "text": "C'era una volta...", "level": "A2", "format": "short_story", "theme": "fiabe", "source": "Liber Liber — Collodi (pubblico dominio)" }
]
```

### 3.2 Seeding script: `scripts/seed-cached-stories.ts` (run locally with Deno or Node)
For each entry:
1. Call the `annotate-text` function (or Gemini directly) → get `tokens`, `grammar`.
2. Compute `word_count` from `text`.
3. `INSERT` into `cached_stories` via the **service-role** Supabase client (so RLS write-restriction is satisfied).
4. Log success/failure per story; on annotation failure, skip and report (don't insert a half-annotated story).

**Important:** because annotation runs offline, transient Gemini failures here are **not** user-facing — just re-run the script for the failed entries. This is a key advantage of annotating at seed time rather than live.

### 3.3 Sourcing guidance (licensing — do this deliberately)
- **Safe sources:** Liber Liber / Project Gutenberg Italian (public domain), Creative-Commons graded readers, text you write or own.
- **Avoid:** scraping arbitrary news/blogs (copyright).
- Record provenance in the `source` column for every row.
- **Verify the level** of each text before tagging it — a fallback must actually be comprehensible at the level it claims. Tag conservatively.

### 3.4 How many to seed
Aim for at least **2–3 stories per (level, format)** you support so fallback has variety. Prioritize the levels/formats your users actually use (A2/B1 short_story first).

---

## Piece 4 — Fallback wiring in `generate-story`

The live change. Small, surgical, additive — it only runs on the failure paths.

### 4.1 Add a helper near the bottom of [`generate-story/index.ts`](supabase-functions/generate-story/index.ts)

```ts
// Pick a cached fallback story and copy it into the user's library.
// Returns the new story_id, or null if no suitable cached story exists.
async function serveCachedFallback(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  level: string,
  format: string,
  theme_tag: string | null,
): Promise<string | null> {
  // Prefer an exact (level, format) match; fall back to level-only.
  // Random-ish pick so users don't always get the same one.
  const tryFetch = async (matchFormat: boolean) => {
    let q = supabase
      .from("cached_stories")
      .select("title,body,summary,topic,level,format,theme_tag,tokens,grammar,word_count")
      .eq("level", level)
      .eq("is_active", true)
      .limit(20);
    if (matchFormat) q = q.eq("format", format);
    const { data } = await q;
    if (!data || data.length === 0) return null;
    return data[Math.floor(Math.random() * data.length)];
  };

  const cached = (await tryFetch(true)) ?? (await tryFetch(false));
  if (!cached) return null;

  const { data: storyRow, error } = await supabase
    .from("stories")
    .insert({
      user_id: userId,
      title: cached.title,
      topic: cached.topic ?? null,
      level: cached.level,
      mode: "standard",          // cached fallbacks are not personalized/stretch
      stretch_level: null,
      format: cached.format,
      body: cached.body,
      summary: cached.summary ?? null,
      word_count: cached.word_count ?? null,
      theme_tag: cached.theme_tag ?? theme_tag,
      target_word_ids: [],       // NOTE: fallback cannot carry this user's due words
    })
    .select("id")
    .single();
  if (error || !storyRow) {
    console.error("fallback insert failed", error);
    return null;
  }

  await supabase.from("story_annotations").insert({
    story_id: storyRow.id,
    user_id: userId,
    tokens: cached.tokens ?? [],
    grammar: cached.grammar ?? [],
  });

  return storyRow.id;
}
```

### 4.2 Call it at the failure point

Replace the current "Gemini not ok" early-return ([`generate-story/index.ts`](supabase-functions/generate-story/index.ts), the `if (!resp.ok)` block) so that **before** returning an error, it tries the cache:

```ts
if (!resp.ok) {
  const txt = await resp.text();
  console.error("Gemini error", resp.status, txt);

  // Fail-safe: try a cached fallback before surfacing an error.
  const fallbackId = await serveCachedFallback(supabase, user.id, level, format, theme_tag);
  if (fallbackId) {
    return json({ story_id: fallbackId, fallback: true }, 200);
  }

  // No cached story available → original error behavior.
  const userMsg = resp.status === 503 || resp.status === 429
    ? "Il modello AI è momentaneamente sovraccarico. Riprova tra qualche secondo."
    : resp.status === 400 || resp.status === 401 || resp.status === 403
    ? "Chiave Gemini non valida. Aggiornala in Impostazioni."
    : `Gemini ${resp.status}: ${txt.slice(0, 200)}`;
  return json({ error: userMsg }, resp.status === 503 ? 503 : 500);
}
```

Also wrap the **JSON-parse failure** path the same way (if `JSON.parse` recovery fails, try `serveCachedFallback` before returning `"Risposta non JSON"`).

### 4.3 Optional frontend touch
The response now may include `fallback: true`. In [`src/routes/generate.tsx`](src/routes/generate.tsx) (the `generate()` handler), you *could* show a gentler toast like *"L'IA era occupata — ecco una storia dalla nostra raccolta."* so the user understands why this story isn't personalized. Optional; the app works without it since it just navigates on `story_id`.

---

## Honest limitations (call these out to the user)

1. **No personalization on fallback.** A cached story cannot contain *this* user's SRS-due target words (`target_word_ids` is `[]`). It's comprehensible but won't reinforce their due vocab. Acceptable as an emergency net; not equal to a live generation.
2. **Copyright is on you.** Only seed public-domain / CC / owned text. The `source` column exists to track this — use it.
3. **Level accuracy is manual.** A web story's CEFR level is your judgment call at seed time; mis-tagging means a fallback that's too hard. Tag conservatively and verify.
4. **Annotation quality = the LLM's tokenization.** Same engine as live, but since seeding is offline you can review and re-run failures — strictly better than the live path.
5. **Empty cache = no-op.** Until you seed stories, the fallback silently does nothing (returns `null`) and the original error shows. Seed before relying on it.

---

## Suggested build order
1. **Piece 1** — review + run the migration; regenerate types.
2. **Piece 2** — `annotate-text` function (copy/trim from generate-story).
3. **Piece 3** — collect 2–3 public-domain stories per (level, format), seed them.
4. **Piece 4** — wire fallback into generate-story; deploy.
5. Test: temporarily force a Gemini failure (e.g. bad key) and confirm a cached story is served and renders with clickable words.

Each Edge Function change must be deployed to Supabase manually (Dashboard or `supabase functions deploy`) — these functions live in the Supabase project, not this repo.
```
