ALTER TABLE "agent_profile" ADD COLUMN "business_hours" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "business_timezone" text DEFAULT 'America/Mexico_City' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "response_mode" text DEFAULT 'outside_hours' NOT NULL;