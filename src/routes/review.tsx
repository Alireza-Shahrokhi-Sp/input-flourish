import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import * as React from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { nextSrs, type Quality } from "@/lib/srs";
import { toast } from "sonner";

export const Route = createFileRoute("/review")({
  component: ReviewPage,
  head: () => ({ meta: [{ title: "Ripasso — Letture" }] }),
});

type Card = {
  id: string;
  lemma: string;
  pos: string | null;
  translation: string | null;
  notes: string | null;
  srs: {
    interval_days: number;
    ease: number;
    reps: number;
    lapses: number;
    due_at: string;
    last_reviewed_at: string | null;
  } | null;
};

function ReviewPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [queue, setQueue] = React.useState<Card[] | null>(null);
  const [idx, setIdx] = React.useState(0);
  const [revealed, setRevealed] = React.useState(false);

  React.useEffect(() => {
    if (!loading && !user) nav({ to: "/auth" });
  }, [user, loading, nav]);

  React.useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: vocab } = await supabase
        .from("vocab_items")
        .select("id,lemma,pos,translation,notes")
        .eq("user_id", user.id);
      const { data: srs } = await supabase
        .from("srs_reviews")
        .select("vocab_id,interval_days,ease,reps,lapses,due_at,last_reviewed_at")
        .eq("user_id", user.id);
      const srsMap = new Map(srs?.map((r) => [r.vocab_id, r]) ?? []);
      const now = Date.now();
      const due = (vocab ?? [])
        .map((v) => ({ ...v, srs: srsMap.get(v.id) ?? null }))
        .filter((c) => !c.srs || new Date(c.srs.due_at).getTime() <= now)
        .sort(() => Math.random() - 0.5)
        .slice(0, 30);
      setQueue(due as Card[]);
    })();
  }, [user]);

  const grade = async (q: Quality) => {
    if (!queue || !user) return;
    const card = queue[idx];
    const next = nextSrs(card.srs, q);
    const payload = { user_id: user.id, vocab_id: card.id, ...next };
    const { error } = await supabase
      .from("srs_reviews")
      .upsert(payload, { onConflict: "vocab_id" });
    if (error) toast.error(error.message);
    setRevealed(false);
    setIdx(idx + 1);
  };

  if (queue === null) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <p className="mx-auto max-w-2xl px-4 py-10 text-muted-foreground">Caricamento…</p>
      </div>
    );
  }

  if (queue.length === 0 || idx >= queue.length) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="mx-auto max-w-md px-4 py-20 text-center">
          <h1 className="font-display text-4xl">
            {queue.length === 0 ? "Niente da ripassare" : "Bravo!"}
          </h1>
          <p className="mt-3 text-muted-foreground">
            {queue.length === 0
              ? "Torna più tardi o aggiungi nuove parole leggendo."
              : `Hai ripassato ${queue.length} carte. Alla prossima.`}
          </p>
          <div className="mt-6 flex gap-2 justify-center">
            <Link to="/vocab"><Button variant="outline">Vocabolario</Button></Link>
            <Link to="/generate"><Button>Nuova storia</Button></Link>
          </div>
        </main>
      </div>
    );
  }

  const card = queue[idx];

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-md px-4 py-12">
        <p className="text-sm text-muted-foreground text-center">
          {idx + 1} / {queue.length}
        </p>
        <div
          className="mt-4 rounded-xl border border-border bg-card p-10 text-center min-h-[220px] flex flex-col items-center justify-center cursor-pointer"
          onClick={() => setRevealed(true)}
        >
          <p className="font-display text-5xl">{card.lemma}</p>
          <div className="mt-2 flex items-center gap-2 justify-center">
            {card.pos && <span className="text-xs uppercase text-muted-foreground">{card.pos}</span>}
            {card.lemma.includes(" ") && (
              <span className="text-[10px] font-medium rounded-full bg-primary/10 text-primary px-1.5 py-0.5">espressione</span>
            )}
          </div>
          {revealed ? (
            <div className="mt-6">
              <p className="text-lg">{card.translation ?? "—"}</p>
              {card.notes && <p className="mt-2 text-sm text-muted-foreground italic">{card.notes}</p>}
            </div>
          ) : (
            <p className="mt-6 text-sm text-muted-foreground">Tocca per rivelare</p>
          )}
        </div>

        {revealed ? (
          <div className="mt-6 grid grid-cols-4 gap-2">
            <Button variant="destructive" onClick={() => grade(0)}>Di nuovo</Button>
            <Button variant="outline" onClick={() => grade(1)}>Difficile</Button>
            <Button onClick={() => grade(2)}>Bene</Button>
            <Button variant="secondary" onClick={() => grade(3)}>Facile</Button>
          </div>
        ) : (
          <Button className="mt-6 w-full" onClick={() => setRevealed(true)}>Rivela</Button>
        )}
      </main>
    </div>
  );
}
