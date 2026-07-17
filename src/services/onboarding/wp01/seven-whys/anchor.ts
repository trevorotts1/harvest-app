// WP01 §6.4 — anchor-statement composition + the doctrine-vocab-clean guard (§0.5).
//
// The anchor statement is composed exactly once, when the invisible >70 completion gate first
// passes (see ./engine.ts). This module is the single call site for that composition so the
// vocab-clean check is never skippable by a different code path composing an anchor another way.

import { findForbiddenTerms } from '../../../../types/onboarding';
import { SevenWhysConversationClient } from './claude-client';
import { SevenWhysTranscriptEntry } from './types';

export class SevenWhysAnchorVocabViolationError extends Error {
  constructor(public readonly terms: string[]) {
    super(
      `Composed anchor statement used forbidden doctrine vocabulary (§0.5): ${terms.join(', ')}`
    );
    this.name = 'SevenWhysAnchorVocabViolationError';
  }
}

/**
 * Composes the anchor statement from a completed transcript via the injected conversation client,
 * then enforces the platform-wide doctrine vocabulary rule (§0.5) before returning it. This is a
 * defensive check on top of the system prompt's own instruction (see ./claude-client.ts) — it never
 * trusts model output to already be clean.
 */
export async function finalizeAnchorStatement(
  client: SevenWhysConversationClient,
  transcript: SevenWhysTranscriptEntry[]
): Promise<string> {
  const { anchorStatement } = await client.composeAnchor({ transcript });

  const violations = findForbiddenTerms(anchorStatement);
  if (violations.length > 0) {
    throw new SevenWhysAnchorVocabViolationError(violations);
  }

  return anchorStatement;
}
