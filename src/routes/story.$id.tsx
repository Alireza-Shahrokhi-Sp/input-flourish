import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import * as React from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Play, Pause, Plus, Check } from "lucide-react";
import { toast } from "sonner";

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
type Annotations = { tokens: Token[]; grammar: GrammarEntry[] };

function StoryPage() {
  const { id } = Route.useParams();
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [story, setStory] = React.useState<Story | null>(null);
  const [ann, setAnn] = React.useState<Annotations | null>(null);
  const [savedLemmas, setSavedLemmas] = React.useState<Set<string>>(new Set());
  const [targetLemmas, setTargetLemmas] = React.useState<Set<string>>(new Set());
  const [targetIdByLemma, setTargetIdByLemma] = React.useState<Map<string, string>>(new Map());
  const [playing, setPlaying] = React.useState(false);
  const [continuing, setContinuing] = React.useState(false);

  React.useEffect(() => {
    if (!loading && !user) nav({ to: "/auth" });
  }, [user, loading, nav]);

  React.useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: s }, { data: a }] = await Promise.all([
        supabase.from("stories").select("*").eq("id", id).maybeSingle(),
        supabase.from("story_annotations").select("tokens,grammar").eq("story_id", id).maybeSingle(),
      ]);
      setStory(s as Story | null);
      setAnn((a as Annotations | null) ?? { tokens: [], grammar: [] });
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

  // Build grammar lookup by token index
  const grammarByToken = React.useMemo(() => {
    const m = new Map<number, GrammarEntry>();
    if (!ann) return m;
    for (const g of ann.grammar) {
      if (g.complexity !== "complex" && !g.is_stretch) continue;
      for (const idx of g.token_indices ?? []) m.set(idx, g);
    }
    return m;
  }, [ann]);

  const speak = () => {
    if (!story) return;
    if (playing) {
      window.speechSynthesis.cancel();
      setPlaying(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(story.body);
    u.lang = "it-IT";
    u.rate = 0.95;
    const voices = window.speechSynthesis.getVoices();
    const it = voices.find((v) => v.lang.startsWith("it"));
    if (it) u.voice = it;
    u.onend = () => setPlaying(false);
    u.onerror = () => setPlaying(false);
    window.speechSynthesis.speak(u);
    setPlaying(true);
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
          <Button variant="outline" size="sm" onClick={speak} className="gap-2">
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {playing ? "Pausa" : "Ascolta"}
          </Button>
        </div>

        <article className="mt-8 font-body text-lg leading-relaxed text-ink">
          {tokenized ? (
            <p className="whitespace-pre-wrap">
              {ann.tokens.map((t) => {
                const g = grammarByToken.get(t.i);
                const isWord = /\p{L}/u.test(t.surface);
                if (!isWord) return <span key={t.i}>{t.surface}</span>;
                const lemmaKey = (t.lemma ?? t.surface).toLowerCase();
                const isTarget = targetLemmas.has(lemmaKey);
                return (
                  <Popover key={t.i} onOpenChange={(open) => { if (open && isTarget) bumpEaseHarder(targetIdByLemma.get(lemmaKey)); }}>
                    <PopoverTrigger asChild>
                      <span
                        className={`word-tok ${isTarget ? "target-word" : ""} ${g ? `grammar-mark ${g.is_stretch ? "stretch" : ""}` : ""}`}
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
                        {t.translation && (
                          <p className="text-sm">{t.translation}</p>
                        )}
                        {t.note && (
                          <p className="text-xs text-muted-foreground italic">{t.note}</p>
                        )}
                        <a
                          href={`https://www.wordreference.com/iten/${encodeURIComponent((t.lemma ?? t.surface).toLowerCase())}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs underline text-terracotta hover:opacity-80"
                        >
                          Definizione & coniugazione su WordReference ↗
                        </a>
                        {g && (
                          <div className={`mt-2 rounded-md p-2 text-xs ${g.is_stretch ? "bg-stretch/10 border border-stretch/30" : "bg-muted"}`}>
                            <p className="font-semibold">{g.name}</p>
                            <p className="mt-1">{g.explanation}</p>
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
          ) : (
            <p className="whitespace-pre-wrap">{story.body}</p>
          )}
        </article>

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
