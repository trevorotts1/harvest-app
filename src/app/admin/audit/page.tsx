// T-R56 — /admin/audit: the read-only Audit / Security Viewer (item 5). Composes GET
// /api/admin/audit (AuditEntry rows + the live hash-chain integrity verdict) and GET
// /api/admin/audit?kind=security (SecurityEvent rows). ADMIN-gated (withCapability('cross_org',
// 'read')); paginated. Never renders `AuditEntryRecord.content_text`/`classifier_data` verbatim —
// same non-rendering discipline as /admin/signups's activity feed.

'use client';

import { useCallback, useEffect, useState } from 'react';

import { useLocale } from '@/app/locale-context';
import { StatusMessage } from '@/components/StatusMessage';
import { formatDateTime } from '@/lib/i18n/format';
import {
  adminMutationActionLabel,
  adminRoleLabel,
  auditOutcomeLabel,
  chainIntegrityLabel,
  securityEventTypeLabel,
  securitySeverityLabel,
} from '@/lib/i18n/admin-token-display';

interface AuditEntryRow {
  id: string;
  sequence: number;
  role: string;
  outcome: string;
  created_at: string;
  classifier_data: Record<string, unknown>;
}

interface SecurityEventRow {
  id: string;
  user_id: string | null;
  type: string;
  severity: string;
  created_at: string;
}

interface ChainIntegrity {
  valid: boolean;
  brokenAtIndex: number | null;
  brokenEntryId: string | null;
  reason: string | null;
}

interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

type AuditState =
  | { kind: 'loading' }
  | { kind: 'ready'; result: PagedResult<AuditEntryRow>; chainIntegrity: ChainIntegrity }
  | { kind: 'forbidden' }
  | { kind: 'failed' };

type SecurityState =
  | { kind: 'loading' }
  | { kind: 'ready'; result: PagedResult<SecurityEventRow> }
  | { kind: 'forbidden' }
  | { kind: 'failed' };

const ADMIN_MUTATION_ACTIONS = new Set([
  'user_suspended',
  'user_reactivated',
  'user_role_changed',
  // R-18 (admin-mediated password recovery): issuance rows render the localized label too.
  'user_password_reset_issued',
]);

export default function AdminAuditPage() {
  const { locale, t } = useLocale();
  const [auditPage, setAuditPage] = useState(1);
  const [securityPage, setSecurityPage] = useState(1);
  const [audit, setAudit] = useState<AuditState>({ kind: 'loading' });
  const [security, setSecurity] = useState<SecurityState>({ kind: 'loading' });

  const loadAudit = useCallback(async (page: number) => {
    setAudit({ kind: 'loading' });
    try {
      const res = await fetch(`/api/admin/audit?kind=audit&page=${page}&pageSize=20`);
      if (res.status === 403) return setAudit({ kind: 'forbidden' });
      if (!res.ok) return setAudit({ kind: 'failed' });
      const body = (await res.json()) as PagedResult<AuditEntryRow> & { chainIntegrity: ChainIntegrity };
      const { chainIntegrity, ...result } = body;
      setAudit({ kind: 'ready', result, chainIntegrity });
    } catch {
      setAudit({ kind: 'failed' });
    }
  }, []);

  const loadSecurity = useCallback(async (page: number) => {
    setSecurity({ kind: 'loading' });
    try {
      const res = await fetch(`/api/admin/audit?kind=security&page=${page}&pageSize=20`);
      if (res.status === 403) return setSecurity({ kind: 'forbidden' });
      if (!res.ok) return setSecurity({ kind: 'failed' });
      const body = (await res.json()) as PagedResult<SecurityEventRow>;
      setSecurity({ kind: 'ready', result: body });
    } catch {
      setSecurity({ kind: 'failed' });
    }
  }, []);

  useEffect(() => {
    void loadAudit(auditPage);
  }, [loadAudit, auditPage]);

  useEffect(() => {
    void loadSecurity(securityPage);
  }, [loadSecurity, securityPage]);

  return (
    <div className="stack">
      <section className="card panel">
        <span className="badge">{t('admin.audit.badge')}</span>
        <h1 style={{ marginTop: 8 }}>{t('admin.audit.heading')}</h1>
        <p style={{ color: 'var(--muted)' }}>{t('admin.audit.intro')}</p>

        {audit.kind === 'ready' && (
          <p>
            <strong>{t('admin.audit.chainIntegrityLabel')}</strong>{' '}
            <span className="badge" role="status">
              {chainIntegrityLabel(t, audit.chainIntegrity.valid)}
            </span>
            {/* `ChainVerificationResult.reason` (hash-chain.ts) is a hardcoded ENGLISH diagnostic
                sentence composed in server code — never fit to render verbatim on a localized
                screen (guard:rendered-i18n-leak). Only the structural, non-prose facts (the
                broken row's id/position — a UUID and an index, not English text) are shown; the
                full diagnostic stays in server logs for an operator to inspect directly. */}
            {!audit.chainIntegrity.valid && (
              <StatusMessage>
                {t('admin.audit.chainBrokenDetail', {
                  entryId: audit.chainIntegrity.brokenEntryId ?? '—',
                  index: audit.chainIntegrity.brokenAtIndex ?? '—',
                })}
              </StatusMessage>
            )}
          </p>
        )}
      </section>

      <section className="card panel">
        <h2>{t('admin.audit.entriesHeading')}</h2>
        {audit.kind === 'loading' && <p>{t('admin.audit.loading')}</p>}
        {audit.kind === 'forbidden' && <StatusMessage>{t('admin.audit.forbiddenBody')}</StatusMessage>}
        {audit.kind === 'failed' && (
          <>
            <StatusMessage>{t('admin.audit.loadFailed')}</StatusMessage>
            <button type="button" className="btn btn-secondary" onClick={() => void loadAudit(auditPage)}>
              {t('common.retry')}
            </button>
          </>
        )}
        {audit.kind === 'ready' && audit.result.items.length === 0 && <p>{t('admin.audit.emptyBody')}</p>}
        {audit.kind === 'ready' && audit.result.items.length > 0 && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('admin.audit.tableSequence')}</th>
                    <th>{t('admin.audit.tableWhen')}</th>
                    <th>{t('admin.audit.tableActorRole')}</th>
                    <th>{t('admin.audit.tableAction')}</th>
                    <th>{t('admin.audit.tableOutcome')}</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.result.items.map((entry) => {
                    const action = entry.classifier_data?.action;
                    const isKnown = typeof action === 'string' && ADMIN_MUTATION_ACTIONS.has(action);
                    return (
                      <tr key={entry.id}>
                        <td>{entry.sequence}</td>
                        <td>{formatDateTime(locale, entry.created_at)}</td>
                        <td>{adminRoleLabel(t, entry.role)}</td>
                        <td>{isKnown ? adminMutationActionLabel(t, action as string) : t('admin.audit.entryGeneric')}</td>
                        <td>{auditOutcomeLabel(t, entry.outcome)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--muted)' }}>
                {t('admin.audit.pageIndicator', { page: audit.result.page, totalPages: audit.result.totalPages, total: audit.result.total })}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-secondary" disabled={audit.result.page <= 1} onClick={() => setAuditPage((p) => Math.max(1, p - 1))}>
                  {t('admin.audit.previousPageCta')}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={audit.result.page >= audit.result.totalPages}
                  onClick={() => setAuditPage((p) => p + 1)}
                >
                  {t('admin.audit.nextPageCta')}
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="card panel">
        <h2>{t('admin.audit.securityHeading')}</h2>
        {security.kind === 'loading' && <p>{t('admin.audit.loading')}</p>}
        {security.kind === 'forbidden' && <StatusMessage>{t('admin.audit.forbiddenBody')}</StatusMessage>}
        {security.kind === 'failed' && (
          <>
            <StatusMessage>{t('admin.audit.loadFailed')}</StatusMessage>
            <button type="button" className="btn btn-secondary" onClick={() => void loadSecurity(securityPage)}>
              {t('common.retry')}
            </button>
          </>
        )}
        {security.kind === 'ready' && security.result.items.length === 0 && <p>{t('admin.audit.securityEmptyBody')}</p>}
        {security.kind === 'ready' && security.result.items.length > 0 && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('admin.audit.tableWhen')}</th>
                    <th>{t('admin.audit.tableEventType')}</th>
                    <th>{t('admin.audit.tableSeverity')}</th>
                  </tr>
                </thead>
                <tbody>
                  {security.result.items.map((ev) => (
                    <tr key={ev.id}>
                      <td>{formatDateTime(locale, ev.created_at)}</td>
                      <td>{securityEventTypeLabel(t, ev.type)}</td>
                      <td>{securitySeverityLabel(t, ev.severity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--muted)' }}>
                {t('admin.audit.pageIndicator', { page: security.result.page, totalPages: security.result.totalPages, total: security.result.total })}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={security.result.page <= 1}
                  onClick={() => setSecurityPage((p) => Math.max(1, p - 1))}
                >
                  {t('admin.audit.previousPageCta')}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={security.result.page >= security.result.totalPages}
                  onClick={() => setSecurityPage((p) => p + 1)}
                >
                  {t('admin.audit.nextPageCta')}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
