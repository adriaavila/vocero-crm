# Feature Specification: Allok SaaS multi-tenant (bandera `ALLOK_SAAS_MODE`)

**Feature Branch**: `main` (aterrizada directamente; ver "Nota de proceso")

**Created**: 2026-09-12

**Status**: Implementada y verificada localmente (491 pruebas unitarias, arnés de
comportamiento en verde sobre base nueva, 24/24 del comprobador de aislamiento).
**No desplegada**: faltan DNS, precios de Stripe y variables en producción.

**Input**: El alta de un cliente costaba un día de trabajo —proyecto Coolify,
Postgres, secretos, app de Meta, token pegado a mano, `curl` del
`override_callback_uri`— y el cobro pasaba por fuera, con un link de Stripe
suelto. La prioridad declarada del dueño para este producto es "súper fácil para
el cliente", que sólo significa una cosa: **la complejidad la absorbe el
producto, no el onboarding**.

## Contexto de negocio

Vocero es MIT y cualquiera lo clona. Lo que nadie cubre es la distancia entre el
`git clone` y un número contestando: VPS, dominio, token de sistema de Meta,
override del webhook y `META_APP_SECRET`, en un orden donde equivocarse **no da
error, sólo silencio**. Ese es el hueco, y un producto que se vende solo es
exactamente el que cierra esa distancia sin que el cliente la vea.

## Alcance

Un despliegue compartido donde cada negocio:

1. se registra en `whatsapp.allok.fun` y recibe su panel en `<slug>.allok.fun`;
2. paga su plan con Stripe sin salir del producto;
3. conecta su número con el Embedded Signup de allok, y sus credenciales y su
   webhook llegan solos a su espacio;
4. queda con la automatización apagada hasta que su plan esté activo.

Todo detrás de `ALLOK_SAAS_MODE`. **Con la bandera apagada, una instancia
self-hosted se comporta exactamente como antes** — sin planes, sin subdominios,
sin cobro. Ésa es la condición que mantiene el fork fusionable con upstream y el
producto regalable.

## Requisitos

- **FR-1 Inquilino por hostname.** El slug del subdominio resuelve la
  organización. Los subdominios de producto (`whatsapp`, `admin`, `crm`,
  `agent`, `inmox`…) están reservados y ningún negocio puede llamarse así.
- **FR-2 Sesión compartida en la raíz.** El host de registro y el panel del
  negocio comparten sesión; un host desconocido devuelve 404, no el panel de
  otro.
- **FR-3 Aislamiento.** Ninguna sesión lee, escribe ni recibe eventos de otra
  organización. Se comprueba en cada corrida con `scripts/saas-isolation-check.mjs`.
- **FR-4 Cobro.** Checkout alojado, portal de cliente y webhook idempotente por
  id de evento y tolerante a eventos fuera de orden. **El checkout no activa
  nada**: activa el webhook.
- **FR-5 Derechos por plan.** La automatización exige suscripción activa o en
  prueba; Ventas, Agenda y Equipo exigen Pro. Las tres puertas a WhatsApp —alta
  guiada, respaldo manual y recuperación— exigen plan activo, porque un número
  conectado consume la app de Meta de allok aunque nadie pague.
- **FR-6 Entrega automática del número.** Al terminar el Embedded Signup, las
  credenciales llegan a la instancia y **después** se redirige el webhook de esa
  WABA, con relectura en Meta para confirmarlo. El orden es parte del requisito:
  al revés, los mensajes se descartan en silencio.
- **FR-7 Recuperación.** Si esa entrega falla, el negocio la repite desde su
  panel sin reconectar el número.
- **FR-8 Horario de atención.** El negocio puede comprar "contesta sólo cuando
  estoy cerrado" en vez de todo o nada.
- **FR-9 Cola durable del agente.** Un turno pendiente sobrevive a un reinicio.
- **FR-10 Panel interno.** Lista de inquilinos con su plan, sólo lectura, con
  allowlist por correo y una fila de auditoría por acceso. Sin suplantación.

## Fuera de alcance (y cuándo dejará de estarlo)

- **Cuotas por plan** ("1 número", "hasta 3 usuarios" son copy sin aplicación):
  cuando entre el segundo cliente que se pase.
- **Acciones de escritura en el panel interno**: cuando reintentar a mano duela.
- **Prueba gratuita**: el código honra `trialing` si Stripe lo manda; nadie lo
  configuró todavía.
- **`data_deletion` / `deauthorize` hacia Vocero**: los atiende la app de Meta de
  allok, que sí los tiene.

## Nota de proceso

Esta especificación se escribió **después** del código, que llevaba semanas sin
commitear en el árbol de trabajo. No es el orden que manda la constitución del
repo; queda escrito para que se note. Lo que sí se respetó antes de aterrizarlo:
el gate completo, el arnés de comportamiento sobre base nueva y el comprobador
de aislamiento.
