ALTER TABLE "pessoa_fisica" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pessoa_juridica" ADD COLUMN "deleted_at" timestamp with time zone;
