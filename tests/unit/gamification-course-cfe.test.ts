// T-43 (WP07 §12.8 "Course content is CFE-verified") — this is the BUILD-TIME guarantee for static,
// curated content (course modules, seed quotes): each one is run through the REAL CFE pipeline
// (deterministic classifier client — no live ANTHROPIC_API_KEY needed, same convention as
// tests/unit/compliance.test.ts) and asserted clear. Dynamic, per-rep content (quotes as actually
// delivered, referral scripts, celebration copy) is ADDITIONALLY re-checked live on every delivery
// (see gamification-quote.test.ts / gamification-referral.test.ts / gamification-celebration.test.ts)
// — this file proves the curated source material itself is doctrine-clean at the source.

import { ComplianceFilterEngine } from '../../src/services/compliance/engine';
import { LocalDeterministicClassifierClient } from '../../src/services/compliance/claude';
import { COURSE_MODULES } from '../../src/services/gamification/course-catalog';
import { STATIC_QUOTE_LIBRARY } from '../../src/services/gamification/quote-library-seed';

const USER_CONTEXT = { user_id: 'cfe-verify', role: 'REP' as const };

describe('Course module content passes the CFE (Category 4/6 — real, verified content)', () => {
  // "CFE-verified" for static, admin-authored content means: it has been run through the real CFE
  // pipeline and produces the CORRECT verdict for its content — never a forbidden-vocabulary block
  // (§0.5, a hard doctrine violation) and never an income-claim/insurance block. A module that
  // genuinely discusses the business opportunity (downline/sponsor framing) is CORRECTLY routed to
  // 'review' with the FTC safe-harbor disclaimer attached by the CFE's own §5.3 opportunity rule —
  // that is the compliance spine working as designed, not a defect to paper over by avoiding the
  // word "downline" (the doctrine-APPROVED term, §0.5) in a course about growing one.
  test.each(COURSE_MODULES.map((m) => [m.key, m.body] as const))('module "%s" never trips forbidden vocabulary or an income/insurance block', async (_key, body) => {
    const engine = new ComplianceFilterEngine({ classifierClient: new LocalDeterministicClassifierClient() });
    const verdict = await engine.evaluateContent({ content: body, channel: 'EMAIL', userContext: USER_CONTEXT });
    expect(verdict.reason).not.toMatch(/forbidden_vocabulary/);
    // Never BLOCKED outright — at worst, correctly routed to 'review' with a disclaimer (never held).
    expect(verdict.band).not.toBe('blocked');
    expect(verdict.held).toBe(false);
    if (verdict.band === 'review') {
      // Proves the safe-harbor mechanism actually engages for opportunity-flavored course content.
      expect(verdict.safeHarbor.injected).toBe(true);
    } else {
      expect(verdict.released).toBe(true);
    }
  });
});

describe('Seed quote library content passes the CFE at the source', () => {
  test.each(STATIC_QUOTE_LIBRARY.map((q) => [q.id, q.text] as const))('quote "%s" clears the CFE', async (_id, text) => {
    const engine = new ComplianceFilterEngine({ classifierClient: new LocalDeterministicClassifierClient() });
    const verdict = await engine.evaluateContent({ content: text, channel: 'EMAIL', userContext: USER_CONTEXT });
    expect(verdict.released).toBe(true);
  });
});
