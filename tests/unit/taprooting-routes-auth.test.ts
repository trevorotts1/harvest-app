// T-R24 (test-coverage hardening from the WP08 gate, T-50 — "5 routes lack route-level auth
// tests; code is correct, just un-netted"). Mirrors billing-routes-auth.test.ts's module-boundary-
// mocking pattern: `getCurrentSession` + `prisma` are mocked so the REAL `withOnboardingGate`-
// wrapped route handlers run, with a forged `x-user-id` header attached to prove identity comes
// ONLY from the session — never a header, never a client-supplied id.
//
// Covers all 5 `/api/taprooting/*` routes (tree, insurance-preview, timeline GET+POST, share) +
// `/api/settings/org-switch` (WP08 §13.5's step-up-MFA-gated org-type switch, reserved by
// WP01/WP11 but never route-exercised before this unit). `getOrgTreeView` itself is already
// service-level tested end-to-end (taprooting-service.test.ts) — the `tree` route section here
// re-proves the SAME RBAC/org-scoping properties, but through the real HTTP route wiring
// (`withOnboardingGate` + the forged-header vector), which is exactly the layer none of the
// existing suite touched.
//
// NOTE on jest.mock hoisting: every `jest.mock(...)` call is at MODULE top level (never nested
// inside a `describe`) — babel-plugin-jest-hoist hoists them above the imports regardless of where
// they're written, so two calls targeting the same module path in one file would silently collide
// (last-write-wins); consolidating each mocked module to exactly one `jest.mock` call here avoids
// that trap entirely.

import { OnboardingStatus, OrgType, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

// Best-effort milestone detection runs on every OWN-tree read (tree/route.ts) — mock it to a no-op
// so this suite stays a pure auth/RBAC/org-scoping test, not a milestone-detection test (that unit
// is proven elsewhere, taprooting-milestone-detection.test.ts).
jest.mock('@/services/taprooting/milestone-detection.service', () => ({
  runMilestoneDetection: jest.fn().mockResolvedValue(undefined),
}));

// Shared by tree/insurance-preview/timeline routes (all three import from this one module).
jest.mock('@/services/taprooting/timeline.service', () => ({
  buildLicensingService: jest.fn(() => 'licensing-service-stub'),
  getInsuranceContentGateContext: jest.fn(),
  getPhasedTimeline: jest.fn(),
  markChecklistItemAttested: jest.fn(),
}));

jest.mock('@/services/taprooting/share-gate', () => ({ evaluateTimeLapseShare: jest.fn() }));
jest.mock('@/services/compliance', () => ({
  ComplianceFilterEngine: jest.fn().mockImplementation(() => ({
    evaluateContent: jest.fn().mockResolvedValue({
      band: 'clear', score: 0, classifierResults: [], held: false, released: true, reason: 'clean',
      heldReason: null, safeHarbor: { injected: false, disclaimers: [] }, httpStatus: 200, ruleVersion: 't', auditEvent: {},
    }),
  })),
}));
jest.mock('@/services/taprooting/org-switch.service', () => ({ switchOrgType: jest.fn() }));

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { buildLicensingService, getInsuranceContentGateContext, getPhasedTimeline, markChecklistItemAttested } from '@/services/taprooting/timeline.service';
import { evaluateTimeLapseShare } from '@/services/taprooting/share-gate';
import { switchOrgType } from '@/services/taprooting/org-switch.service';
import { GET as treeGET } from '@/app/api/taprooting/tree/route';
import { POST as insurancePreviewPOST } from '@/app/api/taprooting/insurance-preview/route';
import { GET as timelineGET, POST as timelinePOST } from '@/app/api/taprooting/timeline/route';
import { POST as sharePOST } from '@/app/api/taprooting/share/route';
import { POST as orgSwitchPOST } from '@/app/api/settings/org-switch/route';

const mockGetSession = getCurrentSession as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const mockBuildLicensingService = buildLicensingService as jest.Mock;
const mockGetInsuranceContentGateContext = getInsuranceContentGateContext as jest.Mock;
const mockGetPhasedTimeline = getPhasedTimeline as jest.Mock;
const mockMarkChecklistItemAttested = markChecklistItemAttested as jest.Mock;
const mockEvaluateTimeLapseShare = evaluateTimeLapseShare as jest.Mock;
const mockSwitchOrgType = switchOrgType as jest.Mock;

const FORGED = { 'x-user-id': 'victim-999' };

function session(overrides: Partial<Session['user']> = {}): Session {
  return {
    expires: '2999-01-01',
    user: {
      id: 'rep-1',
      role: Role.REP,
      orgType: OrgType.PRIMERICA,
      organizationId: 'orgA',
      accessTier: 'FREE_PAID_EXTERNAL',
      onboardingStatus: OnboardingStatus.GATED_COMPLETE,
      mfaEnrolled: false,
      mfaVerifiedAt: null,
      deviceFingerprintHash: 'fp',
      securityVersionAtIssue: 0,
      boundAt: Date.now(),
      ...overrides,
    },
  } as unknown as Session;
}

/** The onboarding gate reads `user.findUnique` for onboarding state ONLY — prime it as
 *  gated-complete so every route's real handler body actually runs. */
function primeGateComplete() {
  db.user = {
    findUnique: jest.fn().mockResolvedValue({ onboarding_status: OnboardingStatus.GATED_COMPLETE, onboarding_sessions: [] }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  primeGateComplete();
  mockBuildLicensingService.mockReturnValue('licensing-service-stub');
});

// ─── GET /api/taprooting/tree — RBAC + org-scoping via real getOrgTreeView (no service mock) ─────

describe('GET /api/taprooting/tree', () => {
  interface Seed {
    users: { id: string; name: string; rank: string | null; org_type: OrgType }[];
    edges: { id: string; sponsor_id: string; recruit_id: string }[];
  }

  /** Wires the SAME fake-db shape taprooting-service.test.ts uses directly onto the mocked
   *  `@/lib/prisma` module, since `getOrgTreeView` is called by the route with NO db argument (it
   *  defaults to the real `prisma` singleton) — this is what makes the test exercise the actual
   *  route -> service wiring, not a bypassed mock. `user.findUnique` is overwritten from
   *  `primeGateComplete`'s stub with one that ALSO serves the gate's own onboarding read (both
   *  reads share the same mocked function; the gate's select always includes `onboarding_status`,
   *  which the seed rows never carry, so branching on the `select` shape is unambiguous). */
  function seedTreeDb(seed: Seed) {
    db.user = {
      findUnique: jest.fn(async ({ where, select }: { where: { id: string }; select?: Record<string, unknown> }) => {
        if (select && 'onboarding_status' in select) {
          return { onboarding_status: OnboardingStatus.GATED_COMPLETE, onboarding_sessions: [] };
        }
        return seed.users.find((u) => u.id === where.id) ?? null;
      }),
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => seed.users.filter((u) => where.id.in.includes(u.id))),
    };
    db.orgTreeEdge = {
      findMany: jest.fn(async ({ where }: { where: { sponsor_id: { in: string[] } } }) => seed.edges.filter((e) => where.sponsor_id.in.includes(e.sponsor_id))),
      update: jest.fn(async () => ({})),
    };
    db.momentumEvent = { findMany: jest.fn(async () => []) };
  }

  function seed(): Seed {
    return {
      users: [
        { id: 'upline-1', name: 'Upline One', rank: 'RVP', org_type: OrgType.PRIMERICA },
        { id: 'rep-A', name: 'Rep A', rank: null, org_type: OrgType.PRIMERICA }, // upline-1's direct downline
        { id: 'rep-B', name: 'Rep B', rank: null, org_type: OrgType.PRIMERICA }, // NOT reachable from upline-1 (different branch of the org / a different org entirely)
      ],
      edges: [{ id: 'e1', sponsor_id: 'upline-1', recruit_id: 'rep-A' }],
    };
  }

  test('401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await treeGET(new NextRequest('http://localhost/api/taprooting/tree', { headers: FORGED }), {});
    expect(res.status).toBe(401);
  });

  test('own tree (no repId): 200, identity comes from the SESSION, never the forged x-user-id header', async () => {
    seedTreeDb(seed());
    mockGetSession.mockResolvedValue(session({ id: 'rep-A' }));

    const res = await treeGET(new NextRequest('http://localhost/api/taprooting/tree', { headers: FORGED }), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    // rep-A's own tree is empty (no downline) — but critically, this succeeded as rep-A's OWN read,
    // never as a read of 'victim-999' (which does not exist in the seed at all and would 404).
    expect(body.ownerDisplayName).toBe('Rep A.'); // toDisplayName: first name + last-initial
  });

  test('RBAC (§13.5 downline_visibility): a REP cannot view via ?repId= even for a reachable target — 404, never 403', async () => {
    // Give rep-A a downline of their own so reachability alone would not explain a 404 — the
    // capability check must be what's doing the denying.
    const s = seed();
    s.edges.push({ id: 'e2', sponsor_id: 'rep-A', recruit_id: 'rep-B' });
    seedTreeDb(s);
    mockGetSession.mockResolvedValue(session({ id: 'rep-A', role: Role.REP }));

    const res = await treeGET(new NextRequest('http://localhost/api/taprooting/tree?repId=rep-B'), {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Org tree not found');
  });

  test('org/reachability-scoping: an UPLINE requesting a NON-downline (cross-org) target -> 404, never 403 (no existence leak)', async () => {
    seedTreeDb(seed()); // rep-B is not reachable from upline-1
    mockGetSession.mockResolvedValue(session({ id: 'upline-1', role: Role.UPLINE }));

    const res = await treeGET(new NextRequest('http://localhost/api/taprooting/tree?repId=rep-B'), {});
    expect(res.status).toBe(404);
  });

  test('org/reachability-scoping: an UPLINE requesting their OWN reachable downline -> 200', async () => {
    seedTreeDb(seed());
    mockGetSession.mockResolvedValue(session({ id: 'upline-1', role: Role.UPLINE }));

    const res = await treeGET(new NextRequest('http://localhost/api/taprooting/tree?repId=rep-A'), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.viewScope).toBe('downline_structure_only');
  });

  test('a nonexistent target also resolves 404 — indistinguishable from "not yours to see"', async () => {
    seedTreeDb(seed());
    mockGetSession.mockResolvedValue(session({ id: 'upline-1', role: Role.UPLINE }));

    const res = await treeGET(new NextRequest('http://localhost/api/taprooting/tree?repId=ghost'), {});
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/taprooting/insurance-preview — session-scoped identity only (no target-id surface) ─

describe('POST /api/taprooting/insurance-preview', () => {
  beforeEach(() => {
    mockGetInsuranceContentGateContext.mockResolvedValue({
      licensingState: 'launch', licensing_phase: true, insurance_licensed: false,
    });
  });

  test('401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await insurancePreviewPOST(
      new NextRequest('http://localhost/api/taprooting/insurance-preview', { method: 'POST', body: '{}', headers: FORGED }),
      {}
    );
    expect(res.status).toBe(401);
  });

  test('identity comes from the SESSION, never the forged x-user-id header — the licensing gate context is fetched for the real caller', async () => {
    mockGetSession.mockResolvedValue(session({ id: 'rep-real' }));
    const res = await insurancePreviewPOST(
      new NextRequest('http://localhost/api/taprooting/insurance-preview', { method: 'POST', body: '{}', headers: FORGED }),
      {}
    );
    expect(res.status).toBe(200);
    expect(mockGetInsuranceContentGateContext).toHaveBeenCalledWith('rep-real', 'licensing-service-stub');
    expect(mockGetInsuranceContentGateContext).not.toHaveBeenCalledWith('victim-999', expect.anything());
  });
});

// ─── GET/POST /api/taprooting/timeline — session-scoped identity only ─────────────────────────────

describe('GET/POST /api/taprooting/timeline', () => {
  beforeEach(() => {
    mockGetPhasedTimeline.mockResolvedValue({ phases: [] });
    mockMarkChecklistItemAttested.mockResolvedValue({ ok: true });
  });

  test('GET 401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await timelineGET(new NextRequest('http://localhost/api/taprooting/timeline', { headers: FORGED }), {});
    expect(res.status).toBe(401);
  });

  test('GET identity comes from the SESSION, never the forged x-user-id header', async () => {
    mockGetSession.mockResolvedValue(session({ id: 'rep-real' }));
    const res = await timelineGET(new NextRequest('http://localhost/api/taprooting/timeline', { headers: FORGED }), {});
    expect(res.status).toBe(200);
    expect(mockGetPhasedTimeline).toHaveBeenCalledWith('rep-real', 'licensing-service-stub');
  });

  test('POST identity comes from the SESSION, never the forged x-user-id header', async () => {
    mockGetSession.mockResolvedValue(session({ id: 'rep-real' }));
    const res = await timelinePOST(
      new NextRequest('http://localhost/api/taprooting/timeline', {
        method: 'POST',
        body: JSON.stringify({ phase: 'launch', itemKey: 'some-item' }),
        headers: FORGED,
      }),
      {}
    );
    expect(res.status).toBe(200);
    expect(mockMarkChecklistItemAttested).toHaveBeenCalledWith('rep-real', 'launch', 'some-item');
    expect(mockMarkChecklistItemAttested).not.toHaveBeenCalledWith('victim-999', expect.anything(), expect.anything());
  });
});

// ─── POST /api/taprooting/share — session-scoped identity only ────────────────────────────────────

describe('POST /api/taprooting/share', () => {
  beforeEach(() => {
    mockEvaluateTimeLapseShare.mockResolvedValue({ allowed: true, exportSummary: { events: [] } });
  });

  const VALID_BODY = { events: [{ level: 1, displayName: 'A B.', joinedAt: '2026-01-01T00:00:00.000Z' }] };

  test('401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await sharePOST(
      new NextRequest('http://localhost/api/taprooting/share', { method: 'POST', body: JSON.stringify(VALID_BODY), headers: FORGED }),
      {}
    );
    expect(res.status).toBe(401);
  });

  test('identity comes from the SESSION, never the forged x-user-id header', async () => {
    mockGetSession.mockResolvedValue(session({ id: 'rep-real', role: Role.REP }));
    const res = await sharePOST(
      new NextRequest('http://localhost/api/taprooting/share', { method: 'POST', body: JSON.stringify(VALID_BODY), headers: FORGED }),
      {}
    );
    expect(res.status).toBe(200);
    expect(mockEvaluateTimeLapseShare).toHaveBeenCalledWith(
      VALID_BODY,
      expect.anything(),
      { user_id: 'rep-real', role: Role.REP }
    );
  });
});

// ─── POST /api/settings/org-switch — withRole + withStepUp (§16.4 step-up-MFA gate) ───────────────

describe('POST /api/settings/org-switch (WP08 §13.5/§18.7 — step-up-MFA gated)', () => {
  beforeEach(() => {
    mockSwitchOrgType.mockResolvedValue({
      ok: true, fromOrgType: OrgType.PRIMERICA, toOrgType: OrgType.EXTERNAL, archivedEdgeCount: 0, archivedMilestoneCount: 0, switchedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  function req(body: unknown, headers: Record<string, string> = {}) {
    return new NextRequest('http://localhost/api/settings/org-switch', { method: 'POST', body: JSON.stringify(body), headers });
  }

  test('401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await orgSwitchPOST(req({ toOrgType: OrgType.EXTERNAL }, FORGED), {});
    expect(res.status).toBe(401);
    expect(mockSwitchOrgType).not.toHaveBeenCalled();
  });

  test('no MFA factor enrolled at all -> 403 MFA_ENROLLMENT_REQUIRED, switchOrgType never called', async () => {
    mockGetSession.mockResolvedValue(session({ mfaEnrolled: false, mfaVerifiedAt: null }));
    const res = await orgSwitchPOST(req({ toOrgType: OrgType.EXTERNAL }), {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('MFA_ENROLLMENT_REQUIRED');
    expect(mockSwitchOrgType).not.toHaveBeenCalled();
  });

  test('enrolled but STALE step-up (older than the 15-minute revalidation window) -> 403 STEP_UP_REQUIRED, switchOrgType never called', async () => {
    const staleVerifiedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min ago
    mockGetSession.mockResolvedValue(session({ mfaEnrolled: true, mfaVerifiedAt: staleVerifiedAt }));
    const res = await orgSwitchPOST(req({ toOrgType: OrgType.EXTERNAL }), {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('STEP_UP_REQUIRED');
    expect(mockSwitchOrgType).not.toHaveBeenCalled();
  });

  test('FRESH step-up -> 200, and switchOrgType is called with the SESSION user id, never the forged x-user-id header', async () => {
    const freshVerifiedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 min ago
    mockGetSession.mockResolvedValue(session({ id: 'real-user', mfaEnrolled: true, mfaVerifiedAt: freshVerifiedAt }));
    const res = await orgSwitchPOST(req({ toOrgType: OrgType.EXTERNAL }, FORGED), {});
    expect(res.status).toBe(200);
    expect(mockSwitchOrgType).toHaveBeenCalledWith('real-user', OrgType.EXTERNAL);
    expect(mockSwitchOrgType).not.toHaveBeenCalledWith('victim-999', expect.anything());
  });

  test('an invalid toOrgType is rejected 400 even with fresh step-up', async () => {
    const freshVerifiedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    mockGetSession.mockResolvedValue(session({ mfaEnrolled: true, mfaVerifiedAt: freshVerifiedAt }));
    const res = await orgSwitchPOST(req({ toOrgType: 'NOT_A_REAL_ORG_TYPE' }), {});
    expect(res.status).toBe(400);
    expect(mockSwitchOrgType).not.toHaveBeenCalled();
  });
});
