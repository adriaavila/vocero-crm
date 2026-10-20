CREATE TABLE "plan_pago" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"nombre" text NOT NULL,
	"reserva" numeric(14, 2) NOT NULL,
	"pasos" jsonb NOT NULL,
	"mes_entrega" integer NOT NULL,
	"aprobado_por" text NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sala_venta" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"token" text NOT NULL,
	"property_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"plan_pago_id" text,
	"alquiler_actual" numeric(14, 2),
	"saludo" text,
	"aperturas" integer DEFAULT 0 NOT NULL,
	"primera_apertura_at" timestamp,
	"ultima_apertura_at" timestamp,
	"calculadora_at" timestamp,
	"visita_pedida_at" timestamp,
	"espera_alquiler_de" text,
	"espera_alquiler_at" timestamp,
	"enviada_whatsapp_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_pago" ADD CONSTRAINT "plan_pago_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sala_venta" ADD CONSTRAINT "sala_venta_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sala_venta" ADD CONSTRAINT "sala_venta_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sala_venta" ADD CONSTRAINT "sala_venta_plan_pago_id_plan_pago_id_fk" FOREIGN KEY ("plan_pago_id") REFERENCES "public"."plan_pago"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sala_venta" ADD CONSTRAINT "sala_venta_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_pago_org_idx" ON "plan_pago" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sala_venta_token_uq" ON "sala_venta" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "sala_venta_contact_uq" ON "sala_venta" USING btree ("organization_id","contact_id");