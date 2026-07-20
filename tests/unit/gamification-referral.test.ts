// T-43 (WP07 §12.7, §12.9-7) — referral scripts CFE-cleared before display; referred names create
// attributed pipeline entries; ownership-scoped (cross-rep -> null, never a leak); Claude-only
// fail-closed when the model is unavailable.

import { draftReferralScript, recordReferredContact } from '../../src/services/gamification/referral.service';
import type { CFEContentEvaluator } from '../../src/services/gamification/cfe-gate';
import type { CFEVerdict } from '../../src/types/compliance';
import type { AgentModelClient } from '../../src/services/agent-runtime/claude/runtime-client';

const USER_CONTEXT = { user_id: 'rep-1', role: 'REP' as const };

function passingCFE(): CFEContentEvaluator {
  return { async evaluateContent(): Promise<CFEVerdict> { return { band: 'clear', score: 0, classifierResults: [], held: false, released: true, reason: 'clean', heldReason: null, safeHarbor: { injected: false, disclaimers: [] }, httpStatus: 200, ruleVersion: 't', auditEvent: {} as CFEVerdict['auditEvent'] }; } };
}
function blockingCFE(): CFEContentEvaluator {
  return { async evaluateContent(): Promise<CFEVerdict> { return { band: 'blocked', score: 90, classifierResults: [], held: false, released: false, reason: 'income_claim', heldReason: null, safeHarbor: { injected: false, disclaimers: [] }, httpStatus: 403, ruleVersion: 't', auditEvent: {} as CFEVerdict['auditEvent'] }; } };
}
function fakeModelClient(text: string): AgentModelClient {
  return { async generate() { return { text, modelId: 'claude-sonnet-5', tier: 'sonnet_5' as never, tokenInput: 10, tokenOutput: 10, batched: false }; } };
}
function throwingModelClient(): AgentModelClient {
  return { async generate() { throw new Error('MissingClaudeCredentialError'); } };
}

function makeReferralDb() {
  const rows: { id: string; referrer_user_id?: string; script_text: string; cfe_cleared: boolean; referred_contact_id: string | null }[] = [];
  let n = 0;
  return {
    rows,
    referral: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        n += 1;
        const row = { id: `ref-${n}`, ...data } as never;
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return (row ?? { id: where.id, script_text: '', cfe_cleared: false, referred_contact_id: null }) as never;
      },
      // ENFORCING mock (T-R24 fix — the prior version matched on `where.id` alone and silently
      // ignored `where.referrer_user_id`, so a mutation dropping `referrer_user_id: userId` from
      // recordReferredContact's where-clause was invisible to this suite: the mock behaved
      // identically with or without that filter). Mirrors real Prisma `findFirst` semantics — a
      // field is only filtered on when the caller's `where` actually includes it, so a production
      // regression that OMITS `referrer_user_id` from the query genuinely widens what matches here
      // too, exactly as it would against a live Postgres `WHERE id = ? AND referrer_user_id = ?`.
      findFirst: async ({ where }: { where: { id: string; referrer_user_id?: string } }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) return null as never;
        if ('referrer_user_id' in where && row.referrer_user_id !== where.referrer_user_id) return null as never;
        return { id: row.id } as never;
      },
    },
  };
}

describe('draftReferralScript — CFE-cleared before the rep sees it (§12.9-7)', () => {
  test('a clean draft is returned as ok and persisted cfe_cleared=true', async () => {
    const db = makeReferralDb();
    const result = await draftReferralScript(
      { userId: 'rep-1', relationshipType: 'family', channel: 'SMS', repFirstName: 'Alex', anchorStatement: null, includeDimeFraming: false, userContext: USER_CONTEXT },
      { cfe: passingCFE(), modelClient: fakeModelClient('Hey Aunt Rosa, thinking about you — would love to introduce you to something that has helped my family.'), db }
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.text.length).toBeGreaterThan(0);
    expect(db.rows[0].cfe_cleared).toBe(true);
  });

  test('a blocked draft is NEVER returned as usable text, but is still recorded for audit', async () => {
    const db = makeReferralDb();
    const result = await draftReferralScript(
      { userId: 'rep-1', relationshipType: 'friend', channel: 'EMAIL', repFirstName: 'Alex', anchorStatement: null, includeDimeFraming: false, userContext: USER_CONTEXT },
      { cfe: blockingCFE(), modelClient: fakeModelClient('You will earn guaranteed income if you join.'), db }
    );
    expect(result.status).toBe('held');
    expect((result as { text?: string }).text).toBeUndefined();
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].cfe_cleared).toBe(false);
  });

  test('Claude unavailable → fail-closed HELD, never a fabricated script (§0.3)', async () => {
    const db = makeReferralDb();
    const result = await draftReferralScript(
      { userId: 'rep-1', relationshipType: 'work', channel: 'SMS', repFirstName: 'Alex', anchorStatement: null, includeDimeFraming: false, userContext: USER_CONTEXT },
      { cfe: passingCFE(), modelClient: throwingModelClient(), db }
    );
    expect(result.status).toBe('held');
  });
});

describe('recordReferredContact — attribution + ownership scoping (§12.9-7 / §16.6 404-not-403)', () => {
  test('creates a Contact linked to the referrer, and updates the Referral row', async () => {
    const db = makeReferralDb();
    await db.referral.create({ data: { referrer_user_id: 'rep-1', script_text: 'hi', cfe_cleared: true } });
    const fullDb = {
      referral: db.referral,
      contact: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new-contact-1', ...data } as never),
        findFirst: async ({ where }: { where: { id: string; user_id: string } }) => (where.id === 'referrer-contact-1' ? { id: 'referrer-contact-1' } : null),
      },
    };
    const result = await recordReferredContact(fullDb, 'rep-1', 'ref-1', 'referrer-contact-1', { firstName: 'New', lastName: 'Person', relationshipType: 'family' });
    expect(result).toEqual({ contactId: 'new-contact-1' });
  });

  test('a referral belonging to a DIFFERENT rep returns null (ownership check — no cross-rep leak)', async () => {
    const db = makeReferralDb();
    await db.referral.create({ data: { referrer_user_id: 'other-rep', script_text: 'hi', cfe_cleared: true } });
    // Deliberately the UNMODIFIED, ownership-ENFORCING mock (no findFirst override) — this is what
    // gives the assertion teeth: if recordReferredContact's where-clause ever drops
    // `referrer_user_id: userId`, this mock's own filtering (mirroring real Prisma) would let the
    // row through and the test would go red, instead of the false-safety a hand-stubbed
    // `findFirst: async () => null` would provide regardless of what the production code queries.
    const fullDb = {
      referral: db.referral,
      contact: { create: async () => ({ id: 'x' }), findFirst: async () => null },
    };
    const result = await recordReferredContact(fullDb, 'rep-1', 'ref-1', null, { firstName: 'X', lastName: 'Y', relationshipType: 'family' });
    expect(result).toBeNull();
  });

  test('a referrerContactId owned by a DIFFERENT rep returns null', async () => {
    const db = makeReferralDb();
    await db.referral.create({ data: { referrer_user_id: 'rep-1', script_text: 'hi', cfe_cleared: true } });
    const fullDb = {
      referral: db.referral,
      contact: { create: async () => ({ id: 'x' }), findFirst: async () => null }, // not owned by rep-1
    };
    const result = await recordReferredContact(fullDb, 'rep-1', 'ref-1', 'someone-elses-contact', { firstName: 'X', lastName: 'Y', relationshipType: 'family' });
    expect(result).toBeNull();
  });
});
