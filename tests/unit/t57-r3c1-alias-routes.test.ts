// T-57 R3c-1 (MINOR-m2, uiux §2.4 "never a 404 dead end"). Four spec-named routes 404'd before this
// fix: /learn/objections, /grow/tree, /grow/timeline, /today/briefing. Each is now a real Next.js
// server-component redirect to the in-page feature. Same real-`redirect()`-invocation proof
// technique as `tests/unit/login-landing-today.test.ts`'s DashboardPage test (asserting on the
// framework's own `NEXT_REDIRECT` control-flow error digest — proves this calls the FRAMEWORK's
// redirect, not a look-alike).

function expectRedirectsTo(Component: () => never, target: string) {
  let thrown: unknown;
  try {
    Component();
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(Error);
  const digest = (thrown as { digest?: string }).digest;
  expect(digest).toMatch(new RegExp(`^NEXT_REDIRECT;replace;${target.replace(/\//g, '\\/')};`));
}

describe('T-57 R3c-1 — m2 deep-link alias routes redirect to their real in-page feature', () => {
  test('/grow/tree redirects to /grow (the Orchard/rings canvas already lives there)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { default: GrowTreeAliasPage } = require('@/app/grow/tree/page');
    expectRedirectsTo(GrowTreeAliasPage, '/grow');
  });

  test('/grow/timeline redirects to /grow (the phased timeline panel already renders there)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { default: GrowTimelineAliasPage } = require('@/app/grow/timeline/page');
    expectRedirectsTo(GrowTimelineAliasPage, '/grow');
  });

  test('/today/briefing redirects to /today (the Briefing Card + its own receipts already render there)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { default: TodayBriefingAliasPage } = require('@/app/today/briefing/page');
    expectRedirectsTo(TodayBriefingAliasPage, '/today');
  });

  test('/learn/objections redirects to /community (the real, per-contact objection coach lives there — not /learn, which has no path to this specific feature)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { default: LearnObjectionsAliasPage } = require('@/app/learn/objections/page');
    expectRedirectsTo(LearnObjectionsAliasPage, '/community');
  });

  test('all four alias pages import redirect from next/navigation (the real framework primitive, never a look-alike)', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const files = [
      ['src', 'app', 'grow', 'tree', 'page.tsx'],
      ['src', 'app', 'grow', 'timeline', 'page.tsx'],
      ['src', 'app', 'today', 'briefing', 'page.tsx'],
      ['src', 'app', 'learn', 'objections', 'page.tsx'],
    ];
    for (const parts of files) {
      const content = fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');
      expect(content).toMatch(/from 'next\/navigation'/);
      expect(content).toMatch(/redirect\('\//);
    }
  });
});
