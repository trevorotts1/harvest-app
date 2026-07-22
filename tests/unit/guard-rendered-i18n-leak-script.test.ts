// T-57 RE-GATE ROUND-4 hardening, DIMENSION B (i18n) — proves
// `scripts/guard-rendered-i18n-leak.mjs` (wired into `postbuild` as `npm run guard:rendered-i18n-leak`)
// DETECTS the three leak shapes it targets (hardcoded English in a set*()/.push() sink; a raw backend
// machine token rendered as JSX content; a raw token interpolated into t()'s vars), stays quiet on the
// legit uses (mapper-wrapped tokens, technical templates, single-token setters, non-token fields), and
// grandfathers its baseline. Runs the REAL script as a child process against disposable fixture trees
// via the script's test-only env-var overrides — same convention as the sibling guard tests.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const GUARD_SCRIPT = path.join(REPO_ROOT, 'scripts', 'guard-rendered-i18n-leak.mjs');

function makeScratchSrc(): { dir: string; srcRoot: string; baselinePath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'guard-rendered-i18n-leak-test-'));
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
        GUARD_RENDERED_I18N_LEAK_SRC_ROOT: srcRoot,
        GUARD_RENDERED_I18N_LEAK_BASELINE_PATH: baselinePath,
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

describe('scripts/guard-rendered-i18n-leak.mjs', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('TEETH (a): hardcoded English in a .push() template-literal sink FAILS the build', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(
      s.srcRoot,
      'Notices.tsx',
      `export function build(n: number) {\n  const notices: string[] = [];\n  notices.push(\`\${n} queued actions could not complete — they need review again.\`);\n  return notices;\n}\n`
    );
    writeBaseline(s.baselinePath, []);
    const r = runGuard(s.srcRoot, s.baselinePath);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/english-in-state-sink/);
    expect(r.stderr).toMatch(/queued actions could not complete/);
  });

  test('TEETH (a): hardcoded English in a setSyncFailure(cond ? `…` : null) TERNARY sink FAILS', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(
      s.srcRoot,
      'Sync.tsx',
      `export function run(setSyncFailure: (v: string | null) => void, failed: boolean, kind: string) {\n  setSyncFailure(failed ? \`1 item couldn't sync yet (\${kind}) — still queued.\` : null);\n}\n`
    );
    writeBaseline(s.baselinePath, []);
    const r = runGuard(s.srcRoot, s.baselinePath);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/english-in-state-sink/);
    expect(r.stderr).toMatch(/couldn't sync yet/);
  });

  test('a technical template (`csv-import-${x}`) in a setter is NOT flagged — no genuine internal-space prose', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(
      s.srcRoot,
      'Key.tsx',
      `export function k(setIdempotencyKey: (v: string) => void, r: string) {\n  setIdempotencyKey(\`csv-import-\${Date.now()}-\${r}\`);\n}\n`
    );
    writeBaseline(s.baselinePath, []);
    expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
  });

  test('a single-token setter arg (setMode(\'login\')) is NOT flagged — an enum/mode key, not prose', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(s.srcRoot, 'Mode.tsx', `export function m(setMode: (v: string) => void) {\n  setMode('login');\n}\n`);
    writeBaseline(s.baselinePath, []);
    expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
  });

  test('TEETH (b): a raw machine token rendered as JSX content ({kit.held_reason}) FAILS', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(s.srcRoot, 'Kit.tsx', `export function Kit({ kit }: { kit: { held_reason: string } }) {\n  return <div>{kit.held_reason}</div>;\n}\n`);
    writeBaseline(s.baselinePath, []);
    const r = runGuard(s.srcRoot, s.baselinePath);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/raw-token-jsx/);
    expect(r.stderr).toMatch(/kit\.held_reason/);
  });

  test('a token rendered THROUGH a mapper ({reasonDisplay(t, kit.held_reason)}) is NOT flagged — that is the fix', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(
      s.srcRoot,
      'KitOk.tsx',
      `import { reasonDisplay } from '@/lib/i18n/reason-display';\nexport function KitOk({ kit, t }: { kit: { held_reason: string }; t: (k: string) => string }) {\n  return <div>{reasonDisplay(t, kit.held_reason)}</div>;\n}\n`
    );
    writeBaseline(s.baselinePath, []);
    expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
  });

  test('TEETH (c): a raw token interpolated into t() vars ({ reason: state.reason }) FAILS', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(
      s.srcRoot,
      'Blocked.tsx',
      `export function Blocked({ state, t }: { state: { reason: string }; t: (k: string, v?: object) => string }) {\n  return <p>{t('x.template', { reason: state.reason })}</p>;\n}\n`
    );
    writeBaseline(s.baselinePath, []);
    const r = runGuard(s.srcRoot, s.baselinePath);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/raw-token-in-t-vars/);
  });

  test('a token passed THROUGH a mapper inside t() vars ({ reason: reasonDisplay(t, r) }) is NOT flagged', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(
      s.srcRoot,
      'BlockedOk.tsx',
      `import { reasonDisplay } from '@/lib/i18n/reason-display';\nexport function BlockedOk({ state, t }: { state: { reason: string }; t: (k: string, v?: object) => string }) {\n  return <p>{t('x.template', { reason: reasonDisplay(t, state.reason) })}</p>;\n}\n`
    );
    writeBaseline(s.baselinePath, []);
    expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
  });

  test('a non-token field rendered as content ({item.body} / {c.firstName}) is NOT flagged', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(
      s.srcRoot,
      'Content.tsx',
      `export function Content({ item, c }: { item: { body: string }; c: { firstName: string } }) {\n  return <div><p>{item.body}</p><span>{c.firstName}</span></div>;\n}\n`
    );
    writeBaseline(s.baselinePath, []);
    expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
  });

  test('a violation present in the baseline is grandfathered (WARN-EXEMPT) and does not fail the build', () => {
    const s = makeScratchSrc();
    dir = s.dir;
    write(s.srcRoot, 'Legacy.tsx', `export function Legacy({ x }: { x: { status: string } }) {\n  return <li>{x.status}</li>;\n}\n`);
    writeBaseline(s.baselinePath, ['src/Legacy.tsx::raw-token-jsx::0::{x.status}']);
    const r = runGuard(s.srcRoot, s.baselinePath);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/WARN-EXEMPT/);
  });
});

describe('scripts/guard-rendered-i18n-leak.mjs — against the REAL repo (no fixtures)', () => {
  test('running the real script from the real repo root, with the real checked-in baseline, exits 0', () => {
    let stdout = '';
    let status = 0;
    try {
      stdout = execFileSync('node', ['scripts/guard-rendered-i18n-leak.mjs'], { cwd: REPO_ROOT, encoding: 'utf8' });
    } catch (err) {
      const e = err as { status?: number; stdout?: string };
      status = e.status ?? 1;
      stdout = e.stdout ?? '';
    }
    expect(status).toBe(0);
    expect(stdout).toMatch(/no NEW rendered-i18n-leaks found\. OK\./);
  });
});
