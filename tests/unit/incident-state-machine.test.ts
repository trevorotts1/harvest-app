import {
  applyIncidentTransition,
  assertNotifyBeforeResolve,
  legalIncidentActionsFrom,
} from '../../src/services/security/incident/incident-state-machine';

/**
 * Proves the §16.7 runbook lifecycle (build-brief item 3): detected -> triaged -> contained ->
 * {notified -> resolved | resolved}, plus the breach-notification safety guard layered on top of
 * the pure table.
 */
describe('incident runbook state machine (§16.7 item 3)', () => {
  test('the full happy path is legal in order: DETECTED->TRIAGED->CONTAINED->NOTIFIED->RESOLVED', () => {
    expect(applyIncidentTransition('DETECTED', 'TRIAGE')).toMatchObject({ ok: true, to: 'TRIAGED' });
    expect(applyIncidentTransition('TRIAGED', 'CONTAIN')).toMatchObject({ ok: true, to: 'CONTAINED' });
    expect(applyIncidentTransition('CONTAINED', 'NOTIFY')).toMatchObject({ ok: true, to: 'NOTIFIED' });
    expect(applyIncidentTransition('NOTIFIED', 'RESOLVE')).toMatchObject({ ok: true, to: 'RESOLVED' });
  });

  test('CONTAINED may also resolve directly (legal at the pure-table level; the breach guard below governs whether it SHOULD)', () => {
    expect(applyIncidentTransition('CONTAINED', 'RESOLVE')).toMatchObject({ ok: true, to: 'RESOLVED' });
  });

  test('skipping a step is illegal (DETECTED cannot jump to CONTAIN/NOTIFY/RESOLVE)', () => {
    expect(applyIncidentTransition('DETECTED', 'CONTAIN').ok).toBe(false);
    expect(applyIncidentTransition('DETECTED', 'NOTIFY').ok).toBe(false);
    expect(applyIncidentTransition('DETECTED', 'RESOLVE').ok).toBe(false);
  });

  test('RESOLVED is terminal — no action is legal from it', () => {
    expect(legalIncidentActionsFrom('RESOLVED')).toEqual([]);
    const result = applyIncidentTransition('RESOLVED', 'TRIAGE');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/terminal/);
  });

  test('an illegal transition names the legal actions from that state in its error', () => {
    const result = applyIncidentTransition('TRIAGED', 'NOTIFY');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Legal actions from "TRIAGED": CONTAIN/);
  });

  describe('assertNotifyBeforeResolve — the breach-notification safety guard (extra teeth beyond the pure table)', () => {
    test('rejects CONTAINED -> RESOLVED while the breach class is still clock-applicable', () => {
      const guard = assertNotifyBeforeResolve('CONTAINED', true);
      expect(guard).not.toBeNull();
      expect(guard).toMatch(/must be NOTIFIED before it can be RESOLVED/);
    });

    test('allows CONTAINED -> RESOLVED once breach class is NOT_PERSONAL_DATA (guard is a no-op)', () => {
      expect(assertNotifyBeforeResolve('CONTAINED', false)).toBeNull();
    });

    test('is a no-op from any other state (NOTIFIED -> RESOLVED is always fine, breach or not)', () => {
      expect(assertNotifyBeforeResolve('NOTIFIED', true)).toBeNull();
      expect(assertNotifyBeforeResolve('NOTIFIED', false)).toBeNull();
    });
  });
});
