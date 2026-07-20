// T-40R (WP05 GATE remediation) — the messaging lane's Inngest cron registrations, the analog of
// agent-runtime/inngest-functions.ts for the WP05 messaging surfaces. This file imports the `inngest`
// package, so — exactly like agent-runtime/inngest-functions.ts — it is NOT reachable from the Jest
// suite (tests exercise the package-free `runDueSequences` / `runHandoffReturnSweep` handler logic
// directly). The serve route (src/app/api/inngest/route.ts) registers `messagingInngestFunctions`
// alongside `agentRuntimeFunctions` on Vercel.
//
// Two cron functions, each a thin `step.run` wrapper around package-free handler logic (the same
// separation-of-concerns the T-R14 scheduled agent dispatch uses):
//   1. the outreach-sequence cadence tick (§10.2) — fire every due step of every ACTIVE sequence
//      through the fully-gated T-37 seam (`SequenceService.runDueSteps`);
//   2. the three-way-handoff return sweep (§10.9-8) — return every lapsed (24h no-join) handoff to
//      its rep with a coached next step (`ThreeWayHandoffService.returnIfLapsed`).
//
// BUILD-SAFETY: every store/service is constructed LAZILY, per invocation, inside the `step.run`
// callback — never at module scope (mirrors `buildProductionAgentRuntimeDeps`). A key-less build
// registers the functions (their config) without constructing a single prisma-backed service or
// reading a key. NO GATE BYPASS: the sequence tick's only send path is the seam inside
// `SequenceService`; this wrapper reaches past no gate.

import { inngest } from '@/lib/inngest/client';
import { prisma } from '@/lib/prisma';

import {
  runDueSequences,
  PrismaDueSequenceStore,
  SCHEDULED_SEQUENCE_RUN_CRON,
  SCHEDULED_SEQUENCE_RUN_FUNCTION_ID,
} from '../sequence/sequence-scheduled-run';
import { buildSequenceService, resolveOrgSendingDomain } from '../send/production-wiring';
import {
  runHandoffReturnSweep,
  PrismaLapsedHandoffStore,
  HANDOFF_RETURN_SWEEP_CRON,
  HANDOFF_RETURN_SWEEP_FUNCTION_ID,
} from '../handoff/handoff-return-sweep';
import {
  ThreeWayHandoffService,
  type ThreeWayHandoffPrismaClient,
} from '../handoff/three-way-handoff.service';

// 1) The outreach-sequence cadence tick (§10.2). Every due step dispatches THROUGH the gated seam.
export const scheduledSequenceRunFunction = inngest.createFunction(
  { id: SCHEDULED_SEQUENCE_RUN_FUNCTION_ID, name: 'Outreach sequence cadence tick (WP05 §10.2, T-40R)' },
  { cron: SCHEDULED_SEQUENCE_RUN_CRON },
  async ({ step }) =>
    step.run('sequence-run', () =>
      // Lazy per-invocation (build-safety). The store resolves each rep-org's authenticated sending
      // domain; the runner is the REAL, fully-gated SequenceService (production-wiring.ts).
      runDueSequences({
        store: new PrismaDueSequenceStore(undefined, (orgId) => resolveOrgSendingDomain(orgId)),
        runner: buildSequenceService(),
      })
    )
);

// 2) The three-way-handoff return sweep (§10.9-8). Ownership-scoped + idempotent inside the service.
export const handoffReturnSweepFunction = inngest.createFunction(
  { id: HANDOFF_RETURN_SWEEP_FUNCTION_ID, name: 'Three-way handoff return sweep (WP05 §10.9-8, T-40R)' },
  { cron: HANDOFF_RETURN_SWEEP_CRON },
  async ({ step }) =>
    step.run('handoff-return-sweep', () =>
      runHandoffReturnSweep({
        store: new PrismaLapsedHandoffStore(),
        sweeper: new ThreeWayHandoffService(prisma as unknown as ThreeWayHandoffPrismaClient),
      })
    )
);

export const messagingInngestFunctions = [scheduledSequenceRunFunction, handoffReturnSweepFunction];
