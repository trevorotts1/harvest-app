// WP04 (T-30) — the Inngest function registry + the Inngest-backed producer (the Vercel-native
// durable queue, D-4). This file imports the `inngest` package, so it is NOT reachable from the test
// suite (tests use InMemoryDurableQueue / dispatchAgentJob directly). The serve route
// (src/app/api/inngest/route.ts) registers `agentRuntimeFunctions` on Vercel.
//
// Durability/retries: the function is registered with `retries` (Inngest re-runs on transient
// failure, §4.6). CORRECTED (T-31 QC ride-along fix): the whole job runs inside a SINGLE
// `step.run('run-agent', ...)` call — there is only one step, not several — so a crash/retry
// re-executes `dispatchAgentJob` from the top, it does NOT "resume from the last completed step"
// (there is no per-step decomposition to resume from). What actually makes a retry safe is
// `AgentRuntime`'s own idempotency: the run-level `idempotencyKey` check (§9.9-1) plus the
// persisted `AgentRun`/`IdempotencyLog` state, so a replayed event still never double-sends even
// though the retry re-runs the entire handler. `step.run`'s memoization here is a (currently unused)
// safety net for Inngest's own transient re-invocations of an already-succeeded step, not a
// per-step crash-resume mechanism.
//
// T-31 (§4.5/§4.6): the real per-rep cost model, budget/kill-switch gate, and in-roster degradation
// ladder are wired in HERE — the production call site — via `buildProductionAgentRuntimeDeps`,
// built lazily per invocation (never at module scope). Without this wiring, `dispatchAgentJob` would
// fall back to `AgentRuntime`'s defaults (T-30's `AllowAllRunGate` / `EstimatingCostModel` / a bare
// `AnthropicRuntimeClient` with no degradation ladder) — the runtime core deliberately implements no
// budgets itself (seams.ts), so T-31 supplying real deps at the one production dispatch site is
// exactly the intended way to consume the seam.

import { inngest } from '@/lib/inngest/client';
import { dispatchAgentJob } from './dispatch';
import { buildProductionAgentRuntimeDeps } from './cost-killswitch';
import {
  AGENT_DISPATCH_EVENT,
  AGENT_DISPATCH_FUNCTION_ID,
  AGENT_DISPATCH_RETRIES,
  AgentDispatchEventData,
  DurableQueue,
} from './durable-queue';
import {
  runScheduledDispatch,
  SCHEDULED_AGENT_DISPATCH_CRON,
  SCHEDULED_AGENT_DISPATCH_FUNCTION_ID,
} from './scheduled-dispatch';

export const agentDispatchFunction = inngest.createFunction(
  { id: AGENT_DISPATCH_FUNCTION_ID, name: 'Agent dispatch (nine-agent runtime)', retries: AGENT_DISPATCH_RETRIES },
  { event: AGENT_DISPATCH_EVENT },
  async ({ event, step }) => {
    // Single coarse step covering the whole job (see the corrected comment above); a retry re-runs
    // this entire callback, and correctness comes from AgentRuntime's own idempotency, not from
    // Inngest per-step resumption.
    return step.run('run-agent', () => {
      const data = event.data as unknown as AgentDispatchEventData;
      // Lazy per-invocation: real cost model + kill-switch gate + degradation-ladder model client
      // (T-31, §4.5/§4.6) — never constructed at module scope (build-safety rule).
      return dispatchAgentJob(data, buildProductionAgentRuntimeDeps(data.userId));
    });
  }
);

/** The real producer: enqueue an agent job onto Inngest. Used by session-gated routes / schedulers. */
export class InngestDurableQueue implements DurableQueue {
  async send(data: AgentDispatchEventData): Promise<void> {
    await inngest.send({ name: AGENT_DISPATCH_EVENT, data: data as unknown as Record<string, unknown> });
  }
}

// T-R14 (LAUNCH-GATE, §4 "24/7 / while you slept") — THE MISSING SCHEDULED TRIGGER. Before this, the
// only ways an agent job reached the queue were the session-gated POST /api/agents/dispatch (a human
// has to be in the app) and this file's own EVENT-triggered `agentDispatchFunction` (something else
// has to fire the event) — there was no autonomous, time-based trigger, which contradicts the
// product's own "while you slept" premise. This is that trigger.
//
// Cadence: HOURLY (`0 * * * *`). Documented in full in scheduled-dispatch.ts's file doc comment —
// short version: every unit of due work carries a per-UTC-day idempotency key, so the hourly tick is
// a liveness/catch-up mechanism (and the reason a rep skipped one hour — RunGate denial, a transient
// infra hiccup — is naturally retried the next hour), not the cadence itself. The cadence a rep
// actually experiences is "at most once per UTC day per agent per target," which is what makes the
// overnight wave land "while you slept" without needing a precise midnight-exact trigger.
//
// The handler is a single `step.run` around the SAME separation `agentDispatchFunction` uses above:
// all the real logic (enumeration, the RunGate guard, the enqueue calls) lives in the package-free,
// directly-unit-testable `runScheduledDispatch` (scheduled-dispatch.ts) — this wrapper's only job is
// supplying the real `InngestDurableQueue` producer, i.e. the EXACT same durable-queue boundary the
// user-invoked dispatch route already uses. No agent-execution logic is forked or duplicated here.
export const scheduledAgentDispatchFunction = inngest.createFunction(
  { id: SCHEDULED_AGENT_DISPATCH_FUNCTION_ID, name: 'Scheduled agent dispatch (24/7 autonomous runs, T-R14)' },
  { cron: SCHEDULED_AGENT_DISPATCH_CRON },
  async ({ step }) => {
    return step.run('scheduled-dispatch', () =>
      // Lazy per-invocation, never at module scope (build-safety rule) — mirrors the
      // `buildProductionAgentRuntimeDeps` convention above. `runScheduledDispatch` is itself
      // fail-safe (an unreachable DB/infra hiccup logs and no-ops rather than throwing); Inngest's
      // own cron delivery plus the per-day idempotency key on every unit of due work is what makes a
      // skipped hour harmless.
      runScheduledDispatch({ queue: new InngestDurableQueue() })
    );
  }
);

export const agentRuntimeFunctions = [agentDispatchFunction, scheduledAgentDispatchFunction];
