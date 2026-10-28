CREATE TABLE "gerente_dueno" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"codigo" text,
	"codigo_vence" timestamp,
	"wa_identity" text,
	"conectado_at" timestamp,
	"reporte_semanal" boolean DEFAULT true NOT NULL,
	"ultimo_reporte" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gerente_dueno" ADD CONSTRAINT "gerente_dueno_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gerente_dueno" ADD CONSTRAINT "gerente_dueno_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gerente_dueno_org_user_uq" ON "gerente_dueno" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gerente_dueno_codigo_uq" ON "gerente_dueno" USING btree ("codigo") WHERE "gerente_dueno"."codigo" is not null;--> statement-breakpoint
CREATE INDEX "gerente_dueno_wa_idx" ON "gerente_dueno" USING btree ("wa_identity");