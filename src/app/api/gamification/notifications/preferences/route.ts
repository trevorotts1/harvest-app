// T-43 (WP07 §12.6) — GET/PATCH /api/gamification/notifications/preferences: the rep's own
// non-critical notification timing/frequency controls. Action Alerts/Milestone/Billing-security are
// deliberately absent from this surface — they are unmutable by design (§12.9-6), so there is
// nothing here for the rep to configure for them.

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { prisma } from '@/lib/prisma';
import { getOrCreatePreferences, updatePreferences, type MutablePreferencePatch } from '@/services/gamification/notification.service';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  const prefs = await getOrCreatePreferences(prisma as never, identity.userId);
  return NextResponse.json(prefs);
});

const MUTABLE_KEYS: (keyof MutablePreferencePatch)[] = [
  'morning_briefing_enabled',
  'morning_briefing_time',
  'midday_motivation_enabled',
  'evening_recap_enabled',
  'quiet_hours_start',
  'quiet_hours_end',
  'timezone',
];

export const PATCH = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const patch: MutablePreferencePatch = {};
  for (const key of MUTABLE_KEYS) {
    if (key in body) (patch as Record<string, unknown>)[key] = body[key];
  }
  const updated = await updatePreferences(prisma as never, identity.userId, patch);
  return NextResponse.json(updated);
});
