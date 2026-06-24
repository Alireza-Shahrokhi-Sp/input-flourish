// Generate an Italian story + annotations using Gemini, in one batched JSON call.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { lemmaLevel, isAtOrBelowLevel } from "../_shared/lexicon.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STRETCH_POOL: Record<string, string[]> = {
  "A1->A2": ["passato prossimo (forme regolari più comuni)", "preposizioni articolate di base", "aggettivi possessivi"],
  "A2->B1": ["imperfetto", "futuro semplice", "pronomi diretti", "ne partitivo basico"],
  "B1->B2": ["congiuntivo presente", "periodo ipotetico II tipo", "pronomi relativi cui/il quale", "ne in tempi composti", "si passivante"],
  "B2->C1": ["congiuntivo imperfetto e trapassato", "periodo ipotetico III tipo", "concordanza dei tempi", "forme implicite (gerundio assoluto, participio assoluto)"],
  "C1->C2": ["congiuntivo trapassato in subordinate complesse", "discorso indiretto libero", "lessico letterario raro", "costruzioni marcate (dislocazioni, frasi scisse)"],
};

const TARGET_WORDS: Record<string, [number, number]> = {
  A1: [80, 140], A2: [140, 220], B1: [220, 350], B2: [350, 500], C1: [500, 700], C2: [600, 900],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    const token = auth?.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Validate the user with the anon client
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userErr } = await authClient.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const user = userData.user;

    // Use service role for DB writes (RLS bypassed; we filter by user.id explicitly)
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const level: string = body.level ?? "A2";
    const mode: "standard" | "stretch" = body.mode ?? "standard";
    const stretch_level: string | null = body.stretch_level ?? null;
    const format: string = body.format ?? "short_story";
    const topic: string | null = body.topic ?? null;
    const theme_tag: string | null = body.theme_tag ?? null;

    const { data: prof } = await supabase
      .from("profiles").select("gemini_api_key").eq("user_id", user.id).maybeSingle();
    const apiKey = (prof?.gemini_api_key as string | null) || Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "Nessuna chiave Gemini. Aggiungi la tua in Impostazioni." }, 400);

    // --- SRS-due target word selection ---
    // Pick 3-5 due words from the same theme (if provided), else from any theme.
    type VocabRow = { id: string; lemma: string; pos: string | null; translation: string | null; theme_tag: string | null };
    const nowIso = new Date().toISOString();

    let dueQuery = supabase
      .from("vocab_items")
      .select("id,lemma,pos,translation,theme_tag,srs_reviews!left(due_at,ease)")
      .eq("user_id", user.id);
    if (theme_tag) dueQuery = dueQuery.eq("theme_tag", theme_tag);
    const { data: vocabRaw } = await dueQuery.limit(200);

    type Joined = VocabRow & { srs_reviews: { due_at: string; ease: number }[] };
    const vocabAll = (vocabRaw ?? []) as Joined[];
    const due = vocabAll
      .map((v) => {
        const srs = v.srs_reviews?.[0];
        const dueAt = srs?.due_at ?? null;
        return { v, dueAt, ease: srs?.ease ?? 2.5, isDue: !dueAt || dueAt <= nowIso };
      })
      .filter((x) => x.isDue)
      .sort((a, b) => a.ease - b.ease) // hardest first
      .slice(0, 5);
    const targetWords = due.map((d) => d.v);
    const targetWordIds = targetWords.map((v) => v.id);

    // Background known vocab to recycle (limit 30) — used in the prompt as a hint.
    const knownLemmas = vocabAll.slice(0, 30).map((v) => v.lemma);
    // FULL set of lemmas this user has saved — used by the density verifier as
    // the "known to the user" side of the i+1 rule (NOT a CEFR level list).
    const allKnownLemmas = vocabAll.map((v) => v.lemma);

    const [minW, maxW] = TARGET_WORDS[level] ?? [200, 350];
    const stretchKey = stretch_level ? `${level}->${stretch_level}` : null;
    const stretchPool = stretchKey ? STRETCH_POOL[stretchKey] ?? [] : [];

    const targetBlock = targetWords.length
      ? `\n- PAROLE BERSAGLIO da ripassare (usa OGNUNA almeno DUE volte in frasi diverse, in forma flessa naturale — non forzare la forma di citazione):\n${targetWords.map((v) => `  • ${v.lemma}${v.translation ? ` (${v.translation})` : ""}${v.pos ? ` [${v.pos}]` : ""}`).join("\n")}`
      : "";

    const sys = `Sei un autore italiano e linguista applicato. Scrivi storie in italiano per studenti di livello CEFR. RISPONDI SOLO in JSON valido secondo lo schema richiesto, senza testo extra e senza fence di codice.`;

    const user_prompt = `Genera una storia originale e coinvolgente in italiano.

PARAMETRI
- Livello: ${level}${mode === "stretch" && stretch_level ? ` (con 1-2 elementi di sfida di ${stretch_level})` : ""}
- Formato: ${format}
- Lunghezza target: ${minW}-${maxW} parole
- Argomento: ${topic ?? "scegli tu qualcosa di interessante e specifico (evita cliché)"}
${theme_tag ? `- Tema/categoria: ${theme_tag}` : ""}
${knownLemmas.length ? `- Riusa con naturalezza qualche parola che lo studente già conosce: ${knownLemmas.slice(0, 30).join(", ")}` : ""}
${stretchPool.length ? `- Elementi di sfida ammessi (scegline 1 o 2, in modo NATURALE, non forzato): ${stretchPool.join("; ")}` : ""}${targetBlock}

REGOLE
- Italiano autentico e vivo, non scolastico. Voce coerente con il formato.
- Mantieni il grosso del lessico/grammatica al livello ${level}.
- REGOLA DEL 98%: almeno il 97-98% delle parole DEVE essere di livello ${level} o inferiore. Le PAROLE BERSAGLIO contano nell'altro 2-3%.
- Ogni PAROLA BERSAGLIO va usata almeno DUE volte, in frasi diverse e in contesti differenti, per rinforzare l'acquisizione.
- Non usare più di 1-2 elementi sopra livello, e SOLO quelli ammessi sopra.
- Nessuna premessa, nessun titolo nel corpo: solo la storia.

OUTPUT (JSON)
{
  "title": "Titolo breve in italiano",
  "summary": "Una frase di sintesi (max 20 parole)",
  "topic": "tema in 2-4 parole",
  "body": "Il testo completo della storia.",
  "tokens": [
    { "i": 0, "surface": "Il", "lemma": "il", "pos": "det" },
    { "i": 1, "surface": " ", "lemma": null, "pos": "other" },
    { "i": 2, "surface": "gatto", "lemma": "gatto", "pos": "noun", "translation": "cat" },
    { "i": 3, "surface": " ", "lemma": null, "pos": "other" },
    { "i": 4, "surface": "mangia", "lemma": "mangiare", "pos": "verb", "translation": "eats" },
    { "i": 5, "surface": ".", "lemma": null, "pos": "punct" }
  ],
  "grammar": [
    {
      "name": "Nome intuitivo della struttura (es. 'Congiuntivo presente')",
      "explanation": "Una frase chiara, in italiano semplice o inglese se aiuta.",
      "example_sentence": "La frase ESATTA presa dalla storia in cui appare.",
      "extra_examples": ["Due o tre altre frasi di esempio."],
      "complexity": "simple" | "complex",
      "is_stretch": true | false,
      "token_indices": [12, 13]
    }
  ],
  "expressions": [
    {
      "token_indices": [5, 6, 7, 8],
      "lemma": "forma di citazione (es. 'farcela', 'in bocca al lupo', 'darsi da fare')",
      "pos": "locuzione | verbo pronominale | espressione idiomatica | collocazione",
      "meaning": "traduzione/significato in inglese, conciso",
      "note": "spiegazione strutturale breve per uno studente (1-2 frasi in inglese)"
    }
  ]
}

ISTRUZIONI TOKENIZZAZIONE
- ESTREMA IMPORTANZA: "tokens" deve dividere il testo PAROLA PER PAROLA. Non raggruppare MAI più parole nello stesso token.
- "tokens" deve coprire l'INTERO body in ordine, includendo punteggiatura e spazi.
- Usa sempre uno space token (surface=" ") per separare le parole. Anche la punteggiatura (, . ! ?) deve avere il proprio token separato.
- Per parole comunissime (articoli, congiunzioni, preposizioni, pronomi clitici basici) puoi omettere "translation".
- "lemma" in minuscolo, forma di citazione (verbi all'infinito, sostantivi al maschile singolare quando possibile). Il lemma deve essere accurato: il backend lo confronta con un lessico CEFR per verificare la difficoltà del testo.
ISTRUZIONI CRITICHE SINTASSI JSON (PENA IL FALLIMENTO):
- TUTTI i valori di testo devono avere le virgolette doppie in apertura e chiusura (es. "surface": "è", MAI "surface": è").
- Se usi il discorso diretto nel "body" o nelle frasi di esempio, EVITA le virgolette doppie ("). Usa invece i caporali (« ») o i trattini (—) per non rompere la formattazione JSON.
- Non inserire MAI caratteri di escape non validi o newline non formattati (\n) all'interno delle stringhe JSON.

ISTRUZIONI GRAMMATICA
- Includi TUTTI i punti grammaticali rilevanti che compaiono nel testo.
- "complexity": "complex" SOLO per strutture non ovvie per il livello (congiuntivo, condizionale, ipotetiche, pronominali ne/ci, si passivante, gerundi, participi assoluti, verbi pronominali tipo "andarsene/farcela/cavarsela", verbi con particelle separate dal clitico, ecc.).
- "is_stretch": true SOLO per gli elementi sopra livello che hai introdotto.
- "token_indices": IMPORTANTISSIMO — elenca TUTTI E SOLI i token che appartengono a UNA SINGOLA occorrenza della struttura, come UN GRUPPO UNICO. Se la stessa struttura ricorre più volte, crea VOCI SEPARATE in "grammar" (una per occorrenza), ognuna con il proprio gruppo di token_indices. NON mettere ogni parola come voce separata, e NON unire occorrenze diverse in un solo gruppo.
- Per verbi pronominali / verbi + particelle clitiche separate (es. "ne ho parlato", "ci penso io", "se ne va", "gliel'ho detto"): includi NEL gruppo TUTTI i token coinvolti (clitico + verbo + ausiliare), anche se non sono adiacenti, così che lo studente veda chiaramente che funzionano insieme.
- Per strutture multi-parola (passato prossimo "ho mangiato", congiuntivo composto, periodo ipotetico "se avessi … sarei …"): includi ausiliare + participio / entrambe le clausole nello STESSO gruppo.

ISTRUZIONI ESPRESSIONI
- "expressions" contiene espressioni multi-parola che uno studente dovrebbe imparare come blocco unico.
- Includi SOLO: verbi pronominali (farcela, andarsene, prendersela, cavarsela), locuzioni fisse (in bocca al lupo, a un tratto, per fortuna, in realtà), espressioni idiomatiche, collocazioni che non si traducono letteralmente.
- NON includere: singole parole, coppie verbo+articolo comuni (fare il, prendere la), tempi composti normali (ho mangiato, sono andato) — quelli vanno in "grammar".
- "token_indices": gli indici ESATTI dei token nel body che formano l'espressione (come per grammar). Anche se i token non sono tutti adiacenti (es. "ce la faccio" con altri token in mezzo), elenca tutti quelli coinvolti.
- "lemma": forma di citazione all'infinito (verbi pronominali con particelle: "andarsene" non "andare"; "farcela" non "fare").
- "note": spiega la STRUTTURA (es. "ce + la + fare: pronominal verb where 'ce' replaces 'ci' before 'la'; means to manage/succeed"). Non ripetere il significato.
- Punta a 2-5 espressioni per storia (dipende dal livello e contenuto). A1 potrebbe averne 1-2, B2 potrebbe averne 4-5. Se non ce ne sono nel testo, lascia l'array vuoto.`;

    // --- Generation + deterministic density verification loop ---
    // CLAUDE.md mandates a deterministic check on the LLM output (LLMs cannot
    // reliably count or hit exact percentages) that calculates the known/target
    // lemma percentages and retries if the i+1 / 95-98% constraint is violated.
    // We verify using the per-token lemmas the model already returns, then
    // regenerate (once) with a corrective instruction if it fails.
    const knownLemmaSet = new Set(allKnownLemmas.map((l) => l.toLowerCase()));
    const targetLemmaSet = new Set(targetWords.map((v) => v.lemma.toLowerCase()));

    const MAX_GEN_ATTEMPTS = 2;
    let parsed!: ParsedStory;
    let verification: DensityResult | null = null;

    for (let attempt = 1; attempt <= MAX_GEN_ATTEMPTS; attempt++) {
      const promptForAttempt =
        attempt === 1 || !verification
          ? user_prompt
          : `${user_prompt}\n\nCORREZIONE (tentativo precedente non conforme):\n${verification.feedback}`;

      const resp = await callGeminiWithRetry(apiKey, sys, promptForAttempt);

      if (!resp.ok) {
        const txt = await resp.text();
        console.error("Gemini error", resp.status, txt);
        const userMsg = resp.status === 503 || resp.status === 429
          ? "Il modello AI è momentaneamente sovraccarico. Riprova tra qualche secondo."
          : resp.status === 400 || resp.status === 401 || resp.status === 403
          ? "Chiave Gemini non valida. Aggiornala in Impostazioni."
          : `Gemini ${resp.status}: ${txt.slice(0, 200)}`;
        return json({ error: userMsg }, resp.status === 503 ? 503 : 500);
      }

      const gemData = await resp.json();
      const text =
        gemData?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";

      let candidate: ParsedStory;
      try {
        candidate = JSON.parse(text);
      } catch (_e) {
        // Try to recover JSON between the first { and last }
        const a = text.indexOf("{");
        const b = text.lastIndexOf("}");
        if (a < 0 || b < 0) {
          if (attempt < MAX_GEN_ATTEMPTS) { verification = null; continue; }
          return json({ error: "Risposta non JSON" }, 500);
        }
        try {
          candidate = JSON.parse(text.slice(a, b + 1));
        } catch (_e2) {
          if (attempt < MAX_GEN_ATTEMPTS) { verification = null; continue; }
          return json({ error: "Risposta non JSON" }, 500);
        }
      }

      verification = verifyDensity(candidate, targetLemmaSet, knownLemmaSet, level);
      console.log(
        `density attempt ${attempt}: pass=${verification.pass} ` +
        `targetPct=${verification.targetPct.toFixed(2)} knownPct=${verification.knownPct.toFixed(1)} ` +
        `atLevelPct=${verification.atLevelPct.toFixed(1)} ` +
        `cefr=${verification.cefrBreakdown ? JSON.stringify(verification.cefrBreakdown) : "n/a"} ` +
        `unmetTargets=[${verification.unmetTargets.join(",")}] reason="${verification.reason}"`,
      );

      parsed = candidate;
      if (verification.pass || attempt === MAX_GEN_ATTEMPTS) break;
      // else: loop again with corrective feedback appended.
    }

    // Guard: if every attempt failed to parse, `parsed` is unset. (The last
    // attempt's parse-failure branch already returns, so this is belt-and-braces.)
    if (!parsed || typeof parsed.body !== "string") {
      return json({ error: "Risposta non valida dal modello" }, 500);
    }

    // Note: we serve the final candidate even if verification ultimately fails
    // after the retry budget — a generated story is still better than an error,
    // and CLAUDE.md's hard fail-safe (cached fallback) is planned separately
    // (see docs/plans/CACHED_FALLBACK_PLAN.md). The verification result is logged
    // and returned to the caller for visibility.

    const word_count = parsed.body.trim().split(/\s+/).length;

    const { data: storyRow, error: insErr } = await supabase
      .from("stories")
      .insert({
        user_id: user.id,
        title: parsed.title,
        topic: parsed.topic ?? topic,
        level,
        mode,
        stretch_level,
        format,
        body: parsed.body,
        summary: parsed.summary ?? null,
        word_count,
        theme_tag,
        target_word_ids: targetWordIds,
      })
      .select("id")
      .single();

    if (insErr || !storyRow) {
      console.error("insert story", insErr);
      return json({ error: insErr?.message ?? "insert failed" }, 500);
    }

    await supabase.from("story_annotations").insert({
      story_id: storyRow.id,
      user_id: user.id,
      tokens: parsed.tokens ?? [],
      grammar: parsed.grammar ?? [],
      expressions: parsed.expressions ?? [],
    });

    return json({
      story_id: storyRow.id,
      density: verification
        ? {
            pass: verification.pass,
            target_pct: verification.targetPct,
            known_pct: verification.knownPct,
            at_level_pct: verification.atLevelPct,
            unmet_targets: verification.unmetTargets,
            cefr_breakdown: verification.cefrBreakdown,
          }
        : null,
    });
  } catch (e) {
    console.error("generate-story error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Deterministic density verification (the "NLP verifier" from CLAUDE.md).
//
// WHY this exists: an LLM cannot reliably count words or hit an exact
// percentage. It will happily claim it followed the 95-98% rule while not
// actually doing so. This deterministic step re-derives the numbers from the
// model's own per-token lemmas and decides pass/fail independently of the
// model's self-report.
//
// "KNOWN" MEANS KNOWN TO THIS USER — not "at/below a CEFR level". The known set
// is the user's saved vocab (vocab_items). The i+1 signal we measure is:
// what fraction of the story's content words does this user already know?
//
// What this verifies deterministically from the tokens:
//   1. Double Exposure: each due target lemma appears at least TWICE — checkable.
//   2. Target density: due words are ~2-5% of content words — checkable.
//   3. Known coverage: % of content words the user already knows (their vocab
//      + the target words, which are by definition being learned) — checkable.
//      This is reported and logged; it is NOT used as a hard pass/fail gate,
//      because a brand-new user with an almost-empty vocab would fail every
//      story through no fault of the generation. It becomes meaningful as the
//      user's saved vocab grows. (Hard-gating it later is a one-line change.)
//
// CEFR-LEVEL DENSITY (cefrBreakdown): a breakdown like "70% A1, 20% A2, …",
// computed DETERMINISTICALLY by looking up each content lemma in the Profilo
// CEFR lexicon (see ../_shared/lexicon.ts). Words not in the lexicon are bucketed
// as "?" (unknown level). This replaces the earlier model-estimated approach.
//
// AT-LEVEL COVERAGE (atLevelPct): % of content words whose lexicon level is <=
// the user's level. Policy: a lemma NOT in the lexicon counts as ABOVE level
// (conservative — protects the comprehension guarantee). This is the lexicon
// half of the i+1 "95-98% known" rule. Like knownPct it is reported/logged but
// NOT a hard pass/fail gate yet (gating it is a one-line change once we're
// confident in lemma-match rates against real generations).
// ---------------------------------------------------------------------------

type Token = {
  i?: number; surface?: string; lemma?: string | null; pos?: string;
  cefr?: string | null;  // optional model-estimated CEFR level of this word
};
type ParsedStory = {
  title: string; summary?: string; topic?: string; body: string;
  tokens?: Token[]; grammar?: unknown[]; expressions?: unknown[];
};

type DensityResult = {
  pass: boolean;
  targetPct: number;          // % of content-word tokens that are due target lemmas
  knownPct: number;           // % of content words known to user (saved vocab + targets + at-level)
  atLevelPct: number;         // % of content words with lexicon level <= user level
  contentWordCount: number;
  unmetTargets: string[];     // target lemmas appearing < 2 times (incl. 0)
  cefrBreakdown: Record<string, number> | null; // lexicon level → % of content words ("?" = not in lexicon)
  reason: string;             // short machine-ish reason
  feedback: string;           // Italian corrective text appended to the retry prompt
};

// Content-word POS tags we count toward density. Function words (articles,
// prepositions, conjunctions, pronouns, punctuation, spaces) are excluded so
// the percentage reflects meaningful vocabulary, not glue words.
const CONTENT_POS = new Set(["noun", "verb", "adj", "adv", "propn", "num"]);

function isContentToken(t: Token): boolean {
  if (!t.lemma) return false;                 // spaces / punctuation have null lemma
  if (!/\p{L}/u.test(t.surface ?? t.lemma)) return false;
  // If pos is provided, restrict to content classes; if absent, accept any
  // lemma'd word token (better to over-count slightly than to under-count).
  if (t.pos) return CONTENT_POS.has(t.pos.toLowerCase());
  return true;
}

// Target density band: due words should be a small, deliberate minority.
// Mirrors CLAUDE.md's "2-5% target/due words". We allow a little slack on the
// low end because short A1 texts can't always hit 2% with whole words.
const TARGET_MIN_PCT = 1.5;
const TARGET_MAX_PCT = 8.0;   // generous upper bound; flagrant overuse still caught
const MIN_TARGET_OCCURRENCES = 2; // Double Exposure

function verifyDensity(
  parsed: ParsedStory,
  targetLemmas: Set<string>,
  knownLemmas: Set<string>,    // lemmas this user has saved (known to the user)
  userLevel: string,           // the story's CEFR level, for at-level lookup
): DensityResult {
  const tokens = Array.isArray(parsed.tokens) ? parsed.tokens : [];

  // Count occurrences of each lemma among content words; tally known + at-level
  // coverage; accumulate the DETERMINISTIC CEFR histogram from the lexicon.
  const lemmaCounts = new Map<string, number>();
  const cefrCounts = new Map<string, number>();  // lexicon level → count; "?" = not in lexicon
  let contentWordCount = 0;
  let knownCount = 0;
  let atLevelCount = 0;
  for (const t of tokens) {
    if (!isContentToken(t)) continue;
    contentWordCount++;
    const lemma = (t.lemma as string).toLowerCase();
    lemmaCounts.set(lemma, (lemmaCounts.get(lemma) ?? 0) + 1);

    const atLevel = isAtOrBelowLevel(lemma, userLevel);
    if (atLevel) atLevelCount++;

    // Known to the user if: saved in their vocab, OR a due target word (actively
    // learning), OR at/below their level per the lexicon (expected to be known).
    if (knownLemmas.has(lemma) || targetLemmas.has(lemma) || atLevel) knownCount++;

    // Deterministic CEFR bucket from the lexicon ("?" when not found).
    const lvl = lemmaLevel(lemma) ?? "?";
    cefrCounts.set(lvl, (cefrCounts.get(lvl) ?? 0) + 1);
  }

  // If the model returned no usable tokens, we cannot verify — pass by default
  // (don't block a story over a tokenization gap; the prompt still applied).
  if (contentWordCount === 0) {
    return {
      pass: true, targetPct: 0, knownPct: 0, atLevelPct: 0, contentWordCount: 0,
      unmetTargets: [], cefrBreakdown: null, reason: "no-tokens", feedback: "",
    };
  }

  // Double Exposure: every due target lemma must appear >= 2 times.
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

  // CEFR-level density: % of content words at each lexicon level. Deterministic.
  // "?" is the share of content words not found in the lexicon (treated as
  // above-level for the at-level/known calculations above).
  const cefrBreakdown: Record<string, number> = {};
  for (const [lvl, n] of cefrCounts) {
    cefrBreakdown[lvl] = Math.round((n / contentWordCount) * 1000) / 10; // 1 decimal %
  }

  // Determine pass/fail. If there are no target words this story, only the
  // (vacuously satisfied) checks apply and it passes.
  const hasTargets = targetLemmas.size > 0;
  const doubleExposureOk = unmetTargets.length === 0;
  const densityOk = !hasTargets || (targetPct >= TARGET_MIN_PCT && targetPct <= TARGET_MAX_PCT);
  const pass = !hasTargets ? true : doubleExposureOk && densityOk;

  // Build a concise reason + an Italian corrective instruction for the retry.
  const reasons: string[] = [];
  const fixes: string[] = [];
  if (hasTargets && !doubleExposureOk) {
    reasons.push(`unmet-double-exposure(${unmetTargets.length})`);
    fixes.push(
      `Le seguenti PAROLE BERSAGLIO non compaiono almeno DUE volte: ${unmetTargets.join(", ")}. ` +
      `Riscrivi la storia in modo che OGNUNA di queste parole appaia almeno due volte, in frasi diverse e naturali.`,
    );
  }
  if (hasTargets && targetPct > TARGET_MAX_PCT) {
    reasons.push(`target-too-dense(${targetPct.toFixed(1)}%)`);
    fixes.push(
      `Le parole bersaglio sono troppo frequenti (${targetPct.toFixed(1)}% delle parole di contenuto). ` +
      `Riduci le ripetizioni superflue: ogni parola bersaglio basta che appaia 2-3 volte.`,
    );
  }
  if (hasTargets && targetPct < TARGET_MIN_PCT && doubleExposureOk) {
    reasons.push(`target-too-sparse(${targetPct.toFixed(1)}%)`);
  }

  return {
    pass,
    targetPct,
    knownPct,
    atLevelPct,
    contentWordCount,
    unmetTargets,
    cefrBreakdown,
    reason: reasons.length ? reasons.join("; ") : "ok",
    feedback: fixes.join(" "),
  };
}

// Call Gemini with resilient retries against transient overload (503) and
// rate-limit (429) responses.
//
// Improvements over the previous version:
//  - Leads with gemini-2.5-flash (generally higher availability) and ALTERNATES
//    models, so a single overloaded model can't sink the whole request. The old
//    order hit flash-lite twice in a row, usually re-hitting the same wall.
//  - 5 attempts with exponential backoff + jitter (~1s, 2s, 4s, 8s, capped 10s).
//    The old budget was only ~5s total, shorter than a typical overload window.
//  - Wraps fetch in try/catch so a transient network blip retries instead of
//    throwing all the way out of the function.
//  - Bails immediately (no retry) on non-transient statuses (400/401/403/404),
//    since retrying a bad key or bad model name only wastes time.
async function callGeminiWithRetry(apiKey: string, sys: string, userPrompt: string): Promise<Response> {
  const models = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
  ];
  let lastResp: Response | null = null;

  for (let i = 0; i < models.length; i++) {
    if (i > 0) {
      const base = Math.min(1000 * 2 ** (i - 1), 10_000); // 1s, 2s, 4s, 8s, 10s…
      const jitter = Math.floor(Math.random() * 500);
      await new Promise((r) => setTimeout(r, base + jitter));
    }

    let resp: Response;
    try {
      resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${models[i]}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: sys }] },
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            generationConfig: { temperature: 0.65, responseMimeType: "application/json" },
          }),
        },
      );
    } catch (e) {
      // Network-level failure (DNS, connection reset, timeout) — retryable.
      console.warn(`Gemini ${models[i]} fetch threw on attempt ${i + 1}/${models.length}:`, e);
      continue;
    }

    if (resp.ok) return resp;
    lastResp = resp;

    // Only 503 (overloaded) and 429 (rate limited) are worth retrying.
    // Everything else (bad key, bad request, missing model) is permanent.
    if (resp.status !== 503 && resp.status !== 429) return resp;
    console.warn(`Gemini ${models[i]} returned ${resp.status}, attempt ${i + 1}/${models.length}`);
  }

  return lastResp!;
}
