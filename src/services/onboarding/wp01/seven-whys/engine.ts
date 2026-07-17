// WP01 §6.4 — the Seven Whys conversation engine.
//
// Orchestrates: one-question-per-turn progression across the seven levels, the invisible >70
// resonance completion gate (rendered as care, never as a numeric score or a failure), and anchor-
// statement composition once the gate passes. This is the piece uiux §5.1 O-5's Focus Shell chat UI
// (T-20) drives — it consumes `SevenWhysRenderedTurn`, which structurally carries no score.

import { aggregateResonance } from './resonance';
import { SevenWhysConversationClient } from './claude-client';
import { finalizeAnchorStatement } from './anchor';
import {
  FIRST_SEVEN_WHYS_LEVEL,
  LAST_SEVEN_WHYS_LEVEL,
  SEVEN_WHYS_LEVELS,
  SEVEN_WHYS_RESONANCE_GATE,
  SevenWhysConversationState,
  SevenWhysLevel,
  SevenWhysRenderedTurn,
  SevenWhysTranscriptEntry,
} from './types';

/** Extended state carrying the last acknowledgment, so a resumed session can replay it (uiux §5.1 O-5 "resume" state) without a fresh Claude call. */
export interface SevenWhysEngineState extends SevenWhysConversationState {
  lastAcknowledgment?: string | null;
}

export interface SevenWhysTurnOutcome {
  state: SevenWhysEngineState;
  rendered: SevenWhysRenderedTurn;
}

function levelIndex(level: SevenWhysLevel): number {
  return SEVEN_WHYS_LEVELS.indexOf(level);
}

function currentOpenLevel(state: SevenWhysEngineState): SevenWhysLevel {
  if (state.status === 'AWAITING_DEEPER_ANSWER' && state.deepenLevel) {
    return state.deepenLevel;
  }
  return SEVEN_WHYS_LEVELS[state.currentLevelIndex];
}

/** Entries for every level answered so far, in level order, excluding `excludeLevel` if given. */
function buildTranscript(
  state: SevenWhysEngineState,
  excludeLevel?: SevenWhysLevel
): SevenWhysTranscriptEntry[] {
  const entries: SevenWhysTranscriptEntry[] = [];
  for (const level of SEVEN_WHYS_LEVELS) {
    if (level === excludeLevel) continue;
    const record = state.levels[level];
    if (!record || record.answer === undefined) continue;
    entries.push({ level, question: record.question, answer: record.answer });
  }
  return entries;
}

function renderTurn(
  state: SevenWhysEngineState,
  fields: {
    question: string | null;
    acknowledgment: string | null;
    reprompt: boolean;
    complete?: boolean;
  }
): SevenWhysRenderedTurn {
  const filledLevels = SEVEN_WHYS_LEVELS.slice(
    0,
    state.status === 'COMPLETE' ? SEVEN_WHYS_LEVELS.length : state.currentLevelIndex
  );
  return {
    filledLevels,
    pulsingLevel: state.status === 'AWAITING_DEEPER_ANSWER' ? state.deepenLevel ?? null : null,
    question: fields.question,
    acknowledgment: fields.acknowledgment,
    reprompt: fields.reprompt,
    complete: fields.complete ?? state.status === 'COMPLETE',
    anchorStatement: state.status === 'COMPLETE' ? state.anchorStatement ?? null : null,
  };
}

/**
 * Starts a fresh Seven Whys conversation: exactly one question (Goal, level 1) — never all seven at
 * once (§6.4, uiux AC-5.1-4).
 */
export async function startSevenWhys(
  userId: string,
  client: SevenWhysConversationClient
): Promise<SevenWhysTurnOutcome> {
  const result = await client.converse({
    respondingToLevel: null,
    answer: null,
    nextLevel: FIRST_SEVEN_WHYS_LEVEL,
    isDeepening: false,
    transcript: [],
  });

  const state: SevenWhysEngineState = {
    userId,
    levels: { [FIRST_SEVEN_WHYS_LEVEL]: { question: result.question } },
    currentLevelIndex: 0,
    status: 'IN_PROGRESS',
    lastAcknowledgment: null,
  };

  return {
    state,
    rendered: renderTurn(state, { question: result.question, acknowledgment: null, reprompt: false }),
  };
}

/**
 * Replays the current pending turn from persisted state — no Claude call, no state change. This is
 * the resume path (uiux §5.1 O-5 "resume" state: "returning mid-conversation replays the last
 * acknowledgment").
 */
export function renderCurrentTurn(state: SevenWhysEngineState): SevenWhysRenderedTurn {
  const level = currentOpenLevel(state);
  const question = state.status === 'COMPLETE' ? null : state.levels[level]?.question ?? null;
  return renderTurn(state, {
    question,
    acknowledgment: state.lastAcknowledgment ?? null,
    reprompt: state.status === 'AWAITING_DEEPER_ANSWER',
  });
}

/**
 * Records the rep's answer to the currently open level and advances the conversation by exactly one
 * turn (§6.4: one question per turn). At the final level (Commitment), this evaluates the invisible
 * >70 resonance completion gate (§6.4): a passing score composes and stores the anchor statement; a
 * non-passing score renders a caring re-prompt at the same point — never a failure, never a visible
 * number (§6.4, uiux AC-5.1-4) — and re-analyzes on the next answer.
 */
export async function submitSevenWhysAnswer(
  state: SevenWhysEngineState,
  answer: string,
  client: SevenWhysConversationClient
): Promise<SevenWhysTurnOutcome> {
  if (state.status === 'COMPLETE') {
    throw new Error('Seven Whys conversation is already complete; no further answers accepted.');
  }

  const level = currentOpenLevel(state);
  const isDeepening = state.status === 'AWAITING_DEEPER_ANSWER';
  const isLastLevel = level === LAST_SEVEN_WHYS_LEVEL;
  const nextLevelCandidate = isLastLevel ? level : SEVEN_WHYS_LEVELS[levelIndex(level) + 1];

  const transcriptSoFar = buildTranscript(state, level);
  const result = await client.converse({
    respondingToLevel: level,
    answer,
    nextLevel: nextLevelCandidate,
    isDeepening,
    transcript: transcriptSoFar,
  });

  const nextState: SevenWhysEngineState = {
    ...state,
    levels: { ...state.levels },
    lastAcknowledgment: result.acknowledgment,
  };
  nextState.levels[level] = {
    question: nextState.levels[level]?.question ?? '',
    answer,
    depthSignal: result.depthSignal,
  };

  if (!isLastLevel) {
    nextState.currentLevelIndex = levelIndex(level) + 1;
    nextState.status = 'IN_PROGRESS';
    nextState.deepenLevel = undefined;
    nextState.levels[nextLevelCandidate] = { question: result.question };
    return {
      state: nextState,
      rendered: renderTurn(nextState, {
        question: result.question,
        acknowledgment: result.acknowledgment,
        reprompt: false,
      }),
    };
  }

  // Final level answered — evaluate the invisible completion gate (§6.4).
  const signalsByLevel: Partial<Record<SevenWhysLevel, number | undefined>> = {};
  for (const lvl of SEVEN_WHYS_LEVELS) {
    signalsByLevel[lvl] = nextState.levels[lvl]?.depthSignal;
  }
  const resonance = aggregateResonance(signalsByLevel);
  nextState.resonanceScore = resonance; // hidden server-side state only — never rendered

  if (resonance > SEVEN_WHYS_RESONANCE_GATE) {
    const fullTranscript = buildTranscript(nextState);
    const anchorStatement = await finalizeAnchorStatement(client, fullTranscript);
    nextState.status = 'COMPLETE';
    nextState.deepenLevel = undefined;
    nextState.anchorStatement = anchorStatement;
    return {
      state: nextState,
      rendered: renderTurn(nextState, {
        question: null,
        acknowledgment: result.acknowledgment,
        reprompt: false,
        complete: true,
      }),
    };
  }

  // <= 70: a caring re-prompt, never a failure message (§6.4, uiux AC-5.1-4). Stay at the same
  // level; re-analyze on the next answer.
  nextState.status = 'AWAITING_DEEPER_ANSWER';
  nextState.deepenLevel = level;
  nextState.levels[level] = { ...nextState.levels[level]!, question: result.question };
  // currentLevelIndex intentionally stays at the last level's index — that seed pulses, not fills.
  nextState.currentLevelIndex = levelIndex(level);

  return {
    state: nextState,
    rendered: renderTurn(nextState, {
      question: result.question,
      acknowledgment: result.acknowledgment,
      reprompt: true,
      complete: false,
    }),
  };
}
