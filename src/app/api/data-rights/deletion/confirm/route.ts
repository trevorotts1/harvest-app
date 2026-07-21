// T-R29 (compliance-reachability build, master-spec §9.3 "24-hour confirmation cooling-off
// period" + §5.7 "24-hour cooling-off period for deletion confirmation" + §16.3).
//
// `POST /api/data-rights/deletion/confirm` is the ONLY route that actually invokes
// `DataRightsService.processDeletion` (T-11's destructive PII scrub, UNMODIFIED) — reachable only
// after ALL of the following, in order:
//
//   1. Real, verified session + role capability (`withCapability('data_rights', 'delete', ...)`)
//      and a FRESH step-up MFA challenge (`withStepUp('data_delete', ...)`) — §16.4/row-8 of the
//      §16.6 matrix.
//   2. Explicit confirmation: the request body must contain `confirm: true` — a missing/falsy/
//      non-boolean value is rejected 400. This is "require explicit confirmation" for a
//      destructive action, deliberately a distinct signal from merely POSTing to this URL (a CSRF-
//      style same-origin POST with no body, or a retried/duplicated earlier request, must never be
//      mistaken for the data subject's affirmative choice).
//   3. OWNERSHIP — own-data-only, cross-user -> 404-not-leak: `processDeletion` takes only a
//      `deletion_id`, with no caller-identity parameter of its own, so this route reads the
//      `UserDataDeletion` row itself FIRST and 404s (identically for "does not exist" and "belongs
//      to someone else") before ever calling the service — same convention as the sibling export
//      download route and `/api/contacts/[contactId]/conversation`.
//   4. Not already processed: a HELD/COMPLETED/FAILED request is rejected 409 rather than silently
//      re-running the scrub against an already-anonymized account.
//   5. The 24-hour cooling-off clock, measured from `UserDataDeletion.requested_at` (written by
//      `POST /api/data-rights/deletion`) — a confirm attempt before that window elapses is rejected
//      409 with the exact `readyAt` timestamp, never processed early.
//
// SESSION-scoped / forged-header-inert: identity is `session.user.id` only, via the verified
// session — no `x-user-id` (or any other client-supplied identity) is ever read.

import { NextResponse } from 'next/server';

import { withCapability, withStepUp } from '@/lib/auth/with-role';
import { prisma } from '@/lib/prisma';
import { buildProductionDataRightsService } from '@/services/compliance/data-rights';
import { DELETION_CONFIRMATION_COOLING_OFF_HOURS } from '@/types/data-rights';

export const dynamic = 'force-dynamic';

const COOLING_OFF_MS = DELETION_CONFIRMATION_COOLING_OFF_HOURS * 60 * 60 * 1000;

interface ConfirmBody {
  deletion_id?: unknown;
  confirm?: unknown;
}

export const POST = withCapability(
  'data_rights',
  'delete',
  withStepUp('data_delete', async (req, _ctx, session) => {
    const body = ((await req.json().catch(() => null)) ?? {}) as ConfirmBody;
    const deletionId = body.deletion_id;
    if (!deletionId || typeof deletionId !== 'string') {
      return NextResponse.json({ error: '"deletion_id" is required.', code: 'DELETION_ID_REQUIRED' }, { status: 400 });
    }
    if (body.confirm !== true) {
      return NextResponse.json(
        {
          error: 'Explicit confirmation is required — set "confirm": true to permanently delete your data.',
          code: 'CONFIRMATION_REQUIRED',
        },
        { status: 400 }
      );
    }

    // Ownership FIRST — `processDeletion` below has no caller-identity parameter of its own.
    const existing = await prisma.userDataDeletion.findUnique({ where: { id: deletionId } });
    if (!existing || existing.user_id !== session.user.id) {
      // Never distinguish "does not exist" from "belongs to a different rep" — both 404 identically.
      return NextResponse.json({ error: 'Deletion request not found.', code: 'DELETION_NOT_FOUND' }, { status: 404 });
    }

    if (existing.status !== 'PENDING') {
      return NextResponse.json(
        {
          error: `This deletion request is already ${existing.status.toLowerCase()} and cannot be re-confirmed.`,
          code: 'ALREADY_PROCESSED',
          status: existing.status,
        },
        { status: 409 }
      );
    }

    const elapsedMs = Date.now() - existing.requested_at.getTime();
    if (elapsedMs < COOLING_OFF_MS) {
      const readyAt = new Date(existing.requested_at.getTime() + COOLING_OFF_MS).toISOString();
      return NextResponse.json(
        {
          error: `Deletion requires a ${DELETION_CONFIRMATION_COOLING_OFF_HOURS}-hour cooling-off period before it can be confirmed.`,
          code: 'TOO_EARLY',
          readyAt,
        },
        { status: 409 }
      );
    }

    const service = buildProductionDataRightsService(prisma);
    const { record, certificate } = await service.processDeletion(deletionId, session.user.id);
    return NextResponse.json({ deletion: record, certificate });
  })
);
