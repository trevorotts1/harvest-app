#!/usr/bin/env node
/**
 * GROUND-TRUTH BATTERY for scripts/eval-agnes-compliance.mjs.
 *
 * This is EVALUATION DATA ONLY. It is not imported by any runtime app code (nothing under
 * src/** references this file) and it is not part of the build/test/postbuild pipeline.
 *
 * Every fixture's `groundTruth` label is taken from — or directly derived from — the CFE's own
 * existing test suite / config, which is the same bar the real Claude-Haiku classifiers are held
 * to (master-spec §5.3/§5.4/§0.5, WP11 Regulatory Matrix §3 "50 known-violation messages, 100%
 * blocked", AC §5.8-2/§5.8-7). Two provenance kinds:
 *
 *   - "fixture": the `content` string (and its expected band) is copied VERBATIM from an existing
 *     Jest test in tests/unit/*.test.ts that drives the real engine (ComplianceFilterEngine +
 *     LocalDeterministicClassifierClient/VocabularyClassifier) against that literal text and
 *     asserts the resulting band. `source` cites the exact file + test description.
 *   - "constructed": no literal test fixture exercises this exact sentence, but it is built
 *     directly from the classifier's own documented detection language in
 *     src/services/compliance/config/classifier-config.ts (the `systemPrompt`/`patterns` — the
 *     SAME config file the production classifiers run against) or from
 *     src/services/compliance/config/classifier-rules.ts's documented thresholds. `source` cites
 *     the exact pattern/rule this was built from. Used only to fill classifier categories
 *     (TESTIMONIAL, REFERRAL, and a couple of soft OPPORTUNITY/INCOME_CLAIM review-band cases)
 *     that the existing Jest suite exercises only via mocked confidences, not literal prose.
 *
 * groundTruth:
 *   'BLOCK'  — CFE band 'blocked' (§5.4: 71-100 / hard rule escalation). The known-violation
 *              subset (§5.8-2's "50 known-violation messages, 100% blocked" bar).
 *   'FLAG'   — CFE band 'review' (§5.4: 11-70). Not clean, but not a hard block either.
 *   'PASS'   — CFE band 'clear' (§5.4: 0-10). The ONLY release path — benign controls.
 *
 * Context assumption for every fixture (matches the CFE's own fail-closed DEFAULT UserContext,
 * i.e. every optional gate unset): unlicensed for insurance, no signed testimonial release, no
 * TCPA referral opt-in, not in a regulated state carve-out. This is deliberate — it is the exact
 * posture master-spec §5.5 calls "fail-closed" and is how nearly every cited test constructs its
 * `userContext` too (bare `{ user_id, role: 'REP' }`, no license/consent flags).
 */

export const FIXTURES = [
  // ─────────────────────────────────────────────────────────────────────────
  // BLOCK — English, income / testimonial / opportunity / insurance claims
  // ─────────────────────────────────────────────────────────────────────────
  { id: 'B01', lang: 'en', category: 'INCOME_CLAIM', groundTruth: 'BLOCK',
    content: 'Make guaranteed income today! Earn so much money!',
    source: 'fixture: tests/unit/compliance.test.ts:31 ("blocks an explicit income guarantee (§5.3-1, ≥0.8 auto-block)")' },
  { id: 'B02', lang: 'en', category: 'INSURANCE', groundTruth: 'BLOCK',
    content: 'You need whole life insurance. Get $500K coverage; this policy is cheaper.',
    source: 'fixture: tests/unit/compliance.test.ts:63 ("detects an insurance recommendation (§5.3-4) and blocks an unlicensed rep (AC §5.8-7)")' },
  { id: 'B03', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'Add this prospect to my funnel and pitch them.',
    source: 'fixture: tests/unit/compliance.test.ts:75 ("blocks forbidden doctrine vocabulary (§0.5)")' },
  { id: 'B04', lang: 'en', category: 'INCOME_CLAIM', groundTruth: 'BLOCK',
    content: 'Guaranteed income, join my team!',
    source: 'fixture: tests/unit/compliance.test.ts:99 (legacy review() facade, outcome BLOCK)' },
  { id: 'B05', lang: 'en', category: 'INCOME_CLAIM', groundTruth: 'BLOCK',
    content: 'You are guaranteed income of $10,000 per month!',
    source: 'fixture: tests/unit/cfe-fail-closed.test.ts:125 ("prohibited input (income claim / forbidden vocab) → blocked")' },
  { id: 'B06', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'Send this pitch to every prospect.',
    source: 'fixture: tests/unit/cfe-fail-closed.test.ts:130 (same test as B05)' },
  { id: 'B07', lang: 'en', category: 'INSURANCE', groundTruth: 'BLOCK',
    content: 'You need whole life insurance for your family.',
    source: 'fixture: tests/unit/cfe-fail-closed.test.ts:193/209 (licensing-phase/unlicensed insurance hard-block, AC §5.8-7); default-unlicensed context per this file\'s header note' },
  { id: 'B08', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'Time to close the deal with this contact.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:34 (extraction-framed "closing")' },
  { id: 'B09', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: "I'm going to close them today, no matter what.",
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:35' },
  { id: 'B10', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: "Let's close the sale on this prospect, she won't say no.",
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:36' },
  { id: 'B11', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: "She's a great sales closer, always closing the sale.",
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:37' },
  { id: 'B12', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'We need to sell them on joining the team tonight.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:38 (extraction-framed "selling")' },
  { id: 'B13', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: "Don't overthink it, just close the deal with this lead already.",
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:39' },
  { id: 'B14', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'He is selling the opportunity way too hard on this call.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:40' },
  { id: 'B15', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: "Don't overthink it — just close them tonight, sell them on the dream.",
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:58 (end-to-end engine test, both "closing" + "selling")' },
  { id: 'B16', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'Add this prospect to the list.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:143 ("prospect")' },
  { id: 'B17', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'This lead is warm.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:144 ("lead")' },
  { id: 'B18', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'Nail the sales pitch tomorrow.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:145 ("pitch")' },
  { id: 'B19', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'Schedule the sales call for Tuesday.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:146 ("sales call")' },
  { id: 'B20', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'Add them to the funnel.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:147 ("funnel")' },
  { id: 'B21', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'Track the conversion rate.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:148 ("conversion")' },
  { id: 'B22', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'Grow your follower count.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:149 ("follower")' },
  { id: 'B23', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'Define the target audience for this post.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:150 ("target audience")' },
  { id: 'B24', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'We need to recruit five more this month.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:151 ("recruit")' },
  { id: 'B25', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'Cold outreach never works for us.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:152 ("cold outreach")' },
  { id: 'B26', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'This offers guaranteed income for life.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:153 ("guaranteed income")' },
  { id: 'B27', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'You will earn $5,000 in your first month.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:154 ("you will earn")' },
  { id: 'B28', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'Our top recruiter closed five deals this month.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:192 (T-57 BLOCKER-B2, agentive noun "recruiter")' },
  { id: 'B29', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'The recruiters gathered for a training call.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:193' },
  { id: 'B30', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'She wants to become a recruiter for the team.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:194' },
  { id: 'B31', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'She is recruiting heavily this quarter.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:207 ("recruit" verb paradigm regression)' },
  { id: 'B32', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'He recruited three new members.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:208' },
  { id: 'B33', lang: 'en', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'Recruitment is picking up this month.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:209' },

  // ─────────────────────────────────────────────────────────────────────────
  // BLOCK — constructed from classifier-config.ts's own documented detection
  // language (TESTIMONIAL / REFERRAL / combined INCOME+OPPORTUNITY / INSURANCE),
  // to cover the categories the literal Jest fixtures only exercise via a
  // mocked confidence map rather than real prose.
  // ─────────────────────────────────────────────────────────────────────────
  { id: 'B34', lang: 'en', category: 'TESTIMONIAL', groundTruth: 'BLOCK',
    content: 'I made $10,000 in my first month with this business — see my screenshot below!',
    source: 'constructed: classifier-config.ts TESTIMONIAL systemPrompt\'s own example ("I made $10K my first month") + first_person_earnings/proof_screenshot patterns; §5.3-2 rule blocks ≥0.8 with no signed release on file (default)' },
  { id: 'B35', lang: 'en', category: 'REFERRAL', groundTruth: 'BLOCK',
    content: "Who do you know that might be interested? Give me three names and I'll follow up today.",
    source: 'constructed: classifier-config.ts REFERRAL systemPrompt\'s own examples ("who do you know", "give me three names") + give_names pattern (weight 0.9); §5.3-5 rule blocks ≥0.8 with no TCPA opt-in on file (default)' },
  { id: 'B36', lang: 'en', category: 'INSURANCE', groundTruth: 'BLOCK',
    content: 'Go with Company X — their policy is way cheaper than what you have now.',
    source: 'constructed: classifier-config.ts INSURANCE systemPrompt\'s own example ("go with Company X") + policy_comparison/company_comparison patterns; unlicensed default → hard-block regardless of score (§5.5, AC §5.8-7)' },
  { id: 'B37', lang: 'en', category: 'INCOME_CLAIM', groundTruth: 'BLOCK',
    content: 'This business gives you unlimited income potential — quit your job and be your own boss!',
    source: 'constructed: classifier-config.ts INCOME_CLAIM unlimited_income (0.85) + quit_job (0.75) patterns combined with OPPORTUNITY own_boss (0.8) pattern' },

  // ─────────────────────────────────────────────────────────────────────────
  // BLOCK — Spanish (T-53 parity, master-spec §17.5)
  // ─────────────────────────────────────────────────────────────────────────
  { id: 'B38', lang: 'es', category: 'INCOME_CLAIM', groundTruth: 'BLOCK',
    content: 'Te garantizo ingresos de $10,000 al mes.',
    source: 'fixture: tests/unit/cfe-spanish.test.ts:48 ("Spanish income-claim content, high confidence -> BLOCKED")' },
  { id: 'B39', lang: 'es', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'Agrega este prospecto a la lista y prepárate para cerrar a este contacto.',
    source: 'fixture: tests/unit/cfe-spanish.test.ts:76 ("Spanish vocabulary BLOCK — fires from stage-1 doctrine vocab lint alone")' },
  { id: 'B40', lang: 'es', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'Este cliente potencial parece interesado en el negocio.',
    source: 'fixture: tests/unit/cfe-spanish.test.ts:90 ("cliente potencial" also blocks)' },
  { id: 'B41', lang: 'es', category: 'INSURANCE', groundTruth: 'BLOCK',
    content: 'Necesitas un seguro de vida entera para tu familia.',
    source: 'fixture: tests/unit/cfe-spanish.test.ts:151 (licensing-phase hard-block applies to Spanish exactly as English)' },
  { id: 'B42', lang: 'es', category: 'INCOME_CLAIM', groundTruth: 'BLOCK',
    content: 'Con este negocio tendrás ingresos garantizados de $5,000 al mes.',
    source: 'fixture: tests/unit/cfe-spanish.test.ts:164 (LOCAL deterministic client Spanish parity)' },
  { id: 'B43', lang: 'es', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'Necesitamos mejorar las conversiones de este mes en el equipo.',
    source: 'fixture: tests/unit/cfe-spanish.test.ts ("conversiones" plural stage-1 BLOCK end-to-end)' },
  { id: 'B44', lang: 'es', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'Los contactos en frío no han respondido esta semana.',
    source: 'fixture: tests/unit/cfe-spanish.test.ts ("contactos en frío" plural stage-1 BLOCK end-to-end)' },
  { id: 'B45', lang: 'es', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'Terminamos las presentaciones de ventas de esta semana.',
    source: 'fixture: tests/unit/cfe-spanish.test.ts ("presentaciones de ventas" plural stage-1 BLOCK end-to-end)' },
  { id: 'B46', lang: 'es', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'Voy a vender a tu contacto la oportunidad esta semana.',
    source: 'fixture: tests/unit/cfe-spanish.test.ts ("vender a tu contacto" end-to-end RUNTIME CFE BLOCK)' },
  { id: 'B47', lang: 'es', category: 'VOCABULARY', groundTruth: 'BLOCK',
    content: 'Nuestro mejor reclutador cerró cinco incorporaciones este mes.',
    source: 'fixture: tests/unit/cfe-spanish.test.ts ("reclutador" end-to-end RUNTIME CFE BLOCK)' },

  // ─────────────────────────────────────────────────────────────────────────
  // FLAG (review band) — not clean, but not a hard block either
  // ─────────────────────────────────────────────────────────────────────────
  { id: 'F01', lang: 'en', category: 'OPPORTUNITY', groundTruth: 'FLAG',
    content: 'I have a business opportunity for you.',
    source: 'fixture: tests/unit/compliance.test.ts:42 ("flags a business-opportunity statement for review (§5.3-3)")' },
  { id: 'F02', lang: 'es', category: 'OPPORTUNITY', groundTruth: 'FLAG',
    content: 'Tengo una oportunidad de negocio para ti.',
    source: 'constructed: Spanish equivalent of F01; classifier-config.ts OPPORTUNITY es_business_opportunity pattern (0.7, review-band disclaimer threshold, not the 0.85 block threshold)' },
  { id: 'F03', lang: 'en', category: 'INCOME_CLAIM', groundTruth: 'FLAG',
    content: 'This could be a nice source of extra income on the side.',
    source: 'constructed: classifier-config.ts INCOME_CLAIM extra_income pattern (weight 0.4) + engine.ts REVIEW_ESCALATION_FLOOR (§5.4 "fail-toward-caution": any classifier ≥0.4 escalates clear→review)' },
  { id: 'F04', lang: 'en', category: 'REFERRAL', groundTruth: 'FLAG',
    content: "Know anyone who might be a good fit? I'd love an introduction if you think of someone.",
    source: 'constructed: classifier-config.ts REFERRAL know_anyone pattern (weight 0.7) — inside the 0.6–0.8 "TCPA consent verification" review band, below the 0.8 block threshold' },

  // ─────────────────────────────────────────────────────────────────────────
  // PASS (clear band) — benign controls; must NOT be over-blocked
  // ─────────────────────────────────────────────────────────────────────────
  { id: 'P01', lang: 'en', category: 'BENIGN', groundTruth: 'PASS',
    content: 'Hey, want to grab coffee this week?',
    source: 'fixture: tests/unit/compliance.test.ts:52 ("releases genuinely clean content — the ONLY release path")' },
  { id: 'P02', lang: 'en', category: 'BENIGN', groundTruth: 'PASS',
    content: 'Hey, coffee soon?',
    source: 'fixture: tests/unit/compliance.test.ts:94 (legacy review() facade, outcome PASS)' },
  { id: 'P03', lang: 'en', category: 'BENIGN', groundTruth: 'PASS',
    content: 'Great seeing you Saturday — lunch soon?',
    source: 'fixture: tests/unit/cfe-fail-closed.test.ts:141 ("clean input, classifiers clear → released")' },
  { id: 'P04', lang: 'en', category: 'BENIGN', groundTruth: 'PASS',
    content: 'Thanks so much for meeting me on Saturday — great to reconnect!',
    source: 'fixture: tests/unit/cfe-fail-closed.test.ts (licensing-phase suite (d): "clean non-insurance message + unlicensed/licensing_phase → released")' },
  { id: 'P05', lang: 'es', category: 'BENIGN', groundTruth: 'PASS',
    content: 'Qué gusto verte el sábado — ¿almorzamos pronto?',
    source: 'fixture: tests/unit/cfe-spanish.test.ts:35 ("clean Spanish content ... -> PASS")' },
  { id: 'P06', lang: 'en', category: 'BENIGN_NEAR_MISS', groundTruth: 'PASS',
    content: 'We are close friends from church.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts allowedCases ("close" — ordinary unrelated sense, not extraction)' },
  { id: 'P07', lang: 'en', category: 'BENIGN_NEAR_MISS', groundTruth: 'PASS',
    content: "Let's close the loop on that calendar invite.",
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts allowedCases' },
  { id: 'P08', lang: 'en', category: 'BENIGN_NEAR_MISS', groundTruth: 'PASS',
    content: 'She just closed on a house last week.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts allowedCases' },
  { id: 'P09', lang: 'en', category: 'BENIGN_NEAR_MISS', groundTruth: 'PASS',
    content: "Don't sell yourself short — you did great today.",
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts allowedCases' },
  { id: 'P10', lang: 'en', category: 'BENIGN_NEAR_MISS', groundTruth: 'PASS',
    content: 'He sells insurance in three states.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts allowedCases (ordinary profession statement, not a recommendation)' },
  { id: 'P11', lang: 'en', category: 'BENIGN_NEAR_MISS', groundTruth: 'PASS',
    content: 'The board finally closed the deal on the merger this morning.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts allowedCases (T-R15 QC 7.3 over-block fix — transaction-completion idiom, no person/extraction-object)' },
  { id: 'P12', lang: 'en', category: 'BENIGN_NEAR_MISS', groundTruth: 'PASS',
    content: 'Finance does a hard close of the books every month-end.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts allowedCases (accounting idiom, not a sales-technique "hard close")' },
  { id: 'P13', lang: 'en', category: 'BENIGN_NEAR_MISS', groundTruth: 'PASS',
    content: 'The new hire started orientation today.',
    source: 'fixture: tests/unit/vocabulary-classifier.test.ts:218 (T-57 BLOCKER-B2 should-not-match control)' },
  { id: 'P14', lang: 'es', category: 'BENIGN_NEAR_MISS', groundTruth: 'PASS',
    content: 'Vamos a vender a tu equipo la nueva promoción.',
    source: 'fixture: tests/unit/cfe-spanish.test.ts should-not-match control ("tu equipo" is not a gated noun for "vender")' },
  { id: 'P15', lang: 'es', category: 'BENIGN_NEAR_MISS', groundTruth: 'PASS',
    content: 'Prepara el informe trimestral de ventas.',
    source: 'fixture: tests/unit/cfe-spanish.test.ts should-not-match control ("informe de ventas" is not the gated "presentación/cita de ventas" phrase)' },
];
