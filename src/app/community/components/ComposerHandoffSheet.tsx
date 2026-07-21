// T-57 R3a (uiux §4.4 Composer Handoff Sheet; §5.7 AC-5.7-1; §4.3 fail-closed AC-4-3; §6.3 parity;
// master-spec §10.1 first-touch composer handoff / locked decision #2) — the first-touch composer
// handoff surface. Its backend (FirstTouchComposerService + POST /api/messaging/compose-handoff
// (+/confirm)) shipped with ZERO frontend; this is that frontend, wired to those REAL routes.
//
// THE FLOW (AC-5.7-1): CFE clearance → sheet shows the cleared text → the rep taps send (an `sms:`
// one-tap deep link on mobile / copy-with-attestation on desktop) → one-tap "Did it send?"
// confirmation → the message is recorded/badged as sent-from-the-rep's-own-number. The app NEVER
// claims to have sent it (§4.4 honesty rule) — the rep sends in Messages; we record the handoff.
//
// FAIL-CLOSED (AC-4-3, master-spec §5.2): opening the sheet does NOT hand it pre-cleared text as a
// prop. Instead, opening triggers `POST /api/messaging/compose-handoff` and renders sendable text
// ONLY when that route returns a genuine READY payload (server-side CFE-cleared + human-approved +
// opt-out/quiet-hours-checked). If the CFE is unavailable, or the content is HELD/BLOCKED/not
// approved / opted out, the route does not return text — and the sheet renders the honest "catching
// up" hold state with NO `sms:` link and NO cleared body. The cleared text does not exist in the
// browser until the server produces it (see `./composer-handoff-core.ts` for the single mapping fn
// that enforces this, unit-tested independently).

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useLocale } from '@/app/locale-context';
import { formatDateTime } from '@/lib/i18n/format';
import AgentSentBadge from './AgentSentBadge';
import {
  CLEARANCE_UNAVAILABLE,
  detectComposerPlatform,
  viewFromHandoffResponse,
  type ComposerPlatform,
} from './composer-handoff-core';
import styles from './ComposerHandoffSheet.module.css';

/** The sheet's internal render state. `ready` is the ONLY phase that holds sendable text/`smsUri`;
 *  it is reachable only by the fetch effect resolving a genuine READY response (or a test seed). */
export interface ComposerSheetState {
  phase: 'loading' | 'ready' | 'held' | 'error' | 'awaitingConfirm' | 'confirmed' | 'declined';
  /** Present only in `ready` / `awaitingConfirm` / `confirmed` / `declined` (once the server cleared it). */
  cleared?: { body: string; smsUri: string; to: string; clearedAt: string };
  messageId?: string;
  holdReason?: string;
  notFound?: boolean;
}

export interface ComposerHandoffSheetProps {
  open: boolean;
  /** The CFE-cleared, human-approved first-touch DraftMessage id to hand off (the ONLY thing the
   *  real route needs). `null` while an entry point is still resolving it — the sheet stays closed. */
  draftId: string | null;
  /** For the header + accessible names (first-name + last-initial, §9.5). */
  contactName: string;
  onClose: () => void;
  /** Fired once the rep confirms "I sent it" (the message is recorded handoff_confirmed) — lets an
   *  entry point refresh its own view (e.g. mark a First-48 goal contacted). */
  onConfirmed?: () => void;
  /** Test/native-shell override for platform detection (§6.3). Omitted in normal web use → detected. */
  platformOverride?: ComposerPlatform;
  /** Test-only seam: seed the internal state so a `renderToStaticMarkup` (no-effects, node) test can
   *  exercise any phase deterministically. Never passed in production (the fetch effect drives it). */
  initialState?: ComposerSheetState;
}

export default function ComposerHandoffSheet({
  open,
  draftId,
  contactName,
  onClose,
  onConfirmed,
  platformOverride,
  initialState,
}: ComposerHandoffSheetProps) {
  const { locale, t } = useLocale();
  const seeded = useRef(initialState !== undefined);
  const [state, setState] = useState<ComposerSheetState>(() => initialState ?? { phase: 'loading' });
  const [platform, setPlatform] = useState<ComposerPlatform>(platformOverride ?? 'desktop');
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Platform is detected post-mount (navigator is absent in SSR/tests) — by the time a `ready` state
  // exists (after the async clearance round-trip), the correct variant is already resolved.
  useEffect(() => {
    if (!platformOverride) setPlatform(detectComposerPlatform());
  }, [platformOverride]);

  // FAIL-CLOSED clearance fetch. Runs when the sheet opens for a draft. It NEVER renders text on its
  // own — it hands the HTTP result to `viewFromHandoffResponse`, which yields sendable text only for
  // a genuine READY response. A thrown fetch (CFE/route unreachable) is mapped to the honest hold.
  useEffect(() => {
    if (!open || !draftId) return;
    if (seeded.current) {
      // A seeded initial state (tests) is authoritative — never overwrite it with a live fetch.
      seeded.current = false;
      return;
    }
    let cancelled = false;
    setState({ phase: 'loading' });
    setConfirmError(null);
    setCopied(false);
    (async () => {
      try {
        const res = await fetch('/api/messaging/compose-handoff', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ draftId }),
        });
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        if (cancelled) return;
        const view = viewFromHandoffResponse(res.status, body);
        if (view.kind === 'ready') {
          setState({
            phase: 'ready',
            cleared: { body: view.body, smsUri: view.smsUri, to: view.to, clearedAt: view.clearedAt },
            messageId: view.messageId,
          });
        } else if (view.kind === 'held') {
          setState({ phase: 'held', holdReason: view.reason });
        } else {
          setState({ phase: 'error', notFound: view.notFound });
        }
      } catch {
        // Fail-closed: the CFE/clearance route was unreachable → honest, text-free hold.
        if (!cancelled) setState({ phase: 'held', holdReason: CLEARANCE_UNAVAILABLE });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, draftId]);

  const confirmSend = useCallback(
    async (sent: boolean) => {
      const messageId = state.messageId;
      if (!messageId) return;
      setBusy(true);
      setConfirmError(null);
      try {
        const res = await fetch('/api/messaging/compose-handoff/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messageId, sent }),
        });
        const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        setBusy(false);
        if (!res.ok || !data?.ok) {
          setConfirmError(t('composer.confirmError'));
          return;
        }
        setState((s) => ({ ...s, phase: sent ? 'confirmed' : 'declined' }));
        if (sent) onConfirmed?.();
      } catch {
        setBusy(false);
        setConfirmError(t('composer.confirmError'));
      }
    },
    [state.messageId, t, onConfirmed]
  );

  const handleCopy = useCallback(async () => {
    const body = state.cleared?.body;
    if (!body) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(body);
      }
      setCopied(true);
    } catch {
      // Clipboard blocked (permissions) — the text is still visible and selectable in the bubble.
      setCopied(true);
    }
    setState((s) => (s.phase === 'ready' ? { ...s, phase: 'awaitingConfirm' } : s));
  }, [state.cleared]);

  const handleOpenInMessages = useCallback(() => {
    // The `<a href="sms:…">` navigation opens the native Messages composer; we advance to the
    // "Did it send?" confirmation so the return lands on the one-tap confirm (§4.4 return handling).
    setState((s) => (s.phase === 'ready' ? { ...s, phase: 'awaitingConfirm' } : s));
  }, []);

  if (!open) return null;

  const clearedTime = state.cleared ? formatDateTime(locale, state.cleared.clearedAt) : '';

  return (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={t('composer.dialogAria', { name: contactName })}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div>
            <p className={styles.title}>{t('composer.title')}</p>
            <p className={styles.subtitle}>{t('composer.contextLine', { name: contactName })}</p>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label={t('composer.closeAria')}>
            <span aria-hidden="true">×</span>
          </button>
        </div>

        {/* LOADING — an honest narrative, never a bare spinner, and NEVER any sendable text (§4.3). */}
        {state.phase === 'loading' && (
          <p className={styles.loading} role="status">
            {t('composer.loading')}
          </p>
        )}

        {/* HELD — the fail-closed compliance/availability hold (AC-4-3): NO cleared text, NO `sms:`. */}
        {state.phase === 'held' && (
          <div className={styles.held} role="status">
            <p className={styles.heldTitle}>
              <span aria-hidden="true" className={styles.heldIcon}>
                🛡
              </span>{' '}
              {state.holdReason === 'OPTED_OUT'
                ? t('composer.heldOptedOutTitle')
                : t('composer.heldTitle')}
            </p>
            <p className={styles.heldBody}>
              {state.holdReason === 'OPTED_OUT'
                ? t('composer.heldOptedOutBody', { name: contactName })
                : state.holdReason === CLEARANCE_UNAVAILABLE
                  ? t('composer.heldUnavailableBody')
                  : t('composer.heldBody')}
            </p>
            <p className={styles.heldReassure}>{t('composer.heldReassure')}</p>
            <div className={styles.actionRow}>
              <button type="button" className={styles.tertiaryBtn} onClick={onClose}>
                {t('composer.notNow')}
              </button>
            </div>
          </div>
        )}

        {/* ERROR — the draft is genuinely gone / the request was malformed. No text. */}
        {state.phase === 'error' && (
          <div className={styles.held} role="alert">
            <p className={styles.heldTitle}>{t('composer.errorTitle')}</p>
            <p className={styles.heldBody}>
              {state.notFound ? t('composer.notFoundBody') : t('composer.errorBody')}
            </p>
            <div className={styles.actionRow}>
              <button type="button" className={styles.tertiaryBtn} onClick={onClose}>
                {t('composer.notNow')}
              </button>
            </div>
          </div>
        )}

        {/* READY / AWAITING-CONFIRM — the ONLY phases that render the cleared bubble + send/confirm. */}
        {(state.phase === 'ready' || state.phase === 'awaitingConfirm') && state.cleared && (
          <div className={styles.readyRegion}>
            <p className={styles.recipient}>{t('composer.recipientLabel', { name: contactName })}</p>
            <div
              className={styles.bubble}
              aria-label={t('composer.messagePreviewAria', { name: contactName })}
              role="note"
            >
              {state.cleared.body}
            </div>
            <p className={styles.clearedCaption}>
              <span aria-hidden="true" className={styles.leafCheck}>
                🌿
              </span>{' '}
              {t('composer.clearedCaption', { time: clearedTime })}
            </p>
            <p className={styles.attestation}>{t('composer.attestation')}</p>

            {state.phase === 'ready' && (
              <div className={styles.actionRow}>
                {platform === 'mobile' ? (
                  <a
                    className={styles.primaryBtn}
                    href={state.cleared.smsUri}
                    onClick={handleOpenInMessages}
                    data-testid="composer-sms-link"
                  >
                    {t('composer.openInMessages')}
                  </a>
                ) : (
                  <>
                    <button type="button" className={styles.primaryBtn} onClick={handleCopy}>
                      {copied ? t('composer.copied') : t('composer.copyText')}
                    </button>
                    <p className={styles.desktopNote}>{t('composer.desktopSendFromPhone')}</p>
                  </>
                )}
                <button type="button" className={styles.tertiaryBtn} onClick={onClose}>
                  {t('composer.notNow')}
                </button>
              </div>
            )}

            {state.phase === 'awaitingConfirm' && (
              <div className={styles.confirmRegion}>
                <p className={styles.confirmPrompt}>{t('composer.didItSend')}</p>
                {confirmError && (
                  <p className={styles.confirmError} role="alert">
                    {confirmError}
                  </p>
                )}
                <div className={styles.actionRow}>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={() => confirmSend(true)}
                    disabled={busy}
                  >
                    {busy ? t('composer.confirmBusy') : t('composer.iSentIt')}
                  </button>
                  <button
                    type="button"
                    className={styles.tertiaryBtn}
                    onClick={() => confirmSend(false)}
                    disabled={busy}
                  >
                    {t('composer.iDidntSend')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* CONFIRMED — the honest sent-from-your-number badge (never a fabricated "delivered"). */}
        {state.phase === 'confirmed' && (
          <div className={styles.outcome} role="status">
            <p className={styles.outcomeTitle}>
              <span aria-hidden="true">🌱</span> {t('composer.confirmedTitle')}
            </p>
            <p className={styles.outcomeBody}>{t('composer.confirmedBody', { name: contactName })}</p>
            <AgentSentBadge source="REP" sentFrom="rep_number" />
            <div className={styles.actionRow}>
              <button type="button" className={styles.primaryBtn} onClick={onClose}>
                {t('composer.done')}
              </button>
            </div>
          </div>
        )}

        {/* DECLINED — no shame copy; the first touch returns to the queue (§4.4). */}
        {state.phase === 'declined' && (
          <div className={styles.outcome} role="status">
            <p className={styles.outcomeTitle}>{t('composer.declinedTitle')}</p>
            <p className={styles.outcomeBody}>{t('composer.declinedBody')}</p>
            <div className={styles.actionRow}>
              <button type="button" className={styles.primaryBtn} onClick={onClose}>
                {t('composer.done')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
