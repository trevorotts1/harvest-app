// WP08 §13.4 — the daily milestone/stagnation SWEEP: the autonomous ("while you slept") half of
// milestone detection. The synchronous half fires the moment an `OrgTreeEdge` is created (see the
// two additive call-sites in `src/services/onboarding/wp01/sponsor-invite.service.ts`); this sweep
// is what still detects a stagnating node or a phase-timeline auto-item that became true without
// any NEW recruit event (e.g. the rep finally finished the Harvest Method, or 31 days of silence
// passed on an existing node) — nobody has to open the app for it to fire.
//
// Package-free (no `inngest` import — that ESM-only package cannot load under Jest's default CJS
// runtime, the same reason `scheduled-dispatch.ts` keeps its own logic import-free of `inngest`).
// The Inngest `{ cron: ... }` wrapper lives in `inngest/taprooting-inngest-functions.ts`, which
// imports this function and wraps it in one `step.run`.

import { OrgType } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { buildLicensingService } from './timeline.service';
import { runMilestoneDetection, type MilestoneDetectionPrismaClient } from './milestone-detection.service';

export const TAPROOTING_SWEEP_FUNCTION_ID = 'taprooting-milestone-sweep' as const;
/** Daily, well off-peak (§13.4 "stagnation ... triggers a re-engagement flow" is a day-granularity
 *  signal, not a real-time one — a once-daily catch-up is the right cadence, mirroring the
 *  agent-dispatch scheduler's own "liveness/catch-up, not the cadence itself" reasoning). */
export const TAPROOTING_SWEEP_CRON = '0 9 * * *' as const; // 09:00 UTC daily

export interface TaprootingSweepResult {
  usersProcessed: number;
  usersFailed: number;
  totalMilestonesDetected: number;
}

/**
 * Runs `runMilestoneDetection` for every Primerica-branch rep (the sweep is Primerica-gated
 * exactly like every other WP08 surface, §17.1 — a universal rep has no orchard/timeline to sweep).
 * Isolated per-user (mirrors `today.service.ts`'s `safeZone` philosophy): one rep's failure never
 * stops the sweep for the rest.
 */
export async function runTaprootingSweep(
  db: MilestoneDetectionPrismaClient = prisma as unknown as MilestoneDetectionPrismaClient,
  now: Date = new Date()
): Promise<TaprootingSweepResult> {
  const users = await (prisma as unknown as { user: { findMany(args: { where: { org_type: OrgType }; select: { id: true } }): Promise<{ id: string }[]> } }).user.findMany({
    where: { org_type: OrgType.PRIMERICA },
    select: { id: true },
  });

  const licensingService = buildLicensingService();
  let usersProcessed = 0;
  let usersFailed = 0;
  let totalMilestonesDetected = 0;

  for (const user of users) {
    try {
      const result = await runMilestoneDetection(user.id, licensingService, db, now);
      usersProcessed += 1;
      totalMilestonesDetected += result.detected.length;
    } catch {
      // Never let one rep's data issue take down the whole sweep — logged upstream by the
      // Inngest step's own retry/telemetry; this function stays a pure, always-completing pass.
      usersFailed += 1;
    }
  }

  return { usersProcessed, usersFailed, totalMilestonesDetected };
}
