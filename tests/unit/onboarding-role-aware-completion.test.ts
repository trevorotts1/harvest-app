// T-R38 — onboarding->provisioning reachable for ALL roles.
//
// Before this fix, `POST /api/onboarding/complete` unconditionally required `intensity_data`
// (+ commitmentScore>=5) for every role, but `OnboardingStep.INTENSITY` is only a member of
// `ROLE_STEP_MAP[REP]`/`ROLE_STEP_MAP[DUAL]` (types/onboarding.ts) — UPLINE/RVP/ADMIN's real,
// in-order `/step` walk could never populate `intensity_data`, so those three roles' `/complete`
// permanently 400'd (proved by tests/unit/onboarding-client-mapping-integration.test.ts's own
// pre-fix "DOCUMENTED BLOCKER" tests, now updated alongside this fix). Separately, a Primerica
// dense-track (UPLINE/RVP) user had no way to supply `solution_number` at `ROLE_ORG_CONTEXT`
// (`UplineTrack.tsx` has no re-entry field for it), so that step 400'd for every Primerica dense
// user even when the value was already captured and persisted (encrypted) at §6.3 registration.
//
// This suite proves the fix end-to-end against the REAL route handlers, using the SAME
// stateful-fake-Prisma / fake-session / fake-Inngest harness already established by
// tests/unit/onboarding-session-persistence.test.ts (T-R36) and
// tests/unit/onboarding-client-mapping-integration.test.ts (T-R37) — a fresh, self-contained copy
// so neither existing, already-passing suite is perturbed:
//
//   1. Each of REP, DUAL, UPLINE, RVP, ADMIN walks their REAL `ROLE_STEP_MAP` through the REAL
//      `/step` + `/complete` handlers to a 200 -> `GATED_COMPLETE` -> exactly one
//      `user.onboarding_completed` event -> `provisionFromContract` actually provisions.
//   2. A Primerica dense (UPLINE) user's persisted, encrypted `User.solution_number` (set the same
//      way §6.3 registration sets it) satisfies `ROLE_ORG_CONTEXT` with NO resubmission — and an
//      explicit payload value still always wins over the persisted fallback.
//   3. REP/DUAL STILL require intensity_data + commitmentScore>=5 — the role-aware gate narrows
//      WHO must supply it, it never drops the requirement for roles that have the step.
//   4. Idempotency + publish-before-mutate fail-closed hold for a role that only reaches
//      `GATED_COMPLETE` because of this fix (UPLINE), not just for REP (already covered by
//      tests/unit/onboarding-complete-publish-e2e.test.ts).
//   5. The non-REP `intensity_setting` operator-reviewable default is exactly `LOW`, on both the
//      published event and the persisted `User.intensity_setting` column.

import { NextRequest } from 'next/server';
import { AccessTier, IntensitySetting, OnboardingStatus, OrgType, Role, SponsorshipState } from '@prisma/client';
import type { Session } from 'next-auth';

import { ROLE_STEP_MAP } from '@/types/onboarding';
import {
  ProvisioningNotAllowedError,
  provisionFromContract,
  type ProvisioningPrismaClient,
  type ProvisionedSubscription,
} from '@/services/payment/provisioning';
import { projectToWP10 } from '@/services/onboarding/wp01/downstream-contracts';
import type { OnboardingCompletedEvent } from '@/types/onboarding';
import { encryptSolutionNumberForStorage } from '@/services/onboarding/wp01/solution-number';
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
  access_tier?: AccessTier;
  commitment_score?: number;
  intensity_setting?: IntensitySetting;
  onboarding_status?: OnboardingStatus;
}

const fakeOnboardingSessions = new Map<string, FakeOnboardingSessionRow>();
const fakeUsers = new Map<string, FakeUserRow>();
const fakeSponsorships = new Map<string, { sponsor_user_id: string }>();
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
  sponsorship: {
    findFirst: async ({ where }: { where: { member_user_id: string; state: string } }) => {
      if (where.state !== SponsorshipState.ACTIVE) return null;
      return fakeSponsorships.get(where.member_user_id) ?? null;
    },
  },
  $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
};

jest.mock('@/lib/prisma', () => ({ prisma: fakePrisma }));

const sentEvents: Array<{ name: string; data: unknown }> = [];
let publishOverride: ((event: unknown) => void | Promise<void>) | null = null;
jest.mock('@/services/payment/inngest/payment-inngest-functions', () => ({
  InngestOnboardingEventSink: class {
    async publish(event: { event: string }) {
      if (publishOverride) {
        return publishOverride(event);
      }
      sentEvents.push({ name: event.event, data: event });
    }
  },
}));

import { getCurrentSession } from '@/lib/auth/session';
import { POST as stepRoute } from '@/app/api/onboarding/step/route';
import { POST as completeRoute } from '@/app/api/onboarding/complete/route';

const mockedGetCurrentSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;

function fakeAuthSession(userId: string, role: Role): Session {
  return {
    user: {
      id: userId,
      role,
      orgType: 'EXTERNAL',
      organizationId: null,
      accessTier: 'FREE_ORG_LINKED',
      mfaEnrolled: false,
      mfaVerifiedAt: null,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

function actAs(userId: string, role: Role) {
  mockedGetCurrentSession.mockResolvedValue(fakeAuthSession(userId, role));
}

function seedUser(userId: string, role: Role, orgType: OrgType, overrides: Partial<FakeUserRow> = {}) {
  fakeUsers.set(userId, { id: userId, role, org_type: orgType, gdpr_consent: false, ...overrides });
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

async function postComplete() {
  const request = new NextRequest('http://localhost/api/onboarding/complete', { method: 'POST' });
  const response = await completeRoute(request, {});
  const body = await response.json();
  return { response, body };
}

/** A genuine, real payload for each step this suite's role walks submit — mirrors the shapes
 *  `onboarding-step-client.ts`'s own builders produce (never a hand-invented duplicate format). */
function payloadForStep(step: string): Record<string, unknown> {
  switch (step) {
    case 'SEVEN_WHYS':
      return { sevenWhys: [{ question: 'Why?', answer: 'Because my family deserves better.', score: 80 }] };
    case 'GOAL_CARD':
      return {
        goalCard: {
          primaryGoal: 'Replace my income within two years.',
          targetDate: '2027-01-01',
          commitmentLevel: 8,
          motivationStatement: 'My kids are watching.',
          anchorStatement: 'Built for my kids.',
        },
      };
    case 'INTENSITY':
      return { intensityData: { commitmentScore: 8, weeklyHours: 10, riskTolerance: 'HIGH', supportNeeds: [] } };
    case 'CONSENT_CAPTURE':
      return { gdpr_consent: true };
    default:
      return {};
  }
}

/** Walks a role's REAL, full `ROLE_STEP_MAP` (§6.9) through the REAL `/step` route, in order,
 *  asserting every call succeeds. Then simulates the REAL, separate `/api/onboarding/consent`
 *  route's own durable GDPR write (not under test here — see onboarding-consent-route.test.ts). */
async function walkFullRoleStepMap(userId: string, role: Role) {
  const steps = ROLE_STEP_MAP[role];
  for (const step of steps) {
    const { response, body } = await postStep(step, payloadForStep(step));
    expect(response.status).toBe(200);
    void body;
  }
  fakeUsers.get(userId)!.gdpr_consent = true;
}

/** Same `ProvisioningPrismaClient` reading from the SAME `fakeUsers` map the completion route
 *  wrote into (T-R36's own convention) — proves provisioning is driven by the route's real write,
 *  never a separately-asserted status dict. */
function makeProvisioningPrisma() {
  const subscriptions = new Map<string, ProvisionedSubscription>();
  let seq = 0;
  const prisma: ProvisioningPrismaClient = {
    user: {
      findUnique: async ({ where }) => {
        const u = fakeUsers.get(where.id);
        return u ? { onboarding_status: u.onboarding_status ?? OnboardingStatus.IN_PROGRESS } : null;
      },
    },
    subscription: {
      findFirst: async ({ where }) => {
        const sub = subscriptions.get(where.user_id);
        return sub && sub.status === where.status ? sub : null;
      },
      create: async ({ data }) => {
        seq += 1;
        const created: ProvisionedSubscription = {
          id: `sub-${seq}`,
          user_id: data.user_id,
          plan_tier: data.plan_tier,
          status: data.status,
          org_sponsored: data.org_sponsored,
          sponsor_user_id: data.sponsor_user_id,
        };
        subscriptions.set(data.user_id, created);
        return created;
      },
    },
    sponsorship: { findFirst: async () => null },
  };
  return { prisma, subscriptions };
}

afterEach(() => {
  fakeOnboardingSessions.clear();
  fakeUsers.clear();
  fakeSponsorships.clear();
  sentEvents.length = 0;
  publishOverride = null;
  mockedGetCurrentSession.mockReset();
});

describe('T-R38 (1) — EVERY role walks its real ROLE_STEP_MAP through the REAL /step + /complete routes to GATED_COMPLETE, then provisions', () => {
  test.each([Role.REP, Role.DUAL, Role.UPLINE, Role.RVP, Role.ADMIN] as const)(
    '%s reaches 200 -> GATED_COMPLETE -> exactly one user.onboarding_completed event -> provisionFromContract provisions',
    async (role) => {
      const userId = `role-sweep-${role}`;
      actAs(userId, role);
      seedUser(userId, role, OrgType.EXTERNAL);

      await walkFullRoleStepMap(userId, role);

      const { response, body } = await postComplete();
      expect(response.status).toBe(200);
      expect(body.completed).toBe(true);

      const persistedUser = fakeUsers.get(userId)!;
      expect(persistedUser.onboarding_status).toBe(OnboardingStatus.GATED_COMPLETE);
      // No sponsor, EXTERNAL org, every role -> the same §6.7 signal-derived tier.
      expect(persistedUser.access_tier).toBe(AccessTier.FREE_PAID_EXTERNAL);

      expect(sentEvents).toHaveLength(1);
      const published = sentEvents[0].data as OnboardingCompletedEvent;
      expect(published.event).toBe('user.onboarding_completed');
      expect(published.role).toBe(role);
      expect(published.user_id).toBe(userId);

      const { prisma } = makeProvisioningPrisma();
      const contract = projectToWP10(published);
      const result = await provisionFromContract(prisma, contract);
      expect(result.provisioned).toBe(true);
      expect(result.subscription.user_id).toBe(userId);
    }
  );

  test('REP/DUAL publish their REAL riskTolerance-derived intensity_setting (HIGH here) — the role-aware fix does not touch the roles that DO have the step', async () => {
    for (const role of [Role.REP, Role.DUAL] as const) {
      const userId = `role-sweep-intensity-${role}`;
      actAs(userId, role);
      seedUser(userId, role, OrgType.EXTERNAL);
      await walkFullRoleStepMap(userId, role);
      await postComplete();
    }
    const publishedRoles = sentEvents.map((e) => (e.data as OnboardingCompletedEvent).role);
    expect(publishedRoles).toEqual([Role.REP, Role.DUAL]);
    for (const e of sentEvents) {
      expect((e.data as OnboardingCompletedEvent).intensity_setting).toBe(IntensitySetting.HIGH);
    }
  });

  test.each([Role.UPLINE, Role.RVP, Role.ADMIN] as const)(
    '%s (no INTENSITY step in their ROLE_STEP_MAP) publishes the documented LOW operator-reviewable default, and User.intensity_setting is persisted as LOW too',
    async (role) => {
      const userId = `role-sweep-default-${role}`;
      actAs(userId, role);
      seedUser(userId, role, OrgType.EXTERNAL);
      await walkFullRoleStepMap(userId, role);

      const { response } = await postComplete();
      expect(response.status).toBe(200);

      expect(sentEvents).toHaveLength(1);
      expect((sentEvents[0].data as OnboardingCompletedEvent).intensity_setting).toBe(IntensitySetting.LOW);
      expect(fakeUsers.get(userId)!.intensity_setting).toBe(IntensitySetting.LOW);
      // Never had a real commitment score — recorded honestly as 0, not fabricated.
      expect(fakeUsers.get(userId)!.commitment_score).toBe(0);
    }
  );
});

describe('T-R38 (2) — Primerica dense-track solution_number reuse (server-side, from the persisted §6.3 registration value)', () => {
  test('an UPLINE Primerica user with a persisted, encrypted User.solution_number clears ROLE_ORG_CONTEXT with NO resubmission', async () => {
    const userId = 'dense-primerica-persisted-1';
    actAs(userId, Role.UPLINE);
    seedUser(userId, Role.UPLINE, OrgType.PRIMERICA, {
      solution_number: encryptSolutionNumberForStorage('1234567'),
    });

    await postStep('REGISTER', {});
    await postStep('ACCOUNT_TYPE', {});

    // The EXACT payload the real dense-track client builds with NO local solution number to
    // source (`UplineTrack.tsx` has no re-entry field) — omits `solution_number`/`solutionNumber`
    // entirely, see `buildRoleOrgContextPayload`'s own doc comment.
    const orgPayload = buildRoleOrgContextPayload(OrgType.PRIMERICA, '');
    expect(orgPayload.solution_number).toBeUndefined();
    expect(orgPayload.solutionNumber).toBeUndefined();

    const { response, body } = await postStep('ROLE_ORG_CONTEXT', orgPayload);
    expect(response.status).toBe(200);
    expect(body.currentStep).toBe('FINRA_DISCLOSURE');
  });

  test('an explicit payload solution_number ALWAYS wins over the persisted fallback — never silently overridden', async () => {
    const userId = 'dense-primerica-explicit-wins-1';
    actAs(userId, Role.UPLINE);
    // Persisted value, if it were ever read, would legitimately FAIL the format gate (it is not a
    // valid alphanumeric identifier — a disallowed symbol, per the T-R57-relaxed rule) — proving
    // that if the route reached 200 here, it did so via the EXPLICIT payload value, never the
    // persisted one.
    seedUser(userId, Role.UPLINE, OrgType.PRIMERICA, {
      solution_number: encryptSolutionNumberForStorage('!!!'),
    });

    await postStep('REGISTER', {});
    await postStep('ACCOUNT_TYPE', {});

    const { response } = await postStep('ROLE_ORG_CONTEXT', {
      orgType: OrgType.PRIMERICA,
      org_type: OrgType.PRIMERICA,
      solution_number: '7654321', // a genuinely well-formed, explicitly-submitted value
    });
    expect(response.status).toBe(200);
  });

  test('a Primerica dense user with NO persisted value and NO submitted value still 400s — fail-closed, never fabricated', async () => {
    const userId = 'dense-primerica-no-value-1';
    actAs(userId, Role.UPLINE);
    seedUser(userId, Role.UPLINE, OrgType.PRIMERICA); // no solution_number persisted

    await postStep('REGISTER', {});
    await postStep('ACCOUNT_TYPE', {});

    const orgPayload = buildRoleOrgContextPayload(OrgType.PRIMERICA, '');
    const { response } = await postStep('ROLE_ORG_CONTEXT', orgPayload);
    expect(response.status).toBe(400);
  });

  test('a UNIVERSAL (non-Primerica) dense user is never affected by the fallback at all (no decrypt attempt, format gate never even runs)', async () => {
    const userId = 'dense-universal-1';
    actAs(userId, Role.RVP);
    seedUser(userId, Role.RVP, OrgType.EXTERNAL, {
      solution_number: encryptSolutionNumberForStorage('1234567'), // present but irrelevant — universal branch
    });

    await postStep('REGISTER', {});
    await postStep('ACCOUNT_TYPE', {});

    const orgPayload = buildRoleOrgContextPayload(OrgType.EXTERNAL, '');
    const { response, body } = await postStep('ROLE_ORG_CONTEXT', orgPayload);
    expect(response.status).toBe(200);
    expect(body.currentStep).toBe('FINRA_DISCLOSURE');
  });
});

describe('T-R38 (3) — REP/DUAL STILL require intensity_data + commitmentScore>=5 (the role-aware gate narrows WHO must supply it, never drops it for roles that have the step)', () => {
  /** Fast-path direct seed (bypasses the /step walk) so the completion precondition itself is
   *  isolated — mirrors onboarding-session-persistence.test.ts's own `directlySeedCompletableSession`. */
  function directlySeedCompletableSession(userId: string, overrides: Partial<FakeOnboardingSessionRow> = {}) {
    idSeq += 1;
    const row: FakeOnboardingSessionRow = {
      id: `sess-direct-${idSeq}`,
      user_id: userId,
      current_step: 'CONSENT_CAPTURE',
      seven_whys: null,
      goal_card: { anchorStatement: 'Built for my kids.' },
      intensity_data: null,
      completed: false,
      created_at: new Date(2026, 0, 1, 0, 0, 0, createdAtSeq++),
      ...overrides,
    };
    fakeOnboardingSessions.set(row.id, row);
    return row;
  }

  test.each([Role.REP, Role.DUAL] as const)(
    '%s with intensity_data === null still 400s: "Intensity data is required before completing onboarding"',
    async (role) => {
      const userId = `still-required-null-${role}`;
      actAs(userId, role);
      seedUser(userId, role, OrgType.EXTERNAL, { gdpr_consent: true });
      directlySeedCompletableSession(userId, { intensity_data: null });

      const { response, body } = await postComplete();
      expect(response.status).toBe(400);
      expect(body.error).toBe('Intensity data is required before completing onboarding');
      expect(fakeUsers.get(userId)!.onboarding_status).toBeUndefined();
      expect(sentEvents).toHaveLength(0);
    }
  );

  test.each([Role.REP, Role.DUAL] as const)(
    '%s with commitmentScore below the MIN_COMMITMENT_SCORE floor still 400s',
    async (role) => {
      const userId = `still-required-low-score-${role}`;
      actAs(userId, role);
      seedUser(userId, role, OrgType.EXTERNAL, { gdpr_consent: true });
      directlySeedCompletableSession(userId, {
        intensity_data: { commitmentScore: 3, weeklyHours: 5, riskTolerance: 'LOW', supportNeeds: [] },
      });

      const { response, body } = await postComplete();
      expect(response.status).toBe(400);
      expect(body.error).toBe('Commitment score must be at least 5/10 to complete onboarding');
      expect(sentEvents).toHaveLength(0);
    }
  );

  test.each([Role.REP, Role.DUAL] as const)(
    '%s WITH valid intensity_data (commitmentScore>=5) still successfully completes — the requirement is satisfiable, not a permanent block',
    async (role) => {
      const userId = `still-required-valid-${role}`;
      actAs(userId, role);
      seedUser(userId, role, OrgType.EXTERNAL, { gdpr_consent: true });
      directlySeedCompletableSession(userId, {
        intensity_data: { commitmentScore: 6, weeklyHours: 10, riskTolerance: 'MEDIUM', supportNeeds: [] },
      });

      const { response, body } = await postComplete();
      expect(response.status).toBe(200);
      expect(body.commitmentScore).toBe(6);
      expect(fakeUsers.get(userId)!.intensity_setting).toBe(IntensitySetting.MEDIUM);
    }
  );
});

describe('T-R38 (4) — idempotency + publish-before-mutate fail-closed hold for UPLINE, a role that ONLY reaches GATED_COMPLETE because of this fix', () => {
  function seedCompletableUpline(userId: string) {
    fakeUsers.set(userId, { id: userId, role: Role.UPLINE, org_type: OrgType.EXTERNAL, gdpr_consent: true });
    idSeq += 1;
    fakeOnboardingSessions.set(`sess-${idSeq}`, {
      id: `sess-${idSeq}`,
      user_id: userId,
      current_step: 'CONSENT_CAPTURE',
      seven_whys: null,
      goal_card: null,
      intensity_data: null,
      completed: false,
      created_at: new Date(2026, 0, 1, 0, 0, 0, createdAtSeq++),
    });
    actAs(userId, Role.UPLINE);
  }

  test('a caller retry after a successful UPLINE completion is rejected and publishes nothing further', async () => {
    const userId = 'upline-retry-1';
    seedCompletableUpline(userId);

    const first = await postComplete();
    expect(first.response.status).toBe(200);
    expect(sentEvents).toHaveLength(1);

    const second = await postComplete();
    expect(second.response.status).toBe(400);
    expect(second.body.error).toBe('Onboarding already completed');
    expect(sentEvents).toHaveLength(1);
  });

  test('a publish failure for UPLINE fails closed (500), never marks the session completed, and a retry after the fault clears publishes exactly once', async () => {
    const userId = 'upline-fail-1';
    seedCompletableUpline(userId);

    publishOverride = () => {
      throw new Error('simulated transient Inngest fault');
    };
    const failed = await postComplete();
    expect(failed.response.status).toBe(500);
    expect(sentEvents).toHaveLength(0);
    const session = [...fakeOnboardingSessions.values()].find((s) => s.user_id === userId);
    expect(session?.completed).toBe(false);
    expect(fakeUsers.get(userId)!.onboarding_status).toBeUndefined();

    publishOverride = null;
    const retried = await postComplete();
    expect(retried.response.status).toBe(200);
    expect(sentEvents).toHaveLength(1);
    expect(fakeUsers.get(userId)!.onboarding_status).toBe(OnboardingStatus.GATED_COMPLETE);
  });

  test('provisioning refuses when the live row is not yet GATED_COMPLETE — fail-closed, even for a role only reachable via this fix', async () => {
    const userId = 'upline-precondition-1';
    seedUser(userId, Role.UPLINE, OrgType.EXTERNAL); // onboarding_status left unset (IN_PROGRESS-equivalent)

    const { prisma, subscriptions } = makeProvisioningPrisma();
    await expect(
      provisionFromContract(prisma, { user_id: userId, access_tier: AccessTier.FREE_PAID_EXTERNAL })
    ).rejects.toBeInstanceOf(ProvisioningNotAllowedError);
    expect(subscriptions.size).toBe(0);
  });
});
