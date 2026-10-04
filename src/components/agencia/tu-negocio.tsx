"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronRight, Loader2, Trash2 } from "lucide-react";
import { HorarioRespuesta, type HoursController } from "@/components/agencia/horario-respuesta";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  isSuggestedHandoff,
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
 * es al revés: qué vendes, cuánto cuesta, dónde estás, cuándo respondes, qué te
 * preguntan siempre y cuándo quieres que te pase la conversación. Lo técnico
 * vive en «Avanzado».
 *
 * UN solo botón guarda todo lo que hay en pantalla (los datos, el horario, la
 * regla de escalado y la pregunta que se esté escribiendo). Se guarda en lo que
 * ya existe (bloques y preguntas de la base de conocimiento, la regla del
 * perfil, el horario) y solo entra lo que el dueño escribió: ningún campo se
 * rellena solo. Si algo falla, lo escrito se queda donde está y se dice por qué.
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
    const wrapper = box.current;
    const el = wrapper?.querySelector("textarea");
    if (!wrapper || !el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + 2}px`;
    };
    fit();
    // Cambiar el ancho (girar el teléfono) cambia cuántos renglones ocupa.
    const observer = new ResizeObserver(fit);
    observer.observe(wrapper);
    return () => observer.disconnect();
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
  hours,
  hoursOpen,
  onHoursOpenChange,
  brandName,
  saveHandoff,
  onChanged,
}: {
  entries: KbEntry[];
  escalationRules: string | null;
  progress: SetupProgress | null;
  /** El horario de respuesta (solo SaaS): se edita aquí y se guarda con el mismo botón. */
  hours: HoursController | null;
  hoursOpen: boolean;
  onHoursOpenChange: (open: boolean) => void;
  /** Marca en minúscula, para una oración. */
  brandName: string;
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
  const faqs = entries.filter((e) => e.kind === "qa");

  const [draft, setDraft] = useState<NegocioDraft>(savedDraft);
  const [handoff, setHandoff] = useState(savedHandoff);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  // Sin ninguna pregunta guardada, el formulario va abierto: es lo que toca hacer.
  const [faqOpen, setFaqOpen] = useState(faqs.length === 0);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [errors, setErrors] = useState<string[]>([]);
  // Lo que falta ANTES de mandar nada se dice bajo el campo, no en el aviso de arriba.
  const [fieldErrors, setFieldErrors] = useState<{ handoff?: string; faq?: string }>({});
  const [removeError, setRemoveError] = useState<string | null>(null);

  const faqDraft = question.trim().length > 0 || answer.trim().length > 0;
  const dirty =
    NEGOCIO_FIELDS.some((f) => draft[f.key].trim() !== savedDraft[f.key]) ||
    handoff.trim() !== savedHandoff.trim() ||
    Boolean(hours?.dirty) ||
    faqDraft;

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
    // Primero lo que se puede revisar sin mandar nada: así el aviso va junto al
    // campo, con el foco en él, y no hay un «no se guardó todo» cuando no se envió nada.
    setErrors([]);
    if (!handoff.trim()) {
      setFieldErrors({ handoff: "Escribe en qué casos quieres que tu agente te pase la conversación." });
      document.getElementById("negocio-handoff")?.focus();
      return;
    }
    if (faqDraft && (!question.trim() || !answer.trim())) {
      setFaqOpen(true);
      setFieldErrors({ faq: question.trim() ? "Falta la respuesta de la pregunta." : "Falta la pregunta de esa respuesta." });
      // El campo se monta ya abierto el cajón: se espera al siguiente cuadro para enfocarlo.
      requestAnimationFrame(() => document.getElementById(question.trim() ? "faq-answer" : "faq-question")?.focus());
      return;
    }
    setFieldErrors({});
    setStatus("saving");
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
    if (hours?.dirty) {
      const result = await hours.save();
      if (!result.ok) failures.push(`Horario de respuesta: ${result.message}`);
    }
    if (faqDraft) {
      const result = await postKbEntry({ kind: "qa", question, answer });
      // Si no se guardó, la pregunta y la respuesta se quedan en el campo.
      if (result.ok) {
        setQuestion("");
        setAnswer("");
      } else {
        failures.push(`Pregunta frecuente: ${result.message}`);
      }
    }

    await onChanged();
    if (failures.length) {
      setErrors(failures);
      setStatus("idle");
      return;
    }
    setStatus("saved");
  }

  async function removeFaq(id: string) {
    setRemoveError(null);
    const result = await saveResult(() => fetch(`/api/kb/${id}`, { method: "DELETE" }));
    if (!result.ok) {
      setRemoveError(result.message);
      return;
    }
    await onChanged();
  }

  const next = progress?.steps.find((step) => !step.done && step.key !== "whatsapp" && step.key !== "negocio");
  const negocioDone = progress?.steps.find((step) => step.key === "negocio")?.done ?? false;
  const busy = status === "saving";

  return (
    <Card id="negocio" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Tu negocio</CardTitle>
        <CardDescription>
          Escribe lo que le dirías a un cliente nuevo. Tu agente responde solo con esto: lo que no esté aquí, no lo inventa.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
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
              disabled={busy}
              onChange={(event) => edit(field.key, event.target.value)}
            />
            <p id={`negocio-${field.key}-hint`} className="text-xs text-text-3">
              {field.hint}
            </p>
          </div>
        ))}

        {hours && (
          <HorarioRespuesta
            hours={hours}
            brandName={brandName}
            open={hoursOpen}
            onOpenChange={onHoursOpenChange}
            disabled={busy}
          />
        )}

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="negocio-handoff">Cuándo pasar con una persona</Label>
            {isSuggestedHandoff(handoff) && <Badge variant="secondary">Sugerencia</Badge>}
          </div>
          <GrowingTextarea
            id="negocio-handoff"
            rows={3}
            maxLength={4000}
            className="resize-y break-words"
            aria-invalid={fieldErrors.handoff ? true : undefined}
            aria-describedby={fieldErrors.handoff ? "negocio-handoff-error negocio-handoff-hint" : "negocio-handoff-hint"}
            value={handoff}
            disabled={busy}
            onChange={(event) => {
              setHandoff(event.target.value);
              setStatus("idle");
              setFieldErrors((prev) => ({ ...prev, handoff: undefined }));
            }}
          />
          {fieldErrors.handoff && (
            <p id="negocio-handoff-error" role="alert" className="text-sm text-danger-text">
              {fieldErrors.handoff}
            </p>
          )}
          <p id="negocio-handoff-hint" className="text-xs text-text-3">
            {isSuggestedHandoff(handoff)
              ? "Es una sugerencia para empezar: cámbiala por lo que de verdad te sirva. Cuando la edites, deja de ser una sugerencia."
              : "En qué casos tu agente deja de responder y te avisa. Ejemplo: cuando pidan un descuento, tengan un reclamo o quieran hablar con alguien."}
          </p>
        </div>

        <section aria-labelledby="faq-title" className="space-y-3 border-t border-border pt-5">
          <div>
            <h4 id="faq-title" className="text-sm font-semibold">
              Preguntas frecuentes{faqs.length > 0 ? ` (${faqs.length})` : ""}
            </h4>
            <p className="mt-1 text-xs leading-5 text-text-3">
              Agrega 2 o 3 que te hagan siempre, con la respuesta que tú darías. Se guardan con el botón de abajo.
            </p>
          </div>

          {faqs.length > 0 && (
            <ul className="space-y-2">
              {faqs.map((faq) => (
                <li key={faq.id} className="flex items-start gap-2 rounded-md border border-border p-3">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="break-words font-medium">{faq.question}</p>
                    <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-text-2">{faq.answer}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    aria-label={`Quitar la pregunta: ${faq.question ?? ""}`}
                    onClick={() => void removeFaq(faq.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {removeError && (
            <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
              {removeError}
            </p>
          )}

          <details
            open={faqOpen}
            onToggle={(event) => setFaqOpen(event.currentTarget.open)}
            className="group rounded-md border border-dashed border-border-strong"
          >
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-text-2 [&::-webkit-details-marker]:hidden">
              <span>{faqs.length > 0 ? "Agregar otra pregunta" : "Escribir una pregunta"}</span>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-text-3 transition-transform group-open:rotate-90 motion-reduce:transition-none"
                aria-hidden="true"
              />
            </summary>
            <div className="space-y-3 border-t border-dashed border-border-strong p-3">
              <div className="space-y-1.5">
                <Label htmlFor="faq-question">Pregunta</Label>
                <Input
                  id="faq-question"
                  className="min-h-11"
                  maxLength={500}
                  placeholder="Ej. ¿Hacen entregas a domicilio?"
                  aria-invalid={fieldErrors.faq && !question.trim() ? true : undefined}
                  aria-describedby={fieldErrors.faq && !question.trim() ? "faq-error" : undefined}
                  value={question}
                  disabled={busy}
                  onChange={(event) => {
                    setQuestion(event.target.value);
                    setStatus("idle");
                    setFieldErrors((prev) => ({ ...prev, faq: undefined }));
                  }}
                />
                {fieldErrors.faq && !question.trim() && (
                  <p id="faq-error" role="alert" className="text-sm text-danger-text">
                    {fieldErrors.faq}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="faq-answer">Respuesta</Label>
                <GrowingTextarea
                  id="faq-answer"
                  rows={2}
                  maxLength={4000}
                  className="resize-y break-words"
                  placeholder="Ej. Sí, entregamos en el este de la ciudad. El envío cuesta $3."
                  aria-invalid={fieldErrors.faq && !answer.trim() ? true : undefined}
                  aria-describedby={fieldErrors.faq && !answer.trim() ? "faq-error" : undefined}
                  value={answer}
                  disabled={busy}
                  onChange={(event) => {
                    setAnswer(event.target.value);
                    setStatus("idle");
                    setFieldErrors((prev) => ({ ...prev, faq: undefined }));
                  }}
                />
                {fieldErrors.faq && !answer.trim() && question.trim() && (
                  <p id="faq-error" role="alert" className="text-sm text-danger-text">
                    {fieldErrors.faq}
                  </p>
                )}
              </div>
            </div>
          </details>
        </section>

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
          <Button type="button" className="min-h-11 w-full sm:w-auto" disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? (
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
