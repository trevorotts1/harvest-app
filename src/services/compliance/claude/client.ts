import { Classifier, ClassifierVerdict } from '../../../types/compliance';

/**
 * Claude client abstraction for the five §5.3 classifiers.
 *
 * Claude-only (§0.3): the ONLY implementations of this interface route to a
 * Claude model (Haiku 4.5 in production, §4.4) or to a deterministic local
 * heuristic for dev/test. There is no non-Claude implementation and no
 * outside-provider fallback anywhere in the classifier path.
 *
 * The interface is dependency-injected into the engine so the fail-closed
 * behavior can be proven without a live ANTHROPIC_API_KEY (inject a throwing /
 * timing-out / deterministic client).
 */
export interface ClassifierRequest {
  classifier: Classifier;
  systemPrompt: string;
  content: string;
}

export interface ClaudeClassifierClient {
  classify(req: ClassifierRequest): Promise<ClassifierVerdict>;
}

/**
 * Fail-closed trigger classes. Any of these thrown from a classifier client
 * causes the engine to hold the item CLOSED (§5.2) — never to release it and
 * never to fall back to a non-Claude provider (§0.3, §4.4).
 */
export class MissingClaudeCredentialError extends Error {
  constructor(envVarName: string) {
    // NOTE: references the secret by NAME only — never its value (§0.4).
    super(`Claude credential ${envVarName} is not set; CFE fails closed (no fallback).`);
    this.name = 'MissingClaudeCredentialError';
  }
}

export class ClassifierTimeoutError extends Error {
  constructor(classifier: Classifier, timeoutMs: number) {
    super(`Classifier ${classifier} timed out after ${timeoutMs}ms; CFE fails closed.`);
    this.name = 'ClassifierTimeoutError';
  }
}

export class ClaudeClassifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeClassifierError';
  }
}

/** Structured-output schema (§ structured outputs): {flagged, confidence, rationale}. */
export const VERDICT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    flagged: { type: 'boolean' },
    confidence: { type: 'number' },
    rationale: { type: 'string' },
  },
  required: ['flagged', 'confidence', 'rationale'],
} as const;

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
