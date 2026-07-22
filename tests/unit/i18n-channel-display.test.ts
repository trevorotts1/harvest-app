// T-57 RG6 (i18n; master-spec §17.5, uiux §6.2) — `channelLabel` (`src/lib/i18n/channel-display.ts`)
// is the display-mapper closing two `RENDERED_I18N_LEAK_BASELINE.json` entries
// (`ApprovalInboxItem.tsx`'s header chip + `draftToAria`, `team/compliance-review/page.tsx`'s "To
// {name} · {channel}" line) — the raw `MessageChannel` machine token used to render either merely
// de-snake-cased ("sms handoff") or spliced raw into an aria label. Proves every known enum value
// resolves to a genuinely distinct EN/ES string (not a silent EN fallback), and that an
// unknown/future token falls back to a generic, always-localized label — never the raw token.

import { t } from '@/lib/i18n/catalog';
import { channelLabel } from '@/lib/i18n/channel-display';

const translateEn = (key: string, vars?: Record<string, string | number>) => t('en', key, vars);
const translateEs = (key: string, vars?: Record<string, string | number>) => t('es', key, vars);

describe('channelLabel — MessageChannel token -> localized display string', () => {
  test.each(['SMS_HANDOFF', 'SMS_PLATFORM', 'EMAIL', 'SOCIAL_DM', 'IN_APP'])(
    'TEETH — %s resolves to a real, distinct EN/ES label, never the raw/humanized token',
    (channel) => {
      const en = channelLabel(translateEn, channel);
      const es = channelLabel(translateEs, channel);
      expect(en).not.toBe(channel);
      expect(en).not.toBe(channel.replaceAll('_', ' '));
      expect(es).not.toBe(channel);
      expect(en).not.toBe(es); // genuinely different copy, not a shared/fallback string
    }
  );

  test('specific known mappings (spot-check real idiomatic copy)', () => {
    expect(channelLabel(translateEn, 'SMS_HANDOFF')).toBe('Text (your number)');
    expect(channelLabel(translateEs, 'SMS_HANDOFF')).toBe('SMS (tu número)');
    expect(channelLabel(translateEn, 'EMAIL')).toBe('Email');
    expect(channelLabel(translateEs, 'EMAIL')).toBe('Correo electrónico');
    expect(channelLabel(translateEn, 'SOCIAL_DM')).toBe('Social DM');
    expect(channelLabel(translateEs, 'SOCIAL_DM')).toBe('DM social');
  });

  test('an unrecognized/future token falls back to a generic localized label, never the raw token', () => {
    expect(channelLabel(translateEn, 'CARRIER_PIGEON')).toBe('Message');
    expect(channelLabel(translateEs, 'CARRIER_PIGEON')).toBe('Mensaje');
  });

  test('null/undefined never crash and resolve to the same generic fallback', () => {
    expect(channelLabel(translateEn, null)).toBe('Message');
    expect(channelLabel(translateEn, undefined)).toBe('Message');
    expect(channelLabel(translateEs, null)).toBe('Mensaje');
  });
});
