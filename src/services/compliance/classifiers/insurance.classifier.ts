import { Classifier } from '../../../types/compliance';
import { BaseHaikuClassifier } from './base.classifier';

/**
 * Insurance-Recommendation Classifier (§5.3-4). Runs on Haiku 4.5 (§4.4).
 * ≥0.5 → block unless an active insurance license (IBA/POL) exists for the
 * recipient's state; ≥0.8 → always block (see rules). AC §5.8-7.
 */
export class InsuranceClassifier extends BaseHaikuClassifier {
  readonly classifier: Classifier = 'INSURANCE';
}
