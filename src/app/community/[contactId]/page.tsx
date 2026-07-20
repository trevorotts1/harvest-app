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

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import ConversationTimeline, { type TimelineEntry } from '../components/ConversationTimeline';
import styles from '../conversation.module.css';

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
  const { contactId } = params;

  const [contact, setContact] = useState<ConversationContact | null>(null);
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const res = await fetch(`/api/contacts/${contactId}/conversation`);
      if (res.status === 404) {
        setNotFound(true);
        setContact(null);
        setEntries([]);
        return;
      }
      if (!res.ok) {
        setError('Could not load this conversation. Try again.');
        return;
      }
      const body = await res.json();
      setContact(body.contact);
      setEntries((body.entries ?? []) as TimelineEntry[]);
    } catch {
      setError('Could not load this conversation. Try again.');
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className={styles.conversationPage}>
      <div className={styles.conversationShell}>
        <Link href="/community" className={styles.backLink}>
          ← Back to Community
        </Link>

        {loading && (
          <p className={styles.timelineEmpty} role="status">
            Loading this conversation…
          </p>
        )}

        {!loading && notFound && (
          <p className={styles.timelineEmpty} role="status">
            This contact could not be found in your community.
          </p>
        )}

        {!loading && !notFound && error && (
          <div className={styles.timelineEmpty}>
            <p>{error}</p>
            <button type="button" className={styles.retryButton} onClick={() => load()}>
              Retry
            </button>
          </div>
        )}

        {!loading && !notFound && !error && contact && (
          <>
            <div className={styles.conversationHeader}>
              <h1 className={styles.conversationTitle}>{contact.name}</h1>
              <div className={styles.chipRow}>
                {contact.doNotContact && <span className={styles.identityChip}>Do not contact</span>}
                {contact.agentsPaused && <span className={styles.identityChip}>Agents paused</span>}
              </div>
            </div>
            <ConversationTimeline entries={entries} />
          </>
        )}
      </div>
    </div>
  );
}
