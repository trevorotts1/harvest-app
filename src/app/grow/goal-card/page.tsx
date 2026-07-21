// T-43 (WP07 §12.8) — the Goal Commitment Card: income target, promotion timeline, top-three
// dreams, financial goals, the weekly-activity math, tied to the anchor statement.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { useT } from '@/app/locale-context';

interface GoalCard {
  incomeTarget: string | null;
  promotionTimeline: string | null;
  topThreeDreams: string[];
  financialGoals: string[];
  weeklyActivityMath: { introductions: number; appointments: number; closes: number } | null;
}

export default function GoalCardPage() {
  const t = useT();
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
      <Link href="/today" className="badge">{t('learn.backToToday')}</Link>

      <section className="card panel wizard-block" style={{ marginTop: 18 }}>
        <span className="badge">{t('learn.goalCard.badge')}</span>
        <h1 style={{ marginTop: 12 }}>{t('learn.goalCard.title')}</h1>
        <p style={{ color: 'var(--muted)' }}>
          {t('grow.goalCard.potentialNotPromise')}
        </p>

        <label>
          {t('grow.goalCard.incomeTargetLabel')}
          <input value={incomeTarget} onChange={(e) => setIncomeTarget(e.target.value)} placeholder={t('grow.goalCard.incomeTargetPlaceholder')} />
        </label>

        <label>
          {t('grow.goalCard.promotionTimelineLabel')}
          <input value={promotionTimeline} onChange={(e) => setPromotionTimeline(e.target.value)} placeholder={t('grow.goalCard.promotionTimelinePlaceholder')} />
        </label>

        <label>
          {t('grow.goalCard.topDreamsLabel')}
          <input value={dreams} onChange={(e) => setDreams(e.target.value)} placeholder={t('grow.goalCard.topDreamsPlaceholder')} />
        </label>

        <label>
          {t('grow.goalCard.financialGoalsLabel')}
          <input value={goals} onChange={(e) => setGoals(e.target.value)} placeholder={t('grow.goalCard.financialGoalsPlaceholder')} />
        </label>

        <button type="button" className="btn btn-primary" onClick={save}>{t('grow.goalCard.saveCommitmentCta')}</button>
        {saved && <p className="badge">{t('grow.goalCard.savedBadge')}</p>}
      </section>

      {card?.weeklyActivityMath && (
        <section className="card panel" style={{ marginTop: 18 }}>
          <span className="badge">{t('grow.goalCard.weeklyActivityMathBadge')}</span>
          <div className="metric-grid" style={{ marginTop: 16 }}>
            <div className="metric"><strong>{card.weeklyActivityMath.introductions}</strong><span>{t('grow.goalCard.introductionsPerWeek')}</span></div>
            <div className="metric"><strong>{card.weeklyActivityMath.appointments}</strong><span>{t('grow.goalCard.appointmentsPerWeek')}</span></div>
            <div className="metric"><strong>{card.weeklyActivityMath.closes}</strong><span>{t('grow.goalCard.closesPerWeek')}</span></div>
          </div>
        </section>
      )}
    </main>
  );
}
