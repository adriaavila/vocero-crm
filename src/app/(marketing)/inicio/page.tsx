import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarCheck, Clock3, MoonStar, PhoneOff, ShieldCheck, UserRoundCheck } from "lucide-react";
import { contactHref, productName } from "@/lib/marketing";

export const metadata: Metadata = {
  title: `${productName()}: vende tus departamentos por WhatsApp, también de noche`,
  description:
    "Rei contesta a cada interesado en segundos, le muestra las propiedades que le sirven y agenda la visita. Tu equipo va a la visita y a la firma.",
};

/*
  La portada vende visitas, no un CRM: quien firma es el dueño de la
  constructora o de la inmobiliaria, y lo que paga es la plata que hoy se le
  va en mensajes sin responder. Regla de esta página: lo que dice como hecho
  funciona hoy en Rei; lo que se está construyendo va marcado «En
  construcción». Las conversaciones son de ejemplo y lo dicen.
*/

const TRY_MESSAGE = "Hola, quiero probar Rei con mi proyecto. Te paso el brochure o el catálogo.";

const PAINS = [
  {
    icon: MoonStar,
    title: "Te escriben de noche, contestas al otro día",
    detail: "La familia mira casas a las 22:00, después de acostar a los chicos. A la mañana ya le respondió otro.",
  },
  {
    icon: PhoneOff,
    title: "Los leads viven en el celular del vendedor",
    detail: "Si el vendedor se va, se los lleva. Y nadie sabe a quién había que volver a escribirle.",
  },
  {
    icon: Clock3,
    title: "Sabes cómo vas recién cuando llamas a todos",
    detail: "Cuántos escribieron, cuántos visitaron y quién está por reservar, repartido en tres teléfonos.",
  },
];

const STEPS = [
  {
    title: "Nos pasas tu proyecto",
    detail: "El brochure, la lista de precios o tu catálogo. Lo cargamos contigo: tipologías, metros, fotos y formas de pago.",
  },
  {
    title: "Rei habla con tus interesados",
    detail: "Desde tu mismo número de WhatsApp. Contesta en segundos, muestra solo lo que existe en tu catálogo y agenda la visita en tu horario.",
  },
  {
    title: "Tu equipo va a la visita",
    detail: "Cada visita llega con nombre, lo que busca y lo que preguntó. Lo que Rei no sabe, lo pasa a una persona.",
  },
];

const TRUST = [
  {
    icon: ShieldCheck,
    title: "No inventa",
    detail: "Ofrece solo lo que está en tu catálogo, con tus precios y tus reglas comerciales.",
  },
  {
    icon: UserRoundCheck,
    title: "Pasa a tu equipo",
    detail: "Si el cliente pide una persona o pregunta algo que no está cargado, avisa y se aparta.",
  },
  {
    icon: CalendarCheck,
    title: "Probado antes de prenderlo",
    detail: "Lo hacemos conversar con compradores simulados y revisamos cada respuesta antes de que hable con tus clientes.",
  },
];

type Bubble = { from: "them" | "us"; text: string; time: string };

const BUYER_CHAT: Bubble[] = [
  { from: "them", text: "Hola, vi el anuncio de las casas con patio. ¿Qué precio tienen?", time: "23:04" },
  {
    from: "us",
    text: "¡Hola! Tenemos dos casas de 3 dormitorios con patio, desde US$ 68.000. ¿Las buscas para vivir con tu familia?",
    time: "23:04",
  },
  { from: "them", text: "Sí, somos 4. ¿Se puede ir a ver?", time: "23:06" },
  {
    from: "us",
    text: "Claro. Tengo libre el sábado a las 10:00 o a las 11:30 en la obra. ¿Cuál te queda mejor?",
    time: "23:06",
  },
  { from: "them", text: "Sábado 10:00", time: "23:07" },
  { from: "us", text: "Listo, te espera Marcelo el sábado a las 10:00. Te mando la ubicación.", time: "23:07" },
];

const OWNER_CHAT: Bubble[] = [
  { from: "us", text: "¿Cómo vamos esta semana?", time: "20:41" },
  {
    from: "them",
    text: "41 personas escribieron, 12 más que la semana pasada. Rei agendó 6 visitas y 4 ya fueron. Daniela y Jorge piden reservar: llámalos hoy.",
    time: "20:41",
  },
  {
    from: "them",
    text: "Una mejora: 7 personas preguntaron por el estacionamiento y tuve que pasarlas a Marcelo. ¿Agrego la respuesta?",
    time: "20:42",
  },
];

function Chat({ title, bubbles, mine }: { title: string; bubbles: Bubble[]; mine: Bubble["from"] }) {
  return (
    <figure className="w-full max-w-sm rounded-2xl border border-border bg-subtle p-3 shadow-sm">
      <figcaption className="flex items-center justify-between border-b border-border px-1 pb-2 text-[13px]">
        <span className="font-semibold">{title}</span>
        <span className="text-text-3">Ejemplo</span>
      </figcaption>
      <ol className="mt-3 flex flex-col gap-2 text-[14px] leading-snug">
        {bubbles.map((bubble, index) => (
          <li
            key={index}
            className={`max-w-[86%] rounded-xl px-3 py-2 ${
              bubble.from === mine ? "self-end bg-brand-tint" : "self-start bg-background shadow-sm"
            }`}
          >
            {bubble.text}
            <span className="mt-0.5 block text-right text-[11px] tabular-nums text-text-3">{bubble.time}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

const PRIMARY_CTA =
  "rei-press inline-flex h-11 items-center justify-center gap-2 rounded-full bg-brand px-6 font-medium text-brand-fg shadow-sm hover:bg-brand-hover";
const SECONDARY_CTA =
  "rei-press inline-flex h-11 items-center justify-center rounded-full border border-border-strong px-6 font-medium hover:bg-bg-hover";
const SECTION_TITLE = "mt-3 font-serif text-[clamp(1.9rem,4vw,2.6rem)] font-normal italic leading-[1.05] tracking-tight";

export default function InicioPage() {
  const name = productName();
  return (
    <div>
      <section className="mx-auto grid max-w-5xl items-center gap-12 px-5 pb-16 pt-16 sm:pt-24 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <p className="kicker">Para constructoras e inmobiliarias</p>
          <h1 className="mt-4 font-serif text-[clamp(2.5rem,6vw,4.1rem)] font-normal italic leading-[1] tracking-tight">
            Vende tus departamentos por WhatsApp, también a las 11 de la noche.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-text-2">
            {name} contesta a cada interesado en segundos, le muestra las
            propiedades que le sirven y agenda la visita. Tu equipo va a la
            visita y a la firma.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href={contactHref(TRY_MESSAGE)} className={PRIMARY_CTA}>
              Probar {name} con mi proyecto <ArrowRight className="h-4 w-4" aria-hidden />
            </a>
            <Link href="/precios" className={SECONDARY_CTA}>
              Ver precios
            </Link>
          </div>
          <p className="mt-4 max-w-md text-sm text-text-3">
            Mándanos tu brochure o tu catálogo y armamos tu agente con tus
            propiedades, para que chatees con él antes de decidir.
          </p>
        </div>
        <div className="flex justify-center lg:justify-end">
          <Chat title="Un interesado, un martes a la noche" bubbles={BUYER_CHAT} mine="us" />
        </div>
      </section>

      <section className="border-t border-border bg-subtle py-16">
        <div className="mx-auto max-w-5xl px-5">
          <p className="kicker">Lo que cuesta no contestar</p>
          <h2 className={SECTION_TITLE}>Cada mensaje sin responder es una visita que se fue con otro</h2>
          <div className="rei-stagger-auto mt-10 grid gap-5 sm:grid-cols-3">
            {PAINS.map((pain) => (
              <div key={pain.title} className="rei-reveal rounded-2xl border border-border bg-background p-6 shadow-sm">
                <pain.icon className="h-5 w-5 text-brand-text" aria-hidden />
                <h3 className="mt-4 text-base font-semibold">{pain.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-2">{pain.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="como-funciona" className="py-16">
        <div className="mx-auto max-w-5xl px-5">
          <p className="kicker">Cómo funciona</p>
          <h2 className={SECTION_TITLE}>Nos pasas tu proyecto. {name} habla con tus interesados. Tú recibes visitas.</h2>
          <ol className="rei-stagger-auto mt-10 grid gap-8 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="rei-reveal border-t border-border-strong pt-5">
                <span className="font-mono text-xs text-brand-text">Paso {index + 1}</span>
                <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-text-2">{step.detail}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-border bg-subtle py-16">
        <div className="mx-auto grid max-w-5xl items-center gap-12 px-5 lg:grid-cols-[1fr_0.9fr]">
          <div>
            <p className="kicker">Tu gerente de ventas</p>
            <h2 className={SECTION_TITLE}>Pregúntale «¿cómo vamos?» por WhatsApp</h2>
            <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-text-2">
              Sin abrir ningún panel: le escribes a {name} desde tu celular y te
              dice cuántos escribieron, cuántas visitas hubo y a quién llamar hoy.
              Cada lunes a las 8:00 te manda el resumen de la semana, con una
              mejora concreta para tu WhatsApp.
            </p>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-text-2">
              Y cuando hay novedades en tu proyecto, les escribe a los interesados
              de hace meses que todavía buscan casa.
            </p>
            <span className="mt-5 inline-flex items-center rounded-full border border-border-strong px-3 py-1 text-xs font-medium text-text-2">
              En construcción
            </span>
          </div>
          <div className="flex justify-center lg:justify-end">
            <Chat title={`${name} · tu gerente de ventas`} bubbles={OWNER_CHAT} mine="us" />
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-5xl px-5">
          <p className="kicker">Confianza</p>
          <h2 className={SECTION_TITLE}>Tu número, tus clientes, tus reglas</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            {TRUST.map((item) => (
              <div key={item.title} className="rei-lift rounded-2xl border border-border bg-background p-6 shadow-sm">
                <item.icon className="h-5 w-5 text-brand-text" aria-hidden />
                <h3 className="mt-4 text-base font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-2">{item.detail}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 max-w-2xl text-[15px] leading-relaxed text-text-2">
            Se conecta el WhatsApp que ya usas, con la API oficial. El número y la
            cuenta de Meta siguen siendo tuyos, y tus datos te los llevas cuando
            quieras.
          </p>
        </div>
      </section>

      <section className="border-t border-border bg-subtle py-16">
        <div className="mx-auto max-w-5xl px-5">
          <p className="kicker">Después de la entrega</p>
          <h2 className={SECTION_TITLE}>Cuando entregas, REI administra el edificio</h2>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-text-2">
            Expensas, gastos con factura a la vista de cada propietario y el
            cierre del mes, con la administración de edificios de REI. Tus
            compradores reciben un edificio ordenado desde el primer día.
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto flex max-w-5xl flex-col items-start gap-5 px-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-serif text-3xl font-normal italic tracking-tight">¿Probamos con tu proyecto?</h2>
            <p className="mt-2 max-w-md text-[15px] leading-relaxed text-text-2">
              Mándanos el brochure o el catálogo. Armamos tu agente con tus
              propiedades y lo pruebas antes de conectar nada.
            </p>
          </div>
          <a href={contactHref(TRY_MESSAGE)} className={`${PRIMARY_CTA} shrink-0`}>
            Probar {name} con mi proyecto <ArrowRight className="h-4 w-4" aria-hidden />
          </a>
        </div>
      </section>
    </div>
  );
}
