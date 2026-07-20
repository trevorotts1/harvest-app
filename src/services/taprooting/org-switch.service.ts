// WP08 §13.5/§18.7 — the org-type switch: "all gated visualization state is wiped instantly,
// mid-session, and Primerica-specific data is archived (not deleted); the reverse switch re-unlocks
// with history restored." This is a genuinely new capability — `org_switch` was already reserved
// as a step-up-MFA `SensitiveAction` (src/lib/auth/mfa.ts, §16.4) by WP01/WP11, but no route ever
// exercised it before this unit.
//
// "ARCHIVED, NOT DELETED" — how this module makes that literally true, not merely narrated: this
// function NEVER issues a delete/update against `OrgTreeEdge` or `Milestone` rows. The ONLY write
// is `User.org_type` itself, plus one `OrgSwitchEvent` audit row recording a SNAPSHOT count of how
// much Primerica-gated state existed at switch time. Every taprooting/timeline read
// (taprooting.service.ts / timeline.service.ts) derives its Primerica/universal branch from a
// FRESH read of `User.org_type` on every call — there is no cache to invalidate, so "wiped
// instantly, mid-session" falls out of that design for free: the very next read after this
// function returns already serves the new branch. Switching BACK later re-reads the SAME
// untouched `OrgTreeEdge`/`Milestone` rows, which is the "reverse switch re-unlocks with history
// restored" property — restoration requires no code at all because nothing was ever removed.

import { OrgType } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import type { OrgSwitchOutcome } from '@/types/taprooting';

export interface OrgSwitchPrismaClient {
  user: {
    findUnique(args: { where: { id: string }; select: { org_type: true } }): Promise<{ org_type: OrgType } | null>;
    update(args: { where: { id: string }; data: { org_type: OrgType } }): Promise<unknown>;
  };
  orgTreeEdge: {
    count(args: { where: { OR: [{ sponsor_id: string }, { recruit_id: string }] } }): Promise<number>;
  };
  milestone: {
    count(args: { where: { user_id: string; milestone_key: { startsWith: string } } }): Promise<number>;
  };
  orgSwitchEvent: {
    create(args: {
      data: {
        user_id: string;
        from_org_type: OrgType;
        to_org_type: OrgType;
        archived_edge_count: number;
        archived_milestone_count: number;
      };
    }): Promise<{ switched_at: Date }>;
  };
}

/**
 * Switches `userId`'s org type. When switching AWAY FROM Primerica, snapshots how much
 * Primerica-gated state exists right now (edge + `wp08_*` milestone counts touching this user) into
 * the `OrgSwitchEvent` audit row — the read-backed "archived, not deleted" proof a QC pass can
 * verify without trusting a narrative. Switching TO Primerica (the reverse) records zero counts
 * (nothing of the NEW branch is being archived by this specific switch); the restored history is
 * simply whatever was never touched, visible again the instant `org_type` flips back.
 */
export async function switchOrgType(
  userId: string,
  toOrgType: OrgType,
  db: OrgSwitchPrismaClient = prisma as unknown as OrgSwitchPrismaClient
): Promise<OrgSwitchOutcome> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { org_type: true } });
  if (!user) return { ok: false, reason: 'not_found' };
  if (user.org_type === toOrgType) return { ok: false, reason: 'same_org_type' };

  const wasPrimerica = user.org_type === OrgType.PRIMERICA;
  const archivedEdgeCount = wasPrimerica
    ? await db.orgTreeEdge.count({ where: { OR: [{ sponsor_id: userId }, { recruit_id: userId }] } })
    : 0;
  const archivedMilestoneCount = wasPrimerica
    ? await db.milestone.count({ where: { user_id: userId, milestone_key: { startsWith: 'wp08_' } } })
    : 0;

  await db.user.update({ where: { id: userId }, data: { org_type: toOrgType } });
  const event = await db.orgSwitchEvent.create({
    data: {
      user_id: userId,
      from_org_type: user.org_type,
      to_org_type: toOrgType,
      archived_edge_count: archivedEdgeCount,
      archived_milestone_count: archivedMilestoneCount,
    },
  });

  return {
    ok: true,
    fromOrgType: user.org_type,
    toOrgType,
    archivedEdgeCount,
    archivedMilestoneCount,
    switchedAt: event.switched_at.toISOString(),
  };
}
