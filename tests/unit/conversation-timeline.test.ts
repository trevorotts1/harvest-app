// T-39 (uiux §5.7 / §4.7) — the conversation-timeline UI proof. The timeline COMPOSES the agent-sent
// badge (§4.7, T-R16/T-R19 fold-in) and the three-way handoff card (§10.6), and renders the two send
// paths honestly + distinctly. Proves:
//   (f) every OUTBOUND agent entry renders "sent by your agent · approved by you [date]"; when the
//       send is linked to its CFE audit record (Message.cfe_audit_id) the badge shows the compliance-
//       record-linked note + carries the audit id; inbound replies carry NO badge.
//   send-path grammar: own-number → "sent from your number" + "handed off" (never a fake delivery
//       tick); platform → "from your Harvest number".
//   system entries: reply-paused cadence chip; the full-width do-not-contact opt-out rule.
//   the handoff card renders invited/joined (both chips)/returned-with-coaching.
//   token discipline: the T-39 conversation surface authored source has no raw hex (§1.2.2).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ConversationTimeline, { type TimelineEntry } from '@/app/community/components/ConversationTimeline';

const render = (entries: TimelineEntry[]) => renderToStaticMarkup(createElement(ConversationTimeline, { entries }));
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');

const TS = '2026-07-14T15:00:00Z';

const agentEntry: TimelineEntry = {
  kind: 'message',
  id: 'm-agent',
  direction: 'OUTBOUND',
  source: 'AGENT',
  channel: 'SMS_PLATFORM',
  sentFrom: 'platform_number',
  body: 'Warm hello from your agent.',
  timestamp: TS,
  deliveryStatus: 'queued',
  approvedBy: 'rep-1',
  approvedAt: TS,
  cfeAuditId: 'audit-abc-123',
};

describe('ConversationTimeline — the agent-sent badge + cfe_audit_id link (§4.7, proof f)', () => {
  test('an OUTBOUND agent entry renders the transparency badge with approval attribution', () => {
    const html = render([{ ...agentEntry, sentFrom: undefined }]);
    const text = textOf(html);
    expect(text).toContain('sent by your agent');
    expect(text).toContain('approved by you');
    expect(text).toContain('2026'); // the formatted approval date's year (tz-stable)
  });

  test('a send linked to its CFE audit record shows the compliance-record-linked note + carries the audit id', () => {
    const html = render([agentEntry]);
    expect(textOf(html)).toContain('compliance record linked');
    expect(html).toContain('data-cfe-audit="audit-abc-123"');
  });

  test('a send NOT linked to an audit record shows no compliance-record-linked note', () => {
    const html = render([{ ...agentEntry, cfeAuditId: null }]);
    expect(textOf(html)).not.toContain('compliance record linked');
  });

  test('an INBOUND reply carries NO agent badge', () => {
    const html = render([
      { kind: 'message', id: 'in-1', direction: 'INBOUND', source: 'REP', channel: 'SMS_PLATFORM', body: 'Sounds good!', timestamp: TS, deliveryStatus: 'delivered' },
    ]);
    const text = textOf(html);
    expect(text).not.toContain('sent by your agent');
    expect(text).not.toContain('approved by you');
  });
});

describe('ConversationTimeline — the two send paths are visible + distinct + honest (§5.7)', () => {
  test('own-number composer handoff renders "sent from your number" and the honest "handed off" status (no fake delivery tick)', () => {
    const html = render([
      { kind: 'message', id: 'h-1', direction: 'OUTBOUND', source: 'AGENT', channel: 'SMS_HANDOFF', sentFrom: 'rep_number', body: 'First touch.', timestamp: TS, deliveryStatus: 'HANDED_OFF', approvedBy: 'rep-1', approvedAt: TS },
    ]);
    const text = textOf(html);
    expect(text).toContain('sent from your number');
    expect(text).toContain('handed off');
    expect(text).not.toContain('delivered');
  });

  test('platform send renders "from your Harvest number"', () => {
    const html = render([agentEntry]);
    expect(textOf(html)).toContain('from your Harvest number');
  });

  test('a failed send stays in the stream as failed with a Retry affordance', () => {
    const html = render([{ ...agentEntry, deliveryStatus: 'FAILED' }]);
    const text = textOf(html);
    expect(text).toContain('failed');
    expect(text).toContain('Retry');
  });
});

describe('ConversationTimeline — three-way handoff card composed in the stream (§10.6)', () => {
  test('invited state announces the upline invitation', () => {
    const html = render([{ kind: 'handoff', id: 'hf-1', repName: 'Alex', uplineName: 'Dana', state: 'INVITED', timestamp: TS }]);
    expect(textOf(html)).toContain('Dana has been invited into this conversation');
  });

  test('joined state chips BOTH humans', () => {
    const html = render([{ kind: 'handoff', id: 'hf-2', repName: 'Alex', uplineName: 'Dana', state: 'JOINED', timestamp: TS }]);
    const text = textOf(html);
    expect(text).toContain('Dana joined the conversation');
    expect(text).toContain('Alex');
    expect(text).toContain('Dana');
  });

  test('returned state renders the labeled coaching next step', () => {
    const html = render([{ kind: 'handoff', id: 'hf-3', repName: 'Alex', uplineName: 'Dana', state: 'RETURNED', coachedNextStep: 'Pick it back up warmly.', timestamp: TS }]);
    const text = textOf(html);
    expect(text).toContain('Returned to you');
    expect(text).toContain('Coaching');
    expect(text).toContain('Pick it back up warmly.');
  });
});

describe('ConversationTimeline — system entries (§10.8 / §18.8)', () => {
  test('a reply-arrived chip announces the paused cadence', () => {
    const html = render([{ kind: 'system', id: 's-1', variant: 'reply-paused', contactName: 'Jamie', timestamp: TS }]);
    expect(textOf(html)).toContain('cadence is paused');
  });

  test('an opt-out entry renders the full-width do-not-contact rule', () => {
    const html = render([{ kind: 'system', id: 's-2', variant: 'opt-out', timestamp: TS }]);
    expect(textOf(html)).toContain('Do not contact');
    expect(textOf(html)).toContain('honored everywhere');
  });

  test('empty timeline renders the §5.7 empty state, never demo interactions', () => {
    const html = render([]);
    expect(textOf(html)).toContain('No introductions yet');
  });
});

// ─── Token discipline: no raw hex in the T-39 conversation surface (§1.2.2) ─────────────────────────
describe('T-39 conversation surface consumes T-05 tokens only — no raw hex', () => {
  const REPO_ROOT = path.join(__dirname, '..', '..');
  const files = [
    path.join(REPO_ROOT, 'src', 'app', 'community', 'conversation.module.css'),
    path.join(REPO_ROOT, 'src', 'app', 'community', 'components', 'ConversationTimeline.tsx'),
    path.join(REPO_ROOT, 'src', 'app', 'community', 'components', 'AgentSentBadge.tsx'),
    path.join(REPO_ROOT, 'src', 'app', 'community', 'components', 'ThreeWayHandoffCard.tsx'),
  ];

  test('sanity: the files exist', () => {
    for (const f of files) expect(statSync(f).isFile()).toBe(true);
    void readdirSync;
  });

  test.each(files.map((f) => [path.relative(REPO_ROOT, f), f]))('%s contains no raw hex color literal', (_rel, file) => {
    const src = readFileSync(file as string, 'utf8');
    const hexMatches = src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexMatches).toEqual([]);
  });
});
