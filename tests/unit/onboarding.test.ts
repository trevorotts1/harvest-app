import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

import { OnboardingService } from '../../src/services/onboarding/service';
import { OnboardingStep, Role, OrgType, AccessTier, ROLE_VISIBILITY, type OnboardingSession } from '../../src/types/onboarding';

// T-R35 (P1 fix): the completion route now publishes `user.onboarding_completed` through
// `InngestOnboardingEventSink` (dynamically imported at request time — see route.ts's own header
// comment on why). That sink's module imports the ESM-only `inngest` package, which cannot load
// under Jest's CJS runtime — mocked here the same module-boundary way
// tests/unit/agent-dispatch-route.test.ts mocks `InngestDurableQueue`, so this suite never loads the
// real `inngest` package and can capture exactly what the route published.
const sentOnboardingEvents: Array<{ name: string; data: unknown }> = [];
jest.mock('@/services/payment/inngest/payment-inngest-functions', () => ({
  InngestOnboardingEventSink: class {
    async publish(event: { event: string }) {
      sentOnboardingEvents.push({ name: event.event, data: event });
    }
  },
}));

// T-R36 — the completion route now reads a REAL persisted `OnboardingSession` row (never the
// retired in-memory `sessions`/`users` arrays — see the removed `./complete/store.ts`) via the real
// Auth.js session (`withRole`/`getCurrentSession`), never an `x-user-id` header. Faked at the module
// boundary the same way `tests/unit/onboarding-consent-route.test.ts` fakes `getCurrentSession` and
// `tests/unit/onboarding-session-persistence.test.ts` (this fix's own dedicated suite) fakes
// `@/lib/prisma` — a stateful, Map-backed fake so these pre-existing T-19/T-21R regression tests
// keep proving the SAME thing they always did (the route's §6.7 tier sourcing / GDPR gate), just
// against the new real-persistence shape.
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
  intensity_setting?: string;
  onboarding_status?: string;
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
      if (where.state !== 'ACTIVE') return null;
      return fakeOnboardingSponsorships.get(where.member_user_id) ?? null;
    },
  },
  $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
};

jest.mock('@/lib/prisma', () => ({ prisma: fakeOnboardingPrisma }));

// T-19 QC CRITICAL fix regression tests: exercise the ACTUAL live route handler (not just the
// service function it used to call), since the defect was in the route's wiring, not only in
// `OnboardingService.determineAccessTier` — see the `POST /api/onboarding/complete` describe block
// at the bottom of this file.
import { getCurrentSession } from '../../src/lib/auth/session';
import { POST as completeOnboarding } from '../../src/app/api/onboarding/complete/route';

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

describe('OnboardingService', () => {
  const service = new OnboardingService();

  describe('Organization gate', () => {
    // T-17 QC fix: this test used to assert `'123456'` (6 digits) is VALID, encoding the legacy
    // `SOLUTION_NUMBER_PATTERN = /^\d{6,8}$/` (6-8 digits) that `validateSolutionNumberFormat` used to
    // check against — a weaker, mismatched rule alongside the authoritative §6.3 7-digit format
    // (`SOLUTION_NUMBER_FORMAT = /^\d{7}$/` in `wp01/solution-number.ts`). A legacy test asserting a
    // spec violation is corrected here (not preserved) now that `validateSolutionNumberFormat`
    // delegates to the authoritative 7-digit check: 6-digit and 8-digit are now REJECTED, and only the
    // spec-correct 7-digit format is accepted.
    test('should validate Primerica solution number format (§6.3: 7 digits, not 6-8)', () => {
      expect(service.validateSolutionNumberFormat('1234567').valid).toBe(true); // 7 digits: valid
      expect(service.validateSolutionNumberFormat('123456').valid).toBe(false); // 6 digits: REJECTED
      expect(service.validateSolutionNumberFormat('12345678').valid).toBe(false); // 8 digits: REJECTED
      expect(service.validateSolutionNumberFormat('12345').valid).toBe(false);
      expect(service.validateSolutionNumberFormat('ABCDEF').valid).toBe(false);
    });

    test('isPrimericaUser returns correct values', () => {
      expect(service.isPrimericaUser(OrgType.PRIMERICA)).toBe(true);
      expect(service.isPrimericaUser(OrgType.EXTERNAL)).toBe(false);
    });
  });

  // T-20 §6.10-1 / §6.7 legacy retirement: `seedAccessTier` (ENTERPRISE-by-role) and
  // `validateSevenWhysScore` (a numeric averaged gate) were REMOVED — the first is a §6.7-violating
  // duplicate of `assignAccessTier` (ENTERPRISE is admin-provisioning only, never a role default),
  // the second CONTRADICTS the T-18 invisible-resonance contract (§6.4, uiux AC-5.1-4: the score is
  // never a number the rep — or any caller — sees). These tests, which encoded exactly those
  // spec-violating behaviors, are corrected (not preserved), the same way the T-17/T-19 QC passes
  // corrected the solution-number-format and commitment-score-tier tests below.
  describe('Retired legacy methods (T-20) — no reachable weaker/duplicate logic remains', () => {
    test('seedAccessTier no longer exists on the service (ENTERPRISE-by-role was a §6.7 violation)', () => {
      expect((service as unknown as Record<string, unknown>).seedAccessTier).toBeUndefined();
    });

    test('validateSevenWhysScore no longer exists (numeric gate contradicted the T-18 invisible-resonance contract)', () => {
      expect((service as unknown as Record<string, unknown>).validateSevenWhysScore).toBeUndefined();
    });

    test('validateStep no longer numeric-gates the SEVEN_WHYS step — the T-18 engine owns that gate', () => {
      const session = { role: Role.REP, org_type: OrgType.EXTERNAL, current_step: OnboardingStep.SEVEN_WHYS } as unknown as OnboardingSession;
      // A "low-scoring" seven_whys payload that the retired numeric gate would have REJECTED now
      // passes this legacy validator untouched (the real gate is the invisible T-18 resonance).
      const result = service.validateStep(session, OnboardingStep.SEVEN_WHYS, {
        seven_whys: [{ score: 10 }, { score: 20 }],
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('Role visibility', () => {
    test('should return correct visibility boundaries', () => {
      const rvpVisibility = service.getRoleVisibility(Role.RVP);
      expect(rvpVisibility).toEqual(ROLE_VISIBILITY[Role.RVP]);
      expect(rvpVisibility.canViewDownline).toBe(true);
      
      const repVisibility = service.getRoleVisibility(Role.REP);
      expect(repVisibility.canViewDownline).toBe(false);
    });
  });

  describe('Progression and business rules', () => {
    test('getNextStep follows role-specific order', () => {
      const mockSession = { role: Role.REP, current_step: OnboardingStep.REGISTER } as unknown as OnboardingSession;
      expect(service.getNextStep(mockSession)).toBe(OnboardingStep.ACCOUNT_TYPE);
    });

    // T-21R (§6.10-10): CONSENT_CAPTURE is the LAST step in every role's ROLE_STEP_MAP — proves the
    // legacy step-machine's own ordering already treats it as the final gate before completion.
    test('CONSENT_CAPTURE is the final step for every role (ROLE_STEP_MAP)', () => {
      for (const role of [Role.REP, Role.UPLINE, Role.RVP, Role.DUAL, Role.ADMIN]) {
        const steps = service.getStepsForRole(role);
        expect(steps[steps.length - 1]).toBe(OnboardingStep.CONSENT_CAPTURE);
        const mockSession = { role, current_step: OnboardingStep.CONSENT_CAPTURE } as unknown as OnboardingSession;
        expect(service.getNextStep(mockSession)).toBeNull(); // nothing comes after it
      }
    });
  });

  // T-21R (§6.10-10) — WP01 gate QC checkpoint #15: the GDPR consent step gate on the legacy
  // `/api/onboarding/step` route's validator. TEETH: every "false"/"missing" assertion below would
  // pass (wrongly) against the pre-fix `validateStep`, which had NO branch for CONSENT_CAPTURE at all
  // — any payload, consented or not, was accepted.
  describe('validateStep gates OnboardingStep.CONSENT_CAPTURE on explicit gdpr_consent (T-21R)', () => {
    const baseSession = { role: Role.REP, org_type: OrgType.EXTERNAL, current_step: OnboardingStep.CONSENT_CAPTURE } as unknown as OnboardingSession;

    test('gdpr_consent: true is ACCEPTED', () => {
      const result = service.validateStep(baseSession, OnboardingStep.CONSENT_CAPTURE, { gdpr_consent: true });
      expect(result.valid).toBe(true);
    });

    test('gdpr_consent: false is REJECTED', () => {
      const result = service.validateStep(baseSession, OnboardingStep.CONSENT_CAPTURE, { gdpr_consent: false });
      expect(result.valid).toBe(false);
    });

    test('missing gdpr_consent entirely is REJECTED (fail-closed, not "consent implied by silence")', () => {
      const result = service.validateStep(baseSession, OnboardingStep.CONSENT_CAPTURE, {});
      expect(result.valid).toBe(false);
    });

    test('a truthy-but-not-boolean-true gdpr_consent ("yes", 1) is REJECTED — must be the real boolean act', () => {
      expect(service.validateStep(baseSession, OnboardingStep.CONSENT_CAPTURE, { gdpr_consent: 'yes' }).valid).toBe(false);
      expect(service.validateStep(baseSession, OnboardingStep.CONSENT_CAPTURE, { gdpr_consent: 1 }).valid).toBe(false);
    });
  });

  // T-17 QC fix: closes the dual-source-of-truth defect — a live route (`/api/onboarding/step`)
  // reaches `OnboardingService.validateStep`/`validateSolutionNumberFormat` and used to accept a
  // 6-digit or 8-digit "solution number" via the legacy `SOLUTION_NUMBER_PATTERN`. These tests exercise
  // the EXACT functions that route delegates to (§17.1/§6.3), proving no path reachable through
  // `OnboardingService` accepts anything but the spec 7-digit format.
  describe('legacy route path — validateStep (what /api/onboarding/step/route.ts calls) now rejects 6/8-digit solution numbers (T-17)', () => {
    const baseSession = {
      role: Role.REP,
      org_type: OrgType.PRIMERICA,
      current_step: OnboardingStep.ROLE_ORG_CONTEXT,
    } as unknown as OnboardingSession;

    test('6-digit solution number is REJECTED at the ROLE_ORG_CONTEXT step', () => {
      const result = service.validateStep(baseSession, OnboardingStep.ROLE_ORG_CONTEXT, {
        solution_number: '123456',
      });
      expect(result.valid).toBe(false);
    });

    test('8-digit solution number is REJECTED at the ROLE_ORG_CONTEXT step', () => {
      const result = service.validateStep(baseSession, OnboardingStep.ROLE_ORG_CONTEXT, {
        solution_number: '12345678',
      });
      expect(result.valid).toBe(false);
    });

    test('the spec-correct 7-digit solution number is ACCEPTED at the ROLE_ORG_CONTEXT step', () => {
      const result = service.validateStep(baseSession, OnboardingStep.ROLE_ORG_CONTEXT, {
        solution_number: '1234567',
      });
      expect(result.valid).toBe(true);
    });

    // canProgressTo is the other legacy-support entry point (accepts camelCase `solutionNumber`); it
    // must reject 6/8-digit too, since it delegates to the same validateSolutionNumberFormat.
    test('canProgressTo also rejects a 6-digit / 8-digit solutionNumber and accepts 7-digit', () => {
      expect(
        service.canProgressTo(OnboardingStep.ROLE_ORG_CONTEXT, {
          orgType: OrgType.PRIMERICA,
          solutionNumber: '123456',
        }).valid
      ).toBe(false);
      expect(
        service.canProgressTo(OnboardingStep.ROLE_ORG_CONTEXT, {
          orgType: OrgType.PRIMERICA,
          solutionNumber: '12345678',
        }).valid
      ).toBe(false);
      expect(
        service.canProgressTo(OnboardingStep.ROLE_ORG_CONTEXT, {
          orgType: OrgType.PRIMERICA,
          solutionNumber: '1234567',
        }).valid
      ).toBe(true);
    });
  });

  // T-19 QC CRITICAL fix: this describe block used to assert `determineAccessTier` branches ON
  // COMMITMENT SCORE (`7-8` -> PAID_INDIVIDUAL, `>=9` -> ENTERPRISE) "regardless of org type" — that
  // was ITSELF the payment-sensitive dual-source-of-truth defect the T-19 QC pass flagged as
  // CRITICAL: §6.7 assigns access tier "from auth source + org context", NEVER a self-reported
  // commitment slider, so a SPONSORED user (should be FREE_ORG_LINKED / $0) who rated their own
  // commitment >=9 was silently promoted to a $25,000/yr ENTERPRISE tier by this exact function. A
  // legacy test encoding a spec violation is corrected here (not preserved): `determineAccessTier`
  // now IGNORES `commitmentScore` entirely and delegates to the §6.7 `assignAccessTierFromSignals`
  // (src/services/onboarding/wp01/access-tier.ts), branching only on `orgType` (Primerica implies
  // sponsor/org-linked; external implies no-sponsor email/password). These tests now assert the
  // §6.7-correct behavior: NO commitment score, however high, can ever push a caller of this
  // function onto a PAID/ENTERPRISE tier.
  describe('determineAccessTier returns real Prisma AccessTier values, NEVER from commitment score (§6.7, T-19 CRITICAL fix)', () => {
    test('commitment score has NO effect on the returned tier — same orgType, wildly different scores, same tier', () => {
      for (const score of [0, 3, 5, 6, 7, 8, 9, 10, 999]) {
        expect(service.determineAccessTier(score, OrgType.PRIMERICA)).toBe(AccessTier.FREE_ORG_LINKED);
        expect(service.determineAccessTier(score, OrgType.EXTERNAL)).toBe(AccessTier.FREE_PAID_EXTERNAL);
      }
    });

    test('a sponsored-context (Primerica) user with commitment score >=9 is FREE_ORG_LINKED, never ENTERPRISE — this is the exact scenario the pre-fix code got wrong ($25,000/yr for a $0 sponsored user)', () => {
      expect(service.determineAccessTier(9, OrgType.PRIMERICA)).toBe(AccessTier.FREE_ORG_LINKED);
      expect(service.determineAccessTier(10, OrgType.PRIMERICA)).not.toBe(AccessTier.ENTERPRISE);
      expect(service.determineAccessTier(10, OrgType.PRIMERICA)).not.toBe(AccessTier.PAID_INDIVIDUAL);
    });

    test('an external (no-sponsor) user with mid commitment score (7-8) is FREE_PAID_EXTERNAL, never PAID_INDIVIDUAL', () => {
      expect(service.determineAccessTier(7, OrgType.EXTERNAL)).toBe(AccessTier.FREE_PAID_EXTERNAL);
      expect(service.determineAccessTier(8, OrgType.EXTERNAL)).toBe(AccessTier.FREE_PAID_EXTERNAL);
    });

    // Fail-closed sweep: no combination of (score, orgType) this function accepts can ever return
    // PAID_INDIVIDUAL or ENTERPRISE — those two tiers are §6.7-reachable ONLY via
    // `assignAccessTierFromSignals`'s `admin_provisioning`/`post_subscription_upgrade` paths
    // (see tests/unit/wp01-access-tier.test.ts), never via this commitment-score-shaped call site.
    test('no score/orgType combination through this function ever returns PAID_INDIVIDUAL or ENTERPRISE', () => {
      for (const score of [-1, 0, 1, 5, 6, 7, 8, 9, 10, 100]) {
        for (const orgType of [OrgType.PRIMERICA, OrgType.EXTERNAL]) {
          const tier = service.determineAccessTier(score, orgType);
          expect(tier).not.toBe(AccessTier.PAID_INDIVIDUAL);
          expect(tier).not.toBe(AccessTier.ENTERPRISE);
        }
      }
    });
  });
});

// T-19 QC CRITICAL fix — the actual reported defect: `POST /api/onboarding/complete` (the LIVE
// route, not just the service function it called) used to derive `access_tier` from
// `commitmentScore` via `onboardingService.determineAccessTier(commitmentScore, session.org_type)`.
// A SPONSORED user (should be FREE_ORG_LINKED / $0) who self-reported commitmentScore >= 9 was
// silently promoted to a $25,000/yr ENTERPRISE tier. These tests call the EXPORTED route handler
// directly (same pattern as tests/unit/session-whoami.test.ts) so the assertion is against the real
// HTTP-shaped entry point, not a proxy for it.
describe('POST /api/onboarding/complete — LIVE route sources access_tier from §6.7 signals, never commitment score (T-19 CRITICAL fix)', () => {
  afterEach(() => {
    fakeOnboardingSessions.clear();
    fakeOnboardingUsers.clear();
    fakeOnboardingSponsorships.clear();
    sentOnboardingEvents.length = 0;
    mockedGetCurrentSession.mockReset();
  });

  // T-R36: `org_type`/`sponsor_id`/`role`/`gdpr_consent` are real `User` columns now (never a fake
  // in-memory session field) — split here into the real `User` row + a real `Sponsorship` row
  // (`sponsor_id` truthy => an ACTIVE Sponsorship row for this member, the same real signal
  // `provisionFromContract` itself reads downstream), while the rest stays on the persisted
  // `OnboardingSession` row. Also arms the mocked real session (`getCurrentSession`) for this user —
  // this route trusts ONLY that now, never an `x-user-id` header.
  function seedSession(userId: string, overrides: Record<string, unknown> = {}) {
    const { org_type, sponsor_id, role, gdpr_consent, ...sessionOverrides } = overrides;
    const resolvedRole = (role as Role) ?? Role.REP;
    fakeOnboardingUsers.set(userId, {
      id: userId,
      role: resolvedRole,
      org_type: (org_type as OrgType) ?? OrgType.EXTERNAL,
      // T-21R (§6.10-10): every test in this describe block is about access-tier sourcing, not
      // consent — default to already-consented so those assertions are unaffected by the
      // completion precondition. The precondition itself is proven separately, below.
      gdpr_consent: gdpr_consent ?? true,
    });
    if (sponsor_id) {
      fakeOnboardingSponsorships.set(userId, { sponsor_user_id: sponsor_id as string });
    }
    fakeRowSeq += 1;
    fakeOnboardingSessions.set(`sess-${fakeRowSeq}`, {
      id: `sess-${fakeRowSeq}`,
      user_id: userId,
      current_step: 'INTENSITY',
      seven_whys: null,
      goal_card: null,
      intensity_data: { commitmentScore: 9, weeklyHours: 10, riskTolerance: 'HIGH', supportNeeds: [] },
      completed: false,
      created_at: new Date(2026, 0, 1, 0, 0, fakeRowSeq),
      ...sessionOverrides,
    });
    mockedGetCurrentSession.mockResolvedValue(fakeAuthSession(userId, resolvedRole));
  }

  function persistedUser(userId: string) {
    return fakeOnboardingUsers.get(userId);
  }

  async function complete(userId: string) {
    // `userId` is no longer read from a header — it's whichever user `seedSession` last armed the
    // mocked real session for (see `mockedGetCurrentSession.mockResolvedValue` above). Kept as a
    // parameter purely so call sites below stay unchanged / self-documenting.
    void userId;
    const request = new NextRequest('http://localhost/api/onboarding/complete', { method: 'POST' });
    const response = await completeOnboarding(request, {});
    const body = await response.json();
    return { response, body };
  }

  // THE mandatory regression test: this exact scenario (sponsored, EXTERNAL org, commitmentScore
  // 9) would FAIL against the pre-fix code. Pre-fix, the route called
  // `onboardingService.determineAccessTier(9, OrgType.EXTERNAL)`, whose legacy body was
  // `if (commitmentScore >= 9) return AccessTier.ENTERPRISE;` — it never even looked at
  // `sponsor_id`, so it returned ENTERPRISE ($25,000/yr) regardless of sponsorship. Against the
  // pre-fix route, `expect(body.accessTier).toBe(AccessTier.FREE_ORG_LINKED)` below would have
  // failed with `Expected: "FREE_ORG_LINKED", Received: "ENTERPRISE"`.
  test('a SPONSORED user (sponsor_id set) with commitment score >=9 resolves to FREE_ORG_LINKED, NOT ENTERPRISE — FAILS against the pre-fix code', async () => {
    seedSession('user-sponsored-high-commitment', {
      org_type: OrgType.EXTERNAL,
      sponsor_id: 'sponsor-abc-123',
      intensity_data: { commitmentScore: 9, weeklyHours: 20, riskTolerance: 'HIGH', supportNeeds: [] },
    });

    const { response, body } = await complete('user-sponsored-high-commitment');

    expect(response.status).toBe(200);
    expect(body.accessTier).toBe(AccessTier.FREE_ORG_LINKED);
    expect(body.accessTier).not.toBe(AccessTier.ENTERPRISE);
    expect(body.accessTier).not.toBe(AccessTier.PAID_INDIVIDUAL);
    const user = persistedUser('user-sponsored-high-commitment');
    expect(user?.access_tier).toBe(AccessTier.FREE_ORG_LINKED);
  });

  test('a no-sponsor EXTERNAL user resolves to FREE_PAID_EXTERNAL', async () => {
    seedSession('user-no-sponsor-external', {
      org_type: OrgType.EXTERNAL,
      sponsor_id: null,
      intensity_data: { commitmentScore: 5, weeklyHours: 5, riskTolerance: 'LOW', supportNeeds: [] },
    });

    const { response, body } = await complete('user-no-sponsor-external');

    expect(response.status).toBe(200);
    expect(body.accessTier).toBe(AccessTier.FREE_PAID_EXTERNAL);
  });

  test('a Primerica-org-context user with no explicit sponsor_id still resolves to FREE_ORG_LINKED (org context implies sponsorship)', async () => {
    seedSession('user-primerica-implicit-sponsor', {
      org_type: OrgType.PRIMERICA,
      sponsor_id: null,
      intensity_data: { commitmentScore: 6, weeklyHours: 8, riskTolerance: 'MEDIUM', supportNeeds: [] },
    });

    const { response, body } = await complete('user-primerica-implicit-sponsor');

    expect(response.status).toBe(200);
    expect(body.accessTier).toBe(AccessTier.FREE_ORG_LINKED);
  });

  test('commitment score sweep (5..10) has ZERO effect on the live route tier for an identical sponsored session', async () => {
    for (const score of [5, 6, 7, 8, 9, 10]) {
      const userId = `user-sweep-${score}`;
      seedSession(userId, {
        org_type: OrgType.EXTERNAL,
        sponsor_id: 'sponsor-xyz',
        intensity_data: { commitmentScore: score, weeklyHours: 10, riskTolerance: 'HIGH', supportNeeds: [] },
      });

      const { response, body } = await complete(userId);

      expect(response.status).toBe(200);
      expect(body.accessTier).toBe(AccessTier.FREE_ORG_LINKED);
      expect(body.commitmentScore).toBe(score); // still recorded, just no longer tier-determinative
    }
  });
});

// T-21R (§6.10-10) — WP01 gate QC checkpoint #15 fix: `POST /api/onboarding/complete` must refuse to
// mark a user complete without a recorded, affirmative GDPR consent event. THE MANDATORY REGRESSION
// PROOF: every test in this block would FAIL against the pre-fix route, which never looked at
// `session.gdpr_consent` at all — an otherwise-fully-qualified (high commitment score, sponsored)
// session reached `completed: true` / 200 with no consent recorded whatsoever.
describe('POST /api/onboarding/complete — GDPR consent completion precondition (T-21R, §6.10-10)', () => {
  afterEach(() => {
    fakeOnboardingSessions.clear();
    fakeOnboardingUsers.clear();
    fakeOnboardingSponsorships.clear();
    sentOnboardingEvents.length = 0;
    mockedGetCurrentSession.mockReset();
  });

  // T-R36: `gdpr_consent` is the REAL `User.gdpr_consent` column now (durably written by
  // `POST /api/onboarding/consent`'s `grantGdprConsent`, T-21R — this route only ever READS it) —
  // no default here (unlike `seedSession` above), matching the real column's own `@default(false)`,
  // so "omitted entirely" (the first test below) means genuinely absent, not defaulted-to-consented.
  function seedSessionNoDefaultConsent(userId: string, overrides: Record<string, unknown> = {}) {
    const { org_type, sponsor_id, role, gdpr_consent, ...sessionOverrides } = overrides;
    const resolvedRole = (role as Role) ?? Role.REP;
    fakeOnboardingUsers.set(userId, {
      id: userId,
      role: resolvedRole,
      org_type: (org_type as OrgType) ?? OrgType.EXTERNAL,
      gdpr_consent,
    });
    if (sponsor_id) {
      fakeOnboardingSponsorships.set(userId, { sponsor_user_id: sponsor_id as string });
    }
    fakeRowSeq += 1;
    fakeOnboardingSessions.set(`sess-${fakeRowSeq}`, {
      id: `sess-${fakeRowSeq}`,
      user_id: userId,
      current_step: 'CONSENT_CAPTURE',
      seven_whys: null,
      goal_card: null,
      intensity_data: { commitmentScore: 9, weeklyHours: 10, riskTolerance: 'HIGH', supportNeeds: [] },
      completed: false,
      created_at: new Date(2026, 0, 1, 0, 0, fakeRowSeq),
      ...sessionOverrides,
    });
    mockedGetCurrentSession.mockResolvedValue(fakeAuthSession(userId, resolvedRole));
  }

  function persistedSession(userId: string) {
    return [...fakeOnboardingSessions.values()].find((s) => s.user_id === userId);
  }

  async function complete(userId: string) {
    void userId; // see the identical note on `complete` in the describe block above
    const request = new NextRequest('http://localhost/api/onboarding/complete', { method: 'POST' });
    const response = await completeOnboarding(request, {});
    const body = await response.json();
    return { response, body };
  }

  // TEETH: this is the exact scenario the QC gate flagged — a fully-qualified session (high
  // commitment, current_step at the final pre-complete step) that simply never granted GDPR consent.
  // Against the pre-fix route (no `evaluateConsentCompletionGate` call at all) this would return 200
  // with `completed: true` — the live bypass this fix closes.
  test('a session with gdpr_consent OMITTED (never consented) is REJECTED — cannot reach GATED_COMPLETE', async () => {
    seedSessionNoDefaultConsent('user-never-consented');

    const { response, body } = await complete('user-never-consented');

    expect(response.status).toBe(400);
    expect(body.code).toBe('GDPR_CONSENT_REQUIRED');
    const session = persistedSession('user-never-consented');
    expect(session?.completed).toBe(false); // never flipped to complete
  });

  test('a session with gdpr_consent EXPLICITLY false is REJECTED', async () => {
    seedSessionNoDefaultConsent('user-explicit-false-consent', { gdpr_consent: false });

    const { response, body } = await complete('user-explicit-false-consent');

    expect(response.status).toBe(400);
    expect(body.code).toBe('GDPR_CONSENT_REQUIRED');
  });

  test('a garbage (non-boolean-true) gdpr_consent value is REJECTED — fail-closed, not just falsy-checked', async () => {
    seedSessionNoDefaultConsent('user-garbage-consent', { gdpr_consent: 'yes' as unknown as boolean });

    const { response, body } = await complete('user-garbage-consent');

    expect(response.status).toBe(400);
    expect(body.code).toBe('GDPR_CONSENT_REQUIRED');
  });

  test('a session with gdpr_consent: true DOES reach GATED_COMPLETE (the precondition is satisfiable, not a permanent block)', async () => {
    seedSessionNoDefaultConsent('user-consented', { gdpr_consent: true });

    const { response, body } = await complete('user-consented');

    expect(response.status).toBe(200);
    expect(body.completed).toBe(true);
    const session = persistedSession('user-consented');
    expect(session?.completed).toBe(true);
  });

  test('current_step CONSENT_CAPTURE (the real last step for every role) is now an accepted pre-complete step', async () => {
    // Before T-21R this route only accepted current_step === 'INTENSITY' — CONSENT_CAPTURE (the
    // actual last step in ROLE_STEP_MAP for every role) would have been rejected with "Cannot
    // complete onboarding before reaching INTENSITY step" regardless of consent.
    seedSessionNoDefaultConsent('user-at-consent-step', {
      current_step: 'CONSENT_CAPTURE',
      gdpr_consent: true,
    });

    const { response } = await complete('user-at-consent-step');

    expect(response.status).toBe(200);
  });
});
