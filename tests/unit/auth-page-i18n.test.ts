// T-R32b (master-spec §17.5; uiux §6.2) — `src/app/auth/page.tsx` is the highest-traffic surface in
// the app (every rep sees it, on every unauthenticated visit) and carried 56 pre-existing
// `NO_LITERALS_BASELINE.json` entries — the single largest concentration in the codebase. Proves the
// full retrofit off hardcoded EN literals onto the i18n catalog (`auth.*` / `common.yes`/`common.no`):
//   (a) the EN default (no `<LocaleContext.Provider>` — this suite's established fallback
//       convention, e.g. approval-inbox-item-i18n.test.ts) still renders byte-identical copy;
//   (b) an explicit `es` locale genuinely renders Spanish catalog copy, not a silent EN fallback;
//   (c) none of the retired EN literals leak into the ES render.
//
// `AuthPage` calls `useRouter()` from `next/navigation` (App Router) at render time; outside a
// mounted app router (this repo's Jest env is plain `testEnvironment: 'node'`, no App Router, no
// jsdom — see jest.config.js) that hook throws ("invariant expected app router to be mounted"), so
// it's mocked here purely to make a static render possible — `AuthPage` itself is otherwise
// prop-less and side-effect-free at render time (its `signIn`/`router.push` calls all live inside
// the `handleLogin` event handler, never invoked by a static render).
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import AuthPage from '@/app/auth/page';
import { LocaleContext } from '@/app/locale-context';
import { t } from '@/lib/i18n/catalog';

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

const renderEn = () => renderToStaticMarkup(createElement(AuthPage));

const renderEs = () =>
  renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      { value: { locale: 'es', setLocale: () => {}, t: (key: string, vars?: Record<string, string | number>) => t('es', key, vars) } },
      createElement(AuthPage)
    )
  );

// `AuthPage` defaults to `mode: 'register'` (a plain `useState`, no server-provided initial prop) —
// the register-wizard branch is what a static, single-pass render always shows. The sibling
// `mode === 'login'` form (and the Primerica reveal, gated on typed `organizationName`) only
// appears after a client interaction this jsdom-less suite cannot simulate; every assertion below
// is scoped to what genuinely renders, matching this repo's other static-render i18n tests.
describe('AuthPage — i18n (EN default + genuine ES render, T-R32b)', () => {
  test('EN default renders the EN catalog copy for the persistent chrome + register wizard', () => {
    const text = textOf(renderEn());
    expect(text).toContain('The Harvest');
    expect(text).toContain('Enter the command center.');
    expect(text).toContain('The demo classifies the business first');
    expect(text).toContain('Demo access');
    expect(text).toContain('Register');
    expect(text).toContain('Login');
    expect(text).toContain('Business / Industry wizard');
    expect(text).toContain('What is the business industry?');
    expect(text).toContain('Which structure best describes it?');
    expect(text).toContain('Downline / team-based organization');
    expect(text).toContain('Franchise owner');
    expect(text).toContain('Name of business or organization');
    expect(text).toContain('Business-specific fields appear only after the business type');
    expect(text).toContain('Continue to onboarding');
    expect(text).toContain('Skip to Today');
    const html = renderEn();
    expect(html).toContain('aria-label="Business and industry wizard"');
    expect(html).toContain('placeholder="Example: business, franchise, school, firm, or organization name"');
  });

  test('ES provider renders genuinely Spanish catalog copy — not a silent EN fallback', () => {
    const text = textOf(renderEs());
    expect(text).toContain('The Harvest'); // brand name intentionally untranslated
    expect(text).toContain('Entra al centro de mando.');
    expect(text).toContain('La demostración clasifica primero el negocio');
    expect(text).toContain('Acceso de demostración');
    expect(text).toContain('Registrarse');
    expect(text).toContain('Iniciar sesión');
    expect(text).toContain('Asistente de negocio / industria');
    expect(text).toContain('¿Cuál es la industria del negocio?');
    expect(text).toContain('¿Qué estructura la describe mejor?');
    expect(text).toContain('Organización de línea descendente o basada en equipo');
    expect(text).toContain('Propietario de franquicia');
    expect(text).toContain('Nombre del negocio u organización');
    expect(text).toContain('Continuar a la incorporación');
    expect(text).toContain('Saltar a Hoy');
    const html = renderEs();
    expect(html).toContain('aria-label="Asistente de negocio e industria"');
    expect(html).toContain('placeholder="Ejemplo: nombre del negocio, franquicia, escuela, firma u organización"');

    // None of the EN-only strings leak into the ES render.
    expect(text).not.toContain('Enter the command center.');
    expect(text).not.toContain('What is the business industry?');
    expect(text).not.toContain('Continue to onboarding');
    expect(text).not.toContain('Skip to Today');
  });

  test('the role select renders translated options (Rep/User, Upline) in both locales', () => {
    const enHtml = renderEn();
    const esHtml = renderEs();
    expect(enHtml).toMatch(/<option value="REP"[^>]*>Rep\/User<\/option>/);
    expect(enHtml).toMatch(/<option value="UPLINE"[^>]*>Upline<\/option>/);
    expect(esHtml).toMatch(/<option value="REP"[^>]*>Rep\/Usuario<\/option>/);
    expect(esHtml).toMatch(/<option value="UPLINE"[^>]*>Línea ascendente<\/option>/);
  });
});
