import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { BookOpen, Sparkles } from "lucide-react";

export const Route = createFileRoute("/library")({
  component: LibraryPage,
  head: () => ({ meta: [{ title: "Biblioteca — Letture" }] }),
});

type StoryRow = {
  id: string;
  title: string;
  level: string;
  mode: string;
  stretch_level: string | null;
  format: string;
  word_count: number | null;
  summary: string | null;
  created_at: string;
};

function LibraryPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [stories, setStories] = React.useState<StoryRow[] | null>(null);

  React.useEffect(() => {
    if (!loading && !user) nav({ to: "/auth" });
  }, [user, loading, nav]);

  React.useEffect(() => {
    if (!user) return;
    supabase
      .from("stories")
      .select("id,title,level,mode,stretch_level,format,word_count,summary,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => setStories((data as StoryRow[]) ?? []));
  }, [user]);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-4xl">Biblioteca</h1>
          <Link to="/generate">
            <Button className="gap-2"><Sparkles className="h-4 w-4" /> Nuova</Button>
          </Link>
        </div>

        {stories === null && <p className="mt-8 text-muted-foreground">Caricamento…</p>}
        {stories?.length === 0 && (
          <div className="mt-12 text-center rounded-xl border border-dashed border-border p-10">
            <BookOpen className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="mt-3 text-muted-foreground">Nessuna storia ancora. Generane una!</p>
          </div>
        )}

        <div className="mt-6 space-y-3">
          {stories?.map((s) => (
            <Link
              key={s.id}
              to="/story/$id"
              params={{ id: s.id }}
              className="block rounded-xl border border-border bg-card p-5 hover:border-primary/40 transition-colors"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-display text-2xl">{s.title}</h2>
                <span className="text-xs text-muted-foreground shrink-0">
                  {s.level}{s.mode === "stretch" ? "+" : ""} · {s.word_count ?? "?"} parole
                </span>
              </div>
              {s.summary && (
                <p className="mt-2 text-sm text-muted-foreground italic">{s.summary}</p>
              )}
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
