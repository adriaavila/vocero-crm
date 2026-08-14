import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { chatJson, extractJson } from "@/lib/ai";
import { isAgentConfigured, resetEnvCacheForTests, shouldRunInternalAgent } from "@/lib/env";

describe("isAgentConfigured", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("acepta un cerebro externo sin activar el LLM interno", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("BOT_API_KEY", "bot-key-de-prueba-larga");

    expect(isAgentConfigured()).toBe(true);
  });

  it("da prioridad al cerebro externo si ambos están configurados", () => {
    vi.stubEnv("OPENAI_API_KEY", "token-openai");
    vi.stubEnv("BOT_API_KEY", "bot-key-de-prueba-larga");

    expect(shouldRunInternalAgent()).toBe(false);
  });
});

describe("extractJson (extracción robusta)", () => {
  it("JSON limpio", () => {
    expect(extractJson('{"action":"none"}')).toEqual({ action: "none" });
  });

  it("bloque ```json con texto alrededor", () => {
    const raw = 'Claro, aquí está:\n```json\n{"action":"reply","text":"hola"}\n```\nEspero que sirva.';
    expect(extractJson(raw)).toEqual({ action: "reply", text: "hola" });
  });

  it("JSON incrustado en prosa (primer { al último })", () => {
    const raw = 'La acción que tomaré es {"action":"handoff","reason":"cliente"} por lo dicho.';
    expect(extractJson(raw)).toEqual({ action: "handoff", reason: "cliente" });
  });

  it("sin JSON → null", () => {
    expect(extractJson("no tengo nada que decir")).toBeNull();
  });
});

describe("chatJson (reintentos y errores tipados)", () => {
  const schema = z.object({ action: z.literal("reply"), text: z.string() });

  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("OPENAI_API_KEY", "token-test");
    vi.stubEnv("OPENAI_MODEL", "modelo-test");
    // getEnv() memoiza; sin esto, el stub de un test no se refleja porque el
    // primer chatJson() del archivo ya cacheó el env de OTRO test.
    resetEnvCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetEnvCacheForTests();
  });

  function providerResponse(content: string) {
    return new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  it("salida inválida al primer intento → reintenta con STRICT y triunfa", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(providerResponse("no soy json"))
      .mockResolvedValueOnce(providerResponse('{"action":"reply","text":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.text).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // el reintento agrega la instrucción STRICT
    const secondBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    expect(JSON.stringify(secondBody.messages)).toContain("STRICT");
  });

  it("proveedor caído (500 persistente) → error tipado, jamás excepción", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response("boom", { status: 500 }))
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("provider_error");
    expect(fetchMock).toHaveBeenCalledTimes(3); // agotó los 3 intentos
  });

  it("salida que nunca cumple el esquema → invalid_output", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(providerResponse('{"action":"otra_cosa"}'))
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_output");
  });

  it("sin token del proveedor principal → not_configured sin tocar la red", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pega a OpenAI con OPENAI_MODEL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      providerResponse('{"action":"reply","text":"ok"}')
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);

    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const requestBody = JSON.parse(init!.body as string);
    expect(requestBody.model).toBe("modelo-test");
  });

  it("judge:true usa OPENAI_JUDGE_MODEL si está seteado (más barato)", async () => {
    vi.stubEnv("OPENAI_JUDGE_MODEL", "modelo-juez-barato");
    const fetchMock = vi.fn().mockResolvedValue(
      providerResponse('{"action":"reply","text":"ok"}')
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(
      schema,
      [{ role: "user", content: "hola" }],
      { judge: true }
    );

    expect(result.ok).toBe(true);
    const requestBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(requestBody.model).toBe("modelo-juez-barato");
  });

  it("judge:true sin OPENAI_JUDGE_MODEL cae a OPENAI_MODEL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      providerResponse('{"action":"reply","text":"ok"}')
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(
      schema,
      [{ role: "user", content: "hola" }],
      { judge: true }
    );

    expect(result.ok).toBe(true);
    const requestBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(requestBody.model).toBe("modelo-test");
  });
});
