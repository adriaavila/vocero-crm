CREATE TABLE "ad_spend" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ad_spend_amount_cents_ck" CHECK ("ad_spend"."amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ad_spend" ADD CONSTRAINT "ad_spend_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_spend_org_period_idx" ON "ad_spend" USING btree ("organization_id","period_start");