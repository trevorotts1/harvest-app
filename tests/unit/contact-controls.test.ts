// T-33 — per-contact agent controls (master-spec §9.4; uiux §5.7 "Pause agents for {name}" / "Do
// not contact" / "Hand to me"). Mirrors tests/unit/contact-flags.test.ts's exact two-layer
// convention: (c) service-level independence proof against an in-memory fake Prisma, (d)
// route-level session-gated + ownership-checked + forged-header-inert proof against the REAL PATCH
// handler.
//
// T-57 R3c-2 (findings m4) extends both layers to prove the third control, `manualMode` /
// `manual_mode`, is independently settable exactly like the original two (never implied by, and
// never clearing, `agentsPaused`/`doNotContact`).

import { OnboardingStatus, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

import {
  ContactControlsService,
  type ContactControlsPrismaClient,
  type ContactControlsRow,
} from '../../src/services/approval-inbox/contact-controls.service';

// ─── (c) Service-level: independence + ownership ───────────────────────────────────────────────────
function createFakeContactControlsPrisma(rows: ContactControlsRow[]): {
  client: ContactControlsPrismaClient;
  updateCalls: { where: { id: string }; data: Record<string, boolean> }[];
} {
  const updateCalls: { where: { id: string }; data: Record<string, boolean> }[] = [];
  const client: ContactControlsPrismaClient = {
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

describe('ContactControlsService.setControls — §9.4, independent toggles', () => {
  test('setting agentsPaused alone never touches do_not_contact/manual_mode — structurally absent from the write', async () => {
    const rows: ContactControlsRow[] = [
      { id: 'c-1', user_id: 'u-1', agents_paused: false, do_not_contact: false, manual_mode: false },
    ];
    const { client, updateCalls } = createFakeContactControlsPrisma(rows);
    const service = new ContactControlsService(client);

    const result = await service.setControls('u-1', 'c-1', { agentsPaused: true });
    expect(result).toEqual({ ok: true, contactId: 'c-1', agentsPaused: true, doNotContact: false, manualMode: false });
    expect(updateCalls[0].data).toEqual({ agents_paused: true });
    expect('do_not_contact' in updateCalls[0].data).toBe(false);
    expect('manual_mode' in updateCalls[0].data).toBe(false);
  });

  test('setting doNotContact alone never touches agents_paused/manual_mode', async () => {
    const rows: ContactControlsRow[] = [
      { id: 'c-2', user_id: 'u-1', agents_paused: true, do_not_contact: false, manual_mode: false },
    ];
    const { client, updateCalls } = createFakeContactControlsPrisma(rows);
    const service = new ContactControlsService(client);

    const result = await service.setControls('u-1', 'c-2', { doNotContact: true });
    expect(result).toEqual({ ok: true, contactId: 'c-2', agentsPaused: true, doNotContact: true, manualMode: false });
    expect(updateCalls[0].data).toEqual({ do_not_contact: true });
    expect('agents_paused' in updateCalls[0].data).toBe(false);
    expect('manual_mode' in updateCalls[0].data).toBe(false);
  });

  // T-57 R3c-2 (findings m4) — the THIRD control, proved with the exact same independence shape.
  test('setting manualMode alone never touches agents_paused/do_not_contact', async () => {
    const rows: ContactControlsRow[] = [
      { id: 'c-2b', user_id: 'u-1', agents_paused: true, do_not_contact: false, manual_mode: false },
    ];
    const { client, updateCalls } = createFakeContactControlsPrisma(rows);
    const service = new ContactControlsService(client);

    const result = await service.setControls('u-1', 'c-2b', { manualMode: true });
    expect(result).toEqual({ ok: true, contactId: 'c-2b', agentsPaused: true, doNotContact: false, manualMode: true });
    expect(updateCalls[0].data).toEqual({ manual_mode: true });
    expect('agents_paused' in updateCalls[0].data).toBe(false);
    expect('do_not_contact' in updateCalls[0].data).toBe(false);
  });

  test('all three may be set together in one call', async () => {
    const rows: ContactControlsRow[] = [
      { id: 'c-3', user_id: 'u-1', agents_paused: false, do_not_contact: false, manual_mode: false },
    ];
    const { client, updateCalls } = createFakeContactControlsPrisma(rows);
    const service = new ContactControlsService(client);

    const result = await service.setControls('u-1', 'c-3', { agentsPaused: true, doNotContact: true, manualMode: true });
    expect(result).toEqual({ ok: true, contactId: 'c-3', agentsPaused: true, doNotContact: true, manualMode: true });
    expect(updateCalls[0].data).toEqual({ agents_paused: true, do_not_contact: true, manual_mode: true });
  });

  test('no controls provided -> ok:false, no write attempted', async () => {
    const rows: ContactControlsRow[] = [
      { id: 'c-4', user_id: 'u-1', agents_paused: false, do_not_contact: false, manual_mode: false },
    ];
    const { client, updateCalls } = createFakeContactControlsPrisma(rows);
    const service = new ContactControlsService(client);

    const result = await service.setControls('u-1', 'c-4', {});
    expect(result).toEqual({ ok: false, reason: 'no_controls_provided' });
    expect(updateCalls).toHaveLength(0);
  });

  test('ownership: a contact owned by a DIFFERENT user -> not_found, no write attempted', async () => {
    const rows: ContactControlsRow[] = [
      { id: 'c-5', user_id: 'someone-else', agents_paused: false, do_not_contact: false, manual_mode: false },
    ];
    const { client, updateCalls } = createFakeContactControlsPrisma(rows);
    const service = new ContactControlsService(client);

    const result = await service.setControls('u-1', 'c-5', { agentsPaused: true });
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
import { PATCH } from '@/app/api/contacts/controls/route';

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
  return new NextRequest('http://localhost/api/contacts/controls', {
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

describe('PATCH /api/contacts/controls — session-gated, ownership-checked, immediate-effect (T-33)', () => {
  test('no session -> 401, never reaches Prisma', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ contactId: 'c-1', agentsPaused: true }), {});
    expect(res.status).toBe(401);
    expect(mockedContactFindFirst).not.toHaveBeenCalled();
  });

  test('authenticated but NOT gated_complete -> 403', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.IN_PROGRESS);
    const res = await PATCH(patchRequest({ contactId: 'c-1', agentsPaused: true }), {});
    expect(res.status).toBe(403);
    expect(mockedContactFindFirst).not.toHaveBeenCalled();
  });

  test('TEETH: a forged x-user-id header has ZERO effect — ownership check uses the SESSION id', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedContactFindFirst.mockResolvedValue({ id: 'c-1', user_id: 'real-session-user', agents_paused: false, do_not_contact: false });
    mockedContactUpdate.mockResolvedValue({ id: 'c-1', agents_paused: true, do_not_contact: false });

    const res = await PATCH(
      patchRequest({ contactId: 'c-1', agentsPaused: true }, { 'x-user-id': 'some-other-victim-id' }),
      {}
    );
    expect(res.status).toBe(200);
    expect(mockedContactFindFirst).toHaveBeenCalledWith({ where: { id: 'c-1', user_id: 'real-session-user' } });
  });

  test('ownership: a contact owned by a different user -> 404, no update attempted', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedContactFindFirst.mockResolvedValue(null);

    const res = await PATCH(patchRequest({ contactId: 'not-mine', doNotContact: true }), {});
    expect(res.status).toBe(404);
    expect(mockedContactUpdate).not.toHaveBeenCalled();
  });

  test('setting do-not-contact takes effect immediately (write reflected in the response)', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedContactFindFirst.mockResolvedValue({ id: 'c-2', user_id: 'real-session-user', agents_paused: false, do_not_contact: false });
    mockedContactUpdate.mockResolvedValue({ id: 'c-2', agents_paused: false, do_not_contact: true });

    const res = await PATCH(patchRequest({ contactId: 'c-2', doNotContact: true }), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.doNotContact).toBe(true);
    expect(mockedContactUpdate).toHaveBeenCalledWith({ where: { id: 'c-2' }, data: { do_not_contact: true } });
  });

  // T-57 R3c-2 (findings m4) — the third control, proved end-to-end through the real route.
  test('setting manualMode takes effect immediately (write reflected in the response)', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedContactFindFirst.mockResolvedValue({
      id: 'c-2c',
      user_id: 'real-session-user',
      agents_paused: false,
      do_not_contact: false,
      manual_mode: false,
    });
    mockedContactUpdate.mockResolvedValue({
      id: 'c-2c',
      agents_paused: false,
      do_not_contact: false,
      manual_mode: true,
    });

    const res = await PATCH(patchRequest({ contactId: 'c-2c', manualMode: true }), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.manualMode).toBe(true);
    expect(mockedContactUpdate).toHaveBeenCalledWith({ where: { id: 'c-2c' }, data: { manual_mode: true } });
  });

  test('manualMode must be a boolean -> 400, never reaches Prisma', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const res = await PATCH(patchRequest({ contactId: 'c-2d', manualMode: 'yes' }), {});
    expect(res.status).toBe(400);
    expect(mockedContactFindFirst).not.toHaveBeenCalled();
  });

  test('missing contactId -> 400, never reaches Prisma', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const res = await PATCH(patchRequest({ agentsPaused: true }), {});
    expect(res.status).toBe(400);
    expect(mockedContactFindFirst).not.toHaveBeenCalled();
  });
});
