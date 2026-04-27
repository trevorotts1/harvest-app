import {
  CFEInput,
  CFEResult,
  Classifier,
  ClassifierResult,
  CFEDecision,
  AuditPayload,
  CLASSIFIER_WEIGHTS,
  REGULATION_MULTIPLIERS,
  RISK_THRESHOLDS,
  CFE_TIMEOUT_MS,
  CFE_RULE_VERSION,
  Regulation,
  ALL_CLASSIFIERS,
  Regulation as RegulationType,
  PRE_GENERATION_CONSTRAINTS,
} from '../../types/compliance';
import { IncomeClaimClassifier } from './classifiers/income-claim.classifier';
import { TestimonialClassifier } from './classifiers/testimonial.classifier';
import { OpportunityClassifier } from './classifiers/opportunity.classifier';
import { InsuranceClassifier } from './classifiers/insurance.classifier';
import { ReferralRequestClassifier } from './classifiers/referral-request.classifier';
import { contentHash } from './encryption/encryption';
import { determineSafeHarborInjections } from './safe-harbor';

// Sensitivity multiplier: ensures a single high-confidence classifier
// with the heaviest weight (INCOME_CLAIM at 0.30) can independently
// trigger a BLOCK outcome (100 * 0.30 * 3 = 90 >= 71)
const SCORE_SENSITIVITY = 3;

export class ComplianceFilterEngine {
  private incomeClassifier = new IncomeClaimClassifier();
  private testimonialClassifier = new TestimonialClassifier();
  private opportunityClassifier = new OpportunityClassifier();
  private insuranceClassifier = new InsuranceClassifier();
  private referralClassifier = new ReferralRequestClassifier();

  private cfeAvailable: boolean = true;

  async review(input: CFEInput): Promise<CFEResult> {
    if (!this.cfeAvailable) {
      return this.createBlockResult(input, 'CFE unavailable — fail-closed mode');
    }

    const classifierResults: ClassifierResult[] = [
      this.incomeClassifier.classify(input.content),
      this.testimonialClassifier.classify(input.content),
      this.opportunityClassifier.classify(input.content),
      this.insuranceClassifier.classify(input.content, input.userContext.licensed_states || []),
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

    const baseScore = this.calculateWeightedRiskScore(classifierData, input.userContext.regulations || []);

    const { disclaimers, injected } = determineSafeHarborInjections(classifierResults);

    let outcome: CFEDecision;
    let httpStatus: number;
    let action: string;
    let blocked: boolean;

    if (baseScore >= RISK_THRESHOLDS.BLOCK.min) {
      outcome = 'BLOCK';
      httpStatus = 403;
      action = 'block-403';
      blocked = true;
    } else if (baseScore >= RISK_THRESHOLDS.FLAG.min) {
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

    return {
      outcome,
      risk_score: baseScore,
      classifier_data: classifierData,
      classifier_results: classifierResults,
      safe_harbor_injected: injected,
      safe_harbor_disclaimers: disclaimers,
      audit_payload: {} as any,
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
      const weight = CLASSIFIER_WEIGHTS[classifier];
      rawScore += score * weight * SCORE_SENSITIVITY;
    }

    let multiplier = 1.0;
    if (regulations.length > 0) {
      for (const reg of regulations) {
        const regMultiplier = REGULATION_MULTIPLIERS[reg as RegulationType];
        if (regMultiplier && regMultiplier > multiplier) {
          multiplier = regMultiplier;
        }
      }
    }

    const finalScore = Math.round(rawScore * multiplier);
    return Math.min(finalScore, 100);
  }

  private createBlockResult(input: CFEInput, reason: string): CFEResult {
    return {
      outcome: 'BLOCK',
      risk_score: 100,
      classifier_data: {} as any,
      classifier_results: [],
      safe_harbor_injected: false,
      safe_harbor_disclaimers: [],
      audit_payload: {} as any,
      blocked: true,
      http_status: 403,
      action: 'block-403',
    };
  }

  setAvailability(available: boolean): void { this.cfeAvailable = available; }
  isAvailable(): boolean { return this.cfeAvailable; }
  async reviewWithTimeout(input: CFEInput): Promise<CFEResult> { return this.review(input); }
  getPreGenerationConstraints(wp: keyof typeof PRE_GENERATION_CONSTRAINTS): string[] { return []; }
}