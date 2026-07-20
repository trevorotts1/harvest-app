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
// Presentational only — tokens (T-05) via the CSS module, icon + text (never color alone, §6.1). It
// takes an already-decrypted, already-ownership-scoped list of entries (the page/route does the
// session-gated read); this component renders, it does not fetch.

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
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const CHANNEL_ICON: Record<TimelineChannel, string> = {
  SMS_HANDOFF: '💬',
  SMS_PLATFORM: '📱',
  EMAIL: '✉',
  SOCIAL_DM: '◇',
  IN_APP: '◆',
};

/** Honest status label — a composer handoff is "handed off", never a fake delivered tick (§4.7). */
function statusLabel(entry: TimelineMessageEntry): string {
  const s = entry.deliveryStatus;
  if (s === 'HANDED_OFF') return 'handed off';
  if (s === 'FAILED') return 'failed';
  if (s === 'PENDING') return 'sending';
  if (s === 'queued') return 'queued';
  if (s === 'SENT' || s === 'sent') return 'sent';
  if (s === 'delivered') return 'delivered';
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

function MessageEntryView({ entry, onRetry }: { entry: TimelineMessageEntry; onRetry?: (id: string) => void }) {
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
        <time className={styles.timestamp} dateTime={entry.timestamp}>{formatTime(entry.timestamp)}</time>
        <span className={`${styles.statusLine} ${failed ? styles.statusFailed : ''}`}>{statusLabel(entry)}</span>
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
          Retry
        </button>
      )}
    </li>
  );
}

function SystemEntryView({ entry }: { entry: TimelineSystemEntry }) {
  if (entry.variant === 'opt-out') {
    // Full-width clay do-not-contact rule (§4.7 / §18.8) — honored everywhere.
    return (
      <li className={styles.entrySystem} data-entry-kind="system" data-variant="opt-out">
        <p className={styles.optOutRule} role="alert">
          <span className={styles.optOutIcon} aria-hidden="true">⊘</span>
          Do not contact — honored everywhere.
        </p>
      </li>
    );
  }
  if (entry.variant === 'reply-paused') {
    // §10.8 reply-arrived chip: the automated cadence is visibly paused; the rep is up.
    const who = entry.contactName ?? 'They';
    return (
      <li className={styles.entrySystem} data-entry-kind="system" data-variant="reply-paused">
        <p className={styles.replyPausedChip} role="status">
          <span className={styles.systemIcon} aria-hidden="true">⏸</span>
          {who} replied — your cadence is paused; you&apos;re up.
        </p>
      </li>
    );
  }
  // Thread-reactivation context-replay card.
  return (
    <li className={styles.entrySystem} data-entry-kind="system" data-variant="reactivation">
      <div className={styles.reactivationCard} role="note">
        <span className={styles.reactivationLabel}>Context replay</span>
        <p className={styles.reactivationSummary}>
          {entry.summary ?? 'Here is where you left off.'}
        </p>
      </div>
    </li>
  );
}

export default function ConversationTimeline({ entries, onRetry }: ConversationTimelineProps) {
  if (entries.length === 0) {
    // §5.7 empty state — never demo interactions.
    return (
      <div className={styles.timelineEmpty} role="status">
        No introductions yet. When you&apos;re ready, your agent has a draft.
      </div>
    );
  }

  return (
    <ol className={styles.timeline} aria-label="Conversation timeline">
      {entries.map((entry) => {
        if (entry.kind === 'message') {
          return <MessageEntryView key={entry.id} entry={entry} onRetry={onRetry} />;
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
        return <SystemEntryView key={entry.id} entry={entry} />;
      })}
    </ol>
  );
}
