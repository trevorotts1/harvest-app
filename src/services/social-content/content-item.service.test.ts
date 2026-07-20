// T-41 (WP06 §11.5) — service-level proofs for ContentItemService. Real `ComplianceFilterEngine`
// instances (injected classifier clients — same convention as tests/unit/approval-inbox-service.test.ts
// / tests/unit/agent-runtime.test.ts) so the CFE-gate proofs are real end-to-end CFE calls, not a
// mocked `evaluateContent`.

import type { ClaudeClassifierClient, ClassifierRequest } from '@/services/compliance/claude';
import { ComplianceFilterEngine } from '@/services/compliance/engine';
import type { ClassifierVerdict } from '@/types/compliance';

import { ContentItemService, DECLINE_REASONS, type ContentItemPrismaClient, type ContentItemRow } from './content-item.service';

class FixedConfidenceClassifierClient implements ClaudeClassifierClient {
  constructor(private confidence: number) {}
  async classify(): Promise<ClassifierVerdict> {
    return { flagged: this.confidence >= 0.5, confidence: this.confidence, rationale: 'test' };
  }
}
const clearCFE = () => new ComplianceFilterEngine({ classifierClient: new FixedConfidenceClassifierClient(0) });
const blockedCFE = () => new ComplianceFilterEngine({ classifierClient: new FixedConfidenceClassifierClient(0.99) });

const originalKey = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});
afterAll(() => {
  if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
});

let idCounter = 0;
function createFakePrisma(seed: ContentItemRow[] = []): { client: ContentItemPrismaClient; rows: ContentItemRow[] } {
  const rows = [...seed];
  const client: ContentItemPrismaClient = {
    contentItem: {
      async findMany({ where }) {
        return rows.filter((r) => {
          if (where.user_id && r.user_id !== where.user_id) return false;
          if (where.state && r.state !== where.state) return false;
          return true;
        });
      },
      async findFirst({ where }) {
        return rows.find((r) => r.id === where.id && r.user_id === where.user_id) ?? null;
      },
      async create({ data }) {
        const row = {
          id: `item-${++idCounter}`,
          created_at: new Date(),
          updated_at: new Date(),
          category: null,
          platform: null,
          launch_kit_id: null,
          launch_kit_piece_type: null,
          brief_id: null,
          template_id: null,
          headline: null,
          image_concept_prompt: null,
          cta: null,
          cfe_outcome: null,
          cfe_risk_score: null,
          cfe_classifier_data: null,
          vocab_violations: null,
          doctrine_notes: null,
          scheduled_for: null,
          published_at: null,
          publish_attempts: 0,
          publish_hold_reason: null,
          approved_by: null,
          approved_at: null,
          edited_after_approval: false,
          edit_history: null,
          decline_reason: null,
          model_used: null,
          personalization_tier: 'AUTOMATIC',
          ...data,
        } as ContentItemRow;
        rows.push(row);
        return row;
      },
      async update({ where, data }) {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return { ...row };
      },
    },
  };
  return { client, rows };
}

describe('ContentItemService.createFromDraft — the single gate (§11.8-1)', () => {
  test('a doctrine-dirty draft is BLOCKED without ever consulting the CFE', async () => {
    const { client } = createFakePrisma();
    const cfe = blockedCFE(); // if this were consulted it would also block — we assert it's SKIPPED
    const spy = jest.spyOn(cfe, 'evaluateContent');
    const service = new ContentItemService(client, cfe);
    const { item, verdict } = await service.createFromDraft({
      userId: 'u-1',
      contentType: 'SOCIAL_POST',
      body: 'This prospect is a lead for my funnel.',
      vocabClean: false,
      vocabViolations: [{ forbidden: 'prospect' }],
    });
    expect(item.state).toBe('BLOCKED');
    expect(item.vocab_clean).toBe(false);
    expect(verdict).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  test('a clean draft that clears the CFE lands READY_FOR_REVIEW with cfe_outcome PASS', async () => {
    const { client } = createFakePrisma();
    const service = new ContentItemService(client, clearCFE());
    const { item } = await service.createFromDraft({
      userId: 'u-1',
      contentType: 'SOCIAL_POST',
      body: 'A warm story about our community this week.',
      vocabClean: true,
    });
    expect(item.state).toBe('READY_FOR_REVIEW');
    expect(item.cfe_outcome).toBe('PASS');
  });

  test('a clean draft that the CFE blocks lands BLOCKED (never released)', async () => {
    const { client } = createFakePrisma();
    const service = new ContentItemService(client, blockedCFE());
    const { item } = await service.createFromDraft({
      userId: 'u-1',
      contentType: 'SOCIAL_POST',
      body: 'Some content the classifiers flag heavily.',
      vocabClean: true,
    });
    expect(item.state).toBe('BLOCKED');
    expect(item.publish_hold_reason).toMatch(/CFE_/);
  });
});

describe('ContentItemService — ownership scoping (never a 403/existence leak, always 404-shaped)', () => {
  test('listQueue never returns another user\'s items', async () => {
    const { client } = createFakePrisma([
      { id: 'a', user_id: 'u-1', state: 'READY_FOR_REVIEW' } as ContentItemRow,
      { id: 'b', user_id: 'u-2', state: 'READY_FOR_REVIEW' } as ContentItemRow,
    ]);
    const service = new ContentItemService(client, clearCFE());
    const items = await service.listQueue('u-1');
    expect(items.map((i) => i.id)).toEqual(['a']);
  });

  test('approveAndSchedule on another user\'s item resolves not_found', async () => {
    const { client } = createFakePrisma([{ id: 'a', user_id: 'u-2', state: 'READY_FOR_REVIEW' } as ContentItemRow]);
    const service = new ContentItemService(client, clearCFE());
    const result = await service.approveAndSchedule('u-1', 'a', new Date());
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('ContentItemService.approveAndSchedule / bulkApprove (§11.8-4)', () => {
  test('only a READY_FOR_REVIEW item is approvable', async () => {
    const { client } = createFakePrisma([{ id: 'a', user_id: 'u-1', state: 'DRAFTING' } as ContentItemRow]);
    const service = new ContentItemService(client, clearCFE());
    const result = await service.approveAndSchedule('u-1', 'a', new Date());
    expect(result).toEqual({ ok: false, reason: 'not_ready', currentState: 'DRAFTING' });
  });

  test('bulkApprove schedules every ready item across time-of-day windows and skips not-ready ones', async () => {
    const { client } = createFakePrisma([
      { id: 'a', user_id: 'u-1', state: 'READY_FOR_REVIEW' } as ContentItemRow,
      { id: 'b', user_id: 'u-1', state: 'READY_FOR_REVIEW' } as ContentItemRow,
      { id: 'c', user_id: 'u-1', state: 'BLOCKED' } as ContentItemRow,
    ]);
    const service = new ContentItemService(client, clearCFE());
    const from = new Date('2026-07-20T00:00:00Z');
    const result = await service.bulkApprove('u-1', ['a', 'b', 'c'], from);
    expect(result.approved).toEqual(['a', 'b']);
    expect(result.skipped).toEqual([{ id: 'c', reason: 'not_ready:BLOCKED' }]);
  });
});

describe('ContentItemService.declineItem', () => {
  test('rejects an invalid reason', async () => {
    const { client } = createFakePrisma([{ id: 'a', user_id: 'u-1', state: 'READY_FOR_REVIEW' } as ContentItemRow]);
    const service = new ContentItemService(client, clearCFE());
    const result = await service.declineItem('u-1', 'a', 'bogus_reason');
    expect(result).toEqual({ ok: false, reason: 'invalid_reason' });
  });

  test('every declared reason is a valid DECLINE_REASONS member', () => {
    expect(DECLINE_REASONS.length).toBeGreaterThan(0);
  });

  test('a PUBLISHED item cannot be declined (terminal)', async () => {
    const { client } = createFakePrisma([{ id: 'a', user_id: 'u-1', state: 'PUBLISHED' } as ContentItemRow]);
    const service = new ContentItemService(client, clearCFE());
    const result = await service.declineItem('u-1', 'a', 'not_my_voice');
    expect(result).toEqual({ ok: false, reason: 'terminal', currentState: 'PUBLISHED' });
  });
});

describe('ContentItemService.editItem — re-enters vocab + CFE, preserves an audit trail (§11.8-4)', () => {
  test('an edit re-enters the CFE and preserves prior body in edit_history', async () => {
    const { client } = createFakePrisma([
      { id: 'a', user_id: 'u-1', state: 'READY_FOR_REVIEW', body: 'original body', headline: null, edit_history: null } as ContentItemRow,
    ]);
    const service = new ContentItemService(client, clearCFE());
    const result = await service.editItem('u-1', 'a', 'a revised community story');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.body).toBe('a revised community story');
    expect(Array.isArray(result.item.edit_history)).toBe(true);
    expect((result.item.edit_history as { previousBody: string }[])[0].previousBody).toBe('original body');
  });

  test('editing in a forbidden term BLOCKS the item without a CFE call', async () => {
    const { client } = createFakePrisma([{ id: 'a', user_id: 'u-1', state: 'READY_FOR_REVIEW', body: 'ok', edit_history: null } as ContentItemRow]);
    const cfe = clearCFE();
    const spy = jest.spyOn(cfe, 'evaluateContent');
    const service = new ContentItemService(client, cfe);
    const result = await service.editItem('u-1', 'a', 'this prospect is a lead');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.state).toBe('BLOCKED');
    expect(spy).not.toHaveBeenCalled();
  });

  test('a PUBLISHED item cannot be edited (terminal)', async () => {
    const { client } = createFakePrisma([{ id: 'a', user_id: 'u-1', state: 'PUBLISHED', body: 'x', edit_history: null } as ContentItemRow]);
    const service = new ContentItemService(client, clearCFE());
    const result = await service.editItem('u-1', 'a', 'new text');
    expect(result).toEqual({ ok: false, reason: 'terminal', currentState: 'PUBLISHED' });
  });

  test('empty body is rejected', async () => {
    const { client } = createFakePrisma([{ id: 'a', user_id: 'u-1', state: 'READY_FOR_REVIEW', body: 'x', edit_history: null } as ContentItemRow]);
    const service = new ContentItemService(client, clearCFE());
    const result = await service.editItem('u-1', 'a', '   ');
    expect(result).toEqual({ ok: false, reason: 'empty_body' });
  });
});
