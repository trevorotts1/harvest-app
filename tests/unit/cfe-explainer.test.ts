// T-57 R3c-2 (findings A4; uiux §6.1 point 3 "Understandable" / AC-6-2: "plain-language compliance
// explanations are reachable from every CFE chip and banner"). Proves:
//   (a) `plainLanguageSentence` (the pure, exported sentence-computation function) produces the
//       correct one-sentence plain-English restatement for every outcome, with and without a
//       classifier signal, in BOTH languages — including the doctrine copy-lint's own forbidden
//       terms never leaking into the generated text.
//   (b) `ApprovalInboxItem` mounts the "What does this mean?" trigger directly next to EVERY CFE
//       chip (all outcomes) AND inside the held banner — reachable WITHOUT first opening the
//       (separate, already-buried) ClassifierAdjudicationDrawer.
//   (c) the explainer's own content is always present in server-rendered markup (native
//       `<details>`/`<summary>` — only visually collapsed), matching this repo's own
//       `renderToStaticMarkup`-only test convention (jest.config.js has no jsdom).

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { plainLanguageSentence, type CfeExplainerOutcome } from '@/app/inbox/components/CfeExplainer';
import ApprovalInboxItem, { type InboxItemData } from '@/app/inbox/components/ApprovalInboxItem';
import { t } from '@/lib/i18n/catalog';

const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');

const tEn = (key: string, vars?: Record<string, string | number>) => t('en', key, vars);
const tEs = (key: string, vars?: Record<string, string | number>) => t('es', key, vars);

const INCOME_CLAIM_DATA = [{ classifier: 'INCOME_CLAIM', confidence: 0.9 }];
const OPPORTUNITY_DATA = [{ classifier: 'OPPORTUNITY', confidence: 0.4 }];

describe('plainLanguageSentence — the one-sentence plain-English restatement (AC-6-2)', () => {
  test('BLOCK + a top classifier signal names the reason (EN) — mirrors the uiux §6.1 verbatim example shape', () => {
    const sentence = plainLanguageSentence('BLOCK', INCOME_CLAIM_DATA, tEn);
    expect(sentence).toBe(
      "This message sounded like an income promise, which the rules don't allow — here's a version that keeps the meaning."
    );
  });

  test('BLOCK with no classifier signal falls back to a generic (but still plain) sentence', () => {
    const sentence = plainLanguageSentence('BLOCK', [], tEn);
    expect(sentence).toBe(
      "This message didn't pass our compliance rules, so it's blocked — here's a version that keeps the meaning."
    );
  });

  test('FLAG names the reason when a classifier fired', () => {
    const sentence = plainLanguageSentence('FLAG', OPPORTUNITY_DATA, tEn);
    expect(sentence).toBe(
      'This message mentions a business-opportunity claim that needs a closer look, so a quick human check is needed before it can go out.'
    );
  });

  test('FLAG with no signal falls back to the generic flag sentence', () => {
    const sentence = plainLanguageSentence('FLAG', undefined, tEn);
    expect(sentence).toBe('This message needs a quick human check before it can go out.');
  });

  test('PASS renders the reassuring ready-to-send sentence, regardless of any signal present', () => {
    expect(plainLanguageSentence('PASS', INCOME_CLAIM_DATA, tEn)).toBe(
      "This message didn't trigger any compliance concerns, so it's ready to send."
    );
  });

  test('RECORDED renders the informational-evidence sentence, never a pass/flag/block claim', () => {
    expect(plainLanguageSentence('RECORDED', null, tEn)).toBe(
      'This was recorded for the compliance record — no action is needed from you.'
    );
  });

  test('null outcome (defensive) falls back to the PASS sentence rather than throwing', () => {
    expect(() => plainLanguageSentence(null, null, tEn)).not.toThrow();
  });

  test('a malformed classifierData (not an array) is treated as "no signal", never throws', () => {
    expect(() => plainLanguageSentence('BLOCK', { not: 'an array' }, tEn)).not.toThrow();
    expect(plainLanguageSentence('BLOCK', { not: 'an array' }, tEn)).toBe(
      "This message didn't pass our compliance rules, so it's blocked — here's a version that keeps the meaning."
    );
  });

  test('picks the HIGHEST-confidence classifier when several fired', () => {
    const mixed = [
      { classifier: 'REFERRAL', confidence: 0.2 },
      { classifier: 'INCOME_CLAIM', confidence: 0.85 },
      { classifier: 'TESTIMONIAL', confidence: 0.5 },
    ];
    expect(plainLanguageSentence('BLOCK', mixed, tEn)).toContain('an income promise');
  });

  test('genuine ES rendering — not a silent EN fallback', () => {
    const sentence = plainLanguageSentence('BLOCK', INCOME_CLAIM_DATA, tEs);
    expect(sentence).toBe(
      'Este mensaje sonaba a una promesa de ingresos, algo que nuestras reglas no permiten — aquí tienes una versión que conserva el sentido.'
    );
    expect(sentence).not.toContain('This message');
  });

  test.each<[CfeExplainerOutcome, unknown]>([
    ['BLOCK', INCOME_CLAIM_DATA],
    ['FLAG', OPPORTUNITY_DATA],
    ['PASS', undefined],
    ['RECORDED', undefined],
  ])('outcome %s carries no doctrine-forbidden term in either language', (outcome, data) => {
    const en = plainLanguageSentence(outcome, data, tEn).toLowerCase();
    const es = plainLanguageSentence(outcome, data, tEs).toLowerCase();
    for (const term of ['prospect', 'lead', 'funnel', 'recruit', 'guaranteed income', 'you will earn']) {
      expect(en).not.toContain(term);
    }
    for (const term of ['prospecto', 'cliente potencial', 'embudo', 'reclut', 'ingreso garantizado', 'vas a ganar']) {
      expect(es).not.toContain(term);
    }
  });
});

// ─── Reachability: mounted directly on the chip AND the held banner (ApprovalInboxItem) ──────────
const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(ApprovalInboxItem as never, props));
const noopApprove = async () => ({ ok: true });
const noopDecline = async () => ({ ok: true });
const noopEdit = async () => ({ ok: true });

function baseItem(overrides: Partial<InboxItemData> = {}): InboxItemData {
  return {
    id: 'd-explain-1',
    contact_id: 'c-1',
    contact: { firstName: 'Jordan', lastName: 'Vega' },
    channel: 'SMS_HANDOFF',
    body: 'a drafted message',
    cfe_outcome: 'PASS',
    cfe_risk_score: 3,
    approval_state: 'PENDING',
    created_at: new Date('2026-07-18T08:00:00Z').toISOString(),
    ...overrides,
  };
}

describe('ApprovalInboxItem — the explainer is reachable directly from the chip, every outcome', () => {
  test.each<InboxItemData['cfe_outcome']>(['PASS', 'FLAG', 'BLOCK'])('outcome %s renders the "What does this mean?" trigger next to the chip', (outcome) => {
    const html = render({
      item: baseItem({ cfe_outcome: outcome, approval_state: outcome === 'BLOCK' ? 'HELD' : 'PENDING' }),
      onApprove: noopApprove,
      onDecline: noopDecline,
      onEdit: noopEdit,
    });
    expect(textOf(html)).toContain('What does this mean?');
  });

  test('the plain-English sentence itself is present in the static markup (native <details> content is never stripped, only visually collapsed)', () => {
    const html = render({
      item: baseItem({ cfe_outcome: 'FLAG', approval_state: 'PENDING', cfe_classifier_data: OPPORTUNITY_DATA }),
      onApprove: noopApprove,
      onDecline: noopDecline,
      onEdit: noopEdit,
    });
    expect(textOf(html)).toContain('a business-opportunity claim that needs a closer look');
  });

  test('queued-offline suppresses the explainer alongside the rest of the stale-band chip (no settled verdict to explain yet)', () => {
    const html = render({
      item: baseItem({ cfe_outcome: 'PASS', approval_state: 'PENDING', queuedOffline: true }),
      onApprove: noopApprove,
      onDecline: noopDecline,
      onEdit: noopEdit,
    });
    expect(textOf(html)).not.toContain('What does this mean?');
  });
});

describe('ApprovalInboxItem — the explainer is ALSO reachable directly from the held banner', () => {
  test('a HELD item renders the held banner AND its own explainer trigger, distinct from the chip one', () => {
    const html = render({
      item: baseItem({ cfe_outcome: 'BLOCK', approval_state: 'HELD', cfe_classifier_data: INCOME_CLAIM_DATA }),
      onApprove: noopApprove,
      onDecline: noopDecline,
      onEdit: noopEdit,
    });
    // Two independent explainer mounts (chip + held banner) — proven by two distinct data-testid
    // anchors rather than counting matches of translated, potentially-repeated visible text.
    expect(html).toContain('data-testid="cfe-explainer-d-explain-1-chip"');
    expect(html).toContain('data-testid="cfe-explainer-d-explain-1-held"');
    // `role="alert"` (assertive — reserved for compliance holds, uiux §6.1) stays on the held
    // banner's OWN text only; the explainer's panel is `role="status"` (polite), never assertive.
    expect(html).toMatch(/role="alert"[^>]*>\s*Held for review/);
  });

  test('a non-HELD PASS item renders no held banner and no second explainer mount', () => {
    const html = render({
      item: baseItem({ cfe_outcome: 'PASS', approval_state: 'PENDING' }),
      onApprove: noopApprove,
      onDecline: noopDecline,
      onEdit: noopEdit,
    });
    expect(html).not.toContain('cfe-explainer-d-explain-1-held');
    expect(html).toContain('cfe-explainer-d-explain-1-chip');
  });
});
