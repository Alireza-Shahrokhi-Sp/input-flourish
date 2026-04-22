import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import * as React from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Brain } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/vocab")({
  component: VocabPage,
  head: () => ({ meta: [{ title: "Vocabolario — Letture" }] }),
});

type Row = {
  id: string;
  lemma: string;
  pos: string | null;
  translation: string | null;
  notes: string | null;
  first_story_id: string | null;
  created_at: string;
  theme_tag: string | null;
  status: string;
  cefr_level: string | null;
  due_at?: string | null;
};

function VocabPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [q, setQ] = React.useState("");
  const [dueCount, setDueCount] = React.useState(0);

  React.useEffect(() => {
    if (!loading && !user) nav({ to: "/auth" });
  }, [user, loading, nav]);

  const load = React.useCallback(async () => {
    if (!user) return;
    const { data: vocab } = await supabase
      .from("vocab_items")
      .select("id,lemma,pos,translation,notes,first_story_id,created_at,theme_tag,status,cefr_level")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    const { data: srs } = await supabase
      .from("srs_reviews")
      .select("vocab_id,due_at")
      .eq("user_id", user.id);
    const dueMap = new Map<string, string>();
    for (const r of srs ?? []) dueMap.set(r.vocab_id, r.due_at);
    const merged = (vocab ?? []).map((r) => ({ ...r, due_at: dueMap.get(r.id) ?? null }));
    setRows(merged as Row[]);
    const now = Date.now();
    setDueCount(merged.filter((r) => !r.due_at || new Date(r.due_at).getTime() <= now).length);
  }, [user]);

  React.useEffect(() => { load(); }, [load]);

  const remove = async (id: string) => {
    const { error } = await supabase.from("vocab_items").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setRows(rows?.filter((r) => r.id !== id) ?? null);
  };

  const filtered = rows?.filter(
    (r) => !q || r.lemma.includes(q.toLowerCase()) || r.translation?.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-4xl">Vocabolario</h1>
          <Link to="/review">
            <Button className="gap-2">
              <Brain className="h-4 w-4" /> Ripassa ({dueCount})
            </Button>
          </Link>
        </div>

        <Input
          className="mt-6"
          placeholder="Cerca parola o traduzione…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        {rows === null && <p className="mt-8 text-muted-foreground">Caricamento…</p>}
        {rows?.length === 0 && (
          <p className="mt-8 text-muted-foreground">
            Nessuna parola salvata. Cliccale dalle storie per aggiungerle.
          </p>
        )}

        <ul className="mt-6 divide-y divide-border rounded-xl border border-border bg-card">
          {filtered?.map((r) => {
            const due = r.due_at && new Date(r.due_at).getTime() <= Date.now();
            return (
              <li key={r.id} className="flex items-center gap-3 p-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-xl">{r.lemma}</span>
                    {r.pos && <span className="text-xs uppercase text-muted-foreground">{r.pos}</span>}
                    {due && <span className="text-xs text-stretch font-medium">da ripassare</span>}
                  </div>
                  {r.translation && <p className="text-sm text-muted-foreground">{r.translation}</p>}
                </div>
                <Button variant="ghost" size="icon" onClick={() => remove(r.id)} aria-label="Elimina">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
