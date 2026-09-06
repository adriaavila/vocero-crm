# Contrato: Provisión desde allok

Ruta: `POST /api/provision` — `force-dynamic`.

allok conecta un número por Meta Embedded Signup y, **antes** de mover el webhook
en Meta, empuja aquí sus credenciales. El orden no es negociable: primero las
credenciales, después el webhook. Si el webhook se redirige antes, los mensajes
llegan a una instancia que todavía no conoce ese número y se pierden.

Consumidor único: allok (`src/lib/handover/provision.ts` en ese repo).

## Autorización

`Authorization: Bearer <PROVISION_API_KEY>`, comparación timing-safe. Sin
`PROVISION_API_KEY` configurada —o de menos de 16 caracteres— la ruta responde
**401** siempre. El mismo valor vive en allok, cifrado, en
`handover_destinations.provision_secret`.

Rate limit: 30 solicitudes por minuto.

## Request

```jsonc
{
  "organization_id": null,              // opcional; si viene, DEBE ser el de esta instancia
  "client": "acme",                     // etiqueta de allok, informativa
  "business_id": "biz_1",               // informativo
  "waba_id": "waba_1",                  // requerido
  "phone_number_id": "phone_1",         // requerido
  "token": "EAA…",                      // requerido, token de negocio del número
  "display_phone_number": "+58 422…",
  "verified_name": "Acme",
  "connection_mode": "META_COEXISTENCE", // o "META_CLOUD_API"
  "status": "subscribed",               // status de allok; NO se copia al enum de vocero
  "is_coexistence": true
}
```

`status` se acepta y se ignora a propósito: si estamos provisionando, la
credencial es nueva y vale `connected`. Mapearlo dejaría entrar el vocabulario de
allok en el enum de vocero.

## Respuesta

**200**

```jsonc
{
  "organization_name": "Acme",
  "webhook_url": "https://crm.ejemplo.com/api/webhooks/wa/<META_WEBHOOK_VERIFY_TOKEN>"
}
```

allok usa `webhook_url` como `override_callback_uri` al suscribir la WABA, así que
esta respuesta es la que decide a dónde llegan los mensajes.

**Errores** — `{ "message": "<texto>" }` a nivel raíz, no el `{ error: { code, message } }`
de la API interna: es lo que allok lee para mostrarle algo útil al operador.

| Código | Cuándo |
|---|---|
| 400 | JSON inválido, falta `waba_id` / `phone_number_id` / `token`, o `connection_mode` desconocido |
| 401 | Bearer ausente o incorrecto, o `PROVISION_API_KEY` sin configurar |
| 409 | `organization_id` de otra instancia · instancia sin organización · el número ya pertenece a otra organización |
| 429 | Rate limit |
| 500 | No se pudieron guardar las credenciales |

## Organización destino

Vocero es mono-organización por instancia (una instancia = un negocio). Sin
`organization_id` se usa la organización de la instancia. Con `organization_id`,
tiene que coincidir: recibir el de otro cliente significa que alguien apuntó el
destino equivocado en allok, y atarlo en silencio entregaría los mensajes de un
negocio a otro.

`meta_credentials` tiene índice único por `phone_number_id` a nivel instancia, así
que un número ya atado a otra organización se rechaza con 409 explícito en vez de
reventar contra Postgres.

## Idempotencia

Reenviar la misma provisión es seguro: el upsert va por `organization_id` y
reemplaza token, WABA y número. Es el camino previsto para rotar un token vencido.
