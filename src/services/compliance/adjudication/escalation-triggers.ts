// T-09 (master-spec §5.5 AC-7 "novel-pattern / classifier-conflict escalation"; §5.4 "classifier
// disagreement or low confidence is treated as the higher risk band"). A PURE, package-free,
// directly-unit-testable predicate over the per-classifier results a FLAG-banded draft already
// carries (`DraftMessage.cfe_classifier_data` = the CFE's `ClassifierResult[]`). It decides which
// ADVISORY model the adjudication advisor invokes for a flagged item:
//
//   • DEFAULT (no trigger)            → Sonnet 5 standard FLAG adjudication (AC-2).
//   • classifier_conflict / novel_pattern → Opus 4.8 escalation BEFORE human review (AC-7).
//
// It NEVER changes the CFE band, never clears, never approves — it only routes the advisory. The
// human still decides regardless of which model produced the recommendation (§5.5 ADVISORY rule).

import type { ClassifierResult } from '@/types/compliance';
import { REVIEW_ESCALATION_FLOOR } from '../config/classifier-rules';

export type EscalationReason = 'classifier_conflict' | 'novel_pattern';

export interface EscalationTrigger {
  /** True → route this item's advisory to Opus 4.8 (AC-7) rather than Sonnet 5. */
  escalate: boolean;
  /** The FIRST reason that fired, for the audit trail / queue row. null when `escalate` is false. */
  reason: EscalationReason | null;
}

/** The confidence a classifier must clear to count as a real, contributing signal (mirrors the
 *  engine's own §5.4 `REVIEW_ESCALATION_FLOOR`, single-sourced from classifier-rules.ts). */
export const ADJUDICATION_SIGNAL_FLOOR = REVIEW_ESCALATION_FLOOR;

/**
 * Coerce the loosely-typed JSON persisted on `DraftMessage.cfe_classifier_data` back into the
 * `ClassifierResult[]` shape the engine wrote. Defensive: a null/legacy/misshapen value yields an
 * empty list (→ no escalation trigger; the advisor falls back to standard Sonnet adjudication)
 * rather than throwing — an advisory routing decision must never itself become a failure path.
 */
export function coerceClassifierResults(data: unknown): ClassifierResult[] {
  if (!Array.isArray(data)) return [];
  const out: ClassifierResult[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.classifier !== 'string' || typeof r.confidence !== 'number') continue;
    out.push({
      classifier: r.classifier as ClassifierResult['classifier'],
      confidence: r.confidence,
      matched_patterns: Array.isArray(r.matched_patterns) ? (r.matched_patterns as string[]) : [],
      details: typeof r.details === 'string' ? r.details : '',
    });
  }
  return out;
}

/**
 * AC-7 trigger detection over a flagged item's classifier results:
 *
 *   • classifier_conflict — TWO OR MORE classifiers each fired at/above the signal floor. Multiple
 *     independent regulatory risk signals on one message is exactly the "classifiers conflict /
 *     disagree" case §5.4 already treats as higher-risk; it warrants the deeper Opus reasoning pass
 *     before a human adjudicates.
 *   • novel_pattern — a classifier fired at/above the floor with NO matched deterministic patterns
 *     (`matched_patterns` empty). The signal came from the model's judgment, not a known/enumerated
 *     phrase — an unrecognized construction the deterministic rules did not anticipate, i.e. a novel
 *     pattern worth escalating.
 *
 * Deterministic and order-stable: classifier_conflict is reported first when both hold. Returns
 * `{ escalate: false, reason: null }` for a clean/single-signal flagged item (→ Sonnet 5, AC-2).
 */
export function detectEscalationTrigger(results: ClassifierResult[]): EscalationTrigger {
  const signals = results.filter((r) => r.confidence >= ADJUDICATION_SIGNAL_FLOOR);

  if (signals.length >= 2) {
    return { escalate: true, reason: 'classifier_conflict' };
  }

  const novel = signals.find((r) => (r.matched_patterns?.length ?? 0) === 0);
  if (novel) {
    return { escalate: true, reason: 'novel_pattern' };
  }

  return { escalate: false, reason: null };
}
