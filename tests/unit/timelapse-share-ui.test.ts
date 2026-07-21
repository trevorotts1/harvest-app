// T-R30 GAP 2 — proves the real share/download/copy affordance on `TimeLapseShare.tsx` (WP08
// §13.1/§13.6-7, uiux AC-5.5-5): before this fix, a `released` CFE verdict rendered status text ONLY
// — no `navigator.share()`, no download, no copy (T-51 finding). `ShareResultActions` is the pure,
// prop-driven render this component's clearance→action wiring goes through; rendered here with
// `react-dom/server` the same way every other status/O-screen component in this codebase is (see
// tests/unit/onboarding-ui.test.ts) — no jsdom, no `navigator` mock needed, since `canShare` /
// `downloadHref` are passed in as plain props rather than read from the DOM inside the component.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ShareResultActions, type ShareState } from '@/app/grow/components/TimeLapseShare';

const render = (state: ShareState, overrides: Partial<Parameters<typeof ShareResultActions>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(ShareResultActions, {
      state,
      canShare: false,
      downloadHref: '',
      copied: false,
      onNativeShare: () => {},
      onCopy: () => {},
      ...overrides,
    })
  );

const NOT_CLEARED_STATES: ShareState[] = [{ kind: 'idle' }, { kind: 'checking' }];

describe('T-R30 GAP 2: share affordance appears ONLY after CFE clearance', () => {
  for (const state of NOT_CLEARED_STATES) {
    test(`state "${state.kind}" renders NO share/download/copy control at all`, () => {
      const html = render(state);
      expect(html).toBe(''); // idle/checking render nothing — not even the status paragraph
      expect(html).not.toMatch(/share|download|copy/i);
    });
  }

  test('a "blocked" verdict renders the block reason as an alert and STILL no share/download/copy control', () => {
    const html = render({ kind: 'blocked', reason: 'cfe_held' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('cfe_held');
    expect(html).not.toMatch(/<button|<a /);
    expect(html).not.toMatch(/download=/);
  });

  test('TEETH: across idle/checking/blocked, the rendered markup never contains a `download=` attribute, an <a>, or a Share/Copy button — no path for uncleared content to leave the app', () => {
    for (const state of [...NOT_CLEARED_STATES, { kind: 'blocked', reason: 'cfe_blocked' } as ShareState]) {
      const html = render(state);
      expect(html).not.toMatch(/download=/);
      expect(html).not.toMatch(/<a /);
      expect(html).not.toMatch(/>Share…</);
      expect(html).not.toMatch(/>Copy</);
    }
  });

  test('once "released", the cleared-status text renders (role="status")', () => {
    const html = render({ kind: 'released', summary: 'Org growth time-lapse — structure and growth only.' });
    expect(html).toContain('role="status"');
    expect(html).toMatch(/cleared to share/i);
  });
});

describe('T-R30 GAP 2: navigator.share() when available, download+copy fallback otherwise', () => {
  test('canShare=true renders ONLY the native "Share…" button — no Download link, no Copy button', () => {
    const html = render({ kind: 'released', summary: 'x' }, { canShare: true });
    expect(html).toMatch(/>Share…</);
    expect(html).not.toMatch(/download=/);
    expect(html).not.toMatch(/>Copy</);
  });

  test('canShare=false renders the Download link + Copy button fallback — no native Share button', () => {
    const html = render(
      { kind: 'released', summary: 'x' },
      { canShare: false, downloadHref: 'blob:mock-url' }
    );
    expect(html).not.toMatch(/>Share…</);
    expect(html).toContain('href="blob:mock-url"');
    expect(html).toContain('download="harvest-timelapse.txt"');
    expect(html).toMatch(/>Copy</);
  });

  test('the Copy button reflects a "Copied" confirmation once `copied` is true', () => {
    const html = render(
      { kind: 'released', summary: 'x' },
      { canShare: false, downloadHref: 'blob:mock-url', copied: true }
    );
    expect(html).toMatch(/>Copied</);
    expect(html).not.toMatch(/>Copy</); // exact label swap, not an "also-present" addition
  });

  test('TEETH: canShare=true never ALSO renders the fallback (mutually exclusive branches, not additive)', () => {
    const html = render({ kind: 'released', summary: 'x' }, { canShare: true, downloadHref: 'blob:mock-url' });
    expect(html).not.toMatch(/download=/);
  });
});
