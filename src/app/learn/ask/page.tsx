// T-43 (WP07 §12.8 P1, §12.9-9) — Ask Harvest: an in-app coach clearly labeled as coaching, grounded
// exclusively in the course/objection/doctrine sources. Never sends anything outbound — this page has
// no send action at all.

'use client';

import { useState } from 'react';
import Link from 'next/link';

import { useT } from '@/app/locale-context';

interface AskResult {
  status: 'ok' | 'refused' | 'held';
  label: 'coaching';
  answer: string | null;
}

export default function AskHarvestPage() {
  const t = useT();
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<{ question: string; result: AskResult }[]>([]);

  const ask = async () => {
    if (!question.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/gamification/ask-harvest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = (await res.json()) as AskResult;
      setHistory((h) => [...h, { question, result: data }]);
      setQuestion('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="shell section">
      <Link href="/learn" className="badge">{t('learn.backToLearnCta')}</Link>

      <section className="card panel" style={{ marginTop: 18 }}>
        <span className="badge">{t('learn.ask.badge')}</span>
        <h1 style={{ marginTop: 12 }}>{t('learn.ask.heading')}</h1>
        <p style={{ color: 'var(--muted)' }}>
          {t('learn.ask.subtitle')}
        </p>

        <div className="stack" style={{ marginTop: 16 }}>
          {history.map((entry, i) => (
            <div key={i} className="action-row" style={{ display: 'block' }}>
              <strong>{t('learn.ask.youAskedLabel')}</strong> {entry.question}
              <p style={{ marginTop: 8 }}>
                <span className="badge">{entry.result.label}</span>{' '}
                {entry.result.answer ?? t('learn.ask.heldFallback')}
              </p>
            </div>
          ))}
        </div>

        <label style={{ marginTop: 16, display: 'block' }}>
          {t('learn.ask.questionLabel')}
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('learn.ask.questionPlaceholder')} />
        </label>
        <button type="button" className="btn btn-primary" onClick={ask} disabled={loading}>
          {loading ? t('learn.ask.thinkingCta') : t('learn.ask.askCta')}
        </button>
      </section>
    </main>
  );
}
