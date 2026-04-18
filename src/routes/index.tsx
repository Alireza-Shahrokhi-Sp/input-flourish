import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/useAuth";
import { Sparkles, Headphones, BookMarked, Brain } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Letture — Comprensible input in italiano" },
      {
        name: "description",
        content:
          "Read Italian stories generated for your level. Inline grammar help, vocabulary tracking, spaced-repetition review, and shadowing audio.",
      },
    ],
  }),
});

function Index() {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-background text-ink">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-16">
        <section className="text-center">
          <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
            Comprensible input · Italiano
          </p>
          <h1 className="mt-4 font-display text-5xl md:text-6xl leading-tight">
            Leggi l'italiano <em className="text-primary not-italic">al tuo livello</em>.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-xl mx-auto">
            Storie generate apposta per te — A1 fino a C2 — con grammatica spiegata
            quando serve, vocabolario che ricordi, e audio per il <em>shadowing</em>.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link to={user ? "/generate" : "/auth"}>
              <Button size="lg" className="gap-2">
                <Sparkles className="h-4 w-4" /> Inizia a leggere
              </Button>
            </Link>
            {user && (
              <Link to="/library">
                <Button size="lg" variant="outline">La mia biblioteca</Button>
              </Link>
            )}
          </div>
        </section>

        <section className="mt-20 grid sm:grid-cols-2 gap-6">
          {[
            { icon: BookMarked, title: "Sceglie il tuo livello", body: "A1–C2 più la modalità “+” che ti spinge appena oltre senza travolgerti." },
            { icon: Brain, title: "Grammatica intuitiva", body: "Solo le strutture complesse sono evidenziate nel testo. Tutto il resto è raccolto a fine storia." },
            { icon: Headphones, title: "Shadowing", body: "Ascolta e ripeti con la voce italiana del tuo browser." },
            { icon: Sparkles, title: "Vocabolario che resta", body: "Salva parole, ripassa con SRS, e l'app ne tiene conto nelle prossime storie." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border border-border bg-card p-5">
              <Icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 font-display text-2xl">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
