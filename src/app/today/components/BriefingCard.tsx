// uiux §4.1 Briefing Card / §5.2 zone 2 — Overnight Briefing. States: ready (real narrative lines +
// receipts), first_day (pre-first-action), agents_resting (Claude/CFE outage — never fabricates,
// master spec §18.6), empty (a quiet night, not an error), and this zone's OWN error state.

import { useState } from 'react';

import styles from '../today.module.css';
import type { BriefingZoneData, ZoneResult } from '@/services/mission-control/types';

export interface BriefingCardProps {
  result: ZoneResult<BriefingZoneData>;
}

function freshnessLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return `as of ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

export default function BriefingCard({ result }: BriefingCardProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  if (result.status === 'error') {
    return (
      <section className={styles.zoneCard} data-zone="briefing">
        <span className={styles.zoneBadge}>While you slept</span>
        <p className={styles.zoneErrorText}>{result.message}</p>
      </section>
    );
  }

  const { state, freshnessStamp, lines } = result.data;
  const stamp = freshnessLabel(freshnessStamp);

  return (
    <section className={styles.zoneCard} data-zone="briefing" data-briefing-state={state}>
      <div className={styles.zoneHeaderRow}>
        <span className={styles.zoneBadge}>While you slept</span>
        {stamp && <span className={styles.freshnessStamp}>{stamp}</span>}
      </div>

      {state === 'first_day' && (
        <p className={styles.narrativeLine}>Your field is planted — your agents haven&apos;t run yet. Nothing to report, nothing lost.</p>
      )}
      {state === 'agents_resting' && (
        <p className={styles.narrativeLine}>Your agents are resting — everything is saved.</p>
      )}
      {state === 'empty' && (
        <p className={styles.narrativeLine}>A quiet night — your agents found nothing that needed you.</p>
      )}
      {state === 'ready' &&
        lines.map((line, i) => (
          <div key={i} className={styles.briefingLine}>
            <button
              type="button"
              className={styles.briefingLineButton}
              onClick={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  return next;
                })
              }
              aria-expanded={expanded.has(i)}
              disabled={line.receipts.length === 0}
            >
              <span className={styles.narrativeLine}>{line.text}</span>
              {line.receipts.length > 0 && <span className={styles.receiptChevron} aria-hidden="true">›</span>}
            </button>
            {expanded.has(i) && line.receipts.length > 0 && (
              <ul className={styles.receiptsList}>
                {line.receipts.map((r) => (
                  <li key={r.agentRunId}>
                    {r.agentDisplayName} · {r.action} · {new Date(r.when).toLocaleString()}
                    {r.cfeBand ? ` · CFE ${r.cfeBand}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
    </section>
  );
}
