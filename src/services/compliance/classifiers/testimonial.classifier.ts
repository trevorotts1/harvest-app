import { ClassifierResult, Classifier } from '../../../types/compliance';

/**
 * TestimonialClassifier
 * Detects: before/after stories, named testimonials, photo/video claims
 * Scoring: ≥ 0.5 → requires substantiation; ≥ 0.8 → blocked unless signed release + typicality disclaimer
 */

const TESTIMONIAL_PATTERNS: Array<{ pattern: RegExp; weight: number; label: string }> = [
  // Before/after stories
  { pattern: /(?:before\s*(?:and|&)?\s*after|from\s*(?:zero|nothing|scratch)\s*to)/i, weight: 0.8, label: 'before_after' },
  { pattern: /(?:used\s*to|was)\s*(?:make|earn|have)\s*\$?\d[\d,]*/i, weight: 0.7, label: 'was_earning' },
  { pattern: /(?:now|now\s*(?:I|they|she|he)\s*(?:make|earn|gross))\s*\$?\d[\d,]*/i, weight: 0.75, label: 'now_earning' },
  // Named testimonials
  { pattern: /(?:according\s*to|as\s*(?:told|shared|stated)\s*by)\s+[A-Z][a-z]+/i, weight: 0.6, label: 'named_testimonial' },
  { pattern: /"[^"]+"\s*[-—]\s*[A-Z][a-z]+/i, weight: 0.65, label: 'quoted_testimonial' },
  { pattern: /(?:testimonials?|reviews?)\s*(?:from|by)\s+[A-Z][a-z]+/i, weight: 0.55, label: 'testimonial_attribution' },
  // Specific earnings claims in testimonial form
  { pattern: /I\s*(?:made|earned|cleared|grossed|netted)\s*\$?\d[\d,]*/i, weight: 0.8, label: 'first_person_earnings' },
  { pattern: /(?:she|he|they)\s*(?:made|earned|cleared|grossed|netted)\s*\$?\d[\d,]*/i, weight: 0.75, label: 'third_person_earnings' },
  { pattern: /(?:first|1st)\s*(?:month|quarter|year)\s*(?:I|she|he|they)\s*(?:made|earned)/i, weight: 0.8, label: 'first_period_earnings' },
  // Photo/video claims
  { pattern: /(?:see|watch|check\s*out)\s*(?:the|our|my)?\s*(?:video|photo|pic|picture|testimonial)/i, weight: 0.5, label: 'photo_video_claim' },
  { pattern: /(?:screenshot|proof|evidence)\s*(?:of|showing)\s*(?:earnings|income|results?)/i, weight: 0.7, label: 'proof_screenshot' },
  // Success stories
  { pattern: /(?:success\s*story|transformation|rags\s*to\s*riches)/i, weight: 0.6, label: 'success_story' },
  { pattern: /(?:changed\s*(?:my|their|her|his)\s*life|life\s*changing)/i, weight: 0.5, label: 'life_changing' },
];

export class TestimonialClassifier {
  classify(content: string): ClassifierResult {
    let maxWeight = 0;
    const matchedPatterns: string[] = [];
    const details: string[] = [];

    for (const { pattern, weight, label } of TESTIMONIAL_PATTERNS) {
      if (pattern.test(content)) {
        maxWeight = Math.max(maxWeight, weight);
        matchedPatterns.push(label);
        details.push(`Matched "${label}" pattern`);
      }
    }

    // Map weights to confidence ranges
    let confidence: number;
    if (maxWeight >= 0.8) {
      confidence = Math.min(maxWeight, 1.0);
    } else if (maxWeight >= 0.5) {
      confidence = 0.5 + (maxWeight - 0.5) * (0.3 / 0.3); // Maps 0.5–0.8 → 0.5–0.8
    } else if (maxWeight > 0) {
      confidence = maxWeight * (0.49 / 0.5); // Maps → 0.0–0.49
    } else {
      confidence = 0;
    }

    return {
      classifier: 'TESTIMONIAL' as Classifier,
      confidence: Math.round(confidence * 100) / 100,
      matched_patterns: matchedPatterns,
      details: details.join('; ') || 'No testimonial patterns detected',
    };
  }
}