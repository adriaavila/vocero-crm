"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronRight, Loader2, Sparkles, Trash2 } from "lucide-react";
import { HorarioRespuesta, type HoursController } from "@/components/agencia/horario-respuesta";
import { SeguimientoAjuste } from "@/components/agencia/seguimiento-ajuste";
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
 *
 * «Llénalo por mí» es la excepción que confirma la regla: el dueño pega SU
 * texto o el enlace a SU web y un borrador ordena eso en los campos (sin
 * inventar, ver `server/agencia/borrador-negocio-prompt.ts`). Llena solo lo
 * vacío y no guarda nada: el dueño lo lee y guarda con el mismo botón.
 */

type PendingFaq = { pregunta: string; respuesta: string };
type BorradorResponse = { borrador: { oferta: string; precios: string; zona: string; preguntas: PendingFaq[] } };

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
  // Preguntas que trajo el borrador: se guardan con el botón, como todo lo demás.
  const [pendingFaqs, setPendingFaqs] = useState<PendingFaq[]>([]);
  const [drafted, setDrafted] = useState(false);

  const faqDraft = question.trim().length > 0 || answer.trim().length > 0;
  const dirty =
    NEGOCIO_FIELDS.some((f) => draft[f.key].trim() !== savedDraft[f.key]) ||
    handoff.trim() !== savedHandoff.trim() ||
    Boolean(hours?.dirty) ||
    faqDraft ||
    pendingFaqs.length > 0;

  // Lo guardado manda mientras el dueño no haya tocado nada; si ya escribió,
  // una recarga no le pisa el texto.
  useEffect(() => {
    if (!dirty) {
      setDraft(savedDraft);
      setHandoff(savedHandoff);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedDraft, savedHandoff]);

  // Fork (agencia): quien se registró desde su demo de allok.fun llega con
  // `?demo=<slug>`. Si «Tu negocio» está vacío, lo que la demo ya aprendió de
  // su web llena el borrador (sin modelo y sin guardar solo). Una sola vez:
  // el parámetro se quita para que una recarga no lo repita.
  const [demoImport, setDemoImport] = useState<"loading" | "failed" | "done" | null>(null);
  const demoTried = useRef(false);
  useEffect(() => {
    if (demoTried.current) return;
    demoTried.current = true;
    const url = new URL(window.location.href);
    const slug = url.searchParams.get("demo");
    if (!slug) return;
    url.searchParams.delete("demo");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    const empty = NEGOCIO_FIELDS.every((field) => !savedDraft[field.key].trim()) && faqs.length === 0;
    if (!empty) return;
    void (async () => {
      await Promise.resolve();
      setDemoImport("loading");
      const response = await fetch("/api/agent/borrador", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ demo: slug }),
      }).catch(() => null);
      const payload = (await response?.json().catch(() => null)) as Partial<BorradorResponse> | null;
      if (response?.ok && payload?.borrador) {
        applyBorrador(payload.borrador);
        setDemoImport("done");
      } else {
        setDemoImport("failed");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyBorrador(borrador: BorradorResponse["borrador"]) {
    // Solo lo vacío: lo que el dueño ya escribió manda sobre el borrador.
    setDraft((prev) => {
      const next = { ...prev };
      for (const field of NEGOCIO_FIELDS) {
        const text = borrador[field.key]?.trim();
        if (text && !prev[field.key].trim()) next[field.key] = text;
      }
      return next;
    });
    const known = new Set(faqs.map((faq) => (faq.question ?? "").trim().toLowerCase()));
    setPendingFaqs(borrador.preguntas.filter((faq) => !known.has(faq.pregunta.trim().toLowerCase())));
    setDrafted(true);
    setStatus("idle");
  }

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
    const keptFaqs: PendingFaq[] = [];
    for (const faq of pendingFaqs) {
      const result = await postKbEntry({ kind: "qa", question: faq.pregunta, answer: faq.respuesta });
      if (!result.ok) {
        keptFaqs.push(faq);
        failures.push(`Pregunta frecuente: ${result.message}`);
      }
    }
    setPendingFaqs(keptFaqs);
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
    setDrafted(false);
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
        <LlenarPorMi
          // Con el borrador puesto se cierra: lo que sigue es revisar los campos.
          key={drafted ? "con-borrador" : "vacio"}
          startOpen={NEGOCIO_FIELDS.every((field) => !draft[field.key].trim()) && faqs.length === 0}
          disabled={busy}
          onDraft={(borrador) => {
            setDemoImport(null);
            applyBorrador(borrador);
          }}
        />
        {demoImport === "loading" && (
          <p role="status" className="flex items-center gap-2 rounded-md border border-info-soft bg-info-tint px-3 py-2 text-sm text-info-text">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Trayendo lo que tu demo aprendió de tu web…
          </p>
        )}
        {demoImport === "failed" && (
          <p role="status" className="rounded-md border border-border bg-subtle px-3 py-2 text-sm leading-relaxed text-text-2">
            No pudimos traer lo de tu demo. Pega el enlace de tu web en «Llénalo por mí» y lo ordenamos igual.
          </p>
        )}
        {drafted && dirty && (
          <p role="status" className="rounded-md border border-info-soft bg-info-tint px-3 py-2 text-sm leading-relaxed text-info-text">
            {demoImport === "done" ? "Esto es lo que tu demo aprendió de tu web." : "Listo."} Revisa lo que llenamos, corrige lo que haga falta y toca «Guardar mi negocio». Todavía no se guardó nada.
          </p>
        )}
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

        <SeguimientoAjuste disabled={busy} />

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

          {pendingFaqs.length > 0 && (
            <ul className="space-y-2" aria-label="Preguntas del borrador, sin guardar">
              {pendingFaqs.map((faq, index) => (
                <li key={`${faq.pregunta}-${index}`} className="flex items-start gap-2 rounded-md border border-dashed border-border-strong p-3">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="break-words font-medium">{faq.pregunta}</p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-text-2">{faq.respuesta}</p>
                    <p className="mt-1 text-xs text-text-3">Sin guardar</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    aria-label={`Descartar la pregunta: ${faq.pregunta}`}
                    disabled={busy}
                    onClick={() => setPendingFaqs((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
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

/**
 * «Llénalo por mí»: el dueño pega el enlace de su web o lo que diría de su
 * negocio (su bio, su lista de precios) y recibe un borrador de los campos.
 */
function LlenarPorMi({
  startOpen,
  disabled,
  onDraft,
}: {
  startOpen: boolean;
  disabled: boolean;
  onDraft: (borrador: BorradorResponse["borrador"]) => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [fuente, setFuente] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (fuente.trim().length < 3) {
      setError("Pega el enlace de tu web o cuéntanos de tu negocio.");
      return;
    }
    setLoading(true);
    setError(null);
    const response = await fetch("/api/agent/borrador", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ fuente: fuente.trim() }),
    }).catch(() => null);
    const payload = (await response?.json().catch(() => null)) as
      | (BorradorResponse & { error?: undefined })
      | { error?: { message?: string } }
      | null;
    setLoading(false);
    if (!response?.ok || !payload || !("borrador" in payload)) {
      setError(
        (payload && "error" in payload && payload.error?.message) ||
          "No pudimos armar el borrador ahora. Prueba de nuevo o escríbelo abajo.",
      );
      return;
    }
    onDraft(payload.borrador);
    setOpen(false);
    setFuente("");
  }

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group rounded-lg border border-brand-soft bg-brand-tint"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-text" aria-hidden="true" />
          Llénalo por mí
        </span>
        <ChevronRight
          className="h-4 w-4 shrink-0 text-text-3 transition-transform group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </summary>
      <div className="space-y-3 px-4 pb-4">
        <p className="text-sm leading-relaxed text-text-2">
          Pega el enlace de tu página web, o el texto de tu perfil o tu lista de precios. Lo ordenamos en los campos de abajo
          y tú lo revisas antes de guardar.
        </p>
        <Label htmlFor="negocio-fuente" className="sr-only">
          Tu web o lo que dirías de tu negocio
        </Label>
        <GrowingTextarea
          id="negocio-fuente"
          rows={3}
          maxLength={8000}
          className="resize-y break-words bg-background"
          placeholder="Ej. miclinica.com  ·  o: Somos una clínica dental en Polanco. Limpieza $600, blanqueamiento $2,500…"
          value={fuente}
          disabled={disabled || loading}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "negocio-fuente-error" : undefined}
          onChange={(event) => {
            setFuente(event.target.value);
            setError(null);
          }}
        />
        {error && (
          <p id="negocio-fuente-error" role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        )}
        <Button type="button" className="min-h-11 w-full sm:w-auto" disabled={disabled || loading} onClick={() => void run()}>
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Leyendo tu negocio…
            </>
          ) : (
            "Llenar por mí"
          )}
        </Button>
      </div>
    </details>
  );
}
