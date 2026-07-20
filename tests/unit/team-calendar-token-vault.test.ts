// T-45 (WP09 §14.1, §0.4) — token-vault.ts: the OAuth/CalDAV credential sealing boundary.
// Fail-closed: absent CALENDAR_TOKEN_ENCRYPTION_KEY, both encrypt/decrypt resolve to null rather
// than throwing or fabricating a usable credential.

import {
  encryptCalendarToken,
  decryptCalendarToken,
  isTokenVaultConfigured,
  generateCalendarVaultKeyForTesting,
} from '../../src/services/team-calendar/token-vault';

const VAULT_KEY_ENV = 'CALENDAR_TOKEN_ENCRYPTION_KEY';

describe('WP09 token-vault', () => {
  const originalKey = process.env[VAULT_KEY_ENV];
  afterEach(() => {
    if (originalKey === undefined) delete process.env[VAULT_KEY_ENV];
    else process.env[VAULT_KEY_ENV] = originalKey;
  });

  it('round-trips a credential through encrypt/decrypt when the vault key is configured', () => {
    process.env[VAULT_KEY_ENV] = generateCalendarVaultKeyForTesting();
    expect(isTokenVaultConfigured()).toBe(true);

    const tokenRef = encryptCalendarToken({ accessToken: 'abc123', refreshToken: 'xyz789', expiresAt: 12345 });
    expect(tokenRef).not.toBeNull();
    expect(tokenRef).not.toContain('abc123'); // never plaintext in the sealed ref

    const decrypted = decryptCalendarToken(tokenRef);
    expect(decrypted).toEqual({ accessToken: 'abc123', refreshToken: 'xyz789', expiresAt: 12345 });
  });

  it('fails closed (null, never throws) when the vault key is absent', () => {
    delete process.env[VAULT_KEY_ENV];
    expect(isTokenVaultConfigured()).toBe(false);
    expect(encryptCalendarToken({ accessToken: 'abc' })).toBeNull();
    expect(decryptCalendarToken('v1:whatever')).toBeNull();
  });

  it('fails closed (null) for a malformed token_ref, never a crash', () => {
    process.env[VAULT_KEY_ENV] = generateCalendarVaultKeyForTesting();
    expect(decryptCalendarToken('not-a-real-sealed-ref')).toBeNull();
    expect(decryptCalendarToken(null)).toBeNull();
    expect(decryptCalendarToken(undefined)).toBeNull();
  });

  it('fails closed when decrypting with a DIFFERENT key than it was sealed with (rotation safety)', () => {
    process.env[VAULT_KEY_ENV] = generateCalendarVaultKeyForTesting();
    const tokenRef = encryptCalendarToken({ accessToken: 'abc123' });
    process.env[VAULT_KEY_ENV] = generateCalendarVaultKeyForTesting(); // rotate to a different key
    expect(decryptCalendarToken(tokenRef)).toBeNull();
  });
});
