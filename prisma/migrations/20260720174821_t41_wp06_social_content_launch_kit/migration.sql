-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('INSTAGRAM', 'FACEBOOK', 'LINKEDIN');

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('SOCIAL_POST', 'BLOG', 'EMAIL');

-- CreateEnum
CREATE TYPE "ContentCategory" AS ENUM ('COMMUNITY_SPOTLIGHT', 'VALUE_FIRST_EDUCATION', 'MOVEMENT_FRAMING', 'BEHIND_THE_HARVEST', 'EVENT_INTRODUCTION_ANNOUNCEMENT');

-- CreateEnum
CREATE TYPE "ContentQueueState" AS ENUM ('DRAFTING', 'COMPLIANCE_CHECK', 'READY_FOR_REVIEW', 'SCHEDULED', 'PUBLISHED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "PersonalizationTier" AS ENUM ('AUTOMATIC', 'AI_INFERRED', 'REP_PROVIDED');

-- CreateEnum
CREATE TYPE "LaunchKitPieceType" AS ENUM ('WELCOME', 'ANNOUNCEMENT', 'DAY3_VALUE_EMAIL', 'DAY7_EVENT_INVITE');

-- CreateEnum
CREATE TYPE "WelcomeVariant" AS ENUM ('PERSONAL_REFERRAL', 'EVENT_ATTENDEE', 'BASE_MEMBER_INTRODUCED');

-- CreateEnum
CREATE TYPE "LaunchKitVersion" AS ENUM ('V1_STANDARD', 'V2_TESTIMONIAL_ANCHORED', 'V3_EVENT_CENTRIC');

-- CreateEnum
CREATE TYPE "LaunchKitState" AS ENUM ('DRAFTING', 'HELD_FOR_REVIEW', 'READY_FOR_REVIEW', 'APPROVED', 'WITHDRAWN_TO_DRAFTS');

-- CreateTable
CREATE TABLE "ContentBrief" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "week_start" TIMESTAMPTZ(6) NOT NULL,
    "context" JSONB NOT NULL,
    "crosswalk" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content_type" "ContentType" NOT NULL,
    "category" "ContentCategory",
    "launch_kit_piece_type" "LaunchKitPieceType",
    "copy_skeleton" TEXT NOT NULL,
    "image_concept_prompt" TEXT,
    "platform_variants" JSONB,
    "tone_guidance" TEXT NOT NULL,
    "doctrine_verified" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ContentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaunchKit" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "new_member_contact_id" TEXT,
    "new_member_first_name" TEXT NOT NULL,
    "welcome_variant" "WelcomeVariant" NOT NULL DEFAULT 'PERSONAL_REFERRAL',
    "version" "LaunchKitVersion" NOT NULL DEFAULT 'V1_STANDARD',
    "state" "LaunchKitState" NOT NULL DEFAULT 'DRAFTING',
    "photo_url" TEXT,
    "triggered_at" TIMESTAMPTZ(6) NOT NULL,
    "generated_at" TIMESTAMPTZ(6),
    "held_reason" TEXT,
    "withdrawn_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "LaunchKit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content_type" "ContentType" NOT NULL,
    "category" "ContentCategory",
    "platform" "SocialPlatform",
    "launch_kit_id" TEXT,
    "launch_kit_piece_type" "LaunchKitPieceType",
    "brief_id" TEXT,
    "template_id" TEXT,
    "personalization_tier" "PersonalizationTier" NOT NULL DEFAULT 'AUTOMATIC',
    "headline" TEXT,
    "body" TEXT NOT NULL,
    "image_concept_prompt" TEXT,
    "cta" TEXT,
    "state" "ContentQueueState" NOT NULL DEFAULT 'DRAFTING',
    "cfe_outcome" "CFEOutcome",
    "cfe_risk_score" INTEGER,
    "cfe_classifier_data" JSONB,
    "vocab_clean" BOOLEAN NOT NULL DEFAULT false,
    "vocab_violations" JSONB,
    "doctrine_notes" JSONB,
    "scheduled_for" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "publish_attempts" INTEGER NOT NULL DEFAULT 0,
    "publish_hold_reason" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMPTZ(6),
    "edited_after_approval" BOOLEAN NOT NULL DEFAULT false,
    "edit_history" JSONB,
    "decline_reason" TEXT,
    "model_used" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementFollowUpTask" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content_item_id" TEXT NOT NULL,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngagementFollowUpTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentBrief_user_id_week_start_idx" ON "ContentBrief"("user_id", "week_start");

-- CreateIndex
CREATE UNIQUE INDEX "ContentTemplate_key_key" ON "ContentTemplate"("key");

-- CreateIndex
CREATE INDEX "LaunchKit_user_id_idx" ON "LaunchKit"("user_id");

-- CreateIndex
CREATE INDEX "LaunchKit_new_member_contact_id_idx" ON "LaunchKit"("new_member_contact_id");

-- CreateIndex
CREATE INDEX "ContentItem_user_id_state_idx" ON "ContentItem"("user_id", "state");

-- CreateIndex
CREATE INDEX "ContentItem_user_id_content_type_idx" ON "ContentItem"("user_id", "content_type");

-- CreateIndex
CREATE INDEX "ContentItem_launch_kit_id_idx" ON "ContentItem"("launch_kit_id");

-- CreateIndex
CREATE INDEX "ContentItem_scheduled_for_idx" ON "ContentItem"("scheduled_for");

-- CreateIndex
CREATE INDEX "EngagementFollowUpTask_user_id_completed_idx" ON "EngagementFollowUpTask"("user_id", "completed");

-- CreateIndex
CREATE INDEX "EngagementFollowUpTask_content_item_id_idx" ON "EngagementFollowUpTask"("content_item_id");
