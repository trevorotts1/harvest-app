// T-33 — service-level proofs for `ApprovalInboxService` (master-spec §9.2; uiux §5.6). Real
// `ComplianceFilterEngine` instances (injected classifier clients, exactly like
// tests/unit/agent-runtime.test.ts's own `clearCFE`/`blockedCFE`/`flaggedCFE` doubles) are used for
// the edit-re-enters-CFE proofs, so these are REAL end-to-end CFE calls, not a mocked
// `evaluateContent`. Each critical test states the mutation that makes it fail.

import type { ClaudeClassifierClient, ClassifierRequest } from '@/services/compliance/claude';
import { ComplianceFilterEngine } from '@/services/compliance/engine';
import type { ClassifierVerdict } from '@/types/compliance';
import { Role } from '@prisma/client';

import {
  ApprovalInboxService,
  type ApprovalInboxPrismaClient,
  type ContactNameRow,
  type DraftMessageRow,
} from '../../src/services/approval-inbox/approval-inbox.service';

// ── CFE test doubles (mirrors agent-runtime.test.ts) ──────────────────────────────────────────────
class FixedConfidenceClassifierClient implements ClaudeClassifierClient {
  constructor(private confidence: number) {}
  async classify(): Promise<ClassifierVerdict> {
    return { flagged: this.confidence >= 0.5, confidence: this.confidence, rationale: 'test' };
  }
}
class SingleClassifierClient implements ClaudeClassifierClient {
  constructor(private target: string, private confidence: number) {}
  async classify(req: ClassifierRequest): Promise<ClassifierVerdict> {
    const c = req.classifier === this.target ? this.confidence : 0;
    return { flagged: c >= 0.5, confidence: c, rationale: 'test' };
  }
}
// Exported (T-54) — see `createFakeApprovalInboxPrisma`'s own export note just below.
export const clearCFE = () => new ComplianceFilterEngine({ classifierClient: new FixedConfidenceClassifierClient(0) });
export const blockedCFE = () => new ComplianceFilterEngine({ classifierClient: new FixedConfidenceClassifierClient(0.99) });
const flaggedCFE = () => new ComplianceFilterEngine({ classifierClient: new SingleClassifierClient('INCOME_CLAIM', 0.5) });

// Every test in this suite is KEY-LESS regardless of ambient shell (deterministic fail-closed proof).
const originalKey = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});
afterAll(() => {
  if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
});

// ── Fake Prisma (in-memory, real Prisma `where` semantics for what this service actually sends) ───
// Exported (T-54) so tests/unit/offline-inbox.test.ts can drive the REAL ApprovalInboxService
// through the offline-queue replay handlers against the same in-memory double, rather than
// reimplementing a second fake Prisma — same "import the existing test helper" convention
// tests/unit/warm-market-offline.test.ts already uses for `createFakeMethodPrisma`.
export function createFakeApprovalInboxPrisma(
  drafts: DraftMessageRow[],
  contacts: ContactNameRow[] = []
): { client: ApprovalInboxPrismaClient; updateCalls: { where: { id: string }; data: Record<string, unknown> }[] } {
  const updateCalls: { where: { id: string }; data: Record<string, unknown> }[] = [];
  const client: ApprovalInboxPrismaClient = {
    draftMessage: {
      async findMany({ where }) {
        return drafts.filter((d) => {
          if (d.user_id !== where.user_id) return false;
          if (where.approval_state === undefined) return true;
          if (typeof where.approval_state === 'string') return d.approval_state === where.approval_state;
          return where.approval_state.in.includes(d.approval_state);
        });
      },
      async findFirst({ where }) {
        return drafts.find((d) => d.id === where.id && d.user_id === where.user_id) ?? null;
      },
      async update({ where, data }) {
        updateCalls.push({ where, data });
        const row = drafts.find((d) => d.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return { ...row };
      },
    },
    contact: {
      async findMany({ where }) {
        return contacts.filter((c) => where.id.in.includes(c.id));
      },
    },
  };
  return { client, updateCalls };
}

export function draft(overrides: Partial<DraftMessageRow> = {}): DraftMessageRow {
  return {
    id: 'd-1',
    user_id: 'u-1',
    contact_id: 'c-1',
    channel: 'SMS_HANDOFF',
    body: 'Hi Jordan — would you be open to a warm chat this week?',
    cfe_outcome: 'PASS',
    cfe_risk_score: 3,
    cfe_classifier_data: [],
    approval_state: 'PENDING',
    approved_by: null,
    approved_at: null,
    edited_after_approval: false,
    decline_reason: null,
    decline_note: null,
    created_at: new Date('2026-07-18T08:00:00Z'),
    updated_at: new Date('2026-07-18T08:00:00Z'),
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// (a) listInbox — PENDING drafts (+ HELD) with CFE band/risk, ownership-scoped
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('ApprovalInboxService.listInbox — §9.2 the inbox surface', () => {
  test('default view returns PENDING + HELD, never APPROVED/DECLINED', async () => {
    const rows = [
      draft({ id: 'd-1', approval_state: 'PENDING' }),
      draft({ id: 'd-2', approval_state: 'HELD' }),
      draft({ id: 'd-3', approval_state: 'APPROVED' }),
      draft({ id: 'd-4', approval_state: 'DECLINED' }),
    ];
    const { client } = createFakeApprovalInboxPrisma(rows, [{ id: 'c-1', first_name: 'Jordan', last_name: 'Vega' }]);
    const service = new ApprovalInboxService(client, clearCFE());

    const items = await service.listInbox('u-1');
    expect(items.map((i) => i.id).sort()).toEqual(['d-1', 'd-2']);
  });

  test('each item carries its CFE band (outcome)/risk score and the draft content', async () => {
    const rows = [draft({ id: 'd-1', cfe_outcome: 'FLAG', cfe_risk_score: 42, body: 'draft text here' })];
    const { client } = createFakeApprovalInboxPrisma(rows, [{ id: 'c-1', first_name: 'Jordan', last_name: 'Vega' }]);
    const service = new ApprovalInboxService(client, clearCFE());

    const items = await service.listInbox('u-1');
    expect(items[0]).toMatchObject({ cfe_outcome: 'FLAG', cfe_risk_score: 42, body: 'draft text here' });
    expect(items[0].contact).toEqual({ firstName: 'Jordan', lastName: 'Vega' });
  });

  test('an explicit state filter narrows to exactly that state', async () => {
    const rows = [
      draft({ id: 'd-1', approval_state: 'PENDING' }),
      draft({ id: 'd-2', approval_state: 'HELD' }),
    ];
    const { client } = createFakeApprovalInboxPrisma(rows);
    const service = new ApprovalInboxService(client, clearCFE());

    const items = await service.listInbox('u-1', { state: 'HELD' });
    expect(items.map((i) => i.id)).toEqual(['d-2']);
  });

  test('ownership: never returns another rep\'s drafts', async () => {
    const rows = [draft({ id: 'd-1', user_id: 'someone-else' })];
    const { client } = createFakeApprovalInboxPrisma(rows);
    const service = new ApprovalInboxService(client, clearCFE());

    const items = await service.listInbox('u-1');
    expect(items).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// (b) approveDraft — exactly one id, per-item, held/blocked never approvable
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('ApprovalInboxService.approveDraft — one item at a time, PENDING only', () => {
  test('approves a PENDING draft — sets APPROVED + approved_by/approved_at', async () => {
    const rows = [draft({ id: 'd-1', approval_state: 'PENDING' })];
    const { client, updateCalls } = createFakeApprovalInboxPrisma(rows);
    const service = new ApprovalInboxService(client, clearCFE());

    const result = await service.approveDraft('u-1', 'd-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.approval_state).toBe('APPROVED');
      expect(result.draft.approved_by).toBe('u-1');
      expect(result.draft.approved_at).toBeInstanceOf(Date);
    }
    expect(updateCalls).toHaveLength(1);
  });

  // TEETH: this is AC-5.6-4 ("blocked items expose only rewrite/discard ... cannot be approved by
  // any UI path") — fails if the server-side approvability check is removed/weakened.
  test('TEETH: a HELD draft cannot be approved — held/blocked items are never approvable', async () => {
    const rows = [draft({ id: 'd-1', approval_state: 'HELD', cfe_outcome: 'BLOCK', cfe_risk_score: 95 })];
    const { client, updateCalls } = createFakeApprovalInboxPrisma(rows);
    const service = new ApprovalInboxService(client, clearCFE());

    const result = await service.approveDraft('u-1', 'd-1');
    expect(result).toEqual({ ok: false, reason: 'not_approvable', currentState: 'HELD' });
    expect(updateCalls).toHaveLength(0);
  });

  test('an already-APPROVED draft cannot be re-approved (idempotent terminal state)', async () => {
    const rows = [draft({ id: 'd-1', approval_state: 'APPROVED', approved_by: 'u-1', approved_at: new Date() })];
    const { client, updateCalls } = createFakeApprovalInboxPrisma(rows);
    const service = new ApprovalInboxService(client, clearCFE());

    const result = await service.approveDraft('u-1', 'd-1');
    expect(result).toEqual({ ok: false, reason: 'not_approvable', currentState: 'APPROVED' });
    expect(updateCalls).toHaveLength(0);
  });

  test('ownership: approving a draft owned by a different rep -> not_found, no write', async () => {
    const rows = [draft({ id: 'd-1', user_id: 'someone-else', approval_state: 'PENDING' })];
    const { client, updateCalls } = createFakeApprovalInboxPrisma(rows);
    const service = new ApprovalInboxService(client, clearCFE());

    const result = await service.approveDraft('u-1', 'd-1');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(updateCalls).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// (c) declineDraft — reason selector always intercepts
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('ApprovalInboxService.declineDraft', () => {
  test('declines a PENDING draft with a valid reason + optional note', async () => {
    const rows = [draft({ id: 'd-1', approval_state: 'PENDING' })];
    const { client } = createFakeApprovalInboxPrisma(rows);
    const service = new ApprovalInboxService(client, clearCFE());

    const result = await service.declineDraft('u-1', 'd-1', 'wrong_time', 'later this week is better');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.approval_state).toBe('DECLINED');
      expect(result.draft.decline_reason).toBe('wrong_time');
      expect(result.draft.decline_note).toBe('later this week is better');
    }
  });

  test('a HELD draft may also be declined/discarded (uiux: blocked items expose rewrite/discard)', async () => {
    const rows = [draft({ id: 'd-1', approval_state: 'HELD' })];
    const { client } = createFakeApprovalInboxPrisma(rows);
    const service = new ApprovalInboxService(client, clearCFE());

    const result = await service.declineDraft('u-1', 'd-1', 'other');
    expect(result.ok).toBe(true);
  });

  test('TEETH: an invalid reason is rejected — the reason selector always intercepts (AC-5.6-9)', async () => {
    const rows = [draft({ id: 'd-1', approval_state: 'PENDING' })];
    const { client, updateCalls } = createFakeApprovalInboxPrisma(rows);
    const service = new ApprovalInboxService(client, clearCFE());

    const result = await service.declineDraft('u-1', 'd-1', 'because I feel like it');
    expect(result).toEqual({ ok: false, reason: 'invalid_reason' });
    expect(updateCalls).toHaveLength(0);
  });

  test('an already-DECLINED/APPROVED draft cannot be declined again', async () => {
    const rows = [draft({ id: 'd-1', approval_state: 'APPROVED' })];
    const { client, updateCalls } = createFakeApprovalInboxPrisma(rows);
    const service = new ApprovalInboxService(client, clearCFE());

    const result = await service.declineDraft('u-1', 'd-1', 'other');
    expect(result).toEqual({ ok: false, reason: 'not_declinable', currentState: 'APPROVED' });
    expect(updateCalls).toHaveLength(0);
  });

  test('ownership: declining another rep\'s draft -> not_found, no write', async () => {
    const rows = [draft({ id: 'd-1', user_id: 'someone-else' })];
    const { client, updateCalls } = createFakeApprovalInboxPrisma(rows);
    const service = new ApprovalInboxService(client, clearCFE());

    const result = await service.declineDraft('u-1', 'd-1', 'other');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(updateCalls).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// (d) editDraft — THE HARD RULE: edit re-enters the CFE before approve/send is possible
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('ApprovalInboxService.editDraft — edit ALWAYS re-enters the CFE (§9.2/§9.9-2)', () => {
  test('editing with a CLEAN new body re-runs the CFE and stays PENDING with the fresh band', async () => {
    const rows = [draft({ id: 'd-1', approval_state: 'PENDING', cfe_outcome: 'PASS', cfe_risk_score: 3 })];
    const { client } = createFakeApprovalInboxPrisma(rows);
    const cfe = clearCFE();
    const spy = jest.spyOn(cfe, 'evaluateContent');
    const service = new ApprovalInboxService(client, cfe);

    const result = await service.editDraft('u-1', 'd-1', 'a brand new clean message', Role.REP);
    expect(result.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1); // the re-entry call actually happened
    if (result.ok) {
      expect(result.draft.body).toBe('a brand new clean message');
      expect(result.draft.approval_state).toBe('PENDING');
      expect(result.verdict.band).toBe('clear');
    }
  });

  // ══ THE CORE PROOF ══ — TEETH + MUTATION-PROOF: an edit that makes the content NOW-BLOCKED must
  // HOLD, not be approvable. This test FAILS if `editDraft`'s call to `this.cfe.evaluateContent` is
  // ever removed/skipped/mocked-away in a refactor: without the real re-evaluation, this fake
  // Prisma has NOTHING that would ever flip `approval_state` to 'HELD' on its own — the state
  // literally cannot reach 'HELD' unless the CFE was actually re-run against the NEW text and
  // returned a blocked verdict.
  test('MUTATION-PROOF: editing to now-blocked content HOLDS the draft — not approvable, band replaces old', async () => {
    const rows = [
      draft({ id: 'd-1', approval_state: 'PENDING', cfe_outcome: 'PASS', cfe_risk_score: 3, body: 'clean original text' }),
    ];
    const { client, updateCalls } = createFakeApprovalInboxPrisma(rows);
    const cfe = blockedCFE();
    const spy = jest.spyOn(cfe, 'evaluateContent');
    const service = new ApprovalInboxService(client, cfe);

    const result = await service.editDraft('u-1', 'd-1', 'guaranteed 10k a month, no risk', Role.REP);

    expect(spy).toHaveBeenCalledTimes(1); // re-entry actually happened — not skipped
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The band that reaches the caller is the NEW (blocked) one, never the stale PASS/3.
      expect(result.verdict.band).toBe('blocked');
      expect(result.draft.approval_state).toBe('HELD');
      expect(result.draft.cfe_outcome).toBe('BLOCK');
      expect(result.draft.body).toBe('guaranteed 10k a month, no risk');
    }

    // The HELD draft can now no longer be approved — proves the two rules compose end-to-end.
    const approveAttempt = await service.approveDraft('u-1', 'd-1');
    expect(approveAttempt).toEqual({ ok: false, reason: 'not_approvable', currentState: 'HELD' });

    // Persisted exactly once, and the persisted state really is HELD (not silently PENDING).
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].data.approval_state).toBe('HELD');
  });

  test('a fail-closed CFE HOLD (e.g. classifier exception / unavailable) also holds the edited draft', async () => {
    const rows = [draft({ id: 'd-1', approval_state: 'PENDING' })];
    const { client } = createFakeApprovalInboxPrisma(rows);
    const cfe = new ComplianceFilterEngine({
      classifierClient: { classify: async () => { throw new Error('boom'); } },
    });
    const spy = jest.spyOn(cfe, 'evaluateContent');
    const service = new ApprovalInboxService(client, cfe);

    const result = await service.editDraft('u-1', 'd-1', 'anything at all', Role.REP);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verdict.held).toBe(true);
      expect(result.draft.approval_state).toBe('HELD');
    }
  });

  test('a FLAGGED (review-band) edit stays PENDING (still needs a human OK) with the new risk score', async () => {
    const rows = [draft({ id: 'd-1', approval_state: 'PENDING', cfe_risk_score: 3 })];
    const { client } = createFakeApprovalInboxPrisma(rows);
    const service = new ApprovalInboxService(client, flaggedCFE());

    const result = await service.editDraft('u-1', 'd-1', 'I made six figures last year doing this', Role.REP);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verdict.band).toBe('review');
      expect(result.draft.approval_state).toBe('PENDING');
      expect(result.draft.cfe_outcome).toBe('FLAG');
      expect(result.draft.cfe_risk_score).not.toBe(3); // the score genuinely changed, not stale
    }
  });

  test('editing an APPROVED draft marks edited_after_approval=true and clears the prior approval', async () => {
    const rows = [
      draft({ id: 'd-1', approval_state: 'APPROVED', approved_by: 'u-1', approved_at: new Date(), edited_after_approval: false }),
    ];
    const { client } = createFakeApprovalInboxPrisma(rows);
    const service = new ApprovalInboxService(client, clearCFE());

    const result = await service.editDraft('u-1', 'd-1', 'a revised version of the approved text', Role.REP);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.edited_after_approval).toBe(true);
      expect(result.draft.approved_by).toBeNull();
      expect(result.draft.approved_at).toBeNull();
      expect(result.draft.approval_state).toBe('PENDING'); // must be re-approved against the NEW text
    }
  });

  test('editing a PENDING (never-approved) draft leaves edited_after_approval false', async () => {
    const rows = [draft({ id: 'd-1', approval_state: 'PENDING', edited_after_approval: false })];
    const { client } = createFakeApprovalInboxPrisma(rows);
    const service = new ApprovalInboxService(client, clearCFE());

    const result = await service.editDraft('u-1', 'd-1', 'a small wording tweak', Role.REP);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.edited_after_approval).toBe(false);
  });

  test('a DECLINED (terminal) draft cannot be edited — no CFE call is made', async () => {
    const rows = [draft({ id: 'd-1', approval_state: 'DECLINED' })];
    const { client } = createFakeApprovalInboxPrisma(rows);
    const cfe = clearCFE();
    const spy = jest.spyOn(cfe, 'evaluateContent');
    const service = new ApprovalInboxService(client, cfe);

    const result = await service.editDraft('u-1', 'd-1', 'trying to resurrect this', Role.REP);
    expect(result).toEqual({ ok: false, reason: 'terminal_state', currentState: 'DECLINED' });
    expect(spy).not.toHaveBeenCalled();
  });

  test('an empty body is rejected before any CFE call', async () => {
    const rows = [draft({ id: 'd-1', approval_state: 'PENDING' })];
    const { client } = createFakeApprovalInboxPrisma(rows);
    const cfe = clearCFE();
    const spy = jest.spyOn(cfe, 'evaluateContent');
    const service = new ApprovalInboxService(client, cfe);

    const result = await service.editDraft('u-1', 'd-1', '   ', Role.REP);
    expect(result).toEqual({ ok: false, reason: 'empty_body' });
    expect(spy).not.toHaveBeenCalled();
  });

  test('ownership: editing another rep\'s draft -> not_found, no CFE call', async () => {
    const rows = [draft({ id: 'd-1', user_id: 'someone-else' })];
    const { client } = createFakeApprovalInboxPrisma(rows);
    const cfe = clearCFE();
    const spy = jest.spyOn(cfe, 'evaluateContent');
    const service = new ApprovalInboxService(client, cfe);

    const result = await service.editDraft('u-1', 'd-1', 'anything', Role.REP);
    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(spy).not.toHaveBeenCalled();
  });
});
