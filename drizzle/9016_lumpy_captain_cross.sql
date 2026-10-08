-- Turno del agente, despacho a Nea y worker: "los últimos mensajes de esta
-- conversación" sin recorrer toda la tabla. Idempotente.
CREATE INDEX IF NOT EXISTS "message_conv_created_idx" ON "message" USING btree ("conversation_id","created_at");
