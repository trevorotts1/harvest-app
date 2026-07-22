// T-55 (master-spec §17.7; uiux §5.9 AC-5.9-8 "partial-data reps render learning states, never
// zeros") — the rep drill-in's "Pipeline states" + "Names in play" panels, extracted from
// RepDrillInPage so their zero-data rendering is independently testable via `renderToStaticMarkup`
// (this repo's Jest config runs `testEnvironment: 'node'` — no DOM/jsdom, see jest.config.js — so a
// fetch-driven page component's resolved states can't be reached by rendering the page itself).
//
// Before this extraction, a rep with no pipeline activity yet (or literally zero names in play)
// rendered a bare section header over an empty grid/list — a narrative-free blank region (SC9).

import { useT } from '@/app/locale-context';
import { pipelineStageLabel } from '@/lib/i18n/team-token-display';

export interface PipelineStatesPanelProps {
  counts: Record<string, number>;
}

export function PipelineStatesPanel({ counts }: PipelineStatesPanelProps) {
  const t = useT();
  const entries = Object.entries(counts);
  return (
    <section className="card panel">
      <span className="badge">{t('team.rep.pipelineStatesBadge')}</span>
      {entries.length === 0 ? (
        <p style={{ color: 'var(--muted)', marginTop: 12 }}>{t('team.rep.pipelineStatesEmpty')}</p>
      ) : (
        <div className="metric-grid" style={{ marginTop: 12 }}>
          {entries.map(([stage, count]) => (
            <div className="metric" key={stage}>
              <strong>{count}</strong>
              <span>{pipelineStageLabel(t, stage)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export interface NameInPlay {
  contactId: string;
  displayName: string;
  pipelineStage: string;
}

export interface NamesInPlayPanelProps {
  names: NameInPlay[];
}

export function NamesInPlayPanel({ names }: NamesInPlayPanelProps) {
  const t = useT();
  return (
    <section className="card panel">
      <span className="badge">{t('team.rep.namesInPlayBadge')}</span>
      {names.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>{t('team.rep.namesInPlayEmpty')}</p>
      ) : (
        <ul>
          {names.map((n) => (
            <li key={n.contactId}>{n.displayName} — {pipelineStageLabel(t, n.pipelineStage)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
