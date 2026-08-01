#!/usr/bin/env node
'use strict';

// run-graph-view.js — behavioral harness for the GraphView widget
// (platform/blueprints/project/helpers/graph-view.js): epic scope, the GV-3b
// project scope (Loop Station whole-plan graph), and the Loop Station install
// heal (platform/install.js applyLoopStationGraphHeal).
//
// GV-2b lineage: the carried finding from the discarded GV-2 attempt is pinned
// as a named fixture (GV2-STALE-DEP-EDGE) — a slice whose depends_on names a
// card absent from the slice set (a discarded/tombstoned name) must render one
// warning-strip row naming both the card and the unresolvable target.
// GV-3b lineage (GV3-STALE-DEP-EDGE): at project scope the same unresolvable
// target stays a warning, while a target living in ANOTHER cluster becomes a
// real cross-epic edge — never a silently satisfied or silently dropped edge.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const WIDGET = path.join(ROOT, 'platform/blueprints/project/helpers/graph-view.js');
const LAYOUT = path.join(ROOT, 'platform/blueprints/project/helpers/graph-layout.js');
const DASHBOARD = path.join(ROOT, 'platform/blueprints/project/helpers/epic-dashboard.js');
const delivery = require(path.join(ROOT, 'platform/mechanisms/delivery'));
const installer = require(path.join(ROOT, 'platform/install.js'));

const widgetSource = fs.readFileSync(WIDGET, 'utf8');
// Replicate the customJS loader exactly: whole file wrapped in ( ... ) as one expression.
const GraphView = eval(`(${widgetSource})`); // eslint-disable-line no-eval
const GraphLayout = eval(`(${fs.readFileSync(LAYOUT, 'utf8')})`); // eslint-disable-line no-eval
const EpicDashboard = eval(`(${fs.readFileSync(DASHBOARD, 'utf8')})`); // eslint-disable-line no-eval

function element(tag = 'div', options = {}) {
  return {
    tag, className: options.cls || '', textContent: options.text || '', style: { cssText: '' },
    innerHTML: '', attrs: {}, children: [], listeners: {}, removed: false,
    createEl(childTag, childOptions = {}) {
      const child = element(childTag, childOptions);
      this.children.push(child);
      return child;
    },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    setAttribute(name, value) { this.attrs[name] = value; },
    querySelector() { return null; },
    remove() { this.removed = true; },
  };
}
function flatten(root, out = []) {
  out.push(root);
  for (const child of root.children || []) flatten(child, out);
  return out;
}
function byClass(root, className) {
  return flatten(root).filter((node) => node.className.split(/\s+/).includes(className));
}
function textOf(root) { return flatten(root).map((node) => node.textContent).filter(Boolean).join('\n'); }
function file(filePath, mtime = 0) {
  return { path: filePath, basename: path.posix.basename(filePath, '.md'), stat: { mtime } };
}
function svgPaths(root, className) {
  const svg = byClass(root, 'graph-view-edges').map((node) => node.innerHTML).join('');
  return svg.split('<path').slice(1).filter((chunk) => chunk.includes(`graph-view-edge ${className}`));
}
function dOf(chunk) { return (chunk.match(/\sd="([^"]+)"/) || [])[1] || ''; }
function memoryAdapter(initial) {
  const store = new Map(Object.entries(initial));
  const dirs = new Set();
  const rememberParents = (entry) => {
    const parts = String(entry).split('/');
    for (let index = 1; index < parts.length; index += 1) dirs.add(parts.slice(0, index).join('/'));
  };
  for (const entry of store.keys()) rememberParents(entry);
  return {
    store, dirs, writes: [],
    async exists(entry) { return store.has(entry) || dirs.has(entry); },
    async list(entry) {
      return {
        folders: [...dirs].filter((candidate) => candidate.startsWith(`${entry}/`)
          && !candidate.slice(entry.length + 1).includes('/')),
        files: [...store.keys()].filter((candidate) => candidate.startsWith(`${entry}/`)
          && !candidate.slice(entry.length + 1).includes('/')),
      };
    },
    async read(entry) {
      if (!store.has(entry)) throw new Error(`ENOENT ${entry}`);
      return store.get(entry);
    },
    async write(entry, body) {
      rememberParents(entry);
      store.set(entry, body);
      this.writes.push({ entry, body });
    },
    async mkdir(entry) { dirs.add(entry); },
  };
}

async function main() {
  const epicFolder = 'spice/projects/alpha/tasks/Graph Epic';
  const epicPath = `${epicFolder}/Graph Epic.md`;
  const board = `${epicFolder}/board`;
  const boardNotePath = `${board}/Graph Epic-board.md`;
  const longReason = 'Resume only after the deployed selector release is installed in every consumer vault and receipts are rebuilt.';
  const staleTarget = 'GV-1 GraphLayout pure layout core';

  const allFiles = [
    file(boardNotePath, 1),
    file(`${board}/GV-A Base.md`, 10), file(`${board}/GV-B Widget.md`, 20),
    file(`${board}/GV-C Parked.md`, 30), file(`${board}/GV-D Blocked.md`, 40),
    file(`${board}/GV-E Stale.md`, 50), file(`${board}/GV-F Malformed.md`, 60),
    file(`${board}/GV-G LongPark.md`, 70),
    file(`${board}/nested/Hidden.md`, 80), file(`${board}/Not a Slice.md`, 90),
  ];
  const frontmatter = new Map([
    [boardNotePath, { type: 'kanban', 'kanban-plugin': 'board', board_role: 'epic' }],
    [`${board}/GV-A Base.md`, { type: 'slice', status: 'completed', depends_on: [] }],
    [`${board}/GV-B Widget.md`, { type: 'slice', status: 'in_progress', depends_on: ['[[GV-A Base]]'] }],
    [`${board}/GV-C Parked.md`, { type: 'slice', status: 'parked', depends_on: [], resume_condition: 'Waiting for Director sign-off' }],
    [`${board}/GV-D Blocked.md`, { type: 'slice', status: 'blocked', depends_on: ['GV-B Widget'] }],
    [`${board}/GV-E Stale.md`, { type: 'slice', status: 'planning', depends_on: [`[[${staleTarget}]]`] }],
    [`${board}/GV-F Malformed.md`, { type: 'slice', status: 'archived', depends_on: [] }],
    // GV-G depends on GV-A so depends (3) vs order (2) edge counts stay
    // ASYMMETRIC — a kind→style swap can never hide behind matching totals.
    [`${board}/GV-G LongPark.md`, { type: 'slice', status: 'parked', depends_on: ['[[GV-A Base]]'], resume_condition: longReason }],
    [`${board}/nested/Hidden.md`, { type: 'slice', status: 'planning' }],
    [`${board}/Not a Slice.md`, { type: 'task', status: 'planning' }],
  ]);
  const boardBody = [
    '---', 'kanban-plugin: board', 'type: kanban', 'board_role: epic', '---', '',
    '## In Planning', '',
    '- [ ] [[GV-E Stale]]', '- [ ] [[GV-F Malformed]]', '',
    '## In Progress', '',
    '- [ ] [[GV-B Widget]]', '- [ ] [[GV-C Parked|parked card]]', '- [ ] [[GV-D Blocked]]', '',
    '## Completed', '', '- [x] [[GV-A Base]]', '',
  ].join('\n');

  const opened = [];
  const mutations = [];
  const mutator = (name) => () => {
    mutations.push(name);
    throw new Error(`read-only fixture invoked ${name}`);
  };
  let markdownFiles = allFiles;
  global.app = {
    vault: {
      getMarkdownFiles: () => markdownFiles,
      cachedRead: async (entry) => {
        if (entry.path === boardNotePath) return boardBody;
        throw new Error(`unexpected read ${entry.path}`);
      },
      create: mutator('vault.create'), createBinary: mutator('vault.createBinary'),
      modify: mutator('vault.modify'), modifyBinary: mutator('vault.modifyBinary'),
      delete: mutator('vault.delete'), rename: mutator('vault.rename'), trash: mutator('vault.trash'),
      adapter: {
        write: mutator('adapter.write'), writeBinary: mutator('adapter.writeBinary'),
        append: mutator('adapter.append'), process: mutator('adapter.process'),
        remove: mutator('adapter.remove'), rename: mutator('adapter.rename'), copy: mutator('adapter.copy'),
        mkdir: mutator('adapter.mkdir'), rmdir: mutator('adapter.rmdir'),
        trashSystem: mutator('adapter.trashSystem'), trashLocal: mutator('adapter.trashLocal'),
      },
    },
    metadataCache: {
      getFileCache: (entry) => ({ frontmatter: frontmatter.get(entry.path) || {} }),
      trigger: mutator('metadataCache.trigger'), save: mutator('metadataCache.save'),
    },
    fileManager: {
      processFrontMatter: mutator('fileManager.processFrontMatter'), renameFile: mutator('fileManager.renameFile'),
    },
    workspace: { openLinkText: (...args) => opened.push(args) },
  };

  const normalizeCalls = [];
  const lifecycleApi = {
    normalizeStatus(value) {
      normalizeCalls.push(value);
      return delivery.normalizeStatus(value);
    },
    deriveEpicLifecycle(slices) { return delivery.deriveEpicLifecycle(slices); },
  };
  const dashboard = new EpicDashboard({ lifecycleApi });
  const currentPage = { file: { path: epicPath, folder: epicFolder } };
  global.customJS = {
    RenderSafe: { page: () => currentPage },
    GraphLayout: new GraphLayout(),
    EpicDashboard: dashboard,
  };

  // Case 1 + 2: gather mirrors _slicePages semantics; laneOrder comes from the
  // board note's In Planning + In Progress checklists in order.
  const layoutCalls = [];
  const recordingContainer = element();
  await new GraphView({
    layout: {
      layoutGraph(slices, options) {
        layoutCalls.push({ slices, options });
        return { nodes: [], edges: [], warnings: [] };
      },
    },
    lifecycleApi,
  }).render({ container: recordingContainer });
  assert.strictEqual(layoutCalls.length, 1, 'layout is delegated exactly once per render');
  assert.deepStrictEqual(layoutCalls[0].slices.map((slice) => slice.card), [
    'GV-A Base', 'GV-B Widget', 'GV-C Parked', 'GV-D Blocked',
    'GV-E Stale', 'GV-F Malformed', 'GV-G LongPark',
  ], 'case 1: gather keeps only direct type:slice children of the sibling board/ directory, name-sorted');
  assert(layoutCalls[0].slices.every((slice) => slice.file && typeof slice.file.path === 'string'
    && slice.file.path.startsWith(`${board}/`)),
  'case 1: gathered slices carry the EpicDashboard._slicePages file shape');
  assert.deepStrictEqual(layoutCalls[0].options.laneOrder, [
    'GV-E Stale', 'GV-F Malformed', 'GV-B Widget', 'GV-C Parked', 'GV-D Blocked',
  ], 'case 2: laneOrder is the In Planning then In Progress checklist wikilinks, in order, aliases resolved, Completed excluded');

  // Full render against the REAL GraphLayout + EpicDashboard delegation chain.
  const container = element();
  await new GraphView().render({ container });
  const root = container.children.find((child) => child.className === 'graph-view-root');
  assert(root, 'render mounts one graph-view-root');

  // Case 3: one chip per slice, chip is a clickable internal link to the card path.
  const chips = byClass(root, 'graph-view-chip');
  assert.strictEqual(chips.length, 7, 'case 3: exactly one chip per gathered slice');
  const chipFor = (id) => chips.find((chip) => flatten(chip).some((node) => node.textContent === id));
  const widgetChip = chipFor('GV-B');
  assert(widgetChip && typeof widgetChip.listeners.click === 'function'
    && widgetChip.style.cssText.includes('cursor:pointer'),
  'case 3: chips are clickable');
  widgetChip.listeners.click();
  assert.deepStrictEqual(opened.at(-1), [`${board}/GV-B Widget`, epicPath, false],
    'case 3: chip click opens the card through the standard internal-link mechanism');

  // Case 4: solid depends edges (arrowheads, no dash) vs dashed low-opacity
  // order edges. The fixture's counts are asymmetric on purpose (3 vs 2): a
  // kind→style swap flips the per-class totals and fails here.
  const dependsPaths = svgPaths(root, 'edge-depends');
  const orderPaths = svgPaths(root, 'edge-order');
  assert.strictEqual(dependsPaths.length, 3, 'case 4: exactly the three real depends edges render');
  assert(dependsPaths.every((chunk) => chunk.includes('marker-end') && !chunk.includes('stroke-dasharray')),
    'case 4: depends edges are solid arrowed strokes');
  assert.strictEqual(orderPaths.length, 2, 'case 4: exactly the two ghost order edges render');
  assert(orderPaths.every((chunk) => chunk.includes('stroke-dasharray') && chunk.includes('opacity')
    && !chunk.includes('marker-end')),
  'case 4: order edges are dashed, low-opacity, and arrowless');

  // Case 11: pin the SVG layer to the widget's REAL position math. The
  // fixture is deterministic, so every value is exact (no tolerances):
  //   chip x = pad + rank*colW (rank is the HORIZONTAL axis)
  //   chip y = pad + row*rowH  (row is the VERTICAL axis)
  // with pad 12, colW 200, rowH 74, chipW 172, chipH 56, and known layout
  //   GV-E Stale (0,0)  GV-F Malformed (0,1)  GV-C Parked (0,2)
  //   GV-A Base (0,3)   GV-B Widget (1,0)     GV-G LongPark (1,1)
  //   GV-D Blocked (2,0)
  const G = { colW: 200, rowH: 74, chipW: 172, chipH: 56, pad: 12 };
  const posOf = (rank, row) => ({ x: G.pad + rank * G.colW, y: G.pad + row * G.rowH });

  // 11a — chip geometry: rank must land on the horizontal axis and row on the
  // vertical axis (a rank↔row transposition moves GV-A Base to 612,12).
  for (const [id, rank, row] of [['GV-A', 0, 3], ['GV-G', 1, 1], ['GV-D', 2, 0]]) {
    const { x, y } = posOf(rank, row);
    assert(chipFor(id).style.cssText.includes(`left:${x}px;top:${y}px`),
      `case 11a: ${id} chip (rank ${rank}, row ${row}) sits at left:${x}px;top:${y}px — rank horizontal, row vertical`);
  }

  // 11b — kind→endpoint binding + direction for the KNOWN depends edge
  // GV-A Base → GV-B Widget: the path starts at the prerequisite chip's
  // right-edge midpoint and ends at the dependent chip's left-edge midpoint,
  // and THIS element carries the solid arrowed depends markup.
  const gvA = posOf(0, 3);
  const gvB = posOf(1, 0);
  const x1 = gvA.x + G.chipW;
  const y1 = gvA.y + G.chipH / 2;
  const x2 = gvB.x;
  const y2 = gvB.y + G.chipH / 2;
  const bend = Math.max(24, (x2 - x1) / 2);
  const dependsD = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  const dependsEdge = dependsPaths.find((chunk) => dOf(chunk) === dependsD);
  assert(dependsEdge,
    'case 11b: the GV-A Base→GV-B Widget depends path runs prerequisite chip (184,262) → dependent chip (212,40)');
  assert(dependsEdge.includes('marker-end="url(#graph-view-arrow)"') && !dependsEdge.includes('stroke-dasharray'),
    'case 11b: the GV-A Base→GV-B Widget element itself carries the solid arrowed depends markup');

  // 11c — direction: the reversed drawing (dependent → prerequisite) of that
  // same edge must not exist anywhere in the SVG layer.
  const rx1 = gvB.x + G.chipW;
  const ry1 = gvB.y + G.chipH / 2;
  const rx2 = gvA.x;
  const ry2 = gvA.y + G.chipH / 2;
  const rbend = Math.max(24, (rx2 - rx1) / 2);
  const reversedD = `M ${rx1} ${ry1} C ${rx1 + rbend} ${ry1}, ${rx2 - rbend} ${ry2}, ${rx2} ${ry2}`;
  assert(!dependsPaths.some((chunk) => dOf(chunk) === reversedD)
    && !orderPaths.some((chunk) => dOf(chunk) === reversedD),
  'case 11c: no edge renders GV-B Widget → GV-A Base (depends direction is prerequisite → dependent)');

  // 11d — the KNOWN order edge GV-E Stale → GV-F Malformed (same rank,
  // vertical drop) leaves the upper chip's bottom edge at the shared column
  // center and lands on the lower chip's top edge, with dashed markup.
  const gvE = posOf(0, 0);
  const gvF = posOf(0, 1);
  const orderX = gvE.x + G.chipW / 2;
  const orderD = `M ${orderX} ${gvE.y + G.chipH} L ${orderX} ${gvF.y}`;
  const orderEdge = orderPaths.find((chunk) => dOf(chunk) === orderD);
  assert(orderEdge,
    'case 11d: the GV-E Stale→GV-F Malformed order path drops upper chip bottom (98,68) → lower chip top (98,86)');
  assert(orderEdge.includes('stroke-dasharray') && !orderEdge.includes('marker-end'),
    'case 11d: the GV-E Stale→GV-F Malformed element itself carries the dashed arrowless order markup');

  // Case 5: wait badges — parked resume_condition verbatim; blocked unmet dep names;
  // long reasons truncate to ~60 chars with the full text in the title attribute.
  const badgeOf = (id) => byClass(chipFor(id), 'graph-view-wait-badge')[0];
  assert.strictEqual(badgeOf('GV-C')?.textContent, 'Waiting for Director sign-off',
    'case 5: a parked slice badge carries resume_condition verbatim');
  assert.strictEqual(badgeOf('GV-D')?.textContent, 'waiting on: GV-B Widget',
    'case 5: a blocked slice badge names its unmet dependency');
  const longBadge = badgeOf('GV-G');
  assert(longBadge && longBadge.textContent.length <= 61 && longBadge.textContent.endsWith('…')
    && longReason.startsWith(longBadge.textContent.slice(0, -1)),
  'case 5: long wait reasons truncate to ~60 chars');
  assert.strictEqual(longBadge.attrs.title, longReason,
    'case 5: the title attribute carries the full wait reason');
  assert(!byClass(chipFor('GV-A'), 'graph-view-wait-badge').length
    && !byClass(widgetChip, 'graph-view-wait-badge').length,
  'case 5: done and active chips carry no wait badge');

  // Case 6: GV2-STALE-DEP-EDGE — depends_on onto a discarded/tombstoned card name
  // renders exactly one warning row naming the card and the unresolvable target.
  const danglingRows = byClass(root, 'warning-dangling-dependency');
  assert.strictEqual(danglingRows.length, 1,
    'GV2-STALE-DEP-EDGE: exactly one dangling-dependency warning row renders');
  assert.strictEqual(danglingRows[0].textContent,
    `GV-E Stale: depends on a card that doesn't exist: '${staleTarget}'`,
    'GV2-STALE-DEP-EDGE: the row names the dependent card and the discarded target');

  // Case 8: malformed slice frontmatter — unknown-style chip + warning, no throw,
  // the rest of the graph still renders.
  const malformedChip = chipFor('GV-F');
  assert(malformedChip.className.includes('status-unrecognized'),
    'case 8: a malformed status renders the unknown-style chip');
  const unreadableRows = byClass(root, 'warning-unreadable-slice');
  assert.strictEqual(unreadableRows.length, 1, 'case 8: malformed frontmatter adds one warning row');
  assert.strictEqual(unreadableRows[0].textContent, "GV-F Malformed: slice state unreadable: 'archived'",
    'case 8: the warning names the card and the unreadable state');
  assert.strictEqual(byClass(root, 'graph-view-warnings').length, 1,
    'warning strip renders as one compact block');

  // Delegated status colors on the real chain (EpicDashboard.STATUS_COLORS via
  // _statusPresentation — never a local table).
  for (const [id, className, color] of [
    ['GV-A', 'status-done', 'var(--color-purple)'],
    ['GV-B', 'status-in-progress', 'var(--color-green)'],
    ['GV-C', 'status-waiting', 'var(--color-orange)'],
    ['GV-D', 'status-blocked', 'var(--color-red)'],
    ['GV-E', 'status-planning', 'var(--color-blue)'],
  ]) {
    const chip = chipFor(id);
    assert(chip.className.includes(className), `${id} chip carries the delegated ${className} class`);
    assert(chip.style.cssText.includes(`color:${color}`),
      `${id} chip color comes from the shared EpicDashboard STATUS_COLORS bucket`);
  }
  assert(normalizeCalls.length >= 7, 'status presentation routes through the Delivery normalizeStatus API');

  // Case 9: the widget performed zero write calls across every render so far.
  assert.deepStrictEqual(mutations, [],
    'case 9: render invokes no vault, adapter, frontmatter, or metadata mutator');
  assert.strictEqual(opened.length, 1, 'only the explicit test click navigated');

  // Case 7: empty warnings render no strip element.
  markdownFiles = allFiles.filter((entry) => [
    boardNotePath, `${board}/GV-A Base.md`, `${board}/GV-B Widget.md`,
  ].includes(entry.path));
  const cleanContainer = element();
  await new GraphView().render({ container: cleanContainer });
  const cleanRoot = cleanContainer.children[0];
  assert.strictEqual(byClass(cleanRoot, 'graph-view-chip').length, 2, 'case 7: clean board renders its chips');
  assert.strictEqual(byClass(cleanRoot, 'graph-view-warnings').length, 0,
    'case 7: empty warnings render no strip element');
  assert.strictEqual(byClass(cleanRoot, 'graph-view-warning').length, 0,
    'case 7: empty warnings render no warning rows');
  markdownFiles = allFiles;

  // Case 10: colors and normalization delegate to the injected lifecycle API —
  // a stub answer flows through to the chip, and the widget source carries no
  // local color table.
  frontmatter.set(`${board}/GV-A Base.md`, { type: 'slice', status: 'weird', depends_on: [] });
  const stubCalls = [];
  const stubContainer = element();
  await new GraphView({
    lifecycleApi: {
      normalizeStatus(value) { stubCalls.push(value); return value === 'weird' ? 'completed' : null; },
      deriveEpicLifecycle() { return { state: 'active', counts: {} }; },
    },
  }).render({ container: stubContainer });
  const stubChip = byClass(stubContainer.children[0], 'graph-view-chip')
    .find((chip) => flatten(chip).some((node) => node.textContent === 'Base'));
  assert(stubChip.className.includes('status-done')
    && stubChip.style.cssText.includes('color:var(--color-purple)'),
  'case 10: an injected lifecycle API answer decides the chip bucket and color');
  assert(stubCalls.includes('weird'), 'case 10: the injected normalizeStatus is consulted');
  assert(!/STATUS_COLORS/.test(widgetSource) && !/STATUS_DISPLAY/.test(widgetSource),
    'case 10: the widget declares no local status color/display table');
  assert(!/--color-(?:blue|green|purple|red)/.test(widgetSource),
    'case 10: the widget hardcodes no lifecycle bucket color');
  assert(widgetSource.includes('_statusPresentation') && widgetSource.includes('_deliveryApi'),
    'case 10: presentation and lifecycle resolution delegate to EpicDashboard');
  frontmatter.set(`${board}/GV-A Base.md`, { type: 'slice', status: 'completed', depends_on: [] });

  // Fail-soft: a missing GraphLayout never blanks the note.
  const priorLayout = global.customJS.GraphLayout;
  delete global.customJS.GraphLayout;
  const noLayoutContainer = element();
  await new GraphView().render({ container: noLayoutContainer });
  assert(textOf(noLayoutContainer.children[0]).includes('GraphLayout unavailable'),
    'fail-soft: missing GraphLayout renders a visible warning row instead of blanking');
  global.customJS.GraphLayout = priorLayout;

  // Fail-soft: a throwing gather surface renders a warning row, never throws.
  const priorGetMarkdownFiles = global.app.vault.getMarkdownFiles;
  global.app.vault.getMarkdownFiles = () => { throw new Error('gather fault'); };
  const faultContainer = element();
  await new GraphView().render({ container: faultContainer });
  assert(faultContainer.children.length === 1,
    'fail-soft: a gather fault still mounts the root');
  global.app.vault.getMarkdownFiles = priorGetMarkdownFiles;

  // ---- Project scope (GV-3b): the whole-plan graph on Loop Station ----
  // Live epics (In Planning + In Progress + Blocked) as labeled clusters,
  // cross-epic depends edges, active-claim outline from station frontmatter,
  // Completed collapse, Archive/below-divider exclusion, missing-epic
  // fail-soft (GV3-STALE-DEP-EDGE lineage: unresolvable targets stay warnings).
  const savedApp = global.app;
  const savedCustomJS = global.customJS;
  const projectDir = 'spice/projects/demo';
  const stationPath = `${projectDir}/Loop Station.md`;
  const projectBoardPath = `${projectDir}/demo-board.md`;
  const epicOneDir = `${projectDir}/tasks/Epic One`;
  const epicTwoDir = `${projectDir}/tasks/Epic Two`;
  const epicDoneDir = `${projectDir}/tasks/Epic Done`;
  const projectFiles = [
    file(projectBoardPath, 1),
    file(`${epicOneDir}/Epic One.md`, 2), file(`${epicOneDir}/board/Epic One-board.md`, 3),
    file(`${epicOneDir}/board/E1-1 Alpha.md`, 4), file(`${epicOneDir}/board/E1-2 Beta.md`, 5),
    file(`${epicTwoDir}/Epic Two.md`, 6), file(`${epicTwoDir}/board/Epic Two-board.md`, 7),
    file(`${epicTwoDir}/board/E2-1 Gamma.md`, 8), file(`${epicTwoDir}/board/E2-2 Delta.md`, 9),
    file(`${epicDoneDir}/Epic Done.md`, 10), file(`${epicDoneDir}/board/Epic Done-board.md`, 11),
    file(`${epicDoneDir}/board/ED-1 Old.md`, 12),
  ];
  const projectFrontmatter = new Map([
    [projectBoardPath, { type: 'kanban', 'kanban-plugin': 'board' }],
    [`${epicOneDir}/Epic One.md`, { type: 'epic' }],
    [`${epicOneDir}/board/Epic One-board.md`, { type: 'kanban', 'kanban-plugin': 'board', board_role: 'epic' }],
    [`${epicOneDir}/board/E1-1 Alpha.md`, { type: 'slice', status: 'completed', depends_on: [] }],
    [`${epicOneDir}/board/E1-2 Beta.md`, { type: 'slice', status: 'in_progress', depends_on: ['[[E1-1 Alpha]]'] }],
    [`${epicTwoDir}/Epic Two.md`, { type: 'epic' }],
    [`${epicTwoDir}/board/Epic Two-board.md`, { type: 'kanban', 'kanban-plugin': 'board', board_role: 'epic' }],
    // E2-1's depends_on crosses INTO Epic One — a real edge, never a warning.
    [`${epicTwoDir}/board/E2-1 Gamma.md`, { type: 'slice', status: 'planning', depends_on: ['[[E1-2 Beta]]'] }],
    // E2-2's depends_on resolves in NO cluster — the dangling warning path.
    [`${epicTwoDir}/board/E2-2 Delta.md`, { type: 'slice', status: 'planning', depends_on: ['[[Ghost Card]]'] }],
    [`${epicDoneDir}/Epic Done.md`, { type: 'epic' }],
    [`${epicDoneDir}/board/Epic Done-board.md`, { type: 'kanban', 'kanban-plugin': 'board', board_role: 'epic' }],
    [`${epicDoneDir}/board/ED-1 Old.md`, { type: 'slice', status: 'completed', depends_on: [] }],
  ]);
  const projectBoardBody = [
    '---', 'kanban-plugin: board', 'type: kanban', '---', '',
    '## In Planning', '',
    '- [ ] [[Epic Two]]', '- [ ] [[Epic Missing]]', '',
    '## In Progress', '',
    '- [ ] [[Epic One]]', '',
    '## Blocked', '',
    '## Discovered (autoloop)', '',
    '- [ ] [[Stray Finding]]', '',
    '## Completed', '',
    '- [x] [[Epic Done]]', '',
    '## Archive', '',
    '- [x] [[Epic Ancient]]', '',
    '***', '',
    // A live-lane heading BELOW the archive divider: if the divider break ever
    // regresses, this epic would render and the P5 assertion turns red.
    '## In Progress', '',
    '- [ ] [[Below Divider Epic]]', '',
  ].join('\n');
  const projectBodies = new Map([
    [projectBoardPath, projectBoardBody],
    [`${epicOneDir}/board/Epic One-board.md`, [
      '---', 'kanban-plugin: board', '---', '',
      '## In Progress', '', '- [ ] [[E1-2 Beta]]', '',
      '## Completed', '', '- [x] [[E1-1 Alpha]]', '',
    ].join('\n')],
    [`${epicTwoDir}/board/Epic Two-board.md`, [
      '---', 'kanban-plugin: board', '---', '',
      '## In Planning', '', '- [ ] [[E2-1 Gamma]]', '- [ ] [[E2-2 Delta]]', '',
    ].join('\n')],
    [`${epicDoneDir}/board/Epic Done-board.md`, [
      '---', 'kanban-plugin: board', '---', '',
      '## Completed', '', '- [x] [[ED-1 Old]]', '',
    ].join('\n')],
  ]);
  const projectOpened = [];
  const projectMutations = [];
  const projectMutator = (name) => () => {
    projectMutations.push(name);
    throw new Error(`read-only fixture invoked ${name}`);
  };
  global.app = {
    vault: {
      getMarkdownFiles: () => projectFiles,
      cachedRead: async (entry) => {
        if (projectBodies.has(entry.path)) return projectBodies.get(entry.path);
        throw new Error(`unexpected read ${entry.path}`);
      },
      create: projectMutator('vault.create'), modify: projectMutator('vault.modify'),
      delete: projectMutator('vault.delete'), rename: projectMutator('vault.rename'),
      trash: projectMutator('vault.trash'),
      adapter: {
        write: projectMutator('adapter.write'), append: projectMutator('adapter.append'),
        process: projectMutator('adapter.process'), remove: projectMutator('adapter.remove'),
        rename: projectMutator('adapter.rename'), mkdir: projectMutator('adapter.mkdir'),
        rmdir: projectMutator('adapter.rmdir'),
      },
    },
    metadataCache: {
      getFileCache: (entry) => ({ frontmatter: projectFrontmatter.get(entry.path) || {} }),
      trigger: projectMutator('metadataCache.trigger'),
    },
    fileManager: { processFrontMatter: projectMutator('fileManager.processFrontMatter') },
    workspace: { openLinkText: (...args) => projectOpened.push(args) },
  };
  const projectPage = {
    file: { path: stationPath, folder: projectDir },
    active: { card: 'E1-2 Beta', phase: 'implementing', epic: 'Epic One' },
  };
  global.customJS = {
    RenderSafe: { page: () => projectPage },
    GraphLayout: new GraphLayout(),
    EpicDashboard: new EpicDashboard({ lifecycleApi }),
  };
  const projectContainer = element();
  await new GraphView({ scope: 'project' }).render({ container: projectContainer });
  const pRoot = projectContainer.children.find((child) => child.className === 'graph-view-root');
  assert(pRoot, 'P: project scope mounts one graph-view-root');

  // P1: two live-epic clusters render as labeled headers, stacked in board
  // order (In Planning first), each header linking to its atlas.
  const headers = byClass(pRoot, 'graph-view-cluster-header');
  assert.deepStrictEqual(headers.map((header) => header.textContent), ['Epic Two', 'Epic One'],
    'P1: exactly the live epics render as clusters, in parent-board lane order');
  assert(headers[0].style.cssText.includes('top:12px') && headers[1].style.cssText.includes('top:198px'),
    'P1: clusters stack vertically at the computed offsets');
  headers[1].listeners.click();
  assert.deepStrictEqual(projectOpened.at(-1), [`${epicOneDir}/Epic One`, stationPath, false],
    'P1: an epic header click opens the epic atlas');
  const pChips = byClass(pRoot, 'graph-view-chip');
  assert.strictEqual(pChips.length, 4, 'P1: every live-epic slice renders exactly one chip');
  const pChipFor = (id) => pChips.find((chip) => flatten(chip)
    .some((node) => node.textContent && node.textContent.startsWith(id)));
  for (const [id, x, y] of [['E2-1', 12, 42], ['E2-2', 12, 116], ['E1-1', 12, 228], ['E1-2', 212, 228]]) {
    assert(pChipFor(id).style.cssText.includes(`left:${x}px;top:${y}px`),
      `P1: ${id} chip sits at its cluster-offset position left:${x}px;top:${y}px`);
  }
  const pCanvas = byClass(pRoot, 'graph-view-project-canvas')[0];
  assert(pCanvas && pCanvas.style.cssText.includes('width:396px;height:296px'),
    'P1: one shared canvas spans all clusters');

  // P2: the cross-epic depends_on (E2-1 Gamma → depends on E1-2 Beta) renders
  // as a real depends edge between chips in DIFFERENT clusters, endpoints
  // pinned to the absolute chip positions (prerequisite right-mid → dependent
  // left-mid), and never as a dangling warning.
  const pDepends = svgPaths(pRoot, 'edge-depends');
  const crossPaths = pDepends.filter((chunk) => chunk.includes('edge-cross-epic'));
  assert.strictEqual(crossPaths.length, 1, 'P2: exactly one cross-epic edge renders');
  assert.strictEqual(dOf(crossPaths[0]), 'M 384 256 C 408 256, -12 70, 12 70',
    'P2: the cross edge runs prerequisite E1-2 Beta (384,256) → dependent E2-1 Gamma (12,70)');
  assert(crossPaths[0].includes('marker-end') && !crossPaths[0].includes('stroke-dasharray'),
    'P2: the cross edge carries the solid arrowed depends markup');
  const intraDepends = pDepends.filter((chunk) => !chunk.includes('edge-cross-epic'));
  assert.strictEqual(intraDepends.length, 1, 'P2: the one intra-cluster depends edge renders');
  assert.strictEqual(dOf(intraDepends[0]), 'M 184 256 C 208 256, 188 256, 212 256',
    'P2: the Epic One intra-cluster edge is drawn at its cluster-offset positions');
  const pOrder = svgPaths(pRoot, 'edge-order');
  assert.deepStrictEqual(pOrder.map(dOf), ['M 98 98 L 98 116'],
    'P2: the Epic Two ghost order edge is drawn at its cluster-offset positions');

  // P3: the card named in the Loop Station's own frontmatter `active` gets a
  // distinct outline; every other chip does not.
  const activeChip = pChipFor('E1-2');
  assert(activeChip.className.includes('graph-view-active'),
    'P3: the active claim chip carries the graph-view-active class');
  assert(activeChip.style.cssText.includes('outline:2px solid var(--interactive-accent);outline-offset:2px;'),
    'P3: the active claim chip carries the distinct outline style');
  for (const id of ['E2-1', 'E2-2', 'E1-1']) {
    assert(!pChipFor(id).className.includes('graph-view-active')
      && !pChipFor(id).style.cssText.includes('outline:'),
    `P3: non-active chip ${id} carries no active outline`);
  }

  // P4: a Completed-lane epic collapses to a single done-chip; its slices
  // never render.
  const doneChips = byClass(pRoot, 'graph-view-done-chip');
  assert.strictEqual(doneChips.length, 1, 'P4: exactly one done-chip renders for the Completed-lane epic');
  assert.strictEqual(doneChips[0].textContent, 'Epic Done', 'P4: the done-chip names the completed epic');
  assert(doneChips[0].className.includes('status-done'),
    'P4: the done-chip carries the delegated done presentation bucket');
  doneChips[0].listeners.click();
  assert.deepStrictEqual(projectOpened.at(-1), [`${epicDoneDir}/Epic Done`, stationPath, false],
    'P4: the done-chip click opens the completed epic atlas');
  assert(!textOf(pRoot).includes('ED-1'), 'P4: slices of a Completed-lane epic never render');

  // P5: Discovered triage, the Archive section, and anything below the kanban
  // archive divider never render.
  const pText = textOf(pRoot);
  for (const name of ['Stray Finding', 'Epic Ancient', 'Below Divider Epic']) {
    assert(!pText.includes(name), `P5: '${name}' never renders at project scope`);
  }

  // P6: a live-lane epic whose atlas/board note is missing renders a warning
  // strip entry — the container still renders (never a throw, never blank).
  const missingRows = byClass(pRoot, 'warning-missing-epic');
  assert.strictEqual(missingRows.length, 1, 'P6: the unresolvable epic renders exactly one warning row');
  assert.strictEqual(missingRows[0].textContent,
    `Epic Missing: epic atlas or board note is missing: '${projectDir}/tasks/Epic Missing/Epic Missing.md'`,
    'P6: the warning names the epic and the missing note');

  // GV3-STALE-DEP-EDGE lineage: a depends_on naming a card in NO cluster stays
  // on the dangling warning path (the same code path as epic scope).
  const pDangling = byClass(pRoot, 'warning-dangling-dependency');
  assert.strictEqual(pDangling.length, 1, 'P: exactly one project-scope dangling warning renders');
  assert.strictEqual(pDangling[0].textContent,
    "E2-2 Delta: depends on a card that doesn't exist: 'Ghost Card'",
    'P: a target resolvable in no cluster is a dangling warning, not a cross edge');

  // Mount contract: the Loop Station guard block passes { scope: "project" }
  // as a render-time arg to the epic-default singleton.
  const overrideContainer = element();
  await new GraphView().render({ container: overrideContainer }, { scope: 'project' });
  assert.strictEqual(byClass(overrideContainer.children[0], 'graph-view-cluster-header').length, 2,
    'P: customjs-guard args { scope: "project" } select project scope on the singleton');

  // Fail-soft: a project without its parent board renders a warning row.
  const orphanPage = { file: { path: 'spice/projects/ghost/Loop Station.md', folder: 'spice/projects/ghost' }, active: null };
  global.customJS.RenderSafe = { page: () => orphanPage };
  const orphanContainer = element();
  await new GraphView({ scope: 'project' }).render({ container: orphanContainer });
  const orphanRows = byClass(orphanContainer.children[0], 'warning-missing-board');
  assert.strictEqual(orphanRows.length, 1, 'P: a missing parent board renders one warning row');
  assert.strictEqual(orphanRows[0].textContent,
    "ghost: parent board note is missing: 'spice/projects/ghost/ghost-board.md'",
    'P: the warning names the expected parent board path');

  // P8: zero mutator calls across every project-scope render.
  assert.deepStrictEqual(projectMutations, [],
    'P8: project scope invokes no vault, adapter, frontmatter, or metadata mutator');
  assert.strictEqual(projectOpened.length, 2, 'P8: only the explicit test clicks navigated');
  global.app = savedApp;
  global.customJS = savedCustomJS;

  // Cold load: RenderSafe absent is a render-safe no-op.
  const priorRenderSafe = global.customJS.RenderSafe;
  delete global.customJS.RenderSafe;
  const coldContainer = element();
  await new GraphView().render({ container: coldContainer });
  assert.strictEqual(coldContainer.children.length, 0, 'cold load is a render-safe no-op');
  global.customJS.RenderSafe = priorRenderSafe;
  assert.deepStrictEqual(mutations, [], 'every render across every case stayed write-free');

  // Widget grammar: RenderSafe-only current access, bare loadable class.
  assert(!widgetSource.includes('dv.current('), 'widget uses RenderSafe instead of raw dv.current');
  assert.ok(/^class GraphView\b/m.test(widgetSource), 'file is a bare customJS-loadable class');

  // Registration: manifest files[] + customjs_classes[], package.json script +
  // one preflight entry directly after run-graph-layout.js.
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform/blueprints/project/manifest.json'), 'utf8'));
  assert.strictEqual(manifest.customjs_classes.filter((name) => name === 'GraphView').length, 1,
    'GraphView is registered exactly once in customjs_classes');
  assert.strictEqual(manifest.files.filter((entry) => entry.source === 'helpers/graph-view.js'
    && entry.dest === '{{scripts_path}}/project/graph-view.js').length, 1,
  'the helper has one canonical install mapping');
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(packageJson.scripts['test:graph-view'], 'node platform/test/run-graph-view.js',
    'focused script is wired');
  assert((packageJson.scripts['release:preflight'] || '').includes(
    'node platform/test/run-graph-layout.js && node platform/test/run-graph-view.js'),
  'release preflight runs the harness exactly once, directly after the layout core');
  assert.strictEqual((packageJson.scripts['release:preflight'].match(/run-graph-view\.js/g) || []).length, 1,
    'release preflight registers the harness once');

  // Atlas mounts: the intake scaffold and the install heal both emit the
  // GraphView customjs-guard block directly after the EpicDashboard block.
  const intakeSource = fs.readFileSync(path.join(ROOT, '.agents/skills/card-intake/scripts/card-intake.js'), 'utf8');
  const dashboardMountAt = intakeSource.indexOf('{ class: "EpicDashboard" }');
  const graphMountAt = intakeSource.indexOf('{ class: "GraphView" }');
  assert(dashboardMountAt >= 0 && graphMountAt > dashboardMountAt,
    'card-intake atlas scaffold mounts GraphView after EpicDashboard');

  const chromeOnlyAtlas = [
    '---', 'type: epic', 'schema_version: 1.1.0', '---', '',
    '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });', '```', '',
  ].join('\n');
  const dashboardOnlyAtlas = `${chromeOnlyAtlas}\n\`\`\`dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "EpicDashboard" });\n\`\`\``;
  const healAdapter = memoryAdapter({
    'spice/projects/demo/tasks/Bare Epic/Bare Epic.md': chromeOnlyAtlas,
    'spice/projects/demo/tasks/Dash Epic/Dash Epic.md': dashboardOnlyAtlas,
  });
  const healHistory = [];
  const healTp = { app: { vault: { adapter: healAdapter } } };
  await installer.applyEpicScaffoldHeal(healTp, { name: 'project' }, {}, healHistory, { commit: 'fixture', tag: null, dirty: false });
  for (const atlas of ['spice/projects/demo/tasks/Bare Epic/Bare Epic.md', 'spice/projects/demo/tasks/Dash Epic/Dash Epic.md']) {
    const healed = healAdapter.store.get(atlas);
    const dashboardAt = healed.indexOf('class: "EpicDashboard"');
    const graphAt = healed.indexOf('class: "GraphView"');
    assert(dashboardAt >= 0 && graphAt > dashboardAt, `heal mounts GraphView after EpicDashboard on ${atlas}`);
    assert.strictEqual((healed.match(/class: "EpicDashboard"/g) || []).length, 1,
      `heal keeps exactly one EpicDashboard block on ${atlas}`);
    assert.strictEqual((healed.match(/class: "GraphView"/g) || []).length, 1,
      `heal injects exactly one GraphView block on ${atlas}`);
  }
  const firstPassStore = [...healAdapter.store.entries()].sort(([left], [right]) => left.localeCompare(right));
  const writesAfterFirstPass = healAdapter.writes.length;
  await installer.applyEpicScaffoldHeal(healTp, { name: 'project' }, {}, healHistory, { commit: 'fixture', tag: null, dirty: false });
  assert.deepStrictEqual(
    [...healAdapter.store.entries()].sort(([left], [right]) => left.localeCompare(right)),
    firstPassStore, 'heal replay is byte-identical');
  assert.strictEqual(healAdapter.writes.length, writesAfterFirstPass, 'heal replay performs zero writes');
  assert(!healHistory.some((entry) => entry.event === 'warning'), 'heal fixtures produce no warnings');

  // Loop Station heal (GV-3b): an existing type:loop-station note without the
  // project-scope GraphView block gains it exactly once, directly after the
  // OperatorStation block; replay is byte-identical with zero writes; a
  // station already carrying it is untouched; non-station notes are ignored.
  const stationGuardBlock = '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "GraphView", args: [{ scope: "project" }] });\n```';
  const operatorOnlyStation = [
    '---', 'type: "loop-station"', 'schema_version: "1.0.0"', '---', '',
    '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" });', '```', '',
  ].join('\n');
  const carryingStation = `${operatorOnlyStation}\n${stationGuardBlock}\n`;
  const projectBoardNote = '---\nkanban-plugin: board\ntype: kanban\n---\n';
  const stationAdapter = memoryAdapter({
    'spice/projects/demo/Loop Station.md': operatorOnlyStation,
    'spice/projects/demo/demo-board.md': projectBoardNote,
    'spice/projects/other/Loop Station.md': carryingStation,
  });
  const stationHistory = [];
  const stationTp = { app: { vault: { adapter: stationAdapter } } };
  await installer.applyLoopStationGraphHeal(stationTp, { name: 'project' }, {}, stationHistory, { commit: 'fixture', tag: null, dirty: false });
  const healedStation = stationAdapter.store.get('spice/projects/demo/Loop Station.md');
  const operatorAt = healedStation.indexOf('class: "OperatorStation"');
  const stationGraphAt = healedStation.indexOf('class: "GraphView"');
  assert(operatorAt >= 0 && stationGraphAt > operatorAt,
    'station heal injects the GraphView block after the OperatorStation block');
  assert.strictEqual((healedStation.match(/class: "GraphView"/g) || []).length, 1,
    'station heal injects exactly one GraphView block');
  assert(healedStation.includes('args: [{ scope: "project" }]'),
    'station heal mounts GraphView at PROJECT scope');
  assert.strictEqual((healedStation.match(/class: "OperatorStation"/g) || []).length, 1,
    'station heal keeps exactly one OperatorStation block');
  assert.strictEqual(stationAdapter.store.get('spice/projects/other/Loop Station.md'), carryingStation,
    'a station already carrying the block is byte-untouched');
  assert(!stationAdapter.writes.some(({ entry }) => entry.includes('other/Loop Station.md')),
    'no write is issued for the already-carrying station');
  assert.strictEqual(stationAdapter.store.get('spice/projects/demo/demo-board.md'), projectBoardNote,
    'non-loop-station notes in the project dir are ignored');
  const stationFirstPass = [...stationAdapter.store.entries()].sort(([left], [right]) => left.localeCompare(right));
  const stationWritesAfterFirstPass = stationAdapter.writes.length;
  await installer.applyLoopStationGraphHeal(stationTp, { name: 'project' }, {}, stationHistory, { commit: 'fixture', tag: null, dirty: false });
  assert.deepStrictEqual(
    [...stationAdapter.store.entries()].sort(([left], [right]) => left.localeCompare(right)),
    stationFirstPass, 'station heal replay is byte-identical');
  assert.strictEqual(stationAdapter.writes.length, stationWritesAfterFirstPass,
    'station heal replay performs zero writes');
  assert(!stationHistory.some((entry) => entry.event === 'warning'),
    'station heal fixtures produce no warnings');
  assert(stationHistory.some((entry) => entry.event === 'info' && entry.step === 'loop_station_graph_heal'
    && entry.action === 'graph_view_injected' && entry.target === 'spice/projects/demo/Loop Station.md'),
  'station heal records one injection history event');

  console.log('graph-view: all checks passed');
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
