import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MetaApiError } from "@/lib/meta/client";
import { motivoFalloCapi } from "@/server/agencia/capi-permiso";
import { parseSignedRequest, readSignedRequest } from "@/server/agencia/meta-cumplimiento";

const SECRET = "secreto-de-la-app";

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function firmar(payload: Record<string, unknown>, secret = SECRET): string {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${sig}.${body}`;
}

describe("parseSignedRequest", () => {
  const payload = { algorithm: "HMAC-SHA256", user_id: "1234567890", issued_at: 1791000000 };

  it("acepta un signed_request firmado con el secreto de la app", () => {
    expect(parseSignedRequest(firmar(payload), SECRET)).toMatchObject({ user_id: "1234567890" });
  });

  it("rechaza la firma de otro secreto", () => {
    expect(parseSignedRequest(firmar(payload, "otro"), SECRET)).toBeNull();
  });

  it("rechaza un payload alterado después de firmar", () => {
    const [sig] = firmar(payload).split(".");
    const otro = b64url(JSON.stringify({ ...payload, user_id: "999" }));
    expect(parseSignedRequest(`${sig}.${otro}`, SECRET)).toBeNull();
  });

  it("rechaza otro algoritmo, sin user_id, basura o secreto vacío", () => {
    expect(parseSignedRequest(firmar({ ...payload, algorithm: "none" }), SECRET)).toBeNull();
    expect(parseSignedRequest(firmar({ algorithm: "HMAC-SHA256" }), SECRET)).toBeNull();
    expect(parseSignedRequest("no-es-nada", SECRET)).toBeNull();
    expect(parseSignedRequest("a.b.c", SECRET)).toBeNull();
    expect(parseSignedRequest(firmar(payload), "")).toBeNull();
  });
});

describe("readSignedRequest", () => {
  it("lo lee del formulario que manda Meta", async () => {
    const req = new Request("http://x", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "signed_request=abc.def",
    });
    expect(await readSignedRequest(req)).toBe("abc.def");
  });

  it("y de JSON", async () => {
    const req = new Request("http://x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signed_request: "abc.def" }),
    });
    expect(await readSignedRequest(req)).toBe("abc.def");
  });
});

describe("motivoFalloCapi", () => {
  it("nombra el permiso cuando Meta rechaza por permisos", () => {
    const err = new MetaApiError("(#200) Permissions error", { status: 403, code: 200 });
    expect(motivoFalloCapi(err)).toContain("whatsapp_business_manage_events");
  });

  it("deja tal cual cualquier otro error", () => {
    expect(motivoFalloCapi(new Error("events_received=0"))).toBe("events_received=0");
  });
});
