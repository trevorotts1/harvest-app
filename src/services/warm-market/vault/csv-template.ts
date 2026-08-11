// R-14 (refinements catalog 2026-07-28) — the CSV contact-import UX: the downloadable template must
// match the SERVER parser's accepted headers EXACTLY, never a hand-copied second table that could
// drift from it (the same drift-elimination rationale as `mapHeader`/`normalizeHeader` being shared
// between server parse and client preview, T-R30 GAP 1). `CSV_TEMPLATE_HEADERS` below is derived
// from the parser's own `HEADER_ALIASES` keys (csv-parser.ts): every canonical field the parser
// maps onto. The round-trip proof lives in tests/unit/r14-csv-ux.test.ts — the generated template is
// fed through the REAL `parseContactCsv`, and every row must survive with its values landing on the
// intended fields.
//
// Why these canonical names: each is the FIRST alias of its logical field in csv-parser.ts's
// `HEADER_ALIASES`, so a header line of exactly `CSV_TEMPLATE_HEADERS` is guaranteed to map 1:1
// onto `MappedField` — a filled-in template is a valid import by construction (and the template
// only omits `jurisdiction`'s sibling aliases, which the parser also accepts; the template simply
// shows the canonical spelling per field).
//
// This module is deliberately pure (no `Buffer`, no DOM): `parseContactCsv`'s byte-limit check is
// the only server-side part of the parser, and nothing here touches it, so this file can be
// imported from a `'use client'` component and from the node test env alike.

/** Canonical header names — the exact header line a filled-in template ships. Ordered the way the
 *  guidance reads: the required `name` first, then the commonly-used contact channels, then the
 *  optional enrichment columns. `name` is the ONLY column the parser requires (a row with an empty
 *  or unmapped name becomes an error row — see `parseContactCsv`). */
export const CSV_TEMPLATE_HEADERS = ['name', 'phone', 'email', 'notes', 'industry', 'birthdate', 'jurisdiction'] as const;

/** One example row per column — used by both the on-screen guidance examples and the template's
 *  sample row (the header is real; the sample row is a plausible, fill-me-in illustration). */
export const CSV_TEMPLATE_EXAMPLE = ['Jamie Rivera', '312-555-0100', 'jamie@example.com', 'Met at the credit union', 'Retail', '1985-03-14', 'IL'] as const;

/** The exact template file name the download produces (locale-agnostic; `es` reps get the same
 *  filename, matching the locale-agnostic header row). */
export const CSV_TEMPLATE_FILENAME = 'harvest-contacts-template.csv';

/**
 * Builds the downloadable template's full CSV text: the canonical header line (exactly
 * `CSV_TEMPLATE_HEADERS`) plus one example row — so the rep sees the format AND a filled example in
 * the file itself, and the file is still a valid import (a template a rep uploads unedited imports
 * one perfectly-formed row rather than erroring on an empty file).
 */
export function buildContactCsvTemplate(): string {
  return buildContactCsv([[...CSV_TEMPLATE_EXAMPLE]]);
}

/**
 * Builds CSV text for arbitrary rows against the canonical header line — RFC4180-ish quoted fields,
 * exactly like the parser's own `splitCsvLine` reads them (embedded commas/quotes are escaped the
 * same way the parser un-escapes them). Used by the template download; also the basis for the
 * test's round-trip proof (build → parseContactCsv → values land on the intended fields).
 */
export function buildContactCsv(rows: readonly (readonly string[])[]): string {
  const quote = (value: string): string => (value.includes(',') || value.includes('"') ? `"${value.replace(/"/g, '""')}"` : value);
  const lines: string[] = [CSV_TEMPLATE_HEADERS.join(',')];
  for (const row of rows) {
    const padded = CSV_TEMPLATE_HEADERS.map((_, i) => (i < row.length ? row[i] : ''));
    lines.push(padded.map(quote).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
