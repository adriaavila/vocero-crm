import { mockGuard } from "@/lib/dev-guard";
import { clearEmails, listEmails, recordEmail } from "@/server/agencia/email-sink";

export const dynamic = "force-dynamic";

/**
 * Sumidero de correo para desarrollo y el guion de autoservicio: con
 * `EMAIL_API_URL=<APP_BASE_URL>/api/dev/email-sink`, `sendEmail` entrega aquí
 * (formato de Resend) y nada sale a internet. 404 sin mocks o en producción.
 *
 *   POST   guarda el correo y contesta `{ id }`
 *   GET    lista lo guardado (`?to=<correo>` filtra)
 *   DELETE vacía
 */
export async function POST(request: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const payload = await request.json().catch(() => null);
  return Response.json({ id: recordEmail(payload).id });
}

export async function GET(request: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  return Response.json({ emails: listEmails(new URL(request.url).searchParams.get("to")) });
}

export async function DELETE() {
  const guard = mockGuard();
  if (guard) return guard;
  clearEmails();
  return Response.json({ ok: true });
}
