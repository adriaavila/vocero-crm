# Backend API blueprint

Use this reference when the user wants concrete backend responsibilities and route design.

## Recommended routes

### 1. Code exchange endpoint

Example:

```text
POST /api/whatsapp/exchange-token
```

Input:

- `code`
- `waba_id`
- `phone_number_id`

Responsibilities:

- validate the request,
- exchange the code with Meta,
- fetch connected phone metadata,
- persist the active connection,
- register the phone number so it becomes operational (see section 2),
- optionally store `meta_user_id`.

## 2. Register the connected phone number

Example:

```text
POST /api/whatsapp/register-number
```

This is the step most teams miss. After Embedded Signup completes and the
token is exchanged, the phone number is linked to the WABA but is **not yet
able to send or receive messages**. In Meta it shows as `PENDING`. To make it
operational you must explicitly register it on the Cloud API:

```text
POST https://graph.facebook.com/v21.0/{phone_number_id}/register
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "messaging_product": "whatsapp",
  "pin": "000000"
}
```

Input:

- `phone_number_id`
- the connection's `access_token`
- a 6-digit two-step-verification `pin`

Responsibilities:

- call the `/register` endpoint with the connection's own token,
- treat `{ "success": true }` as registered,
- treat error code `133016` (already registered) as already done,
- mark the local connection as `connected` / `verified` only after success,
- never assume Embedded Signup alone activates the number.

Notes on the `pin`:

- If the number never had two-step verification, send a new 6-digit pin and
  store it.
- If two-step verification was already set on the number, you must send the
  existing pin, or registration fails with a pin error.
- Re-run `/register` whenever a number is re-onboarded; a fresh Embedded
  Signup produces a new `phone_number_id` that starts `PENDING` again.

When to run it:

- inline, right after a successful code exchange, or
- as a background worker that picks up newly connected numbers that are not
  yet registered. A worker is more resilient because it also recovers numbers
  that were onboarded while the inline call failed.

## 3. WhatsApp webhook

Example:

```text
GET  /api/whatsapp/webhook
POST /api/whatsapp/webhook
```

GET responsibilities:

- verify `hub.verify_token`,
- return `hub.challenge`.

POST responsibilities:

- parse each `entry`,
- parse each `change`,
- process `value.statuses`,
- process `value.messages`,
- upsert by `message_id`.

## 4. Send template message

Example:

```text
POST /api/whatsapp/send-template
```

Input:

- recipient phone
- approved template name
- language code
- template parameters

Responsibilities:

- normalize the phone,
- send the message through Meta,
- store an initial outbound event as `accepted`.

## 5. Send freeform text message

Example:

```text
POST /api/whatsapp/send-text
```

Use this only for open customer service windows.

## 6. Deauthorize callback

Example:

```text
GET  /api/meta/deauthorize
POST /api/meta/deauthorize
```

Responsibilities:

- read `signed_request`,
- validate it with `HMAC-SHA256` and the app secret,
- extract the Meta user identifier,
- map it to the local user,
- purge or unlink WhatsApp data,
- return a confirmation payload.

## Important behavior

- Store only metadata and tokens server-side.
- Never trust the UI as source of truth for message delivery.
- Use idempotent writes for webhook processing.
- A number is not usable until `/register` succeeds; a `PENDING` number cannot
  send or receive, no matter how clean the Embedded Signup looked.
