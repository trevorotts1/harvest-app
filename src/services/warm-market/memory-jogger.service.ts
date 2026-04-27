import { PrismaClient } from '@prisma/client';

export class MemoryJoggerService {
  constructor(private prisma: PrismaClient = new PrismaClient()) {}

  async generatePrompts(contactId: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      include: { interactions: true },
    });

    if (!contact) return [];
    return [
      `How is ${contact.name} doing? Did you talk about ${contact.industry || 'work'} lately?`,
      `Recall the last time you met ${contact.name}. What did you learn?`,
    ];
  }

  async getLastInteraction(contactId: string) {
    const interaction = await this.prisma.contactInteraction.findFirst({
      where: { contact_id: contactId },
      orderBy: { created_at: 'desc' },
    });
    return interaction?.created_at || null;
  }
}
