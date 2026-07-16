import { Classifier } from '../../../types/compliance';
import { BaseHaikuClassifier } from './base.classifier';

/**
 * Income-Claim Classifier (§5.3-1). Runs on Haiku 4.5 (§4.4).
 * ≥0.5 → mandatory FTC safe-harbor disclaimer; ≥0.8 → auto-block (see rules).
 */
export class IncomeClaimClassifier extends BaseHaikuClassifier {
  readonly classifier: Classifier = 'INCOME_CLAIM';
}
