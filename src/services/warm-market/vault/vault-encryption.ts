// T-22 (The Vault, master-spec §7.1 "AES-256 encryption before persistence"; QC WP02 critical
// failure #1 "unencrypted PII") — application-layer at-rest encryption for Contact PII.
//
// Mirrors the exact pattern already established for every other PII-bearing model in this codebase
// (src/services/onboarding/wp01/solution-number.ts's `SOLUTION_NUMBER_ENCRYPTION_KEY`; src/services
// /onboarding/wp01/seven-whys/persistence.ts's `WHY_SESSION_ENCRYPTION_KEY`; src/lib/auth/env.ts's
// `MFA_ENCRYPTION_KEY`): a domain-specific, name-only-read, fail-closed env var feeding the shared
// WP11 `encrypt`/`decrypt` (AES-256-GCM) primitives, with the ciphertext envelope
// (`{ciphertext, iv, authTag, algorithm}`) JSON-serialized into the (String-typed) Prisma column.
//
// `Contact.first_name`/`last_name`/`phone`/`email`/`notes` are the PII surface named in §7.1 ("AES-256
// encryption before persistence") and are the exact fields this module encrypts/decrypts. Matching/
// dedup NEVER uses these columns — that is what `phone_hash`/`email_hash` (keyed HMAC via
// `hmacForMatch`, ../../compliance/encryption/encryption.ts) exist for; ciphertext varies by IV per
// call, so it can never be used for equality lookups anyway.

import { decrypt, encrypt } from '../../compliance/encryption/encryption';

/**
 * Name of the server-side AES-256 key Contact PII (names, phone, email, notes — §7.1) is encrypted
 * at rest with. Read by NAME only (§0.4) — never the value — and fail-closed: a caller that would
 * persist contact PII without an at-rest key is refused rather than silently storing recoverable
 * plaintext.
 */
export const CONTACT_ENCRYPTION_KEY_ENV_VAR = 'CONTACT_ENCRYPTION_KEY';

export function getContactEncryptionKey(): string {
  const key = process.env[CONTACT_ENCRYPTION_KEY_ENV_VAR];
  if (!key) {
    throw new Error(
      `${CONTACT_ENCRYPTION_KEY_ENV_VAR} is not set — refusing to store contact PII (name/phone/` +
        'email/notes) without application-layer encryption at rest (§7.1, §16.4; QC WP02 critical ' +
        'failure "unencrypted PII"). Generate with: openssl rand -base64 32.'
    );
  }
  return key;
}

/** Wire shape stored (JSON-serialized) in every encrypted Contact string column. */
export interface EncryptedEnvelope {
  ciphertext: string;
  iv: string;
  authTag: string;
  algorithm: string;
}

function toEnvelope(plaintext: string, key: string): EncryptedEnvelope {
  const { ciphertext, iv, authTag, algorithm } = encrypt(plaintext, key);
  return { ciphertext, iv, authTag, algorithm };
}

function fromEnvelope(envelope: EncryptedEnvelope, key: string): string {
  return decrypt(envelope, key);
}

/**
 * Encrypt a REQUIRED contact field (`first_name`/`last_name` — non-nullable columns) for storage.
 * Always returns a ciphertext envelope, even for an empty string — there is no plaintext fallback.
 */
export function encryptRequiredField(plaintext: string, key: string = getContactEncryptionKey()): string {
  return JSON.stringify(toEnvelope(plaintext, key));
}

/** Decrypt a value written by `encryptRequiredField`. */
export function decryptRequiredField(stored: string, key: string = getContactEncryptionKey()): string {
  const envelope = JSON.parse(stored) as EncryptedEnvelope;
  return fromEnvelope(envelope, key);
}

/**
 * Encrypt an OPTIONAL contact field (`phone`/`email`/`notes` — nullable columns). `null`/`undefined`/
 * empty-string input is stored as `null` (no envelope) rather than encrypting an empty value — this
 * preserves "no phone on file" as a real null rather than a decryptable-to-empty-string ciphertext,
 * which matters for `phone_hash`/`email_hash` presence checks downstream (§7.6 "needs info" state).
 */
export function encryptOptionalField(
  plaintext: string | null | undefined,
  key: string = getContactEncryptionKey()
): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  return JSON.stringify(toEnvelope(plaintext, key));
}

/** Decrypt a value written by `encryptOptionalField`. Passes `null` through unchanged. */
export function decryptOptionalField(
  stored: string | null | undefined,
  key: string = getContactEncryptionKey()
): string | null {
  if (stored === null || stored === undefined) return null;
  const envelope = JSON.parse(stored) as EncryptedEnvelope;
  return fromEnvelope(envelope, key);
}

/**
 * Decrypts the PII-bearing fields of a stored Contact row back to plaintext for a caller authorized
 * to read it (the row's own owner — e.g. a Vault list view). NOT called anywhere in this build unit's
 * write path; provided as the one seam downstream WP02 consumers (T-23 segmentation/Memory Jogger,
 * T-24 Hidden Earnings, WP04/WP05 outreach) should use instead of reading `contact.first_name` etc.
 * directly, which is ciphertext after T-22 (see the QC WP02 critical failure this unit closes:
 * "unencrypted PII").
 */
export interface EncryptedContactPII {
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

export interface DecryptedContactPII {
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

export function decryptContactPII(
  row: EncryptedContactPII,
  key: string = getContactEncryptionKey()
): DecryptedContactPII {
  return {
    first_name: decryptRequiredField(row.first_name, key),
    last_name: decryptRequiredField(row.last_name, key),
    phone: decryptOptionalField(row.phone, key),
    email: decryptOptionalField(row.email, key),
    notes: decryptOptionalField(row.notes, key),
  };
}
