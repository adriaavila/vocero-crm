import { contact } from "@/lib/marketing";

/**
 * El molde de los textos legales. Meta pide las tres URLs (privacidad,
 * términos y eliminación de datos) para aprobar la app de WhatsApp, y las
 * revisa una persona: tienen que decir lo que el producto hace de verdad.
 */
export function LegalPage({
  title,
  updated,
  children,
}: Readonly<{ title: string; updated: string; children: React.ReactNode }>) {
  return (
    <article className="mx-auto max-w-2xl px-5 pb-20 pt-16">
      <h1 className="text-4xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 font-mono text-sm text-text-3">Última actualización: {updated}</p>
      <div className="mt-10 space-y-6 text-[15px] leading-relaxed text-text-2 [&_a]:text-brand-text [&_a]:underline [&_h2]:mb-2 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:ml-5 [&_li]:list-disc [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:space-y-1.5">
        {children}
      </div>
    </article>
  );
}

/**
 * Razón social y domicilio salen del entorno. Si faltan, la página lo dice en
 * voz alta en vez de inventarlos: un texto legal con datos falsos es peor que
 * uno incompleto, y así no se puede publicar sin darse cuenta.
 */
export function LegalEntity(): React.ReactElement {
  const { legalName } = contact();
  if (!legalName) {
    return <strong className="text-warning-text">[pendiente: configurar LEGAL_NAME]</strong>;
  }
  return <strong>{legalName}</strong>;
}

export function LegalAddress(): React.ReactElement {
  const { legalAddress } = contact();
  if (!legalAddress) {
    return <strong className="text-warning-text">[pendiente: configurar LEGAL_ADDRESS]</strong>;
  }
  return <span>{legalAddress}</span>;
}

export function LegalContact(): React.ReactElement {
  const { email, whatsapp } = contact();
  if (email) {
    return <a href={`mailto:${email}`}>{email}</a>;
  }
  if (whatsapp) {
    return <a href={`https://wa.me/${whatsapp.replace(/\D/g, "")}`}>WhatsApp</a>;
  }
  return <strong className="text-warning-text">[pendiente: configurar CONTACT_EMAIL]</strong>;
}
