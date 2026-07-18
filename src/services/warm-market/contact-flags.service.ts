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
//
// T-29R2 (WP03 gate remediation follow-up, §8.2 "Excluded: state-unlicensed" eligibility) extends
// this SAME route/service — rather than authoring a new one — with the manual CAPTURE path for
// `Contact.jurisdiction` (already an existing, additive, nullable column; no schema change here
// either): a rep who imports without a "state" CSV column, or whose contact's jurisdiction was
// never on file, needs a session-gated, ownership-checked way to add it so the contact can move out
// of the NEEDS_JURISDICTION state (see prioritized-queue.service.ts). Reusing this route's exact
// session-gate/ownership/lazy-instantiation conventions is deliberately the LEAST invasive capture
// surface — no new route, no new auth wiring, one more independently-settable field alongside the
// two flags this route already owns.

import { PrismaClient } from '@prisma/client';

import { normalizeJurisdiction } from '../harvest-method/eligibility';

export interface ContactFlagsRow {
  id: string;
  user_id: string;
  is_recruit_target: boolean;
  is_client: boolean;
  jurisdiction?: string | null;
}

/** Narrow, DI-mockable Prisma surface — same convention as every other service in this codebase
 *  (HarvestMethodPrismaClient, VaultPrismaClient, OnboardingGatePrismaClient, ...). */
export interface ContactFlagsPrismaClient {
  contact: {
    findFirst(args: { where: { id: string; user_id: string } }): Promise<ContactFlagsRow | null>;
    update(args: { where: { id: string }; data: Record<string, boolean | string | null> }): Promise<ContactFlagsRow>;
  };
}

export interface SetContactFlagsInput {
  isRecruitTarget?: boolean;
  isClient?: boolean;
  /** T-29R2 manual jurisdiction capture. `undefined` = untouched (existing behavior); a string =
   *  set (normalized to the 2-letter postal code via eligibility.ts's `normalizeJurisdiction`,
   *  same normalization the compliance boundary itself compares against); `null` = explicitly
   *  clear back to unknown. */
  jurisdiction?: string | null;
}

export type SetContactFlagsResult =
  | { ok: true; contactId: string; isRecruitTarget: boolean; isClient: boolean; jurisdiction: string | null }
  | { ok: false; reason: 'not_found' | 'no_flags_provided' | 'invalid_jurisdiction' };

export class ContactFlagsService {
  constructor(
    private prisma: ContactFlagsPrismaClient = new PrismaClient() as unknown as ContactFlagsPrismaClient
  ) {}

  /**
   * Sets one or more of `is_recruit_target` / `is_client` / `jurisdiction` (T-29R2) for exactly one
   * of the CALLER's OWN contacts — ownership is checked here (`user_id` must match) before any
   * write, mirroring `contacts/agent-queue/route.ts`'s POST ownership check. Never trusts a
   * caller-supplied `userId` from anywhere but the verified session (the route wrapper is what
   * guarantees that; this service just takes whatever `userId` it's given as authoritative).
   *
   * `jurisdiction` validation happens BEFORE the ownership lookup (cheap, no DB round-trip needed)
   * so a malformed value is rejected without ever touching Prisma — same fail-fast shape as the
   * route's own body-shape checks.
   */
  async setFlags(userId: string, contactId: string, input: SetContactFlagsInput): Promise<SetContactFlagsResult> {
    if (input.isRecruitTarget === undefined && input.isClient === undefined && input.jurisdiction === undefined) {
      return { ok: false, reason: 'no_flags_provided' };
    }

    // `undefined` (skip this field entirely, existing convention) vs. `null` (explicit clear) vs. a
    // string (set, once normalized+validated) are three distinct outcomes — never collapsed.
    let jurisdictionToWrite: string | null | undefined;
    if (input.jurisdiction !== undefined) {
      if (input.jurisdiction === null) {
        jurisdictionToWrite = null;
      } else {
        const normalized = normalizeJurisdiction(input.jurisdiction);
        if (!normalized || !/^[A-Z]{2}$/.test(normalized)) {
          return { ok: false, reason: 'invalid_jurisdiction' };
        }
        jurisdictionToWrite = normalized;
      }
    }

    const owned = await this.prisma.contact.findFirst({ where: { id: contactId, user_id: userId } });
    if (!owned) {
      return { ok: false, reason: 'not_found' };
    }

    const data: Record<string, boolean | string | null> = {};
    if (input.isRecruitTarget !== undefined) data.is_recruit_target = input.isRecruitTarget;
    if (input.isClient !== undefined) data.is_client = input.isClient;
    if (jurisdictionToWrite !== undefined) data.jurisdiction = jurisdictionToWrite;

    const updated = await this.prisma.contact.update({ where: { id: contactId }, data });
    return {
      ok: true,
      contactId: updated.id,
      isRecruitTarget: updated.is_recruit_target,
      isClient: updated.is_client,
      jurisdiction: updated.jurisdiction ?? null,
    };
  }
}
