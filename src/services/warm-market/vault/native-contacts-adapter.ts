// T-58 (§7.1 modalities 2/3 "iOS native (CNContactStore) / Android native (Contacts Provider)").
//
// Scope boundary, mirroring google-contacts-adapter.ts's own header exactly: the actual native
// permission prompt + on-device contacts read is a real Capacitor plugin call
// (`@capacitor-community/contacts`'s `Contacts.checkPermissions/requestPermissions/getContacts`,
// see src/lib/native/capacitor-contacts.ts and src/services/warm-market/vault/native-import-flow.ts
// for that orchestration) — this module's job is ONLY to map an already-fetched device contact
// payload onto the SAME `RawContactImportRow` shape the other three modalities produce, so it lands
// on the identical encrypted/deduped/batched ingestion pipeline (`VaultService.importBatch`).
//
// FIELD PROVENANCE (external-payload false-green guard — do NOT invent fields the plugin never
// returns): every field this module reads is copy-verified against the plugin's OWN shipped
// TypeScript definitions, `node_modules/@capacitor-community/contacts/dist/esm/definitions.d.ts`
// (package version pinned in package.json), specifically the `ContactPayload` interface returned by
// `getContacts({ projection })`:
//   ContactPayload { contactId: string; name?: NamePayload; organization?; birthday?: BirthdayPayload
//     | null; note?: string | null; phones?: PhonePayload[]; emails?: EmailPayload[]; urls?;
//     postalAddresses?; image?; }
//   NamePayload { display: string | null; given: string | null; middle: string | null;
//     family: string | null; prefix: string | null; suffix: string | null; }
//   PhonePayload { type: PhoneType; label?: string | null; isPrimary?: boolean | null;
//     number: string | null; }
//   EmailPayload { type: EmailType; label?: string | null; isPrimary?: boolean | null;
//     address: string | null; }
//   BirthdayPayload { day?: number | null; month?: number | null; year?: number | null; }
// This module reads ONLY `name.display` (falling back to `given`+`family` if the OS never populated
// a composed display name — both real, documented fields, never a fabricated one), `phones[].number`
// (first entry, preferring one flagged `isPrimary`), `emails[].address` (same preference), `note`,
// and `birthday.{day,month,year}`. It never reads `organization`/`urls`/`postalAddresses`/`image` —
// those are real plugin fields too, just not ones this Vault-facing row shape has a slot for.

import type { RawContactImportRow } from '../../../types/warm-market';

/** The minimal shape this adapter reads off the plugin's `ContactPayload` — see file header for the
 *  exact upstream field names each property below is copied from (never renamed/reshaped). */
export interface NativeNamePayload {
  display: string | null;
  given: string | null;
  middle: string | null;
  family: string | null;
}

export interface NativePhonePayload {
  number: string | null;
  isPrimary?: boolean | null;
}

export interface NativeEmailPayload {
  address: string | null;
  isPrimary?: boolean | null;
}

export interface NativeBirthdayPayload {
  day?: number | null;
  month?: number | null;
  year?: number | null;
}

export interface NativeContactPayload {
  contactId: string;
  name?: NativeNamePayload;
  note?: string | null;
  phones?: NativePhonePayload[];
  emails?: NativeEmailPayload[];
  birthday?: NativeBirthdayPayload | null;
}

/** First `isPrimary`-flagged entry, else the first entry, else `undefined` — mirrors how the OS
 *  itself orders a contact's multiple phones/emails (primary first) when `isPrimary` is absent. */
function pickPreferred<T extends { isPrimary?: boolean | null }>(list: T[] | undefined): T | undefined {
  if (!list || list.length === 0) return undefined;
  return list.find((entry) => entry.isPrimary === true) ?? list[0];
}

function composedDisplayName(name: NativeNamePayload | undefined): string | null {
  if (!name) return null;
  if (name.display && name.display.trim()) return name.display.trim();
  const parts = [name.given, name.family].filter((p): p is string => !!p && p.trim().length > 0);
  return parts.length > 0 ? parts.join(' ').trim() : null;
}

/** `BirthdayPayload` -> the ISO 8601 date string `RawContactImportRow.birthdate` expects. A
 *  year-less birthday (the OS lets a contact record day/month with no year) cannot be turned into a
 *  real age, so it is treated as absent — same "no signal, don't fabricate" posture
 *  `minors.ts`'s own doc comment states for a missing birthdate generally. */
function birthdayToIsoDate(birthday: NativeBirthdayPayload | null | undefined): string | null {
  if (!birthday || !birthday.year || !birthday.month || !birthday.day) return null;
  const y = String(birthday.year).padStart(4, '0');
  const m = String(birthday.month).padStart(2, '0');
  const d = String(birthday.day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Maps one already-fetched device `ContactPayload` onto a `RawContactImportRow`. A contact with no
 * usable name (no `display`, no `given`/`family`) is dropped (`null`) — same treatment as a CSV row
 * missing its `name` column or a nameless Google `Person` (§7.1 "never silently fabricate a name").
 */
export function mapNativeContactToRow(payload: NativeContactPayload): RawContactImportRow | null {
  const name = composedDisplayName(payload.name);
  if (!name) return null;

  const phone = pickPreferred(payload.phones)?.number ?? null;
  const email = pickPreferred(payload.emails)?.address ?? null;

  return {
    name,
    phone,
    email,
    notes: payload.note ?? null,
    industry: null,
    birthdate: birthdayToIsoDate(payload.birthday),
  };
}

/** A single device contact, mapped and annotated for the rep-facing selection list (§7.1 "present a
 *  selectable list ... choose which to import"). */
export interface NativeContactCandidate {
  /** The plugin's own `ContactPayload.contactId` — stable React key, never persisted. */
  contactId: string;
  row: RawContactImportRow;
  /** True when this candidate's normalized phone/email already matches an existing Vault contact
   *  OR an earlier candidate already produced in this same device read (§7.6 cross-source /
   *  within-batch dedupe) — surfaced to the rep, never silently hidden, and never blocks the rep
   *  from selecting it anyway (the server-side merge-on-duplicate in VaultService is always safe). */
  isDuplicate: boolean;
}

/** Same normalization VaultService.upsertRow applies before hashing/matching — digits-only phone,
 *  lower-cased/trimmed email — so a dedupe comparison here can never disagree with the server's own
 *  match decision for a reason as trivial as formatting. */
function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits || null;
}
function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.toLowerCase().trim();
  return trimmed || null;
}

export interface ExistingContactKeys {
  phone: string | null;
  email: string | null;
}

/**
 * Maps a full device `getContacts()` payload array onto selectable candidates, dropping un-nameable
 * contacts (same rule as `mapNativeContactToRow`) and flagging duplicates against BOTH the caller's
 * existing Vault contacts (`existing` — fetched separately, see the onboarding contacts-import
 * route's GET handler) and earlier candidates already produced within this same call (a device can
 * genuinely list the same person twice under linked/merged system contacts).
 */
export function buildNativeContactCandidates(
  payloads: NativeContactPayload[],
  existing: ExistingContactKeys[] = []
): NativeContactCandidate[] {
  const existingPhones = new Set(existing.map((e) => normalizePhone(e.phone)).filter((v): v is string => v !== null));
  const existingEmails = new Set(existing.map((e) => normalizeEmail(e.email)).filter((v): v is string => v !== null));
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();

  const candidates: NativeContactCandidate[] = [];
  for (const payload of payloads) {
    const row = mapNativeContactToRow(payload);
    if (!row) continue; // un-nameable — never fabricate a name to keep it in the list

    const normPhone = normalizePhone(row.phone);
    const normEmail = normalizeEmail(row.email);

    const isDuplicate =
      (normPhone !== null && (existingPhones.has(normPhone) || seenPhones.has(normPhone))) ||
      (normEmail !== null && (existingEmails.has(normEmail) || seenEmails.has(normEmail)));

    if (normPhone) seenPhones.add(normPhone);
    if (normEmail) seenEmails.add(normEmail);

    candidates.push({ contactId: payload.contactId, row, isDuplicate });
  }
  return candidates;
}
