// T-57 R3a — the PURE fail-closed core of the Composer Handoff Sheet (uiux §4.4/§4.3 AC-4-3,
// master-spec §5.2). `viewFromHandoffResponse` is the single gate that decides whether the sheet may
// render compliance-cleared, sendable text: it may ONLY for a genuine `{ ok:true, payload:{ body,
// smsUri, … } }` READY response on a 200 from the REAL `POST /api/messaging/compose-handoff` route.
// Every other outcome — a 409 SEND_HELD (content held/blocked/not-approved/opted-out), a 5xx while
// the CFE is down, a 404, a 400, or a spoofed/partial 200 that lacks a real string body — resolves
// to a text-free view. This suite is the machine-checkable proof of that invariant.

import {
  viewFromHandoffResponse,
  isMobileComposerPlatform,
  CLEARANCE_UNAVAILABLE,
  type ComposerView,
} from '@/app/community/components/composer-handoff-core';

/** The exact READY body the route returns (mirrors FirstTouchComposerService.ComposerHandoffPayload
 *  + the route's `{ ok:true, payload, messageId }` envelope). */
const READY_BODY = {
  ok: true,
  messageId: 'm-1',
  payload: {
    channel: 'FIRST_TOUCH_COMPOSER',
    to: '+15551234567',
    body: 'Hi Jordan — it has been too long. Would love to catch up.',
    smsUri: 'sms:+15551234567?body=Hi%20Jordan',
    clearedAt: '2026-07-20T15:00:00.000Z',
    repOwnNumber: true,
  },
};

/** True iff this view carries sendable, compliance-cleared text. */
function carriesClearedText(v: ComposerView): boolean {
  return v.kind === 'ready';
}

describe('viewFromHandoffResponse — READY is the ONLY path to sendable text', () => {
  test('a genuine 200 READY response yields the cleared body + sms deep link', () => {
    const v = viewFromHandoffResponse(200, READY_BODY);
    expect(v.kind).toBe('ready');
    if (v.kind === 'ready') {
      expect(v.body).toBe(READY_BODY.payload.body);
      expect(v.smsUri).toBe(READY_BODY.payload.smsUri);
      expect(v.to).toBe('+15551234567');
      expect(v.messageId).toBe('m-1');
    }
  });

  // ══ THE BREAK-IT TEST (pure) — AC-4-3 ══
  // Every fail-closed outcome the route can produce must resolve to a NON-`ready` view: no body, no
  // smsUri, nothing sendable. TEETH: fails the instant any of these starts yielding `ready`.
  describe('BREAK-IT: no non-READY outcome ever carries cleared text', () => {
    const heldReasons = [
      'NOT_CFE_CLEARED', // the CFE held/blocked the content (or never released it)
      'NOT_APPROVED', // approval always precedes send (§2.3)
      'EDITED_AFTER_APPROVAL',
      'CHANNEL_MISMATCH',
      'OPTED_OUT',
      'QUIET_HOURS',
      'ERROR', // deny-by-default: any unexpected server error
    ];
    test.each(heldReasons)('409 SEND_HELD reason=%s -> held, NO cleared text', (reason) => {
      const v = viewFromHandoffResponse(409, { error: 'This first touch is held — nothing was lost.', code: 'SEND_HELD', reason });
      expect(v.kind).toBe('held');
      expect(carriesClearedText(v)).toBe(false);
      expect(v).not.toHaveProperty('body');
      expect(v).not.toHaveProperty('smsUri');
      if (v.kind === 'held') expect(v.reason).toBe(reason);
    });

    test('a 5xx (CFE/clearance service down) -> held UNAVAILABLE, NO cleared text', () => {
      const v = viewFromHandoffResponse(500, { error: 'boom' });
      expect(v.kind).toBe('held');
      if (v.kind === 'held') expect(v.reason).toBe(CLEARANCE_UNAVAILABLE);
      expect(carriesClearedText(v)).toBe(false);
    });

    test('a 409 with NO reason field still holds (defaults to SEND_HELD), never text', () => {
      const v = viewFromHandoffResponse(409, {});
      expect(v.kind).toBe('held');
      expect(carriesClearedText(v)).toBe(false);
    });

    test('a 404 (draft gone) -> error notFound, NO cleared text', () => {
      const v = viewFromHandoffResponse(404, { error: 'Draft not found' });
      expect(v).toEqual({ kind: 'error', notFound: true });
    });

    test('a 400 (bad request) -> error, NO cleared text', () => {
      const v = viewFromHandoffResponse(400, { error: 'bad' });
      expect(v).toEqual({ kind: 'error', notFound: false });
    });

    // A FABRICATED/partial 200 must NOT be trusted — the false-green class this build must avoid.
    test('a spoofed 200 with ok:true but NO payload body -> NOT ready (fail-closed)', () => {
      const v = viewFromHandoffResponse(200, { ok: true, messageId: 'm-x', payload: { to: '+1555', smsUri: 'sms:+1555' } });
      expect(v.kind).not.toBe('ready');
      expect(carriesClearedText(v)).toBe(false);
    });

    test('a spoofed 200 with an EMPTY-string body -> NOT ready', () => {
      const v = viewFromHandoffResponse(200, { ...READY_BODY, payload: { ...READY_BODY.payload, body: '' } });
      expect(v.kind).not.toBe('ready');
    });

    test('a spoofed 200 with a missing smsUri -> NOT ready', () => {
      const p = { ...READY_BODY.payload } as Record<string, unknown>;
      delete p.smsUri;
      const v = viewFromHandoffResponse(200, { ok: true, messageId: 'm', payload: p });
      expect(v.kind).not.toBe('ready');
    });

    test('a 200 with ok:false -> NOT ready', () => {
      const v = viewFromHandoffResponse(200, { ok: false });
      expect(v.kind).not.toBe('ready');
    });

    test('a 200 with a null/garbage body -> NOT ready', () => {
      expect(viewFromHandoffResponse(200, null).kind).not.toBe('ready');
      expect(viewFromHandoffResponse(200, 'nope').kind).not.toBe('ready');
    });
  });
});

describe('isMobileComposerPlatform — parity §6.3 (mobile = Full sms:, desktop = Degraded)', () => {
  test('an iPhone UA is mobile', () => {
    expect(isMobileComposerPlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })).toBe(true);
  });
  test('an Android UA is mobile', () => {
    expect(isMobileComposerPlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' })).toBe(true);
  });
  test('a desktop Chrome UA is NOT mobile (degraded)', () => {
    expect(isMobileComposerPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', maxTouchPoints: 0 })).toBe(false);
  });
  test('a Mac desktop UA with no touch is NOT mobile', () => {
    expect(isMobileComposerPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 })).toBe(false);
  });
  test('iPadOS 13+ (desktop Mac UA but real touch points) IS treated as mobile', () => {
    expect(isMobileComposerPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 })).toBe(true);
  });
  test('an empty/absent UA is NOT mobile (safe degraded default)', () => {
    expect(isMobileComposerPlatform({ userAgent: '' })).toBe(false);
    expect(isMobileComposerPlatform({ userAgent: null })).toBe(false);
    expect(isMobileComposerPlatform({})).toBe(false);
  });
});
