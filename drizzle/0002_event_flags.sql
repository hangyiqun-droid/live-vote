ALTER TABLE "events" ADD COLUMN "show_hall" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "qr_fallback" boolean DEFAULT false NOT NULL;