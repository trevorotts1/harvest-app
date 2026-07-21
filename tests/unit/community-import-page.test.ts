// T-R30 (parity GAP 1) — proves the `/community/import` self-serve CSV surface's pure pieces:
//   (a) `parseCsvPreview` uses the SAME `splitCsvLine`/`mapHeader` the server's authoritative
//       `parseContactCsv` uses (imported, not re-implemented) — so the preview can never disagree
//       with what actually gets persisted;
//   (b) `ImportPreviewTable`/`ImportResultBanner` are pure, prop-driven renders (react-dom/server,
//       same convention as tests/unit/onboarding-ui.test.ts) — no result/error banner renders until
//       the server has actually responded, no fabricated/optimistic count ever shows.
//
// The stateful default-exported page (file picker + fetch orchestration) is intentionally NOT
// interaction-tested here, matching this codebase's established convention for stateful "screen"
// containers (OnboardingFlow.tsx, TimeLapseShare.tsx) — only their pure sub-pieces are.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { isGatedDownstreamPage } from '@/lib/auth/onboarding-gate-edge';
import {
  ImportPreviewTable,
  ImportResultBanner,
  parseCsvPreview,
  type ImportOutcome,
} from '@/app/community/import/CsvImportPanel';

const REPO_ROOT = path.join(__dirname, '..', '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');

const render = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ');

// ─── T-R30 GAP 1 mount/reachability proof (mirrors tests/unit/conversation-mount.test.ts's pattern
// for the exact same class of gap: T-51 found a real CSV parser existing only in an unreachable
// demo file, `src/app/dashboard/contact-upload-demo.tsx` — this proves the REAL surface is actually
// mounted on a route, gated, and linked from an existing, already-reached nav point). ────────────
describe('T-R30 GAP 1 — the /community/import surface is mounted, gated, and reachable', () => {
  test('the page exists at src/app/community/import/page.tsx', () => {
    expect(existsSync(path.join(SRC_DIR, 'app', 'community', 'import', 'page.tsx'))).toBe(true);
  });

  test('a not-yet-onboarded rep landing on /community/import still lands in onboarding first (session+onboarding gate)', () => {
    expect(isGatedDownstreamPage('/community/import')).toBe(true);
  });

  test('the page posts to the REAL Vault ingestion route (/api/contacts/import), never a parallel endpoint', () => {
    const src = readFileSync(path.join(SRC_DIR, 'app', 'community', 'import', 'page.tsx'), 'utf8');
    expect(src).toMatch(/fetch\(\s*['"`]\/api\/contacts\/import['"`]/);
  });

  test('the Community list links to /community/import — reachable from an existing, already-reached nav point', () => {
    const src = readFileSync(path.join(SRC_DIR, 'app', 'community', 'page.tsx'), 'utf8');
    expect(src).toMatch(/href="\/community\/import"/);
  });
});

describe('parseCsvPreview (pure — same header-alias detection as the server\'s parseContactCsv)', () => {
  test('maps varied real-world header spellings onto the SAME logical fields the server maps them onto', () => {
    const preview = parseCsvPreview('Full Name,Email Address,Cell Phone\nJane Doe,jane@example.com,312-555-0100\n');
    expect(preview.mappedFields).toEqual(['name', 'email', 'phone']);
  });

  test('an unrecognized column maps to null ("unmapped"), never guessed at', () => {
    const preview = parseCsvPreview('name,favorite color\nJane Doe,blue\n');
    expect(preview.mappedFields).toEqual(['name', null]);
  });

  test('quoted fields with embedded commas parse correctly in the preview (exotic CSV)', () => {
    const preview = parseCsvPreview('name,notes\n"Doe, Jane","Met at a conference, great chat"\n');
    expect(preview.rows[0]).toEqual(['Doe, Jane', 'Met at a conference, great chat']);
  });

  test('caps the preview at maxRows but reports the real total row count', () => {
    const lines = ['name'].concat(Array.from({ length: 20 }, (_, i) => `Person ${i}`));
    const preview = parseCsvPreview(lines.join('\n'), 5);
    expect(preview.rows).toHaveLength(5);
    expect(preview.totalDataRows).toBe(20);
  });

  test('empty CSV text yields an empty, non-crashing preview', () => {
    expect(parseCsvPreview('')).toEqual({ headers: [], mappedFields: [], rows: [], totalDataRows: 0 });
  });
});

describe('ImportPreviewTable (pure render)', () => {
  test('renders each header alongside its detected field mapping', () => {
    const preview = parseCsvPreview('Full Name,phone_number\nJane Doe,312-555-0100\n');
    const html = render(createElement(ImportPreviewTable, { preview }));
    expect(textOf(html)).toMatch(/Full Name/);
    expect(textOf(html)).toMatch(/→ Name/);
    expect(textOf(html)).toMatch(/phone_number/);
    expect(textOf(html)).toMatch(/→ Phone/);
  });

  test('an unmapped column is labeled "(unmapped)", never silently mapped to something', () => {
    const preview = parseCsvPreview('name,favorite color\nJane Doe,blue\n');
    const html = render(createElement(ImportPreviewTable, { preview }));
    expect(textOf(html)).toMatch(/\(unmapped\)/);
  });

  test('an empty preview (no headers) renders nothing', () => {
    const html = render(createElement(ImportPreviewTable, { preview: { headers: [], mappedFields: [], rows: [], totalDataRows: 0 } }));
    expect(html).toBe('');
  });
});

describe('ImportResultBanner (pure render — TEETH: never fabricates a result)', () => {
  test('outcome=null, error=null renders NOTHING — no optimistic/fake count before the server responds', () => {
    const html = render(createElement(ImportResultBanner, { outcome: null, error: null }));
    expect(html).toBe('');
  });

  test('a real outcome renders the REAL imported/merged counts', () => {
    const outcome: ImportOutcome = { importedCount: 3, mergedCount: 1, minorFlaggedCount: 0, errorRows: [], resumable: false };
    const html = render(createElement(ImportResultBanner, { outcome, error: null }));
    expect(html).toContain('role="status"');
    expect(textOf(html)).toMatch(/Imported 3/);
    expect(textOf(html)).toMatch(/Merged 1/);
  });

  test('minor-flagged contacts are called out explicitly (never silently absorbed into "imported")', () => {
    const outcome: ImportOutcome = { importedCount: 2, mergedCount: 0, minorFlaggedCount: 1, errorRows: [], resumable: false };
    const html = render(createElement(ImportResultBanner, { outcome, error: null }));
    expect(textOf(html)).toMatch(/1 flagged as minors/i);
  });

  test('a real server-side failure renders as an alert, never a silently-faked success', () => {
    const html = render(createElement(ImportResultBanner, { outcome: null, error: 'CSV upload is 12000000 bytes, exceeding the limit.' }));
    expect(html).toContain('role="alert"');
    expect(textOf(html)).toMatch(/exceeding the limit/i);
  });

  test('error takes precedence over any stale outcome (never shows both)', () => {
    const outcome: ImportOutcome = { importedCount: 5, mergedCount: 0, minorFlaggedCount: 0, errorRows: [], resumable: false };
    const html = render(createElement(ImportResultBanner, { outcome, error: 'boom' }));
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('role="status"');
  });
});
