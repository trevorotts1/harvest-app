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
// T-52 (WCAG 2.2 AA §17.4 / uiux §6.1 item 5): the ONE cross-WP import this zone needs to compose
// the "Milestone full-bloom" narration script — `milestones.ts` (this same directory, WP07's zone)
// already crosses this exact boundary the same way, so this is not a new layering precedent.
import { buildMilestoneFullBloomNarration } from '../../gamification/celebration.service';
import type { MissionControlPrismaClient } from '../prisma-types';
import type { HeaderZoneData } from '../types';
// T-57 (server-msg-i18n) — `groveCaption`/`groveBloomNarration` below used to be bare English
// (momentum.ts's `groveCaptionFor` / celebration.service.ts's `buildMilestoneFullBloomNarration`),
// unconditionally, even for an es-locale rep. `locale` is an OPTIONAL trailing param (defaulting to
// `DEFAULT_LOCALE`) threaded in from today.service.ts's aggregator-level `resolveRepLocale` — every
// existing caller/test that omits it keeps compiling and rendering byte-identical English.
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';

const PENDING_APPROVAL_STATES = ['PENDING', 'HELD'];

export async function buildHeaderZone(
  db: MissionControlPrismaClient,
  userId: string,
  greetingName: string,
  now: Date = new Date(),
  locale: Locale = DEFAULT_LOCALE
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
  const groveCaption = groveCaptionFor(groveState, bloom?.label, locale);
  const groveBloomNarration = bloom ? buildMilestoneFullBloomNarration(bloom.key, locale) : null;

  return {
    greetingName,
    momentum,
    groveState,
    groveCaption,
    groveBloomNarration,
    approvalInboxCount: drafts.length,
    momentumCriteria,
  };
}
