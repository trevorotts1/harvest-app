import { NextResponse } from 'next/server';

import { OrgType } from '@prisma/client';

import { prisma } from '@/lib/prisma';
// T-24 §6.10-1: same real-session pattern as /api/contacts/import — resolved from the VERIFIED
// Auth.js session via `withOnboardingGate`, never a client-forged header.
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { assertNoPrimericaLeak } from '@/services/onboarding/wp01/org-gate';
import { computeHiddenEarnings, renderHiddenEarningsPayload } from '@/services/warm-market/hidden-earnings';

// Per-request: reads the live session + a live DB row, so it must not be statically prerendered.
export const dynamic = 'force-dynamic';

// ── GET /api/contacts/hidden-earnings ────────────────────────────────
// The T-24 Hidden Earnings render endpoint (§7.3/§8.4). Reads the caller's OWN live Vault count and
// org context (never a client-supplied count/orgType — both are read server-side so a client cannot
// forge either the growth-path threshold or the Primerica calibration), computes the figure through
// the one Hidden Earnings engine, and returns a payload that ALWAYS carries `safeHarborLine` (the
// engine's own `renderHiddenEarningsPayload` refuses — throws — to emit one that doesn't).
//
// §17.1 defense-in-depth: `assertNoPrimericaLeak` re-scans the assembled payload immediately before
// it crosses the API boundary for a non-Primerica caller. It is structurally a no-op for a Primerica
// user and cannot itself introduce a leak; for a universal user it throws (→ 500, never a silent
// strip) if the payload ever contained a Primerica-gated term, which — given `computeHiddenEarnings`
// only ever selects the Primerica branch when `org_type = primerica` — should never fire in practice,
// but is the same "catch it at the data layer, not just the branch" belt-and-suspenders the org-gate
// module itself recommends for anything crossing the wire.
export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  const userId = identity.userId;

  const [user, contactCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { org_type: true, solution_number: true },
    }),
    prisma.contact.count({ where: { user_id: userId } }),
  ]);

  // Fail-closed default: a missing/deleted user row never falls back to Primerica.
  const orgType = user?.org_type ?? OrgType.EXTERNAL;
  // §8.4: presence of an encrypted `solution_number` implies it already passed the org-gated
  // format check at write time (see solution-number.ts / the register route) — never re-decrypted
  // or re-validated here, and the raw digits never appear in this route at all.
  const hasValidSolutionNumber = Boolean(user?.solution_number);

  const result = computeHiddenEarnings({ contactCount, orgType, hasValidSolutionNumber });
  const payload = renderHiddenEarningsPayload(result);

  assertNoPrimericaLeak(payload, orgType);

  return NextResponse.json(payload);
});
