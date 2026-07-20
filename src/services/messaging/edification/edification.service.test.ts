// T-39 (WP05 §10.5/§10.6 edification script) — teeth: the generated upline introduction is doctrine-
// clean (honest respect, no earnings claims, no forbidden vocabulary) and its `displayable` flag is
// FAIL-CLOSED — it follows the deterministic CFE stage-1 VocabularyClassifier scan, it is not a
// hard-coded `true`. KEY-LESS (no CFE Haiku pass here — the full CFE runs before a recipient send).
//
// QC FIX (T-39 must-fix #2): §10.6 specifies the call-script floor as 200-300 WORDS. The prior test
// asserted `callScript.length >= 150` — a CHARACTER count, which does not actually guard the real
// (word-count) spec bound at all (a 150-character string can be as few as ~25 words). `wordCount`
// below splits on whitespace, matching the spec's own unit, so this test fails for real if the
// script ever drops below 200 words or rises above 300 — see the TEETH test at the bottom of this
// describe block for the proof that it actually can fail.

import { EdificationService } from './edification.service';
import { VocabularyClassifier } from '../../compliance/vocabulary';

/** §10.6's own unit — words, not characters. Splits on whitespace, matching how a rep would read
 *  or count the script aloud. */
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

describe('EdificationService.generate — doctrine-clean, honest, fail-closed', () => {
  test('produces both an SMS bridge and a call-script naming the upline + rank; both are doctrine-clean', () => {
    const result = new EdificationService().generate('Alex', { displayName: 'Dana Fields', rank: 'Regional Vice President' });
    expect(result.script.sms.length).toBeGreaterThan(0);
    expect(result.script.sms).toContain('Dana Fields');
    expect(result.script.callScript).toContain('Regional Vice President');
    expect(result.displayable).toBe(true);
    expect(result.scan.clean).toBe(true);
  });

  test('TEETH (§10.6 word-count floor/ceiling): the call-script is between 200 and 300 WORDS, with or without a rank', () => {
    const withRank = new EdificationService().generate('Alex', { displayName: 'Dana Fields', rank: 'Regional Vice President' });
    const withoutRank = new EdificationService().generate('Alex', { displayName: 'Dana Fields' });

    const withRankWords = wordCount(withRank.script.callScript);
    const withoutRankWords = wordCount(withoutRank.script.callScript);

    expect(withRankWords).toBeGreaterThanOrEqual(200);
    expect(withRankWords).toBeLessThanOrEqual(300);
    expect(withoutRankWords).toBeGreaterThanOrEqual(200);
    expect(withoutRankWords).toBeLessThanOrEqual(300);
  });

  test('TEETH: this test actually can fail — a script under 200 words (or over 300) does not satisfy the assertion', () => {
    const tooShort = 'Meet my upline. They are great. Talk soon.';
    const tooLong = Array.from({ length: 310 }, () => 'word').join(' ');
    expect(wordCount(tooShort)).toBeLessThan(200);
    expect(wordCount(tooLong)).toBeGreaterThan(300);
  });

  test('no rank → no dangling separator, still clean + displayable', () => {
    const result = new EdificationService().generate('Alex', { displayName: 'Dana Fields' });
    expect(result.script.sms).not.toContain(' —  ');
    expect(result.displayable).toBe(true);
  });

  test('the generated copy carries NO forbidden doctrine vocabulary (prospect/lead/pitch/close/funnel/recruit)', () => {
    const result = new EdificationService().generate('Alex', { displayName: 'Dana Fields', rank: 'Senior Rep' });
    const both = `${result.script.sms}\n${result.script.callScript}`.toLowerCase();
    for (const bad of ['prospect', 'pitch', 'funnel', 'guaranteed income', 'you will earn']) {
      expect(both).not.toContain(bad);
    }
  });

  test('TEETH: `displayable` follows the classifier — a flag-everything classifier forces displayable=false', () => {
    const flagEverything = new VocabularyClassifier([{ term: /./, forbidden: 'x', replacement: 'y' }]);
    const result = new EdificationService(flagEverything).generate('Alex', { displayName: 'Dana Fields' });
    expect(result.scan.clean).toBe(false);
    expect(result.displayable).toBe(false); // NOT hard-coded true — the floor is wired to the scan
  });
});
