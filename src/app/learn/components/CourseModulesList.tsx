// T-55 (master-spec §17.7 / uiux §6.6 "Learn → fully populated from day zero ... never renders as
// under-construction") — the Course modules list, extracted from LearnPage so its zero-data /
// failed-load states are independently testable via `renderToStaticMarkup` (this repo's Jest config
// runs `testEnvironment: 'node'` — no DOM/jsdom, see jest.config.js — so a fetch-driven page
// component's resolved states can't be reached by rendering the page itself; presentational
// sub-components that take already-resolved props, like this one, are this codebase's established
// seam for that — see ConversationTimeline.tsx / ActionQueue.tsx / RatioCards.tsx for the same
// convention).
//
// Before this extraction, a transient `/api/gamification/course` failure left the page's `modules`
// state at its initial `[]` with no narrative at all — the "Course modules" header rendered over a
// silently empty list, a narrative-free blank region (SC9). This component now names every state.

import Link from 'next/link';

export type CourseLoadState = 'loading' | 'ready' | 'failed';

export interface CourseModuleSummary {
  key: string;
  order: number;
  title: string;
  summary: string;
  status: string;
  completedAt: string | null;
}

export interface CourseModulesListProps {
  state: CourseLoadState;
  modules: CourseModuleSummary[];
  onRetry: () => void;
}

export default function CourseModulesList({ state, modules, onRetry }: CourseModulesListProps) {
  return (
    <div className="stack" style={{ marginTop: 16 }}>
      {state === 'failed' && (
        <p style={{ color: 'var(--muted)' }}>
          We couldn&apos;t load your course modules right now — nothing was lost.{' '}
          <button type="button" className="badge" onClick={onRetry} style={{ cursor: 'pointer' }}>
            Retry
          </button>
        </p>
      )}
      {state === 'ready' && modules.length === 0 && (
        <p style={{ color: 'var(--muted)' }}>
          Your course is being prepared — check back shortly, or start with{' '}
          <Link href="/learn/referrals">a referral script</Link>.
        </p>
      )}
      {modules.map((m) => (
        <Link key={m.key} href={`/learn/course/${m.key}`} className="action-row" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="priority">{m.order}</span>
          <div>
            <strong>{m.title}</strong><br />
            <span style={{ color: 'var(--muted)' }}>{m.summary}</span>
          </div>
          <span className="badge">{m.status === 'COMPLETED' ? 'Done' : m.status === 'IN_PROGRESS' ? 'In progress' : 'Start'}</span>
        </Link>
      ))}
    </div>
  );
}
