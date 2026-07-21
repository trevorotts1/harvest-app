// T-R32c (i18n completion, master-spec §17.5; uiux §6.2) — the Shift phase screens (Open/Close/
// Done, `src/app/shift/components/*.tsx`) are the daily-use core loop every rep passes through on
// every shift. Carried 18 pre-existing `NO_LITERALS_BASELINE.json` entries across the four phase
// components, plus the `recapLine()` composition function — a scanner blind spot entirely (plain
// string literals inside imperative JS, not JSX). Proves the full retrofit: EN default unchanged,
// genuine ES render (not a silent EN fallback), including the WCAG §17.4/uiux §6.1 "Shift close"
// combined screen-reader narration script this suite's own shift-ui.test.ts already covers in EN.
import { createElement, type ElementType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import OpenPhase from '@/app/shift/components/OpenPhase';
import ClosePhase, { recapLine } from '@/app/shift/components/ClosePhase';
import DoneScreen from '@/app/shift/components/DoneScreen';
import { LocaleContext } from '@/app/locale-context';
import { t, DEFAULT_LOCALE } from '@/lib/i18n';
import type { TVars } from '@/lib/i18n/catalog';
import type { RatioCardView } from '@/types/learning-state';

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&apos;|&rsquo;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

const noop = () => {};
const tEn = (key: string, vars?: TVars) => t(DEFAULT_LOCALE, key, vars);
const tEs = (key: string, vars?: TVars) => t('es', key, vars);

const renderEn = (el: ElementType, props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(el, props));

const renderEs = (el: ElementType, props: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      { value: { locale: 'es', setLocale: noop, t: tEs } },
      createElement(el, props)
    )
  );

const ratioView: RatioCardView = {
  headline: [20, 5, 1],
  isBaseline: true,
  learningLabel: 'learning your community',
  explainer: 'explainer text',
  status: 'LEARNING',
  dataPointCount: 0,
};

const openProps = {
  briefingLines: ['Line one.'],
  motivationalLine: 'Show up today.',
  streakCount: 4,
  graceDayOffer: true,
  mode: 'STANDARD' as const,
  learningState: { agentRatio: ratioView, fieldTrainerRatio: ratioView, computedAt: 'x' },
  onBegin: noop,
};

describe('OpenPhase — i18n (EN default + genuine ES render, T-R32c)', () => {
  test('EN default renders the streak badge, grace-day banner, and Begin CTA in English', () => {
    const text = textOf(renderEn(OpenPhase, openProps));
    expect(text).toContain('4-day streak');
    expect(text).toMatch(/grace day used/i);
    expect(text).toContain('Begin');
  });

  test('ES provider renders genuinely Spanish copy — not a silent EN fallback', () => {
    const text = textOf(renderEs(OpenPhase, openProps));
    expect(text).toContain('Racha de 4 días');
    expect(text).toMatch(/se usó un día de gracia/i);
    expect(text).toContain('Comenzar');
    expect(text).not.toContain('4-day streak');
    expect(text).not.toContain('Begin');
  });
});

describe('ClosePhase.recapLine — i18n (T-R32c, a pure scanner blind spot)', () => {
  test('EN: composes the exact recap sentence for a mixed recap', () => {
    const recap = { approvals: 2, confirmations: 1, logs: 0 };
    expect(recapLine(recap, tEn)).toBe(
      'You approved 2 introductions; confirmed 1 appointment. Your agents take it from here.'
    );
  });

  test('ES: composes a genuinely Spanish recap sentence for the SAME recap — not a silent EN fallback', () => {
    const recap = { approvals: 2, confirmations: 1, logs: 0 };
    expect(recapLine(recap, tEs)).toBe(
      'Tú aprobaste 2 introducciones; confirmaste 1 cita. Tus agentes se encargan a partir de aquí.'
    );
  });

  test('the honest empty-queue fallback is real, distinct EN/ES copy', () => {
    expect(recapLine(null, tEn)).toBe('Nothing needed you today — your field is working.');
    expect(recapLine(null, tEs)).toBe('Nada necesitó de ti hoy — tu campo está trabajando.');
  });

  test('singular vs. plural counts pick the correctly-conjugated EN and ES forms (1 vs. many)', () => {
    expect(recapLine({ approvals: 1, confirmations: 0, logs: 0 }, tEn)).toBe(
      'You approved 1 introduction. Your agents take it from here.'
    );
    expect(recapLine({ approvals: 1, confirmations: 0, logs: 0 }, tEs)).toBe(
      'Tú aprobaste 1 introducción. Tus agentes se encargan a partir de aquí.'
    );
  });
});

describe('ClosePhase — i18n (EN default + genuine ES render, T-R32c)', () => {
  const closeProps = { recap: { approvals: 4, confirmations: 1, logs: 0 }, elapsedSeconds: 22 * 60, targetSeconds: 30 * 60, onFinish: noop };

  test('EN default renders the beat-your-plan celebration and equal-weight buttons in English', () => {
    const html = renderEn(ClosePhase, closeProps);
    const text = textOf(html);
    expect(text).toMatch(/beat your own plan/);
    expect(html).toContain('Save &amp; finish');
    expect(text).toContain('Skip');
  });

  test('ES provider renders genuinely Spanish copy — not a silent EN fallback', () => {
    const text = textOf(renderEs(ClosePhase, closeProps));
    expect(text).toMatch(/superaste tu propio plan/);
    expect(text).toContain('Guardar y finalizar');
    expect(text).toContain('Omitir');
    expect(text).not.toMatch(/beat your own plan/);
  });
});

describe('DoneScreen — i18n (EN default + genuine ES render, T-R32c)', () => {
  const doneProps = { streakCount: 7, recap: { approvals: 2, confirmations: 1, logs: 0 }, onBackToToday: noop };

  test('EN default renders the exact "You\'re done for today." string + combined narration script', () => {
    const text = textOf(renderEn(DoneScreen, doneProps));
    expect(text).toMatch(/You.{1,2}re done for today\./);
    expect(text).toContain('7-day streak');
    expect(text).toContain('Back to your day');
    expect(text).toMatch(/Your agents take it from here\./);
  });

  test('ES provider renders the combined narration script genuinely in Spanish — not a silent EN fallback', () => {
    const text = textOf(renderEs(DoneScreen, doneProps));
    expect(text).toContain('Terminaste por hoy.');
    expect(text).toContain('Racha de 7 días.');
    expect(text).toContain('Volver a tu día');
    expect(text).toMatch(/Tus agentes se encargan a partir de aquí\./);
    expect(text).not.toContain("You're done for today");
  });
});
