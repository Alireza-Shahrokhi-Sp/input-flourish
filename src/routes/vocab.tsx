import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import * as React from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
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
  const [statusFilter, setStatusFilter] = React.useState<"all" | "learning" | "mastering">("all");
  const [themeFilter, setThemeFilter] = React.useState<string>("all");
  const [dueOnly, setDueOnly] = React.useState(false);
  const [sortBy, setSortBy] = React.useState<"recent" | "alpha" | "due">("recent");
  const [levelFilter, setLevelFilter] = React.useState<string>("all");

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

  const updateTheme = async (id: string, theme_tag: string) => {
    const value = theme_tag.trim() || null;
    const { error } = await supabase.from("vocab_items").update({ theme_tag: value }).eq("id", id);
    if (error) return toast.error(error.message);
    setRows((rs) => rs?.map((r) => r.id === id ? { ...r, theme_tag: value } : r) ?? null);
  };

  const toggleStatus = async (id: string, current: string) => {
    const next = current === "mastering" ? "learning" : "mastering";
    const { error } = await supabase.from("vocab_items").update({ status: next }).eq("id", id);
    if (error) return toast.error(error.message);
    setRows((rs) => rs?.map((r) => r.id === id ? { ...r, status: next } : r) ?? null);
  };

  // Distinct themes present in the saved vocab, for the theme filter dropdown.
  const themes = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of rows ?? []) if (r.theme_tag) set.add(r.theme_tag);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "it"));
  }, [rows]);

  const filtered = React.useMemo(() => {
    const query = q.trim().toLowerCase();
    const now = Date.now();
    const out = (rows ?? []).filter((r) => {
      if (query) {
        // Bug fix: lowercase BOTH sides. Lemmas saved from stories are already
        // lowercased, but Anki-imported ones may not be — previously they were
        // silently excluded from search results.
        const hit =
          r.lemma.toLowerCase().includes(query) ||
          (r.translation?.toLowerCase().includes(query) ?? false) ||
          (r.theme_tag?.toLowerCase().includes(query) ?? false);
        if (!hit) return false;
      }
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (levelFilter !== "all" && r.cefr_level !== levelFilter) return false;
      if (themeFilter !== "all" && r.theme_tag !== themeFilter) return false;
      if (dueOnly) {
        const isDue = !r.due_at || new Date(r.due_at).getTime() <= now;
        if (!isDue) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      if (sortBy === "alpha") return a.lemma.localeCompare(b.lemma, "it");
      if (sortBy === "due") {
        // Soonest / most overdue first. Never-reviewed (no due_at) treated as
        // due now (time 0) so they surface near the top, matching review logic.
        const da = a.due_at ? new Date(a.due_at).getTime() : 0;
        const db = b.due_at ? new Date(b.due_at).getTime() : 0;
        return da - db;
      }
      // recent (default): newest created first.
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return out;
  }, [rows, q, statusFilter, levelFilter, themeFilter, dueOnly, sortBy]);

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
          placeholder="Cerca parola, traduzione o tema…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti gli stati</SelectItem>
              <SelectItem value="learning">Learning</SelectItem>
              <SelectItem value="mastering">Mastering</SelectItem>
            </SelectContent>
          </Select>

          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger className="h-8 w-[100px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i livelli</SelectItem>
              <SelectItem value="A1">A1</SelectItem>
              <SelectItem value="A2">A2</SelectItem>
              <SelectItem value="B1">B1</SelectItem>
              <SelectItem value="B2">B2</SelectItem>
            </SelectContent>
          </Select>

          {themes.length > 0 && (
            <Select value={themeFilter} onValueChange={setThemeFilter}>
              <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i temi</SelectItem>
                {themes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
            <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Più recenti</SelectItem>
              <SelectItem value="alpha">Alfabetico</SelectItem>
              <SelectItem value="due">Da ripassare prima</SelectItem>
            </SelectContent>
          </Select>

          <Toggle
            pressed={dueOnly}
            onPressedChange={setDueOnly}
            size="sm"
            className="h-8 text-xs data-[state=on]:bg-stretch/15 data-[state=on]:text-stretch"
          >
            Solo da ripassare
          </Toggle>

          <span className="ml-auto text-xs text-muted-foreground">
            {filtered?.length ?? 0} parole
          </span>
        </div>

        {rows === null && <p className="mt-8 text-muted-foreground">Caricamento…</p>}
        {rows?.length === 0 && (
          <p className="mt-8 text-muted-foreground">
            Nessuna parola salvata. Cliccale dalle storie per aggiungerle.
          </p>
        )}
        {rows && rows.length > 0 && filtered.length === 0 && (
          <p className="mt-8 text-muted-foreground">
            Nessuna parola corrisponde ai filtri.
          </p>
        )}

        <ul className="mt-6 divide-y divide-border rounded-xl border border-border bg-card">
          {filtered?.map((r) => {
            const due = r.due_at && new Date(r.due_at).getTime() <= Date.now();
            return (
              <li key={r.id} className="flex items-center gap-3 p-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-display text-xl">{r.lemma}</span>
                    {r.pos && <span className="text-xs uppercase text-muted-foreground">{r.pos}</span>}
                    {r.lemma.includes(" ") && (
                      <span className="text-[10px] font-medium rounded-full bg-grammar/10 text-grammar px-1.5 py-0.5">espressione</span>
                    )}
                    {r.cefr_level && <span className="text-[10px] font-medium rounded-full bg-primary/10 text-primary px-1.5 py-0.5">{r.cefr_level}</span>}
                    {due && <span className="text-xs text-stretch font-medium">da ripassare</span>}
                    <button
                      onClick={() => toggleStatus(r.id, r.status)}
                      className="text-[10px] uppercase tracking-wide rounded-full border border-border px-2 py-0.5 hover:bg-muted"
                    >
                      {r.status}
                    </button>
                  </div>
                  {r.translation && <p className="text-sm text-muted-foreground">{r.translation}</p>}
                  {r.notes && <p className="text-xs text-muted-foreground italic mt-0.5">{r.notes}</p>}
                  <Input
                    className="mt-2 h-7 text-xs max-w-[220px]"
                    placeholder="tema (es. cucina)"
                    defaultValue={r.theme_tag ?? ""}
                    onBlur={(e) => {
                      if ((e.target.value || "") !== (r.theme_tag ?? "")) updateTheme(r.id, e.target.value);
                    }}
                  />
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
