// T-R32b (master-spec §17.5; uiux §6.2) — the warm-market ritual's four layer components carried 52
// pre-existing `NO_LITERALS_BASELINE.json` entries across 5 files (the ~20-name constellation,
// qualities flip, background matching, and confirmation screens every rep walks through once per
// warm-market pass). Proves the retrofit: EN default unchanged, genuine ES render, no EN leakage.
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { MethodLayer, QualityCluster } from '@/types/harvest-method';
import { ReadinessTier, type PublicQueueItem } from '@/types/harvest-method';

import BlankCanvasLayer from '@/app/ritual/warm-market/components/BlankCanvasLayer';
import QualitiesFlipLayer from '@/app/ritual/warm-market/components/QualitiesFlipLayer';
import BackgroundMatchingLayer from '@/app/ritual/warm-market/components/BackgroundMatchingLayer';
import RitualConfirmation, {
  APPROVAL_BOUNDARY_LINE,
  WARM_MARKET_SUB_AGENT_NAME,
} from '@/app/ritual/warm-market/components/RitualConfirmation';
import { LocaleContext } from '@/app/locale-context';
import { t } from '@/lib/i18n/catalog';

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

function renderEn<P extends object>(el: ComponentType<P>, props: P) {
  return renderToStaticMarkup(createElement(el, props));
}

function renderEs<P extends object>(el: ComponentType<P>, props: P) {
  return renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      { value: { locale: 'es', setLocale: () => {}, t: (key: string, vars?: Record<string, string | number>) => t('es', key, vars) } },
      createElement(el, props)
    )
  );
}

const noop = () => {};

describe('Warm-market ritual — i18n (EN default + genuine ES render, T-R32b)', () => {
  test('BlankCanvasLayer — eyebrow, vault count, vision prompt, add form, and soft gate translate', () => {
    const props = {
      vaultCount: 12,
      entries: [{ typedName: 'Sam', matched: true }],
      onAddName: noop,
      softGateOpen: true,
      onRequestFinish: noop,
      onConfirmSoftGate: noop,
      onKeepAdding: noop,
    };
    const en = textOf(renderEn(BlankCanvasLayer, props));
    const es = textOf(renderEs(BlankCanvasLayer, props));
    expect(en).toContain('Layer 1 of 3');
    expect(en).toContain('You have 12 people in your field.');
    expect(en).toContain('Are you sure you want to stop at 1?');
    expect(en).toContain('Keep adding');
    expect(en).toContain('Yes, that’s my list');
    expect(es).toContain('Capa 1 de 3');
    expect(es).toContain('Tienes 12 personas en tu campo.');
    expect(es).toContain('¿Seguro que quieres detenerte en 1?');
    expect(es).toContain('Seguir agregando');
    expect(es).toContain('Sí, esa es mi lista');
    expect(es).not.toContain('You have 12');
  });

  test('BlankCanvasLayer — the finish CTA (soft gate closed) translates', () => {
    const props = {
      vaultCount: 5,
      entries: [{ typedName: 'A', matched: true }],
      onAddName: noop,
      softGateOpen: false,
      onRequestFinish: noop,
      onConfirmSoftGate: noop,
      onKeepAdding: noop,
    };
    expect(textOf(renderEn(BlankCanvasLayer, props))).toContain('That’s my list');
    expect(textOf(renderEs(BlankCanvasLayer, props))).toContain('Esa es mi lista');
  });

  test('QualitiesFlipLayer — eyebrow, framing caption, section prompt, and Continue translate', () => {
    const props = {
      selectedClusters: [] as QualityCluster[],
      onToggleSelectedCluster: noop,
      seeds: [{ contactId: 'c-1', name: 'Jordan' }],
      assignments: {},
      onToggleAssignedCluster: noop,
      onToggleNeedsTime: noop,
      onContinue: noop,
    };
    const en = textOf(renderEn(QualitiesFlipLayer, props));
    const es = textOf(renderEs(QualitiesFlipLayer, props));
    expect(en).toContain('Layer 2 of 3');
    expect(en).toContain('Service first: who has the qualities that thrive in this business?');
    expect(en).toContain('Which of these live in your list?');
    expect(en).toContain('Need more time');
    expect(en).toContain('Continue');
    expect(es).toContain('Capa 2 de 3');
    expect(es).toContain('El servicio primero: ¿quién tiene las cualidades que prosperan en este negocio?');
    expect(es).toContain('¿Cuáles de estas viven en tu lista?');
    expect(es).toContain('Necesito más tiempo');
    expect(es).toContain('Continuar');
  });

  test('BackgroundMatchingLayer — eyebrow, section prompt, note label, "Not set" option, and Finish matching translate', () => {
    const props = {
      entries: [{ contactId: 'c-1', name: 'Riley', tiles: {}, note: '', existingLicenseeFlag: false }],
      onChangeTile: noop,
      onChangeNote: noop,
      onToggleExistingLicensee: noop,
      corrections: [],
      onSubmit: noop,
    };
    const enHtml = renderEn(BackgroundMatchingLayer, props);
    const esHtml = renderEs(BackgroundMatchingLayer, props);
    const en = textOf(enHtml);
    const es = textOf(esHtml);
    expect(en).toContain('Layer 3 of 3');
    expect(en).toContain('Highlight the matches — tap to fill in what you know.');
    expect(en).toContain('Note (optional)');
    expect(en).toContain('This person already holds a license');
    expect(en).toContain('Finish matching');
    expect(enHtml).toMatch(/<option value=""[^>]*>Not set<\/option>/);
    expect(es).toContain('Capa 3 de 3');
    expect(es).toContain('Resalta las coincidencias — toca para completar lo que sabes.');
    expect(es).toContain('Nota (opcional)');
    expect(es).toContain('Esta persona ya tiene una licencia');
    expect(es).toContain('Finalizar emparejamiento');
    expect(esHtml).toMatch(/<option value=""[^>]*>No establecido<\/option>/);
  });

  test('BackgroundMatchingLayer — the doctrine-correction note and offline deferred notice translate', () => {
    const correctionProps = {
      entries: [{ contactId: 'c-1', name: 'Riley', tiles: {}, note: 'a community contact', existingLicenseeFlag: false }],
      onChangeTile: noop,
      onChangeNote: noop,
      onToggleExistingLicensee: noop,
      corrections: [{ contactId: 'c-1', original: 'a prospect', corrected: 'a community contact', violations: [] }],
      onSubmit: noop,
    };
    expect(textOf(renderEn(BackgroundMatchingLayer, correctionProps))).toContain(
      'We corrected a word in this note to keep it doctrine-clean: “a community contact”'
    );
    expect(textOf(renderEs(BackgroundMatchingLayer, correctionProps))).toContain(
      'Corregimos una palabra en esta nota para mantenerla conforme a la doctrina: “a community contact”'
    );

    const offlineProps = { ...correctionProps, corrections: [], offline: true };
    expect(textOf(renderEn(BackgroundMatchingLayer, offlineProps))).toContain(
      'We’ll finish matching when you’re back online'
    );
    expect(textOf(renderEs(BackgroundMatchingLayer, offlineProps))).toContain(
      'Terminaremos el emparejamiento cuando vuelvas a estar en línea'
    );
  });

  test('RitualConfirmation — eyebrow, lede, boundary line (incl. the two EN reference constants), and Hand-to-agent CTA translate', () => {
    const actionableItem: PublicQueueItem = {
      contactId: 'c-1',
      firstName: 'Morgan',
      lastInitial: 'S',
      tier: ReadinessTier.A,
      label: 'Ready now',
      clusters: [],
      tiles: {},
      needsAcknowledgment: false,
      needsJurisdiction: false,
      layersCompleted: [MethodLayer.BLANK_CANVAS, MethodLayer.QUALITIES_FLIP, MethodLayer.BACKGROUND_MATCHING],
    };
    const props = { queue: [actionableItem], onAcknowledgeExcluded: noop, onHandToAgent: noop };
    const en = textOf(renderEn(RitualConfirmation, props));
    const es = textOf(renderEs(RitualConfirmation, props));
    expect(en).toContain('Confirmation');
    expect(en).toContain('Here are the community members we’ll introduce your business to first');
    expect(en).toContain(WARM_MARKET_SUB_AGENT_NAME);
    expect(en).toContain(APPROVAL_BOUNDARY_LINE);
    expect(en).toContain('Hand to my agent');
    expect(es).toContain('Confirmación');
    expect(es).toContain('Estos son los miembros de tu comunidad a quienes presentaremos tu negocio primero');
    expect(es).toContain('tu Subagente de Mercado Cálido');
    expect(es).toContain('Nada se envía sin tu aprobación.');
    expect(es).toContain('Entregar a mi agente');
    expect(es).not.toContain(WARM_MARKET_SUB_AGENT_NAME);
  });

  test('RitualConfirmation — the unmatched-highlight add-number prompt and excluded/needs-jurisdiction sections translate', () => {
    const excludedItem: PublicQueueItem = {
      contactId: 'c-2',
      firstName: 'Alex',
      lastInitial: 'T',
      tier: ReadinessTier.EXCLUDED,
      label: 'Excluded',
      clusters: [],
      tiles: {},
      needsAcknowledgment: true,
      needsJurisdiction: false,
      layersCompleted: [MethodLayer.BLANK_CANVAS, MethodLayer.QUALITIES_FLIP, MethodLayer.BACKGROUND_MATCHING],
    };
    const props = {
      queue: [excludedItem],
      unmatchedHighlights: [{ name: 'Sam' }],
      onAcknowledgeExcluded: noop,
      onHandToAgent: noop,
    };
    const en = textOf(renderEn(RitualConfirmation, props));
    const es = textOf(renderEs(RitualConfirmation, props));
    expect(en).toContain('We couldn’t find Sam in your contacts');
    expect(en).toContain('Add number');
    expect(en).toContain('These contacts are excluded and need your acknowledgment');
    expect(en).toContain('Acknowledge');
    expect(es).toContain('No pudimos encontrar a Sam en tus contactos');
    expect(es).toContain('Agregar número');
    expect(es).toContain('Estos contactos están excluidos y requieren tu confirmación');
    expect(es).toContain('Confirmar');
  });
});
