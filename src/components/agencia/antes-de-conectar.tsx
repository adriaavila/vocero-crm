import { Check } from "lucide-react";

/**
 * Capa de agencia: lo que hay que tener a mano ANTES de abrir la ventana de
 * Meta. Quien la abría sin su Facebook o sin el celular de su WhatsApp
 * Business a la mano se quedaba a la mitad, y el «por qué» solo lo decía la
 * ventana del puente, ya con Meta abierto. Tres cosas en palabras de dueño;
 * el detalle de cada modo (número nuevo, coexistencia) lo dice el puente.
 */
const ITEMS: { title: string; detail: string }[] = [
  {
    title: "Tu Facebook.",
    detail: "Entras a Meta con tu cuenta de Facebook y ahí eliges o creas la de tu negocio.",
  },
  {
    title: "El celular con tu WhatsApp Business.",
    detail: "Meta te pide confirmar desde la app. Si tu número está en WhatsApp normal, pásalo antes a WhatsApp Business.",
  },
  {
    title: "Una computadora, si puedes.",
    detail: "La ventana de Meta va mejor ahí; deja el celular al lado y síguela hasta «Finalizar».",
  },
];

export function AntesDeConectar() {
  return (
    <div className="mb-4 rounded-lg border border-brand-soft bg-card p-3 sm:p-4">
      <p className="text-sm font-semibold">Antes de empezar, ten a mano:</p>
      <ul className="mt-2 space-y-2">
        {ITEMS.map((item) => (
          <li key={item.title} className="flex gap-2.5 text-sm leading-5">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-text" aria-hidden="true" />
            <span>
              <span className="font-medium">{item.title}</span> <span className="text-text-2">{item.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
