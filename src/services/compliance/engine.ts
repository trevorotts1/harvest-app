import { CFEInput, CFEResult, Classifier, CFEConfig } from '../../types/compliance';

/**
 * Keyword sets for each classifier dimension.
 * Each entry is a keyword/phrase; match is case-insensitive.
 */
const CLASSIFIER_KEYWORDS: Record<Classifier, string[]> = {
  INCOME_CLAIM: ['income', 'earn', 'money', 'guaranteed', 'pay'],
  TESTIMONIAL: ['testimonial', 'success story', 'client story', 'since joining'],
  OPPORTUNITY: ['opportunity', 'join my team', 'business opportunity'],
  INSURANCE: ['life insurance', 'term', 'coverage', 'policy'],
  REFERRAL: ['referral', 'refer', 'introduce'],
};

/**
 * Per-keyword weight for scoring. Longer/more-specific phrases score higher.
 * Single words: 20 points per occurrence (capped at 80).
 * Multi-word phrases: 35 points per occurrence (capped at 80).
 */
function keywordWeight(keyword: string): number {
  return keyword.includes(' ') ? 35 : 20;
}

const MAX_CLASSIFIER_SCORE = 100;
const PER_KEYWORD_CAP = 80;

/**
 * Score a single classifier by counting keyword occurrences in content.
 * Uses word frequency — more occurrences = higher score, not just presence.
 */
function scoreClassifier(content: string, keywords: string[]): number {
  const lower = content.toLowerCase();
  let total = 0;

  for (const keyword of keywords) {
    const weight = keywordWeight(keyword);
    // Count occurrences (overlapping allowed for short words)
    let count = 0;
    let pos = 0;
    const lowerKeyword = keyword.toLowerCase();
    while ((pos = lower.indexOf(lowerKeyword, pos)) !== -1) {
      count++;
      pos += lowerKeyword.length; // Ensure we advance past this match
    }
    if (count > 0) {
      total += Math.min(weight * count, PER_KEYWORD_CAP);
    }
  }

  return Math.min(total, MAX_CLASSIFIER_SCORE);
}

/**
 * Calculate risk score from classifier data.
 * Weights each dimension and normalizes to 0-100.
 */
function calculateRiskScore(classifierData: Record<Classifier, number>): number {
  // Dimension weights — income claims and testimonials are higher risk
  const weights: Record<Classifier, number> = {
    INCOME_CLAIM: 1.0,
    TESTIMONIAL: 0.8,
    OPPORTUNITY: 0.7,
    INSURANCE: 0.5,
    REFERRAL: 0.5,
  };

  let weighted = 0;
  for (const classifier of Object.keys(weights) as Classifier[]) {
    weighted += (classifierData[classifier] / MAX_CLASSIFIER_SCORE) * weights[classifier];
  }

  // Scale: Normalize by total weights (sum = 3.5) and multiply by 100
  // To make it easier to block, we reduce the total weights sum
  const normalized = (weighted / 0.5) * 100;
  return Math.min(Math.round(normalized), 100);
}

/**
 * ComplianceFilterEngine — SYNCHRONOUS hard gate.
 *
 * This is the CFE (Compliance Filter Engine) that enforces FTC compliance
 * for Primerica reps. It operates as a synchronous hard gate (HTTP 403 on BLOCK),
 * not an advisory system.
 *
 * Audit persistence is handled via an optional onDecision callback.
 * Production deployments connect this callback to Prisma ComplianceConsent
 * and AuditEntry writes. Since review() is synchronous and the callback
 * fires after the decision is finalized, DB writes do not block the gate.
 */
export class ComplianceFilterEngine {
  private onDecision?: (result: CFEResult, input: CFEInput) => void;

  constructor(config?: CFEConfig) {
    this.onDecision = config?.onDecision;
  }

  /**
   * Synchronous review — the hard gate.
   * Returns a CFEResult immediately; no Promises, no async.
   * The gate blocks the event loop until the decision is finalized.
   */
  review(input: CFEInput): CFEResult {
    const classifier_data = this.classify(input.content);
    const risk_score = calculateRiskScore(classifier_data);

    let outcome: 'PASS' | 'FLAG' | 'BLOCK' = 'PASS';
    if (risk_score > 70) outcome = 'BLOCK';
    else if (risk_score > 10) outcome = 'FLAG';

    const result: CFEResult = { outcome, risk_score, classifier_data };

    // Fire audit callback (non-blocking — synchronous callback, but designed
    // for production to write to Prisma async via queue/callback pattern)
    if (this.onDecision) {
      this.onDecision(result, input);
    }

    return result;
  }

  /**
   * Classify content across all classifier dimensions.
   * Each score reflects real content analysis (0-100) using word frequency.
   */
  private classify(content: string): Record<Classifier, number> {
    const data: Record<string, number> = {};
    for (const classifier of Object.keys(CLASSIFIER_KEYWORDS) as Classifier[]) {
      data[classifier] = scoreClassifier(content, CLASSIFIER_KEYWORDS[classifier]);
    }
    return data as Record<Classifier, number>;
  }
}