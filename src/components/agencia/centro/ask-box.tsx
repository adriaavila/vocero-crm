"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StateDot } from "@/components/agencia/allok/mark";

/** Las tres sugeridas se contestan en el servidor con tus datos, sin modelo y sin gastar cupo. */
const CHIPS = [
  { label: "¿Qué hago hoy?", chip: "hoy" },
  { label: "¿Qué leads están en riesgo?", chip: "riesgo" },
  { label: "¿Cómo va la semana?", chip: "semana" },
] as const;
const MAX = 300;

type Phase =
  | { kind: "idle" }
  | { kind: "loading"; question: string }
  | { kind: "answer"; question: string; answer: string; remaining: number | null; source: "datos" | "ia" }
  | { kind: "error"; retry: () => void; message: string }
  | { kind: "limit"; message: string };

const LIMIT_MESSAGE = "Llegaste al límite de preguntas de hoy. Mañana vuelves a tener las 20.";

/**
 * Inicio · «Pregúntale a allok». Texto libre → `POST /api/centro/ask` (modelo,
 * 20 al día); las tres sugeridas → el mismo endpoint con `{ chip }`, que
 * contesta con los datos y no usa cupo. Estados: contestando, respuesta, error
 * (con reintento) y tope del día (que sobrevive a recargar: llega del servidor).
 */
export function AskBox({ productLabel, remainingToday }: { productLabel: string; remainingToday: number }) {
  const [value, setValue] = useState("");
  const [phase, setPhase] = useState<Phase>(remainingToday <= 0 ? { kind: "limit", message: LIMIT_MESSAGE } : { kind: "idle" });
  // Una respuesta vieja que llega tarde no pisa a la pregunta nueva.
  const latest = useRef(0);

  async function send(payload: { question: string } | { chip: (typeof CHIPS)[number]["chip"] }, shown: string, free: boolean) {
    if (phase.kind === "loading") return;
    if (free && phase.kind === "limit") return;
    const mine = ++latest.current;
    setPhase({ kind: "loading", question: shown });
    const retry = () => void send(payload, shown, free);
    try {
      const res = await fetch("/api/centro/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => null)) as
        | { answer?: string; remaining?: number | null; source?: "datos" | "ia"; error?: { code?: string; message?: string } }
        | null;
      if (mine !== latest.current) return;
      if (res.ok && json?.answer) {
        setPhase({
          kind: "answer",
          question: shown,
          answer: json.answer,
          remaining: typeof json.remaining === "number" ? json.remaining : null,
          source: json.source ?? "ia",
        });
      } else if (res.status === 429) {
        setPhase({ kind: "limit", message: json?.error?.message ?? LIMIT_MESSAGE });
      } else {
        setPhase({ kind: "error", retry, message: json?.error?.message ?? "No pude contestar ahora. Prueba de nuevo en un momento." });
      }
    } catch {
      if (mine !== latest.current) return;
      setPhase({ kind: "error", retry, message: "No pude conectar. Revisa tu conexión y prueba de nuevo." });
    }
  }

  const busy = phase.kind === "loading";
  const blocked = phase.kind === "limit";
  const ask = (raw: string) => {
    const question = raw.trim();
    if (question.length >= 2) void send({ question }, question, true);
  };

  return (
    <section aria-labelledby="ask-titulo" className="mt-8 rounded-lg border bg-background p-4 md:p-5">
      <h2 id="ask-titulo" className="kicker">
        Pregúntale a {productLabel}
      </h2>
      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          ask(value);
        }}
      >
        <label htmlFor="ask-input" className="sr-only">
          Tu pregunta
        </label>
        <Input
          id="ask-input"
          value={value}
          maxLength={MAX}
          disabled={blocked}
          autoComplete="off"
          placeholder="Pregunta por tu día o tus leads"
          onChange={(e) => setValue(e.target.value)}
          className="h-11 rounded-[10px] text-[15px] sm:flex-1"
        />
        <Button type="submit" size="lg" disabled={busy || blocked || value.trim().length < 2} className="h-11 sm:w-32">
          {busy ? "Mirando…" : "Preguntar"}
        </Button>
      </form>

      {/* En el teléfono las sugeridas se deslizan en una fila, como las tarjetas. */}
      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
        {CHIPS.map(({ label, chip }) => (
          <button
            key={chip}
            type="button"
            disabled={busy}
            onClick={() => {
              setValue("");
              void send({ chip }, label, false);
            }}
            className="inline-flex min-h-11 shrink-0 items-center rounded-[10px] border border-border-strong px-3.5 text-[13.5px] font-medium transition-[border-color,transform] hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
          >
            {label}
          </button>
        ))}
      </div>

      <div aria-live="polite" aria-busy={busy} className="mt-4 empty:hidden">
        {phase.kind === "loading" && (
          <p role="status" className="flex items-center gap-2.5 text-[14px] text-text-2">
            <StateDot state="atendiendo" size={14} motion decorative />
            Mirando tus datos…
          </p>
        )}
        {phase.kind === "answer" && (
          <div className="ak-enter border-l-2 border-border-strong pl-4">
            <p className="line-clamp-2 text-[13px] leading-snug text-text-3">{phase.question}</p>
            <p className="mt-1.5 whitespace-pre-line text-[15px] leading-relaxed">{phase.answer}</p>
            <p className="mt-2 font-mono text-[11px] text-text-3">
              {phase.source === "ia" ? "Respuesta generada por IA con los datos de tu cuenta" : "Calculada con los datos de tu cuenta, sin IA"}
              {phase.remaining !== null ? ` · te ${phase.remaining === 1 ? "queda 1 pregunta" : `quedan ${phase.remaining} preguntas`} hoy` : ""}
            </p>
          </div>
        )}
        {phase.kind === "error" && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="text-[14px] text-destructive-text">{phase.message}</p>
            <Button type="button" variant="outline" size="lg" className="min-h-11" onClick={phase.retry}>
              Reintentar
            </Button>
          </div>
        )}
        {phase.kind === "limit" && (
          <p role="status" className="flex items-start gap-2.5 text-[14px] text-text-2">
            <StateDot state="pausado" size={10} decorative className="mt-1.5" />
            {phase.message}
          </p>
        )}
      </div>
    </section>
  );
}
