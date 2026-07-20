// T-43 (WP07 §12.1, §12.3, §12.6) — the gamification lane's Inngest cron registrations, mirroring
// `agent-runtime/scheduled-dispatch.ts` / `messaging/inngest/messaging-inngest-functions.ts`'s own
// convention: this file imports the `inngest` package (so it is NOT reachable from the Jest suite —
// tests exercise `gamification-scheduled.ts`'s package-free sweep functions directly), and is
// registered on the single Vercel-native Inngest serve endpoint (`src/app/api/inngest/route.ts`).
//
// Three real, scheduled, production-wired triggers (REACHABILITY MANDATE):
//   1. Momentum reconciliation — DAILY (06:00 UTC): the four "latest"-mode criteria + streak recompute.
//   2. Milestone sweep — EVERY 5 MINUTES: the §12.9-3 "detection within 5 minutes" backstop.
//   3. Notification sweep — HOURLY: Morning/Midday/Evening + inactivity nudges, each rep's own local
//      hour, fully idempotent per day via `NotificationLog`'s unique constraint.
//
// BUILD-SAFETY: `prisma` is a module-scope IMPORT (a reference only, matching the whole codebase's
// established `@/lib/prisma` singleton convention — see that file's own comment) — no client is
// constructed or any secret read until a function actually runs.

import { inngest } from '@/lib/inngest/client';
import { prisma } from '@/lib/prisma';
import { runMilestoneSweep, runMomentumReconciliationSweep, runNotificationSweep } from './gamification-scheduled';

export const MOMENTUM_RECONCILIATION_FUNCTION_ID = 'wp07-momentum-reconciliation';
export const MOMENTUM_RECONCILIATION_CRON = '0 6 * * *';

export const MILESTONE_SWEEP_FUNCTION_ID = 'wp07-milestone-sweep';
export const MILESTONE_SWEEP_CRON = '*/5 * * * *';

export const NOTIFICATION_SWEEP_FUNCTION_ID = 'wp07-notification-sweep';
export const NOTIFICATION_SWEEP_CRON = '0 * * * *';

export const momentumReconciliationFunction = inngest.createFunction(
  { id: MOMENTUM_RECONCILIATION_FUNCTION_ID, name: 'WP07 Momentum reconciliation (§12.1 daily)' },
  { cron: MOMENTUM_RECONCILIATION_CRON },
  async ({ step }) => step.run('reconcile', () => runMomentumReconciliationSweep(prisma as never))
);

export const milestoneSweepFunction = inngest.createFunction(
  { id: MILESTONE_SWEEP_FUNCTION_ID, name: 'WP07 Milestone detection sweep (§12.3, 5-minute backstop)' },
  { cron: MILESTONE_SWEEP_CRON },
  async ({ step }) => step.run('sweep', () => runMilestoneSweep(prisma as never))
);

export const notificationSweepFunction = inngest.createFunction(
  { id: NOTIFICATION_SWEEP_FUNCTION_ID, name: 'WP07 Notification sweep (§12.6 hourly, per-rep local time)' },
  { cron: NOTIFICATION_SWEEP_CRON },
  async ({ step }) => step.run('notify', () => runNotificationSweep(prisma as never))
);

export const gamificationInngestFunctions = [momentumReconciliationFunction, milestoneSweepFunction, notificationSweepFunction];
