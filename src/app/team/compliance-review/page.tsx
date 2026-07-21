// T-09 (master-spec §5.5 AC-3b/AC-1; §8.7.1) — the UPLINE's CFE FLAG adjudication queue. Composes the
// additive ClassifierAdjudicationDrawer (AC-1: classifier confidences + risk score + the advisory
// Sonnet/Opus recommendation + suggested rewrite) over the REAL, session-gated, org-scoped
// /api/compliance-review route — no demo/mock fallback. Approve/Reject POST to
// /api/compliance-review/adjudicate; the fail-closed HELD/BLOCK refusal + org-scoping + audit all
// live server-side. Per-item only — there is no batch/select-all affordance here, by construction.

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import ClassifierAdjudicationDrawer from '../../inbox/components/ClassifierAdjudicationDrawer';
import { useT } from '@/app/locale-context';

interface QueueItem {
  queueId: string;
  draftId: string;
  status: string;
  channel: string;
  body: string;
  cfeOutcome: string | null;
  riskScore: number | null;
  classifierResults: unknown;
  recommendedAction: string | null;
  suggestedRewrite: string | null;
  recommendationModel: string | null;
  escalationReason: string | null;
  contact: { firstName: string; lastName: string } | null;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: QueueItem[] }
  | { kind: 'forbidden' }
  | { kind: 'failed' };

export default function ComplianceReviewPage() {
  const t = useT();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const res = await fetch('/api/compliance-review');
      if (res.status === 403) return setState({ kind: 'forbidden' });
      if (!res.ok) return setState({ kind: 'failed' });
      const body = await res.json();
      setState({ kind: 'ready', items: (body.items ?? []) as QueueItem[] });
    } catch {
      setState({ kind: 'failed' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const adjudicate = useCallback(
    async (queueId: string, action: 'APPROVE' | 'REJECT', feedback?: string) => {
      setBusyId(queueId);
      setError(null);
      try {
        const res = await fetch('/api/compliance-review/adjudicate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ queueId, action, feedback }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body?.error ?? 'This item could not be adjudicated.');
          setBusyId(null);
          return;
        }
        // Drop the decided item from the queue.
        setState((prev) =>
          prev.kind === 'ready' ? { kind: 'ready', items: prev.items.filter((it) => it.queueId !== queueId) } : prev
        );
      } catch {
        setError('Network error — try again.');
      }
      setBusyId(null);
    },
    []
  );

  if (state.kind === 'loading') {
    return <div className="card panel"><p>{t('team.complianceReview.loading')}</p></div>;
  }
  if (state.kind === 'forbidden') {
    return (
      <div className="card panel">
        <span className="badge">{t('team.complianceReview.badge')}</span>
        <p>{t('team.complianceReview.forbiddenBody')}</p>
        <Link className="btn btn-secondary" href="/inbox">{t('team.complianceReview.forbiddenCta')}</Link>
      </div>
    );
  }
  if (state.kind === 'failed') {
    return (
      <div className="card panel">
        <p>{t('team.complianceReview.loadError')}</p>
        <button type="button" className="btn btn-secondary" onClick={() => void load()}>{t('team.complianceReview.retry')}</button>
      </div>
    );
  }

  if (state.items.length === 0) {
    return (
      <div className="card panel">
        <span className="badge">{t('team.complianceReview.badge')}</span>
        <h2 style={{ marginTop: 8 }}>{t('team.complianceReview.emptyHeading')}</h2>
        <p>{t('team.complianceReview.emptyBody')}</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <section className="card panel">
        <span className="badge">{t('team.complianceReview.badge')}</span>
        <h2 style={{ marginTop: 8 }}>{t('team.complianceReview.readyHeading')}</h2>
        <p style={{ color: 'var(--muted)' }}>
          {t('team.complianceReview.readyBody')}
        </p>
      </section>

      {state.items.map((item) => {
        const name = item.contact ? `${item.contact.firstName} ${item.contact.lastName}` : 'a contact';
        const busy = busyId === item.queueId;
        return (
          <section key={item.queueId} className="card panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong>{t('team.complianceReview.toLabel')} {name} · {item.channel.replace(/_/g, ' ')}</strong>
              {item.status === 'ESCALATED' ? <span className="badge">{t('team.complianceReview.escalatedBadge')}</span> : <span className="badge">{t('team.complianceReview.flaggedBadge')}</span>}
            </div>
            <p style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{item.body}</p>

            <ClassifierAdjudicationDrawer
              classifierData={item.classifierResults}
              riskScore={item.riskScore}
              recommendedAction={item.recommendedAction}
              suggestedRewrite={item.suggestedRewrite}
              recommendationModel={item.recommendationModel}
              escalationReason={item.escalationReason}
            />

            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void adjudicate(item.queueId, 'APPROVE')}
              >
                {busy ? 'Working…' : 'Approve for send'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void adjudicate(item.queueId, 'REJECT')}
              >
                {t('team.complianceReview.reject')}
              </button>
            </div>
          </section>
        );
      })}

      {error && (
        <div className="card panel" role="alert">
          <p style={{ color: 'var(--color-caution-text)' }}>{error}</p>
        </div>
      )}
    </div>
  );
}
