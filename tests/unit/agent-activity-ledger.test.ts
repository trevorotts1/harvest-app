// T-33 — the Agent Activity Ledger (master-spec §9.3, "derived from AgentRun.reasoning_log").
// Read-only + ownership-scoped, proven at both the service and route layers. This is distinct from
// `src/services/compliance/audit/activity-ledger.ts`'s `ActivityLedgerService` (the WP11 compliance
// audit-store read, covered by tests/unit/audit-store.test.ts) — this suite covers the WP04
// `AgentRun`-sourced ledger named in agent-runtime/index.ts's own T-32/T-33 seam comments.

import { OnboardingStatus, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

import {
  ACTIVITY_LEDGER_MAX_LIMIT,
  AgentActivityLedgerService,
  type ActivityLedgerPrismaClient,
  type AgentRunLedgerRow,
} from '../../src/services/approval-inbox/activity-ledger.service';

function run(overrides: Partial<AgentRunLedgerRow> = {}): AgentRunLedgerRow {
  return {
    id: 'run-1',
    agent_key: 'PRE_SALE_NURTURE',
    user_id: 'u-1',
    trigger: 'overnight_wave',
    status: 'COMPLETED',
    reasoning_log: "Nurture Agent waited 3 days because Tasha hadn't replied.",
    output_ref: null,
    started_at: new Date('2026-07-18T06:00:00Z'),
    finished_at: new Date('2026-07-18T06:00:05Z'),
    created_at: new Date('2026-07-18T06:00:00Z'),
    ...overrides,
  };
}

// ── (a) Service-level: read-only, ownership-scoped, clamps limit ──────────────────────────────────
describe('AgentActivityLedgerService.listForUser — §9.3 read-only, ownership-scoped', () => {
  test('has no update/delete method on its public surface (read-only by construction)', () => {
    const service = new AgentActivityLedgerService({ agentRun: { findMany: jest.fn() } } as unknown as ActivityLedgerPrismaClient);
    expect((service as any).update).toBeUndefined();
    expect((service as any).delete).toBeUndefined();
  });

  test('returns only the caller\'s OWN runs, newest first', async () => {
    const findMany = jest.fn().mockResolvedValue([run({ id: 'run-2' }), run({ id: 'run-1' })]);
    const client: ActivityLedgerPrismaClient = { agentRun: { findMany } };
    const service = new AgentActivityLedgerService(client);

    const entries = await service.listForUser('u-1');
    expect(findMany).toHaveBeenCalledWith({ where: { user_id: 'u-1' }, orderBy: { created_at: 'desc' }, take: 50 });
    expect(entries.map((e) => e.id)).toEqual(['run-2', 'run-1']);
  });

  test('a plain-language reasoning_log is carried through untouched', async () => {
    const findMany = jest.fn().mockResolvedValue([run({ reasoning_log: 'Prospecting Agent introduced 3 new contacts.' })]);
    const service = new AgentActivityLedgerService({ agentRun: { findMany } });
    const entries = await service.listForUser('u-1');
    expect(entries[0].reasoning_log).toBe('Prospecting Agent introduced 3 new contacts.');
  });

  test('limit is clamped to ACTIVITY_LEDGER_MAX_LIMIT', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new AgentActivityLedgerService({ agentRun: { findMany } });
    await service.listForUser('u-1', { limit: 99999 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: ACTIVITY_LEDGER_MAX_LIMIT }));
  });
});

// ── (b) Route-level: session-gated, ownership-scoped (can't read another rep's) ────────────────────
jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: jest.fn() }, agentRun: { findMany: jest.fn() } },
}));

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/activity-ledger/route';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedUserFindUnique = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;
const mockedAgentRunFindMany = (prisma as unknown as { agentRun: { findMany: jest.Mock } }).agentRun.findMany;

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
function getRequest(query = '', headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/activity-ledger${query}`, { headers });
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedUserFindUnique.mockReset();
  mockedAgentRunFindMany.mockReset();
});

describe('GET /api/activity-ledger', () => {
  test('no session -> 401, never touches Prisma', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await GET(getRequest(), {});
    expect(res.status).toBe(401);
    expect(mockedAgentRunFindMany).not.toHaveBeenCalled();
  });

  test('authenticated but NOT gated_complete -> 403', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.IN_PROGRESS);
    const res = await GET(getRequest(), {});
    expect(res.status).toBe(403);
    expect(mockedAgentRunFindMany).not.toHaveBeenCalled();
  });

  test('TEETH — ownership: a forged x-user-id header CANNOT read another rep\'s ledger — the SESSION id scopes the query', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedAgentRunFindMany.mockResolvedValue([]);

    const res = await GET(getRequest('', { 'x-user-id': 'some-other-victim-id' }), {});
    expect(res.status).toBe(200);
    expect(mockedAgentRunFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: 'real-session-user' } })
    );
  });

  test('returns the reasoning_log entries for the session user', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedAgentRunFindMany.mockResolvedValue([run()]);

    const res = await GET(getRequest(), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.entries[0].reasoning_log).toContain("Tasha hadn't replied");
  });
});
