// WP04 (T-30) — the DURABLE QUEUE abstraction (D-4: Inngest, Vercel-native).
//
// This file is deliberately FREE of the `inngest` npm package so it (and everything that reaches it)
// is unit-testable under Jest with no ESM-transform issues and no live queue server. The real
// Inngest wiring lives in inngest-functions.ts + src/lib/inngest/client.ts + the serve route, which
// import THESE constants/types. The DEV/test path uses `InMemoryDurableQueue`.
//
// Durability & retries come from Inngest at deploy time (the function is registered with retries and
// its handler is idempotent via the run-level idempotency key — see AgentRuntime). Here we only
// define the event contract and the mockable producer boundary.

import { AgentJobResult, AgentRuntimeDeps } from './agent-runtime';
import { dispatchAgentJob } from './dispatch';
import { AgentKey } from './runtime-model-map';
import { ContactContext, RepContext } from './prompt-assembly';
import { PersistedChannel } from './store';

/** The single event that triggers an agent run. One event → one durable, retriable agent job. */
export const AGENT_DISPATCH_EVENT = 'agent/dispatch.requested' as const;

/** Inngest function config, defined here (package-free) so tests can assert it without importing inngest. */
export const AGENT_DISPATCH_FUNCTION_ID = 'agent-dispatch' as const;
/** ≥1 → the function is retriable/durable; Inngest re-runs on transient failure (§4.6). */
export const AGENT_DISPATCH_RETRIES = 4 as const;

export interface AgentDispatchEventData {
  agentKey: AgentKey;
  userId: string;
  trigger: string;
  /** Run-level dedup key (§9.9-1) — a replayed/retried event with the same key no-ops. */
  idempotencyKey: string;
  contactId?: string;
  channel?: PersistedChannel;
  task?: string;
  rep?: RepContext;
  contact?: ContactContext;
  segmentContactId?: string;
}

/** The mockable producer boundary. Routes/services `send(...)`; they never touch Inngest directly. */
export interface DurableQueue {
  send(data: AgentDispatchEventData): Promise<void>;
}

/**
 * Dev/test queue: records events; `drain(deps)` runs each through the same handler Inngest would
 * (dispatchAgentJob), so an end-to-end flow is exercisable with no live infra.
 */
export class InMemoryDurableQueue implements DurableQueue {
  readonly sent: AgentDispatchEventData[] = [];

  async send(data: AgentDispatchEventData): Promise<void> {
    this.sent.push(data);
  }

  async drain(deps: AgentRuntimeDeps = {}): Promise<AgentJobResult[]> {
    const results: AgentJobResult[] = [];
    for (const data of this.sent) {
      results.push(await dispatchAgentJob(data, deps));
    }
    return results;
  }
}
