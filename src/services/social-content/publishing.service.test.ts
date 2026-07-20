// T-41 (WP06 §11.5) — proofs for the CFE-offline banner + no-bypass rule, and the retry-then-
// manual-fallback pipeline. Real `ComplianceFilterEngine` instances (fixed-confidence classifier
// double, same convention as content-item.service.test.ts).

import type { ClaudeClassifierClient } from '@/services/compliance/claude';
import { ComplianceFilterEngine } from '@/services/compliance/engine';
import type { ClassifierVerdict } from '@/types/compliance';

import { PublishingService, UnconfiguredSocialPublishTransport, type SocialPublishTransport } from './publishing.service';
import type { ContentItemPrismaClient, ContentItemRow } from './content-item.service';
import type { EngagementFollowUpRow } from './engagement-followup.service';

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

function makeFakeDb(seed: ContentItemRow[]) {
  const rows = [...seed];
  const followUps: EngagementFollowUpRow[] = [];
  let idCounter = 0;
  const client = {
    contentItem: {
      async findMany({ where }: any) {
        return rows.filter((r) => (!where.state || r.state === where.state) && (!where.user_id || r.user_id === where.user_id));
      },
      async findFirst({ where }: any) {
        return rows.find((r) => r.id === where.id && r.user_id === where.user_id) ?? null;
      },
      async update({ where, data }: any) {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return { ...row };
      },
    },
    engagementFollowUpTask: {
      async create({ data }: any) {
        const row = { id: `f-${++idCounter}`, completed: false, completed_at: null, created_at: new Date(), ...data } as EngagementFollowUpRow;
        followUps.push(row);
        return row;
      },
      async findMany() {
        return followUps;
      },
      async findFirst({ where }: any) {
        return followUps.find((f) => f.id === where.id && f.user_id === where.user_id) ?? null;
      },
      async update({ where, data }: any) {
        const row = followUps.find((f) => f.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
  };
  return { client: client as unknown as ContentItemPrismaClient, rows, followUps };
}

function item(overrides: Partial<ContentItemRow> = {}): ContentItemRow {
  return {
    id: 'i-1',
    user_id: 'u-1',
    state: 'SCHEDULED',
    body: 'A clean, community-first update.',
    publish_attempts: 0,
    publish_hold_reason: null,
    published_at: null,
    ...overrides,
  } as ContentItemRow;
}

describe('PublishingService.getBannerState — §11.5 "PUBLISHING PAUSED — COMPLIANCE OFFLINE"', () => {
  test('reports paused when the CFE is marked unavailable', () => {
    const cfe = clearCFE();
    cfe.setAvailability(false);
    const { client } = makeFakeDb([]);
    const service = new PublishingService(client, cfe);
    expect(service.getBannerState()).toEqual({ publishingPaused: true, reason: 'cfe_unavailable' });
  });

  test('reports not paused when the CFE is available', () => {
    const { client } = makeFakeDb([]);
    const service = new PublishingService(client, clearCFE());
    expect(service.getBannerState()).toEqual({ publishingPaused: false });
  });
});

describe('PublishingService.attemptPublish — fail-closed, no bypass (§11.5 rule 1)', () => {
  test('CFE offline (fast path) pauses the attempt and touches nothing', async () => {
    const cfe = clearCFE();
    cfe.setAvailability(false);
    const { client, rows } = makeFakeDb([item()]);
    const service = new PublishingService(client, cfe);
    const result = await service.attemptPublish('u-1', 'i-1');
    expect(result).toEqual({ status: 'PAUSED', reason: 'cfe_unavailable' });
    expect(rows[0].state).toBe('SCHEDULED'); // untouched
    expect(rows[0].publish_attempts).toBe(0);
  });

  test('a fresh CFE block at publish time BLOCKS the item (distinct from an infra pause)', async () => {
    const { client, rows } = makeFakeDb([item()]);
    const service = new PublishingService(client, blockedCFE());
    const result = await service.attemptPublish('u-1', 'i-1');
    expect(result.status).toBe('BLOCKED');
    expect(rows[0].state).toBe('BLOCKED');
  });

  test('unknown item resolves NOT_FOUND', async () => {
    const { client } = makeFakeDb([]);
    const service = new PublishingService(client, clearCFE());
    const result = await service.attemptPublish('u-1', 'missing');
    expect(result).toEqual({ status: 'NOT_FOUND' });
  });

  test('retry-then-manual-fallback: 3 transport failures surface MANUAL_FALLBACK_AVAILABLE (§11.5 rule 2)', async () => {
    const { client, rows } = makeFakeDb([item()]);
    const service = new PublishingService(client, clearCFE(), new UnconfiguredSocialPublishTransport());

    const r1 = await service.attemptPublish('u-1', 'i-1');
    expect(r1.status).toBe('RETRY_HELD');
    expect(rows[0].publish_attempts).toBe(1);

    const r2 = await service.attemptPublish('u-1', 'i-1');
    expect(r2.status).toBe('RETRY_HELD');
    expect(rows[0].publish_attempts).toBe(2);

    const r3 = await service.attemptPublish('u-1', 'i-1');
    expect(r3.status).toBe('MANUAL_FALLBACK_AVAILABLE');
    expect(rows[0].publish_attempts).toBe(3);
    expect(rows[0].state).toBe('SCHEDULED'); // never silently marked published
  });

  test('a working transport publishes and creates the 48h follow-up task (§11.8-5)', async () => {
    const { client, rows, followUps } = makeFakeDb([item()]);
    const workingTransport: SocialPublishTransport = { publish: async () => ({ ok: true }) };
    const service = new PublishingService(client, clearCFE(), workingTransport);
    const now = new Date('2026-07-20T12:00:00Z');
    const result = await service.attemptPublish('u-1', 'i-1', now);
    expect(result.status).toBe('PUBLISHED');
    expect(rows[0].state).toBe('PUBLISHED');
    expect(followUps).toHaveLength(1);
    expect(followUps[0].content_item_id).toBe('i-1');
    expect(followUps[0].due_at.getTime() - now.getTime()).toBe(48 * 60 * 60 * 1000);
  });
});

describe('PublishingService.markPublishedManually — refused until 3 failures, no CFE bypass', () => {
  test('refuses when fewer than 3 attempts have been recorded', async () => {
    const { client } = makeFakeDb([item({ publish_attempts: 2 })]);
    const service = new PublishingService(client, clearCFE());
    const result = await service.markPublishedManually('u-1', 'i-1');
    expect(result).toEqual({ status: 'RETRY_NOT_EXHAUSTED', attempts: 2 });
  });

  test('succeeds after 3 attempts and creates the follow-up task', async () => {
    const { client, rows, followUps } = makeFakeDb([item({ publish_attempts: 3 })]);
    const service = new PublishingService(client, clearCFE());
    const result = await service.markPublishedManually('u-1', 'i-1');
    expect(result.status).toBe('PUBLISHED');
    expect(rows[0].state).toBe('PUBLISHED');
    expect(followUps).toHaveLength(1);
  });

  test('refuses (no bypass) while the CFE is offline, even with 3+ attempts recorded', async () => {
    const cfe = clearCFE();
    cfe.setAvailability(false);
    const { client, rows } = makeFakeDb([item({ publish_attempts: 3 })]);
    const service = new PublishingService(client, cfe);
    const result = await service.markPublishedManually('u-1', 'i-1');
    expect(result.status).toBe('INVALID_STATE');
    expect(rows[0].state).toBe('SCHEDULED');
  });
});

describe('PublishingService.runDuePublishes — one CFE-offline pause halts the whole tick', () => {
  test('stops processing remaining items once a PAUSED result is hit', async () => {
    const cfe = clearCFE();
    const { client } = makeFakeDb([item({ id: 'i-1' }), item({ id: 'i-2' })]);
    const service = new PublishingService(client, cfe, new UnconfiguredSocialPublishTransport());
    // Force offline mid-run by flipping availability before the tick.
    cfe.setAvailability(false);
    const results = await service.runDuePublishes([
      { id: 'i-1', user_id: 'u-1' } as ContentItemRow,
      { id: 'i-2', user_id: 'u-1' } as ContentItemRow,
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('PAUSED');
  });
});
