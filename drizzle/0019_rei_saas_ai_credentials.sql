CREATE TABLE "ai_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"key_cipher" text NOT NULL,
	"key_iv" text NOT NULL,
	"key_tag" text NOT NULL,
	"key_last4" text NOT NULL,
	"last_validated_at" timestamp DEFAULT now() NOT NULL,
	"last_validation_status" text DEFAULT 'valid' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_credentials" ADD CONSTRAINT "ai_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credentials_org_provider_uq" ON "ai_credentials" USING btree ("organization_id","provider");
--> statement-breakpoint
UPDATE "agent_profile"
SET "name" = 'Rei', "updated_at" = now()
WHERE "name" IS DISTINCT FROM 'Rei';
--> statement-breakpoint
ALTER TABLE "agent_profile" ALTER COLUMN "name" SET DEFAULT 'Rei';
