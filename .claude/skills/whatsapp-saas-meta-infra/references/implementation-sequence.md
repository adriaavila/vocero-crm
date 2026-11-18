# Recommended implementation sequence

Use this reference when the user is building from zero or needs a safe order of operations.

## Phase 1: Meta app and Embedded Signup

- Create the Meta app.
- Configure the WhatsApp product.
- Configure the OAuth redirect URL.
- Implement the frontend launcher for Embedded Signup.
- Capture the returned `code`, `waba_id`, and `phone_number_id`.

## Phase 2: Backend token exchange

- Create a backend endpoint for the code exchange.
- Exchange the Meta code for a usable token.
- Fetch phone metadata after the exchange.
- Persist the connection in Supabase.
- Save `meta_user_id` if available so deauthorize can map back to the local user later.

## Phase 3: Register the connected number

This phase is mandatory and is the step most teams skip. Embedded Signup links
the number to the WABA, but the number stays `PENDING` and cannot send or
receive until you register it on the Cloud API.

- After a successful code exchange, call:
  - `POST https://graph.facebook.com/v21.0/{phone_number_id}/register`
  - with the connection's own `access_token`,
  - body `{ "messaging_product": "whatsapp", "pin": "000000" }`.
- Treat `{ "success": true }` as registered.
- Treat error code `133016` (already registered) as success.
- Only then mark the connection as `connected` / `verified` locally.
- Either run this inline after the exchange, or run a small background worker
  that registers any newly connected number that is still unregistered.
- Re-run it on every re-onboarding, because a new Embedded Signup creates a new
  `phone_number_id` that starts `PENDING` again.

## Phase 4: Supabase schema

- Create a table for active WhatsApp connections.
- Create a table for message events.
- Add columns for:
  - `message_id`,
  - `direction`,
  - `message_text`,
  - delivery errors,
  - timestamps.

## Phase 5: Sending

- Implement template sending first.
- Implement freeform text sending second.
- Persist the initial outbound event as `accepted`.

## Phase 6: Webhooks

- Implement GET verification.
- Implement POST ingestion.
- Store both:
  - `statuses`,
  - `messages`.

## Phase 7: Dashboard truthfulness

- Show the connected number.
- Show real templates.
- Show recent message events.
- Build conversations from stored events.

## Phase 8: Compliance

- Add a public data deletion instructions page.
- Add a deauthorize callback route.
- Support automatic deletion or unlinking when Meta revokes authorization.
