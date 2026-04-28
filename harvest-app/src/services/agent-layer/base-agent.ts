// WP04 Base Agent — Abstract class for all 8 agents

import {
  AgentType,
  AgentAction,
  AgentActionType,
  AgentActionStatus,
  AgentEvent,
  AgentExecutionMode,
  ComplianceGateResult,
} from '../../types/agent-layer';
import { CFEResult } from '../../types/compliance';

/**
 * Base class for all Harvest AI agents.
 * Enforces:
 * - CFE compliance gate before any content delivery
 * - Event logging to Mission Control
 * - Stateless design (state in DB, not in agent)
 * - Fail-closed behavior when CFE unavailable
 */
export abstract class BaseAgent {
  abstract readonly agentType: AgentType;
  abstract readonly executionMode: AgentExecutionMode;
  abstract readonly description: string;

  /**
   * All agent-generated content MUST pass through CFE before delivery.
   * Fail-closed: if CFE is unavailable, content is blocked.
   */
  protected complianceGate(cfeResult: CFEResult | null): ComplianceGateResult {
    if (!cfeResult) {
      // CFE unavailable — fail closed
      return {
        passed: false,
        riskScore: 100,
        outcome: 'BLOCK',
        blocked: true,
        safeHarborInjected: false,
      };
    }

    return {
      passed: cfeResult.outcome === 'PASS' && !cfeResult.blocked,
      riskScore: cfeResult.risk_score,
      outcome: cfeResult.outcome,
      blocked: cfeResult.blocked,
      safeHarborInjected: cfeResult.safe_harbor_injected,
    };
  }

  /**
   * Log an agent event to Mission Control telemetry.
   */
  protected logEvent(
    userId: string,
    actionType: AgentActionType,
    payload: Record<string, unknown>,
    contactId?: string,
    compliancePassed = true
  ): AgentEvent {
    return {
      id: crypto.randomUUID(),
      agentType: this.agentType,
      actionType,
      userId,
      contactId,
      timestamp: new Date(),
      payload,
      compliancePassed,
    };
  }

  /**
   * Create a standardized agent action record.
   */
  protected createAction(
    userId: string,
    actionType: AgentActionType,
    payload: Record<string, unknown>,
    contactId?: string
  ): AgentAction {
    return {
      id: crypto.randomUUID(),
      agentType: this.agentType,
      actionType,
      status: AgentActionStatus.PENDING,
      contactId,
      userId,
      payload,
      createdAt: new Date(),
    };
  }

  /**
   * Determine if the action requires human approval per 2 Hour CEO constraints.
   * Default: compliance-flagged content always requires approval.
   */
  requiresHumanApproval(actionType: AgentActionType, complianceResult?: ComplianceGateResult): boolean {
    if (complianceResult && !complianceResult.passed) return true;
    // Appointment confirmation always requires rep sign-off
    if (actionType === AgentActionType.PROPOSE_APPOINTMENT) return true;
    return false;
  }
}