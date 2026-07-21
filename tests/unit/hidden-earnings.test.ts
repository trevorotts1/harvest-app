// T-24 — the Hidden Earnings engine (master-spec §7.3 + §8.4; uiux §4.13 / §5.1 O-8; §18.5).
//
// These tests prove, with teeth, the exact critical failure this build unit exists to prevent
// (QC WP02 block): "Hidden Earnings without the safe-harbor line on any render, or a rendered
// NaN/$0." Each `TEETH` test states what regression it would catch and demonstrates the guard
// actually firing (not just that the happy path looks right).

import { OrgType, Role } from '@prisma/client';

import { OrgBranchViolation } from '@/services/onboarding/wp01/org-gate';
import {
  computeHiddenEarnings,
  computePrimericaFigure,
  computeUniversalFigure,
  composeHiddenEarningsOutreachLine,
  buildScreenReaderUtterance,
  renderHiddenEarningsPayload,
  routeHiddenEarningsToOutreach,
  assertSafeHarborPresent,
  SafeHarborOmittedError,
  SAFE_HARBOR_LINE,
  SAFE_HARBOR_LINE_SPOKEN,
  GROWTH_PATH_CONTACT_THRESHOLD,
  GROWTH_PATH_HEADLINE,
  GROWTH_PATH_BODY,
  DEFAULT_AVG_CLIENT_VALUE_USD,
  type HiddenEarningsFigure,
  type HiddenEarningsGrowthPath,
  type HiddenEarningsResult,
} from '@/services/warm-market/hidden-earnings';
import type { CFEVerdict } from '@/types/compliance';

// ─── (a) Safe harbor on EVERY render — no omission path ──────────────────────────────────────────
describe('(a) safe harbor renders on EVERY Hidden Earnings output — no code path can omit it', () => {
  test('a real figure (42 contacts, universal) carries the exact safe-harbor line', () => {
    const result = computeHiddenEarnings({ contactCount: 42, orgType: OrgType.EXTERNAL });
    expect(result.safeHarborLine).toBe(SAFE_HARBOR_LINE);
  });

  test('the 0-contact growth path ALSO carries the safe-harbor line (§18.5 "safe harbor always" — the growth path is not exempt)', () => {
    const result = computeHiddenEarnings({ contactCount: 0, orgType: OrgType.EXTERNAL });
    expect(result.kind).toBe('growth_path');
    expect(result.safeHarborLine).toBe(SAFE_HARBOR_LINE);
  });

  test('Primerica-calibrated figures ALSO carry the safe-harbor line', () => {
    const result = computeHiddenEarnings({
      contactCount: 100,
      orgType: OrgType.PRIMERICA,
      hasValidSolutionNumber: true,
    });
    expect(result.kind).toBe('figure');
    expect(result.safeHarborLine).toBe(SAFE_HARBOR_LINE);
  });

  test('every render surface (API payload, SR utterance, outreach copy) carries the exact line', () => {
    const result = computeHiddenEarnings({ contactCount: 42, orgType: OrgType.EXTERNAL });
    expect(renderHiddenEarningsPayload(result).safeHarborLine).toBe(SAFE_HARBOR_LINE);
    expect(buildScreenReaderUtterance(result)).toMatch(/potential, not a promise/i);
    expect(composeHiddenEarningsOutreachLine(result)).toContain(SAFE_HARBOR_LINE);
  });

  test('TEETH: a hand-built result missing the safe-harbor line is REFUSED (not silently repaired) by every render/serialize/outreach boundary — this is exactly the regression the guard exists to catch if `mkFigure`/`mkGrowthPath` were ever bypassed', () => {
    // Simulates the one way a disclaimer-free figure could ever reach a render boundary: a future
    // refactor hand-assembling a result object instead of going through the engine's private
    // factories. `assertSafeHarborPresent` — and everything built on it — must throw, not patch it in.
    const tampered = {
      kind: 'figure',
      contactCount: 42,
      estimatedAppointments: 10,
      estimatedClients: 2,
      estimatedMonthlyValueUsd: 700,
      calibration: 'universal',
      safeHarborLine: 'Definitely earn this much every month, guaranteed.', // the omission/corruption
    } as unknown as HiddenEarningsResult;

    expect(() => assertSafeHarborPresent(tampered)).toThrow(SafeHarborOmittedError);
    expect(() => renderHiddenEarningsPayload(tampered)).toThrow(SafeHarborOmittedError);
    expect(() => buildScreenReaderUtterance(tampered)).toThrow(SafeHarborOmittedError);
    expect(() => composeHiddenEarningsOutreachLine(tampered)).toThrow(SafeHarborOmittedError);
  });

  test('TEETH: a result with the disclaimer entirely absent (undefined) is refused the same way', () => {
    const strippedGrowthPath = {
      kind: 'growth_path',
      contactCount: 1,
      headline: GROWTH_PATH_HEADLINE,
      body: GROWTH_PATH_BODY,
      safeHarborLine: undefined,
    } as unknown as HiddenEarningsResult;

    expect(() => assertSafeHarborPresent(strippedGrowthPath)).toThrow(SafeHarborOmittedError);
  });
});

// ─── (b) 0–3 contacts → growth path, NEVER NaN/$0 ────────────────────────────────────────────────
describe('(b) 0, 1, 2, 3 contacts → growth-path state, never NaN/$0/Infinity', () => {
  test.each([0, 1, 2, 3])('contactCount=%i renders the growth path, not a figure', (n) => {
    const result = computeHiddenEarnings({ contactCount: n, orgType: OrgType.EXTERNAL });
    expect(result.kind).toBe('growth_path');
    const growthPath = result as HiddenEarningsGrowthPath;
    expect(growthPath.headline).toBe(GROWTH_PATH_HEADLINE);
    expect(growthPath.body).toBe(GROWTH_PATH_BODY);
    // No numeric dollar field exists on the growth-path shape at all — there is no `$0` to render.
    expect('estimatedMonthlyValueUsd' in growthPath).toBe(false);
  });

  test('TEETH: contactCount=3 (the boundary) is growth path; contactCount=20 (the spec\'s own worked example) is a real figure — proves the threshold is exact, not off-by-one', () => {
    expect(computeHiddenEarnings({ contactCount: 3, orgType: OrgType.EXTERNAL }).kind).toBe('growth_path');
    const twenty = computeHiddenEarnings({ contactCount: 20, orgType: OrgType.EXTERNAL });
    expect(twenty.kind).toBe('figure');
  });

  test('TEETH: the spec\'s own §7.3 worked example (20 contacts -> 5 appointments -> 1 client)', () => {
    const result = computeHiddenEarnings({
      contactCount: 20,
      orgType: OrgType.EXTERNAL,
      avgClientValueUsd: 300,
    }) as HiddenEarningsFigure;
    expect(result.estimatedAppointments).toBe(5);
    expect(result.estimatedClients).toBe(1);
    expect(result.estimatedMonthlyValueUsd).toBe(300);
  });

  test('TEETH: counts strictly above 3 that STILL floor to a zero-client figure (4..19 universal) never render $0 — the "never $0" law is not merely the literal "0-3" text', () => {
    for (const n of [4, 7, 10, 15, 19]) {
      const result = computeHiddenEarnings({ contactCount: n, orgType: OrgType.EXTERNAL });
      expect(result.kind).toBe('growth_path'); // never a figure carrying $0
    }
  });

  test('TEETH: same gap for the Primerica branch (4..11 with a valid solution number)', () => {
    for (const n of [4, 7, 11]) {
      const result = computeHiddenEarnings({
        contactCount: n,
        orgType: OrgType.PRIMERICA,
        hasValidSolutionNumber: true,
      });
      expect(result.kind).toBe('growth_path');
    }
    // 12 is the first Primerica count where a whole client clears the floor.
    const twelve = computeHiddenEarnings({
      contactCount: 12,
      orgType: OrgType.PRIMERICA,
      hasValidSolutionNumber: true,
    });
    expect(twelve.kind).toBe('figure');
  });

  test('never NaN/Infinity: NaN, Infinity, and negative contact counts all resolve to a clean growth path', () => {
    for (const bad of [NaN, Infinity, -Infinity, -5, -0.0001]) {
      const result = computeHiddenEarnings({ contactCount: bad, orgType: OrgType.EXTERNAL });
      expect(result.kind).toBe('growth_path');
      // The growth-path shape structurally carries no numeric dollar field at all — assert its
      // absence directly. (Probing `estimatedMonthlyValueUsd` with `Number.isNaN` here would be
      // vacuous: the field doesn't exist on this variant, so `Number.isNaN(undefined) === false`
      // regardless of whether the engine is implemented correctly.)
      expect('estimatedMonthlyValueUsd' in result).toBe(false);
      expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
    }
  });

  test('TEETH: if the growth-path guard were removed, a naive formula would render $0 at contactCount=10 — proves the guard is load-bearing, not incidental', () => {
    // The naive (unguarded) universal formula this engine deliberately does NOT expose directly.
    const naiveAppointments = Math.floor(10 * 0.25); // 2
    const naiveClients = Math.floor(naiveAppointments * 0.2); // 0
    expect(naiveClients).toBe(0); // confirms the naive path WOULD be $0
    // ...but the real engine never returns that as a figure:
    const guarded = computeHiddenEarnings({ contactCount: 10, orgType: OrgType.EXTERNAL });
    expect(guarded.kind).toBe('growth_path');
  });
});

// ─── (c) Primerica calibration is org-gated — a non-Primerica user never sees it ─────────────────
describe('(c) Primerica calibration only behind the org gate (§8.4/§17.1)', () => {
  test('a Primerica user WITH a valid solution number gets Primerica-calibrated numbers', () => {
    const result = computeHiddenEarnings({
      contactCount: 100,
      orgType: OrgType.PRIMERICA,
      hasValidSolutionNumber: true,
    }) as HiddenEarningsFigure;
    expect(result.calibration).toBe('primerica');
    // §8.4: appointments = floor(100*0.35) = 35; clients = floor(35*0.30) = 10; value = 10*350.
    expect(result.estimatedAppointments).toBe(35);
    expect(result.estimatedClients).toBe(10);
    expect(result.estimatedMonthlyValueUsd).toBe(3500);
  });

  test('a Primerica user WITHOUT a valid solution number gets the universal formula, not Primerica numbers', () => {
    const result = computeHiddenEarnings({
      contactCount: 100,
      orgType: OrgType.PRIMERICA,
      hasValidSolutionNumber: false,
    }) as HiddenEarningsFigure;
    expect(result.calibration).toBe('universal');
    expect(result.estimatedAppointments).toBe(25); // floor(100*0.25)
    expect(result.estimatedClients).toBe(5); // floor(25*0.20)
  });

  test('TEETH: a non-Primerica (universal/EXTERNAL) user NEVER receives Primerica calibration, even if `hasValidSolutionNumber: true` is (incorrectly) passed', () => {
    const result = computeHiddenEarnings({
      contactCount: 100,
      orgType: OrgType.EXTERNAL,
      hasValidSolutionNumber: true, // should be impossible upstream, but the engine must not trust it
    }) as HiddenEarningsFigure;
    expect(result.calibration).toBe('universal');
    expect(result.estimatedAppointments).toBe(25);
    expect(result.estimatedClients).toBe(5);
  });

  test('TEETH: calling the Primerica formula pass directly for a non-Primerica org throws (fails CLOSED) — proves this is not merely convention but an enforced org-gate, per §17.1\'s "guard the service, not just the caller"', () => {
    expect(() => computePrimericaFigure(OrgType.EXTERNAL, 100)).toThrow(OrgBranchViolation);
  });

  test('the universal formula pass has no org dependency at all and is available to every org', () => {
    expect(computeUniversalFigure(100, 350)).toEqual({
      estimatedAppointments: 25,
      estimatedClients: 5,
      estimatedMonthlyValueUsd: 1750,
    });
  });

  test('a rendered universal-branch payload contains zero Primerica strings/numbers, even serialized', () => {
    const result = computeHiddenEarnings({ contactCount: 100, orgType: OrgType.EXTERNAL });
    const payload = renderHiddenEarningsPayload(result);
    const serialized = JSON.stringify(payload).toLowerCase();
    expect(serialized).not.toMatch(/primerica/);
    expect(serialized).not.toContain('0.35');
    expect(serialized).not.toContain('350'); // the Primerica fixed client value never appears here
  });
});

// ─── (d) Framed as potential/illustrative — never a guarantee ────────────────────────────────────
describe('(d) framed as potential, never a guaranteed/promised outcome', () => {
  const forbiddenGuaranteePhrases = [/guarantee/i, /you will earn/i, /promise(d)? income/i, /we promise/i];

  test('the safe-harbor line itself explicitly frames the figure as potential, not a promise', () => {
    expect(SAFE_HARBOR_LINE).toMatch(/potential, not a promise/i);
    expect(SAFE_HARBOR_LINE_SPOKEN).toMatch(/potential, not a promise/i);
  });

  test('TEETH: no exported copy string in this module contains a forbidden guarantee phrase (§0.5: "guaranteed income / \'you will earn\'" is doctrine-forbidden)', () => {
    const copyStrings = [
      SAFE_HARBOR_LINE,
      SAFE_HARBOR_LINE_SPOKEN,
      GROWTH_PATH_HEADLINE,
      GROWTH_PATH_BODY,
    ];
    for (const copy of copyStrings) {
      for (const forbidden of forbiddenGuaranteePhrases) {
        expect(copy).not.toMatch(forbidden);
      }
    }
  });

  test('the outreach-composed line frames the figure as "could represent"/"estimated," never a guarantee, and still carries the safe harbor', () => {
    const result = computeHiddenEarnings({ contactCount: 42, orgType: OrgType.EXTERNAL });
    const line = composeHiddenEarningsOutreachLine(result);
    expect(line).toMatch(/could represent|estimated/i);
    for (const forbidden of forbiddenGuaranteePhrases) {
      expect(line).not.toMatch(forbidden);
    }
    expect(line).toContain(SAFE_HARBOR_LINE);
  });
});

// ─── (e) Division/edge-input guards ──────────────────────────────────────────────────────────────
describe('(e) division/edge-input guards (0-denominator, huge N, negative, non-finite)', () => {
  test('a huge contact count (Number.MAX_SAFE_INTEGER) never produces NaN/Infinity', () => {
    const result = computeHiddenEarnings({ contactCount: Number.MAX_SAFE_INTEGER, orgType: OrgType.EXTERNAL });
    expect(result.kind).toBe('figure');
    const figure = result as HiddenEarningsFigure;
    expect(Number.isFinite(figure.estimatedMonthlyValueUsd)).toBe(true);
    expect(Number.isFinite(figure.estimatedAppointments)).toBe(true);
    expect(Number.isFinite(figure.estimatedClients)).toBe(true);
  });

  test('contactCount = Infinity resolves to the growth path (sanitized to 0), never a crash or NaN', () => {
    const result = computeHiddenEarnings({ contactCount: Infinity, orgType: OrgType.EXTERNAL });
    expect(result.kind).toBe('growth_path');
    expect(result.contactCount).toBe(0);
  });

  test('a negative avgClientValueUsd override is guarded — falls back to the documented default, never a negative dollar figure', () => {
    const result = computeHiddenEarnings({
      contactCount: 40, // appointments=10, clients=2 under universal — clears the growth-path floor
      orgType: OrgType.EXTERNAL,
      avgClientValueUsd: -999,
    }) as HiddenEarningsFigure;
    expect(result.kind).toBe('figure');
    expect(result.estimatedMonthlyValueUsd).toBeGreaterThan(0);
    expect(result.estimatedMonthlyValueUsd).toBe(2 * DEFAULT_AVG_CLIENT_VALUE_USD);
  });

  test('a zero or NaN avgClientValueUsd override is guarded the same way (0-denominator-style bad input)', () => {
    for (const bad of [0, NaN, -Infinity]) {
      const result = computeHiddenEarnings({
        contactCount: 40,
        orgType: OrgType.EXTERNAL,
        avgClientValueUsd: bad,
      }) as HiddenEarningsFigure;
      expect(result.estimatedMonthlyValueUsd).toBe(2 * DEFAULT_AVG_CLIENT_VALUE_USD);
    }
  });

  test('fractional contact counts are floored before any multiplication (never a fractional/undefined intermediate)', () => {
    const result = computeHiddenEarnings({ contactCount: 40.9, orgType: OrgType.EXTERNAL }) as HiddenEarningsFigure;
    expect(result.contactCount).toBe(40);
  });
});

// ─── CFE-gating for any earnings content routed to outreach/send (charter item 5; §5/§18.1) ──────
describe('CFE gating: earnings content headed to outreach/send is fail-closed CFE-gated', () => {
  function verdict(overrides: Partial<CFEVerdict>): CFEVerdict {
    return {
      band: 'clear',
      score: 0,
      classifierResults: [],
      held: false,
      released: true,
      reason: 'clean',
      heldReason: null,
      safeHarbor: { injected: false, disclaimers: [] },
      httpStatus: 200,
      ruleVersion: '1.0.0',
      auditEvent: {} as CFEVerdict['auditEvent'],
      ...overrides,
    };
  }

  const userContext = { user_id: 'u1', role: Role.REP };

  test('a released CFE verdict yields allowed:true and returns the composed, safe-harbor-carrying text', async () => {
    const result = computeHiddenEarnings({ contactCount: 42, orgType: OrgType.EXTERNAL });
    const cfe = { evaluateContent: jest.fn().mockResolvedValue(verdict({})) };
    const decision = await routeHiddenEarningsToOutreach(result, cfe, userContext);
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.text).toContain(SAFE_HARBOR_LINE);
    }
    expect(cfe.evaluateContent).toHaveBeenCalledTimes(1);
  });

  test('TEETH: a HELD (fail-closed/unavailable) CFE verdict is never treated as sendable', async () => {
    const result = computeHiddenEarnings({ contactCount: 42, orgType: OrgType.EXTERNAL });
    const cfe = {
      evaluateContent: jest.fn().mockResolvedValue(verdict({ held: true, released: false, band: 'blocked' })),
    };
    const decision = await routeHiddenEarningsToOutreach(result, cfe, userContext);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('cfe_held');
  });

  test('TEETH: a BLOCKED CFE verdict is never treated as sendable', async () => {
    const result = computeHiddenEarnings({ contactCount: 42, orgType: OrgType.EXTERNAL });
    const cfe = {
      evaluateContent: jest.fn().mockResolvedValue(verdict({ held: false, released: false, band: 'blocked' })),
    };
    const decision = await routeHiddenEarningsToOutreach(result, cfe, userContext);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('cfe_blocked');
  });

  test('TEETH: if a CFE outage caused `evaluateContent` to reject, this function propagates the rejection rather than falling back to allowed:true (no silent bypass)', async () => {
    const result = computeHiddenEarnings({ contactCount: 42, orgType: OrgType.EXTERNAL });
    const cfe = { evaluateContent: jest.fn().mockRejectedValue(new Error('cfe down')) };
    await expect(routeHiddenEarningsToOutreach(result, cfe, userContext)).rejects.toThrow('cfe down');
  });
});

// ─── Growth-path threshold constant sanity ───────────────────────────────────────────────────────
describe('constants', () => {
  test('GROWTH_PATH_CONTACT_THRESHOLD is exactly 3, matching §7.3/§18.5 "0-3 contacts"', () => {
    expect(GROWTH_PATH_CONTACT_THRESHOLD).toBe(3);
  });
});
