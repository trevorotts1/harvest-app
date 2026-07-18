// WP03 §8.1 Layer 3 / §8.2 / §8.3 — the queue orchestrator. This is the ONE place that combines:
//   - the three-layer completion gate (no short-circuit — §8.3 "the queue is empty until all three
//     layers are complete... no short-circuit to a raw Vault list");
//   - the eligibility/exclusion boundary (eligibility.ts — do_not_contact/minor/opted-out/
//     state-unlicensed never rank);
//   - the HIDDEN readiness score + tier (readiness-engine.ts — the score never crosses this module's
//     own return boundary, only `toPublicQueueItem`'s tier+label projection does); and
//   - the Primerica overlay (primerica-overlay.ts / org-gate.ts — additive context only, gated).
//
// DI-mockable via the narrow `QueuePrismaClient` surface (composes `HarvestMethodPrismaClient` with
// the additional `contact`/`contactInteraction`/`optOutRegistry` read surfaces this orchestration
// needs) — same in-memory-fake-in-tests convention as every other service in this codebase.

import { OrgType, PrismaClient, ReadinessTier } from '@prisma/client';

import {
  MethodLayer,
  METHOD_LAYER_ORDER,
  PublicQueueItem,
  QueueResult,
  ReadinessInputs,
} from '../../types/harvest-method';
import { toClusterArray as clustersFromJson } from './clusters';
import {
  checkEligibility,
  checkJurisdictionExclusion,
  type EligibilityContactRow,
  type LicensedJurisdictionsProvider,
  type OptOutLookupClient,
} from './eligibility';
import { computeReadiness, toPublicQueueItem, assertNoRawScoreLeak } from './readiness-engine';
import { buildPrimericaVelocityContext, isPrimericaBranch, type PrimericaVelocityContext } from './primerica-overlay';
import { assertNoPrimericaLeak } from '../onboarding/wp01/org-gate';
import { decryptContactPII, getContactEncryptionKey } from '../warm-market/vault/vault-encryption';
import type { HarvestMethodPrismaClient, ContactMethodProfileRow } from './method-state.service';
import { LicensingService } from '../compliance/licensing/licensing-service';
import { PrismaLicensingRepository, type LicensingRecordPrismaDelegate } from '../compliance/licensing/licensing-repository';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface QueueContactRow extends EligibilityContactRow {
  first_name: string; // ciphertext envelope
  last_name: string; // ciphertext envelope
  /** T-29R (§8.2 "Excluded: state-unlicensed") — plaintext (see prisma/schema.prisma's Contact.
   *  jurisdiction doc comment for why this one Contact column is not ciphertext). Null/absent is
   *  treated as "unknown jurisdiction" by `checkJurisdictionExclusion`. */
  jurisdiction: string | null;
}

export interface QueuePrismaClient extends HarvestMethodPrismaClient {
  contact: {
    findMany(args: { where: { id: { in: string[] }; user_id: string } }): Promise<QueueContactRow[]>;
  };
  contactInteraction: {
    findMany(args: {
      where: { contact_id: { in: string[] } };
      orderBy: { created_at: 'desc' };
    }): Promise<{ contact_id: string; created_at: Date | string }[]>;
  };
  optOutRegistry: OptOutLookupClient;
}

export interface GetQueueOptions {
  /** true = the full ritual-review list (includes EXCLUDED, for the Layer-3 acknowledgment surface,
   *  AND NEEDS_JURISDICTION, T-29R2, for the data-completion-prompt surface); false = the §8.3
   *  action-queue view (neither EXCLUDED nor NEEDS_JURISDICTION ever appears there — "Excluded
   *  contacts never queue," and a contact this rep cannot yet be confirmed licensed for is equally
   *  held out of the actionable view until its jurisdiction is known). */
  includeExcluded: boolean;
  /** Primerica-only; ignored (and never rendered) for a universal org. */
  rank?: string | null;
}

export type PrioritizedQueueResult = QueueResult & { primericaVelocity?: PrimericaVelocityContext };

/** Tier sort precedence — A first, then B, then Slow Burn, then Needs Jurisdiction (T-29R2), then
 *  Excluded (the latter two only ever present when `includeExcluded` is true); score (still hidden)
 *  breaks ties WITHIN a tier only, so a needs-time Slow Burn contact with an incidentally high raw
 *  score can never outrank a true B-tier contact. Needs Jurisdiction sorts ahead of Excluded — a
 *  remediable data gap is a lesser concern than a confirmed exclusion. */
const TIER_SORT_RANK: Record<ReadinessTier, number> = {
  [ReadinessTier.A]: 0,
  [ReadinessTier.B]: 1,
  [ReadinessTier.SLOW_BURN]: 2,
  [ReadinessTier.NEEDS_JURISDICTION]: 3,
  [ReadinessTier.EXCLUDED]: 4,
};

export class PrioritizedQueueService {
  constructor(
    private prisma: QueuePrismaClient = new PrismaClient() as unknown as QueuePrismaClient,
    private encryptionKey: string = getContactEncryptionKey(),
    // T-29R: lazy default, evaluated per-instantiation (never at module scope, per the T-26
    // build-safety lesson referenced by the routes' own "Lazy: constructed per-request" comment
    // below) — constructs no encryption key, reads no secret, just a second narrow PrismaClient
    // handle for LicensingRecord reads, mirroring `prisma` above's own default-param convention.
    private licensingProvider: LicensedJurisdictionsProvider = new LicensingService(
      new PrismaLicensingRepository(new PrismaClient() as unknown as { licensingRecord: LicensingRecordPrismaDelegate })
    )
  ) {}

  /**
   * The single entry point both the prioritized-queue and action-queue routes call. Returns
   * `available: false` (empty queue, NEVER a raw Vault fallback) until all three layers are
   * complete — the named WP03 critical failure "3-layer short-circuit" is what this early return
   * exists to prevent.
   */
  async getQueue(userId: string, orgType: OrgType, options: GetQueueOptions): Promise<PrioritizedQueueResult> {
    const state = await this.prisma.harvestMethodState.findUnique({ where: { user_id: userId } });
    const layersCompleted: MethodLayer[] = [];
    if (state?.blank_canvas_completed_at) layersCompleted.push(MethodLayer.BLANK_CANVAS);
    if (state?.qualities_flip_completed_at) layersCompleted.push(MethodLayer.QUALITIES_FLIP);
    if (state?.background_matching_completed_at) layersCompleted.push(MethodLayer.BACKGROUND_MATCHING);

    if (layersCompleted.length < METHOD_LAYER_ORDER.length) {
      return { available: false, reason: 'layers_incomplete', layersCompleted, queue: [] };
    }

    const profiles = await this.prisma.contactMethodProfile.findMany({ where: { user_id: userId, is_seed: true } });
    if (profiles.length === 0) {
      return { available: true, queue: [] };
    }

    const contactIds = profiles.map((p) => p.contact_id);
    const contacts = await this.prisma.contact.findMany({ where: { id: { in: contactIds }, user_id: userId } });
    const contactsById = new Map(contacts.map((c) => [c.id, c]));

    const interactions = await this.prisma.contactInteraction.findMany({
      where: { contact_id: { in: contactIds } },
      orderBy: { created_at: 'desc' },
    });
    const latestInteractionByContact = new Map<string, Date>();
    for (const i of interactions) {
      // findMany + orderBy desc: the first row seen per contact_id is its most recent interaction.
      if (!latestInteractionByContact.has(i.contact_id)) {
        latestInteractionByContact.set(i.contact_id, new Date(i.created_at));
      }
    }

    // T-29R (§8.2 "Excluded: state-unlicensed", §17.1 regulated-vs-universal) — rep-level, fetched
    // ONCE per getQueue() call (not per contact): `isPrimericaBranch` is this codebase's own
    // authoritative regulated/universal split (org-gate.ts), so a universal (non-Primerica) rep never
    // even calls into LicensingService — the state-unlicensed check is a true no-op for them, never
    // an accidental over-exclusion. A regulated rep's licensed-jurisdictions lookup is wrapped in
    // try/catch: an unavailable/erroring lookup degrades to `[]` (fail-closed — excludes every
    // jurisdiction-bearing contact rather than defaulting open, or throwing the whole queue request).
    const regulated = isPrimericaBranch(orgType);
    let licensedJurisdictions: string[] = [];
    if (regulated) {
      try {
        licensedJurisdictions = await this.licensingProvider.getLicensedJurisdictions(userId);
      } catch {
        licensedJurisdictions = [];
      }
    }

    type Scored = { profile: ContactMethodProfileRow; contact: QueueContactRow; score: number; tier: ReadinessTier; label: string };
    const scored: Scored[] = [];

    for (const profile of profiles) {
      const contact = contactsById.get(profile.contact_id);
      // A seed whose Contact row no longer exists (deleted between seeding and this read) is never
      // fabricated into a queue entry — it is simply omitted, matching §4.6's "never fabricate
      // contacts" doctrine.
      if (!contact) continue;

      const eligibility = await checkEligibility(contact, this.prisma.optOutRegistry);
      const jurisdictionExclusion = checkJurisdictionExclusion(contact.jurisdiction, {
        regulated,
        licensedJurisdictions,
      });
      // T-29R2: the two `checkJurisdictionExclusion` outcomes are NOT folded together any more — only
      // a CONFIRMED-unlicensed jurisdiction feeds `excluded` (unchanged from T-29R); an UNKNOWN
      // jurisdiction feeds the separate `needsJurisdiction` signal below, which computeReadiness
      // routes to the distinct NEEDS_JURISDICTION tier instead of EXCLUDED.
      const excluded =
        !eligibility.eligible || profile.existing_licensee_flag || jurisdictionExclusion === 'unlicensed_jurisdiction';
      const needsJurisdiction = jurisdictionExclusion === 'needs_jurisdiction';

      const clusters = clustersFromJson(profile.clusters);
      const tilesFilledCount = [
        profile.career_stage,
        profile.financial_situation,
        profile.family_context,
        profile.community_role,
      ].filter(Boolean).length;

      const lastInteraction = latestInteractionByContact.get(profile.contact_id) ?? null;
      const daysSinceLastInteraction = lastInteraction
        ? Math.floor((Date.now() - lastInteraction.getTime()) / MS_PER_DAY)
        : null;

      const inputs: ReadinessInputs = {
        assignedClusterCount: clusters.length,
        tilesFilledCount,
        daysSinceLastInteraction,
        careerStage: profile.career_stage,
        financialSituation: profile.financial_situation,
      };

      const result = computeReadiness(inputs, excluded, profile.needs_time, needsJurisdiction);

      // Persist the freshly computed (still-HIDDEN) score+tier so a downstream aggregate/read path
      // never has to re-run the engine — it never crosses THIS module's own return value though.
      await this.prisma.contactMethodProfile.upsert({
        where: { user_id_contact_id: { user_id: userId, contact_id: profile.contact_id } },
        create: {
          user_id: userId,
          contact_id: profile.contact_id,
          is_seed: true,
          readiness_score: result.score,
          readiness_tier: result.tier,
        },
        update: { readiness_score: result.score, readiness_tier: result.tier },
      });

      scored.push({ profile, contact, score: result.score, tier: result.tier, label: result.label });
    }

    // T-29R2: NEEDS_JURISDICTION is held out of the default §8.3 action-queue view exactly like
    // EXCLUDED (can't draft compliant outreach for either), but both remain visible in the
    // `includeExcluded: true` ritual-review list — EXCLUDED for the acknowledgment tap, NEEDS_
    // JURISDICTION for the "add this contact's state" data-completion prompt.
    const filtered = options.includeExcluded
      ? scored
      : scored.filter((s) => s.tier !== ReadinessTier.EXCLUDED && s.tier !== ReadinessTier.NEEDS_JURISDICTION);

    filtered.sort((a, b) => {
      const tierDiff = TIER_SORT_RANK[a.tier] - TIER_SORT_RANK[b.tier];
      if (tierDiff !== 0) return tierDiff;
      return b.score - a.score; // higher hidden score first WITHIN the same tier only
    });

    const queue: PublicQueueItem[] = filtered.map(({ profile, contact, tier, label }) => {
      const pii = decryptContactPII({ first_name: contact.first_name, last_name: contact.last_name, phone: null, email: null, notes: null }, this.encryptionKey);
      return toPublicQueueItem({
        contactId: profile.contact_id,
        firstName: pii.first_name,
        lastInitial: pii.last_name ? pii.last_name[0] : '',
        clusters: clustersFromJson(profile.clusters),
        tiles: {
          careerStage: profile.career_stage ?? undefined,
          financialSituation: profile.financial_situation ?? undefined,
          familyContext: profile.family_context ?? undefined,
          communityRole: profile.community_role ?? undefined,
        },
        tier,
        label,
        layersCompleted,
      });
    });

    // Belt-and-suspenders data-layer tripwires, run on the FULLY assembled payload immediately
    // before it can cross this module's own return boundary:
    assertNoRawScoreLeak(queue, 'prioritized_queue_service');
    assertNoPrimericaLeak(queue, orgType); // no-op for a Primerica caller; throws for a universal one

    const primericaVelocity = buildPrimericaVelocityContext(orgType, options.rank ?? null);
    return primericaVelocity ? { available: true, queue, primericaVelocity } : { available: true, queue };
  }

  /**
   * Marks a queue item actioned/dismissed by the rep. For a contact carrying the Layer-3 "existing
   * licensee" soft-exclusion flag, this doubles as the required acknowledgment (§8.2 "each requires
   * acknowledgment" — never a silent auto-clear; the rep must take this explicit action).
   */
  async markActionComplete(userId: string, contactId: string): Promise<{ success: boolean }> {
    const profile = await this.prisma.contactMethodProfile.findUnique({
      where: { user_id_contact_id: { user_id: userId, contact_id: contactId } },
    });
    if (!profile) return { success: false };

    const now = new Date();
    await this.prisma.contactMethodProfile.upsert({
      where: { user_id_contact_id: { user_id: userId, contact_id: contactId } },
      create: {
        user_id: userId,
        contact_id: contactId,
        is_seed: true,
        queue_actioned_at: now,
        ...(profile.existing_licensee_flag ? { existing_licensee_acked_at: now } : {}),
      },
      update: {
        queue_actioned_at: now,
        ...(profile.existing_licensee_flag ? { existing_licensee_acked_at: now } : {}),
      },
    });
    return { success: true };
  }
}

export { isPrimericaBranch };
