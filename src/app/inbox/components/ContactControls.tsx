// T-33 — per-contact agent controls (master-spec §9.4; uiux §5.7 "Pause agents for {name}" / "Do
// not contact"), each taking effect immediately with a visible confirmation (AC-5.7-4). Reusable —
// dropped into the Approval Inbox item detail here (a natural place a rep decides "not this
// relationship") and intended for the future contact-detail/messaging surface (§5.7) as well.
//
// Calls the REAL `/api/contacts/controls` route (T-33) — no demo/mock fallback. The two toggles are
// independent: this component always sends exactly ONE field per call, mirroring
// `ContactControlsService.setControls`'s independence guarantee.

'use client';

import { useState } from 'react';

import styles from '../inbox.module.css';

export interface ContactControlsProps {
  contactId: string;
  contactName: string;
  agentsPaused: boolean;
  doNotContact: boolean;
  onChanged?: (next: { agentsPaused: boolean; doNotContact: boolean }) => void;
}

export default function ContactControls({
  contactId,
  contactName,
  agentsPaused,
  doNotContact,
  onChanged,
}: ContactControlsProps) {
  const [paused, setPaused] = useState(agentsPaused);
  const [dnc, setDnc] = useState(doNotContact);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function setControl(field: 'agentsPaused' | 'doNotContact', next: boolean) {
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
        setConfirmation('This could not be saved. Try again.');
        return;
      }
      const body = await res.json();
      setPaused(body.agentsPaused);
      setDnc(body.doNotContact);
      onChanged?.({ agentsPaused: body.agentsPaused, doNotContact: body.doNotContact });
      setConfirmation(
        field === 'agentsPaused'
          ? next
            ? `Agents paused for ${contactName}.`
            : `Agents resumed for ${contactName}.`
          : next
            ? `${contactName} marked do-not-contact — honored everywhere.`
            : `${contactName} is contactable again.`
      );
    } catch {
      // T-54 (master-spec §17.6 "no silent failures"): offline (or any other network failure) must
      // never leave this control stuck `pending` forever via an unhandled rejection — this toggle
      // is a live, immediate-effect control (§9.4), not a queueable draft, so there is nothing to
      // offline-queue here; the honest behavior is "didn't happen, try again once you're back".
      setConfirmation("Couldn't reach the server — you may be offline. Try again once you're back.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.controlsRow} role="group" aria-label={`Agent controls for ${contactName}`}>
      <button
        type="button"
        role="switch"
        aria-checked={paused}
        aria-label={`Pause agents for ${contactName}`}
        className={`${styles.controlToggle} ${paused ? styles.controlToggleOn : ''}`}
        onClick={() => setControl('agentsPaused', !paused)}
        disabled={pending}
      >
        {paused ? 'Agents paused' : 'Pause agents'}
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={dnc}
        aria-label={`Do not contact ${contactName}`}
        className={`${styles.controlToggle} ${dnc ? styles.controlToggleDangerOn : styles.controlToggleDanger}`}
        onClick={() => setControl('doNotContact', !dnc)}
        disabled={pending}
      >
        {dnc ? 'Do not contact — set' : 'Do not contact'}
      </button>
      {confirmation && (
        <span className={styles.controlConfirm} role="status">
          {confirmation}
        </span>
      )}
    </div>
  );
}
