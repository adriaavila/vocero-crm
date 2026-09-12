"use client";

import { signOut } from "@/lib/auth/client";
import { ArrowRight, LockKeyhole } from "lucide-react";

export default function MemberAccessPausedPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-subtle px-5 py-10">
      <section className="w-full max-w-md rounded-2xl border bg-background p-7 text-center shadow-md sm:p-9">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-tint text-brand-text">
          <LockKeyhole className="h-5 w-5" aria-hidden="true" />
        </span>
        <p className="kicker mt-6">Acceso del equipo pausado</p>
        <h1 className="mt-2 text-2xl font-[700] tracking-tight">El negocio está en Básico</h1>
        <p className="mt-3 text-sm leading-6 text-text-2">
          Los datos y conversaciones siguen guardados. El propietario puede reactivar Pro para devolver el acceso a los miembros del equipo.
        </p>
        <button type="button" onClick={async () => { await signOut(); window.location.assign("/login"); }} className="mt-7 inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-hover">
          Cerrar sesión <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </section>
    </main>
  );
}
