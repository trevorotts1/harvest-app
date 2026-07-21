// T-57 R3a — the Composer Handoff Sheet component (uiux §4.4). This repo's Jest runs
// `testEnvironment: 'node'` (no jsdom — see approval-inbox-item-approve-gate.test.ts's header), so
// these are `react-dom/server` static-markup renders of the component's initial state. The sheet's
// live states are seeded via its documented `initialState` test seam (no `useEffect`/`fetch` runs in
// a static render), exactly the pattern the locale-context `LocaleContext.Provider` seam supports.
//
// It proves: (1) a READY state renders the cleared text + cleared caption; (2) THE BREAK-IT TEST —
// a HELD / CFE-down / not-yet-cleared (loading) state NEVER renders sendable text or an `sms:` link
// (AC-4-3, master-spec §5.2); (3) mobile → the one-tap `sms:` deep link; (4) desktop → the
// degraded copy path, no `sms:` link; (5) confirm → the agent-sent-from-your-number badge; (6) real
// ES rendering.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ComposerHandoffSheet, { type ComposerSheetState } from '@/app/community/components/ComposerHandoffSheet';
import { LocaleContext, type LocaleContextValue } from '@/app/locale-context';
import { t as lookup } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';

const CLEARED_BODY = 'Hi Jordan — it has been too long. Would love to catch up sometime soon.';
const SMS_URI = 'sms:+15551234567?body=Hi%20Jordan';

function readyState(): ComposerSheetState {
  return {
    phase: 'ready',
    cleared: { body: CLEARED_BODY, smsUri: SMS_URI, to: '+15551234567', clearedAt: '2026-07-20T15:00:00.000Z' },
    messageId: 'm-1',
  };
}

const baseProps = { open: true, draftId: 'd-1', contactName: 'Jordan V.', onClose: () => {} };

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(ComposerHandoffSheet as never, { ...baseProps, ...props }));

function renderLocale(locale: Locale, props: Record<string, unknown>) {
  const value: LocaleContextValue = { locale, setLocale: () => {}, t: (k, v) => lookup(locale, k, v) };
  return renderToStaticMarkup(
    createElement(LocaleContext.Provider, { value }, createElement(ComposerHandoffSheet as never, { ...baseProps, ...props }))
  );
}

const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&#?[a-z0-9]+;/gi, ' ');

describe('READY — the cleared text renders (only in the ready state)', () => {
  test('the compliance-cleared body + "Compliance-cleared" caption render', () => {
    const html = render({ initialState: readyState(), platformOverride: 'mobile' });
    expect(textOf(html)).toContain(CLEARED_BODY);
    expect(textOf(html)).toMatch(/Compliance-cleared/);
    // Honesty fine-copy (§4.4): edits in Messages are the rep's own act.
    expect(textOf(html)).toMatch(/Anything you change in Messages is yours/);
  });
});

// ═══════════════════════════ THE BREAK-IT TEST (AC-4-3) ═══════════════════════════
// The sheet must NEVER render pre-cleared/sendable text when the CFE is unavailable or the content
// did not PASS. No cleared body, no `sms:` deep link — the honest hold state instead.
describe('BREAK-IT: the sheet refuses to open with sendable text when not CFE-cleared', () => {
  test('HELD (CFE held/blocked content) -> NO cleared body, NO sms: link, honest hold copy', () => {
    const html = render({ initialState: { phase: 'held', holdReason: 'NOT_CFE_CLEARED' } as ComposerSheetState, platformOverride: 'mobile' });
    expect(html).not.toContain(CLEARED_BODY);
    expect(html).not.toContain('sms:'); // no deep link anywhere in the markup
    expect(html).not.toMatch(/data-testid="composer-sms-link"/);
    expect(textOf(html)).toMatch(/Compliance check is catching up/);
  });

  test('CFE DOWN (clearance unreachable) -> NO cleared body, NO sms: link, honest "catching up" copy', () => {
    const html = render({ initialState: { phase: 'held', holdReason: 'UNAVAILABLE' } as ComposerSheetState, platformOverride: 'mobile' });
    expect(html).not.toContain(CLEARED_BODY);
    expect(html).not.toContain('sms:');
    expect(textOf(html)).toMatch(/couldn.{0,3}t reach the compliance check/i);
  });

  test('DEFAULT open state (loading — clearance not yet returned) -> NO cleared body, NO sms: link', () => {
    // No initialState: the sheet opens straight into `loading`. The truest fail-closed proof — before
    // the server clears anything, there is nothing sendable in the DOM.
    const html = render({ platformOverride: 'mobile' });
    expect(html).not.toContain(CLEARED_BODY);
    expect(html).not.toContain('sms:');
    expect(textOf(html)).toMatch(/Getting your compliance-cleared message ready/);
  });

  test('closed (open:false) renders nothing at all', () => {
    const html = render({ open: false, initialState: readyState() });
    expect(html).toBe('');
  });
});

describe('Platform parity (§6.3): mobile Full sms: · desktop Degraded copy', () => {
  test('MOBILE ready -> the one-tap sms: deep link is present', () => {
    const html = render({ initialState: readyState(), platformOverride: 'mobile' });
    expect(html).toContain(`href="${SMS_URI}"`);
    expect(html).toMatch(/data-testid="composer-sms-link"/);
    expect(textOf(html)).toMatch(/Open in Messages/);
  });

  test('DESKTOP ready -> copy path + send-from-phone note, and NO sms: anchor (degraded by design)', () => {
    const html = render({ initialState: readyState(), platformOverride: 'desktop' });
    expect(textOf(html)).toMatch(/Copy text/);
    expect(textOf(html)).toMatch(/send it from your phone/i);
    expect(html).not.toContain('href="sms:');
    expect(html).not.toMatch(/data-testid="composer-sms-link"/);
  });
});

describe('Confirmation -> agent-sent badge', () => {
  test('awaiting-confirm shows the one-tap "Did it send?" (I sent it / I didn\'t send it)', () => {
    const html = render({ initialState: { ...readyState(), phase: 'awaitingConfirm' }, platformOverride: 'mobile' });
    expect(textOf(html)).toMatch(/Did it send\?/);
    expect(textOf(html)).toMatch(/I sent it/);
    expect(textOf(html)).toMatch(/I didn.{0,3}t send it/);
  });

  test('confirmed -> the AgentSentBadge renders "sent from your number" (never a fabricated delivery)', () => {
    const html = render({ initialState: { ...readyState(), phase: 'confirmed' } });
    // The AgentSentBadge component actually rendered (its own class name via the CSS-module proxy)…
    expect(html).toContain('agentBadge');
    // …with the honest own-number send-path grammar (uiux §5.7 / §4.7).
    expect(textOf(html).toLowerCase()).toContain('sent from your number');
  });

  test('declined -> no-shame "back in your queue" copy, no badge', () => {
    const html = render({ initialState: { ...readyState(), phase: 'declined' } });
    expect(textOf(html)).toMatch(/back in your queue/i);
    expect(html).not.toContain('agentBadge');
  });
});

describe('Real ES rendering (uiux §6.2)', () => {
  test('ES mobile ready renders idiomatic Spanish chrome (not the English passthrough)', () => {
    const html = renderLocale('es', { initialState: readyState(), platformOverride: 'mobile' });
    const text = textOf(html);
    expect(text).toMatch(/Abrir en Mensajes/); // ES "Open in Messages"
    expect(text).toMatch(/Verificado por cumplimiento/); // ES cleared caption
    expect(text).not.toMatch(/Open in Messages/);
    // The cleared body itself is locale-independent (it is the rep's approved text).
    expect(text).toContain(CLEARED_BODY);
  });

  test('ES held renders the Spanish "catching up" hold, still text-free', () => {
    const html = renderLocale('es', { initialState: { phase: 'held', holdReason: 'NOT_CFE_CLEARED' } as ComposerSheetState });
    expect(textOf(html)).toMatch(/La verificación de cumplimiento se está poniendo al día/);
    expect(html).not.toContain(CLEARED_BODY);
    expect(html).not.toContain('sms:');
  });
});
