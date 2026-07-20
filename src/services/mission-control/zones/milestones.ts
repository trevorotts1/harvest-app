// T-43 (WP07 §12.3) — Zone 7: the milestone pin strip. READ-ONLY, same independent-zone-failure
// convention as every sibling zone (own query, own try/catch via `safeZone` in today.service.ts).
// Milestone DETECTION (the write side-effect that creates new `Milestone` rows) deliberately does
// NOT happen here — every zone builder in this file is read-only by convention; detection runs once,
// best-effort, in the API route BEFORE this zone (and its five siblings) are built, and separately on
// a 5-minute Inngest cron sweep (gamification-inngest-functions.ts) — see celebration.service.ts's
// file header for the full reachability reasoning.

import { MILESTONE_ANCHOR_LINE, MilestoneKey } from '../../gamification/celebration.service';
import type { MissionControlPrismaClient } from '../prisma-types';

export interface MilestoneSummary {
  key: string;
  label: string;
  achievedAt: string; // ISO
  celebrated: boolean;
}

export interface MilestonesZoneData {
  items: MilestoneSummary[];
}

export async function buildMilestonesZone(db: MissionControlPrismaClient, userId: string): Promise<MilestonesZoneData> {
  const rows = await db.milestone.findMany({ where: { user_id: userId } });
  const items: MilestoneSummary[] = rows
    .filter((r) => (Object.values(MilestoneKey) as string[]).includes(r.milestone_key))
    .map((r) => ({
      key: r.milestone_key,
      label: MILESTONE_ANCHOR_LINE[r.milestone_key as MilestoneKey],
      achievedAt: r.achieved_at.toISOString(),
      celebrated: r.celebrated,
    }))
    .sort((a, b) => (a.achievedAt < b.achievedAt ? 1 : -1));
  return { items };
}
