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

  // T-57 RG5-FINAL — shape (d): a raw backend token merely de-snake-cased via
  // `.replace()`/`.replaceAll('_', ' ')` before being rendered as a JSX child (CalendarStrip's
  // pre-fix `{e.type.replaceAll('_', ' ')}` shape) — humanizing the PUNCTUATION never translates the
  // LANGUAGE, so this is the same leak class as shape (b), just one AST layer removed.
  describe('shape (d): humanized raw token (.replace*(\'_\', \' \')) rendered as JSX content', () => {
    test('TEETH: {e.type.replaceAll(\'_\', \' \')} as a JSX child FAILS', () => {
      const s = makeScratchSrc();
      dir = s.dir;
      write(
        s.srcRoot,
        'Calendar.tsx',
        `export function Calendar({ e }: { e: { type: string } }) {\n  return <strong>{e.type.replaceAll('_', ' ')}</strong>;\n}\n`
      );
      writeBaseline(s.baselinePath, []);
      const r = runGuard(s.srcRoot, s.baselinePath);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/humanized-raw-token-jsx/);
      expect(r.stderr).toMatch(/e\.type\.replaceAll/);
    });

    test('TEETH: a CHAINED humanize (.replace(/_/g, \' \').toLowerCase()) still FAILS — the trailing call does not hide it', () => {
      const s = makeScratchSrc();
      dir = s.dir;
      write(
        s.srcRoot,
        'Team.tsx',
        `export function Team({ item }: { item: { triggerReason: string } }) {\n  return <strong>{item.triggerReason.replace(/_/g, ' ').toLowerCase()}</strong>;\n}\n`
      );
      writeBaseline(s.baselinePath, []);
      const r = runGuard(s.srcRoot, s.baselinePath);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/humanized-raw-token-jsx/);
    });

    test('MUTATION PROOF: fixing it via a catalog mapper (mirroring CalendarStrip\'s real fix) reverts the FAIL to a PASS', () => {
      const s = makeScratchSrc();
      dir = s.dir;
      const fixedSource = `export function Calendar({ e, t }: { e: { type: string }; t: (k: string) => string }) {\n  const LABELS: Record<string, string> = { opportunity_night: 'x' };\n  return <strong>{t(LABELS[e.type] ?? 'generic')}</strong>;\n}\n`;
      write(s.srcRoot, 'Calendar.tsx', fixedSource);
      writeBaseline(s.baselinePath, []);
      expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
    });

    test('an UNRELATED .replace() call (digit-stripping, no underscore/space pattern) is NOT flagged', () => {
      const s = makeScratchSrc();
      dir = s.dir;
      write(
        s.srcRoot,
        'Digits.tsx',
        `export function Digits({ v }: { v: { raw: string } }) {\n  return <span>{v.raw.replace(/\\D/g, '')}</span>;\n}\n`
      );
      writeBaseline(s.baselinePath, []);
      expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
    });

    test('the same humanize call used on a JSX ATTRIBUTE (not a rendered child) is NOT flagged — out of this shape\'s scope', () => {
      const s = makeScratchSrc();
      dir = s.dir;
      write(
        s.srcRoot,
        'Attr.tsx',
        `export function Attr({ e }: { e: { type: string } }) {\n  return <span data-kind={e.type.replaceAll('_', ' ')} />;\n}\n`
      );
      writeBaseline(s.baselinePath, []);
      expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
    });
  });

  // T-57 RG5-FINAL — `type` added to TOKEN_FIELDS (shape (b)/(c) now also catch a BARE `{x.type}`
  // render, not merely the humanized-via-.replace* shape (d) above).
  describe('TOKEN_FIELDS now includes `type`', () => {
    test('TEETH: a bare {event.type} JSX child FAILS', () => {
      const s = makeScratchSrc();
      dir = s.dir;
      write(s.srcRoot, 'Bare.tsx', `export function Bare({ event }: { event: { type: string } }) {\n  return <span>{event.type}</span>;\n}\n`);
      writeBaseline(s.baselinePath, []);
      const r = runGuard(s.srcRoot, s.baselinePath);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/raw-token-jsx/);
    });

    test('a {`${item.type}-${idx}`} used as a `key` ATTRIBUTE (not rendered content) is NOT flagged', () => {
      const s = makeScratchSrc();
      dir = s.dir;
      write(
        s.srcRoot,
        'KeyAttr.tsx',
        `export function KeyAttr({ items }: { items: { type: string }[] }) {\n  return <ul>{items.map((item, idx) => <li key={\`\${item.type}-\${idx}\`}>x</li>)}</ul>;\n}\n`
      );
      writeBaseline(s.baselinePath, []);
      expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
    });
  });
  // T-57 RG7 — BLIND-SPOT (a): field names matched by PATTERN (suffix), not just an exact list, so the
  // whole `*Status`/`*State`/`*_reason`/`*_status` enum-token class is enumerable.
  describe('RG7 blind-spot (a): token fields matched by SUFFIX PATTERN', () => {
    test.each([
      ['{seat.activationStatus}', 'export function C({ seat }: { seat: { activationStatus: string } }) {\n  return <span>{seat.activationStatus}</span>;\n}\n'],
      ['{seat.sponsorshipState}', 'export function C({ seat }: { seat: { sponsorshipState: string } }) {\n  return <span>{seat.sponsorshipState}</span>;\n}\n'],
      ['{e.myAttendanceState}', 'export function C({ e }: { e: { myAttendanceState: string } }) {\n  return <li>{e.myAttendanceState}</li>;\n}\n'],
      ['{item.publish_hold_reason}', 'export function C({ item }: { item: { publish_hold_reason: string } }) {\n  return <p>{item.publish_hold_reason}</p>;\n}\n'],
    ])('TEETH: a raw %s render FAILS (previously invisible — not in the old exact list)', (_label, body) => {
      const s = makeScratchSrc();
      dir = s.dir;
      write(s.srcRoot, 'Suffix.tsx', body);
      writeBaseline(s.baselinePath, []);
      const r = runGuard(s.srcRoot, s.baselinePath);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/raw-token-jsx/);
    });

    test('MUTATION PROOF: routing the same field through a display mapper reverts the FAIL to a PASS', () => {
      const s = makeScratchSrc();
      dir = s.dir;
      write(
        s.srcRoot,
        'SuffixOk.tsx',
        `import { activationStatusLabel } from '@/lib/i18n/team-token-display';\nexport function C({ seat, t }: { seat: { activationStatus: string }; t: (k: string) => string }) {\n  return <span>{activationStatusLabel(t, seat.activationStatus)}</span>;\n}\n`
      );
      writeBaseline(s.baselinePath, []);
      expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
    });

    test('a field that does NOT match the token pattern ({item.headline}) is NOT flagged', () => {
      const s = makeScratchSrc();
      dir = s.dir;
      write(s.srcRoot, 'NonToken.tsx', `export function C({ item }: { item: { headline: string } }) {\n  return <p>{item.headline}</p>;\n}\n`);
      writeBaseline(s.baselinePath, []);
      expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
    });
  });

  // T-57 RG7 — BLIND-SPOT (b): the `??`/`||`/ternary a raw token hides behind is unwrapped, so
  // `{x?.status ?? t('…')}` still flags the raw `x.status`.
  describe('RG7 blind-spot (b): raw token inside a ??/||/ternary fallback', () => {
    test('TEETH: {googleLink?.status ?? t(\'…\')} FAILS — the raw status in the ?? fallback is caught', () => {
      const s = makeScratchSrc();
      dir = s.dir;
      write(
        s.srcRoot,
        'Nullish.tsx',
        `export function C({ googleLink, t }: { googleLink?: { status: string }; t: (k: string) => string }) {\n  return <strong>{googleLink?.status ?? t('x.notConnected')}</strong>;\n}\n`
      );
      writeBaseline(s.baselinePath, []);
      const r = runGuard(s.srcRoot, s.baselinePath);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/raw-token-jsx/);
      expect(r.stderr).toMatch(/googleLink\?\.status \?\?/);
    });

    test('TEETH: {cond ? x.reason : t(\'…\')} FAILS — the raw reason in a ternary branch is caught', () => {
      const s = makeScratchSrc();
      dir = s.dir;
      write(
        s.srcRoot,
        'Ternary.tsx',
        `export function C({ x, cond, t }: { x: { reason: string }; cond: boolean; t: (k: string) => string }) {\n  return <p>{cond ? x.reason : t('x.ok')}</p>;\n}\n`
      );
      writeBaseline(s.baselinePath, []);
      expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(1);
    });

    test('MUTATION PROOF: mapping the token inside the fallback ({calendarLinkStatusLabel(t, x?.status)}) reverts to a PASS', () => {
      const s = makeScratchSrc();
      dir = s.dir;
      write(
        s.srcRoot,
        'NullishOk.tsx',
        `import { calendarLinkStatusLabel } from '@/lib/i18n/team-token-display';\nexport function C({ googleLink, t }: { googleLink?: { status: string }; t: (k: string) => string }) {\n  return <strong>{calendarLinkStatusLabel(t, googleLink?.status)}</strong>;\n}\n`
      );
      writeBaseline(s.baselinePath, []);
      expect(runGuard(s.srcRoot, s.baselinePath).status).toBe(0);
    });
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
