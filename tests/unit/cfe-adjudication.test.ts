// T-09 (master-spec §5.5 CFE adjudication + human loop). Proof tests for the UPLINE adjudication
// path (AC-3b), the Claude-only ADVISORY layer (AC-2 Sonnet 5 / AC-7 Opus 4.8), and the fail-closed
// TEETH (HELD/BLOCK never approvable). Each critical block names the mutation that makes it fail.
// KEY-LESS env throughout (the CI standard) so fail-safe-on-missing-key is genuine.

import { Role } from '@prisma/client';

import { ComplianceFilterEngine } from '@/services/compliance/engine';
import type { ClaudeClassifierClient } from '@/services/compliance/claude';
import type { ClassifierResult, ClassifierVerdict } from '@/types/compliance';
import type {
  AgentGenerationRequest,
  AgentGenerationResult,
  AgentModelClient,
} from '@/services/agent-runtime/claude';
import { CLAUDE_MODEL_IDS, ClaudeModelTier } from '@/services/agent-runtime/runtime-model-map';
import type { RunGate, RunGateDecision } from '@/services/agent-runtime/seams';

import {
  AdjudicationAdvisor,
  CfeAdjudicationService,
  detectEscalationTrigger,
  type CfeAdjudicationPrismaClient,
} from '@/services/compliance/adjudication';

// ── CFE doubles (mirror agent-runtime.test.ts / approval-inbox-service.test.ts) ────────────────────
class FixedConfidenceClassifierClient implements ClaudeClassifierClient {
  constructor(private confidence: number) {}
  async classify(): Promise<ClassifierVerdict> {
    return { flagged: this.confidence >= 0.5, confidence: this.confidence, rationale: 'test' };
  }
}
const clearCFE = () => new ComplianceFilterEngine({ classifierClient: new FixedConfidenceClassifierClient(0) });
const blockedCFE = () => new ComplianceFilterEngine({ classifierClient: new FixedConfidenceClassifierClient(0.99) });

// ── Scripted Claude model client (records the tier it was asked for; returns JSON) ─────────────────
class ScriptedModelClient implements AgentModelClient {
  readonly calls: AgentGenerationRequest[] = [];
  constructor(private reply: { recommended_action: string; suggested_rewrite: string }) {}
  async generate(req: AgentGenerationRequest): Promise<AgentGenerationResult> {
    this.calls.push(req);
    return {
      text: JSON.stringify(this.reply),
      modelId: CLAUDE_MODEL_IDS[req.tier],
      tier: req.tier,
      tokenInput: 50,
      tokenOutput: 30,
      batched: false,
    };
  }
}
class ThrowingModelClient implements AgentModelClient {
  calls = 0;
  async generate(): Promise<AgentGenerationResult> {
    this.calls += 1;
    throw new Error('no key — should be caught, fail-safe');
  }
}
class DenyingRunGate implements RunGate {
  check(): RunGateDecision {
    return { allowed: false, reason: 'kill_switch_platform' };
  }
}

const originalKey = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});
afterAll(() => {
  if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
});

// ── In-memory fake Prisma (real `where`/`{in}` semantics for what these services send) ─────────────
interface UserRow { id: string; upline_id: string | null; organization_id: string | null }
interface DraftRow {
  id: string; user_id: string; contact_id: string; channel: string; body: string;
  cfe_outcome: string | null; cfe_risk_score: number | null; cfe_classifier_data: unknown;
  approval_state: string; approved_by?: string | null; approved_at?: Date | null;
  decline_reason?: string | null; decline_note?: string | null;
}
interface QueueRow {
  id: string; audit_entry_id: string; status: string; upline_id: string;
  draft_id: string | null; rep_id: string | null; risk_score: number | null;
  recommended_action: string | null; suggested_rewrite: string | null;
  recommendation_model: string | null; escalation_reason: string | null;
  sla_deadline_at: Date | null; escalated_at: Date | null; escalated_to_contact_id: string | null;
  created_at: Date;
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [k, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    const v = row[k];
    if (cond && typeof cond === 'object' && 'in' in (cond as object)) {
      if (!(cond as { in: unknown[] }).in.includes(v)) return false;
    } else if (cond && typeof cond === 'object' && 'not' in (cond as object)) {
      if (v === (cond as { not: unknown }).not) return false;
    } else if (v !== cond) {
      return false;
    }
  }
  return true;
}

let idc = 0;
const nextId = (p: string) => `${p}-${++idc}`;

function makeFakePrisma(seed: { users: UserRow[]; drafts: DraftRow[]; queue?: QueueRow[]; contacts?: { id: string; first_name: string; last_name: string }[] }) {
  const users = seed.users;
  const drafts = seed.drafts;
  const queue: QueueRow[] = seed.queue ?? [];
  const contacts = seed.contacts ?? [];
  const uplineReviews: Record<string, unknown>[] = [];
  const auditEntries: Record<string, unknown>[] = [];

  const client = {
    draftMessage: {
      async findMany({ where }: { where: Record<string, unknown> }) {
        return drafts.filter((d) => matches(d as never, where));
      },
      async findFirst({ where }: { where: Record<string, unknown> }) {
        return drafts.find((d) => matches(d as never, where)) ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const row = drafts.find((d) => d.id === where.id);
        if (!row) throw new Error('draft not found');
        Object.assign(row, data);
        return { ...row };
      },
    },
    complianceReviewQueue: {
      async findMany({ where }: { where: Record<string, unknown> }) {
        return queue.filter((q) => matches(q as never, where));
      },
      async findFirst({ where }: { where: Record<string, unknown> }) {
        return queue.find((q) => matches(q as never, where)) ?? null;
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: nextId('q'), created_at: new Date(), recommended_action: null, suggested_rewrite: null, recommendation_model: null, escalation_reason: null, escalated_at: null, escalated_to_contact_id: null, ...data } as unknown as QueueRow;
        queue.push(row);
        return { ...row };
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const row = queue.find((q) => q.id === where.id);
        if (!row) throw new Error('queue row not found');
        Object.assign(row, data);
        return { ...row };
      },
    },
    complianceUplineReview: {
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: nextId('ur'), ...data };
        uplineReviews.push(row);
        return { id: row.id as string };
      },
    },
    user: {
      async findMany({ where }: { where: Record<string, unknown> }) {
        return users.filter((u) => matches(u as never, where)).map((u) => ({ id: u.id }));
      },
    },
    contact: {
      async findMany({ where }: { where: { id: { in: string[] } } }) {
        return contacts.filter((c) => where.id.in.includes(c.id));
      },
    },
    auditEntry: {
      async create({ data }: { data: Record<string, unknown> }) {
        auditEntries.push({ ...data });
        return { ...data };
      },
      async findMany({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: Record<string, unknown> }) {
        let rows = auditEntries.filter((e) => (where ? matches(e, where) : true));
        if (orderBy?.sequence) rows = rows.sort((a, b) => (a.sequence as number) - (b.sequence as number));
        return rows;
      },
      async findUnique({ where }: { where: { id: string } }) {
        return auditEntries.find((e) => e.id === where.id) ?? null;
      },
      async findFirst({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: Record<string, unknown> }) {
        let rows = auditEntries.filter((e) => (where ? matches(e, where) : true));
        if (orderBy?.sequence === 'desc') rows = rows.sort((a, b) => (b.sequence as number) - (a.sequence as number));
        return rows[0] ?? null;
      },
    },
  };
  return { client: client as unknown as CfeAdjudicationPrismaClient, drafts, queue, uplineReviews, auditEntries };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────────
// Two classifiers ≥0.4 → classifier_conflict (AC-7 Opus). Single-signal-with-pattern → Sonnet.
const CONFLICT_CLASSIFIERS: ClassifierResult[] = [
  { classifier: 'INCOME_CLAIM', confidence: 0.55, matched_patterns: ['make $5k'], details: '' },
  { classifier: 'OPPORTUNITY', confidence: 0.45, matched_patterns: ['opportunity'], details: '' },
];
const SINGLE_SIGNAL_WITH_PATTERN: ClassifierResult[] = [
  { classifier: 'INCOME_CLAIM', confidence: 0.55, matched_patterns: ['earn extra'], details: '' },
];
const NOVEL_SIGNAL: ClassifierResult[] = [
  { classifier: 'TESTIMONIAL', confidence: 0.6, matched_patterns: [], details: '' },
];

function flagDraft(id: string, userId: string, over: Partial<DraftRow> = {}): DraftRow {
  return {
    id, user_id: userId, contact_id: 'c-1', channel: 'SMS_HANDOFF', body: 'Draft body under review.',
    cfe_outcome: 'FLAG', cfe_risk_score: 42, cfe_classifier_data: SINGLE_SIGNAL_WITH_PATTERN,
    approval_state: 'PENDING', approved_by: null, approved_at: null, ...over,
  };
}

const CONTACTS = [{ id: 'c-1', first_name: 'Sam', last_name: 'Rivera' }];

describe('T-09 escalation-triggers (AC-7 pure predicate)', () => {
  it('two classifiers above the floor → classifier_conflict → Opus', () => {
    expect(detectEscalationTrigger(CONFLICT_CLASSIFIERS)).toEqual({ escalate: true, reason: 'classifier_conflict' });
  });
  it('single signal WITH matched patterns → no escalation → Sonnet', () => {
    expect(detectEscalationTrigger(SINGLE_SIGNAL_WITH_PATTERN)).toEqual({ escalate: false, reason: null });
  });
  it('single signal WITHOUT matched patterns → novel_pattern → Opus', () => {
    expect(detectEscalationTrigger(NOVEL_SIGNAL)).toEqual({ escalate: true, reason: 'novel_pattern' });
  });
});

describe('T-09 upline adjudication path (AC-3b): org-scoped, audited', () => {
  function orgSetup() {
    return makeFakePrisma({
      users: [
        { id: 'up-1', upline_id: null, organization_id: 'org-1' },
        { id: 'rep-1', upline_id: 'up-1', organization_id: 'org-1' },
        { id: 'up-2', upline_id: null, organization_id: 'org-2' },
        { id: 'rep-x', upline_id: 'up-2', organization_id: 'org-2' },
      ],
      drafts: [flagDraft('d1', 'rep-1'), flagDraft('dx', 'rep-x', { contact_id: 'c-1' })],
      contacts: CONTACTS,
    });
  }
  const upline = { id: 'up-1', role: Role.UPLINE, organizationId: 'org-1' };

  it('lists only the org-scoped downline flagged draft (never cross-org), and materializes a queue row + entry AuditEntry', async () => {
    const fake = orgSetup();
    const svc = new CfeAdjudicationService({
      prisma: fake.client,
      cfe: clearCFE(),
      advisor: new AdjudicationAdvisor({ modelClient: new ThrowingModelClient(), cfe: clearCFE() }),
    });
    const items = await svc.listUplineQueue(upline);
    expect(items.map((i) => i.draftId)).toEqual(['d1']); // dx (org-2) is NOT visible
    expect(fake.queue.length).toBe(1);
    expect(fake.queue[0].draft_id).toBe('d1');
    // §8.7.1 — an immutable "entered review" AuditEntry, linked to the draft.
    const entered = fake.auditEntries.find((e) => e.reviewer_action === 'QUEUED_FOR_UPLINE_REVIEW');
    expect(entered).toBeTruthy();
    expect(entered!.content_id).toBe('d1');
  });

  it('APPROVE flips the draft to APPROVED (approved_by = upline) and writes a ComplianceUplineReview + immutable AuditEntry', async () => {
    const fake = orgSetup();
    const svc = new CfeAdjudicationService({ prisma: fake.client, cfe: clearCFE(), advisor: new AdjudicationAdvisor({ modelClient: new ThrowingModelClient(), cfe: clearCFE() }) });
    await svc.listUplineQueue(upline);
    const res = await svc.adjudicate(upline, { draftId: 'd1', action: 'APPROVE', feedback: 'Looks fine with the disclaimer.' });
    expect(res.ok).toBe(true);
    const d1 = fake.drafts.find((d) => d.id === 'd1')!;
    expect(d1.approval_state).toBe('APPROVED');
    expect(d1.approved_by).toBe('up-1');
    // Decision row + immutable audit entry, both attributed to the upline (AC-3b audited proof).
    expect(fake.uplineReviews.some((r) => r.reviewer_id === 'up-1' && r.action === 'APPROVE')).toBe(true);
    expect(fake.auditEntries.some((e) => e.reviewer_id === 'up-1' && e.reviewer_action === 'APPROVED_BY_UPLINE')).toBe(true);
  });

  it('cross-org adjudication is 404-not-leak (a rep outside scope is indistinguishable from nonexistent)', async () => {
    const fake = orgSetup();
    const svc = new CfeAdjudicationService({ prisma: fake.client, cfe: clearCFE(), advisor: new AdjudicationAdvisor({ modelClient: new ThrowingModelClient(), cfe: clearCFE() }) });
    // Materialize both orgs' queue rows from their own uplines first.
    await svc.listUplineQueue(upline);
    await svc.listUplineQueue({ id: 'up-2', role: Role.UPLINE, organizationId: 'org-2' });
    // up-1 tries to adjudicate rep-x's (org-2) draft → not_found, not a leaky 403.
    const res = await svc.adjudicate(upline, { draftId: 'dx', action: 'APPROVE' });
    expect(res).toEqual({ ok: false, reason: 'not_found' });
    // And the cross-org draft is untouched.
    expect(fake.drafts.find((d) => d.id === 'dx')!.approval_state).toBe('PENDING');
  });

  it('REJECT declines the draft and is audited', async () => {
    const fake = orgSetup();
    const svc = new CfeAdjudicationService({ prisma: fake.client, cfe: clearCFE(), advisor: new AdjudicationAdvisor({ modelClient: new ThrowingModelClient(), cfe: clearCFE() }) });
    await svc.listUplineQueue(upline);
    const res = await svc.adjudicate(upline, { draftId: 'd1', action: 'REJECT', feedback: 'Not compliant.' });
    expect(res.ok).toBe(true);
    expect(fake.drafts.find((d) => d.id === 'd1')!.approval_state).toBe('DECLINED');
    expect(fake.auditEntries.some((e) => e.reviewer_action === 'REJECTED_BY_UPLINE')).toBe(true);
  });
});

describe('T-09 FAIL-CLOSED TEETH: HELD/BLOCK never approvable — even by an upline, with the new machinery present', () => {
  const upline = { id: 'up-1', role: Role.UPLINE, organizationId: 'org-1' };

  function heldSetup(over: Partial<DraftRow>) {
    // A manufactured queue row pointing at a HELD/BLOCK draft (listUplineQueue would never enqueue
    // one — this proves the adjudicate() guard refuses it directly, teeth against a tampered row).
    return makeFakePrisma({
      users: [{ id: 'up-1', upline_id: null, organization_id: 'org-1' }, { id: 'rep-1', upline_id: 'up-1', organization_id: 'org-1' }],
      drafts: [flagDraft('d1', 'rep-1', over)],
      queue: [{
        id: 'q1', audit_entry_id: 'a1', status: 'PENDING', upline_id: 'up-1', draft_id: 'd1', rep_id: 'rep-1',
        risk_score: 90, recommended_action: null, suggested_rewrite: null, recommendation_model: null,
        escalation_reason: null, sla_deadline_at: null, escalated_at: null, escalated_to_contact_id: null, created_at: new Date(),
      }],
      contacts: CONTACTS,
    });
  }

  it('a HELD draft (blocked/held verdict) is UNCONDITIONALLY refused on APPROVE', async () => {
    const fake = heldSetup({ approval_state: 'HELD', cfe_outcome: 'BLOCK', cfe_risk_score: 90 });
    const svc = new CfeAdjudicationService({ prisma: fake.client, cfe: clearCFE() });
    const res = await svc.adjudicate(upline, { queueId: 'q1', action: 'APPROVE' });
    expect(res).toMatchObject({ ok: false, reason: 'not_adjudicable' });
    expect(fake.drafts.find((d) => d.id === 'd1')!.approval_state).toBe('HELD'); // never flipped to APPROVED
  });

  it('a BLOCK cfe_outcome (even if state somehow PENDING) is refused on APPROVE', async () => {
    const fake = heldSetup({ approval_state: 'PENDING', cfe_outcome: 'BLOCK', cfe_risk_score: 90 });
    const svc = new CfeAdjudicationService({ prisma: fake.client, cfe: clearCFE() });
    const res = await svc.adjudicate(upline, { queueId: 'q1', action: 'APPROVE' });
    expect(res).toMatchObject({ ok: false, reason: 'not_adjudicable' });
    expect(fake.drafts.find((d) => d.id === 'd1')!.approval_state).not.toBe('APPROVED');
  });

  it('MODIFY re-enters the CFE (AC-4, no bypass): a still-non-compliant edit lands HELD, never APPROVED', async () => {
    const fake = heldSetup({ approval_state: 'PENDING', cfe_outcome: 'FLAG', cfe_risk_score: 42 });
    // A CFE that BLOCKS the edited body — the re-check must hold it, not clear it.
    const svc = new CfeAdjudicationService({ prisma: fake.client, cfe: blockedCFE() });
    const res = await svc.adjudicate(upline, { queueId: 'q1', action: 'MODIFY', newBody: 'You are guaranteed to earn $10,000 a month.' });
    expect(res).toMatchObject({ ok: true, approvalState: 'HELD' });
    expect(fake.drafts.find((d) => d.id === 'd1')!.approval_state).toBe('HELD');
  });
});

describe('T-09 ADVISORY layer (AC-2 Sonnet / AC-7 Opus): recommends, NEVER auto-approves', () => {
  const upline = { id: 'up-1', role: Role.UPLINE, organizationId: 'org-1' };
  const baseUsers = [{ id: 'up-1', upline_id: null, organization_id: 'org-1' }, { id: 'rep-1', upline_id: 'up-1', organization_id: 'org-1' }];

  it('Sonnet 5 produces a recommended action + a CFE-CLEARED rewrite; the draft stays PENDING (NOT auto-approved)', async () => {
    const fake = makeFakePrisma({ users: baseUsers, drafts: [flagDraft('d1', 'rep-1')], contacts: CONTACTS });
    const model = new ScriptedModelClient({ recommended_action: 'Add the income safe-harbor disclaimer, then approve.', suggested_rewrite: 'Happy to share what has worked for me — no promises, results vary.' });
    const advisor = new AdjudicationAdvisor({ modelClient: model, cfe: clearCFE() });
    const svc = new CfeAdjudicationService({ prisma: fake.client, cfe: clearCFE(), advisor });

    const items = await svc.listUplineQueue(upline);
    // ADVISORY tier for a single-signal-with-pattern flagged item is Sonnet 5 (not Opus).
    expect(model.calls[0].tier).toBe(ClaudeModelTier.SONNET_5);
    expect(items[0].recommendationModel).toBe('sonnet_5');
    expect(items[0].recommendedAction).toContain('disclaimer');
    expect(items[0].suggestedRewrite).toBeTruthy(); // cleared the CFE, so it survived
    // THE ADVISORY INVARIANT: recommending did NOT approve/clear the draft.
    expect(fake.drafts.find((d) => d.id === 'd1')!.approval_state).toBe('PENDING');
    expect(fake.drafts.find((d) => d.id === 'd1')!.approved_by ?? null).toBeNull();
  });

  it('AC-7: a classifier-conflict item escalates to Opus 4.8 (advisory, still PENDING)', async () => {
    const fake = makeFakePrisma({ users: baseUsers, drafts: [flagDraft('d1', 'rep-1', { cfe_classifier_data: CONFLICT_CLASSIFIERS })], contacts: CONTACTS });
    const model = new ScriptedModelClient({ recommended_action: 'Two risk signals — recommend decline.', suggested_rewrite: '' });
    const svc = new CfeAdjudicationService({ prisma: fake.client, cfe: clearCFE(), advisor: new AdjudicationAdvisor({ modelClient: model, cfe: clearCFE() }) });
    const items = await svc.listUplineQueue(upline);
    expect(model.calls[0].tier).toBe(ClaudeModelTier.OPUS_4_8);
    expect(items[0].recommendationModel).toBe('opus_4_8');
    expect(items[0].escalationReason).toBe('classifier_conflict');
    expect(fake.drafts.find((d) => d.id === 'd1')!.approval_state).toBe('PENDING'); // never auto-approved
  });

  it('THE REWRITE IS CONTENT: a suggested rewrite that does NOT clear the CFE is dropped (never surfaced)', async () => {
    const fake = makeFakePrisma({ users: baseUsers, drafts: [flagDraft('d1', 'rep-1')], contacts: CONTACTS });
    const model = new ScriptedModelClient({ recommended_action: 'See rewrite.', suggested_rewrite: 'You will DEFINITELY get rich, guaranteed income!' });
    // The advisor CFE-gates the rewrite with a BLOCKED engine → the rewrite must be dropped.
    const svc = new CfeAdjudicationService({ prisma: fake.client, cfe: clearCFE(), advisor: new AdjudicationAdvisor({ modelClient: model, cfe: blockedCFE() }) });
    const items = await svc.listUplineQueue(upline);
    expect(items[0].recommendedAction).toBe('See rewrite.');
    expect(items[0].suggestedRewrite).toBeNull(); // dropped — did not itself clear the CFE
  });

  it('FAIL-SAFE on missing key: the recommendation is simply ABSENT — never an auto-clear, never off-Claude', async () => {
    const fake = makeFakePrisma({ users: baseUsers, drafts: [flagDraft('d1', 'rep-1')], contacts: CONTACTS });
    // No advisor injected → the default AnthropicRuntimeClient, keyless → MissingClaudeCredentialError.
    const svc = new CfeAdjudicationService({ prisma: fake.client, cfe: clearCFE() });
    const items = await svc.listUplineQueue(upline);
    expect(items[0].recommendedAction).toBeNull();
    expect(items[0].suggestedRewrite).toBeNull();
    // The item is still in the queue, still fail-closed PENDING — nothing was auto-cleared.
    expect(items[0].status).toBe('PENDING');
    expect(fake.drafts.find((d) => d.id === 'd1')!.approval_state).toBe('PENDING');
  });

  it('cost kill-switch respected: a RunGate denial skips the Claude call → recommendation absent (no auto-clear)', async () => {
    const fake = makeFakePrisma({ users: baseUsers, drafts: [flagDraft('d1', 'rep-1')], contacts: CONTACTS });
    const model = new ScriptedModelClient({ recommended_action: 'should never be reached', suggested_rewrite: '' });
    const advisor = new AdjudicationAdvisor({ modelClient: model, cfe: clearCFE(), runGate: new DenyingRunGate() });
    const svc = new CfeAdjudicationService({ prisma: fake.client, cfe: clearCFE(), advisor });
    const items = await svc.listUplineQueue(upline);
    expect(model.calls.length).toBe(0); // the kill-switch denial meant NO Claude spend
    expect(items[0].recommendedAction).toBeNull();
    expect(fake.drafts.find((d) => d.id === 'd1')!.approval_state).toBe('PENDING');
  });
});
