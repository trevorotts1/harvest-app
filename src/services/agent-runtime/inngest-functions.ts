// WP04 (T-30) — the Inngest function registry + the Inngest-backed producer (the Vercel-native
// durable queue, D-4). This file imports the `inngest` package, so it is NOT reachable from the test
// suite (tests use InMemoryDurableQueue / dispatchAgentJob directly). The serve route
// (src/app/api/inngest/route.ts) registers `agentRuntimeFunctions` on Vercel.
//
// Durability/retries: the function is registered with `retries` (Inngest re-runs on transient
// failure, §4.6) and wraps the work in `step.run(...)` so a crash mid-run resumes from the last
// completed step rather than re-executing it. Run-level dedup is the idempotency key the handler
// (AgentRuntime) enforces — a replayed event never double-processes (no duplicate send, §9.9-1).

import { inngest } from '@/lib/inngest/client';
import { dispatchAgentJob } from './dispatch';
import {
  AGENT_DISPATCH_EVENT,
  AGENT_DISPATCH_FUNCTION_ID,
  AGENT_DISPATCH_RETRIES,
  AgentDispatchEventData,
  DurableQueue,
} from './durable-queue';

export const agentDispatchFunction = inngest.createFunction(
  { id: AGENT_DISPATCH_FUNCTION_ID, name: 'Agent dispatch (nine-agent runtime)', retries: AGENT_DISPATCH_RETRIES },
  { event: AGENT_DISPATCH_EVENT },
  async ({ event, step }) => {
    // Durable, memoized step: on retry a completed step is replayed, not re-run.
    return step.run('run-agent', () => dispatchAgentJob(event.data as unknown as AgentDispatchEventData));
  }
);

export const agentRuntimeFunctions = [agentDispatchFunction];

/** The real producer: enqueue an agent job onto Inngest. Used by session-gated routes / schedulers. */
export class InngestDurableQueue implements DurableQueue {
  async send(data: AgentDispatchEventData): Promise<void> {
    await inngest.send({ name: AGENT_DISPATCH_EVENT, data: data as unknown as Record<string, unknown> });
  }
}
