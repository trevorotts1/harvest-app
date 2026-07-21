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

'use client';

import { useLocale } from '@/app/locale-context';
import { formatDate } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/locale';
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

// T-R32 (§17.5 locale-aware date formatting) — was `toLocaleDateString('en-US', ...)`, hardcoded
// regardless of the rep's chosen locale. EN output is byte-identical to before.
function formatApprovedAt(locale: Locale, iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return formatDate(locale, d, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function AgentSentBadge({ source, sentFrom, approvedBy, approvedAt, cfeAuditId }: AgentSentBadgeProps) {
  const { locale, t } = useLocale();
  const approvedDate = formatApprovedAt(locale, approvedAt);

  // The primary transparency line.
  let label: string;
  if (sentFrom === 'rep_number') {
    label = t('community.agentBadge.sentFromRepNumber');
  } else if (sentFrom === 'platform_number') {
    label = t('community.agentBadge.fromPlatformNumber');
  } else if (source === 'AGENT') {
    label = t('community.agentBadge.sentByAgent');
  } else {
    label = source === 'UPLINE' ? t('community.agentBadge.sentByUpline') : t('community.agentBadge.sentByYou');
  }

  const approvedClause = approvedBy && approvedDate
    ? t('community.agentBadge.approvedByYouOn', { date: approvedDate })
    : approvedBy
      ? t('community.agentBadge.approvedByYou')
      : '';
  const cfeLinked = Boolean(cfeAuditId);
  const complianceSuffix = cfeLinked ? t('community.agentBadge.complianceLinkedSuffix') : '';

  return (
    <span
      className={styles.agentBadge}
      role="note"
      data-cfe-audit={cfeLinked ? cfeAuditId ?? undefined : undefined}
      // The full sentence is also the screen-reader utterance (transparency = evidence, §9.3).
      aria-label={`${label}${approvedClause}${complianceSuffix}`}
    >
      <span className={styles.agentBadgeIcon} aria-hidden="true">👁</span>
      <span className={styles.agentBadgeText}>
        {label}
        {approvedClause}
      </span>
      {cfeLinked && (
        <span className={styles.cfeEvidence} title={t('community.agentBadge.complianceRecordTitle')}>
          {t('community.agentBadge.complianceRecordLinked')}
        </span>
      )}
    </span>
  );
}
