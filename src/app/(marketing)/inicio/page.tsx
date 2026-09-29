import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarCheck, KanbanSquare, MessagesSquare } from "lucide-react";
import { contactHref, productName } from "@/lib/marketing";

export const metadata: Metadata = {
  title: `${productName()} — Tu WhatsApp responde aunque estés en una visita`,
  description:
    "Rei CRM conecta tu WhatsApp con tu catálogo: venta, alquiler y anticrético. El agente responde, agenda visitas y avisa a tu equipo.",
};

const STEPS = [
  {
    title: "Conecta tu WhatsApp",
    detail: "El número que ya usas, con la API oficial de WhatsApp Business. Sin cambiar nada para tus clientes.",
  },
  {
    title: "Carga tu catálogo",
    detail: "Propiedades en venta, alquiler o anticrético: zona, precio, dormitorios y fotos. El agente solo ofrece lo que existe ahí.",
  },
  {
    title: "El agente atiende y agenda",
    detail: "Responde consultas, califica al interesado y agenda la visita. Lo que no sabe, lo pasa a tu equipo.",
  },
];

const FEATURES = [
  {
    icon: MessagesSquare,
    title: "Una bandeja para todo el equipo",
    detail: "Cada conversación con su historial, sin importar quién de tu equipo la tome.",
  },
  {
    icon: KanbanSquare,
    title: "El embudo de tus leads",
    detail: "De la primera consulta a la visita agendada: qué etapa avanza y qué parte se estanca.",
  },
  {
    icon: CalendarCheck,
    title: "Visitas sin ida y vuelta",
    detail: "El agente propone horarios sobre tu disponibilidad real y confirma por WhatsApp.",
  },
];

export default function InicioPage() {
  return (
    <div>
      <section className="mx-auto max-w-5xl px-5 pb-16 pt-20 sm:pt-28">
        <p className="kicker">CRM de WhatsApp para inmobiliarias</p>
        <h1 className="mt-4 max-w-2xl text-[clamp(2.1rem,5vw,3.4rem)] font-semibold leading-[1.08] tracking-tight">
          Tu WhatsApp responde aunque estés en una visita
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-text-2">
          {productName()} conecta tu catálogo de venta, alquiler y anticrético con
          tu WhatsApp. El agente contesta, califica al interesado y agenda la
          visita; tú ves lo que pasó y decides cuándo entrar.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a
            href={contactHref(`Hola, quiero un agente de WhatsApp para mi inmobiliaria.`)}
            className="rei-press inline-flex h-11 items-center justify-center gap-2 rounded-md bg-brand px-6 font-medium text-brand-fg shadow-sm hover:bg-brand-hover"
          >
            Escribir por WhatsApp <ArrowRight className="h-4 w-4" aria-hidden />
          </a>
          <Link
            href="/precios"
            className="rei-press inline-flex h-11 items-center justify-center rounded-md border border-border-strong px-6 font-medium hover:bg-bg-hover"
          >
            Ver precios
          </Link>
        </div>
      </section>

      <section id="como-funciona" className="border-t border-border bg-subtle py-16">
        <div className="mx-auto max-w-5xl px-5">
          <p className="kicker">Cómo funciona</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">Tres pasos, no siete</h2>
          <div className="rei-stagger-auto mt-10 grid gap-6 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <div key={step.title} className="rei-reveal">
                <span className="font-mono text-sm text-brand-text">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-text-2">{step.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-5xl px-5">
          <p className="kicker">Lo que trae</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">Todo lo que un lead necesita</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="rei-lift rounded-lg border border-border bg-background p-6 shadow-sm">
                <feature.icon className="h-5 w-5 text-brand-text" aria-hidden />
                <h3 className="mt-4 text-base font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-2">{feature.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-subtle py-16">
        <div className="mx-auto flex max-w-5xl flex-col items-start gap-5 px-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">¿Empezamos con tu inmobiliaria?</h2>
            <p className="mt-2 max-w-md text-[15px] leading-relaxed text-text-2">
              Nos cuentas qué vendes y a qué hora atiendes, y dejamos tu agente
              andando con tu número de siempre.
            </p>
          </div>
          <a
            href={contactHref(`Hola, quiero un agente de WhatsApp para mi inmobiliaria.`)}
            className="rei-press inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-brand px-6 font-medium text-brand-fg shadow-sm hover:bg-brand-hover"
          >
            Escribir por WhatsApp <ArrowRight className="h-4 w-4" aria-hidden />
          </a>
        </div>
      </section>
    </div>
  );
}
