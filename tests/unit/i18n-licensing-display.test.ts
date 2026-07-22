// T-57 RG7 (i18n; master-spec §17.5, uiux §6.2/§16.5) — `licensingStateLabel`
// (`src/lib/i18n/licensing-display.ts`) closing the `grow/components/PhasedTimelinePanel.tsx` leak the
// hardened `guard-rendered-i18n-leak.mjs` (blind-spot a: a `State` suffix) surfaced: the raw
// `LicensingState` enum interpolated into an otherwise-translated insurance-hard-block message. Proves
// every known state resolves to a genuinely distinct EN/ES label and an unknown/future token falls
// back to a generic, always-localized label — never the raw English token.

import { t } from '@/lib/i18n/catalog';
import { licensingStateLabel } from '@/lib/i18n/licensing-display';

const translateEn = (key: string, vars?: Record<string, string | number>) => t('en', key, vars);
const translateEs = (key: string, vars?: Record<string, string | number>) => t('es', key, vars);

describe('licensingStateLabel — LicensingState (grow/components/PhasedTimelinePanel.tsx)', () => {
  test.each(['UNLICENSED', 'PRE_LICENSING', 'LICENSED', 'LICENSE_EXPIRED'])(
    'TEETH — %s resolves to a real, distinct EN/ES label, never the raw enum token',
    (state) => {
      const en = licensingStateLabel(translateEn, state);
      const es = licensingStateLabel(translateEs, state);
      expect(en).not.toBe(state);
      expect(es).not.toBe(state);
      expect(en).not.toBe(es);
    }
  );

  test('interpolated into the hard-block message, an es rep never sees the raw English enum token', () => {
    const msg = translateEs('grow.phasedTimeline.hardBlockTemplate', {
      state: licensingStateLabel(translateEs, 'UNLICENSED'),
    });
    expect(msg).not.toContain('UNLICENSED');
    expect(msg).toContain('sin licencia');
  });

  test('null/unrecognized falls back to a generic localized label', () => {
    expect(licensingStateLabel(translateEn, null)).toBe('your current licensing status');
    expect(licensingStateLabel(translateEs, 'SOME_FUTURE_STATE')).toBe('tu estado de licencia actual');
  });
});
