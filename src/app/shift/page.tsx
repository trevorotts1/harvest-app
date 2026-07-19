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

import ShiftView from './ShiftView';

function ShiftPageInner() {
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode') === 'short' ? 'short' : 'standard';

  return <ShiftView mode={mode} />;
}

export default function ShiftPage() {
  return (
    <Suspense fallback={null}>
      <ShiftPageInner />
    </Suspense>
  );
}
