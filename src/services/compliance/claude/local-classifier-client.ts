import { ClassifierVerdict } from '../../../types/compliance';
import { ClaudeClassifierClient, ClassifierRequest, clamp01 } from './client';
import { CLASSIFIER_CONFIG } from '../config/classifier-config';

/**
 * Deterministic, offline classifier client (no API key required).
 *
 * This is NOT the production path — production wires `HaikuClassifierClient`
 * (§4.4). It exists so the deterministic banding logic (§5.4) and the §5.3 rule
 * escalations can be exercised in tests and local dev without a live key. It
 * uses the illustrative detection patterns from `CLASSIFIER_CONFIG` and is
 * still Claude-roster-only in spirit: it never contacts any provider at all.
 */
export class LocalDeterministicClassifierClient implements ClaudeClassifierClient {
  async classify(req: ClassifierRequest): Promise<ClassifierVerdict> {
    const cfg = CLASSIFIER_CONFIG[req.classifier];
    let maxWeight = 0;
    const matched: string[] = [];
    for (const { pattern, weight, label } of cfg.patterns) {
      if (pattern.test(req.content)) {
        maxWeight = Math.max(maxWeight, weight);
        matched.push(label);
      }
    }
    const confidence = Math.round(clamp01(maxWeight) * 100) / 100;
    return {
      flagged: confidence >= 0.5,
      confidence,
      matched_patterns: matched,
      rationale: matched.length ? `matched: ${matched.join(', ')}` : 'no patterns matched',
    };
  }
}
