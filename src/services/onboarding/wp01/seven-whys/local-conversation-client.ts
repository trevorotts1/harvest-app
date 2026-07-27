// WP01 §6.4 — deterministic, offline Seven Whys conversation client (no API key required).
//
// Mirrors `LocalDeterministicClassifierClient` (src/services/compliance/claude/local-classifier-
// client.ts, T-08): this is NOT the production path — production wires `AgnesConversationClient`
// (§4.4, T-R55b). It exists so the engine's turn-by-turn, laddering, and completion-gate logic can be
// exercised in tests and local dev without a live key. It never contacts any provider.

import { estimateDepthSignal } from './resonance';
import {
  SevenWhysAnchorRequest,
  SevenWhysAnchorResult,
  SevenWhysConverseRequest,
  SevenWhysConverseResult,
  SevenWhysLevel,
  SevenWhysTranscriptEntry,
} from './types';
import { SevenWhysConversationClient } from './claude-client';

const BASE_QUESTIONS: Record<SevenWhysLevel, string> = {
  [SevenWhysLevel.GOAL]: "What's the one goal you want The Harvest to help you reach this year?",
  [SevenWhysLevel.URGENCY]: 'Why does reaching that matter to you right now, not just someday?',
  [SevenWhysLevel.HISTORY]:
    "What in your story led you to this moment — what have you already tried or lived through?",
  [SevenWhysLevel.CHALLENGE]: "What's the biggest thing standing between you and that goal today?",
  [SevenWhysLevel.FEAR]: 'What are you afraid will happen if nothing changes?',
  [SevenWhysLevel.TRANSFORMATION]:
    "Who do you become — and whose life changes with you — once you close that gap?",
  [SevenWhysLevel.COMMITMENT]:
    'What are you willing to commit to, starting this week, to make that real?',
};

const DEEPENING_FAMILY_PROMPT = 'Can you say more about the impact on your family?';
const DEEPENING_GENERIC_PROMPT = "Let's stay here a little longer — can you say a bit more?";

const ACK_TEMPLATES = [
  'Thank you for sharing that.',
  "I hear you — that's real.",
  "That says a lot about what you're building toward.",
  'That took something to put into words.',
];

function pickAcknowledgment(transcript: SevenWhysTranscriptEntry[]): string {
  // Deterministic (not random): index by how many turns have happened so far.
  return ACK_TEMPLATES[transcript.length % ACK_TEMPLATES.length];
}

function mentionsFamily(transcript: SevenWhysTranscriptEntry[], latestAnswer: string | null): boolean {
  const familyWords = ['family', 'kids', 'children', 'spouse', 'husband', 'wife', 'mom', 'dad'];
  const haystacks = [latestAnswer ?? '', ...transcript.map((t) => t.answer ?? '')];
  const lower = haystacks.join(' ').toLowerCase();
  return familyWords.some((w) => lower.includes(w));
}

/**
 * A short, laddering follow-up flavor line referencing the prior answer — a deterministic stand-in
 * for what Sonnet 5 would compose from real context. Not shown standalone; the base question for the
 * NEXT level is asked directly (mirroring the one-question-per-turn rule), so this only informs the
 * acknowledgment, keeping the question itself uncluttered.
 */
function ladderingAcknowledgment(priorAnswer: string): string {
  const trimmed = priorAnswer.trim();
  const snippet = trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
  return snippet.length > 0
    ? `Thank you for sharing that — "${snippet}" tells me something real about where you're starting from.`
    : pickAcknowledgment([]);
}

/**
 * Deterministic, offline implementation of `SevenWhysConversationClient` (§6.4). Used by tests and
 * local dev in place of `AgnesConversationClient` (T-R55b) — no live API key required.
 */
export class LocalSevenWhysConversationClient implements SevenWhysConversationClient {
  async converse(req: SevenWhysConverseRequest): Promise<SevenWhysConverseResult> {
    const depthSignal = req.answer !== null ? estimateDepthSignal(req.answer) : 0;

    if (req.isDeepening) {
      const question = mentionsFamily(req.transcript, req.answer)
        ? DEEPENING_GENERIC_PROMPT
        : DEEPENING_FAMILY_PROMPT;
      return {
        acknowledgment: req.answer !== null ? pickAcknowledgment(req.transcript) : null,
        question,
        depthSignal,
      };
    }

    if (req.respondingToLevel === null || req.answer === null) {
      // The very first call: no prior answer to acknowledge, just the opening question.
      return {
        acknowledgment: null,
        question: BASE_QUESTIONS[req.nextLevel],
        depthSignal: 0,
      };
    }

    return {
      acknowledgment: ladderingAcknowledgment(req.answer),
      question: BASE_QUESTIONS[req.nextLevel],
      depthSignal,
    };
  }

  async composeAnchor(req: SevenWhysAnchorRequest): Promise<SevenWhysAnchorResult> {
    const byLevel = new Map(req.transcript.map((t) => [t.level, t.answer ?? '']));
    const goal = (byLevel.get(SevenWhysLevel.GOAL) ?? '').trim();
    const transformation = (byLevel.get(SevenWhysLevel.TRANSFORMATION) ?? '').trim();
    const commitment = (byLevel.get(SevenWhysLevel.COMMITMENT) ?? '').trim();

    const clause = (text: string, maxWords: number): string => {
      const words = text.split(/\s+/).filter(Boolean).slice(0, maxWords);
      return words.join(' ');
    };

    const goalClause = clause(goal, 14) || 'building something that matters';
    const transformClause = clause(transformation, 16) || 'becoming who I know I can be';
    const commitClause = clause(commitment, 12) || 'showing up, every day, starting now';

    const anchorStatement = `I'm building toward ${goalClause}, because it means ${transformClause}. Starting now: ${commitClause}.`;
    return { anchorStatement };
  }
}
