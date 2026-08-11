// R-08 (refinements catalog 2026-07-28) — `POST/GET /api/onboarding/sponsor-decision`: the API half
// of the sponsor-outcome wiring. Proves, against REAL route handlers with a stateful fake Prisma
// (the established narrow-DI convention — `jest.mock('@/lib/prisma')` at the module boundary,
// `getCurrentSession` mocked for `withRole`):
//
//   (a) GET resolves a REAL candidate pool (same-org, sponsor-eligible, never-RVP) with display
//       names from the candidates' real `User.name` — the client is never handed an empty pool
//       when real candidates exist (the 'linked' branch is REACHABLE).
//   (b) POST accept persists the REAL matcher outcome: Sponsorship + OrgTreeEdge + User.upline_id,
//       all in one transaction, for exactly the id the server's own matcher picks.
//   (c) TAMPERED INPUT FAILS CLOSED: a sponsor id the matcher would not have chosen (a different
//       eligible user, a wrong-org user, an unknown id) is rejected with 409 and NOTHING is
//       persisted; a sponsorId on a non-accept decision is rejected outright; a non-REP role
//       (including an RVP — R-01) can never pair; an empty real pool rejects accept with 409.
//   (d) the waitlist / "no upline yet" / paid-path choices persist their honest decision on the
//       session row and never fabricate a sponsorship.

import { NextRequest } from 'next/server';
import { OrgType, Role, type SponsorshipState } from '@prisma/client';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));

interface FakeUserRow {
  id: string;
  role: Role;
  org_type: OrgType;
  name: string;
  upline_id: string | null;
  is_suspended: boolean;
}

interface FakeSessionRow {
  id: string;
  user_id: string;
  sponsor_decision: unknown;
}

const fakeUsers = new Map<string, FakeUserRow>();
const fakeSessions = new Map<string, FakeSessionRow>();
const fakeSponsorships: Array<Record<string, unknown>> = [];
const fakeEdges: Array<Record<string, unknown>> = [];

function seedUser(overrides: Partial<FakeUserRow> = {}): FakeUserRow {
  const row: FakeUserRow = {
    id: overrides.id ?? `user-${fakeUsers.size + 1}`,
    role: Role.REP,
    org_type: OrgType.EXTERNAL,
    name: 'Real Sponsor Name',
    upline_id: null,
    is_suspended: false,
    ...overrides,
  };
  fakeUsers.set(row.id, row);
  return row;
}

function seedSession(userId: string) {
  fakeSessions.set(userId, { id: `session-${userId}`, user_id: userId, sponsor_decision: null });
}

const fakePrisma = {
  user: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      fakeUsers.get(where.id) ? { ...fakeUsers.get(where.id) } : null,
    findMany: async ({
      where,
    }: {
      where: { is_suspended?: boolean; org_type?: OrgType; id?: { in?: string[]; not?: string } };
    }) =>
      [...fakeUsers.values()]
        .filter(
          (u) =>
            (where.is_suspended === undefined || u.is_suspended === where.is_suspended) &&
            (where.org_type === undefined || u.org_type === where.org_type) &&
            (where.id?.in === undefined || where.id.in.includes(u.id)) &&
            (where.id?.not === undefined || u.id !== where.id.not)
        )
        .map((u) => ({ ...u })),
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakeUserRow> }) => {
      const row = fakeUsers.get(where.id);
      if (!row) throw new Error(`no fake user ${where.id}`);
      Object.assign(row, data);
      return { ...row };
    },
  },
  sponsorship: {
    findMany: async ({
      where,
    }: {
      where: { sponsor_user_id: { in: string[] }; state: SponsorshipState };
    }) =>
      fakeSponsorships.filter(
        (s) => where.sponsor_user_id.in.includes(s.sponsor_user_id as string) && s.state === where.state
      ),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `sponsorship-${fakeSponsorships.length + 1}`, ...data };
      fakeSponsorships.push(row);
      return row;
    },
  },
  orgTreeEdge: {
    findMany: async ({ where }: { where: { sponsor_id: { in: string[] } } }) =>
      fakeEdges.filter((e) => where.sponsor_id.in.includes(e.sponsor_id as string)),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `edge-${fakeEdges.length + 1}`, ...data };
      fakeEdges.push(row);
      return row;
    },
  },
  onboardingSession: {
    updateMany: async ({
      where,
      data,
    }: {
      where: { user_id: string };
      data: { sponsor_decision: unknown };
    }) => {
      const session = fakeSessions.get(where.user_id);
      if (session) session.sponsor_decision = data.sponsor_decision;
      return { count: session ? 1 : 0 };
    },
  },
  $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
};

jest.mock('@/lib/prisma', () => ({ prisma: fakePrisma }));

import { getCurrentSession } from '@/lib/auth/session';
import { GET, POST } from '@/app/api/onboarding/sponsor-decision/route';

const mockedGetCurrentSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;

function fakeAuthSession(userId: string, role: Role = Role.REP): Session {
  return {
    user: {
      id: userId,
      role,
      orgType: 'EXTERNAL',
      organizationId: null,
      accessTier: 'FREE_ORG_LINKED',
      mfaEnrolled: false,
      mfaVerifiedAt: null,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

function actAs(userId: string, role: Role = Role.REP) {
  mockedGetCurrentSession.mockResolvedValue(fakeAuthSession(userId, role));
}

async function getPool() {
  const request = new NextRequest('http://localhost/api/onboarding/sponsor-decision');
  const response = await GET(request, {});
  return { response, body: await response.json() };
}

async function postDecision(decision: string, sponsorId?: string) {
  const request = new NextRequest('http://localhost/api/onboarding/sponsor-decision', {
    method: 'POST',
    body: JSON.stringify({ decision, sponsorId }),
  });
  const response = await POST(request, {});
  return { response, body: await response.json() };
}

beforeEach(() => {
  fakeUsers.clear();
  fakeSessions.clear();
  fakeSponsorships.length = 0;
  fakeEdges.length = 0;
});

describe("R-08 — GET: the REAL candidate pool (the 'linked' branch must be reachable)", () => {
  test('resolves same-org, sponsor-eligible candidates with their real names — never a hard-coded empty pool', async () => {
    seedUser({ id: 'rep-1' });
    seedUser({ id: 'alice', name: 'Alice Upline', role: Role.UPLINE, upline_id: 'their-sponsor' });
    seedUser({ id: 'bob', name: 'Bob Rep', role: Role.REP });
    seedUser({ id: 'other-org', name: 'Other Org', role: Role.REP, org_type: OrgType.PRIMERICA });
    seedUser({ id: 'rvp-user', name: 'RVP User', role: Role.RVP });
    seedSession('rep-1');
    actAs('rep-1');

    const { response, body } = await getPool();
    expect(response.status).toBe(200);
    const ids = (body.candidates as Array<{ userId: string }>).map((c) => c.userId);
    // Same org type, REP/UPLINE eligible; the RVP and the other-org user are never candidates.
    expect(ids).toContain('alice');
    expect(ids).toContain('bob');
    expect(ids).not.toContain('rvp-user');
    expect(ids).not.toContain('other-org');
    expect(ids).not.toContain('rep-1');
    // Linkage-row holders (alice has an upline_id) rank first, then the plain eligible user.
    expect(ids).toEqual(['alice', 'bob']);
    const alice = (body.candidates as Array<{ userId: string; name: string }>).find((c) => c.userId === 'alice');
    expect(alice?.name).toBe('Alice Upline');
  });

  test('the pool carries each candidate REAL active-sponsorship load — the least-loaded matcher pick is exactly what accept persists', async () => {
    seedUser({ id: 'rep-1' });
    seedUser({ id: 'busy', name: 'Busy', role: Role.REP });
    seedUser({ id: 'free', name: 'Free', role: Role.UPLINE });
    seedSession('rep-1');
    actAs('rep-1');
    // busy already sponsors 3 ACTIVE members; free has none — the least-loaded matcher must pick free.
    for (let i = 0; i < 3; i += 1) {
      fakeSponsorships.push({ id: `s${i}`, sponsor_user_id: 'busy', member_user_id: `m${i}`, state: 'ACTIVE' });
    }

    const poolResponse = await getPool();
    const candidates = poolResponse.body.candidates as Array<{ userId: string; activeSponsorshipCount: number }>;
    expect(candidates.find((c) => c.userId === 'busy')?.activeSponsorshipCount).toBe(3);
    expect(candidates.find((c) => c.userId === 'free')?.activeSponsorshipCount).toBe(0);

    // The free sponsor (least-loaded) is what the accept route verifies and persists.
    const { response, body } = await postDecision('accept', 'free');
    expect(response.status).toBe(200);
    expect(body.sponsorId).toBe('free');
    expect(fakeSponsorships).toHaveLength(4); // 3 seeded + the new one
    expect(fakeUsers.get('rep-1')?.upline_id).toBe('free');
  });

  test('a non-REP role (e.g. an RVP — R-01) gets the honest empty pool, never a fabricated one', async () => {
    seedUser({ id: 'rvp-1', role: Role.RVP });
    seedUser({ id: 'alice', name: 'Alice', role: Role.UPLINE });
    seedSession('rvp-1');
    actAs('rvp-1', Role.RVP);

    const { response, body } = await getPool();
    expect(response.status).toBe(200);
    expect(body.candidates).toEqual([]);
  });
});

describe('R-08 — POST accept persists the REAL matcher outcome (linked branch is real)', () => {
  test('the exact id the matcher picks (least-loaded, deterministic) persists Sponsorship + OrgTreeEdge + User.upline_id', async () => {
    seedUser({ id: 'rep-1' });
    seedUser({ id: 'alice', name: 'Alice', role: Role.UPLINE, upline_id: 'their-sponsor' });
    seedUser({ id: 'bob', name: 'Bob', role: Role.REP });
    seedSession('rep-1');
    actAs('rep-1');

    // alice (linkage) ranks before bob; the matcher picks the first — alice.
    const { response, body } = await postDecision('accept', 'alice');
    expect(response.status).toBe(200);
    expect(body.outcome).toBe('linked');
    expect(body.sponsorId).toBe('alice');

    expect(fakeSponsorships).toHaveLength(1);
    expect(fakeSponsorships[0]).toMatchObject({
      sponsor_user_id: 'alice',
      member_user_id: 'rep-1',
      state: 'ACTIVE',
    });
    expect(fakeEdges).toHaveLength(1);
    expect(fakeEdges[0]).toMatchObject({
      sponsor_id: 'alice',
      recruit_id: 'rep-1',
      edge_type: 'upline_sponsor',
      is_recruit_confirmed: true,
    });
    expect(fakeUsers.get('rep-1')?.upline_id).toBe('alice');
  });

  test('TAMPERED: a different eligible id the matcher would not have chosen is rejected with 409 and NOTHING is persisted', async () => {
    seedUser({ id: 'rep-1' });
    seedUser({ id: 'alice', name: 'Alice', role: Role.UPLINE, upline_id: 'their-sponsor' });
    seedUser({ id: 'bob', name: 'Bob', role: Role.REP });
    seedSession('rep-1');
    actAs('rep-1');

    const { response } = await postDecision('accept', 'bob'); // alice is the matcher's pick
    expect(response.status).toBe(409);
    expect(fakeSponsorships).toHaveLength(0);
    expect(fakeEdges).toHaveLength(0);
    expect(fakeUsers.get('rep-1')?.upline_id).toBeNull();
  });

  test('TAMPERED: a wrong-org candidate and a fabricated unknown id are both rejected, nothing persisted', async () => {
    seedUser({ id: 'rep-1' });
    seedUser({ id: 'alice', name: 'Alice', role: Role.UPLINE, upline_id: 'their-sponsor' });
    seedUser({ id: 'other-org', name: 'Other', role: Role.UPLINE, org_type: OrgType.PRIMERICA });
    seedSession('rep-1');
    actAs('rep-1');

    const tampered1 = await postDecision('accept', 'other-org');
    expect(tampered1.response.status).toBe(409);
    const tampered2 = await postDecision('accept', 'no-such-user');
    expect(tampered2.response.status).toBe(409);
    expect(fakeSponsorships).toHaveLength(0);
    expect(fakeEdges).toHaveLength(0);
  });

  test('accept with NO real pool fails closed with 409 — nothing fabricated', async () => {
    seedUser({ id: 'rep-1' });
    seedSession('rep-1');
    actAs('rep-1');

    const { response } = await postDecision('accept', 'alice');
    expect(response.status).toBe(409);
    expect(fakeSponsorships).toHaveLength(0);
  });

  test('an RVP can never be paired — accept is rejected with 400, nothing persisted (R-01)', async () => {
    seedUser({ id: 'rvp-1', role: Role.RVP });
    seedUser({ id: 'alice', name: 'Alice', role: Role.UPLINE });
    seedSession('rvp-1');
    actAs('rvp-1', Role.RVP);

    const { response } = await postDecision('accept', 'alice');
    expect(response.status).toBe(400);
    expect(fakeSponsorships).toHaveLength(0);
    expect(fakeEdges).toHaveLength(0);
  });
});

describe('R-08 — POST: the waitlist / "no upline yet" / paid-path choices persist honestly', () => {
  test('join_waitlist records the decision on the session row and NEVER fabricates a sponsorship', async () => {
    seedUser({ id: 'rep-1' });
    seedUser({ id: 'alice', name: 'Alice', role: Role.UPLINE });
    seedSession('rep-1');
    actAs('rep-1');

    const { response, body } = await postDecision('join_waitlist');
    expect(response.status).toBe(200);
    expect(body.outcome).toBe('join_waitlist');
    expect(fakeSponsorships).toHaveLength(0);
    expect(fakeEdges).toHaveLength(0);
    const decision = fakeSessions.get('rep-1')?.sponsor_decision as { decision: string };
    expect(decision.decision).toBe('join_waitlist');
  });

  test('no_upline_yet records the decision — "no upline yet" is a first-class path (§6.10-5)', async () => {
    seedUser({ id: 'rep-1' });
    seedSession('rep-1');
    actAs('rep-1');

    const { response } = await postDecision('no_upline_yet');
    expect(response.status).toBe(200);
    expect((fakeSessions.get('rep-1')?.sponsor_decision as { decision: string }).decision).toBe('no_upline_yet');
  });

  test('TAMPERED: a sponsorId smuggled onto a non-accept decision is rejected outright (400)', async () => {
    seedUser({ id: 'rep-1' });
    seedSession('rep-1');
    actAs('rep-1');

    const { response } = await postDecision('join_waitlist', 'alice');
    expect(response.status).toBe(400);
    expect(fakeSessions.get('rep-1')?.sponsor_decision).toBeNull();
  });

  test('an invalid decision value is rejected with 400 (fail-closed on garbage)', async () => {
    seedUser({ id: 'rep-1' });
    seedSession('rep-1');
    actAs('rep-1');

    const { response } = await postDecision('maybe', 'alice');
    expect(response.status).toBe(400);
  });
});
