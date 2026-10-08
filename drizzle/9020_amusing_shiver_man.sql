CREATE TABLE IF NOT EXISTS "resumen_diario" (
	"organization_id" text NOT NULL,
	"dia" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resumen_diario" ADD CONSTRAINT "resumen_diario_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resumen_diario_org_dia_uq" ON "resumen_diario" USING btree ("organization_id","dia");
