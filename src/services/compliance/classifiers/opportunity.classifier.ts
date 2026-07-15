import { Classifier } from '../../../types/compliance';
import { BaseHaikuClassifier } from './base.classifier';

/**
 * Opportunity-Statement Classifier (§5.3-3). Runs on Haiku 4.5 (§4.4).
 * ≥0.6 → business-opportunity disclaimer; ≥0.85 → block for unlicensed users in
 * regulated states (see rules).
 */
export class OpportunityClassifier extends BaseHaikuClassifier {
  readonly classifier: Classifier = 'OPPORTUNITY';
}
