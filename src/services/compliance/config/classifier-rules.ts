import {
  Classifier,
  ClassifierResult,
  UserContext,
  CFEBand,
  ContentLanguage,
  SAFE_HARBOR_DISCLAIMERS,
  SAFE_HARBOR_DISCLAIMERS_ES,
} from '../../../types/compliance';

/**
 * §5.3 per-classifier hard rules and §5.4 fail-toward-caution constants.
 *
 * These are the parameterized regulatory thresholds (AC §5.8-8): a rule change
 * is an edit here, not in the engine. Each rule can only ESCALATE the band
 * (clear → review → blocked); it never relaxes the aggregate §5.4 band.
 */
export const RULE_THRESHOLDS = {
  INCOME_CLAIM: { disclaimer: 0.5, autoBlock: 0.8 },
  TESTIMONIAL: { disclaimer: 0.5, block: 0.8 },
  OPPORTUNITY: { disclaimer: 0.6, block: 0.85 },
  INSURANCE: { disclaimer: 0.5, conditionalBlock: 0.5, alwaysBlock: 0.8 },
  REFERRAL: { consent: 0.6, block: 0.8 },
} as const;

/**
 * §5.4 "classifier disagreement or low confidence is treated as the higher risk
 * band." An aggregate 'clear' with any classifier at/above this floor is
 * escalated to 'review' — clean content (all signals below it) still releases.
 */
export const REVIEW_ESCALATION_FLOOR = 0.4;

const BAND_RANK: Record<CFEBand, number> = { clear: 0, review: 1, blocked: 2 };

/** Return the stricter (higher-risk) of two bands. Escalation only. */
export function strictestBand(a: CFEBand, b: CFEBand): CFEBand {
  return BAND_RANK[a] >= BAND_RANK[b] ? a : b;
}

export interface RuleOutcome {
  forcedBand: CFEBand;
  disclaimers: string[];
  reasons: string[];
}

function confOf(results: ClassifierResult[], c: Classifier): number {
  const r = results.find((x) => x.classifier === c);
  return r ? r.confidence : 0;
}

/**
 * Apply the five §5.3 classifier rules plus the §5.5 licensing gate. Returns the
 * strictest forced band, the mandatory safe-harbor disclaimers to inject, and a
 * human-readable list of the rules that fired (for the audit trail).
 *
 * T-53 (master-spec §17.5): `language` selects WHICH disclaimer text is injected — the same legal
 * disclosures, in Spanish, when the content itself is Spanish (never an English disclaimer
 * silently stitched onto otherwise-Spanish outbound content). Defaults to 'en' — every pre-T-53
 * caller (which never passed a third argument) keeps producing byte-identical English disclaimers.
 */
export function evaluateClassifierRules(
  results: ClassifierResult[],
  ctx: UserContext,
  language: ContentLanguage = 'en'
): RuleOutcome {
  const D = language === 'es' ? SAFE_HARBOR_DISCLAIMERS_ES : SAFE_HARBOR_DISCLAIMERS;
  let forced: CFEBand = 'clear';
  const disclaimers: string[] = [];
  const reasons: string[] = [];

  const escalate = (band: CFEBand, reason: string) => {
    forced = strictestBand(forced, band);
    reasons.push(reason);
  };

  // 1. Income-Claim — ≥0.5 mandatory FTC safe-harbor disclaimer; ≥0.8 auto-block.
  const income = confOf(results, 'INCOME_CLAIM');
  if (income >= RULE_THRESHOLDS.INCOME_CLAIM.autoBlock) {
    disclaimers.push(D.income);
    escalate('blocked', 'income_auto_block(>=0.8)');
  } else if (income >= RULE_THRESHOLDS.INCOME_CLAIM.disclaimer) {
    disclaimers.push(D.income);
    escalate('review', 'income_disclaimer(>=0.5)');
  }

  // 2. Testimonial — ≥0.5 substantiation + typicality disclaimer; ≥0.8 block
  //    unless a signed release is on file.
  const testimonial = confOf(results, 'TESTIMONIAL');
  if (testimonial >= RULE_THRESHOLDS.TESTIMONIAL.block) {
    disclaimers.push(D.testimonial);
    if (ctx.signed_testimonial_release) {
      escalate('review', 'testimonial_block_with_release(>=0.8)');
    } else {
      escalate('blocked', 'testimonial_block_no_release(>=0.8)');
    }
  } else if (testimonial >= RULE_THRESHOLDS.TESTIMONIAL.disclaimer) {
    disclaimers.push(D.testimonial);
    escalate('review', 'testimonial_disclaimer(>=0.5)');
  }

  // 3. Opportunity — ≥0.6 business-opportunity disclaimer; ≥0.85 block for
  //    unlicensed users in regulated states.
  const opportunity = confOf(results, 'OPPORTUNITY');
  if (opportunity >= RULE_THRESHOLDS.OPPORTUNITY.block) {
    disclaimers.push(D.opportunity);
    if (!ctx.insurance_licensed && ctx.regulated_state) {
      escalate('blocked', 'opportunity_block_unlicensed_regulated(>=0.85)');
    } else {
      escalate('review', 'opportunity_review(>=0.85)');
    }
  } else if (opportunity >= RULE_THRESHOLDS.OPPORTUNITY.disclaimer) {
    disclaimers.push(D.opportunity);
    escalate('review', 'opportunity_disclaimer(>=0.6)');
  }

  // 4. Insurance — §5.5 licensing hard-block + §5.3-4 scoring.
  //    • ≥0.8 → ALWAYS block (licensed or not).
  //    • Unlicensed / licensing-phase rep + ANY insurance-recommendation signal
  //      → BLOCKED regardless of score (master-spec §2.1/§2.4 "unlicensed = zero
  //      insurance product discussion"; §5.5 licensing-phase hard-block; AC
  //      §5.8-7; qc-checklist WP11 named critical failure). "Any signal" = the
  //      classifier reported nonzero confidence OR a matched pattern — it is NOT
  //      the mere fact of being unlicensed, so genuinely clean (zero-signal)
  //      content is never force-blocked.
  //    • Licensed rep + ≥0.5 (below always-block) → review + disclaimer.
  //    Default (no `insurance_licensed` flag) is UNLICENSED — fail-closed.
  const insuranceResult = results.find((x) => x.classifier === 'INSURANCE');
  const insurance = insuranceResult ? insuranceResult.confidence : 0;
  const insuranceSignal =
    insurance > 0 || (insuranceResult?.matched_patterns.length ?? 0) > 0;
  const insuranceLicensed =
    ctx.insurance_licensed === true && ctx.licensing_phase !== true;

  if (insurance >= RULE_THRESHOLDS.INSURANCE.alwaysBlock) {
    disclaimers.push(D.insurance);
    escalate('blocked', 'insurance_always_block(>=0.8)');
  } else if (!insuranceLicensed && insuranceSignal) {
    disclaimers.push(D.insurance);
    escalate(
      'blocked',
      'insurance_block_unlicensed_or_licensing_phase(any_signal_regardless_of_score)'
    );
  } else if (insurance >= RULE_THRESHOLDS.INSURANCE.conditionalBlock) {
    disclaimers.push(D.insurance);
    escalate('review', 'insurance_review_licensed(>=0.5)');
  }

  // 5. Referral — ≥0.6 TCPA consent verification; ≥0.8 block unless explicit opt-in.
  const referral = confOf(results, 'REFERRAL');
  if (referral >= RULE_THRESHOLDS.REFERRAL.block) {
    disclaimers.push(D.referral);
    if (ctx.referral_opt_in) {
      escalate('review', 'referral_review_optin(>=0.8)');
    } else {
      escalate('blocked', 'referral_block_no_optin(>=0.8)');
    }
  } else if (referral >= RULE_THRESHOLDS.REFERRAL.consent) {
    disclaimers.push(D.referral);
    escalate('review', 'referral_consent(>=0.6)');
  }

  return {
    forcedBand: forced,
    disclaimers: [...new Set(disclaimers)],
    reasons,
  };
}
