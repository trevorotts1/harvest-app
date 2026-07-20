// WP08 §13.4 — milestone detection: "WP04 agents act as automated auditors: monitor activity logs
// for recruit/promote/train signals, fire milestone events at the moment of completion ... a
// broken taproot (multiplication inhibited on a branch) flags for upline intervention." Fires from
// TWO real production callers (see the reachability wiring in sponsor-invite.service.ts's two
// `orgTreeEdge.create` call-sites, and `taprooting-inngest-functions.ts`'s daily cron sweep) — never
// a dead scaffold nobody calls.
//
// Persists every detected milestone through the SAME generic `Milestone` model WP07's
// celebration/momentum surfaces already read (`user_id_milestone_key` unique — an idempotent
// upsert, so recomputing the tree on every read/cron tick never double-fires a celebration for an
// already-recorded key), namespaced `wp08_*` so it never collides with a WP07-owned key.

import { prisma } from '@/lib/prisma';
import { LicensingService } from '@/services/compliance/licensing';
import { recomputeAndPersistOrgTree, type TaprootingPrismaClient } from './taprooting.service';
import { computeRoBChips, type BuiltOrgTree } from './tree-builder';
import { STAGNATION_THRESHOLD_DAYS } from './health';
import { milestoneKeyFor, LAUNCH_PHASE_ITEMS, LICENSING_PHASE_ITEMS } from './phase-timeline';
import type { DetectedMilestone } from '@/types/taprooting';

export interface MilestoneDetectionPrismaClient extends TaprootingPrismaClient {
  milestone: {
    upsert(args: {
      where: { user_id_milestone_key: { user_id: string; milestone_key: string } };
      create: { user_id: string; milestone_key: string };
      update: Record<string, never>;
    }): Promise<unknown>;
  };
  harvestMethodState: {
    findUnique(args: { where: { user_id: string }; select: { background_matching_completed_at: true } }): Promise<{ background_matching_completed_at: Date | null } | null>;
  };
  draftMessage: {
    findFirst(args: {
      where: { user_id: string; approval_state: 'APPROVED' };
      orderBy: { approved_at: 'asc' };
      select: { approved_at: true };
    }): Promise<{ approved_at: Date | null } | null>;
  };
  onboardingSession: {
    findFirst(args: {
      where: { user_id: string; intensity_data: { not: null } };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
}

async function upsertMilestone(db: MilestoneDetectionPrismaClient, userId: string, milestoneKey: string): Promise<void> {
  await db.milestone.upsert({
    where: { user_id_milestone_key: { user_id: userId, milestone_key: milestoneKey } },
    create: { user_id: userId, milestone_key: milestoneKey },
    update: {},
  });
}

export interface MilestoneDetectionResult {
  detected: DetectedMilestone[];
  tree: BuiltOrgTree;
  /** Node ids flagged stagnant (>30 days no advance) THIS pass — the re-engagement flow (§13.4) is
   *  the orchard/timeline UI itself surfacing `health.stagnant` per node; this list is what the
   *  Inngest sweep additionally writes one `wp08_stagnation_flag_<id>` breadcrumb for (idempotent —
   *  first-flagged date only), so an upline/ops query has a durable "who has ever stalled" record. */
  stagnantNodeIds: string[];
}

/**
 * Runs the full WP08 detection pass for one rep's tree + phase-timeline auto items: recomputes and
 * persists `OrgTreeEdge`'s WP08-owned columns (§13.1), fires recruit/leg/team/leader Milestone rows
 * "at the moment of completion" (§13.4), auto-detects the phase-timeline items that have a REAL
 * existing signal (Harvest Method completion, first approved send, intensity selection, and the
 * WP11 licensing state itself), and flags stagnant nodes (>30 days) for the re-engagement flow.
 */
export async function runMilestoneDetection(
  userId: string,
  licensingService: LicensingService,
  db: MilestoneDetectionPrismaClient = prisma as unknown as MilestoneDetectionPrismaClient,
  now: Date = new Date()
): Promise<MilestoneDetectionResult> {
  const { tree, newlyGainedOwnRecruit, newlyQualifiedLegRecruitIds } = await recomputeAndPersistOrgTree(db, userId, now);
  const detected: DetectedMilestone[] = [];

  for (const recruitId of newlyGainedOwnRecruit) {
    const key = `wp08_recruit_has_recruit_${recruitId}`;
    await upsertMilestone(db, userId, key);
    detected.push({ kind: 'recruit_gained_own_recruit', milestoneKey: key, userId, subjectNodeId: recruitId });
  }
  for (const recruitId of newlyQualifiedLegRecruitIds) {
    const key = `wp08_leg_four_deep_${recruitId}`;
    await upsertMilestone(db, userId, key);
    detected.push({ kind: 'leg_reached_four_deep', milestoneKey: key, userId, subjectNodeId: recruitId });
  }

  const chips = computeRoBChips(tree);
  const teamChip = chips.chips.find((c) => c.key === 'team_four_legs');
  if (teamChip?.state === 'met') {
    const key = 'wp08_team_four_legs';
    await upsertMilestone(db, userId, key);
    detected.push({ kind: 'team_reached_four_legs', milestoneKey: key, userId });
  }
  const leaderChip = chips.chips.find((c) => c.key === 'leader_emerged');
  if (leaderChip?.state === 'met') {
    const key = 'wp08_leader_emerged';
    await upsertMilestone(db, userId, key);
    detected.push({ kind: 'leader_emerged', milestoneKey: key, userId });
  }

  // ── Phase-timeline auto-detected items (§13.3) — only the items with a REAL existing signal;
  // the rest are rep-attested (phase-timeline.ts's module doc explains why). ─────────────────────
  const harvestMethodDef = LAUNCH_PHASE_ITEMS.find((i) => i.key === 'harvest_method_completed');
  if (harvestMethodDef) {
    const state = await db.harvestMethodState.findUnique({ where: { user_id: userId }, select: { background_matching_completed_at: true } });
    if (state?.background_matching_completed_at) {
      const key = milestoneKeyFor('launch', 'harvest_method_completed');
      await upsertMilestone(db, userId, key);
      detected.push({ kind: 'phase_checklist_item', milestoneKey: key, userId });
    }
  }

  const firstSend = await db.draftMessage.findFirst({
    where: { user_id: userId, approval_state: 'APPROVED' },
    orderBy: { approved_at: 'asc' },
    select: { approved_at: true },
  });
  if (firstSend?.approved_at) {
    const key = milestoneKeyFor('launch', 'first_intro_sent');
    await upsertMilestone(db, userId, key);
    detected.push({ kind: 'phase_checklist_item', milestoneKey: key, userId });
  }

  const intensitySession = await db.onboardingSession.findFirst({
    where: { user_id: userId, intensity_data: { not: null } },
    select: { id: true },
  });
  if (intensitySession) {
    const key = milestoneKeyFor('launch', 'intensity_selected');
    await upsertMilestone(db, userId, key);
    detected.push({ kind: 'phase_checklist_item', milestoneKey: key, userId });
  }

  const licensingState = await licensingService.getEffectiveState(userId);
  if (licensingState === 'LICENSED') {
    const key = milestoneKeyFor('licensing', 'licensed');
    await upsertMilestone(db, userId, key);
    detected.push({ kind: 'phase_checklist_item', milestoneKey: key, userId });
  }

  // ── Stagnation / re-engagement (§13.4) ──────────────────────────────────────────────────────
  const stagnantNodeIds = tree.allNodes.filter((n) => n.health.stagnant).map((n) => n.id);
  for (const nodeId of stagnantNodeIds) {
    const key = `wp08_stagnation_flag_${nodeId}`;
    await upsertMilestone(db, userId, key);
    detected.push({ kind: 'stagnation_reengagement', milestoneKey: key, userId, subjectNodeId: nodeId });
  }

  return { detected, tree, stagnantNodeIds };
}

export { STAGNATION_THRESHOLD_DAYS, LICENSING_PHASE_ITEMS };
