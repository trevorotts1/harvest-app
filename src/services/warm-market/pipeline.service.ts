import { PrismaClient } from '@prisma/client';
import { PipelineStage } from '../../types/warm-market';

export class PipelineService {
  constructor(private prisma: PrismaClient = new PrismaClient()) {}

  async moveContact(contactId: string, toStage: PipelineStage) {
    return await this.prisma.contact.update({
      where: { id: contactId },
      data: { pipeline_stage: toStage },
    });
  }

  async getPipelineSummary(userId: string) {
    const contacts = await this.prisma.contact.findMany({
      where: { user_id: userId },
    });

    const summary: Record<PipelineStage, any[]> = {
      IDENTIFIED: [],
      INTRODUCED: [],
      RESPONDED: [],
      APPOINTMENT_PROPOSED: [],
      APPOINTMENT_CONFIRMED: [],
      MET: [],
      CLOSED_CLIENT: [],
      CLOSED_RECRUIT: [],
      DORMANT: [],
      DO_NOT_CONTACT: [],
    };

    contacts.forEach((c) => {
      summary[c.pipeline_stage as PipelineStage].push(c);
    });

    return summary;
  }
}
