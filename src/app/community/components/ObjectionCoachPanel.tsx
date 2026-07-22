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
import { useT } from '@/app/locale-context';
import { StatusMessage } from '@/components/StatusMessage';

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
  const t = useT();
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
        setLoadError(t('community.objectionCoach.loadFailedGeneric'));
        return;
      }
      const body = await res.json();
      setObjections((body.objections ?? []) as ObjectionNode[]);
    } catch {
      setLoadError(t('community.objectionCoach.loadFailedGeneric'));
    }
  }, [t]);

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
        setStatus(t('community.objectionCoach.prepareFailedGeneric'));
        return;
      }
      setStatus(t('community.objectionCoach.preparedStatus'));
    } catch {
      setStatus(t('community.objectionCoach.prepareFailedGeneric'));
    }
  }

  return (
    <section className={styles.repActionPanel} aria-label={t('community.objectionCoach.title')}>
      <h2 className={styles.repActionTitle}>{t('community.objectionCoach.title')}</h2>
      <p className={styles.repActionNote}>{t('community.objectionCoach.note')}</p>

      {loadError && (
        <div className={styles.repActionStatus}>
          <StatusMessage>{loadError}</StatusMessage>
          <button type="button" className={styles.repActionButton} onClick={() => load()}>
            {t('common.retry')}
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
                        {t('community.objectionCoach.prepareCta')}
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
