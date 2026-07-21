// T-57 R2 (MAJOR-M2 + AC-2-7, uiux §2.4 deep-link law) — the root not-found boundary must land the
// user on Today with an explanatory message, NEVER a bare 404 / blank screen. Source-scanned (the
// component uses `useRouter`, which has no app-router context under this repo's node test env —
// the same reason auth/page.tsx is source-scanned in login-landing-today.test.ts) plus a catalog
// proof of the EN/ES copy.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { t as catalog } from '@/lib/i18n/catalog';

const REPO_ROOT = path.join(__dirname, '..', '..');
const src = (...parts: string[]) => readFileSync(path.join(REPO_ROOT, 'src', ...parts), 'utf8');

describe('root not-found — AC-2-7 "unknown/expired links land on Today with a toast, never a 404"', () => {
  const notFound = src('app', 'not-found.tsx');

  test('it is a client boundary at the app root', () => {
    expect(notFound.startsWith("'use client'")).toBe(true);
  });

  test('it auto-redirects to /today (never dead-ends on the unknown route)', () => {
    expect(notFound).toMatch(/from 'next\/navigation'/);
    expect(notFound).toMatch(/useRouter/);
    expect(notFound).toMatch(/router\.replace\(\s*'\/today'\s*\)/);
  });

  test('it surfaces an explanatory message + a visible link to Today (works even before the auto-redirect fires)', () => {
    expect(notFound).toMatch(/role="status"/); // the explanatory "toast" region
    expect(notFound).toMatch(/href="\/today"/);
    expect(notFound).toMatch(/t\('notFound\.body'\)/);
    expect(notFound).toMatch(/t\('notFound\.cta'\)/);
  });

  test('the copy resolves to real, distinct EN/ES strings (and the ES lands on "Hoy")', () => {
    expect(catalog('en', 'notFound.body')).toContain('Today');
    expect(catalog('en', 'notFound.cta')).toBe('Go to Today');
    expect(catalog('es', 'notFound.body')).toContain('Hoy');
    expect(catalog('es', 'notFound.cta')).toBe('Ir a Hoy');
  });
});
