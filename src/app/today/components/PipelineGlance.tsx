// uiux §5.2 zone 4 — Pipeline glance: introduced → responded → appointment → closed with 7-day
// deltas. AC-5.2-8: negative movement never renders red — it reads "needs tending" (wheat), never an
// alarm color.

import styles from '../today.module.css';
import type { PipelineZoneData, ZoneResult } from '@/services/mission-control/types';
import { useT } from '@/app/locale-context';

export interface PipelineGlanceProps {
  result: ZoneResult<PipelineZoneData>;
}

function deltaLabel(delta: number): { text: string; className: string } {
  if (delta > 0) return { text: `▲ ${delta}`, className: styles.deltaUp };
  if (delta < 0) return { text: `needs tending`, className: styles.deltaNeedsTending };
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
          const d = deltaLabel(b.deltaLast7d);
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
