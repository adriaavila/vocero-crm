"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Info } from "lucide-react";
import { StateDot } from "@/components/agencia/allok/mark";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { haceTexto } from "@/lib/hace";
import { META_PAYMENT_URL } from "@/lib/onboarding-errors";
import type { SystemState } from "@/lib/estado";
import { cn } from "@/lib/utils";
import type { SetupProgress } from "@/server/agencia/setup-progress";

/**
 * Capa de agencia: el número conectado, en UNA tarjeta.
 *
 * Antes eran dos tarjetas (el aviso verde «Número conectado» y el formulario
 * de credenciales debajo) y, aunque todo estuviera bien, la pantalla seguía
 * pidiendo IDs y un token. Aquí el número y TRES hechos por separado, cada uno
 * con su evidencia: vinculado, recibimos mensajes y enviamos respuestas. Que un
 * número esté vinculado no prueba que lleguen mensajes, ni que una respuesta
 * llegue al cliente; «por verificar» es honesto y no es un error.
 */

export type ConnectionEvidence = {
  connectedAt: string | null;
  lastInboundAt: string | null;
  lastDeliveredAt: string | null;
};

type Line = {
  label: string;
  /** Hora del hecho, o null si todavía no hay prueba. */
  at: string | null;
  /** Qué hacer para verificarlo cuando todavía no hay prueba. */
  hint: ReactNode;
  /** Texto cuando no hay hora pero el hecho es cierto (el número vinculado). */
  verifiedWord?: string;
  verified: boolean;
};

function EvidenceLine({ line, now }: { line: Line; now: Date }) {
  const state: SystemState = line.verified ? "activo" : "pausado";
  const word = line.verified ? (line.at ? haceTexto(line.at, now) : (line.verifiedWord ?? "Listo")) : "Por verificar";
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-medium">{line.label}</span>
        <span className="inline-flex items-center gap-2 text-sm text-text-2">
          <StateDot state={state} size={8} decorative />
          <span className={cn(line.verified && "text-foreground")}>{word}</span>
        </span>
      </div>
      {!line.verified && <p className="mt-1 text-xs leading-5 text-text-3">{line.hint}</p>}
    </li>
  );
}

const NEXT_LABEL: Record<string, string> = {
  negocio: "Seguir: cuéntanos de tu negocio",
  probar: "Seguir: probar tu agente",
  activar: "Seguir: activar tu agente",
};

/** El siguiente paso de la puesta en marcha, o abrir las conversaciones si ya está en marcha. */
export function nextAction(progress: SetupProgress | null): { href: string; label: string } {
  const next = progress?.active ? progress.steps.find((step) => !step.done && step.key !== "whatsapp") : null;
  if (!next) return { href: "/inbox", label: "Abrir conversaciones" };
  return { href: next.href, label: NEXT_LABEL[next.key] ?? "Seguir" };
}

export function ConnectionCard({
  number,
  businessName,
  evidence,
  progress,
  changeNumberHref,
  notice,
  footer,
  now = new Date(),
}: {
  number: string;
  businessName: string | null;
  evidence: ConnectionEvidence | null;
  progress: SetupProgress | null;
  /** Para conectar otro número; sin esto no se ofrece. */
  changeNumberHref?: string | null;
  /** Aviso de Meta sobre el nombre visible. */
  notice?: ReactNode;
  footer?: ReactNode;
  now?: Date;
}) {
  const lines: Line[] = [
    {
      label: "Número vinculado",
      at: evidence?.connectedAt ?? null,
      verified: true,
      verifiedWord: "Conectado",
      hint: null,
    },
    {
      label: "Recibimos mensajes",
      at: evidence?.lastInboundAt ?? null,
      verified: Boolean(evidence?.lastInboundAt),
      hint: "Escríbele a este número desde otro teléfono, no desde el del negocio. Aparece aquí cuando llegue.",
    },
    {
      label: "Enviamos respuestas",
      at: evidence?.lastDeliveredAt ?? null,
      verified: Boolean(evidence?.lastDeliveredAt),
      hint: (
        <>
          Se confirma cuando WhatsApp entrega una respuesta a un cliente. Puedes responder tú desde{" "}
          <Link href="/inbox" className="font-medium text-foreground underline-offset-2 hover:underline">
            Conversaciones
          </Link>
          .
        </>
      ),
    },
  ];
  const next = nextAction(progress);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="kicker">Tu número</p>
            <CardTitle className="mt-1 break-words text-xl font-[680] tabular-nums">{number}</CardTitle>
            {businessName && <p className="mt-1 break-words text-sm text-text-2">{businessName}</p>}
          </div>
          <span className="inline-flex items-center gap-2 text-sm font-medium">
            <StateDot state="activo" size={8} decorative />
            Conectado
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <ul aria-live="polite" className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {lines.map((line) => (
            <EvidenceLine key={line.label} line={line} now={now} />
          ))}
        </ul>
        {notice && <p className="text-sm leading-6 text-text-3">{notice}</p>}
        {changeNumberHref && (
          <p className="flex items-start gap-2 text-xs leading-5 text-text-3">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Para escribirle tú primero a un cliente (plantillas), Meta pide un método de pago en tu cuenta.{" "}
              <a href={META_PAYMENT_URL} target="_blank" rel="noreferrer" className="font-medium text-foreground underline-offset-2 hover:underline">
                Agrégalo aquí
              </a>
              .
            </span>
          </p>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link href={next.href} className={buttonVariants({ className: "min-h-11 w-full sm:w-auto" })}>
            {next.label}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          {changeNumberHref && (
            <a
              href={changeNumberHref}
              className="inline-flex min-h-11 items-center text-sm font-medium text-text-2 underline-offset-2 hover:underline"
            >
              ¿Número equivocado? Conecta otro
            </a>
          )}
        </div>
        {footer}
      </CardContent>
    </Card>
  );
}
