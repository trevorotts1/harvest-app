// T-43 (WP07 §12.1, uiux §3.3) — the Momentum detail page: the ten-criteria breakdown behind the
// Today header's tap-to-expand, plus the single suggested action for the weakest Law. Session-gated
// downstream page (falls under `/today`'s existing GATED_DOWNSTREAM_PAGE_PREFIXES entry).

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface MomentumDetail {
  levelName: string;
  criteria: Record<string, { label: string; score: number }>;
  weakestCriterionLabel: string;
  suggestedAction: string;
}

type LoadState = { kind: 'loading' } | { kind: 'ready'; data: MomentumDetail } | { kind: 'failed' };

export default function MomentumDetailPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    fetch('/api/gamification/momentum')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: MomentumDetail) => setState({ kind: 'ready', data }))
      .catch(() => setState({ kind: 'failed' }));
  }, []);

  return (
    <main className="shell section">
      <Link href="/today" className="badge">← Back to Today</Link>

      {state.kind === 'loading' && (
        <section className="card panel" style={{ marginTop: 18 }}>
          <p>Gathering your momentum…</p>
        </section>
      )}

      {state.kind === 'failed' && (
        <section className="card panel" style={{ marginTop: 18 }}>
          <p>We couldn&apos;t load this right now — your work is safe. <Link href="/today">Back to Today</Link>.</p>
        </section>
      )}

      {state.kind === 'ready' && (
        <>
          <section className="card panel" style={{ marginTop: 18 }}>
            <span className="badge">Your level</span>
            <h1 style={{ marginTop: 12 }}>{state.data.levelName}</h1>
            <p style={{ color: 'var(--muted)' }}>{state.data.suggestedAction}</p>
          </section>

          <section className="card panel" style={{ marginTop: 18 }}>
            <span className="badge">The ten criteria feeding your Grove</span>
            <div className="stack" style={{ marginTop: 18 }}>
              {Object.entries(state.data.criteria).map(([key, value]) => (
                <div key={key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <strong>{value.label}</strong>
                    <span>{value.score}/10</span>
                  </div>
                  <div className="progress"><span style={{ width: `${value.score * 10}%` }} /></div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
