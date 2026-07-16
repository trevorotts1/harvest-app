import { generate, generateSecret, generateURI, verify } from 'otplib';

/**
 * RFC 6238 TOTP wrapper (T-12, master-spec §16.4 "Supported factors: TOTP authenticator ...").
 *
 * Thin, intentional wrapper around `otplib` (the one new dependency this unit adds — a minimal,
 * mainstream, actively-maintained TOTP/HOTP library with zero native bindings, pure-JS crypto via
 * its default Noble plugin) rather than hand-rolling HMAC-SHA1/base32 — RFC 6238 has enough sharp
 * edges (base32 padding, constant-time comparison, step/window math) that re-implementing it is
 * the wrong place to spend this unit's engineering budget. Every default below (SHA-1, 6 digits,
 * 30-second period) matches RFC 6238 and every mainstream authenticator app (Google Authenticator,
 * Authy, 1Password, etc.).
 *
 * This module never touches persistence or encryption — see src/lib/auth/mfa.ts for the
 * encrypted-at-rest storage format (`User.mfa_methods`) built on top of these primitives.
 */

const ISSUER = 'The Harvest';

/** ±1 time-step (30s) tolerance each direction — absorbs ordinary clock drift without materially
 *  widening the guessable window (RFC 6238 §5.2's own transmission-delay rationale). */
const VERIFY_EPOCH_TOLERANCE_SECONDS = 30;

/** Generates a new random Base32-encoded TOTP secret (160 bits of entropy). */
export function generateTotpSecret(): string {
  return generateSecret();
}

/** Builds the `otpauth://` enrollment URI an authenticator app scans as a QR code. */
export function buildTotpEnrollmentUri(secret: string, accountLabel: string): string {
  return generateURI({ issuer: ISSUER, label: accountLabel, secret });
}

/** Generates the current 6-digit TOTP code for `secret` — test/debugging use only in this build (no live SMS/QR display surface exists yet). */
export async function generateTotpCode(secret: string, epochSeconds?: number): Promise<string> {
  return generate({ secret, epoch: epochSeconds });
}

export interface TotpVerifyResult {
  valid: boolean;
  /** Time-step offset the match occurred at (0 = no drift); undefined when invalid. */
  delta?: number;
}

/**
 * Verifies a submitted TOTP code against `secret`, within the standard clock-drift tolerance.
 * Rejects a code generated further in the past (or future) than the tolerance window — this is
 * how "expired code" rejection is proven (tests/unit/mfa-totp.test.ts generates a code at an old
 * `epoch` and confirms it is rejected here).
 */
export async function verifyTotpCode(secret: string, token: string): Promise<TotpVerifyResult> {
  if (!token || !/^\d{6}$/.test(token)) {
    return { valid: false };
  }
  const result = await verify({ secret, token, epochTolerance: VERIFY_EPOCH_TOLERANCE_SECONDS });
  return result.valid ? { valid: true, delta: result.delta } : { valid: false };
}
