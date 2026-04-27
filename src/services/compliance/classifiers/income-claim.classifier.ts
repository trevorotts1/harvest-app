import { ClassifierResult, Classifier } from '../../../types/compliance';

/**
 * IncomeClaimClassifier
 * Detects: income guarantees, dollar+timeframe combos, lifestyle claims, percentage returns
 * Scoring: 0.0–0.3 minor reference, 0.31–0.7 moderate, 0.71–1.0 clear claim
 * Rules: confidence ≥ 0.5 → mandatory FTC disclaimer; confidence ≥ 0.8 → auto-blocked
 */

const INCOME_PATTERNS: Array<{ pattern: RegExp; weight: number; label: string }> = [
  // Dollar + timeframe combos (strong signal)
  { pattern: /\$\d[\d,]*\s*(?:a|per|\/)\s*(?:month|year|week|day|hour)/i, weight: 0.9, label: 'dollar_timeframe' },
  { pattern: /\$\d[\d,]*\s*(?:first|initial|within)\s*\d+\s*(?:days?|weeks?|months?)/i, weight: 0.85, label: 'dollar_earnings_timeframe' },
  // Guaranteed income language
  { pattern: /guarantee[d]?\s*(?:income|earnings?|money|profit|results?|return)/i, weight: 1.0, label: 'guaranteed_income' },
  { pattern: /(?:income|earnings?|money|profit|results?)\s*(?:guarantee|guaranteed)/i, weight: 1.0, label: 'income_guaranteed' },
  // Lifestyle claims
  { pattern: /financial\s*freedom/i, weight: 0.8, label: 'financial_freedom' },
  { pattern: /replace\s*(?:your|the|a)\s*income/i, weight: 0.8, label: 'replace_income' },
  { pattern: /quit\s*(?:your|the|a)?\s*(?:job|day\s*job)/i, weight: 0.75, label: 'quit_job' },
  { pattern: /(?:fire\s*(?:your|the|a)?\s*boss|be\s*(?:your|the)\s*own\s*boss)/i, weight: 0.7, label: 'fire_boss' },
  { pattern: /unlimited\s*(?:income|earning|potential)/i, weight: 0.85, label: 'unlimited_income' },
  { pattern: /(?:six|6|seven|7)\s*-?\s*(?:figure|digit)\s*(?:income|earner|potential)/i, weight: 0.85, label: 'six_seven_figure' },
  // Percentage returns
  { pattern: /\d+\s*%\s*(?:return|roi|profit|yield|growth)/i, weight: 0.75, label: 'percentage_return' },
  // General income claims
  { pattern: /make\s*\$?\d/i, weight: 0.6, label: 'make_dollar' },
  { pattern: /earn\s*\$?\d/i, weight: 0.6, label: 'earn_dollar' },
  { pattern: /(?:passive|residual)\s*(?:income|earnings?|revenue)/i, weight: 0.7, label: 'passive_income' },
  { pattern: /(?:extra|additional|supplemental)\s*(?:income|money|earnings?)/i, weight: 0.4, label: 'extra_income' },
];

export class IncomeClaimClassifier {
  classify(content: string): ClassifierResult {
    let totalWeight = 0;
    const matchedPatterns: string[] = [];
    const details: string[] = [];

    for (const { pattern, weight, label } of INCOME_PATTERNS) {
      if (pattern.test(content)) {
        totalWeight = Math.max(totalWeight, weight);
        matchedPatterns.push(label);
        details.push(`Matched "${label}" pattern`);
      }
    }

    // Determine confidence based on strongest match
    let confidence: number;
    if (totalWeight >= 0.8) {
      confidence = Math.min(totalWeight, 1.0);
    } else if (totalWeight >= 0.5) {
      confidence = 0.31 + (totalWeight - 0.5) * (0.39 / 0.3); // Maps 0.5–0.8 → 0.31–0.7
    } else if (totalWeight > 0) {
      confidence = totalWeight * (0.3 / 0.5); // Maps 0–0.5 → 0.0–0.3
    } else {
      confidence = 0;
    }

    return {
      classifier: 'INCOME_CLAIM' as Classifier,
      confidence: Math.round(confidence * 100) / 100,
      matched_patterns: matchedPatterns,
      details: details.join('; ') || 'No income claim patterns detected',
    };
  }
}