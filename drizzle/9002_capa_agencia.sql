-- Capa de agencia: lo que este fork añade sobre el esquema de upstream, más
-- el rescate de los datos que `9001_reconciliacion_fork` apartó.
--
-- Editada a mano sobre la generada para ser RE-EJECUTABLE (Constitución IV):
-- en la base del piloto estas columnas YA existen (las puso el fork antes de
-- la fusión) y en una base nueva no. IF NOT EXISTS cubre los dos casos.

-- 1) Conversación apagada al nacer. Ver el comentario en `schema.ts`: una
--    instancia se ENTREGA a un cliente, y un agente a medio configurar
--    contestándole a un lead real es un incidente, no un bug interno.
ALTER TABLE "conversation" ALTER COLUMN "ai_enabled" SET DEFAULT false;--> statement-breakpoint

-- 2) Columnas del perfil del agente que solo existen en el fork.
ALTER TABLE "agent_profile" ADD COLUMN IF NOT EXISTS "preset_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN IF NOT EXISTS "preset_replies" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN IF NOT EXISTS "allowlist_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN IF NOT EXISTS "allowed_wa_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN IF NOT EXISTS "last_live_test_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN IF NOT EXISTS "last_live_test_passed" boolean;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN IF NOT EXISTS "last_live_test_elapsed_ms" integer;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN IF NOT EXISTS "ai_provider" text DEFAULT 'openai' NOT NULL;--> statement-breakpoint

-- 3) La ficha que 9001 apartó, de vuelta en la columna de upstream.
DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'contact' AND column_name = 'ficha_legacy'
	) THEN
		UPDATE "contact"
		SET "ficha" = "ficha_legacy"
		WHERE "ficha" IS NULL AND "ficha_legacy" IS NOT NULL AND "ficha_legacy" <> '{}'::jsonb;
	END IF;
END $$;--> statement-breakpoint

-- 4) Las citas que creó el calendario viejo (solo Google), en el motor nuevo.
--
--    `ON CONFLICT DO NOTHING` no es pereza: el índice parcial anti
--    doble-booking de upstream es más estricto que el del fork, así que dos
--    citas viejas en el mismo instante ya no pueden coexistir. Gana la primera
--    y la otra se queda en la tabla legacy, visible para quien la revise.
DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'booking_legacy_google'
	) THEN
		INSERT INTO "booking" (
			"id", "organization_id", "kind", "status", "source", "contact_id",
			"conversation_id", "scheduled_at", "duration_minutes", "connector",
			"external_ref", "meeting_link", "link_pending", "is_test", "notes",
			"created_at", "updated_at"
		)
		SELECT
			l."id",
			l."organization_id",
			'session',
			CASE WHEN l."status" IN ('failed', 'cancelled') THEN 'cancelada' ELSE 'agendada' END,
			'ai',
			l."contact_id",
			l."conversation_id",
			l."start_at",
			GREATEST(1, (EXTRACT(EPOCH FROM (l."end_at" - l."start_at")) / 60)::int),
			'google',
			l."google_event_id",
			l."meet_url",
			l."meet_url" IS NULL,
			false,
			l."error",
			l."created_at",
			l."updated_at"
		FROM "booking_legacy_google" l
		ON CONFLICT DO NOTHING;
	END IF;
END $$;

-- `booking_legacy_google` y `contact.ficha_legacy` NO se borran aquí: son la
-- red por si el rescate salió mal. Cuando la agenda nueva esté verificada en
-- producción, se van a mano (una sola vez, con respaldo):
--   DROP TABLE "booking_legacy_google";
--   ALTER TABLE "contact" DROP COLUMN "ficha_legacy";
