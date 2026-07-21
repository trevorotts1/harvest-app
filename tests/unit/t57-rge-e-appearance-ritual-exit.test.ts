// T-57 RE-GATE dimension E [a9500c6d] — GATE-FAIL (narrow): 2 fresh BLOCKERs/MAJOR + 1 minor.
//
//   (1) BLOCKER "M4-appearance" — the existing `ThemeToggle` (T-05, src/app/theme-toggle.tsx) had
//       no in-app entry point in the authenticated app at all: it was mounted only on the public
//       marketing landing (`src/app/page.tsx`) and the nav-hidden `/design-tokens` dev gallery.
//       Fix: new `src/app/me/appearance/page.tsx` hosting the EXISTING ThemeToggle by import, wired
//       into the Me hub's `HUB_ITEMS` (src/app/me/page.tsx).
//   (2) MAJOR "ritual-strand" — `/ritual/warm-market` hides the persistent AppShell (a deliberate
//       full-bleed ritual, §5.4), so before this fix there was NO in-app way out at all — the
//       post-handoff "done" state was a dead end reachable only by browser-back. Fix: an in-app
//       exit affordance in `WarmMarketRitual.tsx`, mirroring `ShiftView.tsx`'s real `/today` exit
//       (T-57 R3c-1), reachable in every stage including the done state.
//   (3) minor "m3" — the public marketing landing (`src/app/page.tsx`) linked `/design-tokens` (an
//       internal dev token gallery), which has no business being linked from public prod marketing.
//
// This repo's Jest config runs `testEnvironment: 'node'` (no jsdom), so rendering assertions use
// `react-dom/server`'s `renderToStaticMarkup` (the same convention as
// tests/unit/me-hub-accessibility.test.ts / tests/unit/warm-market-offline.test.ts), and anything
// that needs a real browser API (`window.location.href` assignment on click) is proven at the
// source level instead (the same convention tests/unit/t57-r3c1-warm-market-handoff.test.ts uses
// for this exact component, for the exact same reason).

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import MePage from '@/app/me/page';
import AppearancePage from '@/app/me/appearance/page';
import WarmMarketRitual, { type WarmMarketRitualInitialView } from '@/app/ritual/warm-market/WarmMarketRitual';
import { LocaleContext } from '@/app/locale-context';
import { t as catalog } from '@/lib/i18n/catalog';
import { MethodLayer } from '@/types/harvest-method';

const REPO_ROOT = path.join(__dirname, '..', '..');
const src = (...parts: string[]) => readFileSync(path.join(REPO_ROOT, 'src', ...parts), 'utf8');

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

const renderEs = (el: Parameters<typeof createElement>[0], props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      { value: { locale: 'es', setLocale: () => {}, t: (k: string, v?: Record<string, string | number>) => catalog('es', k, v) } },
      createElement(el, props)
    )
  );

describe('T-57 RE-GATE E [a9500c6d] BLOCKER "M4-appearance": Me → Appearance is now reachable', () => {
  test('the Me hub links to /me/appearance (was completely absent from HUB_ITEMS)', () => {
    const html = renderToStaticMarkup(createElement(MePage, {}));
    expect(html).toContain('href="/me/appearance"');
    expect(html).toContain('data-me-item="/me/appearance"');
  });

  test('AppearancePage renders the REAL, EXISTING ThemeToggle (its literal "theme-toggle" class), not a reimplementation', () => {
    const html = renderToStaticMarkup(createElement(AppearancePage, {}));
    expect(html).toMatch(/class="theme-toggle"/);
    // The real ThemeToggle's default (pre-hydration) label — proves the actual component rendered,
    // not a stand-in with different copy.
    expect(textOf(html)).toMatch(/Appearance: System/);
  });

  test('AppearancePage does not reimplement theme logic — theme-toggle.tsx is imported, not duplicated (no local localStorage/document.documentElement theme code in the new page)', () => {
    const page = src('app', 'me', 'appearance', 'page.tsx');
    expect(page).toMatch(/import \{ ThemeToggle \} from '@\/app\/theme-toggle'/);
    expect(page).not.toMatch(/THEME_STORAGE_KEY/);
    expect(page).not.toMatch(/document\.documentElement\.setAttribute\('data-theme'/);
  });

  test('renders genuinely Spanish copy under an ES locale (not a silent EN fallback), including the embedded ThemeToggle', () => {
    const text = textOf(renderEs(AppearancePage));
    expect(text).toContain('Apariencia');
    expect(text).toContain('Tema');
    expect(text).toMatch(/Apariencia: Sistema/); // ThemeToggle's own ES copy, same t() context
    expect(text).not.toContain('Appearance');
  });

  test('the Me hub also renders the Spanish "Apariencia" hub card title under an ES locale', () => {
    const text = textOf(renderEs(MePage));
    expect(text).toContain('Apariencia');
  });

  test('catalog keys resolve to distinct, real EN/ES copy', () => {
    expect(catalog('en', 'me.appearance.hubTitle')).toBe('Appearance');
    expect(catalog('es', 'me.appearance.hubTitle')).toBe('Apariencia');
    expect(catalog('en', 'me.appearance.heading')).toBe('Appearance');
    expect(catalog('es', 'me.appearance.heading')).toBe('Apariencia');
    expect(catalog('en', 'me.appearance.themeRowTitle')).toBe('Theme');
    expect(catalog('es', 'me.appearance.themeRowTitle')).toBe('Tema');
  });
});

describe('T-57 RE-GATE E [a9500c6d] MAJOR "ritual-strand": /ritual/warm-market now has an in-app exit', () => {
  test('a "Back to Today" exit control renders in the LOADING stage (no initialView supplied — the real default entry state)', () => {
    const html = renderToStaticMarkup(createElement(WarmMarketRitual, {}));
    expect(textOf(html)).toContain('Back to Today');
  });

  test('TEETH: the exit control ALSO renders in the post-handoff COMPLETE/done stage — the exact dead-end the re-gate flagged is now exited', () => {
    const html = renderToStaticMarkup(
      createElement(WarmMarketRitual, {
        initialView: {
          currentLayer: 'COMPLETE',
          vaultCount: 0,
          vaultContacts: [],
          queue: [],
        } satisfies WarmMarketRitualInitialView,
      })
    );
    expect(textOf(html)).toContain('Back to Today');
  });

  test('the exit control renders across every other stage too (Blank Canvas / Qualities Flip / Background Matching) — reachable throughout, not just at the end', () => {
    const stages: MethodLayer[] = [
      MethodLayer.BLANK_CANVAS,
      MethodLayer.QUALITIES_FLIP,
      MethodLayer.BACKGROUND_MATCHING,
    ];
    for (const currentLayer of stages) {
      const initialView: WarmMarketRitualInitialView = { currentLayer, vaultCount: 0, vaultContacts: [], queue: [] };
      const html = renderToStaticMarkup(createElement(WarmMarketRitual, { initialView }));
      expect(textOf(html)).toContain('Back to Today');
    }
  });

  test('source-level: the exit control navigates to the REAL /today route via window.location.href, mirroring ShiftView.tsx\'s own real exit (T-57 R3c-1) — not a stub, not "/"', () => {
    const source = src('app', 'ritual', 'warm-market', 'WarmMarketRitual.tsx');
    const exitBarMatch = source.match(/<div className=\{styles\.exitBar\}>[\s\S]*?<\/div>/);
    expect(exitBarMatch).not.toBeNull();
    expect(exitBarMatch?.[0]).toMatch(/window\.location\.href = '\/today';/);
    expect(exitBarMatch?.[0]).toMatch(/backToTodayCta/);
  });

  test('renders genuinely Spanish exit copy under an ES locale (not a silent EN fallback)', () => {
    const html = renderEs(WarmMarketRitual, {});
    expect(textOf(html)).toContain('Volver a Hoy');
    expect(textOf(html)).not.toContain('Back to Today');
  });

  test('catalog key resolves to distinct, real EN/ES copy', () => {
    expect(catalog('en', 'ritual.warmMarketRitual.backToTodayCta')).toBe('Back to Today');
    expect(catalog('es', 'ritual.warmMarketRitual.backToTodayCta')).toBe('Volver a Hoy');
  });
});

describe('T-57 RE-GATE E [a9500c6d] minor "m3": public landing no longer links the internal /design-tokens gallery', () => {
  test('src/app/page.tsx no longer contains a /design-tokens link', () => {
    const page = src('app', 'page.tsx');
    expect(page).not.toMatch(/href="\/design-tokens"/);
    expect(page).not.toMatch(/href=\{'\/design-tokens'\}/);
  });

  test('the rest of the public nav is untouched — real destinations still link out', () => {
    const page = src('app', 'page.tsx');
    expect(page).toMatch(/href="\/auth"/);
    expect(page).toMatch(/href="#method"/);
  });

  test('the /design-tokens route itself still exists (relocated reachability, not deleted — still usable by direct URL for internal review)', () => {
    const designTokensPage = src('app', 'design-tokens', 'page.tsx');
    expect(designTokensPage).toContain('ThemeToggle');
  });
});
