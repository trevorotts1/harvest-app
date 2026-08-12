import crypto from 'crypto';

/**
 * Password-reset token issuance/consumption (T-12, master-spec §16.4 "per-IP and per-account rate
 * limits on auth endpoints (login, password reset, ...)"; §18.10 "set/reset screens screen against
 * known-breached passwords").
 *
 * Reuses the pre-existing `VerificationToken` model (identifier/token/expires — T-04's Auth.js
 * Prisma-adapter contract tables) rather than adding a dedicated password-reset table: it is
 * exactly the right shape (a single-use, expiring, identifier-scoped token) and already exists on
 * the schema unused by the Credentials+JWT flow, so no new migration is needed for this piece.
 *
 * Follows the same narrow-Prisma-delegate + constructor-injection pattern as
 * src/services/compliance/data-rights/data-rights.ts / src/services/compliance/audit/
 * audit-service.ts: an interface easy to satisfy with an in-memory fake in tests, and a thin
 * Prisma-backed implementation for real runtime use.
 *
 * The raw token is never persisted — only its SHA-256 hash is (mirrors `VerificationToken.token`'s
 * existing @unique column, which already expects an opaque token string, not a lookup key).
 * Delivering the raw token to the user (email) is WP05's messaging-provider territory and out of
 * this backend unit's scope; `issuePasswordResetToken` returns it so the caller (the API route) can
 * hand it to whatever delivery mechanism is wired in later — it must never be echoed back in an API
 * response in production.
 *
 * R-18 (T-59/W1, admin-mediated recovery): until WP05 wires a provider, the sole delivery channel
 * is the ADMIN console — POST /api/admin/users/[userId]/reset-password calls this same function
 * and returns the raw token ONLY to the admin's session for out-of-band handoff. The confirm route
 * (POST /api/auth/password-reset/confirm) consumes tokens issued by either route identically.
 * `RESET_TOKEN_TTL_MS` is exported so the admin route can report the exact expiry it enforces.
 */

/** 30 minutes — single source of truth for reset-token lifetime (the request route's mechanism;
 *  R-18's admin-mediated issuance reports the same expiry via this constant). */
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export interface VerificationTokenStore {
  create(data: { identifier: string; token: string; expires: Date }): Promise<void>;
  find(identifier: string, token: string): Promise<{ expires: Date } | null>;
  delete(identifier: string, token: string): Promise<void>;
}

/** Narrow Prisma delegate shape for the real implementation. */
export interface VerificationTokenPrismaClient {
  verificationToken: {
    create(args: { data: { identifier: string; token: string; expires: Date } }): Promise<unknown>;
    findUnique(args: {
      where: { identifier_token: { identifier: string; token: string } };
    }): Promise<{ expires: Date } | null>;
    delete(args: { where: { identifier_token: { identifier: string; token: string } } }): Promise<unknown>;
  };
}

export class PrismaVerificationTokenStore implements VerificationTokenStore {
  constructor(private readonly prisma: VerificationTokenPrismaClient) {}

  async create(data: { identifier: string; token: string; expires: Date }): Promise<void> {
    await this.prisma.verificationToken.create({ data });
  }

  async find(identifier: string, token: string): Promise<{ expires: Date } | null> {
    return this.prisma.verificationToken.findUnique({ where: { identifier_token: { identifier, token } } });
  }

  async delete(identifier: string, token: string): Promise<void> {
    await this.prisma.verificationToken.delete({ where: { identifier_token: { identifier, token } } }).catch(() => {
      // Already consumed/deleted — deleting a single-use token twice is not an error condition.
    });
  }
}

export class InMemoryVerificationTokenStore implements VerificationTokenStore {
  private tokens = new Map<string, { expires: Date }>();

  private key(identifier: string, token: string): string {
    return `${identifier}::${token}`;
  }

  async create(data: { identifier: string; token: string; expires: Date }): Promise<void> {
    this.tokens.set(this.key(data.identifier, data.token), { expires: data.expires });
  }

  async find(identifier: string, token: string): Promise<{ expires: Date } | null> {
    return this.tokens.get(this.key(identifier, token)) ?? null;
  }

  async delete(identifier: string, token: string): Promise<void> {
    this.tokens.delete(this.key(identifier, token));
  }

  clear(): void {
    this.tokens.clear();
  }
}

function hashResetToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/** Generates a fresh, single-use reset token; only its hash is persisted. Returns the raw token for out-of-band delivery. */
export async function issuePasswordResetToken(
  store: VerificationTokenStore,
  email: string,
  now: Date = new Date()
): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  await store.create({
    identifier: email.toLowerCase(),
    token: hashResetToken(rawToken),
    expires: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
  });
  return rawToken;
}

/** Revokes a reset token WITHOUT consuming it as a valid redemption — used by the request route
 *  to invalidate a token whose emailed link never left the machine (delivery failed). Idempotent:
 *  revoking an already-revoked/expired token is a no-op. Mirrors `consumePasswordResetToken`'s
 *  hashing + store-delete shape so the store only ever sees SHA-256 hashes. */
export async function revokePasswordResetToken(
  store: VerificationTokenStore,
  email: string,
  rawToken: string
): Promise<void> {
  const identifier = email.toLowerCase();
  const tokenHash = hashResetToken(rawToken);
  await store.delete(identifier, tokenHash).catch(() => undefined); // already gone → no-op
}

/** Verifies and consumes (single-use) a reset token. Returns whether it was valid and unexpired. */
export async function consumePasswordResetToken(
  store: VerificationTokenStore,
  email: string,
  rawToken: string,
  now: Date = new Date()
): Promise<boolean> {
  const identifier = email.toLowerCase();
  const tokenHash = hashResetToken(rawToken);
  const record = await store.find(identifier, tokenHash);
  if (!record) return false;

  await store.delete(identifier, tokenHash); // single-use regardless of expiry outcome below

  return record.expires.getTime() >= now.getTime();
}
