// WP04 (T-30) — the durable-queue handler body, extracted as a plain async function so it is
// unit-testable with NO Inngest runtime and NO external infra. The Inngest function
// (inngest-functions.ts) is a thin wrapper that calls this inside `step.run(...)`; tests call it
// directly. The runtime is constructed HERE (lazily, per invocation) — never at module scope — so a
// key-less `next build` and the test suite pass with no secrets present.

import { AgentRuntime, AgentJobResult, AgentRuntimeDeps } from './agent-runtime';
import { AgentDispatchEventData } from './durable-queue';

export async function dispatchAgentJob(
  data: AgentDispatchEventData,
  deps: AgentRuntimeDeps = {}
): Promise<AgentJobResult> {
  const runtime = new AgentRuntime(deps);
  return runtime.runAgent({
    agentKey: data.agentKey,
    userId: data.userId,
    trigger: data.trigger,
    idempotencyKey: data.idempotencyKey,
    contactId: data.contactId,
    channel: data.channel,
    rep: data.rep,
    contact: data.contact,
    task: data.task,
    segmentContactId: data.segmentContactId,
  });
}
