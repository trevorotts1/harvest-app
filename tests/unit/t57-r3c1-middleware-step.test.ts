// T-57 R3c-1 (MINOR-m1) — `src/middleware.ts` used to do `url.search = ''` unconditionally on
// every onboarding-gate redirect, dropping any `?step=` the original request carried. This proves
// the fix preserves it. `src/middleware.ts`'s default export is wrapped in `next-auth/middleware`'s
// `withAuth(...)` — invoking that wrapped function directly would require mocking NextAuth's JWT
// verification/session resolution, which no existing test in this repo attempts (confirmed:
// `grep -rl middleware tests/unit` finds only tests of the pure, unwrapped decision function,
// `shouldRedirectToOnboarding`). Source-level assertion is this repo's own established technique
// for this exact class of case (see `tests/unit/login-landing-today.test.ts`'s own regex-isolated
// branch assertions against `auth/page.tsx`).

import { readFileSync } from 'node:fs';
import path from 'node:path';

function source(): string {
  return readFileSync(path.join(__dirname, '..', '..', 'src', 'middleware.ts'), 'utf8');
}

describe('T-57 R3c-1 — middleware.ts preserves a genuine ?step= through the onboarding redirect', () => {
  test('RED (pre-fix) shape is gone: the redirect no longer unconditionally clears the whole query string', () => {
    const src = source();
    // The exact pre-fix line. If this string still appears verbatim, the fix was reverted/lost.
    expect(src).not.toMatch(/url\.pathname = ONBOARDING_RESUME_REDIRECT;\s*\n\s*url\.search = '';/);
  });

  test('GREEN: an incoming ?step= is read off the request URL and forwarded onto the redirect', () => {
    const src = source();
    expect(src).toMatch(/req\.nextUrl\.searchParams\.get\('step'\)/);
    expect(src).toMatch(/url\.search = step \? `\?step=\$\{encodeURIComponent\(step\)\}` : '';/);
  });

  test('the redirect target itself is unchanged (/onboarding/resume) — only the query-preservation behavior changed', () => {
    const src = source();
    expect(src).toMatch(/url\.pathname = ONBOARDING_RESUME_REDIRECT;/);
  });
});
