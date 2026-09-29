import { mockGuard } from "@/lib/dev-guard";
import {
  getWaMockState,
  nextN,
  nextOutboundWamid,
  type MockTemplate,
} from "@/server/dev/wa-mock-state";

/**
 * Imitación de la Graph API (contrato mocks.md). El cliente real apunta aquí
 * cuando META_GRAPH_BASE_URL = <app>/api/dev/wa-mock/graph — el código de
 * producción no sabe que habla con un mock.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ path: string[] }> };

/** 016 — Catálogo cerrado de Meta para `business_messaging` (mismo que el real). */
const CAPI_EVENT_NAMES = new Set([
  "Purchase",
  "LeadSubmitted",
  "QualifiedLead",
  "InitiateCheckout",
  "AddToCart",
  "ViewContent",
  "OrderCreated",
  "OrderShipped",
  "OrderDelivered",
  "OrderCanceled",
  "OrderReturned",
  "CartAbandoned",
  "RatingProvided",
  "ReviewProvided",
]);

function bearerToken(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function invalidTokenResponse(): Response {
  return Response.json(
    {
      error: {
        message: "Invalid OAuth access token - Cannot parse access token",
        type: "OAuthException",
        code: 190,
        fbtrace_id: "mock",
      },
    },
    { status: 401 }
  );
}

/** Quita el segmento de versión (v25.0/...) si viene en la ruta. */
function normalizePath(path: string[]): string[] {
  return path[0] && /^v\d+/.test(path[0]) ? path.slice(1) : path;
}

export async function GET(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const path = normalizePath((await ctx.params).path);
  const token = bearerToken(req);
  if (token.endsWith("-invalid")) return invalidTokenResponse();
  const query = new URL(req.url).searchParams;

  // Fork — Embedded Signup en la app: GET oauth/access_token → intercambio
  // del code (30s de vida en la vida real; el mock no lo expira). El código
  // lleva su propio sufijo de comportamiento (como el resto del mock: "-fail",
  // "-invalid") para que el mismo endpoint sirva todos los caminos felices e
  // infelices sin estado adicional.
  if (path.length === 2 && path[0] === "oauth" && path[1] === "access_token") {
    const code = query.get("code") ?? "";
    if (!code || code.endsWith("-expired")) {
      return Response.json(
        {
          error: {
            message: "This authorization code has expired.",
            type: "OAuthException",
            code: 100,
            fbtrace_id: "mock-es-expired",
          },
        },
        { status: 400 }
      );
    }
    return Response.json({
      access_token: `mtok_${code}_${nextN()}`,
      token_type: "bearer",
      expires_in: 5184000,
    });
  }

  // Fork — Embedded Signup en la app: GET debug_token con token DE APP
  // (access_token=APP_ID|APP_SECRET, no Bearer). El token que emite el mock de
  // arriba lleva el `code` incrustado, así que aquí se lee ESE sufijo para
  // decidir permisos/validez — "-noperm" y "-invalid" son del harness E2E.
  if (path.length === 1 && path[0] === "debug_token") {
    const inputToken = query.get("input_token") ?? "";
    const isValid = inputToken.startsWith("mtok_") && !inputToken.includes("-invalid");
    const hasPerms = !inputToken.includes("-noperm");
    return Response.json({
      data: {
        is_valid: isValid,
        app_id: process.env.META_APP_ID ?? "app-id-de-mentira",
        scopes: hasPerms ? ["whatsapp_business_management", "whatsapp_business_messaging"] : [],
        granular_scopes: hasPerms
          ? [
              { scope: "whatsapp_business_management", target_ids: ["*"] },
              { scope: "whatsapp_business_messaging", target_ids: ["*"] },
            ]
          : [],
        issued_at: Math.floor(Date.now() / 1000),
      },
    });
  }

  // Fork — Embedded Signup en la app: GET {wabaId}/phone_numbers → descubrir
  // el número. El id es determinista a partir del wabaId (sin tabla nueva) así
  // que un WABA aleatorio por corrida sigue siendo re-ejecutable.
  if (path.length === 2 && path[1] === "phone_numbers") {
    return Response.json({
      data: [
        {
          id: `esphone_${path[0]}`,
          display_phone_number: "+52 55 1234 5678",
          verified_name: "Negocio de prueba",
          quality_rating: "GREEN",
          name_status: "APPROVED",
        },
      ],
    });
  }

  // Fork — Embedded Signup en la app: GET {wabaId}/subscribed_apps → relee el
  // override que dejó el POST de abajo (o vacío si nunca se llamó).
  if (path.length === 2 && path[1] === "subscribed_apps") {
    const state = getWaMockState();
    const override = state.subscribedApps[path[0]!];
    return Response.json({
      data: override
        ? [
            {
              id: process.env.META_APP_ID ?? "app-id-de-mentira",
              name: "mock-app",
              override_callback_uri: override.overrideCallbackUri,
              subscribed_fields: ["messages"],
            },
          ]
        : [],
    });
  }

  // GET {wabaId}/message_templates → lista para el sync
  if (path.length === 2 && path[1] === "message_templates") {
    const state = getWaMockState();
    return Response.json({
      data: state.templates.map((t) => ({
        id: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        components: t.components ?? [{ type: "BODY", text: t.body }],
      })),
    });
  }

  // GET {mediaId} (ids "media...") → metadata de adjunto (media proxy del bot)
  if (path.length === 1 && path[0]!.startsWith("media")) {
    const origin = new URL(req.url).origin;
    return Response.json({
      id: path[0],
      mime_type: path[0]!.includes("pdf") ? "application/pdf" : "image/jpeg",
      file_size: 13,
      url: `${origin}/api/dev/wa-mock/media-file/${path[0]}`,
    });
  }

  // 017 — GET {psid}?fields=first_name,last_name → perfil de quien escribe
  // por Messenger (la ingesta lo consulta la primera vez que ve un PSID).
  const fields = new URL(req.url).searchParams.get("fields") ?? "";
  if (path.length === 1 && fields.includes("first_name")) {
    return Response.json({
      id: path[0],
      first_name: "Cliente",
      last_name: "de Messenger",
    });
  }

  // 017 — GET {pageId}?fields=id,name → validación de la página de Facebook
  if (path.length === 1 && /(^|,)name(,|$)/.test(fields)) {
    return Response.json({ id: path[0], name: "Página de prueba" });
  }

  // GET {phoneNumberId}?fields=... → validación del wizard; también sirve
  // `is_on_biz_app,platform_type` (estado de coexistencia): son campos extra
  // que no estorban a quien solo pidió los de siempre.
  if (path.length === 1) {
    return Response.json({
      display_phone_number: "+52 55 0000 0000",
      verified_name: "Número de prueba",
      id: path[0],
      is_on_biz_app: true,
      platform_type: "CLOUD_API",
    });
  }

  return Response.json({});
}

export async function POST(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const path = normalizePath((await ctx.params).path);
  const token = bearerToken(req);
  if (token.endsWith("-invalid")) return invalidTokenResponse();

  // POST {phoneNumberId}/media (multipart, 008) → id de media subido.
  // Va ANTES del parseo JSON: el body es form-data.
  if (path.length === 2 && path[1] === "media") {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof Blob)) {
      return Response.json(
        { error: { message: "missing file", type: "GraphMethodException", code: 100 } },
        { status: 400 }
      );
    }
    // El id arranca con "media" para que el GET de metadata lo resuelva.
    return Response.json({ id: `media-up-${nextN()}` });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // 016 — POST {datasetId}/events: Conversions API. Imita las tres cosas que
  // de verdad importan del endpoint real: el catálogo cerrado de nombres, la
  // exigencia del ctwa_clid, y —sobre todo— que Meta puede responder 200
  // DESCARTANDO el evento. Los datasets terminados en "-fail" reproducen eso
  // último, que es el modo de fallo que nadie ve venir.
  if (path.length === 2 && path[1] === "events") {
    const state = getWaMockState();
    const events = Array.isArray(body.data)
      ? (body.data as Record<string, unknown>[])
      : [];
    const event = events[0];
    const eventName = String(event?.event_name ?? "");
    const userData = (event?.user_data ?? {}) as Record<string, unknown>;
    const ctwaClid = userData.ctwa_clid ? String(userData.ctwa_clid) : null;

    if (!CAPI_EVENT_NAMES.has(eventName)) {
      return Response.json(
        {
          error: {
            message: `(#100) Invalid parameter: event_name ${eventName || "(vacío)"}`,
            type: "GraphMethodException",
            code: 100,
            fbtrace_id: "mock-capi-badname",
          },
        },
        { status: 400 }
      );
    }
    if (!ctwaClid) {
      return Response.json(
        {
          error: {
            message: "Messaging Event Invalid Ctwa Clid",
            type: "GraphMethodException",
            code: 100,
            error_subcode: 2804087,
            fbtrace_id: "mock-capi-noclid",
          },
        },
        { status: 400 }
      );
    }

    const datasetId = path[0]!;
    state.capiEvents.push({
      n: nextN(),
      datasetId,
      eventName,
      ctwaClid,
      customData:
        (event?.custom_data as Record<string, unknown> | undefined) ?? null,
      body,
      at: new Date().toISOString(),
    });

    // El 200 mentiroso: recibido por HTTP, descartado por Meta.
    const received = datasetId.endsWith("-fail") ? 0 : 1;
    return Response.json({
      events_received: received,
      messages: [],
      fbtrace_id: `mock-capi-${state.capiEvents.length}`,
    });
  }

  // POST {phoneNumberId}/messages con status:"read" → typing/leído:
  // NO es un mensaje saliente — no contamina el outbox.
  if (path.length === 2 && path[1] === "messages" && body.status === "read") {
    return Response.json({ success: true });
  }

  // POST {phoneNumberId}/messages → registra en el outbox
  if (path.length === 2 && path[1] === "messages") {
    const state = getWaMockState();
    // Meta responde 132000 si los parámetros no cuadran con las {{n}} de la
    // plantilla aprobada. El mock lo replica para que un desfase no pase.
    if (body.type === "template") {
      const tplSend = body.template as
        | {
            name?: string;
            components?: { type?: string; parameters?: unknown[] }[];
          }
        | undefined;
      const known = state.templates.find((t) => t.name === tplSend?.name);
      if (known) {
        const expected = [...known.body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].reduce(
          (max, m) => Math.max(max, Number(m[1])),
          0
        );
        const got =
          tplSend?.components?.find(
            (c) => (c.type ?? "").toLowerCase() === "body"
          )?.parameters?.length ?? 0;
        if (expected !== got) {
          return Response.json(
            {
              error: {
                message: `(#132000) Number of parameters does not match the expected number of params: expected ${expected}, got ${got}`,
                type: "OAuthException",
                code: 132000,
                fbtrace_id: "mock",
              },
            },
            { status: 400 }
          );
        }
      }
    }
    const n = nextN();
    const waMessageId = nextOutboundWamid();
    state.outbox.push({
      n,
      waMessageId,
      phoneNumberId: path[0]!,
      to: String(body.to ?? ""),
      type: String(body.type ?? "text"),
      body,
      at: new Date().toISOString(),
    });
    return Response.json({
      messaging_product: "whatsapp",
      contacts: [{ input: body.to, wa_id: body.to }],
      messages: [{ id: waMessageId }],
    });
  }

  // POST {wabaId}/message_templates → alta de plantilla (queda PENDING)
  if (path.length === 2 && path[1] === "message_templates") {
    const state = getWaMockState();
    const components = (body.components ?? []) as {
      type?: string;
      text?: string;
      example?: { body_text?: string[][] };
    }[];
    const bodyComponent = components.find(
      (c) => (c.type ?? "").toUpperCase() === "BODY"
    );
    // Meta valida que haya un ejemplo por cada {{n}} del cuerpo: sin esto el
    // mock aceptaría plantillas que producción rechaza (error 100).
    const highestVar = [
      ...(bodyComponent?.text ?? "").matchAll(/\{\{\s*(\d+)\s*\}\}/g),
    ].reduce((max, m) => Math.max(max, Number(m[1])), 0);
    const examples = bodyComponent?.example?.body_text?.[0] ?? [];
    if (highestVar !== examples.length) {
      return Response.json(
        {
          error: {
            message: `Invalid parameter: expected ${highestVar} example value(s) for the body, got ${examples.length}`,
            type: "GraphMethodException",
            code: 100,
            fbtrace_id: "mock",
          },
        },
        { status: 400 }
      );
    }
    const tpl: MockTemplate = {
      id: `tplmock_${nextN()}`,
      name: String(body.name ?? ""),
      language: String(body.language ?? "es_MX"),
      category: String(body.category ?? "UTILITY"),
      status: "PENDING",
      body: bodyComponent?.text ?? "",
      components,
    };
    state.templates.push(tpl);
    return Response.json({ id: tpl.id, status: "PENDING", category: tpl.category });
  }

  // POST {wabaId}/subscribed_apps → suscripción (con o sin override). Fork:
  // con `override_callback_uri` se guarda para que el GET de arriba lo relea
  // (verificación de Embedded Signup); sin él es la suscripción simple de
  // siempre (modo directo, `connect.ts`) y no toca lo ya guardado.
  if (path.length === 2 && path[1] === "subscribed_apps") {
    const overrideCallbackUri = typeof body.override_callback_uri === "string" ? body.override_callback_uri : null;
    if (overrideCallbackUri) {
      const state = getWaMockState();
      state.subscribedApps[path[0]!] = {
        overrideCallbackUri,
        verifyToken: typeof body.verify_token === "string" ? body.verify_token : "",
      };
    }
    return Response.json({ success: true });
  }

  // Fork — Embedded Signup en la app: POST {phoneNumberId}/register (solo
  // Cloud API). Segunda vez con el MISMO número → 133016 ("ya registrado"),
  // igual que Meta: el harness E2E es re-ejecutable y debe ver eso como éxito.
  if (path.length === 2 && path[1] === "register") {
    const state = getWaMockState();
    if (state.registeredPhones.has(path[0]!)) {
      return Response.json(
        {
          error: {
            message: "This phone number is already registered.",
            type: "OAuthException",
            code: 133016,
            fbtrace_id: "mock-es-already-registered",
          },
        },
        { status: 400 }
      );
    }
    state.registeredPhones.add(path[0]!);
    return Response.json({ success: true });
  }

  // Fork — Embedded Signup en la app: POST {phoneNumberId}/smb_app_data
  // (sync de coexistencia: `smb_app_state_sync` / `history`). El guard de "una
  // vez por tipo" es responsabilidad del CRM (organization.metadata); el mock
  // solo confirma la solicitud y la anota para que el self-test la verifique
  // (Meta no tiene un GET para releerla).
  if (path.length === 2 && path[1] === "smb_app_data") {
    const state = getWaMockState();
    const requestId = `req_${nextN()}`;
    state.smbAppDataRequests.push({
      n: state.smbAppDataRequests.length + 1,
      phoneNumberId: path[0]!,
      syncType: body.sync_type === "history" ? "history" : "smb_app_state_sync",
      requestId,
      at: new Date().toISOString(),
    });
    return Response.json({ success: true, request_id: requestId });
  }

  return Response.json({});
}

export async function DELETE(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const token = bearerToken(req);
  if (token.endsWith("-invalid")) return invalidTokenResponse();
  await ctx.params;
  return Response.json({ success: true });
}
