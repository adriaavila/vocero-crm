CREATE TABLE "saas_billing_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"type" text NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saas_billing_event" ADD CONSTRAINT "saas_billing_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saas_billing_event_org_idx" ON "saas_billing_event" USING btree ("organization_id");