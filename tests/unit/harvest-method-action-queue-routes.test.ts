// T-27 (WP03 §8.3 action queue / §8.5 anti-patterns architecturally blocked / §8.5 doctrine linter
// extended to a second notes surface). Proves the HTTP-route wiring T-26's service-level tests
// (tests/unit/harvest-method-queue.test.ts) don't cover: session gating, forged-x-user-id inertness,
// and — the T-27-specific surface — that the §8.5 anti-pattern guards actually reject a request
// BEFORE `PrioritizedQueueService` ever runs (proving the block lives at the route boundary, not
// merely somewhere inside the engine), and that the action-complete note is scanned/corrected by the
// doctrine linter before it is ever persisted.
//
// Mirrors the exact module-boundary-mocking convention already established in
// tests/unit/agent-queue-route.test.ts / tests/unit/hidden-earnings-route.test.ts: mock
// `@/lib/auth/session` + `@/lib/prisma`, mock the service class, exercise the REAL route handlers.

import { OnboardingStatus, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    contact: { findFirst: jest.fn() },
    contactInteraction: { create: jest.fn() },
  },
}));

const mockGetQueue = jest.fn();
const mockMarkActionComplete = jest.fn();
jest.mock('@/services/harvest-method/prioritized-queue.service', () => {
  const actual = jest.requireActual('@/services/harvest-method/prioritized-queue.service');
  return {
    ...actual,
    PrioritizedQueueService: jest.fn().mockImplementation(() => ({
      getQueue: mockGetQueue,
      markActionComplete: mockMarkActionComplete,
    })),
  };
});

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { GET as actionQueueGET } from '@/app/api/harvest-method/action-queue/route';
import { GET as prioritizedQueueGET } from '@/app/api/harvest-method/prioritized-queue/route';
import { POST as actionCompletePOST } from '@/app/api/harvest-method/action-complete/route';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedUserFindUnique = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;
const mockedContactFindFirst = (prisma as unknown as { contact: { findFirst: jest.Mock } }).contact.findFirst;
const mockedInteractionCreate = (prisma as unknown as { contactInteraction: { create: jest.Mock } }).contactInteraction.create;

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'rep-real-session',
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

/** First `prisma.user.findUnique` call resolves the onboarding GATE; the route's OWN `rank` read
 *  (action-queue / prioritized-queue) is the second call — exactly mirrors how withOnboardingGate
 *  composes in front of the handler in the real request lifecycle (see hidden-earnings-route.test.ts). */
function seedGate(status: OnboardingStatus, rank: string | null = null) {
  mockedUserFindUnique
    .mockResolvedValueOnce({ onboarding_status: status, onboarding_sessions: [{ current_step: 'REGISTER' }] })
    .mockResolvedValueOnce({ rank });
}

function getRequest(path: string, query = ''): NextRequest {
  return new NextRequest(`http://localhost${path}${query}`);
}

function postRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function postRequestWithHeaders(path: string, body: unknown, headers: Record<string, string>): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedUserFindUnique.mockReset();
  mockedContactFindFirst.mockReset();
  mockedInteractionCreate.mockReset();
  mockGetQueue.mockReset();
  mockMarkActionComplete.mockReset();
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// GET /api/harvest-method/action-queue
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('GET /api/harvest-method/action-queue', () => {
  test('no session -> 401, the queue engine never runs', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await actionQueueGET(getRequest('/api/harvest-method/action-queue'), {});
    expect(res.status).toBe(401);
    expect(mockGetQueue).not.toHaveBeenCalled();
  });

  test('a forged x-user-id header has ZERO effect — the route calls getQueue with the SESSION user id', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedGate(OnboardingStatus.GATED_COMPLETE);
    mockGetQueue.mockResolvedValue({ available: true, queue: [] });

    const req = new NextRequest('http://localhost/api/harvest-method/action-queue', {
      headers: { 'x-user-id': 'some-other-victim-id' },
    });
    const res = await actionQueueGET(req, {});

    expect(res.status).toBe(200);
    expect(mockGetQueue).toHaveBeenCalledTimes(1);
    expect(mockGetQueue.mock.calls[0][0]).toBe('real-session-user');
    expect(mockGetQueue.mock.calls[0][0]).not.toBe('some-other-victim-id');
    // includeExcluded:false is the §8.3 action-queue's own defining contract (never true here).
    expect(mockGetQueue.mock.calls[0][2]).toMatchObject({ includeExcluded: false });
  });

  test('§8.5 anti-pattern: an extraction-first sort attempt (?sortBy=wealth) is REJECTED (400) — the queue engine never runs', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedGate(OnboardingStatus.GATED_COMPLETE);

    const res = await actionQueueGET(getRequest('/api/harvest-method/action-queue', '?sortBy=wealth'), {});

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('ANTI_PATTERN_BLOCKED');
    expect(body.antiPattern).toBe('extraction_first_sorting');
    expect(mockGetQueue).not.toHaveBeenCalled();
  });

  test('a plain ?sort=desc attempt is also rejected (any client-selectable sort mode is blocked, not just "wealth")', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedGate(OnboardingStatus.GATED_COMPLETE);

    const res = await actionQueueGET(getRequest('/api/harvest-method/action-queue', '?sort=desc'), {});
    expect(res.status).toBe(400);
    expect(mockGetQueue).not.toHaveBeenCalled();
  });

  // T-27 QC fast-follow: case-variant query param names must be caught too (?orderBY, not just
  // ?orderBy) — FAILS if rejectSortOverride's case-insensitive scan is reverted.
  test('§8.5 anti-pattern: a case-variant "?orderBY=wealth" is also REJECTED (400) — proves case-insensitivity is wired through this route', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedGate(OnboardingStatus.GATED_COMPLETE);

    const res = await actionQueueGET(getRequest('/api/harvest-method/action-queue', '?orderBY=wealth'), {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('ANTI_PATTERN_BLOCKED');
    expect(body.antiPattern).toBe('extraction_first_sorting');
    expect(mockGetQueue).not.toHaveBeenCalled();
  });

  test('the empty-until-3-layers result passes through untouched (route never injects/strips fields)', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedGate(OnboardingStatus.GATED_COMPLETE);
    mockGetQueue.mockResolvedValue({ available: false, reason: 'layers_incomplete', layersCompleted: [], queue: [] });

    const res = await actionQueueGET(getRequest('/api/harvest-method/action-queue'), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ available: false, reason: 'layers_incomplete', layersCompleted: [], queue: [] });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// GET /api/harvest-method/prioritized-queue
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('GET /api/harvest-method/prioritized-queue', () => {
  test('no session -> 401, the queue engine never runs', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await prioritizedQueueGET(getRequest('/api/harvest-method/prioritized-queue'), {});
    expect(res.status).toBe(401);
    expect(mockGetQueue).not.toHaveBeenCalled();
  });

  test('calls getQueue with includeExcluded:true (the ritual-review/acknowledgment surface) using the SESSION user id, forged header ignored', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedGate(OnboardingStatus.GATED_COMPLETE);
    mockGetQueue.mockResolvedValue({ available: true, queue: [] });

    const req = new NextRequest('http://localhost/api/harvest-method/prioritized-queue', {
      headers: { 'x-user-id': 'some-other-victim-id' },
    });
    const res = await prioritizedQueueGET(req, {});

    expect(res.status).toBe(200);
    expect(mockGetQueue.mock.calls[0][0]).toBe('real-session-user');
    expect(mockGetQueue.mock.calls[0][2]).toMatchObject({ includeExcluded: true });
  });

  test('§8.5 anti-pattern: an extraction-first sort attempt (?orderBy=segment_score) is REJECTED (400)', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedGate(OnboardingStatus.GATED_COMPLETE);

    const res = await prioritizedQueueGET(getRequest('/api/harvest-method/prioritized-queue', '?orderBy=segment_score'), {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('ANTI_PATTERN_BLOCKED');
    expect(mockGetQueue).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/harvest-method/action-complete
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('POST /api/harvest-method/action-complete', () => {
  test('no session -> 401, markActionComplete never runs', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await actionCompletePOST(postRequest('/api/harvest-method/action-complete', { contactId: 'c1' }), {});
    expect(res.status).toBe(401);
    expect(mockMarkActionComplete).not.toHaveBeenCalled();
  });

  test('a forged x-user-id header has ZERO effect — markActionComplete runs with the SESSION user id', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedGate(OnboardingStatus.GATED_COMPLETE);
    mockMarkActionComplete.mockResolvedValue({ success: true });

    const res = await actionCompletePOST(
      postRequestWithHeaders('/api/harvest-method/action-complete', { contactId: 'c1' }, { 'x-user-id': 'some-other-victim-id' }),
      {}
    );

    expect(res.status).toBe(200);
    expect(mockMarkActionComplete).toHaveBeenCalledWith('real-session-user', 'c1');
  });

  test('missing contactId -> 400, markActionComplete never runs', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedGate(OnboardingStatus.GATED_COMPLETE);
    const res = await actionCompletePOST(postRequest('/api/harvest-method/action-complete', {}), {});
    expect(res.status).toBe(400);
    expect(mockMarkActionComplete).not.toHaveBeenCalled();
  });

  describe('§8.5 anti-patterns architecturally blocked', () => {
    test('a batch payload ("contactIds": [...]) is REJECTED (400) — markActionComplete never runs (the block has teeth: removing rejectBatchPayload would let this fall through to "contactId is required" or worse, silently process the batch)', async () => {
      mockedSession.mockResolvedValue(fakeSession());
      seedGate(OnboardingStatus.GATED_COMPLETE);

      const res = await actionCompletePOST(
        postRequest('/api/harvest-method/action-complete', { contactIds: ['c1', 'c2', 'c3'] }),
        {}
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('ANTI_PATTERN_BLOCKED');
      expect(body.antiPattern).toBe('batch_cold_outreach');
      expect(mockMarkActionComplete).not.toHaveBeenCalled();
    });

    test('an array-shaped contactId ("select-N-and-blast" via the singular field) is REJECTED (400)', async () => {
      mockedSession.mockResolvedValue(fakeSession());
      seedGate(OnboardingStatus.GATED_COMPLETE);

      const res = await actionCompletePOST(
        postRequest('/api/harvest-method/action-complete', { contactId: ['c1', 'c2'] }),
        {}
      );

      expect(res.status).toBe(400);
      expect(mockMarkActionComplete).not.toHaveBeenCalled();
    });

    test('a manual tier-override attempt ({ contactId, tier: "A" }) is REJECTED (400) — markActionComplete never runs', async () => {
      mockedSession.mockResolvedValue(fakeSession());
      seedGate(OnboardingStatus.GATED_COMPLETE);

      const res = await actionCompletePOST(
        postRequest('/api/harvest-method/action-complete', { contactId: 'c1', tier: 'A' }),
        {}
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('ANTI_PATTERN_BLOCKED');
      expect(body.antiPattern).toBe('manual_tier_override');
      expect(mockMarkActionComplete).not.toHaveBeenCalled();
    });

    test('a readinessScore-override attempt is also REJECTED (400)', async () => {
      mockedSession.mockResolvedValue(fakeSession());
      seedGate(OnboardingStatus.GATED_COMPLETE);

      const res = await actionCompletePOST(
        postRequest('/api/harvest-method/action-complete', { contactId: 'c1', readinessScore: 95 }),
        {}
      );

      expect(res.status).toBe(400);
      expect(mockMarkActionComplete).not.toHaveBeenCalled();
    });

    // T-27 QC fast-follow: a differently-cased key ("Tier") must be rejected too, not silently
    // accepted as an unrecognized field — FAILS if the guard reverts to exact-case matching.
    test('a case-variant tier-override attempt ({ contactId, Tier: "A" }) is also REJECTED (400)', async () => {
      mockedSession.mockResolvedValue(fakeSession());
      seedGate(OnboardingStatus.GATED_COMPLETE);

      const res = await actionCompletePOST(
        postRequest('/api/harvest-method/action-complete', { contactId: 'c1', Tier: 'A' }),
        {}
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('ANTI_PATTERN_BLOCKED');
      expect(body.antiPattern).toBe('manual_tier_override');
      expect(mockMarkActionComplete).not.toHaveBeenCalled();
    });

    // T-27 QC fast-follow: a one-level-nested tier override must also be rejected — FAILS if the
    // guard's one-level nested scan is reverted to top-level-only.
    test('a nested tier-override attempt ({ contactId, override: { tier: "A" } }) is also REJECTED (400)', async () => {
      mockedSession.mockResolvedValue(fakeSession());
      seedGate(OnboardingStatus.GATED_COMPLETE);

      const res = await actionCompletePOST(
        postRequest('/api/harvest-method/action-complete', { contactId: 'c1', override: { tier: 'A' } }),
        {}
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('ANTI_PATTERN_BLOCKED');
      expect(body.antiPattern).toBe('manual_tier_override');
      expect(mockMarkActionComplete).not.toHaveBeenCalled();
    });

    // T-27 QC fast-follow: a one-level-nested + case-variant batch attempt must also be rejected —
    // FAILS if the guard's case-insensitive/nested scan is reverted.
    test('a nested, case-variant batch attempt ({ contactId, batch: { ContactIds: [...] } }) is also REJECTED (400)', async () => {
      mockedSession.mockResolvedValue(fakeSession());
      seedGate(OnboardingStatus.GATED_COMPLETE);

      const res = await actionCompletePOST(
        postRequest('/api/harvest-method/action-complete', { contactId: 'c1', batch: { ContactIds: ['c1', 'c2'] } }),
        {}
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('ANTI_PATTERN_BLOCKED');
      expect(body.antiPattern).toBe('batch_cold_outreach');
      expect(mockMarkActionComplete).not.toHaveBeenCalled();
    });
  });

  describe('the doctrine linter (§8.5) — an optional action note is scanned/corrected BEFORE it is ever persisted', () => {
    test('a note containing "prospect" is corrected, the correction is returned (logged), and the CORRECTED text is what gets persisted — never the raw forbidden term', async () => {
      mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
      seedGate(OnboardingStatus.GATED_COMPLETE);
      mockMarkActionComplete.mockResolvedValue({ success: true });
      mockedContactFindFirst.mockResolvedValue({ id: 'c1', user_id: 'real-session-user' });
      mockedInteractionCreate.mockResolvedValue({});

      const res = await actionCompletePOST(
        postRequest('/api/harvest-method/action-complete', { contactId: 'c1', note: 'Reached out — this prospect is interested.' }),
        {}
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.correction).toBeTruthy();
      expect(body.correction.original).toContain('prospect');
      expect(body.correction.corrected).not.toMatch(/\bprospects?\b/i);

      // The PERSISTED text (pre-encryption plaintext argument) must be the CORRECTED note, never
      // the raw "prospect" — this is the actual save-time enforcement, not just a returned warning.
      expect(mockedInteractionCreate).toHaveBeenCalledTimes(1);
      const createArgs = mockedInteractionCreate.mock.calls[0][0];
      expect(createArgs.data.contact_id).toBe('c1');
      expect(createArgs.data.type).toBe('ACTION_NOTE');
      // notes is stored as an encrypted envelope (JSON string) — never plaintext, and never
      // containing the raw forbidden term (double-checked by decrypting it back).
      expect(createArgs.data.notes).not.toContain('prospect');
    });

    test('a clean note (no forbidden vocabulary) is persisted with no correction', async () => {
      mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
      seedGate(OnboardingStatus.GATED_COMPLETE);
      mockMarkActionComplete.mockResolvedValue({ success: true });
      mockedContactFindFirst.mockResolvedValue({ id: 'c1', user_id: 'real-session-user' });
      mockedInteractionCreate.mockResolvedValue({});

      const res = await actionCompletePOST(
        postRequest('/api/harvest-method/action-complete', { contactId: 'c1', note: 'Had a great community conversation today.' }),
        {}
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.correction).toBeNull();
      expect(mockedInteractionCreate).toHaveBeenCalledTimes(1);
    });

    test('a note over 500 chars is REJECTED (400 NOTE_TOO_LONG) BEFORE any mutation ever commits — markActionComplete must NEVER run for a request that ends up 400ing (T-27 QC fast-follow atomicity fix; this assertion FAILS against the pre-fix ordering where markActionComplete ran and committed before the note length was ever checked)', async () => {
      mockedSession.mockResolvedValue(fakeSession());
      seedGate(OnboardingStatus.GATED_COMPLETE);
      mockMarkActionComplete.mockResolvedValue({ success: true });
      mockedContactFindFirst.mockResolvedValue({ id: 'c1', user_id: 'rep-real-session' });

      const res = await actionCompletePOST(
        postRequest('/api/harvest-method/action-complete', { contactId: 'c1', note: 'x'.repeat(501) }),
        {}
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('NOTE_TOO_LONG');
      // The atomicity proof: a 400 response must never follow a committed side effect.
      expect(mockMarkActionComplete).not.toHaveBeenCalled();
      expect(mockedInteractionCreate).not.toHaveBeenCalled();
    });

    test('a note for a contactId NOT owned by the session user is never persisted (defense-in-depth ownership check)', async () => {
      mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
      seedGate(OnboardingStatus.GATED_COMPLETE);
      mockMarkActionComplete.mockResolvedValue({ success: true });
      mockedContactFindFirst.mockResolvedValue(null); // not owned by this user

      const res = await actionCompletePOST(
        postRequest('/api/harvest-method/action-complete', { contactId: 'victim-contact', note: 'some note' }),
        {}
      );

      expect(res.status).toBe(200); // markActionComplete itself still ran/succeeded
      expect(mockedInteractionCreate).not.toHaveBeenCalled();
      const body = await res.json();
      expect(body.correction).toBeNull();
    });
  });
});
