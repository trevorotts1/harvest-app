// T-R37 — MAPPING-DRIFT-PROOF integration test.
//
// The unit suite (tests/unit/onboarding-step-client.test.ts) proves the client module's payload
// builders/sequencer behave correctly IN ISOLATION, against a MOCK `/step` route. That alone can't
// catch a mapping drift — if the builders ever produced a shape the REAL route rejects (wrong key
// casing, wrong step order, a payload the real `validateStep` gate refuses), a mock-only test would
// still pass while a real user's browser 400s.
//
// This suite closes that gap: it imports the REAL route handlers (`POST` from
// `src/app/api/onboarding/step/route.ts` and `src/app/api/onboarding/complete/route.ts` — not a
// re-implementation) and feeds them EXACTLY what `OnboardingFlow.tsx`/`UplineTrack.tsx` would send —
// built via the SAME exported functions the component calls
// (`REP_SCREEN_STEP_PLAN`, `buildRoleOrgContextPayload`, `buildSevenWhysResponses`,
// `buildGoalCardPayload`, `buildIntensityDataPayload`, `buildDenseTrackStepPlan`) — never hand-typed
// duplicate fixtures. If the client mapping ever drifts (wrong order, wrong key), THIS test fails
// against the real `validateStep`/`getNextStep`, the same way a real user's request would.
//
// The fake-Prisma/fake-session/fake-Inngest harness below mirrors the ALREADY-established T-R36
// pattern in tests/unit/onboarding-session-persistence.test.ts (same call shapes, same stateful
// Map-backed fakes) — a fresh, self-contained copy so this suite never risks perturbing that
// existing, already-passing regression suite.

import { NextRequest } from 'next/server';
import { AccessTier, IntensitySetting, OnboardingStatus, OrgType, Role, SponsorshipState } from '@prisma/client';
import type { Session } from 'next-auth';

import { MIN_COMMITMENT_SCORE, OnboardingStep, ROLE_STEP_MAP } from '@/types/onboarding';
import {
  REP_SCREEN_STEP_PLAN,
  buildDenseTrackStepPlan,
  buildGoalCardPayload,
  buildIntensityDataPayload,
  buildRoleOrgContextPayload,
  buildSevenWhysResponses,
} from '@/app/onboarding/onboarding-step-client';

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

function seedUser(userId: string, role: Role, orgType: OrgType) {
  fakeUsers.set(userId, { id: userId, role, org_type: orgType, gdpr_consent: false });
}

async function postStep(step: OnboardingStep, data: Record<string, unknown>) {
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

afterEach(() => {
  fakeOnboardingSessions.clear();
  fakeUsers.clear();
  fakeSponsorships.clear();
  sentEvents.length = 0;
  mockedGetCurrentSession.mockReset();
});

describe('REP track — REP_SCREEN_STEP_PLAN payloads run through the REAL /step + /complete routes', () => {
  test('the exact client-built payload sequence, in REP_SCREEN_STEP_PLAN order, clears every real gate through to /complete (EXTERNAL org)', async () => {
    const userId = 'rep-external-1';
    actAs(userId, Role.REP);
    seedUser(userId, Role.REP, OrgType.EXTERNAL);

    // (identity screen) REGISTER, ACCOUNT_TYPE
    for (const step of REP_SCREEN_STEP_PLAN.identity!) {
      const { response, body } = await postStep(step, {});
      expect(response.status).toBe(200);
      void body;
    }

    // (org screen) ROLE_ORG_CONTEXT — built via the SAME function OnboardingFlow.tsx calls.
    const orgPayload = buildRoleOrgContextPayload(OrgType.EXTERNAL, '');
    for (const step of REP_SCREEN_STEP_PLAN.org!) {
      const { response, body } = await postStep(step, orgPayload);
      expect(response.status).toBe(200);
      expect(body.currentStep).toBe('SEVEN_WHYS');
    }

    // (seven_whys screen completion) SEVEN_WHYS -> GOAL_CARD -> INTENSITY, in THAT exact order —
    // the crux mapping this whole fix exists for. Built with real answer text + a real intensity
    // selection, exactly like `handleSevenWhysContinue` does.
    const whyAnswers = [
      'Replace my day job income within two years.',
      'My daughter starts school next year and I refuse to miss it.',
      'I tried once before and gave up after three months.',
      'I never had anyone to show me the actual steps.',
      'That nothing changes and I watch the same year repeat forever.',
      'The version of me who never has to check a bank balance in fear.',
      'Yes — I am ready to do the work this takes.',
    ];
    const sevenWhysPayload = buildSevenWhysResponses(
      whyAnswers.map((answer, i) => ({ question: `Q${i + 1}`, answer }))
    );
    const anchorStatement = 'You build so your daughter never has to wonder.';
    const goalCardPayload = buildGoalCardPayload({
      anchorStatement,
      primaryGoal: whyAnswers[0],
      motivationStatement: whyAnswers[1],
      intensity: IntensitySetting.HIGH,
    });
    const intensityPayload = buildIntensityDataPayload(IntensitySetting.HIGH);

    const chain = REP_SCREEN_STEP_PLAN.seven_whys!;
    expect(chain).toEqual([OnboardingStep.SEVEN_WHYS, OnboardingStep.GOAL_CARD, OnboardingStep.INTENSITY]);

    const sevenWhysResult = await postStep(chain[0], { sevenWhys: sevenWhysPayload });
    expect(sevenWhysResult.response.status).toBe(200);
    expect(sevenWhysResult.body.currentStep).toBe('GOAL_CARD');

    const goalCardResult = await postStep(chain[1], { goalCard: goalCardPayload });
    expect(goalCardResult.response.status).toBe(200);
    expect(goalCardResult.body.currentStep).toBe('INTENSITY');

    const intensityResult = await postStep(chain[2], { intensityData: intensityPayload });
    expect(intensityResult.response.status).toBe(200);
    expect(intensityResult.body.currentStep).toBe('CONSENT_CAPTURE');

    // (consent screen) CONSENT_CAPTURE — exactly the payload handleGrantGdprConsent sends.
    expect(REP_SCREEN_STEP_PLAN.consent).toEqual([OnboardingStep.CONSENT_CAPTURE]);
    const consentStepResult = await postStep(REP_SCREEN_STEP_PLAN.consent![0], { gdpr_consent: true });
    expect(consentStepResult.response.status).toBe(200);

    // Simulate the REAL, separate `/api/onboarding/consent` route's own durable write (WP11) — not
    // under test here (see onboarding-consent-route.test.ts for that route's own suite).
    fakeUsers.get(userId)!.gdpr_consent = true;

    // (first48 screen) POST /complete — the terminal call.
    const complete = await postComplete();
    expect(complete.response.status).toBe(200);
    expect(complete.body.completed).toBe(true);

    const persistedUser = fakeUsers.get(userId)!;
    expect(persistedUser.onboarding_status).toBe(OnboardingStatus.GATED_COMPLETE); // the gate column
    expect(sentEvents).toHaveLength(1);
    expect((sentEvents[0].data as { anchor_statement: string }).anchor_statement).toBe(anchorStatement);
  });

  test('a PRIMERICA rep\'s ROLE_ORG_CONTEXT payload (built by buildRoleOrgContextPayload) clears the REAL solution-number format gate', async () => {
    const userId = 'rep-primerica-1';
    actAs(userId, Role.REP);
    seedUser(userId, Role.REP, OrgType.PRIMERICA);

    await postStep(OnboardingStep.REGISTER, {});
    await postStep(OnboardingStep.ACCOUNT_TYPE, {});

    const payload = buildRoleOrgContextPayload(OrgType.PRIMERICA, '1234567');
    const { response, body } = await postStep(OnboardingStep.ROLE_ORG_CONTEXT, payload);
    expect(response.status).toBe(200);
    expect(body.currentStep).toBe('SEVEN_WHYS');
  });

  // T-R57 (operator directive 2026-07-28): the format gate this canary exercises was relaxed from a
  // fixed-7-digit-only rule to any alphanumeric combination — '123' (a short digit string) is now a
  // VALID solution number under that rule, so it can no longer serve as the "malformed" input here.
  // Use a genuinely malformed value instead (a disallowed symbol) so this canary still proves the
  // real gate is live-enforced, not a vacuous pass.
  test('MAPPING-DRIFT CANARY: a malformed solution number (built the same way, but not a valid alphanumeric identifier) is REJECTED by the real gate — proving this is a real, live-enforced check, not a vacuous pass', async () => {
    const userId = 'rep-primerica-bad-1';
    actAs(userId, Role.REP);
    seedUser(userId, Role.REP, OrgType.PRIMERICA);
    await postStep(OnboardingStep.REGISTER, {});
    await postStep(OnboardingStep.ACCOUNT_TYPE, {});

    const payload = buildRoleOrgContextPayload(OrgType.PRIMERICA, '!!!'); // not alphanumeric
    const { response } = await postStep(OnboardingStep.ROLE_ORG_CONTEXT, payload);
    expect(response.status).toBe(400);
  });

  // SANITY (T-R57): the mapping's other half — an alphanumeric value the OLD fixed-7-digit rule
  // would have rejected (not 7 digits, contains letters) now clears the REAL gate end-to-end.
  test('SANITY: an alphanumeric (non-7-digit) solution number is ACCEPTED by the real gate — proves the fixed-7-digit dead-end bug is fixed end-to-end', async () => {
    const userId = 'rep-primerica-good-alnum-1';
    actAs(userId, Role.REP);
    seedUser(userId, Role.REP, OrgType.PRIMERICA);
    await postStep(OnboardingStep.REGISTER, {});
    await postStep(OnboardingStep.ACCOUNT_TYPE, {});

    const payload = buildRoleOrgContextPayload(OrgType.PRIMERICA, 'SOL-2024');
    const { response, body } = await postStep(OnboardingStep.ROLE_ORG_CONTEXT, payload);
    expect(response.status).toBe(200);
    expect(body.currentStep).toBe('SEVEN_WHYS');
  });
});

describe('Dense track (UPLINE/RVP/ADMIN) — buildDenseTrackStepPlan payloads run through the REAL /step + /complete routes', () => {
  // FORMERLY A DOCUMENTED SERVER-SIDE BLOCKER (T-R37 finding), FIXED BY T-R38:
  //
  // `/api/onboarding/complete` used to require `onboardingRow.intensity_data` to be non-null
  // (route.ts's old lines ~99-108: "Intensity data is required before completing onboarding") and
  // `commitmentScore >= 5` UNCONDITIONALLY, regardless of role. But `OnboardingStep.INTENSITY` is
  // ONLY a member of `ROLE_STEP_MAP[REP]` and `ROLE_STEP_MAP[DUAL]` (types/onboarding.ts) —
  // UPLINE, RVP, and ADMIN's real `ROLE_STEP_MAP`s never include it, so their `intensity_data`
  // column could never be populated by any real, in-order `/step` walk, and their `/complete` was
  // permanently 400. T-R38 makes that precondition ROLE-AWARE (`roleRequiresIntensity` in
  // route.ts, gated on the SAME `ROLE_STEP_MAP` source of truth): a role without the INTENSITY
  // step now completes without it, with `intensity_setting` set to the documented, operator-
  // reviewable `LOW` default (see route.ts's own T-R38 comment for the downstream-consumer
  // justification) rather than being permanently blocked. The tests below now assert the FIXED,
  // current (unblocked) behavior — see tests/unit/onboarding-role-aware-completion.test.ts for the
  // dedicated T-R38 suite (all 5 roles, idempotency, publish-before-mutate, the LOW default, and
  // REP/DUAL's requirement staying intact).
  test.each([Role.UPLINE, Role.RVP] as const)(
    'FIXED (T-R38): %s completes their FULL real ROLE_STEP_MAP + CONSENT_CAPTURE + real GDPR consent, and /complete now reaches GATED_COMPLETE',
    async (role) => {
      const userId = `dense-${role}-1`;
      actAs(userId, role);
      seedUser(userId, role, OrgType.EXTERNAL);

      const plan = buildDenseTrackStepPlan(role, OrgType.EXTERNAL, '');
      for (const item of plan) {
        const { response } = await postStep(item.step, item.data);
        expect(response.status).toBe(200); // every /step call in the real ROLE_STEP_MAP walk succeeds
      }
      const { response: consentStepResponse, body: consentStepBody } = await postStep(OnboardingStep.CONSENT_CAPTURE, {
        gdpr_consent: true,
      });
      expect(consentStepResponse.status).toBe(200);
      expect(consentStepBody.currentStep).toBe('CONSENT_CAPTURE');

      fakeUsers.get(userId)!.gdpr_consent = true; // the real /api/onboarding/consent write, simulated

      // Every precondition the client wiring controls is satisfied (real progression, real
      // consent) — and, as of T-R38, /complete no longer refuses a role with no INTENSITY step.
      const complete = await postComplete();
      expect(complete.response.status).toBe(200);
      expect(complete.body.completed).toBe(true);
      expect(fakeUsers.get(userId)!.onboarding_status).toBe(OnboardingStatus.GATED_COMPLETE);
      expect(fakeUsers.get(userId)!.intensity_setting).toBe(IntensitySetting.LOW); // T-R38's documented default
    }
  );

  test('FIXED (T-R38): ADMIN (its minimal ROLE_STEP_MAP has no INTENSITY step either) also now reaches GATED_COMPLETE', async () => {
    const userId = 'dense-admin-1';
    actAs(userId, Role.ADMIN);
    seedUser(userId, Role.ADMIN, OrgType.EXTERNAL);

    const plan = buildDenseTrackStepPlan(Role.ADMIN, OrgType.EXTERNAL, '');
    expect(plan.map((p) => p.step)).toEqual([OnboardingStep.REGISTER]);
    for (const item of plan) {
      const { response } = await postStep(item.step, item.data);
      expect(response.status).toBe(200);
    }
    await postStep(OnboardingStep.CONSENT_CAPTURE, { gdpr_consent: true });
    fakeUsers.get(userId)!.gdpr_consent = true;
    const complete = await postComplete();
    expect(complete.response.status).toBe(200);
    expect(complete.body.completed).toBe(true);
    expect(fakeUsers.get(userId)!.onboarding_status).toBe(OnboardingStatus.GATED_COMPLETE);
    expect(fakeUsers.get(userId)!.intensity_setting).toBe(IntensitySetting.LOW);
  });

  test('DUAL\'s full plan (rep-derived steps included, with the documented MIN_COMMITMENT_SCORE placeholder) clears every real gate through to /complete', async () => {
    const userId = 'dense-dual-1';
    actAs(userId, Role.DUAL);
    seedUser(userId, Role.DUAL, OrgType.EXTERNAL);

    const plan = buildDenseTrackStepPlan(Role.DUAL, OrgType.EXTERNAL, '');
    expect(plan.map((p) => p.step)).toEqual(ROLE_STEP_MAP[Role.DUAL].filter((s) => s !== OnboardingStep.CONSENT_CAPTURE));
    for (const item of plan) {
      const { response, body } = await postStep(item.step, item.data);
      expect(response.status).toBe(200);
      // The real INTENSITY gate (commitmentScore >= MIN_COMMITMENT_SCORE) must actually be CLEARED
      // by the placeholder, not merely present — proves the placeholder is real-gate-passing, not
      // just shaped correctly.
      if (item.step === OnboardingStep.INTENSITY) {
        expect((item.data.intensityData as { commitmentScore: number }).commitmentScore).toBeGreaterThanOrEqual(
          MIN_COMMITMENT_SCORE
        );
      }
      void body;
    }
    await postStep(OnboardingStep.CONSENT_CAPTURE, { gdpr_consent: true });
    fakeUsers.get(userId)!.gdpr_consent = true;
    const complete = await postComplete();
    expect(complete.response.status).toBe(200);
    expect(fakeUsers.get(userId)!.onboarding_status).toBe(OnboardingStatus.GATED_COMPLETE);
  });

  // T-R38 note: this specific scenario — no persisted `User.solution_number` at all — is still
  // EXPECTED to 400; that is correct, fail-closed behavior (never fabricate a number), not a
  // remaining gap. T-R38's fix is a server-side REUSE of an already-persisted value (added a
  // decrypt fallback in `/step`'s route, `decryptSolutionNumberFromStorage`) — it deliberately does
  // NOT add a UI capture field, so a user who was NEVER given a solution number at §6.3
  // registration genuinely has none to reuse. See
  // tests/unit/onboarding-role-aware-completion.test.ts's "(2) Primerica dense-track solution_number
  // reuse" suite for the now-fixed "persisted value exists" case this same route now clears.
  test('a PRIMERICA dense-track user with no locally-available AND no persisted solution number still 400s at ROLE_ORG_CONTEXT against the REAL route (an honest fail-closed surfaced error, not a silent skip/hack)', async () => {
    const userId = 'dense-upline-primerica-1';
    actAs(userId, Role.UPLINE);
    seedUser(userId, Role.UPLINE, OrgType.PRIMERICA);

    const plan = buildDenseTrackStepPlan(Role.UPLINE, OrgType.PRIMERICA, '');
    await postStep(OnboardingStep.REGISTER, {});
    await postStep(OnboardingStep.ACCOUNT_TYPE, {});
    const orgItem = plan.find((p) => p.step === OnboardingStep.ROLE_ORG_CONTEXT)!;
    const { response } = await postStep(OnboardingStep.ROLE_ORG_CONTEXT, orgItem.data);
    expect(response.status).toBe(400);
  });
});
