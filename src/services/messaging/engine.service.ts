import { ComplianceFilterEngine } from '../compliance/engine';
import { MessageChannel, MessageStatus, MessagePriority, Message } from '../../types/messaging';
import { v4 as uuidv4 } from 'uuid';

export class MessagingEngine {
  private cfe: ComplianceFilterEngine;
  private messages: Map<string, Message> = new Map();

  constructor(cfe: ComplianceFilterEngine) {
    this.cfe = cfe;
  }

  async createMessage(userId: string, contactId: string, content: string, channel: MessageChannel): Promise<Message> {
    const messageId = uuidv4();
    const message: Message = {
      id: messageId,
      userId,
      contactId,
      content,
      channel,
      status: MessageStatus.PENDING_CFE_REVIEW,
      priority: MessagePriority.NORMAL,
      requiresUplineApproval: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const cfeResult = await this.cfe.review({
      content,
      channel: channel as any,
      userContext: { user_id: userId, role: 'REP' },
    });

    if (cfeResult.blocked) {
      message.status = MessageStatus.CFE_BLOCKED;
      message.cfeOutcome = cfeResult.outcome;
      message.cfeReason = 'CFE Blocked content';
    } else if (cfeResult.outcome === 'FLAG') {
      message.status = MessageStatus.DRAFT;
      message.requiresUplineApproval = true;
      message.cfeOutcome = 'FLAG';
    } else {
      message.status = MessageStatus.QUEUED;
      message.cfeOutcome = 'PASS';
    }

    this.messages.set(messageId, message);
    return message;
  }

  async sendMessage(messageId: string): Promise<void> {
    const message = this.messages.get(messageId);
    if (!message || message.status !== MessageStatus.QUEUED) {
      throw new Error('Message not found or not in queued status');
    }
    message.status = MessageStatus.SENT;
    message.sentAt = new Date();
    message.updatedAt = new Date();
  }

  async scheduleMessage(messageId: string, sendAt: Date): Promise<void> {
    const message = this.messages.get(messageId);
    if (!message) throw new Error('Message not found');
    message.status = MessageStatus.SCHEDULED;
    message.scheduledAt = sendAt;
    message.updatedAt = new Date();
  }

  getOutboundHistory(userId: string): Message[] {
    return Array.from(this.messages.values()).filter(m => m.userId === userId && m.status === MessageStatus.SENT);
  }
  
  getMessage(messageId: string): Message | undefined {
    return this.messages.get(messageId);
  }
}
