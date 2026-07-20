// T-45 (WP09, §14.1; §0.4 secrets hygiene) — the OAuth/CalDAV credential vault boundary.
//
// `CalendarLink.token_ref` is documented (prisma/schema.prisma) as "pointer to the secret store —
// never a token value". This module is that boundary: it AES-256-GCM encrypts a per-user calendar
// credential blob (Google OAuth refresh token, or a CalDAV app-specific password) using the
// pre-existing `src/services/compliance/encryption/encryption.ts` primitive, and returns the
// serialized ciphertext as the opaque string `CalendarLink.token_ref` stores — so even a direct
// database read of that column never yields a usable credential.
//
// LAZY INSTANTIATION (§0.4/build-safety, the same convention as twilio-client.ts /
// email-auth-client.ts): the vault's master key (`CALENDAR_TOKEN_ENCRYPTION_KEY`) is read BY NAME
// ONLY, lazily, inside `encryptCalendarToken`/`decryptCalendarToken` — never at module scope. A
// key-less `next build` never touches this. Absent the key, both functions return `null` rather
// than throwing or fabricating a usable value — every caller (google-sync.service.ts,
// caldav-sync.service.ts) treats `null` as "the vault is unconfigured" and degrades to
// propose-only / cannot-sync, exactly like a missing Twilio/Anthropic credential fails closed
// elsewhere in this codebase. This is the stated, intentional deviation for this build environment
// (no live Google/CalDAV credentials are available) — the encryption code path itself is real and
// unit-tested; only the "is a real key present" question resolves to "no" here.

import { encrypt, decrypt, generateEncryptionKey, type EncryptionResult } from '../compliance/encryption/encryption';

export const CALENDAR_TOKEN_ENCRYPTION_KEY_ENV_VAR = 'CALENDAR_TOKEN_ENCRYPTION_KEY';

/** True iff the vault's master key is present. Read at call time only — never cached at module scope. */
export function isTokenVaultConfigured(): boolean {
  return Boolean(process.env[CALENDAR_TOKEN_ENCRYPTION_KEY_ENV_VAR]);
}

/** The minimal shape stored per calendar credential — never logged, never returned to a client. */
export interface CalendarCredential {
  accessToken?: string;
  refreshToken?: string;
  /** CalDAV app-specific password, when `provider === 'caldav_ios'`. */
  appPassword?: string;
  /** Epoch ms the access token expires, when known. */
  expiresAt?: number;
}

const SEALED_PREFIX = 'v1:';

/**
 * Encrypts `credential` into the opaque string `CalendarLink.token_ref` stores. Returns `null` if
 * `CALENDAR_TOKEN_ENCRYPTION_KEY` is unset — the caller must treat this as "cannot store a
 * credential right now" (never silently store plaintext, never throw and crash the connect flow).
 */
export function encryptCalendarToken(credential: CalendarCredential): string | null {
  const key = process.env[CALENDAR_TOKEN_ENCRYPTION_KEY_ENV_VAR];
  if (!key) return null;
  const result = encrypt(JSON.stringify(credential), key);
  return SEALED_PREFIX + Buffer.from(JSON.stringify(result satisfies EncryptionResult)).toString('base64');
}

/**
 * Decrypts a `token_ref` produced by `encryptCalendarToken`. Returns `null` on ANY failure
 * (unconfigured vault, malformed ref, wrong/rotated key) — fail-closed: a caller that cannot
 * recover a usable credential must degrade to propose-only, never treat a decrypt failure as "no
 * credential needed."
 */
export function decryptCalendarToken(tokenRef: string | null | undefined): CalendarCredential | null {
  if (!tokenRef || !tokenRef.startsWith(SEALED_PREFIX)) return null;
  const key = process.env[CALENDAR_TOKEN_ENCRYPTION_KEY_ENV_VAR];
  if (!key) return null;
  try {
    const payload = JSON.parse(Buffer.from(tokenRef.slice(SEALED_PREFIX.length), 'base64').toString('utf8')) as EncryptionResult;
    const plaintext = decrypt(payload, key);
    return JSON.parse(plaintext) as CalendarCredential;
  } catch {
    return null;
  }
}

/** Test/dev convenience — never called by production code paths. */
export function generateCalendarVaultKeyForTesting(): string {
  return generateEncryptionKey();
}
