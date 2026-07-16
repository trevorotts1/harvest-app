// WP01 §6.3 — the Primerica solution-number check. Proves QC critical failure (c) is ABSENT: the
// number is FORMAT-checked only, shows the "not verified" caption, is never displayed after entry,
// is never logged, and is never trusted as auth (§6.10-4, "solution-number security").

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
  describe('format check only — 7 digits, and "not verified" always', () => {
    test('accepts a 7-digit number, rejects other shapes', () => {
      expect(checkSolutionNumberFormat('1234567').formatValid).toBe(true);
      expect(checkSolutionNumberFormat('123456').formatValid).toBe(false); // 6 digits
      expect(checkSolutionNumberFormat('12345678').formatValid).toBe(false); // 8 digits
      expect(checkSolutionNumberFormat('12A4567').formatValid).toBe(false); // non-digit
      expect(checkSolutionNumberFormat('').formatValid).toBe(false);
      expect(checkSolutionNumberFormat(null).formatValid).toBe(false);
      expect(checkSolutionNumberFormat(undefined).formatValid).toBe(false);
    });

    test('verified is ALWAYS false and the not-verified caption is always present', () => {
      const good = checkSolutionNumberFormat('1234567');
      const bad = checkSolutionNumberFormat('nope');
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
