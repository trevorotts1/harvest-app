// T-57 RE-GATE ROUND-4 hardening, DIMENSION A (WCAG SC 4.1.3) — proves
// `scripts/guard-status-live-region.mjs` (wired into `postbuild` as `npm run guard:status-live-region`)
// actually DETECTS a fresh un-announced status render, respects an ARIA live region on the element OR
// an ancestor, does not false-positive on the shapes it must stay quiet on, and grandfathers its
// baseline. Runs the REAL script (unmodified, at its real repo location) as a child process against
// disposable fixture trees via the script's test-only env-var overrides — same convention as
// tests/unit/guard-no-literals-in-components-script.test.ts (its own `typescript` import keeps
// resolving from the real repo node_modules because the script file never moves).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const GUARD_SCRIPT = path.join(REPO_ROOT, 'scripts', 'guard-status-live-region.mjs');

function makeScratchSrc(): { dir: string; srcRoot: string; baselinePath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'guard-status-live-region-test-'));
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
        GUARD_STATUS_LIVE_REGION_SRC_ROOT: srcRoot,
        GUARD_STATUS_LIVE_REGION_BASELINE_PATH: baselinePath,
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

describe('scripts/guard-status-live-region.mjs', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('TEETH: a bare {error} render with no ARIA live region FAILS the build (exit 1)', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(s.srcRoot, 'Err.tsx', `export function Err({ error }: { error: string }) {\n  return <p>{error}</p>;\n}\n`);
    writeBaseline(s.baselinePath, []);
    const r = runGuard(s.srcRoot, s.baselinePath);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/FAILED/);
    expect(r.stderr).toMatch(/\{error\}/);
  });

  test('TEETH: {result.message} (a property access) with no live region FAILS', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(s.srcRoot, 'Zone.tsx', `export function Zone({ result }: { result: { message: string } }) {\n  return <p>{result.message}</p>;\n}\n`);
    writeBaseline(s.baselinePath, []);
    const r = runGuard(s.srcRoot, s.baselinePath);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/\{result\.message\}/);
  });

  test('TEETH: a *Message/*Error suffixed identifier ({coachingMessage}) with no live region FAILS', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(s.srcRoot, 'Coach.tsx', `export function Coach({ coachingMessage }: { coachingMessage: string }) {\n  return <span>{coachingMessage}</span>;\n}\n`);
    writeBaseline(s.baselinePath, []);
    const r = runGuard(s.srcRoot, s.baselinePath);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/\{coachingMessage\}/);
  });

  test('TEETH: a {error ?? t(...)} fallback (the launch-kit shape) with no live region FAILS', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(s.srcRoot, 'Fallback.tsx', `export function Fallback({ error, t }: { error: string | null; t: (k: string) => string }) {\n  return <p>{error ?? t('x.notFound')}</p>;\n}\n`);
    writeBaseline(s.baselinePath, []);
    const r = runGuard(s.srcRoot, s.baselinePath);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/error \?\? t/);
  });

  test('role="status" ON THE ELEMENT clears it — PASSES', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(s.srcRoot, 'Ok.tsx', `export function Ok({ error }: { error: string }) {\n  return <p role="status">{error}</p>;\n}\n`);
    writeBaseline(s.baselinePath, []);
    expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
  });

  test('role="alert"/aria-live on an ANCESTOR wrapper clears it — the ancestor walk PASSES', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(
      s.srcRoot,
      'Wrapped.tsx',
      `export function Wrapped({ error }: { error: string }) {\n  return <div role="alert"><span><p>{error}</p></span></div>;\n}\n`
    );
    writeBaseline(s.baselinePath, []);
    expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
  });

  test('an attribute value (aria-label={error}) is never flagged — only rendered CONTENT is', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(s.srcRoot, 'Attr.tsx', `export function Attr({ error }: { error: string }) {\n  return <input aria-label={error} />;\n}\n`);
    writeBaseline(s.baselinePath, []);
    expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
  });

  test('a computed call child ({t(...)} / {emptyStateMessage(x)}) is never flagged — not the async-status class', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(
      s.srcRoot,
      'Computed.tsx',
      `export function Computed({ t, emptyStateMessage }: { t: (k: string) => string; emptyStateMessage: (x: number) => string }) {\n  return <div><p>{t('x.heading')}</p><p>{emptyStateMessage(3)}</p></div>;\n}\n`
    );
    writeBaseline(s.baselinePath, []);
    expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
  });

  test('a {x.status} render is NOT flagged by this guard — a steady tabular token is the i18n-leak guard\'s concern', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(s.srcRoot, 'Status.tsx', `export function Status({ a }: { a: { status: string } }) {\n  return <li>{a.status}</li>;\n}\n`);
    writeBaseline(s.baselinePath, []);
    expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
  });

  // T-57 RG7 — the CLOSED BLIND SPOT: a `{t('…')}` child rendered in an error/failed branch (the
  // page-failed-to-load class) IS now flagged, while happy-path `{t('…')}` and decorative badges
  // beside an already-announced message stay quiet.
  describe('RG7: {t(\'…\')} rendered in an error/failed branch (the page-failed blind spot)', () => {
    test('TEETH: `if (state.kind === "failed") return <p>{t("…failed")}</p>` FAILS — no live region', () => {
      const s = makeScratchSrc();
      dir = s.dir;
      write(
        s.srcRoot,
        'Failed.tsx',
        `export function P({ state, t }: { state: { kind: string }; t: (k: string) => string }) {\n  if (state.kind === 'failed') {\n    return <div><p>{t('x.loadFailed')}</p></div>;\n  }\n  return <span>{t('x.ready')}</span>;\n}\n`
      );
      writeBaseline(s.baselinePath, []);
      const r = runGuard(s.srcRoot, s.baselinePath);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/x\.loadFailed/);
      // the happy-path {t('x.ready')} in the SAME component must NOT be flagged.
      expect(r.stderr).not.toMatch(/x\.ready/);
    });

    test('TEETH: `{cond === "failed" && <p>{t("…")}</p>}` (the JSX && shape) FAILS', () => {
      const s = makeScratchSrc();
      dir = s.dir;
      write(
        s.srcRoot,
        'AndFail.tsx',
        `export function P({ courseState, t }: { courseState: string; t: (k: string) => string }) {\n  return <section>{courseState === 'failed' && <p>{t('x.loadFailed')}</p>}</section>;\n}\n`
      );
      writeBaseline(s.baselinePath, []);
      expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(1);
    });

    test('MUTATION PROOF: wrapping the failed-state text in <StatusMessage> reverts the FAIL to a PASS (the structural fix the guard recognizes)', () => {
      const s = makeScratchSrc();
      dir = s.dir;
      write(
        s.srcRoot,
        'FailedOk.tsx',
        `import { StatusMessage } from '@/components/StatusMessage';\nexport function P({ state, t }: { state: { kind: string }; t: (k: string) => string }) {\n  if (state.kind === 'failed') {\n    return <div><StatusMessage>{t('x.loadFailed')}</StatusMessage></div>;\n  }\n  return <span>{t('x.ready')}</span>;\n}\n`
      );
      writeBaseline(s.baselinePath, []);
      expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
    });

    test('a retry <button>{t(\'…retry\')}</button> in the SAME failed branch is NOT flagged — an interactive control label is not a status message', () => {
      const s = makeScratchSrc();
      dir = s.dir;
      write(
        s.srcRoot,
        'Retry.tsx',
        `import { StatusMessage } from '@/components/StatusMessage';\nexport function P({ state, t, onRetry }: { state: { kind: string }; t: (k: string) => string; onRetry: () => void }) {\n  if (state.kind === 'failed') {\n    return <div><StatusMessage>{t('x.loadFailed')}</StatusMessage><button onClick={onRetry}>{t('x.retry')}</button></div>;\n  }\n  return null;\n}\n`
      );
      writeBaseline(s.baselinePath, []);
      expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
    });

    test('a decorative badge beside an ALREADY-announced status (role="status" on the message) is NOT flagged — the branch already announces', () => {
      const s = makeScratchSrc();
      dir = s.dir;
      write(
        s.srcRoot,
        'ZoneErr.tsx',
        `export function P({ result, t }: { result: { status: string; message: string }; t: (k: string) => string }) {\n  if (result.status === 'error') {\n    return <section><span>{t('x.zoneBadge')}</span><p role="status">{result.message}</p></section>;\n  }\n  return null;\n}\n`
      );
      writeBaseline(s.baselinePath, []);
      expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
    });

    test('a happy-path `{t(\'…heading\')}` (no error branch anywhere) is NOT flagged', () => {
      const s = makeScratchSrc();
      dir = s.dir;
      write(
        s.srcRoot,
        'Happy.tsx',
        `export function P({ t }: { t: (k: string) => string }) {\n  return <section><h2>{t('x.heading')}</h2><p>{t('x.body')}</p></section>;\n}\n`
      );
      writeBaseline(s.baselinePath, []);
      expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
    });
  });

  test('a violation present in the baseline is grandfathered (WARN-EXEMPT), and a SECOND new one still fails', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(
      s.srcRoot,
      'Legacy.tsx',
      `export function Legacy({ error, loadError }: { error: string; loadError: string }) {\n  return <div><p>{error}</p><p>{loadError}</p></div>;\n}\n`
    );
    // grandfather ONLY the {error} one — the {loadError} one must still fail.
    writeBaseline(s.baselinePath, ['src/Legacy.tsx::0::{error}']);
    const r = runGuard(s.srcRoot, s.baselinePath);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/WARN-EXEMPT/);
    expect(r.stderr).toMatch(/\{loadError\}/);
    expect(r.stderr).not.toMatch(/FAILED — .*\{error\}/); // {error} is exempt, not in the FAILED list
  });
});

describe('scripts/guard-status-live-region.mjs — against the REAL repo (no fixtures)', () => {
  test('running the real script from the real repo root, with the real checked-in baseline, exits 0', () => {
    let stdout = '';
    let status = 0;
    try {
      stdout = execFileSync('node', ['scripts/guard-status-live-region.mjs'], { cwd: REPO_ROOT, encoding: 'utf8' });
    } catch (err) {
      const e = err as { status?: number; stdout?: string };
      status = e.status ?? 1;
      stdout = e.stdout ?? '';
    }
    expect(status).toBe(0);
    expect(stdout).toMatch(/no NEW un-announced status renders found\. OK\./);
  });
});
