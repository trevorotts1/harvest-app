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

// Per-request (reads the signing key at invocation, not at build) — never statically prerendered.
export const dynamic = 'force-dynamic';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [...agentRuntimeFunctions, ...messagingInngestFunctions, ...teamCalendarInngestFunctions],
});
