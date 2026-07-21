#!/usr/bin/env node
/**
 * T-53 (master-spec §17.5; uiux §6.2) — the i18n build guard. Two independent checks, both scoped
 * to what a static Node script (no TypeScript compile, no browser) can actually verify:
 *
 * (A) COPY-LINT, BOTH LANGUAGES (uiux §0.4 "every user-facing string ships through the string
 *     catalog ... and the catalog build fails on any forbidden term" + §6.2 "the doctrine copy-lint
 *     ... runs on both languages — the forbidden-vocabulary list has a Spanish column"). Scans
 *     `src/lib/i18n/messages/en.json` and `es.json` (the actual product catalog) for the doctrine's
 *     banned selling/hype terms, in EITHER language, and fails the build if any catalog STRING
 *     contains one.
 *
 *     This is a SEPARATE, smaller detector from the runtime CFE vocabulary classifier
 *     (`src/services/compliance/vocabulary.ts`'s `FORBIDDEN_TERMS_ALL`) — by design, matching this
 *     repo's existing guard-script convention (e.g. guard-no-opacity-on-text.mjs re-implements its
 *     own detection logic rather than importing app TypeScript; there is no ts-node/tsx in this
 *     project's devDependencies to execute a `.ts` module from a plain `node script.mjs` guard, and
 *     `tsc --noEmit` never emits JS this could import either). The runtime classifier's job is
 *     gating arbitrary REP-composed/AI-generated content — a large, adversarial surface that
 *     legitimately needs regex-level nuance (object-gating on "closing"/"cerrar", etc.). This
 *     guard's job is linting OUR OWN small, fully-controlled, human-reviewed product-copy catalog —
 *     a much smaller and lower-churn surface, so a simple case-insensitive substring match is
 *     proportionate and, per the header note on each list below, deliberately kept in sync BY HAND
 *     with the doctrine table's forbidden column. If the doctrine vocabulary ever changes, update
 *     both this file and vocabulary.ts's `FORBIDDEN_TERMS`/`FORBIDDEN_TERMS_ES`.
 *
 * (B) LAYOUT GROWTH-TOLERANCE (uiux §6.2 "Spanish runs ~25% longer — every component must survive
 *     +35% string growth without truncation (QC-checked on the tab bar, chips, buttons, and banners
 *     specifically)"). A static, repo-wide scan of every `*.module.css` + `globals.css` for the
 *     three concrete CSS shapes that WOULD truncate longer translated text: `text-overflow:
 *     ellipsis`, `-webkit-line-clamp`, and a fixed pixel `width:` (as opposed to `min-width`, which
 *     only sets a floor) on a selector that looks like a chip/button/banner/tab — the exact
 *     surfaces uiux §6.2 names. As of T-53, a manual audit of every primary-surface CSS module
 *     found ZERO instances of any of these three (chips/buttons already use `inline-flex`/auto
 *     width + `flex-wrap: wrap` rows, no `text-overflow` anywhere in the codebase, no
 *     `-webkit-line-clamp` anywhere) — this guard exists to KEEP it that way, not to fix a
 *     violation found at write time.
 *
 * Exits 0 on success, 1 with a descriptive report on any failure — wired into `postbuild`
 * (`npm run guard:i18n`) alongside this repo's other four guards.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');
const MESSAGES_DIR = path.join(SRC_ROOT, 'lib', 'i18n', 'messages');

// ─────────────────────────────────────────────────────────────────────────────
// (A) Copy-lint: doctrine forbidden-vocabulary substrings, EN + ES columns.
// Hand-kept in sync with src/services/compliance/vocabulary.ts's FORBIDDEN_TERMS /
// FORBIDDEN_TERMS_ES `forbidden` labels (the object-gated "selling"/"closing" /
// "vender"/"cerrar" rows are runtime-classifier-only — a catalog string would never legitimately
// contain those verbs in the extraction sense in the first place, so they are intentionally NOT
// duplicated here as bare substrings, which would false-positive on ordinary UI copy like "cerrar
// sesión" / "close" in an unrelated sense).
// ─────────────────────────────────────────────────────────────────────────────
const FORBIDDEN_SUBSTRINGS_EN = [
  'prospect',
  'lead',
  'sales pitch',
  'sales call',
  'funnel',
  'conversion',
  'follower',
  'target audience',
  'recruit',
  'cold outreach',
  'guaranteed income',
  'you will earn',
];

const FORBIDDEN_SUBSTRINGS_ES = [
  'prospecto',
  'cliente potencial',
  'presentación de ventas',
  'cita de ventas',
  'embudo',
  'conversión',
  'seguidores',
  'público objetivo',
  'reclut', // catches reclutar/reclutamiento/reclutas
  'contacto en frío',
  'ingreso garantizado',
  'ingresos garantizados',
  'vas a ganar',
  'ganarás',
];

function flattenCatalog(obj, prefix = '') {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out[full] = value;
    } else if (value && typeof value === 'object') {
      Object.assign(out, flattenCatalog(value, full));
    }
  }
  return out;
}

// T-R32b fix: "lead" is a bare substring of common, unrelated, entirely legitimate product-copy
// words — "Leader"/"Leadership"/"leading" (e.g. the real Primerica titles "Regional Leader",
// "Division Leader", "District Leader" the auth wizard must display verbatim) — none of which are
// the doctrine-forbidden noun "a lead"/"leads" this term exists to catch. The runtime CFE
// classifier (src/services/compliance/vocabulary.ts, FORBIDDEN_TERMS) already draws this exact
// distinction with a word-boundary regex — `{ term: /\bleads?\b/i, forbidden: 'lead', ... }` —
// this mirrors that EXACT pattern (not a re-derived one) for the ONE term that needs it, rather
// than switching every term to word-boundary matching, which would silently break the Spanish
// "reclut" entry's own documented INTENTIONAL prefix match (catches reclutar/reclutamiento/
// reclutas, none of which end at a word boundary right after "reclut").
//
// QC-reject regression (T-R32b, rejected 3.5): an earlier version of this map used a generic
// `new RegExp(\`\\b${term}\\b\`)` built FROM the bare term string, which produced `\blead\b` —
// that drops the plural "leads" (the most common banned form: "generate more leads", "sales leads
// list"), because there is no word boundary between "lead" and a trailing "s". Fixed by mapping
// each word-boundary term to its own EXPLICIT regex literal (copy-pasted from vocabulary.ts, not
// derived), so a plural form can never again be silently dropped, and so this file and
// vocabulary.ts can be diffed against each other by eye to catch future drift. If another term
// ever needs word-boundary matching, add it here as its own explicit `[term, /regex/i]` entry
// mirroring the exact CFE pattern for that term — do NOT reintroduce a generic `\b${term}\b`
// builder, since that reintroduces exactly this bug for any term with an irregular plural/suffix.
//
// T-R34: the SAME plain-substring gap existed here for three ES terms — "conversión" (Spanish
// drops its accent on pluralization: "conversiones" is not a substring-match of "conversión" at
// all, accented or not), "contacto en frío" (the plural "contactos en frío" inserts an "s" BEFORE
// the following word boundary, breaking the substring), and "presentación de ventas" (misses both
// "presentaciones de ventas" — same accent-drop — and "discurso(s) de ventas" entirely, which this
// catalog-lint never listed as its own substring even singular). Fixed the same way as "lead":
// explicit regex literals copy-pasted from the now-fixed src/services/compliance/vocabulary.ts
// FORBIDDEN_TERMS_ES rows, keyed by the FORBIDDEN_SUBSTRINGS_ES entry text so lookup is unchanged.
// ("embudo" needed no entry here — "embudo" is already a literal PREFIX of "embudos", so the plain
// `.includes()` substring check already catches the plural; only terms where pluralizing changes a
// non-trailing character, or inserts a character before word's end, need a regex override.)
const WORD_BOUNDARY_TERMS = new Map([
  // Mirrors src/services/compliance/vocabulary.ts FORBIDDEN_TERMS's `/\bleads?\b/i` exactly.
  ['lead', /\bleads?\b/i],
  // Mirrors vocabulary.ts FORBIDDEN_TERMS_ES's (T-R34-fixed) `/\bconversi[oó]n(?:es)?\b/i` exactly.
  ['conversión', /\bconversi[oó]n(?:es)?\b/i],
  // Mirrors vocabulary.ts FORBIDDEN_TERMS_ES's (T-R34-fixed) `/\bcontactos?\s+en\s+fr[ií]o\b/i`.
  ['contacto en frío', /\bcontactos?\s+en\s+fr[ií]o\b/i],
  // Mirrors vocabulary.ts FORBIDDEN_TERMS_ES's (T-R34-fixed) presentación/discurso-de-ventas rule.
  ['presentación de ventas', /\b(?:discursos?|presentaci[oó]n(?:es)?)\s+de\s+ventas?\b/i],
]);

function termMatches(lowerValue, lowerTerm) {
  const boundaryRegex = WORD_BOUNDARY_TERMS.get(lowerTerm);
  if (boundaryRegex) {
    return boundaryRegex.test(lowerValue);
  }
  return lowerValue.includes(lowerTerm);
}

function lintCatalog(flat, forbiddenSubstrings, label) {
  const violations = [];
  for (const [key, value] of Object.entries(flat)) {
    const lower = value.toLowerCase();
    for (const term of forbiddenSubstrings) {
      if (termMatches(lower, term.toLowerCase())) {
        violations.push({ key, value, term, label });
      }
    }
  }
  return violations;
}

function runCopyLint() {
  const enPath = path.join(MESSAGES_DIR, 'en.json');
  const esPath = path.join(MESSAGES_DIR, 'es.json');
  if (!existsSync(enPath) || !existsSync(esPath)) {
    console.error(`guard:i18n — expected catalog files not found at ${enPath} / ${esPath}.`);
    process.exit(1);
  }
  const en = JSON.parse(readFileSync(enPath, 'utf8'));
  const es = JSON.parse(readFileSync(esPath, 'utf8'));
  const flatEn = flattenCatalog(en);
  const flatEs = flattenCatalog(es);

  const violations = [
    ...lintCatalog(flatEn, FORBIDDEN_SUBSTRINGS_EN, 'en.json'),
    ...lintCatalog(flatEs, FORBIDDEN_SUBSTRINGS_ES, 'es.json'),
  ];

  console.log(
    `(A) Copy-lint: scanned ${Object.keys(flatEn).length} EN key(s) + ${Object.keys(flatEs).length} ES key(s).`
  );
  return violations;
}

// ─────────────────────────────────────────────────────────────────────────────
// (B) Layout growth-tolerance: CSS anti-pattern scan.
// ─────────────────────────────────────────────────────────────────────────────
function findCssFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      out.push(...findCssFiles(full));
    } else if (entry.endsWith('.module.css') || entry === 'globals.css') {
      out.push(full);
    }
  }
  return out;
}

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** @returns {Array<{selector: string, body: string}>} top-level-ish rule blocks (brace-depth aware
 *  so a nested `@media { .x { ... } }` still yields `.x` as its own block, matching this repo's
 *  other CSS guards' approach). */
function parseCssBlocks(css) {
  const blocks = [];
  const n = css.length;
  function skipToBlockEnd(start) {
    let depth = 1;
    let j = start;
    while (j < n && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    return j;
  }
  function walk(text) {
    let k = 0;
    while (k < text.length) {
      const brace = text.indexOf('{', k);
      if (brace === -1) break;
      const selector = text.slice(k, brace).trim();
      const end = skipToBlockEnd(brace + 1);
      const body = text.slice(brace + 1, end - 1);
      if (selector.startsWith('@media') || selector.startsWith('@supports')) {
        walk(body);
      } else if (selector.length > 0 && !selector.startsWith('@')) {
        blocks.push({ selector, body });
      }
      k = end;
    }
  }
  walk(css);
  return blocks;
}

/** Heuristic: does this selector look like one of the surfaces uiux §6.2 explicitly names
 *  ("the tab bar, chips, buttons, and banners specifically")? Deliberately broad (case-insensitive
 *  substring on the class-name text) — a false positive here just means an unrelated rule gets the
 *  (harmless) fixed-width check too; a false negative would silently exempt a real growth risk. */
const GROWTH_SENSITIVE_SELECTOR_RE = /chip|button|btn|banner|tab/i;

function findGrowthViolations(cssFiles) {
  const violations = [];
  for (const file of cssFiles) {
    const relPath = path.relative(REPO_ROOT, file);
    const css = stripCssComments(readFileSync(file, 'utf8'));

    if (/text-overflow\s*:\s*ellipsis/i.test(css)) {
      violations.push({ relPath, kind: 'text-overflow: ellipsis', detail: 'truncates text — never safe for translated UI copy' });
    }
    if (/-webkit-line-clamp/i.test(css)) {
      violations.push({ relPath, kind: '-webkit-line-clamp', detail: 'clips text after N lines — never safe for translated UI copy' });
    }

    for (const { selector, body } of parseCssBlocks(css)) {
      if (!GROWTH_SENSITIVE_SELECTOR_RE.test(selector)) continue;
      for (const raw of body.split(';')) {
        const decl = raw.trim();
        const m = /^width\s*:\s*(\d+(?:\.\d+)?)px$/i.exec(decl);
        if (m) {
          violations.push({
            relPath,
            kind: `fixed width: ${m[1]}px`,
            detail: `on growth-sensitive selector "${selector}" — use min-width or a flexible/auto width instead, so longer (e.g. Spanish) text can grow the element rather than being clipped`,
          });
        }
      }
    }
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────────────────────
// Run both checks.
// ─────────────────────────────────────────────────────────────────────────────
function main() {
  console.log('guard:i18n — T-53 (master-spec §17.5 / uiux §6.2) copy-lint (EN+ES) + layout growth-tolerance.\n');

  const copyLintViolations = runCopyLint();

  const cssFiles = findCssFiles(SRC_ROOT);
  const growthViolations = findGrowthViolations(cssFiles);
  console.log(`(B) Growth-tolerance: scanned ${cssFiles.length} CSS file(s) under src/.`);

  let failures = 0;

  if (copyLintViolations.length > 0) {
    console.error(`\n(A) Copy-lint FAILED — ${copyLintViolations.length} forbidden term(s) found in the product catalog:`);
    for (const v of copyLintViolations) {
      console.error(`  - [${v.label}] "${v.key}" contains doctrine-forbidden term "${v.term}": "${v.value}"`);
    }
    failures += copyLintViolations.length;
  }

  if (growthViolations.length > 0) {
    console.error(`\n(B) Growth-tolerance FAILED — ${growthViolations.length} truncation-risk pattern(s) found:`);
    for (const v of growthViolations) {
      console.error(`  - ${v.relPath}: ${v.kind} — ${v.detail}`);
    }
    failures += growthViolations.length;
  }

  if (failures > 0) {
    console.error(`\nguard:i18n: ${failures} violation(s) found.`);
    process.exit(1);
  }

  console.log('\nguard:i18n: catalog is vocab-doctrine-clean in both languages; no layout growth-truncation risk found. OK.');
  process.exit(0);
}

main();
