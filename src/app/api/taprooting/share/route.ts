// WP08 §13.1/§13.6-7, uiux AC-5.5-5 — the org-tree time-lapse SHARE export. POST the join-order
// event sequence (structure/growth only — see `share-gate.ts`'s doc for why no dollar figure is
// ever part of this payload); the route builds the export summary and routes it through the REAL
// CFE before returning it — a `held`/`blocked` verdict means the export never leaves this response
// at all (the client never receives an `exportSummary` to share). Lazy, in-handler construction.

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { ComplianceFilterEngine } from '@/services/compliance';
import { evaluateTimeLapseShare } from '@/services/taprooting/share-gate';
import type { TimeLapseShareRequest } from '@/types/taprooting';

export const dynamic = 'force-dynamic';

function isValidRequest(body: unknown): body is TimeLapseShareRequest {
  if (!body || typeof body !== 'object') return false;
  const events = (body as { events?: unknown }).events;
  if (!Array.isArray(events)) return false;
  return events.every(
    (e) =>
      e &&
      typeof e === 'object' &&
      typeof (e as { level?: unknown }).level === 'number' &&
      typeof (e as { displayName?: unknown }).displayName === 'string' &&
      typeof (e as { joinedAt?: unknown }).joinedAt === 'string'
  );
}

export const POST = withOnboardingGate(async (req, _ctx, session, identity) => {
  const body = await req.json().catch(() => null);
  if (!isValidRequest(body)) {
    return NextResponse.json({ error: '"events" must be an array of { level, displayName, joinedAt }.' }, { status: 400 });
  }

  const cfe = new ComplianceFilterEngine();
  const outcome = await evaluateTimeLapseShare(body, cfe, {
    user_id: identity.userId,
    role: session.user.role,
  });

  if (!outcome.allowed) {
    return NextResponse.json({ allowed: false, reason: outcome.reason, detail: outcome.detail }, { status: 403 });
  }
  return NextResponse.json({ allowed: true, exportSummary: outcome.exportSummary });
});
