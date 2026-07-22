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

  // T-57 BLOCKER-B5 fix — the extended AST walk: ternary string-literal branches, template-literal
  // content attributes, and string literals passed to setState-shaped calls.
  test('TEETH (T-57 B5): a ternary JSX-child string-literal branch (`{cond ? \'A\' : \'B\'}`) FAILS the build', () => {
    const scratch = makeScratchSrc();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'Toggle.tsx'),
      `export function Toggle({ on }: { on: boolean }) {\n  return <button>{on ? 'Stop the timer' : 'Start the timer'}</button>;\n}\n`
    );
    writeBaseline(scratch.baselinePath, []);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/jsx-ternary-branch/);
    expect(result.stderr).toMatch(/Stop the timer/);
    expect(result.stderr).toMatch(/Start the timer/);
  });

  test('TEETH (T-57 B5): a ternary on a content attribute (aria-label) FAILS the build', () => {
    const scratch = makeScratchSrc();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'AriaToggle.tsx'),
      `export function AriaToggle({ open }: { open: boolean }) {\n  return <button aria-label={open ? 'Close the panel' : 'Open the panel'} />;\n}\n`
    );
    writeBaseline(scratch.baselinePath, []);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/jsx-ternary-branch/);
    expect(result.stderr).toMatch(/Close the panel/);
  });

  test('a ternary on a NON-content attribute (className) is never flagged — a technical class-name toggle is not copy', () => {
    const scratch = makeScratchSrc();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'ClassToggle.tsx'),
      `export function ClassToggle({ active }: { active: boolean }) {\n  return <div className={active ? 'btn-primary' : 'btn-secondary'} />;\n}\n`
    );
    writeBaseline(scratch.baselinePath, []);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath);
    expect(result.status).toBe(0);
  });

  test('a ternary picking between fixed WAI-ARIA enum tokens (aria-current="page") is never flagged — the real false positive this repo hit', () => {
    const scratch = makeScratchSrc();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'NavLink.tsx'),
      "export function NavLink({ active, label }: { active: boolean; label: string }) {\n  return <a aria-current={active ? 'page' : undefined}>{label}</a>;\n}\n"
    );
    writeBaseline(scratch.baselinePath, []);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath);
    expect(result.status).toBe(0);
  });

  test('TEETH (T-57 B5): a template-literal content attribute (aria-label with a substitution) FAILS the build', () => {
    const scratch = makeScratchSrc();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'Avatar.tsx'),
      "export function Avatar({ initials }: { initials: string }) {\n  return <div aria-label={`Initials avatar: ${initials}`} />;\n}\n"
    );
    writeBaseline(scratch.baselinePath, []);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/attr-template:aria-label/);
    expect(result.stderr).toMatch(/Initials avatar:/);
  });

  test('TEETH (T-57 B5): a wordy string literal passed to a setState-shaped call FAILS the build', () => {
    const scratch = makeScratchSrc();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'LoginForm.tsx'),
      [
        "import { useState } from 'react';",
        'export function LoginForm() {',
        '  const [error, setError] = useState<string | null>(null);',
        "  const onSubmit = () => setError('Invalid email or password.');",
        '  return <button onClick={onSubmit}>{error}</button>;',
        '}',
        '',
      ].join('\n')
    );
    writeBaseline(scratch.baselinePath, []);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/setstate-literal/);
    expect(result.stderr).toMatch(/Invalid email or password\./);
  });

  test('a single-token setState argument (an enum/mode key, no space) is never flagged — avoids false-positiving on every mode setter', () => {
    const scratch = makeScratchSrc();
    dir = scratch.dir;
    writeFileSync(
      path.join(scratch.srcRoot, 'ModeSwitch.tsx'),
      [
        "import { useState } from 'react';",
        'export function ModeSwitch() {',
        "  const [mode, setMode] = useState('register');",
        "  return <button onClick={() => setMode('login')}>{mode}</button>;",
        '}',
        '',
      ].join('\n')
    );
    writeBaseline(scratch.baselinePath, []);

    const result = runGuard(scratch.srcRoot, scratch.baselinePath);
    expect(result.status).toBe(0);
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

  // T-57 RG5-FINAL — shape (7): a function-return English literal rendered as a JSX child, one hop
  // removed from the literal (PipelineGlance.tsx's real, pre-fix `deltaLabel()` bug).
  describe('shape (7): function-return English literal rendered as a JSX child', () => {
    test('TEETH: the real deltaLabel() shape — a helper returns { text: \'needs tending\', … }, rendered via {d.text} — FAILS', () => {
      const scratch = makeScratchSrc();
      dir = scratch.dir;
      writeFileSync(
        path.join(scratch.srcRoot, 'Pipeline.tsx'),
        [
          "function deltaLabel(delta: number): { text: string; className: string } {",
          "  if (delta < 0) return { text: 'needs tending', className: 'warn' };",
          "  return { text: '—', className: 'flat' };",
          '}',
          'export function Pipeline({ delta }: { delta: number }) {',
          '  const d = deltaLabel(delta);',
          '  return <span>{d.text}</span>;',
          '}',
          '',
        ].join('\n')
      );
      writeBaseline(scratch.baselinePath, []);

      const result = runGuard(scratch.srcRoot, scratch.baselinePath);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/fn-return-literal-prop-access/);
      expect(result.stderr).toMatch(/d\.text/);
    });

    test('MUTATION PROOF: threading t() into the helper (the real fix) reverts the FAIL to a PASS', () => {
      const scratch = makeScratchSrc();
      dir = scratch.dir;
      writeFileSync(
        path.join(scratch.srcRoot, 'Pipeline.tsx'),
        [
          "function deltaLabel(t: (k: string) => string, delta: number): { text: string; className: string } {",
          "  if (delta < 0) return { text: t('today.pipelineGlance.needsTending'), className: 'warn' };",
          "  return { text: '—', className: 'flat' };",
          '}',
          "export function Pipeline({ delta, t }: { delta: number; t: (k: string) => string }) {",
          '  const d = deltaLabel(t, delta);',
          '  return <span>{d.text}</span>;',
          '}',
          '',
        ].join('\n')
      );
      writeBaseline(scratch.baselinePath, []);
      expect(runGuard(scratch.srcRoot, scratch.baselinePath).status).toBe(0);
    });

    test('TEETH: a helper returning a BARE literal directly, called inline as a JSX child ({helperName(x)}), FAILS', () => {
      const scratch = makeScratchSrc();
      dir = scratch.dir;
      writeFileSync(
        path.join(scratch.srcRoot, 'Bare.tsx'),
        [
          "function statusLine(n: number): string {",
          "  return 'Nothing pending right now';",
          '}',
          'export function Bare({ n }: { n: number }) {',
          '  return <p>{statusLine(n)}</p>;',
          '}',
          '',
        ].join('\n')
      );
      writeBaseline(scratch.baselinePath, []);
      const result = runGuard(scratch.srcRoot, scratch.baselinePath);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/fn-return-literal-direct-call/);
    });

    test('a helper that ALREADY resolves its text via t() internally is never flagged — the fixed shape stays silent', () => {
      const scratch = makeScratchSrc();
      dir = scratch.dir;
      writeFileSync(
        path.join(scratch.srcRoot, 'Fixed.tsx'),
        [
          "function deltaLabel(t: (k: string) => string, delta: number): { text: string; className: string } {",
          "  if (delta < 0) return { text: t('x.needsTending'), className: 'warn' };",
          "  return { text: '—', className: 'flat' };",
          '}',
          "export function Fixed({ delta, t }: { delta: number; t: (k: string) => string }) {",
          '  const d = deltaLabel(t, delta);',
          '  return <span>{d.text}</span>;',
          '}',
          '',
        ].join('\n')
      );
      writeBaseline(scratch.baselinePath, []);
      expect(runGuard(scratch.srcRoot, scratch.baselinePath).status).toBe(0);
    });

    test('a PascalCase-named helper with the IDENTICAL risky shape is never treated as a "risky helper" — this shape only targets lowercase (non-component, non-hook) names', () => {
      const scratch = makeScratchSrc();
      dir = scratch.dir;
      writeFileSync(
        path.join(scratch.srcRoot, 'Comp.tsx'),
        [
          "function DeltaLabel(delta: number): { text: string } {",
          "  return delta < 0 ? { text: 'needs tending' } : { text: '—' };",
          '}',
          'export function Pipeline({ delta }: { delta: number }) {',
          '  const d = DeltaLabel(delta);',
          '  return <span>{d.text}</span>;',
          '}',
          '',
        ].join('\n')
      );
      writeBaseline(scratch.baselinePath, []);
      // Identical shape to the TEETH test above, just PascalCase-named — proves the exclusion is
      // real (a lowercase rename of this exact fixture is the TEETH test and DOES fail).
      expect(runGuard(scratch.srcRoot, scratch.baselinePath).status).toBe(0);
    });

    test('a single-word (no space) literal property, e.g. { key: \'flat\' }, is never flagged — an enum/state key, not prose', () => {
      const scratch = makeScratchSrc();
      dir = scratch.dir;
      writeFileSync(
        path.join(scratch.srcRoot, 'EnumKey.tsx'),
        [
          "function stateOf(n: number): { key: string } {",
          "  return n > 0 ? { key: 'up' } : { key: 'flat' };",
          '}',
          'export function EnumKey({ n }: { n: number }) {',
          '  const s = stateOf(n);',
          '  return <span data-state={s.key} />;',
          '}',
          '',
        ].join('\n')
      );
      writeBaseline(scratch.baselinePath, []);
      expect(runGuard(scratch.srcRoot, scratch.baselinePath).status).toBe(0);
    });

    test('a hook (use-prefixed, PascalCase-after-use) is never treated as a risky helper', () => {
      const scratch = makeScratchSrc();
      dir = scratch.dir;
      writeFileSync(
        path.join(scratch.srcRoot, 'HookUser.tsx'),
        [
          "function useGreeting(): string {",
          "  return 'Welcome back to your dashboard';",
          '}',
          'export function HookUser() {',
          '  const g = useGreeting();',
          '  return <p>{g}</p>;',
          '}',
          '',
        ].join('\n')
      );
      writeBaseline(scratch.baselinePath, []);
      // `g` is a bare identifier JSX child (not `{helperName(x)}` nor `{x.prop}`) — shape (7) cannot
      // see it either way; this proves the `use*` exclusion doesn't misfire into a different shape.
      expect(runGuard(scratch.srcRoot, scratch.baselinePath).status).toBe(0);
    });
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
