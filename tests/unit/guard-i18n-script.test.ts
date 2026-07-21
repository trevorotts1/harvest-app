// T-53 — proves `scripts/guard-i18n.mjs` (the build-time catalog copy-lint + layout
// growth-tolerance guard, wired into `postbuild` as `npm run guard:i18n`) actually DETECTS a
// violation, not just that it passes against the current clean repo state. Runs the real script
// as a child process against small, disposable fixture trees — mirrors this repo's own convention
// of testing guard scripts by invocation rather than importing their internals (they are
// deliberately plain, self-contained Node scripts with no exported API — see this repo's other
// scripts/guard-*.mjs files, none of which are unit-imported either).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const GUARD_SCRIPT = path.join(REPO_ROOT, 'scripts', 'guard-i18n.mjs');

/** Copies the guard script + a minimal src/lib/i18n/messages + src/ CSS tree into a scratch repo
 *  root so the script's own path resolution (`path.join(__dirname, '..')` etc.) works unmodified,
 *  without touching the real repo's files. */
function makeScratchRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'guard-i18n-test-'));
  mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  mkdirSync(path.join(dir, 'src', 'lib', 'i18n', 'messages'), { recursive: true });
  cpSync(GUARD_SCRIPT, path.join(dir, 'scripts', 'guard-i18n.mjs'));
  return dir;
}

function writeCatalogs(dir: string, en: object, es: object) {
  writeFileSync(path.join(dir, 'src', 'lib', 'i18n', 'messages', 'en.json'), JSON.stringify(en, null, 2));
  writeFileSync(path.join(dir, 'src', 'lib', 'i18n', 'messages', 'es.json'), JSON.stringify(es, null, 2));
}

function runGuard(dir: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', ['scripts/guard-i18n.mjs'], { cwd: dir, encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('scripts/guard-i18n.mjs — (A) copy-lint, both languages', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('a clean EN+ES catalog PASSES (exit 0)', () => {
    dir = makeScratchRepo();
    writeCatalogs(dir, { greeting: 'Hello there' }, { greeting: 'Hola' });
    const result = runGuard(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/no layout growth-truncation risk found. OK/);
  });

  test('an EN catalog string containing a forbidden doctrine term FAILS the build (exit 1)', () => {
    dir = makeScratchRepo();
    writeCatalogs(dir, { cta: 'Add this prospect now' }, { cta: 'Hola' });
    const result = runGuard(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Copy-lint FAILED/);
    expect(result.stderr).toMatch(/prospect/);
  });

  test('an ES catalog string containing a forbidden Spanish doctrine term ALSO FAILS the build — Spanish is not exempt', () => {
    dir = makeScratchRepo();
    writeCatalogs(dir, { cta: 'Add this contact now' }, { cta: 'Agrega este prospecto ahora' });
    const result = runGuard(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Copy-lint FAILED/);
    expect(result.stderr).toMatch(/es\.json/);
    expect(result.stderr).toMatch(/prospecto/);
  });

  test('a forbidden term appearing only in the WRONG language column is not flagged under that column (EN scan uses EN terms, ES scan uses ES terms)', () => {
    dir = makeScratchRepo();
    // "recruit" is an EN-list term; placing it inside the ES value should NOT trip the EN scan
    // (it isn't scanned against en.json's content) — the ES scanner has its own (different)
    // Spanish-only substrings and "recruit" the English word isn't among them.
    writeCatalogs(dir, { cta: 'Clean english copy' }, { cta: 'Please recruit is English inside ES value' });
    const result = runGuard(dir);
    expect(result.status).toBe(0);
  });

  // T-R32b QC-reject regression: "lead" is word-boundary-matched (so "Regional Leader" doesn't
  // false-positive) via /\bleads?\b/i, mirroring src/services/compliance/vocabulary.ts's
  // FORBIDDEN_TERMS exactly. An earlier version built the regex generically from the bare term
  // string (`\blead\b`), which silently DROPPED the plural "leads" — the single most common banned
  // form in real MLM copy ("generate more leads", "buy a leads list"). These cases pin both
  // directions: the plural must still FAIL, and the legitimate "Leader"/"leadership" words must
  // still PASS.
  test('the PLURAL "leads" is caught — must FAIL — even though "lead" is word-boundary-matched', () => {
    dir = makeScratchRepo();
    writeCatalogs(dir, { cta: 'Generate more leads today' }, { cta: 'Hola' });
    const result = runGuard(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Copy-lint FAILED/);
    expect(result.stderr).toMatch(/"lead"/);
  });

  test('the plural "leads" inside a longer noun phrase ("sales leads list") is also caught — must FAIL', () => {
    dir = makeScratchRepo();
    writeCatalogs(dir, { cta: 'Buy a sales leads list' }, { cta: 'Hola' });
    const result = runGuard(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Copy-lint FAILED/);
  });

  test('the singular "a lead" is caught — must FAIL', () => {
    dir = makeScratchRepo();
    writeCatalogs(dir, { cta: 'This is a lead' }, { cta: 'Hola' });
    const result = runGuard(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Copy-lint FAILED/);
  });

  test('"Regional Leader" does NOT false-positive on "lead" — must PASS', () => {
    dir = makeScratchRepo();
    writeCatalogs(dir, { title: 'Regional Leader' }, { title: 'Líder Regional' });
    const result = runGuard(dir);
    expect(result.status).toBe(0);
  });

  test('"leadership team" does NOT false-positive on "lead" — must PASS', () => {
    dir = makeScratchRepo();
    writeCatalogs(dir, { copy: 'Join the leadership team' }, { copy: 'Únete al equipo' });
    const result = runGuard(dir);
    expect(result.status).toBe(0);
  });
});

describe('scripts/guard-i18n.mjs — (B) layout growth-tolerance CSS scan', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('a chip/button/banner selector with a FIXED PIXEL WIDTH fails the build', () => {
    dir = makeScratchRepo();
    writeCatalogs(dir, { ok: 'fine' }, { ok: 'bien' });
    mkdirSync(path.join(dir, 'src', 'app'), { recursive: true });
    writeFileSync(
      path.join(dir, 'src', 'app', 'test.module.css'),
      '.myChip { width: 80px; display: inline-flex; }\n'
    );
    const result = runGuard(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Growth-tolerance FAILED/);
    expect(result.stderr).toMatch(/fixed width: 80px/);
  });

  test('a fixed pixel width on a NON-growth-sensitive selector (e.g. an icon) does not fail', () => {
    dir = makeScratchRepo();
    writeCatalogs(dir, { ok: 'fine' }, { ok: 'bien' });
    mkdirSync(path.join(dir, 'src', 'app'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'app', 'test.module.css'), '.icon { width: 24px; }\n');
    const result = runGuard(dir);
    expect(result.status).toBe(0);
  });

  test('text-overflow: ellipsis anywhere in a CSS module fails the build', () => {
    dir = makeScratchRepo();
    writeCatalogs(dir, { ok: 'fine' }, { ok: 'bien' });
    mkdirSync(path.join(dir, 'src', 'app'), { recursive: true });
    writeFileSync(
      path.join(dir, 'src', 'app', 'test.module.css'),
      '.label { text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }\n'
    );
    const result = runGuard(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/text-overflow: ellipsis/);
  });

  test('-webkit-line-clamp anywhere in a CSS module fails the build', () => {
    dir = makeScratchRepo();
    writeCatalogs(dir, { ok: 'fine' }, { ok: 'bien' });
    mkdirSync(path.join(dir, 'src', 'app'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'app', 'test.module.css'), '.clamp { -webkit-line-clamp: 2; }\n');
    const result = runGuard(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/-webkit-line-clamp/);
  });

  test('min-width (a floor, not a cap) on a chip never fails, even at a large value', () => {
    dir = makeScratchRepo();
    writeCatalogs(dir, { ok: 'fine' }, { ok: 'bien' });
    mkdirSync(path.join(dir, 'src', 'app'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'app', 'test.module.css'), '.myChip { min-width: 200px; }\n');
    const result = runGuard(dir);
    expect(result.status).toBe(0);
  });
});

describe('scripts/guard-i18n.mjs — against the REAL repo (no fixtures)', () => {
  test('running the real script from the real repo root exits 0 — the shipped catalog + CSS are clean', () => {
    const result = runGuard(REPO_ROOT);
    expect(result.status).toBe(0);
  });
});
