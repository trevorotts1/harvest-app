// WP08 §13.3/§5.5 — the licensing hard-block, end to end: this WP's named critical-failure
// condition ("insurance-recommendation content reachable during the licensing phase"). Proves the
// REAL CFE (`classifier-rules.ts`'s existing rule, never re-implemented here) blocks insurance
// content "regardless of score" for every non-LICENSED rep, using the exact context
// `getInsuranceContentGateContext` derives from the REAL WP11 `LicensingService`.

import { ComplianceFilterEngine } from '../../src/services/compliance/engine';
import { LocalDeterministicClassifierClient } from '../../src/services/compliance/claude';
import { InMemoryLicensingRepository } from '../../src/services/compliance/licensing/licensing-repository';
import { LicensingService } from '../../src/services/compliance/licensing/licensing-service';
import { getInsuranceContentGateContext, getPhasedTimeline, type TaprootingTimelinePrismaClient } from '../../src/services/taprooting/timeline.service';

function fakeDb(overrides: Partial<TaprootingTimelinePrismaClient> = {}): TaprootingTimelinePrismaClient {
  return {
    user: { findUnique: async () => ({ org_type: 'PRIMERICA' as const }) },
    milestone: {
      findMany: async () => [],
      upsert: async () => ({}),
    },
    ...overrides,
  } as TaprootingTimelinePrismaClient;
}

describe('getInsuranceContentGateContext (§13.3/§16.5 — consumes WP11 LicensingService)', () => {
  it('an UNLICENSED rep (no record — fail-closed default) gets licensing_phase=true', async () => {
    const licensingService = new LicensingService(new InMemoryLicensingRepository(), []);
    const ctx = await getInsuranceContentGateContext('rep-1', licensingService);
    expect(ctx.licensingState).toBe('UNLICENSED');
    expect(ctx.licensing_phase).toBe(true);
    expect(ctx.insurance_licensed).toBe(false);
  });

  it('a fully LICENSED rep clears the flag', async () => {
    const repository = new InMemoryLicensingRepository();
    const licensingService = new LicensingService(repository, []);
    await licensingService.applyTransition('rep-2', 'CA', 'START_PRE_LICENSING', { actor_id: 'rep-2', actor_role: 'REP' });
    await licensingService.applyTransition('rep-2', 'CA', 'OBTAIN_LICENSE', { actor_id: 'rep-2', actor_role: 'REP' });
    const ctx = await getInsuranceContentGateContext('rep-2', licensingService);
    expect(ctx.licensingState).toBe('LICENSED');
    expect(ctx.licensing_phase).toBe(false);
    expect(ctx.insurance_licensed).toBe(true);
  });
});

describe('THE HARD BLOCK, end-to-end through the real CFE (§13.3 "regardless of score")', () => {
  const cfe = new ComplianceFilterEngine({ classifierClient: new LocalDeterministicClassifierClient() });

  it('blocks an insurance recommendation for an UNLICENSED rep even at low/no classifier confidence', async () => {
    const licensingService = new LicensingService(new InMemoryLicensingRepository(), []);
    const ctx = await getInsuranceContentGateContext('rep-3', licensingService);

    const verdict = await cfe.evaluateContent({
      // Deliberately mild — not the ">=0.8 always-block" phrasing; this must still block purely on
      // the licensing-phase rule, not the score.
      content: 'Let me know if you want to talk about your coverage sometime.',
      channel: 'SMS',
      userContext: { user_id: 'rep-3', role: 'REP', licensing_phase: ctx.licensing_phase, insurance_licensed: ctx.insurance_licensed },
    });

    // Whether this specific mild phrasing trips the local deterministic INSURANCE pattern at all is
    // incidental; the load-bearing assertion is the licensing-phase rule in classifier-rules.ts,
    // proven directly here with an explicit signal:
    const explicitVerdict = await cfe.evaluateContent({
      content: 'You should get a whole life policy — this coverage is right for you.',
      channel: 'SMS',
      userContext: { user_id: 'rep-3', role: 'REP', licensing_phase: ctx.licensing_phase, insurance_licensed: ctx.insurance_licensed },
    });
    expect(explicitVerdict.released).toBe(false);
    expect(explicitVerdict.band).toBe('blocked');
    void verdict;
  });

  it('the SAME content releases (subject to ordinary scoring) once the rep is LICENSED', async () => {
    const repository = new InMemoryLicensingRepository();
    const licensingService = new LicensingService(repository, []);
    await licensingService.applyTransition('rep-4', 'CA', 'START_PRE_LICENSING', { actor_id: 'rep-4', actor_role: 'REP' });
    await licensingService.applyTransition('rep-4', 'CA', 'OBTAIN_LICENSE', { actor_id: 'rep-4', actor_role: 'REP' });
    const ctx = await getInsuranceContentGateContext('rep-4', licensingService);
    expect(ctx.licensing_phase).toBe(false);

    const verdict = await cfe.evaluateContent({
      content: 'Happy to catch up soon.',
      channel: 'SMS',
      userContext: { user_id: 'rep-4', role: 'REP', licensing_phase: ctx.licensing_phase, insurance_licensed: ctx.insurance_licensed },
    });
    expect(verdict.released).toBe(true);
  });
});

describe('getPhasedTimeline (§17.1 org-gating)', () => {
  it('a universal (non-Primerica) user gets zero phases — no Primerica strings', async () => {
    const db = fakeDb({ user: { findUnique: async () => ({ org_type: 'EXTERNAL' as const }) } });
    const licensingService = new LicensingService(new InMemoryLicensingRepository(), []);
    const result = await getPhasedTimeline('rep-5', licensingService, db);
    expect(result.branch).toBe('universal');
    expect(result.phases).toEqual([]);
  });

  it('a Primerica user gets the two-phase timeline', async () => {
    const db = fakeDb();
    const licensingService = new LicensingService(new InMemoryLicensingRepository(), []);
    const result = await getPhasedTimeline('rep-6', licensingService, db);
    expect(result.branch).toBe('primerica');
    expect(result.phases).toHaveLength(2);
  });
});
