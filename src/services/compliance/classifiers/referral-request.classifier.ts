import { Classifier } from '../../../types/compliance';
import { BaseHaikuClassifier } from './base.classifier';

/**
 * Referral-Request Classifier (§5.3-5). Runs on Haiku 4.5 (§4.4).
 * ≥0.6 → TCPA consent verification; ≥0.8 → block unless explicit opt-in (see rules).
 */
export class ReferralRequestClassifier extends BaseHaikuClassifier {
  readonly classifier: Classifier = 'REFERRAL';
}
