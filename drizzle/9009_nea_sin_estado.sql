ALTER TABLE "conversation" ADD COLUMN "agent_cursor_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "memory_reset_at" timestamp;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "transcript" text;