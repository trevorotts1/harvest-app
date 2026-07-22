// T-57 RG7 close-out, DIMENSION A (WCAG 2.2 SC 4.1.3 "Status Messages"; uiux §6.1). The shared,
// live-region-by-construction status/error text element. A screen-reader user must be TOLD when an
// async state changes (a page failed to load, a save failed) — but the whole "page-failed-to-load"
// class was rendering `<p>{t('…failed')}</p>` with no ARIA live region, invisible to
// `guard-status-live-region.mjs` because its child is a `{t('…')}` call the guard used to skip.
//
// The durable fix is STRUCTURAL, not another manual sweep: route every failed-state text through this
// one component. It always emits `role="alert"` (assertive) or `role="status"` (polite) plus a
// matching `aria-live`, and `guard-status-live-region.mjs` KNOWS this component announces
// (`LIVE_REGION_COMPONENTS`), so any error-branch text NOT wrapped in it (or in an explicit
// role/aria-live element) fails the guard. That makes the class enumerable and non-recurring: you
// cannot add a new un-announced failed state without the guard catching it.
//
// TONE (uiux §6.1 / the A8 note): `assertive` (role="alert") for hard failures — a whole surface
// failed to load, a mutation was rejected — which is the DEFAULT here because that is what these
// close-out sites are; `polite` (role="status") for graceful, non-blocking notices. role="alert"
// already implies an assertive live region; `aria-live` is set explicitly too so the announcement
// intent is unambiguous across AT implementations.
//
// The live-region attributes are applied AFTER the caller's props are spread, so a `<StatusMessage>`
// can never accidentally have its announcement stripped by a stray `role`/`aria-live` prop — the
// structural guarantee the guard relies on holds no matter how it's called.

import { type HTMLAttributes, type ReactNode } from 'react';

export type StatusMessageTone = 'assertive' | 'polite';

export interface StatusMessageProps extends HTMLAttributes<HTMLParagraphElement> {
  children: ReactNode;
  /** `assertive` (role="alert", default) for hard failures/compliance holds; `polite` (role="status")
   *  for graceful, non-blocking notices. */
  tone?: StatusMessageTone;
}

export function StatusMessage({ children, tone = 'assertive', ...rest }: StatusMessageProps) {
  const role = tone === 'assertive' ? 'alert' : 'status';
  const ariaLive = tone === 'assertive' ? 'assertive' : 'polite';
  return (
    <p {...rest} role={role} aria-live={ariaLive}>
      {children}
    </p>
  );
}

export default StatusMessage;
