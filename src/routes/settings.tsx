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
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!loading && !user) nav({ to: "/auth" });
  }, [user, loading, nav]);

  React.useEffect(() => {
    if (!user) return;
    supabase.from("profiles")
      .select("display_name,default_level,default_stretch")
      .eq("user_id", user.id).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setDisplayName(data.display_name ?? "");
          setLevel(data.default_level as typeof LEVELS[number]);
          setStretch(!!data.default_stretch);
        }
      });
  }, [user]);

  const save = async () => {
    if (!user) return;
    setBusy(true);
    const { error } = await supabase.from("profiles").update({
      display_name: displayName || null,
      default_level: level,
      default_stretch: stretch,
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
          <Button className="w-full" onClick={save} disabled={busy}>
            {busy ? "Salvando…" : "Salva"}
          </Button>
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
