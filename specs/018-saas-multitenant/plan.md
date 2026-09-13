# Plan — 018 SaaS multi-tenant

## Decisiones de arquitectura

**Una bandera, no una rama.** `ALLOK_SAAS_MODE` enciende todo lo de este spec.
Apagada, cada compuerta responde "sí" y la instancia self-hosted no se entera de
que existen los planes. Es el mismo patrón de ADR-001 (canales opcionales) y
ADR-002 (conectores de agenda), y es lo que deja el fork fusionable con upstream.

**El inquilino sale del hostname, nunca de la sesión.** El slug del subdominio
resuelve la organización; la sesión sólo dice quién eres. Resolver el inquilino
desde la sesión haría que "la primera organización del usuario" fuera una
respuesta plausible, y ése es exactamente el bug que no se ve hasta que un
cliente lee los datos de otro.

**El estado del cobro vive en `organization.metadata.allok.billing`**, no en una
tabla nueva. Es un puñado de campos que siempre se leen con la organización, y la
constitución prohíbe meterle al núcleo dependencias de terceros: así, apagada la
bandera, no queda ni una tabla de billing en el esquema de nadie.

**La única tabla nueva del cobro es `saas_billing_event`**, y existe sólo para la
idempotencia: Stripe reintenta, y el id del evento como clave primaria es la
forma más barata de no cobrar ni activar dos veces.

**El orden de la entrega es parte del diseño, no un detalle.** Credenciales
primero, webhook después, y relectura en Meta para confirmar. Al revés, los
mensajes llegan a un CRM que no conoce el número y se descartan **en silencio**.
Todo el camino es idempotente para que reintentar sea siempre seguro.

**La cola del agente se hace durable** (`agent_job` con lock por conversación)
porque el temporizador en memoria perdía turnos en cada despliegue. En una
instancia de un solo negocio eso era un mensaje sin contestar; en una compartida,
es el producto.

## Fronteras de modificación

| Qué | Dónde |
|---|---|
| Resolución de host e inquilino | `src/lib/tenant-host.ts`, `src/server/auth/on-signup.ts` |
| Sesión y compuertas de API | `src/lib/auth/session.ts`, `src/lib/api.ts` |
| Cobro | `src/server/saas/billing.ts`, `src/app/api/saas/billing/*` |
| Derechos por plan | `src/server/agencia/entitlements.ts` |
| Puente con allok | `src/app/api/saas/whatsapp/*`, `src/app/api/provision/route.ts` |
| Panel interno | `src/server/saas/admin.ts`, `src/app/admin/` |
| Del otro lado | `allok-fun`: `src/lib/handover/tenant.ts`, `src/app/api/meta/tenant-*` |

## Cómo se comprueba

El piso es `pnpm typecheck && pnpm lint && pnpm build && pnpm test`. El techo son
dos arneses vivos:

```bash
pnpm test:e2e         # comportamiento, con los mocks; base NUEVA cada corrida
pnpm test:e2e:saas    # aislamiento entre inquilinos; el servidor con ALLOK_SAAS_MODE=true
```

Dos cosas aprendidas montándolo, que cuestan una tarde si no están escritas:

- **El arnés quiere una base nueva.** Varios guiones usan ids fijos de mensaje;
  sobre una base que ya corrió, el webhook los deduplica y los fallos parecen del
  producto. `createdb` + `node scripts/migrate.mjs` antes de cada corrida.
- **El puerto 3000 puede no ser tuyo.** El mock entrega el webhook por loopback a
  `127.0.0.1:$PORT`; con otro servidor de otro proyecto en ese puerto, la entrega
  se va a la app equivocada, devuelve 200 y no llega ningún mensaje. Levantar en
  un puerto propio y apuntar ahí `APP_BASE_URL` y las URLs de los mocks.

Las migraciones tienen su propio arnés (`node scripts/verify-migraciones.mjs`),
que las aplica contra un Postgres real por los dos caminos: base nueva y base del
piloto.
