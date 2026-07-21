// T-57 R4 (i18n residual sweep) — proves the four non-scanner defects this build unit fixed:
//   B3 — bare toLocale*() date rendering now routes through src/lib/i18n/format.ts + the rep's
//        locale (genuinely renders differently EN vs ES, not a silent no-op).
//   B4 — the bare-English `plural: count === 1 ? '' : 's'` call-site pattern is gone; the t()
//        layer now selects a real, independently-authored ES plural form. "acción{plural}" used to
//        produce "accións" for 2+ — this proves the real fix renders "acciones".
//   B6 — the error/toast strings that used to be hardcoded English `setError('...')` literals are
//        now real, distinct EN/ES catalog entries.
//   B5 (spot-check) — one of the newly-i18n'd ternary/component fixes genuinely renders in Spanish.
//
// (The extended-scanner-catches-the-3-shapes proof lives in
// tests/unit/guard-no-literals-in-components-script.test.ts, alongside the rest of that script's
// own test suite — kept there rather than duplicated here.)

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { t, tFrom, pluralCategory, type CatalogTree } from '@/lib/i18n/catalog';
import { LocaleContext } from '@/app/locale-context';
import CalendarStrip from '@/app/today/components/CalendarStrip';
import BriefingCard from '@/app/today/components/BriefingCard';
import PendingBridgeItem from '@/app/team/bridges/components/PendingBridgeItem';
import type { CalendarZoneData, BriefingZoneData, ZoneResult } from '@/services/mission-control/types';

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

const esProviderValue = { locale: 'es' as const, setLocale: () => {}, t: (key: string, vars?: Record<string, string | number>) => t('es', key, vars) };
const renderEs = (el: React.ReactElement) =>
  renderToStaticMarkup(createElement(LocaleContext.Provider, { value: esProviderValue }, el));
const renderEn = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('B4 — locale/word-aware pluralization in the t() layer (not a bare English "+s")', () => {
  test('pluralCategory: CLDR one/other for both supported locales', () => {
    expect(pluralCategory('en', 1)).toBe('one');
    expect(pluralCategory('en', 0)).toBe('other');
    expect(pluralCategory('en', 2)).toBe('other');
    expect(pluralCategory('es', 1)).toBe('one');
    expect(pluralCategory('es', 2)).toBe('other');
  });

  test('a count-keyed t() call resolves to the _one/_other variant, not the bare key', () => {
    const tree: CatalogTree = {
      widgets_one: '{count} widget',
      widgets_other: '{count} widgets',
    };
    expect(tFrom({ en: tree, es: tree }, 'en', 'widgets', { count: 1 })).toBe('1 widget');
    expect(tFrom({ en: tree, es: tree }, 'en', 'widgets', { count: 5 })).toBe('5 widgets');
  });

  test('a t() call with a count var but NO _one/_other variant falls back to the plain key unchanged (back-compat)', () => {
    const tree: CatalogTree = { plain: 'no plural variants here, count={count}' };
    expect(tFrom({ en: tree, es: tree }, 'en', 'plain', { count: 3 })).toBe('no plural variants here, count=3');
  });

  test('TEETH: ES "acción{plural}" used to mechanically append the bare-English "s" and produce "accións" — the real fix renders "acciones" for 2+', () => {
    const two = t('es', 'today.offlineBannerQueuedSuffix', { count: 2 });
    expect(two).toContain('acciones');
    expect(two).not.toContain('accións');
    expect(two).not.toContain('{plural}');
  });

  test('the same fix holds for the singular (count===1) case — "una acción", not "acciones"', () => {
    const one = t('es', 'today.offlineBannerQueuedSuffix', { count: 1 });
    expect(one).toContain('acción');
    expect(one).not.toContain('acciones');
  });

  test('the identical offlineBannerQueuedSuffix/syncingBanner namespaces in inbox.* and ritual.warmMarketRitual.* are ALL fixed, not just today.*', () => {
    expect(t('es', 'inbox.offlineBannerQueuedSuffix', { count: 2 })).toContain('acciones');
    expect(t('es', 'ritual.warmMarketRitual.offlineBannerQueuedSuffix', { count: 2 })).toContain('elementos');
    expect(t('es', 'inbox.syncingBanner', { count: 2 })).toContain('elementos');
    expect(t('es', 'ritual.warmMarketRitual.syncingBanner', { count: 1 })).toMatch(/elemento(?!s)/);
  });

  test('grow.orchardCanvas summary members/ghosts are real ES plurals with adjective agreement, not the old "(s)" parenthetical hack', () => {
    expect(t('es', 'grow.orchardCanvas.summaryMembers', { count: 1 })).toBe('1 miembro real');
    expect(t('es', 'grow.orchardCanvas.summaryMembers', { count: 3 })).toBe('3 miembros reales');
    expect(t('es', 'grow.orchardCanvas.summaryGhosts', { count: 1 })).not.toMatch(/\(s\)/);
    expect(t('es', 'grow.orchardCanvas.summaryGhosts', { count: 3 })).not.toMatch(/\(s\)/);
  });

  test('learn.streakBadge renders a real EN/ES singular vs plural distinction', () => {
    expect(t('en', 'learn.streakBadge', { count: 1 })).toBe('Streak — 1 day');
    expect(t('en', 'learn.streakBadge', { count: 5 })).toBe('Streak — 5 days');
    expect(t('es', 'learn.streakBadge', { count: 1 })).toBe('Racha — 1 día');
    expect(t('es', 'learn.streakBadge', { count: 5 })).toBe('Racha — 5 días');
  });
});

describe('B3 — dates route through src/lib/i18n/format.ts + the rep\'s locale (not a bare, browser-locale toLocale*())', () => {
  test('CalendarStrip.tsx:59 — a calendar event start time renders differently EN vs ES', () => {
    const result: ZoneResult<CalendarZoneData> = {
      status: 'ok',
      data: {
        hasOrg: true,
        events: [{ id: 'evt1', type: 'team_call', startsAt: '2026-07-15T18:30:00Z', attendanceState: 'none' }],
      },
    };
    const en = textOf(renderEn(createElement(CalendarStrip, { result, onMarkAttendance: () => {} })));
    const es = textOf(renderEs(createElement(CalendarStrip, { result, onMarkAttendance: () => {} })));
    expect(en).toMatch(/AM|PM/);
    expect(es.toLowerCase()).toMatch(/a\.m\.|p\.m\./);
    expect(en).not.toBe(es);
  });

  test('BriefingCard.tsx freshness stamp — genuinely locale-aware, no longer a hardcoded "as of" + bare toLocaleTimeString', () => {
    const result: ZoneResult<BriefingZoneData> = {
      status: 'ok',
      data: { state: 'empty', freshnessStamp: '2026-07-15T18:30:00Z', lines: [] },
    };
    const en = textOf(renderEn(createElement(BriefingCard, { result })));
    const es = textOf(renderEs(createElement(BriefingCard, { result })));
    expect(en).toContain('as of');
    expect(es).toContain('a las');
    expect(en).not.toContain('a las');
  });

  test('PendingBridgeItem.tsx:65-66 — the invited-at / return-deadline timestamps render differently EN vs ES', () => {
    const item = {
      id: 'bridge1',
      repName: 'Alex Rivera',
      triggerReason: 'MANUAL',
      invitedAt: '2026-07-15T18:30:00Z',
      returnDeadlineAt: '2026-07-16T18:30:00Z',
    };
    const onJoin = async () => ({ ok: true });
    const en = textOf(renderEn(createElement(PendingBridgeItem, { item, onJoin })));
    const es = textOf(renderEs(createElement(PendingBridgeItem, { item, onJoin })));
    expect(en).toMatch(/AM|PM/);
    expect(es.toLowerCase()).toMatch(/a\.m\.|p\.m\./);
    expect(en).not.toBe(es);
  });
});

describe('B6 — error/toast strings moved to the catalog (real, distinct EN/ES — no longer bare setError(\'English literal\'))', () => {
  test('auth.invalidCredentials', () => {
    expect(t('en', 'auth.invalidCredentials')).toBe('Invalid email or password.');
    expect(t('es', 'auth.invalidCredentials')).not.toBe(t('en', 'auth.invalidCredentials'));
    expect(t('es', 'auth.invalidCredentials').length).toBeGreaterThan(0);
  });

  test('team.complianceReview.adjudicateFailedGeneric / networkErrorGeneric', () => {
    expect(t('en', 'team.complianceReview.adjudicateFailedGeneric')).toBe('This item could not be adjudicated.');
    expect(t('es', 'team.complianceReview.adjudicateFailedGeneric')).not.toBe(t('en', 'team.complianceReview.adjudicateFailedGeneric'));
    expect(t('en', 'team.complianceReview.networkErrorGeneric')).toBe('Network error — try again.');
    expect(t('es', 'team.complianceReview.networkErrorGeneric')).not.toBe(t('en', 'team.complianceReview.networkErrorGeneric'));
  });

  test('onboarding.gdprConsent.failedGeneric / onboarding.contactImport.denied.importFailedGeneric', () => {
    expect(t('en', 'onboarding.gdprConsent.failedGeneric')).toBe('Could not record your consent — please try again.');
    expect(t('es', 'onboarding.gdprConsent.failedGeneric')).not.toBe(t('en', 'onboarding.gdprConsent.failedGeneric'));
    expect(t('en', 'onboarding.contactImport.denied.importFailedGeneric')).toBe('Could not import that file — please try again.');
    expect(t('es', 'onboarding.contactImport.denied.importFailedGeneric')).not.toBe(
      t('en', 'onboarding.contactImport.denied.importFailedGeneric')
    );
  });

  test('all 5 WarmMarketRitual error keys are real, distinct EN/ES entries', () => {
    for (const key of [
      'ritual.warmMarketRitual.loadFailedError',
      'ritual.warmMarketRitual.saveLayer1FailedError',
      'ritual.warmMarketRitual.saveLayer2FailedError',
      'ritual.warmMarketRitual.saveLayer3FailedError',
      'ritual.warmMarketRitual.acknowledgeFailedError',
    ]) {
      const en = t('en', key);
      const es = t('es', key);
      expect(en.length).toBeGreaterThan(0);
      expect(es.length).toBeGreaterThan(0);
      expect(es).not.toBe(en);
    }
  });

  test('the source files no longer contain the bare hardcoded English error literals (source-level regression guard)', () => {
    // A cheap, resilient guard against silent regression back to the hardcoded-literal pattern —
    // mirrors this repo's own convention (e.g. briefing-tts.test.ts's source-text assertions).
    const fs = require('node:fs');
    const path = require('node:path');
    const REPO_ROOT = path.join(__dirname, '..', '..');
    const authSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/app/auth/page.tsx'), 'utf8');
    expect(authSrc).not.toContain("setLoginError('Invalid email or password.')");
    const ritualSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/app/ritual/warm-market/WarmMarketRitual.tsx'), 'utf8');
    expect(ritualSrc).not.toMatch(/setError\('We could not/);
  });
});

describe('B5 spot-check — a real ES render of one of the newly-i18n\'d ternary/component fixes', () => {
  test('auth/page.tsx-equivalent catalog keys (register/login heading + sign-in CTA ternaries) are real, distinct ES prose', () => {
    expect(t('en', 'auth.registerHeading')).toBe('Create your demo profile');
    expect(t('es', 'auth.registerHeading')).not.toBe(t('en', 'auth.registerHeading'));
    expect(t('en', 'auth.loginHeading')).toBe('Welcome back');
    expect(t('es', 'auth.loginHeading')).not.toBe(t('en', 'auth.loginHeading'));
    expect(t('en', 'auth.signingInCta')).toBe('Signing in…');
    expect(t('es', 'auth.signingInCta')).not.toBe(t('en', 'auth.signingInCta'));
  });

  test('team.complianceReview ternary CTAs (Working…/Approve for send) are real, distinct ES prose', () => {
    expect(t('en', 'team.complianceReview.workingCta')).toBe('Working…');
    expect(t('es', 'team.complianceReview.workingCta')).not.toBe(t('en', 'team.complianceReview.workingCta'));
    expect(t('en', 'team.complianceReview.approveForSendCta')).toBe('Approve for send');
    expect(t('es', 'team.complianceReview.approveForSendCta')).not.toBe(t('en', 'team.complianceReview.approveForSendCta'));
  });

  test('BriefingCard Stop/Listen ternary is now catalog-driven with real ES text', () => {
    expect(t('en', 'today.briefingCard.stopCta')).toBe('Stop');
    expect(t('es', 'today.briefingCard.stopCta')).toBe('Detener');
    expect(t('en', 'today.briefingCard.listenCta')).toBe('Listen');
    expect(t('es', 'today.briefingCard.listenCta')).toBe('Escuchar');
  });

  test('BlankCanvasLayer dot-title / entered-suffix ternaries are real, distinct EN/ES entries', () => {
    expect(t('en', 'ritual.blankCanvas.dotTitleOpen')).toBe('Open position');
    expect(t('es', 'ritual.blankCanvas.dotTitleOpen')).not.toBe(t('en', 'ritual.blankCanvas.dotTitleOpen'));
    expect(t('en', 'ritual.blankCanvas.enteredUnmatchedSuffix')).toBe(' (add?)');
    expect(t('es', 'ritual.blankCanvas.enteredUnmatchedSuffix')).not.toBe(t('en', 'ritual.blankCanvas.enteredUnmatchedSuffix'));
  });
});
