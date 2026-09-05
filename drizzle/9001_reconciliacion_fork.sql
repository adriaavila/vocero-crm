-- Reconciliación del fork de agencia con el upstream (kevinrivm/vocero-crm).
--
-- POR QUÉ EXISTE: este fork creó, antes de que upstream tuviera agenda, una
-- tabla `booking` propia (solo Google Calendar) y una columna `contact.ficha`
-- NOT NULL. Upstream después creó las suyas con otra forma. Sin esta
-- migración, en una base que venga del fork:
--   · `0003_flippant_mastermind` revienta ("column ficha already exists"), y
--   · `0009_motor_agenda` NO crea la tabla nueva (su CREATE es IF NOT EXISTS,
--     y la vieja ocupa el nombre) — la app arranca contra un esquema falso.
--
-- Qué hace: aparta lo viejo con un nombre `_legacy_` para que las migraciones
-- de upstream corran limpias. `9002_capa_agencia` recupera los datos después.
--
-- En una base nueva NO HACE NADA: cada bloque comprueba antes de tocar.
-- Re-ejecutable (Constitución IV).

-- 1) La ficha del lead. Upstream la quiere jsonb NULLABLE; el fork la creó
--    NOT NULL DEFAULT '{}'. Se aparta con los datos dentro.
DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'contact' AND column_name = 'ficha'
	) AND NOT EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'contact' AND column_name = 'ficha_legacy'
	) THEN
		ALTER TABLE "contact" RENAME COLUMN "ficha" TO "ficha_legacy";
		ALTER TABLE "contact" ALTER COLUMN "ficha_legacy" DROP NOT NULL;
		ALTER TABLE "contact" ALTER COLUMN "ficha_legacy" DROP DEFAULT;
	END IF;
END $$;--> statement-breakpoint

-- 2) Las citas. Se reconoce la tabla VIEJA por `google_event_id`, que la nueva
--    no tiene: así el bloque no puede confundirse y renombrar la buena.
DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'booking' AND column_name = 'google_event_id'
	) THEN
		ALTER TABLE "booking" RENAME TO "booking_legacy_google";
		-- Los índices se van con la tabla y sus nombres no chocan con los de
		-- upstream (booking_org_when_idx / booking_org_active_slot_uq).
	END IF;
END $$;
