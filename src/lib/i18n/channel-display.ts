// T-57 RG6 (i18n; master-spec §17.5, uiux §6.2) — the "resolve a raw `MessageChannel` machine token
// to a localized DISPLAY string" primitive, the exact sibling of `error-display.ts`'s `errorDisplay`
// / `reason-display.ts`'s `reasonDisplay`, but for the `channel` enum column
// (`prisma/schema.prisma`'s `MessageChannel`: `SMS_HANDOFF | SMS_PLATFORM | EMAIL | SOCIAL_DM |
// IN_APP`) a few rep- and upline-facing surfaces splice straight into visible text
// (`ApprovalInboxItem.tsx`'s header chip + its own `draftToAria` label, `team/compliance-review/
// page.tsx`'s "To {name} · {channel}" line — see `scripts/guard-rendered-i18n-leak.mjs`'s
// `RENDERED_I18N_LEAK_BASELINE.json`, now closed to empty). Before this, a Spanish rep/upline saw
// the raw, merely de-snake-cased English token ("sms handoff") — never translated.
//
// UNKNOWN-TOKEN SAFETY NET: `channel` is a real Prisma enum (not a free-text column), but this
// module still falls back to a generic, always-localized `common.channel.generic` ("Message"/
// "Mensaje") for any value outside the known set — same fail-safe posture as `errorDisplay`'s
// `errors.generic` — so a future enum member never renders as a raw/English token before this
// module is taught about it.

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

const CHANNEL_CATALOG_KEY: Readonly<Record<string, string>> = {
  SMS_HANDOFF: 'common.channel.smsHandoff',
  SMS_PLATFORM: 'common.channel.smsPlatform',
  EMAIL: 'common.channel.email',
  SOCIAL_DM: 'common.channel.socialDm',
  IN_APP: 'common.channel.inApp',
};

/** Resolves a raw `MessageChannel` token to its localized display label. An unrecognized/future
 *  token falls back to a generic localized "Message" label, never the raw/humanized token. */
export function channelLabel(t: Translate, channel: string | null | undefined): string {
  if (!channel) return t('common.channel.generic');
  const key = CHANNEL_CATALOG_KEY[channel];
  return t(key ?? 'common.channel.generic');
}
