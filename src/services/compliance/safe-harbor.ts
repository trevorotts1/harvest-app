import {
  ClassifierResult,
  Classifier,
  SAFE_HARBOR_DISCLAIMERS,
} from '../../types/compliance';

/**
 * Determine which safe-harbor disclaimers need to be injected
 * based on classifier results.
 *
 * Rules from WP11 spec:
 * - Income Claim confidence ≥ 0.5 → income disclaimer required
 * - Testimonial confidence ≥ 0.5 → testimonial disclaimer required
 * - Opportunity confidence ≥ 0.6 → opportunity disclaimer required
 * - Insurance confidence ≥ 0.5 → insurance disclaimer required
 * - Referral confidence ≥ 0.6 → referral disclaimer required
 */
export function determineSafeHarborInjections(
  classifierResults: ClassifierResult[]
): { disclaimers: string[]; injected: boolean } {
  const disclaimers: string[] = [];

  for (const result of classifierResults) {
    switch (result.classifier) {
      case 'INCOME_CLAIM':
        if (result.confidence >= 0.5) {
          disclaimers.push(SAFE_HARBOR_DISCLAIMERS.income);
        }
        break;
      case 'TESTIMONIAL':
        if (result.confidence >= 0.5) {
          disclaimers.push(SAFE_HARBOR_DISCLAIMERS.testimonial);
        }
        break;
      case 'OPPORTUNITY':
        if (result.confidence >= 0.6) {
          disclaimers.push(SAFE_HARBOR_DISCLAIMERS.opportunity);
        }
        break;
      case 'INSURANCE':
        if (result.confidence >= 0.5) {
          disclaimers.push(SAFE_HARBOR_DISCLAIMERS.insurance);
        }
        break;
      case 'REFERRAL':
        if (result.confidence >= 0.6) {
          disclaimers.push(SAFE_HARBOR_DISCLAIMERS.referral);
        }
        break;
    }
  }

  return {
    disclaimers,
    injected: disclaimers.length > 0,
  };
}