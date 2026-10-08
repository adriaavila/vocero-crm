import { mockGuard } from "@/lib/dev-guard";
import { aiMockCompletion, aiMockMedia } from "@/server/dev/ai-mock";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as {
    messages?: { role: string; content: unknown }[];
  };
  const messages = body.messages ?? [];
  // Fork — oír y ver (`server/agencia/oir-y-ver`): una parte de audio o de
  // imagen recibe su transcripción o descripción fija.
  const content =
    aiMockMedia(messages) ??
    aiMockCompletion(messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" })));
  return Response.json({
    id: "aimock",
    choices: [{ index: 0, message: { role: "assistant", content } }],
  });
}
