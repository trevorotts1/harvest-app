// T-28 — closes the carried-forward `is_recruit_target` / `is_client` toggle write-path (uiux §4.6,
// flagged by the WP02 gate). Two layers of proof, mirroring this repo's established conventions:
//
//   (c) SERVICE-level, in-memory-fake Prisma (same convention as harvest-method.test.ts): proves the
//       two flags are written INDEPENDENTLY — setting one never touches the other's column, not even
//       to "re-set it to its current value" (asserted by inspecting exactly which keys reach the
//       fake's `update` call, not just the returned result).
//   (d) ROUTE-level, mocked `@/lib/auth/session` + `@/lib/prisma` (same convention as
//       contacts-import-route.test.ts / contacts/agent-queue's own route): no session -> 401;
//       not GATED_COMPLETE -> 403; a forged `x-user-id` header has ZERO effect (the session's own id
//       is what reaches the service); and a contact owned by a DIFFERENT user -> 404 (ownership
//       check), never a cross-account write.

import { OnboardingStatus, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

import {
  ContactFlagsService,
  type ContactFlagsPrismaClient,
  type ContactFlagsRow,
} from '../../src/services/warm-market/contact-flags.service';

// ─── (c) Service-level: in-memory fake Prisma, independence proof ─────────────────────────────────

function createFakeContactFlagsPrisma(rows: ContactFlagsRow[]): {
  client: ContactFlagsPrismaClient;
  updateCalls: { where: { id: string }; data: Record<string, boolean> }[];
} {
  const updateCalls: { where: { id: string }; data: Record<string, boolean> }[] = [];
  const client: ContactFlagsPrismaClient = {
    contact: {
      async findFirst({ where }) {
        return rows.find((r) => r.id === where.id && r.user_id === where.user_id) ?? null;
      },
      async update({ where, data }) {
        updateCalls.push({ where, data });
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return { ...row };
      },
    },
  };
  return { client, updateCalls };
}

describe('(c) ContactFlagsService.setFlags — independent toggle write-path (uiux §4.6, T-28)', () => {
  test('setting isRecruitTarget alone never touches is_client — the update payload omits the key entirely', async () => {
    const rows: ContactFlagsRow[] = [{ id: 'c-1', user_id: 'u-1', is_recruit_target: false, is_client: false }];
    const { client, updateCalls } = createFakeContactFlagsPrisma(rows);
    const service = new ContactFlagsService(client);

    const result = await service.setFlags('u-1', 'c-1', { isRecruitTarget: true });

    expect(result).toEqual({ ok: true, contactId: 'c-1', isRecruitTarget: true, isClient: false });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].data).toEqual({ is_recruit_target: true });
    expect('is_client' in updateCalls[0].data).toBe(false); // TEETH: not merely unchanged — structurally absent
  });

  test('setting isClient alone never touches is_recruit_target — the update payload omits the key entirely', async () => {
    const rows: ContactFlagsRow[] = [{ id: 'c-2', user_id: 'u-1', is_recruit_target: true, is_client: false }];
    const { client, updateCalls } = createFakeContactFlagsPrisma(rows);
    const service = new ContactFlagsService(client);

    const result = await service.setFlags('u-1', 'c-2', { isClient: true });

    expect(result).toEqual({ ok: true, contactId: 'c-2', isRecruitTarget: true, isClient: true });
    expect(updateCalls[0].data).toEqual({ is_client: true });
    expect('is_recruit_target' in updateCalls[0].data).toBe(false);
  });

  test('TEETH: flipping isRecruitTarget ON then isClient ON in two separate calls leaves both independently true, proving no coupling either direction', async () => {
    const rows: ContactFlagsRow[] = [{ id: 'c-3', user_id: 'u-1', is_recruit_target: false, is_client: false }];
    const { client } = createFakeContactFlagsPrisma(rows);
    const service = new ContactFlagsService(client);

    await service.setFlags('u-1', 'c-3', { isRecruitTarget: true });
    const afterFirst = rows.find((r) => r.id === 'c-3')!;
    expect(afterFirst.is_recruit_target).toBe(true);
    expect(afterFirst.is_client).toBe(false); // untouched by the first call

    await service.setFlags('u-1', 'c-3', { isClient: true });
    const afterSecond = rows.find((r) => r.id === 'c-3')!;
    expect(afterSecond.is_recruit_target).toBe(true); // still true — the second call never reset it
    expect(afterSecond.is_client).toBe(true);
  });

  test('both flags may be set together in one call (both keys present, both independent of each other)', async () => {
    const rows: ContactFlagsRow[] = [{ id: 'c-4', user_id: 'u-1', is_recruit_target: false, is_client: false }];
    const { client, updateCalls } = createFakeContactFlagsPrisma(rows);
    const service = new ContactFlagsService(client);

    const result = await service.setFlags('u-1', 'c-4', { isRecruitTarget: true, isClient: false });
    expect(result).toEqual({ ok: true, contactId: 'c-4', isRecruitTarget: true, isClient: false });
    expect(updateCalls[0].data).toEqual({ is_recruit_target: true, is_client: false });
  });

  test('no flags provided -> ok:false, no write attempted', async () => {
    const rows: ContactFlagsRow[] = [{ id: 'c-5', user_id: 'u-1', is_recruit_target: false, is_client: false }];
    const { client, updateCalls } = createFakeContactFlagsPrisma(rows);
    const service = new ContactFlagsService(client);

    const result = await service.setFlags('u-1', 'c-5', {});
    expect(result).toEqual({ ok: false, reason: 'no_flags_provided' });
    expect(updateCalls).toHaveLength(0);
  });

  test('ownership: a contact owned by a DIFFERENT user -> not_found, no write attempted', async () => {
    const rows: ContactFlagsRow[] = [{ id: 'c-6', user_id: 'someone-else', is_recruit_target: false, is_client: false }];
    const { client, updateCalls } = createFakeContactFlagsPrisma(rows);
    const service = new ContactFlagsService(client);

    const result = await service.setFlags('u-1', 'c-6', { isRecruitTarget: true });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(updateCalls).toHaveLength(0);
  });
});

// ─── (d) Route-level: session-gated, ownership-checked, forged-header-inert ───────────────────────

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: jest.fn() }, contact: { findFirst: jest.fn(), update: jest.fn() } },
}));

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { PATCH } from '@/app/api/contacts/flags/route';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedUserFindUnique = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;
const mockedContactFindFirst = (prisma as unknown as { contact: { findFirst: jest.Mock } }).contact.findFirst;
const mockedContactUpdate = (prisma as unknown as { contact: { update: jest.Mock } }).contact.update;

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

function patchRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/contacts/flags', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedUserFindUnique.mockReset();
  mockedContactFindFirst.mockReset();
  mockedContactUpdate.mockReset();
});

describe('PATCH /api/contacts/flags — session-gated, ownership-checked toggle write-path (T-28)', () => {
  test('no session -> 401, never reaches Prisma', async () => {
    mockedSession.mockResolvedValue(null);

    const res = await PATCH(patchRequest({ contactId: 'c-1', isRecruitTarget: true }), {});
    expect(res.status).toBe(401);
    expect(mockedContactFindFirst).not.toHaveBeenCalled();
    expect(mockedContactUpdate).not.toHaveBeenCalled();
  });

  test('authenticated but NOT gated_complete -> 403 ONBOARDING_INCOMPLETE, never reaches Prisma', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.IN_PROGRESS);

    const res = await PATCH(patchRequest({ contactId: 'c-1', isRecruitTarget: true }), {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ONBOARDING_INCOMPLETE');
    expect(mockedContactFindFirst).not.toHaveBeenCalled();
  });

  test('TEETH: a forged x-user-id header has ZERO effect — the SESSION user id is what reaches the ownership check', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedContactFindFirst.mockResolvedValue({
      id: 'c-1',
      user_id: 'real-session-user',
      is_recruit_target: false,
      is_client: false,
    });
    mockedContactUpdate.mockResolvedValue({ id: 'c-1', is_recruit_target: true, is_client: false });

    const res = await PATCH(
      patchRequest({ contactId: 'c-1', isRecruitTarget: true }, { 'x-user-id': 'some-other-victim-id' }),
      {}
    );

    expect(res.status).toBe(200);
    // The ownership lookup must have used the SESSION id, never the forged header.
    expect(mockedContactFindFirst).toHaveBeenCalledWith({
      where: { id: 'c-1', user_id: 'real-session-user' },
    });
  });

  test('ownership: a contact owned by a different user -> 404, no update attempted', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedContactFindFirst.mockResolvedValue(null); // findFirst scoped to {id, user_id} finds nothing

    const res = await PATCH(patchRequest({ contactId: 'not-mine', isRecruitTarget: true }), {});
    expect(res.status).toBe(404);
    expect(mockedContactUpdate).not.toHaveBeenCalled();
  });

  test('missing contactId -> 400, never reaches Prisma', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);

    const res = await PATCH(patchRequest({ isRecruitTarget: true }), {});
    expect(res.status).toBe(400);
    expect(mockedContactFindFirst).not.toHaveBeenCalled();
  });

  test('TEETH: PATCHing only isClient at the route level never includes is_recruit_target in the update call', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedContactFindFirst.mockResolvedValue({
      id: 'c-9',
      user_id: 'real-session-user',
      is_recruit_target: true,
      is_client: false,
    });
    mockedContactUpdate.mockResolvedValue({ id: 'c-9', is_recruit_target: true, is_client: true });

    const res = await PATCH(patchRequest({ contactId: 'c-9', isClient: true }), {});
    expect(res.status).toBe(200);
    expect(mockedContactUpdate).toHaveBeenCalledWith({ where: { id: 'c-9' }, data: { is_client: true } });
    const updateArg = mockedContactUpdate.mock.calls[0][0];
    expect('is_recruit_target' in updateArg.data).toBe(false);
  });
});
