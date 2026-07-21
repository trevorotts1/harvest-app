// T-39 QC FIX 1 (uiux §5.7 "Messaging & the Composer Handoff" / §4.7 "Conversation Timeline Entry")
// — the contact-detail / conversation surface. Before this fix, `ConversationTimeline`,
// `AgentSentBadge`, and `ThreeWayHandoffCard` existed under `../components/` but were mounted on NO
// route, so a rep could never actually reach a contact's conversation (the QC-critical finding this
// route closes). This page composes them over the REAL, session-scoped, ownership-checked,
// DECRYPTED read at `/api/contacts/[contactId]/conversation` (ConversationTimelineService) — the
// same client-fetch convention already established by `../page.tsx` (Community home) and
// `../../inbox/page.tsx`.
//
// Session-gated: `/community/:path*` is already in `src/middleware.ts`'s matcher AND
// `GATED_DOWNSTREAM_PAGE_PREFIXES` (onboarding-gate-edge.ts) — this route is a subpath of
// `/community`, so it inherits the hard onboarding gate with no middleware change needed (see
// tests/unit/conversation-mount.test.ts's `isGatedDownstreamPage('/community/<id>')` proof). The API
// route behind it is independently session-gated via `withOnboardingGate`.
//
// Reachable from the Community list: `../components/ContactCard.tsx` links here
// (`/community/${id}`) from every rendered card.
//
// T-57 R3c-2 (findings M5) — `load()` now RETURNS the freshly-fetched contact (previously `void`),
// so the one-tap STOP/opt-out action mounted below can ask this page to re-fetch the canonical
// record and report back the FRESH `doNotContact` value for its own fail-closed confirmation,
// without a second, duplicate read implementation. Every existing caller of `load` (the mount
// effect, `ComposerHandoffSheet`'s `onConfirmed`) keeps compiling unchanged — a function returning
// a value remains assignable wherever a `() => void`-shaped callback was expected.

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import ConversationTimeline, { type TimelineEntry } from '../components/ConversationTimeline';
import SequenceEnrollPanel from '../components/SequenceEnrollPanel';
import ObjectionCoachPanel from '../components/ObjectionCoachPanel';
import BridgeUplinePanel from '../components/BridgeUplinePanel';
import ComposerHandoffSheet from '../components/ComposerHandoffSheet';
import { resolveFirstTouchDraftId } from '../components/resolve-first-touch-draft';
import styles from '../conversation.module.css';
import { useT } from '@/app/locale-context';

interface ConversationContact {
  id: string;
  name: string;
  doNotContact: boolean;
  agentsPaused: boolean;
}

interface PageProps {
  params: { contactId: string };
}

export default function ContactConversationPage({ params }: PageProps) {
  const t = useT();
  const { contactId } = params;

  const [contact, setContact] = useState<ConversationContact | null>(null);
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // T-57 R3a (§5.7) — fresh first-touch composer handoff from this contact's conversation surface.
  const [composer, setComposer] = useState<{ draftId: string; contactName: string } | null>(null);
  const [resolvingFirstTouch, setResolvingFirstTouch] = useState(false);
  const [noFirstTouchDraft, setNoFirstTouchDraft] = useState(false);

  const load = useCallback(async (): Promise<ConversationContact | null> => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const res = await fetch(`/api/contacts/${contactId}/conversation`);
      if (res.status === 404) {
        setNotFound(true);
        setContact(null);
        setEntries([]);
        return null;
      }
      if (!res.ok) {
        setError(t('community.conversation.loadFailedGeneric'));
        return null;
      }
      const body = await res.json();
      setContact(body.contact);
      setEntries((body.entries ?? []) as TimelineEntry[]);
      return (body.contact ?? null) as ConversationContact | null;
    } catch {
      setError(t('community.conversation.loadFailedGeneric'));
      return null;
    } finally {
      setLoading(false);
    }
  }, [contactId, t]);

  // T-57 R3c-2 (M5) — the fail-closed confirmation step `ConversationTimeline`'s one-tap STOP action
  // calls after its own two writes (`POST /api/compliance/opt-out` + `PATCH /api/contacts/controls`)
  // both succeed. Re-fetching through the SAME `load()` this page already uses for its initial read
  // means the confirmation is a genuine, fresh, server-authoritative read — never a client-side
  // assumption — and it also keeps this page's own `contact`/`entries` state in sync (the header's
  // do-not-contact chip and the rep-actions region both react immediately).
  const confirmOptOut = useCallback(async (): Promise<boolean> => {
    const fresh = await load();
    return Boolean(fresh?.doNotContact);
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleStartFirstTouch() {
    if (!contact) return;
    setNoFirstTouchDraft(false);
    setResolvingFirstTouch(true);
    const draftId = await resolveFirstTouchDraftId(contact.id);
    setResolvingFirstTouch(false);
    if (draftId) setComposer({ draftId, contactName: contact.name });
    else setNoFirstTouchDraft(true);
  }

  return (
    <div className={styles.conversationPage}>
      <div className={styles.conversationShell}>
        <Link href="/community" className={styles.backLink}>
          {t('community.backToCommunityCta')}
        </Link>

        {loading && (
          <p className={styles.timelineEmpty} role="status">
            {t('community.conversation.loading')}
          </p>
        )}

        {!loading && notFound && (
          <p className={styles.timelineEmpty} role="status">
            {t('community.conversation.notFound')}
          </p>
        )}

        {!loading && !notFound && error && (
          <div className={styles.timelineEmpty}>
            <p>{error}</p>
            <button type="button" className={styles.retryButton} onClick={() => load()}>
              {t('common.retry')}
            </button>
          </div>
        )}

        {!loading && !notFound && !error && contact && (
          <>
            <div className={styles.conversationHeader}>
              <h1 className={styles.conversationTitle}>{contact.name}</h1>
              <div className={styles.chipRow}>
                {contact.doNotContact && <span className={styles.identityChip}>{t('community.conversation.doNotContactChip')}</span>}
                {contact.agentsPaused && <span className={styles.identityChip}>{t('community.conversation.agentsPausedChip')}</span>}
              </div>
            </div>
            <ConversationTimeline
              entries={entries}
              contactId={contact.id}
              doNotContact={contact.doNotContact}
              onOptOutConfirm={confirmOptOut}
            />

            {/* T-40R (uiux §5.7) — the rep-facing WRITE affordances that route through the gated
                messaging surfaces: start a sequence (§10.2), the objection coach (§10.7, only you see
                it), and bridge my upline (§10.6). Withheld once a contact has opted out — the send
                gates would HELD anyway, but the UI should never even offer it. */}
            {!contact.doNotContact && (
              <div className={styles.repActionsRegion}>
                {/* T-57 R3a (§5.7 AC-5.7-1) — fresh own-number first touch from your own number.
                    The sheet re-asserts CFE clearance fail-closed before rendering any text. */}
                <button
                  type="button"
                  className={styles.repActionButton}
                  onClick={handleStartFirstTouch}
                  aria-label={t('composer.startFirstTouchAria', { name: contact.name })}
                  disabled={resolvingFirstTouch}
                >
                  {resolvingFirstTouch ? t('composer.resolving') : t('composer.startFirstTouch')}
                </button>
                {noFirstTouchDraft && (
                  <p className={styles.timelineEmpty} role="status">
                    {t('composer.noDraftReady')}
                  </p>
                )}
                <SequenceEnrollPanel contactId={contact.id} />
                <ObjectionCoachPanel contactId={contact.id} />
                <BridgeUplinePanel contactId={contact.id} />
              </div>
            )}
          </>
        )}
      </div>

      <ComposerHandoffSheet
        open={composer !== null}
        draftId={composer?.draftId ?? null}
        contactName={composer?.contactName ?? ''}
        onClose={() => setComposer(null)}
        onConfirmed={load}
      />
    </div>
  );
}
