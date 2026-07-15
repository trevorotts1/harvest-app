import crypto from 'crypto';
import {
  AES_256_ALGORITHM,
  KEY_LENGTH_BYTES,
  IV_LENGTH_BYTES,
  AUTH_TAG_LENGTH_BYTES,
} from '../../../types/compliance';

/**
 * AES-256-GCM encryption at rest utility.
 * Uses Node.js crypto module for all cryptographic operations.
 * Key management should be handled by a KMS (e.g., Google Cloud KMS) in production.
 */

export interface EncryptionResult {
  ciphertext: string; // base64 encoded
  iv: string;          // base64 encoded
  authTag: string;     // base64 encoded
  algorithm: string;
}

export interface DecryptionInput {
  ciphertext: string; // base64 encoded
  iv: string;          // base64 encoded
  authTag: string;     // base64 encoded
}

// TLS 1.3 posture constants and enforcement helpers
export const TLS_CONFIG = {
  MIN_VERSION: 'TLSv1.3' as const,
  PREFERRED_CIPHERS: [
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'TLS_AES_128_GCM_SHA256',
  ],
  REJECT_UNAUTHORIZED: true,
  MIN_DH_KEY_SIZE: 2048,
} as const;

/**
 * Generate a new AES-256 encryption key.
 * In production, this should come from a KMS.
 */
export function generateEncryptionKey(): string {
  const key = crypto.randomBytes(KEY_LENGTH_BYTES);
  return key.toString('base64');
}

/**
 * Encrypt plaintext data using AES-256-GCM.
 */
export function encrypt(plaintext: string, keyBase64: string): EncryptionResult {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(`Invalid key length: expected ${KEY_LENGTH_BYTES} bytes, got ${key.length}`);
  }

  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(AES_256_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    algorithm: AES_256_ALGORITHM,
  };
}

/**
 * Decrypt ciphertext using AES-256-GCM.
 */
export function decrypt(input: DecryptionInput, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(`Invalid key length: expected ${KEY_LENGTH_BYTES} bytes, got ${key.length}`);
  }

  const iv = Buffer.from(input.iv, 'base64');
  const authTag = Buffer.from(input.authTag, 'base64');

  const decipher = crypto.createDecipheriv(AES_256_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(input.ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Convenience wrapper: encrypt PII string, returning an EncryptedPayload object.
 * If no key is provided, a new one is generated (use for one-shot encryption).
 */
export function encryptPII(plaintext: string, keyBase64?: string): EncryptedPayload & { key?: string } {
  const key = keyBase64 || generateEncryptionKey();
  const result = encrypt(plaintext, key);
  return {
    ciphertext: result.ciphertext,
    iv: result.iv,
    authTag: result.authTag,
    algorithm: result.algorithm,
    key: keyBase64 ? undefined : key,
  };
}

/**
 * Convenience wrapper: decrypt an EncryptedPayload back to plaintext.
 * If payload includes a key property, uses that; otherwise requires keyBase64.
 */
export function decryptPII(payload: EncryptedPayload & { key?: string }, keyBase64?: string): string {
  const key = keyBase64 || payload.key || '';
  return decrypt(
    { ciphertext: payload.ciphertext, iv: payload.iv, authTag: payload.authTag },
    key
  );
}

/**
 * Re-export EncryptedPayload as a convenience alias for data-rights consumers.
 */
export type EncryptedPayload = EncryptionResult;

/**
 * Enforce TLS 1.3 minimum for a given connection configuration.
 * Returns an object suitable for Node.js https/tls options.
 */
export function enforceTLS13(): { minVersion: string; rejectUnauthorized: boolean; ciphers?: string } {
  return {
    minVersion: TLS_CONFIG.MIN_VERSION,
    rejectUnauthorized: TLS_CONFIG.REJECT_UNAUTHORIZED,
    ciphers: TLS_CONFIG.PREFERRED_CIPHERS.join(':'),
  };
}

/**
 * Verify that a given TLS version meets the minimum requirement.
 */
export function isTLSVersionCompliant(version: string): boolean {
  const validVersions = ['TLSv1.3', '1.3', 'v1.3'];
  return validVersions.includes(version);
}

/**
 * Hash sensitive data using SHA-256 for audit logging (one-way).
 *
 * NOTE: this is plain/unkeyed SHA-256. It is suitable for content-integrity hashing
 * (see `contentHash` below) but is NOT suitable for hashing low-entropy identifiers like phone
 * numbers or emails for cross-rep matching (opt-out registry, dedup) — an unkeyed hash of a
 * phone number is trivially reversible by brute force over the small input space. Use
 * `hmacForMatch` (below) for phone_hash/email_hash/identifier_hash instead.
 */
export function hashForAudit(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Name of the server-side pepper secret used to key `hmacForMatch`. Read by name only —
 * never log or print the value (§0.4).
 */
export const CONTACT_HASH_PEPPER_ENV_VAR = 'CONTACT_HASH_PEPPER';

/**
 * Deterministic **keyed** HMAC-SHA256 hash for cross-rep PII matching (phone_hash/email_hash on
 * Contact, identifier_hash on OptOutRegistry — §3, §3.4, §10.4).
 *
 * Unlike `hashForAudit`/plain SHA-256, this is resistant to brute-force reversal of low-entropy
 * inputs (e.g. phone numbers) because the digest is keyed by a server-side pepper that never
 * leaves the backend. The pepper is read from the environment by name only
 * (`CONTACT_HASH_PEPPER`) — this function never reads or logs the pepper's value beyond passing
 * it into `crypto.createHmac`.
 *
 * FAIL-CLOSED: if `CONTACT_HASH_PEPPER` is unset (or empty), this throws rather than silently
 * falling back to an unkeyed hash. Callers must not catch-and-ignore this error path.
 */
export function hmacForMatch(value: string): string {
  const pepper = process.env[CONTACT_HASH_PEPPER_ENV_VAR];
  if (!pepper) {
    throw new Error(
      `${CONTACT_HASH_PEPPER_ENV_VAR} is not set — refusing to fall back to an unkeyed hash for PII matching.`
    );
  }
  return crypto.createHmac('sha256', pepper).update(value).digest('hex');
}

/**
 * Generate a content hash for immutable audit trail entries.
 */
export function contentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}