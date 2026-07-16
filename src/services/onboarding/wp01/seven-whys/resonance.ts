// WP01 §6.4 — the invisible resonance/depth scoring.
//
// This is the "hidden 0–100 score" the master spec names: it gates COMPLETION (> 70 required) but is
// NEVER rendered to the rep as a number anywhere (see `SevenWhysRenderedTurn` in ./types, which has
// no field for it). Two functions live here:
//
//   estimateDepthSignal  — a deterministic 0..1 heuristic used by the LOCAL conversation client
//                          (./local-conversation-client.ts) to stand in for what a real Sonnet 5
//                          call would self-assess per turn, so tests/dev need no live API key.
//   aggregateResonance   — combines the seven per-level depth signals (each 0..1) into the single
//                          0–100 completion-gate score the engine checks against
//                          SEVEN_WHYS_RESONANCE_GATE.
//
// Both are pure functions with no I/O — easy to unit test in isolation from the engine/client wiring.

import { SEVEN_WHYS_LEVELS, SevenWhysLevel, clampUnit } from './types';

/**
 * Words/phrases that tend to correlate with an emotionally resonant, specific answer (as opposed to
 * a generic, deflecting, or one-word one). Illustrative, not exhaustive — mirrors the CFE's own
 * "detection patterns are illustrative, not exhaustive; rules are parameterized" posture (§5.3).
 */
const RESONANCE_SIGNAL_WORDS = [
  'because',
  'family',
  'kids',
  'children',
  'daughter',
  'son',
  'spouse',
  'husband',
  'wife',
  'mom',
  'dad',
  'parents',
  'scared',
  'afraid',
  'terrified',
  'tired of',
  'never',
  'matter',
  'proud',
  'ashamed',
  'promise',
  'promised',
  'love',
  'freedom',
  'future',
  'sacrifice',
  'lost',
  'watched',
  'grew up',
  'every day',
  'every night',
  'can’t',
  "can't",
  'won’t',
  "won't",
];

/** Very short, deflecting, or filler-only answers never read as resonant regardless of keywords. */
const MIN_MEANINGFUL_WORDS = 4;

function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Deterministic 0..1 depth/resonance estimate for a single answer, given the transcript so far for
 * context (unused by the heuristic today but kept in the signature so a future refinement — e.g.
 * penalizing near-duplicate answers across levels — doesn't need a signature change).
 */
export function estimateDepthSignal(answer: string): number {
  const trimmed = answer.trim();
  if (trimmed.length === 0) return 0;

  const words = wordCount(trimmed);
  if (words < MIN_MEANINGFUL_WORDS) return clampUnit(words / (MIN_MEANINGFUL_WORDS * 4));

  const lower = trimmed.toLowerCase();

  // Length component: longer, more elaborated answers tend to carry more resonance. Saturates at
  // ~25 words — a genuine two-sentence answer, not padding — so a one-line deflection can't win on
  // length alone, but a rep isn't penalized for being economical either.
  const lengthComponent = clampUnit(words / 25);

  // Emotional/specificity-language component: count distinct signal words present, saturate at 2 —
  // a single incidental word shouldn't carry this, but a genuinely resonant answer typically uses
  // more than one.
  let matches = 0;
  for (const signal of RESONANCE_SIGNAL_WORDS) {
    if (lower.includes(signal)) matches += 1;
  }
  const languageComponent = clampUnit(matches / 2);

  // Specificity component: a number or a capitalized word mid-sentence (a name, a place) suggests a
  // concrete, non-generic answer rather than an abstract deflection.
  const hasDigit = /\d/.test(trimmed);
  const hasMidSentenceCapital = /[a-z][.,!?]?\s+[A-Z][a-z]+/.test(trimmed);
  const specificityComponent = hasDigit || hasMidSentenceCapital ? 1 : 0;

  const combined =
    lengthComponent * 0.6 + languageComponent * 0.3 + specificityComponent * 0.1;

  return clampUnit(combined);
}

/**
 * Combine per-level depth signals (0..1 each, indexed by level) into the single 0–100 completion-gate
 * score (§6.4: "A resonance score (0–100) is computed; > 70 required to complete"). Later levels
 * (Fear, Transformation, Commitment) are weighted slightly higher — by the time the rep reaches them
 * they've had five prior levels to warm up, so shallow answers there are a stronger signal that the
 * whole conversation hasn't landed than a shallow answer at Goal (level 1, often still surface-level
 * by design).
 */
export function aggregateResonance(
  signalsByLevel: Partial<Record<SevenWhysLevel, number | undefined>>
): number {
  const weights: Record<SevenWhysLevel, number> = {
    [SevenWhysLevel.GOAL]: 0.08,
    [SevenWhysLevel.URGENCY]: 0.1,
    [SevenWhysLevel.HISTORY]: 0.12,
    [SevenWhysLevel.CHALLENGE]: 0.14,
    [SevenWhysLevel.FEAR]: 0.18,
    [SevenWhysLevel.TRANSFORMATION]: 0.18,
    [SevenWhysLevel.COMMITMENT]: 0.2,
  };

  let weightedSum = 0;
  let weightTotal = 0;
  for (const level of SEVEN_WHYS_LEVELS) {
    const signal = signalsByLevel[level];
    if (signal === undefined) continue; // level not yet answered — excluded, not scored as 0
    weightedSum += clampUnit(signal) * weights[level];
    weightTotal += weights[level];
  }

  if (weightTotal === 0) return 0;
  return Math.round((weightedSum / weightTotal) * 100);
}
