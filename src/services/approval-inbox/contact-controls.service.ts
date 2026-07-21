// T-33 — per-contact agent controls (master-spec §9.4; uiux §5.7 "Pause agents for {name}" /
// "Do not contact" / "Hand to me"). Backed by the already-existing, additive `Contact.agents_paused`
// / `Contact.do_not_contact` columns — the SAME two columns `agent-runtime.ts` already reads
// (`AgentRuntimeStore.getContactControls`) to halt a run immediately (§9.4 "take effect immediately").
// This service is the missing WRITE path: nothing in the codebase set these columns from a rep
// action before this build unit.
//
// Mirrors `contact-flags.service.ts`'s (T-28) exact conventions: a narrow DI-mockable Prisma
// surface, ownership checked (`user_id` must match the SESSION-derived caller) before any write, and
// the controls are set INDEPENDENTLY — sending only `agentsPaused` never touches `do_not_contact`
// (or `manualMode`), and vice versa (same independence guarantee T-28 established for
// `is_recruit_target`/`is_client`).
//
// T-57 R3c-2 (findings m4; master-spec §9.4 "hand a thread to manual mode" — the third control this
// file's own header comment already named, "Hand to me", but never implemented): adds
// `manual_mode` as a third, independently-settable column alongside the original two. Genuinely new
// backend surface (schema column + this write path) — nothing in the codebase persisted a
// manual-mode flag before this unit. NOTE for whichever unit next touches `agent-runtime.ts`/
// `src/services/agent-runtime/store.ts` (out of this unit's file ownership by explicit instruction):
// `AgentRuntimeStore.getContactControls`'s `ContactControls` interface and its two Prisma `select`
// clauses (store.ts) still only select `do_not_contact`/`agents_paused` — `manual_mode` is
// persisted and rep-toggleable via this service + `/api/contacts/controls` today, but the runtime's
// own per-contact draft-halt does not YET branch on it. Add `manual_mode: true` to that `select` and
// a `if (controls?.manual_mode) return { status: 'skipped_manual', ... }` branch (mirroring the
// existing `skipped_paused`/`skipped_dnc` branches, agent-runtime.ts:169-177) to close that gap.

import { PrismaClient } from '@prisma/client';

export interface ContactControlsRow {
  id: string;
  user_id: string;
  agents_paused: boolean;
  do_not_contact: boolean;
  manual_mode: boolean;
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
  /** Hand this contact's thread to manual mode (§9.4; findings m4). `undefined` = untouched.
   *  Independent of the other two — manual mode does not imply (or clear) `agentsPaused`/
   *  `doNotContact`, and setting either of those does not clear this. */
  manualMode?: boolean;
}

export type SetContactControlsResult =
  | { ok: true; contactId: string; agentsPaused: boolean; doNotContact: boolean; manualMode: boolean }
  | { ok: false; reason: 'not_found' | 'no_controls_provided' };

export class ContactControlsService {
  constructor(
    private prisma: ContactControlsPrismaClient = new PrismaClient() as unknown as ContactControlsPrismaClient
  ) {}

  /**
   * Sets one or more of `agents_paused`/`do_not_contact`/`manual_mode` for exactly one of the
   * CALLER's OWN contacts. Ownership (`user_id` must match) is checked BEFORE any write — a
   * contactId belonging to a different rep resolves to `not_found`, never a write, never a
   * distinguishing error. Independence: only fields explicitly present (`!== undefined`) in `input`
   * are ever included in the Prisma `update` `data` object — an untouched control is genuinely
   * absent from the write, not "set to its current value."
   */
  async setControls(userId: string, contactId: string, input: SetContactControlsInput): Promise<SetContactControlsResult> {
    if (input.agentsPaused === undefined && input.doNotContact === undefined && input.manualMode === undefined) {
      return { ok: false, reason: 'no_controls_provided' };
    }

    const owned = await this.prisma.contact.findFirst({ where: { id: contactId, user_id: userId } });
    if (!owned) {
      return { ok: false, reason: 'not_found' };
    }

    const data: Record<string, boolean> = {};
    if (input.agentsPaused !== undefined) data.agents_paused = input.agentsPaused;
    if (input.doNotContact !== undefined) data.do_not_contact = input.doNotContact;
    if (input.manualMode !== undefined) data.manual_mode = input.manualMode;

    const updated = await this.prisma.contact.update({ where: { id: contactId }, data });
    return {
      ok: true,
      contactId: updated.id,
      agentsPaused: updated.agents_paused,
      doNotContact: updated.do_not_contact,
      manualMode: updated.manual_mode,
    };
  }
}
