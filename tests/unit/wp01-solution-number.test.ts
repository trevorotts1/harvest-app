// WP01 §6.3 — the Primerica solution-number check. Proves QC critical failure (c) is ABSENT: the
// number is FORMAT-checked only, shows the "not verified" caption, is never displayed after entry,
// is never logged, and is never trusted as auth (§6.10-4, "solution-number security").
//
// T-R57 (operator directive 2026-07-28, T-BUG live-demo dead-end): the format rule below used to be
// a FABRICATED fixed-7-digit-only check (`/^\d{7}$/`) that had no basis in how Primerica actually
// issues solution IDs (they are alphanumeric, not a fixed 7 digits) and dead-ended real registrants
// during a live operator demo. It is now any alphanumeric combination (letters, digits, hyphens;
// 1-64 characters, trimmed) — the tests below are the SANITY proof that the bug is fixed: a value
// the OLD rule rejected (e.g. 'ABC1234', 'SOL-2024') now VALIDATES, while empty/whitespace-only or a
// non-alphanumeric-symbol string still correctly REJECTS.

import { OrgType } from '@prisma/client';

import { decryptPII, generateEncryptionKey } from '../../src/services/compliance/encryption/encryption';
import {
  SOLUTION_NUMBER_MASK,
  SOLUTION_NUMBER_NOT_VERIFIED_CAPTION,
  checkSolutionNumberForOrg,
  checkSolutionNumberFormat,
  encryptSolutionNumber,
  maskSolutionNumber,
} from '../../src/services/onboarding/wp01/solution-number';

describe('WP01 solution-number check (§6.3)', () => {
  describe('format check only — any alphanumeric (1-64 chars, letters/digits/hyphens), and "not verified" always', () => {
    test('SANITY (T-R57): an alphanumeric value the OLD fixed-7-digit rule rejected now VALIDATES', () => {
      // These would all have been `formatValid: false` under the pre-T-R57 `/^\d{7}$/` rule — the
      // exact bug that dead-ended a real registrant's live demo. They must now be `true`.
      expect(checkSolutionNumberFormat('ABC1234').formatValid).toBe(true); // mixed alphanumeric
      expect(checkSolutionNumberFormat('SOL-2024').formatValid).toBe(true); // hyphen
      expect(checkSolutionNumberFormat('A1').formatValid).toBe(true); // short, non-7-length
      expect(checkSolutionNumberFormat('12A4567').formatValid).toBe(true); // was rejected as "non-digit"
      expect(checkSolutionNumberFormat('123456').formatValid).toBe(true); // was rejected as "6 digits"
      expect(checkSolutionNumberFormat('12345678').formatValid).toBe(true); // was rejected as "8 digits"
      expect(checkSolutionNumberFormat('ABCDEFG').formatValid).toBe(true); // was rejected as "non-digit"
      // Still-valid plain-digit case, unaffected by the relaxation.
      expect(checkSolutionNumberFormat('1234567').formatValid).toBe(true);
    });

    test('SANITY (T-R57): empty/whitespace-only still REJECTS, and non-alphanumeric symbols still REJECT', () => {
      expect(checkSolutionNumberFormat('').formatValid).toBe(false);
      expect(checkSolutionNumberFormat('   ').formatValid).toBe(false); // whitespace-only, trimmed to empty
      expect(checkSolutionNumberFormat(null).formatValid).toBe(false);
      expect(checkSolutionNumberFormat(undefined).formatValid).toBe(false);
      expect(checkSolutionNumberFormat('ABC#123').formatValid).toBe(false); // disallowed symbol
      expect(checkSolutionNumberFormat('AB C123').formatValid).toBe(false); // internal space
      expect(checkSolutionNumberFormat('A'.repeat(65)).formatValid).toBe(false); // over the 64-char max
    });

    test('leading/trailing whitespace is trimmed before testing, so incidental copy-paste padding does not reject an otherwise-valid value', () => {
      expect(checkSolutionNumberFormat('  ABC1234  ').formatValid).toBe(true);
      expect(checkSolutionNumberFormat('\tSOL-2024\n').formatValid).toBe(true);
    });

    test('verified is ALWAYS false and the not-verified caption is always present', () => {
      const good = checkSolutionNumberFormat('ABC1234');
      const bad = checkSolutionNumberFormat('###');
      expect(good.verified).toBe(false);
      expect(bad.verified).toBe(false);
      expect(good.caption).toBe(SOLUTION_NUMBER_NOT_VERIFIED_CAPTION);
      expect(good.caption).toMatch(/not verified/i);
    });
  });

  describe('security — never displayed, never logged, never trusted as auth', () => {
    test('the check result never echoes the raw number back', () => {
      const raw = '7654321';
      const result = checkSolutionNumberForOrg(OrgType.PRIMERICA, raw);
      // No property of the result should contain the raw value.
      expect(JSON.stringify(result)).not.toContain(raw);
    });

    test('maskSolutionNumber returns only the mask, never the digits', () => {
      expect(maskSolutionNumber('1234567')).toBe(SOLUTION_NUMBER_MASK);
      expect(maskSolutionNumber('1234567')).not.toContain('1');
    });

    test('the result carries NO auth/entitlement grant — only formatValid/verified/caption', () => {
      const result = checkSolutionNumberFormat('1234567');
      expect(Object.keys(result).sort()).toEqual(['caption', 'formatValid', 'verified']);
      // Nothing that could be read as a session/role/tier/access grant.
      const forbidden = ['role', 'accessTier', 'token', 'session', 'userId', 'authorized', 'granted'];
      for (const key of forbidden) {
        expect(result).not.toHaveProperty(key);
      }
    });

    test('a valid solution number does NOT buy the Primerica branch — it is gated BEHIND org_type', () => {
      // A non-Primerica user submitting a perfectly-formatted number is REFUSED fail-closed: the
      // number can never authorize a branch the org type didn't grant.
      const refused = checkSolutionNumberForOrg(OrgType.EXTERNAL, '1234567');
      expect(refused.formatValid).toBe(false);
      expect(refused.refused).toBe('NOT_PRIMERICA_BRANCH');
      expect(refused.verified).toBe(false);

      // The same input IS format-checked for a Primerica user (org type is the gate, not the number).
      expect(checkSolutionNumberForOrg(OrgType.PRIMERICA, '1234567').formatValid).toBe(true);
    });

    test('SANITY (T-R57): checkSolutionNumberForOrg(PRIMERICA, ...) — an alphanumeric value the OLD rule rejected now formatValid:true; empty still formatValid:false', () => {
      expect(checkSolutionNumberForOrg(OrgType.PRIMERICA, 'ABC1234').formatValid).toBe(true);
      expect(checkSolutionNumberForOrg(OrgType.PRIMERICA, 'SOL-2024').formatValid).toBe(true);
      expect(checkSolutionNumberForOrg(OrgType.PRIMERICA, '').formatValid).toBe(false);
      expect(checkSolutionNumberForOrg(OrgType.PRIMERICA, null).formatValid).toBe(false);
    });
  });

  describe('storage — encrypted, never plaintext (§3.2)', () => {
    test('encryptSolutionNumber produces ciphertext that round-trips but never stores plaintext', () => {
      const raw = '1234567';
      const key = generateEncryptionKey();
      const payload = encryptSolutionNumber(raw, key);

      expect(payload.ciphertext).toBeTruthy();
      expect(payload.ciphertext).not.toContain(raw);
      // Round-trips with the key (proves it is real encryption, not a no-op).
      expect(decryptPII(payload, key)).toBe(raw);
    });
  });
});
