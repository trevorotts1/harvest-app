// uiux §5.3 route: /shift (and /shift?mode=short for the 10-minute re-engagement variant,
// AC-5.3-4). Client-rendered — the ritual is a stateful, resumable, per-day flow driven by the
// authenticated session's own T-34 state, same rationale as /ritual/warm-market's page.tsx.
//
// `useSearchParams()` requires a Suspense boundary in the App Router (it bails out of static
// rendering otherwise — Next.js's own "missing-suspense-with-csr-bailout" build error) — the inner
// component is isolated so the Suspense fallback only ever covers the tiny mode-read, never the
// whole ritual shell.
'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

import { useT } from '@/app/locale-context';
import ShiftView from './ShiftView';
import styles from './shift.module.css';

function ShiftPageInner() {
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode') === 'short' ? 'short' : 'standard';

  return <ShiftView mode={mode} />;
}

// T-57 RE-GATE fix (D states re-gate sibling): `fallback={null}` rendered a truly blank screen for
// the brief window `useSearchParams()` needs to resolve — this is the identical pre-existing
// pattern flagged (and fixed) at onboarding/invite/page.tsx:154. Narrated instead, reusing the
// same `shift.loading.narrativeLine` copy ShiftView's own `!shift` loading branch renders — this
// boundary is strictly shorter-lived than that one (it clears before ShiftView even mounts), so it
// doesn't need its own separate catalog key.
function ShiftPageLoadingFallback() {
  const t = useT();
  return (
    <div className={styles.shell} aria-busy="true">
      <div className={styles.focusShell}>
        <p className={styles.loadingNarrative}>{t('shift.loading.narrativeLine')}</p>
      </div>
    </div>
  );
}

export default function ShiftPage() {
  return (
    <Suspense fallback={<ShiftPageLoadingFallback />}>
      <ShiftPageInner />
    </Suspense>
  );
}
