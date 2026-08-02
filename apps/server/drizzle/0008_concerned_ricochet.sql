ALTER TYPE "public"."auth_provider" ADD VALUE 'pending';--> statement-breakpoint
CREATE TABLE "registration_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_codes_code_hash_unique" UNIQUE("code_hash")
);
