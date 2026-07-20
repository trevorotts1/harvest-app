// WP08 (master-spec §13, uiux §5.5) — Taprooting / Orchard / phased-timeline domain types.
//
// Replaces the pre-existing mock scaffold (a flat in-memory `MOCK_ORG_TREE` with no DB, no
// org-gating, no CFE, no licensing hard-block — dead code nothing in production imported). This is
// the real, org-scoped, RBAC-safe, Primerica/universal-branched shape the WP08 services below
// build and the `/grow` page renders.

/** §13.1 "node health color-coded by the Three Laws (green active/growth, yellow
 *  stagnant/retention-risk, red reverse-maxxing)". `red` renders as a clay OUTLINE + `flag-caution`
 *  icon + "needs attention" label — clay FILL stays compliance-reserved (uiux AC-5.5-4); the tint
 *  name itself carries no fill/outline decision, that is a rendering-layer rule (grow/page.tsx). */
export type HealthTint = 'green' | 'yellow' | 'red';

export interface NodeHealth {
  tint: HealthTint;
  /** 0-100, from the SAME Three-Law engine the Grove/Mission-Control header uses
   *  (`computeMomentum`, src/services/mission-control/momentum.ts) — never a second scoring model. */
  score: number;
  laws: { grow: number; engage: number; wealth: number };
  /** True when this node has gone > 30 days with no MomentumEvent (§13.4 "stagnation (no advance >
   *  30 days) triggers a re-engagement flow"). Independent of `tint` (a fresh node can be `red`
   *  purely on a low, non-stagnant score; `stagnant` is specifically the elapsed-time signal). */
  stagnant: boolean;
  daysSinceLastActivity: number | null;
}

/** A real recruit node — Primerica orchard tree node OR universal ring node (same underlying
 *  shape; the branch decides which visual the client renders, §13.1/uiux §5.5). Never carries
 *  contact PII or conversation content (§13.5/§16.6) — name + rank + own-activity-derived fields
 *  only. */
export interface OrgTreeNode {
  id: string;
  /** First name + last-initial only (uiux §5.5 "Data" — never a full raw PII surface). */
  displayName: string;
  rank: string | null;
  /** 1 = the tree owner's direct recruit, 2 = their recruit, etc. */
  level: number;
  /** 0-4 steps, own-activity-derived tree/foliage size (§13.1 "trees sized by their own activity"). */
  ownActivitySize: number;
  health: NodeHealth;
  /** True once this recruit has at least one recruit of their own (RoB rule 1). */
  hasOwnRecruit: boolean;
  /** How deep THIS recruit's own downline currently reaches (0 = no recruits yet). */
  ownDepthReached: number;
  /** True once the LEG this node belongs to (traced back to its level-1 ancestor) has reached
   *  depth >= 4 (RoB rule 2) — mirrored onto every edge in a qualified leg. */
  isQualifiedLeg: boolean;
  children: OrgTreeNode[];
}

/** §13.1 "the *potential* state (3 wide × 4 deep) rendered as ghosted seedling silhouettes". Never
 *  counted in totals/chips/math (uiux AC-5.5-2). */
export interface GhostSeedling {
  level: number;
  /** 1-based position within its level's ghost lattice — stable across renders for a11y ("open
   *  position, level N"), not a real id. */
  position: number;
}

export type OrgBranchView = 'primerica' | 'universal';

export interface OrgTreeResult {
  branch: OrgBranchView;
  ownerDisplayName: string;
  ownerRank: string | null;
  /** Real nodes only — depth ≥ 5 for a populated Primerica tree (§13.6-1), up to 10+ (§13.1). */
  nodes: OrgTreeNode[];
  /** Populated ONLY for the Primerica branch (§13.1's 3×4 lattice); always `[]` for universal —
   *  the universal view has "no lattice" by construction (uiux §5.5). */
  ghosts: GhostSeedling[];
  robChips: RulesOfBuildingChips;
  /** Total real-node counts — ghosts excluded by construction (uiux AC-5.5-2). */
  totals: { realNodeCount: number; legCount: number; maxDepth: number };
  /** True when this is a day-one/empty tree (uiux AC-5.5-9) — the caller renders the "Invite your
   *  first" single-action empty state, never a blank canvas. */
  isEmpty: boolean;
  /** RBAC scope this payload was assembled under (§13.5/§16.6) — 'own' for the tree owner viewing
   *  their own tree, 'downline_structure_only' for an upline viewing a report's subtree (never PII/
   *  conversation content either way — the shape itself has no field for those). */
  viewScope: 'own' | 'downline_structure_only';
}

// ─── Rules of Building (§13.2, uiux §4.8) ────────────────────────────────────────────────────────

export type RoBChipState = 'met' | 'countdown' | 'not_started';

export interface RulesOfBuildingChip {
  key: 'recruit_has_recruit' | 'leg_four_deep' | 'team_four_legs' | 'leader_emerged';
  label: string;
  state: RoBChipState;
  /** e.g. "2 of 4 deep", "1 of 4 legs" — the live countdown string computed from real data. */
  countLabel: string;
  current: number;
  target: number;
}

export interface RulesOfBuildingChips {
  chips: RulesOfBuildingChip[];
}

/** §13.2 "Tapping a level reveals the override-income math for that depth, always FTC-safe-harbor-
 *  framed." Structure/potential math only — never a guaranteed-income figure (§0.5). */
export interface OverrideMathSheet {
  depth: number;
  /** Illustrative structure count at this depth under the 3-wide × 4-deep model (real + ghost
   *  combined potential) — a multiplication-table figure, not a dollar promise. */
  potentialTeamSizeAtDepth: number;
  /** A single, clearly-labeled illustrative-only structure narrative — no dollar figure is ever
   *  computed here (there is no comp-plan/commission model in this codebase to source one from
   *  honestly; fabricating one would violate §18.6 "no fabricated content" and §0.5's ban on
   *  "guaranteed income" framing). */
  narrative: string;
  safeHarborDisclaimer: string;
}

// ─── Phased timeline (§13.3) ─────────────────────────────────────────────────────────────────────

export type TimelinePhaseKey = 'launch' | 'licensing';

export type ChecklistDetectionMode = 'auto' | 'attested';

export interface TimelineChecklistItem {
  key: string;
  label: string;
  done: boolean;
  detectionMode: ChecklistDetectionMode;
  achievedAt: string | null;
}

export interface TimelinePhase {
  key: TimelinePhaseKey;
  label: string;
  /** True once every item in this phase is done (activity-gated — never calendar-gated). */
  complete: boolean;
  /** True once this phase's content is visible/actionable — phase 1 is always unlocked; phase 2
   *  unlocks only when phase 1 is complete (§13.3 "Next-phase content unlocks only when the prior
   *  benchmarks are met"). */
  unlocked: boolean;
  items: TimelineChecklistItem[];
}

export interface PhasedTimelineResult {
  branch: OrgBranchView;
  /** `[]` for the universal branch — the phased Primerica timeline is Primerica-gated (§13, §17.1). */
  phases: TimelinePhase[];
  /** §13.3/§5.5: true while the rep is in the Days 8-30 licensing phase and not yet LICENSED — the
   *  exact flag this module threads into `UserContext.licensing_phase` for the CFE (classifier-
   *  rules.ts already hard-blocks insurance content "regardless of score" whenever this is true). */
  insuranceHardBlockActive: boolean;
  licensingState: string;
}

// ─── Milestone detection (§13.4) ─────────────────────────────────────────────────────────────────

export type TaprootMilestoneKind =
  | 'recruit_gained_own_recruit'
  | 'leg_reached_four_deep'
  | 'team_reached_four_legs'
  | 'leader_emerged'
  | 'phase_checklist_item'
  | 'stagnation_reengagement';

export interface DetectedMilestone {
  kind: TaprootMilestoneKind;
  milestoneKey: string;
  userId: string;
  subjectNodeId?: string;
}

// ─── Org switch (§13.5, §18.7) ───────────────────────────────────────────────────────────────────

export interface OrgSwitchResult {
  ok: true;
  fromOrgType: string;
  toOrgType: string;
  archivedEdgeCount: number;
  archivedMilestoneCount: number;
  switchedAt: string;
}

export type OrgSwitchOutcome =
  | OrgSwitchResult
  | { ok: false; reason: 'same_org_type' | 'not_found' };

// ─── Time-lapse share (§13.1, §13.6-7, uiux AC-5.5-5) ────────────────────────────────────────────

export interface TimeLapseShareRequest {
  /** Ordered join-order event sequence — structure/growth only, never income math. */
  events: { level: number; displayName: string; joinedAt: string }[];
}

export type TimeLapseShareOutcome =
  | { allowed: true; exportSummary: string }
  | { allowed: false; reason: 'cfe_held' | 'cfe_blocked'; detail: string };
