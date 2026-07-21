// WP04 (T-30) — the Inngest serve endpoint (D-4, Vercel-native). Inngest calls this signed webhook
// to invoke the registered agent functions. This is machine-to-machine (verified by Inngest's own
// signing key, read by NAME at request time, §0.4) — it is NOT a session-authenticated user route
// and correctly reads no `x-user-*` identity header, so scripts/verify-api-auth.mjs does not flag it.
//
// T-R14 (LAUNCH-GATE, §4 "24/7 / while you slept"): `agentRuntimeFunctions` now also carries
// `scheduledAgentDispatchFunction` (inngest-functions.ts), the CRON-triggered autonomous-dispatch
// pass. VERCEL-NATIVE MECHANISM CHOSEN: Inngest's own `{ cron: ... }` function trigger, NOT a
// `vercel.json` Vercel Cron entry — Inngest's sync step (this endpoint's GET, hit once at
// deploy/register time) reads every registered function's trigger config, including `cron`, and
// Inngest's own scheduler is what calls this same signed POST endpoint when the schedule is due. A
// `vercel.json` Cron would need its own separate route to fire the same event and would double-
// schedule the exact same work through two independent clocks — deliberately not added. This route
// (a plain Vercel serverless function at a stable, signed URL) is already the Vercel-native surface;
// nothing else needs to run on Vercel's own Cron infrastructure.

import { serve } from 'inngest/next';

import { inngest } from '@/lib/inngest/client';
import { agentRuntimeFunctions } from '@/services/agent-runtime/inngest-functions';
// T-40R (WP05 GATE remediation): the messaging-lane cron functions — the outreach-sequence cadence
// tick (§10.2) and the three-way-handoff return sweep (§10.9-8). Registered here so Inngest's sync
// step reads their `cron` triggers at deploy/register time and its own scheduler fires this same
// signed endpoint when each is due (the exact Vercel-native mechanism the agent-dispatch cron uses).
import { messagingInngestFunctions } from '@/services/messaging/inngest/messaging-inngest-functions';
// T-45 (WP09 §14.1) — the calendar dual-sync cron tick (Google read+write / CalDAV read-only).
import { teamCalendarInngestFunctions } from '@/services/team-calendar/calendar-sync-inngest';
// T-41 (WP06 §11.1/§11.4/§11.5): the weekly content-batch cron, the scheduled-publish tick, and the
// launch-kit auto-trigger sweep. Same registration convention as the two imports above — the real
// logic lives in package-free, unit-testable modules (scheduled-jobs.ts); this endpoint only needs to
// know their `cron` triggers exist so Inngest's sync step (this route's GET) picks them up.
import { socialContentInngestFunctions } from '@/services/social-content/inngest-functions';
// WP08 (§13.4): the daily taprooting milestone/stagnation sweep — same registration pattern as the
// two imports above (Inngest's sync step reads this function's `cron` trigger at deploy/register
// time; its own scheduler fires this signed endpoint when due).
import { taprootingInngestFunctions } from '@/services/taprooting/inngest/taprooting-inngest-functions';
// T-43 (WP07 §12.1/§12.3/§12.6): the gamification-lane cron functions — momentum reconciliation
// (daily), milestone detection (5-minute backstop), and the notification sweep (hourly). Same
// registration convention as the two imports above.
import { gamificationInngestFunctions } from '@/services/gamification/gamification-inngest-functions';
// T-47 (WP10 payments): the payments-lane cron functions — the sponsor-lapse cascade (§15.3), the
// sponsorship anniversary notices (§15.3), and the billing-lifecycle soft-suspension sweep (§15.4).
// Registered here so Inngest's sync step reads their `cron` triggers at deploy/register time and its
// scheduler fires this same signed endpoint when each is due (same Vercel-native mechanism as above).
import { paymentInngestFunctions } from '@/services/payment/inngest/payment-inngest-functions';
// T-09 (WP11 §5.5 AC-5): the CFE-adjudication FLAG-queue 48-hour SLA escalation cron. Registered
// here so Inngest's sync step reads its `cron` trigger at deploy/register time and its scheduler
// fires this same signed endpoint when due (same Vercel-native mechanism as every import above).
import { complianceAdjudicationInngestFunctions } from '@/services/compliance/adjudication/adjudication-inngest-functions';

// Per-request (reads the signing key at invocation, not at build) — never statically prerendered.
export const dynamic = 'force-dynamic';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    ...agentRuntimeFunctions,
    ...messagingInngestFunctions,
    ...teamCalendarInngestFunctions,
    ...socialContentInngestFunctions,
    ...taprootingInngestFunctions,
    ...gamificationInngestFunctions,
    ...paymentInngestFunctions,
    ...complianceAdjudicationInngestFunctions,
  ],
});
