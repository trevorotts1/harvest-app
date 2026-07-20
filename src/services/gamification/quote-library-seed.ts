// T-43 (WP07 §12.4) — the Quote Library's built-in content. `org_scope: 'ALL'` = general motivation
// + famous figures (shown to every rep); `org_scope: 'PRIMERICA'` = Primerica leadership/field
// language (shown ONLY when the rep's org is Primerica, weighted-mixed with the general set — never
// shown standalone to a non-Primerica rep, §0.4 rule 4 / §18.7).
//
// This static, in-code list is the AUTHORITATIVE content source — `quote.service.ts` reads it
// directly rather than depending on `QuoteLibrary` having been seeded in a live database first (this
// build has no live DB in its sandbox to run a seed script against, and depending on one would risk
// a blank Quote surface on a fresh deploy, SC9). `prisma/seed.ts` ALSO upserts these same rows into
// `QuoteLibrary` (so an admin can curate/add more later through that table) — `quote.service.ts`
// merges both sources, static + DB, at read time.
//
// CFE NOTE (read before adding a quote here): every quote line below is written to be doctrine-clean
// (no "guaranteed"/"you will earn" language, §0.5), but writing clean content here is NOT what makes
// a quote safe to show — `quote.service.ts`'s delivery path calls the live CFE on the FINAL rendered
// text (with the rep's anchor line inserted) on every single delivery, never trusting a cached flag.
// That is what the master spec means by "every quote passes the CFE" and what the QC break-it pass
// tests directly (injecting an income-promise line and confirming the CFE — not this file — catches
// it).

export interface StaticQuote {
  id: string;
  text: string;
  attribution: string | null;
  org_scope: 'ALL' | 'PRIMERICA';
  tags: string[];
}

export const STATIC_QUOTE_LIBRARY: StaticQuote[] = [
  // ── General motivation + famous figures (org_scope: ALL) ──────────────────────────────────────
  { id: 'general-1', text: 'Small, consistent actions compound into a harvest no single big swing ever could.', attribution: null, org_scope: 'ALL', tags: ['consistency', 'morning'] },
  { id: 'general-2', text: "The way to get started is to quit talking and begin doing.", attribution: 'Walt Disney', org_scope: 'ALL', tags: ['famous_figure', 'morning'] },
  { id: 'general-3', text: 'Service, not extraction, is what makes a community want to grow with you.', attribution: null, org_scope: 'ALL', tags: ['collective_benefit', 'midday'] },
  { id: 'general-4', text: "It is during our darkest moments that we must focus to see the light.", attribution: 'Aristotle Onassis', org_scope: 'ALL', tags: ['famous_figure', 'evening'] },
  { id: 'general-5', text: 'You already believe in what you introduce today — that belief is the whole engine.', attribution: null, org_scope: 'ALL', tags: ['belief', 'morning'] },
  { id: 'general-6', text: "Success is the sum of small efforts repeated day in and day out.", attribution: 'Robert Collier', org_scope: 'ALL', tags: ['famous_figure', 'habit'] },
  { id: 'general-7', text: 'A quiet field is not a dead field — it is ready for one small action.', attribution: null, org_scope: 'ALL', tags: ['resilience', 'evening'] },
  { id: 'general-8', text: "The best time to plant a tree was 20 years ago. The second best time is now.", attribution: 'Chinese Proverb', org_scope: 'ALL', tags: ['famous_figure', 'morning'] },
  { id: 'general-9', text: 'Every introduction you make in genuine service plants something that outlasts today.', attribution: null, org_scope: 'ALL', tags: ['grow', 'midday'] },
  { id: 'general-10', text: "What you do every day matters more than what you do once in a while.", attribution: 'Gretchen Rubin', org_scope: 'ALL', tags: ['famous_figure', 'habit'] },
  // ── Primerica leadership / field language (org_scope: PRIMERICA) ─────────────────────────────
  { id: 'primerica-1', text: 'You are not selling a product — you are sharing a philosophy that already changed your own life.', attribution: null, org_scope: 'PRIMERICA', tags: ['field', 'morning'] },
  { id: 'primerica-2', text: 'Do the business, and the business will do for you what it did for the person who introduced it to you.', attribution: null, org_scope: 'PRIMERICA', tags: ['field', 'midday'] },
  { id: 'primerica-3', text: "Rent v. own is a conversation you are having anyway — you are just handing someone a mirror.", attribution: null, org_scope: 'PRIMERICA', tags: ['field', 'evening'] },
  { id: 'primerica-4', text: 'The field wins when the whole team wins — that is the only kind of harvest worth having.', attribution: null, org_scope: 'PRIMERICA', tags: ['collective_benefit', 'midday'] },
  { id: 'primerica-5', text: "Your warm market already trusts you. Today, that trust is the whole opportunity.", attribution: null, org_scope: 'PRIMERICA', tags: ['field', 'morning'] },
];

export function staticQuotesForOrg(isPrimerica: boolean): StaticQuote[] {
  return STATIC_QUOTE_LIBRARY.filter((q) => (isPrimerica ? true : q.org_scope === 'ALL'));
}
