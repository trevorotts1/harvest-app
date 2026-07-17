import { PrismaClient } from '@prisma/client';
import {
  InteractionType,
  PipelineStage,
  RelationshipStrength,
  ContactSource,
} from '../../types/warm-market';
import { hmacForMatch } from '../compliance/encryption/encryption';
// T-22 (The Vault, §7.1 "AES-256 encryption before persistence"; QC WP02 critical failure
// "unencrypted PII"): this file predates the WP11 encryption service being wired in — `importContacts`
// used to persist `normalized.phone`/`.email`/first_name/last_name as plaintext. It now encrypts
// every PII-bearing field before the `.create()` call, via the same Vault encryption module the
// richer batch/idempotency orchestration in `./vault/vault.service.ts` uses, so there is exactly one
// implementation of "how Contact PII is encrypted at rest" in this codebase. `phone_hash`/`email_hash`
// (already correct here since T-03) remain the ONLY queryable/dedup-able representation of phone/email
// — ciphertext varies by IV per call and can never be used for equality lookups.
import { encryptOptionalField, encryptRequiredField } from './vault/vault-encryption';

export interface ContactInput {
  userId: string;
  name: string;
  phone?: string;
  email?: string;
  industry?: string;
  notes?: string;
  source: ContactSource;
}

export class ContactService {
  constructor(private prisma: PrismaClient = new PrismaClient()) {}

  async importContacts(userId: string, source: ContactSource, data: ContactInput[]): Promise<any[]> {
    const imported: any[] = [];
    for (const item of data) {
      const normalized = this.normalize(item);
      const existing = await this.prisma.contact.findFirst({
        where: {
          user_id: userId,
          OR: [
            { phone: normalized.phone || 'non-existent' },
            { email: normalized.email || 'non-existent' },
          ],
        },
      });

      if (!existing) {
        const { first_name, last_name } = this.splitName(item.name);
        const contact = await this.prisma.contact.create({
          data: {
            user_id: userId,
            // T-22: encrypted at rest (AES-256-GCM, WP11 service) — never plaintext (§7.1, §16.4).
            first_name: encryptRequiredField(first_name),
            last_name: encryptRequiredField(last_name),
            phone: encryptOptionalField(normalized.phone),
            email: encryptOptionalField(normalized.email),
            // Deterministic *keyed* HMAC-SHA256 hashes for global opt-out matching & cross-rep
            // dedup (§3, §3.4) — NOT plain SHA-256, which would be reversible for low-entropy
            // inputs like phone numbers. Fails closed (throws) if CONTACT_HASH_PEPPER is unset.
            // These are computed from the PLAINTEXT normalized value (never from the ciphertext
            // above, which varies by IV per call and could never match on lookup).
            phone_hash: normalized.phone ? hmacForMatch(normalized.phone) : null,
            email_hash: normalized.email ? hmacForMatch(normalized.email) : null,
            industry: item.industry ?? null,
            notes: encryptOptionalField(item.notes ?? null),
            source,
            segment_score: 0,
            pipeline_stage: PipelineStage.IDENTIFIED,
          },
        });
        imported.push(contact);
      }
    }
    return imported;
  }

  normalize(contact: any): any {
    return {
      ...contact,
      phone: contact.phone?.replace(/\D/g, '') || null,
      email: contact.email?.toLowerCase().trim() || null,
    };
  }

  private splitName(fullName: string): { first_name: string; last_name: string } {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    const first_name = parts[0] || fullName;
    const last_name = parts.slice(1).join(' ');
    return { first_name, last_name };
  }

  scoreContact(contact: any): RelationshipStrength {
    return contact.interactions?.length > 5 ? 80 : 20;
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
