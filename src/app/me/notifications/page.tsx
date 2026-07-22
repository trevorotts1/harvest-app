'use client';

// T-57 R3b (MAJOR-D3, master-spec §12.6/§12.9-6, uiux §6.5/§6.6) — Me -> Notifications.
//
// Before this build `/api/gamification/notifications/preferences` (T-43) had ZERO UI — the rep's
// own timing/on-off control over Morning Briefing, Midday Motivation, and Evening Recap, plus their
// own notification quiet hours (distinct from recipient TCPA quiet hours, §10.4), was backend-only.
// This page is that UI, wired to the REAL route contract (GET/PATCH, both onboarding-gated):
//   GET  /api/gamification/notifications/preferences
//     -> { morning_briefing_enabled, morning_briefing_time, midday_motivation_enabled,
//          evening_recap_enabled, quiet_hours_start, quiet_hours_end, timezone }
//   PATCH /api/gamification/notifications/preferences  (any subset of the above)
// Action Alerts, Milestone Celebrations, and Billing/security are DELIBERATELY absent from the
// mutable form (§12.9-6 "unmutable by design") — surfaced instead as a plain "always on" notice so
// the rep understands why there's no toggle for them, never a silent omission.
//
// The "quiet so far" empty state (uiux §6.6's named notifications-center variant) reads the real,
// append-only `NotificationLog` (T-43) via the new GET /api/gamification/notifications/log
// (own-data-only, read-only) — an empty result IS "quiet so far"; this never fakes activity.
//
// Reached from the Me hub (/me — src/app/me/page.tsx), which the existing middleware `/me/:path*`
// matcher already auth-gates AND onboarding-gates, same convention as every other Me sub-page.

import { useEffect, useState } from 'react';

import { useLocale } from '@/app/locale-context';
import { StatusMessage } from '@/components/StatusMessage';
import { formatDateTime } from '@/lib/i18n/format';
import styles from './notifications.module.css';

interface NotificationPreferences {
  morning_briefing_enabled: boolean;
  morning_briefing_time: string;
  midday_motivation_enabled: boolean;
  evening_recap_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  timezone: string;
}

interface NotificationLogItem {
  type: string;
  deep_link: string | null;
  unmutable: boolean;
  created_at: string;
}

type Load = 'loading' | 'ready' | 'failed';
type SaveNotice = 'saved' | 'failed' | null;

const ACTIVITY_LABEL_KEY: Record<string, string> = {
  MORNING_BRIEFING: 'me.notifications.activity.itemLabel.morningBriefing',
  MIDDAY_MOTIVATION: 'me.notifications.activity.itemLabel.middayMotivation',
  EVENING_RECAP: 'me.notifications.activity.itemLabel.eveningRecap',
  ACTION_ALERT: 'me.notifications.activity.itemLabel.actionAlert',
  INACTIVITY_NUDGE: 'me.notifications.activity.itemLabel.inactivityNudge',
  MILESTONE_CELEBRATION: 'me.notifications.activity.itemLabel.milestoneCelebration',
  APPROVAL_WAITING: 'me.notifications.activity.itemLabel.approvalWaiting',
  BILLING_SECURITY: 'me.notifications.activity.itemLabel.billingSecurity',
};

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Sao_Paulo',
  'America/Mexico_City',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Berlin',
  'Africa/Lagos',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

/** Feature-detects `Intl.supportedValuesOf` (not universally available); falls back to a curated
 *  list + whatever the rep's saved value already is, so the select never drops the current choice. */
function timezoneOptions(current: string): string[] {
  let zones: string[];
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    zones = typeof supported === 'function' ? supported('timeZone') : COMMON_TIMEZONES;
  } catch {
    zones = COMMON_TIMEZONES;
  }
  return zones.includes(current) ? zones : [current, ...zones];
}

export default function NotificationsPage() {
  const { locale, t } = useLocale();
  const [load, setLoad] = useState<Load>('loading');
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [logItems, setLogItems] = useState<NotificationLogItem[] | null>(null);
  const [saveNotice, setSaveNotice] = useState<SaveNotice>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/gamification/notifications/preferences');
        if (res.ok) {
          setPrefs((await res.json()) as NotificationPreferences);
          setLoad('ready');
        } else {
          setLoad('failed');
        }
      } catch {
        setLoad('failed');
      }
      try {
        const logRes = await fetch('/api/gamification/notifications/log');
        if (logRes.ok) {
          const body = (await logRes.json()) as { items: NotificationLogItem[] };
          setLogItems(body.items);
        }
      } catch {
        // Best-effort — the "quiet so far" section simply stays unpopulated; never blocks the page.
      }
    })();
  }, []);

  async function save(patch: Partial<NotificationPreferences>) {
    if (!prefs) return;
    const next = { ...prefs, ...patch };
    setPrefs(next); // apply immediately (§4.9-style effective-immediately convention)
    setSaveNotice(null);
    try {
      const res = await fetch('/api/gamification/notifications/preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      setSaveNotice(res.ok ? 'saved' : 'failed');
    } catch {
      setSaveNotice('failed');
    }
  }

  if (load === 'loading') {
    return (
      <main className={styles.page}>
        <p className={styles.loading}>{t('me.notifications.loading')}</p>
      </main>
    );
  }

  if (load === 'failed' || !prefs) {
    return (
      <main className={styles.page}>
        {/* T-57 RG7 (SC 4.1.3) — page-failed state announced via StatusMessage (role=alert). */}
        <StatusMessage className={styles.loading}>{t('me.notifications.loadFailed')}</StatusMessage>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>{t('me.notifications.heading')}</h1>
        <p className={styles.subhead}>{t('me.notifications.subhead')}</p>
      </header>

      {/* uiux §6.6 named variant: "notifications center -> 'quiet so far'" */}
      <section className={styles.card} aria-label={t('me.notifications.activity.heading')}>
        <h2 className={styles.sectionTitle}>{t('me.notifications.activity.heading')}</h2>
        {logItems && logItems.length > 0 ? (
          <ul className={styles.activityList}>
            {logItems.map((item, idx) => (
              <li key={`${item.type}-${idx}`} className={styles.activityRow}>
                <span className={styles.activityLabel}>
                  {t(ACTIVITY_LABEL_KEY[item.type] ?? 'me.notifications.activity.itemLabel.billingSecurity')}
                </span>
                <span className={styles.activityMeta}>
                  {formatDateTime(locale, item.created_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.quietSoFar}>
            <p className={styles.activityLabel}>{t('me.notifications.activity.quietSoFar')}</p>
            <p className={styles.quietSoFarBody}>{t('me.notifications.activity.hint')}</p>
          </div>
        )}
      </section>

      <section className={styles.card} aria-label={t('me.notifications.morningBriefing.title')}>
        <div className={styles.prefRow}>
          <div className={styles.prefText}>
            <p className={styles.prefTitle}>{t('me.notifications.morningBriefing.title')}</p>
            <p className={styles.prefDesc}>{t('me.notifications.morningBriefing.desc')}</p>
          </div>
          <div className={styles.prefControls}>
            <label className={styles.timeField}>
              <span className={styles.timeLabel}>{t('me.notifications.morningBriefing.timeLabel')}</span>
              <input
                type="time"
                className={styles.timeInput}
                value={prefs.morning_briefing_time}
                onChange={(e) => void save({ morning_briefing_time: e.target.value })}
                disabled={!prefs.morning_briefing_enabled}
              />
            </label>
            <button
              type="button"
              role="switch"
              aria-checked={prefs.morning_briefing_enabled}
              aria-label={t('me.notifications.morningBriefing.title')}
              className={`${styles.toggle} ${prefs.morning_briefing_enabled ? styles.toggleOn : ''}`.trim()}
              onClick={() => void save({ morning_briefing_enabled: !prefs.morning_briefing_enabled })}
            >
              <span className={styles.toggleKnob} aria-hidden="true" />
              <span className={styles.toggleState}>
                {prefs.morning_briefing_enabled ? t('me.notifications.toggle.on') : t('me.notifications.toggle.off')}
              </span>
            </button>
          </div>
        </div>

        <div className={styles.prefRow}>
          <div className={styles.prefText}>
            <p className={styles.prefTitle}>{t('me.notifications.midday.title')}</p>
            <p className={styles.prefDesc}>{t('me.notifications.midday.desc')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.midday_motivation_enabled}
            aria-label={t('me.notifications.midday.title')}
            className={`${styles.toggle} ${prefs.midday_motivation_enabled ? styles.toggleOn : ''}`.trim()}
            onClick={() => void save({ midday_motivation_enabled: !prefs.midday_motivation_enabled })}
          >
            <span className={styles.toggleKnob} aria-hidden="true" />
            <span className={styles.toggleState}>
              {prefs.midday_motivation_enabled ? t('me.notifications.toggle.on') : t('me.notifications.toggle.off')}
            </span>
          </button>
        </div>

        <div className={styles.prefRow}>
          <div className={styles.prefText}>
            <p className={styles.prefTitle}>{t('me.notifications.evening.title')}</p>
            <p className={styles.prefDesc}>{t('me.notifications.evening.desc')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.evening_recap_enabled}
            aria-label={t('me.notifications.evening.title')}
            className={`${styles.toggle} ${prefs.evening_recap_enabled ? styles.toggleOn : ''}`.trim()}
            onClick={() => void save({ evening_recap_enabled: !prefs.evening_recap_enabled })}
          >
            <span className={styles.toggleKnob} aria-hidden="true" />
            <span className={styles.toggleState}>
              {prefs.evening_recap_enabled ? t('me.notifications.toggle.on') : t('me.notifications.toggle.off')}
            </span>
          </button>
        </div>

        {saveNotice === 'saved' && <p className={styles.notice} role="status">{t('me.notifications.saveNotice.saved')}</p>}
        {saveNotice === 'failed' && <p className={`${styles.notice} ${styles.noticeFailed}`} role="status">{t('me.notifications.saveNotice.failed')}</p>}
      </section>

      <section className={styles.card} aria-label={t('me.notifications.quietHours.title')}>
        <h2 className={styles.sectionTitle}>{t('me.notifications.quietHours.title')}</h2>
        <p className={styles.sectionDesc}>{t('me.notifications.quietHours.desc')}</p>
        <div className={styles.prefControls}>
          <label className={styles.timeField}>
            <span className={styles.timeLabel}>{t('me.notifications.quietHours.startLabel')}</span>
            <input
              type="time"
              className={styles.timeInput}
              value={prefs.quiet_hours_start}
              onChange={(e) => void save({ quiet_hours_start: e.target.value })}
            />
          </label>
          <label className={styles.timeField}>
            <span className={styles.timeLabel}>{t('me.notifications.quietHours.endLabel')}</span>
            <input
              type="time"
              className={styles.timeInput}
              value={prefs.quiet_hours_end}
              onChange={(e) => void save({ quiet_hours_end: e.target.value })}
            />
          </label>
        </div>
      </section>

      <section className={styles.card} aria-label={t('me.notifications.timezone.title')}>
        <h2 className={styles.sectionTitle}>{t('me.notifications.timezone.title')}</h2>
        <p className={styles.sectionDesc}>{t('me.notifications.timezone.desc')}</p>
        <select
          className={styles.selectField}
          aria-label={t('me.notifications.timezone.title')}
          value={prefs.timezone}
          onChange={(e) => void save({ timezone: e.target.value })}
        >
          {timezoneOptions(prefs.timezone).map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </section>

      <section className={styles.card} aria-label={t('me.notifications.alwaysOn.title')}>
        <h2 className={styles.sectionTitle}>{t('me.notifications.alwaysOn.title')}</h2>
        <p className={styles.sectionDesc}>{t('me.notifications.alwaysOn.desc')}</p>
      </section>
    </main>
  );
}
