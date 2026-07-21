// T-43 (WP07 §12.8; uiux §2.1 "Learn" destination) — the Learn home: the Downline Maxxing course
// (disclosed placeholder-plus-roadmap, uiux §6.6 "never renders as under-construction"), the streak
// bar (§12.5), and links to the referral script generator and Ask Harvest.

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { useT } from '@/app/locale-context';
import CourseModulesList, { type CourseLoadState, type CourseModuleSummary } from './components/CourseModulesList';

interface StreakSummary {
  currentStreakDays: number;
  longestStreakDays: number;
  graceDayAvailableThisWeek: boolean;
  last7Days: { date: string; qualified: boolean; wasGraceDay: boolean }[];
}

export default function LearnPage() {
  const t = useT();
  const [modules, setModules] = useState<CourseModuleSummary[]>([]);
  const [disclosure, setDisclosure] = useState('');
  const [streak, setStreak] = useState<StreakSummary | null>(null);
  // T-55 (master-spec §17.7 / uiux §6.6 "Learn → fully populated from day zero ... never renders as
  // under-construction") — the course list previously had no loading/failed tracking at all: a
  // transient fetch failure left `modules` at its initial `[]` forever with no narrative, so the
  // "Course modules" section rendered its header over a silently empty list — a narrative-free blank
  // region (SC9). This tracks the real state so a genuine zero/failure always renders a next step.
  const [courseState, setCourseState] = useState<CourseLoadState>('loading');

  const loadCourse = useCallback(() => {
    setCourseState('loading');
    fetch('/api/gamification/course')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { modules: CourseModuleSummary[]; roadmapDisclosure: string }) => {
        setModules(data.modules);
        setDisclosure(data.roadmapDisclosure);
        setCourseState('ready');
      })
      .catch(() => setCourseState('failed'));
  }, []);

  useEffect(() => {
    loadCourse();
    fetch('/api/gamification/streak')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: StreakSummary) => setStreak(data))
      .catch(() => {});
  }, [loadCourse]);

  return (
    <main className="shell section">
      <Link href="/today" className="badge">{t('learn.backToToday')}</Link>

      <section className="card panel" style={{ marginTop: 18 }}>
        <span className="badge">{t('learn.courseBadge')}</span>
        <h1 style={{ marginTop: 12 }}>{t('learn.title')}</h1>
        {courseState === 'ready' && <p style={{ color: 'var(--muted)' }}>{disclosure}</p>}
        {courseState === 'loading' && <p style={{ color: 'var(--muted)' }}>{t('learn.loadingCourse')}</p>}
        {courseState === 'failed' && (
          <p style={{ color: 'var(--muted)' }}>
            {t('learn.loadFailed')}{' '}
            <button type="button" className="badge" onClick={loadCourse} style={{ cursor: 'pointer' }}>
              {t('learn.retry')}
            </button>
          </p>
        )}
      </section>

      {streak && (
        <section className="card panel" style={{ marginTop: 18 }}>
          <span className="badge">
            {t('learn.streakBadge', { count: streak.currentStreakDays, plural: streak.currentStreakDays === 1 ? '' : 's' })}
          </span>
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }} aria-label={t('learn.streakBar.ariaLabel')}>
            {streak.last7Days.map((day) => (
              <span
                key={day.date}
                title={
                  day.wasGraceDay
                    ? t('learn.streakBar.dayTitle.graceDayUsed')
                    : day.qualified
                      ? t('learn.streakBar.dayTitle.qualified')
                      : t('learn.streakBar.dayTitle.readyWhenYouAre')
                }
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  display: 'grid',
                  placeItems: 'center',
                  background: day.qualified ? 'var(--leaf, #4b7a4f)' : 'transparent',
                  border: '1px solid var(--line)',
                }}
              >
                {day.wasGraceDay ? '♥' : day.qualified ? '✓' : ''}
              </span>
            ))}
          </div>
          {streak.graceDayAvailableThisWeek && <p style={{ color: 'var(--muted)', marginTop: 8 }}>{t('learn.graceDayAvailable')}</p>}
        </section>
      )}

      <section className="grid-3" style={{ marginTop: 18 }}>
        <Link href="/learn/referrals" className="card feature">
          <span className="badge">{t('learn.referralScripts.badge')}</span>
          <h3 style={{ marginTop: 12 }}>{t('learn.referralScripts.title')}</h3>
          <p>{t('learn.referralScripts.body')}</p>
        </Link>
        <Link href="/learn/ask" className="card feature">
          <span className="badge">{t('learn.coaching.badge')}</span>
          <h3 style={{ marginTop: 12 }}>{t('learn.coaching.title')}</h3>
          <p>{t('learn.coaching.body')}</p>
        </Link>
        <Link href="/grow/goal-card" className="card feature">
          <span className="badge">{t('learn.goalCard.badge')}</span>
          <h3 style={{ marginTop: 12 }}>{t('learn.goalCard.title')}</h3>
          <p>{t('learn.goalCard.body')}</p>
        </Link>
      </section>

      <section className="card panel" style={{ marginTop: 18 }}>
        <span className="badge">{t('learn.courseModulesBadge')}</span>
        <CourseModulesList state={courseState} modules={modules} onRetry={loadCourse} />
      </section>
    </main>
  );
}
