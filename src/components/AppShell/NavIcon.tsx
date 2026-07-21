// T-57 R2 (uiux §2.1 icon column) — the persistent nav's destination glyphs, as inline,
// decorative SVGs (`aria-hidden`, `stroke: currentColor`) so they tint with the link's own
// rest/hover/active color and carry NO accessible name of their own (the adjacent label text is the
// accessible name — uiux §2.2 "never icon-only ... an always-visible label"). No raw text nodes and
// no user-facing string attributes here, so the no-literals lint has nothing to flag.

import type { NavIconKey } from './navConfig';

const PATHS: Record<NavIconKey, string> = {
  // sun-today
  today: 'M12 3v2M12 19v2M5 12H3M21 12h-2M6 6 4.5 4.5M18 6l1.5-1.5M6 18l-1.5 1.5M18 18l1.5 1.5M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  // people-community
  community: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20c0-3 2.7-5 6-5s6 2 6 5M17 11a3 3 0 1 0-1-5.8M21 20c0-2.6-1.6-4.4-4-4.9',
  // sapling-grow
  grow: 'M12 21v-8M12 13c0-3 2-5 5-5-.2 3-2 5-5 5ZM12 13c0-3-2-5-5-5 .2 3 2 5 5 5ZM9 21h6',
  // book-learn
  learn: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5ZM4 20.5A2.5 2.5 0 0 1 6.5 18H20',
  // person-me
  me: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 20c0-3.3 3.1-6 7-6s7 2.7 7 6',
  // graph-ratio (team)
  team: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8M20 16v-3',
  // inbox / approvals tray
  inbox: 'M4 13h4l1.5 3h5L16 13h4M4 13l2-8h12l2 8M4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
};

export interface NavIconProps {
  icon: NavIconKey;
}

export default function NavIcon({ icon }: NavIconProps) {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[icon]} />
    </svg>
  );
}
