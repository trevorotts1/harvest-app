// T-R36 — REAL, Prisma-backed onboarding-session persistence.
//
// Before this fix, `POST /api/onboarding/complete` (and its sibling `/step`/`/status` routes) each
// read from their OWN private, always-empty, in-memory `sessions: any[] = []` test seam (the
// retired `src/app/api/onboarding/complete/store.ts` — its own header comment named this exact
// gap: "no session-creation endpoint of its own yet ... full onboarding-session lifecycle wiring is
// T-20"). A real production user's session was NEVER in that array — every real completion 404'd
// before the T-R35 event-publish wiring ever ran, and — separately, and just as fatal — nothing
// ever wrote the real `User.onboarding_status` column T-R35's own registered subscriber
// (`provisionFromContract`, payment/provisioning.ts) fail-closed-requires to be `GATED_COMPLETE`
// before it will provision anything at all.
//
// This suite proves the fix end-to-end against a REAL (faked-at-the-Prisma-boundary, per this
// repo's established narrow-DI convention — ProvisioningPrismaClient/GdprConsentPrismaClient/
// SponsorInvitePrismaClient) persisted session:
//   (1) a session persists across POST /step (start + advance, through the REAL 11-step
//       ROLE_STEP_MAP, including the two new-this-fix enum values SPONSOR_MATCHING-adjacent
//       CONSENT_CAPTURE reaches) -> GET /status -> POST /complete, all against the SAME row.
//   (2) completion reads the persisted session and publishes exactly one correctly-shaped event.
//   (3) the completion route's own DB write (not a test-hardcoded dict) is what satisfies WP10
//       provisioning's fail-closed §15.2 precondition — proven by feeding the SAME fake `User` map
//       the route wrote into to `provisionFromContract`, never a separately-asserted status.
//   (4) idempotent replay of that real published event provisions exactly once.
//   (5) a real, authenticated user with no session of their own — including one where ANOTHER
//       user's session exists — fails closed with an honest 404, never accidentally reading or
//       completing someone else's session.
//
// (Publish-failure-leaves-session-uncompleted and the §6.7/GDPR completion-precondition regression
// suite are covered by tests/unit/onboarding-complete-publish-e2e.test.ts and tests/unit/
// onboarding.test.ts respectively — both updated by this same fix to seed the new real-persistence
// shape; this suite is additive, not a duplicate.)

import { NextRequest } from 'next/server';
import { AccessTier, IntensitySetting, OnboardingStatus, OrgType, Role, SponsorshipState } from '@prisma/client';
import type { Session } from 'next-auth';

import {
  ProvisioningNotAllowedError,
  provisionFromContract,
  type ProvisioningPrismaClient,
  type ProvisionedSubscription,
} from '@/services/payment/provisioning';
import { projectToWP10 } from '@/services/onboarding/wp01/downstream-contracts';
import type { OnboardingCompletedEvent } from '@/types/onboarding';

// ── Fake session plumbing (mirrors tests/unit/onboarding-consent-route.test.ts's established
// pattern: getCurrentSession mocked at the module boundary, withRole sees a real `Session` shape). ──
jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));

// ── Fake Prisma plumbing — a stateful, Map-backed fake matching exactly the calls the THREE real
// routes under test make (onboardingSession.create/findFirst/update, user.findUnique/update,
// sponsorship.findFirst, $transaction). Stateful (not a canned per-call mock) so a session created
// by one request is genuinely visible to the NEXT request against the same fake — the same
// "first call's create is genuinely visible to a second call's read" convention already
// established by onboarding-event-bus-e2e.test.ts / onboarding-complete-publish-e2e.test.ts's own
// fake-Prisma helpers. ──
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
      const s = fakeSponsorships.get(where.member_user_id);
      return s ?? null;
    },
  },
  $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
};

jest.mock('@/lib/prisma', () => ({ prisma: fakePrisma }));

const sentEvents: Array<{ name: string; data: unknown }> = [];
jest.mock('@/services/payment/inngest/payment-inngest-functions', () => ({
  InngestOnboardingEventSink: class {
    async publish(event: { event: string }) {
      sentEvents.push({ name: event.event, data: event });
    }
  },
}));

import { getCurrentSession } from '@/lib/auth/session';
import { POST as stepRoute } from '@/app/api/onboarding/step/route';
import { GET as statusRoute } from '@/app/api/onboarding/status/route';
import { POST as completeRoute } from '@/app/api/onboarding/complete/route';

const mockedGetCurrentSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;

function fakeAuthSession(userId: string, role: Role = Role.REP): Session {
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

function actAs(userId: string, role: Role = Role.REP) {
  mockedGetCurrentSession.mockResolvedValue(fakeAuthSession(userId, role));
}

function seedUser(userId: string, overrides: Partial<FakeUserRow> = {}) {
  fakeUsers.set(userId, {
    id: userId,
    role: Role.REP,
    org_type: OrgType.EXTERNAL,
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

async function postComplete() {
  const request = new NextRequest('http://localhost/api/onboarding/complete', { method: 'POST' });
  const response = await completeRoute(request, {});
  const body = await response.json();
  return { response, body };
}

/** Fast-path direct seed (bypasses walking every /step call) for tests that only care about
 *  completion/provisioning behavior, not the step walk itself — mirrors the existing publish-e2e
 *  suite's own `seedSession` helper, just against the new Map-backed fake instead of an array. */
function directlySeedCompletableSession(userId: string, overrides: Partial<FakeOnboardingSessionRow> = {}) {
  idSeq += 1;
  const row: FakeOnboardingSessionRow = {
    id: `sess-direct-${idSeq}`,
    user_id: userId,
    current_step: 'INTENSITY',
    seven_whys: null,
    goal_card: { anchorStatement: 'I build so my children never have to wonder.' },
    intensity_data: { commitmentScore: 8, weeklyHours: 12, riskTolerance: 'MEDIUM', supportNeeds: [] },
    completed: false,
    created_at: new Date(2026, 0, 1, 0, 0, 0, createdAtSeq++),
    ...overrides,
  };
  fakeOnboardingSessions.set(row.id, row);
  return row;
}

afterEach(() => {
  fakeOnboardingSessions.clear();
  fakeUsers.clear();
  fakeSponsorships.clear();
  sentEvents.length = 0;
  mockedGetCurrentSession.mockReset();
});

describe('T-R36 — a real session persists across start (POST /step) -> advance (POST /step)* -> GET /status -> complete (POST /complete)', () => {
  test('the full REP lifecycle walk persists to the SAME real row, and completion reads exactly what was persisted', async () => {
    const userId = 'user-lifecycle-1';
    actAs(userId, Role.REP);
    seedUser(userId, { role: Role.REP, org_type: OrgType.EXTERNAL, gdpr_consent: false });

    // (start) — no session exists yet; the first /step call creates one (current_step defaults to
    // REGISTER, matching the schema default the old in-memory demo also used).
    expect(fakeOnboardingSessions.size).toBe(0);
    const register = await postStep('REGISTER', {});
    expect(register.response.status).toBe(200);
    expect(register.body.currentStep).toBe('ACCOUNT_TYPE'); // ROLE_STEP_MAP[REP][1]
    expect(fakeOnboardingSessions.size).toBe(1); // exactly one row created, not one per call

    // (advance) — walk the REST of REP's real ROLE_STEP_MAP, through steps the OLD 6-value Prisma
    // enum could never have persisted at all (ROLE_ORG_CONTEXT, CONSENT_CAPTURE — this is exactly
    // what this fix's additive enum-widening migration exists for).
    const accountType = await postStep('ACCOUNT_TYPE', {});
    expect(accountType.body.currentStep).toBe('ROLE_ORG_CONTEXT');

    const orgContext = await postStep('ROLE_ORG_CONTEXT', {});
    expect(orgContext.response.status).toBe(200);
    expect(orgContext.body.currentStep).toBe('SEVEN_WHYS');

    const sevenWhys = await postStep('SEVEN_WHYS', { sevenWhys: [{ question: 'q', answer: 'a', score: 80 }] });
    expect(sevenWhys.body.currentStep).toBe('GOAL_CARD');

    const goalCard = await postStep('GOAL_CARD', {
      goalCard: { primaryGoal: 'goal', targetDate: '2027-01-01', commitmentLevel: 8, motivationStatement: 'why', anchorStatement: 'Built for my kids.' },
    });
    expect(goalCard.body.currentStep).toBe('INTENSITY');

    const intensity = await postStep('INTENSITY', {
      intensityData: { commitmentScore: 8, weeklyHours: 10, riskTolerance: 'HIGH', supportNeeds: [] },
    });
    expect(intensity.response.status).toBe(200);
    expect(intensity.body.currentStep).toBe('CONSENT_CAPTURE'); // the real last step (T-21R), now persistable (T-R36)

    // GET /status reflects the SAME persisted row mid-flow (not a per-route copy).
    const midStatus = await getStatus();
    expect(midStatus.body.currentStep).toBe('CONSENT_CAPTURE');
    expect(midStatus.body.completed).toBe(false);
    expect((midStatus.body.intensityData as { commitmentScore: number }).commitmentScore).toBe(8);

    const consentCapture = await postStep('CONSENT_CAPTURE', { gdpr_consent: true });
    expect(consentCapture.response.status).toBe(200);
    expect(consentCapture.body.currentStep).toBe('CONSENT_CAPTURE'); // nothing comes after it (ROLE_STEP_MAP)

    // The durable, versioned GDPR consent write is `/api/onboarding/consent`'s own job (T-21R,
    // WP11 ConsentManager) — not exercised by this route-focused suite. Simulating that it already
    // ran, exactly like this file's other completion tests must, since the completion gate reads
    // this real column.
    fakeUsers.get(userId)!.gdpr_consent = true;

    expect(fakeOnboardingSessions.size).toBe(1); // still exactly one row for this user, the whole way through

    // (complete) — reads the REAL persisted row (never re-seeded/re-created for this call).
    const complete = await postComplete();
    expect(complete.response.status).toBe(200);
    expect(complete.body.completed).toBe(true);
    expect(complete.body.accessTier).toBe(AccessTier.FREE_PAID_EXTERNAL); // EXTERNAL, no sponsor
    expect(complete.body.commitmentScore).toBe(8);

    const persistedSession = [...fakeOnboardingSessions.values()][0];
    expect(persistedSession.completed).toBe(true);
    expect(persistedSession.current_step).toBe('COMPLETE');

    const persistedUser = fakeUsers.get(userId)!;
    expect(persistedUser.access_tier).toBe(AccessTier.FREE_PAID_EXTERNAL);
    expect(persistedUser.commitment_score).toBe(8);
    expect(persistedUser.intensity_setting).toBe(IntensitySetting.HIGH);
    // THE CRITICAL FIX: the real column WP10 provisioning's fail-closed §15.2 precondition reads —
    // never written by the pre-T-R36 route at all.
    expect(persistedUser.onboarding_status).toBe(OnboardingStatus.GATED_COMPLETE);

    expect(sentEvents).toHaveLength(1);
    const published = sentEvents[0].data as OnboardingCompletedEvent;
    expect(published).toEqual({
      event: 'user.onboarding_completed',
      user_id: userId,
      role: Role.REP,
      access_tier: AccessTier.FREE_PAID_EXTERNAL,
      organization: [OrgType.EXTERNAL],
      anchor_statement: 'Built for my kids.',
      intensity_setting: IntensitySetting.HIGH,
    });
  });
});

describe('T-R36 — completion -> published event -> real subscriber chain -> WP10 provisioning, using the REAL onboarding_status this route wrote (not a test-hardcoded dict)', () => {
  test('provisioning succeeds because the completion route itself flipped onboarding_status to GATED_COMPLETE, and a replay of the same event provisions exactly once', async () => {
    const userId = 'user-prov-real-status-1';
    actAs(userId);
    seedUser(userId, { org_type: OrgType.EXTERNAL, gdpr_consent: true });
    directlySeedCompletableSession(userId);

    const { response } = await postComplete();
    expect(response.status).toBe(200);
    expect(sentEvents).toHaveLength(1);

    // Sanity precondition for the assertion below to mean anything: before completion this field
    // was never GATED_COMPLETE (the fake user row seeded above never set it).
    // Now assert the ROUTE'S OWN write is what satisfies WP10's precondition.
    expect(fakeUsers.get(userId)!.onboarding_status).toBe(OnboardingStatus.GATED_COMPLETE);

    // A `ProvisioningPrismaClient` reading from the SAME `fakeUsers` map the completion route wrote
    // into — never a separate, independently-asserted onboarding-status dict. This is what proves
    // the fix closes the real gap (T-R35's own test file's "loop" tests, by necessity, had to
    // pre-seed `OnboardingStatus.GATED_COMPLETE` into a status dict by hand, documenting that this
    // is "what the real Inngest-delivered event would find in production" — an assumption that was
    // NEVER actually true before this fix, since nothing wrote it for real).
    const subscriptions = new Map<string, ProvisionedSubscription>();
    let seq = 0;
    const provisioningPrisma: ProvisioningPrismaClient = {
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
      sponsorship: {
        findFirst: async () => null,
      },
    };

    const contract = projectToWP10(sentEvents[0].data as OnboardingCompletedEvent);
    const first = await provisionFromContract(provisioningPrisma, contract);
    expect(first.provisioned).toBe(true);
    expect(first.subscription.user_id).toBe(userId);
    expect(first.subscription.plan_tier).toBe('free');

    // IDEMPOTENT REPLAY (Inngest at-least-once delivery): running the same real published event
    // through the real chain twice never double-provisions.
    const second = await provisionFromContract(provisioningPrisma, contract);
    expect(second.provisioned).toBe(false);
    expect(second.subscription.id).toBe(first.subscription.id);
    expect(subscriptions.size).toBe(1);
  });

  test('BEFORE the route runs, the same live-row check would have refused (proves the precondition is real, not vacuous)', async () => {
    const userId = 'user-prov-precondition-2';
    seedUser(userId, { org_type: OrgType.EXTERNAL, gdpr_consent: true }); // onboarding_status left unset (IN_PROGRESS-equivalent)

    const provisioningPrisma: ProvisioningPrismaClient = {
      user: {
        findUnique: async ({ where }) => {
          const u = fakeUsers.get(where.id);
          return u ? { onboarding_status: u.onboarding_status ?? OnboardingStatus.IN_PROGRESS } : null;
        },
      },
      subscription: {
        findFirst: async () => null,
        create: async () => {
          throw new Error('must never be called — the precondition must refuse first');
        },
      },
      sponsorship: { findFirst: async () => null },
    };

    await expect(
      provisionFromContract(provisioningPrisma, { user_id: userId, access_tier: AccessTier.FREE_PAID_EXTERNAL })
    ).rejects.toBeInstanceOf(ProvisioningNotAllowedError);
  });
});

describe('T-R36 — auth-binding: a user can only complete THEIR OWN persisted session, fail-closed', () => {
  test('a real, authenticated user with NO session of their own gets an honest 404 — never auto-created, never someone else\'s', async () => {
    const userId = 'user-no-session-at-all';
    actAs(userId);
    // No `directlySeedCompletableSession` call — this user genuinely has none.

    const { response, body } = await postComplete();
    expect(response.status).toBe(404);
    expect(body.error).toBe('Onboarding session not found');
  });

  test('user A completing while user B has a real, fully-qualified session never reads or completes B\'s session', async () => {
    const userA = 'user-A-no-session';
    const userB = 'user-B-has-session';
    seedUser(userB, { org_type: OrgType.EXTERNAL, gdpr_consent: true });
    const bRow = directlySeedCompletableSession(userB);

    // Caller is authenticated as A (a real, verified session — never a forged header, since this
    // route no longer reads any `x-user-*` header at all).
    actAs(userA);

    const { response, body } = await postComplete();
    expect(response.status).toBe(404); // A has no session; B's is never substituted
    expect(body.error).toBe('Onboarding session not found');

    // B's own session is completely untouched by A's request.
    expect(fakeOnboardingSessions.get(bRow.id)!.completed).toBe(false);
    expect(sentEvents).toHaveLength(0); // never published on A's behalf, and never for B either
  });

  test('the status route has the identical binding property — never leaks another user\'s onboarding state', async () => {
    const userA = 'user-A-status';
    const userB = 'user-B-status';
    seedUser(userB);
    directlySeedCompletableSession(userB, { current_step: 'GOAL_CARD' });

    actAs(userA);
    const { response, body } = await getStatus();
    expect(response.status).toBe(404);
    expect(body.error).toBe('Onboarding session not found');
  });
});
