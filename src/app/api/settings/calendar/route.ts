import { withOwner } from "@/lib/api";
import { getEnv } from "@/lib/env";
import {
  disconnectGoogleOAuth,
  getCalendarStatus,
} from "@/server/calendar";

export const dynamic = "force-dynamic";

export const GET = withOwner(async (session) => {
  const status = await getCalendarStatus(session.organizationId);
  const env = getEnv();
  return Response.json({
    ...status,
    oauthAvailable: Boolean(
      env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET
    ),
    timeZone: env.CALENDAR_TIME_ZONE,
  });
});

export const DELETE = withOwner(async (session) => {
  await disconnectGoogleOAuth(session.organizationId);
  return Response.json({ ok: true });
});
