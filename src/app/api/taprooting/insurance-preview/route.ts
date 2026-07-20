// WP08 §13.3/§5.5 — the licensing hard-block, proved end-to-end and reachable.
//
// This is the ONE route in this build unit whose entire purpose is to demonstrate/exercise the
// named critical-failure condition: "insurance-recommendation content reachable during the
// licensing phase." The Days 8-30 timeline panel's "Preview what an insurance recommendation will
// look like once you're licensed" affordance calls this — it is real content routed through the
// REAL CFE (never a second, parallel copy of the block), with the rep's REAL `LicensingService`
// state threaded into `UserContext.licensing_phase` / `insurance_licensed`. `classifier-rules.ts`'s
// existing `insurance_block_unlicensed_or_licensing_phase` rule is what actually fires — this route
// never decides the block itself, it only supplies the honest context and never bypasses the
// verdict.
//
// FAIL-CLOSED (§0.4 rule 1/2): no ANTHROPIC_API_KEY -> the CFE holds (never releases) -> this route
// still reports "blocked", never a silent stub and never an off-Claude fallback. Lazy, in-handler
// construction only.

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { ComplianceFilterEngine } from '@/services/compliance';
import { buildLicensingService, getInsuranceContentGateContext } from '@/services/taprooting/timeline.service';

export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate(async (req, _ctx, session, identity) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const { content } = (body ?? {}) as { content?: unknown };
  const previewContent =
    typeof content === 'string' && content.trim().length > 0
      ? content
      : 'Based on your situation, you should get a whole life policy — this coverage is the right fit for your family.';

  const licensingService = buildLicensingService();
  const gateContext = await getInsuranceContentGateContext(identity.userId, licensingService);

  const cfe = new ComplianceFilterEngine();
  const verdict = await cfe.evaluateContent({
    content: previewContent,
    channel: 'SMS',
    userContext: {
      user_id: identity.userId,
      role: session.user.role,
      regulations: ['STATE_INSURANCE'],
      licensing_phase: gateContext.licensing_phase,
      insurance_licensed: gateContext.insurance_licensed,
    },
  });

  return NextResponse.json({
    licensingState: gateContext.licensingState,
    hardBlockActive: gateContext.licensing_phase,
    released: verdict.released,
    band: verdict.band,
    held: verdict.held,
    reason: verdict.reason,
  });
});
