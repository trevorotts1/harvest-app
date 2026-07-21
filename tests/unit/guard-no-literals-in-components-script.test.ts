// T-53 QC#1 fixer (master-spec §17.5; uiux §6.2 "no literals in components — a lint rule") — proves
// `scripts/guard-no-literals-in-components.mjs` (wired into `postbuild` as
// `npm run guard:no-literals-in-components`) actually DETECTS a fresh violation, not just that it
// passes against the current clean-per-baseline repo state.
//
// Runs the REAL script (unmodified, at its real repo location) as a child process, exactly like
// tests/unit/guard-i18n-script.test.ts's own convention — with one difference this script's
// dependency on the real `typescript` package forces: instead of copying the script into a scratch
// repo root (which would break `import ts from 'typescript'` resolution outside this repo's
// node_modules), the fixture `src/` tree and baseline file live in a disposable scratch dir and are
// pointed to via the script's test-only `GUARD_NO_LITERALS_SRC_ROOT` /
// `GUARD_NO_LITERALS_BASELINE_PATH` env-var overrides (see that script's own header comment) — the
// script FILE itself never moves, so its own `typescript` import keeps resolving normally.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const GUARD_SCRIPT = path.join(REPO_ROOT, 'scripts', 'guard-no-literals-in-components.mjs');

function makeScratchSrc(): { dir: string; srcRoot: string; baselinePath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'guard-no-literals-test-'));
  const srcRoot = path.join(dir, 'src');
  mkdirSync(srcRoot, { recursive: true });
  const baselinePath = path.join(dir, 'baseline.json');
  return { dir, srcRoot, baselinePath };
}

function writeBaseline(baselinePath: string, fingerprints: string[]) {
  writeFileSync(baselinePath, JSON.stringify(fingerprints, null, 2));
}

function runGuard(srcRoot: string, baselinePath: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [GUARD_SCRIPT], {
      cwd: REPO_ROOT, // node_modules ('typescript') resolves from the REAL repo root
      encoding: 'utf8',
      env: {
        ...process.env,
        GUARD_NO_LITERALS_SRC_ROOT: srcRoot,
        GUARD_NO_LITERALS_BASELINE_PATH: baselinePath,
      },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('scripts/guard-no-literals-in-components.mjs', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('TEETH: a brand-new hardcoded JSX text literal, not in the baseline, FAILS the build (exit 1)', () => {
    const scratch = makeScratchSrc();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'Greeting.tsx'),
      `export function Greeting() {\n  return <p>Welcome back to the dashboard</p>;\n}\n`
    );
    writeBaseline(scratch.baselinePath, []); // empty baseline — nothing grandfathered

    const result = runGuard(scratch.srcRoot, scratch.baselinePath);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/FAILED/);
    expect(result.stderr).toMatch(/Welcome back to the dashboard/);
    expect(result.stderr).toMatch(/Do NOT add these to NO_LITERALS_BASELINE\.json/);
  });

  test('TEETH: a brand-new hardcoded literal on a content attribute (placeholder) FAILS the build', () => {
    const scratch = makeScratchSrc();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'SearchBox.tsx'),
      `export function SearchBox() {\n  return <input placeholder="Search your contacts" />;\n}\n`
    );
    writeBaseline(scratch.baselinePath, []);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/attr:placeholder/);
    expect(result.stderr).toMatch(/Search your contacts/);
  });

  test('TEETH: a bare string-literal JSX expression child (`{\'text\'}`) is caught exactly like raw JSX text', () => {
    const scratch = makeScratchSrc();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'Label.tsx'),
      `export function Label() {\n  return <span>{'Hardcoded via a brace expression'}</span>;\n}\n`
    );
    writeBaseline(scratch.baselinePath, []);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/jsx-expr-literal/);
    expect(result.stderr).toMatch(/Hardcoded via a brace expression/);
  });

  test('a component that routes ALL its copy through t() (the real i18n catalog convention) PASSES clean — no false positives on the pattern this guard exists to require', () => {
    const scratch = makeScratchSrc();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'Clean.tsx'),
      [
        "import { useT } from '@/app/locale-context';",
        'export function Clean() {',
        '  const t = useT();',
        '  return (',
        '    <div className="wrapper" data-testid="clean-panel">',
        '      <p>{t(\'clean.heading\')}</p>',
        '      <input placeholder={t(\'clean.placeholder\')} aria-label={t(\'clean.ariaLabel\')} />',
        '      <span>{42}</span>',
        '      <span>{"—"}</span>',
        '    </div>',
        '  );',
        '}',
        '',
      ].join('\n')
    );
    writeBaseline(scratch.baselinePath, []);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/no NEW hardcoded literals found\. OK\./);
  });

  test('className / data-testid / other non-content attributes are never flagged, even with wordy string values', () => {
    const scratch = makeScratchSrc();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'Structural.tsx'),
      `export function Structural() {\n  return <div className="some structural classname here" data-testid="a wordy test id" />;\n}\n`
    );
    writeBaseline(scratch.baselinePath, []);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath);
    expect(result.status).toBe(0);
  });

  test('numbers, punctuation-only, and short technical tokens are never flagged', () => {
    const scratch = makeScratchSrc();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'Technical.tsx'),
      [
        'export function Technical() {',
        '  return (',
        '    <div>',
        '      <span>42</span>',
        '      <span> — </span>',
        '      <span>OK</span>',
        '      <span>/api/settings/locale</span>',
        '    </div>',
        '  );',
        '}',
        '',
      ].join('\n')
    );
    writeBaseline(scratch.baselinePath, []);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath);
    expect(result.status).toBe(0);
  });

  test('a violation that IS present in the baseline is grandfathered (WARN-EXEMPT) and does not fail the build', () => {
    const scratch = makeScratchSrc();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'Legacy.tsx'),
      `export function Legacy() {\n  return <p>Some pre-existing hardcoded copy</p>;\n}\n`
    );
    // Exact fingerprint shape the script itself derives: relPath::kind::occurrenceIndex::snippet.
    writeBaseline(scratch.baselinePath, ['src/Legacy.tsx::jsx-text::0::Some pre-existing hardcoded copy']);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/WARN-EXEMPT/);
    expect(result.stdout).toMatch(/Some pre-existing hardcoded copy/);
  });

  test('a SECOND, different new literal added to an otherwise-grandfathered file still fails — grandfathering one violation never gives the whole file a pass', () => {
    const scratch = makeScratchSrc();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'Legacy.tsx'),
      `export function Legacy() {\n  return (\n    <div>\n      <p>Some pre-existing hardcoded copy</p>\n      <p>A brand new literal nobody grandfathered</p>\n    </div>\n  );\n}\n`
    );
    writeBaseline(scratch.baselinePath, ['src/Legacy.tsx::jsx-text::0::Some pre-existing hardcoded copy']);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/A brand new literal nobody grandfathered/);
  });

  test('.test.tsx files are excluded from the scan (test fixtures/mocks are not shipped UI copy)', () => {
    const scratch = makeScratchSrc();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'Weird.test.tsx'),
      `export function WeirdFixture() {\n  return <p>This text would fail if scanned but the file is excluded</p>;\n}\n`
    );
    writeBaseline(scratch.baselinePath, []);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Scanned 0 \.tsx file/);
  });
});

describe('scripts/guard-no-literals-in-components.mjs — against the REAL repo (no fixtures)', () => {
  test('running the real script from the real repo root, with the real checked-in baseline, exits 0', () => {
    let stdout = '';
    let status = 0;
    try {
      stdout = execFileSync('node', ['scripts/guard-no-literals-in-components.mjs'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string };
      status = e.status ?? 1;
      stdout = e.stdout ?? '';
    }
    expect(status).toBe(0);
    expect(stdout).toMatch(/no NEW hardcoded literals found\. OK\./);
  });
});
