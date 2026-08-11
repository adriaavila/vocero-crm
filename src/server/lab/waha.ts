import { getEnv, isWahaConfigured } from "@/lib/env";

export type WahaSession = {
  name: string;
  status: string;
  me?: { id?: string; pushName?: string } | null;
};

export class WahaError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function config() {
  if (!isWahaConfigured()) throw new WahaError("WAHA no está configurado", 409);
  const env = getEnv();
  return {
    baseUrl: env.WAHA_API_URL!,
    apiKey: env.WAHA_API_KEY!,
    session: env.WAHA_SESSION,
  };
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const { baseUrl, apiKey } = config();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "X-Api-Key": apiKey,
      ...init?.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new WahaError(detail || `WAHA respondió ${response.status}`, response.status);
  }
  return response;
}

export async function getWahaSession(): Promise<WahaSession | null> {
  const { session } = config();
  const response = await request("/api/sessions?all=true");
  const sessions = (await response.json()) as WahaSession[];
  return sessions.find((item) => item.name === session) ?? null;
}

export async function startWahaSession(): Promise<WahaSession | null> {
  const { session } = config();
  const current = await getWahaSession();
  if (current && ["FAILED", "STOPPED"].includes(current.status)) {
    await request(`/api/sessions/${encodeURIComponent(session)}/restart`, {
      method: "POST",
    });
  } else if (!current) {
    await request("/api/sessions/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: session, config: {} }),
    });
  }
  return getWahaSession();
}

export async function getWahaQr(): Promise<{ data: ArrayBuffer; type: string }> {
  const { session } = config();
  const response = await request(`/api/${encodeURIComponent(session)}/auth/qr?format=image`, {
    headers: { Accept: "image/png" },
  });
  return {
    data: await response.arrayBuffer(),
    type: response.headers.get("content-type") ?? "image/png",
  };
}

export function phoneToChatId(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) throw new WahaError("El número empresarial no es válido", 409);
  return `${digits}@c.us`;
}

export async function sendWahaText(phone: string, text: string): Promise<void> {
  const { session } = config();
  await request("/api/sendText", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId: phoneToChatId(phone), text, session }),
  });
}
