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
| Mensaje | `message` | `wa_message_id` UNIQUE; `origin` dice quién lo mandó. Adjuntos en `media_asset`. |
| Anuncio de origen | `ad_attribution` | Un renglón por conversación; guarda el `referral` normalizado. |
| Decisión del agente | `agent_decision` | Una por turno real. Ver Enriquecer. |
| Resultado | `lead`, `lead_stage_event`, `booking` | Ya son el desenlace; no hay tabla aparte. |

**Crudo vs derivado.** `raw_event` es lo recibido. Todo lo demás se deriva de él
y se reconstruye repitiendo el evento: si un derivado está mal y el crudo bien,
se arregla el código y se repite; no se edita a mano.

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
| `failed` | Un procesador lanzó (`error` corto, sin contenido). | 503 hasta el 3er intento; luego 200. | Reintento de Meta o replay. |
| `unrouted` | El `phone_number_id` (o WABA) no está conectado. | 200. | Replay tras conectar el número. |
| `unmatched` | Un estado llegó antes que su mensaje. | 200. | Replay cuando el mensaje existe. |
| `ignored` | Campo que no manejamos (se guarda igual). | 200. | |
| `pending` | Guardado, aún sin cerrar (proceso caído a medias). | | Replay con `statuses: ["pending"]`. |

Un cuerpo ilegible con firma válida se guarda como `_unparsed` (`failed`) y responde
200. Un echo que falla queda `failed` sin pedir 503. Si guardar la fila falla, el
evento se procesa igual. Un veneno (falla siempre) agota sus 3 intentos: 200, la
fila queda `failed` y un POST repetido ya no la procesa; el replay sí.

`organization_id` es NULL mientras no se pueda enrutar. Es la única tabla de
dominio sin tenant obligatorio, por eso NO se expone a los miembros: solo el
replay del admin la toca. Los NUL y sustitutos sueltos se quitan de TODO el
cambio (texto, nombre, caption, payloads; jsonb y `text` los rechazan).

## Replay

```ts
replayRawEvents({ organizationId?, statuses = ["failed","unrouted","unmatched"], since?, limit = 500 })
```

Vuelve a enrutar y procesar con el mismo procesador que el webhook, los MENOS
intentados primero (un `unmatched` que nunca coincide se hunde y no deja sin
turno al lote). Con `organizationId` incluye lo `unrouted` de su número. Endpoint
solo del admin SaaS (auditado en `saas_admin_audit`); una instancia dedicada llama
la función:

```bash
curl -X POST https://admin.allok.fun/api/saas/raw-events/replay -H 'content-type: application/json' \
  -H 'cookie: <sesion admin>' -d '{"organizationId":"org_...","statuses":["unrouted"]}'
# {"scanned":3,"processed":3,"unrouted":0,"unmatched":0,"ignored":0,"failed":0}
```

**Un replay jamás le escribe al cliente ni cambia el estado hacia atrás**: guarda
el mensaje (el equipo lo ve, sin leer) pero no pide turno del agente ni crea
`agent_job`, un echo viejo no pausa la IA, y una plantilla solo se actualiza si
nada la tocó después del evento.

## 2. Normalizar

Columnas de `message` que salen del canal: `reply_to_wa_id` (`context.id`),
`sent_at / delivered_at / read_at / failed_at` (el `timestamp` de Meta; se llenan
aunque el estado no suba, así un `delivered` tardío tras `read` deja su marca),
`raw_event_id` (de qué evento salió, entrantes y echoes) y `sender_user_id`
(el usuario del CRM en sus envíos: texto, adjuntos, ubicación, contactos y
plantillas; null en la IA y en lo escrito a mano en el teléfono). `origin` (`ai | operator | manual | template |
history`) sigue siendo el tipo de remitente. El `status` es monotónico y
`last_inbound_at`, `last_message_at` y `lead.last_activity_at` solo avanzan
(`GREATEST`): un evento viejo, de replay o reintento, no los mueve atrás.

## 3. Atribuir

`ad_attribution` guarda el anuncio de origen (`server/attribution/`). El
`referral` completo, con su `ctwa_clid`, también queda en el `raw_event`, así que
una atribución perdida se puede reconstruir.

## 4. Enriquecer: `agent_decision`

Una fila por turno real del agente (los del Laboratorio no se registran), en
`server/agencia/decisions.ts`. Registrar nunca tumba un turno.

- **Nea**: `action` (`replied | silent | noop | reset`), `handoff_reason`,
  `dispatch_id` (único por conversación: un despacho = una fila), ids de los
  entrantes que contestó y de sus respuestas (del id determinista). Si un
  reintento halla que Nea ya contestó y el 2xx se perdió, queda `replied` con un
  paso `recovered` (sin modelo ni tokens). `decision` es OPCIONAL en la respuesta
  de Nea (`model`, `promptVersion`, `steps`, `latencyMs`, `tokens`); se valida con
  Zod (máx. 20 pasos, `summary` de 200). Sin él, la fila queda igual.
- **Rei**: acción ejecutada, motivo del handoff, modelo y tokens que reporta el
  proveedor, y `prompt_version` (12 hex del sha256 del prompt compilado).
- **Veredicto**: `verdict` `bien | fallo`, nota (<= 500), quién y cuándo.
  La pantalla `/decisiones` («Cómo decidió el agente») los lista y los califica
  (j/k mover, b bien, f falló); también se abre por conversación con
  `/decisiones?c=<conversationId>`. Calificar es del propietario.

API (tenant-scoped; leen los miembros, solo el propietario califica):
`GET /api/decisions?limit&cursor&verdict`, `GET /api/conversations/[id]/decisions`,
`PATCH /api/decisions/[id]` (`{ verdict: "bien"|"fallo"|null, note? }`). Previews de
<= 140 caracteres, nunca el payload crudo.

## 5. Resultado

`lead`, `lead_stage_event` y `booking` ya son los desenlaces (sin tabla aparte).
## Deliberadamente NO está construido

- Inteligencia por mensaje o por conversación (resúmenes, intención, calidad).
- Retención: `raw_event` crece sin purga. Falta un job que borre `processed` viejos.
- Fusión de identidad entre canales (el mismo cliente en WhatsApp e Instagram).
- Instagram y Messenger todavía no escriben en `raw_event`.
- Turnos que fallan (sin respuesta de Nea, error del proveedor): sin `agent_decision`;
  quedan en `agent_job.last_error` y el handoff `error`.

## Conectar otro canal

Misma tabla, con `channel`. Falta: (1) un `receive...Webhook` que haga lo de Capturar
(`insertRawEvent`, `dedupeKeyFor`, `finishRawEvent`); (2) un procesador por cambio
idempotente (`processed | unrouted | unmatched | ignored`); (3) que `replayRawEvents`
despache por `channel` (hoy asume WhatsApp); (4) `message.raw_event_id` desde su ingesta.

## Observabilidad y verificar

Una línea `[spine]` por etapa, sin contenido ni tokens (`stored`, `duplicate`,
`processed`, `unrouted`, `unmatched`, `failed`, `poison`, `decision`...). Pendientes:
`select status, count(*) from raw_event group by 1;`. Verificar: `pnpm test` (sin BD) y,
con la base migrada, `REALDB_TEST_DATABASE_URL=postgres://... pnpm exec vitest run
tests/unit/data-spine-realdb.test.ts`.
