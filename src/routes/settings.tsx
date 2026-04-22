import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Impostazioni — Letture" }] }),
});

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

function SettingsPage() {
  const { user, loading, signOut } = useAuth();
  const nav = useNavigate();
  const [displayName, setDisplayName] = React.useState("");
  const [level, setLevel] = React.useState<typeof LEVELS[number]>("A2");
  const [stretch, setStretch] = React.useState(false);
  const [geminiKey, setGeminiKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!loading && !user) nav({ to: "/auth" });
  }, [user, loading, nav]);

  React.useEffect(() => {
    if (!user) return;
    supabase.from("profiles")
      .select("display_name,default_level,default_stretch,gemini_api_key")
      .eq("user_id", user.id).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setDisplayName(data.display_name ?? "");
          setLevel(data.default_level as typeof LEVELS[number]);
          setStretch(!!data.default_stretch);
          setGeminiKey((data as { gemini_api_key?: string | null }).gemini_api_key ?? "");
        }
      });
  }, [user]);

  const fileRef = React.useRef<HTMLInputElement>(null);
  const [importing, setImporting] = React.useState(false);

  const onImportFile = async (file: File) => {
    if (!user) return;
    setImporting(true);
    try {
      const text = await file.text();
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessione scaduta");
      const { data, error } = await supabase.functions.invoke("import-anki", {
        body: { csv: text },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      const r = data as { imported: number; inserted: number; updated: number; mature: number; skipped: number };
      toast.success(`Importate ${r.imported} parole (${r.inserted} nuove, ${r.updated} aggiornate, ${r.mature} mature)`);
    } catch (e) {
      toast.error((e as Error).message || "Errore importazione");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async () => {
    if (!user) return;
    setBusy(true);
    const { error } = await supabase.from("profiles").update({
      display_name: displayName || null,
      default_level: level,
      default_stretch: stretch,
      gemini_api_key: geminiKey.trim() || null,
    }).eq("user_id", user.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Salvato");
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-md px-4 py-10 space-y-6">
        <h1 className="font-display text-4xl">Impostazioni</h1>

        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div className="space-y-1">
            <Label htmlFor="dn">Nome</Label>
            <Input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Livello predefinito</Label>
            <Select value={level} onValueChange={(v) => setLevel(v as typeof LEVELS[number])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <Label htmlFor="stretch" className="cursor-pointer">Sfidami (+) di default</Label>
            <Switch id="stretch" checked={stretch} onCheckedChange={setStretch} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gk">Chiave API Gemini (personale)</Label>
            <Input
              id="gk"
              type="password"
              placeholder="AIza…"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Ottienila gratis su{" "}
              <a className="underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                aistudio.google.com/apikey
              </a>. Usata solo per generare le tue storie.
            </p>
          </div>
          <Button className="w-full" onClick={save} disabled={busy}>
            {busy ? "Salvando…" : "Salva"}
          </Button>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">{user?.email}</p>
        <div className="rounded-xl border border-border bg-card p-6 space-y-3">
          <div>
            <h2 className="font-display text-xl">Importa da Anki</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Esporta dal tuo deck Anki come <strong>Notes in Plain Text (.txt/.csv)</strong> includendo
              campi e tag. Le colonne riconosciute: <code>front/lemma</code>, <code>back/translation</code>,
              <code> interval</code>, <code>ease</code>, <code>reps</code>, <code>lapses</code>, <code>tags</code>.
              Le parole già presenti verranno sostituite con i dati di Anki.
            </p>
          </div>
          <Input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
            disabled={importing}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportFile(f);
            }}
          />
          {importing && <p className="text-xs text-muted-foreground">Importazione in corso…</p>}
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">{user?.email}</p>
          <Button variant="outline" className="mt-3 w-full" onClick={async () => {
            await signOut(); nav({ to: "/" });
          }}>Esci</Button>
        </div>
      </main>
    </div>
  );
}
