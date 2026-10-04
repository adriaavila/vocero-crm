-- Fork — la pausa por respuesta manual vence (server/agencia/pausa-manual.ts).
-- null = 12 h por defecto; 0 = nunca, la reactiva el dueño.
ALTER TABLE "agent_profile" ADD COLUMN "handoff_resume_hours" integer;--> statement-breakpoint
-- Las pausas que ya existen (chats que el dueño tomó antes de hoy) NO vencen:
-- se quedan como están, con "La atiendes tú" y sin reloj (`handoff_at` NULL).
-- Decisión de Adrian 2026-10-04: "keep existing chats paused". El reloj
-- arranca la próxima vez que el dueño conteste ese chat (echo o bandeja), y
-- desde ahí aplica la regla nueva. Idempotente.
UPDATE "conversation"
SET "handoff_at" = NULL
WHERE "handoff_reason" = 'manual_reply' AND "handoff_at" IS NOT NULL;--> statement-breakpoint
-- Marcas viejas en negocios donde la IA no contestaba sola (agente apagado o
-- activación por frase): no había nada que pausar, y dejarlas haría que
-- "vencieran" y encendieran la IA en chats que nunca pidieron la frase. Quedan
-- como chats apagados a mano: lo mismo que hoy, sin sorpresa. Idempotente.
UPDATE "conversation" c
SET "handoff_at" = NULL, "handoff_reason" = NULL
FROM "agent_profile" p
WHERE p."organization_id" = c."organization_id"
  AND c."handoff_reason" = 'manual_reply'
  AND (p."enabled" = false OR p."preset_only" = true);
