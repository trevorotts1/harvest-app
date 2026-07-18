import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { PrioritizedQueueService } from '@/services/harvest-method/prioritized-queue.service';
import { AntiPatternBlockedError, rejectBatchPayload, rejectTierOverride } from '@/services/harvest-method/action-boundary';
import { lintNote, NoteTooLongError } from '@/services/harvest-method/doctrine-notes';
import { encryptOptionalField } from '@/services/warm-market/vault/vault-encryption';
import type { NoteCorrection } from '@/types/harvest-method';

// T-26 — marks a queue item actioned/dismissed. For a contact carrying the Layer-3 "existing
// licensee" soft-exclusion flag, this doubles as the required acknowledgment (§8.2).
//
// T-27 additions (§8.5 anti-patterns architecturally blocked; the doctrine linter extended to a
// second rep-authored-text surface):
//   - `rejectBatchPayload`/`rejectTierOverride` refuse (400), before the queue engine ever runs, a
//     batch-shaped payload ("batch cold outreach ... not supported") or a client-supplied
//     tier/score field ("manual A-tier override ... immutable").
//   - An optional `note` (what happened when the rep acted on this contact) is scanned + corrected
//     by the SAME doctrine linter (`lintNote` / `VocabularyClassifier`) Layer 3's Background
//     Matching note already uses (doctrine-notes.ts) — "lead"/"prospect"/etc. is caught and
//     corrected before the note is ever encrypted and persisted, and the correction is returned to
//     the caller (logged, §8.5) rather than silently swallowed. Persisted as a `ContactInteraction`
//     row (`type: 'ACTION_NOTE'`) — no schema change; reuses the existing free-form `type` column.
export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    rejectBatchPayload(body);
    rejectTierOverride(body);

    const { contactId, note } = body as { contactId?: unknown; note?: unknown };
    if (!contactId || typeof contactId !== 'string') {
      return NextResponse.json({ error: 'contactId is required' }, { status: 400 });
    }
    if (note !== undefined && typeof note !== 'string') {
      return NextResponse.json({ error: '"note" must be a string' }, { status: 400 });
    }

    // T-27 QC fast-follow (atomicity): ALL input validation that can 400 — the §8.1 500-char note
    // limit / doctrine-linter scan included — MUST be fully resolved before any side-effecting call
    // below (`markActionComplete`'s upsert, the `ContactInteraction` create). `lintNote` throws
    // `NoteTooLongError` synchronously the instant the raw note exceeds the limit; running it here,
    // BEFORE `markActionComplete`, guarantees a 400 NOTE_TOO_LONG response can never follow a
    // mutation that already committed. (`rejectBatchPayload`/`rejectTierOverride` above already ran
    // before this point, for the same reason.) The ownership check further down does NOT need to
    // move: `markActionComplete`'s own user_id+contact_id composite key already scopes ITS upsert to
    // this user, so it can't affect another user's data regardless of ownership — the ownership
    // check only guards the separate `ContactInteraction` write, and stays exactly where it was,
    // strictly before that write.
    const linted = typeof note === 'string' && note.length > 0 ? lintNote(contactId, note) : null;

    // Lazy: constructed per-request, not at module scope, so `next build`'s page-data collection
    // (which imports this module) never triggers the constructor's fail-closed
    // `getContactEncryptionKey()` default read (T-26 build-integration fix).
    const service = new PrioritizedQueueService();
    const result = await service.markActionComplete(identity.userId, contactId);

    let correction: NoteCorrection | null = null;
    if (result.success && linted) {
      // Defense-in-depth ownership check (mirrors /api/contacts/agent-queue's own pattern) before
      // any note is ever attached to a Contact — a successful `markActionComplete` already implies
      // this contact was seeded under THIS user's own method state, but the note write goes through
      // the Contact-linked `ContactInteraction` table, so it is re-verified here rather than assumed.
      const owned = await prisma.contact.findFirst({ where: { id: contactId, user_id: identity.userId } });
      if (owned) {
        correction = linted.correction;
        await prisma.contactInteraction.create({
          data: {
            contact_id: contactId,
            type: 'ACTION_NOTE',
            notes: encryptOptionalField(linted.text) ?? '',
          },
        });
      }
    }

    return NextResponse.json({ ...result, correction });
  } catch (error) {
    if (error instanceof AntiPatternBlockedError) {
      return NextResponse.json({ error: error.message, code: 'ANTI_PATTERN_BLOCKED', antiPattern: error.antiPattern }, { status: 400 });
    }
    if (error instanceof NoteTooLongError) {
      return NextResponse.json({ error: error.message, code: 'NOTE_TOO_LONG' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
