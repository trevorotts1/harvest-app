// WP01 §6.4 — Seven Whys (Flow C): types for the Sonnet-5 conversation engine.
//
// This is the ENGINE layer T-18 builds: a guided, one-question-per-turn conversation that surfaces
// the rep's deep motivation, gated by an INVISIBLE >70 resonance score (never rendered to the user
// as a number — a low score renders as a caring re-prompt, never a failure), ending in a composed
// anchor statement stored on `WhySession` with `use_in_outreach_consent` defaulting false.
//
// Deeper screens (the Focus Shell chat UI, the composition reveal) are T-20; this module defines the
// state + rendered-turn shape T-20's UI consumes, plus the engine that produces it.

/**
 * The seven levels, in the exact order master-spec §6.4 names them. This ordering is load-bearing:
 * the engine advances through it one level at a time and the UI's seven-seed progress row (uiux
 * §5.1 O-5) fills in this order.
 */
export enum SevenWhysLevel {
  GOAL = 'GOAL',
  URGENCY = 'URGENCY',
  HISTORY = 'HISTORY',
  CHALLENGE = 'CHALLENGE',
  FEAR = 'FEAR',
  TRANSFORMATION = 'TRANSFORMATION',
  COMMITMENT = 'COMMITMENT',
}

export const SEVEN_WHYS_LEVELS: readonly SevenWhysLevel[] = [
  SevenWhysLevel.GOAL,
  SevenWhysLevel.URGENCY,
  SevenWhysLevel.HISTORY,
  SevenWhysLevel.CHALLENGE,
  SevenWhysLevel.FEAR,
  SevenWhysLevel.TRANSFORMATION,
  SevenWhysLevel.COMMITMENT,
] as const;

export const FIRST_SEVEN_WHYS_LEVEL: SevenWhysLevel = SEVEN_WHYS_LEVELS[0];
export const LAST_SEVEN_WHYS_LEVEL: SevenWhysLevel = SEVEN_WHYS_LEVELS[SEVEN_WHYS_LEVELS.length - 1];

/** §6.4: "A resonance score (0–100) is computed; > 70 required to complete." Strictly greater-than. */
export const SEVEN_WHYS_RESONANCE_GATE = 70;

/**
 * Runtime model id for the Seven Whys conversation (§4.4: "Seven Whys conversational coaching" runs
 * on Sonnet 5). Claude-only (§0.3) — this is the ONLY model the conversation/anchor-composition path
 * targets; a missing credential fails the call (never silently falls back to a non-Claude provider,
 * never to Haiku for this quality- and doctrine-sensitive workload).
 */
export const SEVEN_WHYS_MODEL_ID = 'claude-sonnet-5';

/** One turn of the recorded transcript for a single level. */
export interface SevenWhysLevelRecord {
  /** The question asked at this level (the one the rep is answering / just answered). */
  question: string;
  /** The rep's answer, once given. Undefined while the level is still open/unanswered. */
  answer?: string;
  /**
   * Hidden 0–1 depth/resonance signal for `answer`, as assessed by the conversation client. This is
   * server-side-only state: it is never included on `SevenWhysRenderedTurn` (the payload any
   * caller/UI receives) and never printed as a number anywhere the rep can see it (§6.4, uiux
   * AC-5.1-4). Undefined until the level has been answered and assessed.
   */
  depthSignal?: number;
}

export type SevenWhysConversationStatus = 'IN_PROGRESS' | 'AWAITING_DEEPER_ANSWER' | 'COMPLETE';

/**
 * The full engine state for one rep's Seven Whys conversation. This is server-side state — it
 * carries the hidden `depthSignal`s and the aggregated `resonanceScore`, neither of which may ever
 * be forwarded to a rendered/emitted payload (see `SevenWhysRenderedTurn` below, which structurally
 * has no such field).
 */
export interface SevenWhysConversationState {
  userId: string;
  levels: Partial<Record<SevenWhysLevel, SevenWhysLevelRecord>>;
  /** Index into `SEVEN_WHYS_LEVELS` of the level currently open (unanswered) or awaiting a deeper answer. */
  currentLevelIndex: number;
  status: SevenWhysConversationStatus;
  /**
   * Set only while `status === 'AWAITING_DEEPER_ANSWER'` — always `LAST_SEVEN_WHYS_LEVEL` in this
   * engine's design (the gate is evaluated once, at the completion attempt after COMMITMENT is
   * first answered; a re-prompt stays at that same point rather than reopening an earlier level).
   */
  deepenLevel?: SevenWhysLevel;
  /**
   * The hidden 0–100 completion-gate score (§6.4). Present once the completion gate has been
   * evaluated at least once. NEVER copy this onto a rendered/emitted payload.
   */
  resonanceScore?: number;
  /** Present once `status === 'COMPLETE'`. */
  anchorStatement?: string;
  /** Optional why-photo pointer, set by the UI's photo picker (T-20) before/at completion. */
  whyPhotoRef?: string;
}

/** One (level, question, answer) triple — the shape the conversation client sees as context. */
export interface SevenWhysTranscriptEntry {
  level: SevenWhysLevel;
  question: string;
  answer: string | null;
}

/**
 * The ONLY payload shape a caller (API route, UI, test) may render/emit for a turn. This type is the
 * enforcement point for the "invisible gate" requirement: it structurally has no score/resonance
 * field of any kind. A low score never surfaces as a failure — `reprompt` is a caring re-ask, not a
 * rejection, and there is no boolean anywhere named `failed`/`blocked`/`invalid`.
 */
export interface SevenWhysRenderedTurn {
  /** Levels whose seed has FILLED (fully answered and passed) — uiux §5.1 O-5 seven-seed row. */
  filledLevels: SevenWhysLevel[];
  /** The level whose seed PULSES instead of filling — set only during a caring re-prompt. */
  pulsingLevel: SevenWhysLevel | null;
  /** The single next question for this turn. Null only when `complete === true`. */
  question: string | null;
  /** Reflective acknowledgment of the rep's just-given answer. Null on the very first turn. */
  acknowledgment: string | null;
  /** True exactly on the caring re-prompt path (§6.4: "asks a deeper, caring prompt ... re-analyzes"). */
  reprompt: boolean;
  /** True once the anchor statement has been composed. */
  complete: boolean;
  /** Present only when `complete === true`. */
  anchorStatement: string | null;
}

/** Request into the conversation client for a single turn (one Claude call covers both directions). */
export interface SevenWhysConverseRequest {
  /** The level whose answer is being processed this turn. Null only on the very first call. */
  respondingToLevel: SevenWhysLevel | null;
  /** The rep's answer to `respondingToLevel`'s question. Null only on the very first call. */
  answer: string | null;
  /** The level the next question should address (equals `respondingToLevel` again when deepening). */
  nextLevel: SevenWhysLevel;
  /** True when this turn is a caring re-prompt at the same level (the >70 gate has not yet passed). */
  isDeepening: boolean;
  /** Full transcript so far, for laddering/context — the model sees history, the rep sees one question. */
  transcript: SevenWhysTranscriptEntry[];
}

export interface SevenWhysConverseResult {
  /** Reflective acknowledgment of the just-given answer; null on the very first call. */
  acknowledgment: string | null;
  /** The single next (or deepening) question. */
  question: string;
  /**
   * Hidden 0..1 resonance/depth signal for `answer` (meaningless — treat as 0 — when `answer` was
   * null on the request, i.e. the very first call).
   */
  depthSignal: number;
}

/** Request into the client's dedicated anchor-composition call (§6.4 build item 3). */
export interface SevenWhysAnchorRequest {
  transcript: SevenWhysTranscriptEntry[];
}

export interface SevenWhysAnchorResult {
  anchorStatement: string;
}

/** Structured-output schema for the per-turn conversation call (mirrors the CFE classifier pattern). */
export const SEVEN_WHYS_TURN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    acknowledgment: { type: ['string', 'null'] },
    question: { type: 'string' },
    depth_signal: { type: 'number' },
  },
  required: ['acknowledgment', 'question', 'depth_signal'],
} as const;

/** Structured-output schema for the anchor-composition call. */
export const SEVEN_WHYS_ANCHOR_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    anchor_statement: { type: 'string' },
  },
  required: ['anchor_statement'],
} as const;

export function clampUnit(n: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
