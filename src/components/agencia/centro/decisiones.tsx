"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { StateDot } from "@/components/agencia/allok/mark";
import { useToast } from "@/components/ui/toast-provider";
import {
  DECISION_FILTERS,
  FILTER_LABEL,
  decisionMeta,
  decisionTrail,
  handoffPlain,
  whenLabel,
  type DecisionFilter,
} from "@/lib/decisiones";
import { cn } from "@/lib/utils";
import type { DecisionDto } from "@/server/agencia/decisions-read";

type Row = DecisionDto & { contactId: string | null };
type Verdict = "bien" | "fallo" | null;

const NOTE_MAX = 500;

const EMPTY: Record<DecisionFilter, { title: string; body: string }> = {
  todas: {
    title: "Todavía no hay decisiones",
    body: "Cada vez que el agente conteste una conversación real aparece aquí, con lo que hizo, para que lo califiques. Las pruebas del laboratorio no cuentan.",
  },
  "sin-revisar": { title: "No hay nada sin revisar", body: "Todo lo que el agente ha hecho ya tiene su Bien o su Falló." },
  fallos: { title: "No marcaste ningún fallo", body: "Cuando algo salga mal, márcalo con Falló y queda aquí para corregirlo." },
};

const btn =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border px-3.5 text-[13.5px] font-semibold transition-[border-color,background-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [@media(pointer:fine)]:min-h-9";

/**
 * «Cómo decidió el agente»: la revisión diaria de sus turnos, hecha para ser
 * rápida con el teclado. j/k mueven, b marca Bien, f marca Falló (y abre la
 * nota, opcional), u deshace. Cada marca es optimista: se ve al instante y, si
 * la API falla, vuelve atrás y lo dice en la fila.
 */
export function DecisionesClient({
  initial,
  nextCursor,
  filter,
  conversationId,
  onFirstPage,
  canJudge,
  timezone,
  productLabel,
}: {
  initial: Row[];
  nextCursor: string | null;
  filter: DecisionFilter;
  /** Si viene, solo los turnos de esa conversación (sin filtros). */
  conversationId: string | null;
  onFirstPage: boolean;
  canJudge: boolean;
  timezone: string;
  productLabel: string;
}) {
  const notify = useToast();
  const [rows, setRows] = useState<Row[]>(initial);
  const [activeId, setActiveId] = useState<string | null>(initial[0]?.id ?? null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  // Si la API dice que no eres el propietario, se esconden los botones.
  const [forbidden, setForbidden] = useState(false);
  const judge = canJudge && !forbidden;
  // Una respuesta vieja que llega tarde no pisa a una marca más nueva de la misma fila.
  const seq = useRef<Record<string, number>>({});
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const noteInput = useRef<HTMLInputElement | null>(null);
  // Lo que se lleva escrito en la nota de cada fila: si guardar falla, no se pierde.
  const drafts = useRef<Record<string, string>>({});
  const now = useRef(new Date());

  const patchRow = useCallback((id: string, patch: Partial<Row>) => {
    setRows((current) => current.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const focusRow = useCallback((id: string | null) => {
    setActiveId(id);
    if (!id) return;
    const el = refs.current[id];
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest" });
  }, []);

  const move = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      const at = rows.findIndex((r) => r.id === activeId);
      const next = Math.min(rows.length - 1, Math.max(0, (at < 0 ? 0 : at) + delta));
      focusRow(rows[next]?.id ?? null);
    },
    [rows, activeId, focusRow],
  );

  const mark = useCallback(
    async (id: string, verdict: Verdict, note?: string) => {
      const before = rows.find((r) => r.id === id);
      if (!before) return;
      const mine = (seq.current[id] = (seq.current[id] ?? 0) + 1);
      const optimistic = { verdict, verdictNote: verdict === "fallo" ? (note?.trim() || null) : null };
      patchRow(id, optimistic);
      setPending((p) => ({ ...p, [id]: true }));
      setErrors(({ [id]: _drop, ...rest }) => rest);
      const rollback = (message: string) => {
        patchRow(id, { verdict: before.verdict, verdictNote: before.verdictNote });
        // Si falló la marca y no hay nada escrito, la nota no tiene a qué colgarse; si hay
        // un borrador (o falló guardar la nota), se queda abierta para no perderlo.
        if (before.verdict !== "fallo" && !drafts.current[id]?.trim()) setNoteFor((open) => (open === id ? null : open));
        focusRow(id);
        setErrors((e) => ({ ...e, [id]: message }));
        notify(message, "error");
      };
      try {
        const res = await fetch(`/api/decisions/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(verdict === "fallo" && note?.trim() ? { verdict, note: note.trim() } : { verdict }),
        });
        if (mine !== seq.current[id]) return;
        if (res.status === 403) {
          setForbidden(true);
          setNoteFor(null);
          return rollback("Solo el propietario puede calificar.");
        }
        if (!res.ok) return rollback("No se guardó tu calificación. Intenta de nuevo.");
        const json = (await res.json()) as { decision: { verdict: Verdict; verdictNote: string | null; verdictAt: string | null; verdictBy: string | null } };
        patchRow(id, json.decision);
      } catch {
        if (mine === seq.current[id]) rollback("No se guardó: no hay conexión. Intenta de nuevo.");
      } finally {
        if (mine === seq.current[id]) setPending(({ [id]: _drop, ...rest }) => rest);
      }
    },
    [rows, patchRow, notify, focusRow],
  );

  // El teclado: no compite con quien escribe una nota ni con atajos del navegador.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const id = activeId;
      switch (e.key) {
        case "j":
          e.preventDefault();
          return move(1);
        case "k":
          e.preventDefault();
          return move(-1);
        case "b":
          if (!judge || !id) return;
          e.preventDefault();
          void mark(id, "bien");
          return move(1);
        case "f":
          if (!judge || !id) return;
          e.preventDefault();
          // Ya marcada: solo se abre la nota (volver a marcar la borraría).
          if (rows.find((r) => r.id === id)?.verdict !== "fallo") void mark(id, "fallo");
          return setNoteFor(id);
        case "u":
          if (!judge || !id) return;
          e.preventDefault();
          setNoteFor(null);
          return void mark(id, null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, judge, mark, move, rows]);

  useEffect(() => {
    if (noteFor) noteInput.current?.focus();
  }, [noteFor]);

  const total = rows.length;
  const unreviewed = rows.filter((r) => !r.verdict).length;
  const href = (f: DecisionFilter, cursor?: string) => {
    const qs = new URLSearchParams();
    if (f !== "todas") qs.set("f", f);
    if (conversationId) qs.set("c", conversationId);
    if (cursor) qs.set("cursor", cursor);
    const q = qs.toString();
    return q ? `/decisiones?${q}` : "/decisiones";
  };

  return (
    <div className="h-full overflow-y-auto bg-subtle">
      <div className="mx-auto w-full max-w-[960px] px-4 pb-24 pt-6 md:px-8 md:pt-10">
        <Link href="/overview" className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-text-2 hover:text-foreground [@media(pointer:fine)]:min-h-0">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Inicio
        </Link>
        <header className="mt-3">
          <p className="kicker">El agente</p>
          <h1 className="mt-2 text-[30px] font-semibold leading-[1.05] tracking-[-0.035em] md:text-[38px]">Cómo decidió</h1>
          <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-text-2">
            Cada turno de {productLabel} en conversaciones reales. {judge ? "Califícalo con Bien o Falló: lo que falla es lo que se corrige." : "Solo el propietario califica."}
          </p>
        </header>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          {conversationId ? (
            <Link href="/decisiones" className="inline-flex min-h-11 items-center gap-1.5 text-[13.5px] font-medium text-text-2 hover:text-foreground [@media(pointer:fine)]:min-h-9">
              <ArrowLeft className="h-4 w-4" aria-hidden /> Solo esta conversación · ver todas
            </Link>
          ) : (
          <nav aria-label="Filtro" className="inline-flex rounded-[10px] border bg-background p-0.5">
            {DECISION_FILTERS.map((f) => (
              <Link
                key={f}
                href={href(f)}
                aria-current={f === filter ? "true" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-[8px] px-3.5 text-[13px] font-medium transition-colors [@media(pointer:fine)]:min-h-9",
                  f === filter ? "bg-foreground text-background" : "text-text-2 hover:text-foreground",
                )}
              >
                {FILTER_LABEL[f]}
              </Link>
            ))}
          </nav>
          )}
          {total > 0 && (
            <p className="font-mono text-[11.5px] text-text-3">
              {total} {total === 1 ? "turno" : "turnos"}
              {filter === "todas" ? ` · ${unreviewed} sin revisar` : ""}
            </p>
          )}
        </div>

        {judge && total > 0 && (
          <p className="mt-3 hidden font-mono text-[11px] text-text-3 md:block">
            <Kbd>j</Kbd>/<Kbd>k</Kbd> mover · <Kbd>b</Kbd> bien · <Kbd>f</Kbd> falló · <Kbd>u</Kbd> deshacer
          </p>
        )}

        {total === 0 ? (
          <div className="mt-6 flex items-start gap-3 rounded-lg border bg-background px-5 py-5">
            <StateDot state="pausado" size={10} decorative className="mt-1.5" />
            <div>
              <h2 className="text-[15px] font-semibold">{EMPTY[filter].title}</h2>
              <p className="mt-1 max-w-[56ch] text-[14px] leading-relaxed text-text-2">{EMPTY[filter].body}</p>
            </div>
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {rows.map((row) => (
              <li key={row.id}>
                <DecisionRow
                  row={row}
                  active={row.id === activeId}
                  judge={judge}
                  timezone={timezone}
                  now={now.current}
                  pending={Boolean(pending[row.id])}
                  error={errors[row.id]}
                  noteOpen={noteFor === row.id}
                  setRef={(el) => {
                    refs.current[row.id] = el;
                  }}
                  noteRef={noteInput}
                  onActivate={() => setActiveId(row.id)}
                  onMark={(verdict) => {
                    setActiveId(row.id);
                    if (verdict === "fallo") setNoteFor(row.id);
                    else setNoteFor(null);
                    void mark(row.id, verdict);
                  }}
                  onDraft={(v) => {
                    drafts.current[row.id] = v;
                  }}
                  onOpenNote={() => {
                    setActiveId(row.id);
                    setNoteFor(row.id);
                  }}
                  onSaveNote={(note) => {
                    setNoteFor(null);
                    void mark(row.id, "fallo", note);
                    focusRow(row.id);
                  }}
                  onCloseNote={() => {
                    setNoteFor(null);
                    focusRow(row.id);
                  }}
                />
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          {!onFirstPage ? (
            <Link href={href(filter)} className="inline-flex min-h-11 items-center gap-1.5 text-[13.5px] font-medium text-text-2 hover:text-foreground">
              <ArrowLeft className="h-4 w-4" aria-hidden /> Volver a las más nuevas
            </Link>
          ) : (
            <span />
          )}
          {nextCursor && (
            <Link href={href(filter, nextCursor)} className="inline-flex min-h-11 items-center gap-1.5 text-[13.5px] font-medium text-text-2 hover:text-foreground">
              Ver anteriores <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="rounded border border-border-strong px-1.5 py-px font-mono text-[10.5px] text-foreground">{children}</kbd>
);

function DecisionRow({
  row,
  active,
  judge,
  timezone,
  now,
  pending,
  error,
  noteOpen,
  setRef,
  noteRef,
  onActivate,
  onMark,
  onDraft,
  onOpenNote,
  onSaveNote,
  onCloseNote,
}: {
  row: Row;
  active: boolean;
  judge: boolean;
  timezone: string;
  now: Date;
  pending: boolean;
  error: string | undefined;
  noteOpen: boolean;
  setRef: (el: HTMLElement | null) => void;
  noteRef: React.MutableRefObject<HTMLInputElement | null>;
  onActivate: () => void;
  onMark: (verdict: Verdict) => void;
  onDraft: (value: string) => void;
  onOpenNote: () => void;
  onSaveNote: (note: string) => void;
  onCloseNote: () => void;
}) {
  const [draft, setDraft] = useState(row.verdictNote ?? "");
  useEffect(() => {
    if (noteOpen) setDraft(row.verdictNote ?? "");
  }, [noteOpen, row.verdictNote]);

  const trail = decisionTrail({ action: row.action, steps: row.steps });
  const handoff = handoffPlain(row.handoffReason);
  const meta = decisionMeta(row);
  const who = row.contactName ?? "Sin nombre";

  return (
    <article
      ref={setRef}
      tabIndex={active ? 0 : -1}
      aria-label={`${who}, ${whenLabel(row.createdAt, timezone, now)}`}
      onFocus={onActivate}
      onClick={onActivate}
      className={cn(
        "rounded-lg border bg-background p-4 transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:p-5",
        active ? "border-foreground" : "hover:border-border-strong",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="flex min-w-0 items-baseline gap-3">
          <span suppressHydrationWarning className="shrink-0 font-mono text-[11.5px] text-text-3">
            {whenLabel(row.createdAt, timezone, now)}
          </span>
          {row.contactId ? (
            <Link href={`/inbox?contact=${row.contactId}`} title="Abrir la conversación" className="-my-3 truncate py-3 text-[15px] font-semibold tracking-[-0.01em] hover:underline">
              {who}
            </Link>
          ) : (
            <span className="truncate text-[15px] font-semibold tracking-[-0.01em]">{who}</span>
          )}
        </p>
        <VerdictBadge verdict={row.verdict} />
      </div>

      <dl className="mt-3 grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[14px] leading-snug">
        <Field label="Escribió">{row.triggerPreview ? <span className="text-text-2">{row.triggerPreview}</span> : <span className="text-text-3">Sin texto</span>}</Field>
        <Field label="Hizo">
          <span className="font-medium">{trail}</span>
        </Field>
        {handoff && (
          <Field label="Traspaso">
            <span className="text-text-2">{handoff}</span>
          </Field>
        )}
        {row.replyPreview && (
          <Field label="Contestó">
            <span className="text-text-2">{row.replyPreview}</span>
          </Field>
        )}
      </dl>

      {meta.length > 0 && <p className="mt-3 break-words font-mono text-[11px] text-text-3">{meta.join(" · ")}</p>}

      {row.verdict === "fallo" && row.verdictNote && !noteOpen && (
        <p className="mt-3 rounded-md bg-[var(--ground-2)] px-3 py-2 text-[13.5px] leading-snug text-text-2">
          <span className="kicker mr-2">Nota</span>
          {row.verdictNote}
        </p>
      )}

      {judge && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={row.verdict === "bien"}
            disabled={pending}
            onClick={() => onMark(row.verdict === "bien" ? null : "bien")}
            className={cn(btn, row.verdict === "bien" ? "border-transparent bg-[var(--st-activo-soft)] text-[var(--st-activo-ink)]" : "border-border-strong hover:border-foreground")}
          >
            <Check className="h-4 w-4" aria-hidden /> Bien
          </button>
          <button
            type="button"
            aria-pressed={row.verdict === "fallo"}
            disabled={pending}
            onClick={() => onMark(row.verdict === "fallo" ? null : "fallo")}
            className={cn(btn, row.verdict === "fallo" ? "border-destructive bg-destructive/10 text-destructive-text" : "border-border-strong hover:border-foreground")}
          >
            <X className="h-4 w-4" aria-hidden /> Falló
          </button>
          {row.verdict === "fallo" && !noteOpen && (
            <button type="button" onClick={onOpenNote} className="min-h-11 px-2 text-[13px] font-medium text-text-2 underline-offset-2 hover:text-foreground hover:underline [@media(pointer:fine)]:min-h-9">
              {row.verdictNote ? "Editar nota" : "Añadir nota"}
            </button>
          )}
        </div>
      )}

      {judge && noteOpen && (
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            onSaveNote(draft);
          }}
        >
          <label htmlFor={`nota-${row.id}`} className="sr-only">
            Qué falló (opcional)
          </label>
          <input
            id={`nota-${row.id}`}
            ref={noteRef}
            value={draft}
            maxLength={NOTE_MAX}
            placeholder="¿Qué falló? (opcional)"
            onChange={(e) => {
              setDraft(e.target.value);
              onDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onCloseNote();
              }
            }}
            className="h-11 flex-1 rounded-[10px] border border-input bg-background px-3 text-[15px] placeholder:text-text-3 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft"
          />
          <button type="submit" className={cn(btn, "border-transparent bg-primary text-primary-foreground")}>
            Guardar nota
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-3 text-[13.5px] font-medium text-destructive-text">
          {error}
        </p>
      )}
    </article>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="kicker pt-[3px]">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

/** Estado = punto + palabra. «Falló» no es un estado de la marca: lleva el rojo de los fallos. */
function VerdictBadge({ verdict }: { verdict: Verdict }) {
  if (verdict === "fallo") {
    return (
      <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-destructive-text">
        <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-destructive" /> Falló
      </span>
    );
  }
  const state = verdict === "bien" ? "activo" : "pausado";
  return (
    <span data-state={state} className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-[var(--st-ink)]">
      <StateDot state={state} size={8} decorative /> {verdict === "bien" ? "Bien" : "Sin revisar"}
    </span>
  );
}
