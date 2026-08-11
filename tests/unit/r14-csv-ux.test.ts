// R-14 (refinements catalog 2026-07-28) — the CSV contact-import UX: format guidance, a
// downloadable template, and an upload-success confirmation with the route's real counts. This
// suite proves, in order:
//
//   (1) TEMPLATE ↔ PARSER ROUND-TRIP (the card's hard requirement): the generated template's header
//       line is EXACTLY the parser's accepted schema — fed through the REAL `parseContactCsv`
//       (csv-parser.ts), every column maps onto a distinct logical field and every value lands on
//       the field it belongs to; nothing is error-flagged, nothing is dropped. Also covers the
//       quoted-field escape the parser reads (`splitCsvLine`'s `""` un-escape), so a filled-in
//       template with a comma/quotes in a field survives a round-trip.
//
//   (2) GUIDANCE RENDERS — the 'csv-format' beat renders the column table (required/optional
//       markers, examples) + the download CTA + the CSV/manual fallbacks (R-13 preserved), in BOTH
//       locales.
//
//   (3) COUNTS RENDER FROM THE RESPONSE — the 'csv-outcome' beat renders the filename and the
//       imported/merged/skipped counts EXACTLY as supplied (no client fabrication), including the
//       singular/plural CLDR variants and the malformed-rows hint when the route reported errorRows.
//
//   (4) I18N PARITY — every new key exists in BOTH catalogs with genuinely-different real Spanish.
//
//   (5) WIRING (source-scan, the repo's established convention) — OnboardingFlow passes the route's
//       real counts into `csvOutcome`, lands on 'csv-outcome' before advancing, and keeps the
//       R-13 manual form + dense-track surfaces untouched.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ContactImportStep, { type CsvImportOutcome } from '@/app/onboarding/components/ContactImportStep';
import {
  buildContactCsv,
  buildContactCsvTemplate,
  CSV_TEMPLATE_EXAMPLE,
  CSV_TEMPLATE_FILENAME,
  CSV_TEMPLATE_HEADERS,
} from '@/services/warm-market/vault/csv-template';
import { mapHeader, parseContactCsv } from '@/services/warm-market/vault/csv-parser';
import { LocaleContext } from '@/app/locale-context';
import { t } from '@/lib/i18n/catalog';

const REPO = path.join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(path.join(REPO, rel), 'utf8');
const flowSrc = read('src/app/onboarding/OnboardingFlow.tsx');
const stepSrc = read('src/app/onboarding/components/ContactImportStep.tsx');
const enCatalog = JSON.parse(read('src/lib/i18n/messages/en.json')) as { [k: string]: unknown };
const esCatalog = JSON.parse(read('src/lib/i18n/messages/es.json')) as { [k: string]: unknown };
const get = (tree: { [k: string]: unknown }, p: string): string | undefined =>
  p.split('.').reduce<unknown>((node, part) => {
    if (typeof node !== 'object' || node === null) return undefined;
    return (node as { [k: string]: unknown })[part];
  }, tree) as string | undefined;

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function renderEn<P extends object>(el: ComponentType<P>, props: P) {
  return renderToStaticMarkup(createElement(el, props));
}

function renderEs<P extends object>(el: ComponentType<P>, props: P) {
  return renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      { value: { locale: 'es', setLocale: () => {}, t: (key: string, vars?: Record<string, string | number>) => t('es', key, vars) } },
      createElement(el, props)
    )
  );
}

// ─── 1. Template ↔ parser round-trip ─────────────────────────────────────────────────────────────

describe('R-14 CSV template — matches the parser\'s accepted schema (round-trip through the real parser)', () => {
  test('the header line is exactly the parser\'s canonical column set, every column mapping onto a DISTINCT logical field', () => {
    // The template ships the canonical spelling per parser field (the first alias of each
    // HEADER_ALIASES key) — prove every header maps, and that together they cover ALL parser fields
    // with no duplicates: a template that dropped or duplicated a column would not be "the expected
    // schema".
    const mapped = CSV_TEMPLATE_HEADERS.map((h) => mapHeader(h));
    expect(mapped.every((f) => f !== null)).toBe(true);
    expect(new Set(mapped).size).toBe(CSV_TEMPLATE_HEADERS.length);
    // The parser's MappedField set — kept in lockstep with csv-parser.ts's HEADER_ALIASES keys.
    const parserFields = new Set(['name', 'phone', 'email', 'notes', 'industry', 'birthdate', 'jurisdiction']);
    for (const field of mapped) parserFields.delete(field as string);
    expect([...parserFields]).toEqual([]);
  });

  test('round-trip: the generated template parses cleanly through the REAL parser — 1 row, 0 errors, every value on its intended field', () => {
    const result = parseContactCsv(buildContactCsvTemplate());
    expect(result.errorRows).toEqual([]);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.name).toBe('Jamie Rivera');
    expect(row.phone).toBe('312-555-0100');
    expect(row.email).toBe('jamie@example.com');
    expect(row.notes).toBe('Met at the credit union');
    expect(row.industry).toBe('Retail');
    expect(row.birthdate).toBe('1985-03-14');
    expect(row.jurisdiction).toBe('IL');
  });

  test('round-trip with RFC4180 quoting: a comma and a quote inside a field survive the parser\'s `splitCsvLine` un-escape', () => {
    const result = parseContactCsv(buildContactCsv([['Rivera, Jamie "Jay"', '312-555-0100', 'j@example.com', '', '', '', '']]));
    expect(result.errorRows).toEqual([]);
    expect(result.rows[0].name).toBe('Rivera, Jamie "Jay"');
    expect(result.rows[0].email).toBe('j@example.com');
  });

  test('the template example row is exactly the values the guidance table shows (one source of truth)', () => {
    const template = buildContactCsvTemplate();
    const parsed = parseContactCsv(template);
    expect(parsed.rows[0].name).toBe(CSV_TEMPLATE_EXAMPLE[CSV_TEMPLATE_HEADERS.indexOf('name')]);
    // The downloadable file is a valid import even when uploaded unedited.
    expect(parsed.errorRows).toEqual([]);
  });

  test('the template filename is stable and CSV-typed', () => {
    expect(CSV_TEMPLATE_FILENAME).toBe('harvest-contacts-template.csv');
  });
});

// ─── 2. Format guidance renders (both locales) ───────────────────────────────────────────────────

describe('R-14 format guidance beat — renders the parser\'s columns, examples, and download CTA (EN + ES)', () => {
  const OUTCOME_FREE_PROPS = { beat: 'csv-format' as const, onAdvance: () => {} };

  test('EN: the column table (required name, optional columns, examples), the download CTA, and the R-13 fallbacks render', () => {
    const html = renderEn(ContactImportStep, OUTCOME_FREE_PROPS);
    const text = textOf(html);
    expect(text).toContain('Your CSV needs these columns');
    expect(text).toContain('The first row must be the column names');
    expect(text).toContain('Column');
    expect(text).toContain('Required');
    expect(text).toContain('Optional');
    expect(text).toContain('Example');
    // Every canonical column name + its example value renders.
    for (const column of CSV_TEMPLATE_HEADERS) {
      expect(text).toContain(column);
    }
    expect(text).toContain('Jamie Rivera');
    expect(text).toContain('312-555-0100');
    expect(text).toContain('jamie@example.com');
    expect(text).toContain('Limit: 10 MB and up to 10,000 contacts per upload.');
    // Download CTA + the same CSV/manual fallbacks the denied beat offers (R-13 preserved).
    expect(text).toContain('Download the CSV template');
    expect(text).toContain('Import a CSV');
    expect(text).toContain('Add one at a time');
  });

  test('ES: the same guidance renders as REAL Spanish, no English leaks', () => {
    const html = renderEs(ContactImportStep, OUTCOME_FREE_PROPS);
    const text = textOf(html);
    expect(text).toContain('Tu CSV necesita estas columnas');
    expect(text).toContain('La primera fila debe tener los nombres de las columnas');
    expect(text).toContain('Obligatoria');
    expect(text).toContain('Opcional');
    expect(text).toContain('Ejemplo');
    expect(text).toContain('Descargar la plantilla CSV');
    expect(text).toContain('Límite: 10 MB y hasta 10.000 contactos por carga.');
    expect(text).toContain('Agregar una a la vez');
    // The column NAMES stay in English by design (they ARE the parser's schema — a translated
    // header would silently fail the fuzzy map) — so only the UI chrome must not leak.
    expect(text).not.toContain('Your CSV needs these columns');
    expect(text).not.toContain('Download the CSV template');
  });
});

// ─── 3. Upload-success counts render from the response ──────────────────────────────────────────

const SAMPLE_OUTCOME: CsvImportOutcome = {
  fileName: 'my-team.csv',
  importedCount: 5,
  mergedCount: 3,
  skippedCount: 2,
  hadErrorRows: true,
};

describe('R-14 upload-success beat — renders the filename + real imported/merged/skipped counts', () => {
  test('EN: filename, all three counts, and the malformed-rows hint render exactly as supplied', () => {
    const html = renderEn(ContactImportStep, { beat: 'csv-outcome' as const, csvOutcome: SAMPLE_OUTCOME, onCsvOutcomeContinue: () => {} });
    const text = textOf(html);
    expect(text).toContain('Your CSV is in');
    expect(text).toContain('my-team.csv');
    expect(text).toContain('5 new contacts added to your community');
    expect(text).toContain('3 existing contacts were already in your community and were merged');
    expect(text).toContain('2 rows were skipped and not imported');
    expect(text).toContain('A row is skipped when it has no name');
    expect(text).toContain('Continue');
  });

  test('ES: the confirmation renders as REAL Spanish with the same counts', () => {
    const html = renderEs(ContactImportStep, { beat: 'csv-outcome' as const, csvOutcome: SAMPLE_OUTCOME, onCsvOutcomeContinue: () => {} });
    const text = textOf(html);
    expect(text).toContain('Tu CSV se importó');
    expect(text).toContain('my-team.csv');
    expect(text).toContain('5 contactos nuevos agregados a tu comunidad');
    expect(text).toContain('3 contactos existentes ya estaban en tu comunidad y se fusionaron');
    expect(text).toContain('2 filas se omitieron y no se importaron');
    expect(text).toContain('Una fila se omite cuando no tiene nombre');
    expect(text).toContain('Continuar');
    expect(text).not.toContain('Your CSV is in');
  });

  test('CLDR singular/plural: count 1 renders the "one" variants in both locales', () => {
    const one = { ...SAMPLE_OUTCOME, importedCount: 1, mergedCount: 1, skippedCount: 1, hadErrorRows: false };
    const en = textOf(renderEn(ContactImportStep, { beat: 'csv-outcome' as const, csvOutcome: one, onCsvOutcomeContinue: () => {} }));
    const es = textOf(renderEs(ContactImportStep, { beat: 'csv-outcome' as const, csvOutcome: one, onCsvOutcomeContinue: () => {} }));
    expect(en).toContain('1 new contact added to your community');
    expect(en).toContain('1 existing contact was already in your community and was merged');
    expect(en).toContain('1 row was skipped and not imported');
    expect(es).toContain('1 contacto nuevo agregado a tu comunidad');
    expect(es).toContain('1 contacto existente ya estaba en tu comunidad y se fusionó');
    expect(es).toContain('1 fila se omitió y no se importó');
  });

  test('no error-rows → no malformed-row hint (the counts alone, honest and clean)', () => {
    const clean = { ...SAMPLE_OUTCOME, hadErrorRows: false };
    const text = textOf(renderEn(ContactImportStep, { beat: 'csv-outcome' as const, csvOutcome: clean, onCsvOutcomeContinue: () => {} }));
    expect(text).not.toContain('A row is skipped when it has no name');
    expect(text).toContain('2 rows were skipped and not imported');
  });

  test('the outcome card announces the counts as a polite status change (role="status")', () => {
    const html = renderEn(ContactImportStep, { beat: 'csv-outcome' as const, csvOutcome: SAMPLE_OUTCOME, onCsvOutcomeContinue: () => {} });
    expect(html).toContain('role="status"');
  });
});

// ─── 4. i18n parity ──────────────────────────────────────────────────────────────────────────────

describe('R-14 i18n parity — every new key exists in BOTH catalogs with real, non-identical ES', () => {
  const NEW_KEYS = [
    'onboarding.contactImport.csv.formatTitle',
    'onboarding.contactImport.csv.formatLede',
    'onboarding.contactImport.csv.columnsLabel',
    'onboarding.contactImport.csv.requiredLabel',
    'onboarding.contactImport.csv.optionalLabel',
    'onboarding.contactImport.csv.exampleLabel',
    'onboarding.contactImport.csv.downloadTemplateCta',
    'onboarding.contactImport.csv.sampleRowLabel',
    'onboarding.contactImport.csv.limitsCaption',
    'onboarding.contactImport.csvOutcome.headline',
    'onboarding.contactImport.csvOutcome.filenameCaption',
    'onboarding.contactImport.csvOutcome.importedLine_one',
    'onboarding.contactImport.csvOutcome.importedLine_other',
    'onboarding.contactImport.csvOutcome.mergedLine_one',
    'onboarding.contactImport.csvOutcome.mergedLine_other',
    'onboarding.contactImport.csvOutcome.skippedLine_one',
    'onboarding.contactImport.csvOutcome.skippedLine_other',
    'onboarding.contactImport.csvOutcome.skippedHint',
    'onboarding.contactImport.csvOutcome.continueCta',
  ];

  test('every new key resolves in EN and ES, and the ES value is genuinely different (real translation, never a byte-identical passthrough)', () => {
    for (const key of NEW_KEYS) {
      const en = get(enCatalog, key);
      const es = get(esCatalog, key);
      expect(typeof en).toBe('string');
      expect((en as string).length).toBeGreaterThan(0);
      expect(typeof es).toBe('string');
      expect((es as string).length).toBeGreaterThan(0);
      // `filenameCaption` is a pure `{fileName}` interpolation placeholder — identical by design
      // in both locales (the file name itself is never translated). Every OTHER key must be real
      // Spanish, genuinely different from its EN counterpart.
      if (key !== 'onboarding.contactImport.csvOutcome.filenameCaption') {
        expect(es).not.toBe(en);
      }
    }
  });
});

// ─── 5. Wiring: real counts from the route, outcome-before-advance, R-13/dense preserved ─────────

describe('R-14 wiring — the flow feeds the route\'s real response into the outcome beat', () => {
  test('processCsvFile sets csvOutcome from the route response (importedCount/mergedCount/errorRows) and lands on \'csv-outcome\' BEFORE advancing', () => {
    expect(stepSrc).toContain("beat === 'csv-outcome'");
    // The handler reads the REAL fields the route returns — never a fabricated constant.
    expect(flowSrc).toContain('result.importedCount');
    expect(flowSrc).toContain('result.mergedCount');
    expect(flowSrc).toContain('result.errorRows');
    // The skipped figure is the route's OWN rejected-row list length (never a totalRows gap
    // heuristic that could mislabel unprocessed rows of a resumable batch as "skipped").
    expect(flowSrc).toContain('skippedCount: Array.isArray(result.errorRows) ? result.errorRows.length : 0');
    // A failed import still never advances: the csvOutcome set happens only after response.ok.
    const okIdx = flowSrc.indexOf('if (!response.ok)');
    const outcomeIdx = flowSrc.indexOf('setCsvOutcome({');
    expect(outcomeIdx).toBeGreaterThan(okIdx);
    // The flow lands on the outcome beat instead of the old silent `advance()`.
    expect(flowSrc).toContain("setImportBeat('csv-outcome')");
    // Continue is the ONLY way onward from the outcome (explicit, user-driven).
    expect(flowSrc).toContain('onCsvOutcomeContinue={() => {');
  });

  test('the guidance beat is reachable from BOTH fallback beats, and "Add one at a time" (R-13) still renders on them', () => {
    // The denied/unsupported beats route Import-a-CSV through the guidance beat.
    expect(flowSrc).toContain("onViewCsvFormat={() => setImportBeat('csv-format')}");
    // The manual entry form (R-13) still renders in place of the phone-import beats.
    expect(flowSrc).toContain("importBeat === 'manual' && (");
    expect(flowSrc).toContain("importBeat !== 'manual' && (");
    // The manual beat keeps its own fallback CTAs inside ContactImportStep (R-13 preserved).
    expect(stepSrc).toContain('addManuallyCta');
  });

  test('dense-track and native-select surfaces are untouched: no changes to their renders or copy', () => {
    // The dense track (UplineTrack/GdprConsentStep/First48Handoff) never renders the import beats.
    expect(flowSrc).toContain("denseScreen === 'consent'");
    expect(flowSrc).toContain("denseScreen === 'first48'");
    expect(flowSrc).toContain('trackKindForRole(role) === \'dense\'');
    // The native 'select' beat (T-58) is unchanged.
    expect(stepSrc).toContain("beat === 'select'");
    // The R-13 manual form's Cancel landing logic is untouched (denied/unsupported/reveal only).
    expect(flowSrc).toContain("manualReturnBeatRef.current === 'reveal'");
  });
});
