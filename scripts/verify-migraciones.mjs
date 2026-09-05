/**
 * ¿Las migraciones aplican bien en los DOS caminos que existen?
 *
 *   A) Base NUEVA — la de un cliente que se da de alta hoy.
 *   B) Base VIEJA del fork — la del piloto, que ya aplicó las migraciones
 *      0003..0008 propias antes de fusionar con upstream.
 *
 * El camino B es el que puede romper en silencio: `9001_reconciliacion_fork`
 * aparta la tabla `booking` y la columna `contact.ficha` del fork para que las
 * de upstream apliquen, y `9002_capa_agencia` devuelve los datos. Si eso falla,
 * el CRM arranca contra un esquema falso y las citas desaparecen.
 *
 * Uso:  node scripts/verify-migraciones.mjs
 * Requiere: un Postgres alcanzable en PGURL (default: postgres local).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const ADMIN = process.env.PGURL ?? "postgres://localhost:5432/postgres";
const DRIZZLE = path.resolve(import.meta.dirname, "..", "drizzle");

let fallos = 0;
let checks = 0;
const ok = (nombre, cond, extra = "") => {
  checks++;
  if (cond) console.log(`  ✓ ${nombre}`);
  else {
    fallos++;
    console.log(`  ✗ ${nombre}${extra ? ` — ${extra}` : ""}`);
  }
};

/**
 * Las migraciones del fork ANTES de la fusión con upstream.
 *
 * Van en duro y no se leen del historial de git a propósito: son historia
 * congelada (nunca van a cambiar) y sacarlas con `git show <sha>` ataría este
 * arnés a un clon completo del repo — en CI, con clon superficial, ese commit
 * no existe y la mitad más importante de la prueba se saltaría en silencio.
 */
const MIGRACIONES_VIEJAS_DEL_FORK = [
  // 0003_whole_lizard
  `CREATE TABLE "booking" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL,
	"google_event_id" text NOT NULL,
	"meet_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_calendar_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"account_email" text,
	"calendar_id" text DEFAULT 'primary' NOT NULL,
	"refresh_token_cipher" text NOT NULL,
	"refresh_token_iv" text NOT NULL,
	"refresh_token_tag" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "ficha" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_calendar_connection" ADD CONSTRAINT "google_calendar_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_org_start_uq" ON "booking" USING btree ("organization_id","start_at");--> statement-breakpoint
CREATE INDEX "booking_org_contact_start_idx" ON "booking" USING btree ("organization_id","contact_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_connection_org_uq" ON "google_calendar_connection" USING btree ("organization_id");`,
  // 0004_mushy_beast
  `ALTER TABLE "agent_profile" ADD COLUMN "preset_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "preset_replies" jsonb DEFAULT '[]'::jsonb NOT NULL;`,
  // 0005_lethal_celestials
  `ALTER TABLE "conversation" ALTER COLUMN "ai_enabled" SET DEFAULT false;`,
  // 0006_tiny_gladiator
  `ALTER TABLE "agent_profile" ADD COLUMN "allowlist_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "allowed_wa_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;`,
  // 0007_melodic_switch
  `ALTER TABLE "agent_profile" ADD COLUMN "last_live_test_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "last_live_test_passed" boolean;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "last_live_test_elapsed_ms" integer;`,
  // 0008_worried_outlaw_kid
  `ALTER TABLE "agent_profile" ADD COLUMN "ai_provider" text DEFAULT 'openai' NOT NULL;`
];

function sqlDe(tag) {
  return readFileSync(path.join(DRIZZLE, `${tag}.sql`), "utf8");
}

function journal() {
  return JSON.parse(
    readFileSync(path.join(DRIZZLE, "meta", "_journal.json"), "utf8")
  ).entries;
}

async function aplicar(sql, texto) {
  // Mismo troceo Y misma transacción por archivo que el migrador de drizzle:
  // 0001 crea una tabla temporal ON COMMIT DROP, así que fuera de transacción
  // se evapora entre sentencia y sentencia.
  await sql.begin(async (tx) => {
    for (const trozo of texto.split("--> statement-breakpoint")) {
      const stmt = trozo.trim();
      if (stmt) await tx.unsafe(stmt);
    }
  });
}

async function conBase(nombre, fn) {
  const admin = postgres(ADMIN, { max: 1, onnotice: () => {} });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${nombre}`);
  await admin.unsafe(`CREATE DATABASE ${nombre}`);
  await admin.end();
  const url = ADMIN.replace(/\/[^/]*$/, `/${nombre}`);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

async function columnas(sql, tabla) {
  const rows = await sql`
    SELECT column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tabla}`;
  return new Map(rows.map((r) => [r.column_name, r]));
}

console.log("\n▶ A. Base nueva: toda la cadena, en orden de journal");
await conBase("vocero_mig_nueva", async (sql) => {
  for (const e of journal()) await aplicar(sql, sqlDe(e.tag));

  const booking = await columnas(sql, "booking");
  ok("`booking` es la de upstream (scheduled_at)", booking.has("scheduled_at"));
  ok("y no la del fork (sin google_event_id)", !booking.has("google_event_id"));

  const contact = await columnas(sql, "contact");
  ok("`contact.ficha` existe y es nullable", contact.get("ficha")?.is_nullable === "YES");
  ok("sin residuo `ficha_legacy` en base nueva", !contact.has("ficha_legacy"));

  const perfil = await columnas(sql, "agent_profile");
  for (const c of [
    "preset_only",
    "preset_replies",
    "allowlist_enabled",
    "allowed_wa_ids",
    "last_live_test_at",
    "ai_provider",
  ]) {
    ok(`agent_profile.${c} presente`, perfil.has(c));
  }

  const conv = await columnas(sql, "conversation");
  ok(
    "conversation.ai_enabled nace apagada",
    /false/.test(conv.get("ai_enabled")?.column_default ?? "")
  );

  const agenda = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public'
      AND table_name IN ('calendar_settings','offered_slot','zoom_credentials','google_credentials')`;
  ok("motor de agenda completo (4 tablas)", agenda.length === 4, `hay ${agenda.length}`);
});

console.log("\n▶ B. Base del piloto: cadena vieja del fork, luego la fusionada");
await conBase("vocero_mig_piloto", async (sql) => {
  // 1. Lo que el piloto ya tenía aplicado: 0000..0002 + las del fork.
  for (const tag of [
    "0000_absurd_the_santerians",
    "0001_old_sabra",
    "0002_closed_millenium_guard",
  ]) {
    await aplicar(sql, sqlDe(tag));
  }
  for (const texto of MIGRACIONES_VIEJAS_DEL_FORK) await aplicar(sql, texto);

  // 2. Datos reales que NO se pueden perder.
  await sql`INSERT INTO "organization" ("id","name","slug","created_at") VALUES ('org_1','Piloto','piloto',now())`;
  await sql`INSERT INTO "contact" ("id","organization_id","wa_identity","name","ficha","created_at","updated_at")
            VALUES ('ct_1','org_1','5215550001','Ana','{"presupuesto":"50k"}'::jsonb,now(),now())`;
  await sql`INSERT INTO "conversation" ("id","organization_id","contact_id","created_at","updated_at")
            VALUES ('cv_1','org_1','ct_1',now(),now())`;
  await sql`INSERT INTO "booking" ("id","organization_id","conversation_id","contact_id","start_at","end_at","google_event_id","meet_url","status","created_at","updated_at")
            VALUES ('bkg_1','org_1','cv_1','ct_1', now() + interval '2 days', now() + interval '2 days 30 minutes','gev_1','https://meet.example/x','confirmed',now(),now())`;

  // 3. El resto de la cadena, como la aplicaría el contenedor al arrancar.
  const yaAplicadas = new Set([
    "0000_absurd_the_santerians",
    "0001_old_sabra",
    "0002_closed_millenium_guard",
  ]);
  for (const e of journal()) {
    if (yaAplicadas.has(e.tag)) continue;
    await aplicar(sql, sqlDe(e.tag));
  }

  const booking = await columnas(sql, "booking");
  ok("`booking` quedó con la forma de upstream", booking.has("scheduled_at") && !booking.has("google_event_id"));

  const rescatadas = await sql`SELECT * FROM "booking" WHERE "id" = 'bkg_1'`;
  ok("la cita vieja sobrevivió", rescatadas.length === 1);
  if (rescatadas[0]) {
    const b = rescatadas[0];
    ok("con su duración calculada", b.duration_minutes === 30, `es ${b.duration_minutes}`);
    ok("su enlace de Meet", b.meeting_link === "https://meet.example/x");
    ok("marcada como agendada", b.status === "agendada", b.status);
    ok("con el conector google y el id del evento", b.connector === "google" && b.external_ref === "gev_1");
  }

  const ficha = await sql`SELECT "ficha", "ficha_legacy" FROM "contact" WHERE "id" = 'ct_1'`;
  ok("la ficha del lead volvió a su columna", ficha[0]?.ficha?.presupuesto === "50k", JSON.stringify(ficha[0]?.ficha));
  ok("y la copia vieja sigue de red", ficha[0]?.ficha_legacy?.presupuesto === "50k");

  const perfil = await columnas(sql, "agent_profile");
  ok("las columnas del fork no se duplicaron ni se perdieron", perfil.has("ai_provider") && perfil.has("preset_only"));

  const legacy = await sql`SELECT count(*)::int AS n FROM "booking_legacy_google"`;
  ok("la tabla legacy sigue ahí como respaldo", legacy[0].n === 1);
});

console.log(`\n${fallos === 0 ? "✓" : "✗"} ${checks - fallos}/${checks} comprobaciones`);
process.exit(fallos === 0 ? 0 : 1);
