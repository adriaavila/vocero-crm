CREATE TABLE "meta_autorizacion" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"fb_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_solicitud" (
	"id" text PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"fb_user_id" text NOT NULL,
	"codigo" text NOT NULL,
	"organization_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estado" text DEFAULT 'recibida' NOT NULL,
	"issued_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"done_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "meta_autorizacion" ADD CONSTRAINT "meta_autorizacion_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meta_autorizacion_fb_user_idx" ON "meta_autorizacion" USING btree ("fb_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_solicitud_codigo_uq" ON "meta_solicitud" USING btree ("codigo");