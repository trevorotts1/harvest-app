// WP04 (T-30) — the agent runtime persistence boundary.
//
// State lives in Postgres; compute is stateless (§4.1). This module is the narrow, DI-mockable
// delegate the runtime writes through — the same convention the rest of the codebase uses
// (VaultPrismaClient, OnboardingGatePrismaClient, QueuePrismaClient…). Two implementations:
//   • PrismaAgentRuntimeStore  — the real path (default), lazily wrapping @/lib/prisma.
//   • InMemoryAgentRuntimeStore — dev/test, no DB and no external infra.
//
// It persists exactly the durable seams the WP04 companions consume:
//   • AgentRun     → the Activity Ledger (T-32) + the per-rep cost roll-up (T-31, §4.5).
//   • DraftMessage → the Approval Inbox (T-33) — every one carries its CFE band/outcome (§9.2).
//   • IdempotencyLog → crash-safe / retry-safe dispatch (§9.9-1) — a replayed event never
//     double-processes (no duplicate sends).

import { prisma } from '@/lib/prisma';

/** Persisted `AgentRun` status vocabulary (mirrors the schema comment on AgentRun.status). */
export type AgentRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'HELD';

/** Persisted `DraftMessage.approval_state` vocabulary. */
export type ApprovalState = 'PENDING' | 'APPROVED' | 'DECLINED' | 'HELD';

/** CFE outcome persisted on DraftMessage.cfe_outcome (matches the CFEOutcome enum). */
export type PersistedCfeOutcome = 'PASS' | 'FLAG' | 'BLOCK' | 'RECORDED';

/** Channels a DraftMessage can target (matches the MessageChannel enum). */
export type PersistedChannel = 'SMS_HANDOFF' | 'SMS_PLATFORM' | 'EMAIL' | 'SOCIAL_DM' | 'IN_APP';

export interface ContactControls {
  do_not_contact: boolean;
  agents_paused: boolean;
}

export interface CreateAgentRunInput {
  agent_key: string;
  user_id: string;
  trigger: string;
  model_used: string; // tier token: haiku_4_5 | sonnet_5 | opus_4_8
  batched: boolean;
  status: AgentRunStatus;
  input_summary?: string | null;
  reasoning_log?: string | null;
}

export interface UpdateAgentRunInput {
  status?: AgentRunStatus;
  model_used?: string;
  token_input?: number;
  token_output?: number;
  cost_cents?: number;
  output_ref?: string | null;
  reasoning_log?: string | null;
  finished_at?: Date;
}

export interface CreateDraftMessageInput {
  user_id: string;
  contact_id: string;
  channel: PersistedChannel;
  body: string;
  cfe_outcome: PersistedCfeOutcome;
  cfe_risk_score: number;
  cfe_classifier_data: unknown;
  approval_state: ApprovalState;
}

export interface AgentRuntimeStore {
  /** Per-contact controls (§9.4). Null when the contact does not exist / is not this rep's. */
  getContactControls(contactId: string, userId: string): Promise<ContactControls | null>;
  /**
   * Has this idempotency key already reached a TERMINAL outcome (§9.9-1)? A replayed/retried event
   * with a key that was already processed no-ops — no duplicate DraftMessage, no duplicate send.
   */
  wasProcessed(key: string): Promise<boolean>;
  /**
   * Mark a key processed — called ONLY at a terminal outcome (surfaced draft, or a definitive
   * hold/skip). Deliberately NOT called on a transient model failure (429/timeout/network), so those
   * genuinely retry (§4.6) rather than being wrongly deduped.
   */
  markProcessed(key: string, source: string): Promise<void>;
  createAgentRun(input: CreateAgentRunInput): Promise<string>;
  updateAgentRun(id: string, patch: UpdateAgentRunInput): Promise<void>;
  createDraftMessage(input: CreateDraftMessageInput): Promise<string>;
}

// --- Narrow Prisma delegate shapes (only what this store touches) -----------------------------

interface PrismaLike {
  contact: {
    findFirst(args: {
      where: { id: string; user_id: string };
      select: { do_not_contact: true; agents_paused: true };
    }): Promise<{ do_not_contact: boolean; agents_paused: boolean } | null>;
  };
  idempotencyLog: {
    findUnique(args: { where: { key: string }; select: { id: true } }): Promise<{ id: string } | null>;
    create(args: { data: { key: string; source: string } }): Promise<{ id: string }>;
  };
  agentRun: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  draftMessage: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
}

export class PrismaAgentRuntimeStore implements AgentRuntimeStore {
  // Lazy default: the shared singleton, never constructed at module scope here.
  constructor(private db: PrismaLike = prisma as unknown as PrismaLike) {}

  async getContactControls(contactId: string, userId: string): Promise<ContactControls | null> {
    const row = await this.db.contact.findFirst({
      where: { id: contactId, user_id: userId },
      select: { do_not_contact: true, agents_paused: true },
    });
    return row ?? null;
  }

  async wasProcessed(key: string): Promise<boolean> {
    const row = await this.db.idempotencyLog.findUnique({ where: { key }, select: { id: true } });
    return row !== null;
  }

  async markProcessed(key: string, source: string): Promise<void> {
    try {
      await this.db.idempotencyLog.create({ data: { key, source } });
    } catch (err: any) {
      // A concurrent writer already claimed it (P2002) — that is exactly the dedup we want; swallow.
      if (err?.code !== 'P2002') throw err;
    }
  }

  async createAgentRun(input: CreateAgentRunInput): Promise<string> {
    const row = await this.db.agentRun.create({
      data: {
        agent_key: input.agent_key,
        user_id: input.user_id,
        trigger: input.trigger,
        model_used: input.model_used,
        batched: input.batched,
        status: input.status,
        input_summary: input.input_summary ?? null,
        reasoning_log: input.reasoning_log ?? null,
        started_at: new Date(),
      },
    });
    return row.id;
  }

  async updateAgentRun(id: string, patch: UpdateAgentRunInput): Promise<void> {
    await this.db.agentRun.update({ where: { id }, data: { ...patch } });
  }

  async createDraftMessage(input: CreateDraftMessageInput): Promise<string> {
    const row = await this.db.draftMessage.create({
      data: {
        user_id: input.user_id,
        contact_id: input.contact_id,
        channel: input.channel,
        body: input.body,
        cfe_outcome: input.cfe_outcome,
        cfe_risk_score: input.cfe_risk_score,
        cfe_classifier_data: input.cfe_classifier_data as object,
        approval_state: input.approval_state,
      },
    });
    return row.id;
  }
}

/** Test/dev store: no DB, no infra. Records everything for assertions. */
export class InMemoryAgentRuntimeStore implements AgentRuntimeStore {
  contactControls = new Map<string, ContactControls>();
  idempotencyKeys = new Set<string>();
  agentRuns: (CreateAgentRunInput & { id: string } & Partial<UpdateAgentRunInput>)[] = [];
  draftMessages: (CreateDraftMessageInput & { id: string })[] = [];
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  async getContactControls(contactId: string): Promise<ContactControls | null> {
    return this.contactControls.get(contactId) ?? null;
  }

  async wasProcessed(key: string): Promise<boolean> {
    return this.idempotencyKeys.has(key);
  }

  async markProcessed(key: string): Promise<void> {
    this.idempotencyKeys.add(key);
  }

  async createAgentRun(input: CreateAgentRunInput): Promise<string> {
    const id = this.id('run');
    this.agentRuns.push({ ...input, id });
    return id;
  }

  async updateAgentRun(id: string, patch: UpdateAgentRunInput): Promise<void> {
    const run = this.agentRuns.find((r) => r.id === id);
    if (run) Object.assign(run, patch);
  }

  async createDraftMessage(input: CreateDraftMessageInput): Promise<string> {
    const id = this.id('draft');
    this.draftMessages.push({ ...input, id });
    return id;
  }
}
