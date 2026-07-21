// T-R32 (master-spec §17.5; uiux §6.2) — `ConversationTimeline`/`AgentSentBadge` (§4.7/§5.7) were
// fully retrofitted off hardcoded EN literals onto the i18n catalog (8 pre-existing
// `NO_LITERALS_BASELINE.json` entries + several status-label literals the baseline scanner couldn't
// see, since they were hidden behind a function call rather than a direct JSX literal). Proves
// genuine ES rendering via an explicit `<LocaleContext.Provider>` — complementing (never replacing)
// tests/unit/conversation-timeline.test.ts's own EN-default proof, which continues to pass unchanged.
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ConversationTimeline, { type TimelineEntry } from '@/app/community/components/ConversationTimeline';
import AgentSentBadge from '@/app/community/components/AgentSentBadge';
import { LocaleContext } from '@/app/locale-context';
import { t } from '@/lib/i18n/catalog';

const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');

function esRender(children: ReactNode): string {
  return renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      { value: { locale: 'es', setLocale: () => {}, t: (key: string, vars?: Record<string, string | number>) => t('es', key, vars) } },
      children
    )
  );
}

const TS = '2026-07-14T15:00:00Z';

describe('AgentSentBadge — genuine ES render (T-R32)', () => {
  test('platform-sent agent entry renders Spanish transparency copy, not a silent EN fallback', () => {
    const html = esRender(
      createElement(AgentSentBadge, {
        source: 'AGENT',
        sentFrom: 'platform_number',
        approvedBy: 'rep-1',
        approvedAt: TS,
        cfeAuditId: 'audit-1',
      })
    );
    const text = textOf(html);
    expect(text).toContain('desde tu número de Harvest');
    expect(text).toContain('aprobado por ti');
    expect(text).toContain('registro de cumplimiento vinculado');
    expect(text).not.toContain('from your Harvest number');
  });

  test('own-number composer handoff renders "enviado desde tu número"', () => {
    const html = esRender(createElement(AgentSentBadge, { source: 'AGENT', sentFrom: 'rep_number' }));
    expect(textOf(html)).toContain('enviado desde tu número');
  });
});

describe('ConversationTimeline — genuine ES render (T-R32)', () => {
  test('empty timeline renders the Spanish empty-state narrative', () => {
    const html = esRender(createElement(ConversationTimeline, { entries: [] }));
    expect(textOf(html)).toContain('Aún no hay presentaciones');
  });

  test('a failed send renders "fallido" + a Spanish Retry affordance', () => {
    const entries: TimelineEntry[] = [
      {
        kind: 'message',
        id: 'm-1',
        direction: 'OUTBOUND',
        source: 'AGENT',
        channel: 'SMS_PLATFORM',
        sentFrom: 'platform_number',
        body: 'hola',
        timestamp: TS,
        deliveryStatus: 'FAILED',
      },
    ];
    const text = textOf(esRender(createElement(ConversationTimeline, { entries })));
    expect(text).toContain('fallido');
    expect(text).toContain('Reintentar');
    expect(text).not.toContain('Retry');
  });

  test('a reply-paused system entry names the contact in Spanish', () => {
    const entries: TimelineEntry[] = [
      { kind: 'system', id: 's-1', variant: 'reply-paused', contactName: 'Jamie', timestamp: TS },
    ];
    const text = textOf(esRender(createElement(ConversationTimeline, { entries })));
    expect(text).toContain('Jamie respondió');
    expect(text).toContain('tu cadencia está en pausa');
  });

  test('an opt-out entry renders the Spanish do-not-contact rule', () => {
    const entries: TimelineEntry[] = [{ kind: 'system', id: 's-2', variant: 'opt-out', timestamp: TS }];
    const text = textOf(esRender(createElement(ConversationTimeline, { entries })));
    expect(text).toContain('No contactar');
    expect(text).toContain('respetado en todas partes');
  });

  test('own-number handoff renders "enviado desde tu número" and the honest "transferido" status (never a fake delivery tick)', () => {
    const entries: TimelineEntry[] = [
      {
        kind: 'message',
        id: 'h-1',
        direction: 'OUTBOUND',
        source: 'AGENT',
        channel: 'SMS_HANDOFF',
        sentFrom: 'rep_number',
        body: 'primer contacto',
        timestamp: TS,
        deliveryStatus: 'HANDED_OFF',
      },
    ];
    const text = textOf(esRender(createElement(ConversationTimeline, { entries })));
    expect(text).toContain('enviado desde tu número');
    expect(text).toContain('transferido');
    expect(text).not.toContain('entregado');
  });
});
