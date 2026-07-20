// T-43 (WP07 §12.8) — the Goal Commitment Card: income target, promotion timeline, top-three
// dreams, financial goals, the weekly-activity math, tied to the anchor statement.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface GoalCard {
  incomeTarget: string | null;
  promotionTimeline: string | null;
  topThreeDreams: string[];
  financialGoals: string[];
  weeklyActivityMath: { introductions: number; appointments: number; closes: number } | null;
}

export default function GoalCardPage() {
  const [card, setCard] = useState<GoalCard | null>(null);
  const [incomeTarget, setIncomeTarget] = useState('');
  const [promotionTimeline, setPromotionTimeline] = useState('');
  const [dreams, setDreams] = useState('');
  const [goals, setGoals] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/gamification/goal-card')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { card: GoalCard | null }) => {
        if (data.card) {
          setCard(data.card);
          setIncomeTarget(data.card.incomeTarget ?? '');
          setPromotionTimeline(data.card.promotionTimeline ?? '');
          setDreams(data.card.topThreeDreams.join(', '));
          setGoals(data.card.financialGoals.join(', '));
        }
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaved(false);
    const res = await fetch('/api/gamification/goal-card', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        incomeTarget,
        promotionTimeline,
        topThreeDreams: dreams.split(',').map((d) => d.trim()).filter(Boolean).slice(0, 3),
        financialGoals: goals.split(',').map((g) => g.trim()).filter(Boolean),
      }),
    });
    if (res.ok) {
      const updated = await res.json();
      setCard(updated);
      setSaved(true);
    }
  };

  return (
    <main className="shell section">
      <Link href="/today" className="badge">← Back to Today</Link>

      <section className="card panel wizard-block" style={{ marginTop: 18 }}>
        <span className="badge">Goal Commitment Card</span>
        <h1 style={{ marginTop: 12 }}>What you&apos;re building toward</h1>
        <p style={{ color: 'var(--muted)' }}>
          This is potential, not a promise — it depends on your effort, consistency, and market.
        </p>

        <label>
          Income target
          <input value={incomeTarget} onChange={(e) => setIncomeTarget(e.target.value)} placeholder="e.g. Replace my current income" />
        </label>

        <label>
          Promotion timeline
          <input value={promotionTimeline} onChange={(e) => setPromotionTimeline(e.target.value)} placeholder="e.g. Next rank in 6 months" />
        </label>

        <label>
          Top three dreams (comma-separated)
          <input value={dreams} onChange={(e) => setDreams(e.target.value)} placeholder="e.g. Pay off debt, Travel with family, Own a home" />
        </label>

        <label>
          Financial goals (comma-separated)
          <input value={goals} onChange={(e) => setGoals(e.target.value)} placeholder="e.g. Build an emergency fund, Save for retirement" />
        </label>

        <button type="button" className="btn btn-primary" onClick={save}>Save my commitment</button>
        {saved && <p className="badge">Saved</p>}
      </section>

      {card?.weeklyActivityMath && (
        <section className="card panel" style={{ marginTop: 18 }}>
          <span className="badge">Weekly activity math</span>
          <div className="metric-grid" style={{ marginTop: 16 }}>
            <div className="metric"><strong>{card.weeklyActivityMath.introductions}</strong><span>introductions/week</span></div>
            <div className="metric"><strong>{card.weeklyActivityMath.appointments}</strong><span>appointments/week</span></div>
            <div className="metric"><strong>{card.weeklyActivityMath.closes}</strong><span>closes/week</span></div>
          </div>
        </section>
      )}
    </main>
  );
}
