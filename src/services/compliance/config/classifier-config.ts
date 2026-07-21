import { Classifier } from '../../../types/compliance';

/**
 * Classifier configuration (master-spec §5.3).
 *
 * Per §5.3 the detection patterns are ILLUSTRATIVE, not exhaustive, and the
 * rules are "parameterized (config, not code) so a regulatory change is a
 * config update" (AC §5.8-8). This module is that config surface:
 *   - `systemPrompt`  — the doctrine-aware instruction the Haiku 4.5 classifier
 *                       runs with (the production path, §4.4).
 *   - `patterns`      — deterministic signals used by the local (no-key) client
 *                       and as the illustrative pattern set.
 *
 * Changing detection behavior or a regulatory threshold is an edit to this file
 * (or ./classifier-rules.ts) — never a change to the engine.
 */

export interface DetectionPattern {
  pattern: RegExp;
  weight: number;
  label: string;
}

export interface ClassifierConfig {
  label: string;
  systemPrompt: string;
  patterns: DetectionPattern[];
}

const JSON_CONTRACT =
  'Respond ONLY with a JSON object: {"flagged": boolean, "confidence": number, ' +
  '"rationale": string}. `confidence` is your 0.0–1.0 assessment of how strongly ' +
  'the content contains the described violation (0 = absent, 1 = unmistakable). ' +
  'Set `flagged` true when confidence >= 0.5. Judge the meaning, not just keywords: ' +
  'an income promise dressed as encouragement is still an income claim.';

export const CLASSIFIER_CONFIG: Record<Classifier, ClassifierConfig> = {
  INCOME_CLAIM: {
    label: 'Income-Claim Classifier',
    systemPrompt:
      'You are the CFE Income-Claim classifier for a network-marketing compliance ' +
      'gate. Detect income or earnings claims: "guaranteed income", dollar amounts ' +
      'tied to timeframes, "replace your income", lifestyle claims, or percentage/ ' +
      'return claims. ' + JSON_CONTRACT,
    patterns: [
      { pattern: /\$\d[\d,]*\s*(?:a|per|\/)\s*(?:month|year|week|day|hour)/i, weight: 0.9, label: 'dollar_timeframe' },
      { pattern: /\$\d[\d,]*\s*(?:first|initial|within)\s*\d+\s*(?:days?|weeks?|months?)/i, weight: 0.85, label: 'dollar_earnings_timeframe' },
      { pattern: /guarantee[d]?\s*(?:income|earnings?|money|profit|results?|return)/i, weight: 1.0, label: 'guaranteed_income' },
      { pattern: /(?:income|earnings?|money|profit|results?)\s*(?:guarantee|guaranteed)/i, weight: 1.0, label: 'income_guaranteed' },
      { pattern: /financial\s*freedom/i, weight: 0.8, label: 'financial_freedom' },
      { pattern: /replace\s*(?:your|the|a)\s*income/i, weight: 0.8, label: 'replace_income' },
      { pattern: /quit\s*(?:your|the|a)?\s*(?:job|day\s*job)/i, weight: 0.75, label: 'quit_job' },
      { pattern: /(?:fire\s*(?:your|the|a)?\s*boss|be\s*(?:your|the)\s*own\s*boss)/i, weight: 0.7, label: 'fire_boss' },
      { pattern: /unlimited\s*(?:income|earning|potential)/i, weight: 0.85, label: 'unlimited_income' },
      { pattern: /(?:six|6|seven|7)\s*-?\s*(?:figure|digit)\s*(?:income|earner|potential)/i, weight: 0.85, label: 'six_seven_figure' },
      { pattern: /\d+\s*%\s*(?:return|roi|profit|yield|growth)/i, weight: 0.75, label: 'percentage_return' },
      { pattern: /make\s*\$?\d/i, weight: 0.6, label: 'make_dollar' },
      { pattern: /earn\s*\$?\d/i, weight: 0.6, label: 'earn_dollar' },
      { pattern: /(?:passive|residual)\s*(?:income|earnings?|revenue)/i, weight: 0.7, label: 'passive_income' },
      { pattern: /(?:extra|additional|supplemental)\s*(?:income|money|earnings?)/i, weight: 0.4, label: 'extra_income' },
      // T-53 (master-spec §17.5): Spanish parity patterns for the LOCAL (no-key) deterministic
      // client, so `LocalDeterministicClassifierClient` — the dev/test fallback for this
      // classifier — isn't blind to Spanish income claims the way a purely-English pattern set
      // would be. Illustrative, not exhaustive (same standing note as the English rows above); the
      // production path (real Haiku 4.5 via `HaikuClassifierClient`) needs no such patterns at all
      // — Haiku is multilingual and classifies Spanish content directly.
      { pattern: /ingresos?\s*garantizados?/i, weight: 1.0, label: 'es_ingreso_garantizado' },
      { pattern: /ganancias?\s*garantizadas?/i, weight: 1.0, label: 'es_ganancia_garantizada' },
      { pattern: /libertad\s*financiera/i, weight: 0.8, label: 'es_libertad_financiera' },
      { pattern: /(?:renuncia|deja|dejar)\s*(?:a\s*)?tu\s*trabajo/i, weight: 0.75, label: 'es_deja_tu_trabajo' },
      { pattern: /ingresos?\s*ilimitados?/i, weight: 0.85, label: 'es_ingreso_ilimitado' },
      { pattern: /\$\d[\d,]*\s*(?:al|por)\s*(?:mes|año|semana|día)/i, weight: 0.9, label: 'es_dollar_timeframe' },
    ],
  },
  TESTIMONIAL: {
    label: 'Testimonial Classifier',
    systemPrompt:
      'You are the CFE Testimonial classifier. Detect testimonials: "I made $10K my ' +
      'first month", before/after stories, named or photo/video testimonials, and ' +
      'earnings-result stories. ' + JSON_CONTRACT,
    patterns: [
      { pattern: /(?:before\s*(?:and|&)?\s*after|from\s*(?:zero|nothing|scratch)\s*to)/i, weight: 0.8, label: 'before_after' },
      { pattern: /(?:used\s*to|was)\s*(?:make|earn|have)\s*\$?\d[\d,]*/i, weight: 0.7, label: 'was_earning' },
      { pattern: /(?:now|now\s*(?:I|they|she|he)\s*(?:make|earn|gross))\s*\$?\d[\d,]*/i, weight: 0.75, label: 'now_earning' },
      { pattern: /(?:according\s*to|as\s*(?:told|shared|stated)\s*by)\s+[A-Z][a-z]+/i, weight: 0.6, label: 'named_testimonial' },
      { pattern: /"[^"]+"\s*[-—]\s*[A-Z][a-z]+/i, weight: 0.65, label: 'quoted_testimonial' },
      { pattern: /(?:testimonials?|reviews?)\s*(?:from|by)\s+[A-Z][a-z]+/i, weight: 0.55, label: 'testimonial_attribution' },
      { pattern: /I\s*(?:made|earned|cleared|grossed|netted)\s*\$?\d[\d,]*/i, weight: 0.8, label: 'first_person_earnings' },
      { pattern: /(?:she|he|they)\s*(?:made|earned|cleared|grossed|netted)\s*\$?\d[\d,]*/i, weight: 0.75, label: 'third_person_earnings' },
      { pattern: /(?:first|1st)\s*(?:month|quarter|year)\s*(?:I|she|he|they)\s*(?:made|earned)/i, weight: 0.8, label: 'first_period_earnings' },
      { pattern: /(?:see|watch|check\s*out)\s*(?:the|our|my)?\s*(?:video|photo|pic|picture|testimonial)/i, weight: 0.5, label: 'photo_video_claim' },
      { pattern: /(?:screenshot|proof|evidence)\s*(?:of|showing)\s*(?:earnings|income|results?)/i, weight: 0.7, label: 'proof_screenshot' },
      { pattern: /(?:success\s*story|transformation|rags\s*to\s*riches)/i, weight: 0.6, label: 'success_story' },
      { pattern: /(?:changed\s*(?:my|their|her|his)\s*life|life\s*changing)/i, weight: 0.5, label: 'life_changing' },
    ],
  },
  OPPORTUNITY: {
    label: 'Opportunity-Statement Classifier',
    systemPrompt:
      'You are the CFE Opportunity-Statement classifier. Detect business-opportunity ' +
      'framing: "join my team", "be your own boss", "unlimited potential", "2 Hour CEO" ' +
      'brand language, and sponsor/upline/downline framing. ' + JSON_CONTRACT,
    patterns: [
      { pattern: /join\s*(?:my|our|the)\s*team/i, weight: 0.85, label: 'join_team' },
      { pattern: /(?:be|become)\s*(?:your|the)\s*own\s*boss/i, weight: 0.8, label: 'own_boss' },
      { pattern: /unlimited\s*potential/i, weight: 0.8, label: 'unlimited_potential' },
      { pattern: /2\s*hour\s*ceo/i, weight: 0.75, label: 'brand_2hourceo' },
      { pattern: /(?:sponsor|upline|downline)/i, weight: 0.65, label: 'sponsor_framing' },
      { pattern: /(?:business\s*opportunity)/i, weight: 0.7, label: 'business_opportunity' },
      // T-53 (master-spec §17.5): Spanish parity patterns — see the INCOME_CLAIM classifier's own
      // T-53 comment above for why these exist (local/dev-fallback parity only).
      { pattern: /[uú]nete\s*a\s*mi\s*equipo/i, weight: 0.85, label: 'es_join_team' },
      { pattern: /s[eé]\s*tu\s*propio\s*jefe/i, weight: 0.8, label: 'es_own_boss' },
      { pattern: /potencial\s*ilimitado/i, weight: 0.8, label: 'es_unlimited_potential' },
      { pattern: /oportunidad\s*de\s*negocio/i, weight: 0.7, label: 'es_business_opportunity' },
    ],
  },
  INSURANCE: {
    label: 'Insurance-Recommendation Classifier',
    systemPrompt:
      'You are the CFE Insurance-Recommendation classifier. Detect insurance ' +
      'recommendations or advice: "you need whole life", "get $500K coverage", ' +
      '"this policy is cheaper", "go with Company X", or specific policy/coverage ' +
      'advice. ' + JSON_CONTRACT,
    patterns: [
      { pattern: /(?:you\s*(?:need|should|must|gotta|have\s*to)\s*(?:get|buy|purchase|have|consider))\s*(?:a|an|whole|term|universal|variable|indexed)\s*(?:life|insurance)/i, weight: 0.9, label: 'policy_recommendation' },
      { pattern: /(?:get|buy|purchase|consider)\s*\$?\d[\d,]*\s*(?:worth\s*of)?\s*(?:coverage|insurance|policy)/i, weight: 0.85, label: 'coverage_recommendation' },
      { pattern: /(?:whole\s*life|term\s*life|universal\s*life|variable\s*life|indexed\s*universal)\s*(?:insurance|policy|coverage)/i, weight: 0.75, label: 'policy_type_reference' },
      { pattern: /(?:you\s*need|you\s*should|recommend)\s*(?:(?:a|an)\s*)?(?:whole|term|universal|variable|indexed)/i, weight: 0.85, label: 'specific_policy_advice' },
      { pattern: /(?:this\s*policy\s*is|this\s*plan\s*is|this\s*coverage\s*is)\s*(?:cheaper|better|more\s*affordable|best|superior)/i, weight: 0.9, label: 'policy_comparison' },
      { pattern: /go\s*with\s*(?:company\s*)?[A-Z][a-z]+/i, weight: 0.8, label: 'company_comparison' },
      { pattern: /(?:get|need|should\s*have|recommend)\s*\$?\d[\d,]*\s*(?:K|thousand|\s*million)?\s*(?:in\s*)?(?:coverage|insurance|life\s*insurance)/i, weight: 0.8, label: 'specific_coverage_amount' },
      { pattern: /(?:beneficiary|death\s*benefit|cash\s*value|face\s*amount|rider)/i, weight: 0.6, label: 'insurance_terminology' },
      { pattern: /(?:my\s*recommendation|I\s*(?:recommend|suggest|advise|would\s*go\s*with))/i, weight: 0.7, label: 'advice_framing' },
    ],
  },
  REFERRAL: {
    label: 'Referral-Request Classifier',
    systemPrompt:
      'You are the CFE Referral-Request classifier. Detect referral asks: "who do you ' +
      'know", "give me three names", or incentive-linked referrals. ' + JSON_CONTRACT,
    patterns: [
      { pattern: /who\s*(?:do\s*you|can\s*you|else)\s*know/i, weight: 0.85, label: 'who_do_you_know' },
      { pattern: /give\s*me\s*(?:three|3|five|5|a\s*few|some)\s*(?:names?|referrals?|contacts?|leads?)/i, weight: 0.9, label: 'give_names' },
      { pattern: /(?:think\s*of|can\s*you\s*think\s*of)\s*(?:anyone|anybody|someone|somebody)\s*(?:who|that)/i, weight: 0.75, label: 'think_of_anyone' },
      { pattern: /(?:know\s*anyone|anyone\s*you\s*know|anyone\s*else)\s*(?:who|that|looking|might)/i, weight: 0.7, label: 'know_anyone' },
      { pattern: /(?:referral|referrals?)\s*(?:bonus|reward|incentive|program|credit|prize)/i, weight: 0.85, label: 'referral_incentive' },
      { pattern: /(?:get|earn|receive)\s*\$?\d[\d,]*\s*(?:for|per|each)\s*(?:referral|referring|recommendation)/i, weight: 0.9, label: 'paid_referral' },
      { pattern: /(?:bonus|reward|credit)\s*(?:for|per)\s*(?:referring|recommending|sharing)/i, weight: 0.8, label: 'referral_bonus' },
      { pattern: /(?:need|looking\s*for|want)\s*(?:three|3|five|5|more)\s*(?:names?|people|contacts?)/i, weight: 0.75, label: 'pressure_referral' },
      { pattern: /(?:introduce|connect)\s*me\s*(?:to|with)\s*(?:three|3|five|5|more|your)/i, weight: 0.7, label: 'introduce_me' },
    ],
  },
};
