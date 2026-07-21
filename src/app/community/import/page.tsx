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
import { useState, type ChangeEvent, type DragEvent } from 'react';

import {
  ImportPreviewTable,
  ImportResultBanner,
  parseCsvPreview,
  type CsvPreview,
  type ImportOutcome,
} from './CsvImportPanel';
import styles from '../community.module.css';
import { useT } from '@/app/locale-context';

export default function CommunityImportPage() {
  const t = useT();
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  // T-57 C5 (uiux §6.3 "Full" desktop parity) — the shared "a CSV file was chosen" path, extracted
  // so the original file-picker `onChange` AND the new drag-and-drop zone below drive the exact
  // same preview/idempotency-key logic — never a second, hand-copied selection flow.
  async function processFile(file: File) {
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

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await processFile(file);
  }

  // T-57 C5 — drag-and-drop drop target. See OnboardingFlow.tsx's identical pattern/rationale
  // (CSS-gated hint, harmless handlers on touch devices) for why this is unconditionally wired.
  const [dragActive, setDragActive] = useState(false);

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave() {
    setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void processFile(file);
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
        setError((body as { error?: string }).error ?? t('community.import.importFailedGeneric'));
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
      setError(t('community.import.importFailedGeneric'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <Link href="/community" className={styles.backLink}>
          {t('community.backToCommunityCta')}
        </Link>
        <h1 className={styles.title}>{t('community.import.title')}</h1>

        <div className={styles.importPanel}>
          <p>
            {t('community.import.intro')}
          </p>

          <label className={styles.fileButton}>
            {fileName ? t('community.import.selectedFileTemplate', { fileName }) : t('community.import.chooseFileCta')}
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className={styles.hiddenFileInput}
            />
          </label>

          {/* T-57 C5 (uiux §6.3 "Full" desktop parity) — drag-and-drop, additive alongside the file
              picker above (never a replacement). CSS-gated to pointer-capable/wide viewports — see
              community.module.css's `.csvDropZone` for the same rationale as OnboardingFlow.tsx's
              identical pattern. */}
          <div
            className={styles.csvDropZone}
            data-drag-active={dragActive}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {t('community.import.dragDropHint')}
          </div>

          {preview && <ImportPreviewTable preview={preview} />}

          {csvText && (
            <button type="button" className={styles.importButton} onClick={handleImport} disabled={submitting}>
              {submitting ? t('community.import.importingCta') : t('community.import.importContactsCta')}
            </button>
          )}

          <ImportResultBanner outcome={outcome} error={error} />
        </div>
      </div>
    </div>
  );
}
