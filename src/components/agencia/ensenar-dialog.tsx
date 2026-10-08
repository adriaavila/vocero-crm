"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Momento } from "@/lib/ensenar";

/**
 * Fork — «Enséñaselo a tu agente»: la pregunta del cliente y la respuesta del
 * dueño, listas para guardarse como pregunta y respuesta del conocimiento. El
 * dueño las ajusta (quita el nombre del cliente, deja lo que vale para todos)
 * y desde el siguiente mensaje el agente ya lo sabe.
 */
export function EnsenarDialog({
  momento,
  onCancel,
  onSaved,
}: {
  momento: Momento;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [question, setQuestion] = useState(momento.question);
  const [answer, setAnswer] = useState(momento.answer);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/kb", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "qa", question: question.trim(), answer: answer.trim() }),
      });
      if (!res.ok) throw new Error();
      onSaved();
    } catch {
      setError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  const listo = question.trim().length > 0 && answer.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-overlay p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Enséñaselo a tu agente"
    >
      <div className="w-full max-w-md rounded-lg border bg-card p-4 shadow-pop">
        <h3 className="font-semibold">Enséñaselo a tu agente</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-text-3">
          La próxima vez que alguien pregunte esto, tu agente contesta solo. Deja lo que sirve para cualquier cliente.
        </p>

        <label className="mt-3 block text-xs font-medium" htmlFor="ensenar-pregunta">
          Cuando un cliente pregunte
        </label>
        <Input id="ensenar-pregunta" value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} className="mt-1" />

        <label className="mt-3 block text-xs font-medium" htmlFor="ensenar-respuesta">
          Tu agente responde
        </label>
        <Textarea
          id="ensenar-respuesta"
          value={answer}
          maxLength={4000}
          rows={4}
          onChange={(e) => setAnswer(e.target.value)}
          className="mt-1"
        />
        {error && <p className="mt-2 text-xs text-danger-text">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Ahora no
          </Button>
          <Button disabled={!listo || saving} onClick={guardar}>
            Guardar
          </Button>
        </div>
      </div>
    </div>
  );
}
