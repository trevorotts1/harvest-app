// T-40R (WP05 GATE remediation) — the SINGLE lazy, build-safe production factory for the gated send
// stack. T-39 built `SequenceService`, `SeamSequenceDispatcher`, `EmailSendService`,
// `PlatformSmsSendService` and the T-36 deliverability seam, but the ONLY place that ever wired them
// together for production was `POST /api/messaging/platform-send` (one channel, one route). The
// sequence cron (sequence-scheduled-run.ts) and the new sequence/email routes need the SAME wiring,
// so it lives here ONCE rather than being copy-pasted per call-site.
//
// BUILD-SAFETY (§0.4): every export is a FUNCTION — nothing is constructed at module scope, and no
// key is read here. The A2P/email deliverability services, the Twilio/Resend clients, and the
// SendComplianceGate are all built lazily, per invocation, inside a handler/cron tick — exactly the
// convention `platform-send/route.ts` established. A key-less `next build` never runs any of this.
//
// NO GATE BYPASS: this factory only ever hands back the ALREADY-GATED services. Every send path it
// produces funnels through CFE-clearance + SendComplianceGate (+ deliverability) inside those
// services — this file adds no send of its own and reaches past no gate.

import { prisma } from '@/lib/prisma';

import { SendComplianceGate } from '../../compliance/send-gate/send-compliance-gate';
import { isChannelDeliverable } from '../../deliverability/gate';
import { A2PProvisioningService } from '../../deliverability/a2p-service';
import {
  PrismaA2PBrandRepository,
  PrismaA2PCampaignRepository,
  PrismaPlatformPhoneNumberRepository,
  type A2PBrandPrismaDelegate,
  type A2PCampaignPrismaDelegate,
  type PlatformPhoneNumberPrismaDelegate,
} from '../../deliverability/a2p-repository';
import { createTwilioClient } from '../../deliverability/twilio-client';
import { EmailDeliverabilityService } from '../../deliverability/email-deliverability-service';
import {
  PrismaEmailDomainAuthRepository,
  PrismaEmailWarmupRepository,
  type EmailDomainAuthPrismaDelegate,
  type EmailWarmupPlanPrismaDelegate,
} from '../../deliverability/email-warmup-repository';
import { DnsEmailAuthClient } from '../../deliverability/email-auth-client';

import { EmailSendService, FirstTouchComposerService, PlatformSmsSendService } from './index';
import type { SendPrismaClient } from './index';
import { SeamSequenceDispatcher, SequenceService } from '../sequence/sequence.service';
import type { SequencePrismaClient } from '../sequence/sequence.service';

type AnyPrisma = typeof prisma;

/**
 * TEST/DI SEAM (T-40R QC fix, factory-coverage remediation) — the ONLY parameter this file adds
 * that isn't itself a real production dependency. `EmailSendService`/`PlatformSmsSendService` both
 * already default an omitted `sendGate` to `new SendComplianceGate()` (which in turn defaults its
 * OWN `OptOutRegistryService`/`MessagingConsentLedger` to the real imported `prisma` singleton) —
 * exactly what production wants. But that means the `db` this factory threads through for CFE reads
 * + deliverability was NEVER also reaching `SendComplianceGate`, so a caller supplying an in-memory
 * `db` (a unit test) had no way to keep opt-out/quiet-hours/TCPA-consent reads off a live database
 * too. `overrides.sendGate`, when supplied, is passed straight through as the `sendGate` dep instead
 * of leaving it undefined; every production call-site below omits the second argument entirely, so
 * `overrides.sendGate` is `undefined` and every build* function below is BYTE-IDENTICAL to before
 * this change (`deps.sendGate ?? new SendComplianceGate()` behaves the same whether the key is
 * absent or present-but-undefined). No gate logic changes — this only widens who may construct the
 * gate the services already run.
 */
export interface ProductionWiringOverrides {
  sendGate?: SendComplianceGate;
}

/** The real T-36 A2P deliverability service, wired per invocation (never at module scope). */
export function buildA2PService(db: AnyPrisma = prisma): A2PProvisioningService {
  return new A2PProvisioningService(
    new PrismaA2PBrandRepository(db as unknown as { a2PBrandRegistration: A2PBrandPrismaDelegate }),
    new PrismaA2PCampaignRepository(db as unknown as { a2PCampaignRegistration: A2PCampaignPrismaDelegate }),
    new PrismaPlatformPhoneNumberRepository(
      db as unknown as { platformPhoneNumber: PlatformPhoneNumberPrismaDelegate }
    ),
    createTwilioClient()
  );
}

/** The real T-36 email deliverability service (SPF/DKIM/DMARC + warm-up), wired per invocation. */
export function buildEmailDeliverabilityService(db: AnyPrisma = prisma): EmailDeliverabilityService {
  return new EmailDeliverabilityService(
    new PrismaEmailDomainAuthRepository(db as unknown as { emailDomainAuthentication: EmailDomainAuthPrismaDelegate }),
    new PrismaEmailWarmupRepository(db as unknown as { emailWarmupPlan: EmailWarmupPlanPrismaDelegate }),
    new DnsEmailAuthClient()
  );
}

/** The fully-gated automated EMAIL sender (CFE + SendComplianceGate(EMAIL) + isChannelDeliverable). */
export function buildEmailSendService(
  db: AnyPrisma = prisma,
  overrides: ProductionWiringOverrides = {}
): EmailSendService {
  const a2pService = buildA2PService(db);
  const emailService = buildEmailDeliverabilityService(db);
  return new EmailSendService(db as unknown as SendPrismaClient, {
    checkDeliverable: (channel, organizationId, domain) =>
      isChannelDeliverable({ a2pService, emailService }, channel, organizationId, domain),
    sendGate: overrides.sendGate,
  });
}

/** The fully-gated automated platform-SMS sender (CFE + SendComplianceGate(SMS_PLATFORM) + A2P). */
export function buildPlatformSmsSendService(
  db: AnyPrisma = prisma,
  overrides: ProductionWiringOverrides = {}
): PlatformSmsSendService {
  const a2pService = buildA2PService(db);
  const emailService = buildEmailDeliverabilityService(db);
  return new PlatformSmsSendService(db as unknown as SendPrismaClient, {
    checkDeliverable: (channel, organizationId) =>
      isChannelDeliverable({ a2pService, emailService }, channel, organizationId),
    sendGate: overrides.sendGate,
  });
}

/** The first-touch composer handoff (rep's own number; §10.1, never platform-provisioned). */
export function buildFirstTouchComposerService(db: AnyPrisma = prisma): FirstTouchComposerService {
  return new FirstTouchComposerService(db as unknown as SendPrismaClient);
}

/**
 * THE production sequence dispatcher: the T-37 seam boundary a cadence step dispatches THROUGH,
 * routing SMS_HANDOFF / SMS_PLATFORM / EMAIL to their respective fully-gated services and nothing
 * else. Identical to the one T-39's own seam test drives — this factory just supplies the real,
 * prisma-backed services production needs.
 */
export function buildSequenceDispatcher(
  db: AnyPrisma = prisma,
  overrides: ProductionWiringOverrides = {}
): SeamSequenceDispatcher {
  return new SeamSequenceDispatcher(
    buildFirstTouchComposerService(db),
    buildPlatformSmsSendService(db, overrides),
    buildEmailSendService(db, overrides)
  );
}

/** The production `SequenceService` — the cadence engine over the real dispatcher above. */
export function buildSequenceService(
  db: AnyPrisma = prisma,
  overrides: ProductionWiringOverrides = {}
): SequenceService {
  return new SequenceService(
    db as unknown as SequencePrismaClient,
    buildSequenceDispatcher(db, overrides),
    overrides.sendGate
  );
}

/**
 * Resolve the organization's authenticated sending domain for an EMAIL send. Picks the first domain
 * whose T-36 readiness verdict is actually `deliverable` (SPF/DKIM/DMARC VERIFIED + warm-up active);
 * failing that, the first configured domain (the `EmailSendService` gate will then fail it closed);
 * and null when the org has configured none at all (→ `EmailSendService` HELDs NO_SENDING_DOMAIN).
 * This never itself decides deliverability — that stays with the gate inside `EmailSendService`.
 */
export async function resolveOrgSendingDomain(
  organizationId: string,
  db: AnyPrisma = prisma
): Promise<string | null> {
  try {
    const emailService = buildEmailDeliverabilityService(db);
    const domains = await emailService.listDomainsForOrganization(organizationId);
    if (domains.length === 0) return null;
    const deliverable = domains.find((d) => d.readiness.deliverable);
    return (deliverable ?? domains[0]).domain;
  } catch {
    // Fail-closed: an infra hiccup resolving the domain must never fabricate one — no domain → the
    // email send HELDs (NO_SENDING_DOMAIN), it never sends to a guessed sender.
    return null;
  }
}
