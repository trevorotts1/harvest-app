// T-55 (master-spec §17.7 "every list has an empty state with one action") — PendingBridgesList's
// zero-item state. Before this fix, a quiet queue rendered "No pending bridge requests right now."
// with no next step at all.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import PendingBridgesList from '@/app/team/bridges/components/PendingBridgesList';
import type { PendingBridgeData } from '@/app/team/bridges/components/PendingBridgeItem';

const render = (items: PendingBridgeData[]) =>
  renderToStaticMarkup(createElement(PendingBridgesList, { items, onJoin: async () => ({ ok: true }) }));
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');

describe('PendingBridgesList — a quiet queue never renders blank or actionless (SC9, §17.7)', () => {
  test('zero items renders a narrative AND a next-step link back to the team dashboard', () => {
    const html = render([]);
    const text = textOf(html);
    expect(text).toContain('No pending bridge requests right now');
    expect(html).toContain('href="/team"');
  });

  test('populated items render every pending bridge and no empty-state narrative', () => {
    const items: PendingBridgeData[] = [
      { id: 'h1', repName: 'Jordan', triggerReason: 'BUYING_SIGNAL', invitedAt: '2026-07-14T10:00:00Z', returnDeadlineAt: '2026-07-15T10:00:00Z' },
    ];
    const html = render(items);
    const text = textOf(html);
    expect(text).toContain('Jordan');
    expect(text).not.toContain('No pending bridge requests right now');
  });

  test('never throws for empty or populated items', () => {
    expect(() => render([])).not.toThrow();
    expect(() =>
      render([{ id: 'h1', repName: 'A', triggerReason: 'MANUAL', invitedAt: '2026-07-14T10:00:00Z', returnDeadlineAt: '2026-07-15T10:00:00Z' }])
    ).not.toThrow();
  });
});
