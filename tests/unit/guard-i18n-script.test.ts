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

// T-R34 QC-reject follow-up (rejected 7.0): T-R34 widened six FORBIDDEN_TERMS_ES entries in
// src/services/compliance/vocabulary.ts to catch inflected/plural forms — "embudo", "conversión",
// "contacto en frío", "presentación de ventas" (+ "discurso de ventas"), "reclutar", and "público
// objetivo" — and mirrored three of the multi-word/accent-sensitive ones into this script's
// WORD_BOUNDARY_TERMS map. It MISSED mirroring "público objetivo": the plain `.includes('público
// objetivo')` substring check does not match "públicos objetivos" / "públicos objetivo" (pluralizing
// the first word inserts an "s" before the following space, breaking the substring — same defect
// class as "contacto en frío"), so the copy-lint silently disagreed with the runtime classifier.
// Fixed by adding the missing WORD_BOUNDARY_TERMS entry (mirroring vocabulary.ts's
// `/\bp[uú]blicos?\s+objetivos?\b/i` exactly). This suite pins the fix and, per the audit this fix
// required, proves the OTHER five widened terms already agree with the runtime (whether via their
// own WORD_BOUNDARY_TERMS regex, or — for "embudo"/"reclutar" — the plain substring being a literal
// prefix of every inflected form), so any future re-introduction of drift on any of the six is
// caught here rather than slipping to QC again.
describe('scripts/guard-i18n.mjs — T-R34 QC-reject follow-up: guard/runtime drift on all 6 widened ES terms', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe('público objetivo (the missed mirror — this drift is what got T-R34 rejected)', () => {
    test('the plural "públicos objetivos" is caught — must FAIL', () => {
      dir = makeScratchRepo();
      writeCatalogs(dir, { ok: 'fine' }, { cta: 'Define tus públicos objetivos antes de publicar' });
      const result = runGuard(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Copy-lint FAILED/);
      expect(result.stderr).toMatch(/público objetivo/);
    });

    test('the mixed-plural "públicos objetivo" is caught — must FAIL', () => {
      dir = makeScratchRepo();
      writeCatalogs(dir, { ok: 'fine' }, { cta: 'Nuestros públicos objetivo son variados' });
      const result = runGuard(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Copy-lint FAILED/);
    });

    test('the mixed-plural "público objetivos" is caught — must FAIL', () => {
      dir = makeScratchRepo();
      writeCatalogs(dir, { ok: 'fine' }, { cta: 'Elige tu público objetivos con cuidado' });
      const result = runGuard(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Copy-lint FAILED/);
    });

    test('the fully-singular "público objetivo" is still caught — must FAIL (pre-existing, not a regression)', () => {
      dir = makeScratchRepo();
      writeCatalogs(dir, { ok: 'fine' }, { cta: 'Define tu público objetivo' });
      const result = runGuard(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Copy-lint FAILED/);
    });

    test('benign "público general" does NOT false-positive — must PASS', () => {
      dir = makeScratchRepo();
      writeCatalogs(dir, { ok: 'fine' }, { cta: 'Este mensaje es para el público general' });
      const result = runGuard(dir);
      expect(result.status).toBe(0);
    });

    test('benign "público" alone (no "objetivo" nearby) does NOT false-positive — must PASS', () => {
      dir = makeScratchRepo();
      writeCatalogs(dir, { ok: 'fine' }, { cta: 'Gracias, público, por su atención' });
      const result = runGuard(dir);
      expect(result.status).toBe(0);
    });

    test('benign "objetivo" alone (no "público" nearby) does NOT false-positive — must PASS', () => {
      dir = makeScratchRepo();
      writeCatalogs(dir, { ok: 'fine' }, { cta: 'Nuestro objetivo es ayudarte a crecer' });
      const result = runGuard(dir);
      expect(result.status).toBe(0);
    });

    test('benign "público" and "objetivo" both present but NOT adjacent/in-order does NOT false-positive — must PASS', () => {
      dir = makeScratchRepo();
      writeCatalogs(
        dir,
        { ok: 'fine' },
        { cta: 'Somos un público diverso, con un objetivo claro y compartido' }
      );
      const result = runGuard(dir);
      expect(result.status).toBe(0);
    });
  });

  describe('the other 5 T-R34-widened terms — confirming they already agree with the runtime', () => {
    test('embudo: plural "embudos" is caught — must FAIL (plain substring is prefix-safe)', () => {
      dir = makeScratchRepo();
      writeCatalogs(dir, { ok: 'fine' }, { cta: 'Simplifica tus embudos de ventas' });
      const result = runGuard(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Copy-lint FAILED/);
    });

    test('conversión: plural + accent-dropped "conversiones" is caught — must FAIL', () => {
      dir = makeScratchRepo();
      writeCatalogs(dir, { ok: 'fine' }, { cta: 'Mejora tus conversiones esta semana' });
      const result = runGuard(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Copy-lint FAILED/);
    });

    test('contacto en frío: plural "contactos en frío" is caught — must FAIL', () => {
      dir = makeScratchRepo();
      writeCatalogs(dir, { ok: 'fine' }, { cta: 'Evita los contactos en frío' });
      const result = runGuard(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Copy-lint FAILED/);
    });

    test('presentación de ventas: plural + accent-dropped "presentaciones de ventas" is caught — must FAIL', () => {
      dir = makeScratchRepo();
      writeCatalogs(dir, { ok: 'fine' }, { cta: 'Prepara tus presentaciones de ventas' });
      const result = runGuard(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Copy-lint FAILED/);
    });

    test('discurso de ventas (the alternate noun sharing the same rule) is caught — must FAIL', () => {
      dir = makeScratchRepo();
      writeCatalogs(dir, { ok: 'fine' }, { cta: 'No uses un discurso de ventas' });
      const result = runGuard(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Copy-lint FAILED/);
    });

    test('reclutar: feminine past-participle "reclutada" is caught — must FAIL (plain substring is prefix-safe)', () => {
      dir = makeScratchRepo();
      writeCatalogs(dir, { ok: 'fine' }, { cta: 'Fue reclutada la semana pasada' });
      const result = runGuard(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Copy-lint FAILED/);
    });

    test('reclutar: feminine plural past-participle "reclutadas" is caught — must FAIL', () => {
      dir = makeScratchRepo();
      writeCatalogs(dir, { ok: 'fine' }, { cta: 'Las nuevas reclutadas empiezan hoy' });
      const result = runGuard(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Copy-lint FAILED/);
    });
  });
});

// T-57 BLOCKER-B2: vocabulary.ts's runtime "recruit"/"reclut" rows were widened to also catch the
// agentive-noun forms "recruiter(s)"/"reclutador/a(s)". This suite proves the copy-lint's EXISTING
// bare substrings ("recruit" / "reclut") already agree with the widened runtime regexes — via
// plain string-prefix inclusion, with NO new WORD_BOUNDARY_TERMS entry required — so guard and
// runtime don't drift apart on this widening. (Contrast with "público objetivo" above, which DID
// need an explicit override because pluralizing its first word breaks a plain substring match; see
// the corrected comment above WORD_BOUNDARY_TERMS in guard-i18n.mjs for the full explanation of why
// that distinction matters and why it must be checked per-term, not assumed.)
describe('scripts/guard-i18n.mjs — T-57 BLOCKER-B2: guard/runtime agreement on the widened agentive-noun forms', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('EN: "recruiter" is caught by the plain "recruit" substring — must FAIL', () => {
    dir = makeScratchRepo();
    writeCatalogs(dir, { title: 'Ask your recruiter for help' }, { title: 'Hola' });
    const result = runGuard(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Copy-lint FAILED/);
    expect(result.stderr).toMatch(/"recruit"/);
  });

  test('EN: plural "recruiters" is also caught — must FAIL', () => {
    dir = makeScratchRepo();
    writeCatalogs(dir, { title: 'Our recruiters are ready' }, { title: 'Hola' });
    const result = runGuard(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Copy-lint FAILED/);
  });

  test('ES: "reclutador" is caught by the plain "reclut" substring — must FAIL', () => {
    dir = makeScratchRepo();
    writeCatalogs(dir, { ok: 'fine' }, { title: 'Contacta a tu reclutador' });
    const result = runGuard(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Copy-lint FAILED/);
    expect(result.stderr).toMatch(/"reclut"/);
  });

  test('ES: feminine + plural "reclutadoras" is also caught — must FAIL', () => {
    dir = makeScratchRepo();
    writeCatalogs(dir, { ok: 'fine' }, { title: 'Las reclutadoras del equipo' });
    const result = runGuard(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Copy-lint FAILED/);
  });
});

describe('scripts/guard-i18n.mjs — against the REAL repo (no fixtures)', () => {
  test('running the real script from the real repo root exits 0 — the shipped catalog + CSS are clean', () => {
    const result = runGuard(REPO_ROOT);
    expect(result.status).toBe(0);
  });
});
