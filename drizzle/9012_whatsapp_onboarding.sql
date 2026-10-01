CREATE TABLE "whatsapp_onboarding" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"mode" text,
	"waba_id" text,
	"phone_number_id" text,
	"error_step" text,
	"error_code" text,
	"error_detail" text,
	"cancelled_at_step" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"connected_at" timestamp,
	"webhook_ok_at" timestamp,
	"first_message_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_onboarding" ADD CONSTRAINT "whatsapp_onboarding_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;