// uiux §5.4 Layer 3 — Background Matching. The paper flips back, names return with an amber marker
// stroke (approximated here as a token-driven wavy underline — the illustrated hand-drawn stroke
// asset does not exist in this codebase; see T-28's SPEC_DEVIATIONS). Per highlighted contact: the
// four context tiles (Career Stage, Financial Situation, Family Context, Community Role) + an
// optional <=500-char note. The engine computes the Readiness Score in the background — this layer
// NEVER receives or renders it (only the server-returned doctrine corrections after submit,
// AC-5.4-3/5.4-4).
//
// OFFLINE (§5.4 "Offline"; T-R11): "Layer 3's matching requires connection: tiles capture offline,
// matching defers" — a deliberately different treatment than Layers 1-2 (which queue-and-replay).
// Tile/note edits below are already local-only React state regardless of connectivity, so nothing
// typed here is ever lost either way; the ONLY thing gated by `offline` is the final submit, which
// is replaced with the honest deferred notice instead of a disabled-looking dead button — never a
// silent no-op, never a crash.

'use client';

import { MAX_NOTE_LENGTH } from '@/services/harvest-method/doctrine-notes';
import type { BackgroundContextTiles, NoteCorrection } from '@/types/harvest-method';

import styles from '../ritual.module.css';

const CAREER_STAGE_OPTIONS = [
  { value: 'transitioning', label: 'Transitioning' },
  { value: 'early', label: 'Early career' },
  { value: 'established', label: 'Established' },
  { value: 'near_retirement', label: 'Near retirement' },
];

const FINANCIAL_SITUATION_OPTIONS = [
  { value: 'building', label: 'Building' },
  { value: 'stuck', label: 'Feeling stuck' },
  { value: 'just_starting', label: 'Just starting out' },
  { value: 'wealth_building', label: 'Wealth building' },
];

const FAMILY_CONTEXT_OPTIONS = [
  { value: 'young_family', label: 'Young family' },
  { value: 'empty_nester', label: 'Empty nester' },
  { value: 'single', label: 'Single' },
  { value: 'multigenerational', label: 'Multigenerational household' },
];

const COMMUNITY_ROLE_OPTIONS = [
  { value: 'connector', label: 'Connector' },
  { value: 'volunteer', label: 'Volunteer' },
  { value: 'quiet_supporter', label: 'Quiet supporter' },
  { value: 'newcomer', label: 'Newcomer' },
];

export interface BackgroundMatchingDraftEntry {
  contactId: string;
  name: string;
  tiles: BackgroundContextTiles;
  note: string;
  existingLicenseeFlag: boolean;
}

export interface BackgroundMatchingLayerProps {
  entries: BackgroundMatchingDraftEntry[];
  onChangeTile: (contactId: string, tile: keyof BackgroundContextTiles, value: string) => void;
  onChangeNote: (contactId: string, note: string) => void;
  onToggleExistingLicensee: (contactId: string) => void;
  corrections: NoteCorrection[];
  onSubmit: () => void;
  flipping?: boolean;
  /** True while the browser is offline (§5.4 "Offline" — T-R11). Tile/note capture stays fully
   *  interactive; only the submit action is replaced with the deferred notice. */
  offline?: boolean;
}

function TileSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className={styles.tileField}>
      <label className={styles.tileLabel} htmlFor={id}>
        {label}
      </label>
      <select id={id} className={styles.tileSelect} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not set</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function BackgroundMatchingLayer({
  entries,
  onChangeTile,
  onChangeNote,
  onToggleExistingLicensee,
  corrections,
  onSubmit,
  flipping = false,
  offline = false,
}: BackgroundMatchingLayerProps) {
  return (
    <section
      className={`${styles.paper} ${flipping ? styles.paperFlipping : ''}`}
      aria-label="Background Matching — Layer 3 of 3"
    >
      <p className={styles.eyebrow}>Layer 3 of 3 &middot; Background Matching</p>
      <h2 className={styles.sectionPrompt}>Highlight the matches — tap to fill in what you know.</h2>

      {entries.map((entry) => {
        const correction = corrections.find((c) => c.contactId === entry.contactId);
        return (
          <div key={entry.contactId} className={styles.swipeCard}>
            <p className={styles.swipeName}>
              <span className={styles.markerStroke}>{entry.name}</span>
            </p>

            <div className={styles.tileGrid}>
              <TileSelect
                id={`career-${entry.contactId}`}
                label="Career Stage"
                value={entry.tiles.careerStage}
                options={CAREER_STAGE_OPTIONS}
                onChange={(v) => onChangeTile(entry.contactId, 'careerStage', v)}
              />
              <TileSelect
                id={`financial-${entry.contactId}`}
                label="Financial Situation"
                value={entry.tiles.financialSituation}
                options={FINANCIAL_SITUATION_OPTIONS}
                onChange={(v) => onChangeTile(entry.contactId, 'financialSituation', v)}
              />
              <TileSelect
                id={`family-${entry.contactId}`}
                label="Family Context"
                value={entry.tiles.familyContext}
                options={FAMILY_CONTEXT_OPTIONS}
                onChange={(v) => onChangeTile(entry.contactId, 'familyContext', v)}
              />
              <TileSelect
                id={`community-${entry.contactId}`}
                label="Community Role"
                value={entry.tiles.communityRole}
                options={COMMUNITY_ROLE_OPTIONS}
                onChange={(v) => onChangeTile(entry.contactId, 'communityRole', v)}
              />
            </div>

            <label className={styles.tileLabel} htmlFor={`note-${entry.contactId}`}>
              Note (optional)
            </label>
            <textarea
              id={`note-${entry.contactId}`}
              className={styles.noteField}
              maxLength={MAX_NOTE_LENGTH}
              value={entry.note}
              onChange={(e) => onChangeNote(entry.contactId, e.target.value)}
            />
            <p className={styles.noteCounter}>
              {entry.note.length}/{MAX_NOTE_LENGTH}
            </p>

            {correction && (
              <p className={styles.correctionNote} role="status">
                We corrected a word in this note to keep it doctrine-clean: &ldquo;{correction.corrected}&rdquo;
              </p>
            )}

            <div className={styles.licenseeToggleRow}>
              <input
                id={`licensee-${entry.contactId}`}
                type="checkbox"
                checked={entry.existingLicenseeFlag}
                onChange={() => onToggleExistingLicensee(entry.contactId)}
              />
              <label htmlFor={`licensee-${entry.contactId}`}>This person already holds a license</label>
            </div>
          </div>
        );
      })}

      <div className={styles.actions}>
        {offline ? (
          <p className={styles.deferredNotice} role="status">
            We&rsquo;ll finish matching when you&rsquo;re back online. What you&rsquo;ve entered here is saved.
          </p>
        ) : (
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onSubmit}>
            Finish matching
          </button>
        )}
      </div>
    </section>
  );
}
