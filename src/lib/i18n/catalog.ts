/**
 * T-53 — the i18n message catalog + `t()` lookup (master-spec §17.5, uiux §6.2).
 *
 * "String catalog: every user-facing string externalized from day one (no literals in
 * components — a lint rule); keys namespaced per surface (`today.briefing.title`)". This module is
 * that catalog's runtime half: `en.json`/`es.json` ARE the catalog; this file is the typed,
 * fallback-safe accessor every component calls through (`useT()` in `src/app/locale-context.tsx`
 * wraps this for client components; server-only code can call `t()` directly).
 */
import en from './messages/en.json';
import es from './messages/es.json';
import { DEFAULT_LOCALE, type Locale } from './locale';

/** A catalog is an arbitrarily-nested string dictionary — `{ "a": { "b": "c" } }` — addressed by
 *  dotted path (`"a.b"`), matching the uiux §6.2 namespacing convention. */
export type CatalogTree = { [key: string]: string | CatalogTree };

export const CATALOGS: Record<Locale, CatalogTree> = { en, es };

/** Interpolation variables — `t()` replaces every `{name}` token with `String(vars.name)`. */
export type TVars = Record<string, string | number>;

function getPath(tree: CatalogTree, key: string): string | undefined {
  const parts = key.split('.');
  let node: string | CatalogTree | undefined = tree;
  for (const part of parts) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function interpolate(template: string, vars?: TVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

/**
 * Looks up `key` (dotted path, e.g. `"today.primaryCta"`) in `locale`'s catalog, from an arbitrary
 * `catalogs` map. This is the pure, unit-testable core `t()` (below) wraps around the real,
 * shipped `CATALOGS` singleton — kept as a separate export so `tests/unit/i18n-catalog.test.ts` can
 * exercise the fallback/missing-key paths against a small, disposable, test-local catalog rather
 * than mutating the real shared `CATALOGS` module singleton (which every other consumer/test in the
 * process also reads).
 *
 * Fallback order (never renders blank/undefined — §17.7): (1) the requested locale, (2)
 * `DEFAULT_LOCALE` (English) if the key is missing there, (3) the bare key itself as an absolute
 * last resort (a visibly-wrong-but-non-blank string, so a missing-key bug is obvious in the UI
 * rather than invisible). A missing key in a non-default locale is a real gap the catalog build
 * SHOULD eventually be linted for (mirrors the copy-lint's own "the catalog build fails on any
 * forbidden term" — see `scripts/guard-i18n.mjs`), but a lookup miss must never crash a render.
 */
export function tFrom(catalogs: Record<Locale, CatalogTree>, locale: Locale, key: string, vars?: TVars): string {
  const direct = getPath(catalogs[locale], key);
  if (direct !== undefined) return interpolate(direct, vars);

  if (locale !== DEFAULT_LOCALE) {
    const fallback = getPath(catalogs[DEFAULT_LOCALE], key);
    if (fallback !== undefined) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn(`[i18n] missing "${key}" in locale "${locale}" — falling back to "${DEFAULT_LOCALE}".`);
      }
      return interpolate(fallback, vars);
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn(`[i18n] missing catalog key "${key}" in every locale.`);
  }
  return key;
}

/** The real lookup every component calls through — `tFrom` bound to the actual shipped catalogs. */
export function t(locale: Locale, key: string, vars?: TVars): string {
  return tFrom(CATALOGS, locale, key, vars);
}

/** Flattens a nested catalog to `{ "a.b.c": "value" }` — used by the growth-tolerance check
 *  (`./growth.ts`) and the copy-lint guard, both of which need every leaf string with its full key. */
export function flattenCatalog(tree: CatalogTree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out[full] = value;
    } else {
      Object.assign(out, flattenCatalog(value, full));
    }
  }
  return out;
}
