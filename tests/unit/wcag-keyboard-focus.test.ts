// T-52 (WCAG 2.2 AA — master-spec §17.4, uiux §6.1 item 2 "full keyboard and switch navigation...
// visible focus ring per §1.2.4... skip-to-content first on every page"). Source-level checks for
// the three keyboard-nav gaps this unit fixed:
//   (a) skip-to-content link, present on every page (it lives in the ROOT layout, so it is
//       structurally present regardless of which page renders);
//   (b) a systematic, global `:focus-visible` default (not just the handful of ad hoc
//       per-component rules that predate this unit);
//   (c) the one real `role="dialog"` sheet in the app (RulesOfBuildingChips — the WP08 override-math
//       sheet) now behaves like a real modal: `aria-modal`, Escape-to-close, and focus management.
//
// Source-scanning (not react-dom/server rendering) is the deliberate choice here, same convention
// already used by mission-control-ui.test.ts's "(e) Today primary CTA" block — this repo's Jest
// config is `testEnvironment: 'node'` (no DOM), and (a)/(b) are root-layout/CSS concerns with no
// component boundary to render in isolation; (c) requires simulating a click + awaited promise +
// keyboard event, which this component has no testability seam for (consistent with this repo's
// documented convention — see ShiftView.tsx's "TESTING NOTE" — of not adding DOM-event tests where
// no seam already exists, rather than bolting one on unrelated to this fix's own scope).

import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const src = (...parts: string[]) => readFileSync(path.join(REPO_ROOT, 'src', ...parts), 'utf8');

describe('(a) Skip-to-content link — uiux §6.1 item 2 "skip-to-content first on every page"', () => {
  const layout = src('app', 'layout.tsx');

  test('the root layout renders a skip link as the FIRST thing inside <body>, before <Providers>', () => {
    const bodyOpen = layout.indexOf('<body>');
    const skipLink = layout.indexOf('className="skip-link"');
    const providers = layout.indexOf('<Providers>');
    expect(bodyOpen).toBeGreaterThan(-1);
    expect(skipLink).toBeGreaterThan(bodyOpen);
    expect(providers).toBeGreaterThan(skipLink);
  });

  test('the skip link targets a real, focusable #main-content element wrapping the page content', () => {
    expect(layout).toMatch(/href="#main-content"/);
    expect(layout).toMatch(/id="main-content"[^>]*tabIndex=\{-1\}|tabIndex=\{-1\}[^>]*id="main-content"/);
  });

  test('the skip target is a plain <div>, not a second <main> — many pages already render their own <main> landmark', () => {
    const mainContentTag = layout.match(/<(\w+)[^>]*id="main-content"/)?.[1];
    expect(mainContentTag).toBe('div');
  });
});

describe('(a) .skip-link CSS — visually hidden until focused, per the standard skip-link pattern', () => {
  const globalsCss = src('app', 'globals.css');

  test('.skip-link is off-screen at rest and moves on-screen on :focus', () => {
    const rule = globalsCss.match(/\.skip-link\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/top:\s*-\d/); // off-screen at rest
    const focusRule = globalsCss.match(/\.skip-link:focus\s*\{[^}]*\}/)?.[0] ?? '';
    expect(focusRule).toMatch(/top:\s*[^-]/); // back on-screen when focused
  });

  test('.skip-link consumes design-system tokens, not raw hex', () => {
    const rule = globalsCss.match(/\.skip-link\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rule).toContain('var(--color-action)');
  });
});

describe('(b) Global :focus-visible default — uiux §6.1 item 2 "visible focus ring per §1.2.4"', () => {
  const globalsCss = src('app', 'globals.css');

  test('a systematic, low-specificity global rule exists (not just the pre-existing per-component ones)', () => {
    // Matches the bare, unqualified `:focus-visible` selector specifically (not e.g.
    // `.theme-toggle:focus-visible`, which already existed before this unit and stays untouched).
    expect(globalsCss).toMatch(/(?<![\w.-])\s*:focus-visible\s*\{/);
  });

  test('the global rule uses the design-system action token, matching every pre-existing per-component rule', () => {
    const rule = globalsCss.match(/(?<![\w.-])\n?:focus-visible\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('var(--color-action)');
    expect(rule).toContain('outline');
  });
});

describe('(c) RulesOfBuildingChips override-math sheet — a real modal, keyboard-operable', () => {
  const component = src('app', 'grow', 'components', 'RulesOfBuildingChips.tsx');

  test('the sheet declares aria-modal, alongside its existing role="dialog"', () => {
    expect(component).toMatch(/role="dialog"/);
    expect(component).toMatch(/aria-modal="true"/);
  });

  test('Escape closes the sheet', () => {
    expect(component).toMatch(/key === 'Escape'/);
  });

  test('focus moves INTO the sheet on open (onto its one control) and back to the triggering chip on close', () => {
    expect(component).toMatch(/closeButtonRef\.current\?\.focus\(\)/);
    expect(component).toMatch(/openedFromRef\.current\?\.focus\(\)/);
  });
});
