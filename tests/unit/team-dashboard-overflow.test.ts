// T-57 R1c (parity defect MAJOR-C3) — the Team roster table (src/app/team/page.tsx) rendered a bare
// `<table>` that overflowed the viewport below the 860px nav breakpoint (globals.css's
// `table { min-width: 560px }`, no wrapper). Fix: wrap it in the existing global `.table-wrap`
// scroll container (globals.css — already used at dashboard/contact-upload-demo.tsx:144), which
// contains the horizontal scroll to the card instead of the page.
//
// `TeamDashboardPage` is a stateful, fetch-orchestrating container whose "ready" (roster-table)
// state is only reachable after its `useEffect`-driven fetch resolves — unreachable in this repo's
// no-jsdom, single-pass `renderToStaticMarkup` Jest env (see team-dashboard-i18n.test.ts's header
// note; same constraint documented for other stateful "screen" containers in
// community-import-page.test.ts). Per that established convention, this proves the wiring via a
// source-text assertion instead of a render.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PAGE_SRC = readFileSync(
  path.join(__dirname, '..', '..', 'src', 'app', 'team', 'page.tsx'),
  'utf8'
);

describe('Team dashboard roster table — overflow container (T-57 R1c, C3)', () => {
  test('the roster <table> is wrapped in the global .table-wrap scroll container', () => {
    expect(PAGE_SRC).toMatch(/<div className="table-wrap">\s*<table[\s>]/);
  });

  test('the wrapper is closed after the table (no stray/unbalanced markup)', () => {
    const wrapOpen = PAGE_SRC.indexOf('<div className="table-wrap">');
    const tableClose = PAGE_SRC.indexOf('</table>', wrapOpen);
    const wrapClose = PAGE_SRC.indexOf('</div>', tableClose);
    expect(wrapOpen).toBeGreaterThan(-1);
    expect(tableClose).toBeGreaterThan(wrapOpen);
    expect(wrapClose).toBeGreaterThan(tableClose);
  });

  test('there is exactly one <table> on the page, and it is the wrapped one (no un-wrapped second table regresses in later edits)', () => {
    const tableOpenCount = (PAGE_SRC.match(/<table[\s>]/g) ?? []).length;
    expect(tableOpenCount).toBe(1);
  });
});
