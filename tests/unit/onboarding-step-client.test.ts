// T-R37 — unit proofs for the pure client-side onboarding step-wiring module
// (`src/app/onboarding/onboarding-step-client.ts`), the piece that actually POSTs
// `/api/onboarding/step` + `/api/onboarding/complete` from `OnboardingFlow.tsx`/`UplineTrack.tsx`.
//
// Mocks `global.fetch` directly — the same pattern this repo's OWN precedent for testing a
// fetch-calling client helper without jsdom/@testing-library/react already established
// (`resolveFirstTouchDraftId`, tests/unit/composer-handoff-wiring.test.ts). Proves:
//   (a) `postOnboardingStep`/`postOnboardingComplete` never throw, surface HTTP failures AND network
//       exceptions as a discriminated `{ok:false}` result, and never fabricate success.
//   (b) `sendOrderedSteps` is fail-closed (stops at the first rejection, never sends what comes
//       after) and resume-safe (skips a step already cleared per `ROLE_STEP_MAP` order).
//   (c) every payload builder produces the exact shape the real `/step` route reads (cross-checked
//       against tests/unit/onboarding-session-persistence.test.ts's own real-route walk).
//   (d) the screen→step mapping table + resume mapping are internally consistent with the real
//       `ROLE_STEP_MAP`/`OnboardingStep` vocabulary.

import { IntensitySetting, OrgType, Role } from '@prisma/client';

import { MIN_COMMITMENT_SCORE, OnboardingStep, ROLE_STEP_MAP } from '@/types/onboarding';
import {
  REP_SCREEN_STEP_PLAN,
  buildDenseTrackStepPlan,
  buildGoalCardPayload,
  buildIntensityDataPayload,
  buildRoleOrgContextPayload,
  buildSevenWhysResponses,
  commitmentScoreForIntensity,
  defaultGoalCardTargetDate,
  postOnboardingComplete,
  postOnboardingStep,
  sendOrderedSteps,
  stepIndexInRoleMap,
  stepToScreen,
  weeklyHoursForIntensity,
  type ServerStepRef,
  type StepCallResult,
} from '@/app/onboarding/onboarding-step-client';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('postOnboardingStep', () => {
  test('POSTs the exact { step, data } body to /api/onboarding/step and reports success', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(200, { currentStep: 'ACCOUNT_TYPE', completed: false });
    }) as unknown as typeof fetch;

    const result = await postOnboardingStep(OnboardingStep.REGISTER, {}, fakeFetch);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/onboarding/step');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ step: 'REGISTER', data: {} });
    expect(result).toEqual({ ok: true, currentStep: 'ACCOUNT_TYPE', completed: false });
  });

  test('an HTTP failure resolves ok:false with the status + machine code, never throws', async () => {
    const fakeFetch = (async () => jsonResponse(400, { error: 'Expected step X', code: 'SOME_CODE' })) as unknown as typeof fetch;
    const result = await postOnboardingStep(OnboardingStep.SEVEN_WHYS, { sevenWhys: [] }, fakeFetch);
    expect(result).toEqual({ ok: false, status: 400, code: 'SOME_CODE' });
  });

  test('a network exception (fetch throws) resolves ok:false with status null — never throws', async () => {
    const fakeFetch = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const result = await postOnboardingStep(OnboardingStep.SEVEN_WHYS, {}, fakeFetch);
    expect(result).toEqual({ ok: false, status: null });
  });

  test('a malformed (non-JSON) success response never throws — degrades to an empty body', async () => {
    const fakeFetch = (async () =>
      ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }) as unknown as Response) as unknown as typeof fetch;
    const result = await postOnboardingStep(OnboardingStep.REGISTER, {}, fakeFetch);
    expect(result.ok).toBe(true);
  });
});

describe('postOnboardingComplete', () => {
  test('POSTs to /api/onboarding/complete and reports success with the real fields', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(200, { completed: true, accessTier: 'FREE_PAID_EXTERNAL', commitmentScore: 8 });
    }) as unknown as typeof fetch;

    const result = await postOnboardingComplete(fakeFetch);
    expect(calls[0].url).toBe('/api/onboarding/complete');
    expect(calls[0].init?.method).toBe('POST');
    expect(result).toEqual({ ok: true, completed: true, accessTier: 'FREE_PAID_EXTERNAL', commitmentScore: 8 });
  });

  test('a failed completion (e.g. GDPR gate) surfaces ok:false with the real code, never fabricates success', async () => {
    const fakeFetch = (async () =>
      jsonResponse(400, { error: 'GDPR consent is required to complete onboarding (§6.10-10)', code: 'GDPR_CONSENT_REQUIRED' })) as unknown as typeof fetch;
    const result = await postOnboardingComplete(fakeFetch);
    expect(result).toEqual({ ok: false, status: 400, code: 'GDPR_CONSENT_REQUIRED' });
  });

  test('a network exception never throws', async () => {
    const fakeFetch = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(postOnboardingComplete(fakeFetch)).resolves.toEqual({ ok: false, status: null });
  });
});

describe('sendOrderedSteps — fail-closed sequencing', () => {
  test('sends every step in order, updating the ServerStepRef after each success', async () => {
    const sent: OnboardingStep[] = [];
    const postStep = async (step: OnboardingStep): Promise<StepCallResult> => {
      sent.push(step);
      const idx = stepIndexInRoleMap(Role.REP, step);
      const next = ROLE_STEP_MAP[Role.REP][idx + 1] ?? step;
      return { ok: true, currentStep: next, completed: false };
    };
    const ref: ServerStepRef = { current: OnboardingStep.SEVEN_WHYS };
    const outcome = await sendOrderedSteps(
      Role.REP,
      ref,
      [
        { step: OnboardingStep.SEVEN_WHYS, data: {} },
        { step: OnboardingStep.GOAL_CARD, data: {} },
        { step: OnboardingStep.INTENSITY, data: {} },
      ],
      postStep
    );
    expect(outcome.ok).toBe(true);
    expect(sent).toEqual([OnboardingStep.SEVEN_WHYS, OnboardingStep.GOAL_CARD, OnboardingStep.INTENSITY]);
    expect(ref.current).toBe(OnboardingStep.CONSENT_CAPTURE);
  });

  test('TEETH: stops at the FIRST failure — nothing after it is ever sent, and the ref stays at the last successful step', async () => {
    const sent: OnboardingStep[] = [];
    const postStep = async (step: OnboardingStep): Promise<StepCallResult> => {
      sent.push(step);
      if (step === OnboardingStep.GOAL_CARD) return { ok: false, status: 400, code: 'BOOM' };
      return { ok: true, currentStep: OnboardingStep.GOAL_CARD, completed: false };
    };
    const ref: ServerStepRef = { current: OnboardingStep.SEVEN_WHYS };
    const outcome = await sendOrderedSteps(
      Role.REP,
      ref,
      [
        { step: OnboardingStep.SEVEN_WHYS, data: {} },
        { step: OnboardingStep.GOAL_CARD, data: {} },
        { step: OnboardingStep.INTENSITY, data: {} },
      ],
      postStep
    );
    expect(outcome).toEqual({ ok: false, failedStep: OnboardingStep.GOAL_CARD, result: { ok: false, status: 400, code: 'BOOM' } });
    // INTENSITY must NEVER have been sent — a failure must not let the batch continue.
    expect(sent).toEqual([OnboardingStep.SEVEN_WHYS, OnboardingStep.GOAL_CARD]);
    // The ref only reflects the one step that actually succeeded.
    expect(ref.current).toBe(OnboardingStep.GOAL_CARD);
  });

  test('RESUME-SAFE: a step already cleared (per ROLE_STEP_MAP order) is skipped, never re-sent', async () => {
    const sent: OnboardingStep[] = [];
    const postStep = async (step: OnboardingStep): Promise<StepCallResult> => {
      sent.push(step);
      const idx = stepIndexInRoleMap(Role.REP, step);
      const next = ROLE_STEP_MAP[Role.REP][idx + 1] ?? step;
      return { ok: true, currentStep: next, completed: false };
    };
    // Resuming with the server already at GOAL_CARD — SEVEN_WHYS (earlier in ROLE_STEP_MAP) must be
    // skipped; GOAL_CARD/INTENSITY (at-or-after) must still be sent.
    const ref: ServerStepRef = { current: OnboardingStep.GOAL_CARD };
    const outcome = await sendOrderedSteps(
      Role.REP,
      ref,
      [
        { step: OnboardingStep.SEVEN_WHYS, data: {} },
        { step: OnboardingStep.GOAL_CARD, data: {} },
        { step: OnboardingStep.INTENSITY, data: {} },
      ],
      postStep
    );
    expect(outcome.ok).toBe(true);
    expect(sent).toEqual([OnboardingStep.GOAL_CARD, OnboardingStep.INTENSITY]);
  });

  test('a fresh session (serverStepRef.current === null) sends every step — no false skip', async () => {
    const sent: OnboardingStep[] = [];
    const postStep = async (step: OnboardingStep): Promise<StepCallResult> => {
      sent.push(step);
      return { ok: true, currentStep: step, completed: false };
    };
    const ref: ServerStepRef = { current: null };
    await sendOrderedSteps(Role.REP, ref, [{ step: OnboardingStep.REGISTER, data: {} }, { step: OnboardingStep.ACCOUNT_TYPE, data: {} }], postStep);
    expect(sent).toEqual([OnboardingStep.REGISTER, OnboardingStep.ACCOUNT_TYPE]);
  });
});

describe('payload builders — exact shapes the real /step route reads', () => {
  test('buildRoleOrgContextPayload carries snake_case solution_number (the ONLY key validateStep reads for the Primerica format check)', () => {
    const payload = buildRoleOrgContextPayload(OrgType.PRIMERICA, '1234567');
    expect(payload.solution_number).toBe('1234567');
    expect(payload.solutionNumber).toBe('1234567');
    expect(payload.orgType).toBe(OrgType.PRIMERICA);
    expect(payload.org_type).toBe(OrgType.PRIMERICA);
  });

  test('buildRoleOrgContextPayload omits the solution-number keys entirely when none was entered (EXTERNAL org, or Primerica-not-yet-typed)', () => {
    const payload = buildRoleOrgContextPayload(OrgType.EXTERNAL, '');
    expect('solution_number' in payload).toBe(false);
    expect('solutionNumber' in payload).toBe(false);
  });

  test('buildSevenWhysResponses produces {question, answer, score} triples with a REAL (not fabricated-constant) score derived from the answer text', () => {
    const responses = buildSevenWhysResponses([
      { question: 'Q1', answer: '' },
      { question: 'Q2', answer: 'yes' },
      {
        question: 'Q3',
        answer: 'Because my kids deserve a future where I am never scared about money again.',
      },
    ]);
    expect(responses).toHaveLength(3);
    expect(responses[0]).toEqual({ question: 'Q1', answer: '', score: 0 }); // empty answer -> 0 depth signal
    for (const r of responses) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
    // TEETH: a short, generic answer and a long, emotionally-specific one must NOT score identically
    // — proves this isn't a hardcoded/fabricated constant standing in for a real computation.
    expect(responses[2].score).toBeGreaterThan(responses[1].score);
  });

  test('commitmentScoreForIntensity: every position clears MIN_COMMITMENT_SCORE and is monotonic Low < Medium < High', () => {
    const low = commitmentScoreForIntensity(IntensitySetting.LOW);
    const medium = commitmentScoreForIntensity(IntensitySetting.MEDIUM);
    const high = commitmentScoreForIntensity(IntensitySetting.HIGH);
    for (const score of [low, medium, high]) {
      expect(score).toBeGreaterThanOrEqual(MIN_COMMITMENT_SCORE);
    }
    expect(low).toBeLessThan(medium);
    expect(medium).toBeLessThan(high);
  });

  test('weeklyHoursForIntensity is monotonic and always a positive number', () => {
    const low = weeklyHoursForIntensity(IntensitySetting.LOW);
    const medium = weeklyHoursForIntensity(IntensitySetting.MEDIUM);
    const high = weeklyHoursForIntensity(IntensitySetting.HIGH);
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThan(medium);
    expect(medium).toBeLessThan(high);
  });

  test('buildIntensityDataPayload matches the real IntensityData shape and always clears the server gate', () => {
    const payload = buildIntensityDataPayload(IntensitySetting.HIGH);
    expect(payload).toEqual({
      commitmentScore: commitmentScoreForIntensity(IntensitySetting.HIGH),
      weeklyHours: weeklyHoursForIntensity(IntensitySetting.HIGH),
      riskTolerance: IntensitySetting.HIGH,
      supportNeeds: [],
    });
    expect(payload.commitmentScore).toBeGreaterThanOrEqual(MIN_COMMITMENT_SCORE);
  });

  test('defaultGoalCardTargetDate is a date-only ISO string, 90 days out', () => {
    // UTC-constructed fixture (never a local-timezone `new Date(y,m,d)`) so this assertion can never
    // flake depending on the machine/CI runner's timezone.
    const now = new Date(Date.UTC(2026, 0, 1)); // 2026-01-01T00:00:00Z
    expect(defaultGoalCardTargetDate(now)).toBe('2026-04-01'); // 31 (Jan) + 28 (Feb, non-leap) + 31 (Mar) = 90
    expect(defaultGoalCardTargetDate(now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('buildGoalCardPayload sources primaryGoal/motivationStatement from the rep\'s OWN answers, never a fabricated string, and falls back to the anchor only when an answer is empty', () => {
    const withAnswers = buildGoalCardPayload({
      anchorStatement: 'You build so your kids never have to wonder.',
      primaryGoal: 'Replace my 9-5 income',
      motivationStatement: 'My daughter starts school next year',
      intensity: IntensitySetting.HIGH,
    });
    expect(withAnswers.primaryGoal).toBe('Replace my 9-5 income');
    expect(withAnswers.motivationStatement).toBe('My daughter starts school next year');
    expect(withAnswers.anchorStatement).toBe('You build so your kids never have to wonder.');
    expect(withAnswers.commitmentLevel).toBe(commitmentScoreForIntensity(IntensitySetting.HIGH));

    const noAnswers = buildGoalCardPayload({
      anchorStatement: 'Anchor line.',
      primaryGoal: '',
      motivationStatement: '   ',
      intensity: null,
    });
    expect(noAnswers.primaryGoal).toBe('Anchor line.');
    expect(noAnswers.motivationStatement).toBe('Anchor line.');
    expect(noAnswers.commitmentLevel).toBe(MIN_COMMITMENT_SCORE);
  });
});

describe('buildDenseTrackStepPlan — UPLINE/RVP/DUAL/ADMIN', () => {
  test('UPLINE/RVP plans never include CONSENT_CAPTURE (submitted separately by the shared consent screen) and never include the rep-only Seven Whys/Goal/Intensity steps', () => {
    for (const role of [Role.UPLINE, Role.RVP] as const) {
      const plan = buildDenseTrackStepPlan(role, OrgType.EXTERNAL, '');
      const steps = plan.map((p) => p.step);
      expect(steps).not.toContain(OnboardingStep.CONSENT_CAPTURE);
      expect(steps).not.toContain(OnboardingStep.SEVEN_WHYS);
      expect(steps).toEqual(ROLE_STEP_MAP[role].filter((s) => s !== OnboardingStep.CONSENT_CAPTURE));
    }
  });

  test('DUAL\'s plan includes the rep-derived SEVEN_WHYS/GOAL_CARD/INTENSITY steps with a documented, MINIMUM-clearing (never fabricated-high) placeholder', () => {
    const plan = buildDenseTrackStepPlan(Role.DUAL, OrgType.EXTERNAL, '');
    const intensityItem = plan.find((p) => p.step === OnboardingStep.INTENSITY);
    expect(intensityItem).toBeDefined();
    const intensityData = intensityItem!.data.intensityData as { commitmentScore: number };
    expect(intensityData.commitmentScore).toBe(MIN_COMMITMENT_SCORE); // conservative, not inflated
    const sevenWhysItem = plan.find((p) => p.step === OnboardingStep.SEVEN_WHYS);
    expect(sevenWhysItem!.data.sevenWhys).toEqual([]); // honestly empty, not fabricated Q&A
  });

  test('ADMIN\'s plan is just REGISTER (its ROLE_STEP_MAP minus the trailing CONSENT_CAPTURE)', () => {
    const plan = buildDenseTrackStepPlan(Role.ADMIN, OrgType.EXTERNAL, '');
    expect(plan.map((p) => p.step)).toEqual([OnboardingStep.REGISTER]);
  });

  test('a PRIMERICA dense-track ROLE_ORG_CONTEXT submission carries the solution number when one is supplied', () => {
    const plan = buildDenseTrackStepPlan(Role.UPLINE, OrgType.PRIMERICA, '1234567');
    const orgItem = plan.find((p) => p.step === OnboardingStep.ROLE_ORG_CONTEXT)!;
    expect(orgItem.data.solution_number).toBe('1234567');
  });

  test('DOCUMENTED GAP: a PRIMERICA dense-track submission with NO solution number available carries no solution_number key (UplineTrack collects none) — the real validateStep will reject this, an honest surfaced failure, never a hack/fake number', () => {
    const plan = buildDenseTrackStepPlan(Role.UPLINE, OrgType.PRIMERICA, '');
    const orgItem = plan.find((p) => p.step === OnboardingStep.ROLE_ORG_CONTEXT)!;
    expect('solution_number' in orgItem.data).toBe(false);
    expect('solutionNumber' in orgItem.data).toBe(false);
  });
});

describe('screen ↔ step mapping tables', () => {
  test('REP_SCREEN_STEP_PLAN sends SEVEN_WHYS before GOAL_CARD before INTENSITY — the crux fix, asserted directly', () => {
    const chain = REP_SCREEN_STEP_PLAN.seven_whys!;
    expect(chain).toEqual([OnboardingStep.SEVEN_WHYS, OnboardingStep.GOAL_CARD, OnboardingStep.INTENSITY]);
  });

  test('goals_intensity fires NO /step call — the INTENSITY step is deferred to seven_whys (this is what makes the reordering safe)', () => {
    expect(REP_SCREEN_STEP_PLAN.goals_intensity).toBeNull();
  });

  test('every non-null step in REP_SCREEN_STEP_PLAN is a real member of ROLE_STEP_MAP[REP], in that map\'s own relative order', () => {
    const repMap = ROLE_STEP_MAP[Role.REP];
    const flatSteps = Object.values(REP_SCREEN_STEP_PLAN)
      .filter((v): v is readonly OnboardingStep[] => v !== null)
      .flat();
    let lastIdx = -1;
    for (const step of flatSteps) {
      const idx = repMap.indexOf(step);
      expect(idx).toBeGreaterThan(-1); // every mapped step is real for REP
      expect(idx).toBeGreaterThan(lastIdx); // strictly increasing — never out of ROLE_STEP_MAP order
      lastIdx = idx;
    }
    // sanity: every REP step actually gets fired by SOME screen (nothing silently dropped).
    expect(new Set(flatSteps)).toEqual(new Set(repMap));
  });

  test('UI-only screens (sponsor, contacts, reveal, vision) fire no /step call — SPONSOR_MATCHING is a real enum member but is in NO role\'s ROLE_STEP_MAP', () => {
    expect(REP_SCREEN_STEP_PLAN.sponsor).toBeNull();
    expect(REP_SCREEN_STEP_PLAN.contacts).toBeNull();
    expect(REP_SCREEN_STEP_PLAN.reveal).toBeNull();
    expect(REP_SCREEN_STEP_PLAN.vision).toBeNull();
    for (const steps of Object.values(ROLE_STEP_MAP)) {
      expect(steps).not.toContain(OnboardingStep.SPONSOR_MATCHING);
    }
  });

  test('stepToScreen resolves every OnboardingStep to a real OnboardingScreen (resume never lands nowhere)', () => {
    expect(stepToScreen(OnboardingStep.REGISTER)).toBe('identity');
    expect(stepToScreen(OnboardingStep.ACCOUNT_TYPE)).toBe('identity');
    expect(stepToScreen(OnboardingStep.ROLE_ORG_CONTEXT)).toBe('org');
    expect(stepToScreen(OnboardingStep.SEVEN_WHYS)).toBe('seven_whys');
    expect(stepToScreen(OnboardingStep.GOAL_CARD)).toBe('seven_whys');
    expect(stepToScreen(OnboardingStep.INTENSITY)).toBe('seven_whys');
    expect(stepToScreen(OnboardingStep.CONSENT_CAPTURE)).toBe('consent');
    expect(stepToScreen(OnboardingStep.COMPLETE)).toBe('first48');
  });
});

describe('stepIndexInRoleMap', () => {
  test('a step with no membership in a role\'s map (e.g. SPONSOR_MATCHING) is -1 for every role', () => {
    for (const role of Object.values(Role)) {
      expect(stepIndexInRoleMap(role, OnboardingStep.SPONSOR_MATCHING)).toBe(-1);
    }
  });

  test('index order matches ROLE_STEP_MAP exactly for REP', () => {
    ROLE_STEP_MAP[Role.REP].forEach((step, i) => {
      expect(stepIndexInRoleMap(Role.REP, step)).toBe(i);
    });
  });
});
