// T-57 R3b (M9, master-spec §2.3.2/AC-2-4, uiux §2.3 item 2) — the DUAL-role persona switcher.
// `PersonaSwitcher` is deliberately PURE (all inputs are props, no router/session hooks of its
// own) — same convention `AppNavView` already established (tests/unit/nav-shell.test.ts) — so it
// renders deterministically here via `renderToStaticMarkup`. The fail-closed DUAL-only gate is the
// load-bearing proof: every non-DUAL role (including the upline-class roles that DO see the Team
// destination) must see NOTHING from this component.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import PersonaSwitcher from '@/components/AppShell/PersonaSwitcher';
import { isDualPersonaUser } from '@/components/AppShell/navConfig';
import { t as catalog } from '@/lib/i18n/catalog';

const REPO_ROOT = path.join(__dirname, '..', '..');
const src = (...parts: string[]) => readFileSync(path.join(REPO_ROOT, 'src', ...parts), 'utf8');

const en = (key: string, vars?: Record<string, string | number>) => catalog('en', key, vars);
const es = (key: string, vars?: Record<string, string | number>) => catalog('es', key, vars);

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

const render = (props: { role?: string | null; activePersona: 'business' | 'team'; t?: typeof en }) =>
  renderToStaticMarkup(
    createElement(PersonaSwitcher, { role: props.role ?? null, activePersona: props.activePersona, t: props.t ?? en })
  );

describe('PersonaSwitcher — DUAL-only, fail-closed (M9, AC-2-4)', () => {
  test('renders nothing for a REP', () => {
    expect(render({ role: 'REP', activePersona: 'business' })).toBe('');
  });

  test('renders nothing for a pure UPLINE (already lands on the team view of Today by default)', () => {
    expect(render({ role: 'UPLINE', activePersona: 'business' })).toBe('');
  });

  test('renders nothing for RVP or ADMIN', () => {
    expect(render({ role: 'RVP', activePersona: 'business' })).toBe('');
    expect(render({ role: 'ADMIN', activePersona: 'business' })).toBe('');
  });

  test('renders nothing for an unrecognized/missing role (fail-closed, not fail-open)', () => {
    expect(render({ role: undefined, activePersona: 'business' })).toBe('');
    expect(render({ role: null, activePersona: 'business' })).toBe('');
    expect(render({ role: 'SOMETHING_UNEXPECTED', activePersona: 'business' })).toBe('');
  });

  test('DUAL sees the two-segment pill, both real destinations, both real labels', () => {
    const html = render({ role: 'DUAL', activePersona: 'business' });
    expect(html).toContain('href="/today"');
    expect(html).toContain('href="/today?persona=team"');
    const text = textOf(html);
    expect(text).toContain('My Business');
    expect(text).toContain('My Team');
  });

  test('the active segment carries aria-current="page"; the inactive one does not', () => {
    const anchors = (html: string) => html.match(/<a\b[^>]*>/g) ?? [];

    const business = render({ role: 'DUAL', activePersona: 'business' });
    const businessAnchors = anchors(business);
    expect(businessAnchors.find((a) => a.includes('href="/today"'))).toMatch(/aria-current="page"/);
    expect(businessAnchors.find((a) => a.includes('href="/today?persona=team"'))).not.toMatch(/aria-current="page"/);

    const team = render({ role: 'DUAL', activePersona: 'team' });
    const teamAnchors = anchors(team);
    expect(teamAnchors.find((a) => a.includes('href="/today?persona=team"'))).toMatch(/aria-current="page"/);
    expect(teamAnchors.find((a) => a.includes('href="/today"') && !a.includes('persona=team'))).not.toMatch(/aria-current="page"/);
  });

  test('genuine ES render — not a silent EN fallback', () => {
    const text = textOf(render({ role: 'DUAL', activePersona: 'business', t: es }));
    expect(text).toContain('Mi Negocio');
    expect(text).toContain('Mi Equipo');
    expect(text).not.toContain('My Business');
  });
});

describe('navConfig.isDualPersonaUser — the gate PersonaSwitcher and AppShell both key off', () => {
  test('true only for the literal DUAL role', () => {
    expect(isDualPersonaUser('DUAL')).toBe(true);
  });
  test('false for every other role, including upline-class', () => {
    expect(isDualPersonaUser('REP')).toBe(false);
    expect(isDualPersonaUser('UPLINE')).toBe(false);
    expect(isDualPersonaUser('RVP')).toBe(false);
    expect(isDualPersonaUser('ADMIN')).toBe(false);
  });
  test('fail-closed on missing/unknown role', () => {
    expect(isDualPersonaUser(undefined)).toBe(false);
    expect(isDualPersonaUser(null)).toBe(false);
    expect(isDualPersonaUser('BOGUS')).toBe(false);
  });
});

describe('AppShell wiring (source proof — AppShell itself requires a SessionProvider/router context this no-jsdom suite does not stand up, same limitation every other container-vs-pure-view split in this repo documents)', () => {
  test('role comes from the server-issued session, never a client-forgeable prop', () => {
    const shell = src('components', 'AppShell', 'AppShell.tsx');
    expect(shell).toContain('const role = session?.user?.role;');
    expect(shell).toContain('<PersonaSwitcher role={role} activePersona={activePersona} t={t} />');
  });

  test('activePersona is derived from window.location.search post-mount — the "next/navigation" import brings in only usePathname (no new Suspense-boundary requirement on the layout that wraps every page)', () => {
    const shell = src('components', 'AppShell', 'AppShell.tsx');
    const navImport = shell.match(/^import \{[^}]*\} from 'next\/navigation';$/m)?.[0] ?? '';
    expect(navImport).toContain('usePathname');
    expect(navImport).not.toContain('useSearchParams'); // the actual import list, not the prose comment above it
    expect(shell).toContain("new URLSearchParams(window.location.search).get('persona') === 'team'");
  });
});
