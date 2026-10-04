/**
 * Sumidero de correo de desarrollo: guarda en memoria lo que `sendEmail`
 * habría mandado a Resend (ver `EMAIL_API_URL` en `email.ts`). Solo lo usa
 * `/api/dev/email-sink`, que está detrás de `mockGuard`.
 */
export type SunkEmail = {
  id: string;
  from: string | null;
  to: string[];
  subject: string;
  text: string;
  html: string;
  at: string;
};

const MAX_KEPT = 200;

// Sobrevive al hot reload de `next dev`.
const store = globalThis as typeof globalThis & { __emailSink?: SunkEmail[] };
const emails = (store.__emailSink ??= []);

const asString = (value: unknown) => (typeof value === "string" ? value : "");

export function recordEmail(payload: unknown): SunkEmail {
  const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const to = (Array.isArray(body.to) ? body.to : [body.to]).filter((v): v is string => typeof v === "string");
  const email: SunkEmail = {
    id: `sink_${Date.now().toString(36)}_${emails.length}`,
    from: asString(body.from) || null,
    to,
    subject: asString(body.subject),
    text: asString(body.text),
    html: asString(body.html),
    at: new Date().toISOString(),
  };
  emails.push(email);
  if (emails.length > MAX_KEPT) emails.splice(0, emails.length - MAX_KEPT);
  return email;
}

export function listEmails(to?: string | null): SunkEmail[] {
  return to ? emails.filter((email) => email.to.includes(to)) : [...emails];
}

export function clearEmails(): void {
  emails.length = 0;
}
