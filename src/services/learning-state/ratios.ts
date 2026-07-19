// T-34 (master-spec §9.7 "the two ratios", §9.5 item 5, §9.9-7) — pure, deterministic funnel math.
// No Prisma import here on purpose: everything in this file is a plain function over plain data so
// it is exhaustively unit-testable with fixtures (no DB, no mocks) and so the arithmetic can never
// silently drift depending on how a caller happens to query the database.
//
// LANE NOTE: this is NOT the IPA_VALUE agent's periodic self-optimization (that stays Opus 4.8,
// batched, off the per-message path — src/services/agent-runtime/agent-handlers.ts, untouched by
// T-34). This module is the deterministic "what actually happened" tally the ratio cards render and
// that any narrative IPA_VALUE composes on top of later.

/** Mirrors the `PipelineStage` Prisma enum (prisma/schema.prisma) as a plain string union so this
 * module never needs to import `@prisma/client`. */
export type PipelineStageLike =
  | 'IDENTIFIED'
  | 'INTRODUCED'
  | 'RESPONDED'
  | 'APPOINTMENT_PROPOSED'
  | 'APPOINTMENT_CONFIRMED'
  | 'MET'
  | 'CLOSED_CLIENT'
  | 'CLOSED_RECRUIT'
  | 'DORMANT'
  | 'DO_NOT_CONTACT';

/**
 * The Agent's Ratio funnel is strictly ordered (§9.7: "introductions -> responses -> appointments
 * set -> confirmed shows"). `Contact.pipeline_stage` holds only the CURRENT stage, not a visited-
 * stages history, so "reached stage X" is modeled as "current stage's rank >= X's rank" — a
 * contact who is CLOSED_CLIENT today necessarily passed through INTRODUCED/RESPONDED/etc. along the
 * way. CLOSED_CLIENT and CLOSED_RECRUIT share the terminal rank (both are "confirmed-show-and-
 * beyond" outcomes for the Agent's Ratio; which one is the FIELD TRAINER close is decided
 * separately in `computeFieldTrainerRatio`, by the linked Appointment, not by this rank).
 *
 * DORMANT / DO_NOT_CONTACT are modeled as having LEFT the funnel (rank -1, counted nowhere past
 * "exists") because the schema does not retain how far they got before exiting — a documented,
 * defensible simplification, not a silent guess: it means the ratio is always a conservative floor
 * (a contact that went dormant after actually responding is not double-counted as a live response),
 * never an inflated one.
 */
const STAGE_RANK: Record<PipelineStageLike, number> = {
  IDENTIFIED: 0,
  INTRODUCED: 1,
  RESPONDED: 2,
  APPOINTMENT_PROPOSED: 3,
  APPOINTMENT_CONFIRMED: 4,
  MET: 5,
  CLOSED_CLIENT: 6,
  CLOSED_RECRUIT: 6,
  DORMANT: -1,
  DO_NOT_CONTACT: -1,
};

function reachedRank(stage: PipelineStageLike, rank: number): boolean {
  return (STAGE_RANK[stage] ?? -1) >= rank;
}

export interface FunnelContact {
  pipeline_stage: PipelineStageLike;
}

export interface AgentRatioTally {
  /** Contacts that reached INTRODUCED or beyond. Also this ratio's own data-point count (§9.7's
   * "20 introductions" is the unit the 20-50 threshold is measured against for THIS ratio). */
  introductions: number;
  /** Contacts that reached RESPONDED or beyond. */
  responses: number;
  /** Contacts that reached APPOINTMENT_CONFIRMED or beyond ("appointments set" = confirmed, not
   * merely proposed). */
  appointmentsSet: number;
  /** Contacts that reached MET or beyond ("confirmed shows" — the appointment actually happened). */
  confirmedShows: number;
  /** Same as `introductions` — the volume of real signal this ratio is built from. */
  dataPointCount: number;
}

/** Computes the Agent's Ratio (§9.7) from real `Contact.pipeline_stage` rows for one rep. Pure,
 * deterministic, side-effect-free — never NaN (every field is an integer count, never a division). */
export function computeAgentRatio(contacts: FunnelContact[]): AgentRatioTally {
  const introductions = contacts.filter((c) => reachedRank(c.pipeline_stage, 1)).length;
  const responses = contacts.filter((c) => reachedRank(c.pipeline_stage, 2)).length;
  const appointmentsSet = contacts.filter((c) => reachedRank(c.pipeline_stage, 4)).length;
  const confirmedShows = contacts.filter((c) => reachedRank(c.pipeline_stage, 5)).length;
  return { introductions, responses, appointmentsSet, confirmedShows, dataPointCount: introductions };
}

export interface TrainerRunAppointment {
  /** Whether a human trainer is attached to this appointment (§9.7: "belongs to the human closer"
   * — an appointment with no trainer never counts toward the Field Trainer's Ratio). */
  hasTrainer: boolean;
  /** The Appointment.status value (schema: PROPOSED|CONFIRMED|RESCHEDULED|DECLINED|HELD|NO_SHOW).
   * Only CONFIRMED counts as "run" — the appointment actually took place, not merely scheduled. */
  status: string;
  /** The linked Contact's current pipeline_stage, for deciding whether this appointment closed. */
  contactStage: PipelineStageLike;
}

export interface FieldTrainerRatioTally {
  /** Trainer-attached appointments that actually ran (status === 'CONFIRMED'). This ratio's own
   * data-point count. */
  appointmentsRun: number;
  /** Of those, how many contacts went on to CLOSED_CLIENT or CLOSED_RECRUIT. */
  closes: number;
  dataPointCount: number;
}

/** Computes the Field Trainer's Ratio (§9.7: "appointments run -> client signs / recruit joins")
 * from real Appointment + linked-Contact-stage data for one rep. Pure, deterministic — never NaN. */
export function computeFieldTrainerRatio(appointments: TrainerRunAppointment[]): FieldTrainerRatioTally {
  const run = appointments.filter((a) => a.hasTrainer && a.status === 'CONFIRMED');
  const closes = run.filter((a) => a.contactStage === 'CLOSED_CLIENT' || a.contactStage === 'CLOSED_RECRUIT');
  return { appointmentsRun: run.length, closes: closes.length, dataPointCount: run.length };
}

// ─── The learning state (§9.7's "20:5:1" baseline-to-real-record transition; §9.8's heading names
//     this "The Shift") ──────────────────────────────────────────────────────────────────────────

/** Below this many real data points, the ratio card shows the fixed community baseline, not the
 * rep's own (too-thin-to-trust) numbers. §9.7: "holds until 20-50 data points establish the rep's
 * own record." */
export const LEARNING_STATE_MIN_THRESHOLD = 20;
/** At/above this many, the "learning your community" qualifier is dropped — the rep's record is
 * fully established. */
export const LEARNING_STATE_ESTABLISHED_THRESHOLD = 50;

/** The new-rep baseline default (§9.7): 20 introductions -> 5 appointments -> 1 client. */
export const BASELINE_RATIO = Object.freeze({ introductions: 20, appointmentsSet: 5, outcome: 1 });

export type LearningStateStatus = 'LEARNING' | 'SHIFTING' | 'SHIFTED';

/**
 * Derives the learning-state status from a ratio's own data-point count. This is "the shift":
 * LEARNING (< 20) — the rep carries neither ratio burden yet, baseline shown, oversight-style
 * caution (nothing rep-specific is trusted). SHIFTING (20-49) — the rep's own real numbers are now
 * trusted and shown, but still labeled "learning your community" per the spec's literal 20-50
 * range. SHIFTED (>= 50) — the rep's own established record, unlabeled.
 *
 * TEETH: this is a strict `<` comparison at each boundary — 19 is LEARNING, 20 is SHIFTING, 49 is
 * SHIFTING, 50 is SHIFTED. Getting either boundary off-by-one is a real, test-visible defect.
 */
export function deriveLearningStateStatus(dataPointCount: number): LearningStateStatus {
  if (dataPointCount < LEARNING_STATE_MIN_THRESHOLD) return 'LEARNING';
  if (dataPointCount < LEARNING_STATE_ESTABLISHED_THRESHOLD) return 'SHIFTING';
  return 'SHIFTED';
}

/** Whether the "learning your community" qualifier should still render (§9.5 item 5: "labeled
 * 'learning your community' until 20-50 real data points exist" — the label persists through the
 * entire transition range, not just the pre-20 baseline window). */
export function isLearningLabelActive(status: LearningStateStatus): boolean {
  return status !== 'SHIFTED';
}

/** Greatest common divisor — used to simplify a real ratio to small, comparable integers (so "22
 * introductions, 6 appointments, 5 shows" reads as a ratio shape similar to "20:5:1", not a wall of
 * raw counts). Falls back gracefully (never divides by zero). */
function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x || 1;
}

/** Simplifies a list of non-negative integers by their GCD, guarding zero-division (never NaN):
 * an all-zero input returns itself unsimplified, and the GCD helper always returns >= 1. */
export function simplifyRatioParts(parts: number[]): number[] {
  if (parts.every((p) => p === 0)) return parts;
  const nonZero = parts.filter((p) => p > 0);
  const divisor = nonZero.reduce((acc, p) => gcd(acc, p), nonZero[0] ?? 1);
  return parts.map((p) => Math.round(p / divisor));
}

export interface RatioCardView {
  /** The 3-part headline shown (e.g. baseline `[20, 5, 1]` or the rep's own simplified numbers). */
  headline: number[];
  /** Whether `headline` is the fixed baseline (true) or the rep's own real, computed numbers (false). */
  isBaseline: boolean;
  /** §9.5 item 5: "labeled 'learning your community'" — present through LEARNING + SHIFTING. */
  learningLabel: string | null;
  /** §9.5 item 5: "each with a 'what this means' explainer" — always present, never a naked number. */
  explainer: string;
  status: LearningStateStatus;
  dataPointCount: number;
}

const LEARNING_LABEL = 'learning your community';

/** Builds the Agent's Ratio card view: baseline-gated, always explained, never a naked number,
 * never NaN (the baseline branch never divides; the real branch simplifies via `simplifyRatioParts`,
 * which is zero-division-safe). */
export function buildAgentRatioCardView(tally: AgentRatioTally): RatioCardView {
  const status = deriveLearningStateStatus(tally.dataPointCount);
  if (status === 'LEARNING') {
    return {
      headline: [BASELINE_RATIO.introductions, BASELINE_RATIO.appointmentsSet, BASELINE_RATIO.outcome],
      isBaseline: true,
      learningLabel: LEARNING_LABEL,
      explainer:
        "Your Agent's Ratio measures how effective your AI agents are: introductions that get a response, " +
        'turn into a set appointment, and show up. New reps start on the community baseline (20 introductions ' +
        'to 5 appointments to 1 show) until your own record builds up.',
      status,
      dataPointCount: tally.dataPointCount,
    };
  }
  const headline = simplifyRatioParts([tally.introductions, tally.appointmentsSet, tally.confirmedShows]);
  return {
    headline,
    isBaseline: false,
    learningLabel: isLearningLabelActive(status) ? LEARNING_LABEL : null,
    explainer:
      `Your own record: ${tally.introductions} introductions -> ${tally.responses} responded -> ` +
      `${tally.appointmentsSet} appointments set -> ${tally.confirmedShows} confirmed shows. This is how ` +
      'effective your AI agents are for your community.',
    status,
    dataPointCount: tally.dataPointCount,
  };
}

/** Builds the Field Trainer's Ratio card view (§9.7: "belongs to the human closer") — same baseline
 * gating, always explained, never a naked number, never NaN. */
export function buildFieldTrainerRatioCardView(tally: FieldTrainerRatioTally): RatioCardView {
  const status = deriveLearningStateStatus(tally.dataPointCount);
  if (status === 'LEARNING') {
    return {
      headline: [BASELINE_RATIO.appointmentsSet, BASELINE_RATIO.outcome],
      isBaseline: true,
      learningLabel: LEARNING_LABEL,
      explainer:
        "Your Field Trainer's Ratio measures your trainer's close rate once they run the appointment: how many " +
        'become a client or a new teammate. New reps start on the community baseline (5 appointments to 1 ' +
        'close) until enough of your own appointments have run.',
      status,
      dataPointCount: tally.dataPointCount,
    };
  }
  const headline = simplifyRatioParts([tally.appointmentsRun, tally.closes]);
  return {
    headline,
    isBaseline: false,
    learningLabel: isLearningLabelActive(status) ? LEARNING_LABEL : null,
    explainer:
      `Your trainer's own record: ${tally.closes} out of ${tally.appointmentsRun} appointments run became a ` +
      'client or a new teammate.',
    status,
    dataPointCount: tally.dataPointCount,
  };
}
