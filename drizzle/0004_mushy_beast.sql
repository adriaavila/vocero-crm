ALTER TABLE "agent_profile" ADD COLUMN "preset_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "preset_replies" jsonb DEFAULT '[]'::jsonb NOT NULL;