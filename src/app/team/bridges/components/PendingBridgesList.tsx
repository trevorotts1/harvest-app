// T-55 (master-spec §17.7 "every list has an empty state with one action") — the pending-bridges
// list, extracted from TeamBridgesPage so its zero-item state is independently testable via
// `renderToStaticMarkup` (this repo's Jest config runs `testEnvironment: 'node'` — no DOM/jsdom, see
// jest.config.js — the same seam convention as CourseModulesList.tsx / ConversationTimeline.tsx).
//
// Before this fix, a quiet queue rendered "No pending bridge requests right now." with no next step
// at all — the platform rule names "every list has an empty state with one action" (§17.7).

import Link from 'next/link';

import { useT } from '@/app/locale-context';
import PendingBridgeItem, { type PendingBridgeData } from './PendingBridgeItem';

export interface PendingBridgesListProps {
  items: PendingBridgeData[];
  onJoin: (handoffId: string) => Promise<{ ok: boolean; error?: string }>;
}

export default function PendingBridgesList({ items, onJoin }: PendingBridgesListProps) {
  const t = useT();
  if (items.length === 0) {
    return (
      <p style={{ color: 'var(--muted)', marginTop: 12 }}>
        {t('team.bridges.list.emptyNotice')} <Link href="/team">{t('team.bridges.list.backToTeamCta')}</Link>.
      </p>
    );
  }

  return (
    <div className="stack" style={{ marginTop: 16 }}>
      {items.map((item) => (
        <PendingBridgeItem key={item.id} item={item} onJoin={onJoin} />
      ))}
    </div>
  );
}
