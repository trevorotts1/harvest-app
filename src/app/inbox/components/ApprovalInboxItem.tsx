// T-33 — the Approval Inbox item (master-spec §9.2; uiux §4.3/§5.6). Anatomy: agent identity +
// contact + channel + drafted-at header; body preview; the CFE status chip (icon + label, never
// color alone, §6.1); footer — Approve / Edit / Decline. Editing ALWAYS re-enters the CFE
// (uiux AC-5.6-3): while the re-check is in flight, actions disable and the item shows "Re-checking"
// — the NEW band replaces the old the moment the response lands, never the stale one. A HELD/blocked
// item exposes only "Use compliant rewrite" (edit) / "Discard" (decline) — no Approve affordance
// exists in this component's rendering for that state, mirroring the server's own 403
// (AC-5.6-4 "cannot be approved by any UI path").
//
// NO BATCH APPROVE: this component's `onApprove`/`onDecline`/`onEdit` callbacks each take exactly
// the ONE item's id — there is no multi-select affordance anywhere in this file, by construction
// (uiux §5.6 "Batch operations do not exist by design").
//
// QUEUED-OFFLINE (T-54, master-spec §17.6; uiux §4.3 "queued-offline ... will finish when you're
// back online; it will re-check compliance first"): `item.queuedOffline` is a PAGE-owned, ephemeral
// flag (never persisted server-side) set the moment `src/app/inbox/page.tsx` enqueues an
// approve/decline/edit taken while offline (`src/app/inbox/offline.ts`). While it is true, this
// component intentionally shows NEITHER a CFE chip claim NOR the action footer — the chip's own
// default branch would otherwise render a misleading "Pass" for content that has NOT actually been
// re-checked since the rep queued their action; the honest state is a single banner. It is read
// straight off the `item` PROP (not the internal `current` state, which is only ever mutated by this
// component's own successful edit) so a parent re-render that flips this flag is always reflected
// immediately, regardless of whether `current` has itself changed.
//
// APPROVE-BUTTON CFE GATE (T-R16, from T-R13 QC; uiux AC-5.6-5) — COEXISTS with the offline logic
// above, does not replace it: the plain, one-tap Approve button is now gated on `cfe_outcome ===
// 'PASS'` IN ADDITION TO the pre-existing `!isHeld` check. A FLAG/PENDING (non-PASS, non-HELD) draft
// never shows that plain affordance — an enabled one-tap Approve on a flagged item was misleading
// (the server enforces stricter rules for it in some hosts, e.g. the Shift's own
// `ShiftApprovalRequiresReviewError`). Instead it gets a SEPARATE "Approve with justification"
// control (a short required justification textarea + its own button, uiux AC-5.6-5's "capture a
// short justification"), which still calls the SAME `onApprove` callback (with the justification as
// a second, optional argument) — never a second approval code path. Both this PASS-only plain button
// and the FLAG-only justification control are additionally still wrapped in this file's existing
// `!queuedOffline` footer condition, so "online AND cfe_outcome==='PASS' AND not HELD" (or, for the
// justification control, "online AND cfe_outcome==='FLAG' AND not HELD") are exactly the three
// conditions that must ALL hold before either Approve affordance renders — the offline suppression
// and the CFE gate compose, neither one bypasses the other. HELD items get neither, unchanged.

'use client';

import { useState } from 'react';

import { useLocale } from '@/app/locale-context';
import { formatDateTime } from '@/lib/i18n/format';
import type { TVars } from '@/lib/i18n/catalog';
import { channelLabel } from '@/lib/i18n/channel-display';
import ContactControls from './ContactControls';
import ClassifierAdjudicationDrawer from './ClassifierAdjudicationDrawer';
import CfeExplainer from './CfeExplainer';
import styles from '../inbox.module.css';

export type CfeOutcome = 'PASS' | 'FLAG' | 'BLOCK' | 'RECORDED' | null;
export type ApprovalState = 'PENDING' | 'APPROVED' | 'DECLINED' | 'HELD';

export interface InboxItemData {
  id: string;
  contact_id: string;
  contact: { firstName: string; lastName: string } | null;
  channel: string;
  body: string;
  cfe_outcome: CfeOutcome;
  cfe_risk_score: number | null;
  approval_state: ApprovalState;
  created_at: string;
  agentsPaused?: boolean;
  doNotContact?: boolean;
  // T-57 R3c-2 (findings m4) — additive, optional exactly like the two above, so every existing
  // caller (which does not yet populate this from `Contact.manual_mode`) keeps compiling.
  manualMode?: boolean;
  // T-09 (§5.5 AC-1) — additive, all optional so every existing caller keeps compiling. The
  // draft's persisted per-classifier CFE data feeds the ClassifierAdjudicationDrawer; the advisory
  // recommendation fields are populated only on the upline compliance-review surface.
  cfe_classifier_data?: unknown;
  recommendedAction?: string | null;
  suggestedRewrite?: string | null;
  recommendationModel?: string | null;
  escalationReason?: string | null;
  /** T-54 — see this file's header "QUEUED-OFFLINE" note. Page-owned, ephemeral; absent/false for
   *  every existing caller (DraftApprovalCard, Approval Inbox list before an offline action). */
  queuedOffline?: boolean;
}

// T-R32 (i18n) — `labelKey` (a catalog key) replaces a hardcoded EN label; translated at render time
// via `t(opt.labelKey)`.
const DECLINE_REASON_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'not_my_voice', labelKey: 'inbox.item.declineReasons.notMyVoice' },
  { value: 'wrong_person', labelKey: 'inbox.item.declineReasons.wrongPerson' },
  { value: 'wrong_time', labelKey: 'inbox.item.declineReasons.wrongTime' },
  { value: 'other', labelKey: 'inbox.item.declineReasons.other' },
];

type Translate = (key: string, vars?: TVars) => string;

function cfeChip(outcome: CfeOutcome, checking: boolean, t: Translate) {
  if (checking) {
    return { className: styles.cfeChipChecking, label: t('inbox.item.chip.rechecking') };
  }
  if (outcome === 'BLOCK') return { className: styles.cfeChipBlock, label: t('inbox.item.chip.blocked') };
  if (outcome === 'FLAG') return { className: styles.cfeChipFlag, label: t('inbox.item.chip.flagged') };
  return { className: styles.cfeChipPass, label: t('inbox.item.chip.pass') };
}

export interface ApprovalInboxItemProps {
  item: InboxItemData;
  /** T-R16 — `justification` is passed ONLY from the flagged-approve control below (never from the
   *  plain PASS-only Approve button); a host that ignores the second argument (e.g. the Shift
   *  embed, whose server-side `actionCard` refuses any non-PASS approve regardless) loses nothing —
   *  the justification is optional precisely so every existing `onApprove` caller keeps compiling. */
  onApprove: (draftId: string, justification?: string) => Promise<{ ok: boolean; error?: string }>;
  onDecline: (draftId: string, reason: string, note?: string) => Promise<{ ok: boolean; error?: string }>;
  onEdit: (draftId: string, body: string) => Promise<{ ok: boolean; item?: InboxItemData; error?: string }>;
}

export default function ApprovalInboxItem({ item, onApprove, onDecline, onEdit }: ApprovalInboxItemProps) {
  const { locale, t } = useLocale();
  const [mode, setMode] = useState<'view' | 'editing' | 'declining'>('view');
  const [draftText, setDraftText] = useState(item.body);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  // T-R16 (uiux AC-5.6-5) — the flagged-approve justification draft text (see "APPROVE-BUTTON CFE
  // GATE" note above).
  const [justification, setJustification] = useState('');
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(item);

  const contactName = current.contact
    ? `${current.contact.firstName} ${current.contact.lastName}`
    : t('inbox.item.contactFallback');
  const chip = cfeChip(current.cfe_outcome, checking, t);
  const isHeld = current.approval_state === 'HELD';
  const isTerminal = current.approval_state === 'APPROVED' || current.approval_state === 'DECLINED';
  // T-54 — read from the PROP, not `current` (see this file's header "QUEUED-OFFLINE" note).
  const queuedOffline = item.queuedOffline === true;
  // T-R16 (uiux AC-5.6-5 / T-R13 QC "approve-button CFE gate") — the plain one-tap Approve requires
  // a clean PASS; a FLAG (non-PASS, non-HELD) PENDING draft gets the separate justification-gated
  // control below instead, never the plain button. Neither depends on `queuedOffline` directly —
  // both are additionally wrapped in the existing `!queuedOffline` footer condition below, which is
  // how the offline suppression and this CFE gate COEXIST (see this file's header note).
  const canPlainApprove = !isHeld && current.approval_state === 'PENDING' && current.cfe_outcome === 'PASS';
  const isFlaggedApprovable = !isHeld && current.approval_state === 'PENDING' && current.cfe_outcome === 'FLAG';

  async function handleApprove(justificationText?: string) {
    setBusy(true);
    setError(null);
    const result = await onApprove(current.id, justificationText);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t('inbox.errors.approveFailed'));
      return;
    }
    setJustification('');
  }

  async function handleSaveEdit() {
    setChecking(true);
    setError(null);
    const result = await onEdit(current.id, draftText);
    setChecking(false);
    if (!result.ok) {
      setError(result.error ?? t('inbox.item.editFailedGeneric'));
      return;
    }
    if (result.item) setCurrent(result.item);
    setMode('view');
  }

  async function handleDecline() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    const result = await onDecline(current.id, reason, note || undefined);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t('inbox.item.declineFailedGeneric'));
      return;
    }
    setMode('view');
  }

  // T-57 RG6 (i18n; master-spec §17.5) — the raw `MessageChannel` machine token (e.g. `SMS_HANDOFF`)
  // used to render either merely de-snake-cased ("sms handoff", the header chip below) or spliced
  // raw into the `draftToAria` interpolation (a Spanish rep/screen-reader user saw the raw English
  // token in both places) — now resolved through `channelLabel` (`@/lib/i18n/channel-display.ts`),
  // the same catalog-mapper shape as `errorDisplay`/`reasonDisplay`, ONCE, so both sites (and any
  // future one) can never drift apart.
  const channelText = channelLabel(t, current.channel);

  return (
    <article
      className={`${styles.item} ${isHeld ? styles.itemHeld : ''}`}
      aria-label={t('inbox.item.draftToAria', { name: contactName, channel: channelText })}
    >
      <div className={styles.itemHeader}>
        <div className={styles.itemHeaderMeta}>
          <span className={styles.agentChip}>{t('inbox.item.agentDraftLabel')}</span>
          <span>{t('inbox.item.separator')}</span>
          <span>{contactName}</span>
          <span>{t('inbox.item.separator')}</span>
          <span>{channelText}</span>
        </div>
        {/* T-54: while queued offline, the last-known band is stale-to-the-rep's-own-pending-action
            — showing it (esp. the chip's default "Pass" branch) would misrepresent an item that has
            NOT actually been re-checked since the rep queued this action. Show "Queued" instead. */}
        <span className={styles.cfeChipCluster}>
          <span className={`${styles.cfeChip} ${queuedOffline ? styles.cfeChipChecking : chip.className}`} role="status">
            <span aria-hidden="true">&#9673;</span> {queuedOffline ? t('inbox.item.chip.queued') : chip.label}
            {!queuedOffline && typeof current.cfe_risk_score === 'number' && !checking ? ` (${current.cfe_risk_score})` : ''}
          </span>
          {/* T-57 R3c-2 (A4, uiux AC-6-2) — reachable directly from the chip itself, every outcome,
              not buried inside the technical ClassifierAdjudicationDrawer below. Suppressed while
              queued-offline/checking — there is no settled verdict to plain-language-explain yet. */}
          {!queuedOffline && !checking && (
            <CfeExplainer
              outcome={current.cfe_outcome}
              classifierData={current.cfe_classifier_data}
              idSuffix={`${current.id}-chip`}
            />
          )}
        </span>
      </div>

      {queuedOffline ? (
        // uiux §4.3 "queued-offline (approval recorded locally, 'will finish when you're back
        // online; it will re-check compliance first' — §6.4)" — verbatim copy, no action footer
        // while this is showing (nothing here is approvable/declinable/editable until it syncs).
        <p className={styles.offlineQueuedBanner} role="status">
          {t('inbox.item.queuedBanner')}
        </p>
      ) : (
        isHeld && (
          <div className={styles.heldBanner}>
            <p className={styles.heldBannerText} role="alert">
              {t('inbox.item.heldBanner')}
            </p>
            {/* T-57 R3c-2 (A4) — reachable directly from the held banner too, not only the chip. */}
            <CfeExplainer
              outcome={current.cfe_outcome}
              classifierData={current.cfe_classifier_data}
              idSuffix={`${current.id}-held`}
            />
          </div>
        )
      )}

      {mode === 'editing' ? (
        <textarea
          className={styles.editArea}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          aria-label={t('inbox.item.editAria')}
          disabled={checking}
        />
      ) : (
        <p className={styles.itemBody}>{current.body}</p>
      )}

      <p className={styles.itemMeta}>
        {t('inbox.item.draftedAt', { date: formatDateTime(locale, current.created_at) })}
      </p>

      {error && (
        <p className={styles.errorState} role="alert">
          {error}
        </p>
      )}

      {!queuedOffline && mode === 'declining' && (
        <div className={styles.reasonRow} role="radiogroup" aria-label={t('inbox.item.reasonForDecliningAria')}>
          {DECLINE_REASON_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={reason === opt.value}
              className={`${styles.reasonChip} ${reason === opt.value ? styles.reasonChipSelected : ''}`}
              onClick={() => setReason(opt.value)}
            >
              {t(opt.labelKey)}
            </button>
          ))}
          <input
            className={styles.noteInput}
            placeholder={t('inbox.item.optionalNotePlaceholder')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label={t('inbox.item.optionalNoteAria')}
          />
        </div>
      )}

      {/* T-R16 (uiux AC-5.6-5) — the flagged-approve justification input. Only rendered for a
          FLAG/PENDING draft in view mode, online (not queuedOffline) — a clean PASS draft never
          sees this (no justification is required or captured for it), and a HELD draft has no
          approve path at all. */}
      {!queuedOffline && mode === 'view' && isFlaggedApprovable && (
        <div className={styles.justificationRow}>
          <label htmlFor={`justification-${current.id}`} className={styles.justificationLabel}>
            {t('inbox.item.justificationPrompt')}
          </label>
          <textarea
            id={`justification-${current.id}`}
            className={styles.justificationInput}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder={t('inbox.item.justificationPlaceholder')}
            aria-label={t('inbox.item.justificationAria')}
            disabled={busy}
          />
        </div>
      )}

      {!isTerminal && !queuedOffline && (
        <div className={styles.itemFooter}>
          {mode === 'view' && canPlainApprove && (
            <button
              type="button"
              className={`${styles.actionButton} ${styles.approveButton}`}
              onClick={() => handleApprove()}
              disabled={busy}
            >
              {t('inbox.item.approve')}
            </button>
          )}
          {mode === 'view' && isFlaggedApprovable && (
            <button
              type="button"
              className={`${styles.actionButton} ${styles.approveButton}`}
              onClick={() => handleApprove(justification)}
              disabled={busy || justification.trim().length === 0}
            >
              {t('inbox.item.approveWithJustification')}
            </button>
          )}
          {mode === 'editing' ? (
            <>
              <button type="button" className={styles.actionButton} onClick={handleSaveEdit} disabled={checking}>
                {checking ? t('inbox.item.rechecking') : isHeld ? t('inbox.item.useRewrite') : t('inbox.item.saveAndRecheck')}
              </button>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => {
                  setDraftText(current.body);
                  setMode('view');
                }}
                disabled={checking}
              >
                {t('common.cancel')}
              </button>
            </>
          ) : (
            <button type="button" className={styles.actionButton} onClick={() => setMode('editing')} disabled={busy}>
              {t('inbox.item.edit')}
            </button>
          )}
          {mode === 'declining' ? (
            <>
              <button
                type="button"
                className={`${styles.actionButton} ${styles.declineButton}`}
                onClick={handleDecline}
                disabled={busy || !reason}
              >
                {isHeld ? t('inbox.item.discard') : t('inbox.item.confirmDecline')}
              </button>
              <button type="button" className={styles.actionButton} onClick={() => setMode('view')} disabled={busy}>
                {t('common.cancel')}
              </button>
            </>
          ) : (
            mode === 'view' && (
              <button
                type="button"
                className={`${styles.actionButton} ${styles.declineButton}`}
                onClick={() => setMode('declining')}
                disabled={busy}
              >
                {isHeld ? t('inbox.item.discard') : t('inbox.item.decline')}
              </button>
            )
          )}
        </div>
      )}

      {/* T-09 (§5.5 AC-1) — additive compliance-detail disclosure (classifier confidences + risk
          score + any advisory recommendation). Suppressed while queued-offline, matching the chip's
          own stale-band suppression above. */}
      {!queuedOffline && (
        <ClassifierAdjudicationDrawer
          classifierData={current.cfe_classifier_data}
          riskScore={current.cfe_risk_score}
          recommendedAction={current.recommendedAction}
          suggestedRewrite={current.suggestedRewrite}
          recommendationModel={current.recommendationModel}
          escalationReason={current.escalationReason}
          cfeOutcome={current.cfe_outcome}
        />
      )}

      <ContactControls
        contactId={current.contact_id}
        contactName={contactName}
        agentsPaused={current.agentsPaused ?? false}
        doNotContact={current.doNotContact ?? false}
        manualMode={current.manualMode ?? false}
      />
    </article>
  );
}
