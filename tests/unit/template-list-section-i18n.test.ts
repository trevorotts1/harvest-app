// T-57 RG6 (i18n; master-spec §17.5) — `TemplateListSection.tsx` carried 2
// `RENDERED_I18N_LEAK_BASELINE.json` entries: the category-filter-chip `{c.replace(/_/g, ' ')}` and
// `{tpl.defaultPersonalizationTier.replace(/_/g, ' ').toLowerCase()}` — both raw/merely
// de-snake-cased backend tokens, never translated. Mirrors the exact EN-default + genuine-ES-render
// pattern established in tests/unit/approval-inbox-item-i18n.test.ts /
// tests/unit/t57-r4-i18n-residual.test.ts (PendingBridgeItem) — this component takes props
// directly, so (unlike the fetch-driven `/content/templates` page itself) it can be rendered with
// real data via `renderToStaticMarkup` with no effects required.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import TemplateListSection, { type TemplateData } from '@/app/content/templates/components/TemplateListSection';
import { LocaleContext } from '@/app/locale-context';
import { t } from '@/lib/i18n/catalog';

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

const renderEn = (props: Parameters<typeof TemplateListSection>[0]) =>
  renderToStaticMarkup(createElement(TemplateListSection, props));

const renderEs = (props: Parameters<typeof TemplateListSection>[0]) =>
  renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      { value: { locale: 'es', setLocale: () => {}, t: (key: string, vars?: Record<string, string | number>) => t('es', key, vars) } },
      createElement(TemplateListSection, props)
    )
  );

function template(overrides: Partial<TemplateData> = {}): TemplateData {
  return {
    key: 't1',
    name: 'Template one',
    contentType: 'SOCIAL_POST',
    category: 'COMMUNITY_SPOTLIGHT',
    launchKitPieceType: null,
    copySkeleton: 'skeleton text',
    imageConceptPrompt: null,
    toneGuidance: 'warm',
    doctrineVerified: true,
    defaultPersonalizationTier: 'AUTOMATIC',
    version: 1,
    ...overrides,
  };
}

describe('TemplateListSection — i18n (T-57 RG6)', () => {
  test('TEETH — the category filter chips are genuine localized labels, never the raw/de-snake-cased ContentCategory token', () => {
    const props = {
      categories: ['ALL', 'COMMUNITY_SPOTLIGHT', 'VALUE_FIRST_EDUCATION'],
      filter: 'ALL',
      visible: [],
      onSelectFilter: () => {},
    };
    const enText = textOf(renderEn(props));
    const esText = textOf(renderEs(props));
    expect(enText).toContain('Community spotlight');
    expect(enText).toContain('Value-first education');
    expect(esText).toContain('Historia destacada de la comunidad');
    expect(esText).toContain('Educación de valor');
    expect(enText).not.toContain('COMMUNITY_SPOTLIGHT');
    expect(enText).not.toContain('community spotlight');
    expect(esText).not.toContain('community spotlight');
  });

  test('the "ALL" chip reuses content.queue.filters.all in both locales, not a duplicate literal', () => {
    const props = { categories: ['ALL'], filter: 'ALL', visible: [], onSelectFilter: () => {} };
    expect(textOf(renderEn(props))).toContain('All');
    expect(textOf(renderEs(props))).toContain('Todo');
  });

  test('TEETH — the personalization-tier line is a genuine localized label, never the raw/de-snake-cased-and-lowercased PersonalizationTier token', () => {
    const visible = [template({ defaultPersonalizationTier: 'AI_INFERRED' })];
    const props = { categories: ['ALL'], filter: 'ALL', visible, onSelectFilter: () => {} };
    const enText = textOf(renderEn(props));
    const esText = textOf(renderEs(props));
    expect(enText).toContain('AI-inferred');
    expect(esText).toContain('Inferida por IA');
    expect(enText).not.toContain('ai inferred');
    expect(esText).not.toContain('ai inferred');
  });

  test('every known PersonalizationTier value renders a genuine EN/ES label', () => {
    for (const [tier, enLabel, esLabel] of [
      ['AUTOMATIC', 'Automatic', 'Automática'],
      ['REP_PROVIDED', 'Rep-provided', 'Proporcionada por el rep'],
    ] as const) {
      const visible = [template({ defaultPersonalizationTier: tier })];
      const props = { categories: ['ALL'], filter: 'ALL', visible, onSelectFilter: () => {} };
      expect(textOf(renderEn(props))).toContain(enLabel);
      expect(textOf(renderEs(props))).toContain(esLabel);
    }
  });

  test('the content-type chip (SOCIAL_POST) is a genuine localized label', () => {
    const visible = [template({ contentType: 'SOCIAL_POST' })];
    const props = { categories: ['ALL'], filter: 'ALL', visible, onSelectFilter: () => {} };
    expect(textOf(renderEn(props))).toContain('Social post');
    expect(textOf(renderEs(props))).toContain('Publicación social');
  });
});
