# Data spine

Toda interacción de WhatsApp deja datos durables y repetibles. Un evento que
falla, llega antes de tiempo o llega a un número aún sin conectar no se pierde:
se vuelve a procesar. Cinco etapas:

```
Capturar -> Normalizar -> Atribuir -> Enriquecer -> Resultado
raw_event    message        ad_attribution  agent_decision  lead / booking
```

## Entidades canónicas

Cada cosa tiene UNA tabla dueña. Lo demás apunta a ella.

| Entidad | Tabla dueña | Nota |
|---|---|---|
| Evento crudo del canal | `raw_event` | El único dato crudo. Fuente del replay. |
| Contacto | `contact` | Llave `wa_identity` (teléfono o `bsuid:`), ver `inbox/identity.ts`. |
| Conversación | `conversation` | Una real por contacto. |
| Mensaje | `message` | `wa_message_id` UNIQUE. `origin` dice quién lo mandó. |
| Adjunto | `media_asset` | Archivo o payload estructurado. |
| Anuncio de origen | `ad_attribution` | Un renglón por conversación; guarda el `referral` normalizado. |
| Decisión del agente | `agent_decision` | Una por turno real. Ver Enriquecer. |
| Resultado | `lead`, `lead_stage_event`, `booking` | Ya son el desenlace; no hay tabla aparte. |

**Crudo vs derivado.** `raw_event` es lo recibido, sin tocar. Todo lo demás se
deriva de él y se puede reconstruir repitiendo el evento. Si un derivado está mal
y el crudo está bien, se arregla el código y se repite; no se edita a mano.

## 1. Capturar

`POST /api/webhooks/wa/[token]` verifica la firma y entrega el cuerpo a
`receiveWhatsAppWebhook` (`src/server/agencia/raw-events.ts`):

1. Un `raw_event` por cada `changes[]`, guardado ANTES de procesar. Una firma
   inválida no guarda nada.
2. `dedupe_key = sha256(field + JSON canónico del value)`. Un reintento de Meta
   del mismo cambio no crea otra fila: si ya está `processed` no se repite el
   proceso; en cualquier otro estado se procesa de nuevo.
3. Procesa en el orden de siempre (`messages` primero) con los procesadores de
   siempre, que son idempotentes por `wa_message_id`.
4. Anota el desenlace en la fila y cuenta el intento (`attempts + 1`).

| `status` | Significa | Qué hace Meta | Cómo se resuelve |
|---|---|---|---|
| `processed` | Aplicado. | Nada. | |
| `failed` | Un procesador lanzó (`error` corto, sin contenido). | Recibe 503 y reintenta. | Reintento de Meta o replay. |
| `unrouted` | El `phone_number_id` (o WABA) no está conectado. | 200. | Replay tras conectar el número. |
| `unmatched` | Un estado llegó antes que su mensaje. | 200. | Replay cuando el mensaje existe. |
| `ignored` | Campo que no manejamos (se guarda igual). | 200. | |
| `pending` | Guardado, aún sin cerrar (proceso caído a medias). | | Replay con `statuses: ["pending"]`. |

Un cuerpo ilegible con firma válida se guarda como `field = "_unparsed"`
(`failed`, `{ "body": "<texto>" }`) y responde 200. Un echo del teléfono que
falla queda `failed` sin pedir 503 (un echo malformado no puede hacer que Meta
desactive el webhook). Si guardar la fila falla, el evento se procesa igual.

`organization_id` es NULL mientras no se pueda enrutar. Es la única tabla de
dominio sin tenant obligatorio, por eso NO se expone a los miembros: solo el
replay del admin la toca. Los NUL y sustitutos sueltos se quitan del payload
(jsonb los rechaza); es lo único que difiere de lo recibido.

## Replay

```ts
replayRawEvents({ organizationId?, statuses = ["failed","unrouted","unmatched"], since?, limit = 500 })
```

Vuelve a enrutar y procesar cada fila, del más viejo al más nuevo, con el mismo
procesador que el webhook. Con `organizationId` incluye también lo `unrouted`
cuyo `account_ref` es el número de esa organización. El endpoint es solo del
admin SaaS (auditado en `saas_admin_audit`); una instancia dedicada llama la función:

```bash
curl -X POST https://admin.allok.fun/api/saas/raw-events/replay \
  -H 'content-type: application/json' -H 'cookie: <sesion admin>' \
  -d '{"organizationId":"org_...","statuses":["unrouted"],"since":"2026-10-01T00:00:00Z"}'
# {"scanned":3,"processed":3,"unrouted":0,"unmatched":0,"ignored":0,"failed":0}
```

Ojo: repetir `messages` viejos corre la ingesta completa, agente incluido (la
ventana de 24 h lo frena).

## 2. Normalizar

Columnas de `message` que salen del canal: `reply_to_wa_id` (`context.id`),
`sent_at / delivered_at / read_at / failed_at` (el `timestamp` de Meta; se llenan
aunque el estado no suba, así un `delivered` tardío tras `read` deja su marca),
`raw_event_id` (de qué evento salió, entrantes y echoes) y `sender_user_id`
(el usuario del CRM en sus envíos: texto, adjuntos, ubicación, contactos y
plantillas; null en la IA y en lo escrito a mano en el teléfono). `origin` (`ai | operator | manual | template |
history`) sigue siendo el tipo de remitente. El `status` sigue monotónico.

## 3. Atribuir

`ad_attribution` guarda el anuncio de origen (`server/attribution/`). El
`referral` completo, con su `ctwa_clid`, también queda en el `raw_event`, así que
una atribución perdida se puede reconstruir.

## 4. Enriquecer: `agent_decision`

Una fila por turno real del agente (los del Laboratorio no se registran), en
`server/agencia/decisions.ts`. Registrar nunca tumba un turno.

- **Nea**: `action` (`replied | silent | noop | reset`), `handoff_reason`,
  `dispatch_id`, ids de los entrantes que contestó y de sus respuestas (se
  reconstruyen del id determinista). `decision` es OPCIONAL en la respuesta de
  Nea (`model`, `promptVersion`, `steps`, `latencyMs`, `tokens`); se valida con
  Zod (máx. 20 pasos, `summary` de 200). Sin él, la fila queda igual.
- **Rei**: acción ejecutada, motivo del handoff, modelo y tokens que reporta el
  proveedor, y `prompt_version` (12 hex del sha256 del prompt compilado).
- **Veredicto**: `verdict` `bien | fallo`, nota (<= 500), quién y cuándo.

API (miembros, tenant-scoped): `GET /api/decisions?limit&cursor&verdict`,
`GET /api/conversations/[id]/decisions`, `PATCH /api/decisions/[id]`
(`{ verdict: "bien"|"fallo"|null, note? }`). Devuelven previews de <= 140
caracteres, nunca el payload crudo.

## 5. Resultado

`lead`, `lead_stage_event` y `booking` ya son los desenlaces: no hay tabla aparte.

## Deliberadamente NO está construido

- Inteligencia por mensaje o por conversación (resúmenes, intención, calidad).
- Retención: `raw_event` crece sin purga. Falta un job que borre `processed` viejos.
- Fusión de identidad entre canales (el mismo cliente en WhatsApp e Instagram).
- Instagram y Messenger todavía no escriben en `raw_event`.
- Turnos que fallan (Nea sin respuesta, error del proveedor): no dejan
  `agent_decision`; quedan en `agent_job.last_error` y en el handoff `error`.

## Conectar otro canal

Usa la misma tabla con `channel`. Falta: (1) un `receive...Webhook` que haga lo
de Capturar (`insertRawEvent`, `dedupeKeyFor`, `finishRawEvent`); (2) un procesador
por cambio idempotente que devuelva `processed | unrouted | unmatched | ignored`;
(3) que `replayRawEvents` despache por `channel` (hoy asume WhatsApp); (4) alimentar
`message.raw_event_id` desde la ingesta del canal.

## Observabilidad

Una línea `[spine]` por etapa, sin contenido ni tokens (`stored`, `duplicate`,
`processed`, `ignored`, `unrouted`, `unmatched`, `failed`, `store_failed`,
`decision`). Pendientes: `select status, count(*) from raw_event group by 1;`

## Verificar

`pnpm test` corre sin base de datos. Contra Postgres real, con la base migrada:
`REALDB_TEST_DATABASE_URL=postgres://... pnpm exec vitest run tests/unit/data-spine-realdb.test.ts`.
