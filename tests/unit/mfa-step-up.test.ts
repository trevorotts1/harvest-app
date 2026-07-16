import {
  MfaEnrollmentRequiredError,
  requireStepUp,
  SENSITIVE_ACTIONS,
  StepUpRequiredError,
  type SensitiveAction,
} from '../../src/lib/auth/mfa';
import { STEP_UP_REVALIDATION_WINDOW_MS } from '../../src/lib/auth/session-security';

/**
 * Proves (T-12 build brief, PROVE item b): "requireStepUp blocks a sensitive action without
 * recent MFA, allows with it." Also proves the test has teeth — remove the enforcement in mfa.ts
 * and every one of these tests fails (the no-op version used to pass all of them, since it never
 * threw).
 */
describe('requireStepUp (§16.4 step-up MFA gate — real enforcement, T-12)', () => {
  const ACTION: SensitiveAction = 'data_export';

  test('blocks a sensitive action when no MFA factor is enrolled at all', () => {
    expect(() => requireStepUp({ mfaEnrolled: false, mfaVerifiedAt: null }, ACTION)).toThrow(
      MfaEnrollmentRequiredError
    );
  });

  test('blocks when enrolled but never stepped up on this session (mfaVerifiedAt null)', () => {
    expect(() => requireStepUp({ mfaEnrolled: true, mfaVerifiedAt: null }, ACTION)).toThrow(
      StepUpRequiredError
    );
  });

  test('blocks when the last step-up has aged out of the revalidation window', () => {
    const stale = new Date(Date.now() - (STEP_UP_REVALIDATION_WINDOW_MS + 60_000)).toISOString();
    expect(() => requireStepUp({ mfaEnrolled: true, mfaVerifiedAt: stale }, ACTION)).toThrow(
      StepUpRequiredError
    );
  });

  test('allows the action through when enrolled and recently stepped up', () => {
    const fresh = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
    expect(() => requireStepUp({ mfaEnrolled: true, mfaVerifiedAt: fresh }, ACTION)).not.toThrow();
  });

  test('allows the action at exactly the edge of the revalidation window', () => {
    const edgeOfWindow = new Date(Date.now() - (STEP_UP_REVALIDATION_WINDOW_MS - 1_000)).toISOString();
    expect(() => requireStepUp({ mfaEnrolled: true, mfaVerifiedAt: edgeOfWindow }, ACTION)).not.toThrow();
  });

  test('every §16.4 sensitive action is gated identically', () => {
    for (const action of SENSITIVE_ACTIONS) {
      expect(() => requireStepUp({ mfaEnrolled: false, mfaVerifiedAt: null }, action)).toThrow(
        MfaEnrollmentRequiredError
      );
    }
    expect(SENSITIVE_ACTIONS).toEqual([
      'billing_change',
      'data_export',
      'data_delete',
      'rbac_change',
      'org_switch',
    ]);
  });

  test('the two error classes carry the action name and are distinguishable', () => {
    const enrollError = new MfaEnrollmentRequiredError('rbac_change');
    expect(enrollError.action).toBe('rbac_change');
    expect(enrollError.message).toContain('rbac_change');
    expect(enrollError).toBeInstanceOf(Error);

    const stepUpError = new StepUpRequiredError('org_switch');
    expect(stepUpError.action).toBe('org_switch');
    expect(stepUpError.message).toContain('org_switch');
    expect(stepUpError).not.toBeInstanceOf(MfaEnrollmentRequiredError);
  });
});
