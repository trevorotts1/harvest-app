import { PrismaClient } from '@prisma/client';
import {
  InteractionType,
  PipelineStage,
  RelationshipStrength,
  ContactSource,
} from '../../types/warm-market';
import { hashForAudit } from '../compliance/encryption/encryption';

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
            first_name,
            last_name,
            phone: normalized.phone,
            email: normalized.email,
            // Deterministic hashes for global opt-out matching & cross-rep dedup (§3, §3.4);
            // phone/email themselves are expected to hold app-layer AES-256 ciphertext in production.
            phone_hash: normalized.phone ? hashForAudit(normalized.phone) : null,
            email_hash: normalized.email ? hashForAudit(normalized.email) : null,
            industry: item.industry ?? null,
            notes: item.notes ?? null,
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
