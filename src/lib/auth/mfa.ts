import { randomInt } from 'crypto';

import { Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

import type { EncryptedPayload } from '@/services/compliance/encryption/encryption';
import { decrypt, encrypt } from '@/services/compliance/encryption/encryption';
import {
  buildTotpEnrollmentUri,
  generateTotpSecret,
  verifyTotpCode as verifyTotpCodeRaw,
} from '@/services/security/totp';

import { getMfaEncryptionKey } from './env';
import { isStepUpFresh } from './session-security';

/**
 * MFA — T-04 scaffold, completed by T-12 (master-spec §16.4, §18.10).
 *
 * §16.4 requires MFA for `UPLINE`, `RVP`, and `ADMIN` (offered, not required, for `REP`) with real
 * TOTP enrollment/verification, step-up MFA gating five sensitive actions (billing changes, data
 * export/delete, RBAC changes, org switch), and "MFA secret never plaintext". §18.10 adds: lost-
 * factor recovery via a verified backup factor/recovery codes — never a support bypass that skips
 * identity proof.
 *
 * Enrollment state lives on `User.mfa_enrolled` (boolean) / `User.mfa_methods` (Json — an array of
 * `MfaMethodRecord` below). `mfa_methods` intentionally holds the *encrypted* TOTP secret and
 * *hashed* recovery codes, not just a list of method names — the schema's own §3.2 note ("MFA
 * enrollment state is on User.mfa_enrolled/mfa_methods") is this unit's single storage location
 * for that material, so no new Prisma model/migration is needed for MFA itself (the only T-12
 * schema change is `User.security_version`, for session revocation — see session-security.ts).
 */

// ─────────────────────────────────────────────────────────────────────────
// Role/action requirements (T-04, unchanged)
// ─────────────────────────────────────────────────────────────────────────

/** Roles for which §16.4 makes MFA enrollment mandatory (DUAL inherits UPLINE's requirement). */
export const MFA_REQUIRED_ROLES: readonly Role[] = [Role.UPLINE, Role.RVP, Role.ADMIN, Role.DUAL];

export function isMfaRequiredForRole(role: Role): boolean {
  return MFA_REQUIRED_ROLES.includes(role);
}

/** The five §16.4 sensitive actions that require a step-up MFA challenge before they proceed. */
export type SensitiveAction =
  | 'billing_change'
  | 'data_export'
  | 'data_delete'
  | 'rbac_change'
  | 'org_switch';

export const SENSITIVE_ACTIONS: readonly SensitiveAction[] = [
  'billing_change',
  'data_export',
  'data_delete',
  'rbac_change',
  'org_switch',
];

/**
 * The minimal shape `requireStepUp` needs — deliberately not `next-auth`'s `Session` type, so this
 * module (and its tests) stay decoupled from the NextAuth request/response lifecycle. In practice
 * this is populated from `session.user.mfaEnrolled` / `session.user.mfaVerifiedAt`
 * (src/types/next-auth.d.ts), which are threaded through the `jwt`/`session` callbacks in
 * src/lib/auth/options.ts.
 */
export interface StepUpState {
  /** Mirrors `User.mfa_enrolled` — whether the account has at least one factor enrolled. */
  mfaEnrolled: boolean;
  /** Null until a step-up challenge (src/app/api/auth/mfa/step-up) has cleared this session recently. */
  mfaVerifiedAt: string | null;
}

export class StepUpRequiredError extends Error {
  constructor(public readonly action: SensitiveAction) {
    super(
      `Step-up MFA is required before '${action}' (§16.4) — no fresh MFA verification on this ` +
        'session. Complete a step-up challenge (POST /api/auth/mfa/step-up) and retry.'
    );
    this.name = 'StepUpRequiredError';
  }
}

/**
 * Thrown when a sensitive action is attempted by an account with no MFA factor enrolled at all
 * (§18.10 "an MFA-required role without MFA enrolled is prompted to enroll before sensitive
 * actions"). Distinguished from `StepUpRequiredError` (enrolled, just not recently verified) so
 * the caller can route the user to enrollment vs. a plain re-challenge.
 */
export class MfaEnrollmentRequiredError extends Error {
  constructor(public readonly action: SensitiveAction) {
    super(
      `MFA enrollment is required before '${action}' (§16.4/§18.10) — this account has no MFA ` +
        'factor enrolled. Enroll via POST /api/auth/mfa/enroll and retry.'
    );
    this.name = 'MfaEnrollmentRequiredError';
  }
}

/**
 * The real step-up gate (T-12 — T-04 left this a documented no-op). Call immediately before
 * executing any of the five §16.4 sensitive actions:
 *   1. No factor enrolled at all → `MfaEnrollmentRequiredError` (covers §16.6's "Data-rights (own
 *      export/delete) | yes (step-up MFA)" note for REP too — REP is not required to enroll MFA
 *      generally, but *is* required to step up the moment it reaches one of these five actions).
 *   2. Enrolled, but no fresh step-up on this session (`isStepUpFresh`,
 *      STEP_UP_REVALIDATION_WINDOW_MS in session-security.ts) → `StepUpRequiredError`.
 *   3. Otherwise, returns silently — the action may proceed.
 */
export function requireStepUp(state: StepUpState, action: SensitiveAction): void {
  if (!state.mfaEnrolled) {
    throw new MfaEnrollmentRequiredError(action);
  }
  if (!isStepUpFresh(state.mfaVerifiedAt)) {
    throw new StepUpRequiredError(action);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Enrollment/verification (T-12 — real TOTP, RFC 6238, via src/services/security/totp.ts)
// ─────────────────────────────────────────────────────────────────────────

export interface TotpMfaMethod {
  type: 'totp';
  enrolledAt: string;
  /** AES-256-GCM ciphertext of the Base32 TOTP secret — never plaintext (§16.4). */
  secret: EncryptedPayload;
}

export interface RecoveryCodesMfaMethod {
  type: 'recovery_codes';
  generatedAt: string;
  /** bcrypt hashes only; a code is removed from this array the moment it is consumed (single-use). */
  codeHashes: string[];
}

export type MfaMethodRecord = TotpMfaMethod | RecoveryCodesMfaMethod;

const RECOVERY_CODE_COUNT = 10;
const BCRYPT_ROUNDS = 10;

const RECOVERY_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Cryptographically random single-use recovery code, e.g. "7K3F9-QX2M8" (§18.10 lost-factor recovery). */
function randomRecoveryCode(): string {
  const chars = Array.from({ length: 10 }, () =>
    RECOVERY_CODE_ALPHABET.charAt(randomInt(0, RECOVERY_CODE_ALPHABET.length))
  );
  return `${chars.slice(0, 5).join('')}-${chars.slice(5, 10).join('')}`;
}

/** Encrypts a plaintext TOTP secret for storage in `User.mfa_methods` — never store the raw return value of `generateTotpSecret()`. */
export function encryptTotpSecret(secret: string): EncryptedPayload {
  return encrypt(secret, getMfaEncryptionKey());
}

function decryptTotpSecret(payload: EncryptedPayload): string {
  return decrypt(payload, getMfaEncryptionKey());
}

export interface MfaEnrollmentStart {
  /** Plaintext — shown to the user exactly once (enrollment response), never persisted as-is. */
  secret: string;
  otpauthUri: string;
  /** Plaintext — shown to the user exactly once; only bcrypt hashes are persisted. */
  recoveryCodes: string[];
  /** The `MfaMethodRecord[]` the caller should persist to `User.mfa_methods` once verification succeeds. */
  methodsToStore: Promise<MfaMethodRecord[]>;
}

/**
 * Starts TOTP enrollment for `accountLabel` (the user's email, per otpauth:// URI convention).
 * Enrollment is not "complete" (i.e. `User.mfa_enrolled` should not flip to true) until the caller
 * verifies a first code via `verifyEnrollmentCode` — this mirrors the standard TOTP enrollment UX
 * (scan → confirm one code → done) and proves the user actually captured a working secret before
 * it becomes their only second factor.
 */
export function startMfaEnrollment(accountLabel: string): MfaEnrollmentStart {
  const secret = generateTotpSecret();
  const otpauthUri = buildTotpEnrollmentUri(secret, accountLabel);
  const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, randomRecoveryCode);

  const methodsToStore = (async (): Promise<MfaMethodRecord[]> => {
    const codeHashes = await Promise.all(
      recoveryCodes.map((code) => bcrypt.hash(code, BCRYPT_ROUNDS))
    );
    const now = new Date().toISOString();
    return [
      { type: 'totp', enrolledAt: now, secret: encryptTotpSecret(secret) },
      { type: 'recovery_codes', generatedAt: now, codeHashes },
    ];
  })();

  return { secret, otpauthUri, recoveryCodes, methodsToStore };
}

/** Verifies a code against the (not-yet-persisted-as-enrolled) plaintext secret returned by `startMfaEnrollment`. */
export async function verifyEnrollmentCode(secret: string, token: string): Promise<boolean> {
  const result = await verifyTotpCodeRaw(secret, token);
  return result.valid;
}

export type MfaVerifyOutcome =
  | { valid: true; method: 'totp' }
  | { valid: true; method: 'recovery_code'; updatedMethods: MfaMethodRecord[] }
  | { valid: false };

/**
 * Verifies a submitted code against a user's already-persisted `mfa_methods` — first as a TOTP
 * code, then (§18.10 "lost-factor recovery uses a verified backup factor / recovery codes, never a
 * support bypass that skips identity proof") as a recovery code. A matched recovery code is
 * consumed (removed from the stored array) so it cannot be replayed; the caller must persist
 * `updatedMethods` back to `User.mfa_methods` on that branch.
 */
export async function verifyMfaCode(
  methods: MfaMethodRecord[],
  token: string
): Promise<MfaVerifyOutcome> {
  const totpMethod = methods.find((m): m is TotpMfaMethod => m.type === 'totp');
  if (totpMethod) {
    const secret = decryptTotpSecret(totpMethod.secret);
    const result = await verifyTotpCodeRaw(secret, token);
    if (result.valid) {
      return { valid: true, method: 'totp' };
    }
  }

  const recoveryMethod = methods.find((m): m is RecoveryCodesMfaMethod => m.type === 'recovery_codes');
  if (recoveryMethod && /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(token.trim().toUpperCase())) {
    const normalized = token.trim().toUpperCase();
    for (const hash of recoveryMethod.codeHashes) {
      // eslint-disable-next-line no-await-in-loop -- recovery codes are ≤10; sequential bcrypt compares are fine.
      if (await bcrypt.compare(normalized, hash)) {
        const updatedMethods = methods.map((m) =>
          m === recoveryMethod
            ? { ...recoveryMethod, codeHashes: recoveryMethod.codeHashes.filter((h) => h !== hash) }
            : m
        );
        return { valid: true, method: 'recovery_code', updatedMethods };
      }
    }
  }

  return { valid: false };
}
