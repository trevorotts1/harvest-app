// T-R30 (parity GAP 1) — the reachable, real self-serve CSV import surface (T-51: before this fix,
// the ONLY CSV parser in the codebase lived in the unreachable demo `contact-upload-demo.tsx`, and
// onboarding's own CSV button faked its result — see `../../onboarding/OnboardingFlow.tsx`'s
// `handleCsvFileSelected` for the onboarding-time fix). This page is for a rep who wants to import
// MORE contacts any time after onboarding, not just during the O-7 screen.
//
// Session + onboarding gated: `/community/:path*` is already in `src/middleware.ts`'s matcher AND
// `GATED_DOWNSTREAM_PAGE_PREFIXES` (onboarding-gate-edge.ts) — this route is a subpath of
// `/community`, so it inherits the hard onboarding gate with no middleware change needed (same
// reachability argument `../[contactId]/page.tsx` documents). The API behind it,
// `/api/contacts/import`, is independently session-gated via `withOnboardingGate` and scoped to the
// caller's OWN Vault only (`identity.userId` from the verified session — never a client-supplied id),
// so there is no cross-user/cross-org surface here to begin with.
//
// The pure preview/result pieces live in `./CsvImportPanel.tsx`, NOT in this file — a Next.js
// App Router `page.tsx` may only export a default component (`next build` fails typecheck the
// moment any other named value is exported here).
//
// Reachable from the Community list (`../page.tsx`'s header row, alongside the existing "Grow →"
// link) — the same "no orphaned components" reachability convention `../[contactId]/page.tsx`
// documents for its own mount.

'use client';

import Link from 'next/link';
import { useState, type ChangeEvent } from 'react';

import {
  ImportPreviewTable,
  ImportResultBanner,
  parseCsvPreview,
  type CsvPreview,
  type ImportOutcome,
} from './CsvImportPanel';
import styles from '../community.module.css';

export default function CommunityImportPage() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setOutcome(null);
    setError(null);
    setFileName(file.name);
    const text = await file.text();
    setCsvText(text);
    setPreview(parseCsvPreview(text));
    setIdempotencyKey(
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `csv-import-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
  }

  async function handleImport() {
    if (!csvText || !idempotencyKey) return;
    setSubmitting(true);
    setError(null);
    setOutcome(null);
    try {
      const response = await fetch('/api/contacts/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'CSV', csvText, idempotencyKey }),
      });
      const body = await response.json().catch(() => ({}) as { error?: string });
      if (!response.ok) {
        setError((body as { error?: string }).error ?? 'Could not import that file — please try again.');
        return;
      }
      setOutcome({
        importedCount: body.importedCount ?? 0,
        mergedCount: body.mergedCount ?? 0,
        minorFlaggedCount: body.minorFlaggedCount ?? 0,
        errorRows: body.errorRows ?? [],
        resumable: body.resumable ?? false,
      });
      // A successful import attempt is done — a later, separate file mints a fresh key.
      setIdempotencyKey(null);
    } catch {
      setError('Could not import that file — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <Link href="/community" className={styles.backLink}>
          ← Back to Community
        </Link>
        <h1 className={styles.title}>Import contacts from CSV</h1>

        <div className={styles.importPanel}>
          <p>
            Choose a CSV file. We&rsquo;ll show you how each column will be read before anything is
            imported — every contact is encrypted before it&rsquo;s stored, and duplicates are merged
            automatically.
          </p>

          <label className={styles.fileButton}>
            {fileName ? `Selected: ${fileName}` : 'Choose CSV file'}
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className={styles.hiddenFileInput}
            />
          </label>

          {preview && <ImportPreviewTable preview={preview} />}

          {csvText && (
            <button type="button" className={styles.importButton} onClick={handleImport} disabled={submitting}>
              {submitting ? 'Importing…' : 'Import contacts'}
            </button>
          )}

          <ImportResultBanner outcome={outcome} error={error} />
        </div>
      </div>
    </div>
  );
}
