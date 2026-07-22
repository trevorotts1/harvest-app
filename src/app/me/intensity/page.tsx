'use client';

// T-57 R3b (E-M4, master-spec §4.5/§4.6, uiux §4.9) — Me -> Intensity.
//
// The Intensity Dial (Low/Medium/High) is set once during onboarding (`onboarding/components/
// IntensityDial.tsx`) and, before this build, had NO way to change afterward — uiux §4.9 is
// explicit that it "lives in onboarding and Me; changeable any time." This page is that missing
// post-onboarding surface: it REUSES the exact same `IntensityDial` component (same catalog copy,
// same radiogroup semantics, same consequence panel per position) rather than building a second
// implementation, wired to the NEW `/api/settings/intensity` route (GET/PATCH — this build's own
// addition; no prior endpoint changed `User.intensity_setting` after onboarding at all).
//
// "Changing intensity shows an effective-immediately confirmation" (§4.9): selecting a new position
// PATCHes immediately (no separate save step) and surfaces a plain confirmation banner. The dial's
// own "Continue" CTA (pre-existing onboarding.* copy — this page does not add a duplicate label)
// is repurposed here as a "done, back to Me" action once a choice is in effect.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IntensitySetting } from '@prisma/client';

import { useT } from '@/app/locale-context';
import { StatusMessage } from '@/components/StatusMessage';
import IntensityDial from '@/app/onboarding/components/IntensityDial';
import styles from './intensity.module.css';

type Load = 'loading' | 'ready' | 'failed';
type SaveNotice = 'saved' | 'failed' | null;

export default function IntensityPage() {
  const t = useT();
  const router = useRouter();
  const [load, setLoad] = useState<Load>('loading');
  const [value, setValue] = useState<IntensitySetting | null>(null);
  const [saveNotice, setSaveNotice] = useState<SaveNotice>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings/intensity');
        if (res.ok) {
          const body = (await res.json()) as { intensity_setting: IntensitySetting };
          setValue(body.intensity_setting);
          setLoad('ready');
        } else {
          setLoad('failed');
        }
      } catch {
        setLoad('failed');
      }
    })();
  }, []);

  async function choose(next: IntensitySetting) {
    setValue(next); // effective-immediately (§4.9) — applied optimistically, then persisted
    setSaveNotice(null);
    try {
      const res = await fetch('/api/settings/intensity', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intensity_setting: next }),
      });
      setSaveNotice(res.ok ? 'saved' : 'failed');
    } catch {
      setSaveNotice('failed');
    }
  }

  if (load === 'loading') {
    return (
      <main className={styles.page}>
        <p className={styles.loading}>{t('me.intensity.loading')}</p>
      </main>
    );
  }

  if (load === 'failed') {
    return (
      <main className={styles.page}>
        {/* T-57 RG7 (SC 4.1.3) — page-failed state announced via StatusMessage (role=alert). */}
        <StatusMessage className={styles.loading}>{t('me.intensity.loadFailed')}</StatusMessage>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>{t('me.intensity.heading')}</h1>
        <p className={styles.subhead}>{t('me.intensity.subhead')}</p>
      </header>

      <div className={styles.dialFrame}>
        <IntensityDial value={value} onChange={(next) => void choose(next)} onContinue={() => router.push('/me')} />
      </div>

      {saveNotice === 'saved' && (
        <p className={styles.notice} role="status">
          {t('me.intensity.saveNotice.saved')}
        </p>
      )}
      {saveNotice === 'failed' && (
        <p className={`${styles.notice} ${styles.noticeFailed}`} role="status">
          {t('me.intensity.saveNotice.failed')}
        </p>
      )}
    </main>
  );
}
