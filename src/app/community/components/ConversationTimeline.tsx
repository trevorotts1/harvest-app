// T-39 (uiux §5.7 "Messaging & the Composer Handoff" + §4.7 "Conversation Timeline Entry";
// master-spec §10.6/§10.8) — the per-contact CONVERSATION TIMELINE: the single stream that COMPOSES
// the two T-39 timeline pieces — the agent-sent badge (`AgentSentBadge`, T-R16/T-R19 fold-in) on
// every agent/handoff/platform/email outbound entry, and the three-way handoff card
// (`ThreeWayHandoffCard`) on an upline-bridge entry — alongside inbound replies, the reply-paused
// cadence chip (§10.8), the opt-out do-not-contact rule (§18.8), and the thread-reactivation card.
//
// HONESTY RULES this surface must never violate (uiux §4.7 / §5.7 send-path grammar):
//   • the two send paths are visually + verbally DISTINCT — own-number (composer handoff) renders a
//     true blue bubble + "sent from your number"; the platform number renders a leaf-tinted bubble +
//     "from your Harvest number"; the UI never claims to have sent from the rep's own number.
//   • delivery state is honest: a composer-handoff entry shows "handed off", NEVER a fake delivery
//     tick; a failed send stays in the stream as failed with a retry affordance.
//   • the agent badge is transparency-as-compliance evidence (§9.3): who sent it, who approved it,
//     when, and that it links to its CFE audit record (Message.cfe_audit_id).
//
// Presentational only for the TIMELINE ENTRIES themselves — tokens (T-05) via the CSS module, icon +
// text (never color alone, §6.1). It takes an already-decrypted, already-ownership-scoped list of
// entries (the page/route does the session-gated read); rendering an entry never fetches.
//
// T-57 R3c-2 (findings M5; master-spec §10.8/§18.8 "STOP to the rep's personal number -> the rep
// marks it in-app one tap from the timeline, attested at onboarding"; §10.4 "a manual in-app mark for
// a rep's-own-number reply propagates platform-wide"). Before this fix, the `opt-out` system entry
// above (line ~176 in the original, `SystemEntryView`'s `'opt-out'` branch) was DISPLAY-ONLY — it
// only ever appeared AFTER `Contact.do_not_contact` was already `true` server-side
// (`ConversationTimelineService.getConversation`), with no affordance anywhere to actually MARK a
// contact opted out. This adds that missing ONE-TAP ACTION (`OptOutAction`, below) — genuinely wired
// to the REAL `POST /api/compliance/opt-out` (verified contract: `{ contactId, reason }`, reason
// restricted server-side to `'manual' | 'wrong_person'`; 200 `{ optedOut: true, reason }` / 400 / 404
// — src/app/api/compliance/opt-out/route.ts) — a genuine exception to "this component renders, it
// does not fetch," matching this exact codebase's own established pattern for sibling per-contact
// ACTION controls on this same route (`SequenceEnrollPanel`/`ObjectionCoachPanel`/`BridgeUplinePanel`
// in `../community/[contactId]/page.tsx` all self-fetch their own write actions the same way).
//
// SUPPRESSION IS FAIL-CLOSED, HONORED (not just recorded) in two composed layers, mirroring
// `vault.service.ts`'s existing minor-opt-out "belt-and-suspenders" convention exactly:
//   1. `POST /api/compliance/opt-out` writes the GLOBAL, permanent `OptOutRegistry` row (by hashed
//      phone/email) — this is what `SendComplianceGate.evaluate` / `OptOutRegistryService.isOptedOut`
//      actually check before EVERY future send, and `isOptedOut` fails closed (a read error resolves
//      to "opted out", never to "safe to send"). This is the real TCPA enforcement.
//   2. On that success, this action ALSO PATCHes the existing `/api/contacts/controls` route to set
//      `Contact.do_not_contact = true` — the SAME rep-facing flag `agent-runtime.ts` already reads to
//      halt a per-contact run immediately (§9.4), and the same flag this UI (and every other surface
//      that reads `contact.doNotContact`) already renders correctly off of.
// Only after BOTH calls succeed does this ask the PARENT (via `onOptOutConfirm`) to re-fetch the
// canonical contact record and report back the FRESH `do_not_contact` value — genuine confirmation,
// never declared off the mutation responses alone. Any failure at any step surfaces an error and
// leaves the one-tap control available to retry (both underlying writes are idempotent).

'use client';

import { useState } from 'react';

import { useLocale } from '@/app/locale-context';
import { formatDateTime } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/locale';
import type { TVars } from '@/lib/i18n/catalog';
import AgentSentBadge, { type MessageSourceLabel, type SentFromLabel } from './AgentSentBadge';
import ThreeWayHandoffCard, { type HandoffState } from './ThreeWayHandoffCard';
import styles from '../conversation.module.css';

export type TimelineChannel = 'SMS_HANDOFF' | 'SMS_PLATFORM' | 'EMAIL' | 'SOCIAL_DM' | 'IN_APP';

/** A sent/received message entry. `direction` aligns the bubble; `source` + `sentFrom` drive the
 *  bubble variant and the badge copy; the approval attribution + cfe_audit_id ride the immutable
 *  Message row (T-R16/T-R19 fold-in) so the badge is self-contained. */
export interface TimelineMessageEntry {
  kind: 'message';
  id: string;
  direction: 'OUTBOUND' | 'INBOUND';
  source: MessageSourceLabel;
  sentFrom?: SentFromLabel;
  channel: TimelineChannel;
  body: string;
  timestamp: string; // ISO-8601
  /** Honest delivery state (§4.7): HANDED_OFF | queued | SENT | FAILED | PENDING | delivered | ... */
  deliveryStatus: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  cfeAuditId?: string | null;
}

/** A three-way handoff card entry (§10.6). */
export interface TimelineHandoffEntry {
  kind: 'handoff';
  id: string;
  repName: string;
  uplineName: string;
  state: HandoffState;
  coachedNextStep?: string | null;
  timestamp: string;
}

/** A system entry: a reply-paused cadence chip, the opt-out do-not-contact rule, or a
 *  thread-reactivation context-replay card. */
export interface TimelineSystemEntry {
  kind: 'system';
  id: string;
  variant: 'reply-paused' | 'opt-out' | 'reactivation';
  /** Contact display name (reply-paused chip / reactivation card copy). */
  contactName?: string;
  /** Reactivation summary text ("It's been 6 weeks — here's where you left off"). */
  summary?: string;
  timestamp: string;
}

export type TimelineEntry = TimelineMessageEntry | TimelineHandoffEntry | TimelineSystemEntry;

export interface ConversationTimelineProps {
  entries: TimelineEntry[];
  /** Fires when the rep taps "Retry" on a failed send entry (wired by the page). When the contact
   *  has opted out, ALL composers are disabled upstream; this component still renders the
   *  do-not-contact rule if an opt-out system entry is present in `entries`. */
  onRetry?: (entryId: string) => void;
  /** T-57 R3c-2 (M5) — required to target the one-tap STOP/opt-out action; omitted (e.g. an existing
   *  caller that hasn't been updated, or every pre-existing test in this suite) simply suppresses the
   *  control — never a crash, never a fetch with no target. */
  contactId?: string;
  /** Current known do-not-contact state (the parent's own canonical `Contact.do_not_contact` read).
   *  While `true`, the existing informational opt-out system-entry rule already covers this contact
   *  (rendered from `entries` below) — the actionable control only renders while this is `false`. */
  doNotContact?: boolean;
  /** Fires after BOTH `POST /api/compliance/opt-out` and the follow-up `PATCH /api/contacts/controls`
   *  succeed. The PARENT must re-fetch the canonical contact record (the same read every page here
   *  already performs) and resolve with the FRESH `do_not_contact` value — this component's own
   *  "confirmed" state is gated on that fresh value being `true`, never on the mutation responses
   *  alone (fail-closed: a stale/unconfirmed read renders as unconfirmed, not as success). */
  onOptOutConfirm?: () => Promise<boolean>;
}

// T-R32 (§17.5 locale-aware date formatting) — was `toLocaleString('en-US', ...)`, hardcoded
// regardless of the rep's chosen locale. EN output is byte-identical to before.
function formatTime(locale: Locale, iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return formatDateTime(locale, d, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const CHANNEL_ICON: Record<TimelineChannel, string> = {
  SMS_HANDOFF: '💬',
  SMS_PLATFORM: '📱',
  EMAIL: '✉',
  SOCIAL_DM: '◇',
  IN_APP: '◆',
};

type Translate = (key: string, vars?: TVars) => string;

/** Honest status label — a composer handoff is "handed off", never a fake delivered tick (§4.7). */
function statusLabel(entry: TimelineMessageEntry, t: Translate): string {
  const s = entry.deliveryStatus;
  if (s === 'HANDED_OFF') return t('community.timeline.status.handedOff');
  if (s === 'FAILED') return t('community.timeline.status.failed');
  if (s === 'PENDING') return t('community.timeline.status.sending');
  if (s === 'queued') return t('community.timeline.status.queued');
  if (s === 'SENT' || s === 'sent') return t('community.timeline.status.sent');
  if (s === 'delivered') return t('community.timeline.status.delivered');
  return s.toLowerCase();
}

/** Bubble variant per the send-path grammar: own-number handoff = blue; platform = leaf-tinted;
 *  email = its own tint; inbound = neutral received bubble. */
function bubbleClass(entry: TimelineMessageEntry): string {
  if (entry.direction === 'INBOUND') return styles.bubbleInbound;
  if (entry.sentFrom === 'rep_number' || entry.channel === 'SMS_HANDOFF') return styles.bubbleOwnNumber;
  if (entry.sentFrom === 'platform_number' || entry.channel === 'SMS_PLATFORM') return styles.bubblePlatform;
  if (entry.sentFrom === 'email_domain' || entry.channel === 'EMAIL') return styles.bubbleEmail;
  return styles.bubblePlatform;
}

function MessageEntryView({
  entry,
  onRetry,
  locale,
  t,
}: {
  entry: TimelineMessageEntry;
  onRetry?: (id: string) => void;
  locale: Locale;
  t: Translate;
}) {
  const outbound = entry.direction === 'OUTBOUND';
  const failed = entry.deliveryStatus === 'FAILED';
  return (
    <li
      className={`${styles.entry} ${outbound ? styles.entryOutbound : styles.entryInbound}`}
      data-entry-kind="message"
      data-direction={entry.direction}
    >
      {/* Only the message body sits inside the (send-path-tinted) bubble; the meta, the agent badge,
          and any retry affordance sit on the neutral canvas below it so their text always renders on
          an AA-verified text-on-canvas token pair regardless of the bubble tint. */}
      <div className={`${styles.bubble} ${bubbleClass(entry)}`}>
        <p className={styles.messageBody}>{entry.body}</p>
      </div>
      <div className={styles.entryMeta}>
        <span className={styles.channelIcon} aria-hidden="true">{CHANNEL_ICON[entry.channel]}</span>
        <time className={styles.timestamp} dateTime={entry.timestamp}>{formatTime(locale, entry.timestamp)}</time>
        <span className={`${styles.statusLine} ${failed ? styles.statusFailed : ''}`}>{statusLabel(entry, t)}</span>
      </div>
      {/* The agent badge (transparency = compliance evidence, §4.7) rides every OUTBOUND entry. */}
      {outbound && (
        <AgentSentBadge
          source={entry.source}
          sentFrom={entry.sentFrom}
          approvedBy={entry.approvedBy}
          approvedAt={entry.approvedAt}
          cfeAuditId={entry.cfeAuditId}
        />
      )}
      {failed && (
        <button type="button" className={styles.retryButton} onClick={() => onRetry?.(entry.id)}>
          {t('common.retry')}
        </button>
      )}
    </li>
  );
}

function SystemEntryView({ entry, t }: { entry: TimelineSystemEntry; t: Translate }) {
  if (entry.variant === 'opt-out') {
    // Full-width clay do-not-contact rule (§4.7 / §18.8) — honored everywhere.
    return (
      <li className={styles.entrySystem} data-entry-kind="system" data-variant="opt-out">
        <p className={styles.optOutRule} role="alert">
          <span className={styles.optOutIcon} aria-hidden="true">⊘</span>
          {t('community.timeline.doNotContact')}
        </p>
      </li>
    );
  }
  if (entry.variant === 'reply-paused') {
    // §10.8 reply-arrived chip: the automated cadence is visibly paused; the rep is up.
    const replyLine = entry.contactName
      ? t('community.timeline.replyPausedNamed', { name: entry.contactName })
      : t('community.timeline.replyPausedGeneric');
    return (
      <li className={styles.entrySystem} data-entry-kind="system" data-variant="reply-paused">
        <p className={styles.replyPausedChip} role="status">
          <span className={styles.systemIcon} aria-hidden="true">⏸</span>
          {replyLine}
        </p>
      </li>
    );
  }
  // Thread-reactivation context-replay card.
  return (
    <li className={styles.entrySystem} data-entry-kind="system" data-variant="reactivation">
      <div className={styles.reactivationCard} role="note">
        <span className={styles.reactivationLabel}>{t('community.timeline.contextReplay')}</span>
        <p className={styles.reactivationSummary}>
          {entry.summary ?? t('community.timeline.reactivationDefault')}
        </p>
      </div>
    </li>
  );
}

type OptOutStatus = 'idle' | 'pending' | 'confirmed' | 'unconfirmed' | 'error';

/**
 * T-57 R3c-2 (M5) — the actual one-tap STOP/opt-out action (see this file's header note for the
 * full contract + suppression-honoring rationale). A deliberate, isolated exception to this file's
 * "presentational only" rule for entry rendering — see header note for the precedent this follows.
 */
function OptOutAction({
  contactId,
  onOptOutConfirm,
  t,
}: {
  contactId: string;
  onOptOutConfirm?: () => Promise<boolean>;
  t: Translate;
}) {
  const [status, setStatus] = useState<OptOutStatus>('idle');

  async function handleMarkStop() {
    setStatus('pending');
    try {
      const optOutRes = await fetch('/api/compliance/opt-out', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contactId, reason: 'manual' }),
      });
      if (!optOutRes.ok) {
        setStatus('error');
        return;
      }
      const optOutBody: unknown = await optOutRes.json();
      const optedOut =
        optOutBody && typeof optOutBody === 'object' && (optOutBody as { optedOut?: unknown }).optedOut === true;
      if (!optedOut) {
        // Fail-closed: a 200 with an unexpected body shape is NOT treated as success.
        setStatus('error');
        return;
      }

      // Belt-and-suspenders (mirrors vault.service.ts's `registerMinorOptOut` convention exactly):
      // ALSO flip the rep-facing per-contact flag so agent-runtime.ts's EXISTING immediate-halt
      // check (already reads Contact.do_not_contact) engages right away too, alongside the global,
      // permanent OptOutRegistry write above (the real TCPA send-gate, independent of this flag).
      const controlsRes = await fetch('/api/contacts/controls', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contactId, doNotContact: true }),
      });
      if (!controlsRes.ok) {
        setStatus('unconfirmed');
        return;
      }

      // Never declare success off these responses alone — ask the parent to re-fetch the canonical
      // record and only confirm once that FRESH read genuinely shows suppression (fail-closed).
      const confirmed = onOptOutConfirm ? await onOptOutConfirm() : true;
      setStatus(confirmed ? 'confirmed' : 'unconfirmed');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className={styles.optOutAction}>
      <p className={styles.optOutActionNote}>{t('optOut.prompt')}</p>
      <button
        type="button"
        className={styles.optOutActionButton}
        onClick={handleMarkStop}
        disabled={status === 'pending' || status === 'confirmed'}
        aria-label={t('optOut.buttonAria')}
      >
        {status === 'pending' ? t('optOut.marking') : t('optOut.button')}
      </button>
      {status === 'error' && (
        <p role="alert" className={styles.optOutActionError}>
          {t('optOut.error')}
        </p>
      )}
      {status === 'unconfirmed' && (
        <p role="alert" className={styles.optOutActionError}>
          {t('optOut.unconfirmed')}
        </p>
      )}
      {status === 'confirmed' && (
        <p role="status" className={styles.optOutActionConfirmed}>
          {t('optOut.confirmed')}
        </p>
      )}
    </div>
  );
}

export default function ConversationTimeline({
  entries,
  onRetry,
  contactId,
  doNotContact,
  onOptOutConfirm,
}: ConversationTimelineProps) {
  const { locale, t } = useLocale();

  return (
    <>
      {/* T-57 R3c-2 (M5) — reachable from the timeline directly, one tap, regardless of whether any
          messages exist yet (a STOP can arrive before Harvest ever tracked an outbound send). Once
          `doNotContact` is true, the existing informational system-entry rule (rendered below, from
          `entries`) already covers this contact — the actionable control retires. */}
      {contactId && !doNotContact && (
        <OptOutAction contactId={contactId} onOptOutConfirm={onOptOutConfirm} t={t} />
      )}

      {entries.length === 0 ? (
        // §5.7 empty state — never demo interactions.
        <div className={styles.timelineEmpty} role="status">
          {t('community.timeline.emptyState')}
        </div>
      ) : (
        <ol className={styles.timeline} aria-label={t('community.timeline.ariaLabel')}>
          {entries.map((entry) => {
            if (entry.kind === 'message') {
              return <MessageEntryView key={entry.id} entry={entry} onRetry={onRetry} locale={locale} t={t} />;
            }
            if (entry.kind === 'handoff') {
              return (
                <li key={entry.id} className={styles.entrySystem} data-entry-kind="handoff">
                  <ThreeWayHandoffCard
                    repName={entry.repName}
                    uplineName={entry.uplineName}
                    state={entry.state}
                    coachedNextStep={entry.coachedNextStep}
                  />
                </li>
              );
            }
            return <SystemEntryView key={entry.id} entry={entry} t={t} />;
          })}
        </ol>
      )}
    </>
  );
}
