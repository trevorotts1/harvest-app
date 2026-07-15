import { Classifier, ClassifierResult } from '../../../types/compliance';
import { ClaudeClassifierClient, clamp01 } from '../claude';
import { CLASSIFIER_CONFIG } from '../config/classifier-config';

/**
 * Base for the five §5.3 classifiers. Each runs on Haiku 4.5 (§4.4) via the
 * injected `ClaudeClassifierClient`. The client is dependency-injected so tests
 * run without a live key and can simulate throw/timeout/missing-key to prove
 * fail-closed. `classify` is async — the Haiku call is awaited.
 */
export abstract class BaseHaikuClassifier {
  abstract readonly classifier: Classifier;

  constructor(protected readonly client: ClaudeClassifierClient) {}

  async classify(content: string): Promise<ClassifierResult> {
    const cfg = CLASSIFIER_CONFIG[this.classifier];
    const verdict = await this.client.classify({
      classifier: this.classifier,
      systemPrompt: cfg.systemPrompt,
      content,
    });
    const confidence = Math.round(clamp01(verdict.confidence) * 100) / 100;
    return {
      classifier: this.classifier,
      confidence,
      matched_patterns: verdict.matched_patterns ?? [],
      details:
        verdict.rationale ??
        (verdict.flagged ? 'flagged by Haiku classifier' : 'no violation detected'),
    };
  }
}
