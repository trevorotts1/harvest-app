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
import { SEVEN_WHYS_LEVELS, SevenWhysTranscriptEntry } from './types';

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
  const transcriptPlain = JSON.stringify(transcriptEntriesFromState(state));
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

/** Decrypts `WhySession.transcript` back to the level-ordered Q&A entries. */
export function decryptTranscript(
  row: Pick<WhySessionRow, 'transcript'>,
  encryptionKey: string = getWhySessionEncryptionKey()
): SevenWhysTranscriptEntry[] {
  if (!row.transcript) return [];
  const envelope = row.transcript as EncryptedEnvelope;
  const plain = decryptEnvelope(envelope, encryptionKey);
  return JSON.parse(plain) as SevenWhysTranscriptEntry[];
}
