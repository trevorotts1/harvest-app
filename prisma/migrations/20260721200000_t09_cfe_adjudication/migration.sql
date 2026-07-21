-- T-09 (master-spec §5.5 CFE adjudication + human loop; §8.7.1 Flag-queue upline/principal review;
-- §8.1.1 FINRA 3110 Principal Review Triggers). Wires the previously-declared-but-unused
-- ComplianceReviewQueue / ComplianceUplineReview models into a real upline-adjudication path, a
-- 48-hour SLA escalation, and the Sonnet-5 / Opus-4.8 ADVISORY recommendation.
--
-- Every added column is additive and nullable (or a NOT NULL on an empty, previously-unused table),
-- so this migrates drift-clean. Hand-authored SQL (no live Postgres in this build env, DATABASE_URL
-- intentionally unset) — same convention as 20260721190000_t_r16_draft_approval_justification and
-- 20260721100000_t_r25_org_switch_event.

-- AlterTable: ComplianceReviewQueue (empty legacy table — the NOT NULL `updated_at` is safe)
ALTER TABLE "ComplianceReviewQueue" ADD COLUMN "draft_id" TEXT;
ALTER TABLE "ComplianceReviewQueue" ADD COLUMN "rep_id" TEXT;
ALTER TABLE "ComplianceReviewQueue" ADD COLUMN "risk_score" INTEGER;
ALTER TABLE "ComplianceReviewQueue" ADD COLUMN "recommended_action" TEXT;
ALTER TABLE "ComplianceReviewQueue" ADD COLUMN "suggested_rewrite" TEXT;
ALTER TABLE "ComplianceReviewQueue" ADD COLUMN "recommendation_model" TEXT;
ALTER TABLE "ComplianceReviewQueue" ADD COLUMN "escalation_reason" TEXT;
ALTER TABLE "ComplianceReviewQueue" ADD COLUMN "sla_deadline_at" TIMESTAMPTZ(6);
ALTER TABLE "ComplianceReviewQueue" ADD COLUMN "escalated_at" TIMESTAMPTZ(6);
ALTER TABLE "ComplianceReviewQueue" ADD COLUMN "escalated_to_contact_id" TEXT;
ALTER TABLE "ComplianceReviewQueue" ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL;

-- AlterTable: ComplianceUplineReview
ALTER TABLE "ComplianceUplineReview" ADD COLUMN "queue_id" TEXT;
ALTER TABLE "ComplianceUplineReview" ADD COLUMN "draft_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceReviewQueue_draft_id_key" ON "ComplianceReviewQueue"("draft_id");
CREATE INDEX "ComplianceReviewQueue_upline_id_status_idx" ON "ComplianceReviewQueue"("upline_id", "status");
CREATE INDEX "ComplianceReviewQueue_status_sla_deadline_at_idx" ON "ComplianceReviewQueue"("status", "sla_deadline_at");
CREATE INDEX "ComplianceReviewQueue_rep_id_idx" ON "ComplianceReviewQueue"("rep_id");
CREATE INDEX "ComplianceUplineReview_queue_id_idx" ON "ComplianceUplineReview"("queue_id");
CREATE INDEX "ComplianceUplineReview_reviewer_id_timestamp_idx" ON "ComplianceUplineReview"("reviewer_id", "timestamp");
