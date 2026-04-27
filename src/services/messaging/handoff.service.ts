import { Handoff } from '../../types/messaging';
import { v4 as uuidv4 } from 'uuid';

export class HandoffService {
  private handoffs: Map<string, Handoff> = new Map();

  initiateThreeWay(repId: string, uplineId: string, contactId: string): string {
    const id = uuidv4();
    this.handoffs.set(id, { id, repId, uplineId, contactId, status: 'ACTIVE', createdAt: new Date() });
    return id;
  }

  getHandoffStatus(handoffId: string): Handoff | undefined {
    return this.handoffs.get(handoffId);
  }

  completeHandoff(handoffId: string): void {
    const handoff = this.handoffs.get(handoffId);
    if (handoff) {
      handoff.status = 'COMPLETED';
      handoff.completedAt = new Date();
    }
  }
}
