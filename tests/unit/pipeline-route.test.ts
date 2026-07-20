// T-R10 (remediation, flagged from T-28 QC + WP03 gate) — proves `/api/contacts/pipeline` (the
// real data source behind the `/community` page's plots + contact cards) is actually wired to
// `PipelineService.getPipelineSummary` (T-23), is session-gated, and a forged `x-user-id` header has
// ZERO effect — mirrors the exact module-boundary-mocking pattern already established in
// tests/unit/agent-queue-route.test.ts.
//
// `PipelineService.getPipelineSummary`'s own correctness (decrypt, per-stage grouping, ownership
// scoping via `where: { user_id: userId }`, the real isRecruitTarget/isClient passthrough) is proven
// independently in tests/unit/warm-market.test.ts against a real DI-mocked prisma — this suite
// proves ONLY the route/auth/response-shape wiring: does the right (session-derived) user id reach
// PipelineService, does the response never carry the retired demo stub, and does a zero-contact rep
// see a proper (zero-count, zero-contacts) response rather than any fallback contacts.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { OnboardingStatus, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

const REPO_ROOT = path.join(__dirname, '..', '..');

// ─── (b) The retired demo stub is GONE from the authored source — fails if reintroduced ───────────
// Before T-R10, `/api/contacts/pipeline/route.ts` hardcoded four `demo-contact-N` rows and set
// `_meta.demo: true`; `/community/page.tsx` consumed them as its `DemoContact` shape. A static scan
// (not just a runtime response assertion) catches a regression even if some future refactor changes
// how the route is tested.
describe('(b) the retired demo-data stub is gone from the authored source (T-R10)', () => {
  const bannedPatterns = [/demo-contact-\d/, /demoContacts\s*[:(]/, /DemoContact\b/, /demo:\s*true/];

  test.each([
    ['src/app/api/contacts/pipeline/route.ts'],
    ['src/app/community/page.tsx'],
  ])('%s contains no demo-stub marker', (relPath) => {
    const src = readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
    for (const pattern of bannedPatterns) {
      expect(src).not.toMatch(pattern);
    }
  });
});

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
  },
}));

const mockGetPipelineSummary = jest.fn();
jest.mock('@/services/warm-market/pipeline.service', () => {
  const actual = jest.requireActual('@/services/warm-market/pipeline.service');
  return {
    ...actual,
    PipelineService: jest.fn().mockImplementation(() => ({
      getPipelineSummary: mockGetPipelineSummary,
    })),
  };
});

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/contacts/pipeline/route';
import { PipelineStage } from '@/types/warm-market';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedUserFindUnique = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'user-pipeline-1',
      role: Role.REP,
      orgType: 'EXTERNAL',
      organizationId: 'org-1',
      accessTier: 'FREE_ORG_LINKED',
      mfaEnrolled: false,
      mfaVerifiedAt: null,
      ...overrides,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

function seedOnboarding(status: OnboardingStatus | null) {
  mockedUserFindUnique.mockResolvedValue(
    status === null ? null : { onboarding_status: status, onboarding_sessions: [{ current_step: 'REGISTER' }] }
  );
}

function getRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/contacts/pipeline', { headers });
}

function emptyGroupedSummary() {
  const empty: Record<string, unknown[]> = {};
  Object.values(PipelineStage).forEach((stage) => {
    empty[stage] = [];
  });
  return empty;
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedUserFindUnique.mockReset();
  mockGetPipelineSummary.mockReset();
});

describe('GET /api/contacts/pipeline — T-R10 real, session-scoped wiring (no demo fallback)', () => {
  test('no session → 401, PipelineService never runs', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await GET(getRequest(), {});
    expect(res.status).toBe(401);
    expect(mockGetPipelineSummary).not.toHaveBeenCalled();
  });

  test('authenticated but NOT gated_complete → 403 ONBOARDING_INCOMPLETE, PipelineService never runs', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.IN_PROGRESS);
    const res = await GET(getRequest(), {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ONBOARDING_INCOMPLETE');
    expect(mockGetPipelineSummary).not.toHaveBeenCalled();
  });

  test('a forged x-user-id header has ZERO effect — the route uses the SESSION user id', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockGetPipelineSummary.mockResolvedValue(emptyGroupedSummary());

    const res = await GET(getRequest({ 'x-user-id': 'some-other-victim-id' }), {});

    expect(res.status).toBe(200);
    expect(mockGetPipelineSummary).toHaveBeenCalledTimes(1);
    expect(mockGetPipelineSummary).toHaveBeenCalledWith('real-session-user');
    expect(mockGetPipelineSummary).not.toHaveBeenCalledWith('some-other-victim-id');
  });

  test('a rep with a REAL seeded contact sees it in the response, named + scored from the decrypted service result', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const grouped = emptyGroupedSummary();
    grouped[PipelineStage.RESPONDED] = [
      {
        id: 'real-contact-77',
        firstName: 'Priya',
        lastName: 'Nair',
        segmentScore: 63,
        isRecruitTarget: true,
        isClient: false,
      },
    ];
    mockGetPipelineSummary.mockResolvedValue(grouped);

    const res = await GET(getRequest(), {});
    expect(res.status).toBe(200);
    const body = await res.json();

    const respondedStage = body.summary.find((s: { stage: string }) => s.stage === PipelineStage.RESPONDED);
    expect(respondedStage.count).toBe(1);
    expect(respondedStage.contacts).toEqual([
      { id: 'real-contact-77', name: 'Priya Nair', relationshipStrength: 63, isRecruitTarget: true, isClient: false },
    ]);
    expect(body.totals.contacts).toBe(1);

    // Never the retired demo stub's ids or metadata.
    expect(JSON.stringify(body)).not.toContain('demo-contact');
    expect(body._meta.demo).toBe(false);
  });

  test('a zero-contact rep gets a proper empty response (zero counts everywhere), not any fallback contact', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'brand-new-rep' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockGetPipelineSummary.mockResolvedValue(emptyGroupedSummary());

    const res = await GET(getRequest(), {});
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.totals.contacts).toBe(0);
    expect(body.totals.appointmentReady).toBe(0);
    // Zero contacts must resolve to 0, never NaN (divide-by-zero guard).
    expect(body.totals.averageRelationshipStrength).toBe(0);
    body.summary.forEach((s: { count: number; contacts: unknown[] }) => {
      expect(s.count).toBe(0);
      expect(s.contacts).toEqual([]);
    });
    expect(JSON.stringify(body)).not.toContain('demo-contact');
  });
});
