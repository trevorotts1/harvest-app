// T-R56 — /admin/signups: recent signups (User.created_at) + an ADMIN-scoped, org-wide activity
// view. Read-only. Composes GET /api/admin/signups (withCapability('cross_org','read')) and GET
// /api/admin/activity (same capability) — the existing /api/activity-ledger is deliberately
// self-scoped (see that route's own header) and is never reused here for the cross-user read.
//
// The activity feed NEVER renders `AuditEntryRecord.content_text`/`classifier_data` verbatim —
// that column can hold sensitive evidentiary content from OTHER producers (e.g. a CFE-flagged
// message's actual text). Only structured, already-known-safe fields are shown: timestamp, actor
// role, outcome, and — for an admin-console-originated row — the mutation action + affected user
// id via `adminMutationActionLabel`. Anything else renders the generic, translated fallback.

'use client';

import { useCallback, useEffect, useState } from 'react';

import { useLocale } from '@/app/locale-context';
import { StatusMessage } from '@/components/StatusMessage';
import { formatDateTime } from '@/lib/i18n/format';
import { adminMutationActionLabel, adminRoleLabel, auditOutcomeLabel } from '@/lib/i18n/admin-token-display';

interface SignupRow {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

interface ActivityEntry {
  id: string;
  sequence: number;
  user_id: string;
  role: string;
  outcome: string;
  created_at: string;
  classifier_data: Record<string, unknown>;
}

type SignupsState = { kind: 'loading' } | { kind: 'ready'; rows: SignupRow[] } | { kind: 'forbidden' } | { kind: 'failed' };
type ActivityState = { kind: 'loading' } | { kind: 'ready'; entries: ActivityEntry[] } | { kind: 'forbidden' } | { kind: 'failed' };

const ADMIN_MUTATION_ACTIONS = new Set([
  'user_suspended',
  'user_reactivated',
  'user_role_changed',
  // R-18 (admin-mediated password recovery): issuance rows render the localized label too.
  'user_password_reset_issued',
]);
const ACTIVITY_DISPLAY_LIMIT = 25;

export default function AdminSignupsActivityPage() {
  const { locale, t } = useLocale();
  const [signups, setSignups] = useState<SignupsState>({ kind: 'loading' });
  const [activity, setActivity] = useState<ActivityState>({ kind: 'loading' });

  const loadSignups = useCallback(async () => {
    setSignups({ kind: 'loading' });
    try {
      const res = await fetch('/api/admin/signups?limit=20');
      if (res.status === 403) return setSignups({ kind: 'forbidden' });
      if (!res.ok) return setSignups({ kind: 'failed' });
      const body = (await res.json()) as { signups: SignupRow[] };
      setSignups({ kind: 'ready', rows: body.signups });
    } catch {
      setSignups({ kind: 'failed' });
    }
  }, []);

  const loadActivity = useCallback(async () => {
    setActivity({ kind: 'loading' });
    try {
      const res = await fetch('/api/admin/activity');
      if (res.status === 403) return setActivity({ kind: 'forbidden' });
      if (!res.ok) return setActivity({ kind: 'failed' });
      const body = (await res.json()) as { entries: ActivityEntry[] };
      // Newest-first, capped — the store returns ascending append order (`AuditRepository.query`).
      const newestFirst = [...body.entries].reverse().slice(0, ACTIVITY_DISPLAY_LIMIT);
      setActivity({ kind: 'ready', entries: newestFirst });
    } catch {
      setActivity({ kind: 'failed' });
    }
  }, []);

  useEffect(() => {
    void loadSignups();
    void loadActivity();
  }, [loadSignups, loadActivity]);

  return (
    <div className="stack">
      <section className="card panel">
        <span className="badge">{t('admin.signups.badge')}</span>
        <h1 style={{ marginTop: 8 }}>{t('admin.signups.heading')}</h1>

        {signups.kind === 'loading' && <p>{t('admin.signups.loading')}</p>}
        {signups.kind === 'forbidden' && <StatusMessage>{t('admin.signups.forbiddenBody')}</StatusMessage>}
        {signups.kind === 'failed' && (
          <>
            <StatusMessage>{t('admin.signups.loadFailed')}</StatusMessage>
            <button type="button" className="btn btn-secondary" onClick={() => void loadSignups()}>
              {t('common.retry')}
            </button>
          </>
        )}
        {signups.kind === 'ready' && signups.rows.length === 0 && <p>{t('admin.signups.emptyBody')}</p>}
        {signups.kind === 'ready' && signups.rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('admin.signups.tableName')}</th>
                  <th>{t('admin.signups.tableEmail')}</th>
                  <th>{t('admin.signups.tableRole')}</th>
                  <th>{t('admin.signups.tableCreated')}</th>
                </tr>
              </thead>
              <tbody>
                {signups.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.email}</td>
                    <td>{adminRoleLabel(t, row.role)}</td>
                    <td>{formatDateTime(locale, row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card panel">
        <span className="badge">{t('admin.activity.badge')}</span>
        <h2 style={{ marginTop: 8 }}>{t('admin.activity.heading')}</h2>
        <p style={{ color: 'var(--muted)' }}>{t('admin.activity.intro')}</p>

        {activity.kind === 'loading' && <p>{t('admin.activity.loading')}</p>}
        {activity.kind === 'forbidden' && <StatusMessage>{t('admin.activity.forbiddenBody')}</StatusMessage>}
        {activity.kind === 'failed' && (
          <>
            <StatusMessage>{t('admin.activity.loadFailed')}</StatusMessage>
            <button type="button" className="btn btn-secondary" onClick={() => void loadActivity()}>
              {t('common.retry')}
            </button>
          </>
        )}
        {activity.kind === 'ready' && activity.entries.length === 0 && <p>{t('admin.activity.emptyBody')}</p>}
        {activity.kind === 'ready' && activity.entries.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('admin.activity.tableWhen')}</th>
                  <th>{t('admin.activity.tableActorRole')}</th>
                  <th>{t('admin.activity.tableAction')}</th>
                  <th>{t('admin.activity.tableOutcome')}</th>
                </tr>
              </thead>
              <tbody>
                {activity.entries.map((entry) => {
                  const action = entry.classifier_data?.action;
                  const isKnownAdminAction = typeof action === 'string' && ADMIN_MUTATION_ACTIONS.has(action);
                  return (
                    <tr key={entry.id}>
                      <td>{formatDateTime(locale, entry.created_at)}</td>
                      <td>{adminRoleLabel(t, entry.role)}</td>
                      <td>
                        {isKnownAdminAction
                          ? adminMutationActionLabel(t, action as string)
                          : t('admin.activity.entryGeneric')}
                      </td>
                      <td>{auditOutcomeLabel(t, entry.outcome)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
