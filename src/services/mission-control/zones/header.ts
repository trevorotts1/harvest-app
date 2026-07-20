// WP04 (T-32) — Zone 1: Anchor header (uiux §5.2 item 1 / §3 Grove).
//
// Deliberately its OWN, self-contained fetch (MomentumEvent + Milestone + a DraftMessage count for
// the Approval Inbox badge) — reused by NO other zone, even though the Approval Inbox count looks
// similar to the Action Queue zone's own DraftMessage read. That duplication is intentional: sharing
// a query across zones would silently couple their failure modes, defeating the independent-zone-
// failure guarantee (master-spec §9.5 / uiux AC-5.2-6).

import {
  computeBloomOverride,
  computeGroveBandState,
  computeMomentum,
  computeMomentumCriteria,
  groveCaptionFor,
} from '../momentum';
import type { MissionControlPrismaClient } from '../prisma-types';
import type { HeaderZoneData } from '../types';

const PENDING_APPROVAL_STATES = ['PENDING', 'HELD'];

export async function buildHeaderZone(
  db: MissionControlPrismaClient,
  userId: string,
  greetingName: string,
  now: Date = new Date()
): Promise<HeaderZoneData> {
  const [events, milestones, drafts] = await Promise.all([
    db.momentumEvent.findMany({ where: { user_id: userId } }),
    db.milestone.findMany({ where: { user_id: userId } }),
    db.draftMessage.findMany({ where: { user_id: userId, approval_state: { in: PENDING_APPROVAL_STATES } } }),
  ]);

  const momentum = computeMomentum(events, now);
  const momentumCriteria = computeMomentumCriteria(events, now);
  const bloom = computeBloomOverride(milestones, now);
  const groveState = bloom ? 'bloom' : computeGroveBandState(momentum);
  const groveCaption = groveCaptionFor(groveState, bloom?.label);

  return {
    greetingName,
    momentum,
    groveState,
    groveCaption,
    approvalInboxCount: drafts.length,
    momentumCriteria,
  };
}
