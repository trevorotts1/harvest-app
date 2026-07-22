// T-R32 (master-spec §17.5; uiux §6.2) — `ApprovalInboxItem` was fully retrofitted off hardcoded EN
// literals onto the i18n catalog (18 pre-existing `NO_LITERALS_BASELINE.json` entries + several more
// literals the baseline scanner couldn't see, e.g. ternary-embedded chip labels). Proves:
//   (a) the EN default (no `<LocaleContext.Provider>`, i.e. every OTHER test in this suite's own
//       convention — see approval-inbox-item-approve-gate.test.ts) still renders byte-identical copy;
//   (b) wrapping in an explicit `es` locale context genuinely renders Spanish catalog copy, not a
//       silent EN fallback — proving the component actually reads `useLocale()`, not a hardcoded string;
//   (c) the "Drafted {date}" meta line is locale-aware (Spanish month name for `es`, not `en-US`).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ApprovalInboxItem, { type InboxItemData } from '@/app/inbox/components/ApprovalInboxItem';
import { LocaleContext } from '@/app/locale-context';
import { t } from '@/lib/i18n/catalog';

// `renderToStaticMarkup` HTML-escapes a literal apostrophe as `&#x27;` — decode that back to `'`
// BEFORE stripping other (named) entities to a space, so it round-trips intact in `textOf` output.
const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

const noop = async () => ({ ok: true });

function baseItem(overrides: Partial<InboxItemData> = {}): InboxItemData {
  return {
    id: 'd-1',
    contact_id: 'c-1',
    contact: { firstName: 'Jordan', lastName: 'Vega' },
    channel: 'SMS_HANDOFF',
    body: 'a drafted message',
    cfe_outcome: 'PASS',
    cfe_risk_score: 3,
    approval_state: 'PENDING',
    created_at: '2026-07-15T14:30:00.000Z',
    ...overrides,
  };
}

const renderEn = (item: InboxItemData) =>
  renderToStaticMarkup(createElement(ApprovalInboxItem, { item, onApprove: noop, onDecline: noop, onEdit: noop }));

const renderEs = (item: InboxItemData) =>
  renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      { value: { locale: 'es', setLocale: () => {}, t: (key: string, vars?: Record<string, string | number>) => t('es', key, vars) } },
      createElement(ApprovalInboxItem, { item, onApprove: noop, onDecline: noop, onEdit: noop })
    )
  );

describe('ApprovalInboxItem — i18n (EN default + genuine ES render, T-R32)', () => {
  test('EN default (no provider — this suite\'s established fallback convention) renders EN catalog copy', () => {
    const html = renderEn(baseItem());
    const text = textOf(html);
    expect(text).toContain('Agent draft');
    expect(text).toContain('Pass');
    expect(html).toMatch(/<button[^>]*>\s*Approve\s*<\/button>/);
    expect(text).toContain('Edit');
    expect(text).toContain('Decline');
  });

  test('ES provider renders genuinely Spanish catalog copy for the same item — not a silent EN fallback', () => {
    const html = renderEs(baseItem());
    const text = textOf(html);
    expect(text).toContain('Borrador del agente'); // "Agent draft"
    expect(text).toContain('Conforme'); // the PASS chip label
    expect(text).toContain('Aprobar'); // "Approve"
    expect(text).toContain('Editar'); // "Edit"
    expect(text).toContain('Rechazar'); // "Decline"
    // None of the EN-only strings leak into the ES render.
    expect(text).not.toContain('Agent draft');
    expect(html).not.toMatch(/<button[^>]*>\s*Approve\s*<\/button>/);
  });

  test('the HELD banner and rewrite/discard affordances translate too', () => {
    const heldItem = baseItem({ approval_state: 'HELD', cfe_outcome: 'BLOCK' });
    const enText = textOf(renderEn(heldItem));
    const esText = textOf(renderEs(heldItem));
    expect(enText).toContain('cannot be approved as-is');
    expect(esText).toContain('no se puede aprobar tal cual');
  });

  test('"Drafted {date}" is locale-aware — Spanish month name for es, not a hardcoded en-US string', () => {
    const enText = textOf(renderEn(baseItem()));
    const esText = textOf(renderEs(baseItem()));
    expect(enText).toMatch(/Drafted.*Jul/);
    expect(esText).toMatch(/Redactado el.*jul/); // "Drafted on {date}" — Spanish month abbreviation
    expect(esText).not.toContain('Drafted');
  });

  // T-57 RG6 (i18n) — the header chip used to render `{current.channel.replaceAll('_', ' ')}` (a
  // raw `MessageChannel` token, merely de-snake-cased, e.g. "sms handoff") and the `aria-label`
  // spliced the SAME raw token into `draftToAria`'s `{channel}` interpolation — both closed
  // `RENDERED_I18N_LEAK_BASELINE.json` entries via `channelLabel` (`@/lib/i18n/channel-display.ts`).
  test('TEETH — the channel chip is a genuine localized label, never the raw/de-snake-cased MessageChannel token', () => {
    const item = baseItem({ channel: 'SMS_HANDOFF' });
    const enText = textOf(renderEn(item));
    const esText = textOf(renderEs(item));
    expect(enText).toContain('Text (your number)');
    expect(esText).toContain('SMS (tu número)');
    expect(enText).not.toContain('SMS_HANDOFF');
    expect(enText).not.toContain('sms handoff');
    expect(esText).not.toContain('sms handoff');
  });

  test('TEETH — the same fix holds for every known MessageChannel value, and the aria-label carries the localized label too, not the raw token', () => {
    const channels: [string, string, string][] = [
      ['SMS_PLATFORM', 'Text (platform number)', 'SMS (número de la plataforma)'],
      ['EMAIL', 'Email', 'Correo electrónico'],
      ['SOCIAL_DM', 'Social DM', 'DM social'],
      ['IN_APP', 'In-app message', 'Mensaje en la app'],
    ];
    for (const [channel, enLabel, esLabel] of channels) {
      const item = baseItem({ channel });
      const enHtml = renderEn(item);
      const esHtml = renderEs(item);
      expect(textOf(enHtml)).toContain(enLabel);
      expect(textOf(esHtml)).toContain(esLabel);
      // The aria-label attribute itself (not just the visible chip) carries the localized label.
      expect(enHtml).toContain(`via ${enLabel}`);
      expect(esHtml).toContain(`vía ${esLabel}`);
      expect(enHtml).not.toContain(channel);
      expect(esHtml).not.toContain(channel);
    }
  });

  test('queued-offline banner translates and suppresses the action footer in both locales', () => {
    const queuedItem = baseItem({ queuedOffline: true });
    const enHtml = renderEn(queuedItem);
    const esHtml = renderEs(queuedItem);
    const enText = textOf(enHtml);
    const esText = textOf(esHtml);
    expect(enText).toMatch(/will finish when you.{1,3}re back online/i);
    expect(esText).toContain('se completará cuando vuelvas a estar en línea');
    expect(enHtml).not.toMatch(/<button[^>]*>\s*Approve\s*<\/button>/);
    expect(esText).not.toContain('Aprobar');
  });
});
