// T-41 (WP06 §11.1/§11.4/§11.5) — the package-free, directly-unit-testable HANDLER LOGIC for WP06's
// three scheduled/autonomous triggers. Mirrors scheduled-dispatch.ts's own separation: this file
// imports no `inngest` package (so it IS reachable from Jest with no live Inngest server / no live
// DB — callers inject a narrow, DI-mockable Prisma subset); the thin `inngest.createFunction({cron})`
// wrappers live in inngest-functions.ts, which imports `inngest` and calls these directly inside one
// `step.run(...)` each, exactly like scheduled-dispatch.ts's own real production wiring.
//
// Fail-safe by design: one rep's/contact's failure (a transient Claude/DB error) never blocks the
// rest of the sweep — each unit is wrapped so its own error is recorded and the loop continues,
// mirroring runScheduledDispatch's own "an unreachable DB/infra hiccup logs and no-ops" posture.

import type { OnboardingStatus, PipelineStage, Role } from '@prisma/client';
import type { ContentBatchService } from './content-batch.service';
import type { LaunchKitService } from './launch-kit.service';
import type { PublishingService } from './publishing.service';
import type { ContentItemRow } from './content-item.service';

// ── §11.1 weekly batch sweep ────────────────────────────────────────────────────────────────────

export interface WeeklyBatchSweepPrismaClient {
  user: {
    findMany(args: {
      where: { role: { in: Role[] }; onboarding_status: OnboardingStatus };
      select: { id: true };
    }): Promise<{ id: string }[]>;
  };
  contentBrief: {
    findFirst(args: { where: { user_id: string; week_start: Date } }): Promise<{ id: string } | null>;
  };
}

function startOfUtcWeek(now: Date): Date {
  const d = new Date(now);
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export interface WeeklyBatchSweepResult {
  attempted: number;
  succeeded: number;
  failed: { userId: string; error: string }[];
}

/** Runs once per rep per UTC week (idempotent via ContentBrief.week_start uniqueness-by-query — a
 *  rep who already has a brief for this week is skipped, so a more-frequent cron tick is harmless). */
export async function runWeeklyBatchSweep(
  db: WeeklyBatchSweepPrismaClient,
  batchService: ContentBatchService,
  now: Date = new Date()
): Promise<WeeklyBatchSweepResult> {
  const weekStart = startOfUtcWeek(now);
  const reps = await db.user.findMany({
    where: { role: { in: ['REP', 'DUAL'] as Role[] }, onboarding_status: 'GATED_COMPLETE' as OnboardingStatus },
    select: { id: true },
  });

  const result: WeeklyBatchSweepResult = { attempted: 0, succeeded: 0, failed: [] };
  for (const rep of reps) {
    const existing = await db.contentBrief.findFirst({ where: { user_id: rep.id, week_start: weekStart } });
    if (existing) continue;
    result.attempted++;
    try {
      await batchService.generateWeeklyBatch(rep.id, now);
      result.succeeded++;
    } catch (err) {
      result.failed.push({ userId: rep.id, error: err instanceof Error ? err.message : 'unknown error' });
    }
  }
  return result;
}

// ── §11.5 the publish tick ──────────────────────────────────────────────────────────────────────

export interface PublishTickPrismaClient {
  contentItem: {
    findMany(args: { where: { state: 'SCHEDULED'; scheduled_for: { lte: Date } } }): Promise<ContentItemRow[]>;
  };
}

export async function runPublishTick(
  db: PublishTickPrismaClient,
  publishingService: PublishingService,
  now: Date = new Date()
) {
  const due = await db.contentItem.findMany({ where: { state: 'SCHEDULED', scheduled_for: { lte: now } } });
  return publishingService.runDuePublishes(due, now);
}

// ── §11.4 launch-kit auto-trigger sweep ("Triggered on a new member joining") ─────────────────────

export interface LaunchKitSweepPrismaClient {
  contact: {
    findMany(args: {
      where: { pipeline_stage: PipelineStage };
    }): Promise<{ id: string; user_id: string; first_name: string }[]>;
  };
  launchKit: {
    findMany(args: { where: { new_member_contact_id: { in: string[] } } }): Promise<{ new_member_contact_id: string | null }[]>;
  };
}

export interface LaunchKitSweepResult {
  attempted: number;
  succeeded: number;
  failed: { contactId: string; error: string }[];
}

/** §11.4 "Triggered on a new member joining" — a "new member" is modeled as a Contact the rep
 *  recruited into the business, i.e. one whose pipeline_stage has reached CLOSED_RECRUIT (the real,
 *  existing WP02/WP03 pipeline-stage vocabulary, §3.1 — this sweep reads it, it does not add to or
 *  modify WP02/WP03's own state machine). A contact who already has a LaunchKit is skipped, so a
 *  frequent cron tick never double-triggers. */
export async function runLaunchKitAutoTriggerSweep(
  db: LaunchKitSweepPrismaClient,
  launchKitService: LaunchKitService,
  now: Date = new Date()
): Promise<LaunchKitSweepResult> {
  const closedRecruits = await db.contact.findMany({ where: { pipeline_stage: 'CLOSED_RECRUIT' as PipelineStage } });
  const result: LaunchKitSweepResult = { attempted: 0, succeeded: 0, failed: [] };
  if (closedRecruits.length === 0) return result;

  const existingKits = await db.launchKit.findMany({
    where: { new_member_contact_id: { in: closedRecruits.map((c) => c.id) } },
  });
  const alreadyKitted = new Set(existingKits.map((k) => k.new_member_contact_id));

  for (const contact of closedRecruits) {
    if (alreadyKitted.has(contact.id)) continue;
    result.attempted++;
    try {
      await launchKitService.triggerKit(
        {
          userId: contact.user_id,
          newMemberContactId: contact.id,
          newMemberFirstName: contact.first_name,
          welcomeVariant: 'BASE_MEMBER_INTRODUCED',
        },
        now
      );
      result.succeeded++;
    } catch (err) {
      result.failed.push({ contactId: contact.id, error: err instanceof Error ? err.message : 'unknown error' });
    }
  }
  return result;
}
