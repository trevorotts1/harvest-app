// T-R30 (parity GAP 1) — the pure/presentational pieces behind `/community/import`'s page shell.
// Kept OUT of `page.tsx` deliberately: a Next.js App Router `page.tsx` may only export a default
// component (plus a small allow-listed set like `metadata`/`generateStaticParams`) — `next build`
// fails typecheck ("... is not a valid Page export field") the moment any other named value is
// exported from that file, which is exactly what put these here instead.
//
// `parseCsvPreview` reuses the SAME `splitCsvLine`/`mapHeader` the server's authoritative
// `parseContactCsv` (csv-parser.ts) uses, rather than a second, hand-copied alias table — so the
// preview a rep sees here can never disagree with what the real Vault import actually does with the
// same file. This module never persists anything; only `page.tsx`'s POST to `/api/contacts/import`
// does, and that always goes through the real `VaultService` (AES-256-GCM encryption, keyed-HMAC
// dedupe, minors gate) — never a parallel plaintext path.

import { mapHeader, splitCsvLine, type MappedField } from '@/services/warm-market/vault/csv-parser';
import styles from '../community.module.css';
import { useT } from '@/app/locale-context';

export interface CsvPreview {
  headers: string[];
  mappedFields: (MappedField | null)[];
  rows: string[][];
  totalDataRows: number;
}

/** Pure, no React — the client-side field-mapping preview. Display-only: never enforces the §7.1
 *  size/row limits itself (the server does, returning 413 IMPORT_LIMIT_EXCEEDED on the real import). */
export function parseCsvPreview(csvText: string, maxRows = 5): CsvPreview {
  const lines = csvText.split(/\r\n|\r|\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return { headers: [], mappedFields: [], rows: [], totalDataRows: 0 };

  const headers = splitCsvLine(lines[0]);
  const mappedFields = headers.map(mapHeader);
  const dataLines = lines.slice(1);

  return {
    headers,
    mappedFields,
    rows: dataLines.slice(0, maxRows).map(splitCsvLine),
    totalDataRows: dataLines.length,
  };
}

const FIELD_LABEL_KEY: Record<MappedField, string> = {
  name: 'community.csvImport.fieldLabels.name',
  phone: 'community.csvImport.fieldLabels.phone',
  email: 'community.csvImport.fieldLabels.email',
  notes: 'community.csvImport.fieldLabels.notes',
  industry: 'community.csvImport.fieldLabels.industry',
  birthdate: 'community.csvImport.fieldLabels.birthdate',
  jurisdiction: 'community.csvImport.fieldLabels.jurisdiction',
};

/** Pure, prop-driven — the mapping-preview table. */
export function ImportPreviewTable({ preview }: { preview: CsvPreview }) {
  const t = useT();
  if (preview.headers.length === 0) return null;

  return (
    <div className={styles.previewTableWrap}>
      <table className={styles.previewTable} aria-label={t('community.csvImport.previewAriaLabel')}>
        <thead>
          <tr>
            {preview.headers.map((header, i) => (
              <th key={`${header}-${i}`}>
                {header}
                <div className={styles.previewFieldLabel}>
                  {preview.mappedFields[i]
                    ? t('community.csvImport.mappedTo', { label: t(FIELD_LABEL_KEY[preview.mappedFields[i] as MappedField]) })
                    : t('community.csvImport.unmappedLabel')}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row, r) => (
            <tr key={r}>
              {preview.headers.map((_, c) => (
                <td key={c}>{row[c] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {preview.totalDataRows > preview.rows.length && (
        <p className={styles.previewFieldLabel}>
          {t('community.csvImport.showingRows', { shown: preview.rows.length, total: preview.totalDataRows })}
        </p>
      )}
    </div>
  );
}

export interface ImportOutcome {
  importedCount: number;
  mergedCount: number;
  minorFlaggedCount: number;
  errorRows: { index: number; reason: string }[];
  resumable: boolean;
}

/** Pure, prop-driven — the real result banner (or a real failure banner). Never renders an
 *  outcome until the server has actually responded — no fabricated/optimistic count. */
export function ImportResultBanner({ outcome, error }: { outcome: ImportOutcome | null; error: string | null }) {
  const t = useT();
  if (error) {
    return (
      <div className={`${styles.resultBanner} ${styles.resultBannerError}`} role="alert">
        {error}
      </div>
    );
  }
  if (!outcome) return null;

  return (
    <div className={styles.resultBanner} role="status">
      <p>
        {t('community.csvImport.importedMerged', { imported: outcome.importedCount, merged: outcome.mergedCount })}
        {outcome.minorFlaggedCount > 0 && t('community.csvImport.minorsFlaggedSuffix', { count: outcome.minorFlaggedCount })}
      </p>
      {outcome.errorRows.length > 0 && (
        <p className={styles.previewFieldLabel}>
          {t(
            outcome.errorRows.length === 1 ? 'community.csvImport.errorRowsOne' : 'community.csvImport.errorRowsMany',
            { count: outcome.errorRows.length }
          )}
        </p>
      )}
      {outcome.resumable && <p className={styles.previewFieldLabel}>{t('community.csvImport.stillProcessingNotice')}</p>}
    </div>
  );
}
