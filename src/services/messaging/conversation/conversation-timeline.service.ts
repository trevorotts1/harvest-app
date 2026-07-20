// T-39 QC FIX 1 (uiux §5.7 "Messaging & the Composer Handoff" / §4.7 "Conversation Timeline Entry")
// — the real, session-scoped, ownership-checked, DECRYPTED read this build's `ConversationTimeline`
// component was always meant to sit on top of. That component's own header comment says so
// explicitly: "It takes an already-decrypted, already-ownership-scoped list of entries (the
// page/route does the session-gated read); this component renders, it does not fetch." Before this
// fix, nothing implemented that read, so the component/badge/handoff-card were built but mounted on
// no route (the QC-critical "rep cannot reach the conversation surface" finding).
//
// OWNERSHIP (never a leak): the FIRST query is `contact.findFirst({ where: { id: contactId,
// user_id: userId } })`. A contactId that does not exist, OR belongs to a different rep, resolves to
// the exact same `null` — the caller (the API route) turns that into a single 404, so a forged
// contactId can never distinguish "not found" from "not yours" (same convention as
// contacts/flags.route.ts's ContactFlagsService, messaging/compose-handoff's
// FirstTouchComposerService).
//
// DECRYPTION: Contact PII (first/last name) and Message.body are both "encrypted at rest" columns
// (schema §3.3) — this service decrypts them via the same T-22 Vault primitives every other
// downstream read path uses (PipelineService.getPipelineSummary, send-support.ts's send paths),
// never pushing a ciphertext envelope to the caller.
//
// DOES NOT TOUCH THE SEND-GATING BACKBONE: this is a pure read of already-persisted, already-CFE-
// gated rows (Message, ThreeWayHandoff, OutreachSequence, Contact) — it creates nothing, sends
// nothing, and never calls into send/, sequence/, objection/, or handoff/'s write paths.

import {
  decryptContactPII,
  decryptRequiredField,
  getContactEncryptionKey,
} from '../../warm-market/vault/vault-encryption';

// ─── Timeline entry DTOs ────────────────────────────────────────────────────────────────────────
// Deliberately mirror `ConversationTimeline`'s `TimelineEntry` union field-for-field (kind/id/
// direction/source/... for a message; kind/id/repName/... for a handoff; kind/id/variant/... for a
// system entry) — that component's contract IS this service's output shape, by design, so the
// route can JSON-serialize this directly and the client page can treat the response as
// `TimelineEntry[]` with no field renaming. Defined independently here (not imported from the `src/
// app/community/components` UI layer) so this service stays framework-agnostic.

export interface TimelineMessageRow {
  kind: 'message';
  id: string;
  direction: 'OUTBOUND' | 'INBOUND';
  source: 'AGENT' | 'REP' | 'UPLINE' | 'SYSTEM';
  sentFrom: 'rep_number' | 'platform_number' | 'email_domain' | null;
  channel: 'SMS_HANDOFF' | 'SMS_PLATFORM' | 'EMAIL' | 'SOCIAL_DM' | 'IN_APP';
  body: string;
  timestamp: string; // ISO-8601
  deliveryStatus: string;
  approvedBy: string | null;
  approvedAt: string | null; // ISO-8601
  cfeAuditId: string | null;
}

export interface TimelineHandoffRow {
  kind: 'handoff';
  id: string;
  repName: string;
  uplineName: string;
  state: 'INVITED' | 'JOINED' | 'RETURNED';
  coachedNextStep: string | null;
  timestamp: string; // ISO-8601
}

export interface TimelineSystemRow {
  kind: 'system';
  id: string;
  variant: 'reply-paused' | 'opt-out' | 'reactivation';
  contactName?: string;
  summary?: string;
  timestamp: string; // ISO-8601
}

export type TimelineRow = TimelineMessageRow | TimelineHandoffRow | TimelineSystemRow;

export interface ConversationContact {
  id: string;
  name: string;
  doNotContact: boolean;
  agentsPaused: boolean;
}

export interface ConversationResult {
  contact: ConversationContact;
  entries: TimelineRow[];
}

// ─── Narrow, DI-mockable Prisma surface (same hand-written-delegate convention as every other
//     service in this codebase — SendPrismaClient, ThreeWayHandoffPrismaClient, ...) ───────────────

export interface ConversationContactRow {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  do_not_contact: boolean;
  agents_paused: boolean;
}

export interface ConversationThreadRow {
  id: string;
  channel: string;
  state: string; // ACTIVE | REACTIVATED | CLOSED
  last_activity_at: Date;
}

export interface ConversationMessageRow {
  id: string;
  thread_id: string;
  direction: string; // MessageDirection
  source: string; // MessageSource
  channel: string; // MessageChannel
  body: string; // ciphertext envelope
  sent_from: string | null;
  delivery_status: string;
  approved_by: string | null;
  approved_at: Date | null;
  cfe_audit_id: string | null;
  created_at: Date;
}

export interface ConversationHandoffRow {
  id: string;
  upline_id: string;
  state: string; // INVITED | JOINED | RETURNED | CLOSED
  invited_at: Date;
  joined_at: Date | null;
  returned_at: Date | null;
  coached_next_step: string | null;
}

export interface ConversationTimelinePrismaClient {
  contact: {
    findFirst(args: { where: { id: string; user_id: string } }): Promise<ConversationContactRow | null>;
  };
  messageThread: {
    findMany(args: {
      where: { user_id: string; contact_id: string };
    }): Promise<ConversationThreadRow[]>;
  };
  message: {
    findMany(args: {
      where: { thread_id: { in: string[] } };
      orderBy?: { created_at: 'asc' | 'desc' };
    }): Promise<ConversationMessageRow[]>;
  };
  threeWayHandoff: {
    findMany(args: { where: { user_id: string; contact_id: string } }): Promise<ConversationHandoffRow[]>;
  };
  outreachSequence: {
    findFirst(args: {
      where: { user_id: string; contact_id: string; state: string };
    }): Promise<{ pause_reason: string | null } | null>;
  };
  user: {
    findUnique(args: { where: { id: string }; select: { name: true } }): Promise<{ name: string } | null>;
  };
}

const DEFAULT_UPLINE_NAME = 'your upline';
const DEFAULT_REP_NAME = 'you';

export class ConversationTimelineService {
  constructor(
    private prisma: ConversationTimelinePrismaClient,
    private encryptionKey: string = getContactEncryptionKey()
  ) {}

  /**
   * Returns `null` iff `contactId` does not exist OR does not belong to `userId` — the two cases are
   * indistinguishable by design (never leak another rep's contact's existence). Otherwise returns
   * the full, decrypted, chronologically-sorted timeline for that contact.
   */
  async getConversation(userId: string, contactId: string): Promise<ConversationResult | null> {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, user_id: userId } });
    if (!contact) return null;

    const pii = decryptContactPII(
      { first_name: contact.first_name, last_name: contact.last_name, phone: null, email: null, notes: null },
      this.encryptionKey
    );
    const contactName = `${pii.first_name} ${pii.last_name}`.trim() || 'Unnamed contact';

    const threads = await this.prisma.messageThread.findMany({
      where: { user_id: userId, contact_id: contactId },
    });
    const threadIds = threads.map((t) => t.id);
    const messages =
      threadIds.length > 0
        ? await this.prisma.message.findMany({ where: { thread_id: { in: threadIds } }, orderBy: { created_at: 'asc' } })
        : [];

    const handoffs = await this.prisma.threeWayHandoff.findMany({
      where: { user_id: userId, contact_id: contactId },
    });

    const pausedSequence = await this.prisma.outreachSequence.findFirst({
      where: { user_id: userId, contact_id: contactId, state: 'PAUSED' },
    });

    const messageEntries: TimelineMessageRow[] = messages.map((m) => ({
      kind: 'message',
      id: m.id,
      direction: m.direction as TimelineMessageRow['direction'],
      source: m.source as TimelineMessageRow['source'],
      sentFrom: (m.sent_from as TimelineMessageRow['sentFrom']) ?? null,
      channel: m.channel as TimelineMessageRow['channel'],
      body: decryptRequiredField(m.body, this.encryptionKey),
      timestamp: m.created_at.toISOString(),
      deliveryStatus: m.delivery_status,
      approvedBy: m.approved_by ?? null,
      approvedAt: m.approved_at ? m.approved_at.toISOString() : null,
      cfeAuditId: m.cfe_audit_id ?? null,
    }));

    let handoffEntries: TimelineHandoffRow[] = [];
    if (handoffs.length > 0) {
      const rep = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      const repName = rep?.name ?? DEFAULT_REP_NAME;

      const uplineNameById = new Map<string, string>();
      for (const h of handoffs) {
        if (uplineNameById.has(h.upline_id)) continue;
        const upline = await this.prisma.user.findUnique({ where: { id: h.upline_id }, select: { name: true } });
        uplineNameById.set(h.upline_id, upline?.name ?? DEFAULT_UPLINE_NAME);
      }

      handoffEntries = handoffs.map((h) => {
        const timestamp =
          h.state === 'JOINED' && h.joined_at
            ? h.joined_at
            : h.state === 'RETURNED' && h.returned_at
              ? h.returned_at
              : h.invited_at;
        return {
          kind: 'handoff',
          id: h.id,
          repName,
          uplineName: uplineNameById.get(h.upline_id) ?? DEFAULT_UPLINE_NAME,
          state: h.state as TimelineHandoffRow['state'],
          coachedNextStep: h.coached_next_step ?? null,
          timestamp: timestamp.toISOString(),
        };
      });
    }

    const systemEntries: TimelineSystemRow[] = [];
    if (contact.do_not_contact) {
      systemEntries.push({
        kind: 'system',
        id: `optout-${contact.id}`,
        variant: 'opt-out',
        timestamp: new Date().toISOString(),
      });
    }
    if (pausedSequence && pausedSequence.pause_reason === 'REPLY') {
      systemEntries.push({
        kind: 'system',
        id: `reply-paused-${contact.id}`,
        variant: 'reply-paused',
        contactName,
        timestamp: new Date().toISOString(),
      });
    }
    const reactivatedThread = threads.find((t) => t.state === 'REACTIVATED');
    if (reactivatedThread) {
      systemEntries.push({
        kind: 'system',
        id: `reactivation-${reactivatedThread.id}`,
        variant: 'reactivation',
        summary: `It's been a while since your last message with ${contactName} — here's where you left off.`,
        timestamp: reactivatedThread.last_activity_at.toISOString(),
      });
    }

    const entries = [...messageEntries, ...handoffEntries, ...systemEntries].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    return {
      contact: {
        id: contact.id,
        name: contactName,
        doNotContact: contact.do_not_contact,
        agentsPaused: contact.agents_paused,
      },
      entries,
    };
  }
}
