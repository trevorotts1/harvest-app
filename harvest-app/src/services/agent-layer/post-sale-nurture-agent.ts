// WP04 Post-Sale Nurture Agent — onboards and retains new team members/customers

import {
  AgentType,
  AgentExecutionMode,
  AgentActionType,
  AgentAction,
} from '../../types/agent-layer';
import { WP04AgentFeed, PipelineStage } from '../../types/warm-market';
import { BaseAgent } from './base-agent';

/**
 * Post-Sale Nurture Agent: Onboards and retains new team members/customers.
 * Runs 24/7, parallel.
 *
 * Trigger conditions:
 * - Contact pipeline stage is ACTIVATED
 * - No post-sale touchpoint in configured interval
 *
 * Outputs: check-in messages, referral requests, renewal reminders,
 * celebration triggers
 */
export class PostSaleNurtureAgent extends BaseAgent {
  readonly agentType = AgentType.POST_SALE_NURTURE;
  readonly executionMode = AgentExecutionMode.PARALLEL;
  readonly description = 'Onboards and retains new team members/customers';

  /** Days between post-sale check-ins */
  private readonly CHECK_IN_INTERVAL_DAYS = 7;
  /** Days before requesting a referral */
  private readonly REFERRAL_REQUEST_DELAY_DAYS = 14;
  /** Days before renewal reminder */
  private readonly RENEWAL_REMINDER_DAYS = 30;

  /**
   * Find contacts eligible for post-sale nurture.
   */
  findPostSaleCandidates(contacts: WP04AgentFeed[]): WP04AgentFeed[] {
    return contacts.filter((c) => this.needsPostSaleNurture(c));
  }

  /**
   * Check if a contact needs post-sale nurture.
   */
  needsPostSaleNurture(contact: WP04AgentFeed): boolean {
    if (contact.pipelineStage !== PipelineStage.ACTIVATED) {
      return false;
    }
    // Must have been activated (have some last contact date)
    if (!contact.lastContactDate) {
      return true; // activated but never contacted post-sale
    }
    if (contact.daysSinceLastContact !== null && contact.daysSinceLastContact < this.CHECK_IN_INTERVAL_DAYS) {
      return false;
    }
    return true;
  }

  /**
   * Generate appropriate post-sale action based on time since activation.
   */
  generatePostSaleAction(contact: WP04AgentFeed): AgentAction {
    const daysSinceActivation = contact.daysSinceLastContact ?? 0;

    let actionType: AgentActionType;
    if (daysSinceActivation >= this.RENEWAL_REMINDER_DAYS) {
      actionType = AgentActionType.SCHEDULE_RENEWAL_REMINDER;
    } else if (daysSinceActivation >= this.REFERRAL_REQUEST_DELAY_DAYS) {
      actionType = AgentActionType.REQUEST_REFERRAL;
    } else {
      actionType = AgentActionType.SCHEDULE_CHECK_IN;
    }

    return this.createAction(
      contact.userId,
      actionType,
      {
        contactId: contact.contactId,
        firstName: contact.firstName,
        lastName: contact.lastName,
        isClient: contact.isClient,
        isRecruitTarget: contact.isRecruitTarget,
        daysSinceActivation,
        suggestedChannel: contact.consentSms ? 'SMS' : 'EMAIL',
      }
    );
  }
}