// WP08 §13.3 — GET the phased timeline (activity-gated, not calendar-gated); POST records a
// rep's self-attestation for one genuinely third-party-only checklist item (phase-timeline.ts's
// module doc explains why a handful of §13.3 bullets are honestly attested, not auto-detected).
//
// Session-gated via `withOnboardingGate`; the licensing state is read from the REAL WP11
// `LicensingService` (never a second, drifting copy of the licensing rule) — lazy construction
// inside the handler only (§0.4 rule 2).

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { buildLicensingService, getPhasedTimeline, markChecklistItemAttested } from '@/services/taprooting/timeline.service';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  const licensingService = buildLicensingService();
  const result = await getPhasedTimeline(identity.userId, licensingService);
  return NextResponse.json(result);
});

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { phase, itemKey } = (body ?? {}) as { phase?: unknown; itemKey?: unknown };
  if ((phase !== 'launch' && phase !== 'licensing') || typeof itemKey !== 'string' || itemKey.length === 0) {
    return NextResponse.json({ error: '"phase" (launch|licensing) and "itemKey" are required.' }, { status: 400 });
  }

  const outcome = await markChecklistItemAttested(identity.userId, phase, itemKey);
  if (!outcome.ok) {
    const status = outcome.reason === 'unknown_item' ? 404 : 400;
    return NextResponse.json({ error: outcome.reason }, { status });
  }
  return NextResponse.json({ ok: true });
});
