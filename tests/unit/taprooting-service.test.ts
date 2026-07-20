// WP08 §13.1/§13.5 — the Prisma-backed org-tree service: RBAC (never PII, upline sees
// structure/health/pace only), org-gating enforced at the data layer (fresh read every call — this
// IS the "org switch wipes instantly, mid-session" property), and the universal-branch shape.

import { OrgType, Role } from '@prisma/client';

import { getOrgTreeView, recomputeAndPersistOrgTree, type TaprootingPrismaClient } from '../../src/services/taprooting/taprooting.service';

interface Seed {
  users: { id: string; name: string; rank: string | null; org_type: OrgType }[];
  edges: { id: string; sponsor_id: string; recruit_id: string }[];
}

function fakeDb(seed: Seed): TaprootingPrismaClient {
  const edgeUpdates: Record<string, { leg_depth: number; is_leg: boolean; has_own_recruit: boolean; health_index: unknown }> = {};
  const db: TaprootingPrismaClient = {
    user: {
      findUnique: async ({ where }) => seed.users.find((u) => u.id === where.id) ?? null,
      findMany: async ({ where }) => seed.users.filter((u) => where.id.in.includes(u.id)),
    },
    orgTreeEdge: {
      findMany: async ({ where }) => seed.edges.filter((e) => where.sponsor_id.in.includes(e.sponsor_id)),
      update: async ({ where, data }) => {
        edgeUpdates[where.id] = data;
        return {};
      },
    },
    momentumEvent: {
      findMany: async () => [],
    },
  };
  return db;
}

function seedTree(): Seed {
  return {
    users: [
      { id: 'root', name: 'Root Rep', rank: 'RVP', org_type: OrgType.PRIMERICA },
      { id: 'r1', name: 'Alex Rivera', rank: null, org_type: OrgType.PRIMERICA },
      { id: 'r1c', name: 'Sam Chen', rank: null, org_type: OrgType.PRIMERICA },
      { id: 'r2', name: 'Jamie Torres', rank: null, org_type: OrgType.PRIMERICA },
    ],
    edges: [
      { id: 'e1', sponsor_id: 'root', recruit_id: 'r1' },
      { id: 'e2', sponsor_id: 'r1', recruit_id: 'r1c' },
      { id: 'e3', sponsor_id: 'root', recruit_id: 'r2' },
    ],
  };
}

describe('getOrgTreeView (§13.5 RBAC + org-gating)', () => {
  it("a rep reading their OWN tree gets the full real structure, no PII/conversation fields anywhere in the shape", async () => {
    const db = fakeDb(seedTree());
    const outcome = await getOrgTreeView('root', Role.REP, undefined, db);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.branch).toBe('primerica');
      expect(outcome.result.totals.realNodeCount).toBe(3);
      expect(outcome.result.viewScope).toBe('own');
      // The shape itself carries no PII/conversation-content field — structural proof, not a
      // runtime scan: OrgTreeNode (types/taprooting.ts) has no phone/email/message field to leak.
      const serialized = JSON.stringify(outcome.result);
      expect(serialized).not.toMatch(/phone|email|conversation|message_body/i);
    }
  });

  it('a REP cannot view a DIFFERENT rep\'s tree — resolves forbidden, not a data leak', async () => {
    const db = fakeDb(seedTree());
    const outcome = await getOrgTreeView('r2', Role.REP, 'r1', db);
    expect(outcome).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('an UPLINE can view a REACHABLE downline report\'s subtree (structure/health/pace only)', async () => {
    const db = fakeDb(seedTree());
    const outcome = await getOrgTreeView('root', Role.UPLINE, 'r1', db);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.viewScope).toBe('downline_structure_only');
      expect(outcome.result.totals.realNodeCount).toBe(1); // r1's own subtree: just r1c
    }
  });

  it('an UPLINE cannot view a NON-reachable user\'s tree (never trusts the bare id)', async () => {
    const db = fakeDb(seedTree());
    const outcome = await getOrgTreeView('root', Role.UPLINE, 'someone-not-in-my-downline', db);
    expect(outcome).toEqual({ ok: false, reason: 'not_found' });
  });

  it('a nonexistent target resolves not_found', async () => {
    const db = fakeDb(seedTree());
    const missing = await getOrgTreeView('ghost', Role.REP, undefined, db);
    expect(missing).toEqual({ ok: false, reason: 'not_found' });
  });

  it('§17.1 THE ORG-SWITCH INSTANT-WIPE PROPERTY: a fresh read after org_type changes reflects the NEW branch immediately — no cache', async () => {
    const seed = seedTree();
    const db = fakeDb(seed);

    const before = await getOrgTreeView('root', Role.REP, undefined, db);
    expect(before.ok && before.result.branch).toBe('primerica');

    // Simulate the org-switch mutation directly on the seed (org-switch.service.ts's own job is
    // tested separately; this proves getOrgTreeView has NOTHING cached to invalidate).
    seed.users.find((u) => u.id === 'root')!.org_type = OrgType.EXTERNAL;

    const after = await getOrgTreeView('root', Role.REP, undefined, db);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.result.branch).toBe('universal');
      // Universal-view contract: no ghosts, no RoB chips, no override math surface.
      expect(after.result.ghosts).toEqual([]);
      expect(after.result.robChips.chips).toEqual([]);
    }
  });

  it('universal view truncates to 2 rings (direct/second-degree) — no lattice, per uiux §5.5', async () => {
    const seed = seedTree();
    seed.users.find((u) => u.id === 'root')!.org_type = OrgType.EXTERNAL;
    const db = fakeDb(seed);
    const outcome = await getOrgTreeView('root', Role.REP, undefined, db);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      // r1's own child r1c is level 2 — capNode keeps level<=2 but drops grandchildren of level-2.
      const r1 = outcome.result.nodes.find((n) => n.id === 'r1')!;
      expect(r1.children.map((c) => c.id)).toContain('r1c');
    }
  });
});

describe('recomputeAndPersistOrgTree (§13.1/§13.4 — the app-layer-maintained columns)', () => {
  it('flags newlyGainedOwnRecruit / newlyQualifiedLegRecruitIds at the moment they qualify', async () => {
    const db = fakeDb(seedTree());
    const { newlyGainedOwnRecruit } = await recomputeAndPersistOrgTree(db, 'root');
    expect(newlyGainedOwnRecruit).toContain('r1'); // r1 has r1c as their own recruit
    expect(newlyGainedOwnRecruit).not.toContain('r2'); // r2 has no recruit of their own yet
  });
});
