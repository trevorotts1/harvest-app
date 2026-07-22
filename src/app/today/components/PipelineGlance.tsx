// uiux §5.2 zone 4 — Pipeline glance: introduced → responded → appointment → closed with 7-day
// deltas. AC-5.2-8: negative movement never renders red — it reads "needs tending" (wheat), never an
// alarm color.
//
// T-57 RG5-FINAL — `deltaLabel`'s negative-delta text used to be the bare English literal
// `'needs tending'`, returned from this plain (non-component) helper and rendered downstream as
// `{d.text}` — invisible to every existing scanner (not JSX text, not a JSX string-literal
// expression child, not a backend machine token) because the literal lives one function-return hop
// away from the JSX that renders it. A Spanish rep saw "needs tending" verbatim. Fixed by threading
// `t` into the helper and resolving through the catalog (`today.pipelineGlance.needsTending`, ES
// "necesita atención" — same idiom this codebase already uses for the identical "wheat, not red"
// concept elsewhere, e.g. `grow.orchardCanvas.needsAttentionLabel`/`grow.treeList.healthLabel.red`).
// See `scripts/guard-no-literals-in-components.mjs`'s new shape (7) for the guard that now catches
// this exact function-return-literal-into-JSX-child pattern durably.

import styles from '../today.module.css';
import type { PipelineZoneData, ZoneResult } from '@/services/mission-control/types';
import { useT } from '@/app/locale-context';
import type { TVars } from '@/lib/i18n/catalog';

export interface PipelineGlanceProps {
  result: ZoneResult<PipelineZoneData>;
}

function deltaLabel(t: (key: string, vars?: TVars) => string, delta: number): { text: string; className: string } {
  if (delta > 0) return { text: `▲ ${delta}`, className: styles.deltaUp };
  if (delta < 0) return { text: t('today.pipelineGlance.needsTending'), className: styles.deltaNeedsTending };
  return { text: '—', className: styles.deltaFlat };
}

export default function PipelineGlance({ result }: PipelineGlanceProps) {
  const t = useT();

  if (result.status === 'error') {
    return (
      <section className={styles.zoneCard} data-zone="pipeline">
        <span className={styles.zoneBadge}>{t('today.pipelineGlance.heading')}</span>
        <p className={styles.zoneErrorText} role="status">{result.message}</p>
      </section>
    );
  }

  return (
    <section className={styles.zoneCard} data-zone="pipeline">
      <span className={styles.zoneBadge}>{t('today.pipelineGlance.heading')}</span>
      <div className={styles.pipelineRow}>
        {result.data.buckets.map((b) => {
          const d = deltaLabel(t, b.deltaLast7d);
          return (
            <div key={b.key} className={styles.pipelineBucket}>
              <span className={styles.pipelineCount}>{b.count}</span>
              <span className={styles.pipelineLabel}>{b.label}</span>
              <span className={d.className}>{d.text}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
