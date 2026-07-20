// T-43 (WP07 §12.4, §12.9-4) — the quote engine's doctrine-critical properties: EVERY quote passes
// the CFE before delivery, org-scoping never leaks Primerica content to a non-Primerica rep, and the
// surface never fabricates content when the CFE is unavailable (§18.6).

import { deliverQuote } from '../../src/services/gamification/quote.service';
import type { CFEContentEvaluator } from '../../src/services/gamification/cfe-gate';
import type { CFEVerdict } from '../../src/types/compliance';

const USER_CONTEXT = { user_id: 'rep-1', role: 'REP' as const };

function passingCFE(): CFEContentEvaluator {
  return {
    async evaluateContent(input): Promise<CFEVerdict> {
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
        ruleVersion: 'test',
        auditEvent: {} as CFEVerdict['auditEvent'],
      };
    },
  };
}

/** Rejects any content containing an income-promise-style phrase; passes everything else. */
function incomePromiseCatchingCFE(): CFEContentEvaluator {
  return {
    async evaluateContent(input): Promise<CFEVerdict> {
      const isIncomePromise = /guaranteed income|you will earn|\$\d+k? a (month|week|year)/i.test(input.content);
      return {
        band: isIncomePromise ? 'blocked' : 'clear',
        score: isIncomePromise ? 90 : 0,
        classifierResults: [],
        held: false,
        released: !isIncomePromise,
        reason: isIncomePromise ? 'income_claim' : 'clean',
        heldReason: null,
        safeHarbor: { injected: false, disclaimers: [] },
        httpStatus: isIncomePromise ? 403 : 200,
        ruleVersion: 'test',
        auditEvent: {} as CFEVerdict['auditEvent'],
      };
    },
  };
}

function heldCFE(): CFEContentEvaluator {
  return {
    async evaluateContent(): Promise<CFEVerdict> {
      return {
        band: 'blocked',
        score: 100,
        classifierResults: [],
        held: true,
        released: false,
        reason: 'held_for_review:cfe_unavailable',
        heldReason: 'cfe_unavailable',
        safeHarbor: { injected: false, disclaimers: [] },
        httpStatus: 503,
        ruleVersion: 'test',
        auditEvent: {} as CFEVerdict['auditEvent'],
      };
    },
  };
}

describe('quote.service — org-scoping is a hard allow-list', () => {
  test('a non-Primerica rep NEVER receives a Primerica-scoped quote across many deliveries', async () => {
    for (let day = 0; day < 20; day += 1) {
      const result = await deliverQuote(
        {
          userId: `rep-${day}`,
          isPrimerica: false,
          timeSlot: 'morning',
          anchorStatement: null,
          userContext: USER_CONTEXT,
          now: new Date(2026, 0, 1 + day),
        },
        { cfe: passingCFE() }
      );
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.quoteId.startsWith('primerica-')).toBe(false);
      }
    }
  });

  test('a Primerica rep CAN receive a Primerica-scoped quote (mix includes both pools)', async () => {
    const seenIds = new Set<string>();
    for (let day = 0; day < 20; day += 1) {
      const result = await deliverQuote(
        {
          userId: 'rep-primerica',
          isPrimerica: true,
          timeSlot: 'morning',
          anchorStatement: null,
          userContext: USER_CONTEXT,
          now: new Date(2026, 0, 1 + day),
        },
        { cfe: passingCFE() }
      );
      if (result.status === 'ok') seenIds.add(result.quoteId);
    }
    expect([...seenIds].some((id) => id.startsWith('primerica-'))).toBe(true);
  });
});

describe('quote.service — every quote passes the CFE (§12.9-4 break-it case)', () => {
  test('an income-promise line is rejected and never reaches the rep', async () => {
    // A CFE that blocks ANY content containing an income promise, including the safe fallback if it
    // were somehow mutated to contain one (it is not — proving the fallback itself is clean).
    const cfe: CFEContentEvaluator = {
      async evaluateContent(input) {
        const isBad = /guaranteed|you will earn 10k a month/i.test(input.content);
        return {
          band: isBad ? 'blocked' : 'clear',
          score: isBad ? 95 : 0,
          classifierResults: [],
          held: false,
          released: !isBad,
          reason: isBad ? 'income_claim' : 'clean',
          heldReason: null,
          safeHarbor: { injected: false, disclaimers: [] },
          httpStatus: isBad ? 403 : 200,
          ruleVersion: 'test',
          auditEvent: {} as CFEVerdict['auditEvent'],
        } satisfies CFEVerdict;
      },
    };
    const result = await deliverQuote(
      {
        userId: 'rep-1',
        isPrimerica: false,
        timeSlot: 'morning',
        anchorStatement: 'You will earn 10k a month building this the right way.',
        userContext: USER_CONTEXT,
      },
      { cfe }
    );
    // The anchor line itself contains the income promise, so every candidate's personalized text is
    // dirty — the engine must fall through to the clean safe-fallback text, never surface the dirty
    // personalized line.
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.text).not.toMatch(/guaranteed|you will earn 10k a month/i);
    }
  });

  test('CFE held/unavailable → status "held", never a fabricated quote', async () => {
    const result = await deliverQuote(
      { userId: 'rep-1', isPrimerica: false, timeSlot: 'morning', anchorStatement: null, userContext: USER_CONTEXT },
      { cfe: heldCFE() }
    );
    expect(result.status).toBe('held');
  });
});
