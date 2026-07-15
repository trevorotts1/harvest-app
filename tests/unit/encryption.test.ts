// T-03 QC fix (defect 2 + 3): hashForAudit() was plain/unkeyed SHA-256, reversible for
// low-entropy inputs like phone numbers, despite the schema comment claiming HMAC-SHA256.
// hmacForMatch() is the real keyed HMAC-SHA256 replacement; these tests assert it is
// deterministic under a fixed pepper, actually keyed (not a disguised unkeyed hash), and that it
// fails closed (throws) rather than silently degrading when the pepper is absent.
import crypto from 'crypto';
import { hmacForMatch, CONTACT_HASH_PEPPER_ENV_VAR } from '../../src/services/compliance/encryption/encryption';

describe('hmacForMatch (keyed HMAC-SHA256 for PII matching hashes)', () => {
  const ORIGINAL = process.env[CONTACT_HASH_PEPPER_ENV_VAR];

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env[CONTACT_HASH_PEPPER_ENV_VAR];
    } else {
      process.env[CONTACT_HASH_PEPPER_ENV_VAR] = ORIGINAL;
    }
  });

  test('is deterministic for a fixed pepper and fixed input', () => {
    process.env[CONTACT_HASH_PEPPER_ENV_VAR] = 'test-only-dummy-pepper-do-not-use-in-prod';
    const a = hmacForMatch('+15551234567');
    const b = hmacForMatch('+15551234567');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // hex-encoded 32-byte SHA-256 digest
  });

  test('is actually keyed: different peppers produce different digests for the same input', () => {
    process.env[CONTACT_HASH_PEPPER_ENV_VAR] = 'pepper-one';
    const withPepperOne = hmacForMatch('+15551234567');

    process.env[CONTACT_HASH_PEPPER_ENV_VAR] = 'pepper-two';
    const withPepperTwo = hmacForMatch('+15551234567');

    expect(withPepperOne).not.toBe(withPepperTwo);
  });

  test('does not silently degrade to an unkeyed SHA-256 of the same input', () => {
    process.env[CONTACT_HASH_PEPPER_ENV_VAR] = 'test-only-dummy-pepper-do-not-use-in-prod';
    const keyed = hmacForMatch('+15551234567');
    const unkeyed = crypto.createHash('sha256').update('+15551234567').digest('hex');
    expect(keyed).not.toBe(unkeyed);
  });

  test('fails closed: throws when CONTACT_HASH_PEPPER is unset', () => {
    delete process.env[CONTACT_HASH_PEPPER_ENV_VAR];
    expect(() => hmacForMatch('+15551234567')).toThrow();
  });

  test('fails closed: throws when CONTACT_HASH_PEPPER is an empty string', () => {
    process.env[CONTACT_HASH_PEPPER_ENV_VAR] = '';
    expect(() => hmacForMatch('+15551234567')).toThrow();
  });
});
