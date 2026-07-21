// T-R32b (master-spec §17.5; uiux §6.2) — Today (Mission Control) is the app's default landing
// surface (uiux AC-2-1) — every rep sees these zone components on every visit. Proves the retrofit
// off hardcoded EN literals (42 baseline entries across 7 files, plus several genuinely-broken-but-
// unflagged hardcoded label maps — KIND_LABEL/PHASE_COPY, same class of gap as AnchorHeader's
// BAND_LABEL) onto the i18n catalog: EN default unchanged, genuine ES render, no EN leakage.
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ActionQueue from '@/app/today/components/ActionQueue';
import CalendarStrip from '@/app/today/components/CalendarStrip';
import WP07Panel from '@/app/today/components/WP07Panel';
import RatioCards from '@/app/today/components/RatioCards';
import BriefingCard from '@/app/today/components/BriefingCard';
import PipelineGlance from '@/app/today/components/PipelineGlance';
import ZoneErrorBoundary from '@/app/today/components/ZoneErrorBoundary';
import { LocaleContext } from '@/app/locale-context';
import { t } from '@/lib/i18n/catalog';
import type {
  ActionQueueZoneData,
  CalendarZoneData,
  MilestonesZoneData,
  PipelineZoneData,
  QueueItem,
  RatiosZoneData,
  ZoneResult,
} from '@/services/mission-control/types';

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

describe('Today zone components — i18n (EN default + genuine ES render, T-R32b)', () => {
  test('ActionQueue — badge, CFE band narrative, queued-offline, decline/review CTAs, and the "show all" count translate (EN default, no locale prop, matching the direct-function-call test convention)', () => {
    const flaggedItem: QueueItem = {
      id: 'flag-1',
      kind: 'review_flagged',
      title: 'Review flagged draft',
      why: 'needs review',
      contactLabel: 'Maya J.',
      minutes: 3,
      cfeBand: 'FLAG',
      channel: 'SMS_HANDOFF',
    };
    const data: ActionQueueZoneData = { totalMinutes: 22, items: [flaggedItem], totalCount: 3 };
    const result: ZoneResult<ActionQueueZoneData> = { status: 'ok', data };

    const enHtml = renderToStaticMarkup(createElement(ActionQueue, { result, onAction: () => {}, locale: 'en' }));
    const esHtml = renderToStaticMarkup(createElement(ActionQueue, { result, onAction: () => {}, locale: 'es' }));
    const en = textOf(enHtml);
    const es = textOf(esHtml);

    expect(en).toContain('Today: 22 minutes');
    expect(en).toContain('Flagged by compliance review');
    expect(en).toContain('(CFE: FLAG)');
    expect(en).toContain('Review in Approval Inbox');
    expect(en).toContain('Decline');
    expect(en).toContain('show all (3)');

    expect(es).toContain('Hoy: 22 minutos');
    expect(es).toContain('Marcado por revisión de cumplimiento');
    expect(es).toContain('(CFE: FLAG)');
    expect(es).toContain('Revisar en la Bandeja de aprobación');
    expect(es).toContain('Rechazar');
    expect(es).toContain('ver todo (3)');
    expect(es).not.toContain('Today:');
  });

  test('ActionQueue — the empty (0-count) done-state and the confirm-appointment kind label translate', () => {
    const confirmItem: QueueItem = {
      id: 'c-1',
      kind: 'confirm_appointment',
      title: 'Confirm appt',
      why: 'because',
      contactLabel: 'Sam',
      minutes: 1,
      cfeBand: 'PASS',
      channel: 'SMS_HANDOFF',
    };
    const emptyResult: ZoneResult<ActionQueueZoneData> = { status: 'ok', data: { totalMinutes: 0, items: [], totalCount: 0 } };
    const confirmResult: ZoneResult<ActionQueueZoneData> = { status: 'ok', data: { totalMinutes: 1, items: [confirmItem], totalCount: 1 } };

    expect(textOf(renderToStaticMarkup(createElement(ActionQueue, { result: emptyResult, onAction: () => {}, locale: 'en' })))).toContain(
      'Nothing needs you'
    );
    expect(textOf(renderToStaticMarkup(createElement(ActionQueue, { result: emptyResult, onAction: () => {}, locale: 'es' })))).toContain(
      'Nada necesita de ti'
    );
    expect(textOf(renderToStaticMarkup(createElement(ActionQueue, { result: confirmResult, onAction: () => {}, locale: 'en' })))).toContain(
      'Confirm'
    );
    expect(textOf(renderToStaticMarkup(createElement(ActionQueue, { result: confirmResult, onAction: () => {}, locale: 'es' })))).toContain(
      'Confirmar'
    );
  });

  test('CalendarStrip — badge, no-org/quiet narratives, and attendance CTAs translate', () => {
    const noOrg: ZoneResult<CalendarZoneData> = { status: 'ok', data: { hasOrg: false, events: [] } };
    const quiet: ZoneResult<CalendarZoneData> = { status: 'ok', data: { hasOrg: true, events: [] } };
    const withEvent: ZoneResult<CalendarZoneData> = {
      status: 'ok',
      data: { hasOrg: true, events: [{ id: 'e1', type: 'THREE_WAY', startsAt: new Date().toISOString(), attendanceState: 'none' }] },
    };

    expect(textOf(renderEn(CalendarStrip, { result: noOrg, onMarkAttendance: () => {} }))).toContain('No team yet');
    expect(textOf(renderEs(CalendarStrip, { result: noOrg, onMarkAttendance: () => {} }))).toContain('Aún no tienes equipo');
    expect(textOf(renderEn(CalendarStrip, { result: quiet, onMarkAttendance: () => {} }))).toContain('Quiet so far');
    expect(textOf(renderEs(CalendarStrip, { result: quiet, onMarkAttendance: () => {} }))).toContain('Tranquilo por ahora');

    const en = textOf(renderEn(CalendarStrip, { result: withEvent, onMarkAttendance: () => {} }));
    const es = textOf(renderEs(CalendarStrip, { result: withEvent, onMarkAttendance: () => {} }));
    expect(en).toContain('Team calendar');
    expect(en).toContain('I was there');
    expect(en).toContain("Couldn't make it".replace("'", "'"));
    expect(es).toContain('Calendario del equipo');
    expect(es).toContain('Estuve ahí');
    expect(es).toContain('No pude asistir');
  });

  test('WP07Panel — Milestones heading + the three nav cards (Learn/Grow/Momentum) translate', () => {
    const milestones: ZoneResult<MilestonesZoneData> = {
      status: 'ok',
      data: { items: [{ key: 'm1', label: 'First appointment set', achievedAt: new Date().toISOString(), celebrated: false }] },
    };
    const en = textOf(renderEn(WP07Panel, { milestones }));
    const es = textOf(renderEs(WP07Panel, { milestones }));
    expect(en).toContain('Milestones');
    expect(en).toContain('Learn');
    expect(en).toContain('Course, referrals coaching'); // "&" is HTML-escaped then stripped by textOf
    expect(en).toContain('Grow');
    expect(en).toContain('Your Goal Commitment Card');
    expect(en).toContain('Momentum');
    expect(en).toContain('The ten criteria, in full');
    expect(es).toContain('Hitos');
    expect(es).toContain('Aprender');
    expect(es).toContain('Curso, referidos y acompañamiento');
    expect(es).toContain('Cultivar');
    expect(es).toContain('Tu tarjeta de compromiso de metas');
    expect(es).toContain('Los diez criterios, completos');
  });

  test('RatioCards — heading, the two ratio titles, and the learning-state chip translate', () => {
    const data: RatiosZoneData = {
      agentRatio: { a: 20, b: 5, c: 1, labels: ['a', 'b', 'c'], learning: true, dataPoints: 2, explainer: 'x' },
      fieldTrainerRatio: { a: 20, b: 5, c: 1, labels: ['a', 'b', 'c'], learning: true, dataPoints: 0, explainer: 'y' },
    };
    const result: ZoneResult<RatiosZoneData> = { status: 'ok', data };
    const en = textOf(renderEn(RatioCards, { result }));
    const es = textOf(renderEs(RatioCards, { result }));
    expect(en).toContain('Ratios');
    expect(en).toContain("Agent's Ratio".replace("'", "'"));
    expect(en).toContain('learning your community');
    expect(es).toContain('Proporciones');
    expect(es).toContain('Proporción del Agente');
    expect(es).toContain('Proporción del Entrenador de Campo');
    expect(es).toContain('conociendo tu comunidad');
  });

  test('PipelineGlance — heading translates (both locales keep the business term "Pipeline" itself, per doctrine — not a forbidden term)', () => {
    const data: PipelineZoneData = { buckets: [{ key: 'introduced', label: 'Introduced', count: 3, deltaLast7d: 1 }] };
    const result: ZoneResult<PipelineZoneData> = { status: 'ok', data };
    const en = textOf(renderEn(PipelineGlance, { result }));
    const es = textOf(renderEs(PipelineGlance, { result }));
    expect(en).toContain('Pipeline');
    expect(es).toContain('Pipeline');
  });

  test('BriefingCard — the "While you slept" badge translates independent of the AI-composed narrative lines (left English by design, out of this pass\'s scope)', () => {
    const result = { status: 'ok' as const, data: { state: 'empty' as const, freshnessStamp: null, lines: [] } };
    const en = textOf(renderEn(BriefingCard, { result }));
    const es = textOf(renderEs(BriefingCard, { result }));
    expect(en).toContain('While you slept');
    expect(es).toContain('Mientras dormías');
  });

  // `renderToStaticMarkup` (React's legacy, non-streaming SSR) does not run error-boundary recovery
  // at all — a thrown render error simply aborts the whole render, client-only behavior — so the
  // fallback branch can't be reached by actually throwing inside a child here. Instead, this
  // exercises the class component directly: force it into its already-caught `hasError: true` state
  // (exactly what `getDerivedStateFromError` sets) and render the resulting element tree, which is
  // real, plain JSX from that point on.
  test('ZoneErrorBoundary — the render-time-crash fallback message translates (class component; pure t(locale,...), not a hook)', () => {
    const enInstance = new ZoneErrorBoundary({ zoneName: 'ratios', locale: 'en', children: null });
    enInstance.state = { hasError: true };
    const esInstance = new ZoneErrorBoundary({ zoneName: 'ratios', locale: 'es', children: null });
    esInstance.state = { hasError: true };

    const enHtml = renderToStaticMarkup(enInstance.render() as ReturnType<typeof createElement>);
    const esHtml = renderToStaticMarkup(esInstance.render() as ReturnType<typeof createElement>);
    expect(textOf(enHtml)).toContain('We could not show your ratios right now');
    expect(textOf(esHtml)).toContain('No pudimos mostrar tu ratios ahora mismo');
  });
});
