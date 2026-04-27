// WP05 Messaging & Outreach Types

export enum MessageChannel {
  SMS = 'SMS',
  EMAIL = 'EMAIL',
  IN_APP = 'IN_APP',
}

export enum MessageStatus {
  DRAFT = 'DRAFT',
  PENDING_CFE_REVIEW = 'PENDING_CFE_REVIEW',
  CFE_BLOCKED = 'CFE_BLOCKED',
  QUEUED = 'QUEUED',
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  SCHEDULED = 'SCHEDULED',
}

export enum MessagePriority {
  URGENT = 'URGENT',
  HIGH = 'HIGH',
  NORMAL = 'NORMAL',
  LOW = 'LOW',
}

export interface MessageTemplate {
  id: string;
  name: string;
  channel: MessageChannel;
  body: string;
  category: string[];
}

export interface OutreachCadence {
  type: string;
  intervalDays: number;
  maxPerWeek: number;
}

export interface CFEInterceptionResult {
  allowed: boolean;
  status: MessageStatus;
  reason?: string;
  requiresUplineApproval: boolean;
}

export interface Message {
  id: string;
  userId: string;
  contactId: string;
  content: string;
  channel: MessageChannel;
  status: MessageStatus;
  priority: MessagePriority;
  requiresUplineApproval: boolean;
  cfeOutcome?: string;
  cfeReason?: string;
  scheduledAt?: Date;
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Handoff {
  id: string;
  repId: string;
  uplineId: string;
  contactId: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  createdAt: Date;
  completedAt?: Date;
}