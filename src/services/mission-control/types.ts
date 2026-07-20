// WP04 (T-32) — Mission Control / Today: shared zone types (master-spec §9.5, uiux §5.2/§3).
//
// Every zone is fetched and rendered INDEPENDENTLY (master-spec §9.5 "one zone failing must NOT
// take down the others"; uiux AC-5.2-6 "Zone failures are independent — a briefing error never
// blanks the queue"). `ZoneResult<T>` is the uniform envelope every zone builder returns — `ok`
// carries real data, `error` carries a safe, human, non-leaking message the UI renders as that
// zone's OWN error/empty state while its five siblings keep working. See today.service.ts's
// `safeZone` for the architectural guarantee (each zone's fetch is wrapped separately — there is no
// shared try/catch and no zone reuses another zone's query, so one throwing cannot affect another).
export type ZoneResult<T> = { status: 'ok'; data: T } | { status: 'error'; message: string };

// T-43 (WP07 §12.1) — re-exported here (rather than imported piecemeal at every call site) so this
// file stays the single import surface for every Today zone's data shape, matching the convention
// already established for every other type in this file.
import type { MomentumCriteriaResult } from './momentum';
export type { MomentumCriteriaResult } from './momentum';

/** uiux §3.2 — the Grove's eight named states. A component rendering all eight is AC-3-2. */
export type GroveState =
  | 'seed'
  | 'sprout'
  | 'thriving'
  | 'growing'
  | 'quiet'
  | 'resting'
  | 'bloom'
  | 'stale';

/** uiux §3.1 — the three independently-driven channels, one per Law (AC-3-1). */
export interface LawBreakdown {
  grow: number;
  engage: number;
  wealth: number;
}

export type MomentumBand = 'thriving' | 'growing' | 'quiet' | 'resting';

export interface MomentumResult {
  /** 0-100, the average of the three per-Law scores (never NaN — see momentum.ts clamp). */
  score: number;
  band: MomentumBand;
  /** 7 entries, oldest → newest, each 0-100 (uiux §5.2 "7-day sparkline"). */
  sparkline: number[];
  laws: LawBreakdown;
  totalEventCount: number;
}

// ── Zone 1: Anchor header ───────────────────────────────────────────────────────────────────────
export interface HeaderZoneData {
  greetingName: string;
  momentum: MomentumResult;
  groveState: GroveState;
  groveCaption: string;
  approvalInboxCount: number;
  // T-43 (WP07 §12.1): the ten-criteria breakdown + five-level Downline-Maxxer name, layered on top
  // of `momentum` above (see mission-control/momentum.ts's `computeMomentumCriteria` design note —
  // this is an additive lens, not a second score). Optional so existing hand-built `HeaderZoneData`
  // fixtures (predating T-43) keep compiling; `buildHeaderZone` always populates it in practice.
  momentumCriteria?: MomentumCriteriaResult;
}

// ── Zone 2: Overnight Briefing ──────────────────────────────────────────────────────────────────
export interface BriefingReceipt {
  agentRunId: string;
  agentKey: string;
  agentDisplayName: string;
  action: string;
  when: string; // ISO
  cfeBand: string | null;
}

export interface BriefingLine {
  text: string;
  receipts: BriefingReceipt[];
}

/**
 * `ready` — real overnight activity composed into lines. `first_day` — no AgentRun rows exist yet
 * for this rep (pre-first-action). `agents_resting` — the Claude connection/CFE is down (the latest
 * Reporting run HELD for a no-key/CFE-unavailable reason) — uiux §4.1 "no fabricated content ever"
 * (master spec §18.6). `empty` — agents ran but produced nothing overnight (quiet night, not an
 * error).
 */
export type BriefingState = 'ready' | 'first_day' | 'agents_resting' | 'empty';

export interface BriefingZoneData {
  state: BriefingState;
  /** ISO timestamp of the latest Reporting AgentRun, for the freshness stamp — null pre-first-run. */
  freshnessStamp: string | null;
  lines: BriefingLine[];
}

// ── Zone 3: Action Queue ────────────────────────────────────────────────────────────────────────
export type QueueItemKind = 'approve_draft' | 'review_flagged' | 'confirm_appointment';

export interface QueueItem {
  id: string;
  kind: QueueItemKind;
  title: string;
  why: string;
  contactLabel: string | null;
  minutes: number;
  cfeBand: string | null;
  channel: string | null;
}

export interface ActionQueueZoneData {
  /** Sum of every item's minute estimate — NOT just the visible/capped subset (uiux AC-5.2-3). */
  totalMinutes: number;
  /** Capped at 5 for display; `totalCount` carries the real total for "show all (N)". */
  items: QueueItem[];
  totalCount: number;
}

// ── Zone 4: Pipeline glance ─────────────────────────────────────────────────────────────────────
export type PipelineBucketKey = 'introduced' | 'responded' | 'appointment' | 'closed';

export interface PipelineBucket {
  key: PipelineBucketKey;
  label: string;
  count: number;
  /** Signed. The UI never renders this red (uiux AC-5.2-8) — negative movement reads "needs tending". */
  deltaLast7d: number;
}

export interface PipelineZoneData {
  buckets: PipelineBucket[];
}

// ── Zone 5: Ratio cards ─────────────────────────────────────────────────────────────────────────
export interface RatioTriple {
  a: number;
  b: number;
  c: number;
  labels: [string, string, string];
  /** True until `dataPoints` reaches the learning-state threshold (master spec §9.7: 20-50). */
  learning: boolean;
  dataPoints: number;
}

export interface RatiosZoneData {
  agentRatio: RatioTriple;
  fieldTrainerRatio: RatioTriple;
}

// ── Zone 6: Team calendar strip ─────────────────────────────────────────────────────────────────
export type AttendanceState = 'none' | 'rsvp_yes' | 'rsvp_no' | 'attended' | 'missed';

export interface CalendarEventItem {
  id: string;
  type: string;
  startsAt: string; // ISO
  attendanceState: AttendanceState;
}

export interface CalendarZoneData {
  hasOrg: boolean;
  events: CalendarEventItem[];
}

// ── Zone 7: Milestones (T-43, WP07 §12.3) ──────────────────────────────────────────────────────
import type { MilestonesZoneData } from './zones/milestones';
export type { MilestoneSummary, MilestonesZoneData } from './zones/milestones';

// ── The full Today response ─────────────────────────────────────────────────────────────────────
export interface MissionControlToday {
  generatedAt: string;
  header: ZoneResult<HeaderZoneData>;
  briefing: ZoneResult<BriefingZoneData>;
  actionQueue: ZoneResult<ActionQueueZoneData>;
  pipeline: ZoneResult<PipelineZoneData>;
  ratios: ZoneResult<RatiosZoneData>;
  calendar: ZoneResult<CalendarZoneData>;
  // T-43 (WP07 §12.3): additive 7th zone — the milestone pin strip. Optional so any existing caller
  // that constructs a `MissionControlToday` object by hand (fixtures/tests) keeps compiling.
  milestones?: ZoneResult<MilestonesZoneData>;
}

/** Master spec §9.7 / uiux §4.1: the shared baseline shown as "learning your community" until real
 *  data accumulates. Conservative low end of the spec's stated 20-50 data-point range. */
export const RATIO_LEARNING_THRESHOLD = 20;
export const RATIO_BASELINE: [number, number, number] = [20, 5, 1];
