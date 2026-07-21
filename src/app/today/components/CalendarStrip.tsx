// uiux §5.2 zone 6 — Team calendar strip: next 3 team events with one-tap attendance marking.
//
// QUEUED-OFFLINE (T-54, master-spec §17.6; uiux §4.2 "queued-offline"): `queuedOfflineEventIds` is a
// PAGE-owned, ephemeral, client-local set (never a server field on `CalendarEventItem` —
// `src/app/today/page.tsx` tracks it alongside its `PersistentOfflineQueue`, `src/app/today/offline.ts`).
// An event whose id is in the set renders the queued-offline state instead of the two attendance
// buttons — honest ("will sync"), never a button that looks live but silently does nothing offline.

import styles from '../today.module.css';
import type { CalendarEventItem, CalendarZoneData, ZoneResult } from '@/services/mission-control/types';

export interface CalendarStripProps {
  result: ZoneResult<CalendarZoneData>;
  onMarkAttendance: (event: CalendarEventItem, state: 'attended' | 'missed') => void | Promise<void>;
  /** T-54 — see this file's header "QUEUED-OFFLINE" note. Optional; omitted/empty for every
   *  existing caller (no behavior change when nothing is queued). */
  queuedOfflineEventIds?: ReadonlySet<string>;
}

export default function CalendarStrip({ result, onMarkAttendance, queuedOfflineEventIds }: CalendarStripProps) {
  if (result.status === 'error') {
    return (
      <section className={styles.zoneCard} data-zone="calendar">
        <span className={styles.zoneBadge}>Team calendar</span>
        <p className={styles.zoneErrorText}>{result.message}</p>
      </section>
    );
  }

  if (!result.data.hasOrg) {
    return (
      <section className={styles.zoneCard} data-zone="calendar">
        <span className={styles.zoneBadge}>Team calendar</span>
        <p className={styles.narrativeLine}>No team yet — events will show here once you&apos;re connected to an organization.</p>
      </section>
    );
  }

  if (result.data.events.length === 0) {
    return (
      <section className={styles.zoneCard} data-zone="calendar">
        <span className={styles.zoneBadge}>Team calendar</span>
        <p className={styles.narrativeLine}>Quiet so far — no upcoming team events.</p>
      </section>
    );
  }

  return (
    <section className={styles.zoneCard} data-zone="calendar">
      <span className={styles.zoneBadge}>Team calendar</span>
      <ul className={styles.calendarList}>
        {result.data.events.map((e) => (
          <li key={e.id} className={styles.calendarRow}>
            <div>
              <strong>{e.type.replaceAll('_', ' ')}</strong>
              <span className={styles.queueMeta}>{new Date(e.startsAt).toLocaleString()}</span>
            </div>
            {e.attendanceState === 'attended' || e.attendanceState === 'missed' ? (
              <span className={styles.attendanceMarked}>{e.attendanceState === 'attended' ? 'I was there' : "Couldn't make it"}</span>
            ) : queuedOfflineEventIds?.has(e.id) ? (
              <span className={styles.queueQueuedOffline} role="status">
                <span aria-hidden="true">&#x21bb;</span> Queued — will sync
              </span>
            ) : (
              <div className={styles.queueActions}>
                <button type="button" className={styles.queueActionButton} onClick={() => onMarkAttendance(e, 'attended')}>
                  I was there
                </button>
                <button type="button" className={styles.queueActionButtonSecondary} onClick={() => onMarkAttendance(e, 'missed')}>
                  Couldn&apos;t make it
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
