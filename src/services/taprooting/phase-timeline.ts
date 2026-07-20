// WP08 §13.3 — the phased new-member timeline: "content unlocks by activity completion, not
// elapsed time." Pure logic — no I/O, no calendar dates read anywhere in this module (the "Days
// 1-7" / "Days 8-30" labels in the master spec name the ROUGH real-world window a rep is normally
// in during each phase, but gating here is 100% activity-completion-driven, never
// `Date.now() - startedAt`; a rep who finishes phase-1's checklist on day 2 unlocks phase 2 on day
// 2, and a rep stuck on day 40 stays phase-1-gated).
//
// Each checklist item is either:
//   - `auto` — detected from a REAL existing signal elsewhere in the app (Harvest Method
//     completion, a sent/approved introduction, the onboarding intensity selection, or the WP11
//     licensing state machine itself) — never re-implemented here, only consumed (the detector
//     lives in milestone-detection.service.ts, which has DB access; this module only defines WHICH
//     Milestone `milestone_key` each item corresponds to).
//   - `attested` — a handful of §13.3 bullets are genuinely paperwork the rep files with a THIRD
//     PARTY the app has no API into (e.g. "IBA filed" is filed with Primerica/state regulators,
//     not with this app) — a rep-attested checkbox is the honest design here (this codebase already
//     uses the identical pattern for the onboarding solution-number field: "Not verified — we check
//     the format only, not with Primerica," src/services/onboarding/wp01/org-gate.ts), not a stub.

import type { LicensingState } from '@/types/licensing';
import type { PhasedTimelineResult, TimelineChecklistItem, TimelinePhase } from '@/types/taprooting';

export const MILESTONE_KEY_PREFIX = 'wp08_timeline_';

export interface ChecklistItemDefinition {
  key: string;
  label: string;
  detectionMode: 'auto' | 'attested';
}

/** §13.3 "Days 1-7 (Launch)" bullet list, in order. */
export const LAUNCH_PHASE_ITEMS: readonly ChecklistItemDefinition[] = [
  { key: 'iba_filed', label: 'IBA filed / POL registered', detectionMode: 'attested' },
  { key: 'phone_list_uploaded', label: 'Phone list uploaded (Hidden Earnings generated)', detectionMode: 'attested' },
  { key: 'harvest_method_completed', label: 'Harvest Method completed', detectionMode: 'auto' },
  { key: 'first_intro_sent', label: 'First community introduction sent', detectionMode: 'auto' },
  { key: 'ten_identified', label: '10 members identified for kitchen-table conversations', detectionMode: 'attested' },
  { key: 'opportunity_invites_sent', label: 'Opportunity-meeting invites sent', detectionMode: 'attested' },
  { key: 'intensity_selected', label: 'Intensity selected', detectionMode: 'auto' },
  { key: 'countdown_running', label: 'The 48-hour countdown running', detectionMode: 'attested' },
];

/** §13.3 "Days 8-30 (Licensing)" bullet list, in order. */
export const LICENSING_PHASE_ITEMS: readonly ChecklistItemDefinition[] = [
  { key: 'pfsu_enrolled', label: 'PFSU enrollment tracked', detectionMode: 'attested' },
  { key: 'prelicensing_completion_nudged', label: 'Pre-licensing completion', detectionMode: 'auto' },
  { key: 'exam_scheduled', label: 'State-exam scheduling', detectionMode: 'attested' },
  { key: 'objection_tree_reviewed', label: 'Objection tree reviewed', detectionMode: 'attested' },
  { key: 'team_calendar_live', label: 'Team calendar live', detectionMode: 'attested' },
  { key: 'licensed', label: 'State license obtained', detectionMode: 'auto' },
];

export function milestoneKeyFor(phase: 'launch' | 'licensing', itemKey: string): string {
  return `${MILESTONE_KEY_PREFIX}${phase}_${itemKey}`;
}

function buildPhase(
  phaseKey: 'launch' | 'licensing',
  label: string,
  defs: readonly ChecklistItemDefinition[],
  achievedKeys: ReadonlySet<string>,
  achievedAtByKey: ReadonlyMap<string, string>,
  unlocked: boolean
): TimelinePhase {
  const items: TimelineChecklistItem[] = defs.map((def) => {
    const milestoneKey = milestoneKeyFor(phaseKey, def.key);
    const done = achievedKeys.has(milestoneKey);
    return {
      key: def.key,
      label: def.label,
      done,
      detectionMode: def.detectionMode,
      achievedAt: achievedAtByKey.get(milestoneKey) ?? null,
    };
  });
  const complete = items.every((i) => i.done);
  return { key: phaseKey, label, complete, unlocked, items };
}

/**
 * Assembles the two-phase timeline for a Primerica rep. `achievedMilestoneKeys` is the set of
 * `wp08_timeline_*` Milestone rows already recorded for this user (real DB read, done by the
 * caller); this function is pure given that snapshot. Phase 2 (`licensing`) unlocks ONLY when
 * phase 1 (`launch`) is complete (§13.3 "Next-phase content unlocks only when the prior benchmarks
 * are met") — never on elapsed calendar time.
 */
export function buildPhasedTimeline(
  achievedMilestoneKeys: ReadonlySet<string>,
  achievedAtByKey: ReadonlyMap<string, string>,
  licensingState: LicensingState
): { phases: TimelinePhase[]; insuranceHardBlockActive: boolean } {
  const launch = buildPhase('launch', 'Days 1-7: Launch', LAUNCH_PHASE_ITEMS, achievedMilestoneKeys, achievedAtByKey, true);
  const licensing = buildPhase(
    'licensing',
    'Days 8-30: Licensing',
    LICENSING_PHASE_ITEMS,
    achievedMilestoneKeys,
    achievedAtByKey,
    launch.complete
  );

  // §13.3/§5.5: hard-blocked "regardless of score" for the ENTIRE time a rep has not yet reached
  // LICENSED — this is the exact flag classifier-rules.ts's `insuranceLicensed` check already
  // consumes (`ctx.insurance_licensed === true && ctx.licensing_phase !== true`), so setting this
  // true for every non-LICENSED state (not merely "while phase 2 is unlocked") is deliberately
  // MORE conservative than "only during phase 2" — an unlicensed rep who has not even reached
  // phase 2 yet must never be able to bypass the block by virtue of being "still in phase 1."
  const insuranceHardBlockActive = licensingState !== 'LICENSED';

  return { phases: [launch, licensing], insuranceHardBlockActive };
}

/** Assembles the full §13.6-3 result, including the universal (non-Primerica) branch's contract:
 *  "Primerica UI/logic is fully invisible in non-Primerica workspaces" — `phases: []`, no
 *  Primerica-gated strings anywhere in the payload. */
export function buildPhasedTimelineResult(
  branch: 'primerica' | 'universal',
  achievedMilestoneKeys: ReadonlySet<string>,
  achievedAtByKey: ReadonlyMap<string, string>,
  licensingState: LicensingState
): PhasedTimelineResult {
  if (branch === 'universal') {
    return { branch, phases: [], insuranceHardBlockActive: false, licensingState };
  }
  const { phases, insuranceHardBlockActive } = buildPhasedTimeline(achievedMilestoneKeys, achievedAtByKey, licensingState);
  return { branch, phases, insuranceHardBlockActive, licensingState };
}
