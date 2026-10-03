"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Loader2, Plus, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  NEGOCIO_FIELDS,
  NEGOCIO_MAX_CHARS,
  negocioFromEntries,
  planNegocioSave,
  postKbEntry,
  saveResult,
  type NegocioDraft,
  type NegocioKey,
  type SaveResult,
} from "@/lib/negocio";
import type { SetupProgress } from "@/server/agencia/setup-progress";

/**
 * Capa de agencia: «Tu negocio», lo primero que ve el dueño en Tu agente.
 *
 * Antes la pantalla abría con cinco campos que parecen un prompt (nombre,
 * tono, instrucciones, escalado, saludo), un proveedor de IA y una lista de
 * mensajes activadores, y los datos del negocio quedaban hasta el final. Aquí
 * es al revés: qué vendes, cuánto cuesta, dónde estás, qué te preguntan siempre
 * y cuándo quieres que te pase la conversación. Lo técnico vive en «Avanzado».
 *
 * Todo se guarda en lo que ya existe (bloques y preguntas de la base de
 * conocimiento + la regla de escalado del perfil) y solo lo que el dueño
 * escribió entra: ningún campo se rellena solo. Si un guardado falla, el texto
 * se queda donde está y se dice por qué.
 */

type KbEntry = {
  id: string;
  kind: "qa" | "block";
  question: string | null;
  answer: string | null;
  content: string | null;
};

const json = { "content-type": "application/json" };

/** Un campo de texto que crece con lo que se escribe: un texto largo no queda cortado a tres renglones. */
function GrowingTextarea({ value, ...props }: React.ComponentProps<typeof Textarea> & { value: string }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current?.querySelector("textarea");
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <div ref={box}>
      <Textarea value={value} {...props} />
    </div>
  );
}

export function TuNegocio({
  entries,
  escalationRules,
  progress,
  saveHandoff,
  onChanged,
}: {
  entries: KbEntry[];
  escalationRules: string | null;
  progress: SetupProgress | null;
  /** Guarda la regla de escalado en el perfil. */
  saveHandoff: (rules: string) => Promise<SaveResult>;
  /** Algo se guardó: la pantalla recarga lo que depende de ello. */
  onChanged: () => Promise<void> | void;
}) {
  const saved = useMemo(() => negocioFromEntries(entries), [entries]);
  const savedDraft = useMemo<NegocioDraft>(
    () => ({
      oferta: saved.oferta?.text ?? "",
      precios: saved.precios?.text ?? "",
      zona: saved.zona?.text ?? "",
    }),
    [saved],
  );
  const savedHandoff = escalationRules ?? "";

  const [draft, setDraft] = useState<NegocioDraft>(savedDraft);
  const [handoff, setHandoff] = useState(savedHandoff);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [errors, setErrors] = useState<string[]>([]);

  const dirty =
    NEGOCIO_FIELDS.some((f) => draft[f.key].trim() !== savedDraft[f.key]) || handoff.trim() !== savedHandoff.trim();

  // Lo guardado manda mientras el dueño no haya tocado nada; si ya escribió,
  // una recarga no le pisa el texto.
  useEffect(() => {
    if (!dirty) {
      setDraft(savedDraft);
      setHandoff(savedHandoff);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedDraft, savedHandoff]);

  function edit(key: NegocioKey, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setStatus("idle");
  }

  async function save() {
    if (!handoff.trim()) {
      setErrors(["Escribe cuándo quieres que tu agente te pase la conversación."]);
      return;
    }
    setStatus("saving");
    setErrors([]);
    const failures: string[] = [];

    for (const op of planNegocioSave(saved, draft)) {
      const field = NEGOCIO_FIELDS.find((f) => f.key === op.key)!;
      const result =
        op.type === "create"
          ? await postKbEntry({ kind: "block", content: op.content })
          : op.type === "update"
            ? await saveResult(() =>
                fetch(`/api/kb/${op.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ content: op.content }) }),
              )
            : await saveResult(() => fetch(`/api/kb/${op.id}`, { method: "DELETE" }));
      if (!result.ok) failures.push(`${field.label}: ${result.message}`);
    }
    if (handoff.trim() !== savedHandoff.trim()) {
      const result = await saveHandoff(handoff.trim());
      if (!result.ok) failures.push(`Cuándo pasar con una persona: ${result.message}`);
    }

    await onChanged();
    if (failures.length) {
      setErrors(failures);
      setStatus("idle");
      return;
    }
    setStatus("saved");
  }

  const faqs = entries.filter((e) => e.kind === "qa");
  const next = progress?.steps.find((step) => !step.done && step.key !== "whatsapp" && step.key !== "negocio");
  const negocioDone = progress?.steps.find((step) => step.key === "negocio")?.done ?? false;

  return (
    <Card id="negocio" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Tu negocio</CardTitle>
        <CardDescription>
          Escribe lo que le dirías a un cliente nuevo. Tu agente responde solo con esto: lo que no esté aquí, no lo inventa.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-5">
          {NEGOCIO_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`negocio-${field.key}`}>{field.label}</Label>
              <GrowingTextarea
                id={`negocio-${field.key}`}
                rows={field.rows}
                maxLength={NEGOCIO_MAX_CHARS}
                className="resize-y break-words"
                placeholder={field.placeholder}
                aria-describedby={`negocio-${field.key}-hint`}
                value={draft[field.key]}
                disabled={status === "saving"}
                onChange={(event) => edit(field.key, event.target.value)}
              />
              <p id={`negocio-${field.key}-hint`} className="text-xs text-text-3">
                {field.hint}
              </p>
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="negocio-handoff">Cuándo pasar con una persona</Label>
          <GrowingTextarea
            id="negocio-handoff"
            rows={3}
            maxLength={4000}
            className="resize-y break-words"
            aria-describedby="negocio-handoff-hint"
            value={handoff}
            disabled={status === "saving"}
            onChange={(event) => {
              setHandoff(event.target.value);
              setStatus("idle");
            }}
          />
          <p id="negocio-handoff-hint" className="text-xs text-text-3">
            En qué casos tu agente deja de responder y te avisa. Ejemplo: cuando pidan un descuento, tengan un reclamo o quieran hablar con alguien.
          </p>
        </div>

        {errors.length > 0 && (
          <div role="alert" className="space-y-1 rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
            <p className="font-medium">No se guardó todo. Lo que escribiste sigue aquí.</p>
            <ul className="list-disc space-y-0.5 pl-4">
              {errors.map((error) => (
                <li key={error} className="break-words">
                  {error}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="button" className="min-h-11 w-full sm:w-auto" disabled={!dirty || status === "saving"} onClick={() => void save()}>
            {status === "saving" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Guardando…
              </>
            ) : (
              "Guardar mi negocio"
            )}
          </Button>
          <span role="status" className="min-h-5 text-sm text-text-2">
            {status === "saved" && !dirty && (
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-4 w-4 text-success" aria-hidden="true" /> Guardado
              </span>
            )}
          </span>
        </div>

        <Faqs faqs={faqs} onChanged={onChanged} />

        {negocioDone && !dirty && next && (
          <div className="border-t border-border pt-4">
            <Link href={next.href} className={buttonVariants({ variant: "outline", className: "min-h-11 w-full sm:w-auto" })}>
              Seguir: {next.key === "probar" ? "probar tu agente" : "activar tu agente"}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Faqs({ faqs, onChanged }: { faqs: KbEntry[]; onChanged: () => Promise<void> | void }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!question.trim() || !answer.trim()) return;
    setBusy(true);
    setError(null);
    const result = await postKbEntry({ kind: "qa", question, answer });
    setBusy(false);
    // Si no se guardó, la pregunta y la respuesta se quedan en el campo.
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setQuestion("");
    setAnswer("");
    await onChanged();
  }

  async function remove(id: string) {
    setError(null);
    const result = await saveResult(() => fetch(`/api/kb/${id}`, { method: "DELETE" }));
    if (!result.ok) {
      setError(result.message);
      return;
    }
    await onChanged();
  }

  return (
    <section aria-labelledby="faq-title" className="space-y-3 border-t border-border pt-6">
      <div>
        <h4 id="faq-title" className="text-sm font-semibold">
          Preguntas frecuentes
        </h4>
        <p className="mt-1 text-xs leading-5 text-text-3">
          Agrega 2 o 3 que te hagan siempre, con la respuesta que tú darías. Cada una se guarda al agregarla.
        </p>
      </div>

      {faqs.length > 0 && (
        <ul className="space-y-2">
          {faqs.map((faq) => (
            <li key={faq.id} className="flex items-start gap-2 rounded-md border border-border p-3">
              <div className="min-w-0 flex-1 text-sm">
                <p className="break-words font-medium">{faq.question}</p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-text-2">{faq.answer}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-11 shrink-0"
                aria-label={`Quitar la pregunta: ${faq.question ?? ""}`}
                onClick={() => void remove(faq.id)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3 rounded-md border border-dashed border-border-strong p-3">
        <div className="space-y-1.5">
          <Label htmlFor="faq-question">Pregunta</Label>
          <Input
            id="faq-question"
            className="min-h-11"
            maxLength={500}
            placeholder="Ej. ¿Hacen entregas a domicilio?"
            value={question}
            disabled={busy}
            onChange={(event) => setQuestion(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="faq-answer">Respuesta</Label>
          <Textarea
            id="faq-answer"
            rows={2}
            maxLength={4000}
            className="resize-y break-words"
            placeholder="Ej. Sí, entregamos en el este de la ciudad. El envío cuesta $3."
            value={answer}
            disabled={busy}
            onChange={(event) => setAnswer(event.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
            {error}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={busy || !question.trim() || !answer.trim()}
          onClick={() => void add()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
          {busy ? "Guardando…" : "Agregar pregunta"}
        </Button>
      </div>
    </section>
  );
}
