import { ClassifierResult, Classifier } from '../../../types/compliance';

/**
 * InsuranceClassifier
 * Detects: policy recommendations, coverage advice, company comparisons
 * Scoring: ≥ 0.5 → blocked unless IBA/POL license active for state; ≥ 0.8 → always blocked
 */

const INSURANCE_PATTERNS: Array<{ pattern: RegExp; weight: number; label: string }> = [
  // Direct policy recommendations
  { pattern: /(?:you\s*(?:need|should|must|gotta|have\s*to)\s*(?:get|buy|purchase|have|consider))\s*(?:a|an|whole|term|universal|variable|indexed)\s*(?:life|insurance)/i, weight: 0.9, label: 'policy_recommendation' },
  { pattern: /(?:get|buy|purchase|consider)\s*\$?\d[\d,]*\s*(?:worth\s*of)?\s*(?:coverage|insurance|policy)/i, weight: 0.85, label: 'coverage_recommendation' },
  // Coverage advice
  { pattern: /(?:whole\s*life|term\s*life|universal\s*life|variable\s*life|indexed\s*universal)\s*(?:insurance|policy|coverage)/i, weight: 0.75, label: 'policy_type_reference' },
  { pattern: /(?:you\s*need|you\s*should|recommend)\s*(?:(?:a|an)\s*)?(?:whole|term|universal|variable|indexed)/i, weight: 0.85, label: 'specific_policy_advice' },
  // Company comparisons
  { pattern: /(?:Company\s*[A-Z]|go\s*with|choose|switch\s*to)\s*(?:Company)?\s*[A-Z][a-z]+/i, weight: 0.8, label: 'company_comparison' },
  { pattern: /(?:this\s*policy\s*is|this\s*plan\s*is|this\s*coverage\s*is)\s*(?:cheaper|better|more\s*affordable|best|superior)/i, weight: 0.9, label: 'policy_comparison' },
  // Rate/quote language
  { pattern: /(?:rate|premium|quote|price)\s*(?:illustration|comparison|estimate)/i, weight: 0.7, label: 'rate_illustration' },
  { pattern: /(?:compare|comparing)\s*(?:rates|premiums|policies|coverage|quotes)/i, weight: 0.65, label: 'rate_comparison' },
  // Specific coverage amounts
  { pattern: /(?:get|need|should\s*have|recommend)\s*\$?\d[\d,]*\s*(?:K|thousand|\s*million)?\s*(?:in\s*)?(?:coverage|insurance|life\s*insurance)/i, weight: 0.8, label: 'specific_coverage_amount' },
  // Insurance-specific jargon
  { pattern: /(?:IBA|POL|licensed\s*agent|licensed\s*representative|insurance\s*license)/i, weight: 0.5, label: 'insurance_jargon' },
  { pattern: /(?:beneficiary|death\s*benefit|cash\s*value|face\s*amount|rider)/i, weight: 0.6, label: 'insurance_terminology' },
  // Advice framing
  { pattern: /(?:my\s*recommendation|I\s*(?:recommend|suggest|advise|would\s*go\s*with))/i, weight: 0.7, label: 'advice_framing' },
];

export class InsuranceClassifier {
  classify(content: string, licensedStates: string[] = []): ClassifierResult {
    let maxWeight = 0;
    const matchedPatterns: string[] = [];
    const details: string[] = [];

    for (const { pattern, weight, label } of INSURANCE_PATTERNS) {
      if (pattern.test(content)) {
        maxWeight = Math.max(maxWeight, weight);
        matchedPatterns.push(label);
        details.push(`Matched "${label}" pattern`);
      }
    }

    // Confidence mapping: insurance content is high-stakes, so map aggressively
    let confidence: number;
    if (maxWeight >= 0.8) {
      // Always blocked at 0.8+
      confidence = Math.min(maxWeight, 1.0);
    } else if (maxWeight >= 0.5) {
      // Blocked unless licensed
      confidence = 0.5 + (maxWeight - 0.5) * (0.3 / 0.3);
    } else if (maxWeight > 0) {
      confidence = maxWeight * (0.49 / 0.5);
    } else {
      confidence = 0;
    }

    // If user is licensed in relevant states, reduce confidence (they can provide some advice)
    // However, 0.8+ is ALWAYS blocked regardless of license
    if (licensedStates.length > 0 && confidence < 0.8 && confidence >= 0.5) {
      confidence = Math.max(confidence - 0.3, 0.3);
      details.push('Licensed states detected — reduced confidence');
    }

    return {
      classifier: 'INSURANCE' as Classifier,
      confidence: Math.round(confidence * 100) / 100,
      matched_patterns: matchedPatterns,
      details: details.join('; ') || 'No insurance patterns detected',
    };
  }
}