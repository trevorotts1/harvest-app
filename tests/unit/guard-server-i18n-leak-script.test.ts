// T-57 RG7 close-out, DIMENSION B (i18n) — proves `scripts/guard-server-i18n-leak.mjs` (wired into
// `postbuild` as `npm run guard:server-i18n-leak`) DETECTS a rep-facing string composed IN A FUNCTION
// from hardcoded English with no `locale`/`t()` in scope (the `sponsor-cockpit.service.ts` `roiNote`
// class), stays quiet on the things it must (module-level static config/seed data, a function that
// threads `locale` or calls `t()`, single-token/enum values), and grandfathers its baseline. Runs the
// REAL script as a child process against disposable fixture trees via the script's test-only env-var
// overrides — same convention as the sibling guard tests.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const GUARD_SCRIPT = path.join(REPO_ROOT, 'scripts', 'guard-server-i18n-leak.mjs');

function makeScratchSrc(): { dir: string; srcRoot: string; baselinePath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'guard-server-i18n-leak-test-'));
  const srcRoot = path.join(dir, 'src');
  mkdirSync(srcRoot, { recursive: true });
  return { dir, srcRoot, baselinePath: path.join(dir, 'baseline.json') };
}

function writeBaseline(baselinePath: string, fingerprints: string[]) {
  writeFileSync(baselinePath, JSON.stringify(fingerprints, null, 2));
}

function runGuard(srcRoot: string, baselinePath: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [GUARD_SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        GUARD_SERVER_I18N_LEAK_SRC_ROOT: srcRoot,
        GUARD_SERVER_I18N_LEAK_BASELINE_PATH: baselinePath,
      },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function write(srcRoot: string, name: string, body: string) {
  writeFileSync(path.join(srcRoot, name), body);
}

describe('scripts/guard-server-i18n-leak.mjs', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('TEETH: a `roiNote` template composed in a function with no locale/t() FAILS (the sponsor-cockpit shape)', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(
      s.srcRoot,
      'cockpit.service.ts',
      `export function build(n: number, m: number) {\n  return { roiNote: \`\${n} teammate(s) activated and \${m} appointment(s) generated for this seat.\` };\n}\n`
    );
    writeBaseline(s.baselinePath, []);
    const r = runGuard(s.srcRoot, s.baselinePath);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/english-in-server-prose/);
    expect(r.stderr).toMatch(/roiNote/);
  });

  test('MUTATION PROOF: threading a `locale` param through the same function reverts the FAIL to a PASS', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(
      s.srcRoot,
      'cockpit.service.ts',
      `import type { Locale } from '@/lib/i18n/locale';\nexport function build(locale: Locale, n: number, m: number) {\n  return { roiNote: renderNote(locale, n, m) };\n}\nfunction renderNote(_l: Locale, n: number, m: number) {\n  return \`\${n} + \${m}\`;\n}\n`
    );
    writeBaseline(s.baselinePath, []);
    expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
  });

  test('MUTATION PROOF (2): calling t() in the function reverts the FAIL to a PASS', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(
      s.srcRoot,
      'cockpit.service.ts',
      `declare function t(k: string, v?: object): string;\nexport function build(n: number, m: number) {\n  return { roiNote: t('team.cockpit.roiNote', { recruits: n, appointments: m }) };\n}\n`
    );
    writeBaseline(s.baselinePath, []);
    expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
  });

  test('MODULE-LEVEL static config (a const `label` table) is NOT flagged — not per-call composition', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(
      s.srcRoot,
      'clusters.ts',
      `export const CLUSTERS = [\n  { key: 'hub', label: 'Community Hub' },\n  { key: 'steady', label: 'Steady Builder' },\n];\n`
    );
    writeBaseline(s.baselinePath, []);
    expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
  });

  test('a NON-rep-facing property name ({ id: "some thing" }) is NOT flagged even inside a function', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(
      s.srcRoot,
      'ids.ts',
      `export function build() {\n  return { idempotencyKey: 'csv import batch key', memberName: 'Sponsored member fallback' };\n}\n`
    );
    writeBaseline(s.baselinePath, []);
    expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
  });

  test('a single-token (no internal space) value assigned to a rep-facing name is NOT flagged — an enum/token, not prose', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(
      s.srcRoot,
      'single.ts',
      `export function build(x: string) {\n  return { label: x, note: 'Active' };\n}\n`
    );
    writeBaseline(s.baselinePath, []);
    expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
  });

  test('a violation present in the baseline is grandfathered (WARN-EXEMPT) and does not fail the build', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(
      s.srcRoot,
      'legacy.service.ts',
      `export function build() {\n  return { note: 'prior engagement signal on file — open warm, reference the relationship.' };\n}\n`
    );
    writeBaseline(s.baselinePath, ['src/legacy.service.ts::english-in-server-prose::0::note: prior engagement signal on file — open warm, reference the relationship.']);
    const r = runGuard(s.srcRoot, s.baselinePath);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/WARN-EXEMPT/);
  });
});

describe('scripts/guard-server-i18n-leak.mjs — against the REAL repo (no fixtures)', () => {
  test('running the real script from the real repo root, with the real checked-in baseline, exits 0', () => {
    let stdout = '';
    let status = 0;
    try {
      stdout = execFileSync('node', ['scripts/guard-server-i18n-leak.mjs'], { cwd: REPO_ROOT, encoding: 'utf8' });
    } catch (err) {
      const e = err as { status?: number; stdout?: string };
      status = e.status ?? 1;
      stdout = e.stdout ?? '';
    }
    expect(status).toBe(0);
    expect(stdout).toMatch(/no NEW server-side i18n leaks found\. OK\./);
  });
});
