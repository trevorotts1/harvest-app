import { PrismaClient } from '@prisma/client';
import {
  InteractionType,
  PipelineStage,
  RelationshipStrength,
  ContactSource,
} from '../../types/warm-market';

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
        const contact = await this.prisma.contact.create({
          data: {
            ...normalized,
            user_id: userId,
            source,
            relationship_strength: 0,
            pipeline_stage: 'DISCOVERY',
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
