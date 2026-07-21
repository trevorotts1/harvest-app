// T-57 R3c-1 (MAJOR-M7, master-spec §6.6 Upline invite state machine; uiux §2.4 route map:
// "`/onboarding/invite?invite_id={id}` — invite pre-seed"). Before this fix, `/onboarding/invite`
// 404'd, and NOTHING in `src/app/api` ever called `SponsorInviteService`/`invite-state-machine.ts`
// (`grep -rln "invite" src/app/api` found only unrelated comments — see that grep's own trail) —
// the §6.6 state machine (`sent → pending → accepted | rejected | expired`) was fully built and
// unit-tested (`tests/unit/onboarding-invite-state-machine.test.ts`) but had no HTTP surface at all.
//
// This is the "recipient opens the one-time link" half of §6.6: `GET ?invite_id=` looks up the real
// `UplineInvite` row, applies the SAME pure transition rules the state-machine module already
// defines (never re-derived), and — for a live `SENT` invite — advances it to `PENDING` (a genuine,
// persisted state change; `SENT → PENDING` has no extra guard condition per
// `invite-state-machine.ts`'s own transition graph). Deliberately UNAUTHENTICATED: the recipient of
// a sponsor invite email has, by definition, no session yet (this is exactly why `/onboarding/*` is
// absent from `GATED_DOWNSTREAM_PAGE_PREFIXES`/`src/middleware.ts`'s matcher — identity capture is
// itself a step INSIDE onboarding, per onboarding-gate-edge.ts's own header).
//
// "Pre-seeds sponsor + org + role" (§6.6): the `UplineInvite` row itself carries no org/role columns
// (`prisma/schema.prisma` — only `sponsor_id`/`recipient_email`/`status`/timestamps/`resend_count`)
// — the org/role a recipient joins under are the SPONSOR's own (`User.org_type`/`role`), read here
// by a real join. What this route can and does do fully, honestly, for real: resolve + advance the
// invite state and return the sponsor's real org/role for display. What it does NOT do (documented,
// not silent): thread that org/role into `OnboardingFlow`'s own internal step state to literally
// SKIP the sponsor-matching screen — `OnboardingFlow.tsx`/`OrgStep.tsx`/`SponsorStep.tsx` accept no
// such pre-seed prop today, and those files are owned by a different build unit (WP01 onboarding
// track), out of this build unit's file ownership. The invite page forwards the resolved values
// onward as query params on its `/onboarding` link for whenever that follow-up wiring lands.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { InviteStatus, INVITE_EXPIRY_DAYS } from '@/types/onboarding';
import { transitionInvite, type UplineInviteRecord } from '@/services/onboarding/wp01/invite-state-machine';

export const dynamic = 'force-dynamic';

function toRecord(row: {
  id: string;
  sponsor_id: string;
  recipient_email: string;
  status: string;
  created_at: Date;
  responded_at: Date | null;
  resend_count: number;
}): UplineInviteRecord {
  return {
    id: row.id,
    sponsor_id: row.sponsor_id,
    recipient_email: row.recipient_email,
    status: row.status as InviteStatus,
    created_at: row.created_at,
    responded_at: row.responded_at,
    resend_count: row.resend_count,
  };
}

export const GET = async (req: NextRequest) => {
  const inviteId = req.nextUrl.searchParams.get('invite_id');
  if (!inviteId) {
    return NextResponse.json({ error: '"invite_id" is required.' }, { status: 400 });
  }

  const row = await prisma.uplineInvite.findUnique({ where: { id: inviteId } });
  if (!row) {
    return NextResponse.json({ ok: false, code: 'NOT_FOUND', error: 'This invite could not be found.' }, { status: 404 });
  }

  let invite = toRecord(row);
  const now = new Date();

  // §6.6 "a daily job expires invites older than 7 days still in sent/pending" — this GET is not
  // that job, but it never presents a stale, past-window invite as live either: the same pure
  // `transitionInvite(..., EXPIRED, now)` guard the daily job itself uses decides eligibility.
  if (invite.status === InviteStatus.SENT || invite.status === InviteStatus.PENDING) {
    const expiry = transitionInvite(invite, InviteStatus.EXPIRED, now);
    if (expiry.ok) {
      await prisma.uplineInvite.update({ where: { id: invite.id }, data: { status: InviteStatus.EXPIRED } });
      invite = expiry.invite;
    }
  }

  if (invite.status === InviteStatus.EXPIRED) {
    return NextResponse.json(
      { ok: false, code: 'EXPIRED', error: 'This invite has expired.', expiryDays: INVITE_EXPIRY_DAYS },
      { status: 410 }
    );
  }
  if (invite.status === InviteStatus.REJECTED) {
    return NextResponse.json({ ok: false, code: 'REJECTED', error: 'This invite was declined.' }, { status: 410 });
  }

  // SENT → PENDING: "the recipient opens the one-time link" (§6.6). No extra guard condition on
  // this transition — a genuinely fresh invite always advances. Already-PENDING/ACCEPTED are
  // idempotent no-ops here (repeat visits to the same link never error).
  if (invite.status === InviteStatus.SENT) {
    const opened = transitionInvite(invite, InviteStatus.PENDING, now);
    if (opened.ok) {
      await prisma.uplineInvite.update({ where: { id: invite.id }, data: { status: InviteStatus.PENDING } });
      invite = opened.invite;
    }
  }

  const sponsor = await prisma.user.findUnique({
    where: { id: invite.sponsor_id },
    select: { name: true, org_type: true, role: true },
  });

  return NextResponse.json({
    ok: true,
    code: invite.status === InviteStatus.ACCEPTED ? 'ALREADY_ACCEPTED' : 'READY',
    invite: { id: invite.id, status: invite.status },
    sponsor: sponsor
      ? { name: sponsor.name, orgType: sponsor.org_type, role: sponsor.role }
      : { name: null, orgType: null, role: null },
  });
};
