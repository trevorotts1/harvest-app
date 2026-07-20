// WP08 §13.1/§13.6-7, uiux AC-5.5-5 — the time-lapse + share control. The share button shows the
// `shield-cfe` "checking" state, then either the share result on pass or the blocked state + reason
// on fail (uiux §5.5) — it NEVER hands the export to the client until the CFE has released it.

'use client';

import { useState } from 'react';

import type { OrgTreeNode } from '@/types/taprooting';
import styles from '../grow.module.css';

export interface TimeLapseShareProps {
  ownerDisplayName: string;
  nodes: OrgTreeNode[];
}

type ShareState = { kind: 'idle' } | { kind: 'checking' } | { kind: 'released'; summary: string } | { kind: 'blocked'; reason: string };

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

export default function TimeLapseShare({ ownerDisplayName, nodes }: TimeLapseShareProps) {
  const [state, setState] = useState<ShareState>({ kind: 'idle' });

  const handleShare = async () => {
    setState({ kind: 'checking' });
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
      setState({ kind: 'blocked', reason: body.reason ?? 'blocked' });
    }
  };

  return (
    <div className={styles.formRow}>
      <button type="button" className={styles.iconButton} onClick={handleShare} disabled={state.kind === 'checking'}>
        {state.kind === 'checking' ? 'Checking compliance…' : 'Share time-lapse'}
      </button>
      {state.kind === 'released' && (
        <p role="status">Cleared to share — structure and growth only, no income figures.</p>
      )}
      {state.kind === 'blocked' && (
        <p role="alert">Could not clear this for sharing right now ({state.reason}) — nothing left the app.</p>
      )}
    </div>
  );
}
