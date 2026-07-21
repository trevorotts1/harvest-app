// T-41 (WP06 §11.4, AC §11.8-3 "generates as one coherent batch within 60s ... whole-kit review gate
// holds on any block") — end-to-end launch-kit proofs with a real ContentItemService + real
// ComplianceFilterEngine (clear classifier double) and a fake, deterministic AgentModelClient.

import { ComplianceFilterEngine } from '@/services/compliance/engine';
import type { ClaudeClassifierClient } from '@/services/compliance/claude';
import type { ClassifierVerdict } from '@/types/compliance';
import type { AgentModelClient, AgentGenerationRequest } from '@/services/agent-runtime/claude';
import { ClaudeModelTier } from '@/services/agent-runtime/runtime-model-map';

import { LaunchKitService, type LaunchKitPrismaClient, type LaunchKitRow } from './launch-kit.service';
import { ContentBriefService, type ContentBriefPrismaClient } from './content-brief.service';
import { ContentItemService, type ContentItemPrismaClient, type ContentItemRow } from './content-item.service';

class ClearClassifierClient implements ClaudeClassifierClient {
  async classify(): Promise<ClassifierVerdict> {
    return { flagged: false, confidence: 0, rationale: 'clean' };
  }
}
class FixedConfidenceClassifierClient implements ClaudeClassifierClient {
  constructor(private confidence: number) {}
  async classify(): Promise<ClassifierVerdict> {
    return { flagged: this.confidence >= 0.5, confidence: this.confidence, rationale: 'test' };
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

function makeFakeBriefDb(): ContentBriefPrismaClient {
  return {
    contact: { async count() { return 0; } },
    teamEvent: { async findMany() { return []; } },
    user: { async findUnique() { return { organization_id: null, anchor_statement: null, name: 'Alex Chen' }; } },
    contentBrief: {
      async create() { return { id: 'brief-x', user_id: 'u-1', week_start: new Date(), context: {}, crosswalk: null, created_at: new Date() }; },
      async update() { return {}; },
    },
  };
}

function makeFakeItemDb(): ContentItemPrismaClient {
  const rows: ContentItemRow[] = [];
  let n = 0;
  return {
    contentItem: {
      async findMany({ where }: { where: Record<string, unknown> }) {
        return rows.filter((r) => (!where.user_id || r.user_id === where.user_id) && (!where.launch_kit_id || r.launch_kit_id === where.launch_kit_id));
      },
      async findFirst({ where }: { where: { id: string; user_id: string } }) {
        return rows.find((r) => r.id === where.id && r.user_id === where.user_id) ?? null;
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: `item-${++n}`, created_at: new Date(), updated_at: new Date(), publish_attempts: 0, ...data } as ContentItemRow;
        rows.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      async updateMany({ where, data }: { where: { launch_kit_id: string }; data: Record<string, unknown> }) {
        rows.filter((r) => r.launch_kit_id === where.launch_kit_id).forEach((r) => Object.assign(r, data));
      },
    },
  } as unknown as ContentItemPrismaClient;
}

function makeFakeKitDb(itemDb: ContentItemPrismaClient): LaunchKitPrismaClient {
  const kits: LaunchKitRow[] = [];
  let n = 0;
  return {
    launchKit: {
      async create({ data }) {
        const row = { id: `kit-${++n}`, created_at: new Date(), updated_at: new Date(), ...(data as object) } as LaunchKitRow;
        kits.push(row);
        return row;
      },
      async findFirst({ where }) {
        return kits.find((k) => k.id === where.id && k.user_id === where.user_id) ?? null;
      },
      async findMany({ where }: { where: Record<string, unknown> }) {
        return kits.filter((k) => !where.user_id || k.user_id === where.user_id);
      },
      async update({ where, data }) {
        const row = kits.find((k) => k.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    // `itemDb`'s declared `ContentItemPrismaClient` type doesn't expose `updateMany` (it's not part
    // of that production interface); the mock built by `makeFakeItemDb()` has it at runtime, hidden
    // behind that function's own `as unknown as` cast — mirror that same narrowing convention here
    // rather than widening the production interface for a test-only method.
    contentItem: (itemDb as unknown as { contentItem: LaunchKitPrismaClient['contentItem'] }).contentItem,
  };
}

/** Delayed stub so parallelism is provable: if generation were sequential across the 4 pieces, total
 *  elapsed would be roughly 4x a single piece's own (draft + tone-gate) delay; parallel stays near 1x. */
function makeDelayedStubClient(dirtyPiece?: 'ANNOUNCEMENT' | 'RECRUIT_FRAMING'): AgentModelClient {
  return {
    generate: jest.fn().mockImplementation(async (req: AgentGenerationRequest) => {
      await new Promise((r) => setTimeout(r, 40));
      if (req.tier === ClaudeModelTier.HAIKU_4_5) {
        return { text: CLEAN_TONE_JSON, modelId: 'claude-haiku-4-5-20251001', tier: req.tier, tokenInput: 5, tokenOutput: 5, batched: false };
      }
      const isAnnouncement = req.systemPrompt.includes('celebrating the new member');
      let text = `A warm, specific piece written for one reader.`;
      if (dirtyPiece === 'ANNOUNCEMENT' && isAnnouncement) {
        text = 'This prospect is a great lead for my funnel.'; // forbidden vocabulary -> BLOCKED
      }
      if (dirtyPiece === 'RECRUIT_FRAMING' && isAnnouncement) {
        // Deliberately contains NO general-vocabulary forbidden term (no bare "recruit") — this
        // must be caught by the launch-kit-specific `scanRecruitFraming` narrow check, not the
        // general doctrine-guard vocabulary scan, proving that guard actually runs.
        text = 'Meet our newest sign-up, Morgan! So glad they found this community.';
      }
      return { text, modelId: 'claude-sonnet-5', tier: req.tier, tokenInput: 20, tokenOutput: 40, batched: false };
    }),
  };
}

function buildServices(client: AgentModelClient, cfe: ComplianceFilterEngine = new ComplianceFilterEngine({ classifierClient: new ClearClassifierClient() })) {
  const briefService = new ContentBriefService(makeFakeBriefDb());
  const itemDb = makeFakeItemDb();
  const itemService = new ContentItemService(itemDb, cfe);
  const kitDb = makeFakeKitDb(itemDb);
  const service = new LaunchKitService(kitDb, briefService, itemService, { modelClient: client });
  return { service, itemService };
}

describe('LaunchKitService.triggerKit — coherent batch + whole-kit hold (§11.4, AC §11.8-3)', () => {
  test('generates all 4 pieces, every one CFE-cleared, kit lands READY_FOR_REVIEW when all clean', async () => {
    const { service } = buildServices(makeDelayedStubClient());
    const result = await service.triggerKit({
      userId: 'u-1',
      newMemberFirstName: 'Riley',
      welcomeVariant: 'PERSONAL_REFERRAL',
      photoUrl: 'https://example.test/riley.jpg',
    });
    expect(result.items).toHaveLength(4);
    const pieceTypes = new Set(result.items.map((i) => i.launch_kit_piece_type));
    expect(pieceTypes).toEqual(new Set(['WELCOME', 'ANNOUNCEMENT', 'DAY3_VALUE_EMAIL', 'DAY7_EVENT_INVITE']));
    expect(result.items.every((i) => i.state === 'READY_FOR_REVIEW')).toBe(true);
    expect(result.wholeKitHeld).toBe(false);
    expect(result.kit.state).toBe('READY_FOR_REVIEW');
    expect(result.kit.photo_url).toBe('https://example.test/riley.jpg');
  });

  test('generation runs IN PARALLEL — elapsed time stays near a single piece\'s delay, not 4x (§11.8-3 "within 60s")', async () => {
    const { service } = buildServices(makeDelayedStubClient());
    const started = Date.now();
    await service.triggerKit({ userId: 'u-1', newMemberFirstName: 'Sam', welcomeVariant: 'EVENT_ATTENDEE' });
    const elapsed = Date.now() - started;
    // Each piece is draft(40ms) + tone-gate(40ms) = ~80ms if parallel across the 4 pieces;
    // sequential would be ~320ms+. A generous threshold avoids CI flakiness while still proving
    // parallelism (sequential execution would blow well past this).
    expect(elapsed).toBeLessThan(250);
  });

  test('a blocked piece (forbidden vocabulary) triggers the WHOLE-KIT HOLD — sibling pieces stay individually cleared', async () => {
    const { service } = buildServices(makeDelayedStubClient('ANNOUNCEMENT'));
    const result = await service.triggerKit({ userId: 'u-1', newMemberFirstName: 'Taylor', welcomeVariant: 'BASE_MEMBER_INTRODUCED' });
    expect(result.wholeKitHeld).toBe(true);
    expect(result.kit.state).toBe('HELD_FOR_REVIEW');
    expect(result.kit.held_reason).toBeTruthy();
    const announcement = result.items.find((i) => i.launch_kit_piece_type === 'ANNOUNCEMENT')!;
    expect(announcement.state).toBe('BLOCKED');
    // Every OTHER piece still cleared independently (§11.4 "each piece independently CFE-cleared").
    const others = result.items.filter((i) => i.launch_kit_piece_type !== 'ANNOUNCEMENT');
    expect(others.every((i) => i.state === 'READY_FOR_REVIEW')).toBe(true);
  });

  test('never frames the new member as a "recruit/sign-up" — the announcement is blocked, not published, if it drifts that way', async () => {
    const { service } = buildServices(makeDelayedStubClient('RECRUIT_FRAMING'));
    const result = await service.triggerKit({ userId: 'u-1', newMemberFirstName: 'Morgan', welcomeVariant: 'PERSONAL_REFERRAL' });
    const announcement = result.items.find((i) => i.launch_kit_piece_type === 'ANNOUNCEMENT')!;
    expect(announcement.state).toBe('BLOCKED');
    expect(result.wholeKitHeld).toBe(true);
  });

  test('a CFE classifier BLOCK (not just a doctrine-guard violation) ALSO triggers the whole-kit hold', async () => {
    // Every piece here is doctrine-clean text; the CFE itself (a high-confidence classifier double)
    // is what blocks — proving the whole-kit hold reacts to a CFE block, not only to the doctrine
    // scan (the QC break-it instruction: "trigger a launch kit where one piece is CFE-blocked and
    // confirm the whole kit holds").
    const blockedCFE = new ComplianceFilterEngine({ classifierClient: new FixedConfidenceClassifierClient(0.99) });
    const { service } = buildServices(makeDelayedStubClient(), blockedCFE);
    const result = await service.triggerKit({ userId: 'u-1', newMemberFirstName: 'Quinn', welcomeVariant: 'PERSONAL_REFERRAL' });
    expect(result.wholeKitHeld).toBe(true);
    expect(result.kit.state).toBe('HELD_FOR_REVIEW');
    expect(result.items.every((i) => i.state === 'BLOCKED')).toBe(true);
    expect(result.items.every((i) => i.cfe_outcome === 'BLOCK')).toBe(true);
  });

  test('no photo on file -> photo_url is null (never a fabricated stock substitute)', async () => {
    const { service } = buildServices(makeDelayedStubClient());
    const result = await service.triggerKit({ userId: 'u-1', newMemberFirstName: 'Casey', welcomeVariant: 'EVENT_ATTENDEE' });
    expect(result.kit.photo_url).toBeNull();
  });
});

describe('LaunchKitService.approveKit — refused while the whole-kit hold is active', () => {
  test('refuses approval while any piece is BLOCKED', async () => {
    const { service } = buildServices(makeDelayedStubClient('ANNOUNCEMENT'));
    const triggered = await service.triggerKit({ userId: 'u-1', newMemberFirstName: 'Drew', welcomeVariant: 'PERSONAL_REFERRAL' });
    const result = await service.approveKit('u-1', triggered.kit.id);
    expect(result).toEqual({ ok: false, reason: 'still_held' });
  });

  test('approves once every piece is clear', async () => {
    const { service } = buildServices(makeDelayedStubClient());
    const triggered = await service.triggerKit({ userId: 'u-1', newMemberFirstName: 'Avery', welcomeVariant: 'PERSONAL_REFERRAL' });
    const result = await service.approveKit('u-1', triggered.kit.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kit.state).toBe('APPROVED');
  });
});

describe('LaunchKitService.withdrawKit — §11.4 "if the new member withdraws, materials move to drafts"', () => {
  test('moves the kit and every piece back to DRAFTING', async () => {
    const { service, itemService } = buildServices(makeDelayedStubClient());
    const triggered = await service.triggerKit({ userId: 'u-1', newMemberFirstName: 'Jamie', welcomeVariant: 'PERSONAL_REFERRAL' });
    const result = await service.withdrawKit('u-1', triggered.kit.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kit.state).toBe('WITHDRAWN_TO_DRAFTS');
    for (const item of triggered.items) {
      const fresh = await itemService.getItem('u-1', item.id);
      expect(fresh?.state).toBe('DRAFTING');
    }
  });
});
