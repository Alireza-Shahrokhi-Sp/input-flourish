import * as React from "react";
import { Button } from "@/components/ui/button";
import { BookOpen, Loader2, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lemmaLevel } from "@/lib/cefr";
import { toast } from "sonner";

type Props = {
  containerRef: React.RefObject<HTMLElement | null>;
  storyId: string;
  storyLevel: string;
  storyThemeTag: string | null;
  savedLemmas: Set<string>;
  onSaved: (lemma: string) => void;
};

type PopoverState = {
  phrase: string;
  context: string;
  x: number;
  y: number;
} | null;

type AnalysisResult = {
  lemma: string;
  pos: string;
  meaning: string | null;
  note: string | null;
};

export function PhraseSelectionPopover({
  containerRef,
  storyId,
  storyLevel,
  storyThemeTag,
  savedLemmas,
  onSaved,
}: Props) {
  const [popover, setPopover] = React.useState<PopoverState>(null);
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<AnalysisResult | null>(null);
  const [saved, setSaved] = React.useState(false);
  const popoverRef = React.useRef<HTMLDivElement>(null);

  const reset = React.useCallback(() => {
    setPopover(null);
    setResult(null);
    setLoading(false);
    setSaved(false);
  }, []);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = (e: MouseEvent) => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;

      const range = sel.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) return;

      const text = sel.toString().trim();
      if (!text || text.split(/\s+/).length < 2) return;

      const context = extractSentenceContext(range, container);
      const rect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      setPopover({
        phrase: text,
        context,
        x: rect.left + rect.width / 2 - containerRect.left,
        y: rect.top - containerRect.top,
      });
      setResult(null);
      setLoading(false);
      setSaved(false);
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      reset();
    };

    container.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      container.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [containerRef, reset]);

  const analyze = async () => {
    if (!popover) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("explain-phrase", {
        body: { phrase: popover.phrase, context: popover.context },
      });
      if (error) throw error;
      if (data?.error) {
        toast.error(data.error);
        setLoading(false);
        return;
      }
      setResult({
        lemma: data.lemma,
        pos: data.pos,
        meaning: data.meaning,
        note: data.note,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore nell'analisi");
    } finally {
      setLoading(false);
    }
  };

  const savePhrase = async () => {
    if (!result) return;
    const lemma = result.lemma.toLowerCase();
    if (savedLemmas.has(lemma)) {
      toast("Espressione già salvata");
      setSaved(true);
      return;
    }
    const { error } = await supabase.from("vocab_items").insert({
      user_id: (await supabase.auth.getUser()).data.user!.id,
      lemma,
      pos: result.pos,
      translation: result.meaning,
      notes: result.note,
      first_story_id: storyId,
      first_seen_sentence: popover?.context ?? null,
      cefr_level: lemmaLevel(lemma) ?? storyLevel,
      theme_tag: storyThemeTag ?? null,
    });
    if (error) {
      if (error.message.includes("duplicate")) {
        toast("Espressione già salvata");
      } else {
        toast.error(error.message);
        return;
      }
    } else {
      toast.success(`Salvato: ${result.lemma}`);
    }
    onSaved(lemma);
    setSaved(true);
  };

  if (!popover) return null;

  const alreadySaved = result && savedLemmas.has(result.lemma.toLowerCase());

  return (
    <div
      ref={popoverRef}
      className="phrase-popover"
      style={{
        left: `${popover.x}px`,
        top: `${popover.y}px`,
      }}
    >
      {!result && !loading && (
        <Button size="sm" className="gap-1.5 shadow-lg" onClick={analyze}>
          <BookOpen className="h-3.5 w-3.5" />
          Analizza espressione
        </Button>
      )}

      {loading && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 shadow-lg">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Analizzo…</span>
        </div>
      )}

      {result && (
        <div className="w-72 rounded-xl border border-border bg-card p-4 shadow-lg space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-xl">{result.lemma}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {result.pos}
            </span>
          </div>
          {result.meaning && <p className="text-sm">{result.meaning}</p>}
          {result.note && <p className="text-xs text-muted-foreground italic">{result.note}</p>}
          <Button
            size="sm"
            variant={saved || alreadySaved ? "secondary" : "default"}
            className="w-full gap-1 mt-2"
            onClick={savePhrase}
            disabled={saved || !!alreadySaved}
          >
            {saved || alreadySaved ? (
              <>
                <Check className="h-3 w-3" /> Salvato
              </>
            ) : (
              <>
                <BookOpen className="h-3 w-3" /> Salva nel vocabolario
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function extractSentenceContext(range: Range, container: HTMLElement): string {
  const fullText = container.textContent ?? "";
  const rangeText = range.toString();
  const idx = fullText.indexOf(rangeText);
  if (idx < 0) return rangeText;

  let start = idx;
  while (start > 0 && !/[.!?…\n]/.test(fullText[start - 1])) start--;

  let end = idx + rangeText.length;
  while (end < fullText.length && !/[.!?…\n]/.test(fullText[end])) end++;
  if (end < fullText.length) end++;

  return fullText.slice(start, end).trim();
}
