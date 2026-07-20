// T-39 (WP05 §10.6 "Three-way handoff"; uiux §5.7 handoff card; §2.5 upline-visibility boundary) —
// the warm-intro-to-upline lifecycle. A buying signal or a hard question the rep can't answer bridges
// the rep's UPLINE into the same thread; if the upline doesn't join within 24h the thread returns to
// the rep with a coached next step. "Agents generate interest, the rep makes the introduction, the
// upline closes."
//
// ORG-GATING / NO CROSS-REP-OR-ORG LEAK (§2.5, the load-bearing invariant): a handoff row carries
// ONLY ids + state — never contact PII, never conversation body (that stays in per-rep Message rows).
// `visibleToUpline` filters on BOTH `upline_id` AND `organization_id`, and additionally requires the
// caller to actually BE that rep's upline — so a handoff can never surface to a different org's
// upline, a cross-line rep, or anyone who is not this rep's upline. The upline's own visibility is
// the aggregate reference (who/what-stage), consistent with the RBAC boundary; conversation content
// is only ever seen once the upline has JOINED an explicit three-way.

export interface HandoffRow {
  id: string;
  user_id: string;
  upline_id: string;
  organization_id: string;
  contact_id: string;
  thread_id: string | null;
  trigger_reason: string;
  state: string; // INVITED | JOINED | RETURNED | CLOSED
  invited_at: Date;
  joined_at: Date | null;
  returned_at: Date | null;
  return_deadline_at: Date;
  coached_next_step: string | null;
}

export interface ThreeWayHandoffPrismaClient {
  threeWayHandoff: {
    create(args: { data: Record<string, unknown> }): Promise<HandoffRow>;
    findFirst(args: { where: Record<string, unknown> }): Promise<HandoffRow | null>;
    findMany(args: { where: Record<string, unknown>; orderBy?: Record<string, unknown> }): Promise<HandoffRow[]>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<HandoffRow>;
  };
}

export type TriggerReason = 'BUYING_SIGNAL' | 'HARD_QUESTION' | 'MANUAL';

const RETURN_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h no-join → return to rep (§10.9-8).

const DEFAULT_COACHED_NEXT_STEP =
  "Your upline couldn't join in time — that's okay. Pick the conversation back up warmly: thank them for "
  + 'their patience, answer what you can, and offer to set a short call together when it suits them.';

export interface TriggerInput {
  userId: string; // the rep
  contactId: string;
  uplineId: string; // resolved from the rep's User.upline_id by the caller
  organizationId: string; // the rep's org — the visibility gate
  threadId?: string | null;
  reason: TriggerReason;
}

export type JoinResult =
  | { ok: true; handoff: HandoffRow }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_YOUR_HANDOFF' | 'NOT_JOINABLE' };

export class ThreeWayHandoffService {
  constructor(private prisma: ThreeWayHandoffPrismaClient) {}

  /** Bridge the rep's upline into the thread. Fails closed if no upline is on file (nothing to bridge). */
  async trigger(input: TriggerInput, now: Date = new Date()): Promise<{ ok: true; handoff: HandoffRow } | { ok: false; code: 'NO_UPLINE' }> {
    if (!input.uplineId) return { ok: false, code: 'NO_UPLINE' };
    const handoff = await this.prisma.threeWayHandoff.create({
      data: {
        user_id: input.userId,
        upline_id: input.uplineId,
        organization_id: input.organizationId,
        contact_id: input.contactId,
        thread_id: input.threadId ?? null,
        trigger_reason: input.reason,
        state: 'INVITED',
        invited_at: now,
        return_deadline_at: new Date(now.getTime() + RETURN_WINDOW_MS),
      },
    });
    return { ok: true, handoff };
  }

  /**
   * The upline joins the three-way. ONLY the invited upline may join, and only while INVITED. A join
   * attempt by anyone who is not this handoff's `upline_id` is NOT_YOUR_HANDOFF (never a leak).
   */
  async join(uplineId: string, handoffId: string, now: Date = new Date()): Promise<JoinResult> {
    const handoff = await this.prisma.threeWayHandoff.findFirst({ where: { id: handoffId } });
    if (!handoff) return { ok: false, code: 'NOT_FOUND' };
    if (handoff.upline_id !== uplineId) return { ok: false, code: 'NOT_YOUR_HANDOFF' };
    if (handoff.state !== 'INVITED') return { ok: false, code: 'NOT_JOINABLE' };
    const updated = await this.prisma.threeWayHandoff.update({
      where: { id: handoff.id },
      data: { state: 'JOINED', joined_at: now },
    });
    return { ok: true, handoff: updated };
  }

  /**
   * Return a lapsed (still-INVITED, past its 24h deadline) handoff to the rep with a coached next
   * step (§10.9-8). Idempotent: an already-JOINED/RETURNED handoff is left untouched. Scoped to the
   * owning rep — another rep cannot return someone else's handoff.
   */
  async returnIfLapsed(userId: string, handoffId: string, now: Date = new Date()): Promise<HandoffRow | null> {
    const handoff = await this.prisma.threeWayHandoff.findFirst({ where: { id: handoffId, user_id: userId } });
    if (!handoff) return null;
    if (handoff.state !== 'INVITED') return handoff;
    if (now.getTime() < handoff.return_deadline_at.getTime()) return handoff;
    return this.prisma.threeWayHandoff.update({
      where: { id: handoff.id },
      data: { state: 'RETURNED', returned_at: now, coached_next_step: DEFAULT_COACHED_NEXT_STEP },
    });
  }

  /** A rep's view of their own handoffs (ownership-scoped). */
  async listForRep(userId: string): Promise<HandoffRow[]> {
    return this.prisma.threeWayHandoff.findMany({ where: { user_id: userId }, orderBy: { invited_at: 'desc' } });
  }

  /**
   * The upline dashboard's view — ORG-GATED. Returns handoffs bridged TO this upline WITHIN this
   * organization only. `organizationId` is a required part of the key precisely so a handoff can
   * never cross an org boundary into a different org's upline view. Rows carry ids + state only, never
   * contact PII / conversation content (§2.5).
   */
  async visibleToUpline(uplineId: string, organizationId: string): Promise<HandoffRow[]> {
    return this.prisma.threeWayHandoff.findMany({
      where: { upline_id: uplineId, organization_id: organizationId },
      orderBy: { invited_at: 'desc' },
    });
  }
}
