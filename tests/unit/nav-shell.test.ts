// T-57 R2 (uiux §2.1/§2.2/§2.3/§2.5, BLOCKER-C1/E3, AC-2-1/2/3/8) — the persistent 5-destination
// navigation shell. Source-scan + single-pass renderToStaticMarkup proofs, matching this repo's
// node test env (jest.config.js: no jsdom). The presentational `AppNavView` is pure (all inputs are
// props), so it renders deterministically here.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import AppNavView from '@/components/AppShell/AppNavView';
import {
  DESTINATIONS,
  canSeeTeam,
  isActivePath,
  landsOnTeamView,
  showsNavShell,
} from '@/components/AppShell/navConfig';
import { t as catalog } from '@/lib/i18n/catalog';

const en = (key: string, vars?: Record<string, string | number>) => catalog('en', key, vars);
const es = (key: string, vars?: Record<string, string | number>) => catalog('es', key, vars);

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

const render = (props: { pathname: string; role?: string | null; t?: (k: string, v?: Record<string, string | number>) => string }) =>
  renderToStaticMarkup(createElement(AppNavView, { pathname: props.pathname, role: props.role ?? null, t: props.t ?? en }));

/** All `<a …>` open tags in the markup, in DOM order. */
const anchors = (html: string) => html.match(/<a\b[^>]*>/g) ?? [];

describe('AppNavView — the five destinations (uiux §2.1, AC-2-1)', () => {
  test('renders all five destinations, in canonical order, each a real focusable link', () => {
    const html = render({ pathname: '/today', role: 'REP' });
    for (const d of DESTINATIONS) {
      expect(html).toContain(`href="${d.href}"`);
    }
    // Canonical order: Today → Community → Grow → Learn → Me.
    const order = DESTINATIONS.map((d) => html.indexOf(`href="${d.href}"`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Visible, localized labels (never icon-only — uiux §2.2).
    const text = textOf(html);
    for (const label of ['Today', 'Community', 'Grow', 'Learn', 'Me']) {
      expect(text).toContain(label);
    }
  });

  test('the whole thing is a single nav landmark with a localized accessible name (uiux §2.5)', () => {
    const html = render({ pathname: '/today', role: 'REP' });
    expect(html).toMatch(/<nav\b[^>]*aria-label="Primary navigation"/);
  });

  test('exactly one destination carries aria-current="page", and it is the active route (uiux §2.5)', () => {
    const html = render({ pathname: '/community', role: 'REP' });
    expect((html.match(/aria-current="page"/g) ?? []).length).toBe(1);
    const active = anchors(html).find((a) => a.includes('aria-current="page"'));
    expect(active).toBeDefined();
    expect(active).toContain('href="/community"');
  });

  test('aria-current follows a nested sub-route (/me active on /me/accessibility)', () => {
    const html = render({ pathname: '/me/accessibility', role: 'REP' });
    const active = anchors(html).find((a) => a.includes('aria-current="page"'));
    expect(active).toContain('href="/me"');
  });
});

describe('AppNavView — Approval Inbox pin + Team role-gating (uiux §2.3, AC-2-3/AC-2-8)', () => {
  test('the Approval Inbox is always a pinned affordance', () => {
    const html = render({ pathname: '/today', role: 'REP' });
    expect(html).toContain('href="/inbox"');
  });

  test('a rep-only user NEVER sees the Team destination', () => {
    const html = render({ pathname: '/today', role: 'REP' });
    expect(html).not.toContain('href="/team"');
  });

  test('an undefined/missing role fails closed — no Team link', () => {
    const html = render({ pathname: '/today', role: null });
    expect(html).not.toContain('href="/team"');
  });

  test('every upline-class role (UPLINE/RVP/DUAL/ADMIN) sees the Team destination', () => {
    for (const role of ['UPLINE', 'RVP', 'DUAL', 'ADMIN']) {
      const html = render({ pathname: '/today', role });
      expect(html).toContain('href="/team"');
    }
  });
});

describe('AppNavView — genuine ES render (uiux §6.2)', () => {
  test('labels + landmark render in Spanish, not a silent EN fallback', () => {
    const html = render({ pathname: '/today', role: 'UPLINE', t: es });
    const text = textOf(html);
    for (const label of ['Hoy', 'Comunidad', 'Cultivar', 'Aprender', 'Yo']) {
      expect(text).toContain(label);
    }
    expect(html).toMatch(/aria-label="Navegación principal"/);
    expect(text).not.toContain('Community');
    expect(text).not.toContain('Learn');
  });
});

describe('navConfig — role + route predicates', () => {
  test('canSeeTeam: upline-class yes, rep/unknown no', () => {
    expect(canSeeTeam('UPLINE')).toBe(true);
    expect(canSeeTeam('RVP')).toBe(true);
    expect(canSeeTeam('DUAL')).toBe(true);
    expect(canSeeTeam('ADMIN')).toBe(true);
    expect(canSeeTeam('REP')).toBe(false);
    expect(canSeeTeam(undefined)).toBe(false);
    expect(canSeeTeam(null)).toBe(false);
  });

  test('landsOnTeamView: pure UPLINE/RVP only (DUAL defaults to rep persona)', () => {
    expect(landsOnTeamView('UPLINE')).toBe(true);
    expect(landsOnTeamView('RVP')).toBe(true);
    expect(landsOnTeamView('DUAL')).toBe(false);
    expect(landsOnTeamView('REP')).toBe(false);
    expect(landsOnTeamView('ADMIN')).toBe(false);
    expect(landsOnTeamView(undefined)).toBe(false);
  });

  test('showsNavShell: shown on app surfaces, hidden on marketing/auth/onboarding/shift/ritual', () => {
    for (const p of ['/today', '/community', '/grow', '/learn', '/me', '/me/accessibility', '/inbox', '/team']) {
      expect(showsNavShell(p)).toBe(true);
    }
    for (const p of ['/', '/auth', '/onboarding', '/onboarding/resume', '/shift', '/shift?mode=short'.split('?')[0], '/ritual/warm-market', '/dashboard', '/design-tokens']) {
      expect(showsNavShell(p)).toBe(false);
    }
    expect(showsNavShell(null)).toBe(false);
  });

  test('isActivePath: exact + nested sub-route, not prefix-bleed', () => {
    expect(isActivePath('/today', '/today')).toBe(true);
    expect(isActivePath('/today/momentum', '/today')).toBe(true);
    expect(isActivePath('/me/accessibility', '/me')).toBe(true);
    expect(isActivePath('/grower', '/grow')).toBe(false); // no prefix bleed
    expect(isActivePath('/community', '/today')).toBe(false);
  });
});
