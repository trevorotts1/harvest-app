// T-55 (master-spec §17.7 / uiux §4.13 "the generic pattern is the fallback and still must name a
// next step") — TemplateListSection's zero-visible states (a filtered-to-zero category, or a
// genuine zero-template response). Before this fix, either case rendered an empty `itemList` div
// with no narrative at all.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import TemplateListSection, { type TemplateData } from '@/app/content/templates/components/TemplateListSection';

const render = (props: Parameters<typeof TemplateListSection>[0]) =>
  renderToStaticMarkup(createElement(TemplateListSection, props));
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');

const template = (key: string, category: string | null): TemplateData => ({
  key,
  name: `Template ${key}`,
  contentType: 'SOCIAL_POST',
  category,
  launchKitPieceType: null,
  copySkeleton: 'skeleton text',
  imageConceptPrompt: null,
  toneGuidance: 'warm',
  doctrineVerified: true,
  defaultPersonalizationTier: 'AUTOMATIC',
  version: 1,
});

describe('TemplateListSection — zero-visible states never render blank (SC9)', () => {
  test('a genuine zero-template response (filter=ALL) renders a narrative and no "show all" affordance', () => {
    const html = render({ categories: ['ALL'], filter: 'ALL', visible: [], onSelectFilter: () => {} });
    const text = textOf(html);
    expect(text).toContain('No templates in this category yet');
    expect(text).not.toContain('Show all templates');
  });

  test('a filtered-to-zero category offers the one-action "Show all templates" affordance', () => {
    const html = render({ categories: ['ALL', 'CELEBRATION'], filter: 'CELEBRATION', visible: [], onSelectFilter: () => {} });
    const text = textOf(html);
    expect(text).toContain('No templates in this category yet');
    expect(text).toContain('Show all templates');
  });

  test('a populated list renders every visible template and no empty-state narrative', () => {
    const visible = [template('t1', 'CELEBRATION'), template('t2', 'CELEBRATION')];
    const html = render({ categories: ['ALL', 'CELEBRATION'], filter: 'CELEBRATION', visible, onSelectFilter: () => {} });
    const text = textOf(html);
    expect(text).toContain('Template t1');
    expect(text).toContain('Template t2');
    expect(text).not.toContain('No templates in this category yet');
  });

  test('never throws across every category-count × visible-count combination', () => {
    for (const categories of [['ALL'], ['ALL', 'A', 'B']]) {
      for (const visible of [[], [template('t1', null)]]) {
        expect(() => render({ categories, filter: 'ALL', visible, onSelectFilter: () => {} })).not.toThrow();
      }
    }
  });
});
