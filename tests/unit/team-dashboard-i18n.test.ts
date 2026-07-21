// T-R32c (i18n completion, master-spec §17.5; uiux §6.2) — the upline/RVP Team dashboard
// (`src/app/team/page.tsx`) carried 31 pre-existing `NO_LITERALS_BASELINE.json` entries — the
// second-largest count of any file in this build. Proves the full retrofit for every state
// reachable from a single-pass static render: EN default unchanged, genuine ES render.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import TeamDashboardPage from '@/app/team/page';
import { LocaleContext } from '@/app/locale-context';
import { t } from '@/lib/i18n/catalog';

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

const renderEn = () => renderToStaticMarkup(createElement(TeamDashboardPage));

const renderEs = () =>
  renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      { value: { locale: 'es', setLocale: () => {}, t: (key: string, vars?: Record<string, string | number>) => t('es', key, vars) } },
      createElement(TeamDashboardPage)
    )
  );

describe('Team dashboard page — i18n (EN default + genuine ES render, T-R32c)', () => {
  // The page's initial render (no session/fetch resolved in this repo's no-jsdom Jest env) is the
  // 'loading' state — the one state every single-pass static render of a fetch-driven, props-less
  // page like this one can reach (same constraint/rationale as content-queue-i18n.test.ts).
  test("EN default renders the loading narrative in English", () => {
    const text = textOf(renderEn());
    expect(text).toContain("Gathering your team's report…");
  });

  test('ES provider renders the loading narrative genuinely in Spanish — not a silent EN fallback', () => {
    const text = textOf(renderEs());
    expect(text).toContain('Preparando el informe de tu equipo…');
    expect(text).not.toContain("Gathering your team's report");
  });

  test('the forbidden (non-lead) state catalog keys resolve to real, distinct EN/ES copy', () => {
    expect(t('en', 'team.dashboard.forbidden.badge')).toBe('Team view');
    expect(t('en', 'team.dashboard.forbidden.heading')).toBe('This view is for team leaders');
    expect(t('es', 'team.dashboard.forbidden.heading')).toBe('Esta vista es para líderes de equipo');
    expect(t('en', 'team.dashboard.forbidden.cta')).toBe('Go to Sponsor Cockpit');
    expect(t('es', 'team.dashboard.forbidden.cta')).toBe('Ir a la Cabina del Patrocinador');
  });

  test('the empty-team state, roster table headers, and downline-leak/ratio copy are real, distinct EN/ES catalog entries', () => {
    expect(t('en', 'team.dashboard.emptyHeading')).toBe('Your team starts with one.');
    expect(t('es', 'team.dashboard.emptyHeading')).toBe('Tu equipo empieza con uno.');
    expect(t('en', 'team.dashboard.tableHeader.rep')).toBe('Rep');
    expect(t('es', 'team.dashboard.tableHeader.rep')).toBe('Rep');
    expect(t('en', 'team.dashboard.downlineLeakBody', { count: 3 })).toBe(
      "3 rep(s) haven't been in the field for a while — a quiet coaching nudge, not a warning."
    );
    expect(t('es', 'team.dashboard.downlineLeakBody', { count: 3 })).toBe(
      '3 rep(s) no han estado en el campo por un tiempo — un recordatorio de coaching discreto, no una advertencia.'
    );
    expect(t('en', 'team.dashboard.fieldTrainerRatioBadge')).toBe("Your Field Trainer's Ratio");
    expect(t('es', 'team.dashboard.fieldTrainerRatioBadge')).toBe('La Proporción de tu Entrenador de Campo');
  });

  // TEETH: the doctrine copy-lint (guard:i18n) forbids the bare word "lead"/"leads" — this proves
  // the rewording (T-R32c: "team leads" -> "team leaders") never regresses back to the forbidden
  // form, in either language's catalog entry.
  test("TEETH: the forbidden-state heading never regresses to the doctrine-forbidden noun \"leads\"", () => {
    expect(t('en', 'team.dashboard.forbidden.heading')).not.toMatch(/\bleads?\b/i);
  });
});
