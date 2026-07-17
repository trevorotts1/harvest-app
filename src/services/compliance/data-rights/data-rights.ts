import { randomUUID } from 'crypto';
import {
  DATA_EXPORT_SLA_MINUTES,
  DeletionCertificate,
  ExportFormat,
  RetainedRecordRef,
  UserDataDeletionRecord,
  UserDataExportRecord,
} from '../../../types/data-rights';
import { LegalHoldService } from './legal-hold';
import { DataRightsAuditSink, buildDataRightsAuditEvent } from './audit-emit';
import {
  decryptOptionalField,
  decryptRequiredField,
  getContactEncryptionKey,
} from '../../warm-market/vault/vault-encryption';

/**
 * Data Rights service for T-11 (master-spec §16.3).
 *
 * Implements GDPR/CCPA export + deletion, wired to the Prisma `UserDataDeletion` /
 * `UserDataExport` models introduced in T-03. The crux of this file is `processDeletion`:
 *
 *   1. If an ACTIVE LegalHold exists on the user, the deletion is BLOCKED — recorded as HELD,
 *      and NOTHING is touched (no PII scrub happens). See §16.3 "GDPR/CCPA deletion vs. FINRA
 *      retention" and §3.4 "Deletion cascade with legal hold".
 *   2. Otherwise, ordinary PII is deleted/anonymized across every user-owned model: `User`
 *      (including auth material — `password_hash`/`image` — per the QC-2 full-schema sweep),
 *      `Contact`, `WhySession` (the Seven Whys transcript, anchor statement, and why-photo —
 *      §16.3's named sensitive-data class), `OnboardingSession`, `ContactInteraction` (notes on
 *      the user's own contacts), `Message`/`DraftMessage` (body text + `cfe_classifier_data`),
 *      `WarmMarketExercise` (per-contact blank-canvas/background/highlights context),
 *      `UplineInvite` (a third party's plaintext `recipient_email`, both as sponsor and as the
 *      deleted user's own address sitting in someone else's invite), `LicensingRecord`
 *      (`license_number` only — see the QC-2 carve-out comment below for the jurisdiction/state
 *      retention rationale), `AgentRun` (per-run narrative/content fields), and `Milestone`
 *      (`shareable_asset_ref`). FINRA 2210/3110-required communications (`AuditEntry` rows
 *      tagged `regulation: 'FINRA'`) are never touched — they are only *read* (to list them in
 *      the certificate), never deleted or updated. See the QC-2 carve-out comment further below
 *      for the full list of models classified as legitimately-retained (B) or non-PII/system (C)
 *      and why each is left alone — AuditEntry is the only carve-out that is *also* the legal-hold
 *      block-point; the others are ordinary documented exclusions.
 *   3. A `DeletionCertificate` documents exactly what was deleted vs. retained and why, and its
 *      URL is written to `UserDataDeletion.deletion_certificate_url`.
 *
 * This module deliberately does not import from ../classifiers, ../engine, or ../safe-harbor
 * (owned by the concurrent CFE build, T-08) — the only compliance-owned import is
 * `../rbac/rbac-service` (via LegalHoldService), which is a pre-existing, uncontested dependency.
 * Per the T-11 QC-2 full-sweep brief: deletion is data-rights' cross-cutting job, so PII fields on
 * models owned by other build units (AgentRun/DraftMessage.cfe_classifier_data — T-04 agent layer;
 * LicensingRecord — T-13; UplineInvite — the org-tree unit) are scrubbed here too, without this
 * file importing those units' service code — only their Prisma delegate shape, narrowed to
 * `updateMany`, exactly like every other model below.
 */

// ─────────────────────────────────────────────────────────────────────────
// Narrow Prisma delegate shapes — enough surface for this service, easy to satisfy with a plain
// mock object in tests (see tests/unit/data-rights.test.ts), matching the constructor-injection
// pattern already used by src/services/warm-market/contact.service.ts.
// ─────────────────────────────────────────────────────────────────────────

export interface DataRightsPrismaClient {
  user: {
    findUnique(args: { where: { id: string } }): Promise<UserRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<UserRow>;
  };
  contact: {
    findMany(args: { where: Record<string, unknown> }): Promise<ContactRow[]>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  auditEntry: {
    findMany(args: { where: Record<string, unknown> }): Promise<AuditEntryRow[]>;
  };
  // ── T-11 QC fix (§16.3): the models below hold user-owned PII beyond User/Contact and must be
  // scrubbed on the same COMPLETED deletion run — none of them are FINRA-retained (the carve-out
  // is AuditEntry only). Each follows the same narrow updateMany-only shape already used by
  // `contact` above; no `delete`/`deleteMany` is ever needed here because the established pattern
  // is anonymize-via-update, not hard-delete (see the User/Contact blocks below).
  whySession: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  onboardingSession: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  contactInteraction: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  // Message has no user_id scalar (only thread_id); schema.prisma's own convention note (§3
  // header) prefers plain scalar FK filtering over relation traversal, so the owning thread's
  // ids are resolved first via `messageThread.findMany({ where: { user_id } })` and then used to
  // scope `message.updateMany` by `thread_id: { in: [...] }` — the same one-hop
  // fetch-ids-then-filter shape already used for ContactInteraction (via `contact_id: { in: [...] }`
  // below), not a nested relation filter.
  messageThread: {
    findMany(args: { where: Record<string, unknown> }): Promise<MessageThreadRow[]>;
  };
  message: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  draftMessage: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  warmMarketExercise: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  // ── T-11 QC-2 full-sweep fix (§16.3): a second Opus QC pass found MORE user-owned PII
  // surviving a COMPLETED deletion beyond the QC-1 fix above. Same narrow updateMany-only shape;
  // see the classification comment above the carve-out block below for why each of these (and no
  // others) needed a scrub block.
  uplineInvite: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  licensingRecord: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  agentRun: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  milestone: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  userDataDeletion: {
    create(args: { data: Record<string, unknown> }): Promise<UserDataDeletionRow>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<UserDataDeletionRow>;
    findUnique(args: { where: { id: string } }): Promise<UserDataDeletionRow | null>;
  };
  userDataExport: {
    create(args: { data: Record<string, unknown> }): Promise<UserDataExportRow>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<UserDataExportRow>;
    findUnique(args: { where: { id: string } }): Promise<UserDataExportRow | null>;
  };
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  solution_number?: string | null;
  anchor_statement?: string | null;
  calendar_preferences?: unknown;
  mfa_methods?: unknown;
  [key: string]: unknown;
}

interface ContactRow {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  phone_hash?: string | null;
  email_hash?: string | null;
  [key: string]: unknown;
}

interface AuditEntryRow {
  id: string;
  user_id: string;
  regulation: string;
  content_hash: string;
  created_at: Date | string;
}

interface MessageThreadRow {
  id: string;
  user_id: string;
  [key: string]: unknown;
}

interface UserDataDeletionRow {
  id: string;
  user_id: string;
  status: string;
  anonymized_fields: string[];
  retained_fields: string[];
  deletion_certificate_url: string | null;
  requested_at: Date | string;
  completed_at: Date | string | null;
}

interface UserDataExportRow {
  id: string;
  user_id: string;
  status: string;
  expires_at: Date | string;
  created_at: Date | string;
}

// The FINRA carve-out regulation tag as written by the CFE audit path (src/types/compliance.ts's
// `Regulation` union includes 'FINRA'). Kept as a local constant (not re-exported from the CFE's
// types module) so this file has no import dependency on anything the CFE build owns.
const FINRA_REGULATION_TAG = 'FINRA';

// A syntactically valid bcrypt hash that cannot match any real password — mirrors the same
// timing-safe placeholder pattern already established in src/lib/auth/options.ts's
// `DUMMY_PASSWORD_HASH` ("never a real credential and nothing is ever compared against it that
// could succeed"). Duplicated here as a literal (not imported) so this module's only
// compliance-owned dependency stays `../rbac/rbac-service`, per this file's header note — auth's
// own constant is owned by T-04. Anonymizing `password_hash` to this value is defense-in-depth:
// the email swap below already makes the row unreachable via the Credentials provider's
// email-lookup, but no credential material should survive the account regardless.
const ANONYMIZED_PASSWORD_HASH = '$2b$12$MEVZM7ykDz6jQqYFKMsBAOKe7pkfl/di9K.DgFws3GBt/jllkVou.';

// ── T-R7 (§16.3 "the export must contain the data subject's actual data") ──────────────────────
// T-22 (The Vault) encrypts Contact.first_name/last_name/phone/email/notes as AES-256-GCM
// ciphertext envelopes at rest (src/services/warm-market/vault/vault-encryption.ts). A DSAR export
// exists to hand the data subject their OWN readable data, so `processExport` below decrypts each
// Contact's PII fields before serializing — never the raw ciphertext envelope, which would be
// unintelligible to the person receiving it and would defeat the entire purpose of the export.

/**
 * Placeholder substituted for a single Contact PII field (first_name/last_name/phone/email/
 * notes) in a DSAR export when that field's stored ciphertext envelope cannot be decrypted
 * (corrupt/malformed envelope, tampered authTag, wrong/rotated key, etc.). A decrypt failure on
 * one field must never (a) crash the rest of the export — the data subject is still owed every
 * other field, of this contact and every other contact, within the SLA — or (b) surface the raw
 * ciphertext envelope as if it were the value, which is not the subject's data and would mislead
 * rather than merely fail to inform.
 */
export const DSAR_FIELD_DECRYPTION_UNAVAILABLE = '[unavailable — could not be decrypted]';

/** Decrypt a required Contact PII field for a DSAR export; degrades safely on failure. */
function decryptExportRequiredField(stored: string, key: string): string {
  try {
    return decryptRequiredField(stored, key);
  } catch {
    return DSAR_FIELD_DECRYPTION_UNAVAILABLE;
  }
}

/** Decrypt an optional Contact PII field for a DSAR export; degrades safely on failure. */
function decryptExportOptionalField(stored: string | null | undefined, key: string): string | null {
  if (stored === null || stored === undefined) return null;
  try {
    return decryptOptionalField(stored, key);
  } catch {
    return DSAR_FIELD_DECRYPTION_UNAVAILABLE;
  }
}

/**
 * Decrypts one Contact row's PII fields for inclusion in a DSAR export. Each field is decrypted
 * INDEPENDENTLY — not via a single all-or-nothing call — so one corrupt/undecryptable field
 * (e.g. a malformed envelope) degrades only that field to `DSAR_FIELD_DECRYPTION_UNAVAILABLE`
 * without blocking any other field of this contact or any other contact in the same export.
 * Non-PII columns (id, user_id, phone_hash, email_hash, etc.) pass through untouched.
 */
function decryptContactForExport(contact: ContactRow, key: string): ContactRow {
  return {
    ...contact,
    first_name: decryptExportRequiredField(contact.first_name, key),
    last_name: decryptExportRequiredField(contact.last_name, key),
    phone: decryptExportOptionalField(contact.phone, key),
    email: decryptExportOptionalField(contact.email, key),
    notes: decryptExportOptionalField(contact.notes, key),
  };
}

function isoOf(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toDeletionRecord(row: UserDataDeletionRow): UserDataDeletionRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    status: row.status as UserDataDeletionRecord['status'],
    anonymized_fields: row.anonymized_fields ?? [],
    retained_fields: row.retained_fields ?? [],
    deletion_certificate_url: row.deletion_certificate_url ?? null,
    requested_at: isoOf(row.requested_at),
    completed_at: row.completed_at ? isoOf(row.completed_at) : null,
  };
}

function toExportRecord(row: UserDataExportRow): UserDataExportRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    status: row.status as UserDataExportRecord['status'],
    expires_at: isoOf(row.expires_at),
    created_at: isoOf(row.created_at),
  };
}

export class DataRightsService {
  constructor(
    private prisma: DataRightsPrismaClient,
    private legalHold: LegalHoldService,
    private auditSink?: DataRightsAuditSink
  ) {}

  // ── Deletion ────────────────────────────────────────────────────────────

  /** Create a deletion request. Does not perform the deletion itself — see `processDeletion`. */
  async requestDeletion(input: { user_id: string; requested_by: string }): Promise<UserDataDeletionRecord> {
    const row = await this.prisma.userDataDeletion.create({
      data: {
        id: randomUUID(),
        user_id: input.user_id,
        status: 'PENDING',
        anonymized_fields: [],
        retained_fields: [],
        requested_at: new Date(),
      },
    });

    await this.auditSink?.record(
      buildDataRightsAuditEvent('deletion.requested', input.user_id, input.requested_by, {
        deletion_id: row.id,
      })
    );

    return toDeletionRecord(row);
  }

  /**
   * Process a deletion request. THE CRUX: checks for an active legal hold first, and either
   * blocks (HELD) or proceeds with a PII scrub that preserves the FINRA carve-out set.
   */
  async processDeletion(
    deletion_id: string,
    actor_id: string
  ): Promise<{ record: UserDataDeletionRecord; certificate: DeletionCertificate }> {
    const existing = await this.prisma.userDataDeletion.findUnique({ where: { id: deletion_id } });
    if (!existing) {
      throw new Error(`UserDataDeletion ${deletion_id} not found`);
    }
    const user_id = existing.user_id;
    const requestedAt = isoOf(existing.requested_at);

    // §16.3 / §3.4: an active legal hold blocks deletion outright — nothing below this point may
    // run if a hold is in force.
    const hold = await this.legalHold.isUnderHold(user_id);
    if (hold) {
      const heldRow = await this.prisma.userDataDeletion.update({
        where: { id: deletion_id },
        data: { status: 'HELD' },
      });

      await this.auditSink?.record(
        buildDataRightsAuditEvent('deletion.held', user_id, actor_id, {
          deletion_id,
          hold_id: hold.id,
          reason: hold.reason,
        })
      );

      const certificate: DeletionCertificate = {
        user_id,
        deletion_id,
        requested_at: requestedAt,
        completed_at: null,
        status: 'HELD',
        deleted_fields: [],
        retained_records: [],
        legal_hold: { hold_id: hold.id, reason: hold.reason, placed_at: hold.placed_at },
        cascade_hashes: [],
        certificate_url: this.certificateUrl(deletion_id),
      };

      return { record: toDeletionRecord(heldRow), certificate };
    }

    const user = await this.prisma.user.findUnique({ where: { id: user_id } });
    if (!user) {
      throw new Error(`User ${user_id} not found`);
    }
    // Captured BEFORE the anonymizing update below overwrites it — needed for the UplineInvite
    // cross-user scrub further down (the deleted user's own email may sit as the *recipient* on an
    // invite someone else sent, not just on invites this user sent as sponsor).
    const originalEmail = user.email;

    // Ordinary PII: deleted/anonymized on User. password_hash/image added by the QC-2 full sweep
    // (§16.3) — no credential or profile-photo material should survive a COMPLETED deletion either.
    await this.prisma.user.update({
      where: { id: user_id },
      data: {
        email: `deleted-${user_id}@anonymized.harvest.app`,
        name: 'Deleted User',
        phone: null,
        solution_number: null,
        anchor_statement: null,
        calendar_preferences: null,
        mfa_methods: null,
        password_hash: ANONYMIZED_PASSWORD_HASH,
        image: null,
      },
    });
    const deletedFields = [
      'User.email',
      'User.name',
      'User.phone',
      'User.solution_number',
      'User.anchor_statement',
      'User.calendar_preferences',
      'User.mfa_methods',
      'User.password_hash',
      'User.image',
    ];

    // Ordinary PII: deleted/anonymized on the user's own Contact rows (the Vault records they own).
    const contacts = await this.prisma.contact.findMany({ where: { user_id } });
    const cascadeHashes = contacts.map((c) => ({
      contact_id: c.id,
      phone_hash: c.phone_hash ?? null,
      email_hash: c.email_hash ?? null,
    }));
    if (contacts.length > 0) {
      await this.prisma.contact.updateMany({
        where: { user_id },
        data: {
          first_name: 'Deleted',
          last_name: '',
          phone: null,
          email: null,
          notes: null,
          phone_hash: null,
          email_hash: null,
        },
      });
      deletedFields.push(
        'Contact.first_name',
        'Contact.last_name',
        'Contact.phone',
        'Contact.email',
        'Contact.notes'
      );
    }

    // ── T-11 QC fix (§16.3): scrub every OTHER user-owned, PII-bearing model. None of these are
    // FINRA-retained — the carve-out below is AuditEntry only. §16.3 explicitly names "why-photos,
    // Seven Whys transcripts, and anchor statements" as the sensitive-data class requiring the
    // same treatment as Contact PII; the models below are that class plus the other user-owned
    // free-text/PII surfaces in prisma/schema.prisma. Anonymize-via-update, matching the User/
    // Contact pattern above — never a hard delete.

    // WhySession: the Seven Whys transcript, anchor statement, and why-photo pointer (§16.3, §6).
    // transcript is a non-nullable Json column, so it is redacted to `{}` (the Json analog of the
    // empty-string redaction used for Contact.last_name above) rather than nulled.
    const whySessionResult = await this.prisma.whySession.updateMany({
      where: { user_id },
      data: {
        transcript: {},
        anchor_statement: null,
        why_photo_ref: null,
      },
    });
    if (whySessionResult.count > 0) {
      deletedFields.push('WhySession.transcript', 'WhySession.anchor_statement', 'WhySession.why_photo_ref');
    }

    // OnboardingSession: the Seven Whys/goal-card/intensity payloads captured during onboarding
    // (distinct rows from WhySession's richer transcript — retained for step-resumption state,
    // §3.2 — but still user-owned PII once populated).
    const onboardingResult = await this.prisma.onboardingSession.updateMany({
      where: { user_id },
      data: {
        seven_whys: null,
        goal_card: null,
        intensity_data: null,
      },
    });
    if (onboardingResult.count > 0) {
      deletedFields.push(
        'OnboardingSession.seven_whys',
        'OnboardingSession.goal_card',
        'OnboardingSession.intensity_data'
      );
    }

    // ContactInteraction: free-text notes on the user's own contacts (per-rep, never cross-rep —
    // §3.4). Scoped via the contact ids already fetched above; notes is non-nullable
    // (`@default("")`) so it is redacted to '' rather than nulled, mirroring Contact.last_name.
    const contactIds = contacts.map((c) => c.id);
    if (contactIds.length > 0) {
      const interactionResult = await this.prisma.contactInteraction.updateMany({
        where: { contact_id: { in: contactIds } },
        data: { notes: '' },
      });
      if (interactionResult.count > 0) {
        deletedFields.push('ContactInteraction.notes');
      }
    }

    // Message: body text on the user's own message threads. Message has no user_id scalar (only
    // thread_id) — per this schema's own scalar-FK convention (see prisma/schema.prisma header),
    // the owning thread ids are resolved first, then used to scope the update, rather than a
    // nested relation filter.
    const ownedThreads = await this.prisma.messageThread.findMany({ where: { user_id } });
    const threadIds = ownedThreads.map((t) => t.id);
    if (threadIds.length > 0) {
      const messageResult = await this.prisma.message.updateMany({
        where: { thread_id: { in: threadIds } },
        data: { body: '' },
      });
      if (messageResult.count > 0) {
        deletedFields.push('Message.body');
      }
    }

    // DraftMessage: drafted outbound body text awaiting CFE/approval (§5.5) — non-nullable, so
    // redacted to '' like Message.body above. cfe_classifier_data (nullable Json) added by the
    // QC-2 full sweep: unlike AuditEntry.classifier_data (a fixed Record<Classifier, number> of
    // confidence scores only, never raw content — see src/services/compliance/engine.ts), this
    // DraftMessage field has no writer wired up yet anywhere in the codebase, so its eventual
    // shape can't be verified to be excerpt-free. Scrubbed out of caution: nothing needs it to
    // survive a completed deletion, and a Json? column costs nothing to null.
    const draftResult = await this.prisma.draftMessage.updateMany({
      where: { user_id },
      data: { body: '', cfe_classifier_data: null },
    });
    if (draftResult.count > 0) {
      deletedFields.push('DraftMessage.body', 'DraftMessage.cfe_classifier_data');
    }

    // WarmMarketExercise: blank-canvas names, background context, and highlights are personal
    // context about the user's specific relationships (§8) — the same sensitive-data class as
    // Contact PII. match_results/readiness_scores/qualities are keyed off those same per-contact
    // payloads, so all Json fields on this model are scrubbed together.
    const warmMarketResult = await this.prisma.warmMarketExercise.updateMany({
      where: { user_id },
      data: {
        blank_canvas_names: null,
        qualities: null,
        background_context: null,
        highlights: null,
        match_results: null,
        readiness_scores: null,
      },
    });
    if (warmMarketResult.count > 0) {
      deletedFields.push(
        'WarmMarketExercise.blank_canvas_names',
        'WarmMarketExercise.qualities',
        'WarmMarketExercise.background_context',
        'WarmMarketExercise.highlights',
        'WarmMarketExercise.match_results',
        'WarmMarketExercise.readiness_scores'
      );
    }

    // ── T-11 QC-2 full-sweep fix (§16.3): the second Opus QC pass found MORE user-owned PII
    // surviving a COMPLETED deletion. Four more models below, none FINRA-retained.

    // UplineInvite (§6.6): recipient_email is a THIRD PARTY's plaintext email address, sent by
    // this user as sponsor — the CRITICAL defect the QC-2 judge flagged (a completed deletion left
    // it fully intact). recipient_email is non-nullable, so redacted to '' like Contact.last_name/
    // ContactInteraction.notes above, not nulled.
    const uplineInviteSentResult = await this.prisma.uplineInvite.updateMany({
      where: { sponsor_id: user_id },
      data: { recipient_email: '' },
    });
    let uplineInviteScrubbed = uplineInviteSentResult.count > 0;

    // Cross-user case (QC-2 explicitly called this out): the deleted user's OWN email address may
    // sit as the *recipient* on an invite someone ELSE sent as sponsor (they were invited before
    // they ever signed up) — sponsor_id there is a different user, so the block above never
    // touches it. Scrubbed here too: this is a plain equality match on a single indexed-adjacent
    // column, no cross-rep cascade/hash-matching infrastructure is needed (unlike the
    // OptOutRegistry hash cascade, which is deliberately deferred to WP05 — see
    // DeletionCertificate.cascade_hashes' doc comment in src/types/data-rights.ts), so there is no
    // reason to defer it. Uses `originalEmail`, captured before the User.update above overwrote it.
    // Exact-string match only (no case-folding) — consistent with how Contact.email/email_hash
    // equality is handled elsewhere in this codebase today.
    const uplineInviteReceivedResult = await this.prisma.uplineInvite.updateMany({
      where: { recipient_email: originalEmail },
      data: { recipient_email: '' },
    });
    uplineInviteScrubbed = uplineInviteScrubbed || uplineInviteReceivedResult.count > 0;
    if (uplineInviteScrubbed) {
      deletedFields.push('UplineInvite.recipient_email');
    }

    // LicensingRecord (T-13, §16.5): license_number is the deleted user's own professional
    // license/IBA-POL identifier — the [Resolve] defect the QC-2 judge flagged. Decision: SCRUB
    // (not retain). jurisdiction/state/issued_at/expires_at are left untouched — they are
    // licensing-STATUS structural data (which states, what status, when), not an identifying
    // credential number, and the org has a legitimate need-to-know of its own past-rep licensing
    // history independent of any one person's license number (mirrors how User.rank/
    // commitment_score/access_tier survive anonymization elsewhere in this file — status/metadata
    // stays, identifying content goes). No regulatory rule found in master-spec §16.5 or elsewhere
    // in this codebase requires retaining the raw license_number specifically past a GDPR/CCPA
    // erasure request — state insurance regulators keep their own authoritative license records
    // independent of this app's copy — so per the QC-2 brief's "prefer scrubbing unless a clear
    // regulatory basis exists," it is nulled like Contact.phone/email above.
    const licensingResult = await this.prisma.licensingRecord.updateMany({
      where: { user_id },
      data: { license_number: null },
    });
    if (licensingResult.count > 0) {
      deletedFields.push('LicensingRecord.license_number');
    }

    // AgentRun (§4): input_summary/reasoning_log are free-text, per-run narrative content that
    // plausibly names the user's specific contacts/situations (the same sensitive-data class as
    // Message.body/DraftMessage.body); output_ref is a pointer to agent-generated output that may
    // itself reference such content (the same "pointer to identity-bearing content" class as
    // WhySession.why_photo_ref, which this file already scrubs). All three are nulled. Left
    // untouched: agent_key/model_used/trigger/status/batched/token_input/token_output/cost_cents/
    // started_at/finished_at/created_at — pure operational/billing metadata with no narrative
    // content, and exactly what the model's own doc comment says AgentRun exists to feed (§4.5's
    // per-rep cost model + the Activity Ledger's receipts), so none of it needs to survive as PII
    // and none of it needs to be removed to keep serving that non-PII purpose.
    const agentRunResult = await this.prisma.agentRun.updateMany({
      where: { user_id },
      data: { input_summary: null, output_ref: null, reasoning_log: null },
    });
    if (agentRunResult.count > 0) {
      deletedFields.push('AgentRun.input_summary', 'AgentRun.output_ref', 'AgentRun.reasoning_log');
    }

    // Milestone (§12): shareable_asset_ref points at a generated, shareable celebration
    // graphic/card — the same "pointer to identity-bearing content" class as WhySession.
    // why_photo_ref (a shareable achievement asset is, by design, likely to render the user's own
    // name). milestone_key/achieved_at/celebrated are left untouched (non-PII gamification status,
    // same treatment as MomentumEvent below).
    const milestoneResult = await this.prisma.milestone.updateMany({
      where: { user_id },
      data: { shareable_asset_ref: null },
    });
    if (milestoneResult.count > 0) {
      deletedFields.push('Milestone.shareable_asset_ref');
    }

    // ── Full-schema classification (QC-2 sweep of every model in prisma/schema.prisma) ──────────
    // Category (A) — scrubbed above, this run: User, Contact, WhySession, OnboardingSession,
    // ContactInteraction, Message, DraftMessage, WarmMarketExercise, UplineInvite, LicensingRecord
    // (license_number only), AgentRun, Milestone.
    //
    // Category (B) — legitimately retained; documented, never touched by this service:
    //   • AuditEntry — FINRA 2210/3110 communications archive (THE legal-hold carve-out; read
    //     below, never written).
    //   • ComplianceUplineReview.feedback / ComplianceException.reason — free-text compliance
    //     decisions tied 1:1 to an AuditEntry row; FINRA Rule 3110 requires retaining evidence that
    //     supervisory review occurred, including the reviewer's reasoning — the same regulatory
    //     basis as AuditEntry itself, just a different table.
    //   • LicensingStateEvent (incl. its optional `reason`) — the durable who/when licensing
    //     transition trail (this model's own doc comment: "mirrors SecurityEvent's immutability
    //     posture"); a state insurance regulator or E&O inquiry may need "was this person ever
    //     licensed with us in <state> between <dates>" answered long after the person's account
    //     (and even their license_number, per the scrub above) is gone.
    //   • SecurityEvent — security-incident audit trail (own doc comment: "mirrors AuditEntry's
    //     immutability posture"); ip_hash/device_fingerprint_hash are already one-way hashes, not
    //     raw PII, and a takeover/breach investigation must survive the account it was committed
    //     against.
    //   • LegalHold — the hold record itself; erasing hold history on deletion would defeat the
    //     hold's own purpose (a hold must be provable to have existed regardless of what happens to
    //     the held account afterward).
    //   • Subscription, Invoice, PaymentMethod, CommissionConfig — financial/billing records with
    //     no free-text PII (stripe ids, amounts, last4 only — "no PANs ever touch this table" per
    //     PaymentMethod's own comment); ordinary accounting/tax-record retention, same bucket as a
    //     paid invoice from any SaaS vendor.
    // Everything else in prisma/schema.prisma is Category (C) — non-PII, global/system, or pure
    // status/metadata tied to user_id with no identifying free-text content (so anonymizing the
    // owning User row already removes the only PII a reader could tie it back to): Organization,
    // Account/Session/VerificationToken (Auth.js adapter scaffolding — confirmed zero live writers
    // today; the active flow is Credentials + JWT sessions only, see src/lib/auth/options.ts — a
    // follow-up for T-04 if/when an OAuth provider or database-session strategy is ever enabled,
    // since this service never hard-deletes the User row and so never triggers their `onDelete:
    // Cascade`), ComplianceConsent, ComplianceRule, ComplianceReviewQueue, UserDataExport,
    // UserDataDeletion (this very record), AgentDefinition, MessageThread, Appointment,
    // CalendarLink, Sponsorship, IdempotencyLog, OrgTreeEdge, MomentumEvent, CourseProgress,
    // TeamEvent, Attendance, QuoteLibrary.

    // THE CARVE-OUT: read (never write/delete) the FINRA-tagged compliance/communications audit
    // trail for this user. These rows survive the deletion untouched.
    const regulated = await this.prisma.auditEntry.findMany({
      where: { user_id, regulation: FINRA_REGULATION_TAG },
    });
    const retainedRecords: RetainedRecordRef[] = regulated.map((r) => ({
      ref: `AuditEntry:${r.id}`,
      reason: 'FINRA 2210/3110 — 7yr communications retention, segregated archive (§16.2, §16.3)',
    }));

    const completedAt = new Date();
    const certificateUrl = this.certificateUrl(deletion_id);

    const updatedRow = await this.prisma.userDataDeletion.update({
      where: { id: deletion_id },
      data: {
        status: 'COMPLETED',
        anonymized_fields: deletedFields,
        retained_fields: retainedRecords.map((r) => r.ref),
        deletion_certificate_url: certificateUrl,
        completed_at: completedAt,
      },
    });

    await this.auditSink?.record(
      buildDataRightsAuditEvent('deletion.completed', user_id, actor_id, {
        deletion_id,
        deleted_field_count: deletedFields.length,
        retained_record_count: retainedRecords.length,
      })
    );

    const certificate: DeletionCertificate = {
      user_id,
      deletion_id,
      requested_at: requestedAt,
      completed_at: completedAt.toISOString(),
      status: 'COMPLETED',
      deleted_fields: deletedFields,
      retained_records: retainedRecords,
      cascade_hashes: cascadeHashes,
      certificate_url: certificateUrl,
    };

    return { record: toDeletionRecord(updatedRow), certificate };
  }

  private certificateUrl(deletion_id: string): string {
    return `https://api.harvest.app/data-rights/deletion-certificates/${deletion_id}`;
  }

  // ── Export ──────────────────────────────────────────────────────────────

  async requestExport(input: { user_id: string }): Promise<UserDataExportRecord> {
    const now = new Date();
    const row = await this.prisma.userDataExport.create({
      data: {
        id: randomUUID(),
        user_id: input.user_id,
        status: 'PENDING',
        expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        created_at: now,
      },
    });

    await this.auditSink?.record(
      buildDataRightsAuditEvent('export.requested', input.user_id, input.user_id, {
        export_id: row.id,
      })
    );

    return toExportRecord(row);
  }

  /**
   * Generate the export payload and mark the request COMPLETED. Per §16.8-3, must produce valid
   * JSON/CSV within DATA_EXPORT_SLA_MINUTES (5 minutes) — this in-process implementation completes
   * synchronously, well inside the SLA; `sla_deadline` is returned so a caller can assert on it.
   */
  async processExport(
    export_id: string,
    format: ExportFormat
  ): Promise<{ record: UserDataExportRecord; payload: string; sla_deadline: string }> {
    const existing = await this.prisma.userDataExport.findUnique({ where: { id: export_id } });
    if (!existing) {
      throw new Error(`UserDataExport ${export_id} not found`);
    }

    const user = await this.prisma.user.findUnique({ where: { id: existing.user_id } });
    if (!user) {
      throw new Error(`User ${existing.user_id} not found`);
    }
    const contacts = await this.prisma.contact.findMany({ where: { user_id: existing.user_id } });
    // §16.3: the data subject must receive their actual readable data, not the AES-256-GCM
    // ciphertext T-22 persists at rest — decrypt every Contact's PII before serializing.
    const contactEncryptionKey = getContactEncryptionKey();
    const decryptedContacts = contacts.map((contact) =>
      decryptContactForExport(contact, contactEncryptionKey)
    );

    const exportObject = { user, contacts: decryptedContacts };
    const payload =
      format === 'json' ? JSON.stringify(exportObject, null, 2) : toCsv(exportObject);

    const now = new Date();
    const updatedRow = await this.prisma.userDataExport.update({
      where: { id: export_id },
      data: { status: 'COMPLETED', expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
    });

    await this.auditSink?.record(
      buildDataRightsAuditEvent('export.completed', existing.user_id, existing.user_id, {
        export_id,
        format,
      })
    );

    const slaDeadline = new Date(
      new Date(isoOf(existing.created_at)).getTime() + DATA_EXPORT_SLA_MINUTES * 60 * 1000
    ).toISOString();

    return { record: toExportRecord(updatedRow), payload, sla_deadline: slaDeadline };
  }
}

/**
 * RFC 4180 field escaping: wrap every field in double quotes and double any embedded double
 * quote (the CSV standard's escape convention — NOT backslash-escaping, which is not valid CSV
 * and would misparse under a real CSV reader once a field contains embedded commas/quotes, as
 * any nested-JSON field here will).
 *
 * Also guards against CSV/spreadsheet formula injection (OWASP CSV Injection): a field whose
 * content begins with `=`, `+`, `-`, or `@` can be interpreted as a formula by Excel/Sheets when
 * this export is opened, potentially executing attacker-controlled content (e.g. a contact's
 * `notes` field). A leading single quote forces literal-text interpretation without altering the
 * field's actual data (RFC 4180 quoting handles the rest).
 */
function csvField(value: string): string {
  const formulaGuarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${formulaGuarded.replace(/"/g, '""')}"`;
}

/** Flat, dependency-free CSV serializer — good enough for a self-contained data export. */
function toCsv(obj: Record<string, unknown>): string {
  const flat: Record<string, string> = {};
  const walk = (value: unknown, prefix: string) => {
    if (value === null || value === undefined) {
      flat[prefix] = '';
    } else if (Array.isArray(value)) {
      // Arrays (e.g. the user's list of Contact records) have no native CSV representation —
      // serialized as a single JSON-string field. RFC 4180 quoting (above) makes embedding a
      // JSON blob in one field both valid and round-trippable.
      flat[prefix] = JSON.stringify(value);
    } else if (typeof value === 'object') {
      // Plain nested objects are flattened key-by-key (dot-notation) rather than blobbed, so a
      // scalar field like user.email stays its own column.
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, prefix ? `${prefix}.${k}` : k);
      }
    } else {
      flat[prefix] = String(value);
    }
  };
  walk(obj, '');

  const keys = Object.keys(flat);
  const header = keys.map((k) => csvField(k)).join(',');
  const row = keys.map((k) => csvField(flat[k])).join(',');
  return `${header}\n${row}`;
}
