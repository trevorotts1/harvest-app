// T-55 (master-spec §17.7 "no screen ever renders blank ... or a spinner without narrative" / uiux
// §6.6 "Learn → fully populated from day zero ... never renders as under-construction") —
// CourseModulesList's zero-data / failed-load states. Before this fix, a transient
// `/api/gamification/course` failure left LearnPage's `modules` state at its initial `[]` forever
// with no narrative — the "Course modules" section rendered a header over a silently empty list.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import CourseModulesList, { type CourseModuleSummary } from '@/app/learn/components/CourseModulesList';

const render = (props: Parameters<typeof CourseModulesList>[0]) =>
  renderToStaticMarkup(createElement(CourseModulesList, props));
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');

const noop = () => {};

describe('CourseModulesList — zero-data states never render blank (SC9)', () => {
  test('loading has no explicit branch here (page owns the spinner) — an empty module list with state=loading renders without throwing and without listing modules', () => {
    expect(() => render({ state: 'loading', modules: [], onRetry: noop })).not.toThrow();
    const html = render({ state: 'loading', modules: [], onRetry: noop });
    expect(textOf(html).trim()).toBe('');
  });

  test('a genuine zero-module "ready" state renders a next-step narrative, never a blank list', () => {
    const html = render({ state: 'ready', modules: [], onRetry: noop });
    const text = textOf(html);
    expect(text).toContain('Your course is being prepared');
    expect(text).toContain('referral script');
  });

  test('a failed load renders an honest narrative + a working Retry affordance, never a blank list', () => {
    const html = render({ state: 'failed', modules: [], onRetry: noop });
    const text = textOf(html);
    expect(text).toContain('load your course modules right now');
    expect(text).toContain('Retry');
  });

  test('a populated module list renders every module and no empty-state narrative', () => {
    const modules: CourseModuleSummary[] = [
      { key: 'm1', order: 1, title: 'Module One', summary: 'The first module.', status: 'NOT_STARTED', completedAt: null },
      { key: 'm2', order: 2, title: 'Module Two', summary: 'The second module.', status: 'IN_PROGRESS', completedAt: null },
    ];
    const html = render({ state: 'ready', modules, onRetry: noop });
    const text = textOf(html);
    expect(text).toContain('Module One');
    expect(text).toContain('Module Two');
    expect(text).not.toContain('being prepared');
    expect(text).not.toContain("couldn't load");
  });

  test('never throws across every state × module-count combination', () => {
    const modules: CourseModuleSummary[] = [
      { key: 'm1', order: 1, title: 'M', summary: 'S', status: 'COMPLETED', completedAt: '2026-01-01T00:00:00Z' },
    ];
    for (const state of ['loading', 'ready', 'failed'] as const) {
      for (const m of [[], modules]) {
        expect(() => render({ state, modules: m, onRetry: noop })).not.toThrow();
      }
    }
  });
});
