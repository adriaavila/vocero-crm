CREATE TABLE "agent_decision" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"brain" text NOT NULL,
	"dispatch_id" text,
	"action" text NOT NULL,
	"handoff_reason" text,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"prompt_version" text,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"trigger_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reply_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verdict" text,
	"verdict_note" text,
	"verdict_by" text,
	"verdict_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"account_ref" text,
	"field" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	CONSTRAINT "raw_event_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "reply_to_wa_id" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "delivered_at" timestamp;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "read_at" timestamp;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "failed_at" timestamp;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "raw_event_id" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "sender_user_id" text;--> statement-breakpoint
ALTER TABLE "agent_decision" ADD CONSTRAINT "agent_decision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_decision" ADD CONSTRAINT "agent_decision_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_event" ADD CONSTRAINT "raw_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_decision_org_created_idx" ON "agent_decision" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_decision_conv_created_idx" ON "agent_decision" USING btree ("conversation_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "agent_decision_dispatch_uq" ON "agent_decision" USING btree ("conversation_id","dispatch_id") WHERE "agent_decision"."dispatch_id" is not null;--> statement-breakpoint
CREATE INDEX "raw_event_status_received_idx" ON "raw_event" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "raw_event_org_received_idx" ON "raw_event" USING btree ("organization_id","received_at");--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_raw_event_id_raw_event_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_sender_user_id_user_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_raw_event_idx" ON "message" USING btree ("raw_event_id") WHERE "message"."raw_event_id" is not null;