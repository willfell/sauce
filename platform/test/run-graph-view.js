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
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const WIDGET = path.join(ROOT, 'platform/blueprints/project/helpers/graph-view.js');
const LAYOUT = path.join(ROOT, 'platform/blueprints/project/helpers/graph-layout.js');
const INSIGHTS = path.join(ROOT, 'platform/blueprints/project/helpers/graph-insights.js');
const DASHBOARD = path.join(ROOT, 'platform/blueprints/project/helpers/epic-dashboard.js');
const delivery = require(path.join(ROOT, 'platform/mechanisms/delivery'));
const installer = require(path.join(ROOT, 'platform/install.js'));

const widgetSource = fs.readFileSync(WIDGET, 'utf8');
// Replicate the customJS loader exactly: whole file wrapped in ( ... ) as one expression.
const GraphView = eval(`(${widgetSource})`); // eslint-disable-line no-eval
const GraphLayout = eval(`(${fs.readFileSync(LAYOUT, 'utf8')})`); // eslint-disable-line no-eval
const GraphInsights = eval(`(${fs.readFileSync(INSIGHTS, 'utf8')})`); // eslint-disable-line no-eval
const EpicDashboard = eval(`(${fs.readFileSync(DASHBOARD, 'utf8')})`); // eslint-disable-line no-eval

function element(tag = 'div', options = {}) {
  const optionAttrs = { ...(options.attr || {}), ...(options.attrs || {}) };
  const node = {
    tag, className: options.cls || optionAttrs.class || '', textContent: options.text || '', style: { cssText: '' },
    innerHTML: '', attrs: optionAttrs, children: [], listeners: {}, removed: false, parent: null,
    createEl(childTag, childOptions = {}) {
      const child = element(childTag, childOptions);
      child.parent = this;
      this.children.push(child);
      return child;
    },
    insertBefore(child, before) {
      if (child.parent) {
        const prior = child.parent.children.indexOf(child);
        if (prior >= 0) child.parent.children.splice(prior, 1);
      }
      child.parent = this;
      const index = before ? this.children.indexOf(before) : -1;
      this.children.splice(index >= 0 ? index : this.children.length, 0, child);
      return child;
    },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    setAttribute(name, value) {
      this.attrs[name] = value;
      if (name === 'class') this.className = String(value);
    },
    setAttributeNS(_namespace, name, value) {
      this.attrs[name] = value;
      if (name === 'class') this.className = String(value);
    },
    querySelector() { return null; },
    remove() {
      this.removed = true;
      if (this.parent) {
        const index = this.parent.children.indexOf(this);
        if (index >= 0) this.parent.children.splice(index, 1);
      }
      this.parent = null;
    },
  };
  Object.defineProperty(node, 'nextSibling', {
    enumerable: false,
    get() {
      if (!this.parent) return null;
      const index = this.parent.children.indexOf(this);
      return index >= 0 ? this.parent.children[index + 1] || null : null;
    },
  });
  return node;
}
function bubblingClick(target) {
  const path = [];
  for (let node = target; node; node = node.parent) path.push(node);
  let stopped = false;
  const event = {
    type: 'click', target, currentTarget: null,
    stopPropagation() { stopped = true; },
  };
  for (const node of path) {
    event.currentTarget = node;
    node.listeners?.click?.(event);
    if (stopped) break;
  }
  return { stopped };
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
const { check: bl6Check, snapshot: bl6ReceiptSnapshot } = (() => {
  let tail = null;
  let count = 0;
  const check = (name, predicate, message) => {
    assert.strictEqual(typeof predicate, 'function', `BL6 receipt ${name} requires a predicate function`);
    const predicateSource = Function.prototype.toString.call(predicate).replace(/\s+/g, ' ');
    const digest = crypto.createHash('sha256').update(predicateSource).digest('hex');
    assert(predicate(), message);
    tail = { previous: tail, receipt: { name, digest } };
    count += 1;
  };
  const snapshot = () => {
    const output = [];
    output.length = count;
    let cursor = tail;
    let index = count - 1;
    while (cursor) {
      output[index] = { ...cursor.receipt };
      cursor = cursor.previous;
      index -= 1;
    }
    return output;
  };
  return Object.freeze({ check, snapshot });
})();
function domShape(root) {
  return {
    tag: root.tag,
    className: root.className,
    textContent: root.textContent,
    cssText: root.style?.cssText || '',
    innerHTML: root.innerHTML,
    attrs: root.attrs,
    children: (root.children || []).map(domShape),
  };
}
function file(filePath, mtime = 0) {
  return { path: filePath, basename: path.posix.basename(filePath, '.md'), stat: { mtime } };
}
function svgPaths(root, className) {
  const svg = byClass(root, 'graph-view-edges').map((node) => node.innerHTML).join('');
  return svg.split('<path').slice(1).filter((chunk) => chunk.includes(`graph-view-edge ${className}`));
}
function dOf(chunk) { return (chunk.match(/\sd="([^"]+)"/) || [])[1] || ''; }

// GV-R2 deterministic geometry — the widget's per-rank auto-width formula,
// replicated here so every expected width / x-offset / canvas width is COMPUTED
// from the same math (never a magic literal). A mutation to the widget's
// widthCharPx / titleGlyphPx / hPad / minCol / maxCol / colGap diverges from
// this replica → RED. Height intentionally uses the conservative wide-glyph
// cell, independently of the inherited average-width column model.
const GVR2 = {
  widthCharPx: 7, titleGlyphPx: 13, titleFontPx: 12, infoFontPx: 11,
  hPad: 18, minCol: 120, maxCol: 260, colGap: 28, pad: 12,
  chipH: 56, rowGap: 18, titleLineH: 15, infoLineH: 13, padY: 7, contentGap: 3,
  scrollbarAllowance: 14,
};
GVR2.maxCharsPerLine = Math.floor((GVR2.maxCol - GVR2.hPad) / GVR2.widthCharPx); // 34
function wrapLongest(text, maxChars) {
  const limit = Math.max(1, Number(maxChars) || 1);
  const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const sourceWord of words) {
    let word = sourceWord;
    if (word.length > limit) {
      if (line) { lines.push(line); line = ''; }
      while (word.length > limit) { lines.push(word.slice(0, limit)); word = word.slice(limit); }
    }
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= limit || !line) line = candidate;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  const longest = lines.reduce((max, entry) => Math.max(max, entry.length), 0);
  return { lines: lines.length ? lines : [''], longest };
}
function chipWidth(text) {
  const { longest } = wrapLongest(text, GVR2.maxCharsPerLine);
  const raw = longest * GVR2.widthCharPx + GVR2.hPad;
  return Math.min(GVR2.maxCol, Math.max(GVR2.minCol, raw));
}
function titleText(card) {
  const full = String(card || '').trim();
  const id = full.match(/^([A-Z]+-[A-Za-z0-9]+)(?:\s+|$)/);
  if (!id) return full;
  return full.slice(id[0].length).replace(/\s+\(supersedes[^)]*\)\s*$/i, '').trim() || full;
}
function cardId(card) {
  return String(card || '').trim().match(/^([A-Z]+-[A-Za-z0-9]+)(?:\s+|$)/)?.[1] || String(card || '').trim();
}
function waitText(node) {
  const reason = String(node?.waitReason || '').replace(/\s+/g, ' ').trim();
  const blocked = reason.match(/^waiting on:\s*(.+)$/i);
  return blocked ? `needs ${cardId(blocked[1].split(',')[0])}` : reason;
}
function chipHeight(node, width) {
  if (node?.isStub) return GVR2.chipH;
  const parsedId = String(node?.card || '').trim().match(/^([A-Z]+-[A-Za-z0-9]+)(?:\s+|$)/)?.[1] || null;
  const idBudget = parsedId ? parsedId.length * GVR2.titleGlyphPx + 5 : 0;
  const perLineChars = Math.max(1, Math.floor((width - GVR2.hPad - idBudget) / GVR2.titleGlyphPx));
  const titleLines = wrapLongest(titleText(node?.card), perLineChars).lines.length;
  const wait = waitText(node);
  const waitLines = wait ? 2 : 1;
  return Math.max(GVR2.chipH,
    GVR2.padY * 2 + titleLines * GVR2.titleLineH + GVR2.contentGap + waitLines * GVR2.infoLineH);
}
function rowLayout(nodes, widthForNode, startY = GVR2.pad) {
  const grouped = new Map();
  for (const node of nodes) {
    const row = Number(node?.row) || 0;
    if (!grouped.has(row)) grouped.set(row, []);
    grouped.get(row).push(node);
  }
  const tops = new Map();
  const heights = new Map();
  let cursor = startY;
  for (const row of [...grouped.keys()].sort((a, b) => a - b)) {
    const height = Math.max(...grouped.get(row).map((node) => chipHeight(node, widthForNode(node))));
    tops.set(row, cursor); heights.set(row, height); cursor += height + GVR2.rowGap;
  }
  const last = [...grouped.keys()].sort((a, b) => a - b).at(-1);
  return { tops, heights, bottom: last == null ? startY : tops.get(last) + heights.get(last) };
}
// rankMembers[r] = the card names in rank r → per-column widths, x-offsets, and
// the clip-free canvas width (last column right edge + pad).
function columnLayout(rankMembers) {
  const widths = rankMembers.map((members) => members.reduce((max, card) => Math.max(max, chipWidth(card)), GVR2.minCol));
  const offsets = [];
  let cursor = GVR2.pad;
  for (const w of widths) { offsets.push(cursor); cursor += w + GVR2.colGap; }
  const last = widths.length - 1;
  const canvasWidth = offsets[last] + widths[last] + GVR2.pad;
  return { widths, offsets, canvasWidth };
}
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
    // GV-R1 honest-gather fixtures: an archived-status and a discarded-status
    // slice — dead lineage the widget must drop from the gather BEFORE layout
    // (no chip, no warning at either scope).
    file(`${board}/GV-H Archived.md`, 75), file(`${board}/GV-I Discarded.md`, 76),
    file(`${board}/nested/Hidden.md`, 80), file(`${board}/Not a Slice.md`, 90),
  ];
  const frontmatter = new Map([
    [boardNotePath, { type: 'kanban', 'kanban-plugin': 'board', board_role: 'epic' }],
    [`${board}/GV-A Base.md`, { type: 'slice', status: 'completed', depends_on: [] }],
    [`${board}/GV-B Widget.md`, { type: 'slice', status: 'in_progress', depends_on: ['[[GV-A Base]]'] }],
    [`${board}/GV-C Parked.md`, { type: 'slice', status: 'parked', depends_on: [], resume_condition: 'Waiting for Director sign-off' }],
    [`${board}/GV-D Blocked.md`, { type: 'slice', status: 'blocked', depends_on: ['GV-B Widget'] }],
    [`${board}/GV-E Stale.md`, { type: 'slice', status: 'planning', depends_on: [`[[${staleTarget}]]`] }],
    // GV-F carries a genuinely unrecognized status (NOT archived/discarded,
    // which now have honest-gather exclusion semantics) so it still exercises
    // the malformed-status chip + unreadable_slice warning path.
    [`${board}/GV-F Malformed.md`, { type: 'slice', status: 'garbled', depends_on: [] }],
    // GV-G depends on GV-A so depends (3) vs order (2) edge counts stay
    // ASYMMETRIC — a kind→style swap can never hide behind matching totals.
    [`${board}/GV-G LongPark.md`, { type: 'slice', status: 'parked', depends_on: ['[[GV-A Base]]'], resume_condition: longReason }],
    // GV-R1: archived + discarded lineage — excluded from the gather entirely.
    [`${board}/GV-H Archived.md`, { type: 'slice', status: 'archived', depends_on: ['[[GV-A Base]]'] }],
    [`${board}/GV-I Discarded.md`, { type: 'slice', status: 'discarded', depends_on: ['[[GV-B Widget]]'] }],
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
  const persistenceMutations = [];
  const savedLocalStorageDescriptor = Object.getOwnPropertyDescriptor(global, 'localStorage');
  const savedCoordinator = global.coordinator;
  const savedDeliveryCoordinator = global.DeliveryCoordinator;
  const coordinatorSentinel = new Proxy({}, {
    get(_target, name) {
      return (...args) => persistenceMutations.push({ surface: `coordinator.${String(name)}`, args });
    },
  });
  Object.defineProperty(global, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem() { return null; },
      setItem(...args) { persistenceMutations.push({ surface: 'localStorage.setItem', args }); },
      removeItem(...args) { persistenceMutations.push({ surface: 'localStorage.removeItem', args }); },
      clear(...args) { persistenceMutations.push({ surface: 'localStorage.clear', args }); },
    },
  });
  global.coordinator = coordinatorSentinel;
  global.DeliveryCoordinator = coordinatorSentinel;
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
  const sectionLabel = {
    divider(target) {
      const divider = (target.container || target).createEl('hr');
      divider.className = 'shared-section-divider';
      return divider;
    },
    render(dv, opts) {
      const label = (dv.container || dv).createEl('div', { text: opts.text });
      label.className = 'shared-section-label';
      label.__sectionOptions = opts;
      return label;
    },
  };
  global.customJS = {
    RenderSafe: { page: () => currentPage },
    GraphLayout: new GraphLayout(),
    EpicDashboard: dashboard,
    SectionLabel: sectionLabel,
    Coordinator: coordinatorSentinel,
    DeliveryCoordinator: coordinatorSentinel,
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
  assert.strictEqual(byClass(recordingContainer, 'graph-view-legend').length, 0,
    'BL2-LEGEND-EMPTY: an empty drawn graph renders no legend');
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
  assert.strictEqual(root.children[0]?.className, 'shared-section-divider',
    'VP-2 epic scope owns the shared SectionLabel divider as its first child');
  assert.strictEqual(root.children[1]?.className, 'shared-section-label',
    'VP-2 epic scope renders its section title through the shared SectionLabel primitive');
  assert.strictEqual(root.children[1]?.textContent, 'Dependency Graph',
    'VP-2 epic scope labels the graph section Dependency Graph');
  assert.strictEqual(root.children[1]?.__sectionOptions?.top, true,
    'VP-2 shared section label does not synthesize a second divider');
  assert.strictEqual(root.style.cssText, 'display:grid;gap:0;max-width:100%;',
    'VP3-ROOT-RHYTHM: epic root replaces the flat grid gap with explicit child spacing');
  bl6Check('epic-noop', () => byClass(root, 'graph-view-cluster-header').length === 0,
    'BL6-EPIC-SCOPE-NOOP: epic scope renders no cluster header or focus affordance');

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

  // Case 11: pin the SVG layer to the widget's REAL position math under the
  // NEW per-rank auto-width geometry. Every value is COMPUTED from the shared
  // formula (chipWidth/columnLayout), not a literal:
  //   chip x = its rank column's x-offset (rank is the HORIZONTAL axis)
  //   chip y = the sum of preceding row maxima + rowGap (row is VERTICAL)
  //   chip w = its rank column's auto-width (widest content in the rank)
  // Known layout for this fixture:
  //   GV-E Stale (0,0)  GV-F Malformed (0,1)  GV-C Parked (0,2)
  //   GV-A Base (0,3)   GV-B Widget (1,0)     GV-G LongPark (1,1)
  //   GV-D Blocked (2,0)
  // Every card here is short, so each column clamps to minCol (120px), the
  // columns advance by 120+colGap(28), and the canvas ends at the last column
  // right edge + pad — no clip.
  const G = { chipH: GVR2.chipH, pad: GVR2.pad };
  const mainRankMembers = [
    ['GV-E Stale', 'GV-F Malformed', 'GV-C Parked', 'GV-A Base'],
    ['GV-B Widget', 'GV-G LongPark'],
    ['GV-D Blocked'],
  ];
  const mainCols = columnLayout(mainRankMembers);
  assert.deepStrictEqual(mainCols.widths, [120, 120, 120],
    'case 11: every short-title column clamps to the 120px minimum');
  assert.deepStrictEqual(mainCols.offsets, [12, 160, 308],
    'case 11: column x-offsets accumulate prior column widths plus the inter-column gap');
  const mainNodes = new GraphLayout().layoutGraph(layoutCalls[0].slices, layoutCalls[0].options).nodes;
  const mainRows = rowLayout(mainNodes, (node) => mainCols.widths[node.rank || 0]);
  const posOf = (rank, row) => {
    const node = mainNodes.find((entry) => (entry.rank || 0) === rank && (entry.row || 0) === row);
    return {
      x: mainCols.offsets[rank], y: mainRows.tops.get(row), w: mainCols.widths[rank],
      h: chipHeight(node, mainCols.widths[rank]),
    };
  };

  // 11a — chip geometry: rank must land on the horizontal axis (its column
  // offset + width) and row on the vertical axis; a rank↔row transposition
  // moves GV-A Base off its accumulated variable-height row.
  for (const [id, rank, row] of [['GV-A', 0, 3], ['GV-G', 1, 1], ['GV-D', 2, 0]]) {
    const { x, y, w, h } = posOf(rank, row);
    assert(chipFor(id).style.cssText.includes(`left:${x}px;top:${y}px`)
      && chipFor(id).style.cssText.includes(`width:${w}px;height:${h}px`),
    `case 11a: ${id} chip sits at left:${x}px;top:${y}px;width:${w}px;height:${h}px — rank horizontal and row maxima vertical`);
  }

  // 11b — kind→endpoint binding + direction for the KNOWN depends edge
  // GV-A Base → GV-B Widget: the path starts at the prerequisite chip's
  // right-edge midpoint (chip x + its column width) and ends at the dependent
  // chip's left-edge midpoint, and THIS element carries the solid arrowed
  // depends markup.
  const gvA = posOf(0, 3);
  const gvB = posOf(1, 0);
  const x1 = gvA.x + gvA.w;
  const y1 = gvA.y + gvA.h / 2;
  const x2 = gvB.x;
  const y2 = gvB.y + gvB.h / 2;
  const bend = Math.max(24, (x2 - x1) / 2);
  const dependsD = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  const dependsEdge = dependsPaths.find((chunk) => dOf(chunk) === dependsD);
  assert(dependsEdge,
    `case 11b: the GV-A Base→GV-B Widget depends path runs prerequisite chip right-edge (${x1},${y1}) → dependent chip left-edge (${x2},${y2})`);
  assert(dependsEdge.includes('marker-end="url(#graph-view-arrow)"') && !dependsEdge.includes('stroke-dasharray'),
    'case 11b: the GV-A Base→GV-B Widget element itself carries the solid arrowed depends markup');

  // 11c — direction: the reversed drawing (dependent → prerequisite) of that
  // same edge must not exist anywhere in the SVG layer.
  const rx1 = gvB.x + gvB.w;
  const ry1 = gvB.y + gvB.h / 2;
  const rx2 = gvA.x;
  const ry2 = gvA.y + gvA.h / 2;
  const rbend = Math.max(24, (rx2 - rx1) / 2);
  const reversedD = `M ${rx1} ${ry1} C ${rx1 + rbend} ${ry1}, ${rx2 - rbend} ${ry2}, ${rx2} ${ry2}`;
  assert(!dependsPaths.some((chunk) => dOf(chunk) === reversedD)
    && !orderPaths.some((chunk) => dOf(chunk) === reversedD),
  'case 11c: no edge renders GV-B Widget → GV-A Base (depends direction is prerequisite → dependent)');

  // 11d — the KNOWN order edge GV-E Stale → GV-F Malformed (same rank,
  // vertical drop) leaves the upper chip's bottom edge at the shared column
  // center (chip x + column width / 2) and lands on the lower chip's top edge,
  // with dashed markup.
  const gvE = posOf(0, 0);
  const gvF = posOf(0, 1);
  const orderX = gvE.x + gvE.w / 2;
  const orderD = `M ${orderX} ${gvE.y + gvE.h} L ${orderX} ${gvF.y}`;
  const orderEdge = orderPaths.find((chunk) => dOf(chunk) === orderD);
  assert(orderEdge,
    `case 11d: the GV-E Stale→GV-F Malformed order path drops upper chip bottom (${orderX},${gvE.y + gvE.h}) → lower chip top (${orderX},${gvF.y})`);
  assert(orderEdge.includes('stroke-dasharray') && !orderEdge.includes('marker-end'),
    'case 11d: the GV-E Stale→GV-F Malformed element itself carries the dashed arrowless order markup');

  // 11e — clip-free canvas: the epic canvas width equals the last column's
  // right edge plus pad EXACTLY (dropping the auto-width sizing back to the old
  // pad*2 + maxRank*colW + chipW formula changes this number → RED).
  const mainCanvas = byClass(root, 'graph-view-canvas')
    .find((node) => !node.className.split(/\s+/).includes('graph-view-project-canvas'));
  assert(mainCanvas && mainCanvas.style.cssText.includes(`width:${mainCols.canvasWidth}px`),
    `case 11e: canvas width == last column right edge + pad (${mainCols.canvasWidth}px) — no clip at rest`);
  assert(mainCanvas.style.cssText.includes(`height:${mainRows.bottom + GVR2.pad}px`)
    && mainCanvas.style.cssText.includes('margin-inline:auto'),
  'case 11e: canvas height is last row bottom + pad, and CSS auto margins center only when spare width exists');
  const mainScroller = byClass(root, 'graph-view-scroll')[0];
  assert(mainScroller.style.cssText.includes('overflow-x:auto')
    && mainScroller.style.cssText.includes('overflow-y:hidden')
    && mainScroller.style.cssText.includes(`padding-bottom:${GVR2.scrollbarAllowance}px`),
  'case 11e: horizontal overflow is scrollable, vertical overflow is hidden, and scrollbar allowance is fixed');

  // Case 5: the per-chip INFO LINE — a colored lifecycle status word (from the
  // shared presentation API, not a duplicated table) plus an inline wait reason:
  // "needs <dep-id>" for a blocked slice, and the full resume_condition for a
  // parked slice (CSS bounds the visible wait box to two lines). Done /
  // in-progress chips show the status word with no wait span.
  const wordOf = (id) => byClass(chipFor(id), 'graph-view-status-word')[0];
  const glyphOf = (id) => byClass(chipFor(id), 'graph-view-status-glyph')[0];
  const waitOf = (id) => byClass(chipFor(id), 'graph-view-wait')[0];
  assert.strictEqual(waitOf('GV-C')?.textContent, 'Waiting for Director sign-off',
    'case 5: a parked slice info line shows the resume_condition from its start');
  assert.strictEqual(waitOf('GV-D')?.textContent, 'needs GV-B',
    'case 5: a blocked slice info line names its unmet dependency id ("needs <dep-id>")');
  const longWait = waitOf('GV-G');
  assert(longWait && longWait.textContent === longReason
    && longWait.style.cssText.includes('-webkit-line-clamp:2'),
  'case 5: a long parked resume reason stays complete in the DOM and is visually capped at two lines');
  assert.strictEqual(longWait.attrs.title, longReason,
    'case 5: the wait span title attribute carries the full resume reason');
  // Status word colored via the SHARED lifecycle presentation (class + color),
  // never a local color table.
  assert.strictEqual(wordOf('GV-D').textContent, 'blocked', 'case 5: the blocked status word reads "blocked"');
  assert(wordOf('GV-D').style.cssText.includes('color:var(--color-red)')
    && wordOf('GV-D').className.includes('status-blocked'),
  'case 5: the blocked status word carries the shared lifecycle color and class');
  assert.strictEqual(wordOf('GV-C').textContent, 'waiting', 'case 5: the parked status word reads "waiting"');
  assert(wordOf('GV-C').style.cssText.includes('color:var(--color-orange)'),
    'case 5: the parked status word carries the shared waiting color');
  assert.strictEqual(wordOf('GV-A').textContent, 'done', 'case 5: the completed status word reads "done"');
  for (const [id, expected] of [
    ['GV-A', '✓'], ['GV-B', '●'], ['GV-C', '◷'], ['GV-D', '!'], ['GV-E', '○'], ['GV-F', '?'],
  ]) {
    const glyph = glyphOf(id);
    const info = byClass(chipFor(id), 'graph-view-chip-info')[0];
    assert.strictEqual(glyph?.textContent, expected,
      `BL2-CHIP-GLYPH: ${id} receives its glyph through the shared presentation`);
    assert(info.children.indexOf(glyph) < info.children.indexOf(wordOf(id)),
      `BL2-CHIP-GLYPH: ${id} places the glyph before the colored status word`);
  }
  assert(!waitOf('GV-A') && !waitOf('GV-B'),
    'case 5: done and in-progress chips carry a status word but no wait span');

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
  assert.strictEqual(unreadableRows[0].textContent, "GV-F Malformed: slice state unreadable: 'garbled'",
    'case 8: the warning names the card and the unreadable state');
  assert.strictEqual(byClass(root, 'graph-view-warnings').length, 1,
    'warning strip renders as one compact block');
  const legend = byClass(root, 'graph-view-legend')[0];
  const legendEntries = byClass(legend, 'graph-view-legend-entry');
  assert.strictEqual(legendEntries.length, 6,
    'BL2-LEGEND-PRESENT: epic legend has one entry per distinct drawn status, including unrecognized');
  assert.deepStrictEqual(byClass(legend, 'graph-view-legend-label').map((node) => node.textContent).sort(),
    ['blocked', 'done', 'in progress', 'planning', 'unrecognized: garbled', 'waiting'].sort(),
    'BL2-LEGEND-PRESENT: epic legend names exactly the statuses present in the drawn graph');
  for (const entry of legendEntries) {
    const label = byClass(entry, 'graph-view-legend-label')[0]?.textContent;
    const expected = dashboard._statusPresentation(
      label === 'done' ? 'completed' : label === 'in progress' ? 'in_progress'
        : label === 'waiting' ? 'parked' : label === 'unrecognized: garbled' ? 'garbled' : label,
      lifecycleApi,
    );
    assert.strictEqual(byClass(entry, 'graph-view-legend-glyph')[0]?.textContent, expected.glyph,
      `BL2-LEGEND-SHARED: ${label} legend entry uses the shared glyph`);
    assert(entry.style.cssText.includes(`color:${expected.color}`),
      `BL2-LEGEND-SHARED: ${label} legend entry uses the shared color`);
  }
  const canvasForLegend = byClass(root, 'graph-view-canvas')[0];
  const epicScrollerIndex = root.children.findIndex((node) => node.className === 'graph-view-scroll');
  const epicWarningIndex = root.children.findIndex((node) => node.className === 'graph-view-warnings');
  assert(!flatten(canvasForLegend).includes(legend)
    && epicScrollerIndex < root.children.indexOf(legend)
    && root.children.indexOf(legend) < epicWarningIndex,
  'VP3-LEGEND-GEOMETRY: epic legend sits below and outside the canvas, before warnings');
  assert.strictEqual(legend.style.cssText,
    'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:8px 0 0;font-size:0.7em;',
  'VP3-LEGEND-RHYTHM: legend has the exact tight top margin and no former bottom margin');
  assert.strictEqual(byClass(root, 'graph-view-warnings')[0].style.cssText,
    'display:grid;gap:4px;margin-top:16px;padding:2px 0;',
  'VP3-WARNING-RHYTHM: warnings receive the roomier 16px separation explicitly');
  assert.strictEqual(byClass(root, 'graph-view-filter-toolbar')[0].style.cssText,
    'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;',
  'VP3-TOOLBAR-RHYTHM: controls hand off to the canvas on the exact tight 8px rhythm');

  // BL2-MISSING-STATUS: keep missing distinct from the unknown-token fixture
  // above. Suppressing unreadable_slice only for nullish status must turn this
  // executable path red while the neutral shared glyph and legend stay safe.
  const missingRoot = element();
  const missingWarnings = [];
  await new GraphView({ dashboard })._renderGraph(missingRoot, {
    nodes: [{ card: 'GV-M Missing', path: `${board}/GV-M Missing.md`, status: null, rank: 0, row: 0 }],
    edges: [],
  }, lifecycleApi, epicPath, missingWarnings);
  assert.strictEqual(byClass(missingRoot, 'graph-view-status-glyph')[0]?.textContent, '?',
    'BL2-MISSING-STATUS: a missing-status chip renders the neutral shared glyph without throwing');
  assert.strictEqual(byClass(missingRoot, 'graph-view-legend-glyph')[0]?.textContent, '?',
    'BL2-MISSING-STATUS: the missing-status legend entry renders the neutral shared glyph');
  assert.strictEqual(byClass(missingRoot, 'graph-view-legend-label')[0]?.textContent, 'unrecognized: (missing)',
    'BL2-MISSING-STATUS: the legend preserves the existing missing-status presentation');
  assert.deepStrictEqual(missingWarnings, [{ code: 'unreadable_slice', card: 'GV-M Missing', detail: '(missing)' }],
    'BL2-MISSING-STATUS: a missing status still emits exactly one unreadable_slice warning');

  // GV-R1 Behavior A — honest gather: a slice whose status maps to the
  // archived/discarded (excluded) lifecycle bucket contributes NO chip and NO
  // warning row. The gather drops it BEFORE layout, so case 1 above (exactly
  // the seven live slices reach layoutGraph, GV-H/GV-I absent) already pins
  // the pre-layout exclusion; here we confirm nothing leaks into the render.
  // MUTATION GUARD: remove the archived/discarded gather filter and GV-H
  // (archived→unrecognized) renders an eighth chip + an unreadable_slice
  // warning while GV-I (discarded) renders a ninth chip — both counts above
  // (case 3 chips === 7, case 8 unreadableRows === 1) turn RED.
  assert(!chipFor('GV-H') && !chipFor('GV-I'),
    'behavior A: archived and discarded slices render no chip');
  assert(!textOf(root).includes('GV-H') && !textOf(root).includes('GV-I'),
    'behavior A: archived and discarded slices contribute no warning row or any text');
  assert(!layoutCalls[0].slices.some((slice) => ['GV-H Archived', 'GV-I Discarded'].includes(slice.card)),
    'behavior A: the excluded slices never reach layoutGraph — the gather filters them out');

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
  const cleanLegend = byClass(cleanRoot, 'graph-view-legend')[0];
  assert.strictEqual(byClass(cleanLegend, 'graph-view-legend-entry').length, 2,
    'BL2-LEGEND-MUTANT: a two-status graph renders two entries, so hardcoding all lifecycle statuses turns red');
  assert.deepStrictEqual(byClass(cleanLegend, 'graph-view-legend-label').map((node) => node.textContent).sort(),
    ['done', 'in progress'],
    'BL2-LEGEND-MUTANT: absent statuses are omitted from the two-status fixture');
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
  assert(!/STATUS_GLYPHS/.test(widgetSource),
    'BL2-GLYPH-SOURCE: the widget declares and reads no local/shared glyph table; glyphs arrive via presentation');
  for (const glyph of Object.values(EpicDashboard.STATUS_GLYPHS)) {
    assert(!widgetSource.includes(JSON.stringify(glyph)),
      `BL2-GLYPH-SOURCE: graph-view contains no literal ${glyph} glyph`);
  }
  assert(!/\\(?:u[0-9a-f]{4}|x[0-9a-f]{2})/i.test(widgetSource),
    'BL2-GLYPH-SOURCE: escaped Unicode/hex literals cannot hide a second glyph source');
  assert(!/(?:^|[,{]\s*)['"]?(?:planning|in_progress|parked|blocked|completed|discarded)['"]?\s*:/m.test(widgetSource),
    'BL2-GLYPH-SOURCE: graph-view contains no status-keyed object table under any local name');
  assert.strictEqual((widgetSource.match(/presentation\.glyph/g) || []).length, 4,
    'BL2-GLYPH-SOURCE: all chip, legend, panel, and panel-link glyph sites read from shared presentation');
  assert(!/--color-(?:blue|green|purple|red)/.test(widgetSource),
    'case 10: the widget hardcodes no lifecycle bucket color');
  assert(widgetSource.includes('_statusPresentation') && widgetSource.includes('_deliveryApi'),
    'case 10: presentation and lifecycle resolution delegate to EpicDashboard');
  frontmatter.set(`${board}/GV-A Base.md`, { type: 'slice', status: 'completed', depends_on: [] });

  // BL-3 epic scope: analysis is delegated to GraphInsights over the exact
  // drawn nodes/edges. A is the sole root blocker; downstream stuck B is not a
  // root; completed D is reachable but excluded from A's gates count.
  const bl3Nodes = [
    { card: 'BLA-1 Root blocker', path: `${board}/BLA-1 Root blocker.md`, status: 'blocked', rank: 0, row: 0 },
    { card: 'BLB-1 Downstream stuck', path: `${board}/BLB-1 Downstream stuck.md`, status: 'blocked', rank: 1, row: 0 },
    { card: 'BLC-1 Live dependent', path: `${board}/BLC-1 Live dependent.md`, status: 'planning', rank: 2, row: 0 },
    { card: 'BLD-1 Completed dependent', path: `${board}/BLD-1 Completed dependent.md`, status: 'completed', rank: 1, row: 1 },
  ];
  const bl3Edges = [
    { from: 'BLA-1 Root blocker', to: 'BLB-1 Downstream stuck', kind: 'depends' },
    { from: 'BLB-1 Downstream stuck', to: 'BLC-1 Live dependent', kind: 'depends' },
    { from: 'BLA-1 Root blocker', to: 'BLD-1 Completed dependent', kind: 'depends' },
  ];
  const insightCalls = [];
  const realInsights = new GraphInsights();
  const delegatedInsights = {
    analyzeGraph(nodes, edges) {
      insightCalls.push({ nodes, edges });
      return realInsights.analyzeGraph(nodes, edges);
    },
  };
  const bl3Root = element();
  const bl3Warnings = [];
  await new GraphView({ dashboard, lifecycleApi, insights: delegatedInsights })._renderGraph(
    bl3Root, { nodes: bl3Nodes, edges: bl3Edges, warnings: [] }, lifecycleApi, epicPath, bl3Warnings,
  );
  assert.strictEqual(insightCalls.length, 1, 'BL3-DELEGATE: epic render delegates analysis exactly once');
  assert.strictEqual(insightCalls[0].nodes, bl3Nodes,
    'BL3-DELEGATE: GraphInsights receives the exact drawn epic nodes array');
  assert.strictEqual(insightCalls[0].edges, bl3Edges,
    'BL3-DELEGATE: GraphInsights receives the exact drawn epic edges array');
  assert.strictEqual((widgetSource.match(/\.analyzeGraph\(/g) || []).length, 1,
    'BL3-DELEGATE: GraphView has one delegation call and no second analysis path');
  assert(!/_closure\s*\(|_hasPath\s*\(/.test(widgetSource),
    'BL3-DELEGATE: GraphView reimplements no closure or reachability helper');

  const bl3Summary = byClass(bl3Root, 'graph-view-stuck-summary');
  assert.strictEqual(bl3Summary.length, 1, 'BL3-SUMMARY: a stuck graph renders one summary row');
  assert.strictEqual(bl3Summary[0].style.cssText,
    'color:var(--text-error);font-size:0.75em;font-weight:650;margin-bottom:8px;',
  'VP3-SUMMARY-RHYTHM: a stuck summary hands off on the exact tight rhythm');
  assert.strictEqual(bl3Summary[0].textContent, '1 root blocker · gating 2 slices',
    'BL3-SUMMARY: summary text deterministically names the root count and unique live gated total');
  const bl3Canvas = byClass(bl3Root, 'graph-view-canvas')[0];
  assert(!flatten(bl3Canvas).includes(bl3Summary[0])
    && bl3Root.children.indexOf(bl3Summary[0]) < bl3Root.children.findIndex((node) => node.className === 'graph-view-scroll'),
  'BL3-SUMMARY: summary sits above and outside the canvas, so chip coordinates cannot shift');
  const bl3Chips = byClass(bl3Root, 'graph-view-chip');
  const bl3ChipFor = (id) => bl3Chips.find((chip) => flatten(chip).some((node) => node.textContent === id));
  const bl3Badges = byClass(bl3Root, 'graph-view-gates-badge');
  assert.strictEqual(bl3Badges.length, 1,
    'BL3-MUTANT-BADGE-EVERY-STUCK: only the root blocker receives a badge');
  assert.strictEqual(bl3Badges[0].textContent, 'gates 2',
    'BL3-MUTANT-COUNT-COMPLETED: the completed reachable dependent is excluded from the badge count');
  assert(flatten(bl3ChipFor('BLA-1')).includes(bl3Badges[0]),
    'BL3-BADGE: the gates badge renders inside the root-blocker chip');
  assert.strictEqual(byClass(bl3ChipFor('BLB-1'), 'graph-view-gates-badge').length, 0,
    'BL3-MUTANT-BADGE-EVERY-STUCK: a downstream stuck chip is not a root blocker');
  assert(bl3ChipFor('BLA-1').style.cssText.includes('left:12px;top:12px')
    && bl3ChipFor('BLB-1').style.cssText.includes('top:12px'),
  'BL3-GEOMETRY: summary and inside-chip badge leave the established chip coordinates unchanged');
  assert.deepStrictEqual(bl3Warnings, [], 'BL3: successful insights add no warning spam');

  // BL-4 healthy dependent trace: BLC is not itself stuck, but its upstream
  // GraphInsights closure reaches the BLA root blocker through BLB. Selection
  // must use that supplied closure verbatim, never stop at the immediate edge.
  const bl3OpenCount = opened.length;
  bl3ChipFor('BLC-1').listeners.click({ stopPropagation() {} });
  assert.strictEqual(opened.length, bl3OpenCount,
    'BL4-HEALTHY-FIRST-TAP: selecting a healthy dependent does not open it');
  assert(!bl3ChipFor('BLA-1').className.includes('graph-view-dimmed')
    && !bl3ChipFor('BLB-1').className.includes('graph-view-dimmed')
    && !bl3ChipFor('BLC-1').className.includes('graph-view-dimmed')
    && bl3ChipFor('BLD-1').className.includes('graph-view-dimmed'),
  'BL4-HEALTHY-TRACE: a healthy chip selection keeps its full upstream path through the root blocker');
  assert.strictEqual(svgPaths(bl3Root, 'edge-depends').filter((chunk) => chunk.includes('graph-view-chain-edge')).length, 2,
    'BL4-HEALTHY-TRACE: both depends edges from the healthy chip to its root blocker are emphasized');

  // BL4-NULL-PROPAGATION: GraphInsights keeps a null-status node in the chain
  // for reachability but excludes it from gates. The panel must consume that
  // authoritative answer rather than locally recounting the closure.
  const nullGateNodes = [
    { card: 'BLN-A Root', path: `${board}/BLN-A Root.md`, status: 'blocked', rank: 0, row: 0 },
    { card: 'BLN-U Unknown', path: `${board}/BLN-U Unknown.md`, status: null, rank: 1, row: 0 },
    { card: 'BLN-B Live', path: `${board}/BLN-B Live.md`, status: 'planning', rank: 2, row: 0 },
  ];
  const nullGateEdges = [
    { from: 'BLN-A Root', to: 'BLN-U Unknown', kind: 'depends' },
    { from: 'BLN-U Unknown', to: 'BLN-B Live', kind: 'depends' },
  ];
  const nullGateRoot = element();
  await new GraphView({ dashboard, lifecycleApi, insights: realInsights })._renderGraph(
    nullGateRoot, { nodes: nullGateNodes, edges: nullGateEdges }, lifecycleApi, epicPath, [],
  );
  const nullGateChip = byClass(nullGateRoot, 'graph-view-chip').find((chip) => textOf(chip).includes('BLN-A'));
  nullGateChip.listeners.click({ stopPropagation() {} });
  const nullGatePanel = byClass(nullGateRoot, 'graph-view-detail-panel')[0];
  assert(byClass(nullGatePanel, 'graph-view-detail-gates-count')[0]?.textContent === '1 slice'
    && byClass(nullGatePanel, 'graph-view-detail-dependent').length === 1
    && textOf(byClass(nullGatePanel, 'graph-view-detail-dependent')[0]).includes('BLN-B'),
  'BL4-NULL-PROPAGATION: panel gates count/links exclude null-status propagation nodes exactly like GraphInsights');
  const nullGateChips = byClass(nullGateRoot, 'graph-view-chip');
  const nullGateChipFor = (id) => nullGateChips.find((chip) => textOf(chip).includes(id));
  assert(!nullGateChipFor('BLN-U').className.includes('graph-view-dimmed')
    && !nullGateChipFor('BLN-B').className.includes('graph-view-dimmed'),
  'BL4-NULL-PROPAGATION-CHAIN: null-status U remains highlighted in A\'s transitive chain while excluded from gates');

  const emptyFactRoot = element();
  await new GraphView({ dashboard, lifecycleApi, insights: realInsights })._renderGraph(
    emptyFactRoot,
    { nodes: [{ card: 'VPE-1 Empty facts', path: `${board}/VPE-1 Empty facts.md`, status: 'planning', rank: 0, row: 0 }], edges: [] },
    lifecycleApi, epicPath, [],
  );
  byClass(emptyFactRoot, 'graph-view-chip')[0].listeners.click({ stopPropagation() {} });
  const emptyFactPanel = byClass(emptyFactRoot, 'graph-view-detail-panel')[0];
  assert.strictEqual(byClass(emptyFactPanel, 'graph-view-detail-wait-row').length, 0,
    'VP4-EMPTY-WAIT: a card with no wait reason omits the entire WAITING ON row');
  assert.strictEqual(byClass(emptyFactPanel, 'graph-view-detail-needs').length, 0,
    'VP4-EMPTY-NEEDS: a card with no unmet prerequisites omits the entire prerequisites row');
  assert.strictEqual(byClass(emptyFactPanel, 'graph-view-detail-outcome').length, 0,
    'VP4-EMPTY-OUTCOME: a card with no Outcome omits the entire Outcome row');
  assert(byClass(emptyFactPanel, 'graph-view-detail-gates-count')[0]?.textContent === '0 slices'
    && byClass(emptyFactPanel, 'graph-view-detail-dependent').length === 0,
  'VP4-COUNT-ONLY-GATES: zero gates renders one exact count and no link artifact');

  // BL-3 calm/fail-soft posture. With no stuck nodes, real analysis must be
  // structurally byte-identical to GraphInsights missing. A throwing analyzer
  // follows that same legacy rendering path with no warning row.
  const healthyNodes = bl3Nodes.map((node, index) => ({
    ...node,
    status: index === 2 ? 'completed' : index === 1 ? 'in_progress' : 'planning',
  }));
  const healthyResult = { nodes: healthyNodes, edges: bl3Edges, warnings: [] };
  const healthyRoot = element();
  const missingInsightsRoot = element();
  const throwingInsightsRoot = element();
  const bl3HealthyWarnings = [];
  const bl3MissingWarnings = [];
  const bl3ThrowingWarnings = [];
  await new GraphView({ dashboard, lifecycleApi, insights: realInsights })._renderGraph(
    healthyRoot, healthyResult, lifecycleApi, epicPath, bl3HealthyWarnings,
  );
  await new GraphView({ dashboard, lifecycleApi, insights: {} })._renderGraph(
    missingInsightsRoot, healthyResult, lifecycleApi, epicPath, bl3MissingWarnings,
  );
  await new GraphView({
    dashboard,
    lifecycleApi,
    insights: { analyzeGraph() { throw new Error('insights unavailable'); } },
  })._renderGraph(throwingInsightsRoot, healthyResult, lifecycleApi, epicPath, bl3ThrowingWarnings);
  assert.strictEqual(byClass(healthyRoot, 'graph-view-stuck-summary').length, 0,
    'BL3-MUTANT-HEALTHY-SUMMARY: a healthy graph renders no summary');
  assert.strictEqual(byClass(healthyRoot, 'graph-view-gates-badge').length, 0,
    'BL3-HEALTHY: a healthy graph renders no gates badges');
  assert.deepStrictEqual(domShape(healthyRoot), domShape(missingInsightsRoot),
    'BL3-FAIL-SOFT: missing GraphInsights is structurally byte-identical to the healthy legacy render');
  assert.deepStrictEqual(domShape(missingInsightsRoot), domShape(throwingInsightsRoot),
    'BL3-FAIL-SOFT: throwing GraphInsights is structurally byte-identical to the missing-analysis render');
  assert.deepStrictEqual([...bl3HealthyWarnings, ...bl3MissingWarnings, ...bl3ThrowingWarnings], [],
    'BL3-FAIL-SOFT: unavailable analysis emits no warning spam');

  // BL-5 epic filters. The completed bridge is deliberately on the connecting
  // path from root blocker A to downstream stuck C: Stuck must keep it bright,
  // while composing Dim done must dim it. Selection then wins wholesale and
  // temporarily restores that bridge until the empty-canvas clear reapplies
  // both filters.
  const bl5Nodes = [
    { card: 'BL5-A Root', path: `${board}/BL5-A Root.md`, status: 'blocked', rank: 0, row: 0 },
    { card: 'BL5-B Completed bridge', path: `${board}/BL5-B Completed bridge.md`, status: 'completed', rank: 1, row: 0 },
    { card: 'BL5-C Downstream stuck', path: `${board}/BL5-C Downstream stuck.md`, status: 'blocked', rank: 2, row: 0 },
    { card: 'BL5-D Parked', path: `${board}/BL5-D Parked.md`, status: 'parked', rank: 0, row: 1 },
    { card: 'BL5-E Done', path: `${board}/BL5-E Done.md`, status: 'completed', rank: 1, row: 1 },
    { card: 'BL5-F Other', path: `${board}/BL5-F Other.md`, status: 'planning', rank: 2, row: 1 },
  ];
  const bl5Edges = [
    { from: 'BL5-A Root', to: 'BL5-B Completed bridge', kind: 'depends' },
    { from: 'BL5-B Completed bridge', to: 'BL5-C Downstream stuck', kind: 'depends' },
  ];
  const bl5Root = element();
  await new GraphView({ dashboard, lifecycleApi, insights: realInsights })._renderGraph(
    bl5Root, { nodes: bl5Nodes, edges: bl5Edges }, lifecycleApi, epicPath, [],
  );
  const bl5Toolbar = byClass(bl5Root, 'graph-view-filter-toolbar');
  const bl5ScrollerIndex = bl5Root.children.findIndex((node) => node.className === 'graph-view-scroll');
  assert.strictEqual(bl5Toolbar.length, 1, 'BL5-TOOLBAR-EPIC: epic scope renders one filter toolbar');
  assert(bl5Root.children.indexOf(bl5Toolbar[0]) < bl5ScrollerIndex,
    'BL5-TOOLBAR-EPIC: the toolbar sits above and outside the graph canvas');
  const bl5Stuck = byClass(bl5Root, 'graph-view-filter-stuck')[0];
  const bl5Done = byClass(bl5Root, 'graph-view-filter-done')[0];
  assert(bl5Stuck && bl5Done && bl5Stuck.textContent === 'Stuck' && bl5Done.textContent === 'Dim done'
    && bl5Stuck.attrs['aria-pressed'] === 'false' && bl5Done.attrs['aria-pressed'] === 'false'
    && bl5Stuck.style.cssText.includes('min-height:32px') && bl5Done.style.cssText.includes('min-height:32px'),
  'BL5-TOOLBAR-DEFAULT: both mobile-sized toggles render off by default');
  const bl5Chips = byClass(bl5Root, 'graph-view-chip');
  const bl5ChipFor = (id) => bl5Chips.find((chip) => textOf(chip).includes(id));
  // Snapshot values, not the harness node's mutable attrs object: otherwise
  // aria-pressed mutations can rewrite the supposed baseline by reference.
  const bl5AtRest = JSON.parse(JSON.stringify(domShape(bl5Root)));
  assert(bl5Chips.every((chip) => !chip.className.includes('graph-view-dimmed')),
    'BL5-AT-REST: filters off leave every chip at full strength');

  bl5Stuck.listeners.click({ stopPropagation() {} });
  for (const id of ['BL5-A', 'BL5-B', 'BL5-C', 'BL5-D']) {
    assert(!bl5ChipFor(id).className.includes('graph-view-dimmed'),
      `BL5-MUTANT-STUCK-CHAIN: ${id} remains full strength in the authoritative stuck keep-set`);
  }
  for (const id of ['BL5-E', 'BL5-F']) {
    assert(bl5ChipFor(id).className.includes('graph-view-dimmed'),
      `BL5-STUCK-COMPLEMENT: ${id} outside the stuck keep-set dims`);
  }
  assert(bl5Stuck.className.includes('graph-view-filter-active') && bl5Stuck.attrs['aria-pressed'] === 'true',
    'BL5-STUCK-STATE: Stuck exposes its active ephemeral state accessibly');

  bl5Done.listeners.click({ stopPropagation() {} });
  assert(bl5ChipFor('BL5-B').className.includes('graph-view-dimmed')
    && bl5ChipFor('BL5-E').className.includes('graph-view-dimmed')
    && bl5ChipFor('BL5-F').className.includes('graph-view-dimmed')
    && !bl5ChipFor('BL5-D').className.includes('graph-view-dimmed'),
  'BL5-FILTER-UNION: Dim done composes with Stuck and never dims the parked root');

  // BL5B-CROSS-INSTANCE-ACTIVE: render another widget while this one still
  // has BOTH filters active. Turning the first widget off before this probe
  // would let shared/module-level filter state survive unnoticed.
  const bl5ActiveFreshRoot = element();
  await new GraphView({ dashboard, lifecycleApi, insights: realInsights })._renderGraph(
    bl5ActiveFreshRoot, { nodes: bl5Nodes, edges: bl5Edges }, lifecycleApi, epicPath, [],
  );
  assert.deepStrictEqual(domShape(bl5ActiveFreshRoot), bl5AtRest,
    'BL5B-CROSS-INSTANCE-ACTIVE: a second render starts off while the first remains active');

  bubblingClick(bl5ChipFor('BL5-A'));
  assert(!bl5ChipFor('BL5-A').className.includes('graph-view-dimmed')
    && !bl5ChipFor('BL5-B').className.includes('graph-view-dimmed')
    && !bl5ChipFor('BL5-C').className.includes('graph-view-dimmed')
    && bl5ChipFor('BL5-D').className.includes('graph-view-dimmed'),
  'BL5-SELECTION-PRECEDENCE: selected closure wins wholesale and suspends both filter dim sets');
  byClass(bl5Root, 'graph-view-canvas')[0].listeners.click();
  assert(bl5ChipFor('BL5-B').className.includes('graph-view-dimmed')
    && !bl5ChipFor('BL5-D').className.includes('graph-view-dimmed'),
  'BL5-SELECTION-CLEAR: clearing selection reapplies active filter composition');

  bl5Stuck.listeners.click({ stopPropagation() {} });
  assert(bl5ChipFor('BL5-B').className.includes('graph-view-dimmed')
    && bl5ChipFor('BL5-E').className.includes('graph-view-dimmed')
    && !bl5ChipFor('BL5-D').className.includes('graph-view-dimmed')
    && !bl5ChipFor('BL5-F').className.includes('graph-view-dimmed'),
  'BL5-MUTANT-DIM-PARKED: Dim done alone dims completed chips and only completed chips');
  bl5Done.listeners.click({ stopPropagation() {} });
  assert.deepStrictEqual(domShape(bl5Root), bl5AtRest,
    'BL5-TOGGLE-OFF: turning both filters off restores the exact at-rest DOM');

  const bl5FreshRoot = element();
  await new GraphView({ dashboard, lifecycleApi, insights: realInsights })._renderGraph(
    bl5FreshRoot, { nodes: bl5Nodes, edges: bl5Edges }, lifecycleApi, epicPath, [],
  );
  assert.deepStrictEqual(domShape(bl5FreshRoot), bl5AtRest,
    'BL5-MUTANT-PERSISTENCE: a fresh render resets both ephemeral toggles to off');

  // BL5B-CLOSURE-DIVERGENCE: drawn edges say A -> B -> C, while the injected
  // GraphInsights authority says A -> G -> C. Stuck must follow the supplied
  // memberships: G stays bright and B dims. Any widget-side traversal produces
  // the opposite footprint and is therefore observable.
  const bl5DivergentNodes = [...bl5Nodes,
    { card: 'BL5-G Closure bridge', path: `${board}/BL5-G Closure bridge.md`, status: 'planning', rank: 1, row: 2 }];
  const blankInsight = () => ({ upstream: [], downstream: [], gates: 0 });
  const bl5DivergentPerNode = Object.fromEntries(bl5DivergentNodes.map((node) => [node.card, blankInsight()]));
  bl5DivergentPerNode['BL5-A Root'].downstream = ['BL5-G Closure bridge', 'BL5-C Downstream stuck'];
  bl5DivergentPerNode['BL5-C Downstream stuck'].upstream = ['BL5-A Root', 'BL5-G Closure bridge'];
  const bl5DivergentInsights = {
    analyzeGraph() {
      return {
        perNode: bl5DivergentPerNode,
        summary: { stuckCount: 3, rootBlockers: ['BL5-A Root'], gatedTotal: 2 },
      };
    },
  };
  const bl5DivergentRoot = element();
  await new GraphView({ dashboard, lifecycleApi, insights: bl5DivergentInsights })._renderGraph(
    bl5DivergentRoot, { nodes: bl5DivergentNodes, edges: bl5Edges }, lifecycleApi, epicPath, [],
  );
  byClass(bl5DivergentRoot, 'graph-view-filter-stuck')[0].listeners.click({ stopPropagation() {} });
  const bl5DivergentChips = byClass(bl5DivergentRoot, 'graph-view-chip');
  const bl5DivergentChipFor = (id) => bl5DivergentChips.find((chip) => textOf(chip).includes(id));
  for (const id of ['BL5-A', 'BL5-C', 'BL5-D', 'BL5-G']) {
    assert(!bl5DivergentChipFor(id).className.includes('graph-view-dimmed'),
      `BL5B-CLOSURE-DIVERGENCE: authoritative keep member ${id} remains bright`);
  }
  for (const id of ['BL5-B', 'BL5-E', 'BL5-F']) {
    assert(bl5DivergentChipFor(id).className.includes('graph-view-dimmed'),
      `BL5B-CLOSURE-DIVERGENCE: non-member ${id} dims despite the drawn edge path`);
  }

  // GraphInsights exclusively owns the root/closure semantics needed by
  // Stuck. Missing or throwing analysis must leave the toggle inert rather
  // than approximating a keep-set that drops the completed bridge.
  // BL5B-FAIL-SOFT-MISSING BL5B-FAIL-SOFT-THROWING
  for (const [label, insights] of [
    ['missing', {}],
    ['throwing', { analyzeGraph() { throw new Error('BL5 insights unavailable'); } }],
  ]) {
    const failSoftRoot = element();
    await new GraphView({ dashboard, lifecycleApi, insights })._renderGraph(
      failSoftRoot, { nodes: bl5Nodes, edges: bl5Edges }, lifecycleApi, epicPath, [],
    );
    const before = domShape(failSoftRoot);
    const toggle = byClass(failSoftRoot, 'graph-view-filter-stuck')[0];
    toggle.listeners.click({ stopPropagation() {} });
    assert.deepStrictEqual(domShape(failSoftRoot), before,
      `BL5-FAIL-SOFT-${label.toUpperCase()}: Stuck is an exact no-op without authoritative GraphInsights`);
    assert(byClass(failSoftRoot, 'graph-view-chip').every((chip) => !chip.className.includes('graph-view-dimmed')),
      `BL5-MUTANT-${label.toUpperCase()}-INSIGHTS-BRIDGE: unavailable analysis never dims a connecting-chain chip`);
  }

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

  // ---- GV-R1 Behavior B: cross-epic dangling → linkable ghost stub ----
  // At epic scope, a dangling depends_on whose target resolves by card name to
  // a type:slice under cards_root in a DIFFERENT epic renders one small ghost
  // external stub (labeled 'Owning Epic · Card-id', a clickable internal link
  // to that card) instead of a warning; a target that resolves NOWHERE keeps
  // its single dangling_dependency warning row.
  const savedAppB = global.app;
  const savedCustomJSB = global.customJS;
  const bCardsRoot = 'spice/projects/beta/tasks';
  const bEpicDir = `${bCardsRoot}/Home Epic`;
  const bEpicPath = `${bEpicDir}/Home Epic.md`;
  const bBoard = `${bEpicDir}/board`;
  const bBoardNote = `${bBoard}/Home Epic-board.md`;
  const opsEpicDir = `${bCardsRoot}/Loop Ops`;
  const opsSlicePath = `${opsEpicDir}/board/GA-OPS21a4 Ops Slice.md`;
  const bFiles = [
    file(bBoardNote, 1),
    file(`${bBoard}/HB-1 Consumer.md`, 10),
    file(`${bBoard}/HB-2 Ghost.md`, 20),
    // The owning-epic slice lives under the SAME cards_root, a DIFFERENT epic.
    file(`${opsEpicDir}/Loop Ops.md`, 30),
    file(`${opsEpicDir}/board/Loop Ops-board.md`, 31),
    file(opsSlicePath, 32),
  ];
  const bFrontmatter = new Map([
    [bBoardNote, { type: 'kanban', 'kanban-plugin': 'board', board_role: 'epic' }],
    // HB-1 depends on a slice owned by Loop Ops → resolves cross-epic → stub.
    [`${bBoard}/HB-1 Consumer.md`, { type: 'slice', status: 'in_progress', depends_on: ['[[GA-OPS21a4 Ops Slice]]'] }],
    // HB-2 depends on a name that resolves NOWHERE under cards_root → warning.
    [`${bBoard}/HB-2 Ghost.md`, { type: 'slice', status: 'planning', depends_on: ['[[Totally Missing Card]]'] }],
    [`${opsEpicDir}/Loop Ops.md`, { type: 'epic' }],
    [`${opsEpicDir}/board/Loop Ops-board.md`, { type: 'kanban', 'kanban-plugin': 'board', board_role: 'epic' }],
    [opsSlicePath, { type: 'slice', status: 'in_progress', depends_on: [] }],
  ]);
  const bBoardBody = [
    '---', 'kanban-plugin: board', 'type: kanban', 'board_role: epic', '---', '',
    '## In Planning', '', '- [ ] [[HB-2 Ghost]]', '',
    '## In Progress', '', '- [ ] [[HB-1 Consumer]]', '',
  ].join('\n');
  const bOpened = [];
  const bMutations = [];
  const bMutator = (name) => () => { bMutations.push(name); throw new Error(`read-only fixture invoked ${name}`); };
  global.app = {
    vault: {
      getMarkdownFiles: () => bFiles,
      cachedRead: async (entry) => {
        if (entry.path === bBoardNote) return bBoardBody;
        throw new Error(`unexpected read ${entry.path}`);
      },
      create: bMutator('vault.create'), modify: bMutator('vault.modify'),
      delete: bMutator('vault.delete'), rename: bMutator('vault.rename'), trash: bMutator('vault.trash'),
      adapter: {
        write: bMutator('adapter.write'), append: bMutator('adapter.append'),
        process: bMutator('adapter.process'), remove: bMutator('adapter.remove'),
        rename: bMutator('adapter.rename'), mkdir: bMutator('adapter.mkdir'), rmdir: bMutator('adapter.rmdir'),
      },
    },
    metadataCache: {
      getFileCache: (entry) => ({ frontmatter: bFrontmatter.get(entry.path) || {} }),
      trigger: bMutator('metadataCache.trigger'),
    },
    fileManager: { processFrontMatter: bMutator('fileManager.processFrontMatter') },
    workspace: { openLinkText: (...args) => bOpened.push(args) },
  };
  const bPage = { file: { path: bEpicPath, folder: bEpicDir } };
  global.customJS = {
    RenderSafe: { page: () => bPage },
    GraphLayout: new GraphLayout(),
    GraphInsights: new GraphInsights(),
    EpicDashboard: new EpicDashboard({ lifecycleApi }),
    Coordinator: coordinatorSentinel,
    DeliveryCoordinator: coordinatorSentinel,
  };
  const bContainer = element();
  await new GraphView().render({ container: bContainer });
  const bRoot = bContainer.children.find((child) => child.className === 'graph-view-root');
  assert(bRoot, 'B: epic scope mounts one graph-view-root');

  // B1: exactly one ghost stub node renders for the cross-epic dependency,
  // labeled with the owning epic name and the target card id.
  const stubNodes = byClass(bRoot, 'graph-view-stub');
  assert.strictEqual(stubNodes.length, 1,
    'B1: exactly one cross-epic ghost stub node renders');
  const stubText = textOf(stubNodes[0]);
  assert(stubText.includes('Loop Ops') && stubText.includes('GA-OPS21a4'),
    'B1: the stub is labeled with the owning epic name and the target card id');
  // B2 / BL4-STUB: a stub participates in select-first, but its detail panel
  // degrades to identity + explicit Open card only (no invented status,
  // prerequisites, outcome, or gates content).
  assert(stubNodes[0].style.cssText.includes('cursor:pointer')
    && typeof stubNodes[0].listeners.click === 'function',
  'B2: the stub is a clickable internal link');
  const stubCanvas = byClass(bRoot, 'graph-view-canvas')[0];
  const stubFirstTap = bubblingClick(stubNodes[0]);
  assert(stubFirstTap.stopped && stubNodes[0].parent === stubCanvas,
    'BL4-CHIP-CLICK-BUBBLE-GUARD: stub selection stops before the owning canvas clear handler');
  assert.strictEqual(bOpened.length, 0, 'BL4-STUB-FIRST-TAP: selecting a stub does not open it');
  const stubPanel = byClass(bRoot, 'graph-view-detail-panel')[0];
  assert(stubPanel && textOf(stubPanel).includes('GA-OPS21a4') && textOf(stubPanel).includes('Ops Slice')
    && byClass(stubPanel, 'graph-view-detail-open').length === 1,
  'BL4-STUB: the stub detail panel identifies the target and offers Open card');
  assert.strictEqual(byClass(stubPanel, 'graph-view-detail-status').length
    + byClass(stubPanel, 'graph-view-detail-needs').length
    + byClass(stubPanel, 'graph-view-detail-outcome').length
    + byClass(stubPanel, 'graph-view-detail-gates').length, 0,
  'BL4-STUB: unavailable detail fields are omitted rather than fabricated');
  byClass(stubPanel, 'graph-view-detail-open')[0].listeners.click({ stopPropagation() {} });
  assert.deepStrictEqual(bOpened.at(-1), [`${opsEpicDir}/board/GA-OPS21a4 Ops Slice`, bEpicPath, false],
    'B2: the explicit stub Open card affordance opens the owning cross-epic card');
  // B3: a depends edge is drawn into the stub node.
  const bDepends = svgPaths(bRoot, 'edge-depends');
  assert(bDepends.some((chunk) => chunk.includes('edge-cross-epic')),
    'B3: a cross-epic depends edge connects to the stub');
  // B4 (MUTATION GUARD): the resolves-nowhere dependency still warns and is NOT
  // converted to a stub. Drop the resolves-under-cards_root guard so every
  // dangling becomes a stub unconditionally and this assertion turns RED.
  const bDangling = byClass(bRoot, 'warning-dangling-dependency');
  assert.strictEqual(bDangling.length, 1,
    'B4: a target resolvable nowhere under cards_root stays exactly one dangling warning');
  assert.strictEqual(bDangling[0].textContent,
    "HB-2 Ghost: depends on a card that doesn't exist: 'Totally Missing Card'",
    'B4: the surviving warning names the dependent card and the unresolvable target');
  assert.strictEqual(byClass(bRoot, 'graph-view-stub').length, 1,
    'B4: the unresolvable dangling did NOT become a second stub');
  // B5: the widget performed zero write calls across the behavior-B render.
  assert.deepStrictEqual(bMutations, [],
    'B5: cross-epic stub resolution invokes no vault, adapter, frontmatter, or metadata mutator');
  global.app = savedAppB;
  global.customJS = savedCustomJSB;

  // ---- GV-R2 presentation fixture (MX): per-rank auto-width columns, two-line
  // wrapped titles vs beyond-cap ellipsis, the status-word + wait info line, and
  // the Outcome hover tooltip. Widths / offsets / canvas width are recomputed
  // from the SAME formula the widget uses (columnLayout above), so a formula
  // mutation in the widget diverges from these expectations → RED.
  const savedAppMX = global.app;
  const savedCustomJSMX = global.customJS;
  const mxEpicDir = 'spice/projects/mixed/tasks/MX Epic';
  const mxEpicPath = `${mxEpicDir}/MX Epic.md`;
  const mxBoard = `${mxEpicDir}/board`;
  const mxBoardNote = `${mxBoard}/MX Epic-board.md`;
  const mxShort = 'MX-A Hi';
  const mxMiddling = 'MX-B This title is of a middling sort length';
  const mxLongTitle = 'W'.repeat(120);
  assert.strictEqual(mxLongTitle.length, 120, 'MX fixture carries exactly 120 worst-case wide glyphs');
  const mxLong = `MX-C ${mxLongTitle}`;
  const mxParked = 'MX-D Park';
  const mxParkReason = 'Blocked on the upstream vendor SDK cut before this slice can resume in earnest';
  const mxOutcome = 'MX-A delivers the short deterministic path.';
  const mxLongOutcome = 'The long slice ships at last.';
  const mxFiles = [
    file(mxBoardNote, 1),
    file(`${mxBoard}/${mxShort}.md`, 10), file(`${mxBoard}/${mxMiddling}.md`, 20),
    file(`${mxBoard}/${mxLong}.md`, 30), file(`${mxBoard}/${mxParked}.md`, 40),
  ];
  const mxFrontmatter = new Map([
    [mxBoardNote, { type: 'kanban', 'kanban-plugin': 'board', board_role: 'epic' }],
    [`${mxBoard}/${mxShort}.md`, { type: 'slice', status: 'planning', depends_on: [] }],
    [`${mxBoard}/${mxMiddling}.md`, { type: 'slice', status: 'planning', depends_on: [] }],
    // MX-C blocked on the (incomplete) short slice → unmet dep → "needs MX-A".
    [`${mxBoard}/${mxLong}.md`, { type: 'slice', status: 'blocked', depends_on: [`[[${mxShort}]]`] }],
    // MX-D parked with a long resume_condition → info line shows its start.
    [`${mxBoard}/${mxParked}.md`, { type: 'slice', status: 'parked', depends_on: [`[[${mxMiddling}]]`], resume_condition: mxParkReason }],
  ]);
  const mxBoardBody = [
    '---', 'kanban-plugin: board', 'type: kanban', 'board_role: epic', '---', '',
    '## In Planning', '', `- [ ] [[${mxShort}]]`, `- [ ] [[${mxMiddling}]]`, '',
    '## In Progress', '', `- [ ] [[${mxLong}]]`, `- [ ] [[${mxParked}]]`, '',
  ].join('\n');
  const mxBodies = new Map([
    [mxBoardNote, mxBoardBody],
    // MX-A carries an Outcome section → its first sentence is the tooltip.
    [`${mxBoard}/${mxShort}.md`, `## Outcome\n\n${mxOutcome} Second sentence is ignored.\n`],
    [`${mxBoard}/${mxMiddling}.md`, '## Outcome\n\nMiddling outcome text.\n'],
    [`${mxBoard}/${mxLong}.md`, `### Outcome\n\n${mxLongOutcome}\n`],
    // MX-D has NO Outcome section → the tooltip falls back to the full title.
    [`${mxBoard}/${mxParked}.md`, 'Body text without any outcome heading.\n'],
  ]);
  const mxMutations = [];
  const mxMutator = (name) => () => { mxMutations.push(name); throw new Error(`read-only fixture invoked ${name}`); };
  global.app = {
    vault: {
      getMarkdownFiles: () => mxFiles,
      cachedRead: async (entry) => {
        if (mxBodies.has(entry.path)) return mxBodies.get(entry.path);
        throw new Error(`unexpected read ${entry.path}`);
      },
      create: mxMutator('vault.create'), modify: mxMutator('vault.modify'),
      delete: mxMutator('vault.delete'), rename: mxMutator('vault.rename'), trash: mxMutator('vault.trash'),
      adapter: {
        write: mxMutator('adapter.write'), append: mxMutator('adapter.append'),
        process: mxMutator('adapter.process'), remove: mxMutator('adapter.remove'),
        rename: mxMutator('adapter.rename'), mkdir: mxMutator('adapter.mkdir'), rmdir: mxMutator('adapter.rmdir'),
      },
    },
    metadataCache: {
      getFileCache: (entry) => ({ frontmatter: mxFrontmatter.get(entry.path) || {} }),
      trigger: mxMutator('metadataCache.trigger'),
    },
    fileManager: { processFrontMatter: mxMutator('fileManager.processFrontMatter') },
    workspace: { openLinkText: (...args) => mxOpened.push(args) },
  };
  const mxOpened = [];
  const mxPage = { file: { path: mxEpicPath, folder: mxEpicDir } };
  global.customJS = {
    RenderSafe: { page: () => mxPage },
    GraphLayout: new GraphLayout(),
    EpicDashboard: new EpicDashboard({ lifecycleApi }),
    Coordinator: coordinatorSentinel,
    DeliveryCoordinator: coordinatorSentinel,
  };
  const mxContainer = element();
  await new GraphView({ lifecycleApi, insights: new GraphInsights() }).render({ container: mxContainer });
  const mxRoot = mxContainer.children.find((child) => child.className === 'graph-view-root');
  assert(mxRoot, 'MX: epic scope mounts one graph-view-root');
  const mxChips = byClass(mxRoot, 'graph-view-chip');
  const mxChipFor = (id) => mxChips.find((chip) => flatten(chip).some((node) => node.textContent === id));

  // MX-widths — per-rank auto-width: rank 0 = {MX-A short, MX-B middling},
  // rank 1 = {MX-C beyond-cap, MX-D short}. Rows sort alphabetically within a
  // rank (no laneOrder tie). Column width = widest content in the rank; the
  // long title keeps its deterministic full-wrap width within the shared cap.
  const mxCols = columnLayout([[mxShort, mxMiddling], [mxLong, mxParked]]);
  assert.strictEqual(mxCols.widths[0], 242,
    'MX: rank-0 column width equals the widest chip content (MX-B middling → 242px)');
  assert.strictEqual(mxCols.widths[1], chipWidth(mxLong),
    'MX: rank-1 column width comes from every wrapped line of the full MX-C title');
  assert(mxCols.widths[1] <= GVR2.maxCol && mxCols.widths[1] > mxCols.widths[0],
    'MX: the 120-character title widens its column without exceeding the shared cap');
  assert.strictEqual(mxCols.canvasWidth,
    mxCols.offsets[1] + mxCols.widths[1] + GVR2.pad,
  'MX: clip-free canvas width is the last column right edge plus pad');
  const mxNodes = [
    { card: mxShort, rank: 0, row: 0 },
    { card: mxMiddling, rank: 0, row: 1 },
    { card: mxLong, rank: 1, row: 0, waitReason: `waiting on: ${mxShort}` },
    { card: mxParked, rank: 1, row: 1, waitReason: mxParkReason },
  ];
  const mxRows = rowLayout(mxNodes, (node) => mxCols.widths[node.rank]);
  // Independent wide-glyph bound: a 12px proportional-font W occupies less
  // than 12px in the measured native fixture. Prove the allocated title lines
  // cover that pixel demand; changing only titleGlyphPx back to the inherited
  // 7px average makes this inequality red even if the replica still executes.
  const measuredWideGlyphPx = 12;
  const renderedIdBudgetPx = 'MX-C'.length * 8 + 5;
  const renderedTitleAreaPx = mxCols.widths[1] - GVR2.hPad - renderedIdBudgetPx;
  const wideGlyphLinesNeeded = Math.ceil(mxLongTitle.length * measuredWideGlyphPx / renderedTitleAreaPx);
  const allocatedWideGlyphLines = wrapLongest(mxLongTitle,
    Math.floor((mxCols.widths[1] - GVR2.hPad - ('MX-C'.length * GVR2.titleGlyphPx + 5))
      / GVR2.titleGlyphPx)).lines.length;
  assert(allocatedWideGlyphLines >= wideGlyphLinesNeeded,
    'MX average-width mutant: allocated title lines contain the independently measured 120-W pixel demand');
  for (const [id, rank, row] of [['MX-A', 0, 0], ['MX-B', 0, 1], ['MX-C', 1, 0], ['MX-D', 1, 1]]) {
    const x = mxCols.offsets[rank];
    const y = mxRows.tops.get(row);
    const w = mxCols.widths[rank];
    const h = chipHeight(mxNodes.find((node) => node.rank === rank && node.row === row), w);
    const chip = mxChipFor(id);
    assert(chip.style.cssText.includes(`left:${x}px;top:${y}px`)
      && chip.style.cssText.includes(`width:${w}px;height:${h}px`),
    `MX: ${id} chip uses row-max geometry (left:${x}px;top:${y}px;width:${w}px;height:${h}px)`);
  }

  // MX-clip: the shared canvas is exactly the last column right edge + pad.
  const mxCanvas = byClass(mxRoot, 'graph-view-canvas')[0];
  assert(mxCanvas && mxCanvas.style.cssText.includes(`width:${mxCols.canvasWidth}px`),
    `MX: canvas width == last column right edge + pad (${mxCols.canvasWidth}px), no clip at rest`);
  assert(mxCanvas.style.cssText.includes(`height:${mxRows.bottom + GVR2.pad}px`)
    && mxCanvas.style.cssText.includes('margin-inline:auto'),
  'MX: canvas ends at the last variable-height row plus pad and centers only through auto margins');
  const mxScroller = byClass(mxRoot, 'graph-view-scroll')[0];
  assert(mxScroller.style.cssText.includes('overflow-x:auto')
    && mxScroller.style.cssText.includes('overflow-y:hidden')
    && mxScroller.style.cssText.includes(`padding-bottom:${GVR2.scrollbarAllowance}px`),
  'MX: scroller owns horizontal overflow and fixed bottom scrollbar allowance');

  // MX-wrap: titles never clamp. The 120-character title remains complete in
  // the DOM and its deterministic line count expands the whole row.
  const mxTitleOf = (chip) => byClass(chip, 'graph-view-chip-name')[0];
  const mxLongChip = mxChipFor('MX-C');
  const mxMidChip = mxChipFor('MX-B');
  assert(!mxLongChip.className.split(/\s+/).includes('graph-view-chip-clamped')
    && !mxMidChip.className.split(/\s+/).includes('graph-view-chip-clamped'),
  'MX mutant: no title receives the retired clamp marker');
  assert(!mxTitleOf(mxLongChip).style.cssText.includes('line-clamp')
    && !mxTitleOf(mxMidChip).style.cssText.includes('line-clamp'),
  'MX mutant: title CSS contains no line clamp');
  assert(byClass(mxLongChip, 'graph-view-chip-title')[0].style.cssText.includes(`line-height:${GVR2.titleLineH}px`)
    && byClass(mxLongChip, 'graph-view-chip-info')[0].style.cssText.includes(`line-height:${GVR2.infoLineH}px`),
  'MX mutant: rendered title and info line boxes are bound to the exact height formula constants');
  assert(mxTitleOf(mxLongChip).style.cssText.includes(`font-size:${GVR2.titleFontPx}px`)
    && GVR2.titleGlyphPx > GVR2.titleFontPx,
  'MX mutant: repeated-W geometry uses an explicit title font and a strictly conservative wider glyph cell');
  assert.strictEqual(mxTitleOf(mxMidChip).textContent, 'This title is of a middling sort length',
    'MX: the in-cap two-line title renders its full text with no ellipsis character');
  assert(mxTitleOf(mxLongChip).textContent === mxLongTitle
    && !mxTitleOf(mxLongChip).textContent.includes('…'),
  'MX: the 120-character title renders every word with no ellipsis');

  // MX-info: blocked → "needs <dep-id>"; parked → resume_condition from its
  // start (full DOM text, visually capped at two CSS lines); status word shared-colored.
  const mxWaitOf = (id) => byClass(mxChipFor(id), 'graph-view-wait')[0];
  const mxWordOf = (id) => byClass(mxChipFor(id), 'graph-view-status-word')[0];
  assert.strictEqual(mxWaitOf('MX-C')?.textContent, 'needs MX-A',
    'MX: a blocked slice info line names its unmet dependency id ("needs MX-A")');
  assert(mxWordOf('MX-C').textContent === 'blocked'
    && mxWordOf('MX-C').style.cssText.includes('color:var(--color-red)')
    && mxWordOf('MX-C').className.includes('status-blocked'),
  'MX: the blocked status word carries the shared lifecycle color and class');
  const mxParkWait = mxWaitOf('MX-D');
  assert(mxParkWait && mxParkWait.textContent === mxParkReason
    && mxParkWait.style.cssText.includes('-webkit-line-clamp:2'),
  'MX: a parked wait preserves its full DOM text and caps only its visual box at two lines');
  assert.strictEqual(mxParkWait.attrs.title, mxParkReason,
    'MX: the parked wait span title carries the full resume_condition');
  assert(mxWordOf('MX-D').textContent === 'waiting'
    && mxWordOf('MX-D').style.cssText.includes('color:var(--color-orange)'),
  'MX: the parked status word carries the shared waiting color');

  // MX-outcome: the chip hover tooltip carries the card's Outcome sentence; a
  // card with no Outcome section falls back to the full title. The Outcome text
  // never appears as a visible info line.
  assert.strictEqual(mxChipFor('MX-A').attrs.title, mxOutcome,
    'MX: the chip hover tooltip carries the card Outcome sentence');
  assert.strictEqual(mxChipFor('MX-D').attrs.title, mxParked,
    'MX: a card with no Outcome section falls back to its full title in the tooltip');
  assert(!textOf(mxRoot).includes(mxOutcome),
    'MX: the Outcome sentence lives in the tooltip only, never as visible text');

  // BL-4 epic scope. Named mutation guards:
  // - BL4-MUTANT-FIRST-TAP-OPENS turns RED if the first tap navigates.
  // - BL4-MUTANT-DIM-CLOSURE turns RED if the selected closure, rather than
  //   its complement, receives graph-view-dimmed.
  // - BL4-MUTANT-PANEL-AT-REST turns RED if a detail panel exists unselected.
  const mxAtRest = domShape(mxRoot);
  assert.strictEqual(byClass(mxRoot, 'graph-view-detail-panel').length, 0,
    'BL4-MUTANT-PANEL-AT-REST: no panel renders before a chip is selected');
  const mxOpenCount = mxOpened.length;
  const mxFirstTap = bubblingClick(mxChipFor('MX-C'));
  assert(mxFirstTap.stopped,
    'BL4-CHIP-CLICK-BUBBLE-GUARD: epic chip selection stops before the canvas clear handler');
  assert.strictEqual(mxOpened.length, mxOpenCount,
    'BL4-MUTANT-FIRST-TAP-OPENS: first tap selects MX-C without navigation');
  const mxPanel = byClass(mxRoot, 'graph-view-detail-panel')[0];
  assert(mxPanel && textOf(mxPanel).includes('MX-C')
    && textOf(mxPanel).includes(mxLongTitle)
    && textOf(mxPanel).includes('blocked')
    && textOf(mxPanel).includes('waiting on: MX-A Hi')
    && textOf(mxPanel).includes(mxLongOutcome)
    && byClass(mxPanel, 'graph-view-detail-gates-count')[0]?.textContent === '0 slices',
  'BL4-PANEL: selected card identity, shared status, wait reason, Outcome, and gated count render inline');
  const mxHeader = byClass(mxPanel, 'graph-view-detail-header')[0];
  assert(mxHeader
    && byClass(mxHeader, 'graph-view-detail-id')[0]?.textContent === 'MX-C'
    && byClass(mxHeader, 'graph-view-detail-title')[0]?.textContent === mxLongTitle
    && byClass(mxHeader, 'graph-view-detail-status').length === 1
    && byClass(mxHeader, 'graph-view-detail-open').length === 1,
  'VP4-HEADER: id, complete title, shared status chip, and Open card affordance share one header');
  const mxLabels = byClass(mxPanel, 'graph-view-detail-label');
  assert.deepStrictEqual(mxLabels.map((label) => label.textContent),
    ['Waiting on', 'Unmet prerequisites', 'Outcome', 'Gates'],
  'VP4-LABELED-ROWS: each present fact is introduced by its one semantic label in order');
  assert(mxLabels.every((label) => label.style.cssText
    === 'font-size:0.7em;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);'),
  'VP4-LABEL-STYLE: every fact label uses the exact small muted uppercase treatment');
  assert.strictEqual(byClass(mxPanel, 'graph-view-detail-outcome-value')[0]?.textContent, mxLongOutcome,
    'VP4-OUTCOME: the labeled Outcome value is complete and has no inline prefix');
  const mxScrollerIndex = mxRoot.children.findIndex((node) => node.className === 'graph-view-scroll');
  const mxLegendIndex = mxRoot.children.findIndex((node) => node.className === 'graph-view-legend');
  assert(mxScrollerIndex < mxLegendIndex && mxRoot.children.indexOf(mxPanel) === mxLegendIndex + 1,
    'VP3-PANEL-ORDER: epic detail panel occupies the slot after the below-canvas legend');
  assert.strictEqual(mxPanel.style.cssText,
    'display:grid;gap:12px;margin-top:16px;padding:12px 14px;border:1px solid var(--background-modifier-border);'
      + 'border-radius:9px;background:var(--background-secondary);font-size:var(--font-ui-small);',
    'VP4-PANEL-RHYTHM: labeled rows use the exact internal rhythm while retaining the roomy outer separation');
  const mxOrderView = new GraphView();
  mxOrderView._renderWarnings(mxRoot, [{ code: 'render_error', card: 'VP3', detail: 'order fixture' }]);
  const mxOrderWarning = byClass(mxRoot, 'graph-view-warnings')[0];
  assert(mxScrollerIndex < mxLegendIndex
    && mxLegendIndex < mxRoot.children.indexOf(mxPanel)
    && mxRoot.children.indexOf(mxPanel) < mxRoot.children.indexOf(mxOrderWarning),
  'VP3-EPIC-LOWER-ORDER: scroller, legend, panel, then warnings keep their exact relative order');
  mxOrderWarning.remove();
  const mxPrereq = byClass(mxPanel, 'graph-view-detail-prerequisite');
  assert.strictEqual(mxPrereq.length, 1, 'BL4-PANEL: each immediate unmet prerequisite gets one jump link');
  assert(textOf(mxPrereq[0]).includes('MX-A') && textOf(mxPrereq[0]).includes('planning'),
    'BL4-PANEL: the prerequisite jump link carries its own shared status');
  assert(mxPrereq[0].style.cssText
    === 'display:inline-flex;align-items:center;gap:5px;justify-self:start;width:max-content;max-width:100%;'
      + 'padding:3px 8px;border:1px solid var(--background-modifier-border);border-radius:999px;'
      + 'background:var(--background-primary);color:var(--link-color);cursor:pointer;text-align:left;overflow-wrap:anywhere;'
    && byClass(mxPrereq[0], 'graph-view-detail-link-status')[0]?.textContent.includes('planning'),
  'VP4-PREREQUISITE-CHIP: unmet dependencies use the exact effective pill style and their own shared status word');
  const selectedGlyph = byClass(mxChipFor('MX-C'), 'graph-view-status-glyph')[0].textContent;
  const mxPanelStatus = byClass(mxPanel, 'graph-view-detail-status')[0];
  const mxExpectedStatus = dashboard._statusPresentation('blocked', lifecycleApi);
  assert(textOf(mxPanelStatus) === `${mxExpectedStatus.glyph} ${mxExpectedStatus.label}`
    && textOf(mxPanelStatus).startsWith(selectedGlyph)
    && mxPanelStatus.style.cssText
      === 'display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;'
        + `color:${mxExpectedStatus.color};font-weight:650;white-space:nowrap;`
        + `border:1px solid color-mix(in srgb, ${mxExpectedStatus.color} 40%, transparent);`
        + `background:color-mix(in srgb, ${mxExpectedStatus.color} 10%, var(--background-primary));`,
  'VP4-SHARED-STATUS: the header chip uses the exact shared glyph, word, color, and effective pill style');
  assert.strictEqual(byClass(mxPanel, 'graph-view-detail-open').length, 1,
    'BL4-PANEL: the selected card exposes an explicit Open card affordance');
  const beforeOpenAffordance = mxOpened.length;
  byClass(mxPanel, 'graph-view-detail-open')[0].listeners.click({ stopPropagation() {} });
  assert(mxOpened.length === beforeOpenAffordance + 1
    && JSON.stringify(mxOpened.at(-1)) === JSON.stringify([`${mxBoard}/${mxLong}`, mxEpicPath, false]),
  'VP4-OPEN: the restyled non-stub Open card affordance opens the selected card exactly');
  for (const id of ['MX-A', 'MX-C']) {
    assert(!mxChipFor(id).className.includes('graph-view-dimmed'),
      `BL4-MUTANT-DIM-CLOSURE: chain member ${id} remains full strength`);
  }
  for (const id of ['MX-B', 'MX-D']) {
    assert(mxChipFor(id).className.includes('graph-view-dimmed'),
      `BL4-MUTANT-DIM-CLOSURE: non-chain chip ${id} is dimmed`);
  }
  assert.strictEqual(svgPaths(mxRoot, 'edge-depends').filter((chunk) => chunk.includes('graph-view-chain-edge')).length, 1,
    'BL4-CHAIN: only the depends edge whose endpoints are both in the selected closure is emphasized');
  mxPrereq[0].listeners.click({ stopPropagation() {} });
  assert.deepStrictEqual(mxOpened.at(-1), [`${mxBoard}/${mxShort}`, mxEpicPath, false],
    'BL4-PREREQUISITE: the unmet-prerequisite jump link opens that dependency');
  mxChipFor('MX-C').listeners.click({ stopPropagation() {} });
  assert.deepStrictEqual(mxOpened.at(-1), [`${mxBoard}/${mxLong}`, mxEpicPath, false],
    'BL4-SECOND-TAP: tapping the already-selected chip opens it');

  const beforeDifferentCard = mxOpened.length;
  mxChipFor('MX-A').listeners.click({ stopPropagation() {} });
  assert.strictEqual(mxOpened.length, beforeDifferentCard,
    'BL4-DIFFERENT-TAP: tapping a different chip reselects without opening');
  const mxRootPanel = byClass(mxRoot, 'graph-view-detail-panel')[0];
  assert(byClass(mxRootPanel, 'graph-view-detail-gates-count')[0]?.textContent === '1 slice'
    && byClass(mxRootPanel, 'graph-view-detail-dependent').length === 1,
  'BL4-GATES: downstream gated count and jump link are rendered from GraphInsights membership');
  byClass(mxRootPanel, 'graph-view-detail-dependent')[0].listeners.click({ stopPropagation() {} });
  assert.deepStrictEqual(mxOpened.at(-1), [`${mxBoard}/${mxLong}`, mxEpicPath, false],
    'BL4-GATES: a gated-card jump link opens that dependent');

  const beforeParked = mxOpened.length;
  mxChipFor('MX-D').listeners.click({ stopPropagation() {} });
  assert.strictEqual(mxOpened.length, beforeParked,
    'BL4-PARKED-FIRST-TAP: selecting a different parked chip does not open it');
  assert.strictEqual(byClass(byClass(mxRoot, 'graph-view-detail-panel')[0], 'graph-view-detail-wait')[0].textContent,
    mxParkReason,
  'BL4-RESUME: the inline panel shows the full parked resume condition');

  mxCanvas.listeners.click();
  assert.strictEqual(byClass(mxRoot, 'graph-view-detail-panel').length, 0,
    'BL4-DESELECT: tapping empty canvas removes the inline panel');
  assert(mxChips.every((chip) => !chip.className.includes('graph-view-dimmed'))
    && !byClass(mxRoot, 'graph-view-edges')[0].innerHTML.includes('graph-view-chain-edge'),
  'BL4-DESELECT: empty canvas restores all chips and edges to at-rest presentation');
  assert.deepStrictEqual(domShape(mxRoot), mxAtRest,
    'BL4-EPHEMERAL: selecting and clearing returns the DOM exactly to its original at-rest shape');

  const mxFreshContainer = element();
  await new GraphView({ lifecycleApi, insights: new GraphInsights() }).render({ container: mxFreshContainer });
  const mxFreshRoot = mxFreshContainer.children.find((child) => child.className === 'graph-view-root');
  assert.deepStrictEqual(domShape(mxFreshRoot), mxAtRest,
    'BL4-MUTANT-PANEL-AT-REST: a fresh render has no selection artifact and is byte-identical at rest');

  // MX-writes: the presentation render (including Outcome reads) mutates nothing.
  assert.deepStrictEqual(mxMutations, [],
    'MX: auto-width render invokes no vault, adapter, frontmatter, or metadata mutator');
  global.app = savedAppMX;
  global.customJS = savedCustomJSMX;

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
  const epicBlockedDir = `${projectDir}/tasks/Epic Blocked`;
  const epicBoardlessDir = `${projectDir}/tasks/Epic Boardless`;
  const projectTallTitle = 'Delta carries a deliberately long project-scope title whose complete wrapped geometry must move every later epic cluster';
  const projectTallCard = `E2-2 ${projectTallTitle}`;
  const projectFiles = [
    file(projectBoardPath, 1),
    file(`${epicOneDir}/Epic One.md`, 2), file(`${epicOneDir}/board/Epic One-board.md`, 3),
    file(`${epicOneDir}/board/E1-1 Alpha.md`, 4), file(`${epicOneDir}/board/E1-2 Beta.md`, 5),
    file(`${epicTwoDir}/Epic Two.md`, 6), file(`${epicTwoDir}/board/Epic Two-board.md`, 7),
    file(`${epicTwoDir}/board/E2-1 Gamma.md`, 8), file(`${epicTwoDir}/board/${projectTallCard}.md`, 9),
    file(`${epicDoneDir}/Epic Done.md`, 10), file(`${epicDoneDir}/board/Epic Done-board.md`, 11),
    file(`${epicDoneDir}/board/ED-1 Old.md`, 12),
    // GV-3b repair: a Blocked-lane epic with a full atlas + board + one slice —
    // Blocked is a LIVE lane and must render as a cluster.
    file(`${epicBlockedDir}/Epic Blocked.md`, 13), file(`${epicBlockedDir}/board/Epic Blocked-board.md`, 14),
    file(`${epicBlockedDir}/board/EB-1 Gate.md`, 15),
    // GV-3b repair: atlas + slice exist but board/Epic Boardless-board.md does
    // NOT — the atlas-present/board-missing permutation (warning AND cluster).
    file(`${epicBoardlessDir}/Epic Boardless.md`, 16), file(`${epicBoardlessDir}/board/EX-1 Loose.md`, 17),
  ];
  const projectFrontmatter = new Map([
    [projectBoardPath, { type: 'kanban', 'kanban-plugin': 'board' }],
    [`${epicOneDir}/Epic One.md`, { type: 'epic' }],
    [`${epicOneDir}/board/Epic One-board.md`, { type: 'kanban', 'kanban-plugin': 'board', board_role: 'epic' }],
    [`${epicOneDir}/board/E1-1 Alpha.md`, { type: 'slice', status: 'completed', depends_on: [] }],
    // BL-6: Epic One has one cross edge in each direction — E1-2 is gated by
    // EB-1 while it gates E2-1 — so focus must preserve both outside partners.
    [`${epicOneDir}/board/E1-2 Beta.md`, {
      type: 'slice', status: 'in_progress', depends_on: ['[[E1-1 Alpha]]', '[[EB-1 Gate]]'],
    }],
    [`${epicTwoDir}/Epic Two.md`, { type: 'epic' }],
    [`${epicTwoDir}/board/Epic Two-board.md`, { type: 'kanban', 'kanban-plugin': 'board', board_role: 'epic' }],
    // E2-1's depends_on crosses INTO Epic One — a real edge, never a warning.
    [`${epicTwoDir}/board/E2-1 Gamma.md`, { type: 'slice', status: 'planning', depends_on: ['[[E1-2 Beta]]'] }],
    // E2-2's depends_on resolves in NO cluster — the dangling warning path.
    [`${epicTwoDir}/board/${projectTallCard}.md`, { type: 'slice', status: 'planning', depends_on: ['[[Ghost Card]]'] }],
    [`${epicDoneDir}/Epic Done.md`, { type: 'epic' }],
    [`${epicDoneDir}/board/Epic Done-board.md`, { type: 'kanban', 'kanban-plugin': 'board', board_role: 'epic' }],
    [`${epicDoneDir}/board/ED-1 Old.md`, { type: 'slice', status: 'completed', depends_on: [] }],
    [`${epicBlockedDir}/Epic Blocked.md`, { type: 'epic' }],
    [`${epicBlockedDir}/board/Epic Blocked-board.md`, { type: 'kanban', 'kanban-plugin': 'board', board_role: 'epic' }],
    [`${epicBlockedDir}/board/EB-1 Gate.md`, { type: 'slice', status: 'planning', depends_on: [] }],
    [`${epicBoardlessDir}/Epic Boardless.md`, { type: 'epic' }],
    [`${epicBoardlessDir}/board/EX-1 Loose.md`, { type: 'slice', status: 'planning', depends_on: [] }],
  ]);
  const projectBoardBody = [
    '---', 'kanban-plugin: board', 'type: kanban', '---', '',
    '## In Planning', '',
    '- [ ] [[Epic Two]]', '- [ ] [[Epic Missing]]', '',
    '## In Progress', '',
    '- [ ] [[Epic One]]', '',
    '## Blocked', '',
    '- [ ] [[Epic Blocked]]', '- [ ] [[Epic Boardless]]', '',
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
      '## In Planning', '', '- [ ] [[E2-1 Gamma]]', `- [ ] [[${projectTallCard}]]`, '',
    ].join('\n')],
    [`${epicDoneDir}/board/Epic Done-board.md`, [
      '---', 'kanban-plugin: board', '---', '',
      '## Completed', '', '- [x] [[ED-1 Old]]', '',
    ].join('\n')],
    [`${epicBlockedDir}/board/Epic Blocked-board.md`, [
      '---', 'kanban-plugin: board', '---', '',
      '## In Planning', '', '- [ ] [[EB-1 Gate]]', '',
    ].join('\n')],
    [`${epicTwoDir}/board/E2-1 Gamma.md`, '## Outcome\n\nGamma exposes the cross-epic plan path.\n'],
  ]);
  const projectOpened = [];
  const projectOutcomeReads = [];
  const projectMutations = [];
  const projectMutator = (name) => () => {
    projectMutations.push(name);
    throw new Error(`read-only fixture invoked ${name}`);
  };
  global.app = {
    vault: {
      getMarkdownFiles: () => projectFiles,
      cachedRead: async (entry) => {
        if (projectFrontmatter.get(entry.path)?.type === 'slice') projectOutcomeReads.push(entry.path);
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
    GraphInsights: new GraphInsights(),
    EpicDashboard: new EpicDashboard({ lifecycleApi }),
    SectionLabel: sectionLabel,
    Coordinator: coordinatorSentinel,
    DeliveryCoordinator: coordinatorSentinel,
  };
  const projectContainer = element();
  await new GraphView({ scope: 'project' }).render({ container: projectContainer });
  const pRoot = projectContainer.children.find((child) => child.className === 'graph-view-root');
  assert(pRoot, 'P: project scope mounts one graph-view-root');
  assert.strictEqual(pRoot.children[0]?.className, 'shared-section-divider',
    'VP-2 project scope owns the shared SectionLabel divider as its first child');
  assert.strictEqual(pRoot.children[1]?.className, 'shared-section-label',
    'VP-2 project scope renders the Dependency Graph title through SectionLabel');
  assert.strictEqual(pRoot.children[1]?.textContent, 'Dependency Graph',
    'VP-2 project scope labels the graph section Dependency Graph');
  assert.strictEqual(pRoot.children[1]?.__sectionOptions?.top, true,
    'VP-2 project scope reuses the owned divider instead of synthesizing a second one');
  assert.strictEqual(pRoot.style.cssText, 'display:grid;gap:0;max-width:100%;',
    'VP3-ROOT-RHYTHM: project root uses explicit child spacing instead of a flat gap');

  // BL4-MISSING-INSIGHTS-ZERO-OUTCOME-READS: project Outcomes exist only for
  // the selection panel. Missing/throwing GraphInsights disables that panel,
  // so the fail-soft path must not add one slice-body read or at-rest artifact.
  assert(projectOutcomeReads.includes(`${epicTwoDir}/board/E2-1 Gamma.md`),
    'BL4-OUTCOMES-VALID-ANALYSIS: valid project analysis loads slice Outcomes for selection detail');
  const projectAtRestWithAnalysis = domShape(pRoot);
  const outcomeReadsAfterAnalysis = projectOutcomeReads.length;
  const missingProjectContainer = element();
  const throwingProjectContainer = element();
  await new GraphView({ scope: 'project', insights: {} }).render({ container: missingProjectContainer });
  await new GraphView({
    scope: 'project',
    insights: { analyzeGraph() { throw new Error('project insights unavailable'); } },
  }).render({ container: throwingProjectContainer });
  const missingProjectRoot = missingProjectContainer.children[0];
  const throwingProjectRoot = throwingProjectContainer.children[0];
  assert.strictEqual(projectOutcomeReads.length, outcomeReadsAfterAnalysis,
    'BL4-MISSING-INSIGHTS-ZERO-OUTCOME-READS: missing and throwing analysis perform zero slice Outcome reads');
  assert.deepStrictEqual(domShape(missingProjectRoot), projectAtRestWithAnalysis,
    'BL4-MISSING-INSIGHTS-AT-REST: missing analysis retains the exact project at-rest DOM');
  assert.deepStrictEqual(domShape(throwingProjectRoot), projectAtRestWithAnalysis,
    'BL4-THROWING-INSIGHTS-AT-REST: throwing analysis retains the exact project at-rest DOM');
  assert.strictEqual(byClass(missingProjectRoot, 'graph-view-detail-panel').length
    + byClass(throwingProjectRoot, 'graph-view-detail-panel').length, 0,
  'BL4-MUTANT-LOAD-OUTCOMES-WITHOUT-ANALYSIS: unavailable analysis creates no panel artifact');

  // P1: live-epic clusters render as labeled headers, stacked in board order.
  const headers = byClass(pRoot, 'graph-view-cluster-header');
  // P1-blocked (GV-3b repair): Blocked is a LIVE lane — its epic renders as a
  // full labeled cluster, never a collapse or a silent drop.
  assert(headers.some((header) => header.textContent === 'Epic Blocked'),
    'P1-blocked: the Blocked-lane epic renders as a live cluster');
  // P7 (GV-3b repair): atlas present + board note missing renders the warning
  // AND the cluster — the guard skips only when the atlas itself is missing.
  assert(headers.some((header) => header.textContent === 'Epic Boardless'),
    'P7: an epic with atlas present but board note missing still renders as a cluster');
  assert.deepStrictEqual(headers.map((header) => header.textContent),
    ['Epic Two', 'Epic One', 'Epic Blocked', 'Epic Boardless'],
    'P1: exactly the live epics render as clusters, in parent-board lane order (In Planning, In Progress, Blocked)');
  const pGeometry = { chipW: 172, colW: 200, headerH: 30, clusterGap: 36 };
  const pClusters = [
    { nodes: [{ card: 'E2-1 Gamma', rank: 0, row: 0 }, { card: projectTallCard, rank: 0, row: 1 }] },
    { nodes: [{ card: 'E1-1 Alpha', rank: 0, row: 0 }, { card: 'E1-2 Beta', rank: 1, row: 0 }] },
    { nodes: [{ card: 'EB-1 Gate', rank: 0, row: 0 }] },
    { nodes: [{ card: 'EX-1 Loose', rank: 0, row: 0 }] },
  ];
  let pCursor = GVR2.pad;
  const pExpected = new Map();
  for (const cluster of pClusters) {
    cluster.headerY = pCursor;
    cluster.rows = rowLayout(cluster.nodes, () => pGeometry.chipW, pCursor + pGeometry.headerH);
    for (const node of cluster.nodes) pExpected.set(String(node.card).split(/\s+/)[0], {
      x: GVR2.pad + node.rank * pGeometry.colW,
      y: cluster.rows.tops.get(node.row),
      h: chipHeight(node, pGeometry.chipW),
    });
    pCursor = cluster.rows.bottom + pGeometry.clusterGap;
  }
  const pHeight = pCursor - pGeometry.clusterGap + GVR2.pad;
  assert(headers.every((header, index) => header.style.cssText.includes(`top:${pClusters[index].headerY}px`)),
    'P1 mutant: each later cluster cursor follows the complete prior variable-height row geometry');
  const pChips = byClass(pRoot, 'graph-view-chip');
  assert.strictEqual(pChips.length, 6, 'P1: every live-epic slice renders exactly one chip');
  const pChipFor = (id) => pChips.find((chip) => flatten(chip)
    .some((node) => node.textContent && node.textContent.startsWith(id)));
  for (const [id, expected] of [
    ['E2-1', '○'], ['E2-2', '○'], ['E1-1', '✓'], ['E1-2', '●'], ['EB-1', '○'], ['EX-1', '○'],
  ]) {
    const info = byClass(pChipFor(id), 'graph-view-chip-info')[0];
    const glyph = byClass(info, 'graph-view-status-glyph')[0];
    const word = byClass(info, 'graph-view-status-word')[0];
    assert.strictEqual(glyph?.textContent, expected,
      `BL2-PROJECT-GLYPH: ${id} uses the shared status glyph at project scope`);
    assert(info.children.indexOf(glyph) < info.children.indexOf(word),
      `BL2-PROJECT-GLYPH: ${id} glyph precedes its colored status word`);
  }
  for (const id of ['E2-1', 'E2-2', 'E1-1', 'E1-2', 'EB-1', 'EX-1']) {
    const { x, y, h } = pExpected.get(id);
    assert(pChipFor(id).style.cssText.includes(`left:${x}px;top:${y}px`)
      && pChipFor(id).style.cssText.includes(`height:${h}px`),
    `P1: ${id} chip sits at left:${x}px;top:${y}px;height:${h}px from project row maxima`);
  }
  const pCanvas = byClass(pRoot, 'graph-view-project-canvas')[0];
  assert(pCanvas && pCanvas.style.cssText.includes(`width:396px;height:${pHeight}px`)
    && pCanvas.style.cssText.includes('margin-inline:auto'),
  'P1: one shared canvas spans the final cluster bottom + pad with conditional CSS centering');
  const pScroller = byClass(pRoot, 'graph-view-scroll')[0];
  assert(pScroller.style.cssText.includes('overflow-x:auto')
    && pScroller.style.cssText.includes('overflow-y:hidden')
    && pScroller.style.cssText.includes(`padding-bottom:${GVR2.scrollbarAllowance}px`),
  'P1 mutants: project scroller independently binds horizontal scrolling, hidden vertical overflow, and bottom allowance');

  // BL-6 select-first cluster focus. Epic One's own chips plus its direct
  // partners on the incoming EB-1 → E1-2 and outgoing E1-2 → E2-1 edges stay
  // full strength; every unrelated cluster chip dims by exact class footprint.
  const clusterAtRest = JSON.parse(JSON.stringify(domShape(pRoot)));
  const clusterOpenCount = projectOpened.length;
  const firstClusterTap = bubblingClick(headers[1]);
  bl6Check('first-tap', () => firstClusterTap.stopped && projectOpened.length === clusterOpenCount,
    'BL6-FIRST-TAP: first cluster-header tap stops bubbling and performs no navigation');
  for (const id of ['E1-1', 'E1-2', 'E2-1', 'EB-1']) {
    bl6Check(`partner-bright:${id}`, () => !pChipFor(id).className.includes('graph-view-dimmed'),
      `BL6-BIDIRECTIONAL-PARTNER: focused Epic One keeps ${id} full-strength`);
  }
  for (const id of ['E2-2', 'EX-1']) {
    bl6Check(`unrelated-dim:${id}`, () => pChipFor(id).className.includes('graph-view-dimmed'),
      `BL6-EXACT-FOOTPRINT: unrelated ${id} dims`);
  }
  bl6Check('focused-header', () => headers[1].className.includes('graph-view-cluster-focused')
    && headers[1].attrs['aria-pressed'] === 'true',
  'BL6-FOCUSED-HEADER: focused cluster exposes class and pressed state');
  bl6Check('strips-unaffected', () => !byClass(pRoot, 'graph-view-done-chip')[0].className.includes('graph-view-dimmed')
    && byClass(pRoot, 'warning-missing-epic').every((row) => !row.className.includes('graph-view-dimmed')),
  'BL6-STRIPS-UNAFFECTED: done and warning strips remain outside cluster focus');

  // BL6-CROSS-INSTANCE-ACTIVE: prove focus state is controller-local while the
  // first instance remains focused. Clearing before this render would allow a
  // shared/module-level focusedCluster mutant to survive.
  const activeFocusFreshContainer = element();
  await new GraphView({ scope: 'project' }).render({ container: activeFocusFreshContainer });
  bl6Check('active-instance', () => JSON.stringify(domShape(activeFocusFreshContainer.children[0])) === JSON.stringify(clusterAtRest),
    'BL6-CROSS-INSTANCE-ACTIVE: a second render starts unfocused while the first remains focused');

  bubblingClick(headers[1]);
  bl6Check('second-tap', () => JSON.stringify(projectOpened.at(-1))
    === JSON.stringify([`${epicOneDir}/Epic One`, stationPath, false]),
    'BL6-SECOND-TAP: second tap on the focused header opens its atlas');
  const opensAfterSecondTap = projectOpened.length;
  bubblingClick(headers[0]);
  bl6Check('refocus-no-open', () => projectOpened.length === opensAfterSecondTap,
    'BL6-REFOCUS: tapping a different header refocuses instead of opening');
  for (const id of ['E2-1', 'E2-2', 'E1-2']) {
    bl6Check(`refocus-bright:${id}`, () => !pChipFor(id).className.includes('graph-view-dimmed'),
      `BL6-REFOCUS: Epic Two keeps ${id} full-strength`);
  }
  for (const id of ['E1-1', 'EB-1', 'EX-1']) {
    bl6Check(`refocus-dim:${id}`, () => pChipFor(id).className.includes('graph-view-dimmed'),
      `BL6-REFOCUS: Epic Two dims unrelated ${id}`);
  }
  pCanvas.listeners.click();
  bl6Check('canvas-clear', () => JSON.stringify(domShape(pRoot)) === JSON.stringify(clusterAtRest),
    'BL6-EMPTY-CANVAS: empty canvas clears focus and restores exact at-rest DOM');
  const freshProjectContainer = element();
  await new GraphView({ scope: 'project' }).render({ container: freshProjectContainer });
  bl6Check('fresh-render', () => JSON.stringify(domShape(freshProjectContainer.children[0])) === JSON.stringify(clusterAtRest),
    'BL6-FRESH-RENDER: a new widget instance has no persisted cluster focus');
  const pLegend = byClass(pRoot, 'graph-view-legend')[0];
  assert.deepStrictEqual(byClass(pLegend, 'graph-view-legend-label').map((node) => node.textContent).sort(),
    ['done', 'in progress', 'planning'],
    'BL2-PROJECT-LEGEND: project legend contains exactly the statuses present across live clusters');
  assert(!flatten(pCanvas).includes(pLegend)
    && pRoot.children.findIndex((node) => node.className === 'graph-view-scroll') < pRoot.children.indexOf(pLegend)
    && pRoot.children.indexOf(pLegend) < pRoot.children.findIndex((node) => node.className === 'graph-view-done-strip')
    && pRoot.children.indexOf(pLegend) < pRoot.children.findIndex((node) => node.className === 'graph-view-warnings'),
  'VP3-PROJECT-LEGEND: project legend is below the shared canvas and before completed/warning strips');
  assert.strictEqual(pLegend.style.cssText,
    'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:8px 0 0;font-size:0.7em;',
  'VP3-PROJECT-LEGEND-RHYTHM: project legend uses the same exact tight spacing contract');
  assert.strictEqual(byClass(pRoot, 'graph-view-done-strip')[0]?.style.cssText,
    'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:16px;',
  'VP3-DONE-RHYTHM: the completed-epic strip receives the exact roomy separation');
  assert.strictEqual(byClass(pRoot, 'graph-view-warnings')[0]?.style.cssText,
    'display:grid;gap:4px;margin-top:16px;padding:2px 0;',
  'VP3-PROJECT-WARNING-RHYTHM: project warnings receive the exact roomy separation');
  assert.strictEqual(byClass(pRoot, 'graph-view-stuck-summary').length, 0,
    'BL3-PROJECT-HEALTHY: the established healthy project fixture stays calm');
  assert.strictEqual(byClass(pRoot, 'graph-view-gates-badge').length, 0,
    'BL3-PROJECT-HEALTHY: the established healthy project fixture gains no badges');

  const projectToolbar = byClass(pRoot, 'graph-view-filter-toolbar');
  const projectScrollIndex = pRoot.children.findIndex((node) => node.className === 'graph-view-scroll');
  assert.strictEqual(projectToolbar.length, 1, 'BL5-TOOLBAR-PROJECT: project scope renders one filter toolbar');
  assert(pRoot.children.indexOf(projectToolbar[0]) < projectScrollIndex,
    'BL5-TOOLBAR-PROJECT: the project toolbar sits above and outside the shared canvas');
  const projectFilterAtRest = JSON.parse(JSON.stringify(domShape(pRoot)));
  const projectDoneToggle = byClass(projectToolbar[0], 'graph-view-filter-done')[0];
  bubblingClick(headers[1]);
  projectDoneToggle.listeners.click({ stopPropagation() {} });
  bl6Check('filter-composition', () => pChipFor('E1-1').className.includes('graph-view-dimmed')
    && ['E2-2', 'EX-1'].every((id) => pChipFor(id).className.includes('graph-view-dimmed'))
    && ['E2-1', 'E1-2', 'EB-1'].every((id) => !pChipFor(id).className.includes('graph-view-dimmed')),
  'BL6-FILTER-COMPOSITION: cluster focus and Dim done compose as a dimming union');
  bubblingClick(pChipFor('E2-2'));
  bl6Check('selection-precedence', () => !pChipFor('E2-2').className.includes('graph-view-dimmed')
    && ['E2-1', 'E1-1', 'E1-2', 'EB-1', 'EX-1']
      .every((id) => pChipFor(id).className.includes('graph-view-dimmed')),
  'BL6-SELECTION-PRECEDENCE: chip selection wins wholesale over focus and filters');
  pCanvas.listeners.click();
  bl6Check('clear-precedence', () => pChipFor('E1-1').className.includes('graph-view-dimmed')
    && ['E2-1', 'E2-2', 'E1-2', 'EB-1', 'EX-1'].every((id) => !pChipFor(id).className.includes('graph-view-dimmed')),
  'BL6-CLEAR-PRECEDENCE: empty canvas clears selection and focus but reapplies the active filter');
  projectDoneToggle.listeners.click({ stopPropagation() {} });
  bl6Check('ephemeral-composition', () => JSON.stringify(domShape(pRoot)) === JSON.stringify(projectFilterAtRest),
    'BL6-EPHEMERAL-COMPOSITION: clearing focus and toggling the filter off restores exact at-rest DOM');

  // BL-4 project scope uses the one merged graph, including the cross-epic
  // dependency, while leaving the established at-rest geometry untouched.
  const projectAtRest = domShape(pRoot);
  const projectOpenCount = projectOpened.length;
  const projectFirstTap = bubblingClick(pChipFor('E2-1'));
  assert(projectFirstTap.stopped,
    'BL4-CHIP-CLICK-BUBBLE-GUARD: project chip selection stops before the canvas clear handler');
  assert.strictEqual(projectOpened.length, projectOpenCount,
    'BL4-PROJECT-FIRST-TAP: first tap selects without navigation');
  const projectPanel = byClass(pRoot, 'graph-view-detail-panel')[0];
  const projectScrollerIndex = pRoot.children.findIndex((node) => node.className === 'graph-view-scroll');
  const projectLegendIndex = pRoot.children.findIndex((node) => node.className === 'graph-view-legend');
  const projectDoneIndex = pRoot.children.findIndex((node) => node.className === 'graph-view-done-strip');
  const projectWarningIndex = pRoot.children.findIndex((node) => node.className === 'graph-view-warnings');
  assert(projectPanel && projectScrollerIndex < projectLegendIndex
    && pRoot.children.indexOf(projectPanel) === projectLegendIndex + 1
    && pRoot.children.indexOf(projectPanel) < projectDoneIndex
    && projectDoneIndex < projectWarningIndex,
    'VP3-PROJECT-PANEL: lower order is scroller, legend, panel, completed strip, then warnings');
  assert(textOf(projectPanel).includes('E2-1')
    && textOf(projectPanel).includes('Gamma')
    && textOf(projectPanel).includes('Gamma exposes the cross-epic plan path.')
    && textOf(projectPanel).includes('E1-2')
    && textOf(projectPanel).includes('in progress'),
  'BL4-PROJECT-PANEL: project selection shows identity, Outcome, and cross-epic prerequisite status/link');
  assert(pChipFor('E1-1').className.includes('graph-view-dimmed') === false
    && pChipFor('E1-2').className.includes('graph-view-dimmed') === false
    && pChipFor('E2-1').className.includes('graph-view-dimmed') === false
    && pChipFor('EB-1').className.includes('graph-view-dimmed') === false
    && pChipFor('E2-2').className.includes('graph-view-dimmed'),
  'BL4-PROJECT-CHAIN: the merged transitive chain stays full strength and its complement dims');
  assert.strictEqual(svgPaths(pRoot, 'edge-depends').filter((chunk) => chunk.includes('graph-view-chain-edge')).length, 3,
    'BL4-PROJECT-CHAIN: intra- and cross-epic depends edges inside the selected chain are emphasized');
  pCanvas.listeners.click();
  assert.strictEqual(byClass(pRoot, 'graph-view-detail-panel').length, 0,
    'BL4-PROJECT-DESELECT: empty project canvas clears selection');
  assert.deepStrictEqual(domShape(pRoot), projectAtRest,
    'BL4-PROJECT-EPHEMERAL: deselection restores legend, geometry, badges, and warning strips byte-for-byte');

  // P2: the cross-epic depends_on (E2-1 Gamma → depends on E1-2 Beta) renders
  // as a real depends edge between chips in DIFFERENT clusters, endpoints
  // pinned to the absolute chip positions (prerequisite right-mid → dependent
  // left-mid), and never as a dangling warning.
  const pDepends = svgPaths(pRoot, 'edge-depends');
  const crossPaths = pDepends.filter((chunk) => chunk.includes('edge-cross-epic'));
  const projectEdgeD = (fromId, toId) => {
    const from = pExpected.get(fromId); const to = pExpected.get(toId);
    if (from.x === to.x) {
      const x = from.x + pGeometry.chipW / 2;
      return `M ${x} ${from.y + from.h} L ${x} ${to.y}`;
    }
    const x1 = from.x + pGeometry.chipW; const y1 = from.y + from.h / 2;
    const x2 = to.x; const y2 = to.y + to.h / 2;
    const bend = Math.max(24, (x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  };
  assert.strictEqual(crossPaths.length, 2, 'P2: both cross-epic directions render');
  assert.deepStrictEqual(crossPaths.map(dOf).sort(), [
    projectEdgeD('EB-1', 'E1-2'),
    projectEdgeD('E1-2', 'E2-1'),
  ].sort(), 'P2: incoming and outgoing cross edges use the exact absolute endpoints');
  assert(crossPaths.every((chunk) => chunk.includes('marker-end') && !chunk.includes('stroke-dasharray')),
    'P2: both cross edges carry solid arrowed depends markup');
  const intraDepends = pDepends.filter((chunk) => !chunk.includes('edge-cross-epic'));
  assert.strictEqual(intraDepends.length, 1, 'P2: the one intra-cluster depends edge renders');
  assert.strictEqual(dOf(intraDepends[0]), projectEdgeD('E1-1', 'E1-2'),
    'P2: the Epic One intra-cluster edge is drawn at its cluster-offset positions');
  const pOrder = svgPaths(pRoot, 'edge-order');
  assert.deepStrictEqual(pOrder.map(dOf), [projectEdgeD('E2-1', 'E2-2')],
    'P2: the Epic Two ghost order edge is drawn at its cluster-offset positions');

  // P3: the card named in the Loop Station's own frontmatter `active` gets a
  // distinct outline; every other chip does not.
  const activeChip = pChipFor('E1-2');
  assert(activeChip.className.includes('graph-view-active'),
    'P3: the active claim chip carries the graph-view-active class');
  assert(activeChip.style.cssText.includes('outline:2px solid var(--interactive-accent);outline-offset:2px;'),
    'P3: the active claim chip carries the distinct outline style');
  for (const id of ['E2-1', 'E2-2', 'E1-1', 'EB-1', 'EX-1']) {
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
  assert.strictEqual(missingRows.length, 2, 'P6: each unresolvable epic note renders exactly one warning row');
  assert.strictEqual(missingRows[0].textContent,
    `Epic Missing: epic atlas or board note is missing: '${projectDir}/tasks/Epic Missing/Epic Missing.md'`,
    'P6: the warning names the epic and the missing note');
  // P7 (GV-3b repair): the board-missing permutation warns with the BOARD path
  // as the detail — while its cluster (asserted above) still renders.
  assert.strictEqual(missingRows[1].textContent,
    `Epic Boardless: epic atlas or board note is missing: '${epicBoardlessDir}/board/Epic Boardless-board.md'`,
    'P7: the board-missing warning names the epic and the missing board note');

  // GV3-STALE-DEP-EDGE lineage: a depends_on naming a card in NO cluster stays
  // on the dangling warning path (the same code path as epic scope).
  const pDangling = byClass(pRoot, 'warning-dangling-dependency');
  assert.strictEqual(pDangling.length, 1, 'P: exactly one project-scope dangling warning renders');
  assert.strictEqual(pDangling[0].textContent,
    `${projectTallCard}: depends on a card that doesn't exist: 'Ghost Card'`,
    'P: a target resolvable in no cluster is a dangling warning, not a cross edge');

  // BL-3 project scope extends (never repurposes) the established project
  // fixture: render it a second time with E1-2 blocked. The already-real cross
  // edge E1-2 → E2-1 must be present in the ONE merged insights input, so the
  // Epic One badge counts its live dependent in Epic Two.
  const e12Path = `${epicOneDir}/board/E1-2 Beta.md`;
  const healthyE12 = projectFrontmatter.get(e12Path);
  projectFrontmatter.set(e12Path, { ...healthyE12, status: 'blocked' });
  const crossInsightContainer = element();
  await new GraphView({ scope: 'project' }).render({ container: crossInsightContainer });
  projectFrontmatter.set(e12Path, healthyE12);
  const crossInsightRoot = crossInsightContainer.children[0];
  const crossSummary = byClass(crossInsightRoot, 'graph-view-stuck-summary');
  assert.strictEqual(crossSummary.length, 1,
    'BL3-PROJECT-SUMMARY: the separate blocker render produces one stuck summary');
  assert.strictEqual(crossSummary[0].textContent, '1 root blocker · gating 1 slice',
    'BL3-PROJECT-SUMMARY: the merged project graph counts the cross-epic dependent once');
  const crossBadges = byClass(crossInsightRoot, 'graph-view-gates-badge');
  assert.strictEqual(crossBadges.length, 1,
    'BL3-PROJECT-BADGE: exactly the project-wide root blocker receives a badge');
  assert.strictEqual(crossBadges[0].textContent, 'gates 1',
    'BL3-PROJECT-BADGE: the Epic One blocker counts its live dependent in Epic Two');
  const crossChips = byClass(crossInsightRoot, 'graph-view-chip');
  const crossE12 = crossChips.find((chip) => flatten(chip)
    .some((node) => node.textContent && node.textContent.startsWith('E1-2')));
  assert(flatten(crossE12).includes(crossBadges[0]),
    'BL3-PROJECT-BADGE: the cross-epic blast-radius badge lives on E1-2 only');
  assert(crossE12.style.cssText.includes(`left:${pExpected.get('E1-2').x}px;top:${pExpected.get('E1-2').y}px`),
    'BL3-PROJECT-GEOMETRY: the separate blocker render preserves E1-2 coordinates');

  // Mount contract: the Loop Station guard block passes { scope: "project" }
  // as a render-time arg to the epic-default singleton.
  const overrideContainer = element();
  await new GraphView().render({ container: overrideContainer }, { scope: 'project' });
  assert.strictEqual(byClass(overrideContainer.children[0], 'graph-view-cluster-header').length, 4,
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
  assert.deepStrictEqual(projectMutations, [],
    'BL5-ZERO-VAULT-WRITES: all project filter interactions remain DOM-only');
  bl6Check('zero-project-writes', () => projectMutations.length === 0,
    'BL6-ZERO-PROJECT-WRITES: focus invokes no vault, adapter, frontmatter, or metadata mutator');
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
  const priorSectionLabel = global.customJS.SectionLabel;
  delete global.customJS.SectionLabel;
  const fallbackContainer = element();
  await new GraphView({ layout: { layoutGraph: () => ({ nodes: [], edges: [], warnings: [] }) } })
    .render({ container: fallbackContainer });
  assert.strictEqual(fallbackContainer.children[0]?.children[0]?.textContent, 'Dependency Graph',
    'VP-2 missing SectionLabel falls back to plain text without throwing');
  assert.strictEqual(fallbackContainer.children[0]?.children[0]?.style?.cssText, '',
    'VP-2 fallback title carries no local section-label styling');
  assert.strictEqual(fallbackContainer.children[0]?.children[0]?.className, '',
    'VP-2 fallback title carries no local section-label class');
  assert.deepStrictEqual(fallbackContainer.children[0]?.children[0]?.attrs, {},
    'VP-2 fallback title carries no class or presentation attributes');
  global.customJS.SectionLabel = priorSectionLabel;
  assert.deepStrictEqual(mutations, [], 'every render across every case stayed write-free');
  assert.deepStrictEqual(persistenceMutations, [],
    'BL4-BL5-ZERO-PERSISTENCE-SURFACES: selection and filters invoke no localStorage or coordinator mutation surface');
  bl6Check('zero-persistence-writes', () => persistenceMutations.length === 0,
    'BL6-ZERO-PERSISTENCE-WRITES: focus invokes no localStorage or coordinator mutation surface');
  if (savedLocalStorageDescriptor) Object.defineProperty(global, 'localStorage', savedLocalStorageDescriptor);
  else delete global.localStorage;
  if (savedCoordinator === undefined) delete global.coordinator;
  else global.coordinator = savedCoordinator;
  if (savedDeliveryCoordinator === undefined) delete global.DeliveryCoordinator;
  else global.DeliveryCoordinator = savedDeliveryCoordinator;

  // Widget grammar: RenderSafe-only current access, bare loadable class.
  assert(!widgetSource.includes('dv.current('), 'widget uses RenderSafe instead of raw dv.current');
  assert.ok(/^class GraphView\b/m.test(widgetSource), 'file is a bare customJS-loadable class');
  const sectionChromeSource = widgetSource.match(/_renderSectionChrome\(dv, root\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert(sectionChromeSource.includes('SL.divider(root)') && sectionChromeSource.includes('SL.render('),
    'VP-2 section chrome delegates divider and title rendering to SectionLabel');
  const localChromeChannels = [
    /\bstyle\b|\bcssText\b/,
    /\bclassName\b|\bclassList\b|\bcls\s*:/,
    /\bsetAttribute(?:NS)?\s*(?:\?\.)?\s*\([^)]*?["']class["']/,
    /\battrs?\s*:\s*\{[\s\S]*?\bclass\s*:/,
  ];
  assert(localChromeChannels.every((channel) => !channel.test(sectionChromeSource)),
    'VP-2d carried fixture: section chrome defines no local styling or class channel, including optional attribute APIs and createEl attr bags');
  const panelSource = widgetSource.match(/_panelLink\(parent, node, api, source, className\) \{[\s\S]*?\n  \/\/ Stuck filtering/)?.[0] || '';
  assert(panelSource.includes('this._statusPresentation(node.status, api)')
    && !/var\(--color-(?:red|orange|yellow|green|cyan|blue|purple|pink)\)/.test(panelSource),
  'VP4-SHARED-PRESENTATION: panel status glyphs, words, and colors have no local lifecycle palette');

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
  assert.strictEqual(packageJson.scripts['test:graph-view-contract'],
    'node platform/test/run-graph-view-contract.js',
  'independent GraphView contract sentinel is wired');
  assert((packageJson.scripts['release:preflight'] || '').includes(
    'node platform/test/run-graph-layout.js && node platform/test/run-graph-view.js && node platform/test/run-graph-insights.js && node platform/test/run-graph-view-contract.js'),
  'release preflight preserves the inherited graph trio, then runs the independent contract sentinel');
  assert.strictEqual((packageJson.scripts['release:preflight'].match(/run-graph-view\.js/g) || []).length, 1,
    'release preflight registers the harness once');
  assert.strictEqual((packageJson.scripts['release:preflight'].match(/run-graph-view-contract\.js/g) || []).length, 1,
    'release preflight registers the independent contract sentinel once');

  // Atlas mounts: fresh intake emits GraphView before EpicDashboard. Existing
  // atlas migration remains a separately contracted installer slice.
  const intakeSource = fs.readFileSync(path.join(ROOT, '.agents/skills/card-intake/scripts/card-intake.js'), 'utf8');
  const dashboardMountAt = intakeSource.indexOf('{ class: "EpicDashboard" }');
  const graphMountAt = intakeSource.indexOf('{ class: "GraphView" }');
  assert(graphMountAt >= 0 && dashboardMountAt > graphMountAt,
    'card-intake atlas scaffold mounts GraphView before EpicDashboard');

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
    assert(dashboardAt >= 0 && graphAt > dashboardAt, `legacy scaffold still mounts GraphView after EpicDashboard on ${atlas}`);
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
  // GV-3b repair: a type:loop-station note WITHOUT an OperatorStation block —
  // the heal's fallback path appends the GraphView block at end-of-note.
  const bareStation = [
    '---', 'type: "loop-station"', 'schema_version: "1.0.0"', '---', '',
    'Legacy station body with no OperatorStation block.', '',
  ].join('\n');
  const projectBoardNote = '---\nkanban-plugin: board\ntype: kanban\n---\n';
  const stationAdapter = memoryAdapter({
    'spice/projects/demo/Loop Station.md': operatorOnlyStation,
    'spice/projects/demo/demo-board.md': projectBoardNote,
    'spice/projects/other/Loop Station.md': carryingStation,
    'spice/projects/bare/Loop Station.md': bareStation,
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
  // GV-3b repair: the fallback append — no OperatorStation block, so the
  // GraphView block lands at end-of-note (trimmed body + one blank line).
  assert.strictEqual(stationAdapter.store.get('spice/projects/bare/Loop Station.md'),
    `${bareStation.trimEnd()}\n\n${stationGuardBlock}\n`,
    'station heal fallback-appends the GraphView block to a station lacking OperatorStation');
  assert(stationHistory.some((entry) => entry.event === 'info' && entry.step === 'loop_station_graph_heal'
    && entry.action === 'graph_view_injected' && entry.target === 'spice/projects/bare/Loop Station.md'),
  'station heal records the fallback-append injection history event');
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

  console.log(`BL6-RECEIPTS ${JSON.stringify(bl6ReceiptSnapshot())}`);
  console.log('graph-view: all checks passed');
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
