// T-38 (master-spec §10.4 TCPA consent ledger; §16.2 regulatory matrix "TCPA | SMS consent, ...
// | Per-contact consent"; §16.3 "Consent: ... a consent record per data type ... timestamped,
// versioned, revocable. Separate TCPA consent for SMS.").
//
// This is the PER-RECIPIENT-CONTACT counterpart to WP11's existing consent machinery
// (`src/services/compliance/consent/` — `ConsentManager`/`ConsentService`) and its real, wired
// production bridge (`src/lib/onboarding/gdpr-consent.ts`), which both track consent for the
// PLATFORM USER (the rep) — e.g. "has this rep consented to the platform processing their
// profile/contacts/calendar data." TCPA's "prior express written consent" requirement (§16.2) is
// about a DIFFERENT subject: the RECIPIENT — the warm-market Contact who would receive an automated
// SMS — and that per-recipient dimension has no home in the existing WP11 consent surface (its
// `ConsentType`/`ALL_CONSENT_TYPES` are account-level categories swept in bulk at signup, keyed only
// by `user_id`). Per this build's brief ("align with ... ComplianceConsent, not fork it"), this
// module reuses the SAME `ComplianceConsent` table (now additively extended with `contact_id` +
// `version`, prisma/schema.prisma) rather than introducing a parallel ledger model, and follows the
// SAME repository/service split + versioned/timestamped/append-only shape already established by
// `src/services/compliance/consent/consent-service.ts` (`ConsentRepository` / `ConsentService`) —
// mirrored here as `MessagingConsentRepository` / `MessagingConsentLedger`, scoped to
// (contact_id, consent_type) instead of (user_id, consent_type).
//
// FAIL-CLOSED (this build's brief: "Automated messaging without a valid consent record MUST be
// blocked" / "hasMessagingConsent(contact) fail-closed"): `hasMessagingConsent` returns `false` —
// no consent — for: no record found, a latest record with `given: false` (revoked), AND any read
// failure. There is exactly one path that returns `true`: a confirmed, successful lookup whose
// latest-by-version record has `given === true`.

import { prisma } from '../../../lib/prisma';

/** The durable `ComplianceConsent.consent_type` tag for the TCPA per-contact messaging-consent
 *  event — distinguishable from WP11's own account-level `ConsentType` union (`sms_outreach` etc.,
 *  src/types/compliance.ts) exactly the way `gdpr-consent.ts`'s `'gdpr'` tag is: a bare string this
 *  ledger owns, not a member of that other union. Scoped to the channel this build's brief scopes
 *  TCPA consent to — the automated Twilio A2P-10DLC platform-number cadence (§10.1 "automated
 *  cadence"), not the rep's own one-tap composer handoff (a human explicitly confirms every one of
 *  those sends already, see AC §10.9-1). A future channel (e.g. voice) would get its own tag here,
 *  never overload this one. */
export const MESSAGING_TCPA_CONSENT_TYPE = 'messaging_tcpa_sms_platform';

export type MessagingConsentSource = 'sms_keyword' | 'web_form' | 'manual_entry' | 'api';

/**
 * T-R17 (remediation of a T-38 QC finding — §9.2): "current consent" MUST be unambiguous even if
 * two rows ever end up sharing a `version` (the DB `@@unique([contact_id, consent_type, version])`
 * added alongside this fix, prisma/schema.prisma, is the primary defense against that ever
 * happening for a real per-contact race — but this ordering must not itself rely on that alone;
 * an orderBy with only `version: 'desc'` has no defined tiebreak, so which of two same-version rows
 * a plain `findFirst` returns is a DB-implementation detail, not a guarantee). `timestamp` breaks a
 * version tie (the row actually written later is "more current"); `id` is the final, always-unique
 * absolute tiebreak so ordering is deterministic even for two rows inserted in the same instant.
 */
export const CURRENT_CONSENT_ORDER_BY = [
  { version: 'desc' as const },
  { timestamp: 'desc' as const },
  { id: 'desc' as const },
];

/** A concurrent `captureConsent` call already claimed this exact (contact_id, consent_type,
 *  version) tuple — the DB `@@unique` (prisma/schema.prisma) is what makes this race detectable at
 *  all, instead of two rows silently landing on the same version. Same duck-typed Prisma-error
 *  convention as `src/services/agent-runtime/store.ts`'s `markProcessed`. */
function isUniqueConstraintViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

/** Bounded retry count for the version-race in `captureConsent` — high enough that a real
 *  concurrent burst on one contact resolves cleanly, low enough that a genuine, non-race DB outage
 *  (which would keep throwing a DIFFERENT error, and so exit this loop immediately anyway; only a
 *  P2002 keeps retrying) still surfaces quickly rather than looping unboundedly. */
const MAX_VERSION_RACE_ATTEMPTS = 5;

export interface MessagingConsentRecord {
  id: string;
  user_id: string;
  contact_id: string;
  consent_type: string;
  given: boolean;
  version: number;
  timestamp: string; // ISO 8601
  source: MessagingConsentSource;
  metadata?: Record<string, unknown> | null;
}

/**
 * Narrow, DI-mockable Prisma delegate shape — same convention as every other service in this
 * codebase. Reuses `ComplianceConsent` (see this file's header) via `create`/`findFirst`.
 */
export interface MessagingConsentPrismaClient {
  complianceConsent: {
    create(args: {
      data: {
        user_id: string;
        contact_id: string;
        consent_type: string;
        given: boolean;
        version: number;
        timestamp: Date;
      };
    }): Promise<{
      id: string;
      user_id: string;
      contact_id: string | null;
      consent_type: string;
      given: boolean;
      version: number;
      timestamp: Date;
    }>;
    findFirst(args: {
      where: { contact_id: string; consent_type: string };
      orderBy: Array<{ version: 'desc' } | { timestamp: 'desc' } | { id: 'desc' }>;
    }): Promise<{
      id: string;
      user_id: string;
      contact_id: string | null;
      consent_type: string;
      given: boolean;
      version: number;
      timestamp: Date;
    } | null>;
    findMany(args: {
      where: { contact_id: string; consent_type: string };
      orderBy: Array<{ version: 'desc' } | { timestamp: 'desc' } | { id: 'desc' }>;
    }): Promise<
      {
        id: string;
        user_id: string;
        contact_id: string | null;
        consent_type: string;
        given: boolean;
        version: number;
        timestamp: Date;
      }[]
    >;
  };
}

/**
 * The durable, timestamped, versioned, per-contact TCPA messaging-consent ledger (§10.4). T-37/T-39
 * call `hasMessagingConsent` (directly, or via `SendComplianceGate`) before any automated-cadence
 * SMS dispatch.
 */
export class MessagingConsentLedger {
  // See opt-out-registry.ts's identical comment: the parameter is named `client`, not `prisma`, so
  // its default value can reference the imported `prisma` singleton without shadowing.
  constructor(
    private client: MessagingConsentPrismaClient = prisma as unknown as MessagingConsentPrismaClient
  ) {}

  /**
   * Records a new, versioned consent decision for `contactId` (owned by rep `userId`). Always
   * INSERTS a new row — never updates one in place — so the full history survives (append-only,
   * §16.3 "versioned"). The version number is computed from the current latest record for this
   * (contact_id, consent_type) pair, so it durably increments even across process restarts (unlike
   * the pre-T-38 in-process-only `ConsentManager` versioning — see prisma/schema.prisma's
   * `ComplianceConsent.version` doc comment).
   */
  async captureConsent(
    userId: string,
    contactId: string,
    given: boolean,
    opts: { source?: MessagingConsentSource; metadata?: Record<string, unknown> } = {}
  ): Promise<MessagingConsentRecord> {
    // T-R17: bounded retry against the DB @@unique([contact_id, consent_type, version]). Two
    // concurrent captureConsent calls for the same contact can both read the same "current"
    // version below and both attempt the same next version number; the DB constraint lets exactly
    // one of those INSERTs succeed and rejects the other (P2002) instead of silently persisting
    // both under one version number. The loser re-reads the (now-updated) current version and
    // retries — from the caller's perspective this still just "resolves to a valid, uniquely
    // versioned row," never a race-induced duplicate.
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_VERSION_RACE_ATTEMPTS; attempt++) {
      const existing = await this.client.complianceConsent.findFirst({
        where: { contact_id: contactId, consent_type: MESSAGING_TCPA_CONSENT_TYPE },
        orderBy: CURRENT_CONSENT_ORDER_BY,
      });
      const version = existing ? existing.version + 1 : 1;

      try {
        const row = await this.client.complianceConsent.create({
          data: {
            user_id: userId,
            contact_id: contactId,
            consent_type: MESSAGING_TCPA_CONSENT_TYPE,
            given,
            version,
            timestamp: new Date(),
          },
        });

        return {
          id: row.id,
          user_id: row.user_id,
          contact_id: row.contact_id as string,
          consent_type: row.consent_type,
          given: row.given,
          version: row.version,
          timestamp: row.timestamp.toISOString(),
          source: opts.source ?? 'manual_entry',
          metadata: opts.metadata ?? null,
        };
      } catch (err) {
        if (!isUniqueConstraintViolation(err)) throw err;
        lastError = err;
        // Another writer won this version number between our read and our write — loop and
        // re-read the now-current version.
      }
    }
    // Only reachable if MAX_VERSION_RACE_ATTEMPTS consecutive attempts all lost the race — an
    // extraordinarily hot single contact, not a normal outcome. Surface the real DB error rather
    // than masking it.
    throw lastError;
  }

  /** Revokes (records `given: false` for) `contactId`'s messaging consent — a new versioned row,
   *  never a mutation of the prior grant (§16.3 "revocable"). */
  async revokeConsent(
    userId: string,
    contactId: string,
    opts: { source?: MessagingConsentSource } = {}
  ): Promise<MessagingConsentRecord> {
    return this.captureConsent(userId, contactId, false, { source: opts.source ?? 'manual_entry' });
  }

  /**
   * FAIL-CLOSED (this build's brief): `false` unless a confirmed lookup's latest-by-version record
   * has `given === true`. A read failure resolves to `false` (no consent), never `true`.
   */
  async hasMessagingConsent(contactId: string): Promise<boolean> {
    try {
      const latest = await this.client.complianceConsent.findFirst({
        where: { contact_id: contactId, consent_type: MESSAGING_TCPA_CONSENT_TYPE },
        orderBy: CURRENT_CONSENT_ORDER_BY,
      });
      return latest?.given === true;
    } catch {
      return false;
    }
  }

  /** Full version history for `contactId`'s messaging consent (every grant/revoke row, newest
   *  version first) — for the audit surface / DSAR export, not a hot path. Fails closed to an
   *  empty array (never throws) so a read error never masquerades as "no history" vs. "couldn't
   *  check" ambiguity for a caller that only checks `.length`.
   *
   *  Bug fix (T-38 finish-the-remainder): the prior draft of this method called `findFirst` (not
   *  `findMany`) and always returned an array of at most ONE record — "full version history" was
   *  actually just the latest row. `MessagingConsentPrismaClient` now declares `findMany` and this
   *  returns every row for (contact_id, consent_type), newest-version-first, so a captureConsent →
   *  revokeConsent → captureConsent sequence's full lineage is actually retrievable. */
  async getHistory(contactId: string): Promise<MessagingConsentRecord[]> {
    try {
      const rows = await this.client.complianceConsent.findMany({
        where: { contact_id: contactId, consent_type: MESSAGING_TCPA_CONSENT_TYPE },
        orderBy: CURRENT_CONSENT_ORDER_BY,
      });
      return rows.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        contact_id: row.contact_id as string,
        consent_type: row.consent_type,
        given: row.given,
        version: row.version,
        timestamp: row.timestamp.toISOString(),
        source: 'manual_entry' as const,
      }));
    } catch {
      return [];
    }
  }
}
