-- CreateEnum
CREATE TYPE "Role" AS ENUM ('REP', 'UPLINE', 'RVP', 'ADMIN', 'DUAL');

-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('PRIMERICA', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "AccessTier" AS ENUM ('FREE_ORG_LINKED', 'FREE_PAID_EXTERNAL', 'PAID_INDIVIDUAL', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "IntensitySetting" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('IN_PROGRESS', 'GATED_COMPLETE');

-- CreateEnum
CREATE TYPE "OnboardingStep" AS ENUM ('REGISTER', 'ACCOUNT_TYPE', 'SEVEN_WHYS', 'GOAL_CARD', 'INTENSITY', 'COMPLETE');

-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('IDENTIFIED', 'INTRODUCED', 'RESPONDED', 'APPOINTMENT_PROPOSED', 'APPOINTMENT_CONFIRMED', 'MET', 'CLOSED_CLIENT', 'CLOSED_RECRUIT', 'DORMANT', 'DO_NOT_CONTACT');

-- CreateEnum
CREATE TYPE "CFEOutcome" AS ENUM ('PASS', 'FLAG', 'BLOCK');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('SMS_HANDOFF', 'SMS_PLATFORM', 'EMAIL', 'SOCIAL_DM', 'IN_APP');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "MessageSource" AS ENUM ('AGENT', 'REP', 'UPLINE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "SponsorshipState" AS ENUM ('ACTIVE', 'MEMBER_GRACE', 'SPONSOR_LAPSED', 'ANNIVERSARY_PENDING', 'CONVERTED', 'ENDED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrgType" NOT NULL,
    "white_label_theme" JSONB,
    "compliance_contact_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'REP',
    "org_type" "OrgType" NOT NULL DEFAULT 'EXTERNAL',
    "solution_number" TEXT,
    "upline_id" TEXT,
    "access_tier" "AccessTier" NOT NULL DEFAULT 'FREE_ORG_LINKED',
    "intensity_setting" "IntensitySetting" NOT NULL DEFAULT 'MEDIUM',
    "commitment_score" INTEGER NOT NULL DEFAULT 0,
    "rank" TEXT,
    "anchor_statement" TEXT,
    "finra_u4_status" TEXT,
    "calendar_preferences" JSONB,
    "calendar_connected" BOOLEAN NOT NULL DEFAULT false,
    "gdpr_consent" BOOLEAN NOT NULL DEFAULT false,
    "onboarding_status" "OnboardingStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "mfa_enrolled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_methods" JSONB,
    "organization_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL DEFAULT '',
    "phone" TEXT,
    "email" TEXT,
    "phone_hash" TEXT,
    "email_hash" TEXT,
    "notes" TEXT,
    "relationship_type" TEXT,
    "industry" TEXT,
    "segment_score" INTEGER NOT NULL DEFAULT 0,
    "is_recruit_target" BOOLEAN NOT NULL DEFAULT false,
    "is_client" BOOLEAN NOT NULL DEFAULT false,
    "is_a_list" BOOLEAN NOT NULL DEFAULT false,
    "pipeline_stage" "PipelineStage" NOT NULL DEFAULT 'IDENTIFIED',
    "last_contact_date" TIMESTAMPTZ(6),
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "import_batch_id" TEXT,
    "do_not_contact" BOOLEAN NOT NULL DEFAULT false,
    "agents_paused" BOOLEAN NOT NULL DEFAULT false,
    "household_id" TEXT,
    "is_minor_flag" BOOLEAN NOT NULL DEFAULT false,
    "linked_user_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactInteraction" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'NOTE',
    "notes" TEXT NOT NULL DEFAULT '',
    "message_id" TEXT,
    "agent_run_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingSession" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "current_step" "OnboardingStep" NOT NULL DEFAULT 'REGISTER',
    "seven_whys" JSONB,
    "goal_card" JSONB,
    "intensity_data" JSONB,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content_id" TEXT,
    "content_text" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "channel" "MessageChannel",
    "risk_score" INTEGER NOT NULL,
    "outcome" "CFEOutcome" NOT NULL,
    "classifier_data" JSONB NOT NULL,
    "rule_version" TEXT NOT NULL,
    "regulation" TEXT NOT NULL,
    "reviewer_id" TEXT,
    "reviewer_action" TEXT,
    "role" "Role" NOT NULL DEFAULT 'REP',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceConsent" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "consent_type" TEXT NOT NULL,
    "given" BOOLEAN NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regulation" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceReviewQueue" (
    "id" TEXT NOT NULL,
    "audit_entry_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "upline_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceReviewQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceUplineReview" (
    "id" TEXT NOT NULL,
    "audit_entry_id" TEXT NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "feedback" TEXT,
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceUplineReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceException" (
    "id" TEXT NOT NULL,
    "audit_entry_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDataExport" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserDataExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDataDeletion" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "anonymized_fields" TEXT[],
    "retained_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deletion_certificate_url" TEXT,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "UserDataDeletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "default_model" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "prompt_template_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AgentDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agent_key" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "model_used" TEXT NOT NULL,
    "input_summary" TEXT,
    "output_ref" TEXT,
    "token_input" INTEGER NOT NULL DEFAULT 0,
    "token_output" INTEGER NOT NULL DEFAULT 0,
    "cost_cents" INTEGER NOT NULL DEFAULT 0,
    "batched" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reasoning_log" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftMessage" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "body" TEXT NOT NULL,
    "cfe_outcome" "CFEOutcome",
    "cfe_risk_score" INTEGER,
    "cfe_classifier_data" JSONB,
    "approval_state" TEXT NOT NULL DEFAULT 'PENDING',
    "approved_by" TEXT,
    "approved_at" TIMESTAMPTZ(6),
    "edited_after_approval" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "DraftMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageThread" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "source" "MessageSource" NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "body" TEXT NOT NULL,
    "cfe_audit_id" TEXT,
    "sent_from" TEXT,
    "delivery_status" TEXT NOT NULL DEFAULT 'PENDING',
    "handoff_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "rep_id" TEXT NOT NULL,
    "trainer_id" TEXT,
    "contact_id" TEXT NOT NULL,
    "proposed_windows" JSONB,
    "confirmed_start" TIMESTAMPTZ(6),
    "confirmed_end" TIMESTAMPTZ(6),
    "governing_timezone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "slot_lock_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarLink" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "scope" TEXT,
    "token_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CalendarLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "stripe_subscription_id" TEXT,
    "plan_tier" TEXT NOT NULL,
    "billing_cycle" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "current_period_start" TIMESTAMPTZ(6),
    "current_period_end" TIMESTAMPTZ(6),
    "org_sponsored" BOOLEAN NOT NULL DEFAULT false,
    "sponsor_user_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sponsorship" (
    "id" TEXT NOT NULL,
    "sponsor_user_id" TEXT NOT NULL,
    "member_user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "state" "SponsorshipState" NOT NULL,
    "term_start" TIMESTAMPTZ(6),
    "term_end" TIMESTAMPTZ(6),
    "grace_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Sponsorship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "stripe_invoice_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "issued_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "stripe_payment_method_id" TEXT NOT NULL,
    "brand" TEXT,
    "last4" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyLog" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionConfig" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT,
    "sponsor_user_id" TEXT,
    "revenue_share_percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "effective_start" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_end" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CommissionConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgTreeEdge" (
    "id" TEXT NOT NULL,
    "sponsor_id" TEXT NOT NULL,
    "recruit_id" TEXT NOT NULL,
    "edge_type" TEXT NOT NULL,
    "is_recruit_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "leg_depth" INTEGER NOT NULL DEFAULT 0,
    "is_leg" BOOLEAN NOT NULL DEFAULT false,
    "has_own_recruit" BOOLEAN NOT NULL DEFAULT false,
    "health_index" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "OrgTreeEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UplineInvite" (
    "id" TEXT NOT NULL,
    "sponsor_id" TEXT NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMPTZ(6),
    "resend_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UplineInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MomentumEvent" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "law" TEXT NOT NULL,
    "source_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MomentumEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "milestone_key" TEXT NOT NULL,
    "achieved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "celebrated" BOOLEAN NOT NULL DEFAULT false,
    "shareable_asset_ref" TEXT,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptOutRegistry" (
    "id" TEXT NOT NULL,
    "identifier_hash" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OptOutRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhySession" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "transcript" JSONB NOT NULL,
    "resonance_score" INTEGER NOT NULL DEFAULT 0,
    "anchor_statement" TEXT,
    "why_photo_ref" TEXT,
    "use_in_outreach_consent" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "WhySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarmMarketExercise" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "blank_canvas_names" JSONB,
    "qualities" JSONB,
    "background_context" JSONB,
    "highlights" JSONB,
    "match_results" JSONB,
    "readiness_scores" JSONB,
    "mode" TEXT NOT NULL DEFAULT 'UNIVERSAL',
    "blank_canvas_completed" BOOLEAN NOT NULL DEFAULT false,
    "qualities_completed" BOOLEAN NOT NULL DEFAULT false,
    "background_matching_completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "WarmMarketExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseProgress" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "module_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "CourseProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamEvent" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "rsvp_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TeamEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLibrary" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "attribution" TEXT,
    "org_scope" TEXT NOT NULL DEFAULT 'ALL',
    "cfe_cleared" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "QuoteLibrary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "type" TEXT NOT NULL,
    "ip_hash" TEXT,
    "device_fingerprint_hash" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_upline_id_idx" ON "User"("upline_id");

-- CreateIndex
CREATE INDEX "User_organization_id_idx" ON "User"("organization_id");

-- CreateIndex
CREATE INDEX "Contact_user_id_idx" ON "Contact"("user_id");

-- CreateIndex
CREATE INDEX "Contact_user_id_pipeline_stage_idx" ON "Contact"("user_id", "pipeline_stage");

-- CreateIndex
CREATE INDEX "Contact_phone_hash_idx" ON "Contact"("phone_hash");

-- CreateIndex
CREATE INDEX "Contact_email_hash_idx" ON "Contact"("email_hash");

-- CreateIndex
CREATE INDEX "Contact_household_id_idx" ON "Contact"("household_id");

-- CreateIndex
CREATE INDEX "ContactInteraction_contact_id_idx" ON "ContactInteraction"("contact_id");

-- CreateIndex
CREATE INDEX "ContactInteraction_message_id_idx" ON "ContactInteraction"("message_id");

-- CreateIndex
CREATE INDEX "ContactInteraction_agent_run_id_idx" ON "ContactInteraction"("agent_run_id");

-- CreateIndex
CREATE INDEX "AuditEntry_created_at_idx" ON "AuditEntry"("created_at");

-- CreateIndex
CREATE INDEX "AuditEntry_user_id_created_at_idx" ON "AuditEntry"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "AuditEntry_content_id_idx" ON "AuditEntry"("content_id");

-- CreateIndex
CREATE INDEX "ComplianceConsent_timestamp_idx" ON "ComplianceConsent"("timestamp");

-- CreateIndex
CREATE INDEX "ComplianceConsent_user_id_timestamp_idx" ON "ComplianceConsent"("user_id", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceReviewQueue_audit_entry_id_key" ON "ComplianceReviewQueue"("audit_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "AgentDefinition_key_key" ON "AgentDefinition"("key");

-- CreateIndex
CREATE INDEX "AgentRun_user_id_created_at_idx" ON "AgentRun"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "AgentRun_agent_key_idx" ON "AgentRun"("agent_key");

-- CreateIndex
CREATE INDEX "DraftMessage_user_id_idx" ON "DraftMessage"("user_id");

-- CreateIndex
CREATE INDEX "DraftMessage_contact_id_idx" ON "DraftMessage"("contact_id");

-- CreateIndex
CREATE INDEX "MessageThread_user_id_contact_id_idx" ON "MessageThread"("user_id", "contact_id");

-- CreateIndex
CREATE INDEX "Message_thread_id_created_at_idx" ON "Message"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "Message_cfe_audit_id_idx" ON "Message"("cfe_audit_id");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_slot_lock_id_key" ON "Appointment"("slot_lock_id");

-- CreateIndex
CREATE INDEX "Appointment_rep_id_idx" ON "Appointment"("rep_id");

-- CreateIndex
CREATE INDEX "Appointment_contact_id_idx" ON "Appointment"("contact_id");

-- CreateIndex
CREATE INDEX "Appointment_trainer_id_idx" ON "Appointment"("trainer_id");

-- CreateIndex
CREATE INDEX "CalendarLink_user_id_idx" ON "CalendarLink"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripe_subscription_id_key" ON "Subscription"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "Subscription_user_id_idx" ON "Subscription"("user_id");

-- CreateIndex
CREATE INDEX "Sponsorship_sponsor_user_id_idx" ON "Sponsorship"("sponsor_user_id");

-- CreateIndex
CREATE INDEX "Sponsorship_member_user_id_idx" ON "Sponsorship"("member_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_stripe_invoice_id_key" ON "Invoice"("stripe_invoice_id");

-- CreateIndex
CREATE INDEX "Invoice_user_id_idx" ON "Invoice"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_stripe_payment_method_id_key" ON "PaymentMethod"("stripe_payment_method_id");

-- CreateIndex
CREATE INDEX "PaymentMethod_user_id_idx" ON "PaymentMethod"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyLog_key_key" ON "IdempotencyLog"("key");

-- CreateIndex
CREATE INDEX "IdempotencyLog_source_idx" ON "IdempotencyLog"("source");

-- CreateIndex
CREATE INDEX "OrgTreeEdge_sponsor_id_idx" ON "OrgTreeEdge"("sponsor_id");

-- CreateIndex
CREATE INDEX "OrgTreeEdge_recruit_id_idx" ON "OrgTreeEdge"("recruit_id");

-- CreateIndex
CREATE UNIQUE INDEX "OrgTreeEdge_sponsor_id_recruit_id_key" ON "OrgTreeEdge"("sponsor_id", "recruit_id");

-- CreateIndex
CREATE INDEX "UplineInvite_sponsor_id_idx" ON "UplineInvite"("sponsor_id");

-- CreateIndex
CREATE INDEX "MomentumEvent_user_id_created_at_idx" ON "MomentumEvent"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "Milestone_user_id_idx" ON "Milestone"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "Milestone_user_id_milestone_key_key" ON "Milestone"("user_id", "milestone_key");

-- CreateIndex
CREATE INDEX "OptOutRegistry_identifier_hash_idx" ON "OptOutRegistry"("identifier_hash");

-- CreateIndex
CREATE UNIQUE INDEX "OptOutRegistry_identifier_hash_channel_key" ON "OptOutRegistry"("identifier_hash", "channel");

-- CreateIndex
CREATE INDEX "WhySession_user_id_idx" ON "WhySession"("user_id");

-- CreateIndex
CREATE INDEX "WarmMarketExercise_user_id_idx" ON "WarmMarketExercise"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "CourseProgress_user_id_module_key_key" ON "CourseProgress"("user_id", "module_key");

-- CreateIndex
CREATE INDEX "TeamEvent_organization_id_idx" ON "TeamEvent"("organization_id");

-- CreateIndex
CREATE INDEX "TeamEvent_owner_id_idx" ON "TeamEvent"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_event_id_user_id_key" ON "Attendance"("event_id", "user_id");

-- CreateIndex
CREATE INDEX "SecurityEvent_user_id_created_at_idx" ON "SecurityEvent"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "SecurityEvent_type_created_at_idx" ON "SecurityEvent"("type", "created_at");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_upline_id_fkey" FOREIGN KEY ("upline_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactInteraction" ADD CONSTRAINT "ContactInteraction_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingSession" ADD CONSTRAINT "OnboardingSession_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "MessageThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "TeamEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-appended (not derived from schema.prisma, which cannot express conditional/partial
-- constraints via `@@unique`): double-provisioning guard (T-03 QC fix, defect 1, §15).
-- Enforces at most one ACTIVE Subscription row per user, and at most one ACTIVE Sponsorship
-- row per sponsored member, directly at the database layer rather than relying solely on
-- application-level checks.

-- CreatePartialUniqueIndex
CREATE UNIQUE INDEX "subscription_one_active_per_user" ON "Subscription"("user_id") WHERE "status" = 'ACTIVE';

-- CreatePartialUniqueIndex
CREATE UNIQUE INDEX "sponsorship_one_active_per_member" ON "Sponsorship"("member_user_id") WHERE "state" = 'ACTIVE';
