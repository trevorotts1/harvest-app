// T-33 — per-contact agent controls (master-spec §9.4; uiux §5.7 "Pause agents for {name}" / "Do
// not contact" / "Hand to me"), each taking effect immediately with a visible confirmation
// (AC-5.7-4). Reusable — dropped into the Approval Inbox item detail here (a natural place a rep
// decides "not this relationship") and intended for the future contact-detail/messaging surface
// (§5.7) as well.
//
// Calls the REAL `/api/contacts/controls` route (T-33) — no demo/mock fallback. The three toggles
// are independent: this component always sends exactly ONE field per call, mirroring
// `ContactControlsService.setControls`'s independence guarantee.
//
// T-57 R3c-2 (findings m4 + B-M5): adds the THIRD control, "manual mode" (master-spec §9.4 "hand a
// thread to manual mode" — this file's own original header already named it "Hand to me" but never
// implemented it). ALSO fully i18n's this file — findings B-M5 flagged it as having ZERO i18n
// (ternary button labels, template-literal aria-labels, and setState() string args — the three
// shapes `guard-no-literals-in-components.mjs`'s current AST walk cannot see, per findings B5 — so
// this file silently passed the build guard despite being 100% hardcoded EN). Every string below now
// resolves through the catalog under the NEW `contactControls.*` namespace, real EN + ES.

'use client';

import { useState } from 'react';

import { useT } from '@/app/locale-context';
import styles from '../inbox.module.css';

export interface ContactControlsProps {
  contactId: string;
  contactName: string;
  agentsPaused: boolean;
  doNotContact: boolean;
  /** T-57 R3c-2 (findings m4) — the third control's current state. Defaults to `false` so every
   *  existing caller (which does not yet read/pass a Contact.manual_mode value) keeps compiling and
   *  rendering correctly. */
  manualMode?: boolean;
  onChanged?: (next: { agentsPaused: boolean; doNotContact: boolean; manualMode: boolean }) => void;
}

type ControlField = 'agentsPaused' | 'doNotContact' | 'manualMode';

export default function ContactControls({
  contactId,
  contactName,
  agentsPaused,
  doNotContact,
  manualMode = false,
  onChanged,
}: ContactControlsProps) {
  const t = useT();
  const [paused, setPaused] = useState(agentsPaused);
  const [dnc, setDnc] = useState(doNotContact);
  const [manual, setManual] = useState(manualMode);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function setControl(field: ControlField, next: boolean) {
    setPending(true);
    setConfirmation(null);
    try {
      const res = await fetch('/api/contacts/controls', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contactId, [field]: next }),
      });
      if (!res.ok) {
        // T-54: a real (non-network) failure — never a silent no-op; the toggle itself already
        // stays at its pre-click value below (no optimistic flip), so nothing is misrepresented.
        setConfirmation(t('contactControls.error.saveFailed'));
        return;
      }
      const body = await res.json();
      setPaused(body.agentsPaused);
      setDnc(body.doNotContact);
      setManual(body.manualMode);
      onChanged?.({ agentsPaused: body.agentsPaused, doNotContact: body.doNotContact, manualMode: body.manualMode });
      if (field === 'agentsPaused') {
        setConfirmation(
          next
            ? t('contactControls.confirm.pausedOn', { name: contactName })
            : t('contactControls.confirm.pausedOff', { name: contactName })
        );
      } else if (field === 'doNotContact') {
        setConfirmation(
          next
            ? t('contactControls.confirm.dncOn', { name: contactName })
            : t('contactControls.confirm.dncOff', { name: contactName })
        );
      } else {
        setConfirmation(
          next
            ? t('contactControls.confirm.manualOn', { name: contactName })
            : t('contactControls.confirm.manualOff', { name: contactName })
        );
      }
    } catch {
      // T-54 (master-spec §17.6 "no silent failures"): offline (or any other network failure) must
      // never leave this control stuck `pending` forever via an unhandled rejection — this toggle
      // is a live, immediate-effect control (§9.4), not a queueable draft, so there is nothing to
      // offline-queue here; the honest behavior is "didn't happen, try again once you're back".
      setConfirmation(t('contactControls.error.offline'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.controlsRow} role="group" aria-label={t('contactControls.groupAria', { name: contactName })}>
      <button
        type="button"
        role="switch"
        aria-checked={paused}
        aria-label={t('contactControls.pause.aria', { name: contactName })}
        className={`${styles.controlToggle} ${paused ? styles.controlToggleOn : ''}`}
        onClick={() => setControl('agentsPaused', !paused)}
        disabled={pending}
      >
        {paused ? t('contactControls.pause.on') : t('contactControls.pause.off')}
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={dnc}
        aria-label={t('contactControls.dnc.aria', { name: contactName })}
        className={`${styles.controlToggle} ${dnc ? styles.controlToggleDangerOn : styles.controlToggleDanger}`}
        onClick={() => setControl('doNotContact', !dnc)}
        disabled={pending}
      >
        {dnc ? t('contactControls.dnc.on') : t('contactControls.dnc.off')}
      </button>
      {/* T-57 R3c-2 (findings m4) — the third control, "hand to manual mode" (§9.4). Its own
          min-height uses the 44px floor directly (a genuinely NEW interactive element, unlike the
          two above, which are pre-existing/grandfathered — see scripts/TOUCH_TARGET_BASELINE.json's
          own header note on `.controlToggle`). */}
      <button
        type="button"
        role="switch"
        aria-checked={manual}
        aria-label={t('contactControls.manual.aria', { name: contactName })}
        className={`${styles.controlToggleManual} ${manual ? styles.controlToggleManualOn : ''}`}
        onClick={() => setControl('manualMode', !manual)}
        disabled={pending}
      >
        {manual ? t('contactControls.manual.on') : t('contactControls.manual.off')}
      </button>
      {confirmation && (
        <span className={styles.controlConfirm} role="status">
          {confirmation}
        </span>
      )}
    </div>
  );
}
