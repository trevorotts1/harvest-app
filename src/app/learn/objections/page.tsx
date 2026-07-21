import { redirect } from 'next/navigation';

/**
 * T-57 R3c-1 (MINOR-m2, uiux §2.4 route map: "`/learn` · `/learn/course/{module}` ·
 * `/learn/objections` · `/learn/referrals` — Learn surfaces"). `/learn/objections` names the
 * Socratic objection-coaching feature (master-spec §10.7; uiux §5.7 "a `book-learn` affordance on
 * the composer opens the Socratic objection tree ... labeled coaching — only you see this"). That
 * feature is real and shipped (`ObjectionCoachPanel`, `POST /api/messaging/objection`) but is
 * deliberately IN-THREAD/per-contact — it needs a `contactId` to prepare a held draft against, so
 * there is no contact-agnostic "objections library" page for a bare `/learn/objections` visit to
 * render. The honest alias (§2.4 "never a 404 dead end") is Community: pick a contact, then the
 * real coach panel is right there on that contact's conversation surface — not `/learn` itself,
 * which would land the rep on an unrelated hub with no path to this specific feature at all.
 */
export default function LearnObjectionsAliasPage() {
  redirect('/community');
}
