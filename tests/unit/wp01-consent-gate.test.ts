// WP01 §6.10-10 (T-21R) — the pure GDPR consent completion-precondition gate. Proves it is fail-
// closed and entirely independent of the §6.10-1 downstream gate (identity-gate.ts), which this
// module does not import, wrap, or reference at all.

import { evaluateConsentCompletionGate } from '../../src/services/onboarding/wp01/consent-gate';

describe('evaluateConsentCompletionGate (§6.10-10)', () => {
  test('explicit boolean true is allowed', () => {
    expect(evaluateConsentCompletionGate(true)).toEqual({ allowed: true });
  });

  // TEETH: if this gate were ever loosened to accept any truthy value (the mistake a naive
  // `if (!gdprConsent)` check would make look identical to for `true`, but NOT for these), every
  // assertion below would flip to `allowed: true` — a non-consent value silently treated as consent.
  test.each([false, undefined, null, 0, '', 'true', 'yes', 1, {}, []])(
    'fails closed for non-true value: %p',
    (value) => {
      const outcome = evaluateConsentCompletionGate(value);
      expect(outcome.allowed).toBe(false);
      if (!outcome.allowed) {
        expect(outcome.reason).toBe('GDPR_CONSENT_REQUIRED');
      }
    }
  );
});
