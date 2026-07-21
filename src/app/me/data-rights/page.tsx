'use client';

// T-R29 (compliance-reachability build, master-spec §16.3/§9/§4.11 GDPR/CCPA "User Data Rights").
//
// T-51 found the GDPR data-rights center (T-11's `processExport`/`processDeletion`) built but
// UNREACHABLE — no route, no UI. This is the UI: Me -> Data & Privacy. Mounted at
// `/me/data-rights`, which `src/middleware.ts`'s existing `/me/:path*` matcher already auth-gates
// AND onboarding-gates (same convention as `/me/subscription`).
//
// Two flows, each backed by a real `/api/data-rights/*` route (own-data-only, step-up-MFA-gated —
// see each route's header comment):
//   - Export: create (`POST /api/data-rights/export`) then download (`GET .../export/[exportId]`)
//     — the download call is the one that actually decrypts (T-R7/T-R9) and serializes, with
//     secrets excluded by construction.
//   - Deletion: request (`POST /api/data-rights/deletion`) starts a 24-hour cooling-off period
//     (§9.3/§5.7); confirm (`POST /api/data-rights/deletion/confirm`) requires an explicit,
//     affirmative checkbox before it will submit `confirm: true` — never a bare re-click.
//
// Nav reachability: linked from `src/app/today/components/AnchorHeader.tsx` (the persistent header
// rendered on every visit to `/today`, the app's primary landing page) — there is no `/me` index
// page in this codebase yet (only `/me/subscription`), so this follows that page's own precedent of
// being reached via an ad-hoc header link rather than a Me index.

import { useCallback, useEffect, useState } from 'react';

import styles from './data-rights.module.css';
import StepUpPrompt from './components/StepUpPrompt';
import { useStepUpAction, type StepUpAttemptResult } from './components/useStepUpAction';
import type { DeletionCertificate, ExportFormat, UserDataDeletionRecord } from '@/types/data-rights';

type Load = 'loading' | 'ready';

const COOLING_OFF_MS = 24 * 60 * 60 * 1000;

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function readGateCode(res: Response): Promise<'MFA_ENROLLMENT_REQUIRED' | 'STEP_UP_REQUIRED' | null> {
  if (res.status !== 403) return null;
  const body = await res.json().catch(() => ({}));
  return body.code === 'MFA_ENROLLMENT_REQUIRED' || body.code === 'STEP_UP_REQUIRED' ? body.code : null;
}

export default function DataRightsPage() {
  const [load, setLoad] = useState<Load>('loading');
  const [deletionRecord, setDeletionRecord] = useState<UserDataDeletionRecord | null>(null);
  const [certificate, setCertificate] = useState<DeletionCertificate | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [deletionNotice, setDeletionNotice] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('json');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/data-rights/deletion');
        if (res.ok) {
          const body = await res.json();
          setDeletionRecord(body.deletion ?? null);
        }
      } catch {
        // Leave as null — a status-read failure never blocks the request/export actions below.
      }
      setLoad('ready');
    })();
  }, []);

  // ── Export: create, then download (the download call decrypts + secret-excludes) ────────────
  const attemptExport = useCallback(async (): Promise<StepUpAttemptResult<{ filename: string }>> => {
    const createRes = await fetch('/api/data-rights/export', { method: 'POST' });
    const createGate = await readGateCode(createRes);
    if (createGate) return { ok: false, code: createGate };
    if (!createRes.ok) {
      return { ok: false, code: 'ERROR', message: 'Could not start your export. Nothing was changed.' };
    }
    const created = (await createRes.json()) as { export: { id: string } };

    const downloadRes = await fetch(`/api/data-rights/export/${created.export.id}?format=${exportFormat}`);
    const downloadGate = await readGateCode(downloadRes);
    if (downloadGate) return { ok: false, code: downloadGate };
    if (!downloadRes.ok) {
      return { ok: false, code: 'ERROR', message: 'Your export was created but the download failed — try again.' };
    }

    const blob = await downloadRes.blob();
    const filename = `harvest-data-export-${created.export.id}.${exportFormat}`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return { ok: true, value: { filename } };
  }, [exportFormat]);

  const exportAction = useStepUpAction(attemptExport, (value) => setExportNotice(`Downloaded ${value.filename}.`));

  // ── Deletion: request (starts the cooling-off clock) ──────────────────────────────────────────
  const attemptRequestDeletion = useCallback(async (): Promise<StepUpAttemptResult<UserDataDeletionRecord>> => {
    const res = await fetch('/api/data-rights/deletion', { method: 'POST' });
    const gate = await readGateCode(res);
    if (gate) return { ok: false, code: gate };
    if (!res.ok) {
      return { ok: false, code: 'ERROR', message: 'Could not submit your deletion request. Nothing was changed.' };
    }
    const body = (await res.json()) as { deletion: UserDataDeletionRecord };
    return { ok: true, value: body.deletion };
  }, []);

  const requestAction = useStepUpAction(attemptRequestDeletion, (record) => {
    setDeletionRecord(record);
    setDeletionNotice(null);
  });

  // ── Deletion: confirm (only reachable after the explicit checkbox + cooling-off) ──────────────
  const attemptConfirmDeletion = useCallback(async (): Promise<
    StepUpAttemptResult<{ record: UserDataDeletionRecord; certificate: DeletionCertificate }>
  > => {
    if (!deletionRecord) {
      return { ok: false, code: 'ERROR', message: 'No deletion request to confirm.' };
    }
    const res = await fetch('/api/data-rights/deletion/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deletion_id: deletionRecord.id, confirm: true }),
    });
    const gate = await readGateCode(res);
    if (gate) return { ok: false, code: gate };
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string; code?: string; readyAt?: string });
      if (body.code === 'TOO_EARLY' && body.readyAt) {
        return { ok: false, code: 'ERROR', message: `You can confirm starting ${fmt(body.readyAt)}.` };
      }
      return { ok: false, code: 'ERROR', message: body.error ?? 'Could not confirm deletion.' };
    }
    const body = (await res.json()) as { deletion: UserDataDeletionRecord; certificate: DeletionCertificate };
    return { ok: true, value: { record: body.deletion, certificate: body.certificate } };
  }, [deletionRecord]);

  const confirmAction = useStepUpAction(attemptConfirmDeletion, ({ record, certificate: cert }) => {
    setDeletionRecord(record);
    setCertificate(cert);
    setConfirmChecked(false);
  });

  if (load === 'loading') {
    return (
      <main className={styles.page}>
        <p className={styles.loading}>Loading your data & privacy settings…</p>
      </main>
    );
  }

  const requestedAtMs = deletionRecord ? new Date(deletionRecord.requested_at).getTime() : null;
  const readyAtMs = requestedAtMs !== null ? requestedAtMs + COOLING_OFF_MS : null;
  const isCoolingOff = deletionRecord?.status === 'PENDING' && readyAtMs !== null && Date.now() < readyAtMs;
  const canConfirm = deletionRecord?.status === 'PENDING' && readyAtMs !== null && Date.now() >= readyAtMs;

  return (
    <main className={styles.page}>
      <header>
        <h1 className={styles.heading}>Data & Privacy</h1>
        <p className={styles.subhead}>Your data is yours. Export a full copy, or ask us to delete it — GDPR/CCPA, plain terms.</p>
      </header>

      {/* ── Export ── */}
      <section className={styles.stateCard} aria-label="Export your data">
        <h2 className={styles.sectionTitle}>Export your data</h2>
        <p className={styles.body}>
          Download a copy of your profile, contacts, and account data in a readable format. Never
          includes your password or any security credential.
        </p>
        {exportNotice && (
          <div className={`${styles.banner} ${styles.bannerQuiet}`} role="status">
            <p className={styles.bannerBody}>{exportNotice}</p>
          </div>
        )}
        {exportAction.stage === 'idle' || exportAction.stage === 'error' ? (
          <div className={styles.btnRow}>
            {exportAction.errorMessage && <p className={styles.body}>{exportAction.errorMessage}</p>}
            <label className={styles.fieldLabel} htmlFor="export-format">
              Format
            </label>
            <select
              id="export-format"
              className={styles.secondaryBtn}
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value === 'csv' ? 'csv' : 'json')}
            >
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
            </select>
            <button type="button" className={styles.actionBtn} onClick={() => void exportAction.run()}>
              Download my data
            </button>
          </div>
        ) : (
          <StepUpPrompt
            stage={exportAction.stage}
            code={exportAction.code}
            setCode={exportAction.setCode}
            otpauthUri={exportAction.otpauthUri}
            onStartEnroll={() => void exportAction.startEnroll()}
            onSubmitVerify={() => void exportAction.submitVerify()}
            onSubmitStepUp={() => void exportAction.submitStepUp()}
            idPrefix="export"
          />
        )}
      </section>

      {/* ── Deletion ── */}
      <section className={styles.stateCard} aria-label="Delete your account and data">
        <h2 className={styles.sectionTitle}>Delete your account and data</h2>
        <p className={styles.body}>
          This permanently removes your profile, contacts, messages, and Seven Whys history.
          Communications required for regulatory recordkeeping are retained, never sold or reused —
          your deletion certificate lists exactly what was kept and why.
        </p>

        {!deletionRecord && (
          <>
            {requestAction.stage === 'idle' || requestAction.stage === 'error' ? (
              <div className={styles.btnRow}>
                {requestAction.errorMessage && <p className={styles.body}>{requestAction.errorMessage}</p>}
                <button type="button" className={styles.dangerBtn} onClick={() => void requestAction.run()}>
                  Request account deletion
                </button>
              </div>
            ) : (
              <StepUpPrompt
                stage={requestAction.stage}
                code={requestAction.code}
                setCode={requestAction.setCode}
                otpauthUri={requestAction.otpauthUri}
                onStartEnroll={() => void requestAction.startEnroll()}
                onSubmitVerify={() => void requestAction.submitVerify()}
                onSubmitStepUp={() => void requestAction.submitStepUp()}
                idPrefix="deletion-request"
              />
            )}
          </>
        )}

        {deletionRecord?.status === 'PENDING' && isCoolingOff && (
          <div className={`${styles.banner} ${styles.bannerCaution}`} role="status">
            <p className={styles.bannerTitle}>Your deletion request is in its 24-hour cooling-off period.</p>
            <p className={styles.bannerBody}>
              Requested {fmt(deletionRecord.requested_at)}. You can confirm starting {fmt(new Date(readyAtMs!).toISOString())}.
            </p>
          </div>
        )}

        {deletionRecord?.status === 'PENDING' && canConfirm && (
          <>
            {deletionNotice && (
              <div className={`${styles.banner} ${styles.bannerQuiet}`} role="status">
                <p className={styles.bannerBody}>{deletionNotice}</p>
              </div>
            )}
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={confirmChecked}
                onChange={(e) => setConfirmChecked(e.target.checked)}
              />
              <span>I understand this permanently deletes my account and cannot be undone.</span>
            </label>
            {confirmAction.stage === 'idle' || confirmAction.stage === 'error' ? (
              <div className={styles.btnRow}>
                {confirmAction.errorMessage && <p className={styles.body}>{confirmAction.errorMessage}</p>}
                <button
                  type="button"
                  className={styles.dangerBtn}
                  disabled={!confirmChecked}
                  onClick={() => void confirmAction.run()}
                >
                  Permanently delete my data
                </button>
              </div>
            ) : (
              <StepUpPrompt
                stage={confirmAction.stage}
                code={confirmAction.code}
                setCode={confirmAction.setCode}
                otpauthUri={confirmAction.otpauthUri}
                onStartEnroll={() => void confirmAction.startEnroll()}
                onSubmitVerify={() => void confirmAction.submitVerify()}
                onSubmitStepUp={() => void confirmAction.submitStepUp()}
                idPrefix="deletion-confirm"
              />
            )}
          </>
        )}

        {deletionRecord?.status === 'HELD' && (
          <div className={`${styles.banner} ${styles.bannerBlocked}`} role="status">
            <p className={styles.bannerTitle}>Your deletion request is on hold.</p>
            <p className={styles.bannerBody}>A legal hold is active on your account — contact support for details.</p>
          </div>
        )}

        {deletionRecord?.status === 'COMPLETED' && (
          <div className={`${styles.banner} ${styles.bannerQuiet}`} role="status">
            <p className={styles.bannerTitle}>Your account has been deleted.</p>
            <p className={styles.bannerBody}>Completed {fmt(deletionRecord.completed_at)}.</p>
            {certificate && (
              <ul className={styles.list}>
                <li>{certificate.deleted_fields.length} fields deleted or anonymized.</li>
                <li>{certificate.retained_records.length} record(s) retained under regulatory requirement.</li>
              </ul>
            )}
            {deletionRecord.deletion_certificate_url && (
              <p className={styles.meta}>Certificate: {deletionRecord.deletion_certificate_url}</p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
