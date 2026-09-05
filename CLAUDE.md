# Vocero CRM — Guía para Claude

Vocero es un CRM de WhatsApp open source (MIT), self-hosted, con agente de IA y
Laboratorio de auto-evaluación. Una instancia = un negocio. Este archivo guía a
Claude Code (u otro asistente) para operar y **modificar** este repositorio —
el caso típico: una agencia adaptando Vocero para un cliente.

## Este repo es un FORK

`adriaavila/vocero-crm` sigue a `kevinrivm/vocero-crm` (remoto `upstream`) y le
suma una **capa de agencia**: aquí una instancia no la configura su dueño, se
le ENTREGA a un cliente ya montada.

La regla que hace posible seguir fusionando con upstream para siempre:

> **Todo lo del fork vive en su propio sitio. Los archivos de upstream reciben
> una línea que lo monta, no la implementación.**

| Lo del fork | Dónde |
|---|---|
| Lógica de servidor propia | `src/server/agencia/` |
| Componentes propios | `src/components/agencia/` |
| Migraciones propias | `drizzle/9xxx_*.sql` — el rango 9xxx es del fork, así upstream nunca choca de nombre. `pnpm db:generate` las nombra `00xx`: renómbrala y ajusta su `tag` en `drizzle/meta/_journal.json`. |
| Pantallas propias | `/overview`, `/account`, `/api/readiness`, `/api/provision` |

Antes de tocar un archivo de upstream, pregúntate si el cambio cabe en
`agencia/`. Si no cabe, hazlo pequeño, coméntalo con el porqué, y considera
mandárselo a Kevin como PR: lo que él acepte deja de ser un conflicto futuro.

### Qué hace distinto este fork

- **`conversation.ai_enabled` nace según el negocio**, no siempre en true
  (`server/agencia/ia-inicial.ts`): sin cerebro configurado la instancia recién
  entregada calla; con agente interno o `BOT_API_KEY`, contesta.
- **`META_APP_SECRET` es obligatorio**: el webhook rechaza lo que no puede
  verificar y `/api/health` declara la instancia enferma sin él.
- **Guard `ai_disabled` al enviar**: una respuesta cuya conversación se pausó
  mientras el modelo redactaba se descarta.
- **La agenda ve el Google Calendar del dueño**
  (`server/agencia/agenda-externa.ts`): los eventos se espejan como bloqueos.
- **La ficha mueve el embudo** (`server/agencia/ficha-pipeline.ts`).
- **Controles de piloto**: mensajes de activación, allowlist de números,
  proveedor de IA por organización, prueba real por WhatsApp (WAHA).

### Traer lo nuevo de upstream

```bash
git remote add upstream https://github.com/kevinrivm/vocero-crm.git  # una vez
git fetch upstream && git merge upstream/main
```

Al resolver: gana upstream en el núcleo, gana el fork en la capa de agencia.
Las migraciones de upstream se toman TAL CUAL (nunca se renumeran: su `when`
las ordena solo). Después, el gate completo — y `pnpm test:e2e` de verdad, que
es donde aparecen los fallos silenciosos que el typecheck no ve.

## Stack

**Next.js 15 (App Router) + React 19** en monolito · TypeScript estricto
(`strict` + `noUncheckedIndexedAccess`) · Tailwind CSS (sistema de diseño de la
marca Vocero, el mismo de vocerocrm.com: tokens en `src/app/globals.css`, tema
claro/oscuro, acento white-label por defecto `#0d5bff`, fuentes Archivo +
Instrument Serif + IBM Plex Mono self-hosted vía `next/font`; el logo vive en
`src/lib/brand.ts` y se dibuja con `src/components/brand-mark.tsx`) ·
**PostgreSQL + Drizzle ORM** (migraciones versionadas en
`drizzle/`, aplicadas al ARRANCAR el contenedor) · **Better Auth** + plugin
organization · **Zod** en todo input externo · nanoid con prefijos (`ct_`,
`cv_`, `msg_`…) · pnpm · Vitest (unit) + guiones E2E en `tests/e2e/`
conducidos con Playwright · Docker multi-stage (standalone, healthcheck
`/api/health`) · deploy en Coolify (Ruta A) o docker compose + Caddy (Ruta B).

Tiempo real por **SSE** (`/api/events`): heartbeat `: ping` ~25s, headers
anti-buffering, catch-up por refetch con `since=`. Sin WebSockets, sin colas
externas: el trabajo en segundo plano (agente, Laboratorio) es in-process.

## Mapa del código (fronteras de modificación)

| Quieres cambiar… | Toca… |
|---|---|
| El cerebro/proveedor LLM | `src/lib/ai/` (adaptador OpenRouter-compatible, `chatJson<T>`) |
| El comportamiento/prompt del agente | `src/server/ai/prompts.ts` |
| Las acciones que puede tomar el agente | `src/server/ai/actions.ts` + ejecución en `src/server/ai/pipeline.ts` |
| Las personas o el juez del Laboratorio | `src/server/lab/personas.ts` · `src/server/lab/judge.ts` |
| El canal WhatsApp (Graph API) | `src/lib/meta/` (cliente único) + `src/server/whatsapp/` |
| Los canales opcionales (Instagram, Messenger; ADR-001) | `src/lib/channels.ts` (catálogo) · `src/server/channels/` (capacidades y bandera `CHANNELS`) · `src/server/instagram/` · `src/server/messenger/` · `src/server/zernio/` (transporte y firma de la API unificada, compartido) |
| Campos/tablas | `src/lib/db/schema.ts` → `pnpm db:generate` → migración nueva en `drizzle/` |
| La ingesta/envío de mensajes | `src/server/inbox/` (ingest idempotente, send con guard de sandbox, ventana 24h) |
| Cómo se identifica a un contacto | `src/server/inbox/identity.ts` (teléfono normalizado o `bsuid:<id>`) |
| Conectar TU propio bot en vez del agente | `src/app/api/bot/*` + `src/server/bot/auth.ts` (X-API-Key) |
| La agenda (horarios, huecos, citas) | `src/server/agenda/` — detrás de la bandera `AGENDA` (`flag.ts`) |
| Cómo se entrega la reunión (Zoom, Meet…) | `src/server/agenda/connectors/` + catálogo en `src/lib/agenda-connectors.ts` · guía: [docs/agenda-conectores.md](docs/agenda-conectores.md) |
| La atribución de anuncios y el reporte a Meta | `src/server/attribution/` — detrás de la bandera `ATRIBUCION` (`flag.ts`) + `src/lib/meta/capi.ts` · guía: [docs/atribucion-capi.md](docs/atribucion-capi.md) |
| UI | `src/components/` + `src/app/(app)/` |
| **Cualquier cosa propia del fork** | `src/server/agencia/` · `src/components/agencia/` (ver arriba) |

Los mocks del entorno de pruebas viven en `src/app/api/dev/` (wa-mock +
ai-mock) tras un gate único (`src/lib/dev-guard.ts`): 404 incondicional en
producción.

**Identidad de contacto**: Meta está migrando de teléfono a Business-Scoped
User IDs, así que `from` puede no venir. La llave estable es
`contact.wa_identity` (teléfono normalizado 521→52, o `bsuid:<id>`); `phone` es
un atributo OPCIONAL. Nunca asumas que un contacto tiene teléfono.

**Cerebro externo**: `/api/bot/*` (autenticada por `BOT_API_KEY`) deja que un
microservicio propio conduzca la conversación sin que el token de WhatsApp
salga del CRM: marcar leído + "escribiendo…", descargar adjuntos y reiniciar la
conversación de pruebas. Respeta `conversation.ai_enabled`/`handoff_at` igual
que el agente in-process. Sin la key, esa superficie responde 401 y el CRM
funciona igual.

## Reglas de la constitución (no negociables)

Ver [.specify/memory/constitution.md](.specify/memory/constitution.md).

- **Soberanía (II, endurecida — 1.4.0)**: el NÚCLEO depende solo de WhatsApp
  Cloud API + proveedor LLM OpenRouter-compatible opcional; prohibido meterle
  S3/R2, email, billing u otros terceros. Un servicio de terceros solo entra
  como **conector opcional**: apagado por defecto tras bandera (patrón
  ADR-001), aislado tras adaptador con contrato público, con camino sin
  dependencia externa y degradación definida (su fallo jamás bloquea la
  operación core), credenciales del negocio cifradas, y CI que lo prueba
  apagado y encendido. Auth y BD self-hosted.
- **Seguridad (I)**: secretos cifrados en reposo (AES-256-GCM, `lib/crypto`);
  jamás al cliente ni a logs. El token de WhatsApp solo muestra sus últimos 4.
- **Multi-tenancy (III)**: `organization_id` NOT NULL en toda tabla de dominio;
  toda query pasa por `scoped()` de `src/lib/db/tenant.ts`.
- **Idempotencia (IV)**: webhooks dedup por `wa_message_id` UNIQUE; estados
  monotónicos; seeds y migraciones re-ejecutables.
- **Sandbox del Laboratorio**: las conversaciones `is_test` JAMÁS tocan la API
  real — el sender lanza excepción (no lo "arregles": es un guardrail). Lo
  mismo vale para la agenda: una cita de prueba nunca llega a un conector.
- **Módulos opcionales (015, 016)**: lo que no usa toda instancia va detrás de una
  bandera de despliegue, apagado por defecto, con su superficie en 404 y la
  migración aplicada igual. Nunca en una rama aparte
  ([ADR-001](docs/adr-001-canales-opcionales.md),
  [ADR-002](docs/adr-002-conectores-de-agenda.md)).

## Variables de entorno

Ver `.env.example` (cada una con guía inline). Las claves: `APP_BASE_URL`,
`DATABASE_URL`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` (32 bytes base64),
`META_WEBHOOK_VERIFY_TOKEN` (segmento secreto del webhook), `META_APP_SECRET`
(obligatorio para eventos reales), y para IA:

```bash
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o-mini
OPENAI_JUDGE_MODEL=   # opcional: modelo más barato solo para el juez del Laboratorio
OPENAI_BASE_URL=https://api.openai.com   # opcional, este es el default

# Alterno (modelo gratuito): fallback automático si el preferido falla o no
# está configurado; elegible como preferido por org en Configuración → Agente.
OPENROUTER_API_TOKEN=sk-or-...
OPENROUTER_MODEL=meta-llama/llama-3.1-8b-instruct:free
OPENROUTER_BASE_URL=https://openrouter.ai/api   # opcional, este es el default
```

Para el self-test local existe además el modo de pruebas interno (mocks) —
ver `specs/001-vocero-core/quickstart.md`. Nunca actives mocks en producción.

## Manejo de credenciales (obligatorio)

Cuando una feature necesite una variable/credencial nueva: (1) agrégala a
`.env` como placeholder `REEMPLAZA_...` (append), (2) deja guía inline `#` de
cómo obtenerla, (3) resume en el chat y sigue. `.env` está gitignored; para
deploy, las vars van también en la plataforma de hosting (runtime, no build).

## Definición de Hecho REFORZADA (obligatoria)

"Typecheck + lint + build (+ tests)" es el piso, NO el techo. Una feature no
está "Hecha" hasta correr el **self-test de COMPORTAMIENTO de punta a punta**
(Playwright + mocks: `WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock,
`OPENAI_BASE_URL` → ai-mock) y dejarlo verde: flujo real como usuario,
resultado observable, y el camino infeliz degradando sin colgarse. Prohibido
delegar la prueba al usuario. Si algo depende de un LLM/proveedor externo,
todo turno tolera formato inesperado con extracción robusta + reintentos — un
hipo del proveedor nunca tumba el turno. Al detectar un fallo: diagnostica,
corrige y re-verifica tú mismo hasta verde (loop de auto-corrección).

Gate técnico:

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Guiones E2E por historia en `tests/e2e/*.md`, automatizados en
`scripts/e2e-*.mjs`. Con la app viva y los mocks encendidos, `pnpm test:e2e`
corre **todos** (glob, no lista: un guion nuevo entra solo) y sale distinto de
cero si alguno falla. Los guiones son RE-EJECUTABLES: nada de ids ni correos
fijos que hagan que la segunda corrida falle sola. Al agregar una historia,
extiende el arnés en vez de dejar solo el `.md`.

Para correrlo hace falta el `.env` de pruebas completo: mocks de WhatsApp y de
IA, y además `ZERNIO_BASE_URL`, `ZOOM_*` y `GOOGLE_*` apuntando a sus mocks
(ver `.env.example`). El límite de intentos de login se levanta solo en ese
entorno; en producción sigue puesto.

Las migraciones tienen su propio arnés: `node scripts/verify-migraciones.mjs`
las aplica contra un Postgres real por los dos caminos que existen —base nueva
y base del piloto, la que ya traía las migraciones viejas del fork.

## Modo Objetivo — Loop SDD

Cuando el dueño da una META (no prompts paso a paso): Discover → Plan →
Execute → Verify → Iterate, de forma autónoma, volviendo solo con el objetivo
verificado en vivo o con un bloqueo real (decisión de producto, credenciales,
acción irreversible/costosa). Agrupa TODAS las preguntas bloqueantes al inicio.
El estado durable son los artefactos SDD en `specs/` (spec/plan/tasks) —
manténlos al día. Invocable como `/loop-sdd <objetivo>`.

## Memoria persistente

Memoria de archivos en `memory/` (índice `memory/MEMORY.md`, cargado por
sesión). Persiste decisiones, gotchas y correcciones; no dupliques lo que el
repo ya registra. Los subagentes con `memory: project` usan
`.claude/agent-memory/`.

## Arquitectura de agentes

1. **Orquestador** = la sesión principal de Claude Code (este CLAUDE.md + skill
   `loop-sdd`).
2. **Subagentes** (`.claude/agents/`): `deploy-ops` (deploy/logs/healthchecks,
   no escribe código de app) · `public-site-builder` (páginas públicas/legales
   y config de paneles externos).
