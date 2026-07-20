// WP08 §13.1/§13.6-7, uiux AC-5.5-5 — the org-tree time-lapse share export: CFE-gated, fail-closed,
// never includes income math.

import { ComplianceFilterEngine } from '../../src/services/compliance/engine';
import { LocalDeterministicClassifierClient } from '../../src/services/compliance/claude';
import { buildTimeLapseExportSummary, evaluateTimeLapseShare, type CFEContentEvaluator } from '../../src/services/taprooting/share-gate';
import type { CFEInput, CFEVerdict } from '../../src/types/compliance';
import type { TimeLapseShareRequest } from '../../src/types/taprooting';

const REQUEST: TimeLapseShareRequest = {
  events: [
    { level: 0, displayName: 'You', joinedAt: '2026-01-01T00:00:00.000Z' },
    { level: 1, displayName: 'Alex R.', joinedAt: '2026-02-01T00:00:00.000Z' },
    { level: 2, displayName: 'Jamie T.', joinedAt: '2026-03-01T00:00:00.000Z' },
  ],
};

describe('buildTimeLapseExportSummary (§13.6-7 "never includes income math")', () => {
  it('is structure/growth only — no dollar figure, no override-math import anywhere', () => {
    const summary = buildTimeLapseExportSummary(REQUEST);
    expect(summary).not.toMatch(/\$\d/);
    expect(summary).toContain('Level 1: Alex R.');
  });

  it('orders events by join date regardless of input order', () => {
    const shuffled: TimeLapseShareRequest = { events: [REQUEST.events[2], REQUEST.events[0], REQUEST.events[1]] };
    const summary = buildTimeLapseExportSummary(shuffled);
    const lines = summary.split('\n');
    expect(lines[1]).toContain('You');
    expect(lines[2]).toContain('Alex R.');
    expect(lines[3]).toContain('Jamie T.');
  });
});

describe('evaluateTimeLapseShare (§0.4 rule 3 — fail-closed CFE gate)', () => {
  it('releases clean structure content (real CFE, deterministic classifier)', async () => {
    const cfe = new ComplianceFilterEngine({ classifierClient: new LocalDeterministicClassifierClient() });
    const outcome = await evaluateTimeLapseShare(REQUEST, cfe, { user_id: 'u1', role: 'REP' as const });
    expect(outcome.allowed).toBe(true);
    if (outcome.allowed) {
      expect(outcome.exportSummary).not.toMatch(/\$\d/);
    }
  });

  it('NEVER releases when the CFE is held/unavailable — no bypass', async () => {
    const heldVerdict: CFEVerdict = {
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
    const fakeCfe: CFEContentEvaluator = { evaluateContent: async (_input: CFEInput) => heldVerdict };
    const outcome = await evaluateTimeLapseShare(REQUEST, fakeCfe, { user_id: 'u1', role: 'REP' as const });
    expect(outcome.allowed).toBe(false);
    if (!outcome.allowed) {
      expect(outcome.reason).toBe('cfe_held');
    }
  });

  it('a blocked verdict never releases either', async () => {
    const blockedVerdict: CFEVerdict = {
      band: 'blocked',
      score: 90,
      classifierResults: [],
      held: false,
      released: false,
      reason: 'risk_score=90',
      heldReason: null,
      safeHarbor: { injected: false, disclaimers: [] },
      httpStatus: 403,
      ruleVersion: 'test',
      auditEvent: {} as CFEVerdict['auditEvent'],
    };
    const fakeCfe: CFEContentEvaluator = { evaluateContent: async () => blockedVerdict };
    const outcome = await evaluateTimeLapseShare(REQUEST, fakeCfe, { user_id: 'u1', role: 'REP' as const });
    expect(outcome.allowed).toBe(false);
    if (!outcome.allowed) {
      expect(outcome.reason).toBe('cfe_blocked');
    }
  });
});
