// WP01 §6.3 + §17.1 — the org gate. Proves QC critical failure (b) is ABSENT: a non-Primerica
// (universal) user never receives Primerica-specific content/terms; the org-branch lock holds and is
// enforced at the data layer (SC8: "0 Primerica strings render for a non-Primerica user").

import { OrgType } from '@prisma/client';

import {
  OrgBranchViolation,
  assertNoPrimericaLeak,
  assertPrimericaGate,
  buildOrgContext,
  gatePrimericaValue,
  isPrimericaBranch,
  lockOrgBranch,
  scanForPrimericaTerms,
} from '../../src/services/onboarding/wp01/org-gate';

describe('WP01 org gate — §17.1 branch lock (§6.3)', () => {
  test('org selection locks exactly one branch; anything not PRIMERICA is universal (fail-closed)', () => {
    expect(lockOrgBranch(OrgType.PRIMERICA)).toBe('primerica');
    expect(lockOrgBranch(OrgType.EXTERNAL)).toBe('universal');
    expect(isPrimericaBranch(OrgType.PRIMERICA)).toBe(true);
    expect(isPrimericaBranch(OrgType.EXTERNAL)).toBe(false);
  });

  describe('branch enforcement — a Primerica-gated service does not run for a universal user', () => {
    test('assertPrimericaGate throws for a universal user, passes for a Primerica user', () => {
      expect(() => assertPrimericaGate(OrgType.EXTERNAL, 'orchard')).toThrow(OrgBranchViolation);
      expect(() => assertPrimericaGate(OrgType.PRIMERICA, 'orchard')).not.toThrow();
    });

    test('gatePrimericaValue omits the value entirely for a universal user', () => {
      expect(gatePrimericaValue(OrgType.PRIMERICA, { multiplier: 0.35 })).toEqual({ multiplier: 0.35 });
      expect(gatePrimericaValue(OrgType.EXTERNAL, { multiplier: 0.35 })).toBeUndefined();
    });
  });

  describe('data-layer tripwire — no Primerica string reaches a universal user', () => {
    test('scanForPrimericaTerms finds gated terms in values AND in field names', () => {
      expect(scanForPrimericaTerms({ note: 'Welcome to Primerica!' })).toContain('primerica');
      // A leak can hide in a key name, not just a value:
      expect(scanForPrimericaTerms({ solutionNumber: '1234567' })).toContain('solution number');
      expect(scanForPrimericaTerms({ mentor: 'A.L. Williams' })).toContain('a.l. williams');
      expect(scanForPrimericaTerms({ hello: 'world', nested: { ok: true } })).toEqual([]);
    });

    test('assertNoPrimericaLeak throws for a universal payload carrying a Primerica term', () => {
      const leaky = { headline: 'Your Primerica orchard', pfsu: true };
      expect(() => assertNoPrimericaLeak(leaky, OrgType.EXTERNAL)).toThrow(OrgBranchViolation);
    });

    test('assertNoPrimericaLeak is a no-op for a Primerica user (they are entitled to it)', () => {
      const primericaPayload = { headline: 'Your Primerica orchard' };
      expect(() => assertNoPrimericaLeak(primericaPayload, OrgType.PRIMERICA)).not.toThrow();
    });
  });

  describe('buildOrgContext — the authored branch fork of §6.3 Flow A step 3', () => {
    test('a Primerica user gets the solution-number field + Primerica surfaces', () => {
      const ctx = buildOrgContext(OrgType.PRIMERICA);
      expect(ctx.branch).toBe('primerica');
      expect(ctx.solutionNumberField).toBeDefined();
      expect(ctx.solutionNumberField?.caption).toMatch(/not verified/i);
      expect(ctx.primericaSurfaces).toEqual(expect.arrayContaining(['orchard']));
    });

    test('a universal user gets NEITHER field NOR surfaces — and the object is Primerica-free', () => {
      const ctx = buildOrgContext(OrgType.EXTERNAL);
      expect(ctx.branch).toBe('universal');
      expect(ctx.solutionNumberField).toBeUndefined();
      expect(ctx.primericaSurfaces).toBeUndefined();

      // The load-bearing SC8 assertion: 0 Primerica strings in a universal user's context. This is
      // the tripwire that would fire if buildOrgContext ever leaked a Primerica field to universal.
      expect(scanForPrimericaTerms(ctx)).toEqual([]);
      expect(() => assertNoPrimericaLeak(ctx, OrgType.EXTERNAL)).not.toThrow();
    });

    // TEETH: pointing the universal branch at the Primerica context (a gate regression) is caught —
    // proving the tripwire has teeth, not that the current output happens to be clean.
    test('the tripwire WOULD catch a Primerica context mistakenly served to a universal user', () => {
      const primericaCtx = buildOrgContext(OrgType.PRIMERICA);
      expect(() => assertNoPrimericaLeak(primericaCtx, OrgType.EXTERNAL)).toThrow(OrgBranchViolation);
    });
  });
});
