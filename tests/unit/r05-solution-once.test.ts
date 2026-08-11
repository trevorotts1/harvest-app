// R-05 (refinements catalog 2026-07-28) — the solution number is captured EXACTLY ONCE across
// onboarding (at registration, the first Primerica surface) and REUSED on every later step by
// reading the already-persisted value back — never re-prompted.
//
// The O-3 org-context screen no longer shows a solution-number entry field at all: it renders the
// persisted value's MASKED saved-state + the not-verified caption (driven by the server-provided
// presence probe `GET /api/onboarding/status` → `hasSolutionNumber`), and the `/step` route's T-R38
// fallback (`decryptSolutionNumberFromStorage`) satisfies ROLE_ORG_CONTEXT's format gate from the
// value already stored encrypted at registration.
//
// This suite proves, against the REAL `/status` + `/step` routes (narrow-DI fakes at the Prisma
// boundary, per this repo's established convention — mirroring
// onboarding-session-persistence.test.ts):
//   1. REUSE WORKS: a Primerica user whose value was persisted at registration sees
//      `hasSolutionNumber: true` from /status (presence probe only — never the value), and
//      ROLE_ORG_CONTEXT clears with NO re-submitted value (the server decrypts and reuses it).
//   2. EMPTY FAILS CLOSED: a Primerica user with NO persisted value sees `hasSolutionNumber: false`
//      and ROLE_ORG_CONTEXT honestly 400s (never fabricated).
//   3. TAMPER FAILS CLOSED: a corrupted/undecryptable persisted envelope yields `false` (mask only,
//      honest unsaved state) and the gate 400s exactly like "never had one".
//   4. NON-PRIMERICA NEVER SEES A SURFACE: a universal user's /status never reports the probe
//      meaningfully and their ROLE_ORG_CONTEXT passes without any solution-number involvement;
//      render-level "no solution surface" is proven in r02-org-once.test.ts / onboarding-ui.test.ts.

import { NextRequest } from 'next/server';
import { OrgType, Role } from '@prisma/client';
import type { Session } from 'next-auth';

import {
  encryptSolutionNumberForStorage,
} from '@/services/onboarding/wp01/solution-number';
import { buildRoleOrgContextPayload } from '@/app/onboarding/onboarding-step-client';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));

interface FakeOnboardingSessionRow {
  id: string;
  user_id: string;
  current_step: string;
  seven_whys: unknown;
  goal_card: unknown;
  intensity_data: unknown;
  completed: boolean;
  created_at: Date;
}

interface FakeUserRow {
  id: string;
  role: Role;
  org_type: OrgType;
  gdpr_consent: unknown;
  solution_number?: string | null;
}

const fakeOnboardingSessions = new Map<string, FakeOnboardingSessionRow>();
const fakeUsers = new Map<string, FakeUserRow>();
let idSeq = 0;
let createdAtSeq = 0;

const fakePrisma = {
  onboardingSession: {
    findFirst: async ({ where }: { where: { user_id: string } }) => {
      const rows = [...fakeOnboardingSessions.values()].filter((r) => r.user_id === where.user_id);
      if (rows.length === 0) return null;
      return rows.reduce((a, b) => (a.created_at >= b.created_at ? a : b));
    },
    create: async ({ data }: { data: { user_id: string } }) => {
      idSeq += 1;
      const row: FakeOnboardingSessionRow = {
        id: `sess-${idSeq}`,
        user_id: data.user_id,
        current_step: 'REGISTER',
        seven_whys: null,
        goal_card: null,
        intensity_data: null,
        completed: false,
        created_at: new Date(2026, 0, 1, 0, 0, 0, createdAtSeq++),
      };
      fakeOnboardingSessions.set(row.id, row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = fakeOnboardingSessions.get(where.id);
      if (!row) throw new Error(`no fake onboarding session ${where.id}`);
      Object.assign(row, data);
      return row;
    },
  },
  user: {
    findUnique: async ({ where }: { where: { id: string } }) => fakeUsers.get(where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = fakeUsers.get(where.id);
      if (!row) throw new Error(`no fake user ${where.id}`);
      Object.assign(row, data);
      return row;
    },
  },
  $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
};

jest.mock('@/lib/prisma', () => ({ prisma: fakePrisma }));

import { getCurrentSession } from '@/lib/auth/session';
import { POST as stepRoute } from '@/app/api/onboarding/step/route';
import { GET as statusRoute } from '@/app/api/onboarding/status/route';

const mockedGetCurrentSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;

function fakeAuthSession(userId: string): Session {
  return {
    user: {
      id: userId,
      role: Role.REP,
      orgType: 'EXTERNAL',
      organizationId: null,
      accessTier: 'FREE_ORG_LINKED',
      mfaEnrolled: false,
      mfaVerifiedAt: null,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

function actAs(userId: string) {
  mockedGetCurrentSession.mockResolvedValue(fakeAuthSession(userId));
}

function seedUser(userId: string, orgType: OrgType, overrides: Partial<FakeUserRow> = {}) {
  fakeUsers.set(userId, {
    id: userId,
    role: Role.REP,
    org_type: orgType,
    gdpr_consent: false,
    ...overrides,
  });
}

async function postStep(step: string, data: Record<string, unknown>) {
  const request = new NextRequest('http://localhost/api/onboarding/step', {
    method: 'POST',
    body: JSON.stringify({ step, data }),
  });
  const response = await stepRoute(request, {});
  const body = await response.json();
  return { response, body };
}

async function getStatus() {
  const request = new NextRequest('http://localhost/api/onboarding/status');
  const response = await statusRoute(request, {});
  const body = await response.json();
  return { response, body };
}

/** Walk REGISTER + ACCOUNT_TYPE so the session cursor sits on ROLE_ORG_CONTEXT (the step under test). */
async function advanceToOrgContext() {
  const register = await postStep('REGISTER', {});
  expect(register.response.status).toBe(200);
  const accountType = await postStep('ACCOUNT_TYPE', {});
  expect(accountType.response.status).toBe(200);
}

afterEach(() => {
  fakeOnboardingSessions.clear();
  fakeUsers.clear();
  mockedGetCurrentSession.mockReset();
});

describe('R-05 — solution number captured once at registration, REUSED (never re-prompted)', () => {
  test('REUSE WORKS: persisted value at registration → /status reports presence (never the value) → ROLE_ORG_CONTEXT clears with NO resubmission', async () => {
    const userId = 'r05-reuse-1';
    actAs(userId);
    // The §6.3 registration write: encrypted at rest with the server key (the exact value the
    // register route's `encryptSolutionNumberForStorage` produces).
    seedUser(userId, OrgType.PRIMERICA, {
      solution_number: encryptSolutionNumberForStorage('ABC-1234'),
    });

    await advanceToOrgContext();

    // The O-3 screen reads the presence probe from GET /status — a boolean only.
    const status = await getStatus();
    expect(status.response.status).toBe(200);
    expect(status.body.hasSolutionNumber).toBe(true);
    // The value itself never crosses the API — the probe is the ONLY solution-number datum.
    expect(status.body.solution_number).toBeUndefined();
    expect(status.body.solutionNumber).toBeUndefined();

    // The O-3 "Continue" submits NO solution-number value (the rep was never re-asked) — the
    // EXACT payload the flow now builds (`buildRoleOrgContextPayload(orgType, '')`).
    const orgPayload = buildRoleOrgContextPayload(OrgType.PRIMERICA, '');
    expect(orgPayload.solution_number).toBeUndefined();
    expect(orgPayload.solutionNumber).toBeUndefined();

    const { response, body } = await postStep('ROLE_ORG_CONTEXT', orgPayload);
    expect(response.status).toBe(200); // the server reuses the persisted value for the format gate
    expect(body.currentStep).toBe('SEVEN_WHYS');
  });

  test('EMPTY FAILS CLOSED: no persisted value → /status reports false and ROLE_ORG_CONTEXT 400s (honest — never fabricated)', async () => {
    const userId = 'r05-empty-1';
    actAs(userId);
    // A Primerica registrant who (for whatever reason) has no stored value at all.
    seedUser(userId, OrgType.PRIMERICA);

    await advanceToOrgContext();

    const status = await getStatus();
    expect(status.response.status).toBe(200);
    expect(status.body.hasSolutionNumber).toBe(false);

    const orgPayload = buildRoleOrgContextPayload(OrgType.PRIMERICA, '');
    const { response } = await postStep('ROLE_ORG_CONTEXT', orgPayload);
    expect(response.status).toBe(400); // same honest fail-closed gate as "never had one"
  });

  test('TAMPER FAILS CLOSED: an undecryptable persisted envelope → presence false, gate 400s — never a fabricated/garbage value', async () => {
    const userId = 'r05-tamper-1';
    actAs(userId);
    // A corrupted envelope (tampered ciphertext, rotated key, or plain garbage) decrypts to null
    // via `decryptSolutionNumberFromStorage`'s fail-closed rule.
    seedUser(userId, OrgType.PRIMERICA, {
      solution_number: '{"ciphertext":"tampered","iv":"tampered","authTag":"tampered","algorithm":"aes-256-gcm"}',
    });

    await advanceToOrgContext();

    const status = await getStatus();
    expect(status.response.status).toBe(200);
    expect(status.body.hasSolutionNumber).toBe(false); // exactly like "never had one"

    const orgPayload = buildRoleOrgContextPayload(OrgType.PRIMERICA, '');
    const { response } = await postStep('ROLE_ORG_CONTEXT', orgPayload);
    expect(response.status).toBe(400); // fail-closed — a garbage envelope never format-validates
  });

  test('NON-PRIMERICA: a universal user\'s /status presence probe is never meaningfully set and ROLE_ORG_CONTEXT passes with no solution-number involvement', async () => {
    const userId = 'r05-universal-1';
    actAs(userId);
    seedUser(userId, OrgType.EXTERNAL, {
      solution_number: encryptSolutionNumberForStorage('ABC-1234'), // present but irrelevant
    });

    await advanceToOrgContext();

    const status = await getStatus();
    expect(status.response.status).toBe(200);
    expect(status.body.hasSolutionNumber).toBe(true); // a value exists — but no surface may use it

    // The universal user's O-3 panel is Primerica-free by construction (render-proven in
    // r02-org-once.test.ts / onboarding-ui.test.ts); their ROLE_ORG_CONTEXT passes without the
    // format gate even running.
    const orgPayload = buildRoleOrgContextPayload(OrgType.EXTERNAL, '');
    const { response } = await postStep('ROLE_ORG_CONTEXT', orgPayload);
    expect(response.status).toBe(200);
  });

  test('REUSE WORKS FOR THE DENSE TRACK TOO: an UPLINE Primerica user\'s persisted value clears ROLE_ORG_CONTEXT with no resubmission', async () => {
    const userId = 'r05-dense-1';
    actAs(userId);
    seedUser(userId, OrgType.PRIMERICA, {
      role: Role.UPLINE,
      solution_number: encryptSolutionNumberForStorage('SOL-2024'),
    });

    await advanceToOrgContext();

    // The dense track's plan omits any solution number (`buildDenseTrackStepPlan` is built with
    // '' — no local value exists anywhere); the server's reuse fallback satisfies the gate.
    const orgPayload = buildRoleOrgContextPayload(OrgType.PRIMERICA, '');
    const { response, body } = await postStep('ROLE_ORG_CONTEXT', orgPayload);
    expect(response.status).toBe(200);
    expect(body.currentStep).toBe('FINRA_DISCLOSURE'); // UPLINE's real next step
  });
});
