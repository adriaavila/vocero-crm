import type { Metadata } from "next";
import { contactHref, plans, productName } from "@/lib/marketing";

export const metadata: Metadata = {
  title: `Precios de ${productName()}`,
  description: "Un plan de autoservicio en dólares, o una instancia dedicada a convenir.",
};

const FAQ = [
  {
    q: "¿Qué pasa si quiero mi propio dominio?",
    a: "Es la instancia dedicada. Corre aparte, con su base de datos, en tu dominio y sin rastro de nuestra marca en ninguna pantalla que vea tu cliente.",
  },
  {
    q: "¿Necesito un número nuevo de WhatsApp?",
    a: "No. Se conecta el que ya usas, con la API oficial de WhatsApp Business.",
  },
  {
    q: "¿El agente puede inventar un precio?",
    a: "No. Responde solo con lo que hay en tu catálogo, y cuando no sabe algo lo pasa a una persona. Es la regla que más nos importa.",
  },
  {
    q: "¿Hay prueba gratis o permanencia?",
    a: "No hay prueba gratis: el plan Agencia empieza a cobrarse desde el primer mes. Tampoco hay permanencia: es mes a mes, y tus datos son tuyos, te los llevas cuando quieras.",
  },
];

export default function PricingPage() {
  const items = plans();
  return (
    <div className="mx-auto max-w-5xl px-5 pb-20 pt-16">
      <p className="kicker">Precios</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">En dólares, mes a mes</h1>
      <p className="mt-4 max-w-xl text-lg leading-relaxed text-text-2">
        Sin prueba gratis y sin costo de alta: el plan empieza a trabajar desde
        el primer día. Sin permanencia: si no te sirve, te vas y te llevas tus
        datos.
      </p>

      <div className="mt-12 grid gap-5 sm:grid-cols-2">
        {items.map((plan) => (
          <div
            key={plan.id}
            className={`rei-lift flex flex-col rounded-lg border p-6 ${
              plan.featured ? "border-brand bg-brand-tint shadow-md" : "border-border bg-background shadow-sm"
            }`}
          >
            <h2 className="text-lg font-semibold">{plan.name}</h2>
            <p className="mt-1.5 min-h-[40px] text-sm leading-relaxed text-text-2">{plan.tagline}</p>

            <p className="mt-6 flex items-baseline gap-2">
              {plan.price === null ? (
                <span className="font-mono text-[34px] leading-none tabular-nums">A convenir</span>
              ) : (
                <>
                  <span className="font-mono text-[46px] leading-none tabular-nums">${plan.price}</span>
                  <span className="text-sm text-text-3">USD</span>
                </>
              )}
            </p>
            {plan.price !== null && <p className="mt-1 text-sm text-text-3">{plan.period}</p>}

            <ul className="mt-6 flex-1 space-y-2.5 text-[15px]">
              {plan.features.map((feature) => (
                <li key={feature} className="flex gap-2.5 leading-relaxed">
                  <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brand" />
                  <span className="text-text-2">{feature}</span>
                </li>
              ))}
            </ul>

            <a
              href={contactHref(`Hola, me interesa el plan ${plan.name} de ${productName()}`)}
              className={`rei-press mt-7 inline-flex h-11 items-center justify-center rounded-md px-5 font-medium transition-colors ${
                plan.featured
                  ? "bg-brand text-brand-fg shadow-sm hover:bg-brand-hover"
                  : "border border-border-strong hover:bg-bg-hover"
              }`}
            >
              {plan.cta}
            </a>
          </div>
        ))}
      </div>

      <p className="mt-6 text-sm text-text-3">Los impuestos que correspondan a tu país van aparte.</p>

      <section className="mt-20">
        <hr className="mb-10 border-border" />
        <h2 className="text-2xl font-semibold tracking-tight">Preguntas</h2>
        <dl className="mt-8 grid gap-x-10 gap-y-7 sm:grid-cols-2">
          {FAQ.map((item) => (
            <div key={item.q}>
              <dt className="font-medium">{item.q}</dt>
              <dd className="mt-1.5 text-[15px] leading-relaxed text-text-2">{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
