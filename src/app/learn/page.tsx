// T-43 (WP07 §12.8; uiux §2.1 "Learn" destination) — the Learn home: the Downline Maxxing course
// (disclosed placeholder-plus-roadmap, uiux §6.6 "never renders as under-construction"), the streak
// bar (§12.5), and links to the referral script generator and Ask Harvest.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface CourseModuleSummary {
  key: string;
  order: number;
  title: string;
  summary: string;
  status: string;
  completedAt: string | null;
}

interface StreakSummary {
  currentStreakDays: number;
  longestStreakDays: number;
  graceDayAvailableThisWeek: boolean;
  last7Days: { date: string; qualified: boolean; wasGraceDay: boolean }[];
}

export default function LearnPage() {
  const [modules, setModules] = useState<CourseModuleSummary[]>([]);
  const [disclosure, setDisclosure] = useState('');
  const [streak, setStreak] = useState<StreakSummary | null>(null);

  useEffect(() => {
    fetch('/api/gamification/course')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { modules: CourseModuleSummary[]; roadmapDisclosure: string }) => {
        setModules(data.modules);
        setDisclosure(data.roadmapDisclosure);
      })
      .catch(() => {});
    fetch('/api/gamification/streak')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: StreakSummary) => setStreak(data))
      .catch(() => {});
  }, []);

  return (
    <main className="shell section">
      <Link href="/today" className="badge">← Back to Today</Link>

      <section className="card panel" style={{ marginTop: 18 }}>
        <span className="badge">Downline Maxxing course</span>
        <h1 style={{ marginTop: 12 }}>Learn</h1>
        <p style={{ color: 'var(--muted)' }}>{disclosure}</p>
      </section>

      {streak && (
        <section className="card panel" style={{ marginTop: 18 }}>
          <span className="badge">Streak — {streak.currentStreakDays} day{streak.currentStreakDays === 1 ? '' : 's'}</span>
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }} aria-label="7 day streak bar">
            {streak.last7Days.map((day) => (
              <span
                key={day.date}
                title={day.wasGraceDay ? 'grace day used' : day.qualified ? 'qualified' : 'ready when you are'}
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
          {streak.graceDayAvailableThisWeek && <p style={{ color: 'var(--muted)', marginTop: 8 }}>A grace day is available this week if you need it — life happens.</p>}
        </section>
      )}

      <section className="grid-3" style={{ marginTop: 18 }}>
        <Link href="/learn/referrals" className="card feature">
          <span className="badge">Referral scripts</span>
          <h3 style={{ marginTop: 12 }}>Ask for an introduction</h3>
          <p>Relationship-typed, CFE-cleared scripts for family, friends, work, church, and more.</p>
        </Link>
        <Link href="/learn/ask" className="card feature">
          <span className="badge">Coaching</span>
          <h3 style={{ marginTop: 12 }}>Ask Harvest</h3>
          <p>Grounded coaching from the course and objection scripts — in your own voice.</p>
        </Link>
        <Link href="/grow/goal-card" className="card feature">
          <span className="badge">Goal Commitment Card</span>
          <h3 style={{ marginTop: 12 }}>What you&apos;re building toward</h3>
          <p>Income target, promotion timeline, and your top dreams — tied to your anchor.</p>
        </Link>
      </section>

      <section className="card panel" style={{ marginTop: 18 }}>
        <span className="badge">Course modules</span>
        <div className="stack" style={{ marginTop: 16 }}>
          {modules.map((m) => (
            <Link key={m.key} href={`/learn/course/${m.key}`} className="action-row" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="priority">{m.order}</span>
              <div>
                <strong>{m.title}</strong><br />
                <span style={{ color: 'var(--muted)' }}>{m.summary}</span>
              </div>
              <span className="badge">{m.status === 'COMPLETED' ? 'Done' : m.status === 'IN_PROGRESS' ? 'In progress' : 'Start'}</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
