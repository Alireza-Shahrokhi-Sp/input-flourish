import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import * as React from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  computeStats,
  type Stats,
  type VocabLite,
  type SrsLite,
} from "@/lib/stats";
import { Flame, Brain, Sparkles } from "lucide-react";

export const Route = createFileRoute("/stats")({
  component: StatsPage,
  head: () => ({ meta: [{ title: "Statistiche — Letture" }] }),
});

function StatsPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [stats, setStats] = React.useState<Stats | null>(null);

  React.useEffect(() => {
    if (!loading && !user) nav({ to: "/auth" });
  }, [user, loading, nav]);

  React.useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: vocab } = await supabase
        .from("vocab_items")
        .select("id,status,cefr_level,theme_tag,created_at")
        .eq("user_id", user.id);
      const { data: srs } = await supabase
        .from("srs_reviews")
        .select(
          "vocab_id,interval_days,ease,reps,lapses,due_at,last_reviewed_at",
        )
        .eq("user_id", user.id);
      setStats(
        computeStats(
          (vocab ?? []) as VocabLite[],
          (srs ?? []) as SrsLite[],
        ),
      );
    })();
  }, [user]);

  if (!stats) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <p className="mx-auto max-w-3xl px-4 py-10 text-muted-foreground">
          Caricamento…
        </p>
      </div>
    );
  }

  const masteryPct = stats.total
    ? Math.round((stats.mature / stats.total) * 100)
    : 0;
  const maxDay = Math.max(1, ...stats.reviewsByDay.map((d) => d.count));

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-4xl">Statistiche</h1>
          <Link to="/review">
            <Button className="gap-2">
              <Brain className="h-4 w-4" /> Ripassa ({stats.due})
            </Button>
          </Link>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            icon={<Flame className="h-4 w-4 text-stretch" />}
            label="Streak"
            value={`${stats.streakDays}g`}
          />
          <StatCard label="Parole totali" value={String(stats.total)} />
          <StatCard label="Da ripassare" value={String(stats.due)} />
          <StatCard
            label="Ritenzione"
            value={stats.retention == null ? "—" : `${stats.retention}%`}
          />
        </div>

        <section className="mt-8 rounded-xl border border-border bg-card p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-2xl">Padronanza</h2>
            <span className="text-sm text-muted-foreground">
              {masteryPct}% mature
            </span>
          </div>
          <Progress value={masteryPct} className="mt-3" />
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
            <span>Nuove: {stats.newCards}</span>
            <span>Giovani: {stats.young}</span>
            <span>Mature: {stats.mature}</span>
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-2xl">Attività recente</h2>
          <p className="text-xs text-muted-foreground">
            Ultima revisione per parola, ultimi 30 giorni.
          </p>
          <div className="mt-4 flex h-28 items-end gap-[3px]">
            {stats.reviewsByDay.map((d) => (
              <div
                key={d.date}
                className="flex-1 rounded-t bg-primary/70"
                style={{
                  height: `${(d.count / maxDay) * 100}%`,
                  minHeight: d.count ? "3px" : "0",
                }}
                title={`${d.date}: ${d.count}`}
              />
            ))}
          </div>
        </section>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <BreakdownCard
            title="Per livello"
            rows={stats.byLevel.map((r) => ({
              label: r.level,
              count: r.count,
            }))}
            total={stats.total}
          />
          <BreakdownCard
            title="Per tema"
            rows={stats.byTheme.map((r) => ({
              label: r.theme,
              count: r.count,
            }))}
            total={stats.total}
          />
        </div>

        {stats.total === 0 && (
          <div className="mt-10 rounded-xl border border-dashed border-border p-10 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-muted-foreground">
              Nessun dato ancora. Salva parole leggendo e ripassale!
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1 font-display text-3xl">{value}</p>
    </div>
  );
}

function BreakdownCard({
  title,
  rows,
  total,
}: {
  title: string;
  rows: { label: string; count: number }[];
  total: number;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-display text-2xl">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nessun dato.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.label} className="text-sm">
              <div className="flex justify-between">
                <span>{r.label}</span>
                <span className="text-muted-foreground">{r.count}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary/60"
                  style={{
                    width: `${total ? (r.count / total) * 100 : 0}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
