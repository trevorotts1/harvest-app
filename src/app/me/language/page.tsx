'use client';

// T-53 (master-spec §17.5 / uiux §6.2 i18n) — Me -> Language. Mounted at /me/language, which the
// existing middleware's `/me/:path*` matcher already auth-gates AND onboarding-gates (same
// convention as /me/subscription and /me/data-rights). No `/me` index page exists yet (see
// ../data-rights/page.tsx's own header note), so this follows that same precedent: reached via an
// ad-hoc header link (src/app/today/components/AnchorHeader.tsx), not a Me index.
//
// This page is a thin UI over `useLocale()` (src/app/locale-context.tsx): choosing a language
// applies it immediately (this page's own text switches too — SETTING the language IS using it)
// and persists it to `User.locale` via `/api/settings/locale`. uiux §6.2: "the rep's language
// setting lives in Me -> Language and is independent of outreach language (a rep may work in
// English and introduce in Spanish — the composer's language toggle per draft, CFE-gated per
// language)" — this page is ONLY the workspace-language preference; it has no opinion on what
// language any individual outreach draft is written in.

import { useState } from 'react';

import { useLocale } from '@/app/locale-context';
import { StatusMessage } from '@/components/StatusMessage';
import { LOCALE_LABEL, SUPPORTED_LOCALES, type Locale } from '@/lib/i18n/locale';
import styles from './language.module.css';

export default function LanguagePage() {
  const { locale, setLocale, t } = useLocale();
  const [notice, setNotice] = useState<'saved' | 'failed' | null>(null);

  async function choose(next: Locale) {
    setNotice(null);
    setLocale(next); // applies immediately (local + best-effort server persist)
    try {
      const res = await fetch('/api/settings/locale', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: next }),
      });
      setNotice(res.ok ? 'saved' : 'failed');
    } catch {
      setNotice('failed');
    }
  }

  return (
    <main className={styles.page}>
      <header>
        <h1 className={styles.heading}>{t('settings.language.heading')}</h1>
        <p className={styles.subhead}>{t('settings.language.subhead')}</p>
      </header>

      <section className={styles.stateCard} aria-label={t('settings.language.heading')}>
        <div className={styles.optionRow} role="radiogroup" aria-label={t('settings.language.heading')}>
          {SUPPORTED_LOCALES.map((code) => (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={locale === code}
              className={`${styles.optionBtn} ${locale === code ? styles.optionBtnActive : ''}`}
              onClick={() => void choose(code)}
            >
              {LOCALE_LABEL[code]}
            </button>
          ))}
        </div>
        {/* T-57 RG9 (SC 4.1.3) — the SUCCESS notice is now announced too (was a bare <p>, silent to
            AT while its failure sibling announced): a polite (role="status") live region, so a
            screen-reader rep hears "saved" without the assertive interruption a hard failure uses. */}
        {notice === 'saved' && (
          <StatusMessage tone="polite" className={styles.notice}>{t('settings.language.saved')}</StatusMessage>
        )}
        {/* T-57 RG7 (SC 4.1.3) — save-failure announced via StatusMessage (role=alert). */}
        {notice === 'failed' && <StatusMessage className={styles.notice}>{t('settings.language.saveFailed')}</StatusMessage>}
      </section>
    </main>
  );
}
