// T-57 RG7 (i18n; master-spec §17.5, uiux §6.2/§16.5) — the "resolve a raw `LicensingState` machine
// token to a localized DISPLAY label" primitive, the exact sibling of the other token→display mappers
// (`error-display.ts`/`team-token-display.ts`/…). `grow/components/PhasedTimelinePanel.tsx` interpolated
// the raw `LicensingState` enum (`UNLICENSED | PRE_LICENSING | LICENSED | LICENSE_EXPIRED`, `src/types/
// licensing.ts`) straight into its insurance-hard-block messages — `t('…', { state: timeline.licensingState })`
// → "…until you are fully licensed (UNLICENSED)." A Spanish rep saw the raw English enum token inside an
// otherwise-translated compliance message. This maps each known state to a localized label; the message
// templates keep interpolating `{state}`, now with a translated value.
//
// UNKNOWN-TOKEN SAFETY NET: falls back to a generic, always-localized label for any value outside the
// known set — never the raw/English token — same fail-safe posture as the sibling mappers.

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

const LICENSING_STATE_CATALOG_KEY: Readonly<Record<string, string>> = {
  UNLICENSED: 'grow.phasedTimeline.licensingState.unlicensed',
  PRE_LICENSING: 'grow.phasedTimeline.licensingState.preLicensing',
  LICENSED: 'grow.phasedTimeline.licensingState.licensed',
  LICENSE_EXPIRED: 'grow.phasedTimeline.licensingState.licenseExpired',
};

/** Resolves a raw `LicensingState` token to its localized display label. An unrecognized/future token
 *  falls back to a generic localized label, never the raw/English token. */
export function licensingStateLabel(t: Translate, state: string | null | undefined): string {
  if (!state) return t('grow.phasedTimeline.licensingState.generic');
  const key = LICENSING_STATE_CATALOG_KEY[state];
  return t(key ?? 'grow.phasedTimeline.licensingState.generic');
}
