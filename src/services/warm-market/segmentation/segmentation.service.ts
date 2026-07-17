// T-23 (§7.2 "Segmentation & scoring"). Orchestrates: decrypt the one PII field segmentation reads
// (notes) via the T-22 Vault decrypt helper, infer a relationship type through the injected
// `SegmentationClient` (Haiku 4.5 in production, a deterministic local heuristic in tests/dev — see
// ./client.ts), compute the 0–100 segment score (./scoring.ts), and persist both plus the derived
// `is_a_list` flag back onto the Contact row.
//
// Narrow Prisma delegate shape (same DI-mockable convention as `VaultPrismaClient`, T-22) so unit
// tests supply a plain mock/fake object instead of a real Prisma client / live database.

import { PrismaClient } from '@prisma/client';

import { RelationshipType } from '../../../types/warm-market';
import { decryptOptionalField, getContactEncryptionKey } from '../vault/vault-encryption';
import { SegmentationClient, SegmentationHints } from './client';
import { LocalDeterministicSegmentationClient } from './local-client';
import { computeSegmentScore, isAList } from './scoring';

export interface SegmentationContactRow {
  id: string;
  notes: string | null;
  industry: string | null;
}

export interface SegmentationInteractionRow {
  created_at: Date | string;
}

/** Narrow Prisma delegate shape this service needs — see file header. */
export interface SegmentationPrismaClient {
  contact: {
    findUnique(args: { where: { id: string } }): Promise<SegmentationContactRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  contactInteraction: {
    findMany(args: {
      where: { contact_id: string };
      orderBy: { created_at: 'desc' };
    }): Promise<SegmentationInteractionRow[]>;
  };
}

export interface SegmentContactResult {
  contactId: string;
  relationshipType: RelationshipType;
  segmentScore: number;
  isAList: boolean;
  /** §7.2: "no data → 'other' with a manual prompt." True when there were no hints to infer from
   * at all — the caller (UI) should surface a manual relationship-type prompt for this contact. */
  needsManualPrompt: boolean;
  source: 'inferred' | 'no_data_default';
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class SegmentationService {
  constructor(
    private prisma: SegmentationPrismaClient = new PrismaClient() as unknown as SegmentationPrismaClient,
    private client: SegmentationClient = new LocalDeterministicSegmentationClient(),
    private encryptionKey: string = getContactEncryptionKey()
  ) {}

  /**
   * Segments exactly one contact: infers `relationship_type`, computes `segment_score`, derives
   * `is_a_list`, and writes all three back. Returns `null` if the contact does not exist (e.g. it
   * was deleted between enqueue and processing — never throws for that case).
   */
  async segmentContact(contactId: string): Promise<SegmentContactResult | null> {
    const contact = await this.prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) return null;

    // The only Contact PII field segmentation reads is `notes` — always via the T-22 decrypt
    // helper, never the raw (ciphertext) column (this build unit's HARD REQUIREMENT).
    const notes = decryptOptionalField(contact.notes, this.encryptionKey);
    const hints: SegmentationHints = {
      notes,
      industry: contact.industry ?? null,
      groupMembership: null,
    };

    const hasHints = Boolean((notes && notes.trim()) || hints.industry || hints.groupMembership);

    let relationshipType: RelationshipType;
    let needsManualPrompt = false;
    let source: 'inferred' | 'no_data_default';

    if (!hasHints) {
      // §7.2: "no data → 'other' with a manual prompt." Skip the Haiku call entirely — there is no
      // signal for it to reason from, and calling it anyway would spend a request for nothing
      // (§4.4 cost discipline: "Haiku-first with escalation" still means don't call for no reason).
      relationshipType = RelationshipType.OTHER;
      needsManualPrompt = true;
      source = 'no_data_default';
    } else {
      const result = await this.client.inferRelationshipType({ contactId, hints });
      relationshipType = result.relationshipType;
      source = 'inferred';
    }

    const interactions = await this.prisma.contactInteraction.findMany({
      where: { contact_id: contactId },
      orderBy: { created_at: 'desc' },
    });
    const lastInteractionAt = interactions[0]?.created_at ? new Date(interactions[0].created_at) : null;
    const daysSinceLastInteraction = lastInteractionAt
      ? Math.floor((Date.now() - lastInteractionAt.getTime()) / MS_PER_DAY)
      : null;

    const segmentScore = computeSegmentScore({
      relationshipType,
      daysSinceLastInteraction,
      notes,
      interactionCount: interactions.length,
    });
    const aList = isAList(segmentScore);

    await this.prisma.contact.update({
      where: { id: contactId },
      data: {
        relationship_type: relationshipType,
        segment_score: segmentScore,
        is_a_list: aList,
      },
    });

    return { contactId, relationshipType, segmentScore, isAList: aList, needsManualPrompt, source };
  }
}
