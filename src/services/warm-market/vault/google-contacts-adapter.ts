// T-22 (§7.1 modality 4 "Google Contacts (OAuth, People API): consent → fetch → merge → dedup").
//
// Scope boundary (honest, not a stub): the OAuth consent screen + authorization-code/token exchange
// + the actual `people.connections.list` network call to Google's People API is a live third-party
// integration that needs real OAuth client credentials (`GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`) this
// build environment does not have and must not fabricate (§0.4 secrets hygiene — no live network
// calls, no invented tokens). That token-exchange/fetch step belongs to whichever route implements
// the OAuth callback (a WP01-identity-layer concern, not the Vault's).
//
// What IS this build unit's job, and what this module does: once a Google OAuth callback has
// already fetched a person's raw People API `Person` resource, map it onto the SAME
// `RawContactImportRow` shape the other three modalities produce, so it lands on the identical
// encrypted/deduped/batched ingestion pipeline (`VaultService.importBatch`) — "merge → dedup" in the
// spec line above is exactly `VaultService`'s existing per-row merge-on-duplicate behavior, shared
// across all four modalities rather than reimplemented per source.

/** The minimal shape of a Google People API `Person` resource this adapter reads. */
export interface GooglePersonResource {
  names?: { displayName?: string }[];
  phoneNumbers?: { value?: string }[];
  emailAddresses?: { value?: string }[];
  biographies?: { value?: string }[];
  birthdays?: { date?: { year?: number; month?: number; day?: number } }[];
}

import type { RawContactImportRow } from '../../../types/warm-market';

/**
 * Maps one already-fetched Google People API `Person` resource onto a `RawContactImportRow`. A
 * person with no `displayName` has no usable contact identity and is dropped (returns `null`) —
 * the caller should treat that the same as a CSV row missing its `name` column (an error row), not
 * silently fabricate a name.
 */
export function mapGoogleContactToRow(person: GooglePersonResource): RawContactImportRow | null {
  const name = person.names?.[0]?.displayName?.trim();
  if (!name) return null;

  const birthday = person.birthdays?.[0]?.date;
  const birthdate =
    birthday?.year && birthday?.month && birthday?.day
      ? `${birthday.year}-${String(birthday.month).padStart(2, '0')}-${String(birthday.day).padStart(2, '0')}`
      : null;

  return {
    name,
    phone: person.phoneNumbers?.[0]?.value ?? null,
    email: person.emailAddresses?.[0]?.value ?? null,
    notes: person.biographies?.[0]?.value ?? null,
    industry: null,
    birthdate,
  };
}

/** Maps a full People API `connections.list` page onto rows, dropping any un-nameable persons. */
export function mapGoogleContactsToRows(people: GooglePersonResource[]): RawContactImportRow[] {
  return people
    .map(mapGoogleContactToRow)
    .filter((row): row is RawContactImportRow => row !== null);
}
