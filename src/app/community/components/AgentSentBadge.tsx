// T-39 (T-R16 fold-in; uiux §4.7 "the agent badge") — the transparency-is-compliance badge rendered
// on every agent-sent (and composer-handoff) timeline entry. §9.3: "transparency = compliance
// evidence". Reads the immutable sent Message's denormalized approval attribution
// (`approved_by`/`approved_at`, T-R16 fold-in) and its `cfe_audit_id` (T-R19 fold-in) — so the entry
// says, on its face, who sent it, who approved it, when, and that it points at its CFE audit record.
//
// Two honest variants (§4.7 / uiux §5.7 send-path grammar):
//   • AGENT source           → "sent by your agent · approved by you [date]"
//   • composer handoff        → "sent from your number" (rep_number) — a real blue bubble
//   • platform number         → "from your Harvest number" (platform_number)
// Icon + text, never color alone (§6.1).

import styles from '../conversation.module.css';

export type MessageSourceLabel = 'AGENT' | 'REP' | 'UPLINE' | 'SYSTEM';
export type SentFromLabel = 'rep_number' | 'platform_number' | 'email_domain' | null;

export interface AgentSentBadgeProps {
  source: MessageSourceLabel;
  sentFrom?: SentFromLabel;
  approvedBy?: string | null;
  approvedAt?: string | null; // ISO-8601
  /** Present iff the send was linked to its CFE AuditEntry (T-R19). Drives the compliance-evidence note. */
  cfeAuditId?: string | null;
}

function formatApprovedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function AgentSentBadge({ source, sentFrom, approvedBy, approvedAt, cfeAuditId }: AgentSentBadgeProps) {
  const approvedDate = formatApprovedAt(approvedAt);

  // The primary transparency line.
  let label: string;
  if (sentFrom === 'rep_number') {
    label = 'sent from your number';
  } else if (sentFrom === 'platform_number') {
    label = 'from your Harvest number';
  } else if (source === 'AGENT') {
    label = 'sent by your agent';
  } else {
    label = source === 'UPLINE' ? 'sent by your upline' : 'sent by you';
  }

  const approvedClause = approvedBy && approvedDate ? ` · approved by you ${approvedDate}` : approvedBy ? ' · approved by you' : '';
  const cfeLinked = Boolean(cfeAuditId);

  return (
    <span
      className={styles.agentBadge}
      role="note"
      data-cfe-audit={cfeLinked ? cfeAuditId ?? undefined : undefined}
      // The full sentence is also the screen-reader utterance (transparency = evidence, §9.3).
      aria-label={`${label}${approvedClause}${cfeLinked ? ' — linked to its compliance record' : ''}`}
    >
      <span className={styles.agentBadgeIcon} aria-hidden="true">👁</span>
      <span className={styles.agentBadgeText}>
        {label}
        {approvedClause}
      </span>
      {cfeLinked && (
        <span className={styles.cfeEvidence} title="This send is linked to its compliance audit record.">
          compliance record linked
        </span>
      )}
    </span>
  );
}
