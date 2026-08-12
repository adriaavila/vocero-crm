import { timingSafeEqual } from "node:crypto";
import { apiError, withOwner } from "@/lib/api";
import {
  createGoogleOAuthClient,
  saveGoogleOAuthConnection,
} from "@/server/calendar";

export const dynamic = "force-dynamic";

function cookie(req: Request, name: string): string | null {
  const prefix = `${name}=`;
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) return value.slice(prefix.length);
  }
  return null;
}

export const GET = withOwner(async (session, req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = cookie(req, "vocero_google_oauth_state");
  if (!code || !state || !expected) {
    return apiError(422, "oauth_invalid", "Callback OAuth incompleto");
  }
  const a = Buffer.from(state);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return apiError(403, "oauth_state", "Estado OAuth inválido");
  }

  const client = createGoogleOAuthClient();
  const { tokens } = await client.getToken(code);
  await saveGoogleOAuthConnection(session.organizationId, tokens);
  return new Response(null, {
    status: 303,
    headers: {
      location: "/settings/calendar?connected=1",
      "set-cookie": "vocero_google_oauth_state=; Path=/api/settings/calendar; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    },
  });
});
