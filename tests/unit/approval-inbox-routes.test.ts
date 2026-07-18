// T-33 — route-level proofs for the Approval Inbox surface (master-spec §9.2; uiux §5.6). Mirrors
// the exact module-boundary-mocking pattern established in tests/unit/contact-flags.test.ts /
// tests/unit/agent-queue-route.test.ts: mock `@/lib/auth/session` + `@/lib/prisma`, then exercise
// the REAL `withOnboardingGate`-wrapped route handlers. Proves: session-gated, a forged `x-user-id`
// header has ZERO effect, ownership-scoped, and the no-batch-approve guard trips at the route layer
// too (not just the unit-level `rejectBatchApprove` guard).

import { OnboardingStatus, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    draftMessage: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    contact: { findMany: jest.fn() },
  },
}));

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { GET as inboxGET } from '@/app/api/approval-inbox/route';
import { POST as approvePOST } from '@/app/api/approval-inbox/approve/route';
import { POST as declinePOST } from '@/app/api/approval-inbox/decline/route';
import { POST as editPOST } from '@/app/api/approval-inbox/edit/route';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedUserFindUnique = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;
const mockedDraftFindMany = (prisma as unknown as { draftMessage: { findMany: jest.Mock } }).draftMessage.findMany;
const mockedDraftFindFirst = (prisma as unknown as { draftMessage: { findFirst: jest.Mock } }).draftMessage.findFirst;
const mockedDraftUpdate = (prisma as unknown as { draftMessage: { update: jest.Mock } }).draftMessage.update;
const mockedContactFindMany = (prisma as unknown as { contact: { findMany: jest.Mock } }).contact.findMany;

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'real-session-user',
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

function getRequest(path: string, query = '', headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${path}${query}`, { headers });
}
function postRequest(path: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedUserFindUnique.mockReset();
  mockedDraftFindMany.mockReset();
  mockedDraftFindFirst.mockReset();
  mockedDraftUpdate.mockReset();
  mockedContactFindMany.mockReset();
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// GET /api/approval-inbox — the list surface
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('GET /api/approval-inbox', () => {
  test('no session -> 401, never touches Prisma', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await inboxGET(getRequest('/api/approval-inbox'), {});
    expect(res.status).toBe(401);
    expect(mockedDraftFindMany).not.toHaveBeenCalled();
  });

  test('authenticated but NOT gated_complete -> 403 ONBOARDING_INCOMPLETE', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.IN_PROGRESS);
    const res = await inboxGET(getRequest('/api/approval-inbox'), {});
    expect(res.status).toBe(403);
    expect(mockedDraftFindMany).not.toHaveBeenCalled();
  });

  test('TEETH: a forged x-user-id header has ZERO effect — the SESSION user id is what scopes the query', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedDraftFindMany.mockResolvedValue([]);

    const res = await inboxGET(getRequest('/api/approval-inbox', '', { 'x-user-id': 'some-other-victim-id' }), {});
    expect(res.status).toBe(200);
    expect(mockedDraftFindMany).toHaveBeenCalledTimes(1);
    expect(mockedDraftFindMany.mock.calls[0][0].where.user_id).toBe('real-session-user');
    expect(mockedDraftFindMany.mock.calls[0][0].where.user_id).not.toBe('some-other-victim-id');
  });

  test('lists PENDING drafts with CFE band/risk carried through', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedDraftFindMany.mockResolvedValue([
      {
        id: 'd-1',
        user_id: 'user-1',
        contact_id: 'c-1',
        channel: 'SMS_HANDOFF',
        body: 'Hey! Would love to catch up sometime.',
        cfe_outcome: 'FLAG',
        cfe_risk_score: 35,
        cfe_classifier_data: [],
        approval_state: 'PENDING',
        approved_by: null,
        approved_at: null,
        edited_after_approval: false,
        decline_reason: null,
        decline_note: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    mockedContactFindMany.mockResolvedValue([{ id: 'c-1', first_name: 'Jordan', last_name: 'Vega' }]);

    const res = await inboxGET(getRequest('/api/approval-inbox'), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.items[0]).toMatchObject({ cfe_outcome: 'FLAG', cfe_risk_score: 35 });
    expect(body.items[0].contact).toEqual({ firstName: 'Jordan', lastName: 'Vega' });
  });

  test('an invalid ?state= value -> 400, never touches Prisma', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const res = await inboxGET(getRequest('/api/approval-inbox', '?state=NOT_A_STATE'), {});
    expect(res.status).toBe(400);
    expect(mockedDraftFindMany).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/approval-inbox/approve — NO BATCH APPROVE
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('POST /api/approval-inbox/approve', () => {
  test('no session -> 401, never touches Prisma', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await approvePOST(postRequest('/api/approval-inbox/approve', { draftId: 'd-1' }), {});
    expect(res.status).toBe(401);
    expect(mockedDraftFindFirst).not.toHaveBeenCalled();
  });

  test('TEETH — NO BATCH APPROVE: a plural draftIds array is rejected with 400, never reaches Prisma', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const res = await approvePOST(postRequest('/api/approval-inbox/approve', { draftIds: ['d-1', 'd-2'] }), {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('ANTI_PATTERN_BLOCKED');
    expect(body.antiPattern).toBe('batch_approve');
    expect(mockedDraftFindFirst).not.toHaveBeenCalled();
    expect(mockedDraftUpdate).not.toHaveBeenCalled();
  });

  test('TEETH — NO BATCH APPROVE: draftId as an array is rejected with 400', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const res = await approvePOST(postRequest('/api/approval-inbox/approve', { draftId: ['d-1', 'd-2'] }), {});
    expect(res.status).toBe(400);
    expect(mockedDraftFindFirst).not.toHaveBeenCalled();
  });

  test('a forged x-user-id header cannot approve another rep\'s draft — ownership uses the SESSION id', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedDraftFindFirst.mockResolvedValue(null); // scoped to {id, user_id: 'real-session-user'} finds nothing

    const res = await approvePOST(
      postRequest('/api/approval-inbox/approve', { draftId: 'victim-draft' }, { 'x-user-id': 'some-other-victim-id' }),
      {}
    );
    expect(res.status).toBe(404);
    expect(mockedDraftFindFirst).toHaveBeenCalledWith({ where: { id: 'victim-draft', user_id: 'real-session-user' } });
    expect(mockedDraftUpdate).not.toHaveBeenCalled();
  });

  test('approves a single owned PENDING draft -> 200', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedDraftFindFirst.mockResolvedValue({ id: 'd-1', user_id: 'real-session-user', approval_state: 'PENDING' });
    mockedDraftUpdate.mockResolvedValue({ id: 'd-1', user_id: 'real-session-user', approval_state: 'APPROVED', approved_by: 'real-session-user', approved_at: new Date() });

    const res = await approvePOST(postRequest('/api/approval-inbox/approve', { draftId: 'd-1' }), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft.approval_state).toBe('APPROVED');
  });

  test('a HELD draft -> 403 NOT_APPROVABLE, no update attempted', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedDraftFindFirst.mockResolvedValue({ id: 'd-1', user_id: 'real-session-user', approval_state: 'HELD' });

    const res = await approvePOST(postRequest('/api/approval-inbox/approve', { draftId: 'd-1' }), {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('NOT_APPROVABLE');
    expect(mockedDraftUpdate).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/approval-inbox/decline
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('POST /api/approval-inbox/decline', () => {
  test('TEETH — NO BATCH DECLINE either: a plural draftIds array is rejected with 400', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const res = await declinePOST(postRequest('/api/approval-inbox/decline', { draftIds: ['d-1', 'd-2'], reason: 'other' }), {});
    expect(res.status).toBe(400);
    expect(mockedDraftFindFirst).not.toHaveBeenCalled();
  });

  test('missing reason -> 400, never reaches Prisma', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const res = await declinePOST(postRequest('/api/approval-inbox/decline', { draftId: 'd-1' }), {});
    expect(res.status).toBe(400);
    expect(mockedDraftFindFirst).not.toHaveBeenCalled();
  });

  test('a valid single-item decline -> 200', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedDraftFindFirst.mockResolvedValue({ id: 'd-1', user_id: 'real-session-user', approval_state: 'PENDING' });
    mockedDraftUpdate.mockResolvedValue({ id: 'd-1', user_id: 'real-session-user', approval_state: 'DECLINED', decline_reason: 'wrong_person', decline_note: null });

    const res = await declinePOST(postRequest('/api/approval-inbox/decline', { draftId: 'd-1', reason: 'wrong_person' }), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft.approval_state).toBe('DECLINED');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/approval-inbox/edit — THE EDIT-RE-ENTERS-CFE HARD RULE, at the route layer
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('POST /api/approval-inbox/edit', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterAll(() => {
    if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
  });

  test('TEETH — NO BATCH EDIT: a plural draftIds array is rejected with 400', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const res = await editPOST(postRequest('/api/approval-inbox/edit', { draftIds: ['d-1'], body: 'x' }), {});
    expect(res.status).toBe(400);
    expect(mockedDraftFindFirst).not.toHaveBeenCalled();
  });

  test('missing body -> 400, never reaches Prisma', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const res = await editPOST(postRequest('/api/approval-inbox/edit', { draftId: 'd-1' }), {});
    expect(res.status).toBe(400);
    expect(mockedDraftFindFirst).not.toHaveBeenCalled();
  });

  // MUTATION-PROOF (route layer, KEY-LESS/fail-closed real CFE): with no ANTHROPIC_API_KEY
  // configured, a real (non-test-double) ComplianceFilterEngine fails CLOSED the instant
  // `evaluateContent` is actually called — so the edit route can ONLY return HELD here if it truly
  // re-entered the CFE. If a future refactor skipped the CFE call and just persisted the new body,
  // this test would observe `approval_state: 'PENDING'`/200-approvable instead, and fail.
  test('MUTATION-PROOF: with no CFE key configured, editing a draft HOLDS it (fail-closed re-entry) — never silently approvable', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedDraftFindFirst.mockResolvedValue({
      id: 'd-1',
      user_id: 'real-session-user',
      contact_id: 'c-1',
      channel: 'SMS_HANDOFF',
      body: 'original text',
      approval_state: 'PENDING',
      edited_after_approval: false,
    });
    mockedDraftUpdate.mockImplementation(async ({ data }) => ({
      id: 'd-1',
      user_id: 'real-session-user',
      approval_state: data.approval_state,
      cfe_outcome: data.cfe_outcome,
      ...data,
    }));

    const res = await editPOST(postRequest('/api/approval-inbox/edit', { draftId: 'd-1', body: 'an edited message' }), {});
    expect(res.status).toBe(200);
    const resBody = await res.json();
    expect(resBody.cfe.held).toBe(true);
    expect(resBody.draft.approval_state).toBe('HELD');
    expect(mockedDraftUpdate).toHaveBeenCalledTimes(1);
    expect(mockedDraftUpdate.mock.calls[0][0].data.approval_state).toBe('HELD');
  });

  test('ownership: editing another rep\'s draft -> 404, no update attempted', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedDraftFindFirst.mockResolvedValue(null);

    const res = await editPOST(postRequest('/api/approval-inbox/edit', { draftId: 'victim-draft', body: 'x' }), {});
    expect(res.status).toBe(404);
    expect(mockedDraftUpdate).not.toHaveBeenCalled();
  });
});
