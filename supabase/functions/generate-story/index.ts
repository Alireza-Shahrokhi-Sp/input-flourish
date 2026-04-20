// Generate an Italian story + annotations using Gemini, in one batched JSON call.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "GEMINI_API_KEY non configurata" }, 500);

    // Pull a small slice of the user's known vocab so the LLM can recycle some of it
    const { data: vocab } = await supabase
      .from("vocab_items")
      .select("lemma")
      .eq("user_id", user.id)
      .limit(80);
    const knownLemmas = (vocab ?? []).map((v: { lemma: string }) => v.lemma);

    const [minW, maxW] = TARGET_WORDS[level] ?? [200, 350];
    const stretchKey = stretch_level ? `${level}->${stretch_level}` : null;
    const stretchPool = stretchKey ? STRETCH_POOL[stretchKey] ?? [] : [];

    const sys = `Sei un autore italiano e linguista applicato. Scrivi storie in italiano per studenti di livello CEFR. RISPONDI SOLO in JSON valido secondo lo schema richiesto, senza testo extra e senza fence di codice.`;

    const user_prompt = `Genera una storia originale e coinvolgente in italiano.

PARAMETRI
- Livello: ${level}${mode === "stretch" && stretch_level ? ` (con 1-2 elementi di sfida di ${stretch_level})` : ""}
- Formato: ${format}
- Lunghezza target: ${minW}-${maxW} parole
- Argomento: ${topic ?? "scegli tu qualcosa di interessante e specifico (evita cliché)"}
${knownLemmas.length ? `- Riusa con naturalezza qualche parola che lo studente già conosce: ${knownLemmas.slice(0, 30).join(", ")}` : ""}
${stretchPool.length ? `- Elementi di sfida ammessi (scegline 1 o 2, in modo NATURALE, non forzato): ${stretchPool.join("; ")}` : ""}

REGOLE
- Italiano autentico e vivo, non scolastico. Voce coerente con il formato.
- Mantieni il grosso del lessico/grammatica al livello ${level}.
- Non usare più di 1-2 elementi sopra livello, e SOLO quelli ammessi sopra.
- Nessuna premessa, nessun titolo nel corpo: solo la storia.

OUTPUT (JSON)
{
  "title": "Titolo breve in italiano",
  "summary": "Una frase di sintesi (max 20 parole)",
  "topic": "tema in 2-4 parole",
  "body": "Il testo completo della storia.",
  "tokens": [
    { "i": 0, "surface": "Parola", "lemma": "parola", "pos": "noun|verb|adj|adv|det|pron|prep|conj|num|punct|other", "translation": "english gloss (omit for very common closed-class words)" }
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
  ]
}

ISTRUZIONI TOKENIZZAZIONE
- "tokens" deve coprire l'INTERO body in ordine, includendo punteggiatura e spazi (uno space token tra parole, surface=" ").
- Per parole comunissime (articoli, congiunzioni, preposizioni, pronomi clitici basici) puoi omettere "translation".
- "lemma" in minuscolo, forma di citazione (verbi all'infinito, sostantivi al maschile singolare quando possibile).

ISTRUZIONI GRAMMATICA
- Includi TUTTI i punti grammaticali rilevanti che compaiono nel testo.
- "complexity": "complex" SOLO per strutture non ovvie per il livello (congiuntivo, condizionale, ipotetiche, pronominali ne/ci, si passivante, gerundi, participi assoluti, ecc.).
- "is_stretch": true SOLO per gli elementi sopra livello che hai introdotto.
- "token_indices" punta ai token in cui la struttura si manifesta nel body.`;

    const resp = await callGeminiWithRetry(apiKey, sys, user_prompt);

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("Gemini error", resp.status, txt);
      const userMsg = resp.status === 503 || resp.status === 429
        ? "Il modello AI è momentaneamente sovraccarico. Riprova tra qualche secondo."
        : `Gemini ${resp.status}: ${txt.slice(0, 200)}`;
      return json({ error: userMsg }, resp.status === 503 ? 503 : 500);
    }

    const gemData = await resp.json();
    const text =
      gemData?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";

    let parsed: {
      title: string; summary?: string; topic?: string; body: string;
      tokens?: unknown[]; grammar?: unknown[];
    };
    try {
      parsed = JSON.parse(text);
    } catch (_e) {
      // Try to recover JSON between the first { and last }
      const a = text.indexOf("{");
      const b = text.lastIndexOf("}");
      if (a < 0 || b < 0) return json({ error: "Risposta non JSON" }, 500);
      parsed = JSON.parse(text.slice(a, b + 1));
    }

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
    });

    return json({ story_id: storyRow.id });
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
