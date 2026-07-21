// T-57 R4-residual2 (dimension-B i18n re-gate) — proves the 3 residuals R4-main deliberately
// deferred (see harvest-T57-findings.md's R4-main status line: "3 DEFERRED residuals ...: briefing.ts
// server narrative English-only + plural bug, OpenPhase streakBadge ES plural, HiddenEarningsReveal
// srUtterance English-only") are genuinely fixed, not just catalog-key-renamed:
//
//   1. briefing.ts (Zone 2 Overnight Briefing) — was English-only, server-composed, with a bare
//      `runs.length === 1 ? '' : 's'` plural bug. Now composes through the catalog, CLDR one/other,
//      keyed to the rep's real `User.locale` (duck-typed off `db.user.findUnique` — see that file's
//      header) with a graceful English fallback when unavailable.
//   2. OpenPhase's `shift.openPhase.streakBadge` — ES hardcoded "días" (plural) even for a 1-day
//      streak ("Racha de 1 días"). Now CLDR one/other: "Racha de 1 día" / "Racha de 2 días".
//   3. HiddenEarningsReveal's `srUtterance` — the wrapping sentence around the (already
//      locale-aware) currency figure was English-only even for es reps. Now localized via the
//      catalog with CLDR one/other on 3 independent counts; the FTC-mandated
//      `SAFE_HARBOR_LINE_SPOKEN` tail stays verbatim/untranslated by design (hidden-earnings.ts's
//      own doctrine — "Verbatim; never paraphrased").

import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildBriefingZone } from '@/services/mission-control/zones/briefing';
import { createInMemoryMissionControlDb } from '@/services/mission-control/testing/in-memory-db';
import OpenPhase from '@/app/shift/components/OpenPhase';
import HiddenEarningsReveal from '@/app/onboarding/components/HiddenEarningsReveal';
import { SAFE_HARBOR_LINE_SPOKEN } from '@/services/warm-market/hidden-earnings';
import { LocaleContext } from '@/app/locale-context';
import { t } from '@/lib/i18n/catalog';
import type { TVars } from '@/lib/i18n/catalog';

function render<P extends object>(el: ComponentType<P>, props: P) {
  return renderToStaticMarkup(createElement(el, props));
}

function renderEs<P extends object>(el: ComponentType<P>, props: P) {
  return renderToStaticMarkup(
    createElement(
      LocaleContext.Provider,
      { value: { locale: 'es' as const, setLocale: () => {}, t: (key: string, vars?: TVars) => t('es', key, vars) } },
      createElement(el, props)
    )
  );
}

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');

const USER = 'rep-1';
const NOW = new Date('2026-07-15T12:00:00.000Z');

describe('T-57 R4-residual2 (1): briefing.ts — server narrative i18n + CLDR plural', () => {
  test('RED-confirming regression guard: EN default (no locale signal at all) still renders correctly — singular "1 time" for a lone clear run', async () => {
    const db = createInMemoryMissionControlDb({
      agentRuns: [
        { id: 'run-1', user_id: USER, agent_key: 'prospecting', status: 'COMPLETED', reasoning_log: 'CFE clear (score 2) -> entered the Approval Inbox.', finished_at: NOW, created_at: NOW },
      ],
    });
    const result = await buildBriefingZone(db, USER, NOW);
    expect(result.state).toBe('ready');
    expect(result.lines[0].text).toBe('While you slept: your Prospecting Agent ran 1 time — 1 cleared.');
  });

  test('EN, 2+ runs: "times" plural (was already correct pre-fix — proves no regression)', async () => {
    const db = createInMemoryMissionControlDb({
      agentRuns: [
        { id: 'run-1', user_id: USER, agent_key: 'prospecting', status: 'COMPLETED', reasoning_log: 'CFE clear (score 2) -> entered the Approval Inbox.', finished_at: NOW, created_at: NOW },
        { id: 'run-2', user_id: USER, agent_key: 'prospecting', status: 'COMPLETED', reasoning_log: 'CFE review (score 6) -> entered the Approval Inbox.', finished_at: NOW, created_at: NOW },
      ],
    });
    const result = await buildBriefingZone(db, USER, NOW);
    expect(result.lines[0].text).toBe('While you slept: your Prospecting Agent ran 2 times — 1 cleared, 1 flagged for review.');
  });

  test('TEETH — genuine Spanish render (explicit locale override) with correct CLDR plural on BOTH the "ran N vez/veces" AND each part ("conforme(s)"/"marcado(s) para revisión"/"retenido(s)") — proves this is not a bare-English "+s" bug', async () => {
    const db = createInMemoryMissionControlDb({
      agentRuns: [
        { id: 'run-1', user_id: USER, agent_key: 'prospecting', status: 'COMPLETED', reasoning_log: 'CFE clear (score 2) -> entered the Approval Inbox.', finished_at: NOW, created_at: NOW },
        { id: 'run-2', user_id: USER, agent_key: 'prospecting', status: 'COMPLETED', reasoning_log: 'CFE review (score 6) -> entered the Approval Inbox.', finished_at: NOW, created_at: NOW },
        { id: 'run-3', user_id: USER, agent_key: 'prospecting', status: 'HELD', reasoning_log: 'CFE blocked (score 9) -> held.', finished_at: NOW, created_at: NOW },
      ],
    });
    const result = await buildBriefingZone(db, USER, NOW, 'es');
    expect(result.lines[0].text).toBe(
      'Mientras dormías: tu Prospecting Agent corrió 3 veces — 1 conforme, 1 marcado para revisión, 1 retenido.'
    );
    expect(result.lines[0].text).not.toContain('While you slept');
  });

  test('TEETH — singular Spanish: exactly 1 run (a single "clear") renders "corrió 1 vez" and "1 conforme", never "veces"/"conformes"', async () => {
    const db = createInMemoryMissionControlDb({
      agentRuns: [
        { id: 'run-1', user_id: USER, agent_key: 'prospecting', status: 'COMPLETED', reasoning_log: 'CFE clear (score 2) -> entered the Approval Inbox.', finished_at: NOW, created_at: NOW },
      ],
    });
    const result = await buildBriefingZone(db, USER, NOW, 'es');
    expect(result.lines[0].text).toBe('Mientras dormías: tu Prospecting Agent corrió 1 vez — 1 conforme.');
  });

  test('drafts-waiting line: CLDR plural in both locales (1 draft singular vs 2 drafts plural)', async () => {
    const dbOne = createInMemoryMissionControlDb({
      agentRuns: [{ id: 'run-1', user_id: USER, agent_key: 'prospecting', status: 'COMPLETED', reasoning_log: 'CFE clear (score 2) -> entered the Approval Inbox.', finished_at: NOW, created_at: NOW }],
      draftMessages: [{ id: 'draft-1', user_id: USER, contact_id: 'c1', channel: 'SMS_HANDOFF', cfe_outcome: 'PASS', approval_state: 'PENDING', approved_by: null, approved_at: null, created_at: NOW }],
    });
    const resultEn = await buildBriefingZone(dbOne, USER, NOW);
    expect(resultEn.lines.at(-1)?.text).toBe('1 draft waiting for your approval.');
    const resultEs = await buildBriefingZone(dbOne, USER, NOW, 'es');
    expect(resultEs.lines.at(-1)?.text).toBe('1 borrador esperando tu aprobación.');

    const dbTwo = createInMemoryMissionControlDb({
      agentRuns: [{ id: 'run-1', user_id: USER, agent_key: 'prospecting', status: 'COMPLETED', reasoning_log: 'CFE clear (score 2) -> entered the Approval Inbox.', finished_at: NOW, created_at: NOW }],
      draftMessages: [
        { id: 'draft-1', user_id: USER, contact_id: 'c1', channel: 'SMS_HANDOFF', cfe_outcome: 'PASS', approval_state: 'PENDING', approved_by: null, approved_at: null, created_at: NOW },
        { id: 'draft-2', user_id: USER, contact_id: 'c2', channel: 'SMS_HANDOFF', cfe_outcome: 'PASS', approval_state: 'HELD', approved_by: null, approved_at: null, created_at: NOW },
      ],
    });
    const resultEsTwo = await buildBriefingZone(dbTwo, USER, NOW, 'es');
    expect(resultEsTwo.lines.at(-1)?.text).toBe('2 borradores esperando tu aprobación.');
  });

  test('production-realistic path: NO explicit locale passed (mirrors the real today.service.ts call site) — resolves the rep\'s real User.locale off a duck-typed db.user.findUnique, so an es-locale rep genuinely gets a Spanish briefing with zero other-file changes', async () => {
    const baseDb = createInMemoryMissionControlDb({
      agentRuns: [{ id: 'run-1', user_id: USER, agent_key: 'prospecting', status: 'COMPLETED', reasoning_log: 'CFE clear (score 2) -> entered the Approval Inbox.', finished_at: NOW, created_at: NOW }],
    });
    const dbWithEsUser = { ...baseDb, user: { findUnique: async () => ({ locale: 'es' }) } };
    const result = await buildBriefingZone(dbWithEsUser, USER, NOW);
    expect(result.lines[0].text).toBe('Mientras dormías: tu Prospecting Agent corrió 1 vez — 1 conforme.');
  });

  test('fail-safe: a db.user.findUnique that throws, or returns an invalid/null locale, degrades to English — never crashes the zone', async () => {
    const baseDb = createInMemoryMissionControlDb({
      agentRuns: [{ id: 'run-1', user_id: USER, agent_key: 'prospecting', status: 'COMPLETED', reasoning_log: 'CFE clear (score 2) -> entered the Approval Inbox.', finished_at: NOW, created_at: NOW }],
    });
    const dbThrows = { ...baseDb, user: { findUnique: async () => { throw new Error('simulated DB hiccup'); } } };
    const resultThrows = await buildBriefingZone(dbThrows, USER, NOW);
    expect(resultThrows.lines[0].text).toBe('While you slept: your Prospecting Agent ran 1 time — 1 cleared.');

    const dbInvalidLocale = { ...baseDb, user: { findUnique: async () => ({ locale: 'fr' }) } };
    const resultInvalid = await buildBriefingZone(dbInvalidLocale, USER, NOW);
    expect(resultInvalid.lines[0].text).toBe('While you slept: your Prospecting Agent ran 1 time — 1 cleared.');

    const dbNoUser = createInMemoryMissionControlDb({
      agentRuns: [{ id: 'run-1', user_id: USER, agent_key: 'prospecting', status: 'COMPLETED', reasoning_log: 'CFE clear (score 2) -> entered the Approval Inbox.', finished_at: NOW, created_at: NOW }],
    });
    const resultNoUser = await buildBriefingZone(dbNoUser, USER, NOW); // every pre-existing zone test's fake — no `.user` at all
    expect(resultNoUser.lines[0].text).toBe('While you slept: your Prospecting Agent ran 1 time — 1 cleared.');
  });
});

describe('T-57 R4-residual2 (2): OpenPhase streakBadge — CLDR one/other (día/días)', () => {
  const baseProps = {
    briefingLines: ['Line one.'],
    motivationalLine: 'Show up today.',
    graceDayOffer: false,
    mode: 'STANDARD' as const,
    learningState: null,
    onBegin: () => {},
  };

  test('RED-confirming regression guard: ES streakCount=1 used to render "Racha de 1 días" (wrong) — now renders "Racha de 1 día" (singular)', () => {
    const html = renderEs(OpenPhase, { ...baseProps, streakCount: 1 });
    expect(textOf(html)).toContain('Racha de 1 día');
    expect(textOf(html)).not.toContain('Racha de 1 días');
  });

  test('ES streakCount=2 still pluralizes correctly ("días") — no regression from the fix', () => {
    const html = renderEs(OpenPhase, { ...baseProps, streakCount: 2 });
    expect(textOf(html)).toContain('Racha de 2 días');
  });

  test('EN streakCount=1 unaffected ("1-day streak" — English "day" was already invariant)', () => {
    const html = render(OpenPhase, { ...baseProps, streakCount: 1 });
    expect(textOf(html)).toContain('1-day streak');
  });
});

describe('T-57 R4-residual2 (3): HiddenEarningsReveal srUtterance — i18n the wrapping sentence around the already-locale-aware currency', () => {
  test('RED-confirming regression guard turned GREEN: locale="es" now renders a genuinely Spanish wrapping sentence (was English-only before this fix)', () => {
    const html = render(HiddenEarningsReveal, {
      contactCount: 42,
      monthlyValueUsd: 125000,
      estimatedAppointments: 15,
      estimatedClients: 5,
      locale: 'es',
    });
    const srMatch = html.match(/id="reveal-sr"[^>]*>([^<]*)</);
    expect(srMatch).not.toBeNull();
    const sr = srMatch![1];
    expect(sr).toContain('De las 42 personas en tu comunidad');
    expect(sr).toContain('un estimado de 15 conversaciones');
    expect(sr).toContain('5 familias a las que podrías ayudar');
    expect(sr).toContain('$125,000');
    expect(sr).toContain('de valor potencial mensual');
    expect(sr).not.toContain('From the');
    // The FTC safe-harbor tail stays verbatim/untranslated by design (hidden-earnings.ts doctrine).
    expect(sr).toContain(SAFE_HARBOR_LINE_SPOKEN);
  });

  // `contactCount` must be > `ZERO_DATA_MAX_CONTACTS` (3) with a positive `monthlyValueUsd`, or the
  // component renders the (unrelated, out-of-scope) growth-path branch instead of the figure branch
  // this srUtterance lives in — so `contactCount` itself exercises the "other" (5) plural form here;
  // `estimatedAppointments`/`estimatedClients` (independently settable props, not derived from
  // `contactCount`) are what exercise the singular ("1") form for their own two phrases.
  test('TEETH — singular Spanish on the two counts that can legitimately be 1 (conversación/familia), never the plural forms', () => {
    const html = render(HiddenEarningsReveal, {
      contactCount: 5,
      monthlyValueUsd: 500,
      estimatedAppointments: 1,
      estimatedClients: 1,
      locale: 'es',
    });
    const srMatch = html.match(/id="reveal-sr"[^>]*>([^<]*)</);
    const sr = srMatch![1];
    expect(sr).toContain('De las 5 personas en tu comunidad');
    expect(sr).toContain('un estimado de 1 conversación');
    expect(sr).toContain('1 familia a la que podrías ayudar');
    expect(sr).not.toContain('conversaciones');
    expect(sr).not.toContain('familias');
  });

  test('singular English on the two counts that can legitimately be 1 (conversation/family), never the plural forms — regression guard', () => {
    const html = render(HiddenEarningsReveal, {
      contactCount: 5,
      monthlyValueUsd: 500,
      estimatedAppointments: 1,
      estimatedClients: 1,
    });
    const srMatch = html.match(/id="reveal-sr"[^>]*>([^<]*)</);
    const sr = srMatch![1];
    expect(sr).toContain('From the 5 people in your community');
    expect(sr).toContain('an estimated 1 conversation');
    expect(sr).toContain('1 family you could help');
    expect(sr).not.toContain('conversations');
    expect(sr).not.toContain('families');
  });

  test('EN default (omitting locale) renders byte-identical to before this fix for the real-data example', () => {
    const html = render(HiddenEarningsReveal, {
      contactCount: 42,
      monthlyValueUsd: 125000,
      estimatedAppointments: 15,
      estimatedClients: 5,
    });
    const srMatch = html.match(/id="reveal-sr"[^>]*>([^<]*)</);
    const sr = srMatch![1];
    expect(sr).toBe(
      `From the 42 people in your community: an estimated 15 conversations, 5 families you could help, and $125,000 of potential monthly value. ${SAFE_HARBOR_LINE_SPOKEN}`
    );
  });
});
