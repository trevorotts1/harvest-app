// T-55 (master-spec §17.7; uiux §5.6 "Nothing waiting" / "Flagged-empty" named states) —
// inboxEmptyStateMessage's per-filter copy. Before this fix, every filter (Awaiting/Held/Approved/
// Declined/All) showed the same "a good day" copy even where that framing didn't fit (e.g. an empty
// "Declined" or "Held" view).

import { inboxEmptyStateMessage } from '@/app/inbox/empty-state';

describe('inboxEmptyStateMessage — every filter names its own honest empty state (SC9)', () => {
  test('AWAITING and ALL keep the "good day" framing', () => {
    expect(inboxEmptyStateMessage('AWAITING')).toBe('Nothing waiting on you right now — a good day.');
    expect(inboxEmptyStateMessage('ALL')).toBe('Nothing waiting on you right now — a good day.');
  });

  test('HELD reads as a clean field, not an error', () => {
    expect(inboxEmptyStateMessage('HELD')).toBe("Nothing held for review — your field's been clean.");
  });

  test('DECLINED and APPROVED name their own honest zero-state', () => {
    expect(inboxEmptyStateMessage('DECLINED')).toBe('Nothing declined yet.');
    expect(inboxEmptyStateMessage('APPROVED')).toBe('Nothing approved yet — your first approval will show up here.');
  });

  test('every filter key returns a non-empty string — never throws, never blank', () => {
    for (const key of ['AWAITING', 'HELD', 'APPROVED', 'DECLINED', 'ALL'] as const) {
      const msg = inboxEmptyStateMessage(key);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});
