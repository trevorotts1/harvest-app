import { Classifier, ClassifierVerdict } from '../../../types/compliance';

/**
 * Classifier-client abstraction for the five §5.3 semantic classifiers.
 *
 * Claude-only (§0.3), narrowly scoped as of T-R51: this interface's implementations were
 * originally Claude-only (`HaikuClassifierClient`) or a deterministic local heuristic for
 * dev/test. T-R51 adds ONE explicit, operator-authorized exception —
 * `AgnesClassifierClient` (`../agnes/agnes-client.ts`, Sapiens AI `agnes-2.0-flash`), now the
 * engine's DEFAULT for this interface, after Agnes was evaluated at 100% against the CFE's own
 * ground-truth battery on all five categories (`eval/agnes-compliance-harness`). This exception is
 * SCOPED TO THIS INTERFACE ONLY:
 *   - the agent generation/runtime path (`src/services/agent-runtime/**`) remains Claude-only,
 *     unconditionally, untouched by this change;
 *   - the §0.5 doctrine-vocabulary lint (`../vocabulary.ts`) has no model call at all, Claude or
 *     otherwise, and is unaffected;
 *   - `HaikuClassifierClient` is unchanged and still fully supported — inject it explicitly via
 *     `CFEEngineDeps.classifierClient` for any caller that wants the Claude classifier path.
 * There is still no fallback BETWEEN providers on error — whichever client is configured either
 * returns a verdict or throws; a throw always holds the item closed (§5.2), never triggers a
 * silent retry against a different provider.
 *
 * The interface is dependency-injected into the engine so the fail-closed
 * behavior can be proven without a live credential (inject a throwing /
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
