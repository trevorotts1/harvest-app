// T-57 R3c-1 — the two terminal-exit bugs found by R2-QC (ShiftView.tsx:241 onSaveAndLeave no-op;
// ShiftView.tsx:261 "Back to Today" navigating to `/`, the marketing landing route, instead of
// `/today`, Mission Control). Both are event-handler bodies inside a heavily hook-driven client
// component (`useState`/`useEffect`/`useCallback`/`useRef`) — this repo's Jest environment has no
// DOM/jsdom and no react-test-renderer (confirmed: `grep` for either in package.json finds
// nothing), so calling ShiftView as a plain function (the way `ActionQueue.tsx`'s own tests walk
// its returned element tree) would crash on the first hook call, and `renderToStaticMarkup` never
// executes an event handler at all. Source-level assertion is this repo's own established
// technique for exactly this class of "prove the callback body was wired correctly" case —
// `tests/unit/login-landing-today.test.ts`'s own first test does the identical thing for
// `auth/page.tsx`'s `router.push` call, via a regex-isolated branch match.

import { readFileSync } from 'node:fs';
import path from 'node:path';

const SOURCE_PATH = path.join(__dirname, '..', '..', 'src', 'app', 'shift', 'ShiftView.tsx');

function source(): string {
  return readFileSync(SOURCE_PATH, 'utf8');
}

describe('T-57 R3c-1 — ShiftView.tsx terminal-exit fixes', () => {
  test('RED (pre-fix) shape is gone: onSaveAndLeave is no longer an empty/comment-only body', () => {
    const src = source();
    const onSaveAndLeaveMatch = src.match(/onSaveAndLeave=\{[\s\S]*?\n(\s*)\}\}/);
    expect(onSaveAndLeaveMatch).not.toBeNull();
    const body = onSaveAndLeaveMatch![0];
    // The old RED body: a comment claiming this is "outside this route's lane", nothing else.
    expect(body).not.toMatch(/outside this route's lane/);
  });

  test('GREEN: onSaveAndLeave navigates to /today (real save+navigate, not a no-op)', () => {
    const src = source();
    const onSaveAndLeaveMatch = src.match(/onSaveAndLeave=\{[\s\S]*?\n(\s*)\}\}/);
    expect(onSaveAndLeaveMatch?.[0]).toMatch(/window\.location\.href = '\/today';/);
  });

  test('GREEN: DoneScreen\'s "Back to Today" targets /today, not `/` (the marketing landing route)', () => {
    const src = source();
    const onBackToTodayMatch = src.match(/onBackToToday=\{[\s\S]*?\n(\s*)\}\}/);
    expect(onBackToTodayMatch).not.toBeNull();
    expect(onBackToTodayMatch?.[0]).toMatch(/window\.location\.href = '\/today';/);
    // The RED value — a bare root-path redirect to the public marketing page — must not survive.
    expect(onBackToTodayMatch?.[0]).not.toMatch(/window\.location\.href = '\/';/);
  });

  test('exactly one onSaveAndLeave and one onBackToToday wiring exist (no accidental duplicate/second no-op left behind)', () => {
    const src = source();
    expect((src.match(/onSaveAndLeave=\{/g) ?? []).length).toBe(1);
    expect((src.match(/onBackToToday=\{/g) ?? []).length).toBe(1);
  });
});
