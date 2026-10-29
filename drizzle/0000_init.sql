CREATE TYPE "public"."award_status" AS ENUM('pending', 'open', 'closed', 'revealed');--> statement-breakpoint
CREATE TABLE "admin_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"award_id" smallint,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "awards" (
	"id" smallint PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"sort_order" smallint NOT NULL,
	"status" "award_status" DEFAULT 'pending' NOT NULL,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"revealed_at" timestamp with time zone,
	"auto_close_at" timestamp with time zone,
	"seq" bigint DEFAULT 0 NOT NULL,
	"round" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "awards_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ballots" (
	"award_id" smallint NOT NULL,
	"device_hash" "bytea" NOT NULL,
	"request_id" uuid NOT NULL,
	CONSTRAINT "ballots_award_id_device_hash_pk" PRIMARY KEY("award_id","device_hash")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"current_award_id" smallint,
	"hide_counts" boolean DEFAULT false NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_singleton" CHECK ("events"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "nominees" (
	"id" smallint PRIMARY KEY NOT NULL,
	"nickname" text NOT NULL,
	"first_name" text NOT NULL,
	"grp" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "nominees_grp" CHECK ("nominees"."grp" in ('AMBER','AZURE','JADE','RUBY'))
);
--> statement-breakpoint
CREATE TABLE "tallies" (
	"award_id" smallint NOT NULL,
	"nominee_id" smallint NOT NULL,
	"votes" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tallies_award_id_nominee_id_pk" PRIMARY KEY("award_id","nominee_id")
);
--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_award_id_awards_id_fk" FOREIGN KEY ("award_id") REFERENCES "public"."awards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_current_award_id_awards_id_fk" FOREIGN KEY ("current_award_id") REFERENCES "public"."awards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tallies" ADD CONSTRAINT "tallies_award_id_awards_id_fk" FOREIGN KEY ("award_id") REFERENCES "public"."awards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tallies" ADD CONSTRAINT "tallies_nominee_id_nominees_id_fk" FOREIGN KEY ("nominee_id") REFERENCES "public"."nominees"("id") ON DELETE no action ON UPDATE no action;