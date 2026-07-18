// uiux §5.4 Layer 1 — Blank Canvas. A blank paper surface (§1.1 item 4 ritual texture), the Vault
// count as a NUMBER ONLY (never names), free-typed names against a 20-dot constellation, soft-match
// against the Vault, and the §8.1 soft gate ("are you sure you want to stop at N?") — which asks
// once and NEVER hard-blocks (AC-5.4-1).

'use client';

import { useState } from 'react';

import styles from '../ritual.module.css';

export const CONSTELLATION_SIZE = 20;

export interface BlankCanvasDraftEntry {
  typedName: string;
  matched: boolean;
  /** Present only when `matched` — the soft-matched Vault contact id (§5.4 Layer 1). */
  contactId?: string;
}

export interface BlankCanvasLayerProps {
  vaultCount: number;
  entries: BlankCanvasDraftEntry[];
  onAddName: (name: string) => void;
  /** True once the rep has tapped "That's my list" with < 5 names and the soft gate is showing. */
  softGateOpen: boolean;
  onRequestFinish: () => void;
  onConfirmSoftGate: () => void;
  onKeepAdding: () => void;
  flipping?: boolean;
}

export default function BlankCanvasLayer({
  vaultCount,
  entries,
  onAddName,
  softGateOpen,
  onRequestFinish,
  onConfirmSoftGate,
  onKeepAdding,
  flipping = false,
}: BlankCanvasLayerProps) {
  const [draft, setDraft] = useState('');

  function submitName(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onAddName(trimmed);
    setDraft('');
  }

  const dots = Array.from({ length: CONSTELLATION_SIZE }, (_, i) => entries[i]);

  return (
    <section
      className={`${styles.paper} ${flipping ? styles.paperFlipping : ''}`}
      aria-label="Blank Canvas — Layer 1 of 3"
    >
      <p className={styles.eyebrow}>Layer 1 of 3 &middot; Blank Canvas</p>

      <p className={styles.vaultCount}>You have {vaultCount} people in your field.</p>

      {/* Decorative ambient timer — never gates completion (§5.4 A11y). */}
      <div className={styles.ambientTimer} aria-hidden="true" />

      <h1 className={styles.visionPrompt}>
        If money and fear were both taken out of the equation, who are the ~20 people you genuinely
        believe would benefit from learning about building wealth?
      </h1>

      <div className={styles.constellation} role="list" aria-label="Your 20-name constellation">
        {dots.map((entry, i) => (
          <div
            key={i}
            role="listitem"
            className={`${styles.dot} ${entry ? (entry.matched ? styles.dotFilled : styles.dotUnmatched) : ''}`}
            title={entry ? (entry.matched ? `${entry.typedName} — matched in your Vault` : `${entry.typedName} — add?`) : 'Open position'}
          >
            {entry ? entry.typedName.charAt(0).toUpperCase() : ''}
          </div>
        ))}
      </div>

      <form className={styles.nameForm} onSubmit={submitName}>
        <label htmlFor="blank-canvas-name" className={styles.srOnly}>
          Type one name
        </label>
        <input
          id="blank-canvas-name"
          className={styles.nameInput}
          type="text"
          placeholder="Type a first name..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className={`${styles.btn} ${styles.btnSecondary}`}>
          Add
        </button>
      </form>

      <ul className={styles.enteredList} aria-label="Names entered so far">
        {entries.map((entry, i) => (
          <li key={i} className={styles.enteredChip}>
            {entry.typedName}
            {entry.matched ? ' ✓' : ' (add?)'}
          </li>
        ))}
      </ul>

      {softGateOpen && (
        <div className={styles.softGate} role="alert">
          <p className={styles.softGateText}>
            Are you sure you want to stop at {entries.length}? Most people find more once they
            start.
          </p>
          <div className={styles.actions}>
            <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onKeepAdding}>
              Keep adding
            </button>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onConfirmSoftGate}>
              Yes, that&rsquo;s my list
            </button>
          </div>
        </div>
      )}

      {!softGateOpen && (
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={entries.length === 0}
            onClick={onRequestFinish}
          >
            That&rsquo;s my list
          </button>
        </div>
      )}
    </section>
  );
}
