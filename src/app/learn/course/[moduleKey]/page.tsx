// T-43 (WP07 §12.8, §12.9-8) — a single course module reader + complete button. Module completion
// credits the Momentum Score exactly once (idempotent) via POST /api/gamification/course/complete.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

// The module body/title are static, curated content (course-catalog.ts) — fetched via the same
// progress endpoint (which returns every module's title/summary) plus a small static import for the
// full body text, avoiding a second round-trip API just for read-only static copy.
import { COURSE_MODULES } from '@/services/gamification/course-catalog';
import { useT } from '@/app/locale-context';

export default function CourseModulePage({ params }: { params: { moduleKey: string } }) {
  const t = useT();
  const { moduleKey } = params;
  const courseModule = COURSE_MODULES.find((m) => m.key === moduleKey);
  const [completed, setCompleted] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/gamification/course')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { modules: { key: string; status: string }[] }) => {
        const found = data.modules.find((m) => m.key === moduleKey);
        setCompleted(found?.status === 'COMPLETED');
      })
      .catch(() => {});
  }, [moduleKey]);

  const complete = async () => {
    setSaving(true);
    const res = await fetch('/api/gamification/course/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ moduleKey }),
    });
    setSaving(false);
    if (res.ok) setCompleted(true);
  };

  if (!courseModule) {
    return (
      <main className="shell section">
        <Link href="/learn" className="badge">{t('learn.backToLearnCta')}</Link>
        <section className="card panel" style={{ marginTop: 18 }}>
          <p>{t('learn.courseModule.notFound')}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="shell section">
      <Link href="/learn" className="badge">{t('learn.backToLearnCta')}</Link>
      <section className="card panel" style={{ marginTop: 18 }}>
        <span className="badge">{t('learn.courseModule.moduleBadge', { order: courseModule.order })}</span>
        <h1 style={{ marginTop: 12 }}>{courseModule.title}</h1>
        <p style={{ lineHeight: 1.7, marginTop: 12 }}>{courseModule.body}</p>
        <button type="button" className="btn btn-primary" style={{ marginTop: 18 }} onClick={complete} disabled={completed || saving}>
          {completed ? t('learn.courseModule.completedCta') : saving ? t('learn.courseModule.savingCta') : t('learn.courseModule.markCompleteCta')}
        </button>
      </section>
    </main>
  );
}
