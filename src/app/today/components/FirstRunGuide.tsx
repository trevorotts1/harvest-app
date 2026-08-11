// R-16 (refinements catalog 2026-07-28) — first-run expectation-setting on Today.
//
// The operator's words: "in demo mode there should be something like 'we're getting ready to start
// creating messages'… I'm clueless what's getting ready to happen"; and "what does 3 Introductions
// in the next 48 hours mean?" — key phrases appear with no explanation of what they mean or why.
//
// This card is the answer, shown ONLY while Today's briefing is in its zero-data `first_day` state
// (no `AgentRun` rows exist yet for this rep — the honest first-run signal, src/services/
// mission-control/zones/briefing.ts:119). It is NOT a new DB column or flag: zero data on the
// screen already IS the first-run signal, and the guide disappears by itself the moment the agents
// first run (the briefing leaves `first_day`).
//
// Copy requirements, both drawn from the master spec — never invented:
//   (a) what the agents are about to do — "Harvest will draft introductions for the people you
//       added; you review and approve each before anything sends" (approve-before-send is
//       master-spec §9.2's rule: "approval always precedes send"):
//       `today.firstRun.agentsNow`.
//   (b) the First-48 "3 introductions in 48 hours" mission, plainly defined and grounded in
//       master-spec §12.2's canonical wording — "three community introductions to the
//       closest-sphere A-list names highlighted in the warm-market exercise", with the 48-hour
//       clock starting on `gated_complete`:
//       `today.firstRun.definitionBody` / `.definitionSpec` / `.whatCounts*` / `.clockNote`.
//
// All copy ships through the i18n catalog (`today.firstRun.*`, EN + ES) — no literals. Every
// disclosure is a native <details>/<summary> (keyboard/SR-operable with zero JS, same pattern as
// ActionQueue.tsx's receipts expander / CfeExplainer.tsx).

'use client';

import styles from '../today.module.css';
import { useT } from '@/app/locale-context';

export default function FirstRunGuide() {
  const t = useT();
  return (
    <section className={`${styles.zoneCard} ${styles.firstRunGuide}`} data-zone="first-run" data-first-run="true">
      <h2 className={styles.firstRunHeading}>{t('today.firstRun.heading')}</h2>
      <p className={styles.firstRunBody}>{t('today.firstRun.intro')}</p>
      <p className={styles.firstRunBody}>{t('today.firstRun.agentsNow')}</p>

      <details className={styles.firstRunSection}>
        <summary>
          {t('today.firstRun.firstStepHeading')}
          <span aria-hidden="true" className={styles.firstRunChevron}>
            ›
          </span>
        </summary>
        <p className={styles.firstRunBody}>{t('today.firstRun.firstStepBody')}</p>
      </details>

      <details className={styles.firstRunSection}>
        <summary>
          {t('today.firstRun.definitionHeading')}
          <span aria-hidden="true" className={styles.firstRunChevron}>
            ›
          </span>
        </summary>
        <p className={styles.firstRunBody}>{t('today.firstRun.definitionBody')}</p>
        <p className={styles.firstRunBody}>{t('today.firstRun.definitionSpec')}</p>
        <p className={styles.firstRunBody}>
          <strong>{t('today.firstRun.whatCountsHeading')}</strong> {t('today.firstRun.whatCountsBody')}
        </p>
        <p className={styles.firstRunBody}>{t('today.firstRun.whatDoesNotBody')}</p>
        <p className={styles.firstRunBody}>{t('today.firstRun.clockNote')}</p>
      </details>
    </section>
  );
}
