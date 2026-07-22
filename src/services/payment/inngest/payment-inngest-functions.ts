// WP10 (T-47) — the payments lane's Inngest cron registrations, the analog of
// agent-runtime/inngest-functions.ts and messaging-inngest-functions.ts. This file imports the
// `inngest` package, so — like those two — it is NOT reachable from the Jest suite (tests exercise
// the package-free cascade/anniversary/lifecycle logic directly: sponsor-cascade.ts + the
// PrismaLifecycleSweepStore). The serve route (src/app/api/inngest/route.ts) registers
// `paymentInngestFunctions` alongside the others on Vercel.
//
// THREE cron functions — the REAL callers the reachability mandate requires for the P0 cascade +
// anniversary + lifecycle logic (no dead scaffold):
//   1. sponsor-lapse cascade sweep (§15.3) — protect members of lapsed sponsors (30-day window) +
//      expire members whose protected window elapsed;
//   2. anniversary notices sweep (§15.3) — fire 60/30/7-day notices + enter ANNIVERSARY_PENDING;
//   3. billing-lifecycle sweep (§15.4) — PAST_DUE past grace → EXPIRED (soft suspension).
//
// BUILD-SAFETY (invariant #2): every store/sink is constructed LAZILY, per invocation, inside the
// `step.run` callback — never at module scope. A key-less/DB-less build registers the functions
// (their cron config) without constructing a Prisma client.
//
// VERCEL-NATIVE MECHANISM: Inngest's own `{ cron: ... }` trigger (same as the agent-dispatch +
// messaging crons) — Inngest's sync step reads these triggers at deploy/register time and its
// scheduler calls the signed serve endpoint when each is due. No separate vercel.json Cron entry.

import { inngest } from '@/lib/inngest/client';

import { prisma } from '@/lib/prisma';
import { projectToWP10 } from '@/services/onboarding/wp01/downstream-contracts';
import type { OnboardingEventSink } from '@/services/onboarding/wp01/downstream-contracts';
import type { OnboardingCompletedEvent } from '@/types/onboarding';

import {
  expireElapsedMemberGrace,
  runAnniversaryNotices,
  runSponsorLapseCascade,
} from '../sponsor-cascade';
import { provisionFromContract, type ProvisioningPrismaClient } from '../provisioning';
import {
  PrismaLifecycleSweepStore,
  PrismaSponsorCascadeStore,
  buildProductionNotificationSink,
} from '../production-wiring';
import { PAYMENT_GRACE_DAYS } from '../entitlement';

export const ONBOARDING_COMPLETED_EVENT = 'user.onboarding_completed';
export const PROVISION_ON_ONBOARDING_FUNCTION_ID = 'wp10-provision-on-onboarding';

export const SPONSOR_LAPSE_CASCADE_CRON = '0 8 * * *'; // daily 08:00 UTC
export const ANNIVERSARY_NOTICE_CRON = '0 9 * * *'; // daily 09:00 UTC
export const BILLING_LIFECYCLE_SWEEP_CRON = '0 7 * * *'; // daily 07:00 UTC

export const SPONSOR_LAPSE_CASCADE_FUNCTION_ID = 'wp10-sponsor-lapse-cascade';
export const ANNIVERSARY_NOTICE_FUNCTION_ID = 'wp10-anniversary-notices';
export const BILLING_LIFECYCLE_SWEEP_FUNCTION_ID = 'wp10-billing-lifecycle-sweep';

// 0) PROVISION ON ONBOARDING (§15.2 / §6.7). The real caller that consumes the §6.7 AccessTier
// provisioning contract: it derives the `WP10PaymentContract` from the `user.onboarding_completed`
// event via `projectToWP10` (the single source of truth — downstream-contracts.ts) and provisions
// from it. `provisionFromContract` independently enforces the "only after onboarding_completed"
// precondition (reads the live onboarding_status), so provisioning can never run early even if the
// event fires out of order.
export const provisionOnOnboardingCompletedFunction = inngest.createFunction(
  { id: PROVISION_ON_ONBOARDING_FUNCTION_ID, name: 'Provision from access tier (WP10 §15.2/§6.7, T-47)' },
  { event: ONBOARDING_COMPLETED_EVENT },
  async ({ event, step }) =>
    step.run('provision-from-access-tier', () => {
      const contract = projectToWP10(event.data as unknown as OnboardingCompletedEvent);
      return provisionFromContract(prisma as unknown as ProvisioningPrismaClient, contract);
    })
);

// T-R35 (P1 fix) — THE REAL PRODUCTION PUBLISHER. Before this, nothing in the live app ever called
// `inngest.send` for `user.onboarding_completed`: `emitOnboardingCompleted` / the
// `OnboardingEventSink` interface (downstream-contracts.ts) only ever had the test-only
// `InMemoryOnboardingEventSink` as an implementation, so `provisionOnOnboardingCompletedFunction`
// above — correctly built and correctly registered at the /api/inngest serve route — was never
// actually triggered by anything. This is the missing production implementation of that same
// `OnboardingEventSink` interface, mirroring the EXACT `inngest.send({ name, data })` shape
// `InngestDurableQueue.send` uses for `AGENT_DISPATCH_EVENT` (agent-runtime/inngest-functions.ts) —
// the one other real producer in this codebase. Constructed lazily, per-request, by the onboarding
// completion route (`src/app/api/onboarding/complete/route.ts`) via a dynamic `import()` — never at
// module scope — the same build-safety / Jest-safety convention `POST /api/agents/dispatch` already
// uses for `InngestDurableQueue` (this file, like that one, imports the ESM-only `inngest` package,
// so it cannot be loaded under Jest's CJS runtime; a dynamic, request-time import keeps the route
// module itself Jest-loadable, and tests mock this module's export the same way
// tests/unit/agent-dispatch-route.test.ts mocks `InngestDurableQueue`).
export class InngestOnboardingEventSink implements OnboardingEventSink {
  async publish(event: OnboardingCompletedEvent): Promise<void> {
    await inngest.send({ name: event.event, data: event as unknown as Record<string, unknown> });
  }
}

// 1) Sponsor-lapse cascade (§15.3) — protect + expiry, in one daily pass.
export const sponsorLapseCascadeFunction = inngest.createFunction(
  { id: SPONSOR_LAPSE_CASCADE_FUNCTION_ID, name: 'Sponsor-lapse cascade (WP10 §15.3, T-47)' },
  { cron: SPONSOR_LAPSE_CASCADE_CRON },
  async ({ step }) =>
    step.run('sponsor-lapse-cascade', async () => {
      const store = new PrismaSponsorCascadeStore();
      const sink = buildProductionNotificationSink();
      const protectedResult = await runSponsorLapseCascade(store, sink);
      const expiredResult = await expireElapsedMemberGrace(store, sink);
      return { ...protectedResult, ...expiredResult };
    })
);

// 2) Anniversary notices (§15.3) — 60/30/7-day advance notices to both parties.
export const anniversaryNoticeFunction = inngest.createFunction(
  { id: ANNIVERSARY_NOTICE_FUNCTION_ID, name: 'Sponsorship anniversary notices (WP10 §15.3, T-47)' },
  { cron: ANNIVERSARY_NOTICE_CRON },
  async ({ step }) =>
    step.run('anniversary-notices', async () => {
      const store = new PrismaSponsorCascadeStore();
      const sink = buildProductionNotificationSink();
      return runAnniversaryNotices(store, sink);
    })
);

// 3) Billing-lifecycle sweep (§15.4) — PAST_DUE past grace → EXPIRED (soft suspension).
export const billingLifecycleSweepFunction = inngest.createFunction(
  { id: BILLING_LIFECYCLE_SWEEP_FUNCTION_ID, name: 'Billing lifecycle sweep (WP10 §15.4, T-47)' },
  { cron: BILLING_LIFECYCLE_SWEEP_CRON },
  async ({ step }) =>
    step.run('billing-lifecycle-sweep', async () => {
      const store = new PrismaLifecycleSweepStore(undefined, PAYMENT_GRACE_DAYS);
      return store.expireElapsedGrace();
    })
);

export const paymentInngestFunctions = [
  provisionOnOnboardingCompletedFunction,
  sponsorLapseCascadeFunction,
  anniversaryNoticeFunction,
  billingLifecycleSweepFunction,
];
