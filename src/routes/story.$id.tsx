import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import * as React from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Plus, Check, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { lemmaLevel } from "@/lib/cefr";
import { segmentSentences } from "@/lib/speech";
import { ShadowingBar } from "@/components/ShadowingBar";

export const Route = createFileRoute("/story/$id")({
  component: StoryPage,
  head: () => ({ meta: [{ title: "Storia — Letture" }] }),
});

type Token = {
  i: number;
  surface: string;
  lemma?: string;
  pos?: string;
  translation?: string;
  note?: string;
};
type GrammarEntry = {
  name: string;
  explanation: string;
  example_sentence?: string;
  extra_examples?: string[];
  complexity: "simple" | "complex";
  is_stretch?: boolean;
  token_indices?: number[];
};
type Story = {
  id: string;
  title: string;
  level: string;
  mode: string;
  stretch_level: string | null;
  format: string;
  body: string;
  summary: string | null;
  parent_story_id: string | null;
  target_word_ids: string[] | null;
  theme_tag: string | null;
};
type ExpressionEntry = {
  token_indices: number[];
  lemma: string;
  pos: string;
  meaning: string | null;
  note: string | null;
};
type Annotations = { tokens: Token[]; grammar: GrammarEntry[]; expressions: ExpressionEntry[] };

function StoryPage() {
  const { id } = Route.useParams();
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [story, setStory] = React.useState<Story | null>(null);
  const [ann, setAnn] = React.useState<Annotations | null>(null);
  const [savedLemmas, setSavedLemmas] = React.useState<Set<string>>(new Set());
  const [targetLemmas, setTargetLemmas] = React.useState<Set<string>>(new Set());
  const [targetIdByLemma, setTargetIdByLemma] = React.useState<Map<string, string>>(new Map());
  const [continuing, setContinuing] = React.useState(false);
  const [activeSentence, setActiveSentence] = React.useState<number | null>(null);
  const sentences = React.useMemo(
    () => (story ? segmentSentences(story.body) : []),
    [story],
  );

  React.useEffect(() => {
    if (!loading && !user) nav({ to: "/auth" });
  }, [user, loading, nav]);

  React.useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: s }, { data: a }] = await Promise.all([
        supabase.from("stories").select("*").eq("id", id).maybeSingle(),
        supabase.from("story_annotations").select("tokens,grammar,expressions").eq("story_id", id).maybeSingle(),
      ]);
      setStory(s as Story | null);
      setAnn((a as Annotations | null) ?? { tokens: [], grammar: [], expressions: [] });
      const { data: vocab } = await supabase
        .from("vocab_items")
        .select("id,lemma")
        .eq("user_id", user.id);
      setSavedLemmas(new Set((vocab ?? []).map((v: { lemma: string }) => v.lemma)));

      const targetIds = (s as Story | null)?.target_word_ids ?? [];
      if (targetIds && targetIds.length) {
        const map = new Map<string, string>();
        const lemmas = new Set<string>();
        for (const v of (vocab ?? []) as { id: string; lemma: string }[]) {
          if (targetIds.includes(v.id)) {
            map.set(v.lemma.toLowerCase(), v.id);
            lemmas.add(v.lemma.toLowerCase());
          }
        }
        setTargetIdByLemma(map);
        setTargetLemmas(lemmas);
      }
    })();
  }, [id, user]);

  // Build grammar group lookup. Each complex/stretch entry = one occurrence.
  // Contiguous tokens of the same entry render as a single underlined segment;
  // non-contiguous tokens (e.g. separated clitic + verb) each get their own segment
  // but share the same group color/popover so the user knows they belong together.
  type GroupInfo = { g: GrammarEntry; gid: number; pos: "start" | "middle" | "end" | "only" };
  const groupByToken = React.useMemo(() => {
    const m = new Map<number, GroupInfo>();
    if (!ann) return m;
    ann.grammar.forEach((g, gid) => {
      if (g.complexity !== "complex" && !g.is_stretch) return;
      const idxs = [...(g.token_indices ?? [])].sort((a, b) => a - b);
      if (!idxs.length) return;
      const runs: number[][] = [];
      let cur: number[] = [idxs[0]];
      for (let k = 1; k < idxs.length; k++) {
        if (idxs[k] === idxs[k - 1] + 1) cur.push(idxs[k]);
        else { runs.push(cur); cur = [idxs[k]]; }
      }
      runs.push(cur);
      for (const run of runs) {
        for (let k = 0; k < run.length; k++) {
          const pos: GroupInfo["pos"] =
            run.length === 1 ? "only" : k === 0 ? "start" : k === run.length - 1 ? "end" : "middle";
          m.set(run[k], { g, gid, pos });
        }
      }
    });
    return m;
  }, [ann]);

  type ExprInfo = { expr: ExpressionEntry; pos: "start" | "middle" | "end" | "only" };
  const exprByToken = React.useMemo(() => {
    const m = new Map<number, ExprInfo>();
    if (!ann) return m;
    for (const expr of ann.expressions ?? []) {
      const idxs = [...(expr.token_indices ?? [])].sort((a, b) => a - b);
      if (!idxs.length) continue;
      for (let k = 0; k < idxs.length; k++) {
        const pos: ExprInfo["pos"] =
          idxs.length === 1 ? "only" : k === 0 ? "start" : k === idxs.length - 1 ? "end" : "middle";
        m.set(idxs[k], { expr, pos });
      }
    }
    return m;
  }, [ann]);

  React.useEffect(() => {
    if (activeSentence == null) return;
    const el = document.querySelector(".sentence-active");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeSentence]);

  const saveExpression = async (expr: ExpressionEntry) => {
    if (!user || !story) return;
    const lemma = expr.lemma.toLowerCase();
    if (savedLemmas.has(lemma)) {
      toast("Espressione già salvata");
      return;
    }
    const { error } = await supabase.from("vocab_items").insert({
      user_id: user.id,
      lemma,
      pos: expr.pos,
      translation: expr.meaning,
      notes: expr.note,
      first_story_id: id,
      cefr_level: lemmaLevel(lemma) ?? story.level ?? null,
      theme_tag: story.theme_tag ?? null,
    });
    if (error) {
      if (!error.message.includes("duplicate")) {
        toast.error(error.message);
        return;
      }
    }
    setSavedLemmas(new Set([...savedLemmas, lemma]));
    toast.success(`Salvato: ${expr.lemma}`);
  };

  const bumpEaseHarder = async (vocabId?: string) => {
    if (!user || !vocabId) return;
    const { data: existing } = await supabase
      .from("srs_reviews")
      .select("id,ease,interval_days,reps,lapses,due_at")
      .eq("vocab_id", vocabId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (existing) {
      const newEase = Math.max(1.3, Number(existing.ease ?? 2.5) - 0.15);
      await supabase.from("srs_reviews").update({ ease: newEase }).eq("id", existing.id);
    } else {
      await supabase.from("srs_reviews").insert({
        user_id: user.id,
        vocab_id: vocabId,
        ease: 2.35,
        interval_days: 0,
        reps: 0,
        lapses: 0,
        due_at: new Date().toISOString(),
      });
    }
  };

  const saveVocab = async (tok: Token) => {
    if (!user || !tok.lemma) return;
    const lemma = tok.lemma.toLowerCase();
    if (savedLemmas.has(lemma)) return;
    const { error } = await supabase.from("vocab_items").insert({
      user_id: user.id,
      lemma,
      pos: tok.pos,
      translation: tok.translation,
      first_story_id: id,
      first_seen_sentence: tok.surface,
      cefr_level: lemmaLevel(lemma) ?? story?.level ?? null,
      theme_tag: story?.theme_tag ?? null,
    });
    if (error) {
      if (!error.message.includes("duplicate")) {
        toast.error(error.message);
        return;
      }
    }
    setSavedLemmas(new Set([...savedLemmas, lemma]));
    toast.success(`Salvato: ${lemma}`);
  };

  if (!story || !ann) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <p className="mx-auto max-w-2xl px-4 py-10 text-muted-foreground">Caricamento…</p>
      </div>
    );
  }

  // If we have tokens, render token-by-token; otherwise fall back to plain body
  const tokenized = ann.tokens.length > 0;
  const stretchGrammar = ann.grammar.filter((g) => g.is_stretch);
  const otherGrammar = ann.grammar.filter((g) => !g.is_stretch);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {story.level}{story.mode === "stretch" ? "+" : ""} · {story.format.replace("_", " ")}
            </p>
            <h1 className="font-display text-4xl mt-1">{story.title}</h1>
          </div>
        </div>

        <ShadowingBar sentences={sentences} onActiveSentence={setActiveSentence} />

        <article className="mt-8 font-body text-lg leading-relaxed text-ink">
          {tokenized ? (
            renderParagraphs(ann.tokens, groupByToken, exprByToken, targetLemmas, targetIdByLemma, savedLemmas, saveVocab, saveExpression, bumpEaseHarder, activeSentence, sentences)
          ) : (
            renderPlainParagraphs(story.body, activeSentence, sentences)
          )}
        </article>

        {/* Expressions section */}
        {(ann.expressions ?? []).length > 0 && (
          <section className="mt-10 rounded-xl border border-primary/20 bg-primary/5 p-5">
            <h2 className="font-display text-2xl flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" /> Espressioni utili
            </h2>
            <div className="mt-4 space-y-3">
              {(ann.expressions ?? []).map((expr, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-display text-lg">{expr.lemma}</span>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{expr.pos}</span>
                    </div>
                    {expr.meaning && <p className="text-sm">{expr.meaning}</p>}
                    {expr.note && <p className="text-xs text-muted-foreground italic mt-0.5">{expr.note}</p>}
                  </div>
                  <Button
                    size="sm"
                    variant={savedLemmas.has(expr.lemma.toLowerCase()) ? "secondary" : "default"}
                    className="gap-1 shrink-0"
                    onClick={() => saveExpression(expr)}
                    disabled={savedLemmas.has(expr.lemma.toLowerCase())}
                  >
                    {savedLemmas.has(expr.lemma.toLowerCase()) ? (
                      <><Check className="h-3 w-3" /> Salvato</>
                    ) : (
                      <><Plus className="h-3 w-3" /> Salva</>
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Grammar section */}
        {ann.grammar.length > 0 && (
          <section className="mt-12 border-t border-border pt-8">
            <h2 className="font-display text-3xl">Grammatica di questa storia</h2>

            {stretchGrammar.length > 0 && (
              <div className="mt-6">
                <h3 className="font-display text-xl text-stretch">
                  Elementi di sfida ({story.stretch_level ?? "+"})
                </h3>
                <div className="mt-3 space-y-4">
                  {stretchGrammar.map((g, i) => <GrammarCard key={`s${i}`} g={g} stretch />)}
                </div>
              </div>
            )}

            {otherGrammar.length > 0 && (
              <div className="mt-8 space-y-4">
                {otherGrammar.map((g, i) => <GrammarCard key={`o${i}`} g={g} />)}
              </div>
            )}
          </section>
        )}

        <div className="mt-12 flex flex-wrap gap-3 justify-between">
          <Link to="/library"><Button variant="ghost">← Biblioteca</Button></Link>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={continuing}
              onClick={async () => {
                setContinuing(true);
                try {
                  const { data, error } = await supabase.functions.invoke("continue-story", {
                    body: { previous_story_id: id },
                  });
                  if (error) throw error;
                  if (!data?.story_id) throw new Error("Errore");
                  toast.success("Capitolo pronto!");
                  nav({ to: "/story/$id", params: { id: data.story_id } });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Errore");
                } finally {
                  setContinuing(false);
                }
              }}
            >
              {continuing ? "Generando…" : "Continua il capitolo →"}
            </Button>
            <Link to="/generate"><Button>Un'altra storia →</Button></Link>
          </div>
        </div>
      </main>
    </div>
  );
}

function GrammarCard({ g, stretch }: { g: GrammarEntry; stretch?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${stretch ? "border-stretch/40 bg-stretch/5" : "border-border bg-card"}`}>
      <h4 className="font-display text-xl">{g.name}</h4>
      <p className="mt-1 text-sm">{g.explanation}</p>
      {g.example_sentence && (
        <p className="mt-2 text-sm italic text-muted-foreground">«{g.example_sentence}»</p>
      )}
      {g.extra_examples && g.extra_examples.length > 0 && (
        <ul className="mt-2 text-sm list-disc pl-5 space-y-1 text-muted-foreground">
          {g.extra_examples.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
    </div>
  );
}

type GroupInfoLite = { g: GrammarEntry; gid: number; pos: "start" | "middle" | "end" | "only" };
type ExprInfoLite = { expr: ExpressionEntry; pos: "start" | "middle" | "end" | "only" };

function renderPlainParagraphs(
  body: string,
  activeSentence: number | null,
  sentences: { text: string; start: number; end: number }[],
) {
  const activeTxt = activeSentence != null ? sentences[activeSentence]?.text : null;
  const paras = splitParagraphs(body);
  return (
    <div className="space-y-4">
      {paras.map((p, i) => {
        const isActive = activeTxt != null && p.text.includes(activeTxt);
        return (
          <p
            key={i}
            className={[
              p.kind === "dialogue" ? `dialogue-line speaker-${p.speaker} whitespace-pre-wrap` : "whitespace-pre-wrap",
              isActive ? "sentence-active" : "",
            ].join(" ")}
          >
            {p.text}
          </p>
        );
      })}
    </div>
  );
}

function renderParagraphs(
  tokens: Token[],
  groupByToken: Map<number, GroupInfoLite>,
  exprByToken: Map<number, ExprInfoLite>,
  targetLemmas: Set<string>,
  targetIdByLemma: Map<string, string>,
  savedLemmas: Set<string>,
  saveVocab: (t: Token) => void,
  saveExpression: (e: ExpressionEntry) => void,
  bumpEaseHarder: (id?: string) => void,
  activeSentence: number | null,
  sentences: { text: string; start: number; end: number }[],
) {
  // Group tokens into paragraphs by newline tokens.
  const paragraphs: Token[][] = [];
  let cur: Token[] = [];
  for (const t of tokens) {
    if (t.surface.includes("\n")) {
      const parts = t.surface.split("\n");
      // text before first newline
      if (parts[0]) cur.push({ ...t, surface: parts[0] });
      paragraphs.push(cur);
      cur = [];
      for (let i = 1; i < parts.length - 1; i++) {
        if (parts[i]) paragraphs.push([{ ...t, surface: parts[i] }]);
        else paragraphs.push([]);
      }
      const tail = parts[parts.length - 1];
      if (tail) cur.push({ ...t, surface: tail });
    } else {
      cur.push(t);
    }
  }
  if (cur.length) paragraphs.push(cur);

  const activeTxt = activeSentence != null ? sentences[activeSentence]?.text : null;

  let speakerIdx = 0;
  let lastWasDialogue = false;
  return (
    <div className="space-y-4">
      {paragraphs
        .filter((p) => p.some((t) => t.surface.trim().length > 0))
        .map((paraTokens, pIdx) => {
          const firstWord = paraTokens.find((t) => t.surface.trim().length > 0)?.surface.trim() ?? "";
          const isDialogue = /^[—–\-"«„"]/.test(firstWord);
          let speaker = 0;
          if (isDialogue) {
            if (!lastWasDialogue) speakerIdx = 0;
            speaker = speakerIdx % 3;
            speakerIdx++;
            lastWasDialogue = true;
          } else {
            lastWasDialogue = false;
          }
          const paraText = paraTokens.map((t) => t.surface).join("");
          const isActivePara = activeTxt != null && paraText.includes(activeTxt);
          return (
            <p
              key={pIdx}
              className={[
                isDialogue ? `dialogue-line speaker-${speaker}` : "",
                isActivePara ? "sentence-active" : "",
              ].join(" ")}
            >
              {paraTokens.map((t, k) => {
                const gi = groupByToken.get(t.i);
                const ei = exprByToken.get(t.i);
                const isWord = /\p{L}/u.test(t.surface);
                if (!isWord) return <span key={`${pIdx}-${k}`}>{t.surface}</span>;
                const lemmaKey = (t.lemma ?? t.surface).toLowerCase();
                const isTarget = targetLemmas.has(lemmaKey);
                const grammarClass = gi
                  ? `grammar-mark grammar-${gi.pos} ${gi.g.is_stretch ? "stretch" : ""}`
                  : "";
                const exprClass = ei
                  ? `expr-mark expr-${ei.pos}`
                  : "";
                return (
                  <Popover
                    key={`${pIdx}-${k}`}
                    onOpenChange={(open) => {
                      if (open && isTarget) bumpEaseHarder(targetIdByLemma.get(lemmaKey));
                    }}
                  >
                    <PopoverTrigger asChild>
                      <span
                        className={`word-tok ${isTarget ? "target-word" : ""} ${grammarClass} ${exprClass}`}
                      >
                        {t.surface}
                      </span>
                    </PopoverTrigger>
                    <PopoverContent className="w-72">
                      <div className="space-y-2">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-display text-xl">{t.lemma ?? t.surface}</span>
                          {t.pos && (
                            <span className="text-xs text-muted-foreground uppercase">{t.pos}</span>
                          )}
                        </div>
                        {t.translation && <p className="text-sm">{t.translation}</p>}
                        {t.note && <p className="text-xs text-muted-foreground italic">{t.note}</p>}
                        <a
                          href={`https://www.wordreference.com/iten/${encodeURIComponent((t.lemma ?? t.surface).toLowerCase())}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs underline hover:opacity-80"
                        >
                          Definizione & coniugazione su WordReference ↗
                        </a>
                        {gi && (
                          <div className={`mt-2 rounded-md p-2 text-xs ${gi.g.is_stretch ? "bg-stretch/10 border border-stretch/30" : "bg-muted"}`}>
                            <p className="font-semibold">{gi.g.name}</p>
                            <p className="mt-1">{gi.g.explanation}</p>
                            {gi.g.token_indices && gi.g.token_indices.length > 1 && (
                              <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                Struttura di {gi.g.token_indices.length} parole — sottolineata insieme
                              </p>
                            )}
                          </div>
                        )}
                        {ei && (
                          <div className="mt-2 rounded-md p-2 text-xs bg-primary/10 border border-primary/30">
                            <div className="flex items-baseline gap-1">
                              <BookOpen className="h-3 w-3 text-primary shrink-0" />
                              <p className="font-semibold">{ei.expr.lemma}</p>
                              <span className="text-[9px] uppercase text-muted-foreground ml-auto">{ei.expr.pos}</span>
                            </div>
                            {ei.expr.meaning && <p className="mt-1">{ei.expr.meaning}</p>}
                            {ei.expr.note && <p className="mt-1 italic text-muted-foreground">{ei.expr.note}</p>}
                            <Button
                              size="sm"
                              variant={savedLemmas.has(ei.expr.lemma.toLowerCase()) ? "secondary" : "default"}
                              className="w-full gap-1 mt-2"
                              onClick={(e) => { e.stopPropagation(); saveExpression(ei.expr); }}
                              disabled={savedLemmas.has(ei.expr.lemma.toLowerCase())}
                            >
                              {savedLemmas.has(ei.expr.lemma.toLowerCase()) ? (
                                <><Check className="h-3 w-3" /> Salvato</>
                              ) : (
                                <><BookOpen className="h-3 w-3" /> Salva espressione</>
                              )}
                            </Button>
                          </div>
                        )}
                        {t.lemma && (
                          <Button
                            size="sm"
                            variant={savedLemmas.has(t.lemma.toLowerCase()) ? "secondary" : "default"}
                            className="w-full gap-1 mt-2"
                            onClick={() => saveVocab(t)}
                            disabled={savedLemmas.has(t.lemma.toLowerCase())}
                          >
                            {savedLemmas.has(t.lemma.toLowerCase()) ? (
                              <><Check className="h-3 w-3" /> Salvato</>
                            ) : (
                              <><Plus className="h-3 w-3" /> Salva nel vocabolario</>
                            )}
                          </Button>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                );
              })}
            </p>
          );
        })}
    </div>
  );
}

function splitParagraphs(body: string) {
  const lines = body.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  let speakerIdx = 0;
  let lastWasDialogue = false;
  return lines.map((text) => {
    const isDialogue = /^[—–\-"«„"]/.test(text);
    let speaker = 0;
    if (isDialogue) {
      if (!lastWasDialogue) speakerIdx = 0;
      speaker = speakerIdx % 3;
      speakerIdx++;
      lastWasDialogue = true;
    } else {
      lastWasDialogue = false;
    }
    return { kind: isDialogue ? ("dialogue" as const) : ("narration" as const), speaker, text };
  });
}
