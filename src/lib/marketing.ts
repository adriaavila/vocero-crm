import { brand } from "./brand";
import { isAllokSaaSMode, isSaaSAppHost, tenantSlugFromHost } from "./tenant-host";

/**
 * Lo que dice la superficie pública de Rei (`src/app/(marketing)`). Vive acá y
 * no repartido por las páginas: un precio escrito en dos sitios se corrige en
 * uno. Solo tiene sentido bajo `BRAND=rei`; el portero de `(marketing)/layout.tsx`
 * es quien hace que esas rutas no existan para ninguna otra combinación
 * (`tests/unit/marketing-surface.test.ts` prueba la matriz).
 *
 * Funciones y no consts congeladas a propósito (como `tenant-host.ts`): leen
 * `brand()`/`process.env` en cada llamada, nunca al importar el módulo. Server
 * -only, como `lib/brand.ts`: nunca las importe un componente cliente.
 */

export function productName(): string {
  return brand().productName;
}

/**
 * ¿Esta superficie pública existe para este host? El portero real vive en
 * `(marketing)/layout.tsx`; esta función es la regla, expuesta para poder
 * probar la matriz sin renderizar (sesión, DB…). Todo lo demás — otra marca,
 * fuera del SaaS, el host de un negocio — es 404, nunca el panel de otro.
 */
export function isMarketingHost(host: string | null | undefined): boolean {
  if (brand().id !== "rei") return false;
  if (!isAllokSaaSMode()) return false;
  if (!isSaaSAppHost(host)) return false;
  return !tenantSlugFromHost(host);
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Cómo llegar a un humano de Rei. Sale del entorno porque cambia sin tocar
 * código y porque un número inventado en el repositorio termina en
 * producción. Sin prefijo `NEXT_PUBLIC_` a propósito: solo lo leen
 * componentes de servidor.
 */
export function contact(): {
  whatsapp: string | null;
  email: string | null;
  /** Razón social y domicilio, obligatorios en los textos legales. */
  legalName: string | null;
  legalAddress: string | null;
} {
  return {
    whatsapp: brand().contact.whatsapp,
    email: brand().contact.email,
    legalName: nonEmpty(process.env.LEGAL_NAME),
    legalAddress: nonEmpty(process.env.LEGAL_ADDRESS),
  };
}

export function contactHref(message?: string): string {
  const c = contact();
  if (c.whatsapp) {
    const digits = c.whatsapp.replace(/\D/g, "");
    const text = message ? `?text=${encodeURIComponent(message)}` : "";
    return `https://wa.me/${digits}${text}`;
  }
  if (c.email) {
    const subject = message ? `?subject=${encodeURIComponent(message)}` : "";
    return `mailto:${c.email}${subject}`;
  }
  return demoUrl();
}

/** Dónde vive la demo pública. Configurable: en local no es un subdominio. */
export function demoUrl(): string {
  return nonEmpty(process.env.DEMO_URL) ?? "https://demo.reiprop.tech";
}

export type Plan = {
  id: string;
  name: string;
  tagline: string;
  /** `null` = el precio se conversa. No se inventa un número para rellenar. */
  price: number | null;
  period: string;
  features: string[];
  cta: string;
  featured?: boolean;
};

/**
 * Precios de Rei: un plan de autoservicio (Agencia, con precio real) y uno
 * que se conversa (Dedicada). Constante — no depende del entorno — pero
 * exportada como función por consistencia con el resto del módulo y para que
 * un test pueda importarla sin arrastrar un valor congelado al cargar.
 */
export function plans(): Plan[] {
  return [
    {
      id: "agencia",
      name: "Agencia",
      tagline: "Una inmobiliaria, un número de WhatsApp, todo el equipo adentro.",
      price: 299,
      period: "por mes",
      features: [
        "Tu propio subdominio",
        "Tu número de WhatsApp Business conectado",
        "Agente de IA que responde sobre tu catálogo: venta, alquiler y anticrético",
        "Bandeja compartida con tu equipo, sin límite de usuarios",
        "Catálogo, embudo y visitas",
        "Tu logo y tu color en toda la interfaz",
      ],
      cta: "Empezar",
      featured: true,
    },
    {
      id: "dedicada",
      name: "Dedicada",
      tagline: "Tu propio servidor, tu propia base, tu propio dominio.",
      price: null,
      period: "a convenir",
      features: [
        "Despliegue aparte: nada compartido con nadie",
        "Base de datos exclusiva",
        "Tu dominio, sin rastro de nuestra marca",
        "Acompañamiento en la puesta en marcha",
      ],
      cta: "Hablemos",
    },
  ];
}
