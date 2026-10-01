CREATE TABLE "booking_property" (
	"booking_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"property_id" text NOT NULL,
	"outcome" text,
	"reminder_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_property" (
	"conversation_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"property_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_catalog_version" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"operation" text NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"price" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"address" text,
	"neighborhood" text,
	"city" text,
	"bedrooms" integer,
	"bathrooms" numeric(3, 1),
	"built_area" numeric(10, 2),
	"lot_area" numeric(10, 2),
	"parking" integer,
	"amenities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accepted_payments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'disponible' NOT NULL,
	"description" text,
	"archived_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_match" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"property_id" text NOT NULL,
	"score" integer NOT NULL,
	"reasons" jsonb NOT NULL,
	"ai_explanation" text,
	"requirement_version" integer NOT NULL,
	"catalog_version" integer NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "property_match_score_ck" CHECK ("property_match"."score" >= 0 AND "property_match"."score" <= 100)
);
--> statement-breakpoint
CREATE TABLE "property_photo" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"property_id" text NOT NULL,
	"position" integer NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"wa_media_id" text,
	"wa_media_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirement" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"operation" text,
	"budget_min" numeric(14, 2),
	"budget_max" numeric(14, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"zones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"kind" text,
	"min_bedrooms" integer,
	"min_bathrooms" numeric(3, 1),
	"amenities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payment_method" text,
	"needs_guarantor" boolean,
	"urgency" text,
	"notes" text,
	"manual_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_property" ADD CONSTRAINT "booking_property_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_property" ADD CONSTRAINT "booking_property_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_property" ADD CONSTRAINT "booking_property_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_property" ADD CONSTRAINT "conversation_property_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_property" ADD CONSTRAINT "conversation_property_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_property" ADD CONSTRAINT "conversation_property_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_catalog_version" ADD CONSTRAINT "org_catalog_version_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_match" ADD CONSTRAINT "property_match_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_match" ADD CONSTRAINT "property_match_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_match" ADD CONSTRAINT "property_match_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_photo" ADD CONSTRAINT "property_photo_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_photo" ADD CONSTRAINT "property_photo_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement" ADD CONSTRAINT "requirement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement" ADD CONSTRAINT "requirement_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_property_org_property_idx" ON "booking_property" USING btree ("organization_id","property_id");--> statement-breakpoint
CREATE INDEX "conversation_property_org_property_idx" ON "conversation_property" USING btree ("organization_id","property_id");--> statement-breakpoint
CREATE INDEX "property_org_visible_idx" ON "property" USING btree ("organization_id","archived_at","status");--> statement-breakpoint
CREATE INDEX "property_org_operation_price_idx" ON "property" USING btree ("organization_id","operation","price");--> statement-breakpoint
CREATE INDEX "property_org_created_idx" ON "property" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "match_lead_property_uq" ON "property_match" USING btree ("lead_id","property_id");--> statement-breakpoint
CREATE INDEX "match_org_lead_score_idx" ON "property_match" USING btree ("organization_id","lead_id","score");--> statement-breakpoint
CREATE INDEX "match_org_property_score_idx" ON "property_match" USING btree ("organization_id","property_id","score");--> statement-breakpoint
CREATE UNIQUE INDEX "photo_property_position_uq" ON "property_photo" USING btree ("property_id","position");--> statement-breakpoint
CREATE INDEX "photo_org_property_idx" ON "property_photo" USING btree ("organization_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_lead_uq" ON "requirement" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "requirement_org_updated_idx" ON "requirement" USING btree ("organization_id","updated_at");