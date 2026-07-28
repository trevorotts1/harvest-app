// T-R56 — /admin/users: list + search + paginate + detail + suspend/reactivate/role-change.
// Composes the REAL, session-gated, ADMIN-only /api/admin/users/** routes (withCapability
// ('user_profile', 'manage')) — no demo/mock fallback. Every mutation requires an explicit confirm
// step (uiux "never a one-click destructive-shaped action") and shows a clear localized outcome.

'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { useLocale } from '@/app/locale-context';
import { StatusMessage } from '@/components/StatusMessage';
import { errorDisplay } from '@/lib/i18n/error-display';
import { formatDate } from '@/lib/i18n/format';
import { adminOnboardingStatusLabel, adminRoleLabel, suspendStatusLabel } from '@/lib/i18n/admin-token-display';

interface UserSummary {
  id: string;
  email: string;
  name: string;
  role: string;
  accessTier: string;
  onboardingStatus: string;
  isSuspended: boolean;
  createdAt: string;
}

interface UserDetail extends UserSummary {
  orgType: string;
  organizationId: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  updatedAt: string;
}

interface ListResult {
  users: UserSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; result: ListResult }
  | { kind: 'forbidden' }
  | { kind: 'failed' };

type DetailState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; detail: UserDetail }
  | { kind: 'failed' };

type ConfirmKind = null | 'suspend' | 'reactivate' | 'role';

const ROLE_OPTIONS = ['REP', 'UPLINE', 'RVP', 'ADMIN', 'DUAL'] as const;
const PAGE_SIZE = 20;

export default function AdminUsersPage() {
  const { locale, t } = useLocale();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<ListState>({ kind: 'loading' });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState>({ kind: 'idle' });
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [newRole, setNewRole] = useState<string>('');
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationNotice, setMutationNotice] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setList({ kind: 'loading' });
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (roleFilter) params.set('role', roleFilter);
      params.set('page', String(page));
      params.set('pageSize', String(PAGE_SIZE));
      const res = await fetch(`/api/admin/users?${params.toString()}`);
      if (res.status === 403) {
        setList({ kind: 'forbidden' });
        return;
      }
      if (!res.ok) {
        setList({ kind: 'failed' });
        return;
      }
      const result = (await res.json()) as ListResult;
      setList({ kind: 'ready', result });
    } catch {
      setList({ kind: 'failed' });
    }
  }, [search, roleFilter, page]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(async (userId: string) => {
    setDetail({ kind: 'loading' });
    setConfirmKind(null);
    setMutationError(null);
    setMutationNotice(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`);
      if (!res.ok) {
        setDetail({ kind: 'failed' });
        return;
      }
      const d = (await res.json()) as UserDetail;
      setDetail({ kind: 'ready', detail: d });
      setNewRole(d.role);
      setSuspendReason('');
    } catch {
      setDetail({ kind: 'failed' });
    }
  }, []);

  const selectUser = useCallback(
    (userId: string) => {
      setSelectedId(userId);
      void loadDetail(userId);
    },
    [loadDetail]
  );

  const onSearchSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      setPage(1);
      setSearch(searchInput.trim());
    },
    [searchInput]
  );

  /** Posts a mutation to `/api/admin/users/{selectedId}{path}`. Returns the updated detail on
   *  success, or `null` on any failure (the error/notice state is set here either way — callers
   *  never need to duplicate that handling). */
  const postMutation = useCallback(
    async (path: string, body?: unknown): Promise<UserDetail | null> => {
      if (!selectedId) return null;
      setMutationBusy(true);
      setMutationError(null);
      setMutationNotice(null);
      try {
        const res = await fetch(`/api/admin/users/${selectedId}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        });
        const payload = await res.json().catch(() => ({}) as Record<string, unknown>);
        if (!res.ok) {
          setMutationError(errorDisplay(t, payload?.code as string | undefined));
          return null;
        }
        return payload as UserDetail;
      } catch {
        setMutationError(t('errors.generic'));
        return null;
      } finally {
        setMutationBusy(false);
      }
    },
    [selectedId, t]
  );

  const confirmSuspend = useCallback(async () => {
    const updated = await postMutation('/suspend', { reason: suspendReason.trim() || undefined });
    if (updated) {
      setDetail({ kind: 'ready', detail: updated });
      setConfirmKind(null);
      setMutationNotice(t('admin.users.mutationSuccessSuspended'));
      void loadList();
    }
  }, [postMutation, suspendReason, t, loadList]);

  const confirmReactivate = useCallback(async () => {
    const updated = await postMutation('/reactivate');
    if (updated) {
      setDetail({ kind: 'ready', detail: updated });
      setConfirmKind(null);
      setMutationNotice(t('admin.users.mutationSuccessReactivated'));
      void loadList();
    }
  }, [postMutation, t, loadList]);

  const confirmRoleChange = useCallback(async () => {
    const updated = await postMutation('/role', { role: newRole });
    if (updated) {
      setDetail({ kind: 'ready', detail: updated });
      setConfirmKind(null);
      setMutationNotice(t('admin.users.mutationSuccessRoleChanged'));
      void loadList();
    }
  }, [postMutation, newRole, t, loadList]);

  if (list.kind === 'forbidden') {
    return (
      <div className="card panel">
        <span className="badge">{t('admin.users.badge')}</span>
        <StatusMessage>{t('admin.users.forbiddenBody')}</StatusMessage>
      </div>
    );
  }

  return (
    <div className="stack">
      <section className="card panel">
        <span className="badge">{t('admin.users.badge')}</span>
        <h1 style={{ marginTop: 8 }}>{t('admin.users.heading')}</h1>

        <form
          onSubmit={onSearchSubmit}
          style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 16 }}
        >
          <div className="field" style={{ marginBottom: 0, minWidth: 220 }}>
            <label htmlFor="admin-users-search">{t('admin.users.searchLabel')}</label>
            <input
              id="admin-users-search"
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('admin.users.searchPlaceholder')}
            />
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 160 }}>
            <label htmlFor="admin-users-role-filter">{t('admin.users.roleFilterLabel')}</label>
            <select
              id="admin-users-role-filter"
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('admin.users.roleFilterAll')}</option>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {adminRoleLabel(t, r)}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-primary">
            {t('admin.users.searchCta')}
          </button>
        </form>
      </section>

      <section className="card panel">
        {list.kind === 'loading' && <p>{t('admin.users.loading')}</p>}
        {list.kind === 'failed' && (
          <>
            <StatusMessage>{t('admin.users.loadFailed')}</StatusMessage>
            <button type="button" className="btn btn-secondary" onClick={() => void loadList()}>
              {t('common.retry')}
            </button>
          </>
        )}
        {list.kind === 'ready' && list.result.users.length === 0 && <p>{t('admin.users.emptyBody')}</p>}
        {list.kind === 'ready' && list.result.users.length > 0 && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('admin.users.tableName')}</th>
                    <th>{t('admin.users.tableEmail')}</th>
                    <th>{t('admin.users.tableRole')}</th>
                    <th>{t('admin.users.tableStatus')}</th>
                    <th>{t('admin.users.tableCreated')}</th>
                    <th>{t('admin.users.tableActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.result.users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.name}</td>
                      <td>{u.email}</td>
                      <td>{adminRoleLabel(t, u.role)}</td>
                      <td>
                        <span className="badge">{suspendStatusLabel(t, u.isSuspended)}</span>
                      </td>
                      <td>{formatDate(locale, u.createdAt)}</td>
                      <td>
                        <button type="button" className="btn btn-secondary" onClick={() => selectUser(u.id)}>
                          {t('admin.users.viewDetailCta')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--muted)' }}>
                {t('admin.users.pageIndicator', { page: list.result.page, totalPages: list.result.totalPages, total: list.result.total })}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={list.result.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {t('admin.users.previousPageCta')}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={list.result.page >= list.result.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t('admin.users.nextPageCta')}
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {selectedId && (
        <section className="card panel">
          {detail.kind === 'loading' && <p>{t('admin.users.detailLoading')}</p>}
          {detail.kind === 'failed' && <StatusMessage>{t('admin.users.detailLoadFailed')}</StatusMessage>}
          {detail.kind === 'ready' && (
            <>
              <div className="section-heading">
                <h2>{t('admin.users.detailHeading', { name: detail.detail.name })}</h2>
                <button type="button" className="btn btn-secondary" onClick={() => setSelectedId(null)}>
                  {t('admin.users.detailClose')}
                </button>
              </div>

              <div className="stack compact-stack" style={{ marginTop: 8 }}>
                <p>
                  <strong>{t('admin.users.detailEmailLabel')}</strong> {detail.detail.email}
                </p>
                <p>
                  <strong>{t('admin.users.detailRoleLabel')}</strong> {adminRoleLabel(t, detail.detail.role)}
                </p>
                <p>
                  <strong>{t('admin.users.detailStatusLabel')}</strong> {suspendStatusLabel(t, detail.detail.isSuspended)}
                  {detail.detail.isSuspended && detail.detail.suspendedReason ? ` — ${detail.detail.suspendedReason}` : ''}
                </p>
                <p>
                  <strong>{t('admin.users.detailOnboardingLabel')}</strong>{' '}
                  {adminOnboardingStatusLabel(t, detail.detail.onboardingStatus)}
                </p>
                <p>
                  <strong>{t('admin.users.detailCreatedLabel')}</strong> {formatDate(locale, detail.detail.createdAt)}
                </p>
              </div>

              {mutationError && (
                <div style={{ marginTop: 12 }}>
                  <StatusMessage>{mutationError}</StatusMessage>
                </div>
              )}
              {mutationNotice && (
                <div style={{ marginTop: 12 }}>
                  <StatusMessage tone="polite">{mutationNotice}</StatusMessage>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                {!detail.detail.isSuspended && confirmKind !== 'suspend' && (
                  <button type="button" className="btn btn-secondary" onClick={() => setConfirmKind('suspend')}>
                    {t('admin.users.suspendCta')}
                  </button>
                )}
                {detail.detail.isSuspended && confirmKind !== 'reactivate' && (
                  <button type="button" className="btn btn-secondary" onClick={() => setConfirmKind('reactivate')}>
                    {t('admin.users.reactivateCta')}
                  </button>
                )}
                {confirmKind !== 'role' && (
                  <button type="button" className="btn btn-secondary" onClick={() => setConfirmKind('role')}>
                    {t('admin.users.changeRoleCta')}
                  </button>
                )}
              </div>

              {confirmKind === 'suspend' && (
                <div className="notice notice-danger" style={{ marginTop: 12 }}>
                  <p>{t('admin.users.suspendConfirmPrompt', { name: detail.detail.name })}</p>
                  <div className="field">
                    <label htmlFor="admin-suspend-reason">{t('admin.users.suspendReasonLabel')}</label>
                    <input
                      id="admin-suspend-reason"
                      type="text"
                      value={suspendReason}
                      onChange={(e) => setSuspendReason(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn btn-primary" disabled={mutationBusy} onClick={() => void confirmSuspend()}>
                      {mutationBusy ? t('admin.users.workingCta') : t('admin.users.suspendConfirmCta')}
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={mutationBusy} onClick={() => setConfirmKind(null)}>
                      {t('admin.users.cancelCta')}
                    </button>
                  </div>
                </div>
              )}

              {confirmKind === 'reactivate' && (
                <div className="notice" style={{ marginTop: 12 }}>
                  <p>{t('admin.users.reactivateConfirmPrompt', { name: detail.detail.name })}</p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn btn-primary" disabled={mutationBusy} onClick={() => void confirmReactivate()}>
                      {mutationBusy ? t('admin.users.workingCta') : t('admin.users.reactivateConfirmCta')}
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={mutationBusy} onClick={() => setConfirmKind(null)}>
                      {t('admin.users.cancelCta')}
                    </button>
                  </div>
                </div>
              )}

              {confirmKind === 'role' && (
                <div className="notice" style={{ marginTop: 12 }}>
                  <p>{t('admin.users.roleChangeConfirmPrompt', { name: detail.detail.name })}</p>
                  <div className="field">
                    <label htmlFor="admin-new-role">{t('admin.users.newRoleLabel')}</label>
                    <select id="admin-new-role" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {adminRoleLabel(t, r)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn btn-primary" disabled={mutationBusy} onClick={() => void confirmRoleChange()}>
                      {mutationBusy ? t('admin.users.workingCta') : t('admin.users.roleChangeConfirmCta')}
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={mutationBusy} onClick={() => setConfirmKind(null)}>
                      {t('admin.users.cancelCta')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
