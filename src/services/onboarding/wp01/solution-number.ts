// WP01 §6.3 — the Primerica "solution number" check.
//
// The solution number is a USER-DECLARED Primerica identifier captured during onboarding (§6.3
// Flow A step 3). This module does exactly three things, and deliberately nothing more:
//
//   1. FORMAT-CHECK ONLY — a user-declared alphanumeric identifier, format-checked but explicitly
//      not verified. We validate the shape (`[A-Za-z0-9-]{1,64}`, i.e. letters, digits, and hyphens,
//      1-64 characters after trimming). This was previously a FABRICATED fixed-7-digit-only rule
//      (`\d{7}`) that had no basis in how Primerica actually issues solution IDs (they are
//      alphanumeric, not a fixed 7 digits) and dead-ended real registrants during a live operator
//      demo; relaxed to accept any alphanumeric combination per operator directive 2026-07-28
//      (T-R57). We make NO claim of having verified it with Primerica — there is no such
//      integration, and pretending otherwise would be a false assurance. Every check result carries
//      `verified: false` (a literal type — it can never be `true` from this module) and the
//      NOT-VERIFIED caption the UI must show after entry (§6.10-4, uiux §5.1).
//   2. NEVER DISPLAY AFTER ENTRY / NEVER LOG (§6.10-4 + QC "solution-number security" critical
//      failure). The check result never echoes the raw number back; `maskSolutionNumber` is the only
//      display form (all-bullets). This module never logs, and nothing here returns the raw value.
//   3. NEVER TRUSTED AS AUTH. A well-formed solution number grants NOTHING — no session, no role, no
//      entitlement, and not even the Primerica branch (which is decided solely by `User.org_type` via
//      the org gate). The check is itself GATED BEHIND the org branch: a non-Primerica user has no
//      solution-number surface at all, so a submission from one is refused fail-closed rather than
//      format-validated.
//
// Storage (§3.2): `User.solution_number` is "nullable, encrypted, Primerica only". `encryptSolution
// Number` returns the ciphertext payload via the WP11 encryption service; the plaintext is never
// persisted.

import { OrgType } from '@prisma/client';

import {
  decryptPII,
  encryptPII,
  type EncryptedPayload,
} from '@/services/compliance/encryption/encryption';

import { isPrimericaBranch } from './org-gate';

/**
 * §6.3: a user-declared alphanumeric identifier (letters, digits, hyphens; 1-64 characters).
 * Format only — no checksum/verification is claimed. Relaxed from the old fixed-7-digit-only rule
 * (`/^\d{7}$/`) per operator directive 2026-07-28 (T-R57): that rule was fabricated — Primerica
 * solution IDs are alphanumeric, not a fixed 7 digits — and it dead-ended real registrants.
 */
export const SOLUTION_NUMBER_FORMAT = /^[A-Za-z0-9-]{1,64}$/;

/** The caption shown after entry (§6.10-4, uiux §5.1) — we never claim a verification we cannot do. */
export const SOLUTION_NUMBER_NOT_VERIFIED_CAPTION =
  'Not verified — we check the format only, not with Primerica.';

/** The only display form of a solution number after entry (§6.10-4: never displayed after entry). */
export const SOLUTION_NUMBER_MASK = '•••••••';

/**
 * The result of a solution-number check. Note what is ABSENT by design: the raw number, any user id,
 * any role, any entitlement/grant. `verified` is the literal `false` — this module cannot verify, and
 * the type makes it impossible for a caller to be handed a `verified: true` from here.
 */
export interface SolutionNumberCheck {
  formatValid: boolean;
  verified: false;
  caption: string;
  /** Why a check was refused outright (out-of-branch), when applicable. */
  refused?: 'NOT_PRIMERICA_BRANCH';
}

/**
 * Format-check a candidate solution number. Returns validity + the not-verified caption ONLY — never
 * the input value. Callers must not log the input; this function does not. The input is trimmed
 * before testing (so incidental leading/trailing whitespace from a copy-paste doesn't reject an
 * otherwise-valid alphanumeric identifier) — the trimmed form is never returned or logged either.
 */
export function checkSolutionNumberFormat(input: string | null | undefined): SolutionNumberCheck {
  const formatValid = typeof input === 'string' && SOLUTION_NUMBER_FORMAT.test(input.trim());
  return {
    formatValid,
    verified: false,
    caption: SOLUTION_NUMBER_NOT_VERIFIED_CAPTION,
  };
}

/**
 * The org-gated entry point WP01 actually calls (§17.1). The solution number is a Primerica-gated
 * field — a non-Primerica user has no such surface — so a submission carrying an `orgType` that is
 * not Primerica is REFUSED fail-closed (`formatValid: false`, `refused`), never format-validated.
 * This is the "never trusted as auth / gated behind the branch, not the reverse" property: a valid
 * number cannot buy its way into the Primerica branch; only `org_type` does.
 */
export function checkSolutionNumberForOrg(
  orgType: OrgType,
  input: string | null | undefined
): SolutionNumberCheck {
  if (!isPrimericaBranch(orgType)) {
    return {
      formatValid: false,
      verified: false,
      caption: SOLUTION_NUMBER_NOT_VERIFIED_CAPTION,
      refused: 'NOT_PRIMERICA_BRANCH',
    };
  }
  return checkSolutionNumberFormat(input);
}

/**
 * The only display form after entry (§6.10-4). Always returns the mask, never the digits — regardless
 * of input — so a display path cannot accidentally render the real number.
 */
export function maskSolutionNumber(_raw: string | null | undefined): string {
  return SOLUTION_NUMBER_MASK;
}

/**
 * Encrypt a solution number for persistence into `User.solution_number` (§3.2 "encrypted, Primerica
 * only"). Delegates to the WP11 encryption service; the returned payload is ciphertext + iv + authTag
 * (+ a generated key only when no key was supplied, per `encryptPII`). The plaintext is never
 * returned and must never be persisted.
 */
export function encryptSolutionNumber(
  raw: string,
  key?: string
): EncryptedPayload & { key?: string } {
  return encryptPII(raw, key);
}

/**
 * Name of the server-side AES-256 key the solution number is encrypted at rest with (§3.2, §16.3).
 * Read by NAME only (§0.4) — never the value — and fail-closed, mirroring
 * `WHY_SESSION_ENCRYPTION_KEY` (seven-whys/persistence.ts) and `MFA_ENCRYPTION_KEY` (lib/auth/env.ts):
 * a caller that would persist a solution number without an at-rest key is refused rather than
 * silently storing recoverable plaintext or a payload keyed by an ephemeral generated key that is
 * then thrown away (which would make the ciphertext undecryptable and, worse, tempt a plaintext
 * fallback). The register route (src/app/api/auth/register/route.ts) is the one live caller.
 */
export const SOLUTION_NUMBER_ENCRYPTION_KEY_ENV_VAR = 'SOLUTION_NUMBER_ENCRYPTION_KEY';

export function getSolutionNumberEncryptionKey(): string {
  const key = process.env[SOLUTION_NUMBER_ENCRYPTION_KEY_ENV_VAR];
  if (!key) {
    throw new Error(
      `${SOLUTION_NUMBER_ENCRYPTION_KEY_ENV_VAR} is not set — refusing to store a Primerica solution ` +
        'number without application-layer encryption at rest (§3.2, §16.3). Generate with: ' +
        'openssl rand -base64 32.'
    );
  }
  return key;
}

/**
 * The at-rest wire form of an encrypted solution number: the JSON-serialized `EncryptedPayload`
 * envelope stored in the (String-typed) `User.solution_number` column. `encryptSolutionNumberForStorage`
 * is the ONE function the register/onboarding write path calls — it format-checks nothing (the caller
 * has already run `checkSolutionNumberForOrg`), encrypts with the server key, and returns a string
 * that is safe to persist and provably not the raw digits. The raw value is never returned, never
 * logged, and (because a real server key is always used) the returned envelope never carries a
 * throwaway `key`.
 */
export function encryptSolutionNumberForStorage(raw: string, key = getSolutionNumberEncryptionKey()): string {
  const { ciphertext, iv, authTag, algorithm } = encryptSolutionNumber(raw, key);
  return JSON.stringify({ ciphertext, iv, authTag, algorithm });
}

/**
 * T-R38 (§6.3, §17.1) — the inverse of `encryptSolutionNumberForStorage`, added so the dense
 * onboarding track (UPLINE/RVP/dual-derived) can REUSE the solution number already captured and
 * persisted (encrypted) at §6.3 registration, instead of requiring the user to re-enter it at the
 * `ROLE_ORG_CONTEXT` step. `UplineTrack.tsx` has no re-entry field for it at all (see
 * `onboarding-step-client.ts`'s own documented gap) — this is what lets the server satisfy that
 * step's real format gate from data that already exists, server-side only, never by adding a new UI
 * capture field or fabricating a value.
 *
 * Fails CLOSED to `null` on ANY error — a missing value, a malformed/non-JSON envelope, a
 * wrong/rotated key, or a tampered ciphertext/authTag are all treated identically to "no persisted
 * solution number exists": the caller's own fallback logic then behaves exactly as if the user had
 * never supplied one (an honest 400 from the format gate), never a fabricated/garbage digit string
 * that might accidentally happen to format-validate. The raw value is never logged; callers must
 * uphold the same "never log/echo" law as the rest of this module.
 */
export function decryptSolutionNumberFromStorage(
  stored: string | null | undefined,
  key = getSolutionNumberEncryptionKey()
): string | null {
  if (!stored) return null;
  try {
    const envelope = JSON.parse(stored) as EncryptedPayload;
    return decryptPII(envelope, key);
  } catch {
    return null;
  }
}
