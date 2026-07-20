// T-39 (WP05 §10.7) — the objection-coach service over the Socratic OBJECTION_TREE. Two surfaces:
//   • read the tree for the in-thread coaching sheet (uiux §5.7 "objection coach — only you see this");
//   • materialize a chosen branch into a DraftMessage so it goes through the SAME CFE + approval +
//     T-37 send seam as any other outbound. `prepareResponseDraft` creates a PENDING, cfe_outcome=null
//     draft — it does NOT pretend to CFE-clear the text itself (that is WP04's CFE pass). Until WP04
//     clears AND a human approves it, the send seam refuses it (NOT_CFE_CLEARED) — so a templated
//     objection response can never reach a recipient un-gated (§10.9-9 "all branches CFE-cleared").

import { MessageChannel } from '@prisma/client';

import { getObjection, getBranch, OBJECTION_TREE, type ObjectionNode, type ObjectionNextAction } from './objection-tree';

export interface ObjectionPrismaClient {
  contact: {
    findFirst(args: { where: { id: string; user_id: string }; select: { id: true } }): Promise<{ id: string } | null>;
  };
  draftMessage: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
}

export type PrepareObjectionResult =
  | { ok: true; draftId: string; nextAction: ObjectionNextAction }
  | { ok: false; error: string; code: 'UNKNOWN_OBJECTION' | 'UNKNOWN_BRANCH' | 'CONTACT_NOT_FOUND' };

export class ObjectionService {
  constructor(private prisma: ObjectionPrismaClient) {}

  /** The full tree for the coaching sheet (invisible to the community member). */
  listObjections(): ObjectionNode[] {
    return OBJECTION_TREE;
  }

  getObjection(key: string): ObjectionNode | undefined {
    return getObjection(key);
  }

  /**
   * Materialize a branch response into a DraftMessage for `contactId` (owned by `userId`). The draft
   * is PENDING with cfe_outcome = null — deliberately NOT released — so the T-37 seam HELDs it until
   * WP04's CFE pass + human approval clear it. Ownership: a contact not owned by the caller is
   * CONTACT_NOT_FOUND (never a leaky success).
   */
  async prepareResponseDraft(
    userId: string,
    contactId: string,
    objectionKey: string,
    branchKey: string,
    channel: MessageChannel = MessageChannel.SMS_HANDOFF
  ): Promise<PrepareObjectionResult> {
    const objection = getObjection(objectionKey);
    if (!objection) return { ok: false, error: 'No such objection in the tree.', code: 'UNKNOWN_OBJECTION' };
    const branch = getBranch(objectionKey, branchKey);
    if (!branch) return { ok: false, error: 'No such branch for this objection.', code: 'UNKNOWN_BRANCH' };

    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, user_id: userId }, select: { id: true } });
    if (!contact) return { ok: false, error: 'Contact not found.', code: 'CONTACT_NOT_FOUND' };

    const draft = await this.prisma.draftMessage.create({
      data: {
        user_id: userId,
        contact_id: contactId,
        channel,
        body: branch.response,
        // Deliberately null + PENDING: the objection response is agent-adapted content that MUST pass
        // WP04's CFE + the rep's approval before the seam will send it. Never pre-set to PASS here.
        cfe_outcome: null,
        approval_state: 'PENDING',
      },
    });
    return { ok: true, draftId: draft.id, nextAction: branch.nextAction };
  }
}
