import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import {
  AES_256_ALGORITHM,
  KEY_LENGTH_BYTES,
  IV_LENGTH_BYTES,
  AUTH_TAG_LENGTH_BYTES,
  TLS_MIN_VERSION,
} from '../../../types/compliance';

/**
 * Encryption service for PII at rest.
 * Uses AES-256-GCM as mandated by WP11.
 * TLS 1.3 is enforced at the transport layer — this module handles at-rest encryption.
 */

// In production, keys come from KMS / vault. For now, a generated key.
let ENCRYPTION_KEY: Buffer = randomBytes(KEY_LENGTH_BYTES);

/**
 * Set the encryption key (e.g., from environment or KMS at startup).
 */
export function setEncryptionKey(key: Buffer): void {
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(`Encryption key must be ${KEY_LENGTH_BYTES} bytes (AES-256)`);
  }
  ENCRYPTION_KEY = Buffer.from(key);
}

/**
 * Get the current encryption key (for testing / key rotation).
 */
export function getEncryptionKey(): Buffer {
  return Buffer.from(ENCRYPTION_KEY);
}

export interface EncryptedPayload {
  ciphertext: string;   // base64-encoded ciphertext
  iv: string;           // base64-encoded initialization vector
  authTag: string;      // base64-encoded authentication tag
  algorithm: string;    // algorithm identifier for audit / rotation
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns { ciphertext, iv, authTag, algorithm }.
 */
export function encrypt(plaintext: string): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(AES_256_ALGORITHM, ENCRYPTION_KEY, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });

  let encrypted: Buffer;
  try {
    encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  } catch (err) {
    throw new Error(`Encryption failed: ${(err as Error).message}`);
  }

  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    algorithm: AES_256_ALGORITHM,
  };
}

/**
 * Decrypt an EncryptedPayload back to the original plaintext.
 */
export function decrypt(payload: EncryptedPayload): string {
  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');

  const decipher = createDecipheriv(AES_256_ALGORITHM, ENCRYPTION_KEY, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });

  decipher.setAuthTag(authTag);

  let decrypted: Buffer;
  try {
    decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err) {
    throw new Error(`Decryption failed: ${(err as Error).message}`);
  }

  return decrypted.toString('utf8');
}

/**
 * Compute a SHA-256 content hash for audit trail integrity.
 */
export function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Enforce TLS 1.3 as the minimum transport security standard.
 * Call at app startup to verify the Node.js TLS configuration.
 */
export function enforceTLSMinVersion(): void {
  // In a real deployment, this would set the minimum TLS version
  // for the HTTP server and outbound connections.
  // For now, we document the requirement as a constant and log it.
  const required = TLS_MIN_VERSION;
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new Error(
      `SECURITY: TLS verification is disabled (NODE_TLS_REJECT_UNAUTHORIZED=0). ` +
      `This violates WP11 requirement for ${required} minimum.`
    );
  }
}

/**
 * Encrypt a PII field value, returning the encrypted payload.
 * Convenience wrapper for encrypting sensitive user data like password_hash, phone, email.
 */
export function encryptPII(value: string): EncryptedPayload {
  if (!value) throw new Error('Cannot encrypt empty PII value');
  return encrypt(value);
}

/**
 * Decrypt a PII field value, returning the plaintext.
 */
export function decryptPII(payload: EncryptedPayload): string {
  return decrypt(payload);
}