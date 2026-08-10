import { randomBytes } from "node:crypto";
import { withAuth } from "@/lib/api";
import { googleOAuthUrl } from "@/server/calendar";

export const dynamic = "force-dynamic";

export const POST = withAuth(async () => {
  const state = randomBytes(24).toString("base64url");
  return Response.json(
    { url: googleOAuthUrl(state) },
    {
      headers: {
        "set-cookie": `vocero_google_oauth_state=${state}; Path=/api/settings/calendar; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
      },
    }
  );
});
