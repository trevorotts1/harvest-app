import {
  SAFE_HARBOR_DISCLAIMERS,
  Classifier,
  ClassifierResult,
  CFEResult,
} from '../../types/compliance';

/**
 * Safe-Harbor Language Injection Rules
 * Automatically injects mandatory disclaimers when certain classifier patterns are detected.
 * These disclaimers must be appended to content that references income, testimonials, 
 * opportunity, insurance, or referrals.
 */

export interface SafeHarborRule {
  classifier: Classifier;
  confidenceThreshold: number; // Minimum confidence to trigger injection
  disclaimer: string;
  injectionPosition: 'append' | 'prepend' | 'inline';
  mandatory: boolean; // If true, content cannot deploy without this disclaimer
}

export const SAFE_HARBOR_RULES: SafeHarborRule[] = [
  {
    classifier: 'INCOME_CLAIM',
    confidenceThreshold: 0.3,
    disclaimer: SAFE_HARBOR_DISCLAIMERS.income,
    injectionPosition: 'append',
    mandatory: true,
  },
  {
    classifier: 'TESTIMONIAL',
    confidenceThreshold: 0.5,
    disclaimer: SAFE_HARBOR_DISCLAIMERS.testimonial,
    injectionPosition: 'append',
    mandatory: true,
  },
  {
    classifier: 'OPPORTUNITY',
    confidenceThreshold: 0.6,
    disclaimer: SAFE_HARBOR_DISCLAIMERS.opportunity,
    injectionPosition: 'append',
    mandatory: true,
  },
  {
    classifier: 'INSURANCE',
    confidenceThreshold: 0.5,
    disclaimer: SAFE_HARBOR_DISCLAIMERS.insurance,
    injectionPosition: 'append',
    mandatory: true,
  },
  {
    classifier: 'REFERRAL',
    confidenceThreshold: 0.6,
    disclaimer: SAFE_HARBOR_DISCLAIMERS.referral,
    injectionPosition: 'append',
    mandatory: false,
  },
];

/**
 * Determine which safe-harbor disclaimers should be injected based on classifier results.
 */
export function determineSafeHarborInjections(
  classifierResults: ClassifierResult[]
): { disclaimers: string[]; injected: boolean; rules: SafeHarborRule[] } {
  const disclaimers: string[] = [];
  const triggeredRules: SafeHarborRule[] = [];

  for (const rule of SAFE_HARBOR_RULES) {
    const result = classifierResults.find((r) => r.classifier === rule.classifier);
    if (result && result.confidence >= rule.confidenceThreshold) {
      disclaimers.push(rule.disclaimer);
      triggeredRules.push(rule);
    }
  }

  return {
    disclaimers: [...new Set(disclaimers)], // Deduplicate
    injected: disclaimers.length > 0,
    rules: triggeredRules,
  };
}

/**
 * Inject safe-harbor disclaimers into content.
 */
export function injectSafeHarborLanguage(
  content: string,
  classifierResults: ClassifierResult[]
): { content: string; disclaimers: string[]; injected: boolean } {
  const { disclaimers, injected } = determineSafeHarborInjections(classifierResults);

  if (disclaimers.length === 0) {
    return { content, disclaimers, injected: false };
  }

  // Append disclaimers to content
  const disclaimerText = disclaimers.map((d) => `\n\n---\n${d}`).join('');
  return {
    content: content + disclaimerText,
    disclaimers,
    injected: true,
  };
}

/**
 * Check if all mandatory safe-harbor disclaimers have been injected.
 * Content cannot deploy without mandatory disclaimers.
 */
export function validateMandatorySafeHarbor(
  classifierResults: ClassifierResult[],
  content: string
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const rule of SAFE_HARBOR_RULES) {
    if (!rule.mandatory) continue;
    const result = classifierResults.find((r) => r.classifier === rule.classifier);
    if (result && result.confidence >= rule.confidenceThreshold) {
      if (!content.includes(rule.disclaimer)) {
        missing.push(rule.disclaimer);
      }
    }
  }

  return { valid: missing.length === 0, missing };
}