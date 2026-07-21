// WP08 §13.5/§18.7 — the org-type switch route. `org_switch` was already reserved as a step-up-MFA
// `SensitiveAction` by WP01/WP11 (src/lib/auth/mfa.ts §16.4) but nothing exercised it before this
// unit — this is the real, reachable route.
//
// Step-up MFA required (§16.4/§18.10 "step-up MFA gates ... org switch"): the client must first
// clear a fresh challenge via `POST /api/auth/mfa/step-up` (and call `useSession().update(...)`)
// before this route accepts the switch — `withStepUp` enforces that, composed under `withRole` for
// the baseline authenticated-session check, mirroring every other sensitive-action route in this
// codebase (mfa/step-up itself, session/revoke-all).
//
// NOTE ON SESSION FRESHNESS: this route does not touch the JWT/session's `orgType` claim. Every
// taprooting/timeline read (getOrgTreeView / getPhasedTimeline) re-reads `User.org_type` from the
// database on EVERY call — never the session claim — so the org-gate decision is correct on the
// very next request regardless of whether the client's session has refreshed yet (§17.1 "the gate
// is enforced at the API/data layer, not merely hidden in the UI").

import { OrgType, Role } from '@prisma/client';
import { NextResponse } from 'next/server';

import { withRole, withStepUp } from '@/lib/auth/with-role';
import { switchOrgType } from '@/services/taprooting/org-switch.service';

const ANY_AUTHENTICATED_ROLE = Object.values(Role);

function isOrgType(value: unknown): value is OrgType {
  return value === OrgType.PRIMERICA || value === OrgType.EXTERNAL;
}

export const POST = withRole(
  ANY_AUTHENTICATED_ROLE,
  withStepUp('org_switch', async (req, _ctx, session) => {
    const body = await req.json().catch(() => null);
    const toOrgType = (body as { toOrgType?: unknown } | null)?.toOrgType;
    if (!isOrgType(toOrgType)) {
      return NextResponse.json(
        { error: '"toOrgType" must be PRIMERICA or EXTERNAL.', code: 'ORG_TYPE_INVALID' },
        { status: 400 }
      );
    }

    const outcome = await switchOrgType(session.user.id, toOrgType);
    if (!outcome.ok) {
      const status = outcome.reason === 'not_found' ? 404 : 400;
      // T-57 RE-GATE B [af7789d3] Finding 1 — `outcome.reason` was ITSELF a bare machine token
      // ("not_found"/"same_org_type") being handed to the client as `error` — not even English
      // prose, just an untranslated code rendered verbatim. Now surfaced via an explicit `code` the
      // client resolves through the `errors.*` catalog instead.
      const code = outcome.reason === 'not_found' ? 'NOT_FOUND' : 'SAME_ORG_TYPE';
      return NextResponse.json({ error: outcome.reason, code }, { status });
    }
    return NextResponse.json(outcome);
  })
);
