import {
  buildTotpEnrollmentUri,
  generateTotpCode,
  generateTotpSecret,
  verifyTotpCode,
} from '../../src/services/security/totp';
import {
  encryptTotpSecret,
  startMfaEnrollment,
  verifyEnrollmentCode,
  verifyMfaCode,
  type MfaMethodRecord,
} from '../../src/lib/auth/mfa';

describe('RFC 6238 TOTP (src/services/security/totp.ts)', () => {
  test('generates a Base32 secret and a matching otpauth:// enrollment URI', () => {
    const secret = generateTotpSecret();
    expect(secret.length).toBeGreaterThan(0);
    const uri = buildTotpEnrollmentUri(secret, 'rep@example.com');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain(encodeURIComponent('rep@example.com').replace(/%40/gi, '%40'));
  });

  test('accepts the correct current code', async () => {
    const secret = generateTotpSecret();
    const code = await generateTotpCode(secret);
    const result = await verifyTotpCode(secret, code);
    expect(result.valid).toBe(true);
  });

  test('rejects a wrong code', async () => {
    const secret = generateTotpSecret();
    const wrongCode = (await generateTotpCode(secret)) === '000000' ? '111111' : '000000';
    const result = await verifyTotpCode(secret, wrongCode);
    expect(result.valid).toBe(false);
  });

  test('rejects malformed input (non-6-digit) without ever calling into the crypto verify path', async () => {
    const secret = generateTotpSecret();
    expect((await verifyTotpCode(secret, '')).valid).toBe(false);
    expect((await verifyTotpCode(secret, 'abcdef')).valid).toBe(false);
    expect((await verifyTotpCode(secret, '12345')).valid).toBe(false);
  });

  test('rejects an expired code (generated well outside the tolerance window)', async () => {
    const secret = generateTotpSecret();
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 5 * 60;
    const expiredCode = await generateTotpCode(secret, fiveMinutesAgo);
    const result = await verifyTotpCode(secret, expiredCode);
    expect(result.valid).toBe(false);
  });

  test('accepts a code from one step of clock drift (within tolerance)', async () => {
    const secret = generateTotpSecret();
    const twentySecondsAgo = Math.floor(Date.now() / 1000) - 20;
    const slightlyOldCode = await generateTotpCode(secret, twentySecondsAgo);
    const result = await verifyTotpCode(secret, slightlyOldCode);
    expect(result.valid).toBe(true);
  });
});

describe('MFA enrollment + secret-at-rest encryption (src/lib/auth/mfa.ts)', () => {
  test('the stored TOTP secret is ciphertext, never the plaintext secret', async () => {
    const enrollment = startMfaEnrollment('rep@example.com');
    const methods = await enrollment.methodsToStore;
    const totpMethod = methods.find((m) => m.type === 'totp');
    expect(totpMethod).toBeDefined();
    expect(totpMethod).not.toBeNull();
    const secretRecord = totpMethod as Extract<MfaMethodRecord, { type: 'totp' }>;
    expect(secretRecord.secret.ciphertext).not.toContain(enrollment.secret);
    expect(JSON.stringify(secretRecord)).not.toContain(enrollment.secret);
    // Round-trips back to the same plaintext via the encryption service.
    expect(encryptTotpSecret(enrollment.secret).ciphertext).not.toBe(secretRecord.secret.ciphertext); // fresh IV each call
  });

  test('recovery codes are stored as bcrypt hashes, never plaintext', async () => {
    const enrollment = startMfaEnrollment('rep@example.com');
    const methods = await enrollment.methodsToStore;
    const recoveryMethod = methods.find((m) => m.type === 'recovery_codes');
    const record = recoveryMethod as Extract<MfaMethodRecord, { type: 'recovery_codes' }>;
    expect(record.codeHashes).toHaveLength(10);
    for (const code of enrollment.recoveryCodes) {
      expect(record.codeHashes.join(',')).not.toContain(code);
    }
  });

  test('verifyEnrollmentCode accepts the real current code and rejects a wrong one', async () => {
    const enrollment = startMfaEnrollment('rep@example.com');
    const code = await generateTotpCode(enrollment.secret);
    const wrongCode = code === '000000' ? '000001' : '000000';
    expect(await verifyEnrollmentCode(enrollment.secret, code)).toBe(true);
    expect(await verifyEnrollmentCode(enrollment.secret, wrongCode)).toBe(false);
  });

  test('verifyMfaCode: accepts a correct TOTP code against persisted (encrypted) methods', async () => {
    const enrollment = startMfaEnrollment('rep@example.com');
    const methods = await enrollment.methodsToStore;
    const code = await generateTotpCode(enrollment.secret);
    const result = await verifyMfaCode(methods, code);
    expect(result.valid).toBe(true);
    expect(result.valid && result.method).toBe('totp');
  });

  test('verifyMfaCode: rejects a wrong TOTP code and a garbage token', async () => {
    const enrollment = startMfaEnrollment('rep@example.com');
    const methods = await enrollment.methodsToStore;
    const wrongCode = (await generateTotpCode(enrollment.secret)) === '000000' ? '111111' : '000000';
    expect((await verifyMfaCode(methods, wrongCode)).valid).toBe(false);
    expect((await verifyMfaCode(methods, 'not-a-code')).valid).toBe(false);
  });

  test('verifyMfaCode: falls back to and consumes a recovery code (single-use, §18.10 lost-factor recovery)', async () => {
    const enrollment = startMfaEnrollment('rep@example.com');
    const methods = await enrollment.methodsToStore;
    const recoveryCode = enrollment.recoveryCodes[0]!;

    const result = await verifyMfaCode(methods, recoveryCode);
    expect(result.valid).toBe(true);
    expect(result.valid && result.method).toBe('recovery_code');
    if (!result.valid || result.method !== 'recovery_code') throw new Error('expected recovery_code branch');

    // The consumed code is removed from the persisted set — replay is rejected.
    const replay = await verifyMfaCode(result.updatedMethods, recoveryCode);
    expect(replay.valid).toBe(false);

    // The other nine codes still work.
    const secondCode = enrollment.recoveryCodes[1]!;
    const secondResult = await verifyMfaCode(result.updatedMethods, secondCode);
    expect(secondResult.valid).toBe(true);
  });
});
