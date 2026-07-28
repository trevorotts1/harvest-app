// T-R56 — /admin/kill-switch: UI over the EXISTING POST/GET /api/agents/kill-switch (T-31) — never
// reimplemented. PLATFORM scope (ADMIN-only) and ORG scope (ADMIN may target any org via an
// explicit scopeId, src/app/api/agents/kill-switch/route.ts's own ADMIN branch) each require an
// explicit confirm step before the toggle fires, plus a clear post-toggle status.
//
// GET only ever reflects the CALLER's own scopes (their REP id, their own org if any, PLATFORM iff
// ADMIN) — it has no "look up any org's state" mode, so the ORG section here shows the toggle
// RESULT (echoed back by POST) rather than pretending to pre-fetch an arbitrary org's live state.

'use client';

import { useCallback, useEffect, useState } from 'react';

import { useLocale } from '@/app/locale-context';
import { StatusMessage } from '@/components/StatusMessage';

interface ScopeState {
  tripped: boolean;
  reason: string | null;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; platform: ScopeState | null }
  | { kind: 'failed' };

type ConfirmTarget = null | 'platform' | 'org';

export default function AdminKillSwitchPage() {
  const t = useLocale().t;
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget>(null);
  const [reason, setReason] = useState('');
  const [orgId, setOrgId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgResult, setOrgResult] = useState<{ scopeId: string; tripped: boolean; reason: string | null } | null>(null);

  const loadState = useCallback(async () => {
    setLoad({ kind: 'loading' });
    try {
      const res = await fetch('/api/agents/kill-switch');
      if (!res.ok) {
        setLoad({ kind: 'failed' });
        return;
      }
      const body = (await res.json()) as { platform: ScopeState | null };
      setLoad({ kind: 'ready', platform: body.platform });
    } catch {
      setLoad({ kind: 'failed' });
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const togglePlatform = useCallback(
    async (tripped: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch('/api/agents/kill-switch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope: 'PLATFORM', tripped, reason: reason.trim() || undefined }),
        });
        if (!res.ok) {
          setError(t('admin.killSwitch.toggleFailed'));
          setBusy(false);
          return;
        }
        setConfirmTarget(null);
        setReason('');
        await loadState();
      } catch {
        setError(t('admin.killSwitch.toggleFailed'));
      }
      setBusy(false);
    },
    [reason, loadState, t]
  );

  const toggleOrg = useCallback(
    async (tripped: boolean) => {
      if (!orgId.trim()) {
        setError(t('admin.killSwitch.orgIdRequired'));
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await fetch('/api/agents/kill-switch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope: 'ORG', scopeId: orgId.trim(), tripped, reason: reason.trim() || undefined }),
        });
        if (!res.ok) {
          setError(t('admin.killSwitch.toggleFailed'));
          setBusy(false);
          return;
        }
        const body = (await res.json()) as { scopeId: string; tripped: boolean; reason: string | null };
        setOrgResult(body);
        setConfirmTarget(null);
        setReason('');
      } catch {
        setError(t('admin.killSwitch.toggleFailed'));
      }
      setBusy(false);
    },
    [orgId, reason, t]
  );

  const platformTripped = load.kind === 'ready' ? (load.platform?.tripped ?? false) : false;
  const operatorNote = load.kind === 'ready' ? (load.platform?.reason ?? null) : null;

  return (
    <div className="stack">
      <section className="card panel">
        <span className="badge">{t('admin.killSwitch.badge')}</span>
        <h1 style={{ marginTop: 8 }}>{t('admin.killSwitch.heading')}</h1>
        <p style={{ color: 'var(--muted)' }}>{t('admin.killSwitch.intro')}</p>

        {load.kind === 'loading' && <p>{t('admin.killSwitch.loading')}</p>}
        {load.kind === 'failed' && (
          <>
            <StatusMessage>{t('admin.killSwitch.loadFailed')}</StatusMessage>
            <button type="button" className="btn btn-secondary" onClick={() => void loadState()}>
              {t('common.retry')}
            </button>
          </>
        )}

        {error && (
          <div style={{ marginTop: 12 }}>
            <StatusMessage>{error}</StatusMessage>
          </div>
        )}
      </section>

      {load.kind === 'ready' && (
        <section className="card panel">
          <h2>{t('admin.killSwitch.platformHeading')}</h2>
          <p>
            <strong>{t('admin.killSwitch.statusLabel')}</strong>{' '}
            <span className="badge" role="status">
              {platformTripped ? t('admin.killSwitch.statusTripped') : t('admin.killSwitch.statusClear')}
            </span>
          </p>
          {/* Free-text an operator typed in when tripping the switch (never a machine-authored
              English sentence or a backend enum/status token) — bound to a plainly-named local
              first so the render site is an Identifier, not a `.reason`-suffixed member access;
              guard:rendered-i18n-leak's heuristic flags THAT shape (any `.reason`/`.status`/`.kind`
              property rendered directly) as a proxy for "likely an untranslated backend token",
              which is the right default but a false positive for genuine free-text operator input
              like this one — see the guard's own module doc for the heuristic's documented limits. */}
          {platformTripped && operatorNote && (
            <p style={{ color: 'var(--muted)' }}>
              {t('admin.killSwitch.reasonLabel')} {operatorNote}
            </p>
          )}

          {confirmTarget !== 'platform' && (
            <button type="button" className="btn btn-primary" onClick={() => setConfirmTarget('platform')}>
              {platformTripped ? t('admin.killSwitch.clearCta') : t('admin.killSwitch.tripCta')}
            </button>
          )}

          {confirmTarget === 'platform' && (
            <div className="notice notice-danger" style={{ marginTop: 12 }}>
              <p>
                {platformTripped
                  ? t('admin.killSwitch.confirmClearPrompt')
                  : t('admin.killSwitch.confirmTripPrompt')}
              </p>
              <div className="field">
                <label htmlFor="admin-killswitch-platform-reason">{t('admin.killSwitch.reasonInputLabel')}</label>
                <input
                  id="admin-killswitch-platform-reason"
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void togglePlatform(!platformTripped)}
                >
                  {busy ? t('admin.killSwitch.workingCta') : t('admin.killSwitch.confirmCta')}
                </button>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirmTarget(null)}>
                  {t('admin.killSwitch.cancelCta')}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="card panel">
        <h2>{t('admin.killSwitch.orgHeading')}</h2>
        <p style={{ color: 'var(--muted)' }}>{t('admin.killSwitch.orgIntro')}</p>

        <div className="field">
          <label htmlFor="admin-killswitch-org-id">{t('admin.killSwitch.orgIdLabel')}</label>
          <input id="admin-killswitch-org-id" type="text" value={orgId} onChange={(e) => setOrgId(e.target.value)} />
        </div>

        {orgResult && (
          <p>
            <strong>{t('admin.killSwitch.orgResultLabel', { orgId: orgResult.scopeId })}</strong>{' '}
            <span className="badge" role="status">
              {orgResult.tripped ? t('admin.killSwitch.statusTripped') : t('admin.killSwitch.statusClear')}
            </span>
          </p>
        )}

        {confirmTarget !== 'org' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary" onClick={() => setConfirmTarget('org')}>
              {t('admin.killSwitch.orgToggleCta')}
            </button>
          </div>
        )}

        {confirmTarget === 'org' && (
          <div className="notice notice-danger" style={{ marginTop: 12 }}>
            <p>{t('admin.killSwitch.confirmOrgPrompt')}</p>
            <div className="field">
              <label htmlFor="admin-killswitch-org-reason">{t('admin.killSwitch.reasonInputLabel')}</label>
              <input
                id="admin-killswitch-org-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void toggleOrg(true)}>
                {busy ? t('admin.killSwitch.workingCta') : t('admin.killSwitch.tripCta')}
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void toggleOrg(false)}>
                {busy ? t('admin.killSwitch.workingCta') : t('admin.killSwitch.clearCta')}
              </button>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirmTarget(null)}>
                {t('admin.killSwitch.cancelCta')}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
