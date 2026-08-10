// WP01 §6.4 / §3.2 — WhySession persistence.
//
// Storage for the Seven Whys transcript + anchor statement (§6.4: "Stored in WhySession with
// use_in_outreach_consent = false by default"). The Prisma `WhySession` model (T-03) already has
// every field this needs (`transcript`, `resonance_score`, `anchor_statement`, `why_photo_ref`,
// `use_in_outreach_consent Boolean @default(false)`) — no schema change is needed for T-18.
//
// Follows the same narrow, DI-mockable Prisma-delegate-shape pattern already used across this
// codebase (src/services/compliance/data-rights/data-rights.ts, src/services/warm-market/
// contact.service.ts): a small interface naming only the methods this file calls, so tests supply a
// plain mock object instead of a real Prisma client / live database.

import { decrypt, encrypt } from '../../../compliance/encryption/encryption';
import { SevenWhysEngineState } from './engine';
import {
  SEVEN_WHYS_LEVELS,
  SevenWhysConversationStatus,
  SevenWhysLevel,
  SevenWhysLevelRecord,
  SevenWhysTranscriptEntry,
} from './types';

/**
 * Name of the server-side key used to encrypt the Seven Whys transcript/anchor statement at rest
 * (§16.3, §6.4 — the rep's anchor statement and why-photo are "the most intimate data in the
 * product"). Read by name only (§0.4) — mirrors the same fail-closed posture as
 * `getMfaEncryptionKey` (src/lib/auth/env.ts) and `hmacForMatch`'s `CONTACT_HASH_PEPPER` guard
 * (src/services/compliance/encryption/encryption.ts).
 */
export const WHY_SESSION_ENCRYPTION_KEY_ENV_VAR = 'WHY_SESSION_ENCRYPTION_KEY';

export function getWhySessionEncryptionKey(): string {
  const key = process.env[WHY_SESSION_ENCRYPTION_KEY_ENV_VAR];
  if (!key) {
    throw new Error(
      `${WHY_SESSION_ENCRYPTION_KEY_ENV_VAR} is not set — refusing to store Seven Whys ` +
        'transcript/anchor-statement data without application-layer encryption at rest (§16.3, §6.4). ' +
        'Generate with: openssl rand -base64 32.'
    );
  }
  return key;
}

export interface WhySessionRow {
  id: string;
  user_id: string;
  transcript: unknown;
  resonance_score: number;
  anchor_statement: string | null;
  why_photo_ref: string | null;
  use_in_outreach_consent: boolean;
}

export interface WhySessionPrismaClient {
  whySession: {
    findFirst(args: { where: { user_id: string } }): Promise<WhySessionRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<WhySessionRow>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<WhySessionRow>;
  };
}

/** Wire shape stored in the (Json-typed) `transcript` column and the (String-typed) `anchor_statement` column. */
interface EncryptedEnvelope {
  ciphertext: string;
  iv: string;
  authTag: string;
  algorithm: string;
}

function encryptToEnvelope(plaintext: string, key: string): EncryptedEnvelope {
  const { ciphertext, iv, authTag, algorithm } = encrypt(plaintext, key);
  return { ciphertext, iv, authTag, algorithm };
}

function decryptEnvelope(envelope: EncryptedEnvelope, key: string): string {
  return decrypt(envelope, key);
}

function transcriptEntriesFromState(state: SevenWhysEngineState): SevenWhysTranscriptEntry[] {
  const entries: SevenWhysTranscriptEntry[] = [];
  for (const level of SEVEN_WHYS_LEVELS) {
    const record = state.levels[level];
    if (!record) continue;
    entries.push({ level, question: record.question, answer: record.answer ?? null });
  }
  return entries;
}

/**
 * The wire shape persisted inside the encrypted `transcript` envelope. Extends the plain
 * level-ordered Q&A list with the engine's hidden resume metadata — status, the currently open
 * (deepening) level, and each answered level's hidden depth signal — so a conversation resumed
 * from a later request replays EXACTLY (uiux §5.1 O-5 "resume" state), including the >70 gate's
 * `AWAITING_DEEPER_ANSWER` position and the per-level resonance signals the gate aggregates. All
 * of this stays inside the same encrypted-at-rest envelope as the transcript itself (§16.3) — it
 * is never rendered, never emitted as a score, and never exposed outside this module.
 */
export interface PersistedTranscriptEnvelope {
  entries: SevenWhysTranscriptEntry[];
  status: SevenWhysConversationStatus;
  deepenLevel: SevenWhysLevel | null;
  /** Index of the level currently open (unanswered or awaiting a deeper answer). */
  currentLevelIndex: number;
  /** Hidden 0–100 completion-gate score, present once the gate has been evaluated at least once. */
  resonanceScore: number | null;
  /** Hidden 0–1 per-level depth signals — the aggregate inputs, never rendered. */
  depthSignals: Partial<Record<SevenWhysLevel, number>>;
}

function envelopeFromState(state: SevenWhysEngineState): PersistedTranscriptEnvelope {
  const depthSignals: Partial<Record<SevenWhysLevel, number>> = {};
  for (const level of SEVEN_WHYS_LEVELS) {
    const signal = state.levels[level]?.depthSignal;
    if (typeof signal === 'number') depthSignals[level] = signal;
  }
  return {
    entries: transcriptEntriesFromState(state),
    status: state.status,
    deepenLevel: state.deepenLevel ?? null,
    currentLevelIndex: state.currentLevelIndex,
    resonanceScore: state.resonanceScore ?? null,
    depthSignals,
  };
}

/**
 * Rebuilds engine state from a persisted, decrypted transcript envelope. `currentLevelIndex`,
 * `status`, `deepenLevel`, `resonanceScore` and the per-level depth signals are restored verbatim
 * so the engine can continue exactly where it stopped — a resumed re-prompt still deepens at the
 * same level, and the >70 gate re-analyzes with the real historical signals, not a fresh estimate.
 */
export function stateFromPersistedTranscript(
  envelope: PersistedTranscriptEnvelope
): SevenWhysEngineState {
  const levels: SevenWhysEngineState['levels'] = {};
  for (const entry of envelope.entries) {
    const record: SevenWhysLevelRecord = {
      question: entry.question ?? '',
      ...(entry.answer !== null && entry.answer !== undefined ? { answer: entry.answer } : {}),
    };
    const signal = envelope.depthSignals[entry.level];
    if (typeof signal === 'number') record.depthSignal = signal;
    levels[entry.level] = record;
  }
  return {
    userId: '', // caller supplies the real user id on the returned state before use
    levels,
    currentLevelIndex: envelope.currentLevelIndex,
    status: envelope.status,
    ...(envelope.deepenLevel ? { deepenLevel: envelope.deepenLevel } : {}),
    ...(envelope.resonanceScore !== null ? { resonanceScore: envelope.resonanceScore } : {}),
  };
}

/**
 * Persists (creates or updates) the WhySession row for `state`. `use_in_outreach_consent` is NEVER
 * set true here — it is Prisma-default false on create, and left untouched on update (see
 * `setOutreachConsent` below, the only function permitted to change it). This is the programmatic
 * enforcement of §6.4's "default false, opt-in only": no progress-save code path can ever flip it.
 */
export async function saveSevenWhysProgress(
  prisma: WhySessionPrismaClient,
  state: SevenWhysEngineState,
  encryptionKey: string = getWhySessionEncryptionKey()
): Promise<WhySessionRow> {
  const transcriptPlain = JSON.stringify(envelopeFromState(state));
  const transcriptEnvelope = encryptToEnvelope(transcriptPlain, encryptionKey);

  const anchorEnvelope = state.anchorStatement
    ? encryptToEnvelope(state.anchorStatement, encryptionKey)
    : null;

  const existing = await prisma.whySession.findFirst({ where: { user_id: state.userId } });

  const sharedData: Record<string, unknown> = {
    transcript: transcriptEnvelope,
    resonance_score: state.resonanceScore ?? 0,
    anchor_statement: anchorEnvelope ? JSON.stringify(anchorEnvelope) : null,
    why_photo_ref: state.whyPhotoRef ?? null,
  };

  if (existing) {
    // §6.4: consent is a separate, rep-owned act — a progress save never touches it either way.
    return prisma.whySession.update({ where: { id: existing.id }, data: sharedData });
  }

  return prisma.whySession.create({
    data: {
      user_id: state.userId,
      ...sharedData,
      // Explicit, not just relying on the Prisma column default — the default-false requirement is
      // load-bearing enough (§6.4, uiux AC-5.1-5, QC checkpoint 6) to also assert it in code here.
      use_in_outreach_consent: false,
    },
  });
}

/**
 * The ONLY function permitted to change `use_in_outreach_consent` — always an explicit, separate rep
 * act (uiux §5.1 O-5: "the consent toggle — off by default ... You can change this any time").
 */
export async function setOutreachConsent(
  prisma: WhySessionPrismaClient,
  userId: string,
  consent: boolean
): Promise<WhySessionRow> {
  const existing = await prisma.whySession.findFirst({ where: { user_id: userId } });
  if (!existing) {
    throw new Error(`No WhySession exists for user ${userId} yet — nothing to set consent on.`);
  }
  return prisma.whySession.update({
    where: { id: existing.id },
    data: { use_in_outreach_consent: consent },
  });
}

/** Decrypts `WhySession.anchor_statement` back to plaintext for a caller authorized to read it (e.g. the outreach gate, T-20's composition reveal). */
export function decryptAnchorStatement(
  row: Pick<WhySessionRow, 'anchor_statement'>,
  encryptionKey: string = getWhySessionEncryptionKey()
): string | null {
  if (!row.anchor_statement) return null;
  const envelope = JSON.parse(row.anchor_statement) as EncryptedEnvelope;
  return decryptEnvelope(envelope, encryptionKey);
}

/**
 * Decrypts `WhySession.transcript` back to the level-ordered Q&A entries — the documented,
 * pre-R-09 public contract (used by the outreach gate / tests / the DSAR path).
 */
export function decryptTranscript(
  row: Pick<WhySessionRow, 'transcript'>,
  encryptionKey: string = getWhySessionEncryptionKey()
): SevenWhysTranscriptEntry[] {
  return decryptTranscriptEnvelope(row, encryptionKey).entries;
}

/**
 * Decrypts `WhySession.transcript` back to the full persisted envelope (level-ordered Q&A entries
 * + resume metadata). A legacy row written by the pre-R-09 shape (a bare Q&A list, no envelope) is
 * detected structurally and normalized into the new envelope so old sessions still resume — with
 * the gate re-evaluated from freshly-estimated signals on the next answer (the legacy shape carried
 * no depth signals), never lost and never a crash.
 */
export function decryptTranscriptEnvelope(
  row: Pick<WhySessionRow, 'transcript'>,
  encryptionKey: string = getWhySessionEncryptionKey()
): PersistedTranscriptEnvelope {
  if (!row.transcript) {
    return {
      entries: [],
      status: 'IN_PROGRESS',
      deepenLevel: null,
      currentLevelIndex: 0,
      resonanceScore: null,
      depthSignals: {},
    };
  }
  const envelope = row.transcript as EncryptedEnvelope;
  const plain = decryptEnvelope(envelope, encryptionKey);
  const parsed = JSON.parse(plain) as unknown;

  if (isPersistedTranscriptEnvelope(parsed)) {
    return parsed;
  }

  // Legacy pre-R-09 shape: a bare level-ordered Q&A array.
  const entries = (Array.isArray(parsed) ? parsed : []) as SevenWhysTranscriptEntry[];
  const lastEntry = entries[entries.length - 1];
  const lastLevelIndex = lastEntry
    ? SEVEN_WHYS_LEVELS.indexOf(lastEntry.level)
    : -1;
  return {
    entries,
    status: 'IN_PROGRESS',
    deepenLevel: null,
    // A saved row always reflects a completed answer; the conversation is open at the next level.
    currentLevelIndex: lastLevelIndex === -1 ? 0 : Math.min(lastLevelIndex + 1, SEVEN_WHYS_LEVELS.length - 1),
    resonanceScore: null,
    depthSignals: {},
  };
}

function isPersistedTranscriptEnvelope(value: unknown): value is PersistedTranscriptEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate.entries);
}
