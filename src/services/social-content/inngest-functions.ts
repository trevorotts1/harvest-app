// T-41 (WP06) — the Inngest cron registrations. Thin wrappers ONLY (mirrors
// src/services/agent-runtime/inngest-functions.ts exactly): all real logic lives in the
// package-free, directly-testable scheduled-jobs.ts; this file imports the `inngest` package (so it
// is NOT reachable from Jest) and supplies the REAL production service wiring lazily, per invocation,
// inside a single `step.run(...)` — never at module scope (§0.4 build-safety rule).

import { inngest } from '@/lib/inngest/client';
import { prisma } from '@/lib/prisma';
import {
  runLaunchKitAutoTriggerSweep,
  runPublishTick,
  runWeeklyBatchSweep,
  type LaunchKitSweepPrismaClient,
  type PublishTickPrismaClient,
  type WeeklyBatchSweepPrismaClient,
} from './scheduled-jobs';
import {
  buildContentBatchService,
  buildLaunchKitService,
  buildPublishingService,
} from './production-wiring';

/** §11.1 "weekly content brief" — weekly on Monday mornings (UTC). One rep may already have a brief
 *  for the current UTC week (runWeeklyBatchSweep's own check), so a re-run/catch-up tick is harmless. */
export const weeklyContentBatchFunction = inngest.createFunction(
  { id: 'social-content-weekly-batch', name: 'WP06 weekly content batch (§11.1/§11.3)' },
  { cron: '0 9 * * 1' },
  async ({ step }) => {
    return step.run('weekly-batch-sweep', () =>
      runWeeklyBatchSweep(prisma as unknown as WeeklyBatchSweepPrismaClient, buildContentBatchService(prisma))
    );
  }
);

/** §11.5 "Scheduling respects time-of-day windows; API failure holds with retry then manual
 *  fallback." Every 5 minutes so a scheduled post's window is honored closely without hammering the
 *  (currently unconfigured, see publishing.service.ts) publish transport. */
export const contentPublishTickFunction = inngest.createFunction(
  { id: 'social-content-publish-tick', name: 'WP06 scheduled-publish tick (§11.5)' },
  { cron: '*/5 * * * *' },
  async ({ step }) => {
    return step.run('publish-tick', () =>
      runPublishTick(prisma as unknown as PublishTickPrismaClient, buildPublishingService(prisma))
    );
  }
);

/** §11.4 "Triggered on a new member joining" — the automatic production caller (in addition to the
 *  rep-facing manual trigger, POST /api/content/launch-kit/trigger). Every minute so a genuinely new
 *  member is detected close to real-time, keeping the whole batch's generation-latency AC (§11.8-3,
 *  "within 60 s") meaningful in practice — detection latency is bounded by this cadence, generation
 *  latency by launch-kit.service.ts's own parallel generation. */
export const launchKitAutoTriggerFunction = inngest.createFunction(
  { id: 'social-content-launch-kit-sweep', name: 'WP06 launch-kit auto-trigger sweep (§11.4)' },
  { cron: '*/1 * * * *' },
  async ({ step }) => {
    return step.run('launch-kit-sweep', () =>
      runLaunchKitAutoTriggerSweep(prisma as unknown as LaunchKitSweepPrismaClient, buildLaunchKitService(prisma))
    );
  }
);

export const socialContentInngestFunctions = [
  weeklyContentBatchFunction,
  contentPublishTickFunction,
  launchKitAutoTriggerFunction,
];
