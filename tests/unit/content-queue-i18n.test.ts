// T-R32c (i18n completion, master-spec §17.5; uiux §6.2) — the Content Queue page
// (`src/app/content/page.tsx`) is Today's highest-traffic secondary destination (linked directly
// from Today's header row) and carried 33 pre-existing `NO_LITERALS_BASELINE.json` entries, the
// single largest count of any file in this build. Proves the full retrofit: EN default unchanged,
// genuine ES render (not a silent EN fallback), for every element reachable from a single-pass
// static render (this repo's Jest env is `testEnvironment: 'node'` — no jsdom/`useEffect`, so the
// fetch-driven item list itself never resolves; the header/filter-row/launch-kit-trigger markup
// below is NOT gated on that fetch and renders on every pass, exactly like every other
// fetch-driven page's own i18n test in this suite, e.g. anchor-header-i18n.test.ts).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ContentQueuePage from '@/app/content/page';
import { LocaleContext } from '@/app/locale-context';
import { t } from '@/lib/i18n/catalog';

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

const renderEn = () => renderToStaticMarkup(createElement(ContentQueuePage));

const renderEs = () =>
  renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      { value: { locale: 'es', setLocale: () => {}, t: (key: string, vars?: Record<string, string | number>) => t('es', key, vars) } },
      createElement(ContentQueuePage)
    )
  );

describe('Content Queue page — i18n (EN default + genuine ES render, T-R32c)', () => {
  test('EN default renders the title, subtitle, header actions, filter chips, and loading state in English', () => {
    const text = textOf(renderEn());
    expect(text).toContain('Content Queue');
    expect(text).toContain('Nothing publishes without your review');
    expect(text).toContain("Generate this week's batch");
    expect(text).toContain('Trigger a launch kit');
    expect(text).toContain('Template library');
    expect(text).toContain('Ready for Review');
    expect(text).toContain('Follow-ups');
    expect(text).toContain('Loading the content queue…');
  });

  test('ES provider renders genuinely Spanish copy for the same elements — not a silent EN fallback', () => {
    const text = textOf(renderEs());
    expect(text).toContain('Cola de contenido');
    expect(text).toContain('Generar el lote de esta semana');
    expect(text).toContain('Activar un kit de lanzamiento');
    expect(text).toContain('Biblioteca de plantillas');
    expect(text).toContain('Listo para revisión');
    expect(text).toContain('Seguimientos');
    expect(text).toContain('Cargando la cola de contenido…');

    // None of the EN-only strings leak into the ES render.
    expect(text).not.toContain('Content Queue');
    expect(text).not.toContain('Loading the content queue');
    expect(text).not.toContain("Generate this week's batch");
  });

  test('the paused-publishing banner (§11.5 rule 1) is genuinely catalog-driven in both locales', () => {
    expect(t('en', 'content.queue.pausedBanner')).toMatch(/PUBLISHING PAUSED — COMPLIANCE OFFLINE/);
    expect(t('es', 'content.queue.pausedBanner')).toMatch(/PUBLICACIÓN PAUSADA/);
    expect(t('es', 'content.queue.pausedBanner')).not.toBe(t('en', 'content.queue.pausedBanner'));
  });

  test('the launch-kit trigger sub-form catalog keys resolve to real, distinct EN/ES copy', () => {
    expect(t('en', 'content.queue.launchKitTrigger.newMemberFirstNameLabel')).toBe("New member's first name");
    expect(t('es', 'content.queue.launchKitTrigger.newMemberFirstNameLabel')).toBe('Nombre del nuevo miembro');
    expect(t('en', 'content.queue.launchKitTrigger.generateCta')).toBe('Generate launch kit');
    expect(t('es', 'content.queue.launchKitTrigger.generateCta')).toBe('Generar kit de lanzamiento');
  });
});
