// WP08 §13.1/§13.6-7, uiux AC-5.5-5 — the time-lapse + share control. The share button shows the
// `shield-cfe` "checking" state, then either the share result on pass or the blocked state + reason
// on fail (uiux §5.5) — it NEVER hands the export to the client until the CFE has released it.
//
// T-R30 GAP 2 (parity remediation): before this fix, a `released` verdict rendered ONLY the status
// text below — no actual way to get the cleared content out of the app existed at all (T-51). This
// adds the real mechanism: `navigator.share()` where the browser supports it (feature-detected, never
// assumed), falling back to a same-session Blob "Download" link + a clipboard "Copy" button when it
// doesn't. Every one of those three paths consumes `state.summary` — the exact string the CFE already
// released — so there is no second, ungated route for content to leave this component.

'use client';

import { useMemo, useState } from 'react';

import type { OrgTreeNode } from '@/types/taprooting';
import styles from '../grow.module.css';
import { useT } from '@/app/locale-context';

export interface TimeLapseShareProps {
  ownerDisplayName: string;
  nodes: OrgTreeNode[];
}

export type ShareState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'released'; summary: string }
  | { kind: 'blocked'; reason: string };

function flattenJoinOrder(ownerDisplayName: string, nodes: OrgTreeNode[]): { level: number; displayName: string; joinedAt: string }[] {
  const events: { level: number; displayName: string; joinedAt: string }[] = [
    { level: 0, displayName: ownerDisplayName, joinedAt: new Date(0).toISOString() },
  ];
  const walk = (n: OrgTreeNode) => {
    events.push({ level: n.level, displayName: n.displayName, joinedAt: new Date().toISOString() });
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return events;
}

/**
 * The real share/download/copy affordance (T-R30 GAP 2). Kept as a separate, pure, prop-driven
 * component — no `navigator`/`Blob`/DOM read happens IN HERE — so it stays directly testable with
 * `renderToStaticMarkup` the same way every other O-screen/status component in this codebase is
 * (see tests/unit/onboarding-ui.test.ts); the stateful `TimeLapseShare` below computes `canShare` /
 * `downloadHref` from the real runtime once and hands them in as props.
 *
 * TEETH (by construction, not by convention): the ONLY branch of this function that can render a
 * Share/Download/Copy control is `state.kind === 'released'`. `idle` and `checking` render nothing;
 * `blocked` renders only the block reason. There is no code path here through which `idle` /
 * `checking` / `blocked` content can reach a share/download/copy control.
 */
export interface ShareResultActionsProps {
  state: ShareState;
  /** Feature-detected `navigator.share` availability — computed once in the real runtime below. */
  canShare: boolean;
  /** A pre-built same-session Blob object-URL for the "Download" fallback link; `''` before one exists. */
  downloadHref: string;
  copied: boolean;
  onNativeShare: () => void;
  onCopy: () => void;
}

export function ShareResultActions({
  state,
  canShare,
  downloadHref,
  copied,
  onNativeShare,
  onCopy,
}: ShareResultActionsProps) {
  const t = useT();
  if (state.kind === 'blocked') {
    return <p role="alert">{t('grow.timeLapseShare.blockedMessageTemplate', { reason: state.reason })}</p>;
  }

  if (state.kind !== 'released') return null; // 'idle' | 'checking' — nothing cleared yet, nothing to share

  return (
    <>
      <p role="status">{t('grow.timeLapseShare.clearedStatus')}</p>
      <div className={styles.formRow} role="group" aria-label={t('grow.timeLapseShare.shareGroupAriaLabel')}>
        {canShare ? (
          <button type="button" className={styles.iconButton} onClick={onNativeShare}>
            {t('grow.timeLapseShare.shareCta')}
          </button>
        ) : (
          <>
            <a className={styles.iconButton} href={downloadHref} download="harvest-timelapse.txt">
              {t('grow.timeLapseShare.downloadCta')}
            </a>
            <button type="button" className={styles.iconButton} onClick={onCopy}>
              {copied ? t('grow.timeLapseShare.copiedLabel') : t('grow.timeLapseShare.copyLabel')}
            </button>
          </>
        )}
      </div>
    </>
  );
}

export default function TimeLapseShare({ ownerDisplayName, nodes }: TimeLapseShareProps) {
  const t = useT();
  const [state, setState] = useState<ShareState>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);

  // Feature-detected from the real runtime — never assumed available (the gap's own "where
  // available (feature-detected)" requirement).
  const canShare =
    typeof navigator !== 'undefined' && typeof (navigator as Navigator & { share?: unknown }).share === 'function';

  // The download-fallback href: a same-session Blob object URL of the exact CFE-cleared text. Built
  // only once content is actually released (`state.kind === 'released'`) — never eagerly, so there is
  // nothing downloadable before clearance either.
  const downloadHref = useMemo(() => {
    if (state.kind !== 'released') return '';
    if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return '';
    }
    return URL.createObjectURL(new Blob([state.summary], { type: 'text/plain' }));
  }, [state]);

  const handleShare = async () => {
    setState({ kind: 'checking' });
    setCopied(false);
    const events = flattenJoinOrder(ownerDisplayName, nodes);
    const res = await fetch('/api/taprooting/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events }),
    });
    const body = await res.json();
    if (res.ok && body.allowed) {
      setState({ kind: 'released', summary: body.exportSummary });
    } else {
      setState({ kind: 'blocked', reason: body.reason ?? t('grow.timeLapseShare.blockedReasonFallback') });
    }
  };

  // Both handlers are wired ONLY to controls `ShareResultActions` renders exclusively inside its
  // `state.kind === 'released'` branch — the guards below are defense-in-depth, not the only thing
  // standing between an unreleased export and the OS share sheet / clipboard.
  const handleNativeShare = async () => {
    if (state.kind !== 'released') return;
    try {
      await (navigator as Navigator & { share: (data: { title?: string; text?: string }) => Promise<void> }).share({
        title: t('grow.timeLapseShare.shareTitle'),
        text: state.summary,
      });
    } catch {
      // OS share sheet cancelled/failed — nothing left the app either way, no fallback needed here.
    }
  };

  const handleCopy = async () => {
    if (state.kind !== 'released') return;
    try {
      await navigator.clipboard.writeText(state.summary);
      setCopied(true);
    } catch {
      // Clipboard unavailable/denied — the Download link is still right there.
    }
  };

  return (
    <div className={styles.formRow}>
      <button type="button" className={styles.iconButton} onClick={handleShare} disabled={state.kind === 'checking'}>
        {state.kind === 'checking' ? t('grow.timeLapseShare.checkingCta') : t('grow.timeLapseShare.shareTimeLapseCta')}
      </button>
      <ShareResultActions
        state={state}
        canShare={canShare}
        downloadHref={downloadHref}
        copied={copied}
        onNativeShare={handleNativeShare}
        onCopy={handleCopy}
      />
    </div>
  );
}
