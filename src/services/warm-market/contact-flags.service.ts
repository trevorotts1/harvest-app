// T-28 — closes the carried-forward `is_recruit_target` / `is_client` toggle write-path flagged by
// the WP02 gate (uiux §4.6: "two independent flag toggles"). Both columns already exist on
// `Contact` (prisma/schema.prisma — additive from an earlier wave), so this is a write-path-only
// fix: no schema change.
//
// INDEPENDENCE GUARANTEE: `setFlags` only ever includes a column in its Prisma `update` `data`
// object when the caller's input EXPLICITLY supplied that field (`!== undefined`). Setting
// `isRecruitTarget` alone therefore never touches the `is_client` column at all (not "set it to its
// current value" — genuinely absent from the update), and vice versa. This is what makes the two
// toggles structurally independent rather than independent-by-convention.

import { PrismaClient } from '@prisma/client';

export interface ContactFlagsRow {
  id: string;
  user_id: string;
  is_recruit_target: boolean;
  is_client: boolean;
}

/** Narrow, DI-mockable Prisma surface — same convention as every other service in this codebase
 *  (HarvestMethodPrismaClient, VaultPrismaClient, OnboardingGatePrismaClient, ...). */
export interface ContactFlagsPrismaClient {
  contact: {
    findFirst(args: { where: { id: string; user_id: string } }): Promise<ContactFlagsRow | null>;
    update(args: { where: { id: string }; data: Record<string, boolean> }): Promise<ContactFlagsRow>;
  };
}

export interface SetContactFlagsInput {
  isRecruitTarget?: boolean;
  isClient?: boolean;
}

export type SetContactFlagsResult =
  | { ok: true; contactId: string; isRecruitTarget: boolean; isClient: boolean }
  | { ok: false; reason: 'not_found' | 'no_flags_provided' };

export class ContactFlagsService {
  constructor(
    private prisma: ContactFlagsPrismaClient = new PrismaClient() as unknown as ContactFlagsPrismaClient
  ) {}

  /**
   * Sets one or both of `is_recruit_target` / `is_client` for exactly one of the CALLER's OWN
   * contacts — ownership is checked here (`user_id` must match) before any write, mirroring
   * `contacts/agent-queue/route.ts`'s POST ownership check. Never trusts a caller-supplied
   * `userId` from anywhere but the verified session (the route wrapper is what guarantees that;
   * this service just takes whatever `userId` it's given as authoritative).
   */
  async setFlags(userId: string, contactId: string, input: SetContactFlagsInput): Promise<SetContactFlagsResult> {
    if (input.isRecruitTarget === undefined && input.isClient === undefined) {
      return { ok: false, reason: 'no_flags_provided' };
    }

    const owned = await this.prisma.contact.findFirst({ where: { id: contactId, user_id: userId } });
    if (!owned) {
      return { ok: false, reason: 'not_found' };
    }

    const data: Record<string, boolean> = {};
    if (input.isRecruitTarget !== undefined) data.is_recruit_target = input.isRecruitTarget;
    if (input.isClient !== undefined) data.is_client = input.isClient;

    const updated = await this.prisma.contact.update({ where: { id: contactId }, data });
    return {
      ok: true,
      contactId: updated.id,
      isRecruitTarget: updated.is_recruit_target,
      isClient: updated.is_client,
    };
  }
}
