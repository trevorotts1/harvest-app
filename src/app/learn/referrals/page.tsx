// T-43 (WP07 §12.7, §12.9-7) — the Referral script generator UI. Every script is CFE-cleared
// server-side before it ever reaches this page's state — a held/flagged draft never renders as a
// usable script (see the API route + referral.service.ts).

'use client';

import { useState } from 'react';
import Link from 'next/link';

const RELATIONSHIP_TYPES = [
  { key: 'family', label: 'Family' },
  { key: 'friend', label: 'Friend' },
  { key: 'work', label: 'Work colleague' },
  { key: 'church', label: 'Church / faith community' },
  { key: 'neighbor', label: 'Neighbor' },
  { key: 'former_coworker', label: 'Former coworker' },
  { key: 'coach', label: 'Coach / mentor' },
];

type DraftResult = { status: 'ok'; text: string; referralId: string | null } | { status: 'held'; reason: string; referralId: string | null };

export default function ReferralsPage() {
  const [relationshipType, setRelationshipType] = useState('family');
  const [channel, setChannel] = useState<'SMS' | 'EMAIL'>('SMS');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DraftResult | null>(null);

  const draft = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/gamification/referrals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ relationshipType, channel }),
      });
      const data = (await res.json()) as DraftResult;
      setResult(data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="shell section">
      <Link href="/learn" className="badge">← Back to Learn</Link>

      <section className="card panel wizard-block" style={{ marginTop: 18 }}>
        <span className="badge">Referral script generator</span>
        <h1 style={{ marginTop: 12 }}>Ask for a warm introduction</h1>
        <p style={{ color: 'var(--muted)' }}>Every script is compliance-cleared before you see it.</p>

        <label>
          Who are you asking?
          <select value={relationshipType} onChange={(e) => setRelationshipType(e.target.value)}>
            {RELATIONSHIP_TYPES.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
        </label>

        <label>
          Length
          <select value={channel} onChange={(e) => setChannel(e.target.value as 'SMS' | 'EMAIL')}>
            <option value="SMS">Text message (short)</option>
            <option value="EMAIL">Email (longer)</option>
          </select>
        </label>

        <button type="button" className="btn btn-primary" onClick={draft} disabled={loading}>
          {loading ? 'Drafting…' : 'Draft my script'}
        </button>
      </section>

      {result && result.status === 'ok' && (
        <section className="card panel" style={{ marginTop: 18 }}>
          <span className="badge">Cleared and ready</span>
          <p style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{result.text}</p>
        </section>
      )}

      {result && result.status === 'held' && (
        <section className="card panel" style={{ marginTop: 18 }}>
          <p>
            This draft is held for a compliance check ({result.reason === 'model_unavailable' ? 'your agents are resting — nothing was lost' : 'needs a quick review'}) —
            try again in a moment.
          </p>
        </section>
      )}
    </main>
  );
}
