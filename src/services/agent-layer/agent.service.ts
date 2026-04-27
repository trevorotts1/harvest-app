import { AgentType, AgentStatus, AgentState, AgentActionInput, AgentActionResult, ThreeLawsViolation } from '../../types/agent-layer';
import { ComplianceFilterEngine } from '../compliance/engine';

const cfe = new ComplianceFilterEngine();

// Mock in-memory store
const agentStore: Record<string, AgentState[]> = {};

export async function getAgentInventory(userId: string): Promise<AgentState[]> {
  return agentStore[userId] || [];
}

export async function activateAgent(userId: string, agentType: AgentType): Promise<void> {
  const inventory = await getAgentInventory(userId);
  const agent = inventory.find(a => a.agentType === agentType);
  if (agent) agent.status = AgentStatus.ACTIVE;
}

export async function getQueue(userId: string, agentType: AgentType): Promise<any[]> {
  const inventory = await getAgentInventory(userId);
  const agent = inventory.find(a => a.agentType === agentType);
  return agent?.currentQueue || [];
}

export async function processNextAction(input: AgentActionInput): Promise<AgentActionResult> {
  // Logic: generate content, call CFE, return result
  const content = `Action for ${input.agentType}`;
  const cfeResult = await cfe.review({
    content,
    channel: 'SMS',
    userContext: { user_id: input.userId, role: 'REP' }
  });

  return {
    actionId: 'mock-id',
    agentType: input.agentType,
    content,
    compliant: !cfeResult.blocked,
    cfeResult,
    timestamp: new Date()
  };
}

export function runThreeLawsMonitor(userId: string, states: AgentState[]): ThreeLawsViolation[] {
  const violations: ThreeLawsViolation[] = [];
  // Dummy logic for neglect
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  if (states.some(s => s.lastRunAt && s.lastRunAt < fortyEightHoursAgo)) {
    violations.push(ThreeLawsViolation.NEGLECT);
  }
  return violations;
}
