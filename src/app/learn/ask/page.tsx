// T-43 (WP07 §12.8 P1, §12.9-9) — Ask Harvest: an in-app coach clearly labeled as coaching, grounded
// exclusively in the course/objection/doctrine sources. Never sends anything outbound — this page has
// no send action at all.

'use client';

import { useState } from 'react';
import Link from 'next/link';

interface AskResult {
  status: 'ok' | 'refused' | 'held';
  label: 'coaching';
  answer: string | null;
}

export default function AskHarvestPage() {
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
      <Link href="/learn" className="badge">← Back to Learn</Link>

      <section className="card panel" style={{ marginTop: 18 }}>
        <span className="badge">Ask Harvest — coaching, not sent to anyone</span>
        <h1 style={{ marginTop: 12 }}>What do you need help saying?</h1>
        <p style={{ color: 'var(--muted)' }}>
          Grounded in the Downline Maxxing course and the objection scripts — never legal, tax, or
          earnings advice.
        </p>

        <div className="stack" style={{ marginTop: 16 }}>
          {history.map((entry, i) => (
            <div key={i} className="action-row" style={{ display: 'block' }}>
              <strong>You asked:</strong> {entry.question}
              <p style={{ marginTop: 8 }}>
                <span className="badge">{entry.result.label}</span>{' '}
                {entry.result.answer ?? 'Held — try again in a moment.'}
              </p>
            </div>
          ))}
        </div>

        <label style={{ marginTop: 16, display: 'block' }}>
          Your question
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. What do I say when someone thinks this is a pyramid scheme?" />
        </label>
        <button type="button" className="btn btn-primary" onClick={ask} disabled={loading}>
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </section>
    </main>
  );
}
