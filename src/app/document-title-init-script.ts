/**
 * T-57 RE-GATE B [af7789d3] Finding 3 — inline, pre-hydration script that corrects `<title>`/the
 * description `<meta>` to Spanish for an es-resolved rep, exactly the same rationale/pattern as
 * `./theme-init-script.ts` / `./locale-init-script.ts` (no lingering English tab title for a
 * returning rep who already chose Español, and no wait for React to mount before it corrects).
 *
 * WHY THIS EXISTS: `export const metadata` in `layout.tsx` is static (Next.js renders it at
 * build/request time, before any client-side locale resolution runs) — it can only ever hold ONE
 * language. Converting it to an async `generateMetadata()` that reads the rep's session-persisted
 * `User.locale` would only cover SIGNED-IN reps with a saved server preference; it does nothing for
 * the pre-auth/first-load case this app already handles client-side for everything else (theme,
 * `<html lang>`, Big Text) — browser-language detection. Mirroring THAT existing convention (a tiny
 * `beforeInteractive` script reading the same `harvest-locale` storage key / `navigator.languages`
 * detection `./locale-context.tsx`'s `readStoredLocale`/`detectBrowserLocale` use) covers both cases
 * with one small, self-contained fix, consistent with how this app already treats every OTHER
 * pre-paint, locale-dependent correction — rather than leaving this as an undocumented gap.
 *
 * Must stay in sync with:
 *   - the storage key/value contract `./locale-context.tsx` (`LOCALE_STORAGE_KEY`, 'en' | 'es') uses.
 *   - the EN copy in `./layout.tsx`'s `metadata` export (title/description) — this script's ES
 *     strings are a literal, hand-kept translation of that EN copy (an inline `beforeInteractive`
 *     script cannot import the `en.json`/`es.json` catalog module system).
 */
export const DOCUMENT_TITLE_INIT_SCRIPT = `
(function () {
  try {
    var stored = window.localStorage.getItem('harvest-locale');
    var locale = (stored === 'en' || stored === 'es') ? stored : null;
    if (!locale) {
      var langs = (navigator.languages && navigator.languages.length > 0) ? navigator.languages : [navigator.language];
      for (var i = 0; i < langs.length; i++) {
        var primary = (langs[i] || '').split('-')[0].toLowerCase();
        if (primary === 'es') { locale = 'es'; break; }
        if (primary === 'en') { locale = 'en'; break; }
      }
    }
    if (locale === 'es') {
      document.title = 'La Cosecha | CEO de 2 Horas';
      var meta = document.querySelector('meta[name="description"]');
      if (meta) {
        meta.setAttribute(
          'content',
          'Un centro de mando tranquilo para construir un negocio de mercado cálido con enfoque, cumplimiento e impulso.'
        );
      }
    }
  } catch (e) {
    /* localStorage/navigator unavailable (privacy mode, etc.) — the English <title>/description
       already rendered from layout.tsx's metadata stand, exactly like the theme/locale scripts'
       own fallback behavior. */
  }
})();
`;
