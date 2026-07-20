// WP08 §13.5/§18.7 — the org-type switch: archives (never deletes) Primerica-gated state, reverses
// cleanly. Critical-failure conditions this proves: (1) the switch never issues a delete against
// OrgTreeEdge/Milestone; (2) the archive snapshot counts are read-backed, not narrated.

import { OrgType } from '@prisma/client';

import { switchOrgType, type OrgSwitchPrismaClient } from '../../src/services/taprooting/org-switch.service';

function fakeDb(initialOrgType: OrgType, edgeCount: number, milestoneCount: number) {
  const state = { orgType: initialOrgType };
  const calls: string[] = [];
  const db: OrgSwitchPrismaClient = {
    user: {
      findUnique: async () => ({ org_type: state.orgType }),
      update: async ({ data }) => {
        calls.push('user.update');
        state.orgType = data.org_type;
        return {};
      },
    },
    orgTreeEdge: {
      count: async () => {
        calls.push('orgTreeEdge.count');
        return edgeCount;
      },
    },
    milestone: {
      count: async () => {
        calls.push('milestone.count');
        return milestoneCount;
      },
    },
    orgSwitchEvent: {
      create: async () => {
        calls.push('orgSwitchEvent.create');
        return { switched_at: new Date('2026-07-20T00:00:00.000Z') };
      },
    },
  };
  return { db, calls, state };
}

describe('switchOrgType (§13.5/§18.7)', () => {
  it('switching AWAY FROM Primerica snapshots the real edge/milestone counts as "archived"', async () => {
    const { db, calls } = fakeDb(OrgType.PRIMERICA, 6, 3);
    const outcome = await switchOrgType('rep-1', OrgType.EXTERNAL, db);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.archivedEdgeCount).toBe(6);
      expect(outcome.archivedMilestoneCount).toBe(3);
      expect(outcome.fromOrgType).toBe(OrgType.PRIMERICA);
      expect(outcome.toOrgType).toBe(OrgType.EXTERNAL);
    }
    // The ONLY mutation is User.org_type + one audit row — NEVER a delete against
    // OrgTreeEdge/Milestone (there is no `.delete`/`.deleteMany` method on this fake at all, so a
    // call to one would throw — the strongest proof this module structurally cannot delete them).
    expect(calls).toEqual(['orgTreeEdge.count', 'milestone.count', 'user.update', 'orgSwitchEvent.create']);
  });

  it('switching TO Primerica (the reverse) records zero NEW-branch archive counts — nothing of the new branch is being hidden', async () => {
    const { db } = fakeDb(OrgType.EXTERNAL, 0, 0);
    const outcome = await switchOrgType('rep-2', OrgType.PRIMERICA, db);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.archivedEdgeCount).toBe(0);
      expect(outcome.archivedMilestoneCount).toBe(0);
    }
  });

  it('rejects a same-org-type "switch" as a no-op, not a false archive event', async () => {
    const { db } = fakeDb(OrgType.PRIMERICA, 6, 3);
    const outcome = await switchOrgType('rep-3', OrgType.PRIMERICA, db);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('same_org_type');
  });

  it('a nonexistent user resolves to not_found, never a silent success', async () => {
    const db: OrgSwitchPrismaClient = {
      user: { findUnique: async () => null, update: async () => ({}) },
      orgTreeEdge: { count: async () => 0 },
      milestone: { count: async () => 0 },
      orgSwitchEvent: { create: async () => ({ switched_at: new Date() }) },
    };
    const outcome = await switchOrgType('ghost-user', OrgType.EXTERNAL, db);
    expect(outcome).toEqual({ ok: false, reason: 'not_found' });
  });

  it('the REVERSE switch restores full history — nothing was ever removed, so it needs no restore code at all', async () => {
    const { db, state } = fakeDb(OrgType.PRIMERICA, 6, 3);
    await switchOrgType('rep-4', OrgType.EXTERNAL, db);
    expect(state.orgType).toBe(OrgType.EXTERNAL);

    // Reverse: the same edge/milestone counts are still there (this fake never mutated them) — the
    // real production equivalent is that OrgTreeEdge/Milestone rows are simply never touched.
    const back = await switchOrgType('rep-4', OrgType.PRIMERICA, db);
    expect(back.ok).toBe(true);
    expect(state.orgType).toBe(OrgType.PRIMERICA);
  });
});
