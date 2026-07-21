// T-09 (master-spec §5.5 AC-5 48-hour SLA escalation) — the Inngest `{ cron }` wrapper for the SLA
// sweep. Imports the `inngest` package, so it is NOT reachable from the Jest test suite (tests drive
// `runSlaEscalationSweep` directly against in-memory stores). Registered in
// src/app/api/inngest/route.ts so Inngest's sync step reads the `cron` trigger at deploy/register
// time and its own scheduler fires the signed endpoint when due — the exact Vercel-native mechanism
// the agent-dispatch / messaging / gamification / payments crons already use.
//
// The handler's only job is supplying the real Prisma-backed store + audit client; ALL the real
// logic (enumeration, fail-closed escalate-or-hold, the immutable audit writes) lives in the
// package-free, directly-unit-testable `runSlaEscalationSweep` (sla-escalation.ts). Lazy
// per-invocation (never at module scope, build-safety rule): the store/audit deps are constructed
// inside the `step.run` callback, mirroring buildProductionAgentRuntimeDeps' convention.

import { inngest } from '@/lib/inngest/client';
import { prisma } from '@/lib/prisma';

import {
  PrismaSlaEscalationStore,
  runSlaEscalationSweep,
  SLA_ESCALATION_CRON,
  SLA_ESCALATION_FUNCTION_ID,
} from './sla-escalation';

export const slaEscalationFunction = inngest.createFunction(
  { id: SLA_ESCALATION_FUNCTION_ID, name: 'Compliance FLAG 48h SLA escalation (T-09, §5.5 AC-5)' },
  { cron: SLA_ESCALATION_CRON },
  async ({ step }) => {
    return step.run('sla-escalation-sweep', () =>
      runSlaEscalationSweep({
        // Lazy per-invocation, never at module scope (build-safety). The sweep is itself fail-safe
        // (an unreachable DB logs and no-ops rather than throwing); Inngest's hourly cron plus the
        // per-row `sla_deadline_at` deadline make a skipped hour harmless.
        store: new PrismaSlaEscalationStore(prisma as never),
        prismaForAudit: prisma as never,
      })
    );
  }
);

export const complianceAdjudicationInngestFunctions = [slaEscalationFunction];
