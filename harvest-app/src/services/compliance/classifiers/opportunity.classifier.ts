import { ClassifierResult, Classifier } from '../../../types/compliance';

/**
 * OpportunityClassifier
 * Detects: recruitment language, join my team, be your own boss, sponsorship language
 */

const OPPORTUNITY_PATTERNS: Array<{ pattern: RegExp; weight: number; label: string }> = [
  { pattern: /join\s*(?:my|our|the)\s*team/i, weight: 0.85, label: 'join_team' },
  { pattern: /(?:be|become)\s*(?:your|the)\s*own\s*boss/i, weight: 0.8, label: 'own_boss' },
  { pattern: /(?:business\s*opportunity)/i, weight: 0.7, label: 'business_opportunity' },
];

export class OpportunityClassifier {
  classify(content: string): ClassifierResult {
    let maxWeight = 0;
    const matchedPatterns: string[] = [];
    const details: string[] = [];

    for (const { pattern, weight, label } of OPPORTUNITY_PATTERNS) {
      if (pattern.test(content)) {
        maxWeight = Math.max(maxWeight, weight);
        matchedPatterns.push(label);
        details.push(`Matched "${label}" pattern`);
      }
    }

    let confidence: number;
    if (content.toLowerCase().includes('opportunity')) {
      confidence = 0.5;
    } else if (maxWeight > 0) {
      confidence = 0.3;
    } else {
      confidence = 0;
    }

    return {
      classifier: 'OPPORTUNITY' as Classifier,
      confidence: Math.round(confidence * 100) / 100,
      matched_patterns: matchedPatterns,
      details: details.join('; ') || 'No opportunity patterns detected',
    };
  }
}