// WP08 §13.3/§13.6-3, §5.5 — the real, Prisma + WP11-LicensingService-backed phased timeline.
// Replaces the pre-existing mock scaffold (`MOCK_TIMELINE`, a hard-coded array nothing in
// production imported).
//
// THE LICENSING HARD-BLOCK (this WP's named critical-failure condition, §0.4 rule 2 / §13.3 "the
// insurance-recommendation content class is hard-blocked at the CFE regardless of score"): this
// module NEVER re-implements the block — it (a) reads the rep's real `LicensingState` from WP11's
// `LicensingService` (CONSUMED, never duplicated) and (b) threads it into `UserContext.
// licensing_phase` / `insurance_licensed`, the EXACT fields `src/services/compliance/config/
// classifier-rules.ts` already uses to force `blocked` "regardless of score" for a non-LICENSED
// rep with ANY insurance-recommendation signal. Fail-closed by construction: `getLicensingGateContext`
// defaults to the strictest (most blocking) values on any read gap — see its doc comment.

import { OrgType } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { isPrimericaBranch } from '@/services/onboarding/wp01/org-gate';
import { LicensingService, type LicensingState } from '@/services/compliance/licensing';
import { PrismaLicensingRepository, type LicensingRepository } from '@/services/compliance/licensing/licensing-repository';
import { buildPhasedTimelineResult, milestoneKeyFor, LAUNCH_PHASE_ITEMS, LICENSING_PHASE_ITEMS } from './phase-timeline';
import type { PhasedTimelineResult } from '@/types/taprooting';

export interface TaprootingTimelinePrismaClient {
  user: {
    findUnique(args: { where: { id: string }; select: { org_type: true } }): Promise<{ org_type: OrgType } | null>;
  };
  milestone: {
    findMany(args: {
      where: { user_id: string; milestone_key: { startsWith: string } };
      select: { milestone_key: true; achieved_at: true };
    }): Promise<{ milestone_key: string; achieved_at: Date }[]>;
    upsert(args: {
      where: { user_id_milestone_key: { user_id: string; milestone_key: string } };
      create: { user_id: string; milestone_key: string };
      update: Record<string, never>;
    }): Promise<unknown>;
  };
}

const ALL_ITEM_KEYS = {
  launch: LAUNCH_PHASE_ITEMS.map((i) => i.key),
  licensing: LICENSING_PHASE_ITEMS.map((i) => i.key),
};

/**
 * Reads the rep's real, per-jurisdiction-strictest `LicensingState` from WP11's LicensingService
 * (fail-closed default UNLICENSED with no record — see that module's own doc comment) and derives
 * the exact CFE `UserContext` fields the insurance hard-block reads. `licensing_phase` is `true`
 * for EVERY non-LICENSED state (not merely "while the phase-2 UI is unlocked") — deliberately more
 * conservative than gating strictly on the timeline UI's own unlock state, so a rep cannot dodge
 * the block by being stuck in phase 1.
 */
export async function getInsuranceContentGateContext(
  userId: string,
  licensingService: LicensingService
): Promise<{ licensing_phase: boolean; insurance_licensed: boolean; licensingState: LicensingState }> {
  const licensingState = await licensingService.getEffectiveState(userId);
  return {
    licensing_phase: licensingState !== 'LICENSED',
    insurance_licensed: licensingState === 'LICENSED',
    licensingState,
  };
}

/** Builds a real `LicensingService` wired to the shared Prisma repository. Call this INSIDE a
 *  request handler (never at module scope, per §0.4 rule 2) — constructing it does no I/O and
 *  reads no secret itself, but keeping construction lazy matches this codebase's blanket
 *  lazy-instantiation convention for every service that ultimately touches the database. */
export function buildLicensingService(db: unknown = prisma): LicensingService {
  const repository: LicensingRepository = new PrismaLicensingRepository(db as ConstructorParameters<typeof PrismaLicensingRepository>[0]);
  return new LicensingService(repository, []);
}

export async function getPhasedTimeline(
  userId: string,
  licensingService: LicensingService,
  db: TaprootingTimelinePrismaClient = prisma as unknown as TaprootingTimelinePrismaClient
): Promise<PhasedTimelineResult> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { org_type: true } });
  const branch: 'primerica' | 'universal' = user && isPrimericaBranch(user.org_type) ? 'primerica' : 'universal';

  const { licensingState } = await getInsuranceContentGateContext(userId, licensingService);

  if (branch === 'universal') {
    return buildPhasedTimelineResult('universal', new Set(), new Map(), licensingState);
  }

  const rows = await db.milestone.findMany({
    where: { user_id: userId, milestone_key: { startsWith: 'wp08_timeline_' } },
    select: { milestone_key: true, achieved_at: true },
  });
  const achievedKeys = new Set(rows.map((r) => r.milestone_key));
  const achievedAtByKey = new Map(rows.map((r) => [r.milestone_key, r.achieved_at.toISOString()]));

  return buildPhasedTimelineResult('primerica', achievedKeys, achievedAtByKey, licensingState);
}

export type MarkChecklistItemOutcome =
  | { ok: true }
  | { ok: false; reason: 'unknown_item' | 'not_attested' | 'phase_locked' };

/**
 * Records a rep's self-attestation for one §13.3 checklist item (§13.3's genuinely third-party-only
 * bullets — "IBA filed", "10 members identified", etc. — see phase-timeline.ts's module doc for why
 * this is an honest attested checkbox, not a stub). `auto`-mode items are REJECTED here — they may
 * only be recorded by the real detector in milestone-detection.service.ts, never self-attested,
 * so a rep cannot tap a button to fake completing the Harvest Method.
 */
export async function markChecklistItemAttested(
  userId: string,
  phase: 'launch' | 'licensing',
  itemKey: string,
  db: TaprootingTimelinePrismaClient = prisma as unknown as TaprootingTimelinePrismaClient
): Promise<MarkChecklistItemOutcome> {
  const defs = phase === 'launch' ? LAUNCH_PHASE_ITEMS : LICENSING_PHASE_ITEMS;
  const def = defs.find((d) => d.key === itemKey);
  if (!def) return { ok: false, reason: 'unknown_item' };
  if (def.detectionMode !== 'attested') return { ok: false, reason: 'not_attested' };

  if (phase === 'licensing') {
    const launchDone = await allItemsDone(userId, 'launch', db);
    if (!launchDone) return { ok: false, reason: 'phase_locked' };
  }

  const milestoneKey = milestoneKeyFor(phase, itemKey);
  await db.milestone.upsert({
    where: { user_id_milestone_key: { user_id: userId, milestone_key: milestoneKey } },
    create: { user_id: userId, milestone_key: milestoneKey },
    update: {},
  });
  return { ok: true };
}

async function allItemsDone(userId: string, phase: 'launch' | 'licensing', db: TaprootingTimelinePrismaClient): Promise<boolean> {
  const rows = await db.milestone.findMany({
    where: { user_id: userId, milestone_key: { startsWith: `wp08_timeline_${phase}_` } },
    select: { milestone_key: true, achieved_at: true },
  });
  const achieved = new Set(rows.map((r) => r.milestone_key));
  return ALL_ITEM_KEYS[phase].every((key) => achieved.has(milestoneKeyFor(phase, key)));
}
