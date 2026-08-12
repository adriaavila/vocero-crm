ALTER TABLE "agent_profile" ADD COLUMN "last_live_test_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "last_live_test_passed" boolean;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "last_live_test_elapsed_ms" integer;