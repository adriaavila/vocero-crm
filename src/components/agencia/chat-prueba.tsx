"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Capa de agencia — «Escríbele como cliente»: un chat con el agente, dentro de
 * Probar. Lo que el dueño escribe entra como si fuera un cliente y el agente
 * contesta con el turno real, en el sandbox del Laboratorio: nada sale a
 * WhatsApp (ver `server/agencia/chat-prueba.ts`).
 */

type Line = { id: string; from: "cliente" | "agente"; text: string };
type Chat = { lines: Line[]; handoff: string | null };

const SUGGESTIONS = ["Hola, ¿qué precios tienen?", "¿Dónde están ubicados?", "Quiero hablar con una persona"];

const HANDOFF_COPY: Record<string, string> = {
  cliente: "pidió hablar con una persona",
  reclamo: "hay un reclamo",
  fuera_de_kb: "preguntó algo que tu agente no sabe",
};

export function ChatPrueba() {
  const [chat, setChat] = useState<Chat>({ lines: [], handoff: null });
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetch("/api/lab/chat")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Chat | null) => data && setChat(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [chat, pending]);

  async function send(message: string) {
    const clean = message.trim();
    if (!clean || pending) return;
    setPending(clean);
    setText("");
    setError(null);
    const response = await fetch("/api/lab/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: clean }),
    }).catch(() => null);
    const payload = (await response?.json().catch(() => null)) as (Chat & { error?: { message?: string } }) | null;
    setPending(null);
    if (!response?.ok || !payload?.lines) {
      setError(payload?.error?.message ?? "Tu agente no pudo contestar ahora. Prueba de nuevo.");
      setText(clean);
      return;
    }
    setChat(payload);
    if (payload.lines.at(-1)?.from === "cliente" && !payload.handoff) {
      setError("Tu agente no contestó. Revisa que «Tu negocio» esté guardado y vuelve a intentar.");
    }
  }

  async function reset() {
    setError(null);
    const response = await fetch("/api/lab/chat/reset", { method: "POST" }).catch(() => null);
    if (response?.ok) setChat({ lines: [], handoff: null });
  }

  const empty = chat.lines.length === 0 && !pending;

  return (
    <section aria-labelledby="chat-prueba-title" className="overflow-hidden rounded-lg border bg-card">
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h3 id="chat-prueba-title" className="text-[15px] font-semibold tracking-[-0.01em]">
            Escríbele como si fueras un cliente
          </h3>
          <p className="mt-0.5 text-[13px] leading-snug text-text-3">Contesta con lo que cargaste en «Tu negocio». No sale nada a WhatsApp.</p>
        </div>
        {chat.lines.length > 0 && (
          <Button type="button" variant="ghost" size="sm" className="min-h-11 shrink-0" onClick={() => void reset()} disabled={Boolean(pending)}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> De nuevo
          </Button>
        )}
      </header>

      <div ref={scroller} className="max-h-[420px] min-h-[180px] space-y-2 overflow-y-auto bg-[var(--chat-bg)] px-3 py-4" aria-live="polite">
        {empty && (
          <div className="flex flex-wrap justify-center gap-2 py-6">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                className="min-h-11 rounded-full border border-border-strong bg-background px-3 text-sm text-text-2 hover:border-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {chat.lines.map((line) => (
          <Bubble key={line.id} from={line.from} text={line.text} />
        ))}
        {pending && (
          <>
            <Bubble from="cliente" text={pending} />
            <p className="flex items-center gap-2 px-1 text-xs text-text-3">
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Tu agente está escribiendo…
            </p>
          </>
        )}
        {chat.handoff && !pending && (
          <p className="mx-auto max-w-sm rounded-md bg-background px-3 py-2 text-center text-xs leading-relaxed text-text-2">
            Aquí tu agente te pasaría la conversación ({HANDOFF_COPY[chat.handoff] ?? "necesita a una persona"}) y te avisaría.
            Escribe otra cosa para empezar de nuevo.
          </p>
        )}
      </div>

      <form
        className="flex items-center gap-2 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send(text);
        }}
      >
        <label htmlFor="chat-prueba-input" className="sr-only">
          Tu mensaje como cliente
        </label>
        <Input
          id="chat-prueba-input"
          className="min-h-11 flex-1"
          placeholder="Escribe como lo haría un cliente…"
          maxLength={1000}
          autoComplete="off"
          value={text}
          disabled={Boolean(pending)}
          onChange={(event) => setText(event.target.value)}
        />
        <Button type="submit" size="icon" className="h-11 w-11 shrink-0" disabled={!text.trim() || Boolean(pending)} aria-label="Enviar">
          <SendHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </form>
      {error && (
        <p role="alert" className="border-t px-4 py-2 text-sm text-danger-text">
          {error}
        </p>
      )}
    </section>
  );
}

function Bubble({ from, text }: { from: Line["from"]; text: string }) {
  const mine = from === "cliente";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <p
        className={cn(
          "max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm",
          mine ? "rounded-br-sm border border-[var(--bubble-in-border)] bg-[var(--bubble-in)]" : "rounded-bl-sm border border-[var(--bubble-out-border)] bg-[var(--bubble-out)]",
        )}
      >
        <span className="sr-only">{mine ? "Tú: " : "Tu agente: "}</span>
        {text}
      </p>
    </div>
  );
}
