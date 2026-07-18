// T-31 (master-spec §4.6, QC checkpoint #14 "honest degradation") — decorates T-30's
// `AgentRuntimeStore` (an already-injectable seam, `AgentRuntimeDeps.store`) to append an explicit,
// plain-language degradation note to `AgentRun.reasoning_log` — the same Activity Ledger surface
// the rep already reads (§4.1 #5) — whenever the paired `DegradingModelClient` degraded a call
// during this run. This is additive-only: it never changes what the real store persists beyond
// appending to the one text field that already exists for exactly this purpose (plain-language,
// rep-visible reasoning), and it never touches `DraftMessage.body` (the actual outbound content).
//
// Honest, not alarming: the note tells the rep capability was reduced and nothing was lost — it
// never fabricates a reason, and it is never silent (the whole point of checkpoint #14).

import type { AgentRuntimeStore, ContactControls, CreateAgentRunInput, CreateDraftMessageInput, UpdateAgentRunInput } from '../store';
import type { DegradingModelClient } from './degradation';

export const HONEST_DEGRADATION_NOTE =
  ' Note: your agents ran on a lighter Claude model just now because of high demand — draft quality ' +
  'may be a touch simpler than usual. Nothing was lost or sent without your OK.';

/**
 * Wraps a real `AgentRuntimeStore` so the SINGLE terminal `updateAgentRun` call `AgentRuntime` makes
 * after a run's generation step (agent-runtime.ts, unmodified) gets an honest degradation note
 * appended to `reasoning_log` when the paired model client degraded this run. Pair one instance of
 * this with exactly one `DegradingModelClient`, both constructed fresh per dispatch invocation.
 */
export class DegradationAnnotatingStore implements AgentRuntimeStore {
  constructor(
    private readonly inner: AgentRuntimeStore,
    private readonly modelClient: DegradingModelClient
  ) {}

  getContactControls(contactId: string, userId: string): Promise<ContactControls | null> {
    return this.inner.getContactControls(contactId, userId);
  }

  wasProcessed(key: string): Promise<boolean> {
    return this.inner.wasProcessed(key);
  }

  markProcessed(key: string, source: string): Promise<void> {
    return this.inner.markProcessed(key, source);
  }

  createAgentRun(input: CreateAgentRunInput): Promise<string> {
    return this.inner.createAgentRun(input);
  }

  createDraftMessage(input: CreateDraftMessageInput): Promise<string> {
    return this.inner.createDraftMessage(input);
  }

  async updateAgentRun(id: string, patch: UpdateAgentRunInput): Promise<void> {
    const event = this.modelClient.consumeDegradation();
    if (event && typeof patch.reasoning_log === 'string') {
      patch = { ...patch, reasoning_log: patch.reasoning_log + HONEST_DEGRADATION_NOTE };
    }
    return this.inner.updateAgentRun(id, patch);
  }
}
