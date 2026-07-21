// T-57 R1b (MINOR-A7, uiux §6.1 "no automated 44px touch-target guard") — proves
// `scripts/guard-touch-target.mjs` (wired into `postbuild` as `npm run guard:touch-target`) actually
// DETECTS a fresh sub-floor interactive element, not just that it passes against the current
// baseline-grandfathered repo state.
//
// Runs the REAL script (unmodified, at its real repo location) as a child process, exactly like
// tests/unit/guard-no-literals-in-components-script.test.ts's own convention — its dependency on the
// real `typescript` package forces the same trick: instead of copying the script into a scratch repo
// root (which would break `import ts from 'typescript'` resolution outside this repo's
// node_modules), the fixture `src/` tree, baseline file, and tokens.css live in a disposable scratch
// dir and are pointed to via the script's test-only `GUARD_TOUCH_TARGET_SRC_ROOT` /
// `GUARD_TOUCH_TARGET_BASELINE_PATH` / `GUARD_TOUCH_TARGET_TOKENS_PATH` env-var overrides (see that
// script's own header comment) — the script FILE itself never moves, so its own `typescript` import
// keeps resolving normally.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const GUARD_SCRIPT = path.join(REPO_ROOT, 'scripts', 'guard-touch-target.mjs');

function makeScratch(): { dir: string; srcRoot: string; baselinePath: string; tokensPath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'guard-touch-target-test-'));
  const srcRoot = path.join(dir, 'src');
  mkdirSync(path.join(srcRoot, 'app'), { recursive: true });
  const baselinePath = path.join(dir, 'baseline.json');
  const tokensPath = path.join(srcRoot, 'app', 'tokens.css');
  // A real, minimal tokens.css with the real floor — resolves `var(--touch-target-min)` uses.
  writeFileSync(tokensPath, ':root {\n  --touch-target-min: 44px;\n}\n');
  // The guard also always looks for src/app/globals.css — must exist or readFileSync would throw
  // (existsSync guards other reads but checkCssFile's globals scan expects the file present, same
  // as the other guards' convention of a real, if empty, globals.css).
  writeFileSync(path.join(srcRoot, 'app', 'globals.css'), '');
  return { dir, srcRoot, baselinePath, tokensPath };
}

function writeBaseline(baselinePath: string, keys: string[]) {
  writeFileSync(baselinePath, JSON.stringify(keys, null, 2));
}

function runGuard(
  srcRoot: string,
  baselinePath: string,
  tokensPath: string
): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [GUARD_SCRIPT], {
      cwd: REPO_ROOT, // node_modules ('typescript') resolves from the REAL repo root
      encoding: 'utf8',
      env: {
        ...process.env,
        GUARD_TOUCH_TARGET_SRC_ROOT: srcRoot,
        GUARD_TOUCH_TARGET_BASELINE_PATH: baselinePath,
        GUARD_TOUCH_TARGET_TOKENS_PATH: tokensPath,
      },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('scripts/guard-touch-target.mjs', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('TEETH: a brand-new <button> with an explicit sub-floor min-height, not in the baseline, FAILS the build (exit 1)', () => {
    const scratch = makeScratch();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'app', 'Widget.tsx'),
      "import styles from './widget.module.css';\nexport function Widget() {\n  return <button className={styles.tinyBtn}>Go</button>;\n}\n"
    );
    writeFileSync(path.join(scratch.srcRoot, 'app', 'widget.module.css'), '.tinyBtn {\n  min-height: 20px;\n}\n');
    writeBaseline(scratch.baselinePath, []); // empty baseline — nothing grandfathered

    const result = runGuard(scratch.srcRoot, scratch.baselinePath, scratch.tokensPath);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/FAILED/);
    expect(result.stderr).toMatch(/\.tinyBtn.*min-height: 20px/);
  });

  test('TEETH: a brand-new <button> with an explicit sub-floor HEIGHT (not min-height) also FAILS — the mutation-test shape', () => {
    const scratch = makeScratch();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'app', 'Widget.tsx'),
      "import styles from './widget.module.css';\nexport function Widget() {\n  return <button className={styles.tinyBtn}>Go</button>;\n}\n"
    );
    writeFileSync(path.join(scratch.srcRoot, 'app', 'widget.module.css'), '.tinyBtn {\n  height: 20px;\n}\n');
    writeBaseline(scratch.baselinePath, []);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath, scratch.tokensPath);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/height: 20px/);
  });

  test('a <button> sized at exactly the floor via var(--touch-target-min) PASSES clean', () => {
    const scratch = makeScratch();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'app', 'Widget.tsx'),
      "import styles from './widget.module.css';\nexport function Widget() {\n  return <button className={styles.okBtn}>Go</button>;\n}\n"
    );
    writeFileSync(
      path.join(scratch.srcRoot, 'app', 'widget.module.css'),
      '.okBtn {\n  min-height: var(--touch-target-min);\n  min-width: var(--touch-target-min);\n}\n'
    );
    writeBaseline(scratch.baselinePath, []);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath, scratch.tokensPath);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/no NEW sub-floor interactive elements found\. OK\./);
  });

  test('a non-interactive element (plain <div>) with a tiny min-height is never flagged', () => {
    const scratch = makeScratch();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'app', 'Widget.tsx'),
      "import styles from './widget.module.css';\nexport function Widget() {\n  return <div className={styles.tinyBox}>Go</div>;\n}\n"
    );
    writeFileSync(path.join(scratch.srcRoot, 'app', 'widget.module.css'), '.tinyBox {\n  min-height: 8px;\n}\n');
    writeBaseline(scratch.baselinePath, []);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath, scratch.tokensPath);
    expect(result.status).toBe(0);
  });

  test('a <div role="button"> with a tiny min-height IS flagged (role=button counts as interactive)', () => {
    const scratch = makeScratch();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'app', 'Widget.tsx'),
      "import styles from './widget.module.css';\nexport function Widget() {\n  return <div role=\"button\" className={styles.pseudoBtn}>Go</div>;\n}\n"
    );
    writeFileSync(path.join(scratch.srcRoot, 'app', 'widget.module.css'), '.pseudoBtn {\n  min-height: 10px;\n}\n');
    writeBaseline(scratch.baselinePath, []);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath, scratch.tokensPath);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/\.pseudoBtn/);
  });

  test('the sr-only / visually-hidden idiom (position:absolute; 1px; overflow:hidden; clip:rect(0,0,0,0)) on an <input> is never flagged, even though it is technically an interactive element under the floor', () => {
    const scratch = makeScratch();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'app', 'Widget.tsx'),
      "import styles from './widget.module.css';\nexport function Widget() {\n  return <input type=\"file\" className={styles.hiddenFileInput} />;\n}\n"
    );
    writeFileSync(
      path.join(scratch.srcRoot, 'app', 'widget.module.css'),
      '.hiddenFileInput {\n  position: absolute;\n  width: 1px;\n  height: 1px;\n  overflow: hidden;\n  clip: rect(0, 0, 0, 0);\n}\n'
    );
    writeBaseline(scratch.baselinePath, []);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath, scratch.tokensPath);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/visually-hidden sr-only\/proxy-input rule\(s\) excluded/);
  });

  test('a violation present in the baseline is grandfathered (WARN-EXEMPT) and does not fail the build', () => {
    const scratch = makeScratch();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'app', 'Legacy.tsx'),
      "import styles from './legacy.module.css';\nexport function Legacy() {\n  return <button className={styles.legacyBtn}>Go</button>;\n}\n"
    );
    writeFileSync(path.join(scratch.srcRoot, 'app', 'legacy.module.css'), '.legacyBtn {\n  min-height: 36px;\n}\n');
    // Exact fingerprint shape the script derives: relPath::selector::fingerprint('min-height: 36px').
    // Computed once via a throwaway run against this exact fixture, same as the literals guard test's
    // documented convention of writing out the real derived shape rather than a guessed one.
    writeBaseline(scratch.baselinePath, ['src/app/legacy.module.css::.legacyBtn::ef28483f6d']);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath, scratch.tokensPath);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/WARN-EXEMPT/);
    expect(result.stdout).toMatch(/\.legacyBtn/);
  });

  test('a SECOND, different new violation added to an otherwise-grandfathered file still fails — grandfathering one violation never gives the whole file a pass', () => {
    const scratch = makeScratch();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'app', 'Legacy.tsx'),
      "import styles from './legacy.module.css';\nexport function Legacy() {\n  return (\n    <div>\n      <button className={styles.legacyBtn}>Go</button>\n      <button className={styles.newBtn}>Also go</button>\n    </div>\n  );\n}\n"
    );
    writeFileSync(
      path.join(scratch.srcRoot, 'app', 'legacy.module.css'),
      '.legacyBtn {\n  min-height: 36px;\n}\n.newBtn {\n  min-height: 12px;\n}\n'
    );
    writeBaseline(scratch.baselinePath, ['src/app/legacy.module.css::.legacyBtn::ef28483f6d']);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath, scratch.tokensPath);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/\.newBtn.*min-height: 12px/);
  });

  test('next/link <Link> components are treated as interactive (the canonical <a> stand-in)', () => {
    const scratch = makeScratch();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'app', 'Nav.tsx'),
      "import Link from 'next/link';\nimport styles from './nav.module.css';\nexport function Nav() {\n  return <Link href=\"/x\" className={styles.tinyLink}>Go</Link>;\n}\n"
    );
    writeFileSync(path.join(scratch.srcRoot, 'app', 'nav.module.css'), '.tinyLink {\n  min-width: 10px;\n}\n');
    writeBaseline(scratch.baselinePath, []);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath, scratch.tokensPath);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/\.tinyLink.*min-width: 10px/);
  });
});

describe('scripts/guard-touch-target.mjs — against the REAL repo (no fixtures)', () => {
  test('running the real script from the real repo root, with the real checked-in baseline, exits 0', () => {
    let stdout = '';
    let status = 0;
    try {
      stdout = execFileSync('node', ['scripts/guard-touch-target.mjs'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string };
      status = e.status ?? 1;
      stdout = e.stdout ?? '';
    }
    expect(status).toBe(0);
    expect(stdout).toMatch(/no NEW sub-floor interactive elements found\. OK\./);
  });
});
