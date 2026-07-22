// T-57 R3c-1 (MAJOR-M3, master-spec §7.4 Memory Jogger; uiux §2.4 route map "`/community/import` ·
// `/community/jogger` — import flows; Memory Jogger"). `/community/jogger` 404'd before this fix —
// the real, Haiku-backed `MemoryJoggerService` existed with zero UI and zero HTTP route (see
// `src/app/api/contacts/memory-jogger/route.ts`'s header for the full "orphaned since T-23" story).
// This is that missing UI: a swipeable, 2-minute "gardening" mini-flow — one category prompt card
// at a time, a free-text name capture that searches the Vault and adds if absent (§7.4), and a
// "next" action that lets Haiku 4.5 pick the next category (avoiding recent repeats client-side).

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { useT } from '@/app/locale-context';
import { StatusMessage } from '@/components/StatusMessage';
import styles from './jogger.module.css';

interface JoggerPrompt {
  category: string;
  promptText: string;
}

interface JoggerResponse {
  trigger: boolean;
  contactCount: number;
  prompt: JoggerPrompt | null;
  unavailable?: 'no_key' | 'vocab_violation' | 'error';
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'not_triggered'; contactCount: number }
  | { kind: 'unavailable' }
  | { kind: 'ready'; prompt: JoggerPrompt }
  | { kind: 'failed' };

const MAX_RECENT_TRACKED = 8;

export default function MemoryJoggerPage() {
  const t = useT();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [recent, setRecent] = useState<string[]>([]);
  const [nameDraft, setNameDraft] = useState('');
  const [captureStatus, setCaptureStatus] = useState<{ kind: 'added' | 'existing' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (recentCategories: string[]) => {
    setState({ kind: 'loading' });
    setCaptureStatus(null);
    try {
      const params = new URLSearchParams({ onDemand: '1' });
      if (recentCategories.length > 0) params.set('recent', recentCategories.join(','));
      const res = await fetch(`/api/contacts/memory-jogger?${params.toString()}`);
      if (!res.ok) {
        setState({ kind: 'failed' });
        return;
      }
      const body = (await res.json()) as JoggerResponse;
      if (!body.trigger) {
        setState({ kind: 'not_triggered', contactCount: body.contactCount });
      } else if (!body.prompt) {
        setState({ kind: 'unavailable' });
      } else {
        setState({ kind: 'ready', prompt: body.prompt });
      }
    } catch {
      setState({ kind: 'failed' });
    }
  }, []);

  useEffect(() => {
    load([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleNext() {
    if (state.kind === 'ready') {
      const nextRecent = [...recent, state.prompt.category].slice(-MAX_RECENT_TRACKED);
      setRecent(nextRecent);
      void load(nextRecent);
    } else {
      void load(recent);
    }
  }

  async function handleCapture() {
    const name = nameDraft.trim();
    if (!name) return;
    setBusy(true);
    setCaptureStatus(null);
    try {
      const res = await fetch('/api/contacts/memory-jogger', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawName: name }),
      });
      if (!res.ok) {
        setCaptureStatus({ kind: 'error' });
        setBusy(false);
        return;
      }
      const body = (await res.json()) as { outcome: 'added' | 'existing' };
      setCaptureStatus({ kind: body.outcome });
      setNameDraft('');
    } catch {
      setCaptureStatus({ kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.header}>
          <h1 className={styles.title}>{t('jogger.title')}</h1>
          <Link href="/community" className={styles.navLink}>
            {t('jogger.backToCommunity')}
          </Link>
        </div>

        <div className={styles.card}>
          {state.kind === 'loading' && <p>{t('jogger.loading')}</p>}

          {state.kind === 'failed' && (
            <>
              {/* T-57 RG7 (SC 4.1.3) — load-failure announced via StatusMessage (role=alert). */}
              <StatusMessage className={styles.errorText}>{t('jogger.loadFailed')}</StatusMessage>
              <button type="button" className={styles.iconButton} onClick={() => load(recent)}>
                {t('jogger.retry')}
              </button>
            </>
          )}

          {state.kind === 'not_triggered' && (
            <p>{t('jogger.notTriggeredBody', { count: state.contactCount })}</p>
          )}

          {state.kind === 'unavailable' && <p>{t('jogger.unavailableBody')}</p>}

          {state.kind === 'ready' && (
            <>
              <span className={styles.badge}>{t('jogger.promptBadge')}</span>
              <p className={styles.promptText} role="status">
                {state.prompt.promptText}
              </p>

              <div className={styles.formRow}>
                <label className={styles.srOnly} htmlFor="jogger-name-input">
                  {t('jogger.nameInputLabel')}
                </label>
                <input
                  id="jogger-name-input"
                  type="text"
                  className={styles.textInput}
                  placeholder={t('jogger.nameInputPlaceholder')}
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCapture();
                  }}
                />
                <button type="button" className={styles.iconButton} disabled={busy || !nameDraft.trim()} onClick={handleCapture}>
                  {t('jogger.addCta')}
                </button>
              </div>

              {captureStatus?.kind === 'added' && (
                <p role="status" className={styles.successText}>
                  {t('jogger.captureAdded')}
                </p>
              )}
              {captureStatus?.kind === 'existing' && (
                <p role="status" className={styles.successText}>
                  {t('jogger.captureExisting')}
                </p>
              )}
              {captureStatus?.kind === 'error' && (
                <p role="alert" className={styles.errorText}>
                  {t('jogger.captureFailed')}
                </p>
              )}

              <div className={styles.formRow}>
                <button type="button" className={styles.iconButton} onClick={handleNext}>
                  {t('jogger.nextCta')}
                </button>
                <Link href="/today" className={styles.navLink}>
                  {t('jogger.doneCta')}
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
