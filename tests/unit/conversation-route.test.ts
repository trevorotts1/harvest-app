// T-39 QC FIX 1 (uiux §5.7/§4.7 "rep-reachable conversation surface") — proves
// `/api/contacts/[contactId]/conversation` (the real data source the new `/community/[contactId]`
// page mounts `ConversationTimeline` on top of) is session-gated, ownership-checked, and that a
// forged `x-user-id` header has ZERO effect — mirrors the exact module-boundary-mocking pattern
// already established in tests/unit/pipeline-route.test.ts / tests/unit/agent-queue-route.test.ts.
//
// This test proves ONLY the route/auth/ownership wiring (does the SESSION-derived user id reach
// `ConversationTimelineService`, does a contact belonging to someone else 404 rather than leak, does
// a forged header get ignored). `ConversationTimelineService`'s own decrypt/compose correctness is
// proven independently in conversation-timeline.service.test.ts.

import { OnboardingStatus, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
  },
}));

const mockGetConversation = jest.fn();
jest.mock('@/services/messaging/conversation/conversation-timeline.service', () => {
  const actual = jest.requireActual('@/services/messaging/conversation/conversation-timeline.service');
  return {
    ...actual,
    ConversationTimelineService: jest.fn().mockImplementation(() => ({
      getConversation: mockGetConversation,
    })),
  };
});

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/contacts/[contactId]/conversation/route';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedUserFindUnique = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'user-conv-1',
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
  return new NextRequest('http://localhost/api/contacts/contact-1/conversation', { headers });
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedUserFindUnique.mockReset();
  mockGetConversation.mockReset();
});

describe('GET /api/contacts/[contactId]/conversation — session-gated, ownership-checked', () => {
  test('no session → 401, ConversationTimelineService never runs', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await GET(getRequest(), { params: { contactId: 'contact-1' } });
    expect(res.status).toBe(401);
    expect(mockGetConversation).not.toHaveBeenCalled();
  });

  test('authenticated but NOT gated_complete → 403 ONBOARDING_INCOMPLETE, service never runs', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.IN_PROGRESS);
    const res = await GET(getRequest(), { params: { contactId: 'contact-1' } });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ONBOARDING_INCOMPLETE');
    expect(mockGetConversation).not.toHaveBeenCalled();
  });

  test('a forged x-user-id header has ZERO effect — the route uses the SESSION user id', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockGetConversation.mockResolvedValue({
      contact: { id: 'contact-1', name: 'Jamie Rivera', doNotContact: false, agentsPaused: false },
      entries: [],
    });

    const res = await GET(getRequest({ 'x-user-id': 'some-other-victim-id' }), { params: { contactId: 'contact-1' } });

    expect(res.status).toBe(200);
    expect(mockGetConversation).toHaveBeenCalledTimes(1);
    expect(mockGetConversation).toHaveBeenCalledWith('real-session-user', 'contact-1');
    expect(mockGetConversation).not.toHaveBeenCalledWith('some-other-victim-id', 'contact-1');
  });

  test("TEETH (ownership): a contactId that is not this session user's own contact → 404, never a leak", async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    // The service returns null for "not found OR not owned" — indistinguishable by design.
    mockGetConversation.mockResolvedValue(null);

    const res = await GET(getRequest(), { params: { contactId: 'someone-elses-contact' } });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('someone-elses-contact');
    expect(mockGetConversation).toHaveBeenCalledWith('real-session-user', 'someone-elses-contact');
  });

  test('a real owned contact returns its decrypted conversation (contact + entries), fed straight to the timeline', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const conversation = {
      contact: { id: 'contact-77', name: 'Priya Nair', doNotContact: false, agentsPaused: false },
      entries: [
        {
          kind: 'message',
          id: 'm-1',
          direction: 'OUTBOUND',
          source: 'AGENT',
          sentFrom: 'platform_number',
          channel: 'SMS_PLATFORM',
          body: 'Warm hello from your agent.',
          timestamp: '2026-07-14T15:00:00.000Z',
          deliveryStatus: 'queued',
          approvedBy: 'real-session-user',
          approvedAt: '2026-07-14T15:00:00.000Z',
          cfeAuditId: 'audit-1',
        },
      ],
    };
    mockGetConversation.mockResolvedValue(conversation);

    const res = await GET(getRequest(), { params: { contactId: 'contact-77' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(conversation);
    expect(body.entries[0].body).toBe('Warm hello from your agent.'); // decrypted, never ciphertext
  });

  test('a missing contactId is a 400, never forwarded to the service', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const res = await GET(getRequest(), { params: { contactId: '' } });
    expect(res.status).toBe(400);
    expect(mockGetConversation).not.toHaveBeenCalled();
  });
});
