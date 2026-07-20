// T-41 (WP06 §11.1/§11.3, AC §11.8-2 "7+ social posts, 1 blog draft, 2 email drafts per rep on
// Sonnet 5") — end-to-end weekly-batch proof with a real ContentItemService + real
// ComplianceFilterEngine (clear classifier double) and a fake, deterministic AgentModelClient.

import { ComplianceFilterEngine } from '@/services/compliance/engine';
import type { ClaudeClassifierClient } from '@/services/compliance/claude';
import type { ClassifierVerdict } from '@/types/compliance';
import type { AgentModelClient, AgentGenerationRequest } from '@/services/agent-runtime/claude';
import { ClaudeModelTier } from '@/services/agent-runtime/runtime-model-map';

import { ContentBatchService } from './content-batch.service';
import { ContentBriefService, type ContentBriefPrismaClient } from './content-brief.service';
import { ContentItemService, type ContentItemPrismaClient, type ContentItemRow } from './content-item.service';

class ClearClassifierClient implements ClaudeClassifierClient {
  async classify(): Promise<ClassifierVerdict> {
    return { flagged: false, confidence: 0, rationale: 'clean' };
  }
}
const originalKey = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});
afterAll(() => {
  if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
});

const CLEAN_TONE_JSON = JSON.stringify({
  leads_with_relationship: true,
  treats_audience_as_community: true,
  reinforces_three_laws: true,
  harvest_hoarder_framing: false,
  rationale: 'clean',
});

function makeUniqueStubClient(): AgentModelClient {
  let n = 0;
  return {
    generate: jest.fn().mockImplementation(async (req: AgentGenerationRequest) => {
      if (req.tier === ClaudeModelTier.HAIKU_4_5) {
        return { text: CLEAN_TONE_JSON, modelId: 'claude-haiku-4-5-20251001', tier: req.tier, tokenInput: 5, tokenOutput: 5, batched: false };
      }
      n++;
      return {
        text: `A genuinely distinct community story number ${n}, written for one specific reader this week.\nIMAGE CONCEPT: a natural photo, no stock cliches.`,
        modelId: 'claude-sonnet-5',
        tier: req.tier,
        tokenInput: 20,
        tokenOutput: 40,
        batched: false,
      };
    }),
  };
}

function makeFakeBriefDb(): ContentBriefPrismaClient {
  const briefs: { id: string; user_id: string; week_start: Date; context: unknown; crosswalk: string | null; created_at: Date }[] = [];
  let n = 0;
  return {
    contact: { async count() { return 2; } },
    teamEvent: { async findMany() { return []; } },
    user: {
      async findUnique() {
        return { organization_id: null, anchor_statement: 'I do this for my family.', name: 'Jordan Rivera' };
      },
    },
    contentBrief: {
      async create({ data }) {
        const row = { id: `brief-${++n}`, crosswalk: null, created_at: new Date(), ...(data as object) } as (typeof briefs)[number];
        briefs.push(row);
        return row;
      },
      async update({ where, data }) {
        const row = briefs.find((b) => b.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
  };
}

function makeFakeItemDb(): ContentItemPrismaClient {
  const rows: ContentItemRow[] = [];
  let n = 0;
  return {
    contentItem: {
      async findMany({ where }) {
        return rows.filter((r) => !where.user_id || r.user_id === where.user_id);
      },
      async findFirst({ where }) {
        return rows.find((r) => r.id === where.id && r.user_id === where.user_id) ?? null;
      },
      async create({ data }) {
        const row = { id: `item-${++n}`, created_at: new Date(), updated_at: new Date(), publish_attempts: 0, ...(data as object) } as ContentItemRow;
        rows.push(row);
        return row;
      },
      async update({ where, data }) {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
  };
}

describe('ContentBatchService.generateWeeklyBatch — AC §11.8-2 weekly volume', () => {
  test('produces at least 7 social posts, 1 blog, 2 emails — every piece READY_FOR_REVIEW (clean + CFE-cleared)', async () => {
    const briefDb = makeFakeBriefDb();
    const itemDb = makeFakeItemDb();
    const cfe = new ComplianceFilterEngine({ classifierClient: new ClearClassifierClient() });
    const briefService = new ContentBriefService(briefDb);
    const itemService = new ContentItemService(itemDb, cfe);
    const batchService = new ContentBatchService(briefService, itemService, { modelClient: makeUniqueStubClient() });

    const result = await batchService.generateWeeklyBatch('u-1', new Date('2026-07-20T09:00:00Z'));

    const social = result.items.filter((i) => i.content_type === 'SOCIAL_POST');
    const blog = result.items.filter((i) => i.content_type === 'BLOG');
    const email = result.items.filter((i) => i.content_type === 'EMAIL');

    expect(social.length).toBeGreaterThanOrEqual(7);
    expect(blog.length).toBe(1);
    expect(email.length).toBe(2);

    // §11.1: three named platforms, distinct cadence.
    const platforms = new Set(social.map((i) => i.platform));
    expect(platforms).toEqual(new Set(['INSTAGRAM', 'FACEBOOK', 'LINKEDIN']));

    // Every generated piece cleared doctrine + the CFE (§11.8-1 "zero contain forbidden terms").
    expect(result.items.every((i) => i.vocab_clean === true)).toBe(true);
    expect(result.items.every((i) => i.state === 'READY_FOR_REVIEW')).toBe(true);

    // §11.3 weekly content crosswalk narrative was produced.
    expect(result.crosswalk).toMatch(/social posts/);
    expect(result.crosswalk.length).toBeGreaterThan(0);
  });

  test('mass-personalization guard regenerates a near-duplicate social post before it reaches the queue (§11.7/AC-6)', async () => {
    const briefDb = makeFakeBriefDb();
    const itemDb = makeFakeItemDb();
    const cfe = new ComplianceFilterEngine({ classifierClient: new ClearClassifierClient() });
    const briefService = new ContentBriefService(briefDb);
    const itemService = new ContentItemService(itemDb, cfe);

    // First two Sonnet calls return IDENTICAL text (a mail-merge-shaped duplicate); the regeneration
    // call (3rd Sonnet call onward) must return something different so the guard's fix is provable.
    let sonnetCalls = 0;
    const duplicatingClient: AgentModelClient = {
      generate: jest.fn().mockImplementation(async (req: AgentGenerationRequest) => {
        if (req.tier === ClaudeModelTier.HAIKU_4_5) {
          return { text: CLEAN_TONE_JSON, modelId: 'claude-haiku-4-5-20251001', tier: req.tier, tokenInput: 5, tokenOutput: 5, batched: false };
        }
        sonnetCalls++;
        const text =
          sonnetCalls <= 2
            ? 'Hi there, join my team and change your life with this incredible opportunity today!'
            : `A distinct, corrected post number ${sonnetCalls}, written for one specific reader.`;
        return { text, modelId: 'claude-sonnet-5', tier: req.tier, tokenInput: 20, tokenOutput: 40, batched: false };
      }),
    };

    const batchService = new ContentBatchService(briefService, itemService, { modelClient: duplicatingClient });
    const result = await batchService.generateWeeklyBatch('u-1', new Date('2026-07-20T09:00:00Z'));

    const social = result.items.filter((i) => i.content_type === 'SOCIAL_POST');
    const bodies = social.map((i) => i.body);
    // The two originally-identical posts must no longer both be present verbatim.
    const identicalCount = bodies.filter((b) => b === 'Hi there, join my team and change your life with this incredible opportunity today!').length;
    expect(identicalCount).toBeLessThanOrEqual(1);
  });
});
