// WP04 Prospecting Agent — identifies and prioritizes warm market prospects

import {
  AgentType,
  AgentExecutionMode,
  AgentActionType,
  AgentAction,
  AgentActionStatus,
  PrioritizedAction,
} from '../../types/agent-layer';
import { WP04AgentFeed, PipelineStage, calculateSegmentScore } from '../../types/warm-market';
import { BaseAgent } from './base-agent';

/**
 * Prospecting Agent: Identifies high-probability prospects from warm market
 * and initiates first-touch outreach. Runs 24/7, parallel.
 *
 * Trigger conditions:
 * - Daily at 06:00 local time
 * - When new contact added with source: warm_market
 * - When contact last_contact_date exceeds 14 days and pipeline_stage is NEW/ENGAGED
 * - When Hidden Earnings Engine flags "high intent"
 *
 * Outputs: prioritized prospect list, personalized first-touch drafts
 */
export class ProspectingAgent extends BaseAgent {
  readonly agentType = AgentType.PROSPECTING;
  readonly executionMode = AgentExecutionMode.PARALLEL;
  readonly description = 'Identifies and initiates contact with warm market prospects';

  /**
   * Prioritize contacts for outreach based on:
   * - Relationship heat score (segmentScore)
   * - Recency (days since last contact)
   * - Life events (recent events boost priority)
   * - Consent availability (SMS/email)
   */
  prioritizeProspects(
    contacts: WP04AgentFeed[],
    dailyGoal: number
  ): PrioritizedAction[] {
    const eligible = contacts.filter((c) => this.isProspectable(c));

    // Sort by composite priority: segmentScore + recency bonus + life event bonus
    const sorted = eligible.sort((a, b) => {
      const scoreA = this.prospectPriorityScore(a);
      const scoreB = this.prospectPriorityScore(b);
      return scoreB - scoreA;
    });

    const limited = sorted.slice(0, dailyGoal);

    return limited.map((contact, index) => ({
      id: crypto.randomUUID(),
      priority: index + 1,
      actionType: AgentActionType.DRAFT_FIRST_TOUCH,
      description: `Initiate first-touch with ${contact.firstName} ${contact.lastName} (${contact.relationshipType})`,
      contactId: contact.contactId,
      contactName: `${contact.firstName} ${contact.lastName}`,
      dueBy: new Date(Date.now() + (index * 30 * 60 * 1000)), // stagger 30 min apart
      estimatedMinutes: 2,
      agentType: this.agentType,
      requiresHumanApproval: true, // first-touch always requires rep approval
    }));
  }

  /**
   * Check if a contact is eligible for prospecting.
   */
  isProspectable(contact: WP04AgentFeed): boolean {
    // Must be in early pipeline stages
    if (contact.pipelineStage === PipelineStage.ACTIVATED || contact.pipelineStage === PipelineStage.ARCHIVED) {
      return false;
    }
    // Must have at least one consent channel
    if (!contact.consentSms && !contact.consentEmail) {
      return false;
    }
    // Must not be recently contacted (within 3 days)
    if (contact.daysSinceLastContact !== null && contact.daysSinceLastContact < 3) {
      return false;
    }
    return true;
  }

  /**
   * Calculate a composite priority score for a prospect.
   */
  private prospectPriorityScore(contact: WP04AgentFeed): number {
    let score = contact.segmentScore;

    // Recency bonus: longer gap = higher need to re-engage
    if (contact.daysSinceLastContact !== null) {
      if (contact.daysSinceLastContact > 14) score += 15;
      else if (contact.daysSinceLastContact > 7) score += 10;
    } else {
      score += 5; // never contacted
    }

    // Life event bonus
    if (contact.lifeEvents && contact.lifeEvents.length > 0) {
      score += 10;
    }

    // Trust score bonus
    if (contact.trustScore !== null) {
      score += Math.round(contact.trustScore * 0.1);
    }

    // Recruit/client targeting
    if (contact.isRecruitTarget) score += 5;
    if (contact.isClient) score += 3;

    return Math.min(100, score);
  }

  /**
   * Generate a first-touch draft message for a contact.
   * Content will be compliance-reviewed before delivery.
   */
  draftFirstTouch(contact: WP04AgentFeed): AgentAction {
    return this.createAction(
      contact.userId,
      AgentActionType.DRAFT_FIRST_TOUCH,
      {
        contactId: contact.contactId,
        firstName: contact.firstName,
        lastName: contact.lastName,
        relationshipType: contact.relationshipType,
        suggestedChannel: contact.consentSms ? 'SMS' : 'EMAIL',
        segmentScore: contact.segmentScore,
      }
    );
  }

  /**
   * Detect if prospecting pool is exhausted.
   */
  detectEmptyPool(contacts: WP04AgentFeed[]): boolean {
    return contacts.filter((c) => this.isProspectable(c)).length === 0;
  }
}