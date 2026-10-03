"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StateDot } from "@/components/agencia/allok/mark";

const CHIPS = ["¿Qué hago hoy?", "¿Qué leads están en riesgo?", "¿Cómo va la semana?"];
const MAX = 300;

type Phase =
  | { kind: "idle" }
  | { kind: "loading"; question: string }
  | { kind: "answer"; question: string; answer: string; remaining: number | null }
  | { kind: "error"; question: string; message: string }
  | { kind: "limit"; message: string };

/**
 * Inicio · «Pregúntale a allok»: una pregunta en texto libre, contestada con
 * los datos de este negocio (`POST /api/centro/ask`). Cuatro estados además
 * del reposo: contestando, respuesta, error (con reintento) y tope del día.
 */
export function AskBox({ productLabel }: { productLabel: string }) {
  const [value, setValue] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // Una respuesta vieja que llega tarde no pisa a la pregunta nueva.
  const latest = useRef(0);

  async function ask(raw: string) {
    const question = raw.trim();
    if (question.length < 2 || phase.kind === "loading" || phase.kind === "limit") return;
    const mine = ++latest.current;
    setPhase({ kind: "loading", question });
    try {
      const res = await fetch("/api/centro/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const json = (await res.json().catch(() => null)) as
        | { answer?: string; remaining?: number; error?: { code?: string; message?: string } }
        | null;
      if (mine !== latest.current) return;
      if (res.ok && json?.answer) {
        setPhase({ kind: "answer", question, answer: json.answer, remaining: typeof json.remaining === "number" ? json.remaining : null });
      } else if (res.status === 429) {
        setPhase({ kind: "limit", message: json?.error?.message ?? "Llegaste al límite de preguntas de hoy." });
      } else {
        setPhase({ kind: "error", question, message: json?.error?.message ?? "No pude contestar ahora. Prueba de nuevo en un momento." });
      }
    } catch {
      if (mine !== latest.current) return;
      setPhase({ kind: "error", question, message: "No pude conectar. Revisa tu conexión y prueba de nuevo." });
    }
  }

  const busy = phase.kind === "loading";
  const blocked = phase.kind === "limit";

  return (
    <section aria-labelledby="ask-titulo" className="mt-8 rounded-lg border bg-background p-4 md:p-5">
      <h2 id="ask-titulo" className="kicker">
        Pregúntale a {productLabel}
      </h2>
      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(value);
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
          className="h-11 flex-1 rounded-[10px] text-[15px]"
        />
        <Button type="submit" size="lg" disabled={busy || blocked || value.trim().length < 2} className="h-11 sm:w-32">
          {busy ? "Mirando…" : "Preguntar"}
        </Button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            disabled={busy || blocked}
            onClick={() => {
              setValue(chip);
              void ask(chip);
            }}
            className="inline-flex min-h-11 items-center rounded-[10px] border border-border-strong px-3.5 text-[13.5px] font-medium transition-[border-color,transform] hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
          >
            {chip}
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
            <p className="kicker truncate">{phase.question}</p>
            <p className="mt-1.5 whitespace-pre-line text-[15px] leading-relaxed">{phase.answer}</p>
            <p className="mt-2 font-mono text-[11px] text-text-3">
              Con los datos de tu cuenta
              {phase.remaining !== null ? ` · te quedan ${phase.remaining} preguntas hoy` : ""}
            </p>
          </div>
        )}
        {phase.kind === "error" && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="text-[14px] text-destructive">{phase.message}</p>
            <Button type="button" variant="outline" size="lg" className="min-h-11" onClick={() => void ask(phase.question)}>
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
