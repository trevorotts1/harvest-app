// WP01 §6.10-10 (T-21R) — GDPR consent grant/revoke, wired onto WP11's `ConsentManager` (the
// versioned/timestamped/revocable consent business logic) + the real `ComplianceConsent`/`User`
// Prisma models (durable persistence). This module CONSUMES `ConsentManager`'s public
// `grantConsent`/`revokeConsent`/`hasConsent` — it does not reimplement, wrap, or modify any of WP11's
// own machinery (`src/services/compliance/consent/*`).
//
// `ConsentManager` is deliberately pure/in-memory (no Prisma dependency of its own — see its own
// module comment), so it alone cannot durably persist a consent event across requests/processes. This
// module bridges that: it calls `ConsentManager` for the versioning/timestamping decision (so the
// version number and "given" transition are ALWAYS the ones WP11's own rules produced, never
// reimplemented here), then mirrors that decision into a new, immutable `ComplianceConsent` row and
// flips `User.gdpr_consent` in the SAME durable store the rest of the platform reads. Each grant/revoke
// writes a NEW row (never an update-in-place) — an append-only log is how "versioned" cashes out given
// `ComplianceConsent`'s schema (id/user_id/consent_type/given/timestamp, no separate version column):
// the latest-by-timestamp row is the current state, and every prior row is retained as history.
//
// `'profile'` is the closest existing WP11 `ConsentType` to "consent to process the user's personal
// data" — the GDPR Art. 6 legal basis this onboarding capture records; there is no `'gdpr'` member in
// WP11's `ConsentType` union and this module does not add one (that IS WP11's internals). The durable
// `ComplianceConsent.consent_type` column is a bare `String` (not constrained to that TS union), so
// tagging the durable row `'gdpr'` makes the GDPR event its own distinguishable, queryable record
// without touching WP11's enum.
//
// Follows the same narrow, DI-mockable Prisma-delegate-shape pattern already used across this codebase
// (onboarding-gate.ts's `OnboardingGatePrismaClient`, seven-whys/persistence.ts's
// `WhySessionPrismaClient`): a small interface naming only the methods this file calls, defaulted to
// the real singleton, so tests supply a plain mock object instead of a live database.

import { ConsentManager, type ConsentRecord } from '@/services/compliance/consent';
import { prisma } from '@/lib/prisma';

/** The durable `ComplianceConsent.consent_type` tag for the GDPR onboarding-consent event (§6.10-10). */
export const GDPR_COMPLIANCE_CONSENT_TYPE = 'gdpr';

/** The closest existing WP11 `ConsentType` to "GDPR personal-data-processing consent" (see module note). */
export const GDPR_WP11_CONSENT_TYPE = 'profile' as const;

// Module-level singleton: WP11's `ConsentManager` keeps its store in an instance-owned `Map` (pure,
// no Prisma dependency by design). Sharing one instance for the lifetime of this server process means
// a grant → revoke → grant sequence increments `ConsentRecord.version` correctly (each call's
// `existing` lookup sees the prior in-process call), the same versioning contract `ConsentManager`
// promises its own direct callers.
const consentManager = new ConsentManager();

export interface ComplianceConsentRow {
  id: string;
  user_id: string;
  consent_type: string;
  given: boolean;
  timestamp: Date;
}

export interface GdprConsentPrismaClient {
  complianceConsent: {
    create(args: {
      data: { user_id: string; consent_type: string; given: boolean; timestamp: Date };
    }): Promise<ComplianceConsentRow>;
  };
  user: {
    update(args: {
      where: { id: string };
      data: { gdpr_consent: boolean };
    }): Promise<{ id: string; gdpr_consent: boolean }>;
  };
}

export interface GdprConsentResult {
  /** The WP11 `ConsentManager` record this grant/revoke produced (versioned, timestamped). */
  record: ConsentRecord;
  /** The durable `ComplianceConsent` row mirroring that decision. */
  complianceConsent: ComplianceConsentRow;
}

/**
 * Grant GDPR consent for `userId` — an explicit, affirmative act (the caller, e.g. the onboarding
 * consent route, is responsible for only invoking this from a real affirmative UI action, never a
 * pre-checked default). Calls WP11's `ConsentManager.grantConsent`, then persists a NEW, timestamped
 * `ComplianceConsent` row and sets `User.gdpr_consent = true`.
 */
export async function grantGdprConsent(
  userId: string,
  opts: { ipAddress?: string; source?: string } = {},
  client: GdprConsentPrismaClient = prisma as unknown as GdprConsentPrismaClient
): Promise<GdprConsentResult> {
  const record = consentManager.grantConsent(
    userId,
    GDPR_WP11_CONSENT_TYPE,
    opts.source ?? 'onboarding',
    opts.ipAddress,
    { regulation: 'GDPR', purpose: 'onboarding_data_processing' }
  );

  const complianceConsent = await client.complianceConsent.create({
    data: {
      user_id: userId,
      consent_type: GDPR_COMPLIANCE_CONSENT_TYPE,
      given: true,
      timestamp: new Date(record.timestamp),
    },
  });

  await client.user.update({ where: { id: userId }, data: { gdpr_consent: true } });

  return { record, complianceConsent };
}

/**
 * Revoke GDPR consent for `userId` (§6.10-10 "revocable"). Calls WP11's
 * `ConsentManager.revokeConsent`, then persists a NEW `ComplianceConsent` row with `given: false` and
 * clears `User.gdpr_consent`.
 */
export async function revokeGdprConsent(
  userId: string,
  opts: { source?: string } = {},
  client: GdprConsentPrismaClient = prisma as unknown as GdprConsentPrismaClient
): Promise<GdprConsentResult> {
  const record = consentManager.revokeConsent(userId, GDPR_WP11_CONSENT_TYPE, opts.source ?? 'settings');

  const complianceConsent = await client.complianceConsent.create({
    data: {
      user_id: userId,
      consent_type: GDPR_COMPLIANCE_CONSENT_TYPE,
      given: false,
      timestamp: new Date(record.timestamp),
    },
  });

  await client.user.update({ where: { id: userId }, data: { gdpr_consent: false } });

  return { record, complianceConsent };
}

/** Current in-process GDPR consent state per WP11's `ConsentManager` (test/diagnostic helper). */
export function hasGdprConsentInMemory(userId: string): boolean {
  return consentManager.hasConsent(userId, GDPR_WP11_CONSENT_TYPE);
}
