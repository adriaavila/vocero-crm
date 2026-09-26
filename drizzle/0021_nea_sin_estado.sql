ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "transcript" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "agent_cursor_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "memory_reset_at" timestamp;
