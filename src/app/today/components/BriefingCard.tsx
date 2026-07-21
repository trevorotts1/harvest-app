// uiux §4.1 Briefing Card / §5.2 zone 2 — Overnight Briefing. States: ready (real narrative lines +
// receipts), first_day (pre-first-action), agents_resting (Claude/CFE outage — never fabricates,
// master spec §18.6), empty (a quiet night, not an error), and this zone's OWN error state.

import { useCallback, useEffect, useState } from 'react';

import styles from '../today.module.css';
import type { BriefingZoneData, ZoneResult } from '@/services/mission-control/types';
import { useT } from '@/app/locale-context';

export interface BriefingCardProps {
  result: ZoneResult<BriefingZoneData>;
}

function freshnessLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return `as of ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

// T-52 (WCAG 2.2 AA §17.4 / uiux §6.1 items 5 + 6) — "Briefing" narration script, verbatim:
// "While you slept: {line 1}. {line 2}. … Double-tap any line for receipts." — narrative first,
// chrome last. Each `line.text` from briefing.ts already opens with its own "While you slept: "
// lead-in (composed per-agent, not per-utterance), so that prefix is stripped before joining —
// otherwise a rep with 2+ agent lines would hear "While you slept: ... While you slept: ..."
// repeated once per line instead of the spec's single, one-time lead-in.
const LEADING_WHILE_YOU_SLEPT_RE = /^while you slept:\s*/i;

function stripLeadingWhileYouSlept(text: string): string {
  return text.replace(LEADING_WHILE_YOU_SLEPT_RE, '');
}

/** The VISIBLE narrative for the `ready` state — exactly what's on screen (badge text + each
 *  line's text, "While you slept:" said once). Shared by the sr-only narration script below AND
 *  the "listen" (TTS) transcript, so §6.1 item 6's "transcript = the visible text, always" holds
 *  by construction, not by two copies that can drift. Exported (same convention as ClosePhase's
 *  `recapLine` / ShiftView's `applyOptimisticAction`) so this invariant is directly unit-testable. */
export function briefingVisibleNarrative(lines: BriefingZoneData['lines']): string {
  const joined = lines.map((l) => stripLeadingWhileYouSlept(l.text)).join(' ');
  return `While you slept: ${joined}`;
}

/** The full §6.1 item 5 screen-reader script — the visible narrative plus the VoiceOver/TalkBack-
 *  specific "Double-tap any line for receipts." instruction, which is deliberately NOT spoken by
 *  the "listen" TTS affordance (it names a screen-reader gesture, not something a sighted listener
 *  following the visible transcript needs read aloud). */
export function briefingSrUtterance(lines: BriefingZoneData['lines']): string {
  return `${briefingVisibleNarrative(lines)} Double-tap any line for receipts.`;
}

export const FIRST_DAY_LINE = "Your field is planted — your agents haven't run yet. Nothing to report, nothing lost.";
export const AGENTS_RESTING_LINE = 'Your agents are resting — everything is saved.';
export const EMPTY_LINE = 'A quiet night — your agents found nothing that needed you.';

function hasSpeechSynthesis(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export default function BriefingCard({ result }: BriefingCardProps) {
  const t = useT();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // T-52 (WCAG 2.2 AA §17.4 / uiux §6.1 item 6) — "TTS briefing: the 'listen' affordance plays the
  // briefing as audio (system TTS in v1) — an accessibility feature that seeds the Phase-2 Voice
  // Check-In; transcript = the visible text, always." T-51 parity found this entirely absent.
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);

  useEffect(() => {
    setTtsSupported(hasSpeechSynthesis());
    return () => {
      if (hasSpeechSynthesis()) window.speechSynthesis.cancel();
    };
  }, []);

  const speak = useCallback((text: string) => {
    if (!hasSpeechSynthesis()) return;
    window.speechSynthesis.cancel(); // a fresh listen always replaces whatever was mid-utterance
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    if (hasSpeechSynthesis()) window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  const toggleListen = useCallback(
    (transcript: string) => {
      if (isSpeaking) stopSpeaking();
      else speak(transcript);
    },
    [isSpeaking, speak, stopSpeaking]
  );

  if (result.status === 'error') {
    return (
      <section className={styles.zoneCard} data-zone="briefing">
        <span className={styles.zoneBadge}>{t('today.briefingCard.whileYouSlept')}</span>
        <p className={styles.zoneErrorText}>{result.message}</p>
      </section>
    );
  }

  const { state, freshnessStamp, lines } = result.data;
  const stamp = freshnessLabel(freshnessStamp);

  // §6.1 item 6: the transcript is ALWAYS the visible text — one switch, matching the one below
  // that decides what actually renders on screen for each state.
  const transcript =
    state === 'ready'
      ? lines.length > 0
        ? briefingVisibleNarrative(lines)
        : null
      : state === 'first_day'
        ? FIRST_DAY_LINE
        : state === 'agents_resting'
          ? AGENTS_RESTING_LINE
          : EMPTY_LINE;

  return (
    <section className={styles.zoneCard} data-zone="briefing" data-briefing-state={state}>
      <div className={styles.zoneHeaderRow}>
        <span className={styles.zoneBadge}>{t('today.briefingCard.whileYouSlept')}</span>
        {stamp && <span className={styles.freshnessStamp}>{stamp}</span>}
        {ttsSupported && transcript && (
          <button
            type="button"
            className={styles.listenButton}
            onClick={() => toggleListen(transcript)}
            aria-pressed={isSpeaking}
          >
            <span aria-hidden="true">{isSpeaking ? '⏸' : '🔊'}</span>
            {isSpeaking ? 'Stop' : 'Listen'}
          </button>
        )}
      </div>

      {state === 'first_day' && <p className={styles.narrativeLine}>{FIRST_DAY_LINE}</p>}
      {state === 'agents_resting' && <p className={styles.narrativeLine}>{AGENTS_RESTING_LINE}</p>}
      {state === 'empty' && <p className={styles.narrativeLine}>{EMPTY_LINE}</p>}
      {state === 'ready' && lines.length > 0 && (
        <p className={styles.srOnly}>{briefingSrUtterance(lines)}</p>
      )}
      {state === 'ready' &&
        lines.map((line, i) => (
          <div key={i} className={styles.briefingLine}>
            <button
              type="button"
              className={styles.briefingLineButton}
              onClick={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  return next;
                })
              }
              aria-expanded={expanded.has(i)}
              disabled={line.receipts.length === 0}
            >
              <span className={styles.narrativeLine}>{line.text}</span>
              {line.receipts.length > 0 && <span className={styles.receiptChevron} aria-hidden="true">›</span>}
            </button>
            {expanded.has(i) && line.receipts.length > 0 && (
              <ul className={styles.receiptsList}>
                {line.receipts.map((r) => (
                  <li key={r.agentRunId}>
                    {r.agentDisplayName} · {r.action} · {new Date(r.when).toLocaleString()}
                    {r.cfeBand ? ` · CFE ${r.cfeBand}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
    </section>
  );
}
