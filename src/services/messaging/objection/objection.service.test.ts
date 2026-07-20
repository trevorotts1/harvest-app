// T-39 (WP05 §10.7 objection-handling decision tree) — teeth: (1) every generated objection response
// is CFE-GATED — `prepareResponseDraft` materializes a PENDING, cfe_outcome=null DraftMessage, which
// the unified send decision refuses (NOT_CFE_CLEARED) until WP04's CFE pass + a human approval clear
// it, so a templated branch can never reach a recipient un-gated (§10.9-9); (2) the tree meets the
// §10.9-9 shape (≥7 objections, ≥2 branches each, clarifying-question-first); (3) every string in the
// tree is doctrine-clean against the deterministic CFE stage-1 VocabularyClassifier (§0.5 / Claude-
// only vocabulary). Runs KEY-LESS (no CFE Haiku pass, no network).

import { CFEOutcome, MessageChannel } from '@prisma/client';

import { ObjectionService, type ObjectionPrismaClient } from './objection.service';
import { OBJECTION_TREE } from './objection-tree';
import { resolveDraftClearance, type SendDraftFields } from '../send/send-decision';
import { VocabularyClassifier } from '../../compliance/vocabulary';

interface Stores {
  drafts: Array<Record<string, unknown> & { id: string }>;
}
function makePrisma(seed: { contactIds?: string[] } = {}): { prisma: ObjectionPrismaClient; stores: Stores } {
  const contactIds = new Set(seed.contactIds ?? ['c-1']);
  const stores: Stores = { drafts: [] };
  let n = 0;
  const prisma: ObjectionPrismaClient = {
    contact: {
      findFirst: async ({ where }) => (where.user_id === 'rep-1' && contactIds.has(where.id) ? { id: where.id } : null),
    },
    draftMessage: {
      create: async ({ data }) => {
        const row = { id: `draft-${++n}`, ...data };
        stores.drafts.push(row);
        return { id: row.id };
      },
    },
  };
  return { prisma, stores };
}

describe('ObjectionService.prepareResponseDraft — every branch response is CFE-gated (§10.9-9)', () => {
  test('TEETH: the materialized draft is PENDING + cfe_outcome=null, and the send decision REFUSES it (NOT_CFE_CLEARED)', async () => {
    const { prisma, stores } = makePrisma();
    const result = await new ObjectionService(prisma).prepareResponseDraft('rep-1', 'c-1', 'pyramid_scheme', 'illegal', MessageChannel.SMS_HANDOFF);
    expect(result.ok).toBe(true);

    const draft = stores.drafts[0];
    expect(draft.cfe_outcome).toBeNull();
    expect(draft.approval_state).toBe('PENDING');

    // The load-bearing proof: this draft, fed to the SAME gate the send seam uses, is refused.
    const clearance = resolveDraftClearance({
      id: String(draft.id),
      user_id: 'rep-1',
      contact_id: 'c-1',
      channel: MessageChannel.SMS_HANDOFF,
      body: String(draft.body),
      cfe_outcome: draft.cfe_outcome as CFEOutcome | null,
      approval_state: String(draft.approval_state),
      edited_after_approval: false,
    } as SendDraftFields);
    expect(clearance).toEqual({ cleared: false, reason: 'NOT_CFE_CLEARED' });
  });

  test('never pre-sets a PASS: even a valid branch cannot short-circuit the CFE', async () => {
    const { prisma, stores } = makePrisma();
    await new ObjectionService(prisma).prepareResponseDraft('rep-1', 'c-1', 'no_money', 'timing');
    expect(stores.drafts[0].cfe_outcome).not.toBe(CFEOutcome.PASS);
  });

  test('OWNERSHIP: a contact not owned by the caller is CONTACT_NOT_FOUND (no leaky draft created)', async () => {
    const { prisma, stores } = makePrisma();
    const result = await new ObjectionService(prisma).prepareResponseDraft('rep-1', 'not-mine', 'trust', 'the_company');
    expect(result).toMatchObject({ ok: false, code: 'CONTACT_NOT_FOUND' });
    expect(stores.drafts).toHaveLength(0);
  });

  test('an unknown objection / branch is rejected with a typed code (no draft created)', async () => {
    const { prisma, stores } = makePrisma();
    const svc = new ObjectionService(prisma);
    expect(await svc.prepareResponseDraft('rep-1', 'c-1', 'nope', 'x')).toMatchObject({ ok: false, code: 'UNKNOWN_OBJECTION' });
    expect(await svc.prepareResponseDraft('rep-1', 'c-1', 'trust', 'nope')).toMatchObject({ ok: false, code: 'UNKNOWN_BRANCH' });
    expect(stores.drafts).toHaveLength(0);
  });
});

describe('OBJECTION_TREE — §10.9-9 shape + Socratic (clarifying-question-first)', () => {
  test('at least 7 objections, each with at least 2 branches and a clarifying question first', () => {
    expect(OBJECTION_TREE.length).toBeGreaterThanOrEqual(7);
    for (const node of OBJECTION_TREE) {
      expect(node.branches.length).toBeGreaterThanOrEqual(2);
      expect(node.clarifyingQuestion.trim().length).toBeGreaterThan(0);
      for (const branch of node.branches) {
        expect(['continue', 'schedule', 'respectfully_close']).toContain(branch.nextAction);
        expect(branch.response.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test('object keys and branch keys are unique', () => {
    const keys = OBJECTION_TREE.map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const node of OBJECTION_TREE) {
      const bk = node.branches.map((b) => b.key);
      expect(new Set(bk).size).toBe(bk.length);
    }
  });
});

describe('OBJECTION_TREE — doctrine-clean vocabulary (deterministic CFE stage-1, §0.5)', () => {
  const vocab = new VocabularyClassifier();
  test('every clarifying question and every branch response passes the VocabularyClassifier', () => {
    for (const node of OBJECTION_TREE) {
      expect(vocab.scan(node.clarifyingQuestion).clean).toBe(true);
      expect(vocab.scan(node.label).clean).toBe(true);
      for (const branch of node.branches) {
        const scan = vocab.scan(branch.response);
        if (!scan.clean) throw new Error(`Objection ${node.key}/${branch.key} response is not doctrine-clean`);
        expect(scan.clean).toBe(true);
      }
    }
  });
});
