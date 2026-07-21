// T-R22R (re-integration of T-R22, master-spec §10.6) — one pending bridge request awaiting THIS
// upline. Presentational; the page owns the fetch. Ported from the original T-R22 build
// (build/T-R22-handoff-join-ui@765c793, src/app/team/components/PendingBridgeItem.tsx) onto WP09's
// (T-45) global card/action-row/badge idiom instead of a bespoke CSS module, so this reads as one
// surface with its `/team` siblings (dashboard, calendar, cockpit) rather than a bolted-on page.
// Logic and contract are otherwise unchanged: shows only the inviting rep's name, why they're
// asking, and the 24h return-deadline countdown context — NEVER contact identity or conversation
// content, which (per §2.5, and this surface's own read route) only ever surfaces to the upline
// once they've actually joined via the pre-existing, unmodified POST
// /api/messaging/handoff/join.

'use client';

import { useState } from 'react';

import { useT } from '@/app/locale-context';

export interface PendingBridgeData {
  id: string;
  repName: string;
  triggerReason: string;
  invitedAt: string;
  returnDeadlineAt: string;
}

const REASON_LABEL_KEY: Record<string, string> = {
  BUYING_SIGNAL: 'team.bridges.item.reasonLabel.buyingSignal',
  HARD_QUESTION: 'team.bridges.item.reasonLabel.hardQuestion',
  MANUAL: 'team.bridges.item.reasonLabel.manual',
};

export interface PendingBridgeItemProps {
  item: PendingBridgeData;
  onJoin: (handoffId: string) => Promise<{ ok: boolean; error?: string }>;
}

export default function PendingBridgeItem({ item, onJoin }: PendingBridgeItemProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  async function handleJoin() {
    setBusy(true);
    setError(null);
    const result = await onJoin(item.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t('team.bridges.item.errorFallback'));
      return;
    }
    setJoined(true);
  }

  const reasonLabelKey = REASON_LABEL_KEY[item.triggerReason];
  const reasonLabel = reasonLabelKey ? t(reasonLabelKey) : t('team.bridges.item.reasonLabel.fallback');

  return (
    <article className="action-row" aria-label={t('team.bridges.item.ariaLabel', { name: item.repName })}>
      <span className="priority">!</span>
      <div>
        <strong>{item.repName}</strong> {t('inbox.item.separator')} {reasonLabel}
        <br />
        <span style={{ color: 'var(--muted)' }}>
          {t('team.bridges.item.invitedLabel')} {new Date(item.invitedAt).toLocaleString()} {t('team.bridges.item.returnsToThemAtLabel')}{' '}
          {new Date(item.returnDeadlineAt).toLocaleString()} {t('team.bridges.item.ifYouDontJoin')}
        </span>
        {error && (
          <p className="notice notice-danger" role="alert" style={{ marginTop: 8 }}>
            {error}
          </p>
        )}
        {joined && (
          <p role="status" style={{ color: 'var(--muted)', marginTop: 8 }}>
            {t('team.bridges.item.joinedNotice')}
          </p>
        )}
      </div>
      {!joined && (
        <button type="button" className="btn btn-primary" onClick={handleJoin} disabled={busy}>
          {busy ? t('team.bridges.item.joiningCta') : t('team.bridges.item.joinCta')}
        </button>
      )}
    </article>
  );
}
