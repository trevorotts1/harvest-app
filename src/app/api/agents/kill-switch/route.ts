import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Role } from '@prisma/client';

// T-31 (§4.5/§4.6) — the kill-switch toggle route. Session-gated via `withRole` (the caller's
// identity + role come from the VERIFIED Auth.js session, never a client-forged `x-user-id` /
// `x-organization-id` header — this file reads no such header, so a forged identity/org header is
// inert by construction). Ownership-checked per scope below: REP always affects the CALLER's own
// session identity; ORG requires an upline-class role AND the caller's own `organizationId` (never
// a client-supplied org unless ADMIN); PLATFORM requires ADMIN.
import { withRole } from '@/lib/auth/with-role';
import { PrismaBudgetKillSwitchStore } from '@/services/agent-runtime/cost-killswitch';
import type { KillSwitchScope } from '@/services/agent-runtime/cost-killswitch';

export const dynamic = 'force-dynamic';

const UPLINE_CLASS_ROLES: readonly Role[] = [Role.UPLINE, Role.RVP, Role.ADMIN, Role.DUAL];

interface ToggleBody {
  scope?: string;
  scopeId?: string;
  tripped?: boolean;
  reason?: string;
}

function isValidScope(v: unknown): v is KillSwitchScope {
  return v === 'PLATFORM' || v === 'ORG' || v === 'REP';
}

// ── POST /api/agents/kill-switch ──────────────────────────────────────────────────────────────
// Trip or clear a kill switch. Every role may reach this route (a rep must be able to pause their
// own agents); the scope-specific authorization below is what actually gates each action.
export const POST = withRole(
  [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN, Role.DUAL],
  async (req: NextRequest, _ctx, session) => {
    let body: ToggleBody;
    try {
      body = (await req.json()) as ToggleBody;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    if (!isValidScope(body.scope)) {
      return NextResponse.json({ error: "\"scope\" must be one of: PLATFORM, ORG, REP." }, { status: 400 });
    }
    if (typeof body.tripped !== 'boolean') {
      return NextResponse.json({ error: '"tripped" (boolean) is required.' }, { status: 400 });
    }

    const scope = body.scope;
    const actorId = session.user.id;
    const actorRole = session.user.role;

    let scopeId: string;
    if (scope === 'REP') {
      // Never trust a client-supplied scopeId for REP — a rep can only ever toggle their OWN
      // agents. If an upline-class caller wants a downline-pause tool, that is a different,
      // narrower feature than this kill-switch (per-contact `agents_paused` already covers
      // per-contact pause, §9.4) — not added here to stay in-lane.
      scopeId = actorId;
    } else if (scope === 'ORG') {
      if (!UPLINE_CLASS_ROLES.includes(actorRole)) {
        return NextResponse.json({ error: 'Only upline/RVP/admin roles may toggle an org-level kill switch.' }, { status: 403 });
      }
      const callerOrgId = session.user.organizationId;
      // ADMIN may target any org (matches the platform-wide admin-bypass convention elsewhere in
      // RBAC, rbac.ts's `adminBypass`); everyone else may ONLY target their own org — a forged
      // `scopeId` naming a different org is rejected, never trusted.
      if (actorRole === Role.ADMIN && body.scopeId) {
        scopeId = body.scopeId;
      } else {
        if (!callerOrgId) {
          return NextResponse.json({ error: 'Your session has no organization to toggle.' }, { status: 403 });
        }
        if (body.scopeId && body.scopeId !== callerOrgId) {
          return NextResponse.json({ error: 'You may only toggle your own organization\'s kill switch.' }, { status: 403 });
        }
        scopeId = callerOrgId;
      }
    } else {
      // PLATFORM
      if (actorRole !== Role.ADMIN) {
        return NextResponse.json({ error: 'Only an admin may toggle the platform-wide kill switch.' }, { status: 403 });
      }
      scopeId = 'GLOBAL';
    }

    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null;
    const store = new PrismaBudgetKillSwitchStore(); // lazy, per-request — no key/connection at module scope
    await store.setKillSwitchState(scope, scopeId, body.tripped, reason, actorId);

    return NextResponse.json({ scope, scopeId, tripped: body.tripped, reason });
  }
);

// ── GET /api/agents/kill-switch ────────────────────────────────────────────────────────────────
// Returns the kill-switch states visible to this caller: their own REP state always, their ORG
// state if they belong to one, and the PLATFORM state if they are an admin.
export const GET = withRole(
  [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN, Role.DUAL],
  async (_req: NextRequest, _ctx, session) => {
    const store = new PrismaBudgetKillSwitchStore();
    const [rep, org, platform] = await Promise.all([
      store.getKillSwitchState('REP', session.user.id),
      session.user.organizationId ? store.getKillSwitchState('ORG', session.user.organizationId) : Promise.resolve(null),
      session.user.role === Role.ADMIN ? store.getKillSwitchState('PLATFORM', 'GLOBAL') : Promise.resolve(null),
    ]);

    return NextResponse.json({
      rep: rep ?? { tripped: false, reason: null },
      org: session.user.organizationId ? org ?? { tripped: false, reason: null } : null,
      platform: session.user.role === Role.ADMIN ? platform ?? { tripped: false, reason: null } : null,
    });
  }
);
