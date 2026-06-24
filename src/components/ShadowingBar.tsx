import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Play, Pause, SkipBack, SkipForward, Repeat } from "lucide-react";
import {
  loadVoices,
  pickItalianVoice,
  type Sentence,
} from "@/lib/speech";

const RATES = [0.6, 0.75, 0.9, 1.0] as const;

export function ShadowingBar({
  sentences,
  onActiveSentence,
}: {
  sentences: Sentence[];
  onActiveSentence: (i: number | null) => void;
}) {
  const [playing, setPlaying] = React.useState(false);
  const [idx, setIdx] = React.useState(0);
  const [rate, setRate] = React.useState<number>(0.9);
  const [loop, setLoop] = React.useState(false);
  const [voice, setVoice] = React.useState<
    SpeechSynthesisVoice | undefined
  >(undefined);

  const idxRef = React.useRef(idx);
  const playingRef = React.useRef(playing);
  const loopRef = React.useRef(loop);
  const rateRef = React.useRef(rate);

  React.useEffect(() => {
    idxRef.current = idx;
    onActiveSentence(playing ? idx : null);
  }, [idx, playing, onActiveSentence]);
  React.useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  React.useEffect(() => {
    loopRef.current = loop;
  }, [loop]);
  React.useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

  React.useEffect(() => {
    loadVoices().then((vs) => setVoice(pickItalianVoice(vs)));
    return () => window.speechSynthesis.cancel();
  }, []);

  const stop = React.useCallback(() => {
    setPlaying(false);
    playingRef.current = false;
    window.speechSynthesis.cancel();
    onActiveSentence(null);
  }, [onActiveSentence]);

  const speakAt = React.useCallback(
    (i: number) => {
      if (i < 0 || i >= sentences.length) {
        stop();
        return;
      }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(sentences[i].text);
      u.lang = "it-IT";
      u.rate = rateRef.current;
      if (voice) u.voice = voice;
      u.onend = () => {
        if (!playingRef.current) return;
        if (loopRef.current) {
          speakAt(idxRef.current);
          return;
        }
        const next = idxRef.current + 1;
        if (next < sentences.length) {
          setIdx(next);
          speakAt(next);
        } else {
          stop();
        }
      };
      u.onerror = () => stop();
      window.speechSynthesis.speak(u);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sentences, voice, stop],
  );

  const start = () => {
    setPlaying(true);
    playingRef.current = true;
    speakAt(idxRef.current);
  };

  const toggle = () => (playing ? stop() : start());

  const prev = () => {
    const i = Math.max(0, idxRef.current - 1);
    setIdx(i);
    if (playingRef.current) speakAt(i);
  };
  const next = () => {
    const i = Math.min(sentences.length - 1, idxRef.current + 1);
    setIdx(i);
    if (playingRef.current) speakAt(i);
  };

  if (!sentences.length) return null;

  return (
    <div className="sticky top-14 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-2 border-b border-border bg-paper/90 px-4 py-2 backdrop-blur">
      <Button
        variant="ghost"
        size="icon"
        onClick={prev}
        aria-label="Frase precedente"
      >
        <SkipBack className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        onClick={toggle}
        aria-label={playing ? "Pausa" : "Ascolta"}
      >
        {playing ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={next}
        aria-label="Frase successiva"
      >
        <SkipForward className="h-4 w-4" />
      </Button>

      <Button
        variant={loop ? "secondary" : "ghost"}
        size="icon"
        onClick={() => setLoop((l) => !l)}
        aria-label="Ripeti frase"
        title="Ripeti la frase corrente"
      >
        <Repeat className="h-4 w-4" />
      </Button>

      <Select
        value={String(rate)}
        onValueChange={(v) => setRate(Number(v))}
      >
        <SelectTrigger className="h-8 w-[88px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RATES.map((r) => (
            <SelectItem key={r} value={String(r)}>
              {r.toFixed(2)}×
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="ml-auto text-xs text-muted-foreground">
        Frase {Math.min(idx + 1, sentences.length)} / {sentences.length}
      </span>
    </div>
  );
}
