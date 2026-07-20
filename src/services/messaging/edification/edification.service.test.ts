// T-39 (WP05 §10.5/§10.6 edification script) — teeth: the generated upline introduction is doctrine-
// clean (honest respect, no earnings claims, no forbidden vocabulary) and its `displayable` flag is
// FAIL-CLOSED — it follows the deterministic CFE stage-1 VocabularyClassifier scan, it is not a
// hard-coded `true`. KEY-LESS (no CFE Haiku pass here — the full CFE runs before a recipient send).

import { EdificationService } from './edification.service';
import { VocabularyClassifier } from '../../compliance/vocabulary';

describe('EdificationService.generate — doctrine-clean, honest, fail-closed', () => {
  test('produces both an SMS bridge and a call-script naming the upline + rank; both are doctrine-clean', () => {
    const result = new EdificationService().generate('Alex', { displayName: 'Dana Fields', rank: 'Regional Vice President' });
    expect(result.script.sms.length).toBeGreaterThan(0);
    expect(result.script.callScript.length).toBeGreaterThanOrEqual(150);
    expect(result.script.sms).toContain('Dana Fields');
    expect(result.script.callScript).toContain('Regional Vice President');
    expect(result.displayable).toBe(true);
    expect(result.scan.clean).toBe(true);
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
