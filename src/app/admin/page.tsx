// T-R56 — /admin overview: the console's landing surface. Composes a small honest snapshot (total
// user count, most-recent signup, the platform kill-switch state) over four navigation cards into
// the console's other sections — same "independently-fetched zones" shape as today/page.tsx,
// minus the offline-queue machinery this read-only surface has no need for.

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { useLocale } from '@/app/locale-context';
import { StatusMessage } from '@/components/StatusMessage';
import { formatDate } from '@/lib/i18n/format';

interface SnapshotState {
  kind: 'loading' | 'ready' | 'failed';
  totalUsers: number | null;
  latestSignupAt: string | null;
  platformKillSwitchTripped: boolean | null;
}

const INITIAL_STATE: SnapshotState = {
  kind: 'loading',
  totalUsers: null,
  latestSignupAt: null,
  platformKillSwitchTripped: null,
};

export default function AdminOverviewPage() {
  const { locale, t } = useLocale();
  const [state, setState] = useState<SnapshotState>(INITIAL_STATE);

  const load = useCallback(async () => {
    setState(INITIAL_STATE);
    try {
      const [usersRes, signupsRes, killSwitchRes] = await Promise.all([
        fetch('/api/admin/users?pageSize=1'),
        fetch('/api/admin/signups?limit=1'),
        fetch('/api/agents/kill-switch'),
      ]);
      if (!usersRes.ok || !signupsRes.ok) {
        setState((prev) => ({ ...prev, kind: 'failed' }));
        return;
      }
      const users = (await usersRes.json()) as { total: number };
      const signups = (await signupsRes.json()) as { signups: Array<{ createdAt: string }> };
      const killSwitch = killSwitchRes.ok
        ? ((await killSwitchRes.json()) as { platform: { tripped: boolean } | null })
        : null;
      setState({
        kind: 'ready',
        totalUsers: users.total,
        latestSignupAt: signups.signups[0]?.createdAt ?? null,
        platformKillSwitchTripped: killSwitch?.platform?.tripped ?? null,
      });
    } catch {
      setState((prev) => ({ ...prev, kind: 'failed' }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="stack">
      <section className="card panel">
        <span className="badge">{t('admin.overview.badge')}</span>
        <h1 style={{ marginTop: 8 }}>{t('admin.overview.heading')}</h1>
        <p style={{ color: 'var(--muted)' }}>{t('admin.overview.intro')}</p>

        {state.kind === 'loading' && <p>{t('admin.overview.snapshotLoading')}</p>}
        {state.kind === 'failed' && (
          <>
            <StatusMessage>{t('admin.overview.snapshotFailed')}</StatusMessage>
            <button type="button" className="btn btn-secondary" onClick={() => void load()}>
              {t('common.retry')}
            </button>
          </>
        )}
        {state.kind === 'ready' && (
          <div className="metric-grid">
            <div className="metric">
              <strong>{state.totalUsers}</strong>
              <span>{t('admin.overview.totalUsersLabel')}</span>
            </div>
            <div className="metric">
              <strong>{state.latestSignupAt ? formatDate(locale, state.latestSignupAt) : t('admin.overview.noSignupsYet')}</strong>
              <span>{t('admin.overview.latestSignupLabel')}</span>
            </div>
            <div className="metric">
              <strong>
                {state.platformKillSwitchTripped === null
                  ? t('admin.overview.killSwitchUnknown')
                  : state.platformKillSwitchTripped
                    ? t('admin.overview.killSwitchTripped')
                    : t('admin.overview.killSwitchClear')}
              </strong>
              <span>{t('admin.overview.killSwitchLabel')}</span>
            </div>
          </div>
        )}
      </section>

      <div className="grid-2">
        <Link href="/admin/users" className="card feature">
          <h2>{t('admin.overview.usersCardTitle')}</h2>
          <p>{t('admin.overview.usersCardBody')}</p>
        </Link>
        <Link href="/admin/signups" className="card feature">
          <h2>{t('admin.overview.signupsCardTitle')}</h2>
          <p>{t('admin.overview.signupsCardBody')}</p>
        </Link>
        <Link href="/admin/kill-switch" className="card feature">
          <h2>{t('admin.overview.killSwitchCardTitle')}</h2>
          <p>{t('admin.overview.killSwitchCardBody')}</p>
        </Link>
        <Link href="/admin/audit" className="card feature">
          <h2>{t('admin.overview.auditCardTitle')}</h2>
          <p>{t('admin.overview.auditCardBody')}</p>
        </Link>
      </div>
    </div>
  );
}
