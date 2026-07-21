// T-R29 (compliance-reachability build, master-spec §16.3/§9.3/§4.6 "GDPR deletion timeline" +
// §5.7 "24-hour cooling-off period for deletion confirmation").
//
// `GET` — the caller's OWN latest deletion request (own-data-only by construction: `findFirst`
// is scoped to `session.user.id`, never a client-supplied id, so there is no id-based lookup here
// for a forged identity to exploit). Lets the `/me/data-rights` page rehydrate cooling-off/status
// state on reload without spawning a duplicate request. `read` is a separate §16.6 matrix action
// from `export`/`delete` and is NOT one of `mfa.ts`'s five step-up `SensitiveAction`s — viewing
// your own request status is not itself destructive, so no step-up gate here.
//
// `POST` — creates a deletion request (`DataRightsService.requestDeletion`, T-11, UNMODIFIED).
// Idempotent by construction: if the caller already has a PENDING or HELD request, THAT record is
// returned rather than creating a duplicate — deletion is destructive enough that this route
// deliberately avoids letting a re-click (or a retried request) spawn N cooling-off clocks. This
// route only ever CREATES the request; the destructive scrub itself happens in
// `POST /api/data-rights/deletion/confirm` (see that route), which is where the explicit-
// confirmation + cooling-off gates live.
//
// SESSION-scoped / own-data-only / forged-header-inert: identity is `session.user.id` only (via
// `withCapability`/`withStepUp`, both backed by the verified Auth.js session) — no `x-user-id` (or
// any other client-supplied identity) is ever read.

import { NextResponse } from 'next/server';

import { withCapability, withStepUp } from '@/lib/auth/with-role';
import { prisma } from '@/lib/prisma';
import { buildProductionDataRightsService } from '@/services/compliance/data-rights';
import type { UserDataDeletionRecord } from '@/types/data-rights';

export const dynamic = 'force-dynamic';

function toRecord(row: {
  id: string;
  user_id: string;
  status: string;
  anonymized_fields: string[];
  retained_fields: string[];
  deletion_certificate_url: string | null;
  requested_at: Date;
  completed_at: Date | null;
}): UserDataDeletionRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    status: row.status as UserDataDeletionRecord['status'],
    anonymized_fields: row.anonymized_fields,
    retained_fields: row.retained_fields,
    deletion_certificate_url: row.deletion_certificate_url,
    requested_at: row.requested_at.toISOString(),
    completed_at: row.completed_at ? row.completed_at.toISOString() : null,
  };
}

export const GET = withCapability('data_rights', 'read', async (_req, _ctx, session) => {
  const existing = await prisma.userDataDeletion.findFirst({
    where: { user_id: session.user.id },
    orderBy: { requested_at: 'desc' },
  });
  return NextResponse.json({ deletion: existing ? toRecord(existing) : null });
});

export const POST = withCapability(
  'data_rights',
  'delete',
  withStepUp('data_delete', async (_req, _ctx, session) => {
    // Idempotency guard (§9.3's cooling-off flow assumes exactly one live request at a time) — an
    // existing PENDING/HELD request is returned as-is rather than spawning a duplicate.
    const existing = await prisma.userDataDeletion.findFirst({
      where: { user_id: session.user.id, status: { in: ['PENDING', 'HELD'] } },
      orderBy: { requested_at: 'desc' },
    });
    if (existing) {
      return NextResponse.json({ deletion: toRecord(existing), alreadyRequested: true }, { status: 200 });
    }

    const service = buildProductionDataRightsService(prisma);
    const record = await service.requestDeletion({
      user_id: session.user.id,
      requested_by: session.user.id,
    });
    return NextResponse.json({ deletion: record, alreadyRequested: false }, { status: 201 });
  })
);
