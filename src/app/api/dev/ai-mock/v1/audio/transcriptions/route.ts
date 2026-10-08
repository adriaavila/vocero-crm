import { mockGuard } from "@/lib/dev-guard";
import { MOCK_NOTA_DE_VOZ } from "@/server/dev/ai-mock";

export const dynamic = "force-dynamic";

/** Whisper del mock (oír y ver, con solo OpenAI): siempre la misma nota. */
export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const form = await req.formData().catch(() => null);
  if (!form?.get("file")) {
    return Response.json({ error: { message: "file requerido" } }, { status: 400 });
  }
  return Response.json({ text: MOCK_NOTA_DE_VOZ });
}
