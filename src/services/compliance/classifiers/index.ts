import { ClaudeClassifierClient } from '../claude';
import { BaseHaikuClassifier } from './base.classifier';
import { IncomeClaimClassifier } from './income-claim.classifier';
import { TestimonialClassifier } from './testimonial.classifier';
import { OpportunityClassifier } from './opportunity.classifier';
import { InsuranceClassifier } from './insurance.classifier';
import { ReferralRequestClassifier } from './referral-request.classifier';

export { BaseHaikuClassifier } from './base.classifier';
export { IncomeClaimClassifier } from './income-claim.classifier';
export { TestimonialClassifier } from './testimonial.classifier';
export { OpportunityClassifier } from './opportunity.classifier';
export { InsuranceClassifier } from './insurance.classifier';
export { ReferralRequestClassifier } from './referral-request.classifier';

/**
 * Build the five §5.3 classifiers bound to a single Claude client. All five run
 * on Haiku 4.5 (§4.4) through the injected client.
 */
export function buildClassifiers(client: ClaudeClassifierClient): BaseHaikuClassifier[] {
  return [
    new IncomeClaimClassifier(client),
    new TestimonialClassifier(client),
    new OpportunityClassifier(client),
    new InsuranceClassifier(client),
    new ReferralRequestClassifier(client),
  ];
}
