// T-57 R3c-1 (MAJOR-M7, master-spec §6.6; uiux §2.4 route map "`/onboarding/invite?invite_id={id}`
// — invite pre-seed"). Before this fix, this route 404'd — see the API route's own header
// (`src/app/api/onboarding/invite/route.ts`) for the full "orphaned since T-19" story and the
// documented scope boundary on what "pre-seeds sponsor + org + role" can honestly mean from THIS
// build unit's file ownership (this page + its own new API route only — not
// `OnboardingFlow.tsx`/`OrgStep.tsx`/`SponsorStep.tsx`, owned elsewhere).
//
// Deliberately UNAUTHENTICATED (no session exists yet for a fresh invite recipient) and NOT gated
// by `src/middleware.ts` (`/onboarding/*` is absent from its matcher by design).

'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

import { useT } from '@/app/locale-context';
import styles from './invite.module.css';

// `useSearchParams()` requires a Suspense boundary in the App Router (Next.js's own
// "missing-suspense-with-csr-bailout" build error otherwise) — same isolation pattern as
// `shift/page.tsx`'s `ShiftPageInner`: the Suspense fallback only ever covers the tiny
// `invite_id` read, never the whole card.

interface InviteSponsor {
  name: string | null;
  orgType: string | null;
  role: string | null;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'missing_param' }
  | { kind: 'not_found' }
  | { kind: 'expired' }
  | { kind: 'rejected' }
  | { kind: 'failed' }
  | { kind: 'ready'; sponsor: InviteSponsor; alreadyAccepted: boolean };

function OnboardingInvitePageInner() {
  const t = useT();
  const searchParams = useSearchParams();
  const inviteId = searchParams?.get('invite_id') ?? null;
  // `inviteId` is already known synchronously (useSearchParams resolves on the same tick) — a
  // missing param is decided in the initial state itself, not via an effect, so the honest
  // "missing invite code" message is what FIRST renders (server or client) rather than a flash of
  // "loading" that only later, client-side-only, corrects itself.
  const [state, setState] = useState<LoadState>(() => (inviteId ? { kind: 'loading' } : { kind: 'missing_param' }));

  useEffect(() => {
    if (!inviteId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/onboarding/invite?invite_id=${encodeURIComponent(inviteId)}`);
        const body = await res.json();
        if (cancelled) return;
        if (res.status === 404) {
          setState({ kind: 'not_found' });
        } else if (res.status === 410 && body.code === 'EXPIRED') {
          setState({ kind: 'expired' });
        } else if (res.status === 410 && body.code === 'REJECTED') {
          setState({ kind: 'rejected' });
        } else if (res.ok && body.ok) {
          setState({ kind: 'ready', sponsor: body.sponsor, alreadyAccepted: body.code === 'ALREADY_ACCEPTED' });
        } else {
          setState({ kind: 'failed' });
        }
      } catch {
        if (!cancelled) setState({ kind: 'failed' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteId]);

  // Forwarded onward as-is for whenever OnboardingFlow/OrgStep gain a real pre-seed prop (see this
  // page's file-header scope note) — harmless today (the onboarding entry reads no such params
  // yet), never a broken link either way.
  const continueHref =
    state.kind === 'ready'
      ? `/onboarding${state.sponsor.orgType ? `?orgType=${encodeURIComponent(state.sponsor.orgType)}&inviteId=${encodeURIComponent(inviteId ?? '')}` : ''}`
      : '/onboarding';

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.card}>
          {state.kind === 'loading' && <p>{t('invite.loading')}</p>}

          {state.kind === 'missing_param' && (
            <>
              <p>{t('invite.missingParamBody')}</p>
              <Link href="/onboarding" className={styles.primaryCta}>
                {t('invite.startFreshCta')}
              </Link>
            </>
          )}

          {state.kind === 'not_found' && (
            <>
              <p>{t('invite.notFoundBody')}</p>
              <Link href="/onboarding" className={styles.primaryCta}>
                {t('invite.startFreshCta')}
              </Link>
            </>
          )}

          {state.kind === 'expired' && (
            <>
              <p>{t('invite.expiredBody')}</p>
              <Link href="/onboarding" className={styles.primaryCta}>
                {t('invite.startFreshCta')}
              </Link>
            </>
          )}

          {state.kind === 'rejected' && (
            <>
              <p>{t('invite.rejectedBody')}</p>
              <Link href="/onboarding" className={styles.primaryCta}>
                {t('invite.startFreshCta')}
              </Link>
            </>
          )}

          {state.kind === 'failed' && <p role="alert">{t('invite.failedBody')}</p>}

          {state.kind === 'ready' && (
            <>
              <p className={styles.eyebrow}>{t('invite.eyebrow')}</p>
              <h1 className={styles.title}>
                {state.sponsor.name ? t('invite.greetingNamed', { name: state.sponsor.name }) : t('invite.greetingGeneric')}
              </h1>
              {state.alreadyAccepted ? (
                <p>{t('invite.alreadyAcceptedBody')}</p>
              ) : (
                <p>{t('invite.pendingBody')}</p>
              )}
              <Link href={continueHref} className={styles.primaryCta}>
                {t('invite.continueCta')}
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

// T-57 RE-GATE fix (D states re-gate sibling): `fallback={null}` rendered a truly blank screen for
// the brief window `useSearchParams()` needs to resolve — before this fix, an unauthenticated
// invite recipient's FIRST paint of this route could be nothing at all. Narrated instead, reusing
// the exact same `invite.loading` copy `OnboardingInvitePageInner`'s own `state.kind === 'loading'`
// branch renders one tick later (this boundary clears before that component even mounts, so it
// doesn't need a separate catalog key) — same page shell (`.page`/`.shell`/`.card`) so there's no
// visible flash/jump once the inner component takes over.
function OnboardingInviteLoadingFallback() {
  const t = useT();
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.card}>
          <p>{t('invite.loading')}</p>
        </div>
      </div>
    </main>
  );
}

export default function OnboardingInvitePage() {
  return (
    <Suspense fallback={<OnboardingInviteLoadingFallback />}>
      <OnboardingInvitePageInner />
    </Suspense>
  );
}
