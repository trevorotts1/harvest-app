// WP04 Pre-Sale Nurture Agent — warms prospects before first appointment

import {
  AgentType,
  AgentExecutionMode,
  AgentActionType,
  AgentAction,
  PrioritizedAction,
} from '../../types/agent-layer';
import { WP04AgentFeed, PipelineStage } from '../../types/warm-market';
import { BaseAgent } from './base-agent';

/** Days without touchpoint before nurture is needed */
const NURTURE_INACTIVITY_THRESHOLD = 3;

/**
 * Pre-Sale Nurture Agent: Maintains engagement with prospects who have
 * been introduced but not yet scheduled an appointment. Runs 24/7, parallel.
 *
 * Trigger conditions:
 * - Pipeline stage is ENGAGED or PIPELINE (not ACTIVATED/ARCHIVED)
 * - No touchpoint in last 3 days
 * - Contact not opted out or do_not_nurture
 * - Rep's nurture schedule active
 *
 * Outputs: nurture sequence messages, engagement score updates,
 * "ready for appointment" flag on buying signals
 */
export class PreSaleNurtureAgent extends BaseAgent {
  readonly agentType = AgentType.PRE_SALE_NURTURE;
  readonly executionMode = AgentExecutionMode.PARALLEL;
  readonly description = 'Warms prospects before first appointment';

  /**
   * Identify contacts needing nurture.
   */
  findNurtureCandidates(contacts: WP04AgentFeed[]): WP04AgentFeed[] {
    return contacts.filter((c) => this.needsNurture(c));
  }

  /**
   * Check if a contact needs nurturing.
   */
  needsNurture(contact: WP04AgentFeed): boolean {
    // Must be in pipeline stages that benefit from nurture
    if (contact.pipelineStage !== PipelineStage.ENGAGED && contact.pipelineStage !== PipelineStage.PIPELINE) {
      return false;
    }
    // Must not have been contacted recently
    if (contact.daysSinceLastContact !== null && contact.daysSinceLastContact < NURTURE_INACTIVITY_THRESHOLD) {
      return false;
    }
    // Must have consent
    if (!contact.consentSms && !contact.consentEmail) {
      return false;
    }
    return true;
  }

  /**
   * Generate a nurture action for a contact.
   */
  generateNurtureAction(contact: WP04AgentFeed): AgentAction {
    const nurtureType = this.selectNurtureType(contact);

    return this.createAction(
      contact.userId,
      AgentActionType.SEND_NURTURE_MESSAGE,
      {
        contactId: contact.contactId,
        firstName: contact.firstName,
        lastName: contact.lastName,
        relationshipType: contact.relationshipType,
        nurtureType,
        suggestedChannel: contact.consentSms ? 'SMS' : 'EMAIL',
      }
    );
  }

  /**
   * Select nurture content type based on contact engagement history.
   */
  private selectNurtureType(contact: WP04AgentFeed): 'EDUCATIONAL' | 'TESTIMONIAL' | 'INVITATION' {
    // Simple rotation: educational first, testimonial second, invitation third
    const touchCount = contact.daysSinceLastContact
      ? Math.floor(contact.daysSinceLastContact / NURTURE_INACTIVITY_THRESHOLD)
      : 0;

    if (touchCount % 3 === 0) return 'EDUCATIONAL';
    if (touchCount % 3 === 1) return 'TESTIMONIAL';
    return 'INVITATION';
  }

  /**
   * Evaluate buying signals from contact interactions.
   * Flags contacts as "ready for appointment" when positive engagement detected.
   */
  evaluateBuyingSignals(
    contact: WP04AgentFeed,
    interactionCount: number,
    positiveSentimentCount: number
  ): { readyForAppointment: boolean; confidence: number } {
    // After 2+ positive interactions, flag as ready
    if (positiveSentimentCount >= 2) {
      return { readyForAppointment: true, confidence: Math.min(1.0, positiveSentimentCount * 0.3) };
    }
    return { readyForAppointment: false, confidence: 0 };
  }

  /**
   * Detect if engagement is too low (3 sends, no opens).
   * Transitions to Inactivity Agent.
   */
  detectLowEngagement(
    contact: WP04AgentFeed,
    messagesSent: number,
    opens: number
  ): boolean {
    return messagesSent >= 3 && opens === 0;
  }
}