import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import * as React from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AppHeader } from "@/components/AppHeader";
import { toast } from "sonner";
import { Sparkles, Info } from "lucide-react";

export const Route = createFileRoute("/generate")({
  component: GeneratePage,
  head: () => ({ meta: [{ title: "Nuova storia — Letture" }] }),
});

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
const FORMATS = [
  { value: "news", label: "Articolo di cronaca" },
  { value: "short_story", label: "Racconto breve" },
  { value: "novel_chapter", label: "Capitolo di romanzo" },
  { value: "dialogue", label: "Dialogo" },
] as const;

function GeneratePage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [level, setLevel] = React.useState<typeof LEVELS[number]>("A2");
  const [stretch, setStretch] = React.useState(false);
  const [format, setFormat] = React.useState<(typeof FORMATS)[number]["value"]>("short_story");
  const [topic, setTopic] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!loading && !user) nav({ to: "/auth" });
  }, [user, loading, nav]);

  // Load profile defaults
  React.useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("default_level, default_stretch")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setLevel(data.default_level as typeof LEVELS[number]);
          setStretch(!!data.default_stretch);
        }
      });
  }, [user]);

  const generate = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-story", {
        body: {
          level,
          mode: stretch ? "stretch" : "standard",
          stretch_level: stretch ? nextLevel(level) : null,
          format,
          topic: topic.trim() || null,
        },
      });
      if (error) throw error;
      if (!data?.story_id) throw new Error("Generazione fallita");
      toast.success("Storia pronta!");
      nav({ to: "/story/$id", params: { id: data.story_id } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore";
      if (msg.includes("429")) toast.error("Troppi tentativi. Riprova tra poco.");
      else if (msg.includes("402")) toast.error("Crediti AI esauriti. Aggiungili in Settings.");
      else toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="font-display text-4xl">Una nuova storia</h1>
        <p className="text-muted-foreground mt-2">
          Scegli il livello, il formato e (se vuoi) un argomento.
        </p>

        <div className="mt-8 space-y-6 rounded-xl border border-border bg-card p-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Livello</Label>
              <Select value={level} onValueChange={(v) => setLevel(v as typeof LEVELS[number])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Formato</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as typeof format)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <Switch checked={stretch} onCheckedChange={setStretch} id="stretch" disabled={level === "C2"} />
              <Label htmlFor="stretch" className="cursor-pointer">
                Sfidami <span className="text-stretch font-semibold">+</span>
              </Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Aggiunge 1–2 elementi del livello successivo ({nextLevel(level) ?? "—"})
                    per spingerti appena oltre, senza travolgerti.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            {stretch && nextLevel(level) && (
              <span className="text-sm text-stretch font-medium">{level}+</span>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="topic">Argomento (opzionale)</Label>
            <Input
              id="topic"
              placeholder="es. il mercato di Palermo, una gita in montagna…"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Lascia vuoto per lasciare scegliere all'IA.
            </p>
          </div>

          <Button onClick={generate} disabled={busy} size="lg" className="w-full gap-2">
            <Sparkles className="h-4 w-4" />
            {busy ? "Generando…" : "Genera storia"}
          </Button>
        </div>
      </main>
    </div>
  );
}

function nextLevel(l: string): string | null {
  const order = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const i = order.indexOf(l);
  return i >= 0 && i < order.length - 1 ? order[i + 1] : null;
}
