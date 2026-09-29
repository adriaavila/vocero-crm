import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isMarketingHost, productName } from "@/lib/marketing";

/**
 * La superficie pública de Rei, y solo en el host de alta (crm.reiprop.tech).
 *
 * El 404 es la regla, no una cortesía: `isMarketingHost` (lib/marketing.ts)
 * ya descarta otra marca, fuera del SaaS y el host de un negocio — acá solo
 * queda aplicarlo. `tests/unit/marketing-surface.test.ts` prueba la matriz.
 */
const NAV = [
  { href: "/precios", label: "Precios" },
  { href: "/#como-funciona", label: "Cómo funciona" },
];

export default async function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!isMarketingHost(host)) notFound();
  const name = productName();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
          <Link href="/" className="rei-press flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand font-serif text-base text-brand-fg" aria-hidden>
              R
            </span>
            <span className="text-[15px] font-semibold tracking-tight">{name}</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rei-underline rounded-md px-3 py-2 text-text-2 transition-colors hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/login"
              className="ml-2 rounded-md px-3 py-2 font-medium text-brand-text transition-colors hover:bg-brand-tint"
            >
              Ingresar
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border bg-subtle">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-5 py-8 text-sm text-text-3 sm:flex-row sm:items-center sm:justify-between">
          <p>{name} — CRM de WhatsApp con agente de IA para inmobiliarias.</p>
          <nav className="flex flex-wrap gap-4">
            <Link href="/privacidad" className="rei-underline hover:text-foreground">
              Privacidad
            </Link>
            <Link href="/terminos" className="rei-underline hover:text-foreground">
              Términos
            </Link>
            <Link href="/eliminar-datos" className="rei-underline hover:text-foreground">
              Eliminar mis datos
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
