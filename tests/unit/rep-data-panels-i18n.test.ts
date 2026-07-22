// T-57 RG6 (i18n; master-spec §17.5) — `RepDataPanels.tsx` carried 2
// `RENDERED_I18N_LEAK_BASELINE.json` entries: `PipelineStatesPanel`'s
// `{stage.toLowerCase().replace(/_/g, ' ')}` and `NamesInPlayPanel`'s
// `{n.pipelineStage.toLowerCase().replace(/_/g, ' ')}` — both raw/merely de-snake-cased-and-
// lowercased `PipelineStage` tokens, never translated. Both panels take props directly (extracted
// from `RepDrillInPage` specifically so their states are independently testable via
// `renderToStaticMarkup` — see this file's own header comment), so this suite renders them with
// real data, mirroring the EN-default + genuine-ES-render pattern established in
// tests/unit/approval-inbox-item-i18n.test.ts.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { PipelineStatesPanel, NamesInPlayPanel } from '@/app/team/rep/[userId]/components/RepDataPanels';
import { LocaleContext } from '@/app/locale-context';
import { t } from '@/lib/i18n/catalog';

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

const renderEn = (el: React.ReactElement) => renderToStaticMarkup(el);
const renderEs = (el: React.ReactElement) =>
  renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      { value: { locale: 'es', setLocale: () => {}, t: (key: string, vars?: Record<string, string | number>) => t('es', key, vars) } },
      el
    )
  );

describe('PipelineStatesPanel — i18n (T-57 RG6)', () => {
  test('TEETH — each pipeline-stage metric label is a genuine localized string, never the raw/de-snake-cased-and-lowercased token', () => {
    const counts = { IDENTIFIED: 3, CLOSED_CLIENT: 1, CLOSED_RECRUIT: 2 };
    const el = createElement(PipelineStatesPanel, { counts });
    const enText = textOf(renderEn(el));
    const esText = textOf(renderEs(el));
    expect(enText).toContain('Identified');
    expect(enText).toContain('Closed — client');
    expect(enText).toContain('Closed — new teammate');
    expect(esText).toContain('Identificado');
    expect(esText).toContain('Cerrado — cliente');
    expect(esText).toContain('Cerrado — nuevo compañero de equipo');
    expect(enText).not.toContain('closed_client');
    expect(enText).not.toContain('closed_recruit');
  });

  test('CLOSED_RECRUIT never renders the doctrine-forbidden word "recruit"/"reclut" in either locale', () => {
    const el = createElement(PipelineStatesPanel, { counts: { CLOSED_RECRUIT: 1 } });
    expect(textOf(renderEn(el)).toLowerCase()).not.toContain('recruit');
    expect(textOf(renderEs(el)).toLowerCase()).not.toContain('reclut');
  });

  test('an unrecognized/future stage falls back to a generic localized label, never the raw key', () => {
    const el = createElement(PipelineStatesPanel, { counts: { SOME_FUTURE_STAGE: 1 } });
    expect(textOf(renderEn(el))).toContain('In the pipeline');
    expect(textOf(renderEs(el))).toContain('En el pipeline');
  });

  test('the zero-data narrative (SC9) still renders unchanged in both locales', () => {
    const el = createElement(PipelineStatesPanel, { counts: {} });
    expect(textOf(renderEn(el))).toContain("nothing in the pipeline yet");
    expect(textOf(renderEs(el))).toContain('todavía no hay nada en el pipeline');
  });
});

describe('NamesInPlayPanel — i18n (T-57 RG6)', () => {
  test('TEETH — the pipeline-stage suffix on each name is a genuine localized string, never the raw/de-snake-cased-and-lowercased token', () => {
    const names = [
      { contactId: 'c1', displayName: 'Jordan Vega', pipelineStage: 'APPOINTMENT_PROPOSED' },
      { contactId: 'c2', displayName: 'Sam Rivera', pipelineStage: 'DO_NOT_CONTACT' },
    ];
    const el = createElement(NamesInPlayPanel, { names });
    const enText = textOf(renderEn(el));
    const esText = textOf(renderEs(el));
    expect(enText).toContain('Jordan Vega — Appointment proposed');
    expect(enText).toContain('Sam Rivera — Do not contact');
    expect(esText).toContain('Jordan Vega — Cita propuesta');
    expect(esText).toContain('Sam Rivera — No contactar');
    expect(enText).not.toContain('appointment_proposed');
    expect(enText).not.toContain('do not contact'.toUpperCase());
  });

  test('the empty-names narrative (SC9) still renders unchanged in both locales', () => {
    const el = createElement(NamesInPlayPanel, { names: [] });
    expect(textOf(renderEn(el))).toContain('nothing to review');
    expect(textOf(renderEs(el))).toContain('nada que revisar');
  });
});
