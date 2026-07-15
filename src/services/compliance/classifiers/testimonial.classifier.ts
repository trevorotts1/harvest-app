import { Classifier } from '../../../types/compliance';
import { BaseHaikuClassifier } from './base.classifier';

/**
 * Testimonial Classifier (§5.3-2). Runs on Haiku 4.5 (§4.4).
 * ≥0.5 → substantiation + typicality disclaimer; ≥0.8 → block unless a signed
 * release is on file (see rules).
 */
export class TestimonialClassifier extends BaseHaikuClassifier {
  readonly classifier: Classifier = 'TESTIMONIAL';
}
