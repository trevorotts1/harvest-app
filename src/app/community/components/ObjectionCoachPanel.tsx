// T-40R (WP05 GATE remediation, master-spec §10.7; uiux §5.7 "objection coach — only you see this") —
// the in-thread objection coach. Invisible to the community member: it is a coaching sheet FOR THE
// REP. It loads the Socratic objection tree (POST /api/messaging/objection {action:'list'}), leads
// with the clarifying question, and — when the rep picks a branch — prepares that response as a HELD
// DraftMessage (POST {action:'prepare'}) that must still pass the CFE + the rep's approval + the send
// seam before it can ever reach the recipient. Nothing here sends.
//
// Presentational + fetches; tokens only via the CSS module (no raw hex, no opacity on text).

'use client';

import { useCallback, useEffect, useState } from 'react';

import styles from '../conversation.module.css';

interface ObjectionBranch {
  key: string;
  label: string;
  response: string;
  nextAction: 'continue' | 'schedule' | 'respectfully_close';
}
interface ObjectionNode {
  key: string;
  label: string;
  clarifyingQuestion: string;
  branches: ObjectionBranch[];
}

export interface ObjectionCoachPanelProps {
  contactId: string;
}

export default function ObjectionCoachPanel({ contactId }: ObjectionCoachPanelProps) {
  const [objections, setObjections] = useState<ObjectionNode[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/messaging/objection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'list' }),
      });
      if (!res.ok) {
        setLoadError('Could not load the objection coach. Try again.');
        return;
      }
      const body = await res.json();
      setObjections((body.objections ?? []) as ObjectionNode[]);
    } catch {
      setLoadError('Could not load the objection coach. Try again.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function prepare(objectionKey: string, branchKey: string) {
    setStatus(null);
    try {
      const res = await fetch('/api/messaging/objection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'prepare', contactId, objectionKey, branchKey }),
      });
      if (!res.ok) {
        setStatus('Could not prepare that response. Try again.');
        return;
      }
      setStatus('A draft response was prepared — it waits for your approval and clears compliance before it can send.');
    } catch {
      setStatus('Could not prepare that response. Try again.');
    }
  }

  return (
    <section className={styles.repActionPanel} aria-label="Objection coach">
      <h2 className={styles.repActionTitle}>Objection coach</h2>
      <p className={styles.repActionNote}>Only you see this. Lead with the question, then choose an honest response.</p>

      {loadError && (
        <div className={styles.repActionStatus}>
          <p>{loadError}</p>
          <button type="button" className={styles.repActionButton} onClick={() => load()}>
            Retry
          </button>
        </div>
      )}

      <ul className={styles.objectionList}>
        {objections.map((o) => {
          const open = openKey === o.key;
          return (
            <li key={o.key} className={styles.objectionItem}>
              <button
                type="button"
                className={styles.objectionToggle}
                aria-expanded={open}
                onClick={() => setOpenKey(open ? null : o.key)}
              >
                {o.label}
              </button>
              {open && (
                <div className={styles.objectionBody}>
                  <p className={styles.objectionQuestion}>{o.clarifyingQuestion}</p>
                  {o.branches.map((b) => (
                    <div key={b.key} className={styles.branchRow}>
                      <p className={styles.branchLabel}>{b.label}</p>
                      <p className={styles.branchResponse}>{b.response}</p>
                      <button
                        type="button"
                        className={styles.repActionButton}
                        onClick={() => prepare(o.key, b.key)}
                      >
                        Prepare this response
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {status && (
        <p className={styles.repActionStatus} role="status">
          {status}
        </p>
      )}
    </section>
  );
}
