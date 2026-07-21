// T-43 (WP07 §12.7, §12.9-7) — the Referral script generator UI. Every script is CFE-cleared
// server-side before it ever reaches this page's state — a held/flagged draft never renders as a
// usable script (see the API route + referral.service.ts).

'use client';

import { useState } from 'react';
import Link from 'next/link';

import { useT } from '@/app/locale-context';

const RELATIONSHIP_TYPES = [
  { key: 'family', labelKey: 'learn.referrals.relationshipTypes.family' },
  { key: 'friend', labelKey: 'learn.referrals.relationshipTypes.friend' },
  { key: 'work', labelKey: 'learn.referrals.relationshipTypes.work' },
  { key: 'church', labelKey: 'learn.referrals.relationshipTypes.church' },
  { key: 'neighbor', labelKey: 'learn.referrals.relationshipTypes.neighbor' },
  { key: 'former_coworker', labelKey: 'learn.referrals.relationshipTypes.formerCoworker' },
  { key: 'coach', labelKey: 'learn.referrals.relationshipTypes.coach' },
];

type DraftResult = { status: 'ok'; text: string; referralId: string | null } | { status: 'held'; reason: string; referralId: string | null };

export default function ReferralsPage() {
  const t = useT();
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
      <Link href="/learn" className="badge">{t('learn.backToLearnCta')}</Link>

      <section className="card panel wizard-block" style={{ marginTop: 18 }}>
        <span className="badge">{t('learn.referrals.title')}</span>
        <h1 style={{ marginTop: 12 }}>{t('learn.referrals.heading')}</h1>
        <p style={{ color: 'var(--muted)' }}>{t('learn.referrals.subtitle')}</p>

        <label>
          {t('learn.referrals.whoAskingLabel')}
          <select value={relationshipType} onChange={(e) => setRelationshipType(e.target.value)}>
            {RELATIONSHIP_TYPES.map((r) => (
              <option key={r.key} value={r.key}>{t(r.labelKey)}</option>
            ))}
          </select>
        </label>

        <label>
          {t('learn.referrals.lengthLabel')}
          <select value={channel} onChange={(e) => setChannel(e.target.value as 'SMS' | 'EMAIL')}>
            <option value="SMS">{t('learn.referrals.smsOption')}</option>
            <option value="EMAIL">{t('learn.referrals.emailOption')}</option>
          </select>
        </label>

        <button type="button" className="btn btn-primary" onClick={draft} disabled={loading}>
          {loading ? t('learn.referrals.draftingCta') : t('learn.referrals.draftScriptCta')}
        </button>
      </section>

      {result && result.status === 'ok' && (
        <section className="card panel" style={{ marginTop: 18 }}>
          <span className="badge">{t('learn.referrals.clearedBadge')}</span>
          <p style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{result.text}</p>
        </section>
      )}

      {result && result.status === 'held' && (
        <section className="card panel" style={{ marginTop: 18 }}>
          <p>
            {t('learn.referrals.heldTemplate', {
              reason:
                result.reason === 'model_unavailable'
                  ? t('learn.referrals.heldReason.modelUnavailable')
                  : t('learn.referrals.heldReason.needsReview'),
            })}
          </p>
        </section>
      )}
    </main>
  );
}
