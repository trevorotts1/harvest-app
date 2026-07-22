// T-R35 (P1 fix) — proves the DEAD WIRE is now LIVE: reaching `gated_complete` through the REAL
// completion route (`POST /api/onboarding/complete`) actually publishes `user.onboarding_completed`
// through the production Inngest sink, and that published event — run through the exact chain the
// real registered subscriber runs (`projectToWP10` -> `provisionFromContract`, same as
// payment-inngest-functions.ts's `provisionOnOnboardingCompletedFunction` handler body) — actually
// provisions WP10.
//
// Split from (additive to, not a duplicate of):
//   - tests/unit/onboarding.test.ts — proves the route's §6.7 access-tier sourcing/GDPR-gate
//     behavior; now also mocks this same Inngest boundary so those pre-existing tests keep passing,
//     but makes no assertion on the published event itself.
//   - tests/unit/onboarding-event-bus-e2e.test.ts — proves the publish -> project -> provision
//     contract end-to-end starting from a HAND-BUILT `OnboardingCompletedInput` fed straight to
//     `emitOnboardingCompleted` + the in-memory test sink. It explicitly documents (as of T-58) that
//     nothing in the live app actually calls that sink from a real HTTP entry point — THIS suite is
//     the fix for exactly that gap: the event under test here is never hand-built, it is whatever
//     the real route (`src/app/api/onboarding/complete/route.ts`) actually published.
//
// The real subscriber's own file (payment-inngest-functions.ts) imports the ESM-only `inngest`
// package and so cannot load under Jest — mocked below the same module-boundary way
// tests/unit/agent-dispatch-route.test.ts mocks `InngestDurableQueue`, capturing the exact
// `{ name, data }` the route handed to `inngest.send`.

import { NextRequest } from 'next/server';
import { AccessTier, OnboardingStatus, Role, IntensitySetting, OrgType, SponsorshipState } from '@prisma/client';
import type { Session } from 'next-auth';

const sentEvents: Array<{ name: string; data: unknown }> = [];
let publishOverride: ((event: unknown) => void | Promise<void>) | null = null;
jest.mock('@/services/payment/inngest/payment-inngest-functions', () => ({
  InngestOnboardingEventSink: class {
    async publish(event: unknown) {
      if (publishOverride) {
        return publishOverride(event);
      }
      sentEvents.push({ name: (event as { event: string }).event, data: event });
    }
  },
}));

// T-R36 — the route under test now reads a REAL persisted `OnboardingSession` row via a REAL
// Auth.js session (never the retired in-memory `sessions`/`users` arrays or an `x-user-id` header).
// Faked at the module boundary exactly like tests/unit/onboarding.test.ts's own T-R36 update and
// tests/unit/onboarding-session-persistence.test.ts (this fix's dedicated suite) — a stateful,
// Map-backed fake so this suite's own intent (proving the REAL route publishes exactly the right
// event, in the right order, idempotently) is unchanged.
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
  access_tier?: AccessTier;
  commitment_score?: number;
  intensity_setting?: IntensitySetting;
  onboarding_status?: OnboardingStatus;
}

const fakeOnboardingSessions = new Map<string, FakeOnboardingSessionRow>();
const fakeOnboardingUsers = new Map<string, FakeUserRow>();
const fakeOnboardingSponsorships = new Map<string, { sponsor_user_id: string }>();
let fakeRowSeq = 0;

const fakeOnboardingPrisma = {
  onboardingSession: {
    findFirst: async ({ where }: { where: { user_id: string } }) => {
      const rows = [...fakeOnboardingSessions.values()].filter((r) => r.user_id === where.user_id);
      if (rows.length === 0) return null;
      return rows.reduce((a, b) => (a.created_at >= b.created_at ? a : b));
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = fakeOnboardingSessions.get(where.id);
      if (!row) throw new Error(`no fake onboarding session ${where.id}`);
      Object.assign(row, data);
      return row;
    },
  },
  user: {
    findUnique: async ({ where }: { where: { id: string } }) => fakeOnboardingUsers.get(where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = fakeOnboardingUsers.get(where.id);
      if (!row) throw new Error(`no fake user ${where.id}`);
      Object.assign(row, data);
      return row;
    },
  },
  sponsorship: {
    findFirst: async ({ where }: { where: { member_user_id: string; state: string } }) => {
      if (where.state !== SponsorshipState.ACTIVE) return null;
      return fakeOnboardingSponsorships.get(where.member_user_id) ?? null;
    },
  },
  $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
};

jest.mock('@/lib/prisma', () => ({ prisma: fakeOnboardingPrisma }));

import { getCurrentSession } from '@/lib/auth/session';
import { POST as completeOnboarding } from '@/app/api/onboarding/complete/route';
import { projectToWP10 } from '@/services/onboarding/wp01/downstream-contracts';
import type { OnboardingCompletedEvent } from '@/types/onboarding';
import {
  ProvisioningNotAllowedError,
  provisionFromContract,
  type ProvisioningPrismaClient,
  type ProvisionedSubscription,
} from '@/services/payment/provisioning';

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

/** Same stateful (Map-backed) fake Prisma convention as onboarding-event-bus-e2e.test.ts — a first
 *  `provisionFromContract` call's `subscription.create` is genuinely visible to a second call's
 *  `subscription.findFirst`, so idempotency is proven against real state, not a canned mock. */
function createFakeProvisioningPrisma(onboardingStatusByUser: Record<string, OnboardingStatus>) {
  const subscriptions = new Map<string, ProvisionedSubscription>();
  const sponsorships = new Map<string, string>();
  let seq = 0;

  const prisma: ProvisioningPrismaClient = {
    user: {
      findUnique: async ({ where }) => {
        const status = onboardingStatusByUser[where.id];
        return status === undefined ? null : { onboarding_status: status };
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
      findFirst: async ({ where }) => {
        const sponsorUserId = sponsorships.get(where.member_user_id);
        return sponsorUserId ? { sponsor_user_id: sponsorUserId } : null;
      },
    },
  };

  return { prisma, subscriptions, sponsorships };
}

/** Runs the EXACT sequence `provisionOnOnboardingCompletedFunction`'s handler body runs
 *  (payment-inngest-functions.ts:62-66) against the REAL published event data. */
function runRealSubscriberChain(prisma: ProvisioningPrismaClient, publishedEventData: unknown) {
  const contract = projectToWP10(publishedEventData as OnboardingCompletedEvent);
  return provisionFromContract(prisma, contract);
}

// T-R36: `role`/`org_type`/`sponsor_id`/`gdpr_consent` are real `User`/`Sponsorship` signals now —
// split here the same way tests/unit/onboarding.test.ts's own T-R36 update splits them. Also arms
// the mocked real session (`getCurrentSession`) for this user, since the route trusts only that now.
function seedSession(userId: string, overrides: Record<string, unknown> = {}) {
  const { role, org_type, sponsor_id, gdpr_consent, intensity_data, goal_card, current_step, ...rest } = overrides;
  const resolvedRole = (role as Role) ?? Role.REP;
  fakeOnboardingUsers.set(userId, {
    id: userId,
    role: resolvedRole,
    org_type: (org_type as OrgType) ?? OrgType.EXTERNAL,
    gdpr_consent: gdpr_consent ?? true,
  });
  if (sponsor_id) {
    fakeOnboardingSponsorships.set(userId, { sponsor_user_id: sponsor_id as string });
  }
  fakeRowSeq += 1;
  fakeOnboardingSessions.set(`sess-${fakeRowSeq}`, {
    id: `sess-${fakeRowSeq}`,
    user_id: userId,
    current_step: (current_step as string) ?? 'INTENSITY',
    seven_whys: null,
    goal_card: goal_card !== undefined ? goal_card : { anchorStatement: 'I build so my children never have to wonder.' },
    intensity_data:
      intensity_data ?? { commitmentScore: 8, weeklyHours: 12, riskTolerance: 'MEDIUM', supportNeeds: [] },
    completed: false,
    created_at: new Date(2026, 0, 1, 0, 0, fakeRowSeq),
    ...rest,
  });
  mockedGetCurrentSession.mockResolvedValue(fakeAuthSession(userId, resolvedRole));
}

function persistedSession(userId: string) {
  return [...fakeOnboardingSessions.values()].find((s) => s.user_id === userId);
}

async function complete(userId: string) {
  // `userId` is no longer read from a header — it's whichever user `seedSession` last armed the
  // mocked real session for. Kept as a parameter so call sites below stay unchanged.
  void userId;
  const request = new NextRequest('http://localhost/api/onboarding/complete', { method: 'POST' });
  const response = await completeOnboarding(request, {});
  const body = await response.json();
  return { response, body };
}

describe('T-R35 — completion route actually publishes user.onboarding_completed (the previously-dead wire)', () => {
  afterEach(() => {
    fakeOnboardingSessions.clear();
    fakeOnboardingUsers.clear();
    fakeOnboardingSponsorships.clear();
    sentEvents.length = 0;
    publishOverride = null;
    mockedGetCurrentSession.mockReset();
  });

  describe('(1) the route publishes, with the exact declared payload shape, from real session data', () => {
    test('a successful completion publishes exactly one event, name === "user.onboarding_completed"', async () => {
      seedSession('user-pub-1');
      const { response } = await complete('user-pub-1');

      expect(response.status).toBe(200);
      expect(sentEvents).toHaveLength(1);
      expect(sentEvents[0].name).toBe('user.onboarding_completed');
    });

    test('the published payload carries exactly the 7 declared OnboardingCompletedEvent fields — no more, no less', async () => {
      seedSession('user-pub-2');
      await complete('user-pub-2');

      expect(Object.keys(sentEvents[0].data as object).sort()).toEqual(
        ['access_tier', 'anchor_statement', 'event', 'intensity_setting', 'organization', 'role', 'user_id'].sort()
      );
    });

    // T-R38: this test's `role` is deliberately `REP` (was `UPLINE` before T-R38) — the route's
    // intensity precondition is now role-aware (only REP/DUAL's `ROLE_STEP_MAP` includes
    // `OnboardingStep.INTENSITY`), so `intensity_setting` is only ever sourced from this session's
    // own `intensity_data.riskTolerance` for a role that actually has that step; for a role that
    // doesn't (UPLINE/RVP/ADMIN), the route now applies a documented `LOW` default REGARDLESS of
    // what a session row's `intensity_data` happens to contain — see
    // tests/unit/onboarding-role-aware-completion.test.ts for that dedicated coverage. Keeping this
    // test on a role that legitimately has the step is what makes "every field is sourced from this
    // session's own real data" still literally true here.
    test('every field is sourced from this session\'s own real data — user_id, role, access_tier (§6.7 signals, not commitment score), organization, anchor_statement, intensity_setting', async () => {
      seedSession('user-pub-3', {
        role: Role.REP,
        org_type: OrgType.PRIMERICA,
        sponsor_id: null, // Primerica org context alone implies sponsorship (§6.7) — see onboarding.test.ts
        intensity_data: { commitmentScore: 9, weeklyHours: 20, riskTolerance: 'HIGH', supportNeeds: [] },
        goal_card: { anchorStatement: 'Built for my kids.' },
      });

      const { body } = await complete('user-pub-3');
      const published = sentEvents[0].data as OnboardingCompletedEvent;

      expect(published).toEqual({
        event: 'user.onboarding_completed',
        user_id: 'user-pub-3',
        role: Role.REP,
        access_tier: AccessTier.FREE_ORG_LINKED, // Primerica org context => sponsored, per body.accessTier below
        organization: [OrgType.PRIMERICA],
        anchor_statement: 'Built for my kids.',
        intensity_setting: IntensitySetting.HIGH, // from intensity_data.riskTolerance — identical literal values
      });
      expect(body.accessTier).toBe(AccessTier.FREE_ORG_LINKED); // sanity: matches what the route itself returned
    });

    // TEETH: a track that never ran Seven Whys (dense upline/RVP tracks, §6.4) has no goal_card /
    // no anchorStatement — downstream-contracts.ts's own documented convention is `''`, never
    // null/undefined (the base event's field is a non-nullable string). Proves the route follows
    // that convention rather than crashing or leaking `undefined` onto the wire.
    test('no goal_card (dense track, never ran Seven Whys) publishes anchor_statement: "" — not null/undefined', async () => {
      seedSession('user-pub-no-anchor', { goal_card: null });
      await complete('user-pub-no-anchor');

      const published = sentEvents[0].data as OnboardingCompletedEvent;
      expect(published.anchor_statement).toBe('');
    });
  });

  // (2) THE FULL LOOP — completion -> published event -> the REAL subscriber's own chain
  // (projectToWP10 -> provisionFromContract) -> an actual provisioned subscription. This is the
  // exact loop that was dead before T-R35 (nothing published, so the registered subscriber never
  // ran against a real completion).
  describe('(2) completion -> published event -> real subscriber chain -> WP10 actually provisions', () => {
    test('the published event, run through the real subscriber chain, provisions per the real access_tier', async () => {
      seedSession('user-loop-1', {
        org_type: OrgType.EXTERNAL,
        sponsor_id: null, // no sponsor, external => FREE_PAID_EXTERNAL (never PAID_INDIVIDUAL by commitment score)
      });
      const { response } = await complete('user-loop-1');
      expect(response.status).toBe(200);
      expect(sentEvents).toHaveLength(1);

      // The live User row is GATED_COMPLETE by the time the subscriber actually runs (§15.2
      // precondition) — this is what the real Inngest-delivered event would find in production.
      const { prisma } = createFakeProvisioningPrisma({ 'user-loop-1': OnboardingStatus.GATED_COMPLETE });
      const result = await runRealSubscriberChain(prisma, sentEvents[0].data);

      expect(result.provisioned).toBe(true);
      expect(result.subscription.user_id).toBe('user-loop-1');
      expect(result.subscription.plan_tier).toBe('free'); // FREE_PAID_EXTERNAL -> 'free' plan tier (tiers.ts)
      expect(result.subscription.org_sponsored).toBe(false); // FREE_PAID_EXTERNAL is not the sponsored tier
    });

    test('a sponsored (org-linked) completion provisions free/no-card, sponsor linked from the live Sponsorship row', async () => {
      seedSession('user-loop-2', { org_type: OrgType.EXTERNAL, sponsor_id: 'sponsor-1' });
      await complete('user-loop-2');

      const { prisma, sponsorships } = createFakeProvisioningPrisma({ 'user-loop-2': OnboardingStatus.GATED_COMPLETE });
      sponsorships.set('user-loop-2', 'sponsor-99');
      const result = await runRealSubscriberChain(prisma, sentEvents[0].data);

      expect(result.provisioned).toBe(true);
      expect(result.subscription.org_sponsored).toBe(true);
      expect(result.subscription.sponsor_user_id).toBe('sponsor-99');
    });

    // Ordering-independence / fail-closed precondition (provisioning.ts's own guarantee) — proven
    // here against a REAL published event, not a hand-built one: the event can fire before the DB
    // reflects GATED_COMPLETE, and provisioning still refuses.
    test('if the live row is not yet GATED_COMPLETE when the subscriber runs, provisioning is refused — fail-closed', async () => {
      seedSession('user-loop-early');
      await complete('user-loop-early');

      const { prisma, subscriptions } = createFakeProvisioningPrisma({ 'user-loop-early': OnboardingStatus.IN_PROGRESS });
      await expect(runRealSubscriberChain(prisma, sentEvents[0].data)).rejects.toBeInstanceOf(ProvisioningNotAllowedError);
      expect(subscriptions.size).toBe(0);
    });
  });

  // (3) IDEMPOTENT REPLAY — Inngest is at-least-once delivery; a redelivery/retry of the SAME
  // published event must never double-provision. Proven against a REAL published event (from the
  // real route), run through the real chain TWICE, against a stateful fake where the first call's
  // create is genuinely visible to the second call's findFirst.
  describe('(3) idempotent replay of the REAL published event never double-provisions', () => {
    test('running the same published event through the real chain twice provisions once', async () => {
      seedSession('user-idem-1', { org_type: OrgType.PRIMERICA }); // Primerica => FREE_ORG_LINKED
      await complete('user-idem-1');
      expect(sentEvents).toHaveLength(1);

      const { prisma, subscriptions } = createFakeProvisioningPrisma({ 'user-idem-1': OnboardingStatus.GATED_COMPLETE });

      const first = await runRealSubscriberChain(prisma, sentEvents[0].data);
      const second = await runRealSubscriberChain(prisma, sentEvents[0].data); // Inngest replay/retry

      expect(first.provisioned).toBe(true);
      expect(second.provisioned).toBe(false);
      expect(second.subscription.id).toBe(first.subscription.id);
      expect(subscriptions.size).toBe(1);
    });
  });

  // (4) THE ROUTE ITSELF CANNOT DOUBLE-PUBLISH ON A CALLER RETRY — `session.completed` blocks a
  // second POST outright once completion has actually succeeded, so a client retrying the same
  // request after receiving a 200 can never fire a second `user.onboarding_completed`.
  describe('(4) a caller retry after a successful completion cannot publish a second event', () => {
    test('POSTing /complete again for an already-completed session is rejected and publishes nothing further', async () => {
      seedSession('user-retry-1');
      const first = await complete('user-retry-1');
      expect(first.response.status).toBe(200);
      expect(sentEvents).toHaveLength(1);

      const second = await complete('user-retry-1');
      expect(second.response.status).toBe(400);
      expect(second.body.error).toBe('Onboarding already completed');
      expect(sentEvents).toHaveLength(1); // still just the one, real publish
    });
  });

  // (5) FAIL-CLOSED ON A PUBLISH FAILURE — a transient Inngest/network fault must surface as a real
  // error, never a silently-swallowed 200, and must leave the session retryable rather than stuck
  // "completed" with no record anything was ever published.
  describe('(5) a publish failure fails closed, is never swallowed, and leaves the session retryable', () => {
    test('inngest.send throwing surfaces as a 500 and does NOT mark the session completed', async () => {
      seedSession('user-fail-1');
      publishOverride = () => {
        throw new Error('simulated transient Inngest fault');
      };

      const { response, body } = await complete('user-fail-1');

      expect(response.status).toBe(500);
      expect(body.error).toBe('Internal server error');
      expect(sentEvents).toHaveLength(0); // never recorded as sent
      const session = persistedSession('user-fail-1');
      expect(session?.completed).toBe(false); // NOT marked complete — safe to retry
    });

    test('retrying after the transient fault clears succeeds and publishes exactly once', async () => {
      seedSession('user-fail-2');
      publishOverride = () => {
        throw new Error('simulated transient Inngest fault');
      };
      const failed = await complete('user-fail-2');
      expect(failed.response.status).toBe(500);

      publishOverride = null; // the fault clears
      const retried = await complete('user-fail-2');

      expect(retried.response.status).toBe(200);
      expect(retried.body.completed).toBe(true);
      expect(sentEvents).toHaveLength(1); // exactly one real publish across both attempts
    });
  });
});
