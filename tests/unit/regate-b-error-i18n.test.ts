// T-57 RE-GATE B [af7789d3] Finding 1 fix (fix/T57-RGb-error-i18n) — the systemic backend-error
// English leak: client code was doing `data.error ?? t('some.generic.key')` while every mutation
// route ALWAYS populates `error` with raw English prose, so the `??` fallback never fires and a
// Spanish rep saw English 100% of the time. The fix: every route also sets a stable machine `code`
// alongside `error` (kept for logs/back-compat only); the client resolves the DISPLAY string from
// the NEW `errors.*` catalog namespace via `src/lib/i18n/error-display.ts`'s `errorDisplay()` —
// mirroring the ALREADY-correct pattern `composer-handoff-core.ts`'s `viewFromHandoffResponse`
// established (a machine `reason` token -> a catalog key, never the wire body's prose).
//
// This file proves, end to end for a representative sample of the ~15 fixed sites:
//   (a) the RED state's shape — a route response carries a raw-English `error` alongside `code`;
//   (b) resolving that SAME `code` through `errorDisplay` under an ES locale yields a genuine,
//       distinct-from-English Spanish sentence — never the raw `error` string, never a bare
//       untranslated code, never English;
//   (c) an unknown/absent `code` still resolves to `errors.generic` (never English) — the
//       systemic safety net for any route this pass didn't reach;
//   (d) F2 (non-idiomatic EN-identical ES values + the CLDR plural migration) and F3 (the
//       document-title pre-paint locale correction) are in place.

import { OnboardingStatus, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { t as catalog, flattenCatalog, type CatalogTree } from '@/lib/i18n/catalog';
import { errorDisplay, errorStateLabel } from '@/lib/i18n/error-display';
import en from '@/lib/i18n/messages/en.json';
import es from '@/lib/i18n/messages/es.json';
import { parseContactCsv, ImportLimitExceededError, MAX_IMPORT_ROWS, MAX_IMPORT_BYTES } from '@/services/warm-market/vault/csv-parser';

const REPO_ROOT = path.join(__dirname, '..', '..');
const src = (...parts: string[]) => readFileSync(path.join(REPO_ROOT, 'src', ...parts), 'utf8');

// A crude but effective "this string contains no leaked English prose" check for the handful of
// common English function-words that never appear in the real Spanish catalog strings below —
// deliberately narrow (word-boundary matched) so it can't false-positive on Spanish cognates.
function assertNoEnglishLeak(displayed: string) {
  expect(displayed).not.toMatch(/\b(the|this|cannot|could not|is required|must be|not found)\b/i);
}

describe('src/lib/i18n/error-display.ts — the code -> catalog resolver (the fix itself)', () => {
  test('a known code resolves to its own real, distinct EN/ES strings', () => {
    const enText = errorDisplay((k, v) => catalog('en', k, v), 'DRAFT_NOT_FOUND');
    const esText = errorDisplay((k, v) => catalog('es', k, v), 'DRAFT_NOT_FOUND');
    expect(enText).toBe('This draft no longer exists.');
    expect(esText).toBe('Este borrador ya no existe.');
    expect(esText).not.toBe(enText);
  });

  test('interpolates vars into a known code (currentState)', () => {
    const esText = errorDisplay((k, v) => catalog('es', k, v), 'NOT_APPROVABLE', { currentState: 'en espera' });
    expect(esText).toBe('Este borrador no se puede aprobar desde su estado actual (en espera).');
  });

  test('an ABSENT code (the generic auth/RBAC-gate shape, which sets no code) falls back to errors.generic — never English, never blank', () => {
    const esText = errorDisplay((k, v) => catalog('es', k, v), undefined);
    expect(esText).toBe('Ocurrió un error. Inténtalo de nuevo.');
  });

  test('an UNKNOWN code (a route this pass did not reach) ALSO falls back to errors.generic — the systemic safety net', () => {
    const esText = errorDisplay((k, v) => catalog('es', k, v), 'SOME_FUTURE_CODE_NOT_YET_CATALOGED');
    expect(esText).toBe('Ocurrió un error. Inténtalo de nuevo.');
    assertNoEnglishLeak(esText);
  });

  test('errorStateLabel humanizes a known state token per-locale, and passes through an unknown one', () => {
    expect(errorStateLabel((k, v) => catalog('es', k, v), 'HELD')).toBe('en espera');
    expect(errorStateLabel((k, v) => catalog('en', k, v), 'HELD')).toBe('held');
    expect(errorStateLabel((k, v) => catalog('es', k, v), 'SOME_WEIRD_TOKEN')).toBe('SOME_WEIRD_TOKEN');
    expect(errorStateLabel((k, v) => catalog('es', k, v), null)).toBe('');
  });

  test('every errors.* code referenced by errorDisplay across this fix has REAL, non-identical EN/ES copy (parity)', () => {
    const flat = flattenCatalog(en as CatalogTree);
    const flatEs = flattenCatalog(es as CatalogTree);
    const errorKeys = Object.keys(flat).filter((k) => k.startsWith('errors.') && !k.startsWith('errors.states.'));
    expect(errorKeys.length).toBeGreaterThan(30); // the full code list this fix introduced
    for (const key of errorKeys) {
      expect(flatEs[key]).toBeDefined();
      expect(flatEs[key]).not.toBe(flat[key]); // never an EN-identical ES value
    }
  });
});

describe('RE-CONFIRM RED then GREEN — a representative leaking site (approval-inbox approve)', () => {
  jest.doMock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
  jest.doMock('@/lib/prisma', () => ({
    prisma: {
      user: { findUnique: jest.fn() },
      draftMessage: { findFirst: jest.fn(), update: jest.fn() },
    },
  }));

  function fakeSession(overrides: Partial<Session['user']> = {}): Session {
    return {
      user: {
        id: 'real-session-user',
        role: Role.REP,
        orgType: 'EXTERNAL',
        organizationId: 'org-1',
        accessTier: 'FREE_ORG_LINKED',
        mfaEnrolled: false,
        mfaVerifiedAt: null,
        ...overrides,
      },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as Session;
  }

  function postRequest(path: string, body: unknown): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
  }

  test('RED (re-confirmed) then GREEN: a HELD draft approve still carries the raw-English `error` for logs, but the CLIENT never has to render it — the SAME `code` resolves to real, distinct Spanish', async () => {
    const { getCurrentSession } = await import('@/lib/auth/session');
    const { prisma } = await import('@/lib/prisma');
    const { POST: approvePOST } = await import('@/app/api/approval-inbox/approve/route');

    (getCurrentSession as jest.Mock).mockResolvedValue(fakeSession());
    (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique.mockResolvedValue({
      onboarding_status: OnboardingStatus.GATED_COMPLETE,
      onboarding_sessions: [{ current_step: 'REGISTER' }],
    });
    (prisma as unknown as { draftMessage: { findFirst: jest.Mock } }).draftMessage.findFirst.mockResolvedValue({
      id: 'd-1',
      user_id: 'real-session-user',
      approval_state: 'HELD',
    });

    const res = await approvePOST(postRequest('/api/approval-inbox/approve', { draftId: 'd-1' }), {});
    expect(res.status).toBe(403);
    const body = await res.json();

    // RED re-confirmation: the wire body's `error` IS raw English prose (kept for logs/back-compat)
    // — this is exactly what the old client code rendered directly (the leak).
    expect(body.error).toMatch(/^This draft cannot be approved from its current state/);
    expect(body.code).toBe('NOT_APPROVABLE');
    expect(body.currentState).toBe('HELD');

    // GREEN: the client NEVER renders `body.error` anymore — it resolves through errorDisplay(),
    // keyed by `body.code`, and gets a genuine Spanish sentence that is NOT the English wire text.
    const esDisplayed = errorDisplay(
      (k, v) => catalog('es', k, v),
      body.code,
      { currentState: errorStateLabel((k, v) => catalog('es', k, v), body.currentState) }
    );
    expect(esDisplayed).toBe('Este borrador no se puede aprobar desde su estado actual (en espera).');
    expect(esDisplayed).not.toBe(body.error);
    assertNoEnglishLeak(esDisplayed);
  });

  test('every NEW validation branch on approve/decline/edit now sets a machine `code` (never code-less)', async () => {
    const { getCurrentSession } = await import('@/lib/auth/session');
    const { prisma } = await import('@/lib/prisma');
    const { POST: approvePOST } = await import('@/app/api/approval-inbox/approve/route');
    const { POST: declinePOST } = await import('@/app/api/approval-inbox/decline/route');
    const { POST: editPOST } = await import('@/app/api/approval-inbox/edit/route');

    (getCurrentSession as jest.Mock).mockResolvedValue(fakeSession());
    (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique.mockResolvedValue({
      onboarding_status: OnboardingStatus.GATED_COMPLETE,
      onboarding_sessions: [{ current_step: 'REGISTER' }],
    });

    const missingDraftId = await approvePOST(postRequest('/api/approval-inbox/approve', {}), {});
    expect((await missingDraftId.json()).code).toBe('DRAFT_ID_REQUIRED');

    const missingReason = await declinePOST(postRequest('/api/approval-inbox/decline', { draftId: 'd-1' }), {});
    expect((await missingReason.json()).code).toBe('REASON_REQUIRED');

    // `invalid_reason` is checked by the SERVICE before any Prisma read — safe with no findFirst seed.
    const invalidReasonRes = await declinePOST(
      postRequest('/api/approval-inbox/decline', { draftId: 'd-1', reason: 'not_a_real_reason' }),
      {}
    );
    expect((await invalidReasonRes.json()).code).toBe('INVALID_REASON');

    const nonStringBody = await editPOST(postRequest('/api/approval-inbox/edit', { draftId: 'd-1', body: 123 }), {});
    expect((await nonStringBody.json()).code).toBe('EDIT_BODY_INVALID_TYPE');

    const invalidLanguage = await editPOST(
      postRequest('/api/approval-inbox/edit', { draftId: 'd-1', body: 'hola', language: 'fr' }),
      {}
    );
    expect((await invalidLanguage.json()).code).toBe('LANGUAGE_INVALID');
  });
});

describe('CSV import limits (onboarding contacts-import / community import) — granular machine codes', () => {
  test('an oversized-by-bytes CSV throws ImportLimitExceededError with code CSV_TOO_LARGE', () => {
    const hugeValue = 'x'.repeat(MAX_IMPORT_BYTES + 10);
    const csv = `name,notes\nSomeone,"${hugeValue}"\n`;
    try {
      parseContactCsv(csv);
      throw new Error('expected parseContactCsv to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ImportLimitExceededError);
      expect((err as ImportLimitExceededError).code).toBe('CSV_TOO_LARGE');
    }
  });

  test('an oversized-by-rows CSV throws ImportLimitExceededError with code CSV_TOO_MANY_ROWS', () => {
    const header = 'name\n';
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `Contact ${i}`).join('\n');
    try {
      parseContactCsv(header + rows);
      throw new Error('expected parseContactCsv to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ImportLimitExceededError);
      expect((err as ImportLimitExceededError).code).toBe('CSV_TOO_MANY_ROWS');
    }
  });

  test('both granular codes resolve to distinct, real ES sentences via errorDisplay (never a raw-English fallback)', () => {
    const large = errorDisplay((k, v) => catalog('es', k, v), 'CSV_TOO_LARGE');
    const manyRows = errorDisplay((k, v) => catalog('es', k, v), 'CSV_TOO_MANY_ROWS', { maxRows: MAX_IMPORT_ROWS });
    expect(large).toMatch(/demasiado grande/);
    expect(manyRows).toMatch(new RegExp(`${MAX_IMPORT_ROWS}`));
    expect(large).not.toBe(manyRows);
  });

  test('both onboarding-time and self-serve import routes forward the ERROR\'S OWN code (never a single bucket code)', () => {
    const onboardingRoute = src('app', 'api', 'onboarding', 'contacts-import', 'route.ts');
    const selfServeRoute = src('app', 'api', 'contacts', 'import', 'route.ts');
    for (const routeSrc of [onboardingRoute, selfServeRoute]) {
      expect(routeSrc).toMatch(/code:\s*err\.code/);
    }
  });
});

describe('F2 — non-idiomatic EN-identical ES values now have real, distinct Spanish', () => {
  test('learn.referrals.relationshipTypes.coach is real Spanish, not the EN loanword pairing', () => {
    expect(catalog('en', 'learn.referrals.relationshipTypes.coach')).toBe('Coach / mentor');
    expect(catalog('es', 'learn.referrals.relationshipTypes.coach')).toBe('Acompañante / mentor');
  });

  test('team.dashboard.tableHeader.rep is real Spanish, not the bare EN word', () => {
    expect(catalog('en', 'team.dashboard.tableHeader.rep')).toBe('Rep');
    expect(catalog('es', 'team.dashboard.tableHeader.rep')).toBe('Representante');
  });

  test('team.dashboard.downlineLeakBody is migrated to CLDR _one/_other — real ES plural, not a mechanical "(s)"', () => {
    expect(catalog('es', 'team.dashboard.downlineLeakBody', { count: 1 })).toBe(
      "1 rep no ha estado en el campo por un tiempo — un recordatorio de coaching discreto, no una advertencia."
    );
    expect(catalog('es', 'team.dashboard.downlineLeakBody', { count: 3 })).toBe(
      "3 reps no han estado en el campo por un tiempo — un recordatorio de coaching discreto, no una advertencia."
    );
    // The old bare key must be GONE — this is a migration, not an addition alongside it.
    const teamDashboard = (es as unknown as { team: { dashboard: Record<string, unknown> } }).team.dashboard;
    expect(teamDashboard.downlineLeakBody).toBeUndefined();
    expect(teamDashboard.downlineLeakBody_one).toBeDefined();
    expect(teamDashboard.downlineLeakBody_other).toBeDefined();
  });

  test('the call site (team/page.tsx) already passes a numeric `count` — the CLDR resolution engages with no call-site change needed', () => {
    const teamPage = src('app', 'team', 'page.tsx');
    expect(teamPage).toMatch(/downlineLeakBody['"]?,\s*\{\s*count:\s*data\.downlineLeak\.length\s*\}/);
  });
});

describe('F3 — document title/description locale correction (pre-paint, mirrors theme/locale init)', () => {
  test('the init script reads the SAME locale storage key locale-context.tsx uses, and sets a genuine Spanish title/description', async () => {
    const { DOCUMENT_TITLE_INIT_SCRIPT } = await import('@/app/document-title-init-script');
    expect(DOCUMENT_TITLE_INIT_SCRIPT).toMatch(/getItem\('harvest-locale'\)/);
    expect(DOCUMENT_TITLE_INIT_SCRIPT).toContain('La Cosecha | CEO de 2 Horas');
    expect(DOCUMENT_TITLE_INIT_SCRIPT).toMatch(/meta\[name="description"\]/);
    expect(DOCUMENT_TITLE_INIT_SCRIPT).toMatch(/centro de mando tranquilo/);
  });

  test('root layout wires the script in beforeInteractive, alongside theme/locale/text-scale', () => {
    const layout = src('app', 'layout.tsx');
    expect(layout).toContain('DOCUMENT_TITLE_INIT_SCRIPT');
    expect(layout).toMatch(
      /id="lfds-document-title-init"[^>]*strategy="beforeInteractive"|strategy="beforeInteractive"[^>]*>\s*\{DOCUMENT_TITLE_INIT_SCRIPT\}/
    );
  });

  test('the EN metadata export is untouched (still real, still the documented baseline)', () => {
    const layout = src('app', 'layout.tsx');
    expect(layout).toContain("title: 'The Harvest | 2 Hour CEO'");
  });
});
