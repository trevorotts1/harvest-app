// T-57 R3c-2 (findings M5; master-spec §10.8/§18.8, TCPA — compliance-critical). Before this fix,
// `ConversationTimeline.tsx`'s `'opt-out'` system entry was DISPLAY-ONLY (it only ever appeared
// AFTER `Contact.do_not_contact` was already `true` server-side) — there was no affordance anywhere
// to actually mark a contact opted out from the timeline, despite the spec's explicit "the rep marks
// it in-app one tap from the timeline" requirement. Proves:
//   (a) the one-tap control is reachable directly from the timeline (rendered, present/absent by
//       `contactId`/`doNotContact`), with NO messages required (a STOP can precede any tracked send).
//   (b) it is wired to the REAL, verified `POST /api/compliance/opt-out` contract — exact body shape
//       `{ contactId, reason: 'manual' }` — the only rep-selectable reason this action legitimately
//       asserts (never `'stop_reply'`, which is the inbound-webhook's own derived reason).
//   (c) suppression is HONORED, not just recorded: on success it ALSO PATCHes the existing
//       `/api/contacts/controls` route (`doNotContact: true`) — the same flag `agent-runtime.ts`
//       already reads to halt a per-contact run immediately — and only declares "confirmed" after
//       asking the caller-supplied `onOptOutConfirm` to re-fetch and confirm the FRESH state; a
//       failure at any step never silently reports success.
//   (d) the contact-detail page wires `contactId`/`doNotContact`/`onOptOutConfirm` from its own
//       real, session-gated conversation read.
//
// Because this repo's Jest env has no jsdom (`testEnvironment: 'node'`, jest.config.js), there is no
// way to simulate a real click and observe the resulting fetch sequence the way a browser test would
// — the SAME constraint `tests/unit/composer-handoff-wiring.test.ts` already documents and solves
// for its own onClick-triggered fetch flows. This suite follows that EXACT established convention:
// structural source-scan proofs for the click-triggered fetch sequencing, and real
// `renderToStaticMarkup` proofs for everything that is a function of props (conditional rendering).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ConversationTimeline, { type TimelineEntry } from '@/app/community/components/ConversationTimeline';

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(ConversationTimeline as never, props));

describe('ConversationTimeline — the one-tap STOP/opt-out action is wired to the REAL verified contract', () => {
  const src = read('app/community/components/ConversationTimeline.tsx');

  test('POSTs to the real /api/compliance/opt-out route', () => {
    expect(src).toMatch(/fetch\('\/api\/compliance\/opt-out',/);
  });

  test('sends exactly the real contract shape — contactId + reason "manual" (never "stop_reply", the inbound webhook\'s own derived reason)', () => {
    expect(src).toMatch(/body:\s*JSON\.stringify\(\{\s*contactId,\s*reason:\s*'manual'\s*\}\)/);
    expect(src).not.toMatch(/reason:\s*'stop_reply'/);
  });

  test('fails closed on a non-ok /api/compliance/opt-out response — never proceeds to the follow-up PATCH', () => {
    // The `!optOutRes.ok` early-return must appear BEFORE the controls PATCH call in source order.
    const optOutCheckIdx = src.indexOf('!optOutRes.ok');
    const controlsPatchIdx = src.indexOf("fetch('/api/contacts/controls'");
    expect(optOutCheckIdx).toBeGreaterThan(-1);
    expect(controlsPatchIdx).toBeGreaterThan(-1);
    expect(optOutCheckIdx).toBeLessThan(controlsPatchIdx);
  });

  test('also fails closed on an unexpected response body (optedOut !== true) before ever PATCHing controls', () => {
    const optedOutCheckIdx = src.indexOf('!optedOut');
    const controlsPatchIdx = src.indexOf("fetch('/api/contacts/controls'");
    expect(optedOutCheckIdx).toBeGreaterThan(-1);
    expect(optedOutCheckIdx).toBeLessThan(controlsPatchIdx);
  });

  test('belt-and-suspenders: on success, ALSO PATCHes /api/contacts/controls with doNotContact:true (the flag agent-runtime.ts already halts on)', () => {
    expect(src).toMatch(/fetch\('\/api\/contacts\/controls',/);
    expect(src).toMatch(/body:\s*JSON\.stringify\(\{\s*contactId,\s*doNotContact:\s*true\s*\}\)/);
  });

  test('never declares "confirmed" off the mutation responses alone — awaits the caller-supplied re-fetch confirmation first', () => {
    const controlsPatchIdx = src.indexOf("fetch('/api/contacts/controls'");
    const confirmCallIdx = src.indexOf('onOptOutConfirm ?');
    const setConfirmedIdx = src.indexOf("setStatus(confirmed ? 'confirmed'");
    expect(confirmCallIdx).toBeGreaterThan(controlsPatchIdx);
    expect(setConfirmedIdx).toBeGreaterThan(confirmCallIdx);
  });

  test('a thrown error (e.g. offline) anywhere in the sequence resolves to the error state, never confirmed', () => {
    expect(src).toMatch(/catch\s*\{\s*setStatus\('error'\);/);
  });
});

describe('ConversationTimeline — the control is reachable directly from the timeline, no message required', () => {
  test('renders with ZERO entries (a STOP can precede any tracked send) when contactId is given and not yet opted out', () => {
    const html = render({ entries: [], contactId: 'c-1', doNotContact: false });
    expect(textOf(html)).toContain('Mark opted out (STOP)');
  });

  test('renders alongside real entries too', () => {
    const entries: TimelineEntry[] = [
      { kind: 'system', id: 's-1', variant: 'reply-paused', contactName: 'Jamie', timestamp: '2026-07-14T15:00:00Z' },
    ];
    const html = render({ entries, contactId: 'c-1', doNotContact: false });
    expect(textOf(html)).toContain('Mark opted out (STOP)');
    expect(textOf(html)).toContain('cadence is paused');
  });

  test('is ABSENT once doNotContact is already true — the existing informational rule covers it instead', () => {
    const entries: TimelineEntry[] = [{ kind: 'system', id: 's-2', variant: 'opt-out', timestamp: '2026-07-14T15:00:00Z' }];
    const html = render({ entries, contactId: 'c-1', doNotContact: true });
    const text = textOf(html);
    expect(text).not.toContain('Mark opted out (STOP)');
    expect(text).toContain('Do not contact');
  });

  test('is ABSENT when no contactId is supplied (every pre-existing caller/test in this suite) — never a crash, never a fetch with no target', () => {
    const html = render({ entries: [] });
    expect(textOf(html)).not.toContain('Mark opted out (STOP)');
  });

  test('genuine ES rendering of the action prompt/button', () => {
    const { createElement: h } = require('react') as typeof import('react');
    const { LocaleContext } = require('@/app/locale-context') as typeof import('@/app/locale-context');
    const { t } = require('@/lib/i18n/catalog') as typeof import('@/lib/i18n/catalog');
    const html = renderToStaticMarkup(
      h(
        LocaleContext.Provider,
        { value: { locale: 'es', setLocale: () => {}, t: (key: string, vars?: Record<string, string | number>) => t('es', key, vars) } },
        h(ConversationTimeline as never, { entries: [], contactId: 'c-1', doNotContact: false } as never)
      )
    );
    expect(textOf(html)).toContain('Marcar como dado de baja (STOP)');
  });
});

describe('community/[contactId]/page.tsx — wires contactId/doNotContact/onOptOutConfirm from the real conversation read', () => {
  const src = read('app/community/[contactId]/page.tsx');

  test('passes contactId and doNotContact straight from the canonical fetched contact', () => {
    expect(src).toMatch(/contactId=\{contact\.id\}/);
    expect(src).toMatch(/doNotContact=\{contact\.doNotContact\}/);
  });

  test('onOptOutConfirm re-fetches (via the SAME load()) and resolves the FRESH doNotContact value — never a client-side assumption', () => {
    expect(src).toMatch(/onOptOutConfirm=\{confirmOptOut\}/);
    expect(src).toMatch(/const confirmOptOut = useCallback\(async \(\): Promise<boolean> => \{/);
    expect(src).toMatch(/const fresh = await load\(\);/);
    expect(src).toMatch(/return Boolean\(fresh\?\.doNotContact\);/);
  });
});
