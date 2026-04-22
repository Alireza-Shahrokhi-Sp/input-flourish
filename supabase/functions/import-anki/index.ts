// Import an Anki-exported CSV/TSV of cards into vocab_items + srs_reviews.
// - Flexible column detection (front/back/lemma/translation, interval, ease/factor, reps, lapses, tags).
// - Anki "Mature" (interval >= 21d) -> status='mastering', else 'learning'.
// - Anki ease is permille (2500 = 2.5). Clamped to >= 1.3.
// - Duplicates by (user_id, lower(lemma)) are REPLACED with Anki's data.
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

// --- Tiny CSV/TSV parser (handles quotes, escaped quotes, newlines in quotes) ---
function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const counts: Record<string, number> = { ",": 0, "\t": 0, ";": 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]) || ",";
}

function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === delim) { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c === "\r") { /* skip */ }
      else cur += c;
    }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.length > 0 && r.some((v) => v.trim().length > 0));
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

function pickIndex(headers: string[], names: string[]): number {
  const norm = headers.map((h) => h.toLowerCase().trim());
  for (const n of names) {
    const i = norm.indexOf(n);
    if (i !== -1) return i;
  }
  return -1;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    const token = auth?.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userErr } = await authClient.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const user = userData.user;

    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const csvText: string = body.csv ?? "";
    const hasHeaderHint: boolean | undefined = body.has_header;
    if (!csvText || csvText.length < 3) return json({ error: "CSV vuoto" }, 400);

    // Strip Anki export comment lines starting with '#'
    const cleaned = csvText.split(/\r?\n/).filter((l) => !l.startsWith("#")).join("\n");
    const delim = detectDelimiter(cleaned);
    const rows = parseDelimited(cleaned, delim);
    if (rows.length === 0) return json({ error: "Nessuna riga trovata" }, 400);

    // Detect header row: contains any of the known column names.
    const KNOWN = ["front", "back", "lemma", "word", "translation", "meaning", "interval", "ivl", "ease", "factor", "easefactor", "reps", "lapses", "tags", "pos", "notes", "level", "cefr", "theme", "tag"];
    let headers: string[];
    let dataRows: string[][];
    const firstLower = rows[0].map((h) => h.toLowerCase().trim());
    const looksHeader = hasHeaderHint ?? firstLower.some((h) => KNOWN.includes(h));
    if (looksHeader) {
      headers = rows[0].map((h) => h.trim());
      dataRows = rows.slice(1);
    } else {
      // Anki default export (no header): commonly Front, Back, Tags
      const ncols = rows[0].length;
      headers = Array.from({ length: ncols }, (_, i) =>
        i === 0 ? "front" : i === 1 ? "back" : i === ncols - 1 ? "tags" : `col${i}`,
      );
      dataRows = rows;
    }

    const iLemma = (() => {
      const i = pickIndex(headers, ["lemma", "word", "front", "term"]);
      return i === -1 ? 0 : i;
    })();
    const iTrans = (() => {
      const i = pickIndex(headers, ["translation", "meaning", "back", "definition"]);
      return i === -1 && headers.length > 1 ? 1 : i;
    })();
    const iIvl = pickIndex(headers, ["interval", "ivl", "interval_days"]);
    const iEase = pickIndex(headers, ["ease", "factor", "easefactor", "ease_factor"]);
    const iReps = pickIndex(headers, ["reps", "repetitions"]);
    const iLapses = pickIndex(headers, ["lapses"]);
    const iTags = pickIndex(headers, ["tags", "tag", "theme", "theme_tag"]);
    const iPos = pickIndex(headers, ["pos", "part_of_speech"]);
    const iNotes = pickIndex(headers, ["notes", "note"]);
    const iLevel = pickIndex(headers, ["level", "cefr", "cefr_level"]);

    type Parsed = {
      lemma: string;
      translation: string | null;
      pos: string | null;
      notes: string | null;
      cefr_level: string | null;
      theme_tag: string | null;
      interval_days: number;
      ease: number;
      reps: number;
      lapses: number;
      status: "learning" | "mastering";
      due_at: string;
    };

    const now = Date.now();
    const parsed: Parsed[] = [];
    const seen = new Set<string>();
    let skipped = 0;

    for (const r of dataRows) {
      const rawLemma = stripHtml(r[iLemma] ?? "");
      if (!rawLemma) { skipped++; continue; }
      const lemma = rawLemma.toLowerCase();
      if (seen.has(lemma)) { skipped++; continue; }
      seen.add(lemma);

      const translation = iTrans !== -1 ? (stripHtml(r[iTrans] ?? "") || null) : null;
      const tagsRaw = iTags !== -1 ? (r[iTags] ?? "").trim() : "";
      const theme_tag = tagsRaw ? tagsRaw.split(/[\s,]+/)[0].toLowerCase() : null;

      const ivlDays = iIvl !== -1 ? Math.max(0, Math.round(Number(r[iIvl]) || 0)) : 0;
      let easeRaw = iEase !== -1 ? Number(r[iEase]) || 0 : 0;
      // Anki stores ease as permille (e.g. 2500). If value > 10, treat as permille.
      if (easeRaw > 10) easeRaw = easeRaw / 1000;
      const ease = easeRaw > 0 ? Math.max(1.3, Math.min(3.5, easeRaw)) : 2.5;
      const reps = iReps !== -1 ? Math.max(0, Math.round(Number(r[iReps]) || 0)) : 0;
      const lapses = iLapses !== -1 ? Math.max(0, Math.round(Number(r[iLapses]) || 0)) : 0;
      const status: "learning" | "mastering" = ivlDays >= 21 ? "mastering" : "learning";
      const due_at = new Date(now + ivlDays * 86_400_000).toISOString();

      parsed.push({
        lemma,
        translation,
        pos: iPos !== -1 ? (r[iPos]?.trim() || null) : null,
        notes: iNotes !== -1 ? (r[iNotes]?.trim() || null) : null,
        cefr_level: iLevel !== -1 ? (r[iLevel]?.trim().toUpperCase() || null) : null,
        theme_tag,
        interval_days: ivlDays,
        ease,
        reps,
        lapses,
        status,
        due_at,
      });
    }

    if (parsed.length === 0) return json({ error: "Nessuna parola valida nel CSV", skipped }, 400);

    // Fetch existing vocab for this user matching any of these lemmas
    const lemmas = parsed.map((p) => p.lemma);
    const { data: existing, error: exErr } = await supabase
      .from("vocab_items").select("id,lemma").eq("user_id", user.id).in("lemma", lemmas);
    if (exErr) return json({ error: exErr.message }, 500);
    const existingMap = new Map<string, string>();
    for (const r of existing ?? []) existingMap.set(r.lemma.toLowerCase(), r.id);

    let updated = 0;
    let inserted = 0;
    const ids: { lemma: string; id: string; srs: Parsed }[] = [];

    // Process in chunks to avoid statement size limits
    const CHUNK = 200;
    for (let i = 0; i < parsed.length; i += CHUNK) {
      const chunk = parsed.slice(i, i + CHUNK);
      const toUpdate = chunk.filter((p) => existingMap.has(p.lemma));
      const toInsert = chunk.filter((p) => !existingMap.has(p.lemma));

      // Replace duplicates: update vocab fields in place, keep id
      for (const p of toUpdate) {
        const id = existingMap.get(p.lemma)!;
        const { error } = await supabase.from("vocab_items").update({
          translation: p.translation,
          pos: p.pos,
          notes: p.notes,
          cefr_level: p.cefr_level,
          theme_tag: p.theme_tag,
          status: p.status,
        }).eq("id", id).eq("user_id", user.id);
        if (!error) { updated++; ids.push({ lemma: p.lemma, id, srs: p }); }
      }

      if (toInsert.length > 0) {
        const { data: ins, error } = await supabase.from("vocab_items").insert(
          toInsert.map((p) => ({
            user_id: user.id,
            lemma: p.lemma,
            translation: p.translation,
            pos: p.pos,
            notes: p.notes,
            cefr_level: p.cefr_level,
            theme_tag: p.theme_tag,
            status: p.status,
          })),
        ).select("id,lemma");
        if (error) return json({ error: error.message }, 500);
        for (const row of ins ?? []) {
          const p = toInsert.find((x) => x.lemma === row.lemma.toLowerCase());
          if (p) { inserted++; ids.push({ lemma: row.lemma, id: row.id, srs: p }); }
        }
      }
    }

    // Upsert SRS rows (vocab_id is unique)
    const srsRows = ids.map(({ id, srs }) => ({
      user_id: user.id,
      vocab_id: id,
      interval_days: srs.interval_days,
      ease: srs.ease,
      reps: srs.reps,
      lapses: srs.lapses,
      due_at: srs.due_at,
      last_reviewed_at: srs.reps > 0 ? new Date().toISOString() : null,
    }));

    let srsUpserted = 0;
    for (let i = 0; i < srsRows.length; i += CHUNK) {
      const chunk = srsRows.slice(i, i + CHUNK);
      const { error } = await supabase.from("srs_reviews").upsert(chunk, { onConflict: "vocab_id" });
      if (error) return json({ error: error.message }, 500);
      srsUpserted += chunk.length;
    }

    return json({
      ok: true,
      total_rows: dataRows.length,
      imported: ids.length,
      inserted,
      updated,
      skipped,
      srs_upserted: srsUpserted,
      mature: parsed.filter((p) => p.status === "mastering").length,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
