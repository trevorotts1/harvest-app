// WP04 (T-32) — POST /api/mission-control/queue-action: act on a Today Action Queue item.
//
// Session-gated (`withOnboardingGate`, never `x-user-id`). Ownership is enforced inside
// `actOnQueueDraft`/`confirmAppointment` — both re-check the row belongs to the SESSION user before
// any write, never trusting the request body's id alone. Uses the same `DraftMessage.approval_state`
// / `Appointment.status` vocabulary T-33 (Approval Inbox) will also drive — see today.service.ts.

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { actOnQueueDraft, confirmAppointment } from '@/services/mission-control/today.service';

export const dynamic = 'force-dynamic';

interface QueueActionBody {
  kind?: 'draft' | 'appointment';
  id?: string;
  action?: 'approve' | 'decline';
}

// T-57 RE-GATE B [af7789d3] Finding 1 residual (RGb2) — a stable machine `code` alongside every
// `error` (kept for logs/back-compat only), so `src/app/today/offline.ts`'s replay handlers can
// resolve a localized DISPLAY string via `errorDisplay` instead of rendering this raw English prose
// (mirrors the approval-inbox approve/decline/edit routes' identical RG-fix-B pattern). Code-only —
// no status/auth/validation change.
export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: QueueActionBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.', code: 'INVALID_JSON' }, { status: 400 });
  }

  if (!body.id || typeof body.id !== 'string') {
    return NextResponse.json({ error: '"id" is required.', code: 'ID_REQUIRED' }, { status: 400 });
  }

  if (body.kind === 'appointment') {
    const result = await confirmAppointment(identity.userId, body.id);
    if (!result.ok) {
      const code = result.reason === 'not_found' ? 'APPOINTMENT_NOT_FOUND' : 'APPOINTMENT_INVALID_STATE';
      return NextResponse.json(
        { error: `Appointment ${result.reason.replace('_', ' ')}.`, code },
        { status: result.reason === 'not_found' ? 404 : 409 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  if (body.kind === 'draft') {
    if (body.action !== 'approve' && body.action !== 'decline') {
      return NextResponse.json({ error: '"action" must be "approve" or "decline".', code: 'QUEUE_ACTION_INVALID' }, { status: 400 });
    }
    const result = await actOnQueueDraft(identity.userId, body.id, body.action);
    if (!result.ok) {
      const code =
        result.reason === 'not_found'
          ? 'DRAFT_NOT_FOUND'
          : result.reason === 'invalid_state'
            ? 'QUEUE_DRAFT_INVALID_STATE'
            : 'QUEUE_DRAFT_REQUIRES_REVIEW';
      return NextResponse.json(
        { error: `Draft ${result.reason.replace('_', ' ')}.`, code },
        { status: result.reason === 'not_found' ? 404 : 409 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: '"kind" must be "draft" or "appointment".', code: 'QUEUE_KIND_INVALID' }, { status: 400 });
});
