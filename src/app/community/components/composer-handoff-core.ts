// T-57 R3a (uiux §4.4 Composer Handoff Sheet / §4.3 fail-closed / §5.7 AC-5.7-1 / §6.3 parity) —
// the PURE, I/O-free core the `ComposerHandoffSheet` renders on. Kept separate from the component so
// the ONE invariant that matters here is a single testable function, not a claim buried in JSX:
//
//   FAIL-CLOSED (AC-4-3, master-spec §5.2/§18.6): the sheet may render compliance-cleared, sendable
//   text ONLY from a genuine `{ ok:true, payload:{ body, smsUri, ... } }` READY response returned by
//   the REAL `POST /api/messaging/compose-handoff` route (backed by FirstTouchComposerService, which
//   re-asserts CFE-clearance + human-approval + opt-out/quiet-hours server-side, deny-by-default).
//   Every other outcome — a 409 SEND_HELD (content HELD/BLOCKED/not-approved/opted-out), a 404, a
//   5xx, a network failure while the CFE is unreachable, or a malformed/spoofed 200 that lacks a real
//   string body — resolves to a NON-sendable view (`held`/`error`), NEVER to cleared text and NEVER
//   to an `sms:` deep link. There is no client-side path that fabricates the cleared body: it does
//   not exist in the browser until the server produces it.

/** The exact READY payload shape `FirstTouchComposerService.prepareHandoff` returns and the route
 *  forwards as `{ ok:true, payload, messageId }` (see
 *  src/services/messaging/send/first-touch-composer.service.ts `ComposerHandoffPayload`). */
export interface ComposerHandoffPayload {
  channel: 'FIRST_TOUCH_COMPOSER';
  to: string;
  body: string;
  smsUri: string;
  clearedAt: string;
  repOwnNumber: true;
}

/** The resolved, render-ready view. `ready` is the ONLY variant that carries sendable text. */
export type ComposerView =
  | { kind: 'ready'; body: string; smsUri: string; to: string; clearedAt: string; messageId: string }
  /** A compliance/availability hold — the CFE held/blocked the content, it is not approved, the
   *  recipient opted out / is in quiet hours, OR the clearance service could not be reached
   *  (`UNAVAILABLE`). NEVER carries text — the honest "catching up" state renders instead. */
  | { kind: 'held'; reason: string }
  /** The draft/message is genuinely gone (404) or the request was malformed (400). No text. */
  | { kind: 'error'; notFound: boolean };

/** A reason token the sheet renders when the clearance service itself could not be reached (network
 *  failure / 5xx) — distinct from a server-issued SEND_HELD reason, but rendered as the same honest,
 *  text-free "compliance check is catching up" hold (master-spec §5.2). */
export const CLEARANCE_UNAVAILABLE = 'UNAVAILABLE';

function isReadyOkBody(
  body: unknown
): body is { ok: true; messageId: string; payload: ComposerHandoffPayload } {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  if (b.ok !== true) return false;
  if (typeof b.messageId !== 'string' || b.messageId.length === 0) return false;
  const p = b.payload as Record<string, unknown> | undefined;
  if (typeof p !== 'object' || p === null) return false;
  // The two load-bearing, sendable fields MUST be real, non-empty strings — a spoofed/partial 200
  // with a missing or blank body can never resolve to `ready` (fail-closed, no fabricated text).
  if (typeof p.body !== 'string' || p.body.length === 0) return false;
  if (typeof p.smsUri !== 'string' || p.smsUri.length === 0) return false;
  return true;
}

function heldReasonFrom(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const b = body as Record<string, unknown>;
    if (typeof b.reason === 'string' && b.reason.length > 0) return b.reason;
  }
  return 'SEND_HELD';
}

/**
 * Map a `POST /api/messaging/compose-handoff` HTTP result to a render-ready view. This is the
 * fail-closed gate: `ready` (with text) is reachable ONLY through a genuine `ok:true` READY body on
 * a 200. Everything else is text-free.
 */
export function viewFromHandoffResponse(status: number, body: unknown): ComposerView {
  if (status === 200 && isReadyOkBody(body)) {
    const p = body.payload;
    return { kind: 'ready', body: p.body, smsUri: p.smsUri, to: p.to, clearedAt: p.clearedAt, messageId: body.messageId };
  }
  // 409 = the route's explicit fail-closed SEND_HELD (CFE held/blocked, not approved, opted out,
  // quiet hours). 5xx = the clearance service is down. Both → honest, text-free hold.
  if (status === 409) return { kind: 'held', reason: heldReasonFrom(body) };
  if (status >= 500) return { kind: 'held', reason: CLEARANCE_UNAVAILABLE };
  if (status === 404) return { kind: 'error', notFound: true };
  return { kind: 'error', notFound: false };
}

/** The fail-closed view for a thrown fetch (the CFE/clearance route was unreachable): a text-free
 *  hold, never an error that could be mistaken for "try a different message" — the content is fine,
 *  the check is catching up (master-spec §5.2). */
export const CLEARANCE_UNREACHABLE_VIEW: ComposerView = { kind: 'held', reason: CLEARANCE_UNAVAILABLE };

// ─────────────────────────────────────────────────────────────────────────────
// Platform detection (uiux §6.3 parity): mobile-web/native shell → Full (`sms:` one-tap); desktop →
// Degraded (send-to-phone + copy-with-attestation). Pure so it is unit-testable with no `navigator`.
// ─────────────────────────────────────────────────────────────────────────────

export type ComposerPlatform = 'mobile' | 'desktop';

/** Pure UA/touch heuristic. Mobile = a phone/tablet UA OR a coarse-pointer touch device (covers the
 *  iOS/Android native shell + mobile web, which get the full `sms:` path); everything else is
 *  desktop (degraded). Deliberately conservative: a false "desktop" only costs a rep the one-tap
 *  path (they still get copy + send-to-phone), never a broken `sms:` on a device that can't honor
 *  it. */
export function isMobileComposerPlatform(input: {
  userAgent?: string | null;
  maxTouchPoints?: number;
}): boolean {
  const ua = (input.userAgent ?? '').toLowerCase();
  if (/android|iphone|ipad|ipod|windows phone|blackberry|iemobile|opera mini|mobile/.test(ua)) return true;
  // iPadOS 13+ reports a desktop Safari UA but exposes touch points — treat a Mac-UA with real
  // touch points as a tablet (mobile) rather than a desktop.
  if (/macintosh/.test(ua) && (input.maxTouchPoints ?? 0) > 1) return true;
  return false;
}

/** Reads the live `navigator` (guarded for SSR/tests, where it is absent → `desktop`, the safe
 *  degraded default) and returns the platform. */
export function detectComposerPlatform(): ComposerPlatform {
  if (typeof navigator === 'undefined') return 'desktop';
  const mobile = isMobileComposerPlatform({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  });
  return mobile ? 'mobile' : 'desktop';
}
