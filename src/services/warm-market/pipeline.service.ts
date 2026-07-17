// T-23 (§7.5 "Contact pipeline to agents"; §16.4/§7.1 PII encrypted at rest).
//
// DECRYPT FIX (HARD REQUIREMENT): `getPipelineSummary` used to push the raw Contact row (ciphertext
// `first_name`/`last_name`/`phone`/`email`/`notes` since T-22) straight into its per-stage arrays —
// any caller reading `.first_name` off the result got an AES-256-GCM envelope, not a name. Every
// PII field returned by this service is now decrypted via `decryptContactPII`.

import { PrismaClient } from '@prisma/client';

import {
  AgentQueueContact,
  PipelineStage,
  RecordOutreachInput,
  RelationshipType,
} from '../../types/warm-market';
import { decryptContactPII, getContactEncryptionKey } from './vault/vault-encryption';

/** §7.5: pipeline stages a contact must NOT be in to be "ready" for a new agent-run outreach —
 * already closed, dormant, or opted out. */
const AGENT_QUEUE_EXCLUDED_STAGES: PipelineStage[] = [
  PipelineStage.CLOSED_CLIENT,
  PipelineStage.CLOSED_RECRUIT,
  PipelineStage.DORMANT,
  PipelineStage.DO_NOT_CONTACT,
];

export const AGENT_QUEUE_DEFAULT_LIMIT = 50;
export const AGENT_QUEUE_MAX_LIMIT = 200;

export interface AgentQueueOptions {
  status?: 'ready';
  limit?: number;
}

export class PipelineService {
  constructor(
    private prisma: PrismaClient = new PrismaClient(),
    private encryptionKey: string = getContactEncryptionKey()
  ) {}

  async moveContact(contactId: string, toStage: PipelineStage) {
    return await this.prisma.contact.update({
      where: { id: contactId },
      data: { pipeline_stage: toStage },
    });
  }

  /**
   * The "Community home" horizontally-scrollable plots (§7.2) group contacts by pipeline stage.
   * FIX (T-23, decrypt fix): every PII field is decrypted via `decryptContactPII` before a contact
   * is grouped — the pre-fix code pushed the raw (ciphertext) row.
   */
  async getPipelineSummary(userId: string) {
    const contacts = await this.prisma.contact.findMany({
      where: { user_id: userId },
    });

    const summary: Record<PipelineStage, any[]> = {
      IDENTIFIED: [],
      INTRODUCED: [],
      RESPONDED: [],
      APPOINTMENT_PROPOSED: [],
      APPOINTMENT_CONFIRMED: [],
      MET: [],
      CLOSED_CLIENT: [],
      CLOSED_RECRUIT: [],
      DORMANT: [],
      DO_NOT_CONTACT: [],
    };

    contacts.forEach((c: any) => {
      const pii = decryptContactPII(
        { first_name: c.first_name, last_name: c.last_name, phone: c.phone, email: c.email, notes: c.notes },
        this.encryptionKey
      );
      summary[c.pipeline_stage as PipelineStage].push({
        id: c.id,
        firstName: pii.first_name,
        lastName: pii.last_name,
        phone: pii.phone,
        email: pii.email,
        notes: pii.notes,
        industry: c.industry ?? null,
        pipelineStage: c.pipeline_stage,
        segmentScore: c.segment_score,
      });
    });

    return summary;
  }

  /**
   * §7.5 contact→agent pipeline: `GET /api/v1/contacts/agent-queue?status=ready&limit=N`. Returns
   * contacts sorted by `segment_score` DESC — the exact ordering WP04's agents dequeue by — with
   * DECRYPTED PII (the agent layer must act on a real name/phone/email, not ciphertext),
   * relationship type, and the dual `is_recruit_target`/`is_client` flags. "Ready" (§7.5) excludes
   * anything already closed, dormant, opted out (`do_not_contact`), agent-paused, or a flagged
   * minor — the agent queue is eligibility for a NEW outreach, not merely Vault membership.
   *
   * This is a live query with no separate materialized/cached queue, so deleting a Contact row (or
   * flipping `do_not_contact`/`agents_paused`/`is_minor_flag`) removes it from every subsequent call
   * immediately — comfortably inside the §7.5 60-second propagation requirement (see
   * `tests/unit/warm-market.test.ts`'s agent-queue deletion-propagation test for the proof).
   */
  async getAgentQueue(userId: string, opts: AgentQueueOptions = {}): Promise<AgentQueueContact[]> {
    const limit = clampAgentQueueLimit(opts.limit);
    const contacts = await this.prisma.contact.findMany({
      where: {
        user_id: userId,
        do_not_contact: false,
        agents_paused: false,
        is_minor_flag: false,
        pipeline_stage: { notIn: AGENT_QUEUE_EXCLUDED_STAGES },
      },
      orderBy: { segment_score: 'desc' },
      take: limit,
    });

    return (contacts as any[]).map((c) => this.toAgentQueueContact(c));
  }

  /** §7.5: "after outreach it updates last_contact_date and pipeline_stage." */
  async recordOutreach(input: RecordOutreachInput) {
    return this.prisma.contact.update({
      where: { id: input.contactId },
      data: {
        pipeline_stage: input.toStage,
        last_contact_date: input.contactedAt ?? new Date(),
      },
    });
  }

  private toAgentQueueContact(c: any): AgentQueueContact {
    const pii = decryptContactPII(
      { first_name: c.first_name, last_name: c.last_name, phone: c.phone, email: c.email, notes: c.notes },
      this.encryptionKey
    );
    return {
      id: c.id,
      firstName: pii.first_name,
      lastName: pii.last_name,
      phone: pii.phone,
      email: pii.email,
      relationshipType: (c.relationship_type as RelationshipType | null) ?? null,
      segmentScore: c.segment_score,
      isAList: c.is_a_list,
      isRecruitTarget: c.is_recruit_target,
      isClient: c.is_client,
      pipelineStage: c.pipeline_stage as PipelineStage,
      lastContactDate: c.last_contact_date ?? null,
      doNotContact: c.do_not_contact,
    };
  }
}

/** Exported so callers (e.g. the `/api/contacts/agent-queue` route) can compute the resolved
 * `limit` for a response payload without duplicating the clamp rule. */
export function clampAgentQueueLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return AGENT_QUEUE_DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), AGENT_QUEUE_MAX_LIMIT);
}
