import { mockGuard } from "@/lib/dev-guard";
import {
  nextZernioMessageId,
  resetZernioMock,
  zernioMockState,
  zernioTokenIsBad,
} from "@/server/dev/zernio-mock-state";

export const dynamic = "force-dynamic";

/**
 * 017 — Zernio de mentira para el self-test. Tras `mockGuard()`: 404
 * incondicional en producción, indistinguible de una ruta inexistente.
 *
 * Imita lo único que Vocero usa de esa API —listar conversaciones (que es como
 * se valida la llave) y responder en una— y expone `_sent` y `_reset` para que
 * el arnés pueda afirmar sobre lo que recibió.
 */

type Ctx = { params: Promise<{ path: string[] }> };

function unauthorized(): Response {
  return Response.json(
    { error: { message: "Invalid API key" } },
    { status: 401 }
  );
}

export async function GET(req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;
  const route = path.join("/");

  if (route === "_sent") {
    return Response.json({ sent: zernioMockState().sent });
  }
  if (zernioTokenIsBad(req.headers.get("authorization"))) return unauthorized();

  // GET /inbox/conversations → lo que usa la validación de la llave.
  if (route === "inbox/conversations") {
    return Response.json({ data: [], hasMore: false });
  }
  return Response.json({});
}

export async function POST(req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;

  if (path.join("/") === "_reset") {
    resetZernioMock();
    return Response.json({ ok: true });
  }
  if (zernioTokenIsBad(req.headers.get("authorization"))) return unauthorized();

  // POST /inbox/conversations/{id}/messages
  if (
    path.length === 4 &&
    path[0] === "inbox" &&
    path[1] === "conversations" &&
    path[3] === "messages"
  ) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const state = zernioMockState();
    const id = nextZernioMessageId();
    state.sent.push({
      n: state.seq,
      conversationId: decodeURIComponent(path[2]!),
      accountId: body.accountId ? String(body.accountId) : null,
      message: String(body.message ?? ""),
      ...(body.messagingType ? { messagingType: String(body.messagingType) } : {}),
      ...(body.messageTag ? { messageTag: String(body.messageTag) } : {}),
      idempotencyKey: req.headers.get("idempotency-key"),
      at: new Date().toISOString(),
    });
    return Response.json({ message: { id } });
  }

  return Response.json({});
}
