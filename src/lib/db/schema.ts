import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ============================================================
 * Auth (Better Auth + plugin organization)
 * ============================================================ */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  activeOrganizationId: text("active_organization_id"),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  metadata: text("metadata"),
});

/**
 * Eventos de Stripe SaaS ya aplicados. El id de Stripe es la clave primaria:
 * un reintento o evento duplicado nunca vuelve a mutar la suscripción.
 */
export const saasBillingEvent = pgTable(
  "saas_billing_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    type: text("type").notNull(),
    processedAt: timestamp("processed_at").notNull().defaultNow(),
  },
  (t) => [index("saas_billing_event_org_idx").on(t.organizationId)]
);

/** Accesos al panel interno SaaS; no guarda payloads ni datos del cliente. */
export const saasAdminAudit = pgTable(
  "saas_admin_audit",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    organizationId: text("organization_id").references(() => organization.id, { onDelete: "set null" }),
    /** JSON con el detalle de la acción (plan, confirmOverrideStripe, result…). Null en acciones sin detalle (p. ej. view_tenants). */
    detail: text("detail"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("saas_admin_audit_created_idx").on(t.createdAt)]
);

/** Trabajos durables del agente SaaS: una conversación, como máximo, en vuelo. */
export const agentJob = pgTable(
  "agent_job",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["queued", "running", "done", "failed", "needs_review"],
    })
      .notNull()
      .default("queued"),
    availableAt: timestamp("available_at").notNull().defaultNow(),
    lockedAt: timestamp("locked_at"),
    lockedBy: text("locked_by"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("agent_job_active_conversation_uq")
      .on(t.conversationId)
      .where(sql`${t.status} in ('queued', 'running')`),
    index("agent_job_claim_idx").on(t.status, t.availableAt, t.lockedAt),
  ]
);

export const member = pgTable("member", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

/* ============================================================
 * Dominio (toda tabla lleva organization_id NOT NULL + índice org-first)
 * ============================================================ */

export const contact = pgTable(
  "contact",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /**
     * Llave de resolución WhatsApp (003): teléfono normalizado (521→52) o
     * `bsuid:<id>` cuando Meta no manda wa_id. Estable de por vida.
     */
    /**
     * 014: canal por el que vive este contacto. Aditivo y con default: toda
     * fila existente sigue significando exactamente lo mismo.
     */
    channel: text("channel", { enum: ["whatsapp", "instagram", "messenger"] })
      .notNull()
      .default("whatsapp"),
    /**
     * Llave de resolucion. WhatsApp: telefono normalizado (521 a 52) o
     * `bsuid:<id>`. Instagram (014): `ig:<IGSID>`. Estable de por vida.
     * El nombre `wa_identity` se conserva porque es contrato publicado:
     * `/api/bot/context?waIdentity=...` lo recibe y lo devuelve, y hay
     * cerebros externos que dependen de el.
     */
    waIdentity: text("wa_identity").notNull(),
    /** Teléfono como ATRIBUTO opcional (003): falta en contactos BSUID. */
    phone: text("phone"),
    /** Business-Scoped User ID si se conoce (003). */
    waUserId: text("wa_user_id"),
    name: text("name").notNull(),
    notes: text("notes"),
    /**
     * Ficha de calificación que levanta un cerebro externo por
     * `PUT /api/bot/ficha`. Es un objeto libre a propósito: los datos que
     * importan de un lead los define cada negocio (una clínica querrá
     * "tratamiento", una constructora "metros"), y cablearlos como columnas
     * obligaría a migrar el CRM cada vez que alguien cambia su cuestionario.
     * Merge campo a campo; `null` explícito borra la clave.
     */
    ficha: jsonb("ficha").$type<Record<string, unknown>>(),
    /**
     * De dónde salió el prospecto. NULL = nadie la capturó, y entonces la API
     * la deduce. Así no hace falta backfill ni marcar en falso los contactos
     * que ya existían.
     */
    source: text("source", {
      enum: ["anuncio", "organico", "referido", "conocido", "otro"],
    }),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // 014: el canal entra en la llave. Sin el, un IGSID que coincidiera con
    // un telefono normalizado mezclaria dos personas en silencio.
    uniqueIndex("contact_org_channel_identity_uq").on(
      t.organizationId,
      t.channel,
      t.waIdentity
    ),
    index("contact_org_wa_user_id_idx").on(t.organizationId, t.waUserId),
    index("contact_org_name_idx").on(t.organizationId, t.name),
  ]
);

export const pipelineStage = pgTable(
  "pipeline_stage",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    /** open = etapa normal · won / lost = anclas no borrables */
    kind: text("kind", { enum: ["open", "won", "lost"] })
      .notNull()
      .default("open"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("stage_org_pos_idx").on(t.organizationId, t.position)]
);

export const lead = pgTable(
  "lead",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    stageId: text("stage_id")
      .notNull()
      .references(() => pipelineStage.id),
    position: integer("position").notNull().default(0),
    /**
     * Monto de la negociación en CENTAVOS ENTEROS. NULL = nadie lo capturó, que
     * no es lo mismo que cero: un trato sin monto no vale $0, simplemente no se
     * sabe, y el tablero lo dice con palabras en vez de sumar un cero.
     */
    amountCents: integer("amount_cents"),
    /** Moneda del monto; la del negocio al capturarlo (Ajustes → Marca). */
    currency: text("currency"),
    /**
     * Prioridad de cierre. NULL = nadie la ha decidido, que NO es lo mismo que
     * "media": nada la escribe automáticamente, así que el dueño puede confiar
     * en que lo que ve es lo que él puso.
     */
    priority: text("priority", { enum: ["alta", "media", "baja"] }),
    priorityUpdatedAt: timestamp("priority_updated_at"),
    lastActivityAt: timestamp("last_activity_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("lead_contact_uq").on(t.contactId),
    index("lead_org_stage_idx").on(t.organizationId, t.stageId, t.position),
  ]
);

/**
 * Bitácora de movimientos de etapa: append-only. Nada se actualiza ni se borra;
 * corregir un dato es agregar un movimiento nuevo.
 *
 * Es el cimiento de todo lo histórico: sin ella el CRM solo sabe dónde está
 * cada lead HOY, y "¿cuánto cerré en julio?" no tiene respuesta.
 *
 * Regla dura: la ÚNICA puerta que escribe aquí —y que escribe `lead.stage_id`—
 * es `src/server/leads/stage-history.ts`. Un unit test de vigilancia falla si
 * aparece otra escritura, porque un camino que mueva el lead sin registrar el
 * evento no truena: solo hace que las gráficas mientan meses después.
 */
export const leadStageEvent = pgTable(
  "lead_stage_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    leadId: text("lead_id")
      .notNull()
      .references(() => lead.id, { onDelete: "cascade" }),
    /** Denormalizado a propósito: casi toda agregación cruza con el contacto,
     *  y el join extra se pagaría en cada consulta. */
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    /** NULL = el lead nació en `toStage` (evento de creación). */
    fromStageId: text("from_stage_id").references(() => pipelineStage.id, {
      onDelete: "set null",
    }),
    fromStageName: text("from_stage_name"),
    toStageId: text("to_stage_id").references(() => pipelineStage.id, {
      onDelete: "set null",
    }),
    /** Snapshots: sobreviven al renombre y al borrado de la etapa, para que
     *  reorganizar el tablero de hoy no reescriba el embudo del pasado. */
    toStageName: text("to_stage_name").notNull(),
    toStageKind: text("to_stage_kind", { enum: ["open", "won", "lost"] })
      .notNull()
      .default("open"),
    /** Cuándo PASÓ (no cuándo se registró). */
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    /** NULL = no lo movió una persona (bot, sistema, migración). */
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    source: text("source", {
      enum: ["dueno", "bot", "sistema", "migracion"],
    })
      .notNull()
      .default("dueno"),
    /** true = fecha SEMBRADA en la migración, no observada. Cuenta para los
     *  totales pero jamás para promedios de tiempo. */
    approximate: boolean("approximate").notNull().default(false),
    lossReason: text("loss_reason", {
      enum: [
        "precio",
        "no_es_perfil",
        "sin_presupuesto",
        "eligio_otro",
        "nunca_contesto",
        "otro",
      ],
    }),
    lossNote: text("loss_note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("lse_org_occurred_idx").on(t.organizationId, t.occurredAt),
    index("lse_lead_occurred_idx").on(t.leadId, t.occurredAt),
    index("lse_org_kind_occurred_idx").on(
      t.organizationId,
      t.toStageKind,
      t.occurredAt
    ),
    // Perder un trato sin motivo es imposible a nivel de BASE, no por
    // disciplina de cada ruta. La excepción es la siembra de la migración: no
    // puede inventar un motivo que nadie capturó.
    check(
      "lse_loss_reason_ck",
      sql`${t.toStageKind} <> 'lost' OR ${t.approximate} = true OR ${t.lossReason} IS NOT NULL`
    ),
  ]
);

export const conversation = pgTable(
  "conversation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    /** Conversación del Laboratorio: jamás toca la API de WhatsApp. */
    isTest: boolean("is_test").notNull().default(false),
    /**
     * 014: canal de la conversacion. Denormalizado del contacto a proposito:
     * el ruteo de salida y el filtro de la bandeja lo leen en cada mensaje.
     */
    channel: text("channel", { enum: ["whatsapp", "instagram", "messenger"] })
      .notNull()
      .default("whatsapp"),
    /**
     * 014: identificador del hilo en la plataforma de origen. Zernio entrega
     * un conversationId opaco ("no asumas su formato") que hace falta para
     * responder; WhatsApp no lo necesita y queda null.
     */
    channelThreadRef: text("channel_thread_ref"),
    /**
     * Apagada al nacer (fork de agencia). Upstream la abre por defecto porque
     * una instancia = un negocio que ya configuró su agente; aquí una
     * instancia se ENTREGA a un cliente, y una conversación real contestada
     * por un agente a medio configurar es un incidente con el cliente final,
     * no un bug interno. Se enciende por conversación, o en masa desde
     * Configuración → Agente cuando el dueño ya probó el agente.
     */
    aiEnabled: boolean("ai_enabled").notNull().default(false),
    handoffAt: timestamp("handoff_at"),
    handoffReason: text("handoff_reason", {
      // 008: manual_reply = el dueño respondió desde la app del teléfono.
      // hostilidad = el lead se puso agresivo y el agente se retiró.
      enum: [
        "cliente",
        "modelo",
        "error",
        "ventana",
        "hostilidad",
        "manual_reply",
      ],
    }),
    lastInboundAt: timestamp("last_inbound_at"),
    lastMessageAt: timestamp("last_message_at"),
    unreadCount: integer("unread_count").notNull().default(0),
    /**
     * Nea sin estado (dispatch v2): hasta dónde ya se le mandó a Nea. Avanza
     * SOLO tras un 2xx, a `GREATEST(actual, max(createdAt) de lo pendiente
     * despachado)` — nunca retrocede aunque un despacho tardío llegue con un
     * pendiente más viejo. NULL = nunca se le despachó nada; el turno cae
     * entonces al último saliente `ai` no fallido.
     */
    agentCursorAt: timestamp("agent_cursor_at"),
    /**
     * `POST /api/bot/reset` la fija a `now()`: la memoria de Nea (historial +
     * pendientes) arranca de cero después de este instante, aunque el hilo
     * del inbox conserve todo el historial como auditoría.
     */
    memoryResetAt: timestamp("memory_reset_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Una conversación real por contacto; las de prueba no compiten.
    uniqueIndex("conversation_org_contact_real_uq")
      .on(t.organizationId, t.contactId)
      .where(sql`${t.isTest} = false`),
    index("conversation_org_last_idx").on(t.organizationId, t.lastMessageAt),
  ]
);

/**
 * Data spine — el cambio del webhook TAL COMO LLEGÓ, guardado ANTES de
 * procesarlo. Es la fuente replayable: lo derivado (message, contact, lead…)
 * se puede reconstruir desde aquí, no al revés.
 *
 * `organization_id` es NULL a propósito mientras el evento no se pudo enrutar
 * (un `phone_number_id` que todavía no está conectado): se rellena cuando el
 * replay lo logra. Es la única tabla de dominio sin tenant obligatorio; por eso
 * jamás se expone por una ruta de miembro, solo por el replay del admin SaaS.
 *
 * `channel` deja que Instagram/Messenger usen la misma tabla. `status`:
 * pending | processed | failed | unrouted | unmatched | ignored (text sin
 * CHECK: agregar un valor es aditivo). `error` es corto y sin contenido de
 * mensajes ni secretos.
 */
export const rawEvent = pgTable(
  "raw_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    channel: text("channel").notNull().default("whatsapp"),
    /** phone_number_id (o WABA en eventos de plantilla): para enrutar un replay. */
    accountRef: text("account_ref"),
    field: text("field").notNull(),
    /** sha256(field + JSON canónico del value): un reintento de Meta no duplica. */
    dedupeKey: text("dedupe_key").notNull().unique(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"),
    status: text("status", {
      enum: ["pending", "processed", "failed", "unrouted", "unmatched", "ignored"],
    })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
  },
  (t) => [
    index("raw_event_status_received_idx").on(t.status, t.receivedAt),
    index("raw_event_org_received_idx").on(t.organizationId, t.receivedAt),
  ]
);

export const message = pgTable(
  "message",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    /** ID de WhatsApp — UNIQUE (idempotencia). Nullable en salientes de prueba. */
    waMessageId: text("wa_message_id").unique(),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    type: text("type").notNull().default("text"),
    text: text("text"),
    status: text("status", {
      enum: ["pending", "sent", "delivered", "read", "failed"],
    })
      .notNull()
      .default("pending"),
    error: text("error"),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    /**
     * 008 — Origen del saliente: IA (bot), operador del CRM, manual desde la
     * app de WhatsApp Business del teléfono (echo), o plantilla. En entrantes
     * queda el default y la UI lo ignora.
     *
     * Fork — "history": mensaje importado por Embedded Signup
     * (server/agencia/whatsapp-signup/history-sync.ts), en cualquier
     * dirección. Columna `text` sin CHECK: agregar un valor es aditivo y no
     * pide migración (mismo patrón que `ai_credentials.last_validation_status`
     * más abajo). `server/ai/worker.ts` lo excluye del chequeo de "hay algo
     * nuevo, reprograma el turno".
     */
    origin: text("origin", {
      enum: ["ai", "operator", "manual", "template", "history"],
    })
      .notNull()
      .default("operator"),
    /** 008 — Adjunto del mensaje (imagen, doc, ubicación…), si lo hay. */
    mediaAssetId: text("media_asset_id").references(() => mediaAsset.id, {
      onDelete: "set null",
    }),
    /**
     * Nea sin estado (dispatch v2): transcripción de un entrante de
     * audio/documento/imagen, escrita por `POST
     * /api/bot/messages/[id]/transcript`. Primera escritura gana (Nea no la
     * reescribe); null hasta entonces.
     */
    transcript: text("transcript"),
    waTimestamp: timestamp("wa_timestamp"),
    /** Data spine — wamid del mensaje al que este responde (`context.id`). */
    replyToWaId: text("reply_to_wa_id"),
    /**
     * Data spine — cuándo confirmó Meta cada estado (su `timestamp`, no el
     * nuestro). Se llenan aunque el estado no suba de rango: un `delivered`
     * tardío después de `read` igual llena `delivered_at` si estaba vacío.
     */
    sentAt: timestamp("sent_at"),
    deliveredAt: timestamp("delivered_at"),
    readAt: timestamp("read_at"),
    failedAt: timestamp("failed_at"),
    /** Data spine — el evento crudo del que salió (entrantes y echoes). */
    rawEventId: text("raw_event_id").references(() => rawEvent.id, {
      onDelete: "set null",
    }),
    /** Data spine — el usuario del CRM que lo mandó (envíos del operador). */
    senderUserId: text("sender_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("message_org_conv_idx").on(
      t.organizationId,
      t.conversationId,
      t.createdAt
    ),
    // El turno del agente, el despacho a Nea y el worker leen "los últimos
    // mensajes de ESTA conversación" sin la organización por delante: sin
    // este índice cada turno recorría la tabla entera de mensajes.
    index("message_conv_created_idx").on(t.conversationId, t.createdAt),
    // Data spine: "¿qué mensajes salieron de este evento?" y el ON DELETE SET
    // NULL de raw_event no recorren toda la tabla. Parcial: casi todo mensaje
    // saliente y los de antes de la columna no la llevan.
    index("message_raw_event_idx")
      .on(t.rawEventId)
      .where(sql`${t.rawEventId} is not null`),
  ]
);

/**
 * Data spine — una decisión del agente por turno real (Nea o Rei): qué hizo,
 * por qué lo entregó a un humano, con qué modelo y prompt, a qué mensajes
 * respondió y qué contestó. El veredicto lo pone una persona (bien | fallo) y
 * alimenta la mejora del agente. Los turnos del Laboratorio no se registran.
 *
 * `steps`: [{ tool, summary, ok }] — sin contenido de mensajes.
 */
export const agentDecision = pgTable(
  "agent_decision",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    brain: text("brain", { enum: ["nea", "rei"] }).notNull(),
    dispatchId: text("dispatch_id"),
    action: text("action").notNull(),
    handoffReason: text("handoff_reason"),
    steps: jsonb("steps").notNull().default(sql`'[]'::jsonb`),
    model: text("model"),
    promptVersion: text("prompt_version"),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    triggerMessageIds: jsonb("trigger_message_ids").notNull().default(sql`'[]'::jsonb`),
    replyMessageIds: jsonb("reply_message_ids").notNull().default(sql`'[]'::jsonb`),
    verdict: text("verdict", { enum: ["bien", "fallo"] }),
    verdictNote: text("verdict_note"),
    verdictBy: text("verdict_by"),
    verdictAt: timestamp("verdict_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("agent_decision_org_created_idx").on(t.organizationId, t.createdAt.desc()),
    index("agent_decision_conv_created_idx").on(t.conversationId, t.createdAt.desc()),
    // Un despacho = una decisión: un reintento nunca duplica la fila. Rei no
    // tiene dispatch_id (null) y puede tener varias por conversación.
    uniqueIndex("agent_decision_dispatch_uq")
      .on(t.conversationId, t.dispatchId)
      .where(sql`${t.dispatchId} is not null`),
  ]
);

/**
 * 008 — Adjuntos: archivo (imagen/video/audio/documento/sticker) copiado al
 * volumen local (`MEDIA_DIR`) o contenido estructurado (location/contacts) en
 * `payload`. Meta expira sus archivos (~30 días): el disco propio es la
 * fuente durable (constitución II: sin S3/R2).
 */
export const mediaAsset = pgTable(
  "media_asset",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: [
        "image",
        "video",
        "audio",
        "document",
        "sticker",
        "location",
        "contacts",
      ],
    }).notNull(),
    /** media id de Graph (entrantes/salientes subidos); NULL en location/contacts. */
    waMediaId: text("wa_media_id"),
    mimeType: text("mime_type"),
    fileName: text("file_name"),
    fileSize: integer("file_size"),
    caption: text("caption"),
    /** location {latitude, longitude, name?, address?} o contacts (subset). */
    payload: jsonb("payload"),
    /** Ruta relativa dentro de MEDIA_DIR; NULL si aún no descargado o no aplica. */
    storagePath: text("storage_path"),
    fetchStatus: text("fetch_status", {
      enum: ["available", "pending", "failed"],
    })
      .notNull()
      .default("pending"),
    fetchError: text("fetch_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("media_asset_org_idx").on(t.organizationId, t.createdAt),
    index("media_asset_wa_media_idx").on(t.waMediaId),
  ]
);

export const metaCredentials = pgTable(
  "meta_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    wabaId: text("waba_id").notNull(),
    phoneNumberId: text("phone_number_id").notNull(),
    displayPhoneNumber: text("display_phone_number"),
    verifiedName: text("verified_name"),
    tokenCipher: text("token_cipher").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenTag: text("token_tag").notNull(),
    status: text("status", { enum: ["connected", "reconnect_required"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("meta_credentials_org_uq").on(t.organizationId),
    // El webhook enruta por phone_number_id: debe ser único en la instancia.
    uniqueIndex("meta_credentials_phone_uq").on(t.phoneNumberId),
  ]
);

/**
 * Alta de WhatsApp de autoservicio: dónde quedó cada negocio, para que el
 * dueño retome y soporte vea lo mismo. Una fila por organización; el avance es
 * pendiente → conectado → webhook_ok → primer_mensaje, y `error` guarda el paso
 * y el motivo sin perder lo ya hecho (las columnas *_at no se borran).
 */
export const whatsappOnboarding = pgTable("whatsapp_onboarding", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: ["pendiente", "conectado", "webhook_ok", "primer_mensaje", "error"],
  })
    .notNull()
    .default("pendiente"),
  mode: text("mode", { enum: ["coexistence", "cloud_api"] }),
  wabaId: text("waba_id"),
  phoneNumberId: text("phone_number_id"),
  /** Paso del alta que falló (clave de `onboarding/errors.ts`), null sin error. */
  errorStep: text("error_step"),
  /** Código de Meta si lo hubo (p. ej. 133005), para soporte; nunca se muestra crudo. */
  errorCode: text("error_code"),
  /** Detalle técnico para soporte (mensaje de Meta). No llega al dueño. */
  errorDetail: text("error_detail"),
  /** Paso del popup donde el dueño canceló (current_step de Meta). */
  cancelledAtStep: text("cancelled_at_step"),
  attempts: integer("attempts").notNull().default(0),
  connectedAt: timestamp("connected_at"),
  webhookOkAt: timestamp("webhook_ok_at"),
  firstMessageAt: timestamp("first_message_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * 014 - Credenciales del canal de Instagram. Tabla explicita (no un jsonb
 * generico) porque unas credenciales tienen forma fija y conocida: asi
 * conservan tipado e indices. El token se cifra con los mismos helpers que el
 * de WhatsApp; un segundo mecanismo de cifrado seria un segundo mecanismo que
 * auditar.
 */
export const instagramCredentials = pgTable(
  "instagram_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** De donde vienen los mensajes: API unificada o app propia de Meta. */
    source: text("source", { enum: ["zernio", "meta"] }).notNull(),
    /** IG_ID del perfil profesional: por el enruta el webhook. */
    igUserId: text("ig_user_id").notNull(),
    /** Zernio: accountId de la cuenta conectada. Meta directo: null. */
    accountRef: text("account_ref"),
    username: text("username"),
    tokenCipher: text("token_cipher").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenTag: text("token_tag").notNull(),
    /** Secreto HMAC de las entregas (Zernio); null en modo Meta. */
    webhookSecret: text("webhook_secret"),
    status: text("status", { enum: ["connected", "reconnect_required"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("instagram_credentials_org_uq").on(t.organizationId),
    uniqueIndex("instagram_credentials_ig_user_uq").on(t.igUserId),
    index("instagram_credentials_account_ref_idx").on(t.accountRef),
  ]
);

/**
 * 017 — Credenciales del canal de Messenger: la página de Facebook y su token
 * de acceso, cifrado con el mismo AES-256-GCM que los demás. Tabla propia y
 * explícita, como la de Instagram: unas credenciales tienen forma fija y
 * conocida, y esconderlas en un jsonb perdería el tipado y los índices.
 */
export const messengerCredentials = pgTable(
  "messenger_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** De donde vienen los mensajes: API unificada o app propia de Meta. */
    source: text("source", { enum: ["zernio", "meta"] })
      .notNull()
      .default("meta"),
    /**
     * ID de la página de Facebook: por él enruta el webhook de Meta
     * (`entry[].id`). En modo Zernio puede no conocerse — ahí enruta
     * `account_ref` — así que es opcional.
     */
    pageId: text("page_id"),
    pageName: text("page_name"),
    /** Zernio: accountId de la cuenta conectada. Meta directo: null. */
    accountRef: text("account_ref"),
    tokenCipher: text("token_cipher").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenTag: text("token_tag").notNull(),
    /** Secreto HMAC de las entregas (Zernio); null en modo Meta. */
    webhookSecret: text("webhook_secret"),
    status: text("status", { enum: ["connected", "reconnect_required"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("messenger_credentials_org_uq").on(t.organizationId),
    uniqueIndex("messenger_credentials_page_uq").on(t.pageId),
    index("messenger_credentials_account_ref_idx").on(t.accountRef),
  ]
);

export const agentProfile = pgTable(
  "agent_profile",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    name: text("name").notNull().default("Rei"),
    tone: text("tone"),
    instructions: text("instructions"),
    escalationRules: text("escalation_rules"),
    greeting: text("greeting"),
    /** Horario de respuestas de Allok; no es la disponibilidad de citas. */
    businessHours: jsonb("business_hours").notNull().default({}),
    businessTimezone: text("business_timezone")
      .notNull()
      .default("America/Mexico_City"),
    responseMode: text("response_mode", {
      enum: ["outside_hours", "all_day"],
    })
      .notNull()
      .default("outside_hours"),
    /**
     * Fork — la pausa por respuesta manual VENCE: cuántas horas sin que el
     * dueño escriba desde el teléfono tarda la IA en retomar un chat que él
     * tomó a mano. NULL = el valor por defecto (12, `pausa-manual.ts`);
     * 0 = nunca, la reactiva él desde la conversación.
     */
    handoffResumeHours: integer("handoff_resume_hours"),
    /**
     * Fork — seguimiento: horas de silencio del cliente (tras la última
     * respuesta del agente) antes de que el agente le escriba UNA vez para
     * retomar. NULL o 0 = apagado. Ver `server/agencia/seguimiento.ts`.
     */
    followUpHours: integer("follow_up_hours"),
    activationEnabled: boolean("preset_only").notNull().default(false),
    activationMessages: jsonb("preset_replies")
      .$type<string[]>()
      .notNull()
      .default([]),
    allowlistEnabled: boolean("allowlist_enabled").notNull().default(false),
    allowedWaIds: jsonb("allowed_wa_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    lastLiveTestAt: timestamp("last_live_test_at"),
    lastLiveTestPassed: boolean("last_live_test_passed"),
    lastLiveTestElapsedMs: integer("last_live_test_elapsed_ms"),
    // Proveedor de IA preferido para este agente. Los inquilinos nuevos nacen
    // con "openrouter" (GLM 5.3 Flash, `default-profile.ts`); si el preferido
    // no responde, el adaptador cae al otro proveedor disponible. El default de
    // la columna sigue en "openai" para no pedir migración.
    aiProvider: text("ai_provider", { enum: ["openai", "openrouter"] })
      .notNull()
      .default("openai"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_profile_org_uq").on(t.organizationId)]
);

/** Claves propias de IA por organización. Nunca se devuelve el secreto en la API. */
export const aiCredentials = pgTable(
  "ai_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["openai", "openrouter"] }).notNull(),
    model: text("model").notNull(),
    keyCipher: text("key_cipher").notNull(),
    keyIv: text("key_iv").notNull(),
    keyTag: text("key_tag").notNull(),
    keyLast4: text("key_last4").notNull(),
    lastValidatedAt: timestamp("last_validated_at").notNull().defaultNow(),
    /**
     * `auth_failed`/`no_credits`: la razón EXACTA que Nea reportó con esta
     * clave (dispatch v2, step 6/item 11) — Nea sigue respondiendo con la de
     * allok mientras el dueño no la reemplace, y la UI distingue "se quedó
     * sin créditos" de "la rechazaron" en vez de un genérico "inválida".
     * `invalid` queda como valor legado (de antes de item 11) — se trata
     * igual que `auth_failed` donde se lee. Columna `text` sin CHECK: agregar
     * un valor es aditivo y no pide migración.
     */
    lastValidationStatus: text("last_validation_status", {
      enum: ["valid", "invalid", "auth_failed", "no_credits"],
    })
      .notNull()
      .default("valid"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ai_credentials_org_provider_uq").on(t.organizationId, t.provider),
  ]
);

export const kbEntry = pgTable(
  "kb_entry",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["qa", "block"] }).notNull(),
    question: text("question"),
    answer: text("answer"),
    content: text("content"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("kb_org_idx").on(t.organizationId)]
);

export const template = pgTable(
  "template",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    language: text("language").notNull(),
    category: text("category").notNull(),
    body: text("body").notNull(),
    status: text("status", {
      enum: ["draft", "pending", "approved", "rejected"],
    })
      .notNull()
      .default("draft"),
    rejectionReason: text("rejection_reason"),
    waTemplateId: text("wa_template_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("template_org_name_lang_uq").on(
      t.organizationId,
      t.name,
      t.language
    ),
  ]
);

export const agentTestRun = pgTable(
  "agent_test_run",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["running", "done", "failed"] })
      .notNull()
      .default("running"),
    score: integer("score"),
    error: text("error"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    // Lock de concurrencia en BD: máximo 1 corrida activa por organización.
    uniqueIndex("test_run_org_running_uq")
      .on(t.organizationId)
      .where(sql`${t.status} = 'running'`),
    index("test_run_org_idx").on(t.organizationId, t.startedAt),
  ]
);

/* ============================================================
 * 015 — Motor de agenda (detrás de la bandera AGENDA)
 *
 * Las tablas se crean SIEMPRE, encendida o apagada la bandera: una tabla
 * vacía es inerte, y a cambio todas las instancias del mundo comparten la
 * misma estructura y la misma cadena de migraciones (ADR-001).
 * ============================================================ */

/** Configuración de la agenda del negocio: una fila por organización. */
export const calendarSettings = pgTable(
  "calendar_settings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** `{"mon":[{"start":"09:00","end":"18:00"}]}` — hora de PARED, no UTC. */
    weeklyHours: jsonb("weekly_hours").notNull(),
    slotMinutes: integer("slot_minutes").notNull().default(30),
    bufferMinutes: integer("buffer_minutes").notNull().default(0),
    minNoticeHours: integer("min_notice_hours").notNull().default(2),
    maxDaysAhead: integer("max_days_ahead").notNull().default(7),
    timezone: text("timezone").notNull().default("America/Mexico_City"),
    /**
     * Cómo se entrega la reunión. `enlace-fijo` no habla con nadie: es el
     * default y la razón de que encender la agenda no exija terceros.
     * Un fork agrega el suyo al catálogo del código sin tocar esta columna.
     */
    connector: text("connector").notNull().default("enlace-fijo"),
    /** Sala fija del conector `enlace-fijo`; null ⇒ citas sin link. */
    meetingLink: text("meeting_link"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("calendar_settings_org_uq").on(t.organizationId)]
);

/**
 * La cita. Una sola tabla para sesiones y bloqueos manuales: un bloqueo es
 * una cita sin contacto que ocupa agenda igual.
 */
export const booking = pgTable(
  "booking",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["session", "block"] })
      .notNull()
      .default("session"),
    status: text("status", {
      enum: ["agendada", "realizada", "no_show", "cancelada"],
    })
      .notNull()
      .default("agendada"),
    source: text("source", { enum: ["manual", "ai"] })
      .notNull()
      .default("manual"),
    contactId: text("contact_id").references(() => contact.id, {
      onDelete: "cascade",
    }),
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "set null",
    }),
    leadId: text("lead_id").references(() => lead.id, { onDelete: "set null" }),
    /** Instante UTC. El horario semanal es de pared; esto ya está resuelto. */
    scheduledAt: timestamp("scheduled_at").notNull(),
    /** Capturada al crear: cambiar la configuración no reescribe el pasado. */
    durationMinutes: integer("duration_minutes").notNull(),
    /**
     * Con qué conector nació la ENTREGA. Reprogramar y cancelar hablan con
     * ESTE, no con el activo: si el negocio cambia de proveedor, las citas ya
     * confirmadas siguen viviendo donde se crearon.
     */
    connector: text("connector"),
    /** Id de la reunión/evento en el proveedor; null en `enlace-fijo`. */
    externalRef: text("external_ref"),
    /**
     * El link que se le dio al cliente. Se COPIA, no se lee de la
     * configuración: la cita es un hecho histórico, no una vista del presente.
     */
    meetingLink: text("meeting_link"),
    /**
     * El proveedor falló al crear la reunión. La cita existe igual —un tercero
     * caído no cuesta la conversión— y el operador reintenta desde "Citas".
     */
    linkPending: boolean("link_pending").notNull().default(false),
    /** Conversación del Laboratorio: jamás llama a un conector real. */
    isTest: boolean("is_test").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("booking_org_when_idx").on(t.organizationId, t.scheduledAt),
    index("booking_org_status_idx").on(t.organizationId, t.status),
    /**
     * Anti doble-booking ATÓMICO. La re-validación al confirmar deja una
     * ventana entre leer y escribir; esto la cierra en la BASE: dos
     * confirmaciones simultáneas del mismo instante no pueden ganar las dos, y
     * la perdedora recibe un 23505 que el servicio traduce a `slot_taken` con
     * alternativas frescas. Las citas de prueba quedan fuera: no consumen la
     * agenda real.
     */
    uniqueIndex("booking_org_active_slot_uq")
      .on(t.organizationId, t.scheduledAt)
      .where(
        sql`${t.status} in ('agendada','realizada') and ${t.isTest} = false`
      ),
  ]
);

/**
 * La memoria de lo ofrecido. Es lo que hace verificable el requisito
 * innegociable: sin fila aquí, no hay reserva.
 *
 * Vive en el CRM y no en quien conduce la conversación porque Vocero promete
 * "conecta TU propio cerebro": con la garantía del lado del cliente, cualquier
 * cerebro podría reservar un instante que jamás se ofreció y el CRM lo
 * aceptaría.
 */
export const offeredSlot = pgTable(
  "offered_slot",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    startUtc: timestamp("start_utc").notNull(),
    /** La etiqueta EXACTA que se le mostró al cliente. */
    label: text("label").notNull(),
    offeredAt: timestamp("offered_at").notNull().defaultNow(),
  },
  (t) => [index("offered_slot_conv_idx").on(t.conversationId, t.startUtc)]
);

/**
 * Credenciales del conector Zoom (app Server-to-Server del propio negocio).
 * Tabla explícita como las de WhatsApp e Instagram: unas credenciales tienen
 * forma fija y conocida, y así conservan tipado e índices. El secreto se cifra
 * con los mismos helpers; un segundo mecanismo sería otro que auditar.
 */
export const zoomCredentials = pgTable(
  "zoom_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    clientId: text("client_id").notNull(),
    secretCipher: text("secret_cipher").notNull(),
    secretIv: text("secret_iv").notNull(),
    secretTag: text("secret_tag").notNull(),
    /** `error` SE ESCRIBE cuando el proveedor rechaza la autenticación. */
    status: text("status", { enum: ["connected", "error"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("zoom_credentials_org_uq").on(t.organizationId)]
);

/**
 * Credenciales del conector Google (Calendar + Meet), de la app de Google
 * Cloud del propio negocio. DOS secretos cifrados: el client secret y el
 * refresh token pegado una sola vez.
 */
export const googleCredentials = pgTable(
  "google_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    clientSecretCipher: text("client_secret_cipher").notNull(),
    clientSecretIv: text("client_secret_iv").notNull(),
    clientSecretTag: text("client_secret_tag").notNull(),
    refreshTokenCipher: text("refresh_token_cipher").notNull(),
    refreshTokenIv: text("refresh_token_iv").notNull(),
    refreshTokenTag: text("refresh_token_tag").notNull(),
    calendarId: text("calendar_id").notNull().default("primary"),
    status: text("status", { enum: ["connected", "error"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("google_credentials_org_uq").on(t.organizationId)]
);

export const agentTestCase = pgTable(
  "agent_test_case",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => agentTestRun.id, { onDelete: "cascade" }),
    persona: text("persona").notNull(),
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "set null",
    }),
    transcript: jsonb("transcript"),
    veredicto: text("veredicto", { enum: ["verde", "amarillo", "rojo"] }),
    hallazgos: jsonb("hallazgos"),
    status: text("status", {
      enum: ["pending", "running", "done", "judge_failed"],
    })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("test_case_run_idx").on(t.runId)]
);

/* ============================================================
 * 016 — Atribución de anuncios y Conversions API
 * (detrás de la bandera ATRIBUCION)
 * ============================================================ */

/**
 * De qué anuncio vino una conversación. El primer referral gana: el UNIQUE de
 * abajo es lo que vuelve idempotente la captura ante los reintentos de Meta,
 * en vez de un "consulta y luego inserta" que dos webhooks simultáneos
 * ganarían los dos.
 */
export const adAttribution = pgTable(
  "ad_attribution",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    /**
     * El identificador del clic en el anuncio. Es la llave de TODO: sin él no
     * hay nada que reportarle a Meta. Nullable porque hay referrals sin clid,
     * y porque sin la bandera ATRIBUCION no se guarda (018): el origen del
     * anuncio se ve siempre, el identificador de clic solo si se atribuye.
     */
    ctwaClid: text("ctwa_clid"),
    sourceId: text("source_id"),
    sourceType: text("source_type"),
    sourceUrl: text("source_url"),
    headline: text("headline"),
    body: text("body"),
    mediaType: text("media_type"),
    /**
     * 018 — La imagen del creativo, copiada del CDN de Meta (su URL caduca en
     * días). Compartida por todas las conversaciones del mismo `source_id`: se
     * descarga una vez por anuncio. Borrar el adjunto deja la fila sin imagen,
     * no apuntando a nada.
     */
    imageAssetId: text("image_asset_id").references(() => mediaAsset.id, {
      onDelete: "set null",
    }),
    /**
     * El referral recortado a sus claves conocidas (018: con cotas de tamaño,
     * y sin `ctwa_clid` si la bandera estaba apagada). Es la póliza contra
     * "Meta agregó un campo", y de aquí se vuelve a leer la URL de la imagen
     * cuando hay que reparar la copia.
     */
    raw: jsonb("raw").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ad_attribution_org_conversation_uq").on(
      t.organizationId,
      t.conversationId
    ),
    index("ad_attribution_org_contact_idx").on(t.organizationId, t.contactId),
    // 018 — la imagen ya guardada de un anuncio, y a qué filas asignarla.
    index("ad_attribution_org_source_idx").on(t.organizationId, t.sourceId),
  ]
);

/**
 * Cada intento de reportarle un desenlace a Meta. Las filas `skipped` no son
 * basura: son la respuesta a "¿por qué este lead no aparece en Meta?", que sin
 * ellas se contesta adivinando.
 */
export const conversionEvent = pgTable(
  "conversion_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    attributionId: text("attribution_id").references(() => adAttribution.id, {
      onDelete: "set null",
    }),
    /** Nombre del catálogo de Meta tal cual (`QualifiedLead`, `Purchase`). */
    eventName: text("event_name").notNull(),
    status: text("status", { enum: ["pending", "sent", "failed", "skipped"] })
      .notNull()
      .default("pending"),
    /** Motivo legible: por qué se omitió, o qué contestó Meta. */
    error: text("error"),
    /**
     * Acuse del envío. Es la única referencia que Meta pide para rastrear un
     * evento de su lado; sin persistirla, un `sent` no se puede reclamar.
     */
    fbTraceId: text("fb_trace_id"),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // El dedup ES este índice: la fila se inserta ANTES de hablar con Meta y
    // con ON CONFLICT DO NOTHING. Dos movimientos simultáneos del mismo lead
    // no pueden mandar dos compras.
    uniqueIndex("conversion_event_org_conv_name_uq").on(
      t.organizationId,
      t.conversationId,
      t.eventName
    ),
    index("conversion_event_org_created_idx").on(
      t.organizationId,
      t.createdAt
    ),
  ]
);

/** Conexión del negocio con su dataset de Meta (token cifrado en reposo). */
export const capiSettings = pgTable(
  "capi_settings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    datasetId: text("dataset_id").notNull(),
    tokenCipher: text("token_cipher").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenTag: text("token_tag").notNull(),
    /**
     * Qué etapa significa "lead calificado" PARA ESTE NEGOCIO. Las etapas
     * sembradas de Vocero no incluyen ninguna con ese nombre y cada quien
     * renombra las suyas, así que se elige en vez de adivinarse. NULL = ese
     * evento no se emite. `set null` a propósito: borrar la etapa apaga el
     * evento, no rompe la configuración.
     */
    qualifiedStageId: text("qualified_stage_id").references(
      () => pipelineStage.id,
      { onDelete: "set null" }
    ),
    status: text("status", { enum: ["connected", "error"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("capi_settings_org_uq").on(t.organizationId)]
);

/* ============================================================
 * Gasto de anuncios (fork — Cloud lo tiene, upstream open source no)
 * ============================================================ */

/**
 * Lo que el dueño cargó a mano por fuente y periodo. No hay conector de
 * anuncios en el núcleo (Soberanía II): el gasto real vive en Meta Ads y
 * aquí solo se anota lo que el dueño dice que gastó, para poder mostrar
 * costo por prospecto/cliente y retorno en Resultados.
 *
 * Por FUENTE, no por anuncio ni creativo: el gasto de Meta se factura por
 * conjunto/campaña, no por `source_id` individual, y repartirlo entre
 * creativos sería inventar un número que nadie cargó.
 */
export const adSpend = pgTable(
  "ad_spend",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    source: text("source", {
      enum: ["anuncio", "organico", "referido", "conocido", "otro"],
    }).notNull(),
    // `mode: "string"` explícito (ya es el default): se compara y se prorratea
    // como fecha de calendario `YYYY-MM-DD`, igual que `PeriodDto.from`/`to` —
    // nunca como instante, que traería la zona horaria de vuelta al problema
    // que `period.ts` ya resolvió.
    periodStart: date("period_start", { mode: "string" }).notNull(),
    /** INCLUSIVO, como `from`/`to` en el resto de Resultados. */
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    // bigint, no integer: un gasto real (una campaña anual grande, varias
    // monedas fuertes) pasa los $21,474,836.48 que un integer de Postgres
    // permite en centavos. `mode: "number"` porque nunca se acerca a
    // Number.MAX_SAFE_INTEGER (unos 90 billones de centavos) y así el resto
    // del código sigue viendo un `number`, no un `bigint` de JS.
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    /** La del negocio (`getBranding().currency`): un solo gasto, una sola moneda. */
    currency: text("currency").notNull(),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("ad_spend_org_period_idx").on(t.organizationId, t.periodStart),
    check("ad_spend_amount_cents_ck", sql`${t.amountCents} >= 0`),
  ]
);

/* ============================================================
 * Vertical inmobiliario — parte 1 (flag, catálogo, fotos)
 *
 * Activo SOLO para organizaciones con `organization.metadata.vertical ===
 * "inmobiliario"` (`server/agencia/vertical.ts`). Mismo patrón que 015/016
 * (ADR-001): las tablas existen SIEMPRE — vacías son inertes — y lo que
 * decide si el vertical EXISTE para el usuario es la bandera por
 * organización, no una rama aparte. `organization_id` NOT NULL, FK con
 * cascade e índice org-first, como el resto del dominio; toda query pasa por
 * `scoped()`.
 *
 * Los valores de cada enum viven, como texto, EN ESTE ARCHIVO (nunca se
 * importa `lib/realty/catalog.ts` aquí, para no romper la regla de que
 * `schema.ts` no depende de nada propio): ese módulo es la fuente de verdad
 * legible (labels, formato, validadores Zod) y debe leerse igual a esta
 * lista. Portado y adaptado de `vocero-inmobiliario-main` (spec 003): a
 * diferencia de ese fork, aquí las fotos NO viven en Postgres (ver
 * `server/storage/`) y las visitas son la `booking` de allok con
 * `booking_property` al lado, no una tabla `viewing` propia.
 * ============================================================ */

/**
 * Contador de versión del inventario POR organización. Cualquier escritura
 * sobre `property` lo incrementa (`bumpCatalogVersion`), y eso invalida la
 * caché de matches de TODOS los leads sin recorrerlos: una propiedad nueva
 * aparece de inmediato en los paneles (parte 2).
 */
export const orgCatalogVersion = pgTable("org_catalog_version", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const property = pgTable(
  "property",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    operation: text("operation", {
      enum: ["renta", "venta", "anticretico"],
    }).notNull(),
    kind: text("kind", {
      enum: ["casa", "departamento", "local", "terreno", "oficina", "bodega"],
    }).notNull(),
    /** Si falta, se deriva `<Tipo> en <ciudad>` (`derivedTitle`): nunca vacío. */
    title: text("title"),
    price: numeric("price", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency", { enum: ["USD", "BOB", "MXN"] })
      .notNull()
      .default("USD"),
    address: text("address"),
    /** Colonia: campo de PRIMER nivel — es la unidad de zona que puntúa. */
    neighborhood: text("neighborhood"),
    city: text("city"),
    bedrooms: integer("bedrooms"),
    /** Admite medios baños (`1.5`), reales en el mercado. */
    bathrooms: numeric("bathrooms", { precision: 3, scale: 1 }),
    builtArea: numeric("built_area", { precision: 10, scale: 2 }),
    lotArea: numeric("lot_area", { precision: 10, scale: 2 }),
    parking: integer("parking"),
    amenities: jsonb("amenities").$type<string[]>().notNull().default([]),
    /** Formas de pago que acepta (un crédito exige avalúo y papeleo propio). */
    acceptedPayments: jsonb("accepted_payments")
      .$type<string[]>()
      .notNull()
      .default([]),
    /** Eje A — estatus COMERCIAL. Transiciones libres. */
    status: text("status", { enum: ["disponible", "apartada", "cerrada"] })
      .notNull()
      .default("disponible"),
    description: text("description"),
    /**
     * Eje B — visibilidad (soft-delete reversible), ORTOGONAL al estatus:
     * archivar no toca `status` y desarchivar lo devuelve tal como estaba.
     * No existe borrado duro.
     */
    archivedAt: timestamp("archived_at"),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("property_org_visible_idx").on(
      t.organizationId,
      t.archivedAt,
      t.status
    ),
    index("property_org_operation_price_idx").on(
      t.organizationId,
      t.operation,
      t.price
    ),
    index("property_org_created_idx").on(t.organizationId, t.createdAt),
  ]
);

/**
 * Fotos de propiedades. Constitución II (1.4.0): el binario vive en el
 * conector opcional de almacenamiento (`server/storage/`, Cloudflare R2 del
 * OPERADOR del despliegue) con un camino sin dependencia externa (disco local
 * bajo `MEDIA_DIR`) cuando ese conector no está configurado — ver la
 * enmienda de `.specify/memory/constitution.md`. Esta tabla solo guarda la
 * llave (`storage_key`) y los metadatos; nunca el binario.
 *
 * La PORTADA es la foto en posición 0. No hay bandera "es portada": una sola
 * fuente de verdad hace imposible tener dos portadas o ninguna.
 */
export const propertyPhoto = pgTable(
  "property_photo",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    propertyId: text("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    /** `0..n-1` sin huecos. La posición 0 ES la portada. */
    position: integer("position").notNull(),
    /** Llave dentro del bucket/`MEDIA_DIR`: `org/<orgId>/properties/<propertyId>/<photoId>.<ext>`. */
    storageKey: text("storage_key").notNull(),
    mime: text("mime", {
      enum: ["image/jpeg", "image/png", "image/webp"],
    }).notNull(),
    byteSize: integer("byte_size").notNull(),
    /** Dimensiones reales del archivo guardado; null si no se pudieron leer. */
    width: integer("width"),
    height: integer("height"),
    /** Media id de Graph, cacheado para no resubir la foto en cada envío (parte 2). */
    waMediaId: text("wa_media_id"),
    waMediaExpiresAt: timestamp("wa_media_expires_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("photo_property_position_uq").on(t.propertyId, t.position),
    index("photo_org_property_idx").on(t.organizationId, t.propertyId),
  ]
);

/** Qué busca un lead. 1:1 con `lead`, igual que `lead` es 1:1 con `contact`. */
export const requirement = pgTable(
  "requirement",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    leadId: text("lead_id")
      .notNull()
      .references(() => lead.id, { onDelete: "cascade" }),
    operation: text("operation", {
      enum: ["renta", "venta", "anticretico"],
    }),
    budgetMin: numeric("budget_min", { precision: 14, scale: 2 }),
    budgetMax: numeric("budget_max", { precision: 14, scale: 2 }),
    currency: text("currency", { enum: ["USD", "BOB", "MXN"] })
      .notNull()
      .default("USD"),
    /**
     * Lista de zonas ("Del Valle", "Narvarte"). `jsonb`, no `text`: el
     * contrato de Nea (parte 2, `/api/bot/realty/*`) manda `zones: string[]`
     * directo — `lib/realty/catalog.ts#parseZones` normaliza esto o una
     * cadena "Del Valle, Narvarte" a la misma forma para quien la escriba
     * como texto libre.
     */
    zones: jsonb("zones").$type<string[]>().notNull().default([]),
    kind: text("kind", {
      enum: ["casa", "departamento", "local", "terreno", "oficina", "bodega"],
    }),
    minBedrooms: integer("min_bedrooms"),
    minBathrooms: numeric("min_bathrooms", { precision: 3, scale: 1 }),
    amenities: jsonb("amenities").$type<string[]>().notNull().default([]),
    /** En LATAM decide la viabilidad del prospecto, no es un extra. */
    paymentMethod: text("payment_method", {
      enum: [
        "contado",
        "credito_bancario",
        "credito_vis",
        "otro",
      ],
    }),
    needsGuarantor: boolean("needs_guarantor"),
    urgency: text("urgency", { enum: ["alta", "media", "baja"] }),
    notes: text("notes"),
    /**
     * Campos fijados a mano por un asesor: la extracción del agente NO los
     * pisa. Sin esto, la IA sobrescribe correcciones humanas.
     */
    manualFields: jsonb("manual_fields").$type<string[]>().notNull().default([]),
    /** Sube solo si algún campo cambió de verdad (invalida la caché). */
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("requirement_lead_uq").on(t.leadId),
    index("requirement_org_updated_idx").on(t.organizationId, t.updatedAt),
  ]
);

/**
 * Caché del cruce lead↔propiedad con sus razones (parte 2). El `score` es
 * SIEMPRE el determinista (`server/realty/matching.ts`, auditable); la IA
 * solo añade `aiExplanation`.
 *
 * Válida únicamente si `requirementVersion` Y `catalogVersion` coinciden con
 * los actuales — así una propiedad nueva invalida sin esperar al lead.
 */
export const propertyMatch = pgTable(
  "property_match",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    leadId: text("lead_id")
      .notNull()
      .references(() => lead.id, { onDelete: "cascade" }),
    propertyId: text("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    reasons: jsonb("reasons").notNull(),
    aiExplanation: text("ai_explanation"),
    requirementVersion: integer("requirement_version").notNull(),
    catalogVersion: integer("catalog_version").notNull(),
    computedAt: timestamp("computed_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("match_lead_property_uq").on(t.leadId, t.propertyId),
    index("match_org_lead_score_idx").on(t.organizationId, t.leadId, t.score),
    index("match_org_property_score_idx").on(
      t.organizationId,
      t.propertyId,
      t.score
    ),
    check(
      "property_match_score_ck",
      sql`${t.score} >= 0 AND ${t.score} <= 100`
    ),
  ]
);

/**
 * Extensión lateral de UNA `booking` de allok cuando es la visita a una
 * propiedad (parte 2). `booking_id` ES la clave primaria (no hay `id`
 * propio): es 1:1 con la cita, nunca una entidad aparte — igual que
 * `org_catalog_version` usa `organization_id` como PK.
 *
 * `restrict` en `property_id`: una propiedad con visitas no se borra (solo
 * se archiva, `property.archived_at`).
 */
export const bookingProperty = pgTable(
  "booking_property",
  {
    bookingId: text("booking_id")
      .primaryKey()
      .references(() => booking.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    propertyId: text("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "restrict" }),
    /** El feedback de la muestra es el dato más valioso del proceso. */
    outcome: text("outcome", {
      enum: ["interesado", "no_interesado", "quiere_negociar", "sin_definir"],
    }),
    /** Sello de idempotencia: exactamente un recordatorio por visita. */
    reminderSentAt: timestamp("reminder_sent_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("booking_property_org_property_idx").on(
      t.organizationId,
      t.propertyId
    ),
  ]
);

/**
 * El foco inmobiliario de UNA conversación (parte 2: qué propiedad está
 * mostrando el agente ahora mismo). `conversation_id` ES la clave primaria:
 * a lo más una propiedad enfocada por conversación. `set null` en
 * `property_id`: borrar o archivar la propiedad no debe borrar la
 * conversación, solo le apaga el foco.
 *
 * Antes vivía como columna en `conversation` (fork inmobiliario); en este
 * repo `conversation` es una tabla de upstream y el CLAUDE.md del fork
 * prohíbe agregarle columnas propias — de ahí la tabla lateral.
 */
export const conversationProperty = pgTable(
  "conversation_property",
  {
    conversationId: text("conversation_id")
      .primaryKey()
      .references(() => conversation.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    propertyId: text("property_id").references(() => property.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("conversation_property_org_property_idx").on(
      t.organizationId,
      t.propertyId
    ),
  ]
);

/**
 * Fork — avisos al celular (Web Push). Un renglón por navegador/teléfono en el
 * que una persona del negocio dijo «avísame»: cuando el agente pasa una
 * conversación a una persona o agenda una cita, le llega una notificación
 * aunque no tenga la app abierta. Sin renglones, no se manda nada (el camino
 * sin aviso es el de siempre: la bandeja).
 *
 * `endpoint` es la URL que el navegador dio para esta suscripción: única,
 * porque el mismo teléfono que vuelve a decir «avísame» la reutiliza. `p256dh`
 * y `auth` son las llaves PÚBLICAS de cifrado del navegador (no secretos del
 * negocio): sin la llave privada del servidor no sirven para nada.
 */
export const pushSubscription = pgTable(
  "push_subscription",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastSentAt: timestamp("last_sent_at"),
  },
  (t) => [
    uniqueIndex("push_subscription_endpoint_uq").on(t.endpoint),
    index("push_subscription_org_idx").on(t.organizationId),
  ]
);
