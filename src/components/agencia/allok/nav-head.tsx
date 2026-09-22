"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { STATE_LABEL } from "@/lib/estado";
import { AllokWordmark, StateDot } from "./mark";
import { useSystemState } from "./system-state";

/**
 * Cabecera de la barra lateral del SaaS: la casa firma arriba (`all ● k`, con
 * el punto en el estado real) y debajo el negocio con su número de WhatsApp —
 * el mismo encabezado que el centro de control de allok.fun. Si hay algo que
 * hacer, la tarjeta lleva a donde se resuelve.
 */
export function AllokNavHead({ businessName }: { businessName: string }) {
  const snapshot = useSystemState();
  if (!snapshot) return null;
  const { state, reason, href, whatsapp } = snapshot;

  const body = (
    <>
      <span className="flex items-center gap-2" data-state={state}>
        <StateDot state={state} size={7} decorative />
        <span className="text-[12.5px] font-semibold text-[var(--st-ink)]">{STATE_LABEL[state]}</span>
        {href && <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-text-3" strokeWidth={1.8} aria-hidden />}
      </span>
      <span className="mt-2.5 block truncate text-[13.5px] font-semibold leading-tight text-foreground">
        {businessName}
      </span>
      <span className="mt-1 block truncate font-mono text-[11px] text-text-3">
        {whatsapp.phone ?? "WhatsApp sin conectar"}
      </span>
      <span className="mt-2.5 block border-t pt-2.5 text-[12px] leading-snug text-text-2">{reason}</span>
    </>
  );

  return (
    <div className="min-w-0 flex-1">
      <AllokWordmark state={state} size={26} className="ml-0.5 text-foreground" />
      {href ? (
        <Link
          href={href}
          className="mt-5 block rounded-md border bg-background p-3 transition-colors hover:border-border-strong"
        >
          {body}
        </Link>
      ) : (
        <div className="mt-5 rounded-md border bg-background p-3">{body}</div>
      )}
    </div>
  );
}

/** La marca en la barra superior del móvil: el mismo punto, más chico. */
export function AllokShellBrand() {
  const snapshot = useSystemState();
  if (!snapshot) return null;
  return <AllokWordmark state={snapshot.state} size={21} className="text-foreground" />;
}
