// T-R16 (from T-R24 QC finding) — BUILD-TIME/static proof that the WP07 static milestone-celebration
// copy (`MILESTONE_ANCHOR_LINE`, `src/services/gamification/celebration.service.ts`) actually passes
// the CFE. `tests/unit/gamification-celebration.test.ts` exercises `buildMilestoneShareText` against
// a fully MOCKED `CFEContentEvaluator` (`passingCFE`/`blockingCFE`) whose `evaluateContent` returns a
// fixed verdict regardless of what content it's handed — so no existing test ever actually ran the
// real CFE's classifiers over the five literal anchor-line strings themselves. This suite closes that
// gap: it runs the REAL `ComplianceFilterEngine`, wired to the key-less, deterministic
// `LocalDeterministicClassifierClient` (the same offline/no-API-key classifier client
// `tests/unit/cfe-fail-closed.test.ts` uses for its own key-less proofs), against every entry in
// `MILESTONE_ANCHOR_LINE` — so this runs in CI/build with no live ANTHROPIC_API_KEY, deterministically,
// every time.
//
// TEETH: if a future edit to `MILESTONE_ANCHOR_LINE` introduces forbidden vocabulary (an income
// claim, a guarantee, an opportunity-recruitment pitch, etc. — see `classifier-config.ts`'s
// patterns), this suite fails with `band !== 'clear'` for that specific key, naming exactly which
// anchor line regressed.

import { ComplianceFilterEngine } from '@/services/compliance/engine';
import { LocalDeterministicClassifierClient } from '@/services/compliance/claude';
import { ALL_MILESTONE_KEYS, MILESTONE_ANCHOR_LINE, MilestoneKey } from '@/services/gamification/celebration.service';

// Key-less regardless of ambient shell — this suite's whole point is that it proves the anchor
// copy clean WITHOUT a live Claude key (same convention as cfe-fail-closed.test.ts /
// approval-inbox-service.test.ts).
const originalKey = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});
afterAll(() => {
  if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
});

function realEngine(): ComplianceFilterEngine {
  return new ComplianceFilterEngine({ classifierClient: new LocalDeterministicClassifierClient() });
}

describe('MILESTONE_ANCHOR_LINE — static WP07 celebration copy passes the real CFE (build-time proof)', () => {
  test('every ALL_MILESTONE_KEYS entry has a MILESTONE_ANCHOR_LINE string — no key silently missing its anchor line', () => {
    for (const key of ALL_MILESTONE_KEYS) {
      expect(typeof MILESTONE_ANCHOR_LINE[key]).toBe('string');
      expect(MILESTONE_ANCHOR_LINE[key].length).toBeGreaterThan(0);
    }
  });

  // §12.3 "a compliance-filtered share-to-social option" — buildMilestoneShareText evaluates on the
  // 'SOCIAL' channel; this suite mirrors that exact channel so the classifiers see the same context
  // a real share attempt would.
  test.each(ALL_MILESTONE_KEYS)('%s — MILESTONE_ANCHOR_LINE passes the real (key-less) CFE clean: band clear, released', async (key) => {
    const engine = realEngine();
    const content = MILESTONE_ANCHOR_LINE[key];

    const verdict = await engine.evaluateContent({
      content,
      channel: 'SOCIAL',
      userContext: { user_id: 'rep-static-cfe-proof', role: 'REP' },
    });

    expect(verdict.band).toBe('clear');
    expect(verdict.held).toBe(false);
    expect(verdict.released).toBe(true);
  });

  test('sanity: every MilestoneKey enum member is covered by ALL_MILESTONE_KEYS (nothing skipped above)', () => {
    const enumKeys = Object.values(MilestoneKey);
    expect(ALL_MILESTONE_KEYS.slice().sort()).toEqual(enumKeys.slice().sort());
  });
});
