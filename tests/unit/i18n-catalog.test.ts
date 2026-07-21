// T-53 — i18n message catalog (master-spec §17.5; uiux §6.2). Proves the `t()` lookup helper
// resolves real EN/ES catalog keys, interpolates variables, falls back EN when a key is missing in
// a non-default locale, and never crashes (renders the bare key) when a key is missing everywhere.
import { t, tFrom, CATALOGS, flattenCatalog, type CatalogTree } from '@/lib/i18n/catalog';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, isLocale, detectLocaleFromAcceptLanguage, resolveLocale } from '@/lib/i18n/locale';

describe('i18n locale primitives', () => {
  test('exactly EN + ES are supported, EN is the default', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'es']);
    expect(DEFAULT_LOCALE).toBe('en');
  });

  test('isLocale narrows correctly', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('es')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  describe('detectLocaleFromAcceptLanguage', () => {
    test('a bare "es" header detects Spanish', () => {
      expect(detectLocaleFromAcceptLanguage('es')).toBe('es');
    });

    test('"es-MX,es;q=0.9,en;q=0.8" detects Spanish (highest-priority supported tag)', () => {
      expect(detectLocaleFromAcceptLanguage('es-MX,es;q=0.9,en;q=0.8')).toBe('es');
    });

    test('"en-US,en;q=0.9" detects English', () => {
      expect(detectLocaleFromAcceptLanguage('en-US,en;q=0.9')).toBe('en');
    });

    test('an unsupported-only header (e.g. French) defaults sensibly to EN', () => {
      expect(detectLocaleFromAcceptLanguage('fr-FR,fr;q=0.9')).toBe('en');
    });

    test('null/undefined/empty header defaults to EN, never throws', () => {
      expect(detectLocaleFromAcceptLanguage(null)).toBe('en');
      expect(detectLocaleFromAcceptLanguage(undefined)).toBe('en');
      expect(detectLocaleFromAcceptLanguage('')).toBe('en');
    });

    test('a malformed header never throws — falls through to the default', () => {
      expect(() => detectLocaleFromAcceptLanguage(',,,;q=;garbage')).not.toThrow();
      expect(detectLocaleFromAcceptLanguage(',,,;q=;garbage')).toBe('en');
    });

    test('a higher q-value for a lower-priority-listed locale still wins (real q-value ranking, not list order)', () => {
      // "es" is listed FIRST but has the LOWER q — "en" (listed second, q=0.9) should win.
      expect(detectLocaleFromAcceptLanguage('es;q=0.3,en;q=0.9')).toBe('en');
    });
  });

  describe('resolveLocale — priority order', () => {
    test('an explicit user DB preference wins over everything else', () => {
      expect(resolveLocale({ userPreference: 'es', clientOverride: 'en', detected: 'en' })).toBe('es');
    });

    test('a client override wins over detection when no user preference exists', () => {
      expect(resolveLocale({ userPreference: null, clientOverride: 'es', detected: 'en' })).toBe('es');
    });

    test('detection wins when neither a user preference nor a client override exists', () => {
      expect(resolveLocale({ detected: 'es' })).toBe('es');
    });

    test('falls back to DEFAULT_LOCALE when nothing resolves — never throws, never undefined', () => {
      expect(resolveLocale({})).toBe('en');
      expect(resolveLocale({ userPreference: 'fr', clientOverride: 'xx', detected: 'garbage' })).toBe('en');
    });
  });
});

describe('t() — catalog lookup', () => {
  // The missing-key paths below deliberately trigger `tFrom`'s own dev-mode `console.warn` (by
  // design — a loud signal a real translator/reviewer should see locally). Silenced here so this
  // test's OWN expected-and-desired warnings don't clutter the suite's output; restored after.
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('resolves a real EN key', () => {
    expect(t('en', 'today.primaryCta')).toBe("Start today's 30 minutes");
  });

  test('resolves the SAME key in Spanish to a REAL, different translation (not a byte-identical passthrough)', () => {
    const en = t('en', 'today.primaryCta');
    const es = t('es', 'today.primaryCta');
    expect(es).not.toBe(en);
    expect(es.length).toBeGreaterThan(0);
    expect(es).toBe('Comienza tus 30 minutos de hoy');
  });

  test('interpolates a variable', () => {
    expect(t('en', 'today.greeting', { name: 'Maria' })).toBe('Good morning, Maria');
    expect(t('es', 'today.greeting', { name: 'Maria' })).toBe('Buenos días, Maria');
  });

  test('interpolates multiple variables, including a repeated-token count/plural pair', () => {
    expect(t('en', 'inbox.syncingBanner', { count: 3, plural: 's' })).toBe('Back online — syncing 3 items…');
    expect(t('en', 'inbox.syncingBanner', { count: 1, plural: '' })).toBe('Back online — syncing 1 item…');
  });

  test('an unmatched {token} with no corresponding var is left verbatim (never throws)', () => {
    expect(t('en', 'today.greeting')).toBe('Good morning, {name}');
  });

  test('a nested (multi-level) key resolves correctly in both locales', () => {
    expect(t('en', 'learn.referralScripts.title')).toBe('Ask for an introduction');
    expect(t('es', 'learn.referralScripts.title')).toBe('Pide una presentación');
  });

  test('a key missing in ES falls back to the EN value, never blank/undefined (§17.7)', () => {
    // Uses `tFrom` against a small, disposable, test-local catalog pair — NOT the real shared
    // `CATALOGS` singleton (mutating that would leak into every other test in the process).
    const catalogs: Record<'en' | 'es', CatalogTree> = {
      en: { greeting: 'Hello, {name}' },
      es: {}, // deliberately missing the key entirely
    };
    expect(tFrom(catalogs, 'es', 'greeting', { name: 'Ana' })).toBe('Hello, Ana');
  });

  test('a key present in neither locale returns the bare key, never throws', () => {
    const catalogs: Record<'en' | 'es', CatalogTree> = { en: {}, es: {} };
    expect(tFrom(catalogs, 'es', 'nowhere.at.all')).toBe('nowhere.at.all');
    expect(tFrom(catalogs, 'en', 'nowhere.at.all')).toBe('nowhere.at.all');
  });

  test('a key missing in EVERY locale returns the bare key (visibly wrong, never blank/undefined)', () => {
    expect(t('en', 'this.key.does.not.exist')).toBe('this.key.does.not.exist');
    expect(t('es', 'this.key.does.not.exist')).toBe('this.key.does.not.exist');
  });
});

describe('flattenCatalog', () => {
  test('flattens a nested tree to dotted keys', () => {
    const flat = flattenCatalog({ a: { b: 'c', d: { e: 'f' } }, g: 'h' });
    expect(flat).toEqual({ 'a.b': 'c', 'a.d.e': 'f', g: 'h' });
  });

  test('every EN catalog key has a corresponding ES key, and vice versa (structural parity)', () => {
    const en = flattenCatalog(CATALOGS.en);
    const es = flattenCatalog(CATALOGS.es);
    const enKeys = new Set(Object.keys(en));
    const esKeys = new Set(Object.keys(es));
    const missingInEs = [...enKeys].filter((k) => !esKeys.has(k));
    const missingInEn = [...esKeys].filter((k) => !enKeys.has(k));
    expect(missingInEs).toEqual([]);
    expect(missingInEn).toEqual([]);
    expect(enKeys.size).toBeGreaterThan(50); // sanity: this is a real, populated catalog, not a stub
  });
});
