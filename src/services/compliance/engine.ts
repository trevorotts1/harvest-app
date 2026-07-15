import {
  CFEInput,
  CFEResult,
  CFEVerdict,
  CFEBand,
  CFEDecision,
  CFEAuditEvent,
  ClassifierResult,
  Classifier,
  Regulation,
  HeldReason,
  AuditPayload,
  ALL_CLASSIFIERS,
  CLASSIFIER_WEIGHTS,
  REGULATION_MULTIPLIERS,
  RISK_THRESHOLDS,
  CFE_TIMEOUT_MS,
  CFE_RULE_CONFIG_VERSION,
  PRE_GENERATION_CONSTRAINTS,
} from '../../types/compliance';
import { contentHash } from './encryption/encryption';
import {
  ClaudeClassifierClient,
  HaikuClassifierClient,
  MissingClaudeCredentialError,
  ClassifierTimeoutError,
  ClaudeClassifierError,
} from './claude';
import { BaseHaikuClassifier, buildClassifiers } from './classifiers';
import { VocabularyClassifier } from './vocabulary';
import {
  evaluateClassifierRules,
  strictestBand,
  REVIEW_ESCALATION_FLOOR,
} from './config/classifier-rules';
import { CFEAuditSink, NoopCFEAuditSink } from './audit/audit-sink';

export interface CFEEngineDeps {
  /**
   * Classifier client for the five §5.3 Haiku classifiers. DEFAULTS to the real
   * `HaikuClassifierClient` (§4.4) — so a production engine with no
   * ANTHROPIC_API_KEY fails CLOSED. Tests inject a deterministic / throwing /
   * timing-out client to prove fail-closed without a live key.
   */
  classifierClient?: ClaudeClassifierClient;
  /** Pre-built classifiers (overrides `classifierClient`). */
  classifiers?: BaseHaikuClassifier[];
  auditSink?: CFEAuditSink;
  /** Per-classifier timeout; a slow classifier holds the item (§5.2/§5.4). */
  timeoutMs?: number;
  vocabulary?: VocabularyClassifier;
}

const HTTP_BY_BAND: Record<CFEBand, number> = { clear: 200, review: 202, blocked: 403 };
const DECISION_BY_BAND: Record<CFEBand, CFEDecision> = {
  clear: 'PASS',
  review: 'FLAG',
  blocked: 'BLOCK',
};
const ACTION_BY_BAND: Record<CFEBand, string> = {
  clear: 'auto-deploy',
  review: 'upline-review',
  blocked: 'block-403',
};
/** HTTP status for a fail-closed hold: service could not decide (distinct from a content 403). */
const HELD_HTTP_STATUS = 503;

/**
 * The Compliance Filter Engine (master-spec §5).
 *
 * Position (§5.1): a SYNCHRONOUS gate between generation and any approval queue
 * or send path. Pipeline: stage-1 deterministic vocabulary lint → stage-2 five
 * Haiku 4.5 classifiers → stage-3 risk banding → §5.3 rule escalation.
 *
 * FAIL-CLOSED (§5.2, the single most important behavior): if the engine cannot
 * obtain a confident clear result — a classifier throws, times out, the key is
 * missing, any exception occurs, or the CFE is marked unavailable — it HOLDS the
 * item (`held: true`, never `released`). There is exactly one release path:
 * `band === 'clear' && !held`. No error path yields an approved/clear verdict.
 */
export class ComplianceFilterEngine {
  private readonly classifiers: BaseHaikuClassifier[];
  private readonly auditSink: CFEAuditSink;
  private readonly timeoutMs: number;
  private readonly vocabulary: VocabularyClassifier;
  private available = true;

  constructor(deps: CFEEngineDeps = {}) {
    const client = deps.classifierClient ?? new HaikuClassifierClient();
    this.classifiers = deps.classifiers ?? buildClassifiers(client);
    this.auditSink = deps.auditSink ?? new NoopCFEAuditSink();
    this.timeoutMs = deps.timeoutMs ?? CFE_TIMEOUT_MS;
    this.vocabulary = deps.vocabulary ?? new VocabularyClassifier();
  }

  // ---------------------------------------------------------------------------
  // Gate entry point — WP04/05/06/07 call THIS before any send/publish/queue.
  // ---------------------------------------------------------------------------
  async evaluateContent(input: CFEInput): Promise<CFEVerdict> {
    const hash = this.hash(input.content);

    // §5.2: CFE explicitly unavailable/offline → hold within the sync path.
    if (!this.available) {
      return this.heldVerdict(input, hash, 'cfe_unavailable');
    }

    try {
      // Stage 1: deterministic vocabulary lint (fast, local, §0.5/§5.3).
      const vocab = this.vocabulary.scan(input.content);

      // Stage 2: five Haiku 4.5 classifiers. Any throw/timeout rejects here and
      // is caught below → held (fail-closed). No partial-clear path exists.
      const results = await this.runClassifiers(input);

      // Stage 3: aggregate risk score + band (§5.4).
      const score = this.computeScore(results, input.userContext.regulations ?? []);
      let band = this.bandForScore(score);

      // §5.3 per-classifier hard rules (escalate upward only).
      const rules = evaluateClassifierRules(results, input.userContext);
      band = strictestBand(band, rules.forcedBand);

      // §0.5/§5.3: forbidden doctrine vocabulary must be rewritten before the
      // item can proceed → block (not releasable, not human-approvable as-is).
      if (!vocab.clean) {
        band = 'blocked';
        rules.reasons.push(
          `forbidden_vocabulary:${vocab.violations.map((v) => v.forbidden).join('|')}`
        );
      }

      // §5.4 fail-toward-caution: low-confidence/ambiguous signal never releases.
      if (band === 'clear' && this.maxConfidence(results) >= REVIEW_ESCALATION_FLOOR) {
        band = 'review';
        rules.reasons.push('fail_toward_caution:ambiguous_signal');
      }

      const released = band === 'clear';
      const reason =
        rules.reasons.length > 0
          ? rules.reasons.join('; ')
          : band === 'clear'
            ? 'clean'
            : `risk_score=${score}`;

      return this.buildVerdict(input, hash, {
        band,
        score,
        results,
        held: false,
        heldReason: null,
        released,
        reason,
        disclaimers: rules.disclaimers,
      });
    } catch (err) {
      // FAIL-CLOSED: any failure in the classifier pass holds the item.
      return this.heldVerdict(input, hash, this.reasonFromError(err));
    }
  }

  // ---------------------------------------------------------------------------
  // Backward-compatible facade used by already-merged WP04/WP05 code paths.
  // ---------------------------------------------------------------------------
  async review(input: CFEInput): Promise<CFEResult> {
    const v = await this.evaluateContent(input);
    return {
      outcome: v.held ? 'BLOCK' : DECISION_BY_BAND[v.band],
      risk_score: v.score,
      classifier_data: this.classifierData(v.classifierResults),
      classifier_results: v.classifierResults,
      safe_harbor_injected: v.safeHarbor.injected,
      safe_harbor_disclaimers: v.safeHarbor.disclaimers,
      audit_payload: this.toAuditPayload(v.auditEvent),
      // held OR block band both mean "not released" — messaging marks CFE_BLOCKED.
      blocked: v.held || v.band === 'blocked',
      http_status: v.httpStatus,
      action: v.held ? 'held-for-review' : ACTION_BY_BAND[v.band],
      held: v.held,
      band: v.band,
    };
  }

  /** Retained alias; timeout handling is now internal per-classifier. */
  async reviewWithTimeout(input: CFEInput): Promise<CFEResult> {
    return this.review(input);
  }

  // §5.2 / AC §5.8-5: force the CFE offline to prove agent output pauses & holds.
  setAvailability(available: boolean): void {
    this.available = available;
  }
  isAvailable(): boolean {
    return this.available;
  }

  getPreGenerationConstraints(wp: keyof typeof PRE_GENERATION_CONSTRAINTS): readonly string[] {
    return PRE_GENERATION_CONSTRAINTS[wp] ?? [];
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  private async runClassifiers(input: CFEInput): Promise<ClassifierResult[]> {
    // Promise.all rejects on the FIRST classifier failure/timeout → held.
    return Promise.all(this.classifiers.map((c) => this.runOne(c, input.content)));
  }

  private runOne(classifier: BaseHaikuClassifier, content: string): Promise<ClassifierResult> {
    const label = classifier.classifier;
    const timeoutMs = this.timeoutMs;
    return new Promise<ClassifierResult>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new ClassifierTimeoutError(label, timeoutMs));
      }, timeoutMs);
      classifier.classify(content).then(
        (r) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(r);
        },
        (e) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(e);
        }
      );
    });
  }

  private computeScore(results: ClassifierResult[], regulations: Regulation[]): number {
    // §5.4: Base Score = Σ(confidence×weight) × regulation_multiplier (cap 100).
    // Confidence is scaled to 0–100 so weights (Σ = 1.0) map onto the 0–100 band.
    let raw = 0;
    for (const r of results) {
      const weight = CLASSIFIER_WEIGHTS[r.classifier] ?? 0;
      raw += r.confidence * 100 * weight;
    }
    let multiplier = 1.0;
    for (const reg of regulations) {
      const m = REGULATION_MULTIPLIERS[reg];
      if (m && m > multiplier) multiplier = m;
    }
    return Math.min(100, Math.round(raw * multiplier));
  }

  private bandForScore(score: number): CFEBand {
    if (score >= RISK_THRESHOLDS.BLOCK.min) return 'blocked';
    if (score >= RISK_THRESHOLDS.FLAG.min) return 'review';
    return 'clear';
  }

  private maxConfidence(results: ClassifierResult[]): number {
    return results.reduce((m, r) => Math.max(m, r.confidence), 0);
  }

  private classifierData(results: ClassifierResult[]): Record<Classifier, number> {
    const data = {} as Record<Classifier, number>;
    for (const c of ALL_CLASSIFIERS) data[c] = 0;
    for (const r of results) data[r.classifier] = Math.round(r.confidence * 100);
    return data;
  }

  private hash(content: string): string {
    try {
      return contentHash(content);
    } catch {
      // Hashing must never trip fail-closed; degrade to a stable marker.
      return `unhashed:${content.length}`;
    }
  }

  private reasonFromError(err: unknown): HeldReason {
    if (err instanceof MissingClaudeCredentialError) return 'missing_credentials';
    if (err instanceof ClassifierTimeoutError) return 'classifier_timeout';
    if (err instanceof ClaudeClassifierError) return 'classifier_error';
    return 'engine_exception';
  }

  private heldVerdict(input: CFEInput, hash: string, heldReason: HeldReason): CFEVerdict {
    return this.buildVerdict(input, hash, {
      band: 'blocked',
      score: 100,
      results: [],
      held: true,
      heldReason,
      released: false,
      reason: `held_for_review:${heldReason}`,
      disclaimers: [],
    });
  }

  private buildVerdict(
    input: CFEInput,
    hash: string,
    v: {
      band: CFEBand;
      score: number;
      results: ClassifierResult[];
      held: boolean;
      heldReason: HeldReason | null;
      released: boolean;
      reason: string;
      disclaimers: string[];
    }
  ): CFEVerdict {
    const triggered = v.results.filter((r) => r.confidence > 0).map((r) => r.classifier);
    const auditEvent: CFEAuditEvent = {
      content_id: input.userContext.content_id ?? null,
      content_text: input.content,
      content_hash: hash,
      channel: input.channel,
      user_id: input.userContext.user_id,
      role: input.userContext.role,
      band: v.band,
      outcome: v.held ? 'BLOCK' : DECISION_BY_BAND[v.band],
      risk_score: v.score,
      held: v.held,
      held_reason: v.heldReason,
      classifier_results: v.results,
      classifiers_triggered: triggered,
      safe_harbor_injected: v.disclaimers.length > 0,
      safe_harbor_disclaimers: v.disclaimers,
      regulation: input.userContext.regulations ?? [],
      rule_version: CFE_RULE_CONFIG_VERSION,
      timestamp: new Date().toISOString(),
    };

    // Emit exactly one audit event per decision (§5.6, AC §5.8-4).
    this.auditSink.emit(auditEvent);

    return {
      band: v.band,
      score: v.score,
      classifierResults: v.results,
      held: v.held,
      released: v.released,
      reason: v.reason,
      heldReason: v.heldReason,
      safeHarbor: { injected: v.disclaimers.length > 0, disclaimers: v.disclaimers },
      httpStatus: v.held ? HELD_HTTP_STATUS : HTTP_BY_BAND[v.band],
      ruleVersion: CFE_RULE_CONFIG_VERSION,
      auditEvent,
    };
  }

  private toAuditPayload(e: CFEAuditEvent): AuditPayload {
    const scores = {} as Record<Classifier, number>;
    for (const c of ALL_CLASSIFIERS) scores[c] = 0;
    for (const r of e.classifier_results) scores[r.classifier] = Math.round(r.confidence * 100);
    return {
      content_text: e.content_text,
      content_hash: e.content_hash,
      risk_score: e.risk_score,
      outcome: e.outcome,
      classifier_scores: scores,
      classifier_results: e.classifier_results,
      safe_harbor_injected: e.safe_harbor_injected,
      safe_harbor_disclaimers: e.safe_harbor_disclaimers,
      timestamp: e.timestamp,
      user_id: e.user_id,
      role: e.role,
      channel: e.channel,
      rule_version: e.rule_version,
      regulation: e.regulation,
      reviewer_id: e.reviewer_id,
      reviewer_action: e.reviewer_action,
    };
  }
}
