// T-57 R2 (uiux §2.1 destination 5 / §5.8 + BLOCKER-A1 WCAG 2.2 AA §6.1) — the Me hub and the
// Big Text (Accessibility) toggle. Render proofs + source/const proofs, per this repo's node test
// env (no jsdom, so the toggle's onClick/effect are asserted at the source + constant level, the
// same convention wcag-keyboard-focus.test.ts uses for interaction it can't simulate).

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import MePage from '@/app/me/page';
import AccessibilityPage from '@/app/me/accessibility/page';
import { LocaleContext } from '@/app/locale-context';
import { t as catalog } from '@/lib/i18n/catalog';
import { BIG_TEXT_SCALE, BIG_TEXT_STORAGE_KEY, TEXT_SCALE_INIT_SCRIPT } from '@/app/text-scale-init-script';

const REPO_ROOT = path.join(__dirname, '..', '..');
const src = (...parts: string[]) => readFileSync(path.join(REPO_ROOT, 'src', ...parts), 'utf8');

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

const renderEs = (el: Parameters<typeof createElement>[0]) =>
  renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      { value: { locale: 'es', setLocale: () => {}, t: (k: string, v?: Record<string, string | number>) => catalog('es', k, v) } },
      createElement(el, {})
    )
  );

describe('Me hub (uiux §2.1 / §5.8)', () => {
  test('links to every Me sub-surface that exists today (accessibility/language/subscription/data-rights)', () => {
    const html = renderToStaticMarkup(createElement(MePage, {}));
    expect(html).toContain('href="/me/accessibility"');
    expect(html).toContain('href="/me/language"');
    expect(html).toContain('href="/me/subscription"');
    expect(html).toContain('href="/me/data-rights"');
  });

  test('hosts a Notifications placeholder for the later wave (R3b) — a non-navigating "coming soon" card, never a dead link', () => {
    const html = renderToStaticMarkup(createElement(MePage, {}));
    // The placeholder is present and marked coming-soon...
    expect(html).toContain('data-me-item="/me/notifications"');
    expect(textOf(html)).toContain('Coming soon');
    // ...but is NOT a live <a href> to the not-yet-built page.
    expect(html).not.toContain('href="/me/notifications"');
  });

  test('renders genuinely Spanish titles under an ES locale (not a silent EN fallback)', () => {
    const text = textOf(renderEs(MePage));
    for (const label of ['Accesibilidad', 'Idioma', 'Suscripción', 'Datos y privacidad', 'Notificaciones', 'Próximamente']) {
      expect(text).toContain(label);
    }
    expect(text).not.toContain('Accessibility');
  });
});

describe('Me → Accessibility: Big Text toggle (BLOCKER-A1, WCAG 2.2 AA §6.1)', () => {
  test('renders a switch-role control with the Big Text label + description', () => {
    const html = renderToStaticMarkup(createElement(AccessibilityPage, {}));
    expect(html).toMatch(/role="switch"/);
    expect(html).toMatch(/aria-checked="false"/); // SSR default-off; reconciled to storage after mount
    const text = textOf(html);
    expect(text).toContain('Big Text');
    expect(text).toContain('Increase the text size');
  });

  test('the toggle drives tokens.css --text-scale to 1.25 (the documented Big Text value), live + persisted', () => {
    const page = src('app', 'me', 'accessibility', 'page.tsx');
    // Applies the scale live to the document root...
    expect(page).toMatch(/document\.documentElement\.style\.setProperty\(\s*'--text-scale'/);
    expect(page).toMatch(/BIG_TEXT_SCALE/);
    // ...and persists the choice under the shared storage key.
    expect(page).toMatch(/localStorage\.setItem\(\s*BIG_TEXT_STORAGE_KEY/);
    expect(BIG_TEXT_SCALE).toBe('1.25');
    expect(BIG_TEXT_STORAGE_KEY).toBe('harvest-big-text');
  });

  test('a beforeInteractive init script applies the saved preference before first paint (mirrors theme/locale init)', () => {
    // The init script itself sets --text-scale:1.25 from the saved 'on' value.
    expect(TEXT_SCALE_INIT_SCRIPT).toMatch(/getItem\('harvest-big-text'\)/);
    expect(TEXT_SCALE_INIT_SCRIPT).toMatch(/setProperty\('--text-scale', '1\.25'\)/);
    // ...and the root layout wires it in beforeInteractive, alongside the theme + locale init scripts.
    const layout = src('app', 'layout.tsx');
    expect(layout).toContain('TEXT_SCALE_INIT_SCRIPT');
    expect(layout).toMatch(/id="lfds-text-scale-init"[^>]*strategy="beforeInteractive"|strategy="beforeInteractive"[^>]*>\s*\{TEXT_SCALE_INIT_SCRIPT\}/);
  });

  test('catalog keys resolve to distinct EN/ES copy', () => {
    expect(catalog('en', 'accessibility.bigTextTitle')).toBe('Big Text');
    expect(catalog('es', 'accessibility.bigTextTitle')).toBe('Texto grande');
    expect(catalog('en', 'me.heading')).toBe('Me');
    expect(catalog('es', 'me.heading')).toBe('Yo');
  });
});
