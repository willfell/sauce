#!/usr/bin/env node
/**
 * run-project-dashboard.js — behavioral harness for ProjectDashboard.
 *
 * Zero-dep. Loads the bare-class file via new Function() (mirrors what
 * customJS does at runtime, minus the wrapping parens) and exercises the
 * static helpers + instance render pipeline with DOM + customJS stubs.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

function loadClass(relPath, className) {
    const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    return new Function(`${src}\nreturn ${className};`)();
}

const ProjectDashboard = loadClass(
    'platform/blueprints/project/helpers/project-dashboard.js',
    'ProjectDashboard'
);

let passes = 0, fails = 0;
function ok(label, cond, detail) {
    if (cond) { passes++; console.log('ok ' + label); }
    else { fails++; console.error('FAIL ' + label + (detail ? ' — ' + detail : '')); }
}

// ── DOM stub ────────────────────────────────────────────────────────────────
// Minimal element: createEl(tag), addEventListener, querySelector, style.cssText.
// Tracks children on __children and computed innerHTML/textContent for assertions.
function makeEl(tag) {
    const el = {
        tag,
        textContent: '',
        innerHTML: '',
        className: '',
        style: { cssText: '', setProperty() {} },
        __children: [],
        __listeners: {},
    };
    el.createEl = (t, opts) => {
        const c = makeEl(t);
        if (opts && opts.cls) c.className = opts.cls;
        if (opts && opts.text) c.textContent = opts.text;
        el.__children.push(c);
        return c;
    };
    el.appendChild = (c) => { el.__children.push(c); return c; };
    el.querySelector = () => null;
    el.querySelectorAll = () => [];
    el.getBoundingClientRect = () => ({ left: 0, bottom: 0, width: 100, top: 0 });
    el.remove = () => {};
    el.addEventListener = (ev, fn) => {
        (el.__listeners[ev] = el.__listeners[ev] || []).push(fn);
    };
    el.removeEventListener = () => {};
    el.click = () => { for (const fn of (el.__listeners.click || [])) fn({ target: el }); };
    el.__descendants = function () {
        const out = [];
        for (const c of this.__children) {
            out.push(c);
            if (c.__descendants) out.push(...c.__descendants());
        }
        return out;
    };
    return el;
}

// ── customJS stubs ─────────────────────────────────────────────────────────
global.customJS = global.customJS || {};
global.__mpCalls = [];
global.customJS.MenuPopover = {
    open: (entries, opts) => { global.__mpCalls.push({ entries, opts }); return { __navClose: () => {} }; },
};
global.customJS.SectionLabel = {
    render: (dv, opts) => {
        const c = dv.container || dv;
        const lbl = c.createEl('div');
        lbl.__isSectionLabel = true;
        lbl.textContent = String(opts?.text || '');
    },
    divider: (dv) => (dv.container || dv).createEl('hr'),
};
global.customJS.ProjectChromeBar = {
    ICON: {
        docs: '<svg data-icon="docs"/>',
        board: '<svg data-icon="board"/>',
        todo: '<svg data-icon="todo"/>',
        map: '<svg data-icon="map"/>',
        project: '<svg data-icon="project"/>',
        task: '<svg data-icon="task"/>',
        links: '<svg data-icon="links"/>',
    },
    detectContext: (path) => ({ projectDir: 'spice/projects/foo', projectSlug: 'foo', context: 'project-hub' }),
    navTarget: (dv, c, key) => ({
        docs:  'spice/projects/foo/docs/Docs.md',
        board: 'spice/projects/foo/foo-board.md',
        todo:  'spice/projects/foo/Foo To-Do.md',
        map:   'spice/projects/foo/Sauce - Map.md',
        links: 'spice/projects/foo/Links Hub.md',
    }[key] || null),
};
global.__opens = [];
global.app = {
    workspace: {
        openLinkText: (target, src, newLeaf) => { global.__opens.push({ target, src, newLeaf }); },
    },
};

// ── Stub helpers ───────────────────────────────────────────────────────────
function _stubList(n, type, extra) {
    const arr = [];
    for (let i = 0; i < n; i++) {
        arr.push({
            type,
            ...(extra || {}),
            file: { path: `stub-${i}.md`, name: `stub-${i}`, mtime: { ts: 1_000_000 + i } },
        });
    }
    arr.where = function (pred) {
        const out = this.filter(pred);
        out.where = arr.where;
        return out;
    };
    return arr;
}

function _stubListWithMtimes(specs, type) {
    const arr = specs.map(s => ({
        type,
        ...s,
        file: { path: `${s.name}.md`, mtime: { ts: s.ts }, name: s.name },
    }));
    arr.where = function (pred) {
        const out = this.filter(pred);
        out.where = arr.where;
        return out;
    };
    return arr;
}

function makeApp(files) {
    return {
        vault: {
            read: async (file) => {
                const p = typeof file === 'string' ? file : (file && file.path);
                return files[p] != null ? files[p] : '';
            },
            getAbstractFileByPath: (p) => (files[p] != null ? { path: p } : null),
        },
        fileManager: { processFrontMatter: async () => {} },
        workspace: { openLinkText: (t, s, n) => { global.__opens.push({ target: t, src: s, newLeaf: n }); } },
    };
}

// ============================================================================
// PROJDASH-1 — class instantiates
// ============================================================================
{
    let threw = false;
    try {
        const d = new ProjectDashboard();
        void d.render;
    } catch (e) { threw = true; }
    ok('PROJDASH-1 class instantiates without throwing', !threw);
}

// ============================================================================
// PROJDASH-2 — _projectMatches static
// ============================================================================
{
    const m = ProjectDashboard._projectMatches;
    const p = 'spice/projects/foo/Foo.md';
    ok('PROJDASH-2a string [[Foo]]',    m('[[Foo]]', p, 'Foo') === true);
    ok('PROJDASH-2b string [[Foo|X]]',  m('[[Foo|Alias]]', p, 'Foo') === true);
    ok('PROJDASH-2c string bare name',  m('Foo', p, 'Foo') === true);
    ok('PROJDASH-2d obj by path',       m({ path: p }, p, 'Foo') === true);
    ok('PROJDASH-2e obj by display',    m({ display: 'Foo' }, p, 'Foo') === true);
    ok('PROJDASH-2f no match',          m('Bar', p, 'Foo') === false);
    ok('PROJDASH-2g falsy field',       m(null, p, 'Foo') === false);
}

// ============================================================================
// PROJDASH-3 — _counts
// ============================================================================
(async () => {
    const dash = new ProjectDashboard();
    const currentPath = 'spice/projects/foo/Foo.md';
    const projectName = 'Foo';
    const slug = 'foo';
    const folder = 'spice/projects/foo';
    const dv = {
        current: () => ({ status: 'in-progress', workstreams: ['ws1', 'ws2'], file: { path: currentPath } }),
        pages: (query) => {
            if (query.includes('/docs')) return _stubList(3, 'doc-note');
            if (query.includes('meetings/notes')) return _stubList(4, 'meeting', { project: '[[Foo]]' });
            if (query.includes('/tasks')) return _stubList(0, 'task-note');
            return _stubList(0, null);
        },
    };
    const boardContent = '## Todo\n- [ ] a\n- [ ] b\n## In Progress\n## Completed\n- [ ] should-not-count\n';
    const todoContent = '- [ ] one\n- [x] done\n';
    const localApp = makeApp({
        [`${folder}/${slug}-board.md`]: boardContent,
        [`${folder}/${projectName} To-Do.md`]: todoContent,
    });

    const ctx = { app: localApp, folder, slug, projectName, currentPath };
    const counts = await dash._counts(dv, ctx);
    ok('PROJDASH-3a docs count',     counts.docs === 3, JSON.stringify(counts));
    ok('PROJDASH-3b board count',    counts.board === 2, JSON.stringify(counts));
    ok('PROJDASH-3c todo count',     counts.todo === 1, JSON.stringify(counts));
    ok('PROJDASH-3d map count',      counts.map === 2, JSON.stringify(counts));
    ok('PROJDASH-3e meetings count', counts.meetings === 4, JSON.stringify(counts));
})();

// ============================================================================
// PROJDASH-4 — _recentByKind grouped + capped mtime-sorted lists
// ============================================================================
{
    const dash = new ProjectDashboard();
    const currentPath = 'spice/projects/foo/Foo.md';
    const dv = {
        pages: (query) => {
            if (query.includes('/docs')) return _stubListWithMtimes([
                { ts: 3000, name: 'doc-mid' }, { ts: 6000, name: 'doc-new' },
                { ts: 1000, name: 'doc-old' }, { ts: 2000, name: 'doc-x' }, { ts: 500, name: 'doc-oldest' },
            ], 'doc-note');
            if (query.includes('meetings/notes')) return _stubListWithMtimes([{ ts: 5000, name: 'mtg-newest', project: '[[Foo]]' }], 'meeting');
            if (query.includes('/tasks')) return _stubListWithMtimes([{ ts: 4000, name: 'task-old' }], 'task-note');
            return _stubList(0, null);
        },
    };
    const ctx = { folder: 'spice/projects/foo', projectName: 'Foo', currentPath };
    const groups = dash._recentByKind(dv, ctx);
    ok('PROJDASH-4a docs capped at 4', groups.docs.length === 4, String(groups.docs.length));
    ok('PROJDASH-4b docs newest-first', groups.docs[0].mtime === 6000 && groups.docs[3].mtime === 1000, JSON.stringify(groups.docs.map(r => r.mtime)));
    ok('PROJDASH-4c meetings + tasks split', groups.meetings.length === 1 && groups.tasks.length === 1);
}

// ============================================================================
// PROJDASH-5 — _renderHeader (status pill + MenuPopover)
// ============================================================================
{
    const dash = new ProjectDashboard();
    const container = makeEl('div');
    const currentPage = { status: 'in-progress', file: { path: 'spice/projects/foo/Foo.md' } };
    const ctx = {
        currentPage,
        app: { fileManager: { processFrontMatter: async () => {} } },
        file: currentPage.file,
    };

    global.__mpCalls = [];
    dash._renderHeader(container, ctx);

    const pill = container.__descendants().find(el => el.__isStatusPill);
    ok('PROJDASH-5a pill rendered', !!pill && pill.textContent.toLowerCase() === 'in-progress');
    if (pill) pill.click();
    ok('PROJDASH-5b click opens MenuPopover', global.__mpCalls.length === 1);
    ok('PROJDASH-5c popover has 7 entries',
        global.__mpCalls[0] && global.__mpCalls[0].entries.filter(e => e.label).length === 7,
        global.__mpCalls[0] ? String(global.__mpCalls[0].entries.length) : 'no call');
}

// ============================================================================
// PROJDASH-6 — _renderTiles: 6 tiles, fallback targets (no ChromeBar ctx)
// ============================================================================
{
    const dash = new ProjectDashboard();
    const container = makeEl('div');
    const counts = { docs: 3, board: 2, todo: 1, map: 2, meetings: 4 };
    const ctx = {
        folder: 'spice/projects/foo',
        slug: 'foo',
        projectName: 'Foo',
        currentPath: 'spice/projects/foo/Foo.md',
        // no bar / barCtx → tiles use the hardcoded fallback path table
    };
    dash._renderTiles(container, ctx, counts);

    const tiles = container.__descendants().filter(el => el.__isTile);
    ok('PROJDASH-6a tiles rendered=6', tiles.length === 6, String(tiles.length));
    const labels = tiles.map(t => t.__label).join('|');
    ok('PROJDASH-6b labels ordered', labels === 'Docs|Board|To-Do|Map|Meetings|Helpful Links', labels);
    // Links tile carries NO count chip; the five metric tiles do.
    const chipCounts = tiles.map(t => t.__count);
    ok('PROJDASH-6c counts inline (Links=none)',
        JSON.stringify(chipCounts) === JSON.stringify([3, 2, 1, 2, 4, undefined]), JSON.stringify(chipCounts));

    global.__opens = [];
    tiles[0].click();
    ok('PROJDASH-6d Docs fallback → docs/Docs.md', global.__opens[0] && global.__opens[0].target === 'spice/projects/foo/docs/Docs.md', JSON.stringify(global.__opens[0]));
    tiles[1].click();
    ok('PROJDASH-6e Board fallback → foo-board.md', global.__opens[1] && global.__opens[1].target === 'spice/projects/foo/foo-board.md');
    tiles[2].click();
    ok('PROJDASH-6f To-Do fallback → Foo To-Do.md', global.__opens[2] && global.__opens[2].target === 'spice/projects/foo/Foo To-Do.md');
    tiles[3].click();
    ok('PROJDASH-6g Map fallback → Project Map.md', global.__opens[3] && global.__opens[3].target === 'spice/projects/foo/Project Map.md');
    tiles[4].click();
    ok('PROJDASH-6h Meetings tile → Meetings.md', global.__opens[4] && global.__opens[4].target === 'spice/meetings/Meetings.md');
    tiles[5].click();
    ok('PROJDASH-6i Links fallback → Links Hub.md', global.__opens[5] && global.__opens[5].target === 'spice/projects/foo/Links Hub.md');
}

// ============================================================================
// PROJDASH-10 — _renderTiles delegates to ProjectChromeBar.navTarget
// ============================================================================
{
    const dash = new ProjectDashboard();
    const container = makeEl('div');
    const counts = { docs: 3, board: 2, todo: 1, map: 2, meetings: 4 };
    const ctx = {
        folder: 'spice/projects/foo',
        slug: 'foo',
        projectName: 'Foo',
        currentPath: 'spice/projects/foo/Foo.md',
        dv: {},
        bar: global.customJS.ProjectChromeBar,
        barCtx: { projectDir: 'spice/projects/foo', projectSlug: 'foo' },
    };
    dash._renderTiles(container, ctx, counts);
    const tiles = container.__descendants().filter(el => el.__isTile);

    global.__opens = [];
    tiles[0].click();
    ok('PROJDASH-10a Docs → navTarget docs/Docs.md', global.__opens[0] && global.__opens[0].target === 'spice/projects/foo/docs/Docs.md', JSON.stringify(global.__opens[0]));
    tiles[3].click();
    ok('PROJDASH-10b Map → navTarget map path', global.__opens[1] && global.__opens[1].target === 'spice/projects/foo/Sauce - Map.md', JSON.stringify(global.__opens[1]));
    tiles[5].click();
    ok('PROJDASH-10c Links → navTarget Links Hub.md', global.__opens[2] && global.__opens[2].target === 'spice/projects/foo/Links Hub.md');
}

// ============================================================================
// PROJDASH-7 — _renderRecentGroups (grouped cards; empty groups hide)
// ============================================================================
{
    const dash = new ProjectDashboard();
    const container = makeEl('div');
    const groups = {
        docs: [
            { kind: 'doc', page: { file: { path: 'd1.md', name: 'Doc one', mtime: { ts: 4000 } } }, mtime: 4000 },
            { kind: 'doc', page: { file: { path: 'd2.md', name: 'Doc two', mtime: { ts: 3000 } } }, mtime: 3000 },
        ],
        meetings: [
            { kind: 'meeting', page: { file: { path: 'm1.md', name: 'Meeting one', mtime: { ts: 5000 } } }, mtime: 5000 },
        ],
        tasks: [],
    };
    dash._renderRecentGroups(container, { currentPath: 'cp.md' }, groups);
    const rows = container.__descendants().filter(el => el.__isRecentRow);
    ok('PROJDASH-7a rows rendered=3', rows.length === 3, String(rows.length));
    const secLabels = container.__descendants().filter(el => el.__isSectionLabel).map(el => el.textContent).join('|');
    ok('PROJDASH-7b two non-empty labels (no Recent Tasks)', secLabels === 'Recent Docs|Recent Meetings', secLabels);

    global.__opens = [];
    rows[0].click();
    ok('PROJDASH-7c row click opens', global.__opens[0] && global.__opens[0].target === 'd1.md');

    const empty = makeEl('div');
    dash._renderRecentGroups(empty, { currentPath: 'cp.md' }, { docs: [], meetings: [], tasks: [] });
    ok('PROJDASH-7d all-empty renders nothing', empty.__children.length === 0);
}

// ============================================================================
// PROJDASH-11 — _openTasks now queries spice/tasks task-notes (open, project_slug match, non-meeting).
// ============================================================================
(async () => {
  const dash = new ProjectDashboard();
  const tasksPages = [
    { type: 'task', status: 'open',  project_slug: 'foo', source: '',        file: { path: 'spice/tasks/A.md', name: 'A' }, title: 'A' },
    { type: 'task', status: 'open',  project_slug: 'foo', source: 'meeting', file: { path: 'spice/tasks/B.md', name: 'B' }, title: 'B' },
    { type: 'task', status: 'done',  project_slug: 'foo', source: '',        file: { path: 'spice/tasks/C.md', name: 'C' }, title: 'C' },
    { type: 'task', status: 'open',  project_slug: 'bar', source: '',        file: { path: 'spice/tasks/D.md', name: 'D' }, title: 'D' },
    { type: 'task', status: 'open',  project_slug: 'foo', source: '',        file: { path: 'spice/tasks/_done/E.md', name: 'E' }, title: 'E' },
    { type: 'task', status: 'open',  project_slug: 'foo', source: '',        file: { path: 'spice/tasks/F.md', name: 'F' }, title: 'F' },
  ];
  const where = (arr) => { const f = (fn) => where(arr.filter(fn)); return Object.assign(arr, { where: f }); };
  const dv = {
    current: () => ({ project_slug: 'foo' }),
    pages: (src) => where(String(src).includes('spice/tasks') ? tasksPages.slice() : []),
  };
  const ctx = { dv, slug: 'foo', currentPage: { project_slug: 'foo' } };
  const tasks = await dash._openTasks(ctx);
  ok('PROJDASH-11a open non-meeting task-notes for foo = 2', tasks.length === 2, JSON.stringify(tasks.map(t => t.title)));
  ok('PROJDASH-11b titles A,F (done/meeting/_done/other-project excluded)', tasks.map(t => t.title).join(',') === 'A,F', tasks.map(t => t.title).join(','));
  ok('PROJDASH-11c path points at the task note', tasks[0].path === 'spice/tasks/A.md', tasks[0].path);
})();

// PROJDASH-12 — _boardStats parses all 4 kanban lanes.
(async () => {
  const dash = new ProjectDashboard();
  const board = [
    "## In Planning", "- [ ] p1", "- [ ] p2",
    "## In Progress", "- [ ] ip1",
    "## Blocked", "- [x] b1",
    "## Completed", "- [x] c1", "- [x] c2", "- [x] c3",
  ].join("\n");
  const realApp = {
    vault: {
      getAbstractFileByPath: (p) => (p === 'spice/projects/foo/foo-board.md' ? { path: p } : null),
      read: async () => board,
    },
  };
  const ctx = { app: realApp, folder: 'spice/projects/foo', slug: 'foo' };
  const stats = await dash._boardStats(ctx);
  ok('PROJDASH-12a planning=2', stats.planning === 2, JSON.stringify(stats));
  ok('PROJDASH-12b inProgress=1', stats.inProgress === 1, JSON.stringify(stats));
  ok('PROJDASH-12c blocked=1', stats.blocked === 1, JSON.stringify(stats));
  ok('PROJDASH-12d completed=3', stats.completed === 3, JSON.stringify(stats));
  const ctx2 = { app: { vault: { getAbstractFileByPath: () => null, read: async () => '' } }, folder: 'x', slug: 'x' };
  const stats2 = await dash._boardStats(ctx2);
  ok('PROJDASH-12e missing board = all zero', stats2.planning === 0 && stats2.inProgress === 0 && stats2.blocked === 0 && stats2.completed === 0, JSON.stringify(stats2));
})();

// PROJDASH-13 — meeting enrichment: attendees + hasNotes + openTasks.
(async () => {
  const dash = new ProjectDashboard();
  ok('PROJDASH-13a _bodyHasNotes true on real prose', ProjectDashboard._bodyHasNotes('---\ntype: meeting\n---\n\nWe discussed the roadmap in detail today.') === true);
  // Note: matches SpaceDailyDashboard._bodyHasNotes verbatim behavior — a wikilink
  // bullet like "- [[Bob]]" carries >5 non-whitespace chars, so it counts as
  // real content even though it's scaffold-shaped. Use a pure scaffold body
  // (task lines + empty bullet + heading only) to exercise the false case.
  ok('PROJDASH-13b _bodyHasNotes false on scaffold-only', ProjectDashboard._bodyHasNotes('---\ntype: meeting\n---\n\n## Attendees\n-\n\n## Tasks\n- [ ] do it') === false);

  const content = "---\ntype: meeting\nattendees: [Bob, Carol]\n---\n\nGreat discussion about the plan and next quarter.\n\n## Tasks\n- [ ] follow up\n- [x] done one\n";
  const realApp = { vault: { getAbstractFileByPath: (p) => ({ path: p }), read: async () => content } };
  const enriched = await dash._enrichMeeting(realApp, { attendees: ['Bob', 'Carol'], file: { path: 'spice/meetings/notes/M.md', name: 'M' } });
  ok('PROJDASH-13c attendees parsed', enriched.attendees.join(',') === 'Bob,Carol', JSON.stringify(enriched.attendees));
  ok('PROJDASH-13d hasNotes true', enriched.hasNotes === true);
  ok('PROJDASH-13e openTasks = 1', enriched.openTasks === 1, String(enriched.openTasks));
})();

// ============================================================================
// PROJDASH-8 — _renderLinks chips
// ============================================================================
{
    const dash = new ProjectDashboard();
    const container = makeEl('div');
    const links = [
        'https://example.com',
        '[GitHub](https://github.com)',
        '[[Related Note]]',
    ];
    dash._renderLinks(container, { currentPath: 'cp.md' }, links);
    const chips = container.__descendants().filter(el => el.__isLinkChip);
    ok('PROJDASH-8a chips.length=3', chips.length === 3, String(chips.length));
    ok('PROJDASH-8b chip labels',
        chips.map(c => c.textContent).join('|') === 'example.com|GitHub|Related Note',
        chips.map(c => c.textContent).join('|'));

    const empty = makeEl('div');
    dash._renderLinks(empty, { currentPath: 'cp.md' }, []);
    ok('PROJDASH-8c empty array hides', empty.__children.length === 0);

    const empty2 = makeEl('div');
    dash._renderLinks(empty2, { currentPath: 'cp.md' }, null);
    ok('PROJDASH-8d null hides', empty2.__children.length === 0);
}

// ============================================================================
// PROJDASH-9 — render() wires header + tiles + recent + links
// ============================================================================
(async () => {
    const dash = new ProjectDashboard();
    const container = makeEl('div');
    const dv = {
        container,
        current: () => ({
            status: 'in-progress',
            workstreams: ['ws1', 'ws2'],
            links: ['https://foo.com'],
            file: { path: 'spice/projects/foo/Foo.md', name: 'Foo' },
        }),
        pages: (q) => {
            if (q.includes('/docs')) return _stubListWithMtimes([{ ts: 3000, name: 'doc-a' }], 'doc-note');
            if (q.includes('meetings/notes')) return _stubListWithMtimes([{ ts: 5000, name: 'mtg-a', project: '[[Foo]]' }], 'meeting');
            if (q.includes('/tasks')) return _stubListWithMtimes([], 'task-note');
            return _stubList(0, null);
        },
    };
    global.app = {
        workspace: { openLinkText: () => {} },
        vault: {
            read: async (f) => '## Todo\n- [ ] a\n- [ ] b\n',
            getAbstractFileByPath: (p) => (String(p).endsWith('board.md') ? { path: p } : null),
        },
        fileManager: { processFrontMatter: async () => {} },
    };

    await dash.render(dv);
    const pill = container.__descendants().find(el => el.__isStatusPill);
    const tiles = container.__descendants().filter(el => el.__isTile);
    const rows = container.__descendants().filter(el => el.__isRecentRow);
    const chips = container.__descendants().filter(el => el.__isLinkChip);

    ok('PROJDASH-9a pill in-progress', !!pill && pill.textContent === 'in-progress');
    ok('PROJDASH-9b 6 tiles', tiles.length === 6, String(tiles.length));
    ok('PROJDASH-9c 2 recent rows (doc + meeting)', rows.length === 2, String(rows.length));
    ok('PROJDASH-9d 1 link chip', chips.length === 1, String(chips.length));

    console.log(`\n${passes} passed, ${fails} failed`);
    process.exit(fails === 0 ? 0 : 1);
})();
