import { ClassifierResult, Classifier } from '../../../types/compliance';

/**
 * ReferralRequestClassifier
 * Detects: who do you know, give me three names/referrals, incentive-linked referrals
 * Scoring: ≥ 0.6 → TCPA consent verification; ≥ 0.8 → blocked unless explicit opt-in
 */

const REFERRAL_PATTERNS: Array<{ pattern: RegExp; weight: number; label: string }> = [
  // Direct referral requests
  { pattern: /who\s*(?:do\s*you|can\s*you|else)\s*know/i, weight: 0.85, label: 'who_do_you_know' },
  { pattern: /give\s*me\s*(?:three|3|five|5|a\s*few|some)\s*(?:names?|referrals?|contacts?|leads?)/i, weight: 0.9, label: 'give_names' },
  { pattern: /(?:think\s*of|can\s*you\s*think\s*of)\s*(?:anyone|anybody|someone|somebody)\s*(?:who|that)/i, weight: 0.75, label: 'think_of_anyone' },
  { pattern: /(?:know\s*anyone|anyone\s*you\s*know|anyone\s*else)\s*(?:who|that|looking|might)/i, weight: 0.7, label: 'know_anyone' },
  // Incentive-linked referrals
  { pattern: /(?:referral|referrals?)\s*(?:bonus|reward|incentive|program|credit|prize)/i, weight: 0.85, label: 'referral_incentive' },
  { pattern: /(?:get|earn|receive)\s*\$?\d[\d,]*\s*(?:for|per|each)\s*(?:referral|referring|recommendation)/i, weight: 0.9, label: 'paid_referral' },
  { pattern: /(?:bonus|reward|credit)\s*(?:for|per)\s*(?:referring|recommending|sharing)/i, weight: 0.8, label: 'referral_bonus' },
  // Pressure tactics for referrals
  { pattern: /(?:need|looking\s*for|want)\s*(?:three|3|five|5|more)\s*(?:names?|people|contacts?)/i, weight: 0.75, label: 'pressure_referral' },
  { pattern: /(?:share|pass|send|forward)\s*(?:this|along|it)\s*(?:to|with)\s*(?:three|3|five|5|your|others?)/i, weight: 0.65, label: 'share_forward' },
  // Network mining
  { pattern: /(?:introduce|connect)\s*me\s*(?:to|with)\s*(?:three|3|five|5|more|your)/i, weight: 0.7, label: 'introduce_me' },
  { pattern: /(?:your|my)\s*(?:network|contacts?|circle|friends?|family)\s*(?:would|could|might)/i, weight: 0.55, label: 'network_mining' },
];

export class ReferralRequestClassifier {
  classify(content: string): ClassifierResult {
    let maxWeight = 0;
    const matchedPatterns: string[] = [];
    const details: string[] = [];

    for (const { pattern, weight, label } of REFERRAL_PATTERNS) {
      if (pattern.test(content)) {
        maxWeight = Math.max(maxWeight, weight);
        matchedPatterns.push(label);
        details.push(`Matched "${label}" pattern`);
      }
    }

    // Map to confidence
    let confidence: number;
    if (maxWeight >= 0.8) {
      confidence = Math.min(maxWeight, 1.0);
    } else if (maxWeight >= 0.6) {
      confidence = 0.6 + (maxWeight - 0.6) * (0.2 / 0.2);
    } else if (maxWeight > 0) {
      confidence = maxWeight * (0.59 / 0.55);
    } else {
      confidence = 0;
    }

    return {
      classifier: 'REFERRAL' as Classifier,
      confidence: Math.round(confidence * 100) / 100,
      matched_patterns: matchedPatterns,
      details: details.join('; ') || 'No referral patterns detected',
    };
  }
}