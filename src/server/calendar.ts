import { createHash } from "node:crypto";
import { and, asc, eq, gt } from "drizzle-orm";
import {
  AuthClient,
  GoogleAuth,
  OAuth2Client,
  type Credentials,
} from "google-auth-library";
import { getEnv } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

const TIME_ZONE = "America/Caracas";
const CARACAS_OFFSET_MS = 4 * 60 * 60 * 1000;
const DURATION_MS = 30 * 60 * 1000;
const BUFFER_MS = 15 * 60 * 1000;
const SLOT_STEP_MINUTES = 45;
const HORIZON_DAYS = 14;
const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
];

export type CalendarSlot = {
  startUtc: string;
  endUtc: string;
  label: string;
};

type BusyInterval = { start: Date; end: Date };
type CalendarClient = {
  auth: AuthClient;
  calendarId: string;
  mode: "service_account" | "oauth";
  accountEmail: string | null;
};

export class CalendarError extends Error {
  constructor(
    public code:
      | "calendar_not_configured"
      | "calendar_unavailable"
      | "meet_unavailable",
    message: string
  ) {
    super(message);
    this.name = "CalendarError";
  }
}

export function oauthRedirectUri(): string {
  return `${getEnv().APP_BASE_URL.replace(/\/$/, "")}/api/settings/calendar/callback`;
}

export function createGoogleOAuthClient(): OAuth2Client {
  const env = getEnv();
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new CalendarError(
      "calendar_not_configured",
      "Google OAuth no está configurado"
    );
  }
  return new OAuth2Client({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: oauthRedirectUri(),
  });
}

export function googleOAuthUrl(state: string): string {
  return createGoogleOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    state,
    scope: CALENDAR_SCOPES,
  });
}

export async function saveGoogleOAuthConnection(
  organizationId: string,
  credentials: Credentials
): Promise<void> {
  if (!credentials.refresh_token) {
    throw new CalendarError(
      "calendar_not_configured",
      "Google no devolvió refresh token; vuelve a autorizar la cuenta"
    );
  }
  const enc = encryptSecret(credentials.refresh_token);
  const oauth = createGoogleOAuthClient();
  oauth.setCredentials(credentials);
  const tokenInfo = credentials.access_token
    ? await oauth.getTokenInfo(credentials.access_token).catch(() => null)
    : null;
  const db = getDb();
  await db
    .insert(schema.googleCalendarConnection)
    .values({
      id: newId("googleCalendarConnection"),
      organizationId,
      accountEmail: tokenInfo?.email ?? null,
      calendarId: "primary",
      refreshTokenCipher: enc.cipher,
      refreshTokenIv: enc.iv,
      refreshTokenTag: enc.tag,
    })
    .onConflictDoUpdate({
      target: [schema.googleCalendarConnection.organizationId],
      set: {
        accountEmail: tokenInfo?.email ?? null,
        calendarId: "primary",
        refreshTokenCipher: enc.cipher,
        refreshTokenIv: enc.iv,
        refreshTokenTag: enc.tag,
        updatedAt: new Date(),
      },
    });
}

export async function disconnectGoogleOAuth(
  organizationId: string
): Promise<void> {
  await getDb()
    .delete(schema.googleCalendarConnection)
    .where(
      eq(schema.googleCalendarConnection.organizationId, organizationId)
    );
}

async function getCalendarClient(
  organizationId: string
): Promise<CalendarClient> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.googleCalendarConnection)
    .where(
      eq(schema.googleCalendarConnection.organizationId, organizationId)
    )
    .limit(1);
  const connection = rows[0];
  if (connection) {
    const oauth = createGoogleOAuthClient();
    oauth.setCredentials({
      refresh_token: decryptSecret({
        cipher: connection.refreshTokenCipher,
        iv: connection.refreshTokenIv,
        tag: connection.refreshTokenTag,
      }),
    });
    return {
      auth: oauth,
      calendarId: connection.calendarId,
      mode: "oauth",
      accountEmail: connection.accountEmail,
    };
  }

  const env = getEnv();
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 || !env.GOOGLE_CALENDAR_ID) {
    throw new CalendarError(
      "calendar_not_configured",
      "Configura una cuenta de servicio o conecta Google Calendar"
    );
  }
  let credentials: { client_email?: string; private_key?: string };
  try {
    credentials = JSON.parse(
      Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_JSON_B64, "base64").toString(
        "utf8"
      )
    );
  } catch {
    throw new CalendarError(
      "calendar_not_configured",
      "GOOGLE_SERVICE_ACCOUNT_JSON_B64 no contiene JSON válido"
    );
  }
  if (!credentials.client_email || !credentials.private_key) {
    throw new CalendarError(
      "calendar_not_configured",
      "La cuenta de servicio no contiene client_email/private_key"
    );
  }
  const auth = await new GoogleAuth({ credentials, scopes: CALENDAR_SCOPES }).getClient();
  return {
    auth,
    calendarId: env.GOOGLE_CALENDAR_ID,
    mode: "service_account",
    accountEmail: credentials.client_email,
  };
}

function calendarUrl(calendarId: string, suffix = ""): string {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}${suffix}`;
}

export async function getCalendarStatus(organizationId: string): Promise<{
  configured: boolean;
  mode: CalendarClient["mode"] | null;
  accountEmail: string | null;
  meetSupported: boolean;
  error: string | null;
}> {
  try {
    const client = await getCalendarClient(organizationId);
    const response = await client.auth.request<{
      conferenceProperties?: { allowedConferenceSolutionTypes?: string[] };
    }>({ url: calendarUrl(client.calendarId) });
    return {
      configured: true,
      mode: client.mode,
      accountEmail: client.accountEmail,
      meetSupported: Boolean(
        response.data.conferenceProperties?.allowedConferenceSolutionTypes?.includes(
          "hangoutsMeet"
        )
      ),
      error: null,
    };
  } catch (error) {
    return {
      configured: false,
      mode: null,
      accountEmail: null,
      meetSupported: false,
      error: error instanceof Error ? error.message : "Google Calendar no disponible",
    };
  }
}

async function queryBusy(
  client: CalendarClient,
  timeMin: Date,
  timeMax: Date
): Promise<BusyInterval[]> {
  try {
    const response = await client.auth.request<{
      calendars?: Record<
        string,
        { busy?: Array<{ start?: string; end?: string }> }
      >;
    }>({
      url: "https://www.googleapis.com/calendar/v3/freeBusy",
      method: "POST",
      data: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        timeZone: TIME_ZONE,
        items: [{ id: client.calendarId }],
      },
    });
    return (response.data.calendars?.[client.calendarId]?.busy ?? [])
      .filter((item) => item.start && item.end)
      .map((item) => ({ start: new Date(item.start!), end: new Date(item.end!) }))
      .filter(
        (item) =>
          !Number.isNaN(item.start.getTime()) && !Number.isNaN(item.end.getTime())
      );
  } catch (error) {
    throw new CalendarError(
      "calendar_unavailable",
      error instanceof Error ? error.message : "No se pudo consultar la agenda"
    );
  }
}

/** Cálculo puro: la integración remota queda fuera y esta es la superficie de test. */
export function buildAvailability(
  now: Date,
  busy: BusyInterval[],
  limit: number
): CalendarSlot[] {
  const wallNow = new Date(now.getTime() - CARACAS_OFFSET_MS);
  const localMidnight = Date.UTC(
    wallNow.getUTCFullYear(),
    wallNow.getUTCMonth(),
    wallNow.getUTCDate()
  );
  const slots: CalendarSlot[] = [];

  for (let day = 0; day < HORIZON_DAYS && slots.length < limit; day += 1) {
    const localDay = localMidnight + day * 24 * 60 * 60 * 1000;
    const weekday = new Date(localDay).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;

    for (
      let minute = 9 * 60;
      minute + DURATION_MS / 60_000 <= 17 * 60 && slots.length < limit;
      minute += SLOT_STEP_MINUTES
    ) {
      const start = new Date(localDay + minute * 60_000 + CARACAS_OFFSET_MS);
      const end = new Date(start.getTime() + DURATION_MS);
      if (start <= now) continue;
      const overlaps = busy.some(
        (item) =>
          start.getTime() < item.end.getTime() + BUFFER_MS &&
          end.getTime() > item.start.getTime() - BUFFER_MS
      );
      if (!overlaps) {
        slots.push({
          startUtc: start.toISOString(),
          endUtc: end.toISOString(),
          label: new Intl.DateTimeFormat("es-VE", {
            timeZone: TIME_ZONE,
            weekday: "long",
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
          }).format(start),
        });
      }
    }
  }
  return slots;
}

export async function listAvailability(
  organizationId: string,
  limit = 6,
  now = new Date()
): Promise<CalendarSlot[]> {
  const client = await getCalendarClient(organizationId);
  const end = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);
  const busy = await queryBusy(client, now, end);
  return buildAvailability(now, busy, Math.max(1, Math.min(limit, 200)));
}

function eventId(organizationId: string, startUtc: string): string {
  return createHash("sha256")
    .update(`${organizationId}:${startUtc}`)
    .digest("hex")
    .slice(0, 32);
}

function meetUrl(event: {
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
}): string | null {
  return (
    event.hangoutLink ??
    event.conferenceData?.entryPoints?.find(
      (entry) => entry.entryPointType === "video"
    )?.uri ??
    null
  );
}

type GoogleEvent = {
  id?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    createRequest?: { status?: { statusCode?: string } };
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
};

async function insertOrGetEvent(
  client: CalendarClient,
  input: {
    eventId: string;
    summary: string;
    description: string;
    start: Date;
    end: Date;
  }
): Promise<GoogleEvent> {
  const url = `${calendarUrl(client.calendarId, "/events")}?conferenceDataVersion=1&sendUpdates=none`;
  try {
    const response = await client.auth.request<GoogleEvent>({
      url,
      method: "POST",
      data: {
        id: input.eventId,
        summary: input.summary,
        description: input.description,
        visibility: "private",
        start: { dateTime: input.start.toISOString(), timeZone: TIME_ZONE },
        end: { dateTime: input.end.toISOString(), timeZone: TIME_ZONE },
        conferenceData: {
          createRequest: {
            requestId: `meet-${input.eventId}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
    });
    return response.data;
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status !== 409) throw error;
    const existing = await client.auth.request<GoogleEvent>({
      url: calendarUrl(client.calendarId, `/events/${input.eventId}`),
    });
    return existing.data;
  }
}

export type BookingResult = {
  label: string;
  scheduledAt: string;
  zoomJoinUrl: string | null;
};

export async function createBooking(input: {
  organizationId: string;
  conversationId: string;
  startUtc: string;
}): Promise<BookingResult | null> {
  const start = new Date(input.startUtc);
  if (Number.isNaN(start.getTime())) return null;

  const available = await listAvailability(input.organizationId, 200);
  const chosen = available.find(
    (slot) => new Date(slot.startUtc).getTime() === start.getTime()
  );
  if (!chosen) return null;

  const db = getDb();
  const conversations = await db
    .select({ conversation: schema.conversation, contact: schema.contact })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .where(
      and(
        eq(schema.conversation.organizationId, input.organizationId),
        eq(schema.conversation.id, input.conversationId)
      )
    )
    .limit(1);
  const row = conversations[0];
  if (!row) return null;

  const id = eventId(input.organizationId, chosen.startUtc);
  const existing = await db
    .select()
    .from(schema.booking)
    .where(
      and(
        eq(schema.booking.organizationId, input.organizationId),
        eq(schema.booking.startAt, start)
      )
    )
    .limit(1);
  if (existing[0]?.conversationId !== input.conversationId) return null;
  if (existing[0]?.status === "confirmed") {
    return {
      label: chosen.label,
      scheduledAt: chosen.startUtc,
      zoomJoinUrl: existing[0].meetUrl,
    };
  }

  if (!existing[0]) {
    await db.insert(schema.booking).values({
      id: newId("booking"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      contactId: row.contact.id,
      startAt: start,
      endAt: new Date(chosen.endUtc),
      googleEventId: id,
    });
  }

  try {
    const client = await getCalendarClient(input.organizationId);
    const status = await getCalendarStatus(input.organizationId);
    if (!status.meetSupported) {
      throw new CalendarError(
        "meet_unavailable",
        "Este calendario no permite crear Google Meet; conecta Google con OAuth"
      );
    }
    let event = await insertOrGetEvent(client, {
      eventId: id,
      summary: `Cita con ${row.contact.name}`,
      description: [
        row.contact.phone ? `WhatsApp: ${row.contact.phone}` : null,
        `CRM: ${getEnv().APP_BASE_URL}/inbox?contact=${encodeURIComponent(row.contact.id)}`,
      ]
        .filter(Boolean)
        .join("\n"),
      start,
      end: new Date(chosen.endUtc),
    });

    for (let attempt = 0; attempt < 5 && !meetUrl(event); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const response = await client.auth.request<GoogleEvent>({
        url: calendarUrl(client.calendarId, `/events/${id}`),
      });
      event = response.data;
    }
    const joinUrl = meetUrl(event);
    await db
      .update(schema.booking)
      .set({ status: "confirmed", meetUrl: joinUrl, error: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.booking.organizationId, input.organizationId),
          eq(schema.booking.startAt, start)
        )
      );
    return { label: chosen.label, scheduledAt: chosen.startUtc, zoomJoinUrl: joinUrl };
  } catch (error) {
    await db
      .update(schema.booking)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 1000) : "Google Calendar falló",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.booking.organizationId, input.organizationId),
          eq(schema.booking.startAt, start)
        )
      );
    throw error;
  }
}

export async function getUpcomingBooking(
  organizationId: string,
  contactId: string,
  now = new Date()
) {
  const rows = await getDb()
    .select()
    .from(schema.booking)
    .where(
      and(
        eq(schema.booking.organizationId, organizationId),
        eq(schema.booking.contactId, contactId),
        eq(schema.booking.status, "confirmed"),
        gt(schema.booking.startAt, now)
      )
    )
    .orderBy(asc(schema.booking.startAt))
    .limit(1);
  const booking = rows[0];
  if (!booking) return null;
  return {
    id: booking.id,
    scheduledAt: booking.startAt.toISOString(),
    endAt: booking.endAt.toISOString(),
    label: new Intl.DateTimeFormat("es-VE", {
      timeZone: TIME_ZONE,
      weekday: "long",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(booking.startAt),
    meetUrl: booking.meetUrl,
  };
}
