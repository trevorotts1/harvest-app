// T-45 (WP09 §9.6/§16.6; uiux §5.9 "privacy boundary rendered, not just enforced", AC-5.9-4) — the
// rep drill-in. Cross-org/non-downline access renders as a plain not-found (the API 404s; the page
// never distinguishes "exists but blocked" from "doesn't exist").

'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

import { useT } from '@/app/locale-context';
import { NamesInPlayPanel, PipelineStatesPanel } from './components/RepDataPanels';

interface DrillIn {
  repUserId: string;
  repName: string;
  pipelineStateCounts: Record<string, number>;
  namesInPlay: { contactId: string; displayName: string; pipelineStage: string }[];
  appointments: { id: string; status: string; whenIso: string | null }[];
  attendance: { eventId: string; state: string }[];
  milestones: { key: string; achievedAtIso: string; celebrated: boolean }[];
  privacyBoundary: string;
}

type LoadState = { kind: 'loading' } | { kind: 'ready'; data: DrillIn } | { kind: 'not_found' } | { kind: 'failed' };

export default function RepDrillInPage() {
  const t = useT();
  const params = useParams<{ userId: string }>();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/team/rep/${params.userId}`);
        if (cancelled) return;
        if (res.status === 404) {
          setState({ kind: 'not_found' });
          return;
        }
        if (!res.ok) {
          setState({ kind: 'failed' });
          return;
        }
        const data = (await res.json()) as DrillIn;
        setState({ kind: 'ready', data });
      } catch {
        if (!cancelled) setState({ kind: 'failed' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.userId]);

  if (state.kind === 'loading') return <div className="card panel"><p>{t('common.loading')}</p></div>;
  if (state.kind === 'not_found') return <div className="card panel"><p>{t('team.rep.notFound')}</p></div>;
  if (state.kind === 'failed') return <div className="card panel"><p>{t('team.rep.loadFailed')}</p></div>;

  const { data } = state;

  return (
    <div className="stack">
      <section className="card panel">
        <span className="badge">{t('team.rep.badge')}</span>
        <h2 style={{ marginTop: 8 }}>{data.repName}</h2>
      </section>

      <PipelineStatesPanel counts={data.pipelineStateCounts} />

      <NamesInPlayPanel names={data.namesInPlay} />

      {data.milestones.length > 0 && (
        <section className="card panel">
          <span className="badge">{t('team.rep.milestonesBadge')}</span>
          <ul>
            {data.milestones.map((m) => (
              <li key={m.key}>{m.key.replace(/_/g, ' ')} — {new Date(m.achievedAtIso).toLocaleDateString()}</li>
            ))}
          </ul>
        </section>
      )}

      {/* uiux §5.9: the privacy boundary, RENDERED (not just enforced) — where PII would begin. */}
      <section className="card panel" style={{ borderStyle: 'dashed' }}>
        <p style={{ fontStyle: 'italic' }}>{data.privacyBoundary}</p>
      </section>
    </div>
  );
}
