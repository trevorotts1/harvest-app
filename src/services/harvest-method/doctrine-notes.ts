// WP03 §8.5 — "'Lead'/'prospect' in any notes field -> detected and replaced with 'community
// contact,' logged." This module is the ONE place the Layer-3 Background Matching note (§8.1,
// <=500 chars) is scanned/corrected before it is ever encrypted and persisted — reusing the
// existing WP11 `VocabularyClassifier` (src/services/compliance/vocabulary.ts) rather than
// hand-rolling a second forbidden-term table (there must be exactly one doctrine vocabulary in
// this codebase to audit, per that module's own header).

import { VocabularyClassifier, type VocabularyViolation } from '../compliance/vocabulary';
import type { NoteCorrection } from '../../types/harvest-method';

export const MAX_NOTE_LENGTH = 500;

export class NoteTooLongError extends Error {
  constructor(length: number) {
    super(`Background Matching note is ${length} chars — the §8.1 limit is ${MAX_NOTE_LENGTH}.`);
    this.name = 'NoteTooLongError';
  }
}

const classifier = new VocabularyClassifier();

/**
 * Applies the doctrine linter's replacement table to a raw note. This is a deterministic, local,
 * regex-driven rewrite (mirrors the CFE's own stage-1 vocabulary pass) — never an LLM call — so it
 * is instant and side-effect-free to run on every save.
 */
function applyReplacements(content: string, violations: VocabularyViolation[]): string {
  let corrected = content;
  for (const v of violations) {
    // `v.match` is the exact substring the classifier's rule matched; replacing every case-
    // insensitive occurrence of that literal substring corrects the note without needing to
    // re-derive (or duplicate) the classifier's own regex table.
    const re = new RegExp(escapeRegExp(v.match), 'gi');
    corrected = corrected.replace(re, v.replacement);
  }
  return corrected;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface LintedNote {
  /** The text to actually persist (encrypted) — corrected of any forbidden term. */
  text: string;
  correction: NoteCorrection | null;
}

/**
 * Scans + corrects one contact's Layer-3 note (§8.5). Throws `NoteTooLongError` if the RAW input
 * exceeds the 500-char limit (checked before any rewrite, since a correction can only shrink or
 * hold length steady in this table — "prospect" -> "community member / warm-market contact" is
 * actually longer, so length is checked against the rep's own typed text, the fairest reading of
 * the §8.1 limit).
 */
export function lintNote(contactId: string, rawNote: string | undefined | null): LintedNote {
  if (!rawNote) return { text: '', correction: null };
  if (rawNote.length > MAX_NOTE_LENGTH) {
    throw new NoteTooLongError(rawNote.length);
  }

  const scan = classifier.scan(rawNote);
  if (scan.clean) {
    return { text: rawNote, correction: null };
  }

  const corrected = applyReplacements(rawNote, scan.violations);
  return {
    text: corrected,
    correction: {
      contactId,
      original: rawNote,
      corrected,
      violations: scan.violations,
    },
  };
}
