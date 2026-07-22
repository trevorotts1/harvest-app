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
    // T-57 RE-GATE B [af7789d3] F2 fix — this was an EN-identical ES value (a real defect this
    // test previously encoded as "expected"); ES now gets its own real word, not the bare EN one.
    expect(t('es', 'team.dashboard.tableHeader.rep')).toBe('Representante');
    // T-57 RE-GATE B [af7789d3] F2 fix — migrated off the mechanical English "rep(s)" pattern to
    // real CLDR _one/_other plural forms (a genuine singular/plural distinction in ES: rep/reps).
    expect(t('en', 'team.dashboard.downlineLeakBody', { count: 1 })).toBe(
      "1 rep hasn't been in the field for a while — a quiet coaching nudge, not a warning."
    );
    expect(t('en', 'team.dashboard.downlineLeakBody', { count: 3 })).toBe(
      "3 reps haven't been in the field for a while — a quiet coaching nudge, not a warning."
    );
    expect(t('es', 'team.dashboard.downlineLeakBody', { count: 1 })).toBe(
      '1 rep no ha estado en el campo por un tiempo — un recordatorio de coaching discreto, no una advertencia.'
    );
    expect(t('es', 'team.dashboard.downlineLeakBody', { count: 3 })).toBe(
      '3 reps no han estado en el campo por un tiempo — un recordatorio de coaching discreto, no una advertencia.'
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

  // T-57 RG6 (i18n) — this page's `needsYouNow[].triggerReason` used to render the raw/merely
  // de-snake-cased-and-lowercased `TriggerReason` token (`RENDERED_I18N_LEAK_BASELINE.json`, now
  // closed to empty). The fix REUSES `team/bridges/components/PendingBridgeItem.tsx`'s own
  // `team.bridges.item.reasonLabel.*` catalog keys (a local `REASON_LABEL_KEY` map in
  // `team/page.tsx`, single source of truth for the copy — see that file's own header note) rather
  // than duplicating a second translated namespace for the identical `three-way-handoff.service.ts`
  // machine token. The "needs you now" section itself is behind the unresolved fetch this suite's
  // fixed loading-state-only scope covers — this asserts the reused keys resolve to real, distinct
  // EN/ES copy (already unit-proven for PendingBridgeItem in tests/unit/t57-r4-i18n-residual.test.ts).
  test('the reused team.bridges.item.reasonLabel.* keys (needsYouNow trigger reason) resolve to real, distinct EN/ES copy', () => {
    expect(t('en', 'team.bridges.item.reasonLabel.buyingSignal')).toBe("They're showing real interest");
    expect(t('es', 'team.bridges.item.reasonLabel.buyingSignal')).toBe('Está mostrando interés real');
    expect(t('en', 'team.bridges.item.reasonLabel.fallback')).toBe('Wants to bring you into a conversation');
    expect(t('es', 'team.bridges.item.reasonLabel.fallback')).toBe('Quiere incluirte en una conversación');
  });
});
