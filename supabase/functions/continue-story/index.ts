// Continue an existing story as a new chapter — same level/mode/format, same characters.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STRETCH_POOL: Record<string, string[]> = {
  "A1->A2": ["passato prossimo (forme regolari più comuni)", "preposizioni articolate", "aggettivi possessivi"],
  "A2->B1": ["imperfetto", "futuro semplice", "pronomi diretti", "ne partitivo basico"],
  "B1->B2": ["congiuntivo presente", "periodo ipotetico II tipo", "pronomi relativi cui/il quale", "ne in tempi composti", "si passivante"],
  "B2->C1": ["congiuntivo imperfetto e trapassato", "periodo ipotetico III tipo", "concordanza dei tempi", "forme implicite"],
  "C1->C2": ["congiuntivo trapassato in subordinate complesse", "discorso indiretto libero", "lessico letterario raro", "costruzioni marcate"],
};

const TARGET_WORDS: Record<string, [number, number]> = {
  A1: [80, 140], A2: [140, 220], B1: [220, 350], B2: [350, 500], C1: [500, 700], C2: [600, 900],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "GEMINI_API_KEY non configurata" }, 500);

    const auth = createClient(url, anon);
    const { data: u, error: ue } = await auth.getUser(token);
    if (ue || !u.user) return json({ error: "Unauthorized" }, 401);
    const user = u.user;
    const supabase = createClient(url, svc);

    const { previous_story_id } = await req.json();
    if (!previous_story_id) return json({ error: "previous_story_id mancante" }, 400);

    const { data: prev } = await supabase
      .from("stories")
      .select("*")
      .eq("id", previous_story_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!prev) return json({ error: "Storia precedente non trovata" }, 404);

    const level = prev.level;
    const mode = prev.mode;
    const stretch_level = prev.stretch_level;
    const format = prev.format;
    const [minW, maxW] = TARGET_WORDS[level] ?? [200, 350];
    const stretchKey = stretch_level ? `${level}->${stretch_level}` : null;
    const stretchPool = stretchKey ? STRETCH_POOL[stretchKey] ?? [] : [];

    const { data: vocab } = await supabase
      .from("vocab_items").select("lemma").eq("user_id", user.id).limit(80);
    const knownLemmas = (vocab ?? []).map((v: { lemma: string }) => v.lemma);

    const sys = `Sei un autore italiano e linguista applicato. Continui storie esistenti per studenti CEFR. RISPONDI SOLO in JSON valido, senza testo extra.`;

    const userPrompt = `Continua la storia seguente come un NUOVO capitolo. Mantieni gli stessi personaggi, ambientazione, voce e tono. Il capitolo deve poter essere letto da chi non ricorda perfettamente il precedente: poche righe iniziali ricordano il contesto, poi si sviluppa qualcosa di nuovo.

STORIA PRECEDENTE (titolo: «${prev.title}»):
${prev.body}

PARAMETRI
- Livello: ${level}${mode === "stretch" && stretch_level ? ` (con 1-2 elementi di sfida ${stretch_level})` : ""}
- Formato: ${format}
- Lunghezza target: ${minW}-${maxW} parole
${knownLemmas.length ? `- Riusa con naturalezza qualche parola che lo studente conosce: ${knownLemmas.slice(0, 30).join(", ")}` : ""}
${stretchPool.length ? `- Elementi di sfida ammessi (1 o 2, naturali): ${stretchPool.join("; ")}` : ""}

OUTPUT (stesso schema della prima generazione):
{
  "title": "Titolo del nuovo capitolo",
  "summary": "Una frase di sintesi",
  "topic": "tema in 2-4 parole",
  "body": "Il testo completo del capitolo.",
  "tokens": [{ "i": 0, "surface": "...", "lemma": "...", "pos": "...", "translation": "..." }],
  "grammar": [{ "name": "...", "explanation": "...", "example_sentence": "...", "extra_examples": ["..."], "complexity": "simple|complex", "is_stretch": true|false, "token_indices": [0] }]
}

Tokens coprono l'intero body in ordine (spazi e punteggiatura inclusi). Grammar: complex solo per strutture non ovvie; is_stretch solo per gli elementi sopra livello introdotti.`;

    const resp = await callGeminiWithRetry(apiKey, sys, userPrompt);
    if (!resp.ok) {
      const t = await resp.text();
      const userMsg = resp.status === 503 || resp.status === 429
        ? "Il modello AI è momentaneamente sovraccarico. Riprova tra qualche secondo."
        : `Gemini ${resp.status}: ${t.slice(0, 200)}`;
      return json({ error: userMsg }, resp.status === 503 ? 503 : 500);
    }
    const g = await resp.json();
    const text = g?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    let parsed;
    try { parsed = JSON.parse(text); }
    catch {
      const a = text.indexOf("{"), b = text.lastIndexOf("}");
      parsed = JSON.parse(text.slice(a, b + 1));
    }
    const wc = parsed.body.trim().split(/\s+/).length;

    const { data: row, error: insErr } = await supabase.from("stories").insert({
      user_id: user.id,
      title: parsed.title,
      topic: parsed.topic ?? prev.topic,
      level, mode, stretch_level, format,
      body: parsed.body,
      summary: parsed.summary ?? null,
      word_count: wc,
      parent_story_id: previous_story_id,
    }).select("id").single();
    if (insErr || !row) return json({ error: insErr?.message ?? "insert failed" }, 500);

    await supabase.from("story_annotations").insert({
      story_id: row.id, user_id: user.id,
      tokens: parsed.tokens ?? [], grammar: parsed.grammar ?? [],
    });
    return json({ story_id: row.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callGeminiWithRetry(apiKey: string, sys: string, userPrompt: string): Promise<Response> {
  const models = ["gemini-2.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
  const delays = [0, 1500, 3500];
  let lastResp: Response | null = null;
  for (let i = 0; i < models.length; i++) {
    if (delays[i] > 0) await new Promise((r) => setTimeout(r, delays[i]));
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${models[i]}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sys }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.9, responseMimeType: "application/json" },
        }),
      },
    );
    if (resp.ok) return resp;
    lastResp = resp;
    if (resp.status !== 503 && resp.status !== 429) return resp;
    console.warn(`Gemini ${models[i]} returned ${resp.status}, attempt ${i + 1}`);
  }
  return lastResp!;
}
