// T-22 (§7.1 modality 1 "CSV upload (desktop): drag/drop or picker; fuzzy header-map preview +
// correction... Limits: 10 MB, 10,000 contacts/upload"; §7.6/§18.5 "malformed/exotic CSV → mapping
// preview + downloadable error rows"; "emoji/nickname names tolerated") — real CSV parsing with
// fuzzy header aliasing, size/row limits, and per-row error isolation.
//
// This is intentionally a small, dependency-free RFC4180-ish parser (quoted fields, embedded commas,
// escaped `""` quotes, `\r\n`/`\n` line endings) rather than a stub that just calls `String.split`
// — "exotic" CSV (quoted commas, stray whitespace, mixed casing on headers) is exactly what §7.6's
// break-it emphasis targets.

import type { RawContactImportRow } from '../../../types/warm-market';

/** §7.1 hard limits. */
export const MAX_IMPORT_ROWS = 10_000;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024; // 10 MB

export class ImportLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportLimitExceededError';
  }
}

export interface CsvErrorRow {
  index: number;
  raw: string;
  reason: string;
}

export interface CsvParseResult {
  rows: RawContactImportRow[];
  errorRows: CsvErrorRow[];
}

/** Recognized logical fields a fuzzy-matched header may map onto. */
export type MappedField = 'name' | 'phone' | 'email' | 'notes' | 'industry' | 'birthdate' | 'jurisdiction';

// §7.1 "fuzzy header-map": common real-world header spellings/casings/synonyms per logical field.
// Matching is done against a normalized header (lowercased, punctuation/whitespace collapsed), so
// "E-Mail Address", "email_address", and "Email" all resolve to `email`.
const HEADER_ALIASES: Record<MappedField, string[]> = {
  name: ['name', 'full name', 'fullname', 'contact name', 'contact'],
  phone: ['phone', 'phone number', 'phonenumber', 'mobile', 'cell', 'cell phone', 'telephone', 'tel'],
  email: ['email', 'e mail', 'email address', 'emailaddress'],
  notes: ['notes', 'note', 'comments', 'comment', 'memo'],
  industry: ['industry', 'company', 'business', 'occupation'],
  birthdate: ['birthdate', 'birth date', 'birthday', 'dob', 'date of birth'],
  // T-29R2 (WP03 gate remediation follow-up, §8.2 "Excluded: state-unlicensed" eligibility): the
  // ONLY CSV capture path for `Contact.jurisdiction` — raw value passed through as-is here (see
  // `RawContactImportRow.jurisdiction`'s doc comment); `VaultService.upsertRow` normalizes to the
  // two-letter postal code before persistence. Column absent = jurisdiction stays unknown/null; the
  // import itself never fails for lacking this column.
  jurisdiction: ['state', 'jurisdiction', 'contact state', 'licensing state'],
};

// `normalizeHeader`/`mapHeader` are exported (T-R30 GAP 1) so a client-side import preview (e.g. the
// `/community/import` field-mapping preview) can show the SAME header→field detection the server's
// authoritative `parseContactCsv` actually uses, rather than a second, hand-copied alias table that
// could silently drift from this one. Neither function touches `Buffer` (only `parseContactCsv`'s
// size check below does), so importing them into a `'use client'` module is safe — that code path is
// simply never reached from the browser.
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mapHeader(header: string): MappedField | null {
  const normalized = normalizeHeader(header);
  for (const field of Object.keys(HEADER_ALIASES) as MappedField[]) {
    if (HEADER_ALIASES[field].includes(normalized)) return field;
  }
  return null;
}

/**
 * Splits one CSV line into fields, honoring RFC4180-style double-quoted fields (embedded commas,
 * embedded newlines are NOT supported — a line is still one row — and `""` as an escaped quote).
 */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

/**
 * Parse raw CSV text into normalized contact rows + a downloadable error-rows list (§7.6). Enforces
 * the §7.1 10 MB / 10,000-row limits fail-closed (throws `ImportLimitExceededError` — the caller
 * must not silently truncate a too-large upload). A data row with no recognized `name` column, or an
 * empty name value, becomes an error row rather than aborting the whole parse (one malformed row
 * never corrupts/blocks the rest of the file — §18.5 "partial failure leaves a resumable state, not
 * corruption", applied at parse time too).
 */
export function parseContactCsv(csvText: string): CsvParseResult {
  const byteLength = Buffer.byteLength(csvText, 'utf8');
  if (byteLength > MAX_IMPORT_BYTES) {
    throw new ImportLimitExceededError(
      `CSV upload is ${byteLength} bytes, exceeding the ${MAX_IMPORT_BYTES}-byte (10 MB) limit (§7.1). ` +
        'Use the streamed/chunked upload path for large lists.'
    );
  }

  const lines = csvText.split(/\r\n|\r|\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return { rows: [], errorRows: [] };

  const headerFields = splitCsvLine(lines[0]);
  const fieldMap: (MappedField | null)[] = headerFields.map(mapHeader);

  const dataLines = lines.slice(1);
  if (dataLines.length > MAX_IMPORT_ROWS) {
    throw new ImportLimitExceededError(
      `CSV upload has ${dataLines.length} contact rows, exceeding the ${MAX_IMPORT_ROWS}-contact ` +
        'limit (§7.1). Split into multiple uploads or use the streamed path.'
    );
  }

  const rows: RawContactImportRow[] = [];
  const errorRows: CsvErrorRow[] = [];

  dataLines.forEach((line, index) => {
    const values = splitCsvLine(line);
    const record: Partial<Record<MappedField, string>> = {};
    fieldMap.forEach((field, col) => {
      if (field && values[col] !== undefined && values[col] !== '') {
        record[field] = values[col];
      }
    });

    if (!record.name || !record.name.trim()) {
      errorRows.push({ index, raw: line, reason: 'Missing or unmapped "name" column' });
      return;
    }

    // Emoji/nickname names (§7.6 "tolerated") — no stripping, no rejection; passed through as-is.
    rows.push({
      name: record.name,
      phone: record.phone ?? null,
      email: record.email ?? null,
      notes: record.notes ?? null,
      industry: record.industry ?? null,
      birthdate: record.birthdate ?? null,
      // T-29R2: raw pass-through (normalized downstream by VaultService.upsertRow); absent column ->
      // null, never fails the import.
      jurisdiction: record.jurisdiction ?? null,
    });
  });

  return { rows, errorRows };
}
