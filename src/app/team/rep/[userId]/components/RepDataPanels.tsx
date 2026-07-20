// T-55 (master-spec §17.7; uiux §5.9 AC-5.9-8 "partial-data reps render learning states, never
// zeros") — the rep drill-in's "Pipeline states" + "Names in play" panels, extracted from
// RepDrillInPage so their zero-data rendering is independently testable via `renderToStaticMarkup`
// (this repo's Jest config runs `testEnvironment: 'node'` — no DOM/jsdom, see jest.config.js — so a
// fetch-driven page component's resolved states can't be reached by rendering the page itself).
//
// Before this extraction, a rep with no pipeline activity yet (or literally zero names in play)
// rendered a bare section header over an empty grid/list — a narrative-free blank region (SC9).

export interface PipelineStatesPanelProps {
  counts: Record<string, number>;
}

export function PipelineStatesPanel({ counts }: PipelineStatesPanelProps) {
  const entries = Object.entries(counts);
  return (
    <section className="card panel">
      <span className="badge">Pipeline states</span>
      {entries.length === 0 ? (
        <p style={{ color: 'var(--muted)', marginTop: 12 }}>Learning this rep&apos;s community — nothing in the pipeline yet.</p>
      ) : (
        <div className="metric-grid" style={{ marginTop: 12 }}>
          {entries.map(([stage, count]) => (
            <div className="metric" key={stage}>
              <strong>{count}</strong>
              <span>{stage.toLowerCase().replace(/_/g, ' ')}</span>
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
  return (
    <section className="card panel">
      <span className="badge">Names in play</span>
      {names.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No names in play yet — nothing to review.</p>
      ) : (
        <ul>
          {names.map((n) => (
            <li key={n.contactId}>{n.displayName} — {n.pipelineStage.toLowerCase().replace(/_/g, ' ')}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
