import { PrismaClient } from '@prisma/client';
import { PipelineStage, RelationshipStrength } from '../../types/warm-market';
// T-R8 (housekeeping, from the T-22 QC): this file used to also own a single-contact import/dedup
// method that predated T-22's AES-256 encryption of Contact.phone/.email. Once those columns
// became per-call-IV ciphertext, its dedup lookup — an equality match keyed on the caller-supplied
// PLAINTEXT phone/email value — could never match a ciphertext column again; it was dead code kept
// alive only by its own unit test. The one *live* import path is VaultService.importBatch
// (./vault/vault.service.ts), which already dedupes correctly via the keyed phone_hash/email_hash
// columns. That dead method (and its now-orphaned normalize/name-splitting helpers) was removed
// rather than fixed, since there was no live call site to preserve — see
// tests/unit/warm-market.test.ts's retirement-proof block for the grep-clean check.

export class ContactService {
  constructor(private prisma: PrismaClient = new PrismaClient()) {}

  scoreContact(contact: { interactions?: unknown[] }): RelationshipStrength {
    return (contact.interactions?.length ?? 0) > 5 ? 80 : 20;
  }

  async calculateHiddenEarnings(contactId: string): Promise<number> {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      include: { interactions: true },
    });

    if (!contact) return 0;
    const strength = this.scoreContact(contact);
    return strength * 1000;
  }

  async getPipelineContacts(userId: string, stage: PipelineStage) {
    return await this.prisma.contact.findMany({
      where: { user_id: userId, pipeline_stage: stage },
    });
  }
}
