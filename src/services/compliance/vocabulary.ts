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
  // whitespace grounds here too), "closing the loop", "close friend", and
  // (post T-R15-QC-7.3 fix) ordinary transaction/accounting/furniture uses
  // of "close(d) the deal" — "closed the deal on her new apartment/car/the
  // merger", "hard close of the books", "soft close drawers" — which have NO
  // person/extraction-object in them and must stay clean.
  //
  // The "closing" rule below therefore REQUIRES an explicit extraction-object
  // cue rather than matching bare "close/closed the deal/sale": either (1)
  // the thing being closed is a PERSON — them/him/her/(the/this/a/my/our)
  // contact/prospect/lead — directly as the verb's object ("close them",
  // "closing the prospect"), or (2) "close/closing/closed the sale/deal" is
  // followed by "with"/"on" + that same person-noun ("close the deal with
  // this contact"), or (3) the "sales closer" / "sale closing" idiom (sale(s)
  // immediately before the close verb). Ordinary objects after "on" (a
  // house, a car, the merger, the books, drawers) never satisfy the
  // person-noun requirement, so they no longer match. The bare "hard/soft
  // close" alternative was REMOVED entirely — it had no object gating at
  // all and could not be reliably distinguished by regex from the
  // accounting ("hard close of the books") and furniture ("soft-close
  // drawers") senses of the same words; the patterns below already cover
  // the genuine sales-technique "hard/soft close" cases whenever they're
  // actually aimed at a person.
  {
    term: /\bsell(?:ing|s)?\s+(?:them\b|him\b|her\b|(?:the\s+)?(?:opportunity|deal|dream|business)\b)/i,
    forbidden: 'selling',
    replacement: 'inviting, introducing, welcoming, onboarding',
  },
  {
    term: /\bclos(?:e|es|ing|ed)\s+(?:them|him|her|(?:(?:this|that|the|a|my|our)\s+)?(?:contact|prospect|lead)s?)\b|\bclos(?:e|es|ing|ed)\s+(?:the\s+)?(?:sale|deal)\s+(?:with|on)\s+(?:(?:this|that|the|a|my|our)\s+)?(?:contact|prospect|lead)s?\b|\bsales?\s*clos(?:e|es|er|ing)\b/i,
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
