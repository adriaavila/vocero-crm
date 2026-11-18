# whatsapp-saas-meta-infra

Claude Code / Agent skill to **implement and troubleshoot the infrastructure
layer of a WhatsApp SaaS** on the Meta Graph API and WhatsApp Cloud API.

Use it when building or debugging:

- Embedded Signup and the OAuth callback,
- backend token exchange,
- **phone number registration** (the `/register` step that moves a number from
  `PENDING` to operational — the step most teams miss),
- webhook verification and ingestion,
- Supabase persistence,
- message sending and status handling,
- data deletion / deauthorize callbacks.

## Install

Clone into your skills directory:

```bash
git clone https://github.com/kevinrivm/whatsapp-saas-meta-infra.git \
  ~/.claude/skills/whatsapp-saas-meta-infra
```

## Structure

- `SKILL.md` — entry point, workflow, guardrails, and minimum infra standard.
- `references/architecture.md` — system-level view and recommended flow.
- `references/implementation-sequence.md` — safe build order, phase by phase.
- `references/api-blueprint.md` — backend route contracts, including the
  `/register` endpoint and a background-worker pattern.
- `references/meta-config.md` — Meta app settings, callback URLs, env vars.
- `references/supabase-schema.md` — connections and message-event tables.

## Key idea

The product should not be a thin wrapper around API calls. The dashboard must
reflect real state from Meta assets, webhook events, and the local database —
and a freshly onboarded number is **not usable until `/register` succeeds**.
