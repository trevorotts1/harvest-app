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

import { useT } from '@/app/locale-context';
import { StatusMessage } from '@/components/StatusMessage';

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
  const t = useT();
  return (
    <div className="stack" style={{ marginTop: 16 }}>
      {state === 'failed' && (
        /* T-57 RG7 (SC 4.1.3) — modules-load failure announced via StatusMessage (role=alert). */
        <StatusMessage style={{ color: 'var(--muted)' }}>
          {t('learn.courseModules.loadFailed')}{' '}
          <button type="button" className="badge" onClick={onRetry} style={{ cursor: 'pointer' }}>
            {t('common.retry')}
          </button>
        </StatusMessage>
      )}
      {state === 'ready' && modules.length === 0 && (
        <p style={{ color: 'var(--muted)' }}>
          {t('learn.courseModules.emptyState')}{' '}
          <Link href="/learn/referrals">{t('learn.courseModules.referralScriptLink')}</Link>.
        </p>
      )}
      {modules.map((m) => (
        <Link key={m.key} href={`/learn/course/${m.key}`} className="action-row" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="priority">{m.order}</span>
          <div>
            <strong>{m.title}</strong><br />
            <span style={{ color: 'var(--muted)' }}>{m.summary}</span>
          </div>
          <span className="badge">
            {t(
              m.status === 'COMPLETED'
                ? 'learn.courseModules.status.done'
                : m.status === 'IN_PROGRESS'
                  ? 'learn.courseModules.status.inProgress'
                  : 'learn.courseModules.status.start'
            )}
          </span>
        </Link>
      ))}
    </div>
  );
}
