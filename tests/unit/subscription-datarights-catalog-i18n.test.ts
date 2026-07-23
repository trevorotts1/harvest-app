// T-R32 (master-spec §17.5; uiux §6.2) — the new `billing.*`/`dataRights.*` catalog keys this task
// added to route `me/subscription`'s sponsored/anniversary/cancel-flow copy and `me/data-rights`'s
// export/deletion copy through the catalog. Both pages gate their real content behind an async
// `useEffect` fetch that never resolves under this repo's `renderToStaticMarkup`-only Jest
// environment (no jsdom, no effects run — see `src/app/locale-context.tsx`'s own header note), so a
// full page-level ES render proof isn't reachable there; this instead directly proves every new key
// resolves correctly in BOTH locales via `t()` — the same direct-catalog-verification convention
// `tests/unit/i18n-catalog.test.ts` already established for T-53.
import { t } from '@/lib/i18n/catalog';
import en from '@/lib/i18n/messages/en.json';
import es from '@/lib/i18n/messages/es.json';

describe('billing.* — sponsored/anniversary/cancel-flow copy (me/subscription, T-R32)', () => {
  test('sponsored coverage copy — with vs. without a named sponsor', () => {
    expect(t('en', 'billing.sponsored.coveredThroughWithSponsor', { date: 'July 1, 2027' })).toBe(
      'Covered through July 1, 2027 by your Downline Sponsor.'
    );
    expect(t('es', 'billing.sponsored.coveredThroughWithSponsor', { date: '1 de julio de 2027' })).toBe(
      'Cubierto hasta el 1 de julio de 2027 por tu patrocinador de línea descendente.'
    );
    expect(t('en', 'billing.sponsored.coveredThroughNoSponsor', { date: 'July 1, 2027' })).toBe('Covered through July 1, 2027.');
    expect(t('es', 'billing.sponsored.coveredThroughNoSponsor', { date: '1 de julio de 2027' })).toBe('Cubierto hasta el 1 de julio de 2027.');
  });

  test('anniversary approach copy (§15.3 three explicit paths)', () => {
    expect(t('en', 'billing.anniversary.endsOn', { date: 'July 1, 2027' })).toBe('Your sponsored year ends July 1, 2027.');
    expect(t('es', 'billing.anniversary.endsOn', { date: '1 de julio de 2027' })).toBe('Tu año patrocinado termina el 1 de julio de 2027.');
    expect(t('en', 'billing.anniversary.convertCta')).toBe('Convert to $297/month');
    expect(t('es', 'billing.anniversary.convertCta')).toBe('Cambiar a $297/mes');
  });

  test('cancel-flow copy (AC-5.8-6 no-dark-pattern cancellation)', () => {
    expect(t('en', 'billing.manage.accessUntil', { date: 'July 1, 2027', days: 30 })).toBe(
      'If you cancel, you keep full access until July 1, 2027, and you can reactivate within 30 days. No need to contact support.'
    );
    expect(t('es', 'billing.manage.accessUntil', { date: '1 de julio de 2027', days: 30 })).toBe(
      'Si cancelas, mantienes acceso completo hasta el 1 de julio de 2027, y puedes reactivar dentro de 30 días. No necesitas contactar a soporte.'
    );
  });

  // T-R42 (P2 cleanup, integration-reachability audit): this REPLACES the old assertions (removed
  // above) that `billing.manage.pauseOption` resolved to real EN/ES pause copy. No pause capability
  // exists anywhere in this codebase (no `PAUSED` in `SubscriptionStatus`, no pause method on
  // `SubscriptionService`) — `buildCancellationFlow` no longer offers 'pause' as an alternative
  // (src/services/payment/cancellation.ts, T-R42), so the key that only ever labeled that button is
  // genuinely unused now (confirmed by repo-wide grep before removal — zero references outside these
  // two catalog files). The correct new intent is asserting its ABSENCE, in BOTH locales (parity
  // maintained — neither catalog kept a stray orphaned key), not merely deleting the old assertions.
  test('T-R42: billing.manage.pauseOption is REMOVED from both catalogs — pause is no longer offered', () => {
    expect(en.billing.manage).not.toHaveProperty('pauseOption');
    expect(es.billing.manage).not.toHaveProperty('pauseOption');
    // t()'s documented last-resort fallback (catalog.ts: "the bare key itself as an absolute last
    // resort") confirms it end-to-end through the real lookup path too, in both locales.
    expect(t('en', 'billing.manage.pauseOption')).toBe('billing.manage.pauseOption');
    expect(t('es', 'billing.manage.pauseOption')).toBe('billing.manage.pauseOption');
  });

  test('every tier body translates and no tier is left in English under es', () => {
    for (const tier of ['free', 'individual', 'enterprise'] as const) {
      const en = t('en', `billing.tier.body.${tier}`);
      const es = t('es', `billing.tier.body.${tier}`);
      expect(en.length).toBeGreaterThan(0);
      expect(es.length).toBeGreaterThan(0);
      expect(es).not.toBe(en);
    }
  });

  test('every lifecycle banner (BillingBanner) title+body pair exists and translates', () => {
    const pairs = [
      'paymentReceivedTitle', 'paymentReceivedBody',
      'memberGraceTitle', 'memberGraceBody',
      'graceTitle', 'graceBody',
      'softSuspendedTitle', 'softSuspendedBody',
      'disputedTitle', 'disputedBody',
      'canceledActiveTitle',
    ];
    for (const key of pairs) {
      const en = t('en', `billing.banner.${key}`);
      const es = t('es', `billing.banner.${key}`);
      expect(en).not.toBe(`billing.banner.${key}`); // never the bare missing-key fallback
      expect(es).not.toBe(`billing.banner.${key}`);
      expect(es).not.toBe(en);
    }
  });
});

describe('dataRights.* — export/deletion flow copy (me/data-rights, T-R29/T-R32)', () => {
  test('cooling-off + confirm-deletion copy interpolates dates correctly in both locales', () => {
    expect(t('en', 'dataRights.deletion.coolingOffBody', { requestedDate: 'July 1, 2026', readyDate: 'July 2, 2026' })).toBe(
      'Requested July 1, 2026. You can confirm starting July 2, 2026.'
    );
    expect(t('es', 'dataRights.deletion.coolingOffBody', { requestedDate: '1 de julio de 2026', readyDate: '2 de julio de 2026' })).toBe(
      'Solicitado el 1 de julio de 2026. Puedes confirmar a partir del 2 de julio de 2026.'
    );
  });

  test('the permanent-deletion confirm checkbox + CTA translate (no dark pattern — explicit affirmative copy)', () => {
    expect(t('en', 'dataRights.deletion.confirmCheckboxLabel')).toMatch(/permanently deletes my account/);
    expect(t('es', 'dataRights.deletion.confirmCheckboxLabel')).toMatch(/elimina permanentemente mi cuenta/);
    expect(t('en', 'dataRights.deletion.confirmCta')).toBe('Permanently delete my data');
    expect(t('es', 'dataRights.deletion.confirmCta')).toBe('Eliminar permanentemente mis datos');
  });

  test('export create/download failure copy + the downloaded-filename confirmation translate', () => {
    expect(t('en', 'dataRights.export.downloaded', { filename: 'export.json' })).toBe('Downloaded export.json.');
    expect(t('es', 'dataRights.export.downloaded', { filename: 'export.json' })).toBe('Se descargó export.json.');
    expect(t('en', 'dataRights.export.createFailed')).not.toBe(t('es', 'dataRights.export.createFailed'));
  });

  test('the completed-deletion certificate summary (fields deleted / records retained) translates', () => {
    expect(t('en', 'dataRights.deletion.fieldsDeleted', { count: 12 })).toBe('12 fields deleted or anonymized.');
    expect(t('es', 'dataRights.deletion.fieldsDeleted', { count: 12 })).toBe('12 campos eliminados o anonimizados.');
    expect(t('en', 'dataRights.deletion.recordsRetained', { count: 2 })).toBe('2 record(s) retained under regulatory requirement.');
    expect(t('es', 'dataRights.deletion.recordsRetained', { count: 2 })).toBe('2 registro(s) conservado(s) por requisito regulatorio.');
  });

  test('no dataRights.* or billing.* key added by T-R32 is missing from either catalog (never falls back to the bare key)', () => {
    const keys = [
      'billing.sponsored.coveredThroughWithSponsor', 'billing.sponsored.coveredThroughNoSponsor', 'billing.sponsored.everythingIncluded',
      'billing.anniversary.endsOn', 'billing.anniversary.body', 'billing.anniversary.convertCta',
      // T-R42: 'billing.manage.pauseOption' intentionally removed from this list — that key was
      // DELETED from both catalogs (see the dedicated T-R42 test above), not accidentally missing.
      'billing.manage.heading', 'billing.manage.downgradeOption', 'billing.manage.accessUntil',
      'billing.tier.currentPlanBadge', 'billing.tier.body.free', 'billing.tier.body.individual', 'billing.tier.body.enterprise',
      'dataRights.loadingSettings', 'dataRights.exportSectionAria', 'dataRights.deletionSectionAria',
      'dataRights.export.createFailed', 'dataRights.export.downloadFailed', 'dataRights.export.downloaded',
      'dataRights.deletion.requestFailed', 'dataRights.deletion.noRequestToConfirm', 'dataRights.deletion.confirmFailedGeneric',
      'dataRights.deletion.confirmStartingAt', 'dataRights.deletion.coolingOffTitle', 'dataRights.deletion.coolingOffBody',
      'dataRights.deletion.confirmCheckboxLabel', 'dataRights.deletion.confirmCta', 'dataRights.deletion.onHoldTitle',
      'dataRights.deletion.onHoldBody', 'dataRights.deletion.completedTitle', 'dataRights.deletion.completedBody',
      'dataRights.deletion.fieldsDeleted', 'dataRights.deletion.recordsRetained', 'dataRights.deletion.certificateLabel',
    ];
    for (const key of keys) {
      expect(t('en', key)).not.toBe(key);
      expect(t('es', key)).not.toBe(key);
    }
  });
});
