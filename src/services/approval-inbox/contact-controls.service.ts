// T-33 — per-contact agent controls (master-spec §9.4; uiux §5.7 "Pause agents for {name}" /
// "Do not contact" / "Hand to me"). Backed by the already-existing, additive `Contact.agents_paused`
// / `Contact.do_not_contact` columns — the SAME two columns `agent-runtime.ts` already reads
// (`AgentRuntimeStore.getContactControls`) to halt a run immediately (§9.4 "take effect immediately").
// This service is the missing WRITE path: nothing in the codebase set these columns from a rep
// action before this build unit.
//
// Mirrors `contact-flags.service.ts`'s (T-28) exact conventions: a narrow DI-mockable Prisma
// surface, ownership checked (`user_id` must match the SESSION-derived caller) before any write, and
// the two controls are set INDEPENDENTLY — sending only `agentsPaused` never touches
// `do_not_contact`, and vice versa (same independence guarantee T-28 established for
// `is_recruit_target`/`is_client`).

import { PrismaClient } from '@prisma/client';

export interface ContactControlsRow {
  id: string;
  user_id: string;
  agents_paused: boolean;
  do_not_contact: boolean;
}

/** Narrow, DI-mockable Prisma surface — same convention as ContactFlagsPrismaClient. */
export interface ContactControlsPrismaClient {
  contact: {
    findFirst(args: { where: { id: string; user_id: string } }): Promise<ContactControlsRow | null>;
    update(args: { where: { id: string }; data: Record<string, boolean> }): Promise<ContactControlsRow>;
  };
}

export interface SetContactControlsInput {
  /** Pause/resume agents for this one contact (§9.4). `undefined` = untouched. */
  agentsPaused?: boolean;
  /** Mark do-not-contact (§9.4/§18.8). `undefined` = untouched. Setting this `true` does not itself
   *  clear `agentsPaused` — the two remain independently settable, same as T-28's two flags. */
  doNotContact?: boolean;
}

export type SetContactControlsResult =
  | { ok: true; contactId: string; agentsPaused: boolean; doNotContact: boolean }
  | { ok: false; reason: 'not_found' | 'no_controls_provided' };

export class ContactControlsService {
  constructor(
    private prisma: ContactControlsPrismaClient = new PrismaClient() as unknown as ContactControlsPrismaClient
  ) {}

  /**
   * Sets one or both of `agents_paused`/`do_not_contact` for exactly one of the CALLER's OWN
   * contacts. Ownership (`user_id` must match) is checked BEFORE any write — a contactId belonging
   * to a different rep resolves to `not_found`, never a write, never a distinguishing error.
   * Independence: only fields explicitly present (`!== undefined`) in `input` are ever included in
   * the Prisma `update` `data` object — the other control is genuinely absent from the write, not
   * "set to its current value."
   */
  async setControls(userId: string, contactId: string, input: SetContactControlsInput): Promise<SetContactControlsResult> {
    if (input.agentsPaused === undefined && input.doNotContact === undefined) {
      return { ok: false, reason: 'no_controls_provided' };
    }

    const owned = await this.prisma.contact.findFirst({ where: { id: contactId, user_id: userId } });
    if (!owned) {
      return { ok: false, reason: 'not_found' };
    }

    const data: Record<string, boolean> = {};
    if (input.agentsPaused !== undefined) data.agents_paused = input.agentsPaused;
    if (input.doNotContact !== undefined) data.do_not_contact = input.doNotContact;

    const updated = await this.prisma.contact.update({ where: { id: contactId }, data });
    return {
      ok: true,
      contactId: updated.id,
      agentsPaused: updated.agents_paused,
      doNotContact: updated.do_not_contact,
    };
  }
}
