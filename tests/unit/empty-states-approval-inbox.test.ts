// T-55 (master-spec §17.7; uiux §5.6 "Nothing waiting" / "Flagged-empty" named states) —
// inboxEmptyStateMessage's per-filter copy. Before this fix, every filter (Awaiting/Held/Approved/
// Declined/All) showed the same "a good day" copy even where that framing didn't fit (e.g. an empty
// "Declined" or "Held" view).
//
// T-R32 (master-spec §17.5; uiux §6.2) — this copy lived as a raw hardcoded literal in a plain `.ts`
// module (invisible to `guard-no-literals-in-components.mjs`, which only walks `.tsx`). Now routed
// through the i18n catalog, keyed on an explicit `Locale` argument — proven here for BOTH EN
// (regression: byte-identical to the pre-T-R32 hardcoded strings) and ES (genuinely new coverage).

import { inboxEmptyStateMessage } from '@/app/inbox/empty-state';

describe('inboxEmptyStateMessage — every filter names its own honest empty state (SC9), EN', () => {
  test('AWAITING and ALL keep the "good day" framing', () => {
    expect(inboxEmptyStateMessage('AWAITING', 'en')).toBe('Nothing waiting on you right now — a good day.');
    expect(inboxEmptyStateMessage('ALL', 'en')).toBe('Nothing waiting on you right now — a good day.');
  });

  test('HELD reads as a clean field, not an error', () => {
    expect(inboxEmptyStateMessage('HELD', 'en')).toBe("Nothing held for review — your field's been clean.");
  });

  test('DECLINED and APPROVED name their own honest zero-state', () => {
    expect(inboxEmptyStateMessage('DECLINED', 'en')).toBe('Nothing declined yet.');
    expect(inboxEmptyStateMessage('APPROVED', 'en')).toBe('Nothing approved yet — your first approval will show up here.');
  });

  test('every filter key returns a non-empty string — never throws, never blank', () => {
    for (const key of ['AWAITING', 'HELD', 'APPROVED', 'DECLINED', 'ALL'] as const) {
      const msg = inboxEmptyStateMessage(key, 'en');
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});

describe('inboxEmptyStateMessage — ES (T-R32) — genuinely Spanish, never a silent EN fallback', () => {
  test('AWAITING and ALL keep the "good day" framing', () => {
    expect(inboxEmptyStateMessage('AWAITING', 'es')).toBe('No tienes nada pendiente en este momento — un buen día.');
    expect(inboxEmptyStateMessage('ALL', 'es')).toBe('No tienes nada pendiente en este momento — un buen día.');
  });

  test('HELD reads as a clean field, not an error', () => {
    expect(inboxEmptyStateMessage('HELD', 'es')).toBe('No hay nada retenido para revisión — tu campo ha estado limpio.');
  });

  test('DECLINED and APPROVED name their own honest zero-state', () => {
    expect(inboxEmptyStateMessage('DECLINED', 'es')).toBe('Nada rechazado todavía.');
    expect(inboxEmptyStateMessage('APPROVED', 'es')).toBe('Nada aprobado todavía — tu primera aprobación aparecerá aquí.');
  });

  test('every filter key returns a non-empty, EN-distinct string — never throws, never blank', () => {
    for (const key of ['AWAITING', 'HELD', 'APPROVED', 'DECLINED', 'ALL'] as const) {
      const msg = inboxEmptyStateMessage(key, 'es');
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toBe(inboxEmptyStateMessage(key, 'en'));
    }
  });
});
