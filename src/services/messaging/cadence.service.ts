import { OutreachCadence } from '../../types/messaging';

export class CadenceService {
  private history: Map<string, Date[]> = new Map();

  getCadence(userId: string, contactId: string): OutreachCadence {
    return { type: 'RELATIONSHIP_BASED', intervalDays: 3, maxPerWeek: 5 };
  }

  checkCadenceCompliance(userId: string, contactId: string): boolean {
    const key = `${userId}:${contactId}`;
    const pastWeek = new Date();
    pastWeek.setDate(pastWeek.getDate() - 7);
    const messages = (this.history.get(key) || []).filter(d => d > pastWeek);
    return messages.length < 5;
  }

  getNextRecommendedAction(userId: string, contactId: string): Date {
    const nextAction = new Date();
    nextAction.setDate(nextAction.getDate() + 3);
    return nextAction;
  }
}
