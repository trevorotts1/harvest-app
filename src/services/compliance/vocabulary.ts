/**
 * Doctrine vocabulary classifier (master-spec §0.5, referenced by §5.3).
 *
 * Runs as CFE stage-1 (deterministic, local, fast). Forbidden doctrine terms
 * trigger a required rewrite "before the item can proceed" — so a violation
 * holds the item out of release. The forbidden list is config (a doctrine
 * change is an edit here, not in the engine).
 */

export interface ForbiddenTermRule {
  term: RegExp;
  forbidden: string;
  replacement: string;
}

/** §0.5 forbidden → required-replacement table. */
export const FORBIDDEN_TERMS: ForbiddenTermRule[] = [
  { term: /\bprospects?\b/i, forbidden: 'prospect', replacement: 'community member / warm-market contact' },
  { term: /\bleads?\b/i, forbidden: 'lead', replacement: 'community member / contact' },
  { term: /\b(?:sales\s*)?pitch(?:es|ing|ed)?\b/i, forbidden: 'pitch', replacement: 'community introduction / share / invite' },
  { term: /\bsales\s*call\b/i, forbidden: 'sales call', replacement: 'community introduction' },
  // §0.5 row 3 "selling / closing (as extraction)". Deliberately NOT a bare
  // \bsell\b / \bclos(?:e|ing)\b — those are common English words with
  // legitimate senses this classifier must not trip on: "close of business",
  // "close rate" (§9.7's Field Trainer's Ratio — a human CLOSE RATE metric,
  // not extraction framing), "CLOSED_RECRUIT" (the pipeline-stage enum;
  // already word-boundary-safe since `_` is a \w char, but excluded on
  // whitespace grounds here too), "closing the loop", "close friend", etc.
  // These patterns require the extraction-object context (a sale/deal/
  // prospect/lead, a person as the thing being closed, or the "hard/soft
  // close" and "sales closer" sales-technique idiom) that marks the phrase
  // as manipulative-selling framing rather than an unrelated ordinary use.
  {
    term: /\bsell(?:ing|s)?\s+(?:them\b|him\b|her\b|(?:the\s+)?(?:opportunity|deal|dream|business)\b)/i,
    forbidden: 'selling',
    replacement: 'inviting, introducing, welcoming, onboarding',
  },
  {
    term: /\b(?:hard|soft)\s+clos(?:e|es|ing|ed)\b|\bsales?\s*clos(?:e|es|er|ing)\b|\bclos(?:e|es|ing|ed)\s+(?:on\s+)?(?:the\s+)?(?:sale|deal|prospect|lead)s?\b|\bclos(?:e|es|ing|ed)\s+(?:them|him|her)\b/i,
    forbidden: 'closing',
    replacement: 'inviting, introducing, welcoming, onboarding',
  },
  { term: /\bfunnel\b/i, forbidden: 'funnel', replacement: 'introduction pipeline / harvest pipeline' },
  { term: /\bconversion\b/i, forbidden: 'conversion', replacement: 'engagement step / introduction completion' },
  { term: /\bfollowers?\b/i, forbidden: 'follower', replacement: 'community member / base member / subscriber' },
  { term: /\btarget\s*audience\b/i, forbidden: 'target audience', replacement: 'community / downline / base' },
  { term: /\brecruit(?:ing|s|ed|ment)?\b/i, forbidden: 'recruit', replacement: 'invite / sponsor / bring in' },
  { term: /\bcold\s*outreach\b/i, forbidden: 'cold outreach', replacement: 'community introduction (a warm context is always required)' },
  { term: /\bguaranteed\s*income\b/i, forbidden: 'guaranteed income', replacement: 'potential (with the FTC safe-harbor line attached)' },
  { term: /\byou\s*will\s*earn\b/i, forbidden: 'you will earn', replacement: 'potential (with the FTC safe-harbor line attached)' },
];

export interface VocabularyViolation {
  forbidden: string;
  replacement: string;
  match: string;
}

export interface VocabularyScan {
  clean: boolean;
  violations: VocabularyViolation[];
}

export class VocabularyClassifier {
  private readonly rules: ForbiddenTermRule[];

  constructor(rules: ForbiddenTermRule[] = FORBIDDEN_TERMS) {
    this.rules = rules;
  }

  scan(content: string): VocabularyScan {
    const violations: VocabularyViolation[] = [];
    for (const rule of this.rules) {
      const m = content.match(rule.term);
      if (m) {
        violations.push({
          forbidden: rule.forbidden,
          replacement: rule.replacement,
          match: m[0],
        });
      }
    }
    return { clean: violations.length === 0, violations };
  }
}
