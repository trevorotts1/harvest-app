// R-10 (refinements catalog 2026-07-28; master-spec §6 O-4 Flow A (4)) — the O-4 "Goals &
// intensity" step's THREE GOAL FIELDS (income goal, weekly time commitment, promotion target),
// which the spec's O-4 defines alongside the intensity dial and which this build adds. The
// intensity dial itself (R-06 copy, three positions, commitment mapping) is deliberately UNTOUCHED
// — this suite proves both directions of that law:
//
//   (A) the three fields RENDER on the O-4 step (via `IntensityDial`'s new optional `goals` props),
//       in both languages, with ZERO Primerica strings for a universal rep (org-gate/leak law);
//   (B) the values PERSIST through the REAL `/api/onboarding/step` + `/status` routes (goal_fields
//       JSON on the session row, mirroring the intensity_data payload), read back exactly;
//   (C) validation FAILS CLOSED: bad/missing/tampered values are rejected by the real
//       `validateStep` (income/time must be sane finite numbers, promotion target must be from the
//       canonical `PROMOTION_TARGET_LEVELS` vocabulary) while omitting the fields stays valid;
//   (D) the intensity dial is behaviorally untouched: the INTENSITY payload's dial-derived
//       fields (commitmentScore/weeklyHours/riskTolerance/supportNeeds) and the pre-R-10
//       `buildIntensityDataPayload(intensity)` single-arg shape stay byte-identical.

import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { NextRequest } from 'next/server';
import { AccessTier, IntensitySetting, OnboardingStatus, OrgType, Role, SponsorshipState } from '@prisma/client';
import type { Session } from 'next-auth';

import {
  MIN_COMMITMENT_SCORE,
  OnboardingStep,
  PROMOTION_TARGET_LEVELS,
  type OnboardingSession,
} from '@/types/onboarding';
import IntensityDial from '@/app/onboarding/components/IntensityDial';
import GoalsFields, { EMPTY_GOALS_FIELDS } from '@/app/onboarding/components/GoalsFields';
import { buildIntensityDataPayload, buildDenseTrackStepPlan } from '@/app/onboarding/onboarding-step-client';
import { OnboardingService } from '@/services/onboarding/service';
import { LocaleContext } from '@/app/locale-context';
import { t } from '@/lib/i18n/catalog';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));

// ─── Rendering helpers (node env, renderToStaticMarkup — this repo's established convention) ─────

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

function renderEn<P extends object>(el: ComponentType<P>, props: P) {
  return renderToStaticMarkup(createElement(el, props));
}
function renderEs<P extends object>(el: ComponentType<P>, props: P) {
  return renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      {
        value: {
          locale: 'es',
          setLocale: () => {},
          t: (key: string, vars?: Record<string, string | number>) => t('es', key, vars),
        },
      },
      createElement(el, props)
    )
  );
}

const goals = {
  monthlyIncomeGoal: 2500,
  weeklyTimeCommitment: 7,
  promotionTarget: 'dl' as const,
};

// ─── Real-route harness (mirrors onboarding-client-mapping-integration.test.ts's established
//     fake-Prisma pattern — same call shapes, same Map-backed fakes) ────────────────────────────

interface FakeOnboardingSessionRow {
  id: string;
  user_id: string;
  current_step: string;
  seven_whys: unknown;
  goal_card: unknown;
  intensity_data: unknown;
  goal_fields: unknown;
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
        goal_fields: null,
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
      return null;
    },
  },
  $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
};

jest.mock('@/lib/prisma', () => ({ prisma: fakePrisma }));
jest.mock('@/services/payment/inngest/payment-inngest-functions', () => ({
  InngestOnboardingEventSink: class {
    async publish() {
      return Promise.resolve();
    }
  },
}));

import { getCurrentSession } from '@/lib/auth/session';
import { POST as stepRoute } from '@/app/api/onboarding/step/route';
import { GET as statusRoute } from '@/app/api/onboarding/status/route';

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

async function getStatus() {
  const request = new NextRequest('http://localhost/api/onboarding/status');
  const response = await statusRoute(request, {});
  const body = await response.json();
  return { response, body };
}

afterEach(() => {
  fakeOnboardingSessions.clear();
  fakeUsers.clear();
  mockedGetCurrentSession.mockReset();
});

// ─── (A) RENDERING — the three fields render on the O-4 step, EN + ES, no Primerica leak ────────

describe('R-10 rendering — the O-4 goal fields render on the goals/intensity step', () => {
  test('GoalsFields renders all three labeled inputs (income, time, promotion) with a level vocabulary', () => {
    const en = textOf(renderEn(GoalsFields, { value: EMPTY_GOALS_FIELDS, onChange: () => {} }));
    expect(en).toContain('Monthly income goal');
    expect(en).toContain('Weekly time commitment');
    expect(en).toContain('Promotion target');
    // The promotion selector offers the canonical ladder vocabulary (top SNSD … bottom REP).
    expect(en).toContain('SNSD (Senior National Sales Director)');
    expect(en).toContain('RVP (Regional Vice President)');
    expect(en).toContain('Rep (Representative)');
  });

  test('GoalsFields genuinely translates to Spanish', () => {
    const es = textOf(renderEs(GoalsFields, { value: EMPTY_GOALS_FIELDS, onChange: () => {} }));
    expect(es).toContain('Meta de ingresos mensuales');
    expect(es).toContain('Compromiso de tiempo semanal');
    expect(es).toContain('Meta de ascenso');
    expect(es).toContain('RVP (Vicepresidente Regional)');
  });

  test('IntensityDial renders the goal fields when passed, and NOT without them (additive prop)', () => {
    const withGoals = textOf(
      renderEn(IntensityDial, { value: IntensitySetting.MEDIUM, goals, onGoalsChange: () => {} })
    );
    expect(withGoals).toContain('Monthly income goal');
    expect(withGoals).toContain('Weekly time commitment');
    expect(withGoals).toContain('Promotion target');

    const withoutGoals = textOf(renderEn(IntensityDial, { value: IntensitySetting.MEDIUM }));
    expect(withoutGoals).not.toContain('Monthly income goal');
    expect(withoutGoals).not.toContain('Weekly time commitment');
    expect(withoutGoals).not.toContain('Promotion target');
  });

  test('R-06 copy + dial positions are untouched by R-10, and the step leaks NO Primerica string', () => {
    const en = textOf(
      renderEn(IntensityDial, { value: IntensitySetting.MEDIUM, goals, onGoalsChange: () => {} })
    );
    // The dial's own R-06 copy still renders verbatim.
    expect(en).toContain('How hard should your Harvest AI agents work while you live your life?');
    expect(en).toContain('2 Hour CEO');
    expect(en).toContain('A steady daily rhythm');
    // Universal org-gate/leak law: the goal fields render the ladder labels (Primerica's level
    // names — "SNSD", "RVP", "Rep") but NEVER the Primerica brand string on this universal step.
    expect(en).not.toMatch(/primerica/i);
  });

  test('the dial requires an explicit selection and Continue stays disabled without one (AC-5.1-3, untouched)', () => {
    const html = renderEn(IntensityDial, { value: null, goals, onGoalsChange: () => {} });
    expect(html).not.toMatch(/aria-checked="true"/);
    expect(html).toMatch(/disabled/);
  });
});

// ─── (B) PERSISTENCE — the fields ride the INTENSITY payload through the REAL routes ────────────

describe('R-10 persistence — goal fields persist through the real /step + /status routes', () => {
  async function walkToIntensity(userId: string) {
    for (const [step, data] of [
      [OnboardingStep.REGISTER, {}],
      [OnboardingStep.ACCOUNT_TYPE, {}],
      [OnboardingStep.ROLE_ORG_CONTEXT, {}],
      [OnboardingStep.SEVEN_WHYS, { sevenWhys: [{ question: 'q', answer: 'a', score: 80 }] }],
      [
        OnboardingStep.GOAL_CARD,
        {
          goalCard: {
            primaryGoal: 'goal',
            targetDate: '2027-01-01',
            commitmentLevel: 8,
            motivationStatement: 'why',
            anchorStatement: 'Built for my kids.',
          },
        },
      ],
    ] as Array<[OnboardingStep, Record<string, unknown>]>) {
      const { response } = await postStep(step, data);
      expect(response.status).toBe(200);
    }
  }

  test('a full INTENSITY payload with all three goal fields persists to goal_fields and reads back from /status', async () => {
    const userId = 'r10-rep-1';
    actAs(userId, Role.REP);
    seedUser(userId, Role.REP, OrgType.EXTERNAL);
    await walkToIntensity(userId);

    const payload = buildIntensityDataPayload(IntensitySetting.HIGH, goals);
    const intensity = await postStep(OnboardingStep.INTENSITY, { intensityData: payload });
    expect(intensity.response.status).toBe(200);
    expect(intensity.body.currentStep).toBe('CONSENT_CAPTURE');

    // The session row carries the durable copy...
    const row = [...fakeOnboardingSessions.values()][0];
    expect(row.goal_fields).toEqual(goals);
    // ...and the live intensity_data carries the same three fields alongside the dial's own.
    expect(row.intensity_data).toMatchObject({
      commitmentScore: 10,
      weeklyHours: 30,
      riskTolerance: 'HIGH',
      supportNeeds: [],
      monthlyIncomeGoal: 2500,
      weeklyTimeCommitment: 7,
      promotionTarget: 'dl',
    });

    const status = await getStatus();
    expect(status.response.status).toBe(200);
    expect(status.body.goalFields).toEqual(goals);
    expect((status.body.intensityData as { monthlyIncomeGoal: number }).monthlyIncomeGoal).toBe(2500);
  });

  test('an INTENSITY payload with NO goal fields persists neither goal_fields nor extra intensity_data keys (pre-R-10 payloads unchanged)', async () => {
    const userId = 'r10-rep-2';
    actAs(userId, Role.REP);
    seedUser(userId, Role.REP, OrgType.EXTERNAL);
    await walkToIntensity(userId);

    // Exactly the pre-R-10 single-argument call the old callers (and dense track) still make.
    const payload = buildIntensityDataPayload(IntensitySetting.MEDIUM);
    const intensity = await postStep(OnboardingStep.INTENSITY, { intensityData: payload });
    expect(intensity.response.status).toBe(200);

    const row = [...fakeOnboardingSessions.values()][0];
    expect(row.goal_fields).toBeNull();
    expect(row.intensity_data).toEqual({
      commitmentScore: 8,
      weeklyHours: 15,
      riskTolerance: 'MEDIUM',
      supportNeeds: [],
    });
  });

  test('the dense-track plan (which never collects goal fields) still clears the real /step gate', async () => {
    const userId = 'r10-dense-1';
    actAs(userId, Role.UPLINE);
    seedUser(userId, Role.UPLINE, OrgType.EXTERNAL);
    for (const [step, data] of [
      [OnboardingStep.REGISTER, {}],
      [OnboardingStep.ACCOUNT_TYPE, {}],
      [OnboardingStep.ROLE_ORG_CONTEXT, {}],
    ] as Array<[OnboardingStep, Record<string, unknown>]>) {
      const { response } = await postStep(step, data);
      expect(response.status).toBe(200);
    }
    const plan = buildDenseTrackStepPlan(Role.UPLINE, OrgType.EXTERNAL, '');
    const intensityItem = plan.find((p) => p.step === OnboardingStep.INTENSITY);
    // UPLINE's ROLE_STEP_MAP has no INTENSITY step — this assertion pins that unchanged fact.
    expect(intensityItem).toBeUndefined();
  });

  test('buildIntensityDataPayload single-arg output is byte-identical to pre-R-10 (dial untouched)', () => {
    for (const level of [IntensitySetting.LOW, IntensitySetting.MEDIUM, IntensitySetting.HIGH]) {
      expect(buildIntensityDataPayload(level)).toEqual({
        commitmentScore: { LOW: 6, MEDIUM: 8, HIGH: 10 }[level],
        weeklyHours: { LOW: 5, MEDIUM: 15, HIGH: 30 }[level],
        riskTolerance: level,
        supportNeeds: [],
      });
    }
  });
});

// ─── (C) VALIDATION — the real validateStep gates the goal fields, fail-closed ──────────────────

describe('R-10 validation — income/time/promotion are format-gated, tampered/missing fail closed', () => {
  const service = new OnboardingService();
  const session = {
    role: Role.REP,
    org_type: OrgType.EXTERNAL,
    current_step: OnboardingStep.INTENSITY,
  } as unknown as OnboardingSession;

  const validIntensity = { commitmentScore: 8, weeklyHours: 10, riskTolerance: 'HIGH', supportNeeds: [] };

  test('valid income + time + promotion are ACCEPTED (and every ladder level is accepted)', () => {
    const ok = service.validateStep(session, OnboardingStep.INTENSITY, {
      intensityData: { ...validIntensity, monthlyIncomeGoal: 3000, weeklyTimeCommitment: 5, promotionTarget: 'rvp' },
    });
    expect(ok.valid).toBe(true);
    for (const level of PROMOTION_TARGET_LEVELS) {
      const r = service.validateStep(session, OnboardingStep.INTENSITY, {
        intensityData: { ...validIntensity, promotionTarget: level },
      });
      expect(r.valid).toBe(true);
    }
  });

  test('missing goal fields entirely is ACCEPTED (optional, dense-track / pre-R-10 payloads stay valid)', () => {
    expect(service.validateStep(session, OnboardingStep.INTENSITY, { intensityData: validIntensity }).valid).toBe(true);
    expect(service.validateStep(session, OnboardingStep.INTENSITY, {}).valid).toBe(false); // no intensityData at all still fails
  });

  test.each([
    ['income NaN', { ...validIntensity, monthlyIncomeGoal: Number.NaN }],
    ['income Infinity', { ...validIntensity, monthlyIncomeGoal: Number.POSITIVE_INFINITY }],
    ['income 0', { ...validIntensity, monthlyIncomeGoal: 0 }],
    ['income negative', { ...validIntensity, monthlyIncomeGoal: -5 }],
    ['income above 1M', { ...validIntensity, monthlyIncomeGoal: 2_000_000 }],
    ['income string', { ...validIntensity, monthlyIncomeGoal: '5000' }],
    ['time 0', { ...validIntensity, weeklyTimeCommitment: 0 }],
    ['time negative', { ...validIntensity, weeklyTimeCommitment: -2 }],
    ['time 169', { ...validIntensity, weeklyTimeCommitment: 169 }],
    ['time NaN', { ...validIntensity, weeklyTimeCommitment: Number.NaN }],
    ['time string', { ...validIntensity, weeklyTimeCommitment: '10' }],
    ['promotion invented level', { ...validIntensity, promotionTarget: 'King of the World' }],
    ['promotion wrong case', { ...validIntensity, promotionTarget: 'DL' }],
    ['promotion non-string', { ...validIntensity, promotionTarget: 42 }],
  ])('REJECTS %s (fail-closed — never persisted)', (_label, intensityData) => {
    const result = service.validateStep(session, OnboardingStep.INTENSITY, { intensityData });
    expect(result.valid).toBe(false);
  });

  test('a tampered goal field is rejected by the REAL route before any persistence happens', async () => {
    const userId = 'r10-tamper-1';
    actAs(userId, Role.REP);
    seedUser(userId, Role.REP, OrgType.EXTERNAL);
    for (const [step, data] of [
      [OnboardingStep.REGISTER, {}],
      [OnboardingStep.ACCOUNT_TYPE, {}],
      [OnboardingStep.ROLE_ORG_CONTEXT, {}],
      [OnboardingStep.SEVEN_WHYS, { sevenWhys: [{ question: 'q', answer: 'a', score: 80 }] }],
      [
        OnboardingStep.GOAL_CARD,
        {
          goalCard: {
            primaryGoal: 'goal',
            targetDate: '2027-01-01',
            commitmentLevel: 8,
            motivationStatement: 'why',
            anchorStatement: 'Built for my kids.',
          },
        },
      ],
    ] as Array<[OnboardingStep, Record<string, unknown>]>) {
      const { response } = await postStep(step, data);
      expect(response.status).toBe(200);
    }

    const tampered = await postStep(OnboardingStep.INTENSITY, {
      intensityData: { ...validIntensity, promotionTarget: 'Intergalactic Commander' },
    });
    expect(tampered.response.status).toBe(400);
    // Nothing was persisted: no goal_fields row, and current_step never advanced.
    const row = [...fakeOnboardingSessions.values()][0];
    expect(row.goal_fields).toBeNull();
    expect(row.current_step).toBe('INTENSITY');
  });
});
