// T-55 (master-spec §17.7; uiux §5.9 AC-5.9-8 "partial-data reps render learning states, never
// zeros") — the rep drill-in's Pipeline states + Names in play panels. Before this fix, a rep with
// no pipeline activity yet (or literally zero names in play) rendered a bare section header over an
// empty grid/list with no narrative at all.

import { createElement, type ElementType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { NamesInPlayPanel, PipelineStatesPanel, type NameInPlay } from '@/app/team/rep/[userId]/components/RepDataPanels';

const render = (el: ElementType, props: Record<string, unknown>) => renderToStaticMarkup(createElement(el, props));
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');

describe('PipelineStatesPanel — zero pipeline activity never renders blank (SC9)', () => {
  test('zero counts renders a learning-state narrative, not a bare header over an empty grid', () => {
    const html = render(PipelineStatesPanel, { counts: {} });
    expect(textOf(html)).toContain('Learning this rep');
  });

  test('populated counts render every stage and no learning-state narrative', () => {
    const html = render(PipelineStatesPanel, { counts: { INTRODUCED: 4, RESPONDED: 2 } });
    const text = textOf(html);
    expect(text).toContain('4');
    expect(text).toContain('introduced');
    expect(text).not.toContain('Learning this rep');
  });

  test('never throws for empty or populated counts', () => {
    expect(() => render(PipelineStatesPanel, { counts: {} })).not.toThrow();
    expect(() => render(PipelineStatesPanel, { counts: { CLOSED: 1 } })).not.toThrow();
  });
});

describe('NamesInPlayPanel — zero names in play never renders blank (SC9)', () => {
  test('zero names renders a plain "nothing to review" narrative, not a bare empty list', () => {
    const html = render(NamesInPlayPanel, { names: [] });
    expect(textOf(html)).toContain('No names in play yet');
  });

  test('populated names render every entry and no empty-state narrative', () => {
    const names: NameInPlay[] = [{ contactId: 'c1', displayName: 'Jordan Lee', pipelineStage: 'RESPONDED' }];
    const html = render(NamesInPlayPanel, { names });
    const text = textOf(html);
    expect(text).toContain('Jordan Lee');
    expect(text).not.toContain('No names in play yet');
  });

  test('never throws for empty or populated names', () => {
    expect(() => render(NamesInPlayPanel, { names: [] })).not.toThrow();
    expect(() =>
      render(NamesInPlayPanel, { names: [{ contactId: 'c1', displayName: 'A', pipelineStage: 'INTRODUCED' }] })
    ).not.toThrow();
  });
});
