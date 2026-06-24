// Analyze an Italian phrase/expression using Gemini and return its meaning,
// lemma form, POS category, and a structural note for language learners.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SYSTEM = `Sei un linguista italiano esperto in didattica L2. Ti viene data un'espressione italiana selezionata da uno studente dentro una frase di contesto. Analizzala e rispondi SOLO in JSON valido (senza fence di codice).

SCHEMA OUTPUT:
{
  "lemma": "forma citazionale / infinito dell'espressione (es. 'farcela', 'in bocca al lupo', 'darsi da fare')",
  "pos": "una tra: 'locuzione', 'locuzione avverbiale', 'locuzione preposizionale', 'locuzione congiuntiva', 'verbo pronominale', 'espressione idiomatica', 'collocazione'",
  "meaning": "traduzione/significato contestuale in inglese, conciso",
  "note": "spiegazione strutturale breve per uno studente (max 2 frasi). Spiega PERCHÉ l'espressione funziona così: particelle pronominali, reggenza, registro, ecc. Scrivi in inglese semplice."
}

REGOLE:
- "lemma" deve essere la forma di citazione standard (infinito per i verbi, forma base per le locuzioni).
- Se l'espressione è un verbo pronominale, il lemma DEVE includere le particelle (es. "andarsene", "farcela", "prendersela", NON "andare", "fare", "prendere").
- "note" deve spiegare la struttura, non ripetere il significato. Concentrati su ciò che uno studente troverebbe sorprendente o difficile da dedurre.
- Se la selezione non è un'espressione riconoscibile (solo parole casuali), rispondi con: {"lemma": null, "pos": null, "meaning": null, "note": null}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    const token = auth?.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userErr } = await authClient.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const user = userData.user;

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: prof } = await supabase
      .from("profiles").select("gemini_api_key").eq("user_id", user.id).maybeSingle();
    const apiKey = (prof?.gemini_api_key as string | null) || Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "Nessuna chiave Gemini." }, 400);

    const body = await req.json();
    const phrase: string = (body.phrase ?? "").trim();
    const context: string = (body.context ?? "").trim();
    if (!phrase || phrase.length < 2) return json({ error: "Frase troppo corta" }, 400);
    if (phrase.split(/\s+/).length < 2) return json({ error: "Seleziona almeno due parole" }, 400);

    const userPrompt = `ESPRESSIONE: «${phrase}»\nCONTESTO: «${context}»`;

    const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash"];
    let lastResp: Response | null = null;

    for (let i = 0; i < models.length; i++) {
      if (i > 0) {
        const base = Math.min(1000 * 2 ** (i - 1), 5000);
        await new Promise((r) => setTimeout(r, base + Math.floor(Math.random() * 300)));
      }
      let resp: Response;
      try {
        resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${models[i]}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: SYSTEM }] },
              contents: [{ role: "user", parts: [{ text: userPrompt }] }],
              generationConfig: { temperature: 0.3, responseMimeType: "application/json" },
            }),
          },
        );
      } catch (_e) {
        continue;
      }
      if (resp.ok) { lastResp = resp; break; }
      lastResp = resp;
      if (resp.status !== 503 && resp.status !== 429) break;
    }

    if (!lastResp || !lastResp.ok) {
      const status = lastResp?.status ?? 500;
      return json({ error: `Errore Gemini (${status})` }, status === 503 ? 503 : 500);
    }

    const gemData = await lastResp.json();
    const text = gemData?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";

    let result: { lemma: string | null; pos: string | null; meaning: string | null; note: string | null };
    try {
      result = JSON.parse(text);
    } catch {
      const a = text.indexOf("{");
      const b = text.lastIndexOf("}");
      if (a < 0 || b < 0) return json({ error: "Risposta non valida" }, 500);
      result = JSON.parse(text.slice(a, b + 1));
    }

    if (!result.lemma) {
      return json({ error: "Non sembra un'espressione riconoscibile. Prova a selezionare un'espressione diversa." }, 422);
    }

    return json({
      lemma: result.lemma,
      pos: result.pos ?? "locuzione",
      meaning: result.meaning,
      note: result.note,
      original_phrase: phrase,
    });
  } catch (e) {
    console.error("explain-phrase error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
