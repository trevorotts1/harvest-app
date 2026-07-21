import { VocabularyClassifier, FORBIDDEN_TERMS } from '../../src/services/compliance/vocabulary';
import { ComplianceFilterEngine } from '../../src/services/compliance/engine';
import { LocalDeterministicClassifierClient } from '../../src/services/compliance/claude';
import { InMemoryCFEAuditSink } from '../../src/services/compliance/audit/audit-sink';

/**
 * CFE stage-1 doctrine vocabulary classifier (master-spec §0.5, T-R15 remediation).
 *
 * §0.5's forbidden-term table has 10 rows; before this remediation the classifier
 * implemented 9 of them and was MISSING row 3, "selling / closing (as extraction)".
 * This suite proves: (a) the new rule actually catches extraction-framed
 * selling/closing language, (b) it does NOT false-positive on the spec-allowed
 * vocabulary (CLOSED_RECRUIT, "close of business", "close rate", the CFE's own
 * negative-constraint prompt string), and (c) the other 9 rows are unchanged and
 * still fire — no regression to the existing forbidden-term set.
 */
describe('VocabularyClassifier — §0.5 row 3 "selling / closing (as extraction)" (T-R15)', () => {
  const classifier = new VocabularyClassifier();

  // ---------------------------------------------------------------------------
  // (a) CAUGHT — extraction-framed selling/closing language.
  //
  // MUTATION PROOF: every assertion below is `clean === false` /
  // `forbidden === 'selling'|'closing'` produced ONLY by the two rule entries
  // added in this change. Revert the addition (delete the two new entries from
  // FORBIDDEN_TERMS in src/services/compliance/vocabulary.ts) and every test in
  // this block fails: `scan()` would return `clean: true` for all of them, since
  // none of the pre-existing 9 rows' patterns (prospect/lead/pitch/sales
  // call/funnel/conversion/follower/target audience/recruit/cold
  // outreach/guaranteed income/you will earn) match any of these sentences.
  // ---------------------------------------------------------------------------
  describe('(a) extraction-framed selling/closing is caught', () => {
    const extractionCases: Array<[string, string]> = [
      ['Time to close the deal with this contact.', 'closing'],
      ["I'm going to close them today, no matter what.", 'closing'],
      ["Let's close the sale on this prospect, she won't say no.", 'closing'],
      ["She's a great sales closer, always closing the sale.", 'closing'],
      ["We need to sell them on joining the team tonight.", 'selling'],
      ["Don't overthink it, just close the deal with this lead already.", 'closing'],
      ['He is selling the opportunity way too hard on this call.', 'selling'],
    ];

    it.each(extractionCases)('flags "%s" (forbidden: %s)', (content, expectedForbidden) => {
      const scan = classifier.scan(content);
      expect(scan.clean).toBe(false);
      expect(scan.violations.map((v) => v.forbidden)).toContain(expectedForbidden);
      // Replacement mirrors the §0.5 row-3 required replacement exactly.
      const hit = scan.violations.find((v) => v.forbidden === expectedForbidden)!;
      expect(hit.replacement).toBe('inviting, introducing, welcoming, onboarding');
    });

    it('is wired into the CFE stage-1 pass and blocks release end-to-end', async () => {
      const engine = new ComplianceFilterEngine({
        classifierClient: new LocalDeterministicClassifierClient(),
        auditSink: new InMemoryCFEAuditSink(),
      });
      const v = await engine.evaluateContent({
        content: "Don't overthink it — just close them tonight, sell them on the dream.",
        channel: 'SMS',
        userContext: { user_id: 'u1', role: 'REP' },
      });
      expect(v.band).toBe('blocked');
      expect(v.released).toBe(false);
      expect(v.reason).toMatch(/forbidden_vocabulary/);
      expect(v.reason).toMatch(/closing|selling/);
    });
  });

  // ---------------------------------------------------------------------------
  // (b) NOT false-positived — spec-allowed vocabulary + ordinary English uses.
  // ---------------------------------------------------------------------------
  describe('(b) spec-allowed vocabulary is NOT false-positived', () => {
    const allowedCases: string[] = [
      // The pipeline-stage enum (prisma/schema.prisma PipelineStage.CLOSED_RECRUIT)
      // is the spec-mandated allowed term for a completed sponsorship — must never
      // be caught as "closing (as extraction)".
      'Contact moved to CLOSED_RECRUIT after the appointment.',
      'pipeline_stage: CLOSED_RECRUIT',
      // Legitimate business-hours usage.
      "I'll follow up before close of business today.",
      'Office closes at 5pm on Fridays.',
      // §9.7's Field Trainer's Ratio metric ("close rate") — a legitimate,
      // spec-mandated statistical term, not extraction framing.
      "Your Field Trainer's Ratio measures your trainer's close rate once they run the appointment.",
      'The human close rate stayed flat this month.',
      // Ordinary, unrelated senses of "close"/"sell" that must not trip a
      // doctrine-vocabulary hold on an innocent note or message.
      'We are close friends from church.',
      "Let's close the loop on that calendar invite.",
      'She just closed on a house last week.',
      "Don't sell yourself short — you did great today.",
      'He sells insurance in three states.',
      // --- T-R15 QC 7.3 over-block fixes -----------------------------------
      // Ordinary transaction-completion idiom: "close(d) the deal" with no
      // person/extraction-object — must NOT be treated as extraction-selling
      // a community member just because the object of "on" happens to be a
      // deal/transaction rather than a person.
      'She closed the deal on her new apartment yesterday.',
      'The board finally closed the deal on the merger this morning.',
      'I closed the deal on my new car over the weekend.',
      // Bare "close/closed the deal/sale" alone, with no object at all —
      // also must not match (the old regex matched this unconditionally).
      "Don't overthink it, just close the sale already.",
      // "Hard close"/"soft close" with zero extraction-object gating are
      // accounting and furniture terms, not sales-technique idioms, and the
      // bare alternative that used to catch these regardless of context has
      // been removed.
      'Finance does a hard close of the books every month-end.',
      'These cabinets have a soft close drawers feature.',
    ];

    it.each(allowedCases)('leaves "%s" clean', (content) => {
      const scan = classifier.scan(content);
      expect(scan.clean).toBe(true);
    });

    it('does not flag the CFE\'s own negative-constraint doctrine prompt string', () => {
      // src/services/agent-runtime/prompt-assembly.ts DOCTRINE_SYSTEM_PROMPT
      // legitimately lists "selling, closing (as extraction)" as an
      // instruction to the model (§0.5's negative-constraint layer, §11) — it
      // must never itself be treated as a violation if it were ever scanned.
      const negativeConstraintLine =
        'FORBIDDEN vocabulary (§0.5) — never use: prospect, lead, pitch, sales pitch, sales call, selling, ' +
        'closing (as extraction), funnel, conversion, follower, target/target audience, recruit (as an ' +
        'extraction verb), cold outreach, guaranteed income, "you will earn".';
      const scan = classifier.scan(negativeConstraintLine);
      // This string is expected to be non-clean — it is a doctrine LISTING of
      // the forbidden terms and legitimately contains several of them (e.g.
      // "lead", "pitch"). The point of this test is narrower: the new
      // selling/closing rule's MATCH TEXT is exactly the harmless enumeration
      // phrase "selling, closing (as extraction)" and not some over-broad
      // capture that corrupts the rest of the sentence.
      const sellingOrClosing = scan.violations.filter((v) => v.forbidden === 'selling' || v.forbidden === 'closing');
      expect(sellingOrClosing).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // (c) REGRESSION — the other 9 §0.5 rows still fire unchanged.
  // ---------------------------------------------------------------------------
  describe('(c) the other 9 forbidden-term rows still fire (no regression)', () => {
    const existingRows: Array<[string, string]> = [
      ['Add this prospect to the list.', 'prospect'],
      ['This lead is warm.', 'lead'],
      ['Nail the sales pitch tomorrow.', 'pitch'],
      ['Schedule the sales call for Tuesday.', 'sales call'],
      ['Add them to the funnel.', 'funnel'],
      ['Track the conversion rate.', 'conversion'],
      ['Grow your follower count.', 'follower'],
      ['Define the target audience for this post.', 'target audience'],
      ['We need to recruit five more this month.', 'recruit'],
      ['Cold outreach never works for us.', 'cold outreach'],
      ['This offers guaranteed income for life.', 'guaranteed income'],
      ['You will earn $5,000 in your first month.', 'you will earn'],
    ];

    it.each(existingRows)('still flags "%s" (forbidden: %s)', (content, expectedForbidden) => {
      const scan = classifier.scan(content);
      expect(scan.clean).toBe(false);
      expect(scan.violations.map((v) => v.forbidden)).toContain(expectedForbidden);
    });

    it('FORBIDDEN_TERMS now has exactly 14 rules (12 pre-existing + 2 new: selling, closing)', () => {
      expect(FORBIDDEN_TERMS).toHaveLength(14);
      const labels = FORBIDDEN_TERMS.map((r) => r.forbidden);
      expect(labels).toEqual(
        expect.arrayContaining([
          'prospect', 'lead', 'pitch', 'sales call', 'selling', 'closing', 'funnel',
          'conversion', 'follower', 'target audience', 'recruit', 'cold outreach',
          'guaranteed income', 'you will earn',
        ])
      );
    });
  });
});

/**
 * T-57 BLOCKER-B2 (uiux §6.2/§17.5): the EN "recruit" row (vocabulary.ts:64,
 * `/\brecruit(?:ing|s|ed|ment)?\b/i`) covers the verb paradigm
 * (recruit/recruiting/recruits/recruited/recruitment) but MISSES the agentive noun
 * "recruiter(s)" — the doctrine-forbidden ROLE noun itself. This is a live fail-closed hole:
 * content that names someone as a "recruiter" (rather than using the verb "recruit") slides
 * through stage-1 untouched. Companion to the Spanish "reclutador/a(s)" fix in
 * tests/unit/cfe-spanish.test.ts's "T-57 BLOCKER-B2" describe block.
 */
describe('T-57 BLOCKER-B2 — EN agentive noun "recruiter(s)" in the recruit row', () => {
  const classifier = new VocabularyClassifier();
  // Verbatim pre-fix pattern (copied from vocabulary.ts before the T-57 R1a fix).
  const beforeFixRecruit = /\brecruit(?:ing|s|ed|ment)?\b/i;

  const agentiveCases: Array<[string, string]> = [
    ['Our top recruiter closed five deals this month.', 'recruiter'],
    ['The recruiters gathered for a training call.', 'recruiters'],
    ['She wants to become a recruiter for the team.', 'recruiter'],
  ];

  it.each(agentiveCases)('AFTER(caught): "%s" now flags "recruit" via the agentive form', (content) => {
    const scan = classifier.scan(content);
    expect(scan.clean).toBe(false);
    expect(scan.violations.map((v) => v.forbidden)).toContain('recruit');
    // BEFORE: the verbatim pre-fix pattern misses the agentive-noun form entirely.
    expect(beforeFixRecruit.test(content)).toBe(false);
  });

  it('the other recruit-family forms (recruit/recruiting/recruits/recruited/recruitment) still fire — no regression', () => {
    const stillFires: string[] = [
      'We need to recruit five more this month.',
      'She is recruiting heavily this quarter.',
      'He recruited three new members.',
      'Recruitment is picking up this month.',
    ];
    for (const content of stillFires) {
      expect(classifier.scan(content).clean).toBe(false);
    }
  });

  it('should-not-match control: unrelated words stay clean', () => {
    expect(classifier.scan('The new hire started orientation today.').clean).toBe(true);
  });

  it('end-to-end: the RUNTIME CFE blocks "recruiter" through the full pipeline, zero Haiku signal', async () => {
    const engine = new ComplianceFilterEngine({
      classifierClient: new LocalDeterministicClassifierClient(),
      auditSink: new InMemoryCFEAuditSink(),
    });
    const v = await engine.evaluateContent({
      content: 'Our top recruiter closed five deals this month.',
      channel: 'SMS',
      userContext: { user_id: 'u2', role: 'REP' },
    });
    expect(v.band).toBe('blocked');
    expect(v.released).toBe(false);
    expect(v.reason).toMatch(/forbidden_vocabulary/);
  });
});
