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
import { StatusMessage } from '@/components/StatusMessage';
import { errorDisplay, errorStateLabel } from '@/lib/i18n/error-display';
import { channelLabel } from '@/lib/i18n/channel-display';

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

// T-R51 (OBSERVE variant) — read-only §0.5 doctrine-vocabulary catch frequency. The vocabulary
// hard-block is unchanged (still fires regardless of mode); this panel exists purely so the
// operator can see WHICH terms fire and how often, to refine the list later.
interface VocabularyTermStat {
  forbidden: string;
  count: number;
  lastSeenAt: string;
}
interface VocabularyObservability {
  mode: 'block' | 'observe';
  totalCatches: number;
  byTerm: VocabularyTermStat[];
  recentEvents: unknown[];
}
type VocabLoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: VocabularyObservability }
  | { kind: 'failed' };

export default function ComplianceReviewPage() {
  const t = useT();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vocabState, setVocabState] = useState<VocabLoadState>({ kind: 'loading' });

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

  // T-R51: best-effort, additive — a failure/403 here never blocks or alters the FLAG queue above
  // (fetched independently); the panel simply doesn't render (see JSX below).
  const loadVocabularyObservability = useCallback(async () => {
    setVocabState({ kind: 'loading' });
    try {
      const res = await fetch('/api/compliance-review/vocabulary-observability');
      if (!res.ok) return setVocabState({ kind: 'failed' });
      const body = (await res.json()) as VocabularyObservability;
      setVocabState({ kind: 'ready', data: body });
    } catch {
      setVocabState({ kind: 'failed' });
    }
  }, []);

  useEffect(() => {
    void load();
    void loadVocabularyObservability();
  }, [load, loadVocabularyObservability]);

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
          // T-57 RE-GATE B [af7789d3] Finding 1 — never render the raw English `body.error`;
          // resolve a locale-correct string from the `errors.*` catalog by the route's `code`.
          const body = await res.json().catch(() => ({}) as { code?: string; currentState?: string });
          setError(errorDisplay(t, body?.code, { currentState: errorStateLabel(t, body?.currentState) }));
          setBusyId(null);
          return;
        }
        // Drop the decided item from the queue.
        setState((prev) =>
          prev.kind === 'ready' ? { kind: 'ready', items: prev.items.filter((it) => it.queueId !== queueId) } : prev
        );
      } catch {
        setError(t('team.complianceReview.networkErrorGeneric'));
      }
      setBusyId(null);
    },
    [t]
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
        {/* T-57 RG7 (SC 4.1.3) — review-queue load failure announced via StatusMessage (role=alert). */}
        <StatusMessage>{t('team.complianceReview.loadError')}</StatusMessage>
        <button type="button" className="btn btn-secondary" onClick={() => void load()}>{t('team.complianceReview.retry')}</button>
      </div>
    );
  }

  // T-R51 (OBSERVE variant) — the vocabulary-watch panel. Additive/read-only: renders only when it
  // loaded successfully AND there's something to show; a 403/network failure here silently omits
  // the panel rather than blocking or altering the FLAG queue above (fetched independently).
  const vocabularyPanel =
    vocabState.kind === 'ready' && vocabState.data.byTerm.length > 0 ? (
      <section className="card panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>{t('team.complianceReview.vocabulary.heading')}</h2>
          <span className="badge">
            {t(
              vocabState.data.mode === 'observe'
                ? 'team.complianceReview.vocabulary.modeObserveBadge'
                : 'team.complianceReview.vocabulary.modeBlockBadge'
            )}
          </span>
        </div>
        <p style={{ color: 'var(--muted)' }}>{t('team.complianceReview.vocabulary.intro')}</p>
        <p style={{ color: 'var(--muted)' }}>
          {t('team.complianceReview.vocabulary.totalCatches', { count: vocabState.data.totalCatches })}
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>{t('team.complianceReview.vocabulary.termHeader')}</th>
                <th style={{ textAlign: 'right', padding: '4px 8px' }}>{t('team.complianceReview.vocabulary.countHeader')}</th>
                <th style={{ textAlign: 'right', padding: '4px 8px' }}>{t('team.complianceReview.vocabulary.lastSeenHeader')}</th>
              </tr>
            </thead>
            <tbody>
              {vocabState.data.byTerm.map((row) => (
                <tr key={row.forbidden}>
                  <td style={{ padding: '4px 8px' }}>{row.forbidden}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{row.count}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{new Date(row.lastSeenAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    ) : null;

  if (state.items.length === 0) {
    return (
      <div className="stack">
        <div className="card panel">
          <span className="badge">{t('team.complianceReview.badge')}</span>
          <h2 style={{ marginTop: 8 }}>{t('team.complianceReview.emptyHeading')}</h2>
          <p>{t('team.complianceReview.emptyBody')}</p>
        </div>
        {vocabularyPanel}
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

      {vocabularyPanel}

      {state.items.map((item) => {
        const name = item.contact ? `${item.contact.firstName} ${item.contact.lastName}` : t('team.complianceReview.contactFallback');
        const busy = busyId === item.queueId;
        return (
          <section key={item.queueId} className="card panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {/* T-57 RG6 (i18n) — was `{item.channel.replace(/_/g, ' ')}`: the raw `MessageChannel`
                  token, merely de-snake-cased, never translated. `channelLabel`
                  (`@/lib/i18n/channel-display.ts`) is the same mapper `ApprovalInboxItem.tsx` uses
                  for the identical enum. */}
              <strong>{t('team.complianceReview.toLabel')} {name} · {channelLabel(t, item.channel)}</strong>
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
                {busy ? t('team.complianceReview.workingCta') : t('team.complianceReview.approveForSendCta')}
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
