import { ClassifierResult, Classifier } from '../../../types/compliance';

/**
 * OpportunityClassifier
 * Detects: recruitment language, join my team, be your own boss, sponsorship language
 * Scoring: ≥ 0.6 → business opportunity disclaimer required; ≥ 0.85 → blocked for unlicensed users in regulated states
 */

const OPPORTUNITY_PATTERNS: Array<{ pattern: RegExp; weight: number; label: string }> = [
  // Direct recruitment
  { pattern: /join\s*(?:my|our|the)\s*team/i, weight: 0.85, label: 'join_team' },
  { pattern: /(?:be|become)\s*(?:your|the)\s*own\s*boss/i, weight: 0.8, label: 'own_boss' },
  { pattern: /(?:sponsor|upline|downline)/i, weight: 0.7, label: 'mlm_terminology' },
  { pattern: /(?:recruit|recruiting)/i, weight: 0.75, label: 'recruitment' },
  // Business opportunity framing
  { pattern: /unlimited\s*(?:potential|opportunity|growth)/i, weight: 0.75, label: 'unlimited_potential' },
  { pattern: /(?:ground\s*floor|once\s*in\s*a\s*lifetime)\s*(?:opportunity|chance)/i, weight: 0.8, label: 'ground_floor_opportunity' },
  { pattern: /(?:business|career|entrepreneurial)\s*(?:opportunity|path|journey)/i, weight: 0.6, label: 'business_opportunity' },
  { pattern: /(?:work\s*from\s*home|remote\s*(?:work|career|opportunity))/i, weight: 0.55, label: 'work_from_home' },
  // 2 Hour CEO brand language
  { pattern: /2\s*hour\s*(?:ceo|CEO)/i, weight: 0.5, label: 'two_hour_ceo' },
  // Lifestyle/wealth framing
  { pattern: /(?:financial|financially)\s*(?:free|freedom|independent|independence)/i, weight: 0.7, label: 'financial_freedom' },
  { pattern: /(?:build|create|design)\s*(?:your|the)\s*(?:future|wealth|empire|legacy)/i, weight: 0.6, label: 'build_wealth' },
  // Urgency/scarcity
  { pattern: /(?:don'?t\s*miss|act\s*now|limited\s*(?:time|spots?|positions?))/i, weight: 0.5, label: 'urgency_pressure' },
  // Team building
  { pattern: /(?:grow|build|expand|scale)\s*(?:your|the|our)\s*(?:team|organization|group|downline)/i, weight: 0.7, label: 'team_building' },
  { pattern: /(?:leadership|mentorship|coaching)\s*(?:opportunity|program|position)/i, weight: 0.55, label: 'leadership_opportunity' },
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

    // Map to confidence: opportunity claims often require disclaimer at ≥0.6
    let confidence: number;
    if (maxWeight >= 0.85) {
      confidence = Math.min(maxWeight, 1.0);
    } else if (maxWeight >= 0.6) {
      confidence = 0.6 + (maxWeight - 0.6) * (0.25 / 0.25); // Maps 0.6–0.85 → 0.6–0.85
    } else if (maxWeight > 0) {
      confidence = maxWeight * (0.59 / 0.55); // Maps → 0.0–0.59
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