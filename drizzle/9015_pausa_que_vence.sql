-- Fork — la pausa por respuesta manual vence (server/agencia/pausa-manual.ts).
-- null = 12 h por defecto; 0 = nunca, la reactiva el dueño.
ALTER TABLE "agent_profile" ADD COLUMN "handoff_resume_hours" integer;--> statement-breakpoint
-- Las pausas que ya existen se midieron desde la PRIMERA respuesta manual
-- (el código no adelantaba el reloj). Desde hoy `handoff_at` es la ÚLTIMA:
-- se alinea con el último saliente manual para que una pausa de hace un rato
-- no "venza" en el primer mensaje tras el deploy. Idempotente.
UPDATE "conversation" c
SET "handoff_at" = m.last_manual
FROM (
  SELECT "conversation_id", max(coalesce("wa_timestamp", "created_at")) AS last_manual
  FROM "message"
  WHERE "direction" = 'out' AND "origin" = 'manual'
  GROUP BY "conversation_id"
) m
WHERE c."id" = m."conversation_id"
  AND c."handoff_reason" = 'manual_reply'
  AND c."handoff_at" < m.last_manual;
