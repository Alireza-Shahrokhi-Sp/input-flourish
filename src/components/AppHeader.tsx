import { Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { BookOpen, Sparkles, LogOut, Brain, Settings as Cog, Library } from "lucide-react";

export function AppHeader() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();

  return (
    <header className="border-b border-border bg-paper/80 backdrop-blur sticky top-0 z-30">
      <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-display text-xl">
          <BookOpen className="h-5 w-5 text-primary" />
          <span>Letture</span>
        </Link>
        <nav className="flex items-center gap-1">
          {user ? (
            <>
              <Link to="/library">
                <Button variant="ghost" size="sm" className="gap-1">
                  <Library className="h-4 w-4" />
                  <span className="hidden sm:inline">Biblioteca</span>
                </Button>
              </Link>
              <Link to="/vocab">
                <Button variant="ghost" size="sm" className="gap-1">
                  <Brain className="h-4 w-4" />
                  <span className="hidden sm:inline">Vocabolario</span>
                </Button>
              </Link>
              <Link to="/generate">
                <Button size="sm" className="gap-1">
                  <Sparkles className="h-4 w-4" />
                  <span className="hidden sm:inline">Nuova</span>
                </Button>
              </Link>
              <Link to="/settings">
                <Button variant="ghost" size="icon" aria-label="Impostazioni">
                  <Cog className="h-4 w-4" />
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                onClick={async () => {
                  await signOut();
                  nav({ to: "/" });
                }}
                aria-label="Esci"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <Link to="/auth">
              <Button size="sm">Accedi</Button>
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
