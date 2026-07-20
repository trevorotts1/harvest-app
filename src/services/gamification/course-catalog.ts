// T-43 (WP07 §12.8) — the Downline Maxxing course. Ships as PLACEHOLDER-PLUS-ROADMAP in v1 — a
// DISCLOSED scope decision (§1.6: "A fully authored Downline Maxxing course and the Harvest book...
// ship as placeholder-plus-roadmap per the roadmap's own note; the data models for course progress
// and certification are scaffolded now"), NOT an empty stub: every module below has real, complete,
// doctrine-clean, CFE-verified body content (proven by `tests/unit/gamification-course-cfe.test.ts`,
// which runs every module's body through the real CFE pipeline) — there is genuine substance to read
// today, plus an honest, visible disclosure that the full curriculum keeps expanding (uiux §6.6
// "Learn -> fully populated from day zero with the v1 course edition... never renders as under-
// construction").

export interface CourseModule {
  key: string;
  order: number;
  title: string;
  summary: string;
  body: string;
}

export const ROADMAP_DISCLOSURE =
  'This is v1 of the Downline Maxxing course — five foundational modules, live today. New modules ' +
  'and the full Harvest book publish on an ongoing roadmap; nothing here is a placeholder for content ' +
  'that does not exist yet — it is real, complete, and yours to use right now.';

export const COURSE_MODULES: CourseModule[] = [
  {
    key: 'three_laws',
    order: 1,
    title: 'The Three Laws',
    summary: 'Why growth, engagement, and wealth only work together.',
    body:
      'Downline Maxxing rests on three laws that must run at the same time: growing your downline, ' +
      'engaging your base, and increasing your wealth. Run one without the others and the system ' +
      'reverses — a downline with no engaged base burns out; wealth with no collective benefit becomes ' +
      'extraction, not a harvest. This course, and this app, exist to keep all three moving together, ' +
      'every day, in small and steady amounts. You will not be asked to choose one law over the others. ' +
      'When you notice one going quiet, that is the signal to act there next — not to abandon the ' +
      'others, and never a reason to feel behind.',
  },
  {
    key: 'warm_market_mindset',
    order: 2,
    title: 'Warm Market Mindset: Service Over Extraction',
    summary: 'You are a recommendation specialist, not a salesperson.',
    body:
      'Your community already trusts you. That trust is the entire opportunity, and it is also the ' +
      'entire responsibility. Every name in your Vault is a person you can genuinely serve — never a ' +
      'contact selected for what they might be worth to you. When you reach out, you are making a warm ' +
      'community introduction: sharing something you believe in with someone you already care about, in ' +
      'a context that is already warm. If a name does not fit that description, it does not belong in ' +
      'your queue. Service, offered honestly, is what makes people want to build alongside you.',
  },
  {
    key: 'anchor_and_belief',
    order: 3,
    title: 'The Anchor Statement & Belief',
    summary: 'Why your own "why" is the whole engine.',
    body:
      'Your anchor statement — the reason you are doing this — is not a slogan. It is the thing you ' +
      'come back to on the days momentum is quiet. Belief compounds the same way consistency does: the ' +
      'more you return to your own honest reasons, the more genuine your community introductions sound, ' +
      'and the more naturally people respond to them. If your belief ever feels shaky, that is not a ' +
      'sign to push harder — it is a signal to revisit your Seven Whys and remember why you started. ' +
      'The platform will gently remind you of your own words; it will never manufacture new ones for ' +
      'you.',
  },
  {
    key: 'consistency_ritual',
    order: 4,
    title: 'Consistency & the 30-Minute Ritual',
    summary: 'Brilliance is optional. Consistency compounds.',
    body:
      'The daily ritual is designed to take about 30 minutes and end with an explicit permission to ' +
      'stop. That boundary is intentional: an interface that invites endless scrolling breaks the whole ' +
      'promise of this platform. Showing up for a small, bounded amount of time, every day, beats a rare ' +
      'burst of intensity that burns out in a week. Streaks in this app include a compassionate repair — ' +
      'one grace day a week at Low intensity — because life happens, and a single missed day should ' +
      'never erase a real pattern of showing up.',
  },
  {
    key: 'collective_benefit',
    order: 5,
    title: 'Collective Benefit & the Anti-Hoarder Pattern',
    summary: 'The harvest is collective, or it is not a harvest.',
    body:
      'Wealth that only flows upward is extraction, not a harvest. This platform ranks team wins above ' +
      'individual wins for a reason: a downline that only benefits the person at the top eventually ' +
      'collapses, because nobody beneath them has a reason to keep building. The "Harvest Hoarder" ' +
      'pattern — high personal gain with no investment in the people you brought in — is something this ' +
      'course flags honestly, never something it celebrates. Watching for your own balance between ' +
      'personal wealth and genuinely helping the people in your downline succeed is part of doing this ' +
      'work well, not an extra chore on top of it.',
  },
];

export function getCourseModule(key: string): CourseModule | undefined {
  return COURSE_MODULES.find((m) => m.key === key);
}
