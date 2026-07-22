// uiux §5.2 zone 6 — Team calendar strip: next 3 team events with one-tap attendance marking.
//
// QUEUED-OFFLINE (T-54, master-spec §17.6; uiux §4.2 "queued-offline"): `queuedOfflineEventIds` is a
// PAGE-owned, ephemeral, client-local set (never a server field on `CalendarEventItem` —
// `src/app/today/page.tsx` tracks it alongside its `PersistentOfflineQueue`, `src/app/today/offline.ts`).
// An event whose id is in the set renders the queued-offline state instead of the two attendance
// buttons — honest ("will sync"), never a button that looks live but silently does nothing offline.
//
// T-57 RG5-FINAL — this used to render `{e.type.replaceAll('_', ' ')}`: the raw `TeamEvent.type`
// backend token (prisma/schema.prisma: `opportunity_night | training | team_call | big_event`),
// merely de-snake-cased, never translated — a Spanish rep saw "opportunity night" verbatim, not
// "Noche de oportunidad". `eventTypeLabel` below maps the known tokens to catalog labels, REUSING
// the exact same `team.calendar.eventType.*` keys `team/calendar/page.tsx`'s own event-type <select>
// already ships (single source of truth for these 4 values — no duplicate namespace), and falls
// back to a generic localized "Team event" label for any future/unrecognized type — never the raw
// snake_case token. See `scripts/guard-rendered-i18n-leak.mjs`'s new shape for the guard that now
// catches a raw `.replaceAll('_', ' ')`/`.replace(/_/g, ' ')`-humanized token rendered as JSX content.

import styles from '../today.module.css';
import type { CalendarEventItem, CalendarZoneData, ZoneResult } from '@/services/mission-control/types';
import { useLocale } from '@/app/locale-context';
import { formatDateTime } from '@/lib/i18n/format';
import type { TVars } from '@/lib/i18n/catalog';

export interface CalendarStripProps {
  result: ZoneResult<CalendarZoneData>;
  onMarkAttendance: (event: CalendarEventItem, state: 'attended' | 'missed') => void | Promise<void>;
  /** T-54 — see this file's header "QUEUED-OFFLINE" note. Optional; omitted/empty for every
   *  existing caller (no behavior change when nothing is queued). */
  queuedOfflineEventIds?: ReadonlySet<string>;
}

/** The known `TeamEvent.type` values (prisma/schema.prisma's own comment on that column) → the
 *  SAME catalog keys `team/calendar/page.tsx`'s event-type <select> already uses. */
const EVENT_TYPE_CATALOG_KEY: Readonly<Record<string, string>> = {
  opportunity_night: 'team.calendar.eventType.opportunityNight',
  training: 'team.calendar.eventType.training',
  team_call: 'team.calendar.eventType.teamCall',
  big_event: 'team.calendar.eventType.bigEvent',
};

/** Resolves a raw `TeamEvent.type` token to its localized display label. An unrecognized/future
 *  token (the field is a free `String` column, not a Prisma enum — see the schema comment) falls
 *  back to a generic localized "Team event" label, never the raw snake_case token. */
function eventTypeLabel(t: (key: string, vars?: TVars) => string, type: string): string {
  const key = EVENT_TYPE_CATALOG_KEY[type];
  return t(key ?? 'today.calendarStrip.eventTypeGeneric');
}

export default function CalendarStrip({ result, onMarkAttendance, queuedOfflineEventIds }: CalendarStripProps) {
  const { locale, t } = useLocale();

  if (result.status === 'error') {
    return (
      <section className={styles.zoneCard} data-zone="calendar">
        <span className={styles.zoneBadge}>{t('today.calendarStrip.badge')}</span>
        <p className={styles.zoneErrorText} role="status">{result.message}</p>
      </section>
    );
  }

  if (!result.data.hasOrg) {
    return (
      <section className={styles.zoneCard} data-zone="calendar">
        <span className={styles.zoneBadge}>{t('today.calendarStrip.badge')}</span>
        <p className={styles.narrativeLine}>{t('today.calendarStrip.noOrgNarrative')}</p>
      </section>
    );
  }

  if (result.data.events.length === 0) {
    return (
      <section className={styles.zoneCard} data-zone="calendar">
        <span className={styles.zoneBadge}>{t('today.calendarStrip.badge')}</span>
        <p className={styles.narrativeLine}>{t('today.calendarStrip.quietNarrative')}</p>
      </section>
    );
  }

  return (
    <section className={styles.zoneCard} data-zone="calendar">
      <span className={styles.zoneBadge}>{t('today.calendarStrip.badge')}</span>
      <ul className={styles.calendarList}>
        {result.data.events.map((e) => (
          <li key={e.id} className={styles.calendarRow}>
            <div>
              <strong>{eventTypeLabel(t, e.type)}</strong>
              <span className={styles.queueMeta}>{formatDateTime(locale, e.startsAt)}</span>
            </div>
            {e.attendanceState === 'attended' || e.attendanceState === 'missed' ? (
              <span className={styles.attendanceMarked}>{e.attendanceState === 'attended' ? t('today.calendarStrip.attendedCta') : t('today.calendarStrip.missedCta')}</span>
            ) : queuedOfflineEventIds?.has(e.id) ? (
              <span className={styles.queueQueuedOffline} role="status">
                <span aria-hidden="true">{t('today.actionQueue.reloadIcon')}</span> {t('today.actionQueue.queuedWillSync')}
              </span>
            ) : (
              <div className={styles.queueActions}>
                <button type="button" className={styles.queueActionButton} onClick={() => onMarkAttendance(e, 'attended')}>
                  {t('today.calendarStrip.attendedCta')}
                </button>
                <button type="button" className={styles.queueActionButtonSecondary} onClick={() => onMarkAttendance(e, 'missed')}>
                  {t('today.calendarStrip.missedCta')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
