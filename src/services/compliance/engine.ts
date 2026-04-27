import {
  CFEInput,
  CFEResult,
  CFEConfig,
  DEFAULT_CFE_CONFIG,
  Classifier,
  ClassifierResult,
  CFEDecision,
  AuditPayload,
  Regulation,
  Channel,
  Role,
  ALL_CLASSIFIERS,
  CFE_TIMEOUT_MS,
  CFE_RULE_VERSION,
  PRE_GENERATION_CONSTRAINTS,
} from '../../types/compliance';
import { IncomeClaimClassifier } from './classifiers/income-claim.classifier';
import { TestimonialClassifier } from './classifiers/testimonial.classifier';
import { OpportunityClassifier } from './classifiers/opportunity.classifier';
import { InsuranceClassifier } from './classifiers/insurance.classifier';
import { ReferralRequestClassifier } from './classifiers/referral-request.classifier';
import { contentHash } from './encryption/encryption';
import { determineSafeHarborInjections } from './safe-harbor';
import { AuditService, AuditRepository, InMemoryAuditRepository } from './audit/audit-service';

// Sensitivity multiplier: ensures a single high-confidence classifier
// with the heaviest weight (INCOME_CLAIM at 0.30) can independently
// trigger a BLOCK outcome (100 * 0.30 * 3 = 90 >= 71)
const SCORE_SENSITIVITY = 3;

export interface ComplianceFilterEngineOptions {
  config?: Partial<CFEConfig>;
  onDecision?: (result: CFEResult, input: CFEInput) => void;
  auditRepository?: AuditRepository;
}

export class ComplianceFilterEngine {
  private incomeClassifier = new IncomeClaimClassifier();
  private testimonialClassifier = new TestimonialClassifier();
  private opportunityClassifier = new OpportunityClassifier();
  private insuranceClassifier = new InsuranceClassifier();
  private referralClassifier = new ReferralRequestClassifier();

  private cfeAvailable: boolean = true;
  private config: CFEConfig;
  private onDecision?: (result: CFEResult, input: CFEInput) => void;
  private auditService: AuditService;

  constructor(options?: ComplianceFilterEngineOptions) {
    this.config = { ...DEFAULT_CFE_CONFIG, ...options?.config };
    this.onDecision = options?.onDecision;
    this.auditService = new AuditService(options?.auditRepository ?? new InMemoryAuditRepository());
  }

  /**
   * Review content through the CFE pipeline.
   * Uses a 2-second timeout wrapper per WP11 §2.4.
   * If classifier/service unavailable, result must BLOCK (fail-closed), never pass.
   */
  async review(input: CFEInput): Promise<CFEResult> {
    if (!this.cfeAvailable) {
      return this.createBlockResult(input, 'CFE unavailable — fail-closed mode');
    }

    // 2-second timeout wrapper per WP11 requirement
    const timeoutMs = this.config.timeout_ms;
    const resultPromise = this.evaluateContent(input);

    let result: CFEResult;
    try {
      result = await Promise.race([
        resultPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`CFE_TIMEOUT: Evaluation exceeded ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
    } catch (err) {
      // Timeout or error → fail-closed: BLOCK everything
      return this.createBlockResult(input, `CFE timeout/error: ${(err as Error).message}`);
    }

    // Persist audit trail
    await this.auditService.recordDecision(result.audit_payload);

    // Invoke onDecision callback if provided
    this.onDecision?.(result, input);

    return result;
  }

  /**
   * Core evaluation logic — runs all five classifiers and computes risk score.
   */
  private async evaluateContent(input: CFEInput): Promise<CFEResult> {
    const classifierResults: ClassifierResult[] = [
      this.incomeClassifier.classify(input.content),
      this.testimonialClassifier.classify(input.content),
      this.opportunityClassifier.classify(input.content),
      this.insuranceClassifier.classify(input.content, input.userContext.licensed_states ?? []),
      this.referralClassifier.classify(input.content),
    ];

    // Convert classifier confidence (0–1) to integer scores (0–100)
    const classifierData: Record<Classifier, number> = {
      INCOME_CLAIM: 0,
      TESTIMONIAL: 0,
      OPPORTUNITY: 0,
      INSURANCE: 0,
      REFERRAL: 0,
    };

    for (const result of classifierResults) {
      classifierData[result.classifier] = Math.round(result.confidence * 100);
    }

    const baseScore = this.calculateWeightedRiskScore(classifierData, input.userContext.regulations ?? []);

    const { disclaimers, injected } = determineSafeHarborInjections(classifierResults);

    let outcome: CFEDecision;
    let httpStatus: number;
    let action: string;
    let blocked: boolean;

    if (baseScore >= this.config.risk_thresholds.block_min) {
      outcome = 'BLOCK';
      httpStatus = 403;
      action = 'block-403';
      blocked = true;
    } else if (baseScore >= this.config.risk_thresholds.flag_min) {
      outcome = 'FLAG';
      httpStatus = 202;
      action = 'upline-review';
      blocked = false;
    } else {
      outcome = 'PASS';
      httpStatus = 200;
      action = 'auto-deploy';
      blocked = false;
    }

    const auditPayload: AuditPayload = {
      content_text: input.content,
      content_hash: contentHash(input.content),
      risk_score: baseScore,
      outcome,
      classifier_scores: classifierData,
      classifier_results: classifierResults,
      safe_harbor_injected: injected,
      safe_harbor_disclaimers: disclaimers,
      timestamp: new Date().toISOString(),
      user_id: input.userContext.user_id,
      role: input.userContext.role,
      channel: input.channel,
      rule_version: this.config.rule_version,
      regulation: input.userContext.regulations ?? [],
    };

    return {
      outcome,
      risk_score: baseScore,
      classifier_data: classifierData,
      classifier_results: classifierResults,
      safe_harbor_injected: injected,
      safe_harbor_disclaimers: disclaimers,
      safe_harbor_applied: injected,
      safe_harbor_text: disclaimers.join(' '),
      audit_payload: auditPayload,
      blocked,
      http_status: httpStatus,
      action,
    };
  }

  private calculateWeightedRiskScore(
    classifierData: Record<Classifier, number>,
    regulations: Regulation[]
  ): number {
    let rawScore = 0;

    for (const classifier of ALL_CLASSIFIERS) {
      const score = classifierData[classifier]; // 0–100
      const weight = this.config.classifier_weights[classifier];
      rawScore += score * weight * SCORE_SENSITIVITY;
    }

    let multiplier = 1.0;
    if (regulations.length > 0) {
      for (const reg of regulations) {
        const regMultiplier = this.config.regulation_multipliers[reg];
        if (regMultiplier && regMultiplier > multiplier) {
          multiplier = regMultiplier;
        }
      }
    }

    const finalScore = Math.round(rawScore * multiplier);
    return Math.min(finalScore, 100);
  }

  private createBlockResult(input: CFEInput, reason: string): CFEResult {
    const auditPayload: AuditPayload = {
      content_text: input.content,
      content_hash: contentHash(input.content),
      risk_score: 100,
      outcome: 'BLOCK',
      classifier_scores: { INCOME_CLAIM: 0, TESTIMONIAL: 0, OPPORTUNITY: 0, INSURANCE: 0, REFERRAL: 0 },
      classifier_results: [],
      safe_harbor_injected: false,
      safe_harbor_disclaimers: [],
      timestamp: new Date().toISOString(),
      user_id: input.userContext.user_id,
      role: input.userContext.role,
      channel: input.channel,
      rule_version: this.config.rule_version,
      regulation: input.userContext.regulations ?? [],
    };

    return {
      outcome: 'BLOCK',
      risk_score: 100,
      classifier_data: { INCOME_CLAIM: 0, TESTIMONIAL: 0, OPPORTUNITY: 0, INSURANCE: 0, REFERRAL: 0 },
      classifier_results: [],
      safe_harbor_injected: false,
      safe_harbor_disclaimers: [],
      safe_harbor_applied: false,
      safe_harbor_text: reason,
      audit_payload: auditPayload,
      blocked: true,
      http_status: 403,
      action: 'block-403',
    };
  }

  setAvailability(available: boolean): void { this.cfeAvailable = available; }
  isAvailable(): boolean { return this.cfeAvailable; }

  /**
   * Review with explicit timeout wrapper.
   * Wraps review() with a configurable timeout.
   */
  async reviewWithTimeout(input: CFEInput, timeoutMs?: number): Promise<CFEResult> {
    const timeout = timeoutMs ?? this.config.timeout_ms;
    return Promise.race([
      this.review(input),
      new Promise<CFEResult>((_, reject) =>
        setTimeout(() => reject(new Error(`CFE_TIMEOUT: ${timeout}ms`)), timeout)
      ),
    ]);
  }

  /**
   * Get pre-generation compliance constraints for a specific work package.
   */
  getPreGenerationConstraints(wp: keyof typeof PRE_GENERATION_CONSTRAINTS): string[] {
    return [...PRE_GENERATION_CONSTRAINTS[wp]];
  }

  /**
   * Get the audit service for querying audit records.
   */
  getAuditService(): AuditService {
    return this.auditService;
  }

  /**
   * Get current CFE config.
   */
  getConfig(): CFEConfig {
    return { ...this.config };
  }
}