// T-39 (WP05 §10.6 three-way handoff; §2.5 upline-visibility boundary) — teeth: the upline dashboard
// view is ORG-GATED and never leaks across a rep, an org, or a non-upline. `visibleToUpline` filters
// on BOTH upline_id AND organization_id; `join` refuses anyone who is not this handoff's invited
// upline (NOT_YOUR_HANDOFF); every mutation is ownership-scoped; the 24h no-join return path is
// idempotent. KEY-LESS pure logic over an in-memory Prisma.

import { ThreeWayHandoffService, type HandoffRow, type ThreeWayHandoffPrismaClient } from './three-way-handoff.service';

const T0 = new Date('2026-07-15T12:00:00Z');
const H = (ms: number) => new Date(T0.getTime() + ms);

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => row[k] === v);
}

function makePrisma(): { prisma: ThreeWayHandoffPrismaClient; rows: HandoffRow[] } {
  const rows: HandoffRow[] = [];
  let n = 0;
  const prisma: ThreeWayHandoffPrismaClient = {
    threeWayHandoff: {
      create: async ({ data }) => {
        const row = { id: `h-${++n}`, ...(data as object) } as HandoffRow;
        rows.push(row);
        return { ...row };
      },
      findFirst: async ({ where }) => {
        const r = rows.find((row) => matches(row as unknown as Record<string, unknown>, where));
        return r ? { ...r } : null;
      },
      findMany: async ({ where }) => rows.filter((row) => matches(row as unknown as Record<string, unknown>, where)).map((r) => ({ ...r })),
      update: async ({ where, data }) => {
        const r = rows.find((row) => row.id === where.id)!;
        Object.assign(r, data);
        return { ...r };
      },
    },
  };
  return { prisma, rows };
}

const baseTrigger = { userId: 'rep-A', contactId: 'c-1', uplineId: 'up-A', organizationId: 'org-1', reason: 'BUYING_SIGNAL' as const };

describe('ThreeWayHandoffService.trigger — fail-closed + 24h return deadline', () => {
  test('no upline on file → NO_UPLINE (nothing to bridge)', async () => {
    const { prisma } = makePrisma();
    const result = await new ThreeWayHandoffService(prisma).trigger({ ...baseTrigger, uplineId: '' }, T0);
    expect(result).toEqual({ ok: false, code: 'NO_UPLINE' });
  });

  test('creates an INVITED handoff with return_deadline_at = invited_at + 24h', async () => {
    const { prisma } = makePrisma();
    const result = await new ThreeWayHandoffService(prisma).trigger(baseTrigger, T0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.handoff.state).toBe('INVITED');
    expect(result.handoff.return_deadline_at.getTime()).toBe(T0.getTime() + 24 * 60 * 60 * 1000);
  });
});

describe('ThreeWayHandoffService.visibleToUpline — ORG-GATED, no cross-rep-or-org leak (§2.5)', () => {
  test('TEETH: a handoff surfaces ONLY to its exact upline within its exact org — never another org or another upline', async () => {
    const { prisma } = makePrisma();
    const svc = new ThreeWayHandoffService(prisma);
    // Same upline id, DIFFERENT orgs; plus a different upline in org-1.
    await svc.trigger({ userId: 'rep-A', contactId: 'c-1', uplineId: 'up-A', organizationId: 'org-1', reason: 'BUYING_SIGNAL' }, T0);
    await svc.trigger({ userId: 'rep-B', contactId: 'c-2', uplineId: 'up-A', organizationId: 'org-2', reason: 'HARD_QUESTION' }, T0);
    await svc.trigger({ userId: 'rep-C', contactId: 'c-3', uplineId: 'up-Z', organizationId: 'org-1', reason: 'MANUAL' }, T0);

    const org1View = await svc.visibleToUpline('up-A', 'org-1');
    expect(org1View).toHaveLength(1);
    expect(org1View[0].organization_id).toBe('org-1');
    expect(org1View[0].contact_id).toBe('c-1');

    // Same upline id, other org → cannot see org-1's handoff (the org gate holds).
    const org2View = await svc.visibleToUpline('up-A', 'org-2');
    expect(org2View.map((h) => h.contact_id)).toEqual(['c-2']);

    // A different upline in org-1 sees only their own, never up-A's.
    const otherUpline = await svc.visibleToUpline('up-Z', 'org-1');
    expect(otherUpline.map((h) => h.contact_id)).toEqual(['c-3']);

    // A rep who is nobody's upline here sees nothing.
    expect(await svc.visibleToUpline('rep-A', 'org-1')).toHaveLength(0);
  });
});

describe('ThreeWayHandoffService.join — only the invited upline, only while INVITED', () => {
  test('TEETH: a different upline attempting to join → NOT_YOUR_HANDOFF (never a leak); the real upline joins', async () => {
    const { prisma } = makePrisma();
    const svc = new ThreeWayHandoffService(prisma);
    const created = await svc.trigger(baseTrigger, T0);
    if (!created.ok) throw new Error('setup');
    const id = created.handoff.id;

    expect(await svc.join('up-INTRUDER', id, H(1000))).toEqual({ ok: false, code: 'NOT_YOUR_HANDOFF' });

    const joined = await svc.join('up-A', id, H(2000));
    expect(joined).toMatchObject({ ok: true });
    if (joined.ok) expect(joined.handoff.state).toBe('JOINED');

    // Not joinable twice.
    expect(await svc.join('up-A', id, H(3000))).toEqual({ ok: false, code: 'NOT_JOINABLE' });
    expect(await svc.join('up-A', 'no-such-id', H(4000))).toEqual({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('ThreeWayHandoffService.returnIfLapsed — 24h no-join return, idempotent, ownership-scoped (§10.9-8)', () => {
  test('a still-INVITED handoff past its deadline returns to the rep with a coached next step', async () => {
    const { prisma } = makePrisma();
    const svc = new ThreeWayHandoffService(prisma);
    const created = await svc.trigger(baseTrigger, T0);
    if (!created.ok) throw new Error('setup');

    const returned = await svc.returnIfLapsed('rep-A', created.handoff.id, H(25 * 60 * 60 * 1000));
    expect(returned?.state).toBe('RETURNED');
    expect((returned?.coached_next_step ?? '').length).toBeGreaterThan(0);
  });

  test('before the deadline it is left INVITED; a JOINED handoff is never overwritten', async () => {
    const { prisma } = makePrisma();
    const svc = new ThreeWayHandoffService(prisma);
    const created = await svc.trigger(baseTrigger, T0);
    if (!created.ok) throw new Error('setup');
    const id = created.handoff.id;

    expect((await svc.returnIfLapsed('rep-A', id, H(1000)))?.state).toBe('INVITED');
    await svc.join('up-A', id, H(2000));
    expect((await svc.returnIfLapsed('rep-A', id, H(25 * 60 * 60 * 1000)))?.state).toBe('JOINED');
  });

  test('OWNERSHIP: another rep cannot return this rep\'s handoff', async () => {
    const { prisma } = makePrisma();
    const svc = new ThreeWayHandoffService(prisma);
    const created = await svc.trigger(baseTrigger, T0);
    if (!created.ok) throw new Error('setup');
    expect(await svc.returnIfLapsed('rep-OTHER', created.handoff.id, H(25 * 60 * 60 * 1000))).toBeNull();
  });

  test('listForRep is ownership-scoped', async () => {
    const { prisma } = makePrisma();
    const svc = new ThreeWayHandoffService(prisma);
    await svc.trigger(baseTrigger, T0);
    await svc.trigger({ ...baseTrigger, userId: 'rep-OTHER' }, T0);
    const mine = await svc.listForRep('rep-A');
    expect(mine).toHaveLength(1);
    expect(mine[0].user_id).toBe('rep-A');
  });
});
