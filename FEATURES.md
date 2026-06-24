# Letture — Feature & Code Map

**Letture** is a web app for Italian language learners built around comprehensible input. It generates CEFR-leveled Italian stories with inline grammar annotations, vocabulary tracking, spaced-repetition review, and text-to-speech shadowing.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 19 + TanStack Start (SSR) + TanStack Router |
| Styling | Tailwind CSS 4 + Radix UI (via shadcn/ui) |
| Backend / DB | Supabase (Auth, Postgres, Edge Functions) |
| AI | Google Gemini (user-provided API key) via Supabase Edge Functions |
| Build | Vite 7 + Cloudflare Workers (`@cloudflare/vite-plugin`) |
| Language | TypeScript 5.8 |

---

## Features

### 1. Authentication (Email + Google OAuth)

Users sign up / sign in with email+password or Google OAuth. Sessions are managed by Supabase Auth and persisted in localStorage.

| What | Where |
|---|---|
| Auth page (sign-in / sign-up form, Google button) | [`src/routes/auth.tsx`](src/routes/auth.tsx) |
| Auth context provider (`useAuth` hook) | [`src/hooks/useAuth.tsx`](src/hooks/useAuth.tsx) |
| Supabase client (lazy-init via Proxy) | [`src/integrations/supabase/client.ts`](src/integrations/supabase/client.ts) |
| Google OAuth via Lovable cloud auth | [`src/integrations/lovable/index.ts`](src/integrations/lovable/index.ts) |
| All protected routes redirect to `/auth` if not logged in | Each route file's `useEffect` guard |

---

### 2. Story Generation (AI-powered)

Users configure a story by choosing CEFR level (A1–C2), format (news article, short story, novel chapter, dialogue), optional topic, and optional theme for targeted vocab reinforcement. A "Stretch +" mode seeds 1–2 grammar elements from the next CEFR level.

| What | Where |
|---|---|
| Generate page UI (level, format, stretch toggle, topic, theme) | [`src/routes/generate.tsx`](src/routes/generate.tsx) |
| Story generation call (`supabase.functions.invoke("generate-story")`) | [`src/routes/generate.tsx:79`](src/routes/generate.tsx#L79) |
| Story continuation (`supabase.functions.invoke("continue-story")`) | [`src/routes/story.$id.tsx:269`](src/routes/story.$id.tsx#L269) |
| CEFR levels & story formats (enums) | [`src/integrations/supabase/types.ts:284-289`](src/integrations/supabase/types.ts#L284-L289) |
| Profile defaults (level, stretch) loaded on generate page | [`src/routes/generate.tsx:60-73`](src/routes/generate.tsx#L60-L73) |

**Story formats:** `news` (Articolo di cronaca), `short_story` (Racconto breve), `novel_chapter` (Capitolo di romanzo), `dialogue` (Dialogo).

**Stretch mode:** When enabled, adds 1–2 grammar structures from one level above. Auto-disabled at C2 (no higher level). The `nextLevel()` helper computes the next CEFR level.

---

### 3. Story Reader (Tokenized + Annotated)

Each story is rendered token-by-token with interactive word popovers and inline grammar markers. If no token annotations exist, it falls back to plain paragraph rendering.

| What | Where |
|---|---|
| Story reader page | [`src/routes/story.$id.tsx`](src/routes/story.$id.tsx) |
| Token-by-token rendering with grammar spans | [`src/routes/story.$id.tsx:333-468`](src/routes/story.$id.tsx#L333-L468) (`renderParagraphs`) |
| Plain-text fallback rendering | [`src/routes/story.$id.tsx:313-331`](src/routes/story.$id.tsx#L313-L331) (`renderPlainParagraphs`) |
| Grammar group computation (contiguous token spans) | [`src/routes/story.$id.tsx:101-125`](src/routes/story.$id.tsx#L101-L125) (`groupByToken` memo) |
| Word popover (lemma, POS, translation, grammar note, WordReference link, save button) | [`src/routes/story.$id.tsx:402-458`](src/routes/story.$id.tsx#L402-L458) |
| Grammar cards (end-of-story section, stretch vs. regular) | [`src/routes/story.$id.tsx:238-259`](src/routes/story.$id.tsx#L238-L259) + `GrammarCard` component |
| Dialogue detection & speaker color rotation | Integrated in both `renderParagraphs` and `splitParagraphs` |
| "Continue chapter" button (serialized stories) | [`src/routes/story.$id.tsx:263-288`](src/routes/story.$id.tsx#L263-L288) |

**Key data types:**
- `Token`: `{ i, surface, lemma, pos, translation, note }`
- `GrammarEntry`: `{ name, explanation, example_sentence, extra_examples, complexity, is_stretch, token_indices }`
- Annotations stored in `story_annotations` table (tokens JSON + grammar JSON).

**Inline grammar markers:** Only `complex` or `is_stretch` grammar entries get underlined in the story text. Simple/expected structures for the level are listed only in the end-of-story grammar section.

---

### 4. Text-to-Speech Shadowing

The reader has a play/pause button that reads the full story aloud using the browser's built-in Italian voice (`SpeechSynthesis` API) at 0.95x speed.

| What | Where |
|---|---|
| Speak function (play/pause, Italian voice selection) | [`src/routes/story.$id.tsx:130-147`](src/routes/story.$id.tsx#L130-L147) |
| Play/Pause button in story header | [`src/routes/story.$id.tsx:222-225`](src/routes/story.$id.tsx#L222-L225) |

---

### 5. Vocabulary Tracking

Users save words to their personal vocabulary by clicking them in stories. Each vocab item stores: lemma, POS, translation, first story context, CEFR level, theme tag, and learning status.

| What | Where |
|---|---|
| Vocab list page (search, theme editing, status toggle, delete) | [`src/routes/vocab.tsx`](src/routes/vocab.tsx) |
| Save word from story popover | [`src/routes/story.$id.tsx:173-195`](src/routes/story.$id.tsx#L173-L195) (`saveVocab`) |
| Target word highlighting (words from vocab reused in new stories) | [`src/routes/story.$id.tsx:57-58`](src/routes/story.$id.tsx#L57-L58), [`src/routes/story.$id.tsx:397-400`](src/routes/story.$id.tsx#L397-L400) |
| Vocab DB schema | [`src/integrations/supabase/types.ts:218-270`](src/integrations/supabase/types.ts#L218-L270) (`vocab_items`) |

**Theme tags:** Users can tag words with themes (e.g., "cucina", "viaggi"). When generating a new story with a theme, the app pulls 3–5 saved words on that theme to embed in the story for reinforcement.

**Status:** Each word has a status (`learning` / `mastering`) that can be toggled from the vocab list.

---

### 6. Spaced Repetition Review (SM-2)

A flashcard review system using a modified SM-2 algorithm. Cards show the Italian lemma; the user reveals the translation and grades recall quality (Again / Hard / Good / Easy).

| What | Where |
|---|---|
| Review page (flashcard UI, grading buttons, session progress) | [`src/routes/review.tsx`](src/routes/review.tsx) |
| SM-2 algorithm (`nextSrs` function) | [`src/lib/srs.ts`](src/lib/srs.ts) |
| SRS state: `interval_days`, `ease`, `reps`, `lapses`, `due_at` | [`src/integrations/supabase/types.ts:50-96`](src/integrations/supabase/types.ts#L50-L96) (`srs_reviews`) |
| Due count shown on vocab page ("Ripassa" button) | [`src/routes/vocab.tsx:95-97`](src/routes/vocab.tsx#L95-L97) |
| In-context ease bump (when clicking a target word in a story) | [`src/routes/story.$id.tsx:149-171`](src/routes/story.$id.tsx#L149-L171) (`bumpEaseHarder`) |

**Algorithm details (SM-2 lite):**
- Quality grades: 0 (Again), 1 (Hard), 2 (Good), 3 (Easy)
- "Again" resets interval to 0 and drops ease by 0.2
- First two reps use fixed intervals; subsequent reps multiply by ease factor
- Ease floor: 1.3
- Review sessions load up to 30 due cards in random order

---

### 7. Settings & Profile

Users configure display name, default CEFR level, default stretch mode, and their personal Gemini API key (used for story generation).

| What | Where |
|---|---|
| Settings page | [`src/routes/settings.tsx`](src/routes/settings.tsx) |
| Profile DB schema (`profiles` table) | [`src/integrations/supabase/types.ts:17-48`](src/integrations/supabase/types.ts#L17-L48) |
| Gemini API key input | [`src/routes/settings.tsx:185-199`](src/routes/settings.tsx#L185-L199) |

---

### 8. Anki Import / Export

Users can import vocabulary from Anki (TSV/CSV with recognized columns) and export their Letture vocabulary back to Anki format with SRS state preserved.

| What | Where |
|---|---|
| Export to Anki (TSV file download with header directives) | [`src/routes/settings.tsx:59-121`](src/routes/settings.tsx#L59-L121) (`onExportAnki`) |
| Import from Anki (file upload → Edge Function) | [`src/routes/settings.tsx:123-144`](src/routes/settings.tsx#L123-L144) (`onImportFile`) |
| Import Edge Function call (`supabase.functions.invoke("import-anki")`) | [`src/routes/settings.tsx:131`](src/routes/settings.tsx#L131) |

**Export format:** TSV with Anki header directives (`#separator:tab`, `#html:false`, `#columns:...`). Includes: Front, Back, Tags, Interval, Ease, Reps, Lapses, POS, Notes, Level.

---

### 9. App Navigation & Layout

A sticky header with navigation links that adapts to auth state. Italian-language UI throughout.

| What | Where |
|---|---|
| App header (logo, nav links, auth-aware) | [`src/components/AppHeader.tsx`](src/components/AppHeader.tsx) |
| Root layout (QueryClient, AuthProvider, Toaster) | [`src/routes/__root.tsx`](src/routes/__root.tsx) |
| Router config (scroll restoration, error component) | [`src/router.tsx`](src/router.tsx) |
| Route tree (auto-generated) | [`src/routeTree.gen.ts`](src/routeTree.gen.ts) |
| 404 page | [`src/routes/__root.tsx:9-29`](src/routes/__root.tsx#L9-L29) |
| Landing page (feature cards, CTA) | [`src/routes/index.tsx`](src/routes/index.tsx) |

---

### 10. UI Component Library

All UI primitives come from shadcn/ui (Radix + Tailwind). Over 40 components are available.

| What | Where |
|---|---|
| All shadcn/ui components | [`src/components/ui/`](src/components/ui/) |
| Mobile detection hook | [`src/hooks/use-mobile.tsx`](src/hooks/use-mobile.tsx) |
| Utility function (`cn` for class merging) | [`src/lib/utils.ts`](src/lib/utils.ts) |
| Global styles (CSS custom properties, fonts) | [`src/styles.css`](src/styles.css) |

---

## Database Schema (Supabase Postgres)

| Table | Purpose |
|---|---|
| `profiles` | User preferences (display name, default level, stretch, Gemini key) |
| `stories` | Generated stories (title, body, level, mode, format, parent chain, target words) |
| `story_annotations` | Token-level and grammar annotations per story (JSON) |
| `vocab_items` | Saved vocabulary (lemma, POS, translation, theme, status, CEFR level) |
| `srs_reviews` | Spaced repetition state per vocab item (interval, ease, reps, lapses, due date) |
| `user_roles` | Role-based access control (admin / user) |

Full type definitions: [`src/integrations/supabase/types.ts`](src/integrations/supabase/types.ts)

---

## Supabase Edge Functions (server-side)

| Function | Called from |
|---|---|
| `generate-story` | Generate page — creates a new story with annotations |
| `continue-story` | Story reader — generates a sequel chapter |
| `import-anki` | Settings page — parses uploaded Anki file and upserts vocab |

---

## Route Map

| Path | Page | Auth required |
|---|---|---|
| `/` | Landing page | No |
| `/auth` | Sign in / Sign up | No |
| `/generate` | Story generator | Yes |
| `/library` | Story library | Yes |
| `/story/:id` | Story reader | Yes |
| `/vocab` | Vocabulary list | Yes |
| `/review` | SRS flashcard review | Yes |
| `/settings` | Profile & Anki import/export | Yes |
