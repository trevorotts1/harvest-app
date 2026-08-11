// uiux §5.1 O-7 — Contact import with progressive permission. THREE beats BEFORE any OS dialog
// (AC-5.1-7): (1) value, (2) outcome preview, (3) then the OS request. Denial is graceful:
// CSV / manual add, never a dead end, and a later re-ask is registered.
//
// T-58 — two additive beats replacing the old fake "Import from Phone" success path
// (`onRequestPermission` used to just do `setContactCount(24)` with no permission ever asked and no
// contact ever read):
//   'select'      — permission GRANTED: the real, already-fetched device contacts, mapped + deduped
//                    (native-contacts-adapter.ts), presented as a rep-checked selection list. Nothing
//                    is imported until the rep explicitly confirms.
//   'unsupported' — WEB/non-native fail-closed path: native contact import is native-shell-only
//                    (§7.1) and is never even attempted on web/PWA — an honest "not available here"
//                    state with the same CSV/manual fallback the permission-DENIED beat offers,
//                    never a fabricated result.
// 'permission' is now the real async IN-FLIGHT state (checking/requesting OS permission, then
// reading the device) — no CTA of its own, since there is no user action to take while that promise
// is outstanding; it resolves into 'select' | 'denied' | 'unsupported' (an error also lands on
// 'denied' with `nativeImportError` set, see that beat below).

import StatusMessage from '@/components/StatusMessage';
import type { NativeContactCandidate } from '@/services/warm-market/vault/native-contacts-adapter';
import {
  CSV_TEMPLATE_EXAMPLE,
  CSV_TEMPLATE_FILENAME,
  CSV_TEMPLATE_HEADERS,
  buildContactCsvTemplate,
} from '@/services/warm-market/vault/csv-template';
import styles from '../onboarding.module.css';
import { useT } from '@/app/locale-context';

// R-13 — `'manual'` is the real contact-entry FORM beat (see ManualAddStep.tsx's header): the
// "Add one at a time" / reveal "Add people" actions land HERE, never back on 'unsupported'/'denied'
// (the catalog row's observed navigation loop). It is rendered by OnboardingFlow.tsx, not by this
// component, so ImportBeat gains the member and this component keeps rendering only the import
// beats it owns.
//
// R-14 — `'csv-format'` is the CSV FORMAT-GUIDANCE beat (the catalog row's (a): what columns the
// parser accepts, with examples + a downloadable template, (b)) and `'csv-outcome'` the CSV
// UPLOAD-SUCCESS beat (the catalog row's (c): filename "sitting" + the route's real
// imported/merged/skipped counts, with error feedback for malformed rows, before advancing). Both
// are rendered BY THIS component (unlike 'manual'), gated to the CSV path only.
export type ImportBeat = 'value' | 'preview' | 'permission' | 'select' | 'denied' | 'unsupported' | 'manual' | 'csv-format' | 'csv-outcome';

/** R-14 — the confirmation data a completed CSV import shows (taken verbatim from the
 *  `/api/onboarding/contacts-import` response — never fabricated client-side). */
export interface CsvImportOutcome {
  /** The file the rep actually selected ("sitting" on the confirmation, per the catalog row). */
  fileName: string;
  importedCount: number;
  mergedCount: number;
  skippedCount: number;
  /** True when the route reported malformed rows (errorRows) — surfaced as honest error feedback
   *  alongside the counts, never silently dropped. */
  hadErrorRows: boolean;
}

export interface ContactImportStepProps {
  beat: ImportBeat;
  onAdvance?: () => void;
  onRequestPermission?: () => void;
  onDeny?: () => void;
  /** R-14 — opens the REAL OS file picker (used by the 'csv-format' beat's "Import a CSV" button;
   *  the denied/unsupported beats' "Import a CSV" button goes through `onViewCsvFormat` first). */
  onUseCsv?: () => void;
  /** R-14 — from the phone-import fallback beats, "Import a CSV" leads to the format-guidance beat
   *  ('csv-format': columns + downloadable template) instead of straight to the picker. */
  onViewCsvFormat?: () => void;
  onAddManually?: () => void;
  /** T-R30 (parity GAP 1): true while a real CSV import (file picker → Vault ingestion) is
   *  in flight — relabels the CSV button and disables it against a double-submit. */
  csvImporting?: boolean;
  /** T-R30 (parity GAP 1): a real import failure (oversized file, network error, etc.) — surfaced
   *  as an alert rather than silently faking success. */
  csvError?: string | null;
  /** T-58 — the real, already-mapped+deduped device contacts for the 'select' beat. Empty (not
   *  missing) means "the device read succeeded but found nothing importable" — rendered as an
   *  honest empty state, never a silently-skipped screen. */
  nativeCandidates?: NativeContactCandidate[];
  /** T-58 — which candidates (by `contactId`) are currently checked for import. */
  nativeSelectedIds?: ReadonlySet<string>;
  onToggleNativeCandidate?: (contactId: string) => void;
  onSelectAllNative?: () => void;
  onDeselectAllNative?: () => void;
  /** T-58 — the rep's explicit "import these" confirmation; nothing is created before this fires. */
  onConfirmNativeImport?: () => void;
  onCancelNativeSelection?: () => void;
  /** T-58 — true while the confirmed selection is being POSTed to the real ingestion route. */
  nativeImporting?: boolean;
  /** T-58 — a real native-import failure (e.g. the OS device-contacts read itself threw) — distinct
   *  from a plain permission refusal, which has no error text at all (the rep didn't do anything
   *  wrong; something broke). Rendered alongside the 'denied' beat's fallback actions. */
  nativeImportError?: string | null;
  /** R-14 — the CSV import's upload-success data (the route's real response). Set on the
   *  'csv-outcome' beat; the confirmation then renders the filename + real counts before the rep
   *  continues. */
  csvOutcome?: CsvImportOutcome | null;
  /** R-14 — the 'csv-outcome' beat's Continue button (advances onward into the flow). */
  onCsvOutcomeContinue?: () => void;
}

const EMPTY_CANDIDATES: NativeContactCandidate[] = [];
const EMPTY_SELECTED: ReadonlySet<string> = new Set();

export default function ContactImportStep({
  beat,
  onAdvance,
  onRequestPermission,
  onDeny,
  onUseCsv,
  onViewCsvFormat,
  onAddManually,
  csvImporting = false,
  csvError = null,
  nativeCandidates = EMPTY_CANDIDATES,
  nativeSelectedIds = EMPTY_SELECTED,
  onToggleNativeCandidate,
  onSelectAllNative,
  onDeselectAllNative,
  onConfirmNativeImport,
  onCancelNativeSelection,
  nativeImporting = false,
  nativeImportError = null,
  csvOutcome = null,
  onCsvOutcomeContinue,
}: ContactImportStepProps) {
  const t = useT();

  // R-14 — the (b) downloadable template: a client-side-generated CSV file whose header line is
  // EXACTLY the canonical header set the real parser accepts (csv-parser.ts's `HEADER_ALIASES`
  // keys — see csv-template.ts). Built at click time with the same createObjectURL → anchor.click →
  // revokeObjectURL pattern the app's data-rights export already uses (no library, no network).
  function handleDownloadTemplate() {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
    const blob = new Blob([buildContactCsvTemplate()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = CSV_TEMPLATE_FILENAME;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // R-14 — the (a) on-screen format guidance: the exact columns the parser accepts (from the SAME
  // `CSV_TEMPLATE_HEADERS` the downloadable template uses — one source of truth), each marked
  // required/optional, with a real example value.
  if (beat === 'csv-format') {
    const required = CSV_TEMPLATE_HEADERS.slice(0, 1);
    const optional = CSV_TEMPLATE_HEADERS.slice(1);
    return (
      <div className={styles.stepInner}>
        <h1 className={styles.headline}>{t('onboarding.contactImport.csv.formatTitle')}</h1>
        <div className={styles.card}>
          <div className={styles.csvFormatGuide}>
            <p className={styles.lede}>{t('onboarding.contactImport.csv.formatLede')}</p>
            <table className={styles.csvFormatTable}>
              <thead>
                <tr>
                  <th scope="col">{t('onboarding.contactImport.csv.columnsLabel')}</th>
                  <th scope="col">{t('onboarding.contactImport.csv.requiredLabel')}</th>
                  <th scope="col">{t('onboarding.contactImport.csv.exampleLabel')}</th>
                </tr>
              </thead>
              <tbody>
                {required.map((column) => (
                  <tr key={column}>
                    <td>
                      <span className={styles.csvColumnName}>{column}</span>
                    </td>
                    <td>
                      <span className={styles.csvRequiredTag}>{t('onboarding.contactImport.csv.requiredLabel')}</span>
                    </td>
                    <td>
                      <span className={styles.csvExampleText}>{CSV_TEMPLATE_EXAMPLE[CSV_TEMPLATE_HEADERS.indexOf(column)]}</span>
                    </td>
                  </tr>
                ))}
                {optional.map((column) => (
                  <tr key={column}>
                    <td>
                      <span className={styles.csvColumnName}>{column}</span>
                    </td>
                    <td>
                      <span className={styles.csvOptionalTag}>{t('onboarding.contactImport.csv.optionalLabel')}</span>
                    </td>
                    <td>
                      <span className={styles.csvExampleText}>{CSV_TEMPLATE_EXAMPLE[CSV_TEMPLATE_HEADERS.indexOf(column)]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={styles.csvLimitsCaption}>{t('onboarding.contactImport.csv.limitsCaption')}</p>
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleDownloadTemplate}>
            {t('onboarding.contactImport.csv.downloadTemplateCta')}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onUseCsv} disabled={csvImporting}>
            {csvImporting ? t('onboarding.contactImport.denied.importingCta') : t('onboarding.contactImport.denied.importCsvCta')}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onAddManually}>
            {t('onboarding.contactImport.denied.addManuallyCta')}
          </button>
        </div>
        {csvError && <StatusMessage>{csvError}</StatusMessage>}
      </div>
    );
  }

  // R-14 — the (c) upload-success state: the selected file's name "sitting" on the screen plus the
  // route's REAL imported/merged/skipped counts (rendered from `csvOutcome`, never faked) and,
  // when the route reported malformed rows, honest error feedback — only then does the rep continue
  // onward into the flow (the catalog row's "silently advanced with nothing shown" gap). The card
  // is REAL information (not decorative, unlike the preview beat's) — readable by assistive tech,
  // and `role="status"` announces the counts as a polite status change.
  if (beat === 'csv-outcome') {
    return (
      <div className={styles.stepInner}>
        <h1 className={styles.headline}>{t('onboarding.contactImport.csvOutcome.headline')}</h1>
        <div className={styles.card} role="status">
          <ul className={styles.csvOutcomeList}>
            <li className={styles.csvOutcomeFilename}>{t('onboarding.contactImport.csvOutcome.filenameCaption', { fileName: csvOutcome?.fileName ?? '' })}</li>
            <li>{t('onboarding.contactImport.csvOutcome.importedLine', { count: csvOutcome?.importedCount ?? 0 })}</li>
            <li>{t('onboarding.contactImport.csvOutcome.mergedLine', { count: csvOutcome?.mergedCount ?? 0 })}</li>
            <li>{t('onboarding.contactImport.csvOutcome.skippedLine', { count: csvOutcome?.skippedCount ?? 0 })}</li>
            {csvOutcome?.hadErrorRows && <li className={styles.csvOutcomeSkippedHint}>{t('onboarding.contactImport.csvOutcome.skippedHint')}</li>}
          </ul>
        </div>
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onCsvOutcomeContinue}>
            {t('onboarding.contactImport.csvOutcome.continueCta')}
          </button>
        </div>
      </div>
    );
  }

  if (beat === 'value') {
    return (
      <div className={styles.stepInner}>
        <h1 className={styles.headline}>{t('onboarding.contactImport.value.headline')}</h1>
        <p className={styles.lede}>{t('onboarding.contactImport.value.lede')}</p>
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onAdvance}>
            {t('onboarding.continueCta')}
          </button>
        </div>
      </div>
    );
  }

  if (beat === 'preview') {
    return (
      <div className={styles.stepInner}>
        <h1 className={styles.headline}>{t('onboarding.contactImport.preview.headline')}</h1>
        <div className={styles.card} aria-hidden="true">
          <p className={styles.lede}>
            {t('onboarding.contactImport.preview.lede')}
          </p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onRequestPermission}>
            {t('onboarding.contactImport.preview.connectCta')}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onDeny}>
            {t('onboarding.contactImport.preview.notNowCta')}
          </button>
        </div>
      </div>
    );
  }

  if (beat === 'select') {
    const selectedCount = nativeSelectedIds.size;
    return (
      <div className={styles.stepInner}>
        <h1 className={styles.headline}>{t('onboarding.contactImport.select.headline')}</h1>
        {nativeCandidates.length === 0 ? (
          <p className={styles.lede}>{t('onboarding.contactImport.select.emptyState')}</p>
        ) : (
          <>
            <p className={styles.lede}>{t('onboarding.contactImport.select.lede')}</p>
            <div className={styles.contactPickHeaderRow}>
              <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onSelectAllNative}>
                {t('onboarding.contactImport.select.selectAllCta')}
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onDeselectAllNative}>
                {t('onboarding.contactImport.select.deselectAllCta')}
              </button>
            </div>
            <ul className={styles.contactPickList}>
              {nativeCandidates.map((candidate) => (
                <li key={candidate.contactId}>
                  <label className={styles.contactPickRow}>
                    <input
                      type="checkbox"
                      className={styles.contactPickCheckbox}
                      checked={nativeSelectedIds.has(candidate.contactId)}
                      onChange={() => onToggleNativeCandidate?.(candidate.contactId)}
                    />
                    <span className={styles.contactPickText}>
                      <span className={styles.contactPickName}>{candidate.row.name}</span>
                      {(candidate.row.phone || candidate.row.email) && (
                        <span className={styles.contactPickMeta}>{candidate.row.phone || candidate.row.email}</span>
                      )}
                      {candidate.isDuplicate && (
                        <span className={styles.contactPickDuplicate}>
                          {t('onboarding.contactImport.select.duplicateLabel')}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className={styles.actions}>
          {nativeCandidates.length > 0 && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={onConfirmNativeImport}
              disabled={nativeImporting || selectedCount === 0}
            >
              {nativeImporting
                ? t('onboarding.contactImport.select.importingCta')
                : selectedCount === 1
                  ? t('onboarding.contactImport.select.importCtaOne', { count: selectedCount })
                  : t('onboarding.contactImport.select.importCtaMany', { count: selectedCount })}
            </button>
          )}
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onCancelNativeSelection}>
            {t('onboarding.contactImport.select.cancelCta')}
          </button>
        </div>
      </div>
    );
  }

  if (beat === 'unsupported') {
    return (
      <div className={styles.stepInner}>
        <h1 className={styles.headline}>{t('onboarding.contactImport.unsupported.headline')}</h1>
        <p className={styles.lede}>{t('onboarding.contactImport.unsupported.lede')}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSecondary}`}
            onClick={onViewCsvFormat}
            disabled={csvImporting}
          >
            {csvImporting ? t('onboarding.contactImport.denied.importingCta') : t('onboarding.contactImport.denied.importCsvCta')}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onAddManually}>
            {t('onboarding.contactImport.denied.addManuallyCta')}
          </button>
        </div>
        {csvError && <StatusMessage>{csvError}</StatusMessage>}
      </div>
    );
  }

  if (beat === 'denied') {
    return (
      <div className={styles.stepInner}>
        <h1 className={styles.headline}>{t('onboarding.contactImport.denied.headline')}</h1>
        <p className={styles.lede}>{t('onboarding.contactImport.denied.lede')}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSecondary}`}
            onClick={onViewCsvFormat}
            disabled={csvImporting}
          >
            {csvImporting ? t('onboarding.contactImport.denied.importingCta') : t('onboarding.contactImport.denied.importCsvCta')}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onAddManually}>
            {t('onboarding.contactImport.denied.addManuallyCta')}
          </button>
        </div>
        {/* A real native-import FAILURE (not a plain permission refusal, which has no error text of
            its own) — distinct message, same honest-alert treatment as csvError below. */}
        {nativeImportError && <StatusMessage>{nativeImportError}</StatusMessage>}
        {csvError && <StatusMessage>{csvError}</StatusMessage>}
      </div>
    );
  }

  // 'permission' — the real async in-flight state: OS permission check/request, then the device
  // contacts read (native-import-flow.ts's `runNativeContactsDiscovery`). No CTA here by design —
  // there is no user action while that promise is outstanding; it resolves into 'select' (granted),
  // 'denied' (refused or errored), or 'unsupported' (web).
  return (
    <div className={styles.stepInner}>
      <h1 className={styles.headline}>{t('onboarding.contactImport.permission.headline')}</h1>
      <p className={styles.lede} aria-live="polite">
        {t('onboarding.contactImport.permission.lede')}
      </p>
    </div>
  );
}
