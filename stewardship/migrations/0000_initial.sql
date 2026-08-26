CREATE TABLE IF NOT EXISTS "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'onboarding' NOT NULL,
	"default_timezone" text DEFAULT 'America/New_York' NOT NULL,
	"zernio_profile_id" text,
	"zernio_phone_number_id" text,
	"waba_owner" text,
	"emailit_sender_domain" text,
	"send_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"goal_cents" integer,
	"send_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "designations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"unit_noun_singular" text NOT NULL,
	"unit_noun_plural" text NOT NULL,
	"unit_amount_cents" integer NOT NULL,
	"impact_phrase" text NOT NULL,
	"ladder_next_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "donors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"hebrew_name" text,
	"email" text,
	"phone_e164" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"country" text,
	"timezone" text,
	"candle_lighting_zone_id" uuid,
	"first_gift_at" timestamp with time zone,
	"last_gift_at" timestamp with time zone,
	"lifetime_cents" integer DEFAULT 0 NOT NULL,
	"gift_count" integer DEFAULT 0 NOT NULL,
	"ladder_stage" text DEFAULT 'new' NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donors_org_id_dedupe_key_unique" UNIQUE("org_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"donor_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"designation_id" uuid,
	"amount_cents" integer NOT NULL,
	"matched_total_cents" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"gateway" text,
	"team_referrer" text,
	"dedication_text" text,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"recurring_interval" text,
	"status" text NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gifts_org_id_platform_external_id_unique" UNIQUE("org_id","platform","external_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donor_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"state" text NOT NULL,
	"source" text NOT NULL,
	"evidence" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consents_donor_id_channel_unique" UNIQUE("donor_id","channel")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"donor_id" uuid,
	"reason" text NOT NULL,
	"scope" text DEFAULT 'all' NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"key" text NOT NULL,
	"version" text DEFAULT '1' NOT NULL,
	"body" text NOT NULL,
	"variables" text[] DEFAULT '{}' NOT NULL,
	"has_media_header" boolean DEFAULT false NOT NULL,
	"meta_template_name" text,
	"meta_status" text DEFAULT 'draft',
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"original_uri" text NOT NULL,
	"original_bytes" integer,
	"mime" text,
	"captured_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"designation_id" uuid,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"faces_present" boolean DEFAULT false NOT NULL,
	"release_on_file" boolean DEFAULT false NOT NULL,
	"tagging_state" text DEFAULT 'untagged' NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enrollment_asset_id" uuid,
	"biometric_consent_on_file" boolean DEFAULT false NOT NULL,
	"photo_consent_on_file" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_asset_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"method" text DEFAULT 'human_confirmed' NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "donor_subject_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donor_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"relationship" text NOT NULL,
	"verified_by" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_renditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"uri" text NOT NULL,
	"bytes" integer,
	"mime" text,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"spec_version" text DEFAULT 'v1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journey_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donor_id" uuid NOT NULL,
	"journey_id" uuid NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"current_step_key" text,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exited_at" timestamp with time zone,
	"exit_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "touches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donor_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"journey_id" uuid,
	"step_key" text,
	"channel" text NOT NULL,
	"template_id" uuid,
	"asset_id" uuid,
	"ask_amount_cents" integer,
	"variables" jsonb,
	"scheduled_for" timestamp with time zone,
	"send_bucket_id" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"skip_reason" text,
	"provider" text,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donor_id" uuid NOT NULL,
	"touch_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enrichments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donor_id" uuid NOT NULL,
	"provider" text DEFAULT 'hatch' NOT NULL,
	"matched" boolean,
	"match_confidence" real,
	"capacity_score" real,
	"affinity_score" real,
	"propensity_score" real,
	"raw" jsonb,
	"fetched_at" timestamp with time zone,
	CONSTRAINT "enrichments_donor_id_provider_unique" UNIQUE("donor_id","provider")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subject_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"embedding_placeholder" text,
	"source_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "yom_tov_dates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gregorian_date" text NOT NULL,
	"name" text NOT NULL,
	"blackout_starts_local" text DEFAULT '14:00' NOT NULL,
	"blackout_ends_local" text DEFAULT '22:00' NOT NULL,
	CONSTRAINT "yom_tov_dates_gregorian_date_unique" UNIQUE("gregorian_date")
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "designations" ADD CONSTRAINT "designations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "donors" ADD CONSTRAINT "donors_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_donor_id_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."donors"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_designation_id_designations_id_fk" FOREIGN KEY ("designation_id") REFERENCES "public"."designations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_donor_id_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."donors"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_donor_id_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."donors"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_asset_subjects" ADD CONSTRAINT "media_asset_subjects_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_asset_subjects" ADD CONSTRAINT "media_asset_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "donor_subject_links" ADD CONSTRAINT "donor_subject_links_donor_id_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."donors"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "donor_subject_links" ADD CONSTRAINT "donor_subject_links_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_renditions" ADD CONSTRAINT "media_renditions_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journey_enrollments" ADD CONSTRAINT "journey_enrollments_donor_id_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."donors"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journey_enrollments" ADD CONSTRAINT "journey_enrollments_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_donor_id_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."donors"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_donor_id_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."donors"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_touch_id_touches_id_fk" FOREIGN KEY ("touch_id") REFERENCES "public"."touches"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "enrichments" ADD CONSTRAINT "enrichments_donor_id_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."donors"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subject_embeddings" ADD CONSTRAINT "subject_embeddings_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subject_embeddings" ADD CONSTRAINT "subject_embeddings_source_asset_id_media_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;
