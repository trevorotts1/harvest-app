import { PrismaClient } from '@prisma/client';
import {
  AgentAction,
  AgentActionStatus,
  AgentActionType,
  AgentEvent,
  AgentType,
  CorrectiveNudge,
  ThreeLaw,
} from '../../types/agent-layer';

export interface AgentStateRepository {
  createAction(action: AgentAction): Promise<AgentAction>;
  updateActionStatus(id: string, status: AgentActionStatus, result?: Record<string, unknown>): Promise<AgentAction>;
  listPendingActions(userId: string, limit?: number): Promise<AgentAction[]>;
  createEvent(event: AgentEvent): Promise<AgentEvent>;
  listEventsSince(userId: string, since: Date): Promise<AgentEvent[]>;
  createCorrectiveNudge(userId: string, nudge: CorrectiveNudge): Promise<CorrectiveNudge>;
}

function mapActionRecord(record: any): AgentAction {
  return {
    id: record.id,
    agentType: record.agent_type as AgentType,
    actionType: record.action_type as AgentActionType,
    status: record.status as AgentActionStatus,
    contactId: record.contact_id ?? undefined,
    userId: record.user_id,
    payload: (record.payload ?? {}) as Record<string, unknown>,
    result: (record.result ?? undefined) as Record<string, unknown> | undefined,
    complianceResult: (record.compliance_result ?? undefined) as AgentAction['complianceResult'],
    createdAt: record.created_at,
    completedAt: record.completed_at ?? undefined,
  };
}

function mapEventRecord(record: any): AgentEvent {
  return {
    id: record.id,
    agentType: record.agent_type as AgentType,
    actionType: record.action_type as AgentActionType,
    userId: record.user_id,
    contactId: record.contact_id ?? undefined,
    timestamp: record.timestamp,
    payload: (record.payload ?? {}) as Record<string, unknown>,
    result: (record.result ?? undefined) as Record<string, unknown> | undefined,
    compliancePassed: Boolean(record.compliance_passed),
  };
}

export class PrismaAgentStateRepository implements AgentStateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createAction(action: AgentAction): Promise<AgentAction> {
    const record = await this.prisma.agentActionRecord.create({
      data: {
        id: action.id,
        agent_type: action.agentType as any,
        action_type: action.actionType,
        status: action.status as any,
        contact_id: action.contactId,
        user_id: action.userId,
        payload: action.payload as any,
        result: action.result as any,
        compliance_result: action.complianceResult as any,
        created_at: action.createdAt,
        completed_at: action.completedAt,
      },
    });
    return mapActionRecord(record);
  }

  async updateActionStatus(id: string, status: AgentActionStatus, result?: Record<string, unknown>): Promise<AgentAction> {
    const record = await this.prisma.agentActionRecord.update({
      where: { id },
      data: {
        status: status as any,
        result: result as any,
        completed_at: status === AgentActionStatus.COMPLETED || status === AgentActionStatus.FAILED ? new Date() : undefined,
      },
    });
    return mapActionRecord(record);
  }

  async listPendingActions(userId: string, limit = 20): Promise<AgentAction[]> {
    const records = await this.prisma.agentActionRecord.findMany({
      where: { user_id: userId, status: AgentActionStatus.PENDING as any },
      orderBy: [{ created_at: 'asc' }],
      take: limit,
    });
    return records.map(mapActionRecord);
  }

  async createEvent(event: AgentEvent): Promise<AgentEvent> {
    const record = await this.prisma.agentEventRecord.create({
      data: {
        id: event.id,
        agent_type: event.agentType as any,
        action_type: event.actionType,
        user_id: event.userId,
        contact_id: event.contactId,
        payload: event.payload as any,
        result: event.result as any,
        compliance_passed: event.compliancePassed,
        timestamp: event.timestamp,
      },
    });
    return mapEventRecord(record);
  }

  async listEventsSince(userId: string, since: Date): Promise<AgentEvent[]> {
    const records = await this.prisma.agentEventRecord.findMany({
      where: { user_id: userId, timestamp: { gte: since } },
      orderBy: [{ timestamp: 'desc' }],
    });
    return records.map(mapEventRecord);
  }

  async createCorrectiveNudge(userId: string, nudge: CorrectiveNudge): Promise<CorrectiveNudge> {
    await this.prisma.correctiveNudgeRecord.create({
      data: {
        id: nudge.id,
        user_id: userId,
        law: nudge.law as any,
        severity: nudge.severity,
        message: nudge.message,
        suggested_action: nudge.suggestedAction,
        escalated_to_upline: nudge.escalatedToUpline,
        dismissed_at: nudge.dismissedAt,
        created_at: nudge.triggeredAt,
      },
    });
    return nudge;
  }
}

export class InMemoryAgentStateRepository implements AgentStateRepository {
  private actions = new Map<string, AgentAction>();
  private events: AgentEvent[] = [];
  private nudges: CorrectiveNudge[] = [];

  async createAction(action: AgentAction): Promise<AgentAction> {
    this.actions.set(action.id, action);
    return action;
  }

  async updateActionStatus(id: string, status: AgentActionStatus, result?: Record<string, unknown>): Promise<AgentAction> {
    const current = this.actions.get(id);
    if (!current) throw new Error(`Agent action not found: ${id}`);
    const updated = { ...current, status, result, completedAt: status === AgentActionStatus.COMPLETED || status === AgentActionStatus.FAILED ? new Date() : current.completedAt };
    this.actions.set(id, updated);
    return updated;
  }

  async listPendingActions(userId: string, limit = 20): Promise<AgentAction[]> {
    return Array.from(this.actions.values())
      .filter((action) => action.userId === userId && action.status === AgentActionStatus.PENDING)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);
  }

  async createEvent(event: AgentEvent): Promise<AgentEvent> {
    this.events.push(event);
    return event;
  }

  async listEventsSince(userId: string, since: Date): Promise<AgentEvent[]> {
    return this.events
      .filter((event) => event.userId === userId && event.timestamp >= since)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  async createCorrectiveNudge(_userId: string, nudge: CorrectiveNudge): Promise<CorrectiveNudge> {
    this.nudges.push(nudge);
    return nudge;
  }
}
