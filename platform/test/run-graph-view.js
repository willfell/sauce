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

const nodeAssert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// PH1D-HARNESS-FLOOR (PH1C-HARNESS-NOT-VACUOUS): a render that never settles
// (an awaited promise nothing resolves) drains the event loop, and node then
// exits 0 having skipped every assertion after it and printed no pass line;
// scripts/run-preflight.js scores the exit code, so that would be a silent
// PASS. assert is therefore a counting wrapper, and an exit guard fails the
// run unless finishHarness() ran with at least ASSERTION_FLOOR assertions
// counted and printed the pass line. Raise ASSERTION_FLOOR when assertions
// are added. Pattern: platform/test/run-autoloop-leases.js.
// MUTATION GUARD: PH1D-MUTANT-NARROW-NEVER-SETTLES turns RED here if a narrow
// render never settles (_renderCompactMap awaiting a promise nothing
// resolves): without this guard node exits 0 with no pass line; with it the
// exit code is 1 and stderr names the "PH1D-HARNESS-FLOOR
// (PH1C-HARNESS-NOT-VACUOUS)" abort.
// MUTATION GUARD: PH1D-MUTANT-COLD-LOAD-NEVER-SETTLES turns RED here the same
// way if the one-shot's re-render (the render handed a measurement) never
// settles, so the cold-load fixtures' drain waits forever.
let assertionCount = 0;
const counted = (check) => (...args) => {
  assertionCount += 1;
  return check(...args);
};
const assert = Object.assign(counted(nodeAssert), nodeAssert, Object.fromEntries([
  'ok', 'equal', 'notEqual', 'strictEqual', 'notStrictEqual', 'deepEqual', 'notDeepEqual', 'deepStrictEqual',
  'notDeepStrictEqual', 'throws', 'doesNotThrow', 'rejects', 'doesNotReject', 'match', 'doesNotMatch', 'fail',
].map((name) => [name, counted(nodeAssert[name])])));
const ASSERTION_FLOOR = 2243;
let harnessPassed = false;
function finishHarness() {
  if (assertionCount < ASSERTION_FLOOR) {
    console.error(`PH1D-HARNESS-FLOOR (PH1C-HARNESS-NOT-VACUOUS): ran ${assertionCount} assertions, expected at least ${ASSERTION_FLOOR}; a block was skipped`);
    process.exitCode = 1;
    return;
  }
  harnessPassed = true;
  console.log(`graph-view: ${assertionCount} assertions (floor ${ASSERTION_FLOOR})`);
  console.log('graph-view: all checks passed');
}
process.on('exit', (code) => {
  if (harnessPassed || code !== 0) return;
  console.error(`PH1D-HARNESS-FLOOR (PH1C-HARNESS-NOT-VACUOUS): aborted after ${assertionCount} assertions without printing the pass line`);
  console.error('  (an awaited render never settled and the event loop drained, or a block returned early)');
  process.exitCode = 1;
});

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
  // PH-1: a model of Node.isConnected — false once this node (or any
  // ancestor) has been removed, or while a container is modelled off-document
  // (offDocument). The resize stub reports a zero box for such a target.
  Object.defineProperty(node, 'isConnected', {
    enumerable: false,
    get() { return !this.removed && !this.offDocument && (this.parent ? this.parent.isConnected : true); },
  });
  // PH-1c: a model of Node.parentNode.
  Object.defineProperty(node, 'parentNode', {
    enumerable: false,
    get() { return this.parent; },
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
// PH1D-HAIRLINE-CASCADE: a minimal in-harness cascade over one inline
// cssText. Declarations apply in source order and a later one wins; the
// `border` shorthand sets all four sides and a `border-<side>` declaration
// sets that side, so a hairline declared BEFORE the shorthand is overwritten.
// A physical border width, style, or color property (border-width,
// border-left-color, ...) makes effectiveBorders return null rather than
// guess; other border properties are ignored.
function cssDeclarations(cssText) {
  return String(cssText || '').split(';').map((chunk) => chunk.trim()).filter(Boolean).map((chunk) => {
    const colon = chunk.indexOf(':');
    return [chunk.slice(0, colon).trim().toLowerCase(), chunk.slice(colon + 1).trim()];
  });
}
function cssEffective(cssText) {
  const effective = {};
  for (const [property, value] of cssDeclarations(cssText)) effective[property] = value;
  return effective;
}
function effectiveBorders(cssText) {
  let sides = { top: null, right: null, bottom: null, left: null };
  for (const [property, value] of cssDeclarations(cssText)) {
    if (property === 'border') sides = { top: value, right: value, bottom: value, left: value };
    else if (/^border-(top|right|bottom|left)$/.test(property)) sides[property.slice('border-'.length)] = value;
    else if (/^border-(?:(?:top|right|bottom|left)-)?(?:width|style|color)$/.test(property)) return null;
  }
  return sides;
}
function file(filePath, mtime = 0) {
  return { path: filePath, basename: path.posix.basename(filePath, '.md'), stat: { mtime } };
}
// PH-1 phone-first: sha256 over the structural DOM shape of a subtree.
function digestOf(node) {
  return crypto.createHash('sha256').update(JSON.stringify(domShape(node))).digest('hex');
}
// PH1C-WIDE-BYTE-IDENTICAL pins (PH1-WIDE-DIGEST-PINS). Each entry is the
// sha256 of domShape() at rest for a pre-existing epic-scope fixture's whole
// root and for its canvas scroller subtree, as the pre-PH-1 renderer
// (graph-view.js at fff7ad69) draws them. Run against that renderer, this
// file passes the main, clean, and stub-lifecycle pins and first fails at
// BL2-GLYPH-SOURCE's exact presentation.glyph site count (4 !== 5), before
// the cross-epic and MX pins.
const PH1_WIDE_DIGESTS = {
  main: {
    root: '48bdadf60733de6867a92ae2922311c43481c4664dc5a674d133e135afa21776',
    scroller: '5e4d7cfcbd16b2a3ecb5ff747aa7bfa77b1598e9557c17ded9753ca1a4f68df0',
  },
  clean: {
    root: 'bb15204729eb48779151562d99d23ca60bcdfae2e4c2a0b185cb0e8f4f758400',
    scroller: 'afd575ede4abca0d0e40860c7712dbf36af2c5e41db4a88ac68e10861233e102',
  },
  stubLifecycle: {
    root: 'a730b21c4640eec736d849bb1760fea59900745cc38f39c25816696ebebc76d0',
    scroller: '320a964a6f047540197aaf1afedf42213adfc06c81e680617ed75b586e12b8b6',
  },
  crossEpic: {
    root: '480d6b985de32eecd904e26d1d7d6c192832f6d7b416fec714eb30cf3a5d2f33',
    scroller: '1388a531760a13ec7f33bd4d63a75448fa10cbdb9a9597e5eb1e9e51e3270f84',
  },
  mx: {
    root: '7e4d53c843c43950af4fa76aa74465bb51557232eb856f9fa32db3713f60a0e6',
    scroller: '41973fd13663ad3a4606a59ca53655259741a6de50646196f457baebdaad165a',
  },
};
function assertWideDigest(label, root, expected) {
  const scroller = byClass(root, 'graph-view-scroll')[0];
  assert(scroller, `PH1C-WIDE-BYTE-IDENTICAL: ${label} renders the wide scroller`);
  assert.strictEqual(byClass(root, 'graph-view-compact').length, 0,
    `PH1C-WIDE-BYTE-IDENTICAL: ${label} renders no compact host`);
  assert.strictEqual(digestOf(scroller), expected.scroller,
    `PH1C-WIDE-BYTE-IDENTICAL: ${label} canvas + chip subtree digest equals the pre-slice renderer's`);
  assert.strictEqual(digestOf(root), expected.root,
    `PH1C-WIDE-BYTE-IDENTICAL (PH1-WIDE-DIGEST-PINS): ${label} whole-root digest equals the pre-slice renderer's`);
}
// PH-1 compact geometry helpers: compactColW, compactNatural, compactPos, and
// compactEdgeD compute expected compact column widths, canvas widths, pill
// positions, and edge paths.
const PH1 = { pad: 2, gap: 10, pillH: 26, rowGap: 8, minCol: 40, maxCol: 140, shortIdBelow: 72 };
function compactColW(R, W) {
  return Math.min(PH1.maxCol, Math.max(PH1.minCol, Math.floor((W - 2 * PH1.pad - (R - 1) * PH1.gap) / R)));
}
function compactNatural(R, colW) { return R * colW + (R - 1) * PH1.gap + 2 * PH1.pad; }
function compactPos(rankIndex, row, colW) {
  return {
    x: PH1.pad + rankIndex * (colW + PH1.gap), y: PH1.pad + row * (PH1.pillH + PH1.rowGap),
    w: colW, h: PH1.pillH,
  };
}
function compactEdgeD(from, to) {
  if (from.x === to.x) {
    const x = from.x + from.w / 2;
    return `M ${x} ${from.y + from.h} L ${x} ${to.y}`;
  }
  const x1 = from.x + from.w; const y1 = from.y + from.h / 2;
  const x2 = to.x; const y2 = to.y + to.h / 2;
  const bend = Math.max(24, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}
// The var(--*) token set graph-view.js used before PH-1 (fff7ad69). A
// PH1-SOURCE-SCAN assertion checks graph-view.js uses exactly this set.
const PH1_ALLOWED_TOKENS = [
  'var(--background-modifier-border)', 'var(--background-primary)', 'var(--background-secondary)',
  'var(--color-orange)', 'var(--font-monospace)', 'var(--font-ui-small)', 'var(--font-ui-smaller)',
  'var(--interactive-accent)', 'var(--link-color)', 'var(--text-error)', 'var(--text-faint)',
  'var(--text-muted)',
];
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
// PH-1: a minimal read-only epic environment (board note + type:slice cards)
// for render()-driven fixtures. Every mutator records and throws.
function epicEnv({ dir, name, slices, laneOrder = [] }) {
  const boardDir = `${dir}/board`;
  const boardNote = `${boardDir}/${name}-board.md`;
  const opened = [];
  const mutations = [];
  const files = [file(boardNote, 1), ...slices.map((slice, index) => file(`${boardDir}/${slice.card}.md`, 10 + index))];
  const frontmatter = new Map([
    [boardNote, { type: 'kanban', 'kanban-plugin': 'board', board_role: 'epic' }],
    ...slices.map((slice) => [`${boardDir}/${slice.card}.md`, {
      type: 'slice', status: slice.status, depends_on: slice.depends_on || [],
      ...(slice.resume_condition ? { resume_condition: slice.resume_condition } : {}),
    }]),
  ]);
  const bodies = new Map([
    [boardNote, [
      '---', 'kanban-plugin: board', 'type: kanban', 'board_role: epic', '---', '',
      '## In Planning', '', ...laneOrder.map((card) => `- [ ] [[${card}]]`), '',
    ].join('\n')],
    ...slices.filter((slice) => slice.outcome).map((slice) => [`${boardDir}/${slice.card}.md`, `## Outcome\n\n${slice.outcome}\n`]),
  ]);
  const mutator = (label) => () => { mutations.push(label); throw new Error(`read-only fixture invoked ${label}`); };
  const app = {
    vault: {
      getMarkdownFiles: () => files,
      cachedRead: async (entry) => {
        if (bodies.has(entry.path)) return bodies.get(entry.path);
        throw new Error(`unexpected read ${entry.path}`);
      },
      create: mutator('vault.create'), modify: mutator('vault.modify'),
      delete: mutator('vault.delete'), rename: mutator('vault.rename'), trash: mutator('vault.trash'),
      adapter: {
        write: mutator('adapter.write'), append: mutator('adapter.append'),
        process: mutator('adapter.process'), remove: mutator('adapter.remove'),
        rename: mutator('adapter.rename'), mkdir: mutator('adapter.mkdir'), rmdir: mutator('adapter.rmdir'),
      },
    },
    metadataCache: {
      getFileCache: (entry) => ({ frontmatter: frontmatter.get(entry.path) || {} }),
      trigger: mutator('metadataCache.trigger'),
    },
    fileManager: { processFrontMatter: mutator('fileManager.processFrontMatter') },
    workspace: { openLinkText: (...args) => opened.push(args) },
  };
  const epicPath = `${dir}/${name}.md`;
  return { app, page: { file: { path: epicPath, folder: dir } }, boardDir, epicPath, opened, mutations };
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
  // PH1C-WIDE-BYTE-IDENTICAL (main fixture): the default path and an explicit
  // W=1024 override both match the pinned pre-PH-1 digests.
  assertWideDigest('main (default width)', root, PH1_WIDE_DIGESTS.main);
  const wideMainContainer = element();
  await new GraphView().render({ container: wideMainContainer }, { containerWidth: 1024 });
  assertWideDigest('main @1024', wideMainContainer.children[0], PH1_WIDE_DIGESTS.main);
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
  assertWideDigest('clean (default width)', cleanRoot, PH1_WIDE_DIGESTS.clean);
  const wideCleanContainer = element();
  await new GraphView().render({ container: wideCleanContainer }, { containerWidth: 1024 });
  assertWideDigest('clean @1024', wideCleanContainer.children[0], PH1_WIDE_DIGESTS.clean);
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
  const weirdLifecycleApi = {
    normalizeStatus(value) { stubCalls.push(value); return value === 'weird' ? 'completed' : null; },
    deriveEpicLifecycle() { return { state: 'active', counts: {} }; },
  };
  await new GraphView({ lifecycleApi: weirdLifecycleApi }).render({ container: stubContainer });
  assertWideDigest('stub lifecycle (default width)', stubContainer.children[0], PH1_WIDE_DIGESTS.stubLifecycle);
  const wideStubContainer = element();
  await new GraphView({ lifecycleApi: weirdLifecycleApi }).render({ container: wideStubContainer }, { containerWidth: 1024 });
  assertWideDigest('stub lifecycle @1024', wideStubContainer.children[0], PH1_WIDE_DIGESTS.stubLifecycle);
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
  // The fifth read site is the compact pill (_renderPill).
  assert.strictEqual((widgetSource.match(/presentation\.glyph/g) || []).length, 5,
    'BL2-GLYPH-SOURCE (PH1-GLYPH-SITE-COUNT-FIVE): the chip, compact pill, legend, panel, and panel-link glyph sites read from shared presentation');
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
  assert(nullGatePanel, 'BL4-NULL-PROPAGATION: the first chip tap opens the graph-view-detail-panel card');
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
  assertWideDigest('cross-epic stub (default width)', bRoot, PH1_WIDE_DIGESTS.crossEpic);
  const wideBContainer = element();
  await new GraphView().render({ container: wideBContainer }, { containerWidth: 1024 });
  assertWideDigest('cross-epic stub @1024', wideBContainer.children[0], PH1_WIDE_DIGESTS.crossEpic);

  // B1: exactly one ghost stub node renders for the cross-epic dependency,
  // labeled with the owning epic name and the target card id.
  const stubNodes = byClass(bRoot, 'graph-view-stub');
  assert.strictEqual(stubNodes.length, 1,
    'B1: exactly one cross-epic ghost stub node renders');
  const stubText = textOf(stubNodes[0]);
  assert(stubText.includes('Loop Ops') && stubText.includes('GA-OPS21a4'),
    'B1: the stub is labeled with the owning epic name and the target card id');
  // B2 / BL4-STUB: a stub participates in select-first, but its detail panel
  // degrades to identity plus the explicit Open slice and Close buttons (no
  // invented status, prerequisites, outcome, or gates content).
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
  'BL4-STUB: the stub detail panel identifies the target and offers Open slice');
  assert.strictEqual(byClass(stubPanel, 'graph-view-detail-status').length
    + byClass(stubPanel, 'graph-view-detail-needs').length
    + byClass(stubPanel, 'graph-view-detail-outcome').length
    + byClass(stubPanel, 'graph-view-detail-gates').length, 0,
  'BL4-STUB: unavailable detail fields are omitted rather than fabricated');
  byClass(stubPanel, 'graph-view-detail-open')[0].listeners.click({ stopPropagation() {} });
  assert.deepStrictEqual(bOpened.at(-1), [`${opsEpicDir}/board/GA-OPS21a4 Ops Slice`, bEpicPath, false],
    'B2: the explicit stub Open slice affordance opens the owning cross-epic card');
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
  assertWideDigest('MX (default width)', mxRoot, PH1_WIDE_DIGESTS.mx);
  const wideMxContainer = element();
  await new GraphView({ lifecycleApi, insights: new GraphInsights() }).render({ container: wideMxContainer }, { containerWidth: 1024 });
  assertWideDigest('MX @1024', wideMxContainer.children[0], PH1_WIDE_DIGESTS.mx);
  // The MX env mounts without SectionLabel, so the wide root holds no empty
  // element at all: every node has children, text, or edge markup.
  assert.deepStrictEqual(flatten(mxRoot).filter((node) => !node.children.length && !node.textContent && !node.innerHTML).map((node) => node.className),
    [],
    'PH1C-WIDE-BYTE-IDENTICAL: no empty host elements are pre-created on the wide path');
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
  'VP4-HEADER: id, complete title, shared status chip, and Open slice affordance share one header');
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
    'BL4-PANEL: the selected card exposes an explicit Open slice affordance');
  const beforeOpenAffordance = mxOpened.length;
  byClass(mxPanel, 'graph-view-detail-open')[0].listeners.click({ stopPropagation() {} });
  assert(mxOpened.length === beforeOpenAffordance + 1
    && JSON.stringify(mxOpened.at(-1)) === JSON.stringify([`${mxBoard}/${mxLong}`, mxEpicPath, false]),
  'VP4-OPEN: the restyled non-stub Open slice affordance opens the selected card exactly');
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

  // ---- PH-1 phone-first (MX env, W=390): compact map + inline detail card ----
  // document.body is stubbed from here through the one-shot fixtures so the
  // is-mobile class and a body-mounted card are both observable.
  const ph1Body = element('body');
  let ph1MobileClass = false;
  ph1Body.classList = { contains: (name) => name === 'is-mobile' && ph1MobileClass };
  ph1Body.appendChild = (child) => ph1Body.insertBefore(child, null);
  const savedDocumentDescriptor = Object.getOwnPropertyDescriptor(global, 'document');
  global.document = { body: ph1Body };
  const mxReads = [];
  const mxPriorRead = global.app.vault.cachedRead;
  global.app.vault.cachedRead = async (entry) => { mxReads.push(entry.path); return mxPriorRead(entry); };
  const mxNarrowContainer = element();
  await new GraphView({ lifecycleApi, insights: new GraphInsights() })
    .render({ container: mxNarrowContainer }, { containerWidth: 390 });
  global.app.vault.cachedRead = mxPriorRead;
  const mxNarrowRoot = mxNarrowContainer.children.find((child) => child.className === 'graph-view-root');
  const mxHost = byClass(mxNarrowRoot, 'graph-view-compact')[0];
  assert(mxHost && mxHost.parent === mxNarrowRoot,
    'PH1C-DETAIL-INLINE-OUTCOME: a 390px override mounts the compact host inside the graph root');
  assert.strictEqual(byClass(mxNarrowRoot, 'graph-view-chip-name').length, 0,
    'PH1: the compact presentation draws pills, not wide chips');
  assert.deepStrictEqual(flatten(mxNarrowRoot).filter((node) => !node.children.length && !node.textContent && !node.innerHTML).map((node) => node.className),
    [],
    'PH1C-DETAIL-INLINE-OUTCOME: no empty host elements are pre-created on the compact path either');
  for (const slicePath of [`${mxBoard}/${mxShort}.md`, `${mxBoard}/${mxMiddling}.md`, `${mxBoard}/${mxLong}.md`, `${mxBoard}/${mxParked}.md`]) {
    assert(mxReads.includes(slicePath),
      `PH1C-DETAIL-INLINE-OUTCOME: the compact presentation loads the Outcome body of ${slicePath}`);
  }
  const mxPills = byClass(mxNarrowRoot, 'graph-view-pill');
  assert.strictEqual(mxPills.length, 4, 'PH1: one compact pill per MX slice');
  const mxPillFor = (id) => mxPills.find((pill) => byClass(pill, 'graph-view-pill-id')[0]?.textContent === id);
  assert(['MX-A', 'MX-B', 'MX-C', 'MX-D'].every((id) => mxPillFor(id)),
    'PH1C-SHORT-ID-RULE: two 390px ranks (colW 140 >= 72) keep every full id on its pill');
  const mxNarrowScroller = byClass(mxHost, 'graph-view-compact-scroll')[0];
  const mxNarrowLegend = byClass(mxHost, 'graph-view-legend')[0];
  const mxNarrowToolbar = byClass(mxHost, 'graph-view-filter-toolbar')[0];
  assert(mxNarrowScroller && mxNarrowLegend && mxNarrowToolbar
    && mxHost.children.indexOf(mxNarrowToolbar) < mxHost.children.indexOf(mxNarrowScroller)
    && mxHost.children.indexOf(mxNarrowScroller) < mxHost.children.indexOf(mxNarrowLegend),
  'PH1: the compact host orders toolbar, map, legend (BL-5 / VP-3 placement)');
  assert.strictEqual(byClass(mxNarrowRoot, 'graph-view-detail-panel').length, 0,
    'PH1C-DETAIL-INLINE-OUTCOME: no card renders at rest');
  const mxNarrowAtRest = JSON.parse(JSON.stringify(domShape(mxNarrowRoot)));
  const mxNarrowOpenCount = mxOpened.length;
  const mxNarrowFirstTap = bubblingClick(mxPillFor('MX-C'));
  assert(mxNarrowFirstTap.stopped && mxOpened.length === mxNarrowOpenCount,
    'PH1C-DETAIL-INLINE-OUTCOME: the first pill tap selects without navigation and stops before the canvas clear');
  // The card is looked up in the root AND on the stubbed body so a mutant that
  // mounts it on document.body is caught by its own named guard below.
  const mxCard = byClass(mxNarrowRoot, 'graph-view-detail-panel')[0] || byClass(ph1Body, 'graph-view-detail-panel')[0];
  assert(mxCard, 'PH1C-DETAIL-INLINE-OUTCOME: the first tap renders a detail card');
  const mxCardAncestry = [];
  for (let node = mxCard; node; node = node.parent) mxCardAncestry.push(node);
  // MUTATION GUARD: PH1-MUTANT-FIXED-OVERLAY turns RED if the card is mounted
  // on document.body or carries position:fixed instead of living inline.
  assert(mxCardAncestry.includes(mxNarrowRoot) && !mxCardAncestry.includes(ph1Body)
    && ph1Body.children.length === 0 && !mxCard.style.cssText.includes('position:fixed'),
  'PH1-MUTANT-FIXED-OVERLAY: the card lives in the graph root, never as a body-fixed overlay');
  assert(mxCard.parent === mxHost
    && mxHost.children.indexOf(mxCard) === mxHost.children.indexOf(mxNarrowLegend) + 1,
  'PH1C-DETAIL-INLINE-OUTCOME: the card is an inline element directly after the compact legend, under the map, inside the compact host');
  assert.deepStrictEqual(byClass(mxCard, 'graph-view-detail-label').map((label) => label.textContent),
    ['Waiting on', 'Unmet prerequisites', 'Outcome', 'Gates'],
    'PH1C-DETAIL-INLINE-OUTCOME: the compact card carries WAITING ON / UNMET PREREQUISITES / OUTCOME / GATES');
  assert.strictEqual(byClass(mxCard, 'graph-view-detail-outcome-value')[0]?.textContent, mxLongOutcome,
    'PH1C-DETAIL-INLINE-OUTCOME: the OUTCOME row holds the loaded slice Outcome text at 390px');
  assert.strictEqual(byClass(mxCard, 'graph-view-detail-wait')[0]?.textContent, `waiting on: ${mxShort}`,
    'PH1: the compact card shows the selected slice wait reason');
  assert(byClass(mxCard, 'graph-view-detail-prerequisite').length === 1
    && byClass(mxCard, 'graph-view-detail-gates-count')[0]?.textContent === '0 slices',
  'PH1: the compact card carries the prerequisite link and the gates count');
  const mxOpenSlice = byClass(mxCard, 'graph-view-detail-open')[0];
  const mxClose = byClass(mxCard, 'graph-view-detail-close')[0];
  assert(mxOpenSlice?.textContent === 'Open slice' && mxClose?.textContent === 'Close',
    'PH1C-DETAIL-INLINE-OUTCOME: Open slice and Close actions are present');
  // ---- PH1D-DETAIL-BUTTONS ----
  // The card's Open slice and Close buttons are button elements carrying
  // exactly min-height:32px;padding:5px 10px;cursor:pointer;.
  // MUTATION GUARD: PH1D-MUTANT-CLOSE-BUTTON-DECLARATION turns RED at
  // "PH1D-DETAIL-BUTTONS: the compact card's Close button ..." if the Close
  // button's min-height drops to 24px.
  // MUTATION GUARD: PH1D-MUTANT-OPEN-BUTTON-DECLARATION turns RED at
  // "PH1D-DETAIL-BUTTONS: the compact card's Open slice button ..." if the
  // Open slice button's min-height drops to 24px.
  for (const [name, button] of [['Open slice', mxOpenSlice], ['Close', mxClose]]) {
    assert(button?.tag === 'button' && button.style.cssText === 'min-height:32px;padding:5px 10px;cursor:pointer;',
      `PH1D-DETAIL-BUTTONS: the compact card's ${name} button carries exactly min-height:32px;padding:5px 10px;cursor:pointer;`);
  }
  assert(!mxPillFor('MX-A').className.includes('graph-view-dimmed')
    && !mxPillFor('MX-C').className.includes('graph-view-dimmed')
    && mxPillFor('MX-B').className.includes('graph-view-dimmed')
    && mxPillFor('MX-D').className.includes('graph-view-dimmed'),
  'PH1: selecting a pill keeps its chain full strength and dims the complement');
  assert.strictEqual(svgPaths(mxNarrowRoot, 'edge-depends').filter((chunk) => chunk.includes('graph-view-chain-edge')).length, 1,
    'PH1: exactly one depends edge is emphasized on the compact map');
  mxClose.listeners.click({ stopPropagation() {} });
  assert.strictEqual(byClass(mxNarrowRoot, 'graph-view-detail-panel').length, 0,
    'PH1C-DETAIL-INLINE-OUTCOME: Close removes the card');
  assert.deepStrictEqual(domShape(mxNarrowRoot), mxNarrowAtRest,
    'PH1: Close restores the exact at-rest DOM');
  bubblingClick(mxPillFor('MX-C'));
  mxPillFor('MX-C').listeners.click({ stopPropagation() {} });
  assert.deepStrictEqual(mxOpened.at(-1), [`${mxBoard}/${mxLong}`, mxEpicPath, false],
    'PH1C-DETAIL-INLINE-OUTCOME: a second tap on the same pill opens the note');
  const mxBeforeReselect = mxOpened.length;
  bubblingClick(mxPillFor('MX-A'));
  assert(mxOpened.length === mxBeforeReselect && byClass(mxNarrowRoot, 'graph-view-detail-panel').length === 1,
    'PH1: tapping a different pill reselects without opening');
  byClass(mxHost, 'graph-view-compact-canvas')[0].listeners.click();
  assert.strictEqual(byClass(mxNarrowRoot, 'graph-view-detail-panel').length, 0,
    'PH1C-DETAIL-INLINE-OUTCOME: a canvas tap clears the card');
  assert.deepStrictEqual(domShape(mxNarrowRoot), mxNarrowAtRest,
    'PH1: a canvas tap restores the exact at-rest DOM');
  bubblingClick(mxPillFor('MX-D'));
  const mxOpenSliceBefore = mxOpened.length;
  byClass(mxNarrowRoot, 'graph-view-detail-open')[0].listeners.click({ stopPropagation() {} });
  assert(mxOpened.length === mxOpenSliceBefore + 1
    && JSON.stringify(mxOpened.at(-1)) === JSON.stringify([`${mxBoard}/${mxParked}`, mxEpicPath, false]),
  'PH1: Open slice opens the selected note');
  byClass(mxHost, 'graph-view-compact-canvas')[0].listeners.click();
  assert.notStrictEqual(digestOf(mxNarrowRoot), PH1_WIDE_DIGESTS.mx.root,
    'PH1: the 390 root digest differs from the 1024 pin');
  // Wide (W=1024): the card carries Outcome, Open slice, and Close at the
  // legend+1 slot of the root, and Close returns the root to its pinned digest.
  const mxWideDetailContainer = element();
  await new GraphView({ lifecycleApi, insights: new GraphInsights() })
    .render({ container: mxWideDetailContainer }, { containerWidth: 1024 });
  const mxWideRoot = mxWideDetailContainer.children[0];
  const mxWideChips = byClass(mxWideRoot, 'graph-view-chip');
  const mxWideChipFor = (id) => mxWideChips.find((chip) => flatten(chip).some((node) => node.textContent === id));
  bubblingClick(mxWideChipFor('MX-C'));
  const mxWideCard = byClass(mxWideRoot, 'graph-view-detail-panel')[0];
  const mxWideLegendIndex = mxWideRoot.children.findIndex((node) => node.className === 'graph-view-legend');
  assert(mxWideCard && mxWideRoot.children.indexOf(mxWideCard) === mxWideLegendIndex + 1
    && !mxWideCard.style.cssText.includes('position:fixed') && ph1Body.children.length === 0,
  'PH1C-DETAIL-INLINE-OUTCOME: at 1024 the card is inline under the canvas at the legend+1 slot');
  assert.strictEqual(byClass(mxWideCard, 'graph-view-detail-outcome-value')[0]?.textContent, mxLongOutcome,
    'PH1C-DETAIL-INLINE-OUTCOME: the OUTCOME row holds the loaded slice Outcome text at 1024px');
  assert(byClass(mxWideCard, 'graph-view-detail-open')[0]?.textContent === 'Open slice'
    && byClass(mxWideCard, 'graph-view-detail-close')[0]?.textContent === 'Close',
  'PH1C-DETAIL-INLINE-OUTCOME: Open slice and Close are present on the wide card too');
  for (const [name, className] of [['Open slice', 'graph-view-detail-open'], ['Close', 'graph-view-detail-close']]) {
    const button = byClass(mxWideCard, className)[0];
    assert(button?.tag === 'button' && button.style.cssText === 'min-height:32px;padding:5px 10px;cursor:pointer;',
      `PH1D-DETAIL-BUTTONS: the wide card's ${name} button carries exactly min-height:32px;padding:5px 10px;cursor:pointer;`);
  }
  byClass(mxWideCard, 'graph-view-detail-close')[0].listeners.click({ stopPropagation() {} });
  assert.strictEqual(digestOf(mxWideRoot), PH1_WIDE_DIGESTS.mx.root,
    'PH1C-WIDE-BYTE-IDENTICAL: closing the wide card returns the root to the pinned pre-slice shape');

  // MX-writes: the presentation render (including Outcome reads) mutates nothing.
  assert.deepStrictEqual(mxMutations, [],
    'MX: auto-width render invokes no vault, adapter, frontmatter, or metadata mutator');
  global.app = savedAppMX;
  global.customJS = savedCustomJSMX;

  // ---- PH-1 phone-first: width resolver, compact geometry, cold-load one-shot ----
  // The main Graph Epic env is live again.
  const ph1View = new GraphView({ dashboard, lifecycleApi, insights: realInsights });
  const resolve = (dv, overrides) => ph1View._resolveWidth(dv, overrides);
  assert.deepStrictEqual(resolve({ container: { clientWidth: 500 } }, { containerWidth: 1024 }),
    { width: 1024, narrow: false, source: 'override' },
    'PH1C-WIDTH-RESOLUTION: an explicit containerWidth override beats a measured clientWidth');
  assert.deepStrictEqual(resolve({ container: { clientWidth: 900 } }, { containerWidth: 390 }),
    { width: 390, narrow: true, source: 'override' },
    'PH1C-WIDTH-RESOLUTION: a narrow override beats a wide measurement');
  assert.deepStrictEqual(resolve({ container: { clientWidth: 500 } }, {}),
    { width: 500, narrow: true, source: 'measured' },
    'PH1C-WIDTH-RESOLUTION: without an override the measured clientWidth decides');
  ph1MobileClass = true;
  assert.deepStrictEqual(resolve({ container: { clientWidth: 800 } }, undefined),
    { width: 800, narrow: false, source: 'measured' },
    'PH1C-WIDTH-RESOLUTION: a positive measurement beats the is-mobile body class');
  // MUTATION GUARD: PH1-MUTANT-SKIP-MOBILE-CLASS turns RED if the resolver
  // skips the is-mobile body-class fallback and resolves a zero measurement wide.
  assert.deepStrictEqual(resolve({ container: { clientWidth: 0 } }, {}),
    { width: 390, narrow: true, source: 'mobile-class' },
    'PH1-MUTANT-SKIP-MOBILE-CLASS: a zero measurement with the is-mobile body class resolves narrow');
  // PH1B-THROWING-GETTER-DROPS-CROSSING: a read that throws is unmeasured,
  // not an error, so it falls through to the is-mobile class and then wide.
  const throwingWidth = { container: { get clientWidth() { throw new Error('clientWidth unreadable'); } } };
  const throwingContainer = { get container() { throw new Error('container unreadable'); } };
  for (const dv of [throwingWidth, throwingContainer]) {
    assert.deepStrictEqual(resolve(dv, {}), { width: 390, narrow: true, source: 'mobile-class' },
      'PH1C-WIDTH-RESOLUTION (PH1B-THROWING-GETTER-DROPS-CROSSING): a throwing width read on an is-mobile body resolves unmeasured, through the mobile class, without throwing');
  }
  ph1MobileClass = false;
  for (const dv of [throwingWidth, throwingContainer]) {
    assert.deepStrictEqual(resolve(dv, {}), { width: 1024, narrow: false, source: 'default' },
      'PH1C-WIDTH-RESOLUTION (PH1B-THROWING-GETTER-DROPS-CROSSING): a throwing width read without is-mobile resolves unmeasured default wide, without throwing');
  }
  assert.deepStrictEqual(resolve(throwingWidth, { containerWidth: 700 }), { width: 700, narrow: false, source: 'override' },
    'PH1C-WIDTH-RESOLUTION: a throwing width read does not mask an override');
  assert.deepStrictEqual(resolve({ container: { clientWidth: 500 } }, { get containerWidth() { throw new Error('args unreadable'); } }),
    { width: 500, narrow: true, source: 'measured' },
    'PH1C-WIDTH-RESOLUTION: an override read that throws is no override, so the measurement still decides');
  assert.deepStrictEqual(resolve({ container: { clientWidth: 0 } }, {}),
    { width: 1024, narrow: false, source: 'default' },
    'PH1C-WIDTH-RESOLUTION: a zero measurement without is-mobile resolves wide');
  // MUTATION GUARD: PH1-MUTANT-THRESHOLD-INCLUSIVE turns RED if 600px is
  // treated as narrow (the threshold is strictly under 600).
  for (const [width, narrow] of [[599, true], [600, false]]) {
    assert.strictEqual(resolve({ container: {} }, { containerWidth: width }).narrow, narrow,
      `PH1-MUTANT-THRESHOLD-INCLUSIVE: an override of ${width} is ${narrow ? 'narrow' : 'wide'}`);
    assert.strictEqual(resolve({ container: { clientWidth: width } }, {}).narrow, narrow,
      `PH1-MUTANT-THRESHOLD-INCLUSIVE: a measurement of ${width} is ${narrow ? 'narrow' : 'wide'}`);
  }
  // MUTATION GUARD: PH1C-MUTANT-COERCED-OVERRIDE turns RED if the override is
  // coerced with Number() (true -> 1, '390' -> 390, [390] -> 390) instead of
  // requiring a finite positive number; a non-number falls through to
  // measurement.
  assert.deepStrictEqual(resolve({ container: { clientWidth: 500 } }, { containerWidth: true }),
    { width: 500, narrow: true, source: 'measured' },
    'PH1C-MUTANT-COERCED-OVERRIDE (PH1-OVERRIDE-NUMBER-ONLY): a boolean containerWidth is not an override (Number(true) would be 1); measurement decides');
  assert.deepStrictEqual(resolve({ container: { clientWidth: 900 } }, { containerWidth: '390' }),
    { width: 900, narrow: false, source: 'measured' },
    'PH1C-WIDTH-RESOLUTION (PH1-OVERRIDE-NUMBER-ONLY): a numeric string is not an override either');
  for (const [dv, overrides] of [
    [null, null], [undefined, 'garbage'], [{}, { containerWidth: 'abc' }],
    [{ container: null }, { containerWidth: -5 }], [{ container: {} }, { containerWidth: 0 }], [42, 42],
    [{ get container() { throw new Error('boom'); } }, {}],
    [{ container: { get clientWidth() { throw new Error('boom'); } } }, { containerWidth: NaN }],
    [{}, { containerWidth: true }], [{}, { containerWidth: '390' }], [{}, { containerWidth: [390] }],
    [{}, { containerWidth: Infinity }],
  ]) {
    assert.deepStrictEqual(resolve(dv, overrides), { width: 1024, narrow: false, source: 'default' },
      'PH1C-WIDTH-RESOLUTION (PH1-OVERRIDE-NUMBER-ONLY): each listed unknown input without the is-mobile class resolves default wide without throwing, including true, "390", [390], and Infinity on an unmeasurable container');
  }
  // ---- PH1D-MOBILE-CLASS-READ ----
  // The is-mobile read beyond classList: a body without classList falls back
  // to its className, matching is-mobile only as a whole class; a classList
  // that exists decides alone; no document, no body, or a body that throws
  // reads as not mobile, so a zero measurement resolves default wide.
  // MUTATION GUARD: PH1D-MUTANT-NO-CLASSNAME-FALLBACK turns RED at
  // "PH1D-MOBILE-CLASS-READ: a body without classList whose className carries
  // is-mobile ..." if only classList is read.
  // MUTATION GUARD: PH1D-MUTANT-CLASSNAME-SUBSTRING turns RED at
  // "PH1D-MOBILE-CLASS-READ: a body without classList whose className carries
  // only is-mobile-app ..." if the className match is a substring match.
  // MUTATION GUARD: PH1D-MUTANT-CLASSLIST-OR-CLASSNAME turns RED at
  // "PH1D-MOBILE-CLASS-READ: a body whose classList denies is-mobile ..." if
  // a classList that exists does not decide alone.
  // MUTATION GUARD: PH1D-MUTANT-MOBILE-READ-FAULT-IS-MOBILE turns RED at
  // "PH1D-MOBILE-CLASS-READ: a body getter that throws ..." if a failed read
  // counts as mobile.
  {
    const documentBefore = global.document;
    const zeroPane = { container: { clientWidth: 0 } };
    for (const [label, doc, mobile] of [
      ['a body without classList whose className carries is-mobile resolves mobile-class', { body: { className: 'theme-dark is-mobile' } }, true],
      ['a body without classList whose className carries only is-mobile-app and not-is-mobile resolves default', { body: { className: 'is-mobile-app not-is-mobile' } }, false],
      ['a body whose classList denies is-mobile resolves default even when its className names it', { body: { className: 'is-mobile', classList: { contains: () => false } } }, false],
      ['no document resolves default', null, false],
      ['a document without a body resolves default', {}, false],
      ['a body getter that throws resolves default', { get body() { throw new Error('body unreadable'); } }, false],
    ]) {
      if (doc === null) delete global.document;
      else global.document = doc;
      const resolved = resolve(zeroPane, {});
      global.document = documentBefore;
      assert.deepStrictEqual(resolved, mobile
        ? { width: 390, narrow: true, source: 'mobile-class' }
        : { width: 1024, narrow: false, source: 'default' },
      `PH1D-MOBILE-CLASS-READ: ${label}`);
    }
  }

  // ---- PH1D-MEASURED-FINITE ----
  // A clientWidth that is not a finite number is unmeasured: Infinity
  // resolves through the is-mobile class, and without it to default wide.
  // MUTATION GUARD: PH1D-MUTANT-MEASURED-NOT-FINITE turns RED at
  // "PH1D-MEASURED-FINITE: an Infinity clientWidth on an is-mobile body ..." if
  // any positive measurement counts, finite or not.
  for (const [mobile, expected] of [
    [true, { width: 390, narrow: true, source: 'mobile-class' }],
    [false, { width: 1024, narrow: false, source: 'default' }],
  ]) {
    ph1MobileClass = mobile;
    const resolved = resolve({ container: { clientWidth: Infinity } }, {});
    ph1MobileClass = false;
    assert.deepStrictEqual(resolved, expected,
      `PH1D-MEASURED-FINITE: an Infinity clientWidth ${mobile ? 'on an is-mobile body resolves mobile-class 390' : 'without is-mobile resolves default wide'}`);
  }
  // ---- PH1D-RESOLVER-FAULT ----
  // An is-mobile read that throws inside _resolveWidth resolves default wide
  // and does not throw out of the resolver.
  // MUTATION GUARD: PH1D-MUTANT-RESOLVER-RETHROWS turns RED at
  // "PH1D-RESOLVER-FAULT: an is-mobile read that throws ..." if the
  // resolver's outer catch rethrows instead of resolving default wide.
  {
    const faultyMobile = new GraphView();
    faultyMobile._isMobileBody = () => { throw new Error('is-mobile read fault'); };
    let resolved = null;
    try {
      resolved = faultyMobile._resolveWidth({ container: { clientWidth: 0 } }, {});
    } catch (_error) { resolved = 'threw'; }
    assert.deepStrictEqual(resolved, { width: 1024, narrow: false, source: 'default' },
      'PH1D-RESOLVER-FAULT: an is-mobile read that throws inside _resolveWidth resolves default wide and does not throw');
  }

  // ---- PH1D-POSITIVE-WIDTHS ----
  // Any finite positive width is used as given: a 0.5 override is an
  // override, and a 0.5 or a 599.5 clientWidth is a measurement.
  // MUTATION GUARD: PH1D-MUTANT-OVERRIDE-AT-LEAST-ONE turns RED at
  // "PH1D-POSITIVE-WIDTHS: a 0.5 containerWidth override ..." if an override
  // must be at least 1.
  // MUTATION GUARD: PH1D-MUTANT-MEASURED-AT-LEAST-ONE turns RED at
  // "PH1D-POSITIVE-WIDTHS: a 0.5 clientWidth ..." if a measurement must be at
  // least 1.
  // MUTATION GUARD: PH1D-MUTANT-MEASURED-PARSEINT turns RED at
  // "PH1D-POSITIVE-WIDTHS: a 0.5 clientWidth ..." if the measurement is read
  // with parseInt instead of Number.
  assert.deepStrictEqual(resolve({ container: { clientWidth: 900 } }, { containerWidth: 0.5 }),
    { width: 0.5, narrow: true, source: 'override' },
    'PH1D-POSITIVE-WIDTHS: a 0.5 containerWidth override over a measured 900 resolves as a narrow override of 0.5');
  for (const clientWidth of [0.5, 599.5]) {
    assert.deepStrictEqual(resolve({ container: { clientWidth } }, {}),
      { width: clientWidth, narrow: true, source: 'measured' },
      `PH1D-POSITIVE-WIDTHS: a ${clientWidth} clientWidth resolves as a narrow measurement of ${clientWidth}`);
  }
  // ---- PH1D-ARGS-OBJECT-ONLY ----
  // Only an args object carries an override: a function that has a
  // containerWidth property is no override.
  // MUTATION GUARD: PH1D-MUTANT-ARGS-ANY-TRUTHY turns RED at
  // "PH1D-ARGS-OBJECT-ONLY: a function args value ..." if any truthy args
  // value is read for containerWidth.
  assert.deepStrictEqual(resolve({ container: { clientWidth: 900 } }, Object.assign(() => {}, { containerWidth: 390 })),
    { width: 900, narrow: false, source: 'measured' },
    'PH1D-ARGS-OBJECT-ONLY: a function args value carrying containerWidth 390 is no override, so the measured 900 decides');

  // PH1C-NO-SIDEWAYS-SCROLL — pure geometry at W=390.
  const ph1Nodes = (count, prefix = 'GA-ML') => Array.from({ length: count }, (_, index) => ({
    card: `${prefix}${index + 1} Step ${index + 1}`, path: `${board}/${prefix}${index + 1} Step ${index + 1}.md`,
    status: 'planning', rank: index, row: 0,
  }));
  const ph1Ranks = (count) => Array.from({ length: count }, (_, index) => index);
  // MUTATION GUARD: PH1-MUTANT-DROP-CLAMP turns RED if colW loses its
  // [40, 140] clamp (1 rank would widen to 386, 8 ranks would shrink to 39).
  const one = ph1View._compactGeometry(ph1Nodes(1), ph1Ranks(1), 390);
  assert.strictEqual(one.colW, 140,
    'PH1-MUTANT-DROP-CLAMP: a single rank clamps down to the 140px ceiling (the raw floor gives 386)');
  assert.strictEqual(one.canvasWidth, 144, 'PH1C-NO-SIDEWAYS-SCROLL: a single 140px column plus 2*pad is 144px');
  // By the card's formula, 8 ranks at 390 clamp to 40px pills and need
  // 8*40 + 7*10 + 4 = 394px, 4px past 390, so the map scrolls.
  const eight = ph1View._compactGeometry(ph1Nodes(8), ph1Ranks(8), 390);
  assert.strictEqual(eight.colW, 40,
    'PH1-MUTANT-DROP-CLAMP: 8 ranks at 390 clamp up to the 40px floor (the raw floor gives 39)');
  assert(eight.natural === 394 && eight.scrolls === true && eight.canvasWidth === 394,
    'PH1C-NO-SIDEWAYS-SCROLL (PH1-EIGHT-RANKS-OVERFLOW): 8 ranks at 390 overflow — 40px pills, 394px canvas, scrolls: true');
  for (const R of [1, 4, 7]) {
    const geometry = ph1View._compactGeometry(ph1Nodes(R), ph1Ranks(R), 390);
    assert.strictEqual(geometry.colW, compactColW(R, 390),
      `PH1C-NO-SIDEWAYS-SCROLL: ${R}-rank column width is clamp(floor((390 - 4 - ${R - 1}*10) / ${R}), 40, 140) = ${compactColW(R, 390)}`);
    assert(geometry.canvasWidth <= 390 && geometry.scrolls === false && geometry.canvasWidth === compactNatural(R, geometry.colW),
      `PH1C-NO-SIDEWAYS-SCROLL: ${R} ranks at 390 fit without horizontal scroll (canvas ${geometry.canvasWidth}px)`);
    assert.deepStrictEqual([geometry.pillH, geometry.rowGap, geometry.pad, geometry.gap], [26, 8, 2, 10],
      'PH1C-NO-SIDEWAYS-SCROLL: pill height 26, row gap 8, pad 2, gap 10 are the emitted numbers');
    for (let index = 0; index < R; index += 1) {
      assert.deepStrictEqual(geometry.positions.get(`GA-ML${index + 1} Step ${index + 1}`), compactPos(index, 0, geometry.colW),
        `PH1C-NO-SIDEWAYS-SCROLL: rank ${index} pill sits at pad + rank*(colW + gap)`);
    }
    assert.strictEqual(geometry.canvasHeight, 2 * PH1.pad + PH1.pillH,
      'PH1C-NO-SIDEWAYS-SCROLL: a single-row map is pad + pill + pad tall');
  }
  assert.throws(() => ph1View._compactGeometry(ph1Nodes(2), ph1Ranks(2), 'nope'),
    'PH1: compact geometry refuses a non-numeric width');

  // PH1C-SHORT-ID-RULE — pure labels, then the rendered pills.
  const five = ph1View._compactGeometry(ph1Nodes(5), ph1Ranks(5), 390);
  assert.strictEqual(five.colW, 69, 'PH1C-SHORT-ID-RULE: five 390px ranks give a 69px column (below 72)');
  assert(five.shortIds === true, 'PH1C-SHORT-ID-RULE: ids shorten when colW < 72 and every id shares a prefix');
  assert.deepStrictEqual([...five.labels.values()], ['ML1', 'ML2', 'ML3', 'ML4', 'ML5'],
    'PH1C-SHORT-ID-RULE: the shared alphabetic prefix is stripped through the dash (GA-ML1 -> ML1)');
  const four = ph1View._compactGeometry(ph1Nodes(4), ph1Ranks(4), 390);
  assert(four.colW === 89 && four.shortIds === false,
    'PH1C-SHORT-ID-RULE: at colW >= 72 ids do not shorten');
  assert.deepStrictEqual([...four.labels.values()], ['GA-ML1', 'GA-ML2', 'GA-ML3', 'GA-ML4'],
    'PH1C-SHORT-ID-RULE: at colW >= 72 every pill shows its full id');
  const mixedPrefixes = [...ph1Nodes(4), { card: 'FL-1c Readiness', path: `${board}/FL-1c Readiness.md`, status: 'planning', rank: 4, row: 0 }];
  const mixed = ph1View._compactGeometry(mixedPrefixes, ph1Ranks(5), 390);
  assert(mixed.colW === 69 && mixed.shortIds === false,
    'PH1C-SHORT-ID-RULE: a set whose prefixes differ does not shorten, even below 72');
  assert.deepStrictEqual([...mixed.labels.values()], ['GA-ML1', 'GA-ML2', 'GA-ML3', 'GA-ML4', 'FL-1c'],
    'PH1C-SHORT-ID-RULE: mixed-prefix pills keep their full ids');
  // PH1D-SHORT-ID-UNPARSEABLE (L04): a set where one node has no parseable id
  // (a card named without an ID-prefix) keeps full ids for every node, even
  // below 72, and the id-less node is labelled with its whole card name.
  // MUTATION GUARD: PH1D-MUTANT-SKIP-UNPARSEABLE-ID (L04) turns RED here if a
  // node without a parseable id is skipped instead of cancelling the shared
  // prefix.
  // MUTATION GUARD: PH1D-MUTANT-IDLESS-LABEL-EMPTY turns RED here if an
  // id-less node's label drops its card-name fallback.
  // A geometry call that throws (a shortened label cut from a null id) is a
  // failure of this fixture, reported under its own label.
  let idless = null;
  try {
    idless = ph1View._compactGeometry([...ph1Nodes(4), { card: 'Loose note', path: `${board}/Loose note.md`, status: 'planning', rank: 4, row: 0 }], ph1Ranks(5), 390);
  } catch (_error) { idless = null; }
  assert(idless && idless.colW === 69 && idless.shortIds === false
    && JSON.stringify([...idless.labels.values()]) === JSON.stringify(['GA-ML1', 'GA-ML2', 'GA-ML3', 'GA-ML4', 'Loose note']),
  'PH1D-SHORT-ID-UNPARSEABLE (L04): a set where one node has no parseable id keeps every full id below 72, and the id-less node shows its card name');
  const shortRoot = element();
  await ph1View._renderCompactGraph(shortRoot, { nodes: ph1Nodes(5), edges: [] }, lifecycleApi, epicPath, [], 390);
  assert.deepStrictEqual(byClass(shortRoot, 'graph-view-pill-id').map((node) => node.textContent), ['ML1', 'ML2', 'ML3', 'ML4', 'ML5'],
    'PH1C-SHORT-ID-RULE: rendered pills carry the short ids');
  assert(byClass(shortRoot, 'graph-view-pill').every((pill, index) => pill.attrs.title === `GA-ML${index + 1} Step ${index + 1}`),
    'PH1: a pill tooltip keeps the full card name');
  const fullRoot = element();
  await ph1View._renderCompactGraph(fullRoot, { nodes: ph1Nodes(4), edges: [] }, lifecycleApi, epicPath, [], 390);
  assert.deepStrictEqual(byClass(fullRoot, 'graph-view-pill-id').map((node) => node.textContent), ['GA-ML1', 'GA-ML2', 'GA-ML3', 'GA-ML4'],
    'PH1C-SHORT-ID-RULE: rendered pills at colW >= 72 carry full ids');

  // ---- PH1D-GEOMETRY-BOUNDARIES ----
  // The short-id threshold and the scroll condition, each pinned on both
  // sides of its flip.
  // PH1C-SHORT-ID-BOUNDARY: five ranks floor to colW 71 at W=399 (the widest
  // column that still shortens) and to colW 72 at W=404 (the narrowest that
  // keeps full ids).
  // MUTATION GUARD: PH1D-MUTANT-SHORT-ID-BELOW-71 turns RED at
  // "PH1D-GEOMETRY-BOUNDARIES (PH1C-SHORT-ID-BOUNDARY): five ranks at W=399
  // ..." if the threshold moves to 71 (colW 71 would keep full ids).
  // MUTATION GUARD: PH1D-MUTANT-SHORT-ID-BELOW-73 turns RED at
  // "PH1D-GEOMETRY-BOUNDARIES (PH1C-SHORT-ID-BOUNDARY): five ranks at W=404
  // ..." if the threshold moves to 73 (colW 72 would shorten).
  // MUTATION GUARD: PH1D-MUTANT-SHORT-ID-INCLUSIVE turns RED at
  // "PH1D-GEOMETRY-BOUNDARIES (PH1C-SHORT-ID-BOUNDARY): five ranks at W=404
  // ..." if the rule becomes colW <= 72.
  const ph1dShort = ['ML1', 'ML2', 'ML3', 'ML4', 'ML5'];
  const ph1dFull = ['GA-ML1', 'GA-ML2', 'GA-ML3', 'GA-ML4', 'GA-ML5'];
  for (const [W, colW, shortened] of [[399, 71, true], [404, 72, false]]) {
    const labels = shortened ? ph1dShort : ph1dFull;
    const geometry = ph1View._compactGeometry(ph1Nodes(5), ph1Ranks(5), W);
    assert(compactColW(5, W) === colW && geometry.colW === colW && geometry.shortIds === shortened
      && JSON.stringify([...geometry.labels.values()]) === JSON.stringify(labels),
    `PH1D-GEOMETRY-BOUNDARIES (PH1C-SHORT-ID-BOUNDARY): five ranks at W=${W} give colW ${colW} and ${shortened ? 'shorten every id' : 'keep every full id'}`);
    const rendered = element();
    await ph1View._renderCompactGraph(rendered, { nodes: ph1Nodes(5), edges: [] }, lifecycleApi, epicPath, [], W);
    assert.deepStrictEqual(byClass(rendered, 'graph-view-pill-id').map((node) => node.textContent), labels,
      `PH1D-GEOMETRY-BOUNDARIES (PH1C-SHORT-ID-BOUNDARY): the rendered W=${W} pills (colW ${colW}) carry ${shortened ? 'the short ids' : 'the full ids'}`);
    assert(byClass(rendered, 'graph-view-pill').every((pill) => pill.style.cssText.includes(`width:${colW}px;height:${PH1.pillH}px;`)),
      `PH1D-GEOMETRY-BOUNDARIES (PH1C-SHORT-ID-BOUNDARY): the rendered W=${W} pills are ${colW}px wide`);
  }
  // PH1C-SCROLL-BOUNDARY: eight 40px ranks need 8*40 + 7*10 + 2*2 = 394px.
  // At W=394 they fit exactly: no scroll and a zero scrollbar allowance. At
  // W=393 they scroll, and the compact scroller reserves the 14px allowance
  // under the map as its padding-bottom.
  // MUTATION GUARD: PH1D-MUTANT-SCROLL-INCLUSIVE turns RED at
  // "PH1D-GEOMETRY-BOUNDARIES (PH1C-SCROLL-BOUNDARY): eight ranks at W=394
  // ..." if the scroll condition becomes >= W.
  // MUTATION GUARD: PH1D-MUTANT-ALLOWANCE-ALWAYS turns RED at
  // "PH1D-GEOMETRY-BOUNDARIES (PH1C-SCROLL-BOUNDARY): eight ranks at W=394
  // ..." if the allowance is 14 whether or not the map scrolls.
  // MUTATION GUARD: PH1D-MUTANT-ALLOWANCE-NEVER turns RED at
  // "PH1D-GEOMETRY-BOUNDARIES (PH1C-SCROLL-BOUNDARY): eight ranks at W=393
  // ..." if the allowance is 0 even when the map scrolls.
  // MUTATION GUARD: PH1D-MUTANT-SCROLLER-PADDING-FIXED turns RED if the
  // compact scroller's padding-bottom stops reading the geometry's
  // allowance: fixed at 14px, at "PH1D-GEOMETRY-BOUNDARIES
  // (PH1C-SCROLL-BOUNDARY): the W=394 compact scroller ..."; fixed at 0px,
  // at "PH1D-GEOMETRY-BOUNDARIES (PH1C-SCROLL-BOUNDARY): the W=393 compact
  // scroller ...".
  for (const [W, scrolls, allowance] of [[394, false, 0], [393, true, 14]]) {
    const geometry = ph1View._compactGeometry(ph1Nodes(8), ph1Ranks(8), W);
    assert(geometry.colW === 40 && geometry.natural === 394 && geometry.canvasWidth === 394
      && geometry.scrolls === scrolls && geometry.scrollbarAllowance === allowance,
    `PH1D-GEOMETRY-BOUNDARIES (PH1C-SCROLL-BOUNDARY): eight ranks at W=${W} lay out 40px pills on a 394px canvas with scrolls: ${scrolls} and a ${allowance}px scrollbar allowance`);
    const rendered = element();
    await ph1View._renderCompactGraph(rendered, { nodes: ph1Nodes(8), edges: [] }, lifecycleApi, epicPath, [], W);
    const scroller = byClass(rendered, 'graph-view-compact-scroll')[0];
    assert(scroller && scroller.style.cssText.includes(`padding-bottom:${allowance}px;`)
      && byClass(rendered, 'graph-view-compact-canvas')[0]?.style.cssText.includes('width:394px;'),
    `PH1D-GEOMETRY-BOUNDARIES (PH1C-SCROLL-BOUNDARY): the W=${W} compact scroller's padding-bottom is the ${allowance}px scrollbar allowance under a 394px canvas`);
  }

  // ---- PH1D-COLUMN-FORMULA (G21, G50) ----
  // The column numerator W - 2*pad - (R-1)*gap, pinned at three widths.
  // Expected values are literals from the card formula
  // colW = floor((W - 4 - (R-1)*10) / R), left = 2 + r*(colW + 10),
  // canvas = R*colW + (R-1)*10 + 4:
  //   R=4, W=393: floor(359/4) = 89, lefts 2 101 200 299, canvas 390
  //   R=3, W=391: floor(367/3) = 122, lefts 2 134 266, canvas 390
  //   R=2, W=293: floor(279/2) = 139, lefts 2 151, canvas 292
  // W - pad gives 90 / 123 / 140 (a canvas wider than W); a +1 numerator
  // gives 90 / 122 / 140.
  // MUTATION GUARD: PH1D-MUTANT-NUMERATOR-SINGLE-PAD (G21) turns RED at
  // "PH1D-COLUMN-FORMULA (G21, G50): 4 ranks at W=393 ..." if the numerator
  // subtracts pad once instead of 2*pad.
  // MUTATION GUARD: PH1D-MUTANT-NUMERATOR-PLUS-ONE (G50) turns RED at
  // "PH1D-COLUMN-FORMULA (G21, G50): 4 ranks at W=393 ..." if the numerator
  // gains one pixel.
  for (const [R, W, colW, lefts, canvas] of [
    [4, 393, 89, [2, 101, 200, 299], 390],
    [3, 391, 122, [2, 134, 266], 390],
    [2, 293, 139, [2, 151], 292],
  ]) {
    const geometry = ph1View._compactGeometry(ph1Nodes(R), ph1Ranks(R), W);
    assert(geometry.colW === colW && geometry.canvasWidth === canvas && geometry.natural === canvas
      && geometry.scrolls === false && geometry.scrollbarAllowance === 0 && canvas <= W
      && JSON.stringify(ph1Ranks(R).map((index) => geometry.positions.get(`GA-ML${index + 1} Step ${index + 1}`)))
        === JSON.stringify(lefts.map((x) => ({ x, y: 2, w: colW, h: 26 }))),
    `PH1D-COLUMN-FORMULA (G21, G50): ${R} ranks at W=${W} give colW ${colW}, lefts ${lefts.join(' ')}, and a ${canvas}px canvas that fits without scrolling`);
  }
  // One column per distinct rank in rank order, even when the ranks are not
  // contiguous (ranks 0 and 3 draw as the first and second columns), and a
  // zero or negative width is refused.
  // MUTATION GUARD: PH1D-MUTANT-COLUMN-BY-INDEX turns RED at
  // "PH1D-COLUMN-FORMULA: ranks 0 and 3 ..." if columns are looked up by
  // position instead of by rank value.
  // MUTATION GUARD: PH1D-MUTANT-ZERO-WIDTH-ACCEPTED turns RED at
  // "PH1D-COLUMN-FORMULA: a zero width ..." if only negative widths are
  // refused.
  const gapped = ph1View._compactGeometry([
    { card: 'GA-ML1 Step 1', rank: 0, row: 0 }, { card: 'GA-ML4 Step 4', rank: 3, row: 0 },
  ], [0, 3], 390);
  assert(gapped.colW === 140 && gapped.canvasWidth === 294
    && JSON.stringify(gapped.positions.get('GA-ML1 Step 1')) === JSON.stringify({ x: 2, y: 2, w: 140, h: 26 })
    && JSON.stringify(gapped.positions.get('GA-ML4 Step 4')) === JSON.stringify({ x: 152, y: 2, w: 140, h: 26 }),
  'PH1D-COLUMN-FORMULA: ranks 0 and 3 at W=390 draw as two 140px columns at left 2 and 152 on a 294px canvas');
  for (const width of [0, -5]) {
    assert.throws(() => ph1View._compactGeometry(ph1Nodes(2), ph1Ranks(2), width), /positive width/,
      `PH1D-COLUMN-FORMULA: a ${width === 0 ? 'zero' : 'negative'} width is refused`);
  }

  // ---- PH1D-GEOMETRY-RANKS ----
  // The ranks argument decides the columns and their order. Nodes at ranks 0
  // and 2 over the ranks [0, 1, 2] at W=390 draw three columns,
  // colW = floor((390 - 4 - 2*10) / 3) = 122, the rank-2 node at left
  // 2 + 2*(122 + 10) = 266. Nodes at ranks 2 and 0 with no ranks argument
  // take their columns in ascending rank order: rank 0 at left 2, rank 2 at
  // left 152 (two 140px columns). No nodes and no ranks lay out one empty
  // 140px column on a 144 x 4 canvas; no nodes over five ranks give 69px
  // columns and shorten no id. A compact map whose node list names rank 1
  // before rank 0 draws rank 0 at left 2 and rank 1 at left 152.
  // MUTATION GUARD: PH1D-MUTANT-RANKS-ARGUMENT-IGNORED turns RED at
  // "PH1D-GEOMETRY-RANKS: nodes at ranks 0 and 2 over the ranks [0, 1, 2] ..."
  // if the columns come from the node ranks instead of the ranks argument.
  // MUTATION GUARD: PH1D-MUTANT-DERIVED-RANKS-DESCENDING turns RED at
  // "PH1D-GEOMETRY-RANKS: nodes at ranks 2 and 0 with no ranks argument ..."
  // if ranks derived from the nodes sort descending.
  // MUTATION GUARD: PH1D-MUTANT-ZERO-RANKS turns RED at "PH1D-GEOMETRY-RANKS:
  // no nodes and no ranks ..." if the column count can be zero.
  // MUTATION GUARD: PH1D-MUTANT-EMPTY-SET-SHARES-PREFIX turns RED at
  // "PH1D-GEOMETRY-RANKS: no nodes over five ranks ..." if an empty id set
  // counts as sharing a prefix.
  // MUTATION GUARD: PH1D-MUTANT-COMPACT-RANKS-UNSORTED turns RED at
  // "PH1D-GEOMETRY-RANKS: a compact map whose node list names rank 1 before
  // rank 0 ..." if _renderCompactGraph passes its ranks in node order.
  {
    const listed = ph1View._compactGeometry([
      { card: 'GA-ML1 Step 1', rank: 0, row: 0 }, { card: 'GA-ML3 Step 3', rank: 2, row: 0 },
    ], [0, 1, 2], 390);
    assert(listed.ranks === 3 && listed.colW === 122 && listed.canvasWidth === 390
      && JSON.stringify(listed.positions.get('GA-ML1 Step 1')) === JSON.stringify({ x: 2, y: 2, w: 122, h: 26 })
      && JSON.stringify(listed.positions.get('GA-ML3 Step 3')) === JSON.stringify({ x: 266, y: 2, w: 122, h: 26 }),
    'PH1D-GEOMETRY-RANKS: nodes at ranks 0 and 2 over the ranks [0, 1, 2] at W=390 draw three 122px columns, the rank-2 node at left 266 on a 390px canvas');
    const derived = ph1View._compactGeometry([
      { card: 'GA-ML3 Step 3', rank: 2, row: 0 }, { card: 'GA-ML1 Step 1', rank: 0, row: 0 },
    ], undefined, 390);
    assert(derived.ranks === 2 && derived.colW === 140
      && derived.positions.get('GA-ML1 Step 1')?.x === 2 && derived.positions.get('GA-ML3 Step 3')?.x === 152,
    'PH1D-GEOMETRY-RANKS: nodes at ranks 2 and 0 with no ranks argument draw rank 0 at left 2 and rank 2 at left 152');
    const empty = ph1View._compactGeometry([], [], 390);
    assert(empty.ranks === 1 && empty.colW === 140 && empty.canvasWidth === 144 && empty.canvasHeight === 4
      && empty.scrolls === false && empty.positions.size === 0 && empty.labels.size === 0 && empty.shortIds === false,
    'PH1D-GEOMETRY-RANKS: no nodes and no ranks at W=390 lay out one empty 140px column on a 144 x 4 canvas that does not scroll');
    const emptyNarrow = ph1View._compactGeometry([], ph1Ranks(5), 390);
    assert(emptyNarrow.colW === 69 && emptyNarrow.labels.size === 0 && emptyNarrow.shortIds === false,
      'PH1D-GEOMETRY-RANKS: no nodes over five ranks at W=390 give 69px columns and shorten no id');
    const rankOrdered = element();
    await ph1View._renderCompactGraph(rankOrdered, { nodes: [
      { card: 'GA-ML2 Step 2', path: `${board}/GA-ML2 Step 2.md`, status: 'planning', rank: 1, row: 0 },
      { card: 'GA-ML1 Step 1', path: `${board}/GA-ML1 Step 1.md`, status: 'planning', rank: 0, row: 0 },
    ], edges: [] }, lifecycleApi, epicPath, [], 390);
    const rankOrderedLeft = (id) => cssEffective(byClass(rankOrdered, 'graph-view-pill')
      .find((pill) => byClass(pill, 'graph-view-pill-id')[0]?.textContent === id)?.style.cssText).left;
    assert(rankOrderedLeft('GA-ML1') === '2px' && rankOrderedLeft('GA-ML2') === '152px',
      'PH1D-GEOMETRY-RANKS: a compact map whose node list names rank 1 before rank 0 draws rank 0 at left 2 and rank 1 at left 152');
  }

  // PH1C-FALLBACK-DOCUMENTED — 12 chained slices through the full render()
  // path at 390: 40px pills, a 594px canvas inside the map scroller, no
  // warning.
  const savedAppPH1 = global.app;
  const savedCustomJSPH1 = global.customJS;
  const chainSlices = Array.from({ length: 12 }, (_, index) => ({
    card: `GA-ML${index + 1} Step ${index + 1}`, status: 'planning',
    depends_on: index ? [`[[GA-ML${index} Step ${index}]]`] : [],
  }));
  const chainEnv = epicEnv({
    dir: 'spice/projects/phone/tasks/Chain Epic', name: 'Chain Epic',
    slices: chainSlices, laneOrder: chainSlices.map((slice) => slice.card),
  });
  global.app = chainEnv.app;
  global.customJS = {
    RenderSafe: { page: () => chainEnv.page },
    GraphLayout: new GraphLayout(),
    GraphInsights: new GraphInsights(),
    EpicDashboard: new EpicDashboard({ lifecycleApi }),
    SectionLabel: sectionLabel,
    Coordinator: coordinatorSentinel,
    DeliveryCoordinator: coordinatorSentinel,
  };
  const chainContainer = element();
  await new GraphView().render({ container: chainContainer }, { containerWidth: 390 });
  const chainRoot = chainContainer.children[0];
  const chainPills = byClass(chainRoot, 'graph-view-pill');
  assert.strictEqual(chainPills.length, 12, 'PH1C-FALLBACK-DOCUMENTED: 12 ranks render 12 pills');
  const chainColW = compactColW(12, 390);
  assert.strictEqual(chainColW, 40, 'PH1C-FALLBACK-DOCUMENTED: the replica formula floors 12 ranks at 40px');
  assert(chainPills.every((pill) => pill.style.cssText.includes(`width:${chainColW}px;height:${PH1.pillH}px;`)),
    'PH1C-FALLBACK-DOCUMENTED: 12 ranks at 390 render 40px pills');
  const chainNatural = compactNatural(12, chainColW);
  const chainCanvas = byClass(chainRoot, 'graph-view-compact-canvas')[0];
  assert(chainNatural === 594 && chainCanvas.style.cssText.includes(`width:${chainNatural}px;`),
    'PH1C-FALLBACK-DOCUMENTED: the canvas is wider than 390 (594px)');
  // PH1D-PILL-PRESENTATION (PH1C-SVG-SIZED-TO-CANVAS): the edge layer spans
  // the canvas, not the container. A map whose canvas equals W cannot tell
  // the two apart (3 ranks at 390 give a 390px canvas), so the width is
  // pinned here on the scrolling map, where the canvas is 594 and W is 390.
  // MUTATION GUARD: PH1D-MUTANT-SVG-SIZED-TO-W turns RED here if the compact
  // edge SVG is sized to W instead of to the canvas.
  const chainCanvasHeight = 2 * PH1.pad + PH1.pillH;
  assert(byClass(chainRoot, 'graph-view-edges')[0]?.innerHTML
    .startsWith(`<svg width="${chainNatural}" height="${chainCanvasHeight}" viewBox="0 0 ${chainNatural} ${chainCanvasHeight}"`),
  'PH1D-PILL-PRESENTATION (PH1C-SVG-SIZED-TO-CANVAS): on the 12-rank scrolling map the edge SVG is exactly the 594px canvas width, not W=390');
  const chainScroller = byClass(chainRoot, 'graph-view-compact-scroll')[0];
  assert(chainScroller && chainScroller.style.cssText.includes('overflow-x:auto')
    && chainScroller.style.cssText.includes('max-width:100%'),
  'PH1C-FALLBACK-DOCUMENTED: the map scroller carries overflow-x:auto and max-width:100%');
  // PH1D-COMPACT-HOST-GRID (C12): the graph root is a grid container and the
  // compact host is its grid item with min-width:0 and max-width:100%; the
  // host's scroller carries overflow-x:auto and max-width:100% over the 594px
  // canvas. Checked on the effective declarations (a later duplicate would
  // win).
  // MUTATION GUARD: PH1D-MUTANT-HOST-NO-MIN-WIDTH (C12) turns RED here if the
  // compact host loses min-width:0.
  const chainHost = byClass(chainRoot, 'graph-view-compact')[0];
  const chainRootCss = cssEffective(chainRoot.style.cssText);
  const chainHostCss = cssEffective(chainHost?.style.cssText);
  const chainScrollerCss = cssEffective(chainScroller?.style.cssText);
  const chainCanvasCss = cssEffective(chainCanvas?.style.cssText);
  assert(chainRootCss.display === 'grid' && chainHost?.parent === chainRoot
    && chainHostCss.display === 'grid' && chainHostCss['min-width'] === '0' && chainHostCss['max-width'] === '100%'
    && chainScroller?.parent === chainHost && chainScrollerCss['overflow-x'] === 'auto' && chainScrollerCss['max-width'] === '100%'
    && chainCanvas?.parent === chainScroller && chainCanvasCss.position === 'relative' && chainCanvasCss.width === '594px',
  'PH1D-COMPACT-HOST-GRID (C12): the compact host is a grid item of the grid root with min-width:0 and max-width:100%, and its overflow-x:auto scroller holds the 594px canvas');
  assert.strictEqual(byClass(chainRoot, 'graph-view-warnings').length + byClass(chainRoot, 'graph-view-warning').length, 0,
    'PH1C-FALLBACK-DOCUMENTED: the fallback renders zero warning rows');
  const chainPillFor = (label) => chainPills.find((pill) => byClass(pill, 'graph-view-pill-id')[0]?.textContent === label);
  for (let index = 0; index < 12; index += 1) {
    const pos = compactPos(index, 0, chainColW);
    assert(chainPillFor(`ML${index + 1}`)?.style.cssText.includes(`left:${pos.x}px;top:${pos.y}px;`),
      `PH1C-FALLBACK-DOCUMENTED: ML${index + 1} sits in rank ${index} at left:${pos.x}px`);
  }
  const chainDepends = svgPaths(chainRoot, 'edge-depends');
  assert.strictEqual(chainDepends.length, 11, 'PH1C-FALLBACK-DOCUMENTED: every chain dependency edge renders');
  for (let index = 1; index < 12; index += 1) {
    const d = compactEdgeD(compactPos(index - 1, 0, chainColW), compactPos(index, 0, chainColW));
    assert(chainDepends.some((chunk) => dOf(chunk) === d),
      `PH1C-FALLBACK-DOCUMENTED: edge ML${index} -> ML${index + 1} runs pill right-edge to pill left-edge (${d})`);
  }
  assert.deepStrictEqual(chainEnv.mutations, [], 'PH1C-FALLBACK-DOCUMENTED: the fallback render is write-free');

  // ---- PH1D-RESOLVED-WIDTH-BOUND (F10, F12) ----
  // The width render() resolves is the width the compact map is drawn at.
  // render() runs over chained slices at a measured 500, a measured 590, and
  // an override of 430 over a measured 900 pane; the expected colW, lefts,
  // and canvas widths are literals from the card formula
  // colW = floor((W - 4 - (R-1)*10) / R), left = 2 + r*(colW + 10),
  // canvas = R*colW + (R-1)*10 + 4:
  //   measured 500, 4 ranks: colW 116, lefts 2 128 254 380, canvas 498
  //   measured 590, 5 ranks: colW 109, lefts 2 121 240 359 478, canvas 589
  //   override 430, 3 ranks: colW 135, lefts 2 147 292, canvas 429
  // One row, so the canvas is 2 + 26 + 2 = 30 tall and each depends edge runs
  // at mid-height (15) from a pill's right edge to the next pill's left edge,
  // bending by max(24, gap/2) = 24: M x1 15 C x1+24 15, x2-24 15, x2 15.
  // MUTATION GUARD: PH1D-MUTANT-COMPACT-WIDTH-390 (F10) turns RED at
  // "PH1D-RESOLVED-WIDTH-BOUND (F10, F12): measured 500, 4 ranks ..." if
  // render() draws every compact map at a constant 390.
  // MUTATION GUARD: PH1D-MUTANT-COMPACT-WIDTH-CAPPED (F12) turns RED at
  // "PH1D-RESOLVED-WIDTH-BOUND (F10, F12): measured 590, 5 ranks ..." if
  // render() hands the compact map Math.min(width, 500).
  for (const [label, clientWidth, overrides, R, colW, lefts, canvasWidth] of [
    ['measured 500, 4 ranks', 500, undefined, 4, 116, [2, 128, 254, 380], 498],
    ['measured 590, 5 ranks', 590, undefined, 5, 109, [2, 121, 240, 359, 478], 589],
    ['override 430 over a measured 900 pane, 3 ranks', 900, { containerWidth: 430 }, 3, 135, [2, 147, 292], 429],
  ]) {
    const widthSlices = Array.from({ length: R }, (_, index) => ({
      card: `GA-W${index + 1} Width ${index + 1}`, status: 'planning',
      depends_on: index ? [`[[GA-W${index} Width ${index}]]`] : [],
    }));
    const widthEnv = epicEnv({
      dir: `spice/projects/phone/tasks/Width Epic ${R}`, name: `Width Epic ${R}`,
      slices: widthSlices, laneOrder: widthSlices.map((slice) => slice.card),
    });
    global.app = widthEnv.app;
    global.customJS = {
      RenderSafe: { page: () => widthEnv.page },
      GraphLayout: new GraphLayout(),
      GraphInsights: new GraphInsights(),
      EpicDashboard: new EpicDashboard({ lifecycleApi }),
      SectionLabel: sectionLabel,
      Coordinator: coordinatorSentinel,
      DeliveryCoordinator: coordinatorSentinel,
    };
    const widthContainer = element();
    widthContainer.clientWidth = clientWidth;
    await new GraphView().render({ container: widthContainer }, overrides);
    const widthRoot = widthContainer.children[0];
    const widthPillFor = (id) => byClass(widthRoot, 'graph-view-pill')
      .find((pill) => byClass(pill, 'graph-view-pill-id')[0]?.textContent === id);
    const widthCanvas = byClass(widthRoot, 'graph-view-compact-canvas')[0];
    assert(byClass(widthRoot, 'graph-view-pill').length === R
      && lefts.every((x, index) => widthPillFor(`GA-W${index + 1}`)?.style.cssText.includes(`left:${x}px;top:2px;width:${colW}px;height:26px;`))
      && widthCanvas?.style.cssText.includes(`width:${canvasWidth}px;height:30px;`),
    `PH1D-RESOLVED-WIDTH-BOUND (F10, F12): ${label} draws ${colW}px pills at left ${lefts.join(' ')} on a ${canvasWidth}px canvas`);
    const expectedEdges = lefts.slice(1).map((x2, index) => {
      const x1 = lefts[index] + colW;
      return `M ${x1} 15 C ${x1 + 24} 15, ${x2 - 24} 15, ${x2} 15`;
    });
    assert(byClass(widthRoot, 'graph-view-edges')[0]?.innerHTML.startsWith(`<svg width="${canvasWidth}" height="30" viewBox="0 0 ${canvasWidth} 30"`)
      && JSON.stringify(svgPaths(widthRoot, 'edge-depends').map(dOf).sort()) === JSON.stringify(expectedEdges.sort()),
    `PH1D-RESOLVED-WIDTH-BOUND (F10, F12): ${label} sizes the edge SVG to ${canvasWidth}x30 and runs every depends edge between those pills`);
    assert(byClass(widthRoot, 'graph-view-warning').length === 0 && widthEnv.mutations.length === 0,
      `PH1D-RESOLVED-WIDTH-BOUND (F10, F12): ${label} renders no warning row and writes nothing`);
  }
  // ---- PH1D-HANDOFF-BOUNDARY ----
  // Each row renders chained slices GA-H1 ... GA-H<R> through render() at a
  // width on a floor boundary of the card formula
  // colW = clamp(floor((W - 4 - (R-1)*10) / R), 40, 140),
  // left = 2 + r*(colW + 10), canvas = R*colW + (R-1)*10 + 4, and checks the
  // drawn pills, canvas, and scroller padding against it; ids shorten
  // (GA-H1 -> H1) when colW < 72, and the compact scroller's padding-bottom
  // is 14px when R*40 + (R-1)*10 + 4 > W, else 0px:
  //   measured 404, 5 ranks: colW 72, lefts 2 84 166 248 330, full ids, canvas 404, padding 0
  //   measured 403, 5 ranks: colW 71, lefts 2 83 164 245 326, short ids, canvas 399, padding 0
  //   measured 399, 5 ranks: colW 71, lefts 2 83 164 245 326, short ids, canvas 399, padding 0
  //   measured 599, 5 ranks: colW 111, lefts 2 123 244 365 486, full ids, canvas 599, padding 0
  //   measured 394, 8 ranks: colW 40, lefts 2 52 102 152 202 252 302 352, short ids, canvas 394, padding 0
  //   measured 393, 8 ranks: colW 40, lefts as at 394, short ids, canvas 394, padding 14
  //   override 394 over a measured 900 pane, 8 ranks: as measured 394
  //   override 393 over a measured 900 pane, 8 ranks: as measured 393
  //   override 0.5 over a measured 900 pane, 5 ranks: colW 40, lefts 2 52 102 152 202, short ids, canvas 244, padding 14
  // Every pill is top 2, height 26, and the canvas is 30 tall. A measured
  // 600 pane draws the five wide chips and no compact map.
  // MUTATION GUARD: PH1D-MUTANT-HANDOFF-MINUS-ONE turns RED at
  // "PH1D-HANDOFF-BOUNDARY: measured 404, 5 ranks ..." if render() hands the
  // compact map resolved.width - 1.
  // MUTATION GUARD: PH1D-MUTANT-HANDOFF-PLUS-ONE turns RED at
  // "PH1D-HANDOFF-BOUNDARY: measured 403, 5 ranks ..." if render() hands the
  // compact map resolved.width + 1.
  // MUTATION GUARD: PH1D-MUTANT-HANDOFF-EVEN turns RED at
  // "PH1D-HANDOFF-BOUNDARY: measured 399, 5 ranks ..." if render() hands the
  // compact map resolved.width rounded down to an even number.
  // MUTATION GUARD: PH1D-MUTANT-HANDOFF-FLOOR turns RED at
  // "PH1D-HANDOFF-BOUNDARY: override 0.5 over a measured 900 pane ..." if
  // render() hands the compact map Math.floor(resolved.width).
  const ph1dChainEnv = (R) => {
    const slices = Array.from({ length: R }, (_, index) => ({
      card: `GA-H${index + 1} Handoff ${index + 1}`, status: 'planning',
      depends_on: index ? [`[[GA-H${index} Handoff ${index}]]`] : [],
    }));
    return epicEnv({
      dir: `spice/projects/phone/tasks/Handoff Epic ${R}`, name: `Handoff Epic ${R}`,
      slices, laneOrder: slices.map((slice) => slice.card),
    });
  };
  const ph1dUseEnv = (env) => {
    global.app = env.app;
    global.customJS = {
      RenderSafe: { page: () => env.page },
      GraphLayout: new GraphLayout(),
      GraphInsights: new GraphInsights(),
      EpicDashboard: new EpicDashboard({ lifecycleApi }),
      SectionLabel: sectionLabel,
      Coordinator: coordinatorSentinel,
      DeliveryCoordinator: coordinatorSentinel,
    };
  };
  // The drawn compact map as literals: each pill's id text, left, top,
  // width, and height (in left order), the canvas cssText, and the compact
  // scroller's padding-bottom.
  const ph1dCompactDrawing = (root) => ({
    pills: byClass(root, 'graph-view-pill').map((pill) => {
      const css = cssEffective(pill.style.cssText);
      return [byClass(pill, 'graph-view-pill-id')[0]?.textContent, css.left, css.top, css.width, css.height];
    }).sort((left, right) => parseFloat(left[1]) - parseFloat(right[1])),
    canvas: byClass(root, 'graph-view-compact-canvas')[0]?.style.cssText,
    padding: cssEffective(byClass(root, 'graph-view-compact-scroll')[0]?.style.cssText)['padding-bottom'],
  });
  const ph1dExpectedDrawing = (colW, lefts, ids, canvasWidth, padding) => ({
    pills: lefts.map((x, index) => [ids === 'short' ? `H${index + 1}` : `GA-H${index + 1}`, `${x}px`, '2px', `${colW}px`, '26px']),
    canvas: `position:relative;width:${canvasWidth}px;height:30px;`,
    padding: `${padding}px`,
  });
  const ph1dLefts5At72 = [2, 84, 166, 248, 330];
  const ph1dLefts5At71 = [2, 83, 164, 245, 326];
  const ph1dLefts8 = [2, 52, 102, 152, 202, 252, 302, 352];
  for (const [label, clientWidth, overrides, R, colW, lefts, ids, canvasWidth, padding] of [
    ['measured 404, 5 ranks', 404, undefined, 5, 72, ph1dLefts5At72, 'full', 404, 0],
    ['measured 403, 5 ranks', 403, undefined, 5, 71, ph1dLefts5At71, 'short', 399, 0],
    ['measured 399, 5 ranks', 399, undefined, 5, 71, ph1dLefts5At71, 'short', 399, 0],
    ['measured 599, 5 ranks', 599, undefined, 5, 111, [2, 123, 244, 365, 486], 'full', 599, 0],
    ['measured 394, 8 ranks', 394, undefined, 8, 40, ph1dLefts8, 'short', 394, 0],
    ['measured 393, 8 ranks', 393, undefined, 8, 40, ph1dLefts8, 'short', 394, 14],
    ['override 394 over a measured 900 pane, 8 ranks', 900, { containerWidth: 394 }, 8, 40, ph1dLefts8, 'short', 394, 0],
    ['override 393 over a measured 900 pane, 8 ranks', 900, { containerWidth: 393 }, 8, 40, ph1dLefts8, 'short', 394, 14],
    ['override 0.5 over a measured 900 pane, 5 ranks', 900, { containerWidth: 0.5 }, 5, 40, [2, 52, 102, 152, 202], 'short', 244, 14],
  ]) {
    ph1dUseEnv(ph1dChainEnv(R));
    const container = element();
    container.clientWidth = clientWidth;
    await new GraphView().render({ container }, overrides);
    assert.deepStrictEqual(ph1dCompactDrawing(container.children[0]), ph1dExpectedDrawing(colW, lefts, ids, canvasWidth, padding),
      `PH1D-HANDOFF-BOUNDARY: ${label} draws ${colW}px pills with ${ids} ids on a ${canvasWidth}px canvas and a ${padding}px scroller padding-bottom`);
  }
  {
    ph1dUseEnv(ph1dChainEnv(5));
    const container = element();
    container.clientWidth = 600;
    await new GraphView().render({ container });
    const root = container.children[0];
    assert(byClass(root, 'graph-view-compact').length === 0 && byClass(root, 'graph-view-pill').length === 0
      && byClass(root, 'graph-view-chip').length === 5 && byClass(root, 'graph-view-scroll').length === 1,
    'PH1D-HANDOFF-BOUNDARY: measured 600, 5 ranks draws the five wide chips in the wide scroller and no compact map');
  }
  // ---- PH1D-FRACTIONAL-WIDTH ----
  // Fractional widths, laid out directly by _compactGeometry and drawn by
  // render() from an override and from a measurement. Literals from the card
  // formula colW = clamp(floor((W - 4 - (R-1)*10) / R), 40, 140),
  // left = 2 + r*(colW + 10), canvas = R*colW + (R-1)*10 + 4, and a 14px
  // scroller padding-bottom when R*40 + (R-1)*10 + 4 > W, else 0px:
  //   403.5, 5 ranks: floor(359.5 / 5) = 71, short ids, canvas 399, no scroll, padding 0
  //   393.5, 8 ranks: floor(319.5 / 8) = 39, clamped to 40, short ids, canvas 394,
  //     394 > 393.5 so the map scrolls, padding 14
  //   0.5, 5 ranks: clamped to 40, short ids, canvas 244, scrolls, padding 14
  // MUTATION GUARD: PH1D-MUTANT-GEOMETRY-WIDTH-ROUNDED turns RED at
  // "PH1D-FRACTIONAL-WIDTH: _compactGeometry at W=403.5 with 5 ranks ..." if
  // _compactGeometry takes Math.round(width) as W.
  // MUTATION GUARD: PH1D-MUTANT-GEOMETRY-WIDTH-CEIL turns RED at the same label
  // if _compactGeometry takes Math.ceil(width) as W.
  // MUTATION GUARD: PH1D-MUTANT-COLUMN-NUMERATOR-ROUNDED turns RED at the same
  // label if the colW numerator uses Math.round(W).
  // MUTATION GUARD: PH1D-MUTANT-COLUMN-NUMERATOR-CEIL turns RED at the same
  // label if the colW numerator uses Math.ceil(W).
  // MUTATION GUARD: PH1D-MUTANT-SCROLL-TEST-ROUNDED turns RED at
  // "PH1D-FRACTIONAL-WIDTH: _compactGeometry at W=393.5 with 8 ranks ..." if
  // the scroll test compares against Math.round(W).
  // MUTATION GUARD: PH1D-MUTANT-SCROLL-TEST-CEIL turns RED at the same label if
  // the scroll test compares against Math.ceil(W).
  // MUTATION GUARD: PH1D-MUTANT-HANDOFF-ROUNDED turns RED at
  // "PH1D-FRACTIONAL-WIDTH: override 403.5 over a measured 900 pane, 5 ranks
  // ..." if render() hands the compact map Math.round(resolved.width).
  // MUTATION GUARD: PH1D-MUTANT-HANDOFF-CEIL turns RED at the same label if
  // render() hands the compact map Math.ceil(resolved.width).
  // ph1dLayOut returns what _compactGeometry returns, or { error } when it
  // throws, so the assertion that reads it fails under its own label.
  const ph1dLayOut = (nodes, ranks, width) => {
    try { return ph1View._compactGeometry(nodes, ranks, width); } catch (error) { return { error: String(error?.message || error) }; }
  };
  for (const [W, R, colW, lefts, canvasWidth, scrolls, allowance] of [
    [403.5, 5, 71, ph1dLefts5At71, 399, false, 0],
    [393.5, 8, 40, ph1dLefts8, 394, true, 14],
  ]) {
    const geometry = ph1dLayOut(ph1Nodes(R), ph1Ranks(R), W);
    assert.deepStrictEqual({
      width: geometry.width, colW: geometry.colW, shortIds: geometry.shortIds, labels: geometry.labels ? [...geometry.labels.values()] : null,
      lefts: ph1Ranks(R).map((index) => geometry.positions?.get(`GA-ML${index + 1} Step ${index + 1}`)?.x),
      canvasWidth: geometry.canvasWidth, scrolls: geometry.scrolls, scrollbarAllowance: geometry.scrollbarAllowance,
    }, {
      width: W, colW, shortIds: true, labels: ph1Ranks(R).map((index) => `ML${index + 1}`),
      lefts, canvasWidth, scrolls, scrollbarAllowance: allowance,
    }, `PH1D-FRACTIONAL-WIDTH: _compactGeometry at W=${W} with ${R} ranks keeps width ${W} and gives colW ${colW}, short ids, lefts ${lefts.join(' ')}, a ${canvasWidth}px canvas, scrolls: ${scrolls}, and a ${allowance}px scrollbar allowance`);
  }
  for (const [label, clientWidth, overrides, R, colW, lefts, canvasWidth, padding] of [
    ['override 403.5 over a measured 900 pane, 5 ranks', 900, { containerWidth: 403.5 }, 5, 71, ph1dLefts5At71, 399, 0],
    ['measured 403.5, 5 ranks', 403.5, undefined, 5, 71, ph1dLefts5At71, 399, 0],
    ['override 393.5 over a measured 900 pane, 8 ranks', 900, { containerWidth: 393.5 }, 8, 40, ph1dLefts8, 394, 14],
    ['measured 393.5, 8 ranks', 393.5, undefined, 8, 40, ph1dLefts8, 394, 14],
    ['measured 0.5, 5 ranks', 0.5, undefined, 5, 40, [2, 52, 102, 152, 202], 244, 14],
  ]) {
    ph1dUseEnv(ph1dChainEnv(R));
    const container = element();
    container.clientWidth = clientWidth;
    await new GraphView().render({ container }, overrides);
    assert.deepStrictEqual(ph1dCompactDrawing(container.children[0]), ph1dExpectedDrawing(colW, lefts, 'short', canvasWidth, padding),
      `PH1D-FRACTIONAL-WIDTH: ${label} draws ${colW}px pills with short ids at left ${lefts.join(' ')} on a ${canvasWidth}px canvas and a ${padding}px scroller padding-bottom`);
  }

  // ---- PH1D-MANY-RANKS ----
  // 13 chained slices GA-H1 ... GA-H13 drawn by render() at an override of
  // 390: colW = clamp(floor((390 - 4 - 120) / 13), 40, 140) = 40, short ids
  // at left 2 + 50r for r = 0 ... 12, a 13*40 + 12*10 + 4 = 644px canvas and
  // edge SVG, 30px tall, and a 14px scroller padding-bottom (644 > 390).
  // Each depends edge runs at y 15 from a pill's right edge to the next
  // pill's left edge.
  // MUTATION GUARD: PH1D-MUTANT-RANK-CAP-12 turns RED at "PH1D-MANY-RANKS: 13
  // chained slices at an override of 390 ..." if _compactGeometry counts at
  // most 12 ranks.
  {
    const lefts13 = Array.from({ length: 13 }, (_, index) => 2 + 50 * index);
    ph1dUseEnv(ph1dChainEnv(13));
    const container = element();
    await new GraphView().render({ container }, { containerWidth: 390 });
    const root = container.children[0];
    assert.deepStrictEqual(ph1dCompactDrawing(root), ph1dExpectedDrawing(40, lefts13, 'short', 644, 14),
      'PH1D-MANY-RANKS: 13 chained slices at an override of 390 draw 40px pills with short ids at left 2, 52, ... 602 on a 644px canvas and a 14px scroller padding-bottom');
    const expectedEdges = lefts13.slice(1).map((x2, index) => `M ${lefts13[index] + 40} 15 C ${lefts13[index] + 64} 15, ${x2 - 24} 15, ${x2} 15`);
    assert(byClass(root, 'graph-view-edges')[0]?.innerHTML.startsWith('<svg width="644" height="30" viewBox="0 0 644 30"')
      && JSON.stringify(svgPaths(root, 'edge-depends').map(dOf).sort()) === JSON.stringify(expectedEdges.sort()),
    'PH1D-MANY-RANKS: the 13-rank edge SVG is 644 x 30 and runs each of the 12 depends edges between adjacent pills');
  }
  // _compactGeometry over 1 to 16 ranks and 24 ranks, at widths from 0.5 to
  // 10000, against compactColW and compactNatural (the card formula above):
  // the width it keeps, colW, every column's left, the canvas width, the
  // scroll flag (R*40 + (R-1)*10 + 4 > W), and the scrollbar allowance.
  // Spot values: 16 ranks at 390 give a 794px canvas; 16 ranks at 10000
  // give 140px columns on a 2394px canvas that does not scroll.
  {
    const rankCounts = [...Array.from({ length: 16 }, (_, index) => index + 1), 24];
    for (const W of [0.5, 390, 393.5, 403.5, 599.5, 10000]) {
      const laidOut = rankCounts.map((R) => {
        const geometry = ph1dLayOut(ph1Nodes(R), ph1Ranks(R), W);
        return [R, geometry.width, geometry.colW, ph1Ranks(R).map((index) => geometry.positions?.get(`GA-ML${index + 1} Step ${index + 1}`)?.x),
          geometry.canvasWidth, geometry.scrolls, geometry.scrollbarAllowance];
      });
      const expected = rankCounts.map((R) => {
        const colW = compactColW(R, W);
        const scrolls = compactNatural(R, PH1.minCol) > W;
        return [R, W, colW, ph1Ranks(R).map((index) => PH1.pad + index * (colW + PH1.gap)), compactNatural(R, colW), scrolls, scrolls ? 14 : 0];
      });
      assert.deepStrictEqual(laidOut, expected,
        `PH1D-MANY-RANKS: _compactGeometry at W=${W} over 1 to 16 and 24 ranks keeps the width and gives the card formula's colW, column lefts, canvas width, scroll flag, and scrollbar allowance`);
    }
    const sixteenNarrow = ph1dLayOut(ph1Nodes(16), ph1Ranks(16), 390);
    const sixteenWide = ph1dLayOut(ph1Nodes(16), ph1Ranks(16), 10000);
    assert(sixteenNarrow.colW === 40 && sixteenNarrow.canvasWidth === 794 && sixteenNarrow.scrolls === true
      && sixteenWide.colW === 140 && sixteenWide.canvasWidth === 2394 && sixteenWide.scrolls === false,
    'PH1D-MANY-RANKS: 16 ranks give 40px columns on a 794px scrolling canvas at W=390 and 140px columns on a 2394px canvas that does not scroll at W=10000');
  }

  // ---- PH1D-MULTI-ROW ----
  // Row geometry from the card formula (pad 2, pill height 26, row gap 8):
  // row r sits at top 2 + 34r (2, 36, 70, 104, 138) and n rows make a
  // canvas 4 + 26n + 8(n-1) tall (30, 64, 98, 132, 166 for n = 1 ... 5).
  // render() at an override of 390 over GA-R1 ... GA-R6 in lane order, where
  // GA-R5 depends on GA-R3 and GA-R6 on GA-R4: rank 0 holds GA-R1 ... GA-R4
  // in rows 0 ... 3 and rank 1 holds GA-R5 and GA-R6 in rows 0 and 1, as
  // 140px pills (colW = min(140, floor((390 - 14) / 2))) at left 2 and 152,
  // on a 294 x 132 canvas. The depends edges run from the rank-0 pill's
  // right edge (142) at its mid-height to the rank-1 pill's left edge (152)
  // at its mid-height, bending by 24: row 2 (y 83) to row 0 (y 15) and
  // row 3 (y 117) to row 1 (y 49). The order edges between lane neighbours
  // in one rank drop from a pill's bottom-centre to the next pill's top:
  // x 72 from 28 to 36, 62 to 70, and 96 to 104, and x 222 from 28 to 36.
  // MUTATION GUARD: PH1D-MUTANT-ROW-GAP-ONCE turns RED at "PH1D-MULTI-ROW: a
  // rank with 4 rows ..." if a pill's top adds the row gap once instead of
  // once per row above it.
  // MUTATION GUARD: PH1D-MUTANT-HEIGHT-ROW-GAP-ONCE turns RED at the same label
  // if the canvas height adds the row gap once instead of once per gap.
  // MUTATION GUARD: PH1D-MUTANT-ROW-COUNT-DISTINCT turns RED at
  // "PH1D-MULTI-ROW: _compactGeometry with pills in rows 0 and 3 only ..." if
  // the row count is the number of distinct rows instead of the highest row
  // plus one.
  {
    const rowSlices = [
      { card: 'GA-R1 Row 1', status: 'planning' }, { card: 'GA-R2 Row 2', status: 'planning' },
      { card: 'GA-R3 Row 3', status: 'planning' }, { card: 'GA-R4 Row 4', status: 'planning' },
      { card: 'GA-R5 Row 5', status: 'planning', depends_on: ['[[GA-R3 Row 3]]'] },
      { card: 'GA-R6 Row 6', status: 'planning', depends_on: ['[[GA-R4 Row 4]]'] },
    ];
    const rowEnv = epicEnv({
      dir: 'spice/projects/phone/tasks/Row Epic', name: 'Row Epic',
      slices: rowSlices, laneOrder: rowSlices.map((slice) => slice.card),
    });
    ph1dUseEnv(rowEnv);
    const container = element();
    await new GraphView().render({ container }, { containerWidth: 390 });
    const root = container.children[0];
    const drawing = ph1dCompactDrawing(root);
    assert.deepStrictEqual({ pills: drawing.pills, canvas: drawing.canvas }, {
      pills: [
        ['GA-R1', '2px', '2px', '140px', '26px'], ['GA-R2', '2px', '36px', '140px', '26px'],
        ['GA-R3', '2px', '70px', '140px', '26px'], ['GA-R4', '2px', '104px', '140px', '26px'],
        ['GA-R5', '152px', '2px', '140px', '26px'], ['GA-R6', '152px', '36px', '140px', '26px'],
      ],
      canvas: 'position:relative;width:294px;height:132px;',
    }, 'PH1D-MULTI-ROW: a rank with 4 rows at an override of 390 draws its pills at top 2, 36, 70, and 104, the next rank at top 2 and 36, on a 294 x 132 canvas');
    assert(byClass(root, 'graph-view-edges')[0]?.innerHTML.startsWith('<svg width="294" height="132" viewBox="0 0 294 132"')
      && JSON.stringify(svgPaths(root, 'edge-depends').map(dOf).sort()) === JSON.stringify([
        'M 142 83 C 166 83, 128 15, 152 15', 'M 142 117 C 166 117, 128 49, 152 49',
      ].sort())
      && JSON.stringify(svgPaths(root, 'edge-order').map(dOf).sort()) === JSON.stringify([
        'M 72 28 L 72 36', 'M 72 62 L 72 70', 'M 72 96 L 72 104', 'M 222 28 L 222 36',
      ].sort()),
    'PH1D-MULTI-ROW: the 294 x 132 edge SVG runs the depends edges from rows 2 and 3 at y 83 and 117 to rows 0 and 1 at y 15 and 49, and the order edges between rows 0-1, 1-2, and 2-3');
    const oneRank = (rows) => Array.from(rows, (row) => ({ card: `GA-ML${row + 1} Step ${row + 1}`, rank: 0, row }));
    const stacked = [1, 2, 3, 4, 5].map((count) => {
      const geometry = ph1dLayOut(oneRank(Array.from({ length: count }, (_, row) => row)), [0], 390);
      return [count, geometry.positions ? [...geometry.positions.values()].map((at) => at.y) : null, geometry.canvasHeight];
    });
    assert.deepStrictEqual(stacked, [
      [1, [2], 30], [2, [2, 36], 64], [3, [2, 36, 70], 98], [4, [2, 36, 70, 104], 132], [5, [2, 36, 70, 104, 138], 166],
    ], 'PH1D-MULTI-ROW: _compactGeometry stacks 1 to 5 rows at top 2, 36, 70, 104, and 138 on canvases 30, 64, 98, 132, and 166 tall');
    const sparse = ph1dLayOut(oneRank([0, 3]), [0], 390);
    assert(JSON.stringify(sparse.positions ? [...sparse.positions.values()].map((at) => at.y) : null) === JSON.stringify([2, 104])
      && sparse.canvasHeight === 132,
    'PH1D-MULTI-ROW: _compactGeometry with pills in rows 0 and 3 only draws them at top 2 and 104 on a canvas 132 tall');
  }

  // ---- PH1D-STUB-ROWS ----
  // GA-T1 depends on GB-1 and GB-2, two slices on another epic's board, so
  // render() draws two cross-epic stubs in the column after GA-T1, in rows 0
  // and 1. At an override of 390 (two ranks, colW 140): GA-T1 at left 2,
  // top 2; GB-1 and GB-2 at left 152, top 2 and 36; a 294 x 64 canvas. Each
  // stub edge runs from the stub's right edge (292) at its mid-height (15,
  // 49) back to GA-T1's left edge (2) at 15, bending by 24.
  // MUTATION GUARD: PH1D-MUTANT-ROW-COUNT-WITHOUT-STUBS turns RED at
  // "PH1D-STUB-ROWS: two cross-epic stubs ..." if the row count skips stubs.
  // MUTATION GUARD: PH1D-MUTANT-STUBS-IN-ROW-0 turns RED at the same label if
  // every stub is drawn in row 0.
  {
    const stubEnv = epicEnv({
      dir: 'spice/projects/phone/tasks/Stub Epic', name: 'Stub Epic',
      slices: [{ card: 'GA-T1 Consumer', status: 'planning', depends_on: ['[[GB-1 Far One]]', '[[GB-2 Far Two]]'] }],
      laneOrder: ['GA-T1 Consumer'],
    });
    const farFiles = [
      file('spice/projects/phone/tasks/Far Epic/board/GB-1 Far One.md', 40),
      file('spice/projects/phone/tasks/Far Epic/board/GB-2 Far Two.md', 41),
    ];
    const ownFiles = stubEnv.app.vault.getMarkdownFiles;
    stubEnv.app.vault.getMarkdownFiles = () => [...ownFiles(), ...farFiles];
    const ownCache = stubEnv.app.metadataCache.getFileCache;
    stubEnv.app.metadataCache.getFileCache = (entry) => (farFiles.includes(entry)
      ? { frontmatter: { type: 'slice', status: 'planning', depends_on: [] } }
      : ownCache(entry));
    ph1dUseEnv(stubEnv);
    const container = element();
    await new GraphView().render({ container }, { containerWidth: 390 });
    const root = container.children[0];
    const drawing = ph1dCompactDrawing(root);
    assert.deepStrictEqual({ pills: drawing.pills, canvas: drawing.canvas, stubs: byClass(root, 'graph-view-stub').length }, {
      pills: [
        ['GA-T1', '2px', '2px', '140px', '26px'], ['GB-1', '152px', '2px', '140px', '26px'], ['GB-2', '152px', '36px', '140px', '26px'],
      ],
      canvas: 'position:relative;width:294px;height:64px;',
      stubs: 2,
    }, 'PH1D-STUB-ROWS: two cross-epic stubs at an override of 390 draw at left 152, top 2 and 36, beside GA-T1 at left 2, on a 294 x 64 canvas');
    assert(byClass(root, 'graph-view-edges')[0]?.innerHTML.startsWith('<svg width="294" height="64" viewBox="0 0 294 64"')
      && JSON.stringify(svgPaths(root, 'edge-depends').map(dOf).sort()) === JSON.stringify([
        'M 292 15 C 316 15, -22 15, 2 15', 'M 292 49 C 316 49, -22 15, 2 15',
      ].sort()),
    'PH1D-STUB-ROWS: the 294 x 64 edge SVG runs each stub edge from the stub\'s right edge at y 15 and 49 to GA-T1\'s left edge at y 15');
  }

  // ---- PH1D-EDGE-BEND ----
  // GA-S2 depends on GA-S1, and GA-S3 on GA-S2 and GA-S1. At an override of
  // 390 the three ranks are 122px columns (floor((390 - 24) / 3)) at left
  // 2, 134, and 266. Each depends edge bends by max(24, (x2 - x1) / 2): the
  // adjacent-rank edges span 10px and bend by 24; GA-S1 -> GA-S3 spans
  // 266 - 124 = 142px and bends by 71.
  // MUTATION GUARD: PH1D-MUTANT-BEND-THIRD-OF-SPAN turns RED at
  // "PH1D-EDGE-BEND: ..." if an edge bends by max(24, (x2 - x1) / 3).
  {
    const bendSlices = [
      { card: 'GA-S1 Bend 1', status: 'planning' },
      { card: 'GA-S2 Bend 2', status: 'planning', depends_on: ['[[GA-S1 Bend 1]]'] },
      { card: 'GA-S3 Bend 3', status: 'planning', depends_on: ['[[GA-S2 Bend 2]]', '[[GA-S1 Bend 1]]'] },
    ];
    ph1dUseEnv(epicEnv({
      dir: 'spice/projects/phone/tasks/Bend Epic', name: 'Bend Epic',
      slices: bendSlices, laneOrder: bendSlices.map((slice) => slice.card),
    }));
    const container = element();
    await new GraphView().render({ container }, { containerWidth: 390 });
    const root = container.children[0];
    assert(JSON.stringify(ph1dCompactDrawing(root).pills) === JSON.stringify([
      ['GA-S1', '2px', '2px', '122px', '26px'], ['GA-S2', '134px', '2px', '122px', '26px'], ['GA-S3', '266px', '2px', '122px', '26px'],
    ]) && JSON.stringify(svgPaths(root, 'edge-depends').map(dOf).sort()) === JSON.stringify([
      'M 124 15 C 148 15, 110 15, 134 15', 'M 256 15 C 280 15, 242 15, 266 15', 'M 124 15 C 195 15, 195 15, 266 15',
    ].sort()),
    'PH1D-EDGE-BEND: at an override of 390 the adjacent-rank edges bend by 24 and the GA-S1 -> GA-S3 edge, spanning 142px, bends by 71');
  }

  // ---- PH1D-VERY-WIDE ----
  // Widths of 10000 and 1000000 are honoured as they are: an override over a
  // measured 500 resolves as a wide override, a measurement on an is-mobile
  // body resolves as a wide measurement, and render() draws the five wide
  // chips of a chained epic with no compact map in both cases.
  // MUTATION GUARD: PH1D-MUTANT-VERY-WIDE-OVERRIDE-IGNORED turns RED at
  // "PH1D-VERY-WIDE: a 10000 containerWidth override ..." if an override of
  // 10000 or more is not an override.
  // MUTATION GUARD: PH1D-MUTANT-VERY-WIDE-MEASUREMENT-IGNORED turns RED at
  // "PH1D-VERY-WIDE: a 10000 clientWidth on an is-mobile body ..." if a
  // measurement of 10000 or more is not a measurement.
  for (const width of [10000, 1000000]) {
    assert.deepStrictEqual(resolve({ container: { clientWidth: 500 } }, { containerWidth: width }),
      { width, narrow: false, source: 'override' },
      `PH1D-VERY-WIDE: a ${width} containerWidth override over a measured 500 resolves as a wide override of ${width}`);
    ph1MobileClass = true;
    const measured = resolve({ container: { clientWidth: width } }, undefined);
    ph1MobileClass = false;
    assert.deepStrictEqual(measured, { width, narrow: false, source: 'measured' },
      `PH1D-VERY-WIDE: a ${width} clientWidth on an is-mobile body resolves as a wide measurement of ${width}`);
    for (const [label, clientWidth, overrides] of [
      [`an override of ${width} over a measured 500 pane`, 500, { containerWidth: width }],
      [`a measured ${width} pane on an is-mobile body`, width, undefined],
    ]) {
      ph1dUseEnv(ph1dChainEnv(5));
      const container = element();
      container.clientWidth = clientWidth;
      ph1MobileClass = overrides === undefined;
      await new GraphView().render({ container }, overrides);
      ph1MobileClass = false;
      const root = container.children[0];
      assert(byClass(root, 'graph-view-compact').length === 0 && byClass(root, 'graph-view-pill').length === 0
        && byClass(root, 'graph-view-chip').length === 5 && byClass(root, 'graph-view-scroll').length === 1,
      `PH1D-VERY-WIDE: ${label} draws the five wide chips in the wide scroller and no compact map`);
    }
  }

  // ---- PH1D-TINY-WIDTH ----
  // Number.MIN_VALUE (5e-324), the smallest positive number, and 1e-6 are
  // positive widths: an override over a measured 900 resolves as a narrow
  // override, a clientWidth resolves as a narrow measurement, and
  // _compactGeometry lays 5 ranks out as 40px columns on a 244px canvas that
  // scrolls with a 14px allowance, keeping the width it was given. render()
  // with the override draws those 40px pills with short ids.
  // MUTATION GUARD: PH1D-MUTANT-TINY-OVERRIDE-IGNORED turns RED at
  // "PH1D-TINY-WIDTH: a 5e-324 containerWidth override ..." if an override
  // must exceed 0.001.
  // MUTATION GUARD: PH1D-MUTANT-TINY-MEASUREMENT-IGNORED turns RED at
  // "PH1D-TINY-WIDTH: a 5e-324 clientWidth ..." if a measurement must exceed
  // 0.001.
  // MUTATION GUARD: PH1D-MUTANT-TINY-GEOMETRY-REFUSED turns RED at
  // "PH1D-TINY-WIDTH: _compactGeometry at W=5e-324 ..." if _compactGeometry
  // refuses a width below 0.001.
  // MUTATION GUARD: PH1D-MUTANT-TINY-GEOMETRY-RAISED turns RED at the same
  // label if _compactGeometry raises a positive width below 0.01 to 0.01.
  for (const width of [Number.MIN_VALUE, 1e-6]) {
    assert.deepStrictEqual(resolve({ container: { clientWidth: 900 } }, { containerWidth: width }),
      { width, narrow: true, source: 'override' },
      `PH1D-TINY-WIDTH: a ${width} containerWidth override over a measured 900 resolves as a narrow override of ${width}`);
    assert.deepStrictEqual(resolve({ container: { clientWidth: width } }, {}),
      { width, narrow: true, source: 'measured' },
      `PH1D-TINY-WIDTH: a ${width} clientWidth resolves as a narrow measurement of ${width}`);
    const geometry = ph1dLayOut(ph1Nodes(5), ph1Ranks(5), width);
    assert(geometry.width === width && geometry.colW === 40 && geometry.canvasWidth === 244
      && geometry.scrolls === true && geometry.scrollbarAllowance === 14,
    `PH1D-TINY-WIDTH: _compactGeometry at W=${width} with 5 ranks keeps the width and gives 40px columns on a 244px canvas that scrolls with a 14px allowance`);
    ph1dUseEnv(ph1dChainEnv(5));
    const container = element();
    container.clientWidth = 900;
    await new GraphView().render({ container }, { containerWidth: width });
    assert.deepStrictEqual(ph1dCompactDrawing(container.children[0]), ph1dExpectedDrawing(40, [2, 52, 102, 152, 202], 'short', 244, 14),
      `PH1D-TINY-WIDTH: an override of ${width} over a measured 900 pane draws 40px pills with short ids on a 244px canvas and a 14px scroller padding-bottom`);
  }

  // ---- PH1D-CARD-UNDER-CANVAS ----
  // A graph whose only node is a cross-epic stub has no legend. Drawn at an
  // override of 1024 with one warning row, a tap on the stub opens the
  // detail card directly after the canvas scroller and before the warning
  // strip.
  // MUTATION GUARD: PH1D-MUTANT-CARD-WITHOUT-SCROLLER-ANCHOR turns RED at
  // "PH1D-CARD-UNDER-CANVAS: ..." if the inline card is handed no scroller
  // and so is appended after the warning strip.
  {
    ph1dUseEnv(ph1dChainEnv(1));
    const stubOnlyLayout = {
      layoutGraph: () => ({
        nodes: [{
          card: 'GB-9 Elsewhere', path: 'spice/projects/phone/tasks/Other Epic/board/GB-9 Elsewhere.md', status: null,
          rank: 0, row: 0, isStub: true, stubLabel: 'Other Epic · GB-9',
        }],
        edges: [],
        warnings: [{ code: 'self_dependency', card: 'GA-H1 Handoff 1', detail: '' }],
      }),
    };
    const container = element();
    await new GraphView({ layout: stubOnlyLayout, lifecycleApi, insights: new GraphInsights() })
      .render({ container }, { containerWidth: 1024 });
    const root = container.children[0];
    const stub = byClass(root, 'graph-view-stub')[0];
    const tap = stub ? bubblingClick(stub) : null;
    const panel = byClass(root, 'graph-view-detail-panel')[0];
    const scroller = byClass(root, 'graph-view-scroll')[0];
    const strip = byClass(root, 'graph-view-warnings')[0];
    assert(tap?.stopped && byClass(root, 'graph-view-legend').length === 0 && panel?.parent === root && scroller && strip
      && root.children.indexOf(panel) === root.children.indexOf(scroller) + 1
      && root.children.indexOf(strip) === root.children.indexOf(panel) + 1,
    'PH1D-CARD-UNDER-CANVAS: at 1024, a tap on the only node, a cross-epic stub, opens the card directly after the canvas scroller and before the warning strip');
  }
  global.app = savedAppPH1;
  global.customJS = savedCustomJSPH1;

  // PH-1 compact parity with BL-4/BL-5: Stuck, Dim done, chain highlight,
  // two-tap open, and the canvas-tap deselect on compact pills.
  const bl5Compact = element();
  await new GraphView({ dashboard, lifecycleApi, insights: realInsights })
    ._renderCompactGraph(bl5Compact, { nodes: bl5Nodes, edges: bl5Edges }, lifecycleApi, epicPath, [], 390);
  const bl5CompactHost = byClass(bl5Compact, 'graph-view-compact')[0];
  const bl5CompactToolbar = byClass(bl5CompactHost, 'graph-view-filter-toolbar');
  const bl5CompactScrollerIndex = bl5CompactHost.children.findIndex((node) => node.className.split(/\s+/).includes('graph-view-scroll'));
  assert(bl5CompactToolbar.length === 1 && bl5CompactHost.children.indexOf(bl5CompactToolbar[0]) < bl5CompactScrollerIndex,
    'PH1-COMPACT-TOOLBAR: the compact map renders one filter toolbar above the map');
  const bl5CompactStuck = byClass(bl5Compact, 'graph-view-filter-stuck')[0];
  const bl5CompactDone = byClass(bl5Compact, 'graph-view-filter-done')[0];
  const bl5CompactPills = byClass(bl5Compact, 'graph-view-pill');
  const bl5CompactPillFor = (id) => bl5CompactPills.find((pill) => textOf(pill).includes(id));
  assert.strictEqual(bl5CompactPills.length, 6, 'PH1-COMPACT: one pill per BL-5 node');
  assert(bl5CompactPills.every((pill) => pill.className.split(/\s+/).includes('graph-view-chip')),
    'PH1-COMPACT: pills carry the graph-view-chip class (shared dimming class contract)');
  const bl5CompactAtRest = JSON.parse(JSON.stringify(domShape(bl5Compact)));
  const bl5ColW = compactColW(3, 390);
  assert.strictEqual(bl5ColW, 122, 'PH1-COMPACT-GEOMETRY: three 390px ranks give 122px columns');
  for (const [id, rank, row] of [['BL5-A', 0, 0], ['BL5-B', 1, 0], ['BL5-C', 2, 0], ['BL5-D', 0, 1], ['BL5-E', 1, 1], ['BL5-F', 2, 1]]) {
    const pos = compactPos(rank, row, bl5ColW);
    assert(bl5CompactPillFor(id).style.cssText.includes(`left:${pos.x}px;top:${pos.y}px;width:${pos.w}px;height:${pos.h}px;`),
      `PH1-COMPACT-GEOMETRY: ${id} pill sits at left:${pos.x}px;top:${pos.y}px;width:${pos.w}px;height:${pos.h}px`);
  }
  const bl5CompactCanvas = byClass(bl5Compact, 'graph-view-compact-canvas')[0];
  const bl5CompactHeight = 2 * PH1.pad + 2 * PH1.pillH + PH1.rowGap;
  assert(bl5CompactCanvas.style.cssText.includes(`width:${compactNatural(3, bl5ColW)}px;height:${bl5CompactHeight}px;`),
    'PH1-COMPACT-GEOMETRY: the canvas is the natural width and pad + rows*pill + rowGap tall');
  assert(byClass(bl5Compact, 'graph-view-edges')[0].innerHTML.startsWith(`<svg width="${compactNatural(3, bl5ColW)}" height="${bl5CompactHeight}"`),
    'PH1-COMPACT-EDGES: the SVG layer is sized to the compact canvas');
  const bl5CompactDepends = svgPaths(bl5Compact, 'edge-depends');
  assert.deepStrictEqual(bl5CompactDepends.map(dOf).sort(), [
    compactEdgeD(compactPos(0, 0, bl5ColW), compactPos(1, 0, bl5ColW)),
    compactEdgeD(compactPos(1, 0, bl5ColW), compactPos(2, 0, bl5ColW)),
  ].sort(), 'PH1-COMPACT-EDGES: every dependency edge between compact pills has exact endpoints');
  assert(bl5CompactDepends.every((chunk) => chunk.includes('marker-end') && !chunk.includes('stroke-dasharray')),
    'PH1-COMPACT-EDGES: compact depends edges keep the solid arrowed markup');
  bl5CompactStuck.listeners.click({ stopPropagation() {} });
  for (const id of ['BL5-A', 'BL5-B', 'BL5-C', 'BL5-D']) {
    assert(!bl5CompactPillFor(id).className.includes('graph-view-dimmed'),
      `PH1-COMPACT-STUCK: ${id} remains full strength in the authoritative stuck keep-set`);
  }
  for (const id of ['BL5-E', 'BL5-F']) {
    assert(bl5CompactPillFor(id).className.includes('graph-view-dimmed'),
      `PH1-COMPACT-STUCK: ${id} outside the stuck keep-set dims`);
  }
  bl5CompactDone.listeners.click({ stopPropagation() {} });
  assert(bl5CompactPillFor('BL5-B').className.includes('graph-view-dimmed')
    && bl5CompactPillFor('BL5-E').className.includes('graph-view-dimmed')
    && bl5CompactPillFor('BL5-F').className.includes('graph-view-dimmed')
    && !bl5CompactPillFor('BL5-D').className.includes('graph-view-dimmed'),
  'PH1-COMPACT-FILTER-UNION: Dim done composes with Stuck and does not dim the parked root');
  const bl5CompactFresh = element();
  await new GraphView({ dashboard, lifecycleApi, insights: realInsights })
    ._renderCompactGraph(bl5CompactFresh, { nodes: bl5Nodes, edges: bl5Edges }, lifecycleApi, epicPath, [], 390);
  assert.deepStrictEqual(domShape(bl5CompactFresh), bl5CompactAtRest,
    'PH1-COMPACT-CROSS-INSTANCE: a second compact render starts off while the first remains active');
  const bl5CompactOpenCount = opened.length;
  const bl5CompactTap = bubblingClick(bl5CompactPillFor('BL5-A'));
  assert(bl5CompactTap.stopped && opened.length === bl5CompactOpenCount,
    'PH1-COMPACT-FIRST-TAP: the first pill tap selects without navigation');
  assert(!bl5CompactPillFor('BL5-A').className.includes('graph-view-dimmed')
    && !bl5CompactPillFor('BL5-B').className.includes('graph-view-dimmed')
    && !bl5CompactPillFor('BL5-C').className.includes('graph-view-dimmed')
    && bl5CompactPillFor('BL5-D').className.includes('graph-view-dimmed'),
  'PH1-COMPACT-SELECTION-PRECEDENCE: the selected closure stays full strength over both filters');
  assert.strictEqual(svgPaths(bl5Compact, 'edge-depends').filter((chunk) => chunk.includes('graph-view-chain-edge')).length, 2,
    'PH1-COMPACT-CHAIN: both depends edges inside the selected chain are emphasized');
  const bl5CompactPanel = byClass(bl5Compact, 'graph-view-detail-panel')[0];
  assert(bl5CompactPanel && bl5CompactPanel.parent === bl5CompactHost
    && bl5CompactHost.children.indexOf(bl5CompactPanel) === bl5CompactHost.children.indexOf(byClass(bl5CompactHost, 'graph-view-legend')[0]) + 1,
  'PH1-COMPACT-PANEL: the inline card mounts after the compact legend');
  bl5CompactCanvas.listeners.click();
  assert(byClass(bl5Compact, 'graph-view-detail-panel').length === 0
    && bl5CompactPillFor('BL5-B').className.includes('graph-view-dimmed')
    && !bl5CompactPillFor('BL5-D').className.includes('graph-view-dimmed'),
  'PH1-COMPACT-CANVAS-CLEAR: a canvas tap clears selection and reapplies the active filters');
  bl5CompactStuck.listeners.click({ stopPropagation() {} });
  assert(bl5CompactPillFor('BL5-B').className.includes('graph-view-dimmed')
    && bl5CompactPillFor('BL5-E').className.includes('graph-view-dimmed')
    && !bl5CompactPillFor('BL5-D').className.includes('graph-view-dimmed')
    && !bl5CompactPillFor('BL5-F').className.includes('graph-view-dimmed'),
  'PH1-COMPACT-DIM-DONE-ONLY: Dim done alone dims the completed pills and leaves the parked and planning pills full strength');
  bl5CompactDone.listeners.click({ stopPropagation() {} });
  assert.deepStrictEqual(domShape(bl5Compact), bl5CompactAtRest,
    'PH1-COMPACT-TOGGLE-OFF: turning both filters off restores the exact at-rest DOM');
  bubblingClick(bl5CompactPillFor('BL5-A'));
  bl5CompactPillFor('BL5-A').listeners.click({ stopPropagation() {} });
  assert.deepStrictEqual(opened.at(-1), [`${board}/BL5-A Root`, epicPath, false],
    'PH1-COMPACT-TWO-TAP-OPEN: tapping the already-selected pill opens it');
  bl5CompactCanvas.listeners.click();
  assert.deepStrictEqual(domShape(bl5Compact), bl5CompactAtRest,
    'PH1-COMPACT-EPHEMERAL: selecting and clearing returns the compact DOM exactly to at rest');
  const compactFailSoft = element();
  await new GraphView({ dashboard, lifecycleApi, insights: {} })
    ._renderCompactGraph(compactFailSoft, { nodes: bl5Nodes, edges: bl5Edges }, lifecycleApi, epicPath, [], 390);
  const compactFailSoftBefore = domShape(compactFailSoft);
  byClass(compactFailSoft, 'graph-view-filter-stuck')[0].listeners.click({ stopPropagation() {} });
  assert.deepStrictEqual(domShape(compactFailSoft), compactFailSoftBefore,
    'PH1-COMPACT-FAIL-SOFT: Stuck is an exact no-op without authoritative GraphInsights on the compact map too');
  // Without authoritative GraphInsights a pill tap opens its slice directly.
  // MUTATION GUARD: PH1D-MUTANT-INERT-PILL-WITHOUT-INSIGHTS turns RED here if
  // a pill with no selection controller ignores the tap.
  const failSoftOpens = opened.length;
  byClass(compactFailSoft, 'graph-view-pill').find((pill) => textOf(pill).includes('BL5-A'))?.listeners.click({ stopPropagation() {} });
  assert(opened.length === failSoftOpens + 1 && JSON.stringify(opened.at(-1)) === JSON.stringify([`${board}/BL5-A Root`, epicPath, false]),
    'PH1D-PILL-PRESENTATION: without authoritative GraphInsights a pill tap opens its slice directly');

  // Compact pill presentation: shared status class, colour, and glyph through
  // _statusPresentation; stubs dashed; stuck pills a 2px error hairline on the
  // left; parked pills the needs-you class; unrecognized status still warns.
  const presNodes = [
    { card: 'PR-A Planned', path: `${board}/PR-A Planned.md`, status: 'planning', rank: 0, row: 0 },
    { card: 'PR-B Blocked', path: `${board}/PR-B Blocked.md`, status: 'blocked', rank: 0, row: 1, waitReason: 'waiting on: PR-A Planned' },
    { card: 'PR-C Parked', path: `${board}/PR-C Parked.md`, status: 'parked', rank: 1, row: 0, waitReason: 'Director decision' },
    { card: 'PR-D Garbled', path: `${board}/PR-D Garbled.md`, status: 'garbled', rank: 1, row: 1 },
    { card: 'PR-E Done', path: `${board}/PR-E Done.md`, status: 'completed', rank: 2, row: 0 },
    { card: 'GA-X1 External', path: 'spice/projects/x/tasks/Other/board/GA-X1 External.md', status: null, rank: 3, row: 0, isStub: true, stubLabel: 'Other · GA-X1' },
  ];
  const presEdges = [
    { from: 'PR-A Planned', to: 'PR-B Blocked', kind: 'order' },
    { from: 'PR-A Planned', to: 'PR-C Parked', kind: 'depends' },
    { from: 'GA-X1 External', to: 'PR-E Done', kind: 'depends', cross: true },
  ];
  const presRoot = element();
  const presWarnings = [];
  await ph1View._renderCompactGraph(presRoot, { nodes: presNodes, edges: presEdges }, lifecycleApi, epicPath, presWarnings, 390);
  const presColW = compactColW(4, 390);
  const presPills = byClass(presRoot, 'graph-view-pill');
  const presPillFor = (id) => presPills.find((pill) => byClass(pill, 'graph-view-pill-id')[0]?.textContent === id);
  assert.strictEqual(presPills.length, 6, 'PH1-COMPACT-PRESENTATION: one pill per node including the stub');
  for (const [id, status] of [['PR-A', 'planning'], ['PR-B', 'blocked'], ['PR-C', 'parked'], ['PR-D', 'garbled'], ['PR-E', 'completed']]) {
    const expected = dashboard._statusPresentation(status, lifecycleApi);
    const pill = presPillFor(id);
    assert(pill && pill.className.split(/\s+/).includes(expected.className),
      `PH1-COMPACT-PRESENTATION: ${id} pill carries the shared status class ${expected.className}`);
    assert(pill.style.cssText.includes(`color:${expected.color};`),
      `PH1-COMPACT-PRESENTATION: ${id} pill carries the shared colour ${expected.color}`);
    // MUTATION GUARD: PH1D-MUTANT-UNTINTED-BORDER turns RED here if the pill
    // border stops mixing the shared presentation colour (another colour, or
    // another strength than 40%).
    assert(pill.style.cssText.includes(`border:1px solid color-mix(in srgb, ${expected.color} 40%, transparent);`),
      `PH1D-PILL-PRESENTATION (PH1C-PILL-TINTS): ${id} pill's border is the shared colour ${expected.color} tinted 40%`);
    // MUTATION GUARD: PH1D-MUTANT-UNTINTED-BACKGROUND turns RED here if the
    // pill background stops mixing the shared presentation colour (another
    // colour, or another strength than 10%).
    assert(pill.style.cssText.includes(`background:color-mix(in srgb, ${expected.color} 10%, var(--background-primary));`),
      `PH1D-PILL-PRESENTATION (PH1C-PILL-TINTS): ${id} pill's background is the shared colour ${expected.color} tinted 10% over the primary background`);
    const glyph = byClass(pill, 'graph-view-status-glyph')[0];
    assert(glyph && glyph.textContent === expected.glyph && glyph.attrs['aria-hidden'] === 'true'
      && pill.children.indexOf(glyph) < pill.children.indexOf(byClass(pill, 'graph-view-pill-id')[0]),
    `PH1-COMPACT-PRESENTATION: ${id} pill carries the shared glyph ${expected.glyph} before its id`);
    // MUTATION GUARD: PH1D-MUTANT-GLYPH-UNCOLOURED (P12) turns RED here if
    // the glyph span stops carrying the shared status colour (or its shared
    // status class).
    assert(cssEffective(glyph.style.cssText).color === expected.color
      && glyph.className === `graph-view-status-glyph ${expected.className}`,
    `PH1D-GLYPH-COLOUR (P12): ${id} pill's glyph carries the shared colour ${expected.color} and the shared status class`);
  }
  for (const id of ['PR-B', 'PR-C']) {
    assert(presPillFor(id).style.cssText.includes('border-left:2px solid var(--text-error);'),
      `PH1-COMPACT-STUCK-HAIRLINE: stuck ${id} carries the 2px error hairline on the left`);
  }
  for (const id of ['PR-A', 'PR-D', 'PR-E']) {
    assert(!presPillFor(id).style.cssText.includes('border-left:'),
      `PH1-COMPACT-STUCK-HAIRLINE: ${id} carries no hairline`);
  }
  // PH1D-HAIRLINE-CASCADE (P23): effectiveBorders applies each pill's
  // declarations in order: the effective left border of the blocked and
  // parked pills is the 2px error hairline, and every other side of PR-A
  // through PR-E is the 1px shared-colour tint.
  // MUTATION GUARD: PH1D-MUTANT-HAIRLINE-BEFORE-SHORTHAND (P23) turns RED
  // here if the hairline is declared before the border shorthand.
  for (const [id, status] of [['PR-A', 'planning'], ['PR-B', 'blocked'], ['PR-C', 'parked'], ['PR-D', 'garbled'], ['PR-E', 'completed']]) {
    const expected = dashboard._statusPresentation(status, lifecycleApi);
    const tint = `1px solid color-mix(in srgb, ${expected.color} 40%, transparent)`;
    const stuck = status === 'blocked' || status === 'parked';
    assert.deepStrictEqual(effectiveBorders(presPillFor(id).style.cssText),
      { top: tint, right: tint, bottom: tint, left: stuck ? '2px solid var(--text-error)' : tint },
      `PH1D-HAIRLINE-CASCADE (P23): ${id}'s effective left border is ${stuck ? 'the 2px error hairline' : 'the 1px shared tint'} and its other sides the 1px shared tint`);
  }
  const parkedPresentation = dashboard._statusPresentation('parked', lifecycleApi);
  assert(presPillFor('PR-C').className.split(/\s+/).includes('graph-view-needs-you')
    && byClass(presPillFor('PR-C'), 'graph-view-status-glyph')[0].textContent === parkedPresentation.glyph,
  'PH1-COMPACT-NEEDS-YOU: the parked pill carries the needs-you class and the shared parked glyph');
  for (const id of ['PR-A', 'PR-B', 'PR-D', 'PR-E']) {
    assert(!presPillFor(id).className.split(/\s+/).includes('graph-view-needs-you'),
      `PH1-COMPACT-NEEDS-YOU: ${id} carries no needs-you class`);
  }
  // PH1D-PILL-PRESENTATION (PH1C-NEEDS-YOU-NOT-ON-STUB): a cross-epic stub
  // whose status reads parked does not carry the needs-you class (the stub
  // above is status-less); the parked slice drawn beside it is the control.
  // MUTATION GUARD: PH1D-MUTANT-NEEDS-YOU-ON-STUB turns RED here if a stub
  // pill takes the needs-you class from a parked status.
  const parkedStubRoot = element();
  await ph1View._renderCompactGraph(parkedStubRoot, { nodes: [
    { card: 'PR-P Parked', path: `${board}/PR-P Parked.md`, status: 'parked', rank: 0, row: 0, waitReason: 'Director decision' },
    { card: 'GA-X2 External', path: 'spice/projects/x/tasks/Other/board/GA-X2 External.md', status: 'parked', rank: 1, row: 0, isStub: true, stubLabel: 'Other · GA-X2' },
  ], edges: [] }, lifecycleApi, epicPath, [], 390);
  const parkedStubPill = byClass(parkedStubRoot, 'graph-view-pill').find((pill) => pill.className.split(/\s+/).includes('graph-view-stub'));
  const parkedSlicePill = byClass(parkedStubRoot, 'graph-view-pill').find((pill) => !pill.className.split(/\s+/).includes('graph-view-stub'));
  assert(parkedPresentation.normalized === 'parked' && parkedSlicePill && parkedStubPill
    && parkedSlicePill.className.split(/\s+/).includes('graph-view-needs-you')
    && !parkedStubPill.className.split(/\s+/).includes('graph-view-needs-you')
    && !parkedStubPill.style.cssText.includes('border-left:'),
  'PH1D-PILL-PRESENTATION (PH1C-NEEDS-YOU-NOT-ON-STUB): a parked stub carries no needs-you class and no stuck hairline, while the parked slice beside it carries the needs-you class');
  const presStub = presPillFor('GA-X1');
  assert(presStub && presStub.className.split(/\s+/).includes('graph-view-stub')
    && presStub.style.cssText.includes('border:1px dashed')
    && byClass(presStub, 'graph-view-status-glyph').length === 0
    && presStub.attrs.title === 'Other · GA-X1',
  'PH1-COMPACT-STUB: stub pills are dashed, glyph-less, and keep the owning-epic label as their tooltip');
  assert.deepStrictEqual(presWarnings, [{ code: 'unreadable_slice', card: 'PR-D Garbled', detail: 'garbled' }],
    'PH1-COMPACT-PRESENTATION: an unrecognized status emits exactly one unreadable_slice warning');
  // MUTATION GUARD: PH1D-MUTANT-MISSING-STATUS-DETAIL turns RED here if a pill
  // whose status is absent reports its detail as anything but (missing).
  const missingStatusWarnings = [];
  await ph1View._renderCompactGraph(element(), { nodes: [
    { card: 'PR-M Missing', path: `${board}/PR-M Missing.md`, rank: 0, row: 0 },
  ], edges: [] }, lifecycleApi, epicPath, missingStatusWarnings, 390);
  assert.deepStrictEqual(missingStatusWarnings, [{ code: 'unreadable_slice', card: 'PR-M Missing', detail: '(missing)' }],
    'PH1D-PILL-PRESENTATION: a pill with no status emits exactly one unreadable_slice warning whose detail is (missing)');
  const presHost = byClass(presRoot, 'graph-view-compact')[0];
  const presSummary = byClass(presHost, 'graph-view-stuck-summary')[0];
  assert(presSummary && presHost.children.indexOf(presSummary) < presHost.children.indexOf(byClass(presHost, 'graph-view-filter-toolbar')[0]),
    'PH1-COMPACT: the stuck summary sits above the toolbar and outside the map');
  assert.deepStrictEqual(byClass(byClass(presHost, 'graph-view-legend')[0], 'graph-view-legend-label').map((node) => node.textContent).sort(),
    ['blocked', 'done', 'planning', 'unrecognized: garbled', 'waiting'].sort(),
    'PH1-COMPACT: the compact legend names exactly the drawn statuses and skips the stub');
  assert.deepStrictEqual(svgPaths(presRoot, 'edge-order').map(dOf),
    [compactEdgeD(compactPos(0, 0, presColW), compactPos(0, 1, presColW))],
    'PH1-COMPACT-EDGES: a same-column order edge drops from pill bottom-centre to the next row top');
  const presDepends = svgPaths(presRoot, 'edge-depends');
  assert.deepStrictEqual(presDepends.map(dOf).sort(), [
    compactEdgeD(compactPos(0, 0, presColW), compactPos(1, 0, presColW)),
    compactEdgeD(compactPos(3, 0, presColW), compactPos(2, 0, presColW)),
  ].sort(), 'PH1-COMPACT-EDGES: cross-column depends edges, including the backwards cross-epic stub edge, use exact endpoints');
  assert(presDepends.some((chunk) => chunk.includes('edge-cross-epic')),
    'PH1-COMPACT-EDGES: the cross-epic edge keeps its class on the compact map');

  // ---- PH1D-COMPACT-DECLARATIONS ----
  // The compact map's structure and inline declarations, pinned as literals
  // for this 4-rank map at 390 (colW = floor((390 - 4 - 30) / 4) = 89, lefts
  // 2 101 200 299, rows at top 2 and 36, canvas 390 x 64): the host, the
  // scroller, the canvas, the edge layer, a plain, two stuck, and a stub
  // pill with their id spans, and the plain pill's glyph span. Colours come
  // from the shared presentation.
  // MUTATION GUARD: PH1D-MUTANT-PILL-DECLARATION turns RED here if any pill
  // declaration changes (position:absolute, box-sizing:border-box,
  // inline-flex, padding, the stub's opacity) or a pill loses a shared
  // class (graph-view-chip on a stub).
  // MUTATION GUARD: PH1D-MUTANT-PILL-OUTSIDE-CANVAS turns RED here if pills
  // are drawn on the host instead of the canvas.
  // MUTATION GUARD: PH1D-MUTANT-ID-SPAN-DECLARATION turns RED here if the id
  // span stops ellipsizing inside its pill.
  // MUTATION GUARD: PH1D-MUTANT-MAP-DECLARATION turns RED here if the
  // scroller, canvas, or edge layer declarations or classes change
  // (box-sizing, graph-view-canvas, position:absolute, pointer-events:none).
  {
    const planning = dashboard._statusPresentation('planning', lifecycleApi);
    const blocked = dashboard._statusPresentation('blocked', lifecycleApi);
    const pillBase = (left, top) => `position:absolute;left:${left}px;top:${top}px;width:89px;height:26px;`
      + 'display:inline-flex;align-items:center;gap:4px;padding:0 6px;border-radius:999px;box-sizing:border-box;'
      + 'cursor:pointer;min-width:0;font-family:var(--font-monospace);font-size:11px;font-weight:600;';
    const tinted = (color, stuck) => `color:${color};border:1px solid color-mix(in srgb, ${color} 40%, transparent);`
      + (stuck ? 'border-left:2px solid var(--text-error);' : '')
      + `background:color-mix(in srgb, ${color} 10%, var(--background-primary));`;
    const presCanvas = byClass(presRoot, 'graph-view-compact-canvas')[0];
    const presScroller = byClass(presRoot, 'graph-view-compact-scroll')[0];
    const presEdgeLayer = byClass(presRoot, 'graph-view-edges')[0];
    assert(presHost.className === 'graph-view-compact' && presHost.style.cssText === 'display:grid;gap:0;min-width:0;max-width:100%;'
      && presScroller.parent === presHost && presScroller.className === 'graph-view-scroll graph-view-compact-scroll'
      && presScroller.style.cssText === 'overflow-x:auto;overflow-y:hidden;max-width:100%;padding-bottom:0px;box-sizing:content-box;'
      && presCanvas.parent === presScroller && presCanvas.className === 'graph-view-canvas graph-view-compact-canvas'
      && presCanvas.style.cssText === 'position:relative;width:390px;height:64px;'
      && presEdgeLayer.parent === presCanvas && presCanvas.children[0] === presEdgeLayer
      && presEdgeLayer.style.cssText === 'position:absolute;inset:0;pointer-events:none;',
    'PH1D-COMPACT-DECLARATIONS: the host, scroller, canvas, and edge layer carry exactly their pinned classes and declarations, the edge layer first inside the canvas');
    assert(presPills.every((pill) => pill.parent === presCanvas),
      'PH1D-COMPACT-DECLARATIONS: every pill is drawn inside the canvas, never on the host');
    for (const [id, className, cssText] of [
      ['PR-A', `graph-view-chip graph-view-pill ${planning.className}`, pillBase(2, 2) + tinted(planning.color, false)],
      ['PR-B', `graph-view-chip graph-view-pill ${blocked.className}`, pillBase(2, 36) + tinted(blocked.color, true)],
      ['PR-C', `graph-view-chip graph-view-pill ${parkedPresentation.className} graph-view-needs-you`, pillBase(101, 2) + tinted(parkedPresentation.color, true)],
      ['GA-X1', 'graph-view-chip graph-view-pill graph-view-stub', pillBase(299, 2) + 'color:var(--text-muted);opacity:0.75;'
        + 'border:1px dashed color-mix(in srgb, var(--text-muted) 45%, transparent);'
        + 'background:color-mix(in srgb, var(--text-muted) 6%, var(--background-primary));'],
    ]) {
      const pill = presPillFor(id);
      assert(pill && pill.className === className && pill.style.cssText === cssText,
        `PH1D-COMPACT-DECLARATIONS: ${id} pill carries exactly its pinned classes and declarations`);
      const idSpan = byClass(pill, 'graph-view-pill-id')[0];
      assert(idSpan && idSpan.className === 'graph-view-pill-id' && pill.children.at(-1) === idSpan
        && idSpan.style.cssText === 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
      `PH1D-COMPACT-DECLARATIONS: ${id} pill's id span is its last child and ellipsizes inside the pill`);
    }
    const planningGlyph = byClass(presPillFor('PR-A'), 'graph-view-status-glyph')[0];
    assert(planningGlyph && planningGlyph.style.cssText === `flex:none;font-weight:700;color:${planning.color};`,
      'PH1D-COMPACT-DECLARATIONS: the glyph span carries exactly its pinned declarations');
  }

  // ---- PH1D-COMPACT-WIDE-PARITY ----
  // The compact map and the wide canvas present one layout result. Each
  // drawing gets its own selection controller instance from the one builder
  // _selectionController. Each run of ph1dParity.run() draws its fixture
  // twice, compact and wide. The render() fixture's wide drawing is render()
  // at a containerWidth override of 1024, and its compact drawing is render()
  // reached through one width source per run: a containerWidth override of
  // 390 (the run below), and a measured clientWidth of 390, an unmeasured
  // clientWidth of 0 with the is-mobile body class, and a cold-load one-shot
  // re-render at 390 (the runs in PH1D-COMPACT-WIDE-PARITY (width sources)).
  // The two direct-draw fixtures are drawn with _renderCompactGraph at 390
  // (compact) and _renderGraph, which takes no width (wide).
  // The step list stepsFor() builds is replayed on both drawings of each
  // fixture, one click per step on the target the step names: rest (no
  // click); for each node in turn, a tap and a second tap on it; Open slice;
  // the canvas; Stuck; a tap on each node; Close; Stuck; Dim done; a tap on
  // each node; the canvas; Dim done; Stuck; Dim done; a tap on each node; the
  // canvas; Dim done; Stuck; a tap on the fixture's pick node; Stuck; Dim
  // done; the canvas; Stuck; Dim done; rest. A step whose target is not
  // found clicks nothing (for example Open slice or Close with no card
  // open). In the two fixtures with GraphInsights a tap on an unselected node
  // selects it and opens its card, and a tap on the selected node opens its
  // note; in the fixture without GraphInsights a tap opens the node's note,
  // no node is ever selected, no card opens, and a Stuck click changes
  // nothing.
  // After each step, read() returns, for each drawing, an object with exactly
  // these fields, and parity is assert.deepStrictEqual of the two objects:
  //   nodes: per fixture node, either the string 'not exactly one element'
  //     (the node maps to no element or to more than one) or: dimmed (the
  //     graph-view-dimmed class), dimStyle (the inline style ends with the
  //     dimming declarations), selected (the first detail card's heading is
  //     the node's id and title), cell (the index of its left among the
  //     distinct lefts of the fixture nodes' boxes, and of its top among
  //     their distinct tops), and status (its status-* classes; the
  //     effective values of its color, border, background, and opacity
  //     declarations; and the text, class, and effective colour of each
  //     .graph-view-status-glyph span in it);
  //   edges: each path in the .graph-view-edges layers whose class
  //     attribute starts with 'graph-view-edge ', sorted, as from -> to,
  //     kind, cross-epic, emphasized, and stroke width, where from and to are
  //     the nodes whose drawn boxes the path's first and last points touch
  //     (an 'unresolved' or 'unparsed' marker when that is not exactly one
  //     node);
  //   cards: the number of detail cards;
  //   card: for the first detail card, its heading, status row, row labels,
  //     Waiting on, Unmet prerequisites (id and status of each link),
  //     Outcome, Gates, Dependents, button texts, and the digest of its
  //     domShape;
  //   stuck and dimDone: each button's aria-pressed and active class;
  //   canvases: the number of canvases;
  //   summary: the stuck summary text;
  //   legend: the class, glyph, and label of each legend entry, in order;
  //   warningRows: the warning rows' text;
  //   warnings: a copy of the list a direct draw was handed (null for the
  //     render() fixture);
  //   opened: the openLinkText argument lists recorded during the step.
  // Nothing else about the drawing is compared: the card draws pills and
  // chips differently at the two widths.
  // Every step is also anchored. projectedOf() takes, from the compact
  // reading: per node, the status classes, color, and glyph texts; the
  // dimmed nodes; the dim-styled nodes; the selected nodes; the emphasized
  // edges as from -> to, sorted; the card count; for the first card, its
  // heading, number of status rows, sorted Unmet prerequisite ids, sorted
  // Dependent ids, and Gates text; the stuck and dimDone button states; the
  // summary; and the opened notes. That object must deep-equal expectedOf()
  // of a model that advance() moves one step at a time; the comments on those
  // two functions state how the expected values are derived.
  // MUTATION GUARD: PH1D-MUTANT-COMPACT-STUB-UNREGISTERED (A01) turns RED at
  // "PH1D-COMPACT-WIDE-PARITY: render() of six slices and two cross-epic stubs,
  // step 1 (tap PA-1 Base): the compact reading equals the wide reading ..." if the compact map does
  // not register stub pills with the selection controller.
  // MUTATION GUARD: PH1D-MUTANT-COMPACT-REGISTER-SLICES-AFTER-LEGEND (A12) turns RED
  // at the same label if the compact map registers only its slice pills,
  // after the legend.
  // MUTATION GUARD: PH1D-MUTANT-COMPACT-ANALYSIS-WITHOUT-STUBS (A05) turns RED
  // at "PH1D-COMPACT-WIDE-PARITY: render() of six slices and two cross-epic stubs,
  // step 5 (tap PA-3 Blocked): the compact reading equals the wide reading ..." if the compact map's
  // GraphInsights analysis leaves out stubs and cross-epic edges.
  // MUTATION GUARD: PH1D-MUTANT-COMPACT-CONTROLLER-WITHOUT-CROSS-EDGES (A06) turns RED
  // at the same label if the compact selection controller is handed no
  // cross-epic edges.
  // MUTATION GUARD: PH1D-MUTANT-COMPACT-CONTROLLER-WITHOUT-STUBS (A07) turns RED
  // at the same label if the compact selection controller is handed no stub
  // nodes.
  // MUTATION GUARD: PH1D-MUTANT-COMPACT-STUB-REGISTERED-COMPLETED (B18) turns RED
  // at "PH1D-COMPACT-WIDE-PARITY: render() of six slices and two cross-epic stubs,
  // step 30 (done): the compact reading equals the wide reading ..." if the compact map registers each
  // stub with a completed status.
  // MUTATION GUARD: PH1D-MUTANT-DIM-DONE-DIMS-STUBS (B06) turns RED at
  // "PH1D-COMPACT-WIDE-PARITY: render() of six slices and two cross-epic stubs,
  // step 30 (done): the compact reading matches the fixture model ..." if Dim done dims every stub on both
  // presentations.
  // MUTATION GUARD: PH1D-MUTANT-COMPACT-LEGEND-REVERSED (A08) turns RED at
  // "PH1D-COMPACT-WIDE-PARITY: render() of six slices and two cross-epic stubs,
  // step 0 (rest): the compact reading equals the wide reading ..." if the compact legend lists its
  // entries in reverse node order.
  // MUTATION GUARD: PH1D-MUTANT-COMPACT-UNRECOGNIZED-AS-PLANNING (X1) turns RED
  // at the same label if, from the render() parity fixture on, the compact
  // map draws an unrecognized status with the planning presentation.
  // MUTATION GUARD: PH1D-MUTANT-COMPACT-PILL-WITHOUT-STATUS-CLASS (X2) turns RED
  // at the same label if, from the render() parity fixture on, a compact
  // slice pill drops its status class.
  // MUTATION GUARD: PH1D-MUTANT-BOTH-FILTERS-IGNORE-STUCK (F1) turns RED at
  // "PH1D-COMPACT-WIDE-PARITY: render() of six slices and two cross-epic stubs,
  // step 42 (done): the compact reading matches the fixture model ..." if, from the render() parity
  // fixture on, Stuck stops dimming while Dim done is on.
  // MUTATION GUARD: PH1D-MUTANT-FILTERS-OVERRIDE-SELECTION (S19) turns RED at
  // "PH1D-COMPACT-WIDE-PARITY: render() of six slices and two cross-epic stubs,
  // step 55 (stuck): the compact reading matches the fixture model ..." if a filter toggled while a node is
  // selected re-dims the nodes.
  // MUTATION GUARD: PH1D-MUTANT-COMPACT-STUB-REGISTERED-BLOCKED (B19) turns RED
  // at "PH1D-COMPACT-WIDE-PARITY: a handed-in layout result with three cross-epic stubs,
  // step 36 (done): the compact reading equals the wide reading ..." if the compact map registers each
  // stub with a blocked status.
  // MUTATION GUARD: PH1D-MUTANT-COMPACT-SUMMARY-WITHOUT-STUBS (B21) turns RED
  // at "PH1D-COMPACT-WIDE-PARITY: a handed-in layout result with three cross-epic stubs,
  // step 0 (rest): the compact reading equals the wide reading ..." if the compact stuck summary comes
  // from an analysis without stubs and cross-epic edges.
  // MUTATION GUARD: PH1D-MUTANT-STUB-IN-LAST-COLUMN (Z74) turns RED at the
  // same label if the compact map draws every stub in the last rank's
  // column.
  // MUTATION GUARD: PH1D-MUTANT-DEPENDENTS-RAW-COMPLETED (S10) turns RED at
  // "PH1D-COMPACT-WIDE-PARITY: a handed-in layout result with three cross-epic stubs,
  // step 15 (tap PC-6 Odd): the compact reading matches the fixture model ..." if the card's Dependents
  // compare the raw status with 'completed'.
  // MUTATION GUARD: PH1D-MUTANT-BOTH-FILTERS-IGNORE-DIM-DONE (F2) turns RED at
  // "PH1D-COMPACT-WIDE-PARITY: a handed-in layout result with three cross-epic stubs,
  // step 50 (done): the compact reading matches the fixture model ..." if, from the render() parity
  // fixture on, Dim done stops dimming while Stuck is on.
  // MUTATION GUARD: PH1D-MUTANT-STUB-PILL-OPENS-CARD-NAME (A13) turns RED at
  // "PH1D-COMPACT-WIDE-PARITY: the same handed-in result without
  // GraphInsights, step 3 (tap PX-7 Relay): the compact reading equals the wide reading ..." if a stub
  // pill without a selection controller opens its card name instead of its
  // path.
  const ph1dParity = (() => {
    const dimTail = 'opacity:0.28;filter:saturate(0.45);';
    const classesOf = (node) => String(node?.className || '').split(/\s+/);
    const textsOf = (root, className) => byClass(root, className).map((node) => node.textContent);
    const idOf = (node) => dashboard._titleParts(node.card).id || node.card;
    const headingOf = (node) => {
      const parts = dashboard._titleParts(node.card);
      return JSON.stringify([parts.id || node.card, parts.id ? parts.title : null]);
    };
    const identifies = {
      compact: (node, chip) => classesOf(chip).includes('graph-view-pill')
        && classesOf(chip).includes('graph-view-stub') === Boolean(node.isStub)
        && chip.attrs.title === String(node.isStub ? node.stubLabel || node.card : node.card),
      wide: (node, chip) => {
        if (classesOf(chip).includes('graph-view-pill')
          || classesOf(chip).includes('graph-view-stub') !== Boolean(node.isStub)) return false;
        if (node.isStub) {
          return JSON.stringify(textsOf(chip, 'graph-view-stub-label')) === JSON.stringify([String(node.stubLabel || node.card)]);
        }
        const parts = dashboard._titleParts(node.card);
        return JSON.stringify([textsOf(chip, 'graph-view-chip-id')[0] ?? null, textsOf(chip, 'graph-view-chip-name')])
          === JSON.stringify([parts.id, [parts.title]]);
      },
    };
    const elementsOf = (kind, root, nodes) => {
      const chips = byClass(root, 'graph-view-chip');
      return new Map(nodes.map((node) => {
        const matches = chips.filter((chip) => identifies[kind](node, chip));
        return [node.card, matches.length === 1 ? matches[0] : null];
      }));
    };
    const boxOf = (chip) => {
      const css = cssEffective(chip.style.cssText);
      return { left: parseFloat(css.left), top: parseFloat(css.top), width: parseFloat(css.width), height: parseFloat(css.height) };
    };
    const read = (kind, root, nodes, opened, warnings) => {
      const elements = elementsOf(kind, root, nodes);
      const boxes = new Map([...elements].filter(([, chip]) => chip).map(([card, chip]) => [card, boxOf(chip)]));
      const lefts = [...new Set([...boxes.values()].map((box) => box.left))].sort((left, right) => left - right);
      const tops = [...new Set([...boxes.values()].map((box) => box.top))].sort((left, right) => left - right);
      const panels = byClass(root, 'graph-view-detail-panel');
      const panel = panels[0] || null;
      const heading = panel
        ? JSON.stringify([textsOf(panel, 'graph-view-detail-id')[0] ?? null, textsOf(panel, 'graph-view-detail-title')[0] ?? null])
        : null;
      const touching = (x, y, test) => {
        const hits = [...boxes].filter(([, box]) => test(box, x, y)).map(([card]) => card);
        return hits.length === 1 ? hits[0] : `unresolved ${x} ${y}`;
      };
      const edges = byClass(root, 'graph-view-edges').map((layer) => layer.innerHTML).join('')
        .split('<path').slice(1).filter((chunk) => chunk.includes('class="graph-view-edge '))
        .map((chunk) => {
          const names = ((chunk.match(/class="([^"]*)"/) || [])[1] || '').split(/\s+/);
          const d = dOf(chunk);
          const curve = d.match(/^M (\S+) (\S+) C \S+ \S+, \S+ \S+, (\S+) (\S+)$/);
          const line = d.match(/^M (\S+) (\S+) L (\S+) (\S+)$/);
          let ends = [`unparsed ${d}`, `unparsed ${d}`];
          if (curve) {
            const [x1, y1, x2, y2] = curve.slice(1).map(Number);
            ends = [touching(x1, y1, (box, x, y) => box.left + box.width === x && box.top + box.height / 2 === y),
              touching(x2, y2, (box, x, y) => box.left === x && box.top + box.height / 2 === y)];
          } else if (line) {
            const [x1, y1, x2, y2] = line.slice(1).map(Number);
            ends = [touching(x1, y1, (box, x, y) => box.left + box.width / 2 === x && box.top + box.height === y),
              touching(x2, y2, (box, x, y) => box.left + box.width / 2 === x && box.top === y)];
          }
          const edgeKind = names.includes('edge-depends') ? 'depends' : (names.includes('edge-order') ? 'order' : 'unknown');
          return `${ends[0]} -> ${ends[1]} ${edgeKind}${names.includes('edge-cross-epic') ? ' cross' : ''}`
            + `${names.includes('graph-view-chain-edge') ? ' emphasized' : ''} stroke ${(chunk.match(/stroke-width="([^"]*)"/) || [])[1]}`;
        }).sort();
      const links = (className) => (panel ? byClass(panel, className).map((link) => [
        textsOf(link, 'graph-view-detail-link-id')[0], textsOf(link, 'graph-view-detail-link-status')[0],
      ]) : []);
      const pressed = (className) => byClass(root, className)
        .map((button) => `${button.attrs['aria-pressed']} ${classesOf(button).includes('graph-view-filter-active') ? 'active' : 'inactive'}`);
      return {
        nodes: Object.fromEntries(nodes.map((node) => {
          const chip = elements.get(node.card);
          if (!chip) return [node.card, 'not exactly one element'];
          const box = boxes.get(node.card);
          const css = cssEffective(chip.style.cssText);
          const glyphs = byClass(chip, 'graph-view-status-glyph');
          return [node.card, {
            dimmed: classesOf(chip).includes('graph-view-dimmed'),
            dimStyle: chip.style.cssText.endsWith(dimTail),
            selected: heading !== null && heading === headingOf(node),
            cell: [lefts.indexOf(box.left), tops.indexOf(box.top)],
            status: {
              classes: classesOf(chip).filter((name) => name.startsWith('status-')),
              color: css.color ?? null,
              border: css.border ?? null,
              background: css.background ?? null,
              opacity: css.opacity ?? null,
              glyph: glyphs.map((glyph) => glyph.textContent),
              glyphClass: glyphs.map((glyph) => glyph.className),
              glyphColor: glyphs.map((glyph) => cssEffective(glyph.style.cssText).color ?? null),
            },
          }];
        })),
        edges,
        cards: panels.length,
        card: panel ? {
          heading: JSON.parse(heading),
          status: byClass(panel, 'graph-view-detail-status').map((node) => `${node.textContent} | ${node.className}`),
          labels: textsOf(panel, 'graph-view-detail-label'),
          wait: textsOf(panel, 'graph-view-detail-wait'),
          unmet: links('graph-view-detail-prerequisite'),
          outcome: textsOf(panel, 'graph-view-detail-outcome-value'),
          gates: textsOf(panel, 'graph-view-detail-gates-count'),
          dependents: links('graph-view-detail-dependent'),
          buttons: [...textsOf(panel, 'graph-view-detail-open'), ...textsOf(panel, 'graph-view-detail-close')],
          digest: digestOf(panel),
        } : null,
        stuck: pressed('graph-view-filter-stuck'),
        dimDone: pressed('graph-view-filter-done'),
        canvases: byClass(root, 'graph-view-canvas').length,
        summary: textsOf(root, 'graph-view-stuck-summary'),
        legend: byClass(root, 'graph-view-legend-entry').map((entry) => `${entry.className} | `
          + `${textsOf(entry, 'graph-view-legend-glyph').join()} | ${textsOf(entry, 'graph-view-legend-label').join()}`),
        warningRows: textsOf(root, 'graph-view-warning'),
        warnings: warnings ? JSON.parse(JSON.stringify(warnings)) : null,
        opened,
      };
    };
    const targetOf = (kind, root, nodes, [verb, card]) => {
      if (verb === 'tap') return elementsOf(kind, root, nodes).get(card) || null;
      const className = {
        clear: 'graph-view-canvas', stuck: 'graph-view-filter-stuck', done: 'graph-view-filter-done',
        open: 'graph-view-detail-open', close: 'graph-view-detail-close',
      }[verb];
      return className ? byClass(root, className)[0] || null : null;
    };
    const stepsFor = (nodes, pick) => {
      const taps = nodes.map((node) => ['tap', node.card]);
      return [
        ['rest'],
        ...nodes.flatMap((node) => [['tap', node.card], ['tap', node.card]]),
        ['open'], ['clear'],
        ['stuck'], ...taps, ['close'], ['stuck'],
        ['done'], ...taps, ['clear'], ['done'],
        ['stuck'], ['done'], ...taps, ['clear'], ['done'], ['stuck'],
        ['tap', pick], ['stuck'], ['done'], ['clear'], ['stuck'], ['done'],
        ['rest'],
      ];
    };
    const walk = (card, edges, forward) => {
      const seen = new Set();
      const queue = [card];
      while (queue.length) {
        const at = queue.shift();
        for (const edge of edges) {
          if (edge.kind !== 'depends') continue;
          const next = forward ? (edge.from === at ? edge.to : null) : (edge.to === at ? edge.from : null);
          if (next && next !== card && !seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      return seen;
    };
    const completedCards = (fixture) => fixture.nodes
      .filter((node) => delivery.normalizeStatus(node.status) === 'completed').map((node) => node.card);
    const openedFor = (fixture, node) => [[String(node.path).replace(/\.md$/, ''), fixture.source, false]];
    // The model: the selection and the two filter states each step leaves,
    // moved by the step alone. With GraphInsights a tap on an unselected node
    // selects it; without GraphInsights a tap opens the node. A tap on the
    // selected node, and Open slice while a node is selected, open that node.
    // A canvas click and Close drop the selection. A Stuck click toggles
    // Stuck when the fixture has GraphInsights; a Dim done click toggles Dim
    // done. rest changes nothing. advance() returns the notes the step opens.
    const advance = (fixture, model, [verb, card]) => {
      const byCard = new Map(fixture.nodes.map((node) => [node.card, node]));
      let opened = [];
      if (verb === 'tap') {
        if (!fixture.insights || model.selected === card) opened = openedFor(fixture, byCard.get(card));
        else model.selected = card;
      } else if (verb === 'open') {
        if (model.selected) opened = openedFor(fixture, byCard.get(model.selected));
      } else if (verb === 'clear' || verb === 'close') {
        model.selected = null;
      } else if (verb === 'stuck') {
        if (fixture.insights) model.stuck = !model.stuck;
      } else if (verb === 'done') {
        model.dimDone = !model.dimDone;
      }
      return opened;
    };
    // expectedOf() returns the object projectedOf() must read for the model:
    //   statuses: for each slice, the className, color, and glyph that
    //     EpicDashboard._statusPresentation returns for its status; for each
    //     stub, no status class, the color var(--text-muted), and no glyph;
    //   with a node selected: dimmed, the fixture nodes outside the node's
    //     closure (the node and a breadth-first walk of the fixture's depends
    //     edges in each direction); emphasized, the fixture's depends edges
    //     with both ends in the closure; one card whose heading is the node's
    //     id and title; for a stub, no status row, Unmet prerequisites,
    //     Dependents, or Gates; for a slice, one status row, Unmet
    //     prerequisites the ids of the sources of the depends edges into the
    //     node that are stubs or whose status delivery.normalizeStatus does
    //     not read as completed, Dependents the ids of the nodes the
    //     downstream walk reaches that are not stubs, whose status is not
    //     null, and whose status, trimmed and lower-cased, is not
    //     'completed', and Gates the count of those Dependents as
    //     "N slice(s)";
    //   with nothing selected: dimmed, the fixture nodes outside the
    //     fixture's hand-pinned Stuck keep-set while Stuck is on, together
    //     with the nodes whose status delivery.normalizeStatus reads as
    //     completed while Dim done is on; no emphasized edge; no card;
    //   in both cases: dimStyled equal to dimmed; selected, the selected
    //     node or none; each button 'true active' while its filter is on and
    //     'false inactive' otherwise; summary, the fixture's literal; opened,
    //     what advance() returned.
    const expectedOf = (fixture, model, opened) => {
      const pressed = (on) => [on ? 'true active' : 'false inactive'];
      const byCard = new Map(fixture.nodes.map((entry) => [entry.card, entry]));
      let dimmed;
      let emphasized = [];
      let card = null;
      if (model.selected) {
        const node = byCard.get(model.selected);
        const down = walk(node.card, fixture.edges, true);
        const chain = new Set([node.card, ...walk(node.card, fixture.edges, false), ...down]);
        dimmed = fixture.nodes.filter((entry) => !chain.has(entry.card)).map((entry) => entry.card);
        emphasized = fixture.edges.filter((edge) => edge.kind === 'depends' && chain.has(edge.from) && chain.has(edge.to))
          .map((edge) => `${edge.from} -> ${edge.to}`).sort();
        const unmet = fixture.edges.filter((edge) => edge.kind === 'depends' && edge.to === node.card)
          .map((edge) => byCard.get(edge.from))
          .filter((entry) => entry.isStub || delivery.normalizeStatus(entry.status) !== 'completed').map(idOf);
        const dependents = fixture.nodes.filter((entry) => down.has(entry.card) && !entry.isStub && entry.status !== null
          && String(entry.status).trim().toLowerCase() !== 'completed').map(idOf);
        card = node.isStub
          ? { heading: JSON.parse(headingOf(node)), statusRows: 0, unmet: [], dependents: [], gates: [] }
          : {
            heading: JSON.parse(headingOf(node)), statusRows: 1, unmet: unmet.sort(), dependents: dependents.sort(),
            gates: [`${dependents.length} slice${dependents.length === 1 ? '' : 's'}`],
          };
      } else {
        const keep = new Set(fixture.keep);
        const completed = new Set(completedCards(fixture));
        dimmed = fixture.nodes.filter((entry) => (model.stuck && !keep.has(entry.card))
          || (model.dimDone && completed.has(entry.card))).map((entry) => entry.card);
      }
      const statuses = Object.fromEntries(fixture.nodes.map((entry) => {
        if (entry.isStub) return [entry.card, { classes: [], color: 'var(--text-muted)', glyph: [] }];
        const presentation = dashboard._statusPresentation(entry.status, lifecycleApi);
        return [entry.card, { classes: [presentation.className], color: presentation.color, glyph: [presentation.glyph] }];
      }));
      return {
        statuses, dimmed, dimStyled: dimmed, selected: model.selected ? [model.selected] : [], emphasized,
        cards: card ? 1 : 0, card, stuck: pressed(model.stuck), dimDone: pressed(model.dimDone),
        summary: fixture.summary, opened,
      };
    };
    const projectedOf = (fixture, state) => ({
      statuses: Object.fromEntries(fixture.nodes.map((node) => [node.card, state.nodes[node.card]?.status
        ? { classes: state.nodes[node.card].status.classes, color: state.nodes[node.card].status.color, glyph: state.nodes[node.card].status.glyph }
        : null])),
      dimmed: fixture.nodes.filter((node) => state.nodes[node.card]?.dimmed === true).map((node) => node.card),
      dimStyled: fixture.nodes.filter((node) => state.nodes[node.card]?.dimStyle === true).map((node) => node.card),
      selected: fixture.nodes.filter((node) => state.nodes[node.card]?.selected === true).map((node) => node.card),
      emphasized: state.edges.filter((edge) => edge.includes(' emphasized')).map((edge) => edge.split(' depends')[0]).sort(),
      cards: state.cards,
      card: state.card ? {
        heading: state.card.heading,
        statusRows: state.card.status.length,
        unmet: state.card.unmet.map(([id]) => id).sort(),
        dependents: state.card.dependents.map(([id]) => id).sort(),
        gates: state.card.gates,
      } : null,
      stuck: state.stuck,
      dimDone: state.dimDone,
      summary: state.summary,
      opened: state.opened,
    });
    const run = async (fixture) => {
      const drawn = {};
      for (const kind of ['compact', 'wide']) drawn[kind] = await fixture.draw(kind);
      for (const kind of ['compact', 'wide']) {
        const elements = elementsOf(kind, drawn[kind].root, fixture.nodes);
        assert([...elements.values()].every(Boolean) && byClass(drawn[kind].root, 'graph-view-chip').length === fixture.nodes.length
          && byClass(drawn[kind].root, 'graph-view-pill').length === (kind === 'compact' ? fixture.nodes.length : 0),
        `PH1D-COMPACT-WIDE-PARITY: ${fixture.label}: each of the ${fixture.nodes.length} nodes maps to exactly one ${kind === 'compact' ? 'compact pill' : 'wide chip'}, the drawing holds exactly that many graph-view-chip elements, and ${kind === 'compact' ? 'as many graph-view-pill elements' : 'no graph-view-pill element'}`);
      }
      const model = { selected: null, stuck: false, dimDone: false };
      const readings = [];
      for (const [index, step] of stepsFor(fixture.nodes, fixture.pick).entries()) {
        const pair = {};
        for (const kind of ['compact', 'wide']) {
          const { root, opened, warnings } = drawn[kind];
          const before = opened.length;
          const target = targetOf(kind, root, fixture.nodes, step);
          if (target) bubblingClick(target);
          pair[kind] = read(kind, root, fixture.nodes, opened.slice(before), warnings);
        }
        const at = `PH1D-COMPACT-WIDE-PARITY: ${fixture.label}, step ${index} (${step.join(' ')})`;
        assert.deepStrictEqual(pair.compact, pair.wide,
          `${at}: the compact reading equals the wide reading (the whole object read() returns)`);
        const opened = advance(fixture, model, step);
        assert.deepStrictEqual(projectedOf(fixture, pair.compact), expectedOf(fixture, model, opened),
          `${at}: the compact reading matches the fixture model (the whole object projectedOf() returns equals expectedOf())`);
        readings.push({ step, state: pair.compact });
      }
      return readings;
    };
    return { run, idOf };
  })();
  const ph1dFarBoard = 'spice/projects/phone/tasks/Far Epic/board';
  const ph1dWithFarSlices = (env, farFiles) => {
    const ownFiles = env.app.vault.getMarkdownFiles;
    env.app.vault.getMarkdownFiles = () => [...ownFiles(), ...farFiles];
    const ownCache = env.app.metadataCache.getFileCache;
    env.app.metadataCache.getFileCache = (entry) => (farFiles.includes(entry)
      ? { frontmatter: { type: 'slice', status: 'planning', depends_on: [] } }
      : ownCache(entry));
    return env;
  };
  // The render() fixture: six slices whose statuses are 'COMPLETED',
  // 'Parked', ' blocked ', 'in-progress', 'planning', and 'garbled', two of
  // them depending on slices on another epic's board (drawn as the
  // cross-epic stubs PB-1 and PB-2). PA-5 also depends on PZ-0 Nowhere, which
  // resolves to no slice, so the layout reports a dangling_dependency
  // warning. PA-2 is the one root blocker; Stuck keeps PA-2 and PA-3.
  // MUTATION GUARD: PH1D-MUTANT-NARROW-DROPS-LAYOUT-WARNINGS-WITH-STUBS turns RED
  // at "PH1D-COMPACT-WIDE-PARITY: render() of six slices and two cross-epic
  // stubs, step 0 (rest): the compact reading equals the wide reading ..." if
  // a narrow render() with cross-epic stubs leaves the layout's warnings out
  // of its warning strip. ph1dRenderFixture(label, drawCompact) builds a fresh
  // environment for it; its wide drawing is render() at a containerWidth
  // override of 1024, and its compact drawing is the root drawCompact(env)
  // returns.
  const ph1dParitySlices = [
    { card: 'PA-1 Base', status: 'COMPLETED', outcome: 'The base shipped.' },
    { card: 'PA-2 Parked', status: 'Parked', depends_on: ['[[PA-1 Base]]'], resume_condition: 'Director decision', outcome: 'The parked slice resumes.' },
    { card: 'PA-3 Blocked', status: ' blocked ', depends_on: ['[[PB-1 Far One]]', '[[PA-2 Parked]]'] },
    { card: 'PA-4 Flow', status: 'in-progress', depends_on: ['[[PA-3 Blocked]]'], outcome: 'The flow lands.' },
    { card: 'PA-5 Loose', status: 'planning', depends_on: ['[[PB-2 Far Two]]', '[[PZ-0 Nowhere]]'] },
    { card: 'PA-6 Garbled', status: 'garbled', depends_on: ['[[PA-1 Base]]'] },
  ];
  const ph1dRenderFixture = (label, drawCompact) => {
    const env = ph1dWithFarSlices(epicEnv({
      dir: 'spice/projects/phone/tasks/Parity Epic', name: 'Parity Epic',
      slices: ph1dParitySlices, laneOrder: ph1dParitySlices.map((slice) => slice.card),
    }), [file(`${ph1dFarBoard}/PB-1 Far One.md`, 40), file(`${ph1dFarBoard}/PB-2 Far Two.md`, 41)]);
    return {
      env,
      label,
      insights: true,
      source: env.epicPath,
      nodes: [
        ...ph1dParitySlices.map((slice) => ({ card: slice.card, status: slice.status, path: `${env.boardDir}/${slice.card}.md` })),
        { card: 'PB-1 Far One', status: null, isStub: true, stubLabel: 'Far Epic · PB-1', path: `${ph1dFarBoard}/PB-1 Far One.md` },
        { card: 'PB-2 Far Two', status: null, isStub: true, stubLabel: 'Far Epic · PB-2', path: `${ph1dFarBoard}/PB-2 Far Two.md` },
      ],
      edges: [
        { from: 'PA-1 Base', to: 'PA-2 Parked', kind: 'depends' },
        { from: 'PA-2 Parked', to: 'PA-3 Blocked', kind: 'depends' },
        { from: 'PA-3 Blocked', to: 'PA-4 Flow', kind: 'depends' },
        { from: 'PA-1 Base', to: 'PA-6 Garbled', kind: 'depends' },
        { from: 'PB-1 Far One', to: 'PA-3 Blocked', kind: 'depends' },
        { from: 'PB-2 Far Two', to: 'PA-5 Loose', kind: 'depends' },
      ],
      keep: ['PA-2 Parked', 'PA-3 Blocked'],
      summary: ['1 root blocker · gating 2 slices'],
      pick: 'PA-3 Blocked',
      draw: async (kind) => {
        let root;
        if (kind === 'compact') {
          root = await drawCompact(env);
        } else {
          const container = element();
          await new GraphView({ lifecycleApi, insights: new GraphInsights() })
            .render({ container }, { containerWidth: 1024 });
          root = container.children[0];
        }
        return { root, opened: env.opened, warnings: null };
      },
    };
  };
  {
    const savedApp = global.app;
    const savedCustomJS = global.customJS;
    const farBoard = ph1dFarBoard;
    const withFarSlices = ph1dWithFarSlices;
    const renderFixture = ph1dRenderFixture('render() of six slices and two cross-epic stubs', async () => {
      const container = element();
      await new GraphView({ lifecycleApi, insights: new GraphInsights() }).render({ container }, { containerWidth: 390 });
      return container.children[0];
    });
    const parityEnv = renderFixture.env;
    ph1dUseEnv(parityEnv);
    const renderReadings = await ph1dParity.run(renderFixture);

    // ---- PH1D-CARD-UNDER-MAP ----
    // render() of the render() fixture at an override of 390 draws two
    // cross-epic stubs. After a tap on the PA-3 slice pill, and again after a
    // tap on the PB-1 stub pill, the container holds one detail card, and in
    // the compact host the filter toolbar comes before the map, the map
    // before the legend, and the card is the child directly after the legend
    // and the host's last child.
    // MUTATION GUARD: PH1D-MUTANT-LEGEND-ABOVE-MAP-WITH-STUBS (C21) turns RED
    // at "PH1D-CARD-UNDER-MAP: with two cross-epic stubs drawn at 390, a tap
    // on the PA-3 slice pill ..." if the compact legend is moved above the
    // map when stubs are present.
    {
      const container = element();
      await new GraphView({ lifecycleApi, insights: new GraphInsights() }).render({ container }, { containerWidth: 390 });
      const host = byClass(container.children[0], 'graph-view-compact')[0];
      const pillFor = (title) => byClass(host, 'graph-view-pill').find((pill) => pill.attrs.title === title);
      for (const [name, title] of [['the PA-3 slice pill', 'PA-3 Blocked'], ['the PB-1 stub pill', 'Far Epic · PB-1']]) {
        const pill = pillFor(title);
        if (pill) bubblingClick(pill);
        const order = host.children.map((child) => String(child.className).split(/\s+/));
        const at = (className) => order.findIndex((names) => names.includes(className));
        assert(pill && byClass(host, 'graph-view-stub').length === 2 && byClass(container, 'graph-view-detail-panel').length === 1
          && at('graph-view-filter-toolbar') >= 0 && at('graph-view-filter-toolbar') < at('graph-view-compact-scroll')
          && at('graph-view-compact-scroll') < at('graph-view-legend')
          && at('graph-view-detail-panel') === at('graph-view-legend') + 1 && at('graph-view-detail-panel') === order.length - 1,
        `PH1D-CARD-UNDER-MAP: with two cross-epic stubs drawn at 390, a tap on ${name} leaves one card in the compact host directly after the legend, and the host orders toolbar, map, legend, card`);
      }
    }

    // The direct-draw fixtures: _renderCompactGraph at 390 and _renderGraph
    // (which takes no width) over one handed-in layout result whose slice
    // statuses are ' blocked ', 'Parked', 'COMPLETED', 'in_progress',
    // 'garbled', ' Completed ' (PC-2, a dependent of PC-6), and 'completed'
    // (PC-7), with three cross-epic stubs: PX-9, whose status is 'Parked', a
    // prerequisite of PC-1; PX-7, on the path PC-1 -> PX-7 -> PC-7 -> PC-3;
    // and PX-8, whose status is 'COMPLETED', in the first rank. PC-1 is the
    // one root blocker (PC-3's ancestors include PC-1 through PX-7 and PC-7);
    // Stuck keeps PC-1, PX-7, PC-3, and the completed PC-7 on the path between
    // them.
    const craftSlices = [
      { card: 'PC-1 Root', status: 'blocked', outcome: 'The root unblocks.' },
      { card: 'PC-3 Parked', status: 'parked', outcome: 'The parked slice resumes.' },
      { card: 'PC-4 Done', status: 'completed', outcome: 'The done slice shipped.' },
      { card: 'PC-5 Next', status: 'in_progress' },
      { card: 'PC-6 Odd', status: 'garbled' },
      { card: 'PC-2 Shipped', status: 'completed', outcome: 'The shipped slice landed.' },
      { card: 'PC-7 Bridge', status: 'completed' },
    ];
    const craftEnv = epicEnv({
      dir: 'spice/projects/phone/tasks/Craft Epic', name: 'Craft Epic',
      slices: craftSlices, laneOrder: craftSlices.map((slice) => slice.card),
    });
    const craftPath = (card) => `${craftEnv.boardDir}/${card}.md`;
    const craftNodes = [
      { card: 'PC-1 Root', path: craftPath('PC-1 Root'), status: ' blocked ', rank: 0, row: 0, waitReason: 'waiting on: PX-9 Far Stub' },
      { card: 'PX-7 Relay', path: 'spice/projects/phone/tasks/Relay Epic/board/PX-7 Relay.md', status: null, rank: 1, row: 0, isStub: true, stubLabel: 'Relay Epic · PX-7' },
      { card: 'PC-3 Parked', path: craftPath('PC-3 Parked'), status: 'Parked', rank: 2, row: 0, waitReason: 'Director decision' },
      { card: 'PC-4 Done', path: craftPath('PC-4 Done'), status: 'COMPLETED', rank: 0, row: 1 },
      { card: 'PX-8 Shipped', path: 'spice/projects/phone/tasks/Done Epic/board/PX-8 Shipped.md', status: 'COMPLETED', rank: 0, row: 2, isStub: true, stubLabel: 'Done Epic · PX-8' },
      { card: 'PC-5 Next', path: craftPath('PC-5 Next'), status: 'in_progress', rank: 3, row: 0 },
      { card: 'PX-9 Far Stub', path: `${farBoard}/PX-9 Far Stub.md`, status: 'Parked', rank: 3, row: 1, isStub: true, stubLabel: 'Far Epic · PX-9' },
      { card: 'PC-6 Odd', path: craftPath('PC-6 Odd'), status: 'garbled', rank: 2, row: 1 },
      { card: 'PC-2 Shipped', path: craftPath('PC-2 Shipped'), status: ' Completed ', rank: 3, row: 2 },
      { card: 'PC-7 Bridge', path: craftPath('PC-7 Bridge'), status: 'completed', rank: 1, row: 1 },
    ];
    const craftEdges = [
      { from: 'PX-9 Far Stub', to: 'PC-1 Root', kind: 'depends', cross: true },
      { from: 'PC-1 Root', to: 'PX-7 Relay', kind: 'depends', cross: true },
      { from: 'PX-7 Relay', to: 'PC-7 Bridge', kind: 'depends', cross: true },
      { from: 'PC-7 Bridge', to: 'PC-3 Parked', kind: 'depends' },
      { from: 'PC-4 Done', to: 'PC-3 Parked', kind: 'depends' },
      { from: 'PX-8 Shipped', to: 'PC-5 Next', kind: 'depends', cross: true },
      { from: 'PC-3 Parked', to: 'PC-5 Next', kind: 'depends' },
      { from: 'PC-4 Done', to: 'PC-6 Odd', kind: 'order' },
      { from: 'PC-6 Odd', to: 'PC-2 Shipped', kind: 'depends' },
    ];
    const craftDraw = (insights) => async (kind) => {
      const root = element();
      const warnings = [];
      const view = new GraphView({ dashboard, lifecycleApi, insights });
      const result = { nodes: craftNodes.map((node) => ({ ...node })), edges: craftEdges.map((edge) => ({ ...edge })) };
      if (kind === 'compact') await view._renderCompactGraph(root, result, lifecycleApi, craftEnv.epicPath, warnings, 390);
      else await view._renderGraph(root, result, lifecycleApi, craftEnv.epicPath, warnings);
      return { root, opened: craftEnv.opened, warnings };
    };
    const craftFixture = {
      label: 'a handed-in layout result with three cross-epic stubs',
      insights: true,
      source: craftEnv.epicPath,
      nodes: craftNodes,
      edges: craftEdges,
      keep: ['PC-1 Root', 'PX-7 Relay', 'PC-3 Parked', 'PC-7 Bridge'],
      summary: ['1 root blocker · gating 2 slices'],
      pick: 'PC-1 Root',
      draw: craftDraw(new GraphInsights()),
    };
    ph1dUseEnv(craftEnv);
    const craftReadings = await ph1dParity.run(craftFixture);
    await ph1dParity.run({
      ...craftFixture,
      label: 'the same handed-in result without GraphInsights',
      insights: false,
      summary: [],
      draw: craftDraw({}),
    });
    assert(['Parked', ' blocked ', 'COMPLETED'].every((status) => craftNodes.some((node) => node.status === status
      && delivery.normalizeStatus(status) !== status && delivery.normalizeStatus(status) !== null)),
    'PH1D-COMPACT-WIDE-PARITY: the handed-in result carries the statuses \'Parked\', \' blocked \', and \'COMPLETED\', each of which delivery.normalizeStatus reads as a different, registered status');
    const stubIds = [...renderFixture.nodes, ...craftNodes].filter((node) => node.isStub).map(ph1dParity.idOf);
    const sliceCards = new Set([...renderFixture.nodes, ...craftNodes].filter((node) => !node.isStub).map((node) => node.card));
    assert([renderReadings, craftReadings].every((readings) => readings.some(({ step, state }) => step[0] === 'tap'
      && sliceCards.has(step[1]) && state.card && state.card.unmet.some(([id]) => stubIds.includes(id)))),
    'PH1D-COMPACT-WIDE-PARITY: in both fixtures with GraphInsights, a tap on a slice opens a card whose Unmet prerequisites list a cross-epic stub');
    assert.deepStrictEqual([...parityEnv.mutations, ...craftEnv.mutations], [],
      'PH1D-COMPACT-WIDE-PARITY: the parity fixtures\' renders and interactions invoke no vault, adapter, frontmatter, or metadata mutator');

    // ---- PH1D-SHORT-ID-STUB ----
    // render() at an override of 390 of four chained GA- slices, the last of
    // which depends on GA-Z9 Far Away on another epic's board: five ranks,
    // 69px columns (floor((390 - 4 - 40) / 5)), and every id, the stub's
    // included, shares the GA prefix, so each pill shows its id without it:
    // S1 S2 S3 S4 at lefts 2 81 160 239, and the stub Z9 at 318, on a 389px
    // canvas. The stub pill's tooltip is its epic · id label.
    // MUTATION GUARD: PH1D-MUTANT-STUB-FULL-ID-WHEN-SHORT (C15) turns RED at
    // "PH1D-SHORT-ID-STUB: at an override of 390, four GA- slices ..." if a
    // stub pill shows its full card name when ids are shortened.
    {
      const shortSlices = [
        { card: 'GA-S1 Short 1', status: 'planning' },
        { card: 'GA-S2 Short 2', status: 'planning', depends_on: ['[[GA-S1 Short 1]]'] },
        { card: 'GA-S3 Short 3', status: 'planning', depends_on: ['[[GA-S2 Short 2]]'] },
        { card: 'GA-S4 Short 4', status: 'planning', depends_on: ['[[GA-S3 Short 3]]', '[[GA-Z9 Far Away]]'] },
      ];
      ph1dUseEnv(withFarSlices(epicEnv({
        dir: 'spice/projects/phone/tasks/Short Epic', name: 'Short Epic',
        slices: shortSlices, laneOrder: shortSlices.map((slice) => slice.card),
      }), [file(`${farBoard}/GA-Z9 Far Away.md`, 42)]));
      const container = element();
      await new GraphView({ lifecycleApi, insights: new GraphInsights() }).render({ container }, { containerWidth: 390 });
      const root = container.children[0];
      const stub = byClass(root, 'graph-view-stub')[0];
      assert.deepStrictEqual({
        drawing: ph1dCompactDrawing(root),
        stub: stub ? [byClass(stub, 'graph-view-pill-id')[0]?.textContent, stub.attrs.title] : null,
      }, {
        drawing: {
          pills: [
            ['S1', '2px', '2px', '69px', '26px'], ['S2', '81px', '2px', '69px', '26px'], ['S3', '160px', '2px', '69px', '26px'],
            ['S4', '239px', '2px', '69px', '26px'], ['Z9', '318px', '2px', '69px', '26px'],
          ],
          canvas: 'position:relative;width:389px;height:30px;',
          padding: '0px',
        },
        stub: ['Z9', 'Far Epic · GA-Z9'],
      }, 'PH1D-SHORT-ID-STUB: at an override of 390, four GA- slices and the GA-Z9 cross-epic stub draw 69px pills labelled S1 S2 S3 S4 Z9 on a 389px canvas, and the stub pill\'s tooltip is Far Epic · GA-Z9');
    }

    // ---- PH1D-SHORT-ID-MIXED ----
    // render() of chained slices, the last of which depends on a slice on
    // another epic's board, at containerWidth overrides that make colW < 72.
    // At 390 there are five ranks: 69px pills at lefts 2 81 160 239 318 on a
    // 389px canvas, and every pill keeps its full id when
    //   the slices are GA-S1..GA-S4 and the stub is FL-Z9;
    //   the slices are GA-S1..GA-S4 and the stub is Far Away Notes, whose
    //     card has no parseable id (its pill shows the card name);
    //   the slices are GA-S1, GA-S2, GB-S3, GA-S4 and the stub is GA-Z9.
    // At 300, the slices GA-S1..GA-S3 and the stub GA-Z9 are four ranks with
    // colW floor((300 - 4 - 30) / 4) = 66, and the pills read S1 S2 S3 Z9 at
    // lefts 2 78 154 230 on a 298px canvas.
    // MUTATION GUARD: PH1D-MUTANT-SHORT-ID-PREFIX-FROM-SLICES (D6B) turns RED at
    // "PH1D-SHORT-ID-MIXED: at an override of 390, GA-S1..GA-S4 and the FL-Z9
    // cross-epic stub ..." if stubs are left out of the shared-prefix check.
    // MUTATION GUARD: PH1D-MUTANT-IDLESS-STUB-ALLOWS-SHORT-IDS (D6C) turns RED at
    // "PH1D-SHORT-ID-MIXED: at an override of 390, GA-S1..GA-S4 and the
    // idless cross-epic stub ..." if a stub whose card has no parseable id
    // does not stop ids from shortening.
    // MUTATION GUARD: PH1D-MUTANT-FOREIGN-STUB-STRIPPED (D6D) turns RED at
    // "PH1D-SHORT-ID-MIXED: at an override of 390, GA-S1..GA-S4 and the FL-Z9
    // cross-epic stub ..." if a stub with another prefix is left out of the
    // check and loses its own prefix.
    // MUTATION GUARD: PH1D-MUTANT-SHORT-ID-SLICE-PREFIX-ONLY (D6E) turns RED at
    // the same label if stubs are left out of the shared-prefix check and
    // every id is cut at the slices' prefix length.
    // MUTATION GUARD: PH1D-MUTANT-SHORT-IDS-FIVE-RANKS (D3) turns RED at
    // "PH1D-SHORT-ID-MIXED: at an override of 300, GA-S1..GA-S3 and the GA-Z9
    // cross-epic stub ..." if ids shorten only on maps of five or more ranks.
    {
      const chainOf = (ids, far) => ids.map((id, index) => ({
        card: `${id} Short ${index + 1}`,
        status: 'planning',
        depends_on: [
          ...(index ? [`[[${ids[index - 1]} Short ${index}]]`] : []),
          ...(index === ids.length - 1 ? [`[[${far}]]`] : []),
        ],
      }));
      const drawnAt = async (name, ids, far, width) => {
        const slices = chainOf(ids, far);
        ph1dUseEnv(withFarSlices(epicEnv({
          dir: `spice/projects/phone/tasks/${name}`, name,
          slices, laneOrder: slices.map((slice) => slice.card),
        }), [file(`${farBoard}/${far}.md`, 60)]));
        const container = element();
        await new GraphView({ lifecycleApi, insights: new GraphInsights() }).render({ container }, { containerWidth: width });
        return ph1dCompactDrawing(container.children[0]);
      };
      const fiveAt390 = (labels) => ({
        pills: labels.map((label, index) => [label, `${2 + index * 79}px`, '2px', '69px', '26px']),
        canvas: 'position:relative;width:389px;height:30px;',
        padding: '0px',
      });
      assert.deepStrictEqual(await drawnAt('Short Foreign Stub', ['GA-S1', 'GA-S2', 'GA-S3', 'GA-S4'], 'FL-Z9 Far Away', 390),
        fiveAt390(['GA-S1', 'GA-S2', 'GA-S3', 'GA-S4', 'FL-Z9']),
        'PH1D-SHORT-ID-MIXED: at an override of 390, GA-S1..GA-S4 and the FL-Z9 cross-epic stub draw 69px pills labelled GA-S1 GA-S2 GA-S3 GA-S4 FL-Z9 on a 389px canvas');
      assert.deepStrictEqual(await drawnAt('Short Idless Stub', ['GA-S1', 'GA-S2', 'GA-S3', 'GA-S4'], 'Far Away Notes', 390),
        fiveAt390(['GA-S1', 'GA-S2', 'GA-S3', 'GA-S4', 'Far Away Notes']),
        'PH1D-SHORT-ID-MIXED: at an override of 390, GA-S1..GA-S4 and the idless cross-epic stub Far Away Notes draw 69px pills labelled GA-S1 GA-S2 GA-S3 GA-S4 Far Away Notes on a 389px canvas');
      assert.deepStrictEqual(await drawnAt('Short Foreign Slice', ['GA-S1', 'GA-S2', 'GB-S3', 'GA-S4'], 'GA-Z9 Far Away', 390),
        fiveAt390(['GA-S1', 'GA-S2', 'GB-S3', 'GA-S4', 'GA-Z9']),
        'PH1D-SHORT-ID-MIXED: at an override of 390, GA-S1 GA-S2 GB-S3 GA-S4 and the GA-Z9 cross-epic stub draw 69px pills labelled GA-S1 GA-S2 GB-S3 GA-S4 GA-Z9 on a 389px canvas');
      assert.deepStrictEqual(await drawnAt('Short Four Ranks', ['GA-S1', 'GA-S2', 'GA-S3'], 'GA-Z9 Far Away', 300), {
        pills: [
          ['S1', '2px', '2px', '66px', '26px'], ['S2', '78px', '2px', '66px', '26px'],
          ['S3', '154px', '2px', '66px', '26px'], ['Z9', '230px', '2px', '66px', '26px'],
        ],
        canvas: 'position:relative;width:298px;height:30px;',
        padding: '0px',
      }, 'PH1D-SHORT-ID-MIXED: at an override of 300, GA-S1..GA-S3 and the GA-Z9 cross-epic stub draw 66px pills labelled S1 S2 S3 Z9 on a 298px canvas');
    }

    // ---- PH1D-STUB-WITHOUT-LABEL ----
    // A handed-in cross-epic stub with no stubLabel carries its card name as
    // its compact pill's tooltip and as its wide stub chip's label.
    // MUTATION GUARD: PH1D-MUTANT-STUB-TOOLTIP-LABEL-ONLY (D16) turns RED at
    // "PH1D-STUB-WITHOUT-LABEL: a handed-in cross-epic stub with no stubLabel
    // ..." if a compact stub pill's tooltip falls back to an empty string.
    {
      const result = () => ({
        nodes: [
          { card: 'GA-S1 Short 1', path: `${board}/GA-S1 Short 1.md`, status: 'planning', rank: 0, row: 0 },
          { card: 'GX-9 Unlabelled', path: `${farBoard}/GX-9 Unlabelled.md`, status: null, rank: 1, row: 0, isStub: true },
        ],
        edges: [{ from: 'GX-9 Unlabelled', to: 'GA-S1 Short 1', kind: 'depends', cross: true }],
      });
      const compactRoot = element();
      await new GraphView({ dashboard, lifecycleApi, insights: new GraphInsights() })
        ._renderCompactGraph(compactRoot, result(), lifecycleApi, epicPath, [], 390);
      const wideRoot = element();
      await new GraphView({ dashboard, lifecycleApi, insights: new GraphInsights() })
        ._renderGraph(wideRoot, result(), lifecycleApi, epicPath, []);
      assert.deepStrictEqual([
        byClass(compactRoot, 'graph-view-stub').map((pill) => pill.attrs.title),
        byClass(wideRoot, 'graph-view-stub-label').map((label) => label.textContent),
      ], [['GX-9 Unlabelled'], ['GX-9 Unlabelled']],
      'PH1D-STUB-WITHOUT-LABEL: a handed-in cross-epic stub with no stubLabel carries GX-9 Unlabelled as its compact pill\'s tooltip and as its wide stub chip\'s label');
    }

    // ---- PH1D-ONE-INSTANCE-TWO-EPICS ----
    // One GraphView instance renders the epic Twin One (TA-1, TA-2) and then
    // the epic Twin Two (TB-1, TB-2), each slice with its own Outcome, at a
    // containerWidth override of 390, and then both again at 1024. At each
    // width, after both epics are drawn, a tap on TA-2 leaves one card in
    // Twin One's drawing, with TA-2's id and Outcome, and none in Twin Two's;
    // then a tap on TB-2 leaves one card in Twin Two's drawing, with TB-2's id
    // and Outcome.
    // MUTATION GUARD: PH1D-MUTANT-COMPACT-SELECT-ON-INSTANCE (B4) turns RED at
    // "PH1D-ONE-INSTANCE-TWO-EPICS: at a containerWidth override of 390 ..."
    // if compact pills call the selection of the instance's latest compact
    // render.
    // MUTATION GUARD: PH1D-MUTANT-COMPACT-OUTCOMES-ON-INSTANCE (B5) turns RED at
    // the same label if the compact map reuses the Outcomes the instance
    // loaded first.
    // MUTATION GUARD: PH1D-MUTANT-COMPACT-OUTCOMES-BY-COUNT (B8) turns RED at
    // the same label if the compact map reuses Outcomes loaded for an epic
    // with the same number of nodes.
    // MUTATION GUARD: PH1D-MUTANT-WIDE-OUTCOMES-ON-INSTANCE (WB5) turns RED at
    // "PH1D-ONE-INSTANCE-TWO-EPICS: at a containerWidth override of 1024 ..."
    // if the wide canvas reuses the Outcomes the instance loaded first.
    {
      const twin = (name, prefix) => epicEnv({
        dir: `spice/projects/phone/tasks/${name}`, name,
        slices: [
          { card: `${prefix}-1 First`, status: 'planning', outcome: `${name} first lands.` },
          { card: `${prefix}-2 Second`, status: 'planning', depends_on: [`[[${prefix}-1 First]]`], outcome: `${name} second lands.` },
        ],
        laneOrder: [`${prefix}-1 First`, `${prefix}-2 Second`],
      });
      const twins = [twin('Twin One', 'TA'), twin('Twin Two', 'TB')];
      const view = new GraphView({ lifecycleApi, insights: new GraphInsights() });
      const chipFor = (root, id) => byClass(root, 'graph-view-chip').find((chip) => textOf(chip).split('\n').includes(id));
      const cardsOf = (root) => byClass(root, 'graph-view-detail-panel').map((panel) => [
        byClass(panel, 'graph-view-detail-id')[0]?.textContent ?? null,
        byClass(panel, 'graph-view-detail-outcome-value')[0]?.textContent ?? null,
      ]);
      for (const width of [390, 1024]) {
        const drawn = [];
        for (const env of twins) {
          ph1dUseEnv(env);
          const container = element();
          await view.render({ container }, { containerWidth: width });
          drawn.push(container.children[0]);
        }
        const tapOne = chipFor(drawn[0], 'TA-2');
        if (tapOne) bubblingClick(tapOne);
        const afterOne = [cardsOf(drawn[0]), cardsOf(drawn[1])];
        const tapTwo = chipFor(drawn[1], 'TB-2');
        if (tapTwo) bubblingClick(tapTwo);
        assert.deepStrictEqual({
          compact: drawn.map((root) => byClass(root, 'graph-view-compact').length),
          afterOne,
          afterTwo: cardsOf(drawn[1]),
        }, {
          compact: width === 390 ? [1, 1] : [0, 0],
          afterOne: [[['TA-2', 'Twin One second lands.']], []],
          afterTwo: [['TB-2', 'Twin Two second lands.']],
        }, `PH1D-ONE-INSTANCE-TWO-EPICS: at a containerWidth override of ${width}, one instance draws Twin One and then Twin Two; a tap on TA-2 leaves one card, with TA-2's id and Outcome, in Twin One's drawing and none in Twin Two's, and a tap on TB-2 then leaves one card, with TB-2's id and Outcome, in Twin Two's drawing`);
      }
    }
    global.app = savedApp;
    global.customJS = savedCustomJS;
  }

  // ---- PH1D-UNRECOGNIZED-STATUSES ----
  // _renderCompactGraph at 390 and _renderGraph over four slices whose
  // statuses are 'garbled', 'garbled', ' weird ', and null. Each draw pushes
  // exactly these warnings, in node order: one unreadable_slice warning per
  // slice, whose detail is the raw status, or '(missing)' for null. Each
  // legend's labels are exactly 'unrecognized: garbled', 'unrecognized:
  // weird', and 'unrecognized: (missing)', in that order.
  // MUTATION GUARD: PH1D-MUTANT-WARN-ONCE-PER-STATUS (W2) turns RED at
  // "PH1D-UNRECOGNIZED-STATUSES: the compact draw ..." if the compact map
  // pushes one unreadable_slice warning per distinct status.
  // MUTATION GUARD: PH1D-MUTANT-WARNING-DETAIL-TRIMMED (W1) turns RED at the
  // same label if the compact map trims the warning detail.
  // MUTATION GUARD: PH1D-MUTANT-LEGEND-SKIPS-STATUSLESS (L1) turns RED at the
  // same label if the compact legend leaves out slices with no status.
  {
    const unrecognized = () => ({
      nodes: [
        { card: 'GA-U1 One', path: `${board}/GA-U1 One.md`, status: 'garbled', rank: 0, row: 0 },
        { card: 'GA-U2 Two', path: `${board}/GA-U2 Two.md`, status: 'garbled', rank: 0, row: 1 },
        { card: 'GA-U3 Three', path: `${board}/GA-U3 Three.md`, status: ' weird ', rank: 1, row: 0 },
        { card: 'GA-U4 Four', path: `${board}/GA-U4 Four.md`, status: null, rank: 1, row: 1 },
      ],
      edges: [],
    });
    const expectedWarnings = [
      { code: 'unreadable_slice', card: 'GA-U1 One', detail: 'garbled' },
      { code: 'unreadable_slice', card: 'GA-U2 Two', detail: 'garbled' },
      { code: 'unreadable_slice', card: 'GA-U3 Three', detail: ' weird ' },
      { code: 'unreadable_slice', card: 'GA-U4 Four', detail: '(missing)' },
    ];
    const expectedLegend = ['unrecognized: garbled', 'unrecognized: weird', 'unrecognized: (missing)'];
    for (const [kind, draw] of [
      ['compact', (view, root, warnings) => view._renderCompactGraph(root, unrecognized(), lifecycleApi, epicPath, warnings, 390)],
      ['wide', (view, root, warnings) => view._renderGraph(root, unrecognized(), lifecycleApi, epicPath, warnings)],
    ]) {
      const root = element();
      const warnings = [];
      await draw(new GraphView({ dashboard, lifecycleApi, insights: new GraphInsights() }), root, warnings);
      assert.deepStrictEqual({
        warnings,
        legend: byClass(root, 'graph-view-legend-label').map((label) => label.textContent),
      }, { warnings: expectedWarnings, legend: expectedLegend },
      `PH1D-UNRECOGNIZED-STATUSES: the ${kind} draw of four slices whose statuses are 'garbled', 'garbled', ' weird ', and null pushes one unreadable_slice warning per slice with the raw status (or '(missing)') as its detail, and its legend labels are exactly 'unrecognized: garbled', 'unrecognized: weird', and 'unrecognized: (missing)'`);
    }
  }

  // ---- PH1D-NONCANONICAL-STATUS ----
  // For each of the raw statuses 'Parked', ' Blocked ', "'blocked'", and
  // '"PARKED"': delivery.normalizeStatus reads it as 'parked' or 'blocked';
  // the compact pill drawn for it has the same domShape as the pill drawn
  // for that normalized status with the same card, rank, and row; neither
  // draw pushes a warning; the pill carries the needs-you class exactly for
  // the parked forms; and its effective left border is the 2px error
  // hairline.
  // MUTATION GUARD: PH1D-MUTANT-NEEDS-YOU-RAW-STATUS (A02) turns RED at
  // "PH1D-NONCANONICAL-STATUS: the pill for status "Parked" ..." if needs-you
  // compares the raw status with 'parked'.
  // MUTATION GUARD: PH1D-MUTANT-HAIRLINE-RAW-STATUS (A03) turns RED at the same
  // label if the hairline compares the raw status with 'blocked' and
  // 'parked'.
  // MUTATION GUARD: PH1D-MUTANT-HAIRLINE-LOWERCASED-STATUS (A04) turns RED at
  // "PH1D-NONCANONICAL-STATUS: the pill for status "'blocked'" ..." if the
  // hairline compares the trimmed, lowercased raw status instead.
  for (const [raw, canonical, needsYou] of [
    ['Parked', 'parked', true], [' Blocked ', 'blocked', false], ["'blocked'", 'blocked', false], ['"PARKED"', 'parked', true],
  ]) {
    const pillFor = async (status) => {
      const root = element();
      const warnings = [];
      await ph1View._renderCompactGraph(root, { nodes: [
        { card: 'PR-N Status', path: `${board}/PR-N Status.md`, status, rank: 0, row: 0 },
      ], edges: [] }, lifecycleApi, epicPath, warnings, 390);
      return { pill: byClass(root, 'graph-view-pill')[0] || null, warnings };
    };
    const drawn = await pillFor(raw);
    const reference = await pillFor(canonical);
    assert(delivery.normalizeStatus(raw) === canonical && drawn.pill && reference.pill
      && JSON.stringify(domShape(drawn.pill)) === JSON.stringify(domShape(reference.pill))
      && drawn.warnings.length === 0 && reference.warnings.length === 0,
    `PH1D-NONCANONICAL-STATUS: the pill for status ${JSON.stringify(raw)} has the domShape of the pill for '${canonical}', which is how delivery.normalizeStatus reads that status, and neither pill pushes a warning`);
    assert(drawn.pill && drawn.pill.className.split(/\s+/).includes('graph-view-needs-you') === needsYou
      && effectiveBorders(drawn.pill.style.cssText)?.left === '2px solid var(--text-error)',
    `PH1D-NONCANONICAL-STATUS: the ${JSON.stringify(raw)} pill ${needsYou ? 'carries' : 'does not carry'} the needs-you class, and its effective left border is the 2px error hairline`);
  }

  // ---- PH1C: no continuous observer, one cold-load one-shot ----
  // PH1-BROWSER-LIKE-OBSERVER-STUB: BrowserLikeResizeObserver models a
  // browser ResizeObserver. observe() owes one notification, delivered at the
  // next layout frame (ph1Frame) with the target's current content-box width,
  // not synchronously. After that it notifies only when a frame finds the
  // observed width changed. A disconnected observer is silent. A detached (or
  // off-document) target reports 0, so removing a laid-out root notifies
  // once, with 0, and removing a zero-box root after its first notification
  // notifies nothing. The container's clientWidth is a model
  // (container.ph1Width: a number or a function of the drawn root;
  // container.ph1Throws makes that many upcoming reads throw and
  // container.ph1ThrowOn(readNumber) throws on chosen reads; every read is
  // counted in container.ph1Reads), and the root's content box is modelled
  // independently (container.ph1Content) so the two can disagree.
  // BrowserLikeMutationObserver watches one container's childList and, at the
  // next frame, delivers one record of the children removed and added since
  // the last frame, before any resize notification. Timers run on a stubbed
  // clock (ph1Clock) so ten quiet seconds are deterministic and pending
  // timers are countable. A callback that throws is recorded in the
  // observer's thrown list instead of propagating. ph1Collect(container)
  // marks a detached container collected, and observers whose target is
  // inside it stop counting as live.
  const ph1Observers = [];
  // PH1D-STUB-VIOLATIONS: a stub check that threw inside an observer method
  // could be caught by the widget's own try/catch, so a misuse of either stub
  // is recorded here instead, and settled() and the end of this section
  // assert the record empty.
  const ph1StubViolations = [];
  const hasGraph = (root) => Boolean(root && byClass(root, 'graph-view-canvas').length);
  const isWideGraph = (root) => hasGraph(root) && !byClass(root, 'graph-view-compact').length;
  const ph1Layout = {
    clientWidthOf(container) {
      const model = container.ph1Width;
      return typeof model === 'function' ? model(container.children[0] || null, container) : (Number(model) || 0);
    },
    contentWidthOf(target) {
      if (!target || !target.isConnected || !target.parent) return 0;
      const model = target.parent.ph1Content;
      return model == null ? ph1Layout.clientWidthOf(target.parent) : Number(model);
    },
  };
  class BrowserLikeResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.target = null;
      this.owesFirst = false;
      this.lastWidth = null;
      this.disconnected = 0;
      this.notifications = 0;
      this.thrown = [];
      ph1Observers.push(this);
    }
    get live() { return Boolean(this.target) && this.disconnected === 0; }
    observe(target) {
      if (this.target) ph1StubViolations.push('PH1-BROWSER-LIKE-OBSERVER-STUB: a ResizeObserver observes one root once');
      this.target = target;
      this.owesFirst = true;
    }
    unobserve() {}
    disconnect() { this.disconnected += 1; }
    frame() {
      if (!this.live) return;
      const width = ph1Layout.contentWidthOf(this.target);
      if (!this.owesFirst && width === this.lastWidth) return;
      this.owesFirst = false;
      this.lastWidth = width;
      this.notifications += 1;
      try {
        this.callback([{ target: this.target, contentRect: { width } }], this);
      } catch (error) {
        this.thrown.push(error);
      }
    }
  }
  class BrowserLikeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.target = null;
      this.seen = [];
      this.disconnected = 0;
      this.deliveries = 0;
      this.thrown = [];
      ph1Observers.push(this);
    }
    get live() { return Boolean(this.target) && this.disconnected === 0; }
    observe(target, options) {
      if (!(options && options.childList === true && !options.subtree && !options.attributes && !options.characterData)) {
        ph1StubViolations.push('PH1-BROWSER-LIKE-OBSERVER-STUB: the widget watches its container childList only');
      }
      if (this.target) ph1StubViolations.push('PH1-BROWSER-LIKE-OBSERVER-STUB: a MutationObserver observes one container once');
      this.target = target;
      this.seen = [...target.children];
    }
    takeRecords() { return []; }
    disconnect() { this.disconnected += 1; }
    frame() {
      if (!this.live) return;
      const now = [...this.target.children];
      const removedNodes = this.seen.filter((node) => !now.includes(node));
      const addedNodes = now.filter((node) => !this.seen.includes(node));
      this.seen = now;
      if (!removedNodes.length && !addedNodes.length) return;
      this.deliveries += 1;
      try {
        this.callback([{ type: 'childList', target: this.target, removedNodes, addedNodes }], this);
      } catch (error) {
        this.thrown.push(error);
      }
    }
  }
  const savedResizeObserver = global.ResizeObserver;
  const savedMutationObserver = global.MutationObserver;
  const savedSetTimeout = global.setTimeout;
  const savedClearTimeout = global.clearTimeout;
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const ph1Clock = {
    now: 0, timers: [], nextId: 1,
    pending() { return this.timers.filter((timer) => !timer.cleared && !timer.fired); },
    async advance(ms) {
      const target = this.now + ms;
      for (;;) {
        const next = this.pending().filter((timer) => timer.due <= target).sort((a, b) => a.due - b.due || a.id - b.id)[0];
        if (!next) break;
        this.now = next.due;
        next.fired = true;
        next.fn();
        await settle();
      }
      this.now = target;
    },
  };
  global.ResizeObserver = BrowserLikeResizeObserver;
  global.MutationObserver = BrowserLikeMutationObserver;
  global.setTimeout = (fn, ms) => {
    const timer = { id: ph1Clock.nextId, fn, due: ph1Clock.now + (Number(ms) || 0), cleared: false, fired: false };
    ph1Clock.nextId += 1;
    ph1Clock.timers.push(timer);
    return timer.id;
  };
  global.clearTimeout = (id) => { const timer = ph1Clock.timers.find((entry) => entry.id === id); if (timer) timer.cleared = true; };
  const ph1InFlight = [];
  const ph1Drain = async () => {
    while (ph1InFlight.length) await ph1InFlight.shift();
    await settle();
  };
  // One frame's deliveries, synchronously: childList records first, then
  // resize notifications, each over the observers that existed at its start.
  const ph1Deliver = () => {
    for (const observer of ph1Observers.filter((entry) => entry instanceof BrowserLikeMutationObserver)) observer.frame();
    for (const observer of ph1Observers.filter((entry) => entry instanceof BrowserLikeResizeObserver)) observer.frame();
  };
  const ph1Frame = async () => {
    ph1Deliver();
    await ph1Drain();
  };
  const ph1Quiet = async () => {
    for (let second = 0; second < 10; second += 1) {
      await ph1Clock.advance(1000);
      await ph1Frame();
    }
  };
  const collected = (node) => {
    for (let cursor = node; cursor; cursor = cursor.parent) if (cursor.ph1Collected) return true;
    return false;
  };
  const ph1Collect = (container) => {
    assert(!container.isConnected, 'ph1Collect: only a detached container can be collected');
    container.ph1Collected = true;
  };
  const liveOf = (kind) => ph1Observers.filter((observer) => observer instanceof kind && observer.live && !collected(observer.target));
  const liveResize = () => liveOf(BrowserLikeResizeObserver);
  const liveMutation = () => liveOf(BrowserLikeMutationObserver);
  const liveObservers = () => [...liveResize(), ...liveMutation()];
  const pendingTimers = () => ph1Clock.pending().length;
  const mountContainer = (width, content = null) => {
    const container = element();
    container.querySelector = (selector) => (selector === ':scope > .graph-view-root'
      ? container.children.find((child) => child.className.split(/\s+/).includes('graph-view-root')) || null
      : null);
    container.ph1Width = width;
    container.ph1Content = content;
    container.ph1Throws = 0;
    container.ph1ThrowOn = null;
    container.ph1Reads = 0;
    Object.defineProperty(container, 'clientWidth', {
      configurable: true,
      get() {
        container.ph1Reads += 1;
        const throwOnRead = typeof container.ph1ThrowOn === 'function' && container.ph1ThrowOn(container.ph1Reads);
        if (container.ph1Throws > 0 || throwOnRead) {
          if (container.ph1Throws > 0) container.ph1Throws -= 1;
          throw new Error('clientWidth unreadable');
        }
        return ph1Layout.clientWidthOf(container);
      },
    });
    return container;
  };
  // Counts _renderAtWidth calls (renders) and, separately, the render() calls
  // the harness itself made (initiated). Each trace entry classifies the
  // child that call added to its mount container before returning its
  // promise.
  const countingView = () => {
    const view = new GraphView({ lifecycleApi, insights: new GraphInsights() });
    const renderAtWidth = view._renderAtWidth.bind(view);
    view.renders = 0;
    view.initiated = 0;
    view.trace = [];
    view._renderAtWidth = (...args) => {
      view.renders += 1;
      const mount = args[0]?.container;
      const before = mount?.children ? [...mount.children] : [];
      const started = renderAtWidth(...args);
      const drawn = mount?.children ? mount.children.find((child) => !before.includes(child)) || null : null;
      const inFlight = started.then((result) => {
        view.trace.push(drawn && byClass(drawn, 'graph-view-compact').length ? 'compact' : 'wide');
        return result;
      });
      ph1InFlight.push(inFlight);
      return inFlight;
    };
    view.render = (...args) => {
      view.initiated += 1;
      return GraphView.prototype.render.apply(view, args);
    };
    return view;
  };
  const referenceRoot = async (width) => {
    const container = mountContainer(0);
    await new GraphView({ lifecycleApi, insights: new GraphInsights() }).render({ container }, { containerWidth: width });
    return JSON.stringify(domShape(container.children[0]));
  };
  const isCompact = (container) => byClass(container.children[0], 'graph-view-compact').length === 1;
  // Ten quiet seconds (a frame each second), then the pinned end state: no
  // recorded stub misuse, zero pending timers, zero live observers of either
  // kind, the exact render trace and count, and, when a container is passed,
  // its drawn presentation.
  const ph1Receipts = [];
  const settled = async (label, view, trace, container = null) => {
    await ph1Quiet();
    const runs = view.trace.reduce((out, entry) => { const last = out[out.length - 1]; if (last && last[0] === entry) last[1] += 1; else out.push([entry, 1]); return out; }, []);
    ph1Receipts.push(`${label} => ${runs.map(([entry, count]) => (count > 1 ? `${entry} x${count}` : entry)).join(' > ')} | renders ${view.renders} (initiated ${view.initiated}) | live resize ${liveResize().length} | live childList ${liveMutation().length} | pending timers ${pendingTimers()}`);
    assert.deepStrictEqual(ph1StubViolations, [], `PH1D-STUB-VIOLATIONS: ${label}: no observer-stub misuse was recorded`);
    assert.strictEqual(pendingTimers(), 0, `${label}: nothing pending after ten quiet seconds`);
    assert.strictEqual(liveObservers().length, 0, `${label}: zero live observers of either kind after ten quiet seconds`);
    assert.deepStrictEqual(view.trace, trace, `${label}: render trace is exactly ${trace.join(' -> ')}`);
    assert.strictEqual(view.renders, trace.length, `${label}: exactly ${trace.length} render(s)`);
    if (container) {
      assert.strictEqual(isCompact(container), trace[trace.length - 1] === 'compact',
        `${label}: ends ${trace[trace.length - 1]}`);
    }
  };

  // Stub self-tests.
  {
    const probe = element();
    const probeRoot = probe.createEl('div');
    probe.ph1Width = 700;
    const seen = [];
    const probeObserver = new BrowserLikeResizeObserver((entries) => seen.push(entries.map((entry) => entry.contentRect.width)));
    probeObserver.observe(probeRoot);
    const synchronous = seen.length;
    await ph1Frame();
    await ph1Frame();
    probe.ph1Width = 650;
    await ph1Frame();
    probe.ph1Content = 650;
    await ph1Frame();
    probeRoot.remove();
    await ph1Frame();
    await ph1Frame();
    probeObserver.disconnect();
    const silent = new BrowserLikeResizeObserver((entries) => seen.push(['silent', ...entries]));
    silent.observe(probe.createEl('div'));
    silent.disconnect();
    const zeroBox = element();
    const zeroRoot = zeroBox.createEl('div');
    const zeroSeen = [];
    const zeroObserver = new BrowserLikeResizeObserver((entries) => zeroSeen.push(entries[0].contentRect.width));
    zeroObserver.observe(zeroRoot);
    await ph1Frame();
    zeroRoot.remove();
    await ph1Frame();
    zeroObserver.disconnect();
    assert(synchronous === 0 && JSON.stringify(seen) === JSON.stringify([[700], [650], [0]])
      && JSON.stringify(zeroSeen) === JSON.stringify([0]) && liveObservers().length === 0 && pendingTimers() === 0,
    'PH1-BROWSER-LIKE-OBSERVER-STUB: observe() owes one notification delivered at the next frame, then one per size change and none for an unchanged size; a detached target reports a zero box once, and a zero-box target removed reports nothing; a disconnected observer is silent; every notification carries a size');
    const watched = element();
    const first = watched.createEl('div');
    const records = [];
    const childList = new BrowserLikeMutationObserver((entries) => records.push(entries.map((entry) => [entry.type, entry.removedNodes.length, entry.addedNodes.length])));
    childList.observe(watched, { childList: true });
    const before = records.length;
    first.remove();
    await ph1Frame();
    await ph1Frame();
    watched.createEl('div');
    await ph1Frame();
    childList.disconnect();
    watched.children[0].remove();
    await ph1Frame();
    assert(before === 0 && JSON.stringify(records) === JSON.stringify([[['childList', 1, 0]], [['childList', 0, 1]]])
      && liveObservers().length === 0,
    'PH1-BROWSER-LIKE-OBSERVER-STUB: the childList stub delivers one record per frame with changes (removals and additions), none without, and nothing after disconnect');
    const subtreeWatch = new BrowserLikeMutationObserver(() => {});
    subtreeWatch.observe(element(), { childList: true, subtree: true });
    subtreeWatch.disconnect();
    const doubleObserve = new BrowserLikeResizeObserver(() => {});
    const doubleTarget = element().createEl('div');
    doubleObserve.observe(doubleTarget);
    doubleObserve.observe(doubleTarget);
    doubleObserve.disconnect();
    assert.deepStrictEqual(ph1StubViolations.splice(0), [
      'PH1-BROWSER-LIKE-OBSERVER-STUB: the widget watches its container childList only',
      'PH1-BROWSER-LIKE-OBSERVER-STUB: a ResizeObserver observes one root once',
    ], 'PH1D-STUB-VIOLATIONS: the stubs record a subtree watch and a second observe() instead of throwing');
    assert(liveObservers().length === 0, 'PH1D-STUB-VIOLATIONS: the misuse probes leave no live observer');
  }

  // ---- PH1C-NO-CONTINUOUS-OBSERVER ----
  // A render whose width came from a measurement or an override arms
  // nothing: zero live observers and zero pending timers, at once and after
  // ten quiet seconds.
  // MUTATION GUARD: PH1C-MUTANT-OBSERVER-AFTER-MEASURED turns RED if a
  // measured (or pinned) render installs an observer.
  {
    const container = mountContainer(900);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    assert(liveObservers().length === 0 && pendingTimers() === 0 && view.renders === 1 && !isCompact(container),
      'PH1C-MUTANT-OBSERVER-AFTER-MEASURED (PH1C-NO-CONTINUOUS-OBSERVER): a measured 900 render draws wide and leaves zero live observers and zero pending timers');
    await settled('PH1C-NO-CONTINUOUS-OBSERVER: measured 900', view, ['wide'], container);
  }
  {
    const container = mountContainer(390);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    assert(liveObservers().length === 0 && pendingTimers() === 0 && isCompact(container),
      'PH1C-NO-CONTINUOUS-OBSERVER: a measured 390 render draws compact and leaves zero live observers and zero pending timers');
    await settled('PH1C-NO-CONTINUOUS-OBSERVER: measured 390', view, ['compact'], container);
  }
  for (const [label, measured, override, drawn] of [
    ['override 1024 over a measured 390 pane', 390, 1024, 'wide'],
    ['override 390 over a measured 900 pane', 900, 390, 'compact'],
    ['override 390 over an unmeasured (0) pane', 0, 390, 'compact'],
  ]) {
    const container = mountContainer(measured);
    const view = countingView();
    await view.render({ container }, { containerWidth: override });
    await ph1Drain();
    assert(liveObservers().length === 0 && pendingTimers() === 0,
      `PH1C-NO-CONTINUOUS-OBSERVER: an ${label} leaves zero live observers and zero pending timers`);
    container.ph1Width = measured ? 1400 - measured : 590;
    await ph1Frame();
    await settled(`PH1C-NO-CONTINUOUS-OBSERVER: ${label}`, view, [drawn], container);
  }
  // PH1-OBSERVER-DISAGREEMENT-LOOP: container clientWidth and root content box
  // straddle 600, and content-box ticks after the measured render initiate no
  // render.
  for (const [clientWidth, contentWidth] of [[600, 599.75], [590, 610], [610, 590]]) {
    const container = mountContainer(clientWidth, contentWidth);
    const view = countingView();
    await view.render({ container });
    for (const tick of [contentWidth - 0.25, contentWidth, contentWidth - 0.5]) {
      container.ph1Content = tick;
      await ph1Frame();
    }
    await settled(`PH1-OBSERVER-DISAGREEMENT-LOOP (PH1C-NO-CONTINUOUS-OBSERVER): container ${clientWidth} / root content ${contentWidth}`,
      view, [clientWidth < 600 ? 'compact' : 'wide'], container);
  }
  // PH1-FLIP-CAP-LOST-CROSSING: 600px crossings 400ms and 1500ms apart after a
  // measured render initiate no render.
  for (const cadence of [400, 1500]) {
    const container = mountContainer(900);
    const view = countingView();
    await view.render({ container });
    for (const width of [500, 900, 500, 900]) {
      container.ph1Width = width;
      await ph1Clock.advance(cadence);
      await ph1Frame();
    }
    await settled(`PH1-FLIP-CAP-LOST-CROSSING (PH1C-NO-CONTINUOUS-OBSERVER): crossings every ${cadence}ms ending at 900`,
      view, ['wide'], container);
  }
  // PH1B-SCROLLBAR-DEPENDENT-MEASUREMENT: a pane scrollbar that appears only
  // while a graph is drawn (610 empty, 595 drawn); the one render draws wide
  // and nothing re-renders.
  {
    const container = mountContainer((root) => (hasGraph(root) ? 595 : 610));
    const view = countingView();
    await view.render({ container });
    assert.strictEqual(container.clientWidth, 595,
      'PH1B-SCROLLBAR-DEPENDENT-MEASUREMENT: the drawn graph moved the pane from 610 to 595');
    await settled('PH1B-SCROLLBAR-DEPENDENT-MEASUREMENT (PH1C-NO-CONTINUOUS-OBSERVER): 610 empty / 595 drawn',
      view, ['wide'], container);
  }
  // PH1B-PERMANENT-HOLD: the pane moves 900 -> 610 -> 500 after a measured
  // render with nothing following, then a Dataview refresh measures 500 and
  // draws compact.
  {
    const container = mountContainer(900);
    const view = countingView();
    await view.render({ container });
    for (const width of [610, 500]) {
      container.ph1Width = width;
      await ph1Clock.advance(200);
      await ph1Frame();
    }
    assert(view.renders === 1 && !isCompact(container),
      'PH1B-PERMANENT-HOLD: pane changes after a measured render initiate no render');
    await view.render({ container });
    await settled('PH1B-PERMANENT-HOLD (PH1C-NO-CONTINUOUS-OBSERVER): 900 -> 610 -> 500, then one Dataview refresh',
      view, ['wide', 'compact'], container);
  }
  // PH1B-FALSE-BISTABLE-PROOF: on a pane that measures 590 under the wide
  // graph and 605 under the compact map, each Dataview render draws what its
  // own measurement says, and width changes between them initiate no render.
  {
    const container = mountContainer((root) => (isWideGraph(root) ? 590 : 605));
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    await view.render({ container });
    await ph1Frame();
    const model = container.ph1Width;
    for (const width of [610, 590, model]) {
      container.ph1Width = width;
      await ph1Frame();
    }
    await view.render({ container });
    await settled('PH1B-FALSE-BISTABLE-PROOF (PH1C-NO-CONTINUOUS-OBSERVER): three Dataview renders on a 590-wide / 605-compact pane',
      view, ['wide', 'compact', 'wide'], container);
  }
  for (const identifier of [
    '_flipStreak', '_flipStreaks', '_widthFlipAllowed', 'settleCheck', 'boundedCheck', 'bistable', 'withinBand',
    'sawCompactWide', 'sawWideNarrow', '_handoffWidthRender', '_beginWidthRender', '_resetWidthState', '_widthState',
    '_widthHandoffs', 'setTimeout', 'clearTimeout', 'setInterval', 'requestAnimationFrame',
  ]) {
    assert(!widgetSource.includes(identifier),
      `PH1C-NO-CONTINUOUS-OBSERVER: graph-view.js contains no ${identifier}`);
  }
  assert(!/\bband\b|\bsettle|\bstreak|\bdebounce/i.test(widgetSource),
    'PH1C-NO-CONTINUOUS-OBSERVER: graph-view.js carries no band, settle, streak, or debounce state');

  // ---- PH1C-ONE-SHOT-COLD-LOAD ----
  // An unmeasured render arms one one-shot: one resize observer on its root
  // and one childList watch on its container. Each resize notification
  // re-resolves the same measurement render() uses; while that is unmeasured
  // nothing happens; the first time it is measured the one-shot disarms and
  // re-renders exactly once, and that measured render arms nothing.
  {
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    const armed = liveResize();
    const watch = liveMutation();
    assert(view.renders === 1 && !isCompact(container) && armed.length === 1 && armed[0].target === container.children[0]
      && watch.length === 1 && watch[0].target === container && pendingTimers() === 0,
    'PH1C-ONE-SHOT-COLD-LOAD: a render at clientWidth 0 without is-mobile renders wide and installs exactly one observer, on its root, plus one childList watch on its container');
    const oneShot = armed[0];
    // MUTATION GUARD: PH1-MUTANT-RERENDER-EVERY-TICK turns RED if the one-shot
    // re-renders on a notification whose re-resolved measurement is still
    // unmeasured.
    await ph1Frame();
    assert(oneShot.notifications === 1 && view.renders === 1 && oneShot.live,
      'PH1-MUTANT-RERENDER-EVERY-TICK (PH1C-ONE-SHOT-COLD-LOAD): the observe() notification re-resolves 0 and does nothing');
    // MUTATION GUARD: PH1C-MUTANT-OBSERVER-OWN-MEASUREMENT turns RED if the
    // one-shot decides from the notification's content box instead of
    // re-resolving the measurement render() uses.
    container.ph1Content = 300;
    await ph1Frame();
    assert(oneShot.notifications === 2 && view.renders === 1 && oneShot.live && liveResize().length === 1,
      'PH1C-MUTANT-OBSERVER-OWN-MEASUREMENT (PH1C-ONE-SHOT-COLD-LOAD): a notification with a positive content box while clientWidth still reads 0 does not re-render and keeps observing');
    container.ph1Content = 0;
    await ph1Frame();
    await ph1Quiet();
    assert(oneShot.notifications === 3 && view.renders === 1 && oneShot.live && pendingTimers() === 0,
      'PH1C-ONE-SHOT-COLD-LOAD: notifications while the re-resolved measurement is still zero do nothing, through ten quiet seconds');
    container.ph1Width = 590;
    container.ph1Content = null;
    await ph1Frame();
    // MUTATION GUARD: PH1C-MUTANT-ONE-SHOT-TWICE turns RED if the one-shot
    // re-renders more than once for its firing, or stays armed after it fires
    // (any later notification could then re-render again).
    assert(view.renders === 2 && isCompact(container) && oneShot.notifications === 4 && oneShot.disconnected >= 1
      && liveObservers().length === 0 && oneShot.thrown.length === 0,
    'PH1C-MUTANT-ONE-SHOT-TWICE (PH1C-ONE-SHOT-COLD-LOAD): when the container lays out at 590 the next notification re-resolves 590 and re-renders compact exactly once, the one-shot disarms as it fires, and the measured re-render installs none');
    await settled('PH1C-ONE-SHOT-COLD-LOAD: cold load at 0, the pane lays out at 590', view, ['wide', 'compact'], container);
    assert.strictEqual(oneShot.notifications, 4, 'PH1C-ONE-SHOT-COLD-LOAD: the disarmed one-shot is not notified again');
    const fresh = mountContainer(590);
    const freshView = countingView();
    await freshView.render({ container: fresh });
    await ph1Drain();
    assert(liveObservers().length === 0 && isCompact(fresh),
      'PH1C-ONE-SHOT-COLD-LOAD: a new render at 590 is measured and installs none');
    await settled('PH1C-ONE-SHOT-COLD-LOAD: a new render at 590', freshView, ['compact'], fresh);
  }
  // is-mobile cold load: the 390 compact map, then one re-render to wide
  // when the pane measures 800.
  {
    ph1MobileClass = true;
    const at390 = await referenceRoot(390);
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    const armed = liveResize();
    assert(isCompact(container) && JSON.stringify(domShape(container.children[0])) === at390
      && armed.length === 1 && armed[0].target === container.children[0] && liveMutation().length === 1,
    'PH1C-ONE-SHOT-COLD-LOAD: an is-mobile cold load (clientWidth 0) renders the 390 compact map and installs exactly one observer');
    const oneShot = armed[0];
    await ph1Frame();
    assert(view.renders === 1 && oneShot.live,
      'PH1C-ONE-SHOT-COLD-LOAD: on is-mobile the observe() notification re-resolves 0 and does nothing');
    container.ph1Width = 800;
    await ph1Frame();
    assert(view.renders === 2 && !isCompact(container) && oneShot.disconnected >= 1 && liveObservers().length === 0,
      'PH1C-ONE-SHOT-COLD-LOAD: when the is-mobile container measures 800 the one-shot re-renders once, to wide, and disarms');
    await settled('PH1C-ONE-SHOT-COLD-LOAD: is-mobile cold load at 390 compact, the pane measures 800',
      view, ['compact', 'wide'], container);
    ph1MobileClass = false;
  }
  // Removing the root disarms the one-shot without rendering, even when the
  // pane has meanwhile laid out at a measurable 590.
  for (const [label, laidOut] of [['before its first notification', false], ['after a laid-out content box', true]]) {
    const container = mountContainer(0, laidOut ? 240 : null);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    const oneShot = liveResize()[0];
    if (laidOut) {
      await ph1Frame();
      assert(oneShot && oneShot.notifications === 1 && oneShot.live && view.renders === 1,
        'PH1C-ONE-SHOT-COLD-LOAD: a 240px content box over an unmeasured pane leaves the one-shot observing');
    }
    container.children[0].remove();
    container.ph1Width = 590;
    await ph1Frame();
    assert(oneShot && oneShot.disconnected >= 1 && view.renders === 1 && container.children.length === 0
      && liveObservers().length === 0 && oneShot.thrown.length === 0,
    `PH1C-ONE-SHOT-COLD-LOAD: removing the root ${label} disarms the one-shot without rendering`);
    await settled(`PH1C-ONE-SHOT-COLD-LOAD: root removed ${label}`, view, ['wide']);
  }
  // A new mount container replaces the old one at cold load: the old
  // container leaves the document with its root still inside, so its
  // one-shot stays armed on that detached subtree (one notification, the one
  // observe() owes, and no render; the harness drops it with ph1Collect);
  // the new container's one-shot re-renders once when its pane lays out.
  // MUTATION GUARD: PH1C-MUTANT-PER-INSTANCE-KEY turns RED here too: keyed per
  // instance, the replacement's render disarms the old container's one-shot.
  // MUTATION GUARD: PH1C-MUTANT-ISCONNECTED-REMOVAL turns RED here too: a
  // detached container is not a removed root, so its one-shot stays armed.
  {
    const old = mountContainer(0);
    const view = countingView();
    await view.render({ container: old });
    const oldPair = liveObservers();
    old.remove();
    const replacement = mountContainer(0);
    await view.render({ container: replacement });
    await ph1Drain();
    assert(oldPair.length === 2 && liveResize().length === 2 && liveMutation().length === 2,
      'PH1C-MUTANT-PER-INSTANCE-KEY (PH1C-ONE-SHOT-COLD-LOAD): each container owns its own one-shot');
    replacement.ph1Width = 590;
    await ph1Frame();
    await ph1Quiet();
    assert(view.renders === 3 && isCompact(replacement) && old.children.length === 1 && !isCompact(old)
      && oldPair.every((observer) => observer.live && observer.thrown.length === 0) && oldPair[0].notifications === 1
      && liveObservers().length === 2 && pendingTimers() === 0,
    'PH1C-MUTANT-ISCONNECTED-REMOVAL (PH1C-ONE-SHOT-COLD-LOAD): when a new mount container replaces the old one at cold load the new one-shot re-renders exactly once; the old one stays armed on its detached container, not notified again and not rendering');
    ph1Collect(old);
    await settled('PH1C-ONE-SHOT-COLD-LOAD: a new mount container replaces the old one at cold load',
      view, ['wide', 'wide', 'compact'], replacement);
  }
  // Without a ResizeObserver API an unmeasured render still succeeds; without
  // a MutationObserver API the one-shot still arms and re-renders once.
  {
    global.ResizeObserver = undefined;
    ph1MobileClass = true;
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    ph1MobileClass = false;
    global.ResizeObserver = BrowserLikeResizeObserver;
    assert(isCompact(container) && view.renders === 1 && liveObservers().length === 0,
      'PH1C-ONE-SHOT-COLD-LOAD: without a ResizeObserver API an unmeasured is-mobile render still draws compact and arms nothing');
  }
  {
    global.MutationObserver = undefined;
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    global.MutationObserver = BrowserLikeMutationObserver;
    assert(liveResize().length === 1 && liveMutation().length === 0,
      'PH1C-ONE-SHOT-COLD-LOAD: without a MutationObserver API the one-shot still arms its resize observer');
    container.ph1Width = 590;
    await ph1Frame();
    await settled('PH1C-ONE-SHOT-COLD-LOAD: no MutationObserver API, the pane lays out at 590', view, ['wide', 'compact'], container);
  }

  // ---- PH1C-ONE-SHOT-NO-LEAK ----
  // Re-runs into the same container leave at most one armed one-shot, and
  // removing the root disarms it.
  // MUTATION GUARD: PH1C-MUTANT-DISARM-ON-NOTIFICATION-ONLY turns RED if the
  // one-shot disarms only when a resize notification reaches it (no disarm at
  // render start, no childList watch).
  {
    const container = mountContainer(0);
    const view = countingView();
    let most = 0;
    for (let run = 0; run <= 50; run += 1) {
      if (run > 0) container.children[0].remove();
      await view.render({ container });
      await ph1Frame();
      most = Math.max(most, liveResize().length, liveMutation().length);
    }
    assert(most === 1 && liveResize().length === 1 && liveMutation().length === 1 && view.renders === 51
      && view.initiated === 51 && container.children.length === 1,
    'PH1C-MUTANT-DISARM-ON-NOTIFICATION-ONLY (PH1C-ONE-SHOT-NO-LEAK): 50 Dataview re-runs at clientWidth 0 leave at most one armed one-shot (one resize and one childList observer) after every render');
    container.ph1Width = 590;
    await ph1Frame();
    assert(view.renders === 52 && view.renders - view.initiated === 1 && isCompact(container) && liveObservers().length === 0,
      'PH1C-ONE-SHOT-NO-LEAK: when the pane lays out at 590 exactly one extra render draws compact and zero observers of either kind stay live');
    await settled('PH1C-ONE-SHOT-NO-LEAK: 50 Dataview re-runs at clientWidth 0, then the pane lays out at 590',
      view, [...Array(51).fill('wide'), 'compact'], container);
  }
  {
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    const [resize] = liveResize();
    const [watch] = liveMutation();
    assert(resize && watch && resize.notifications === 1 && view.renders === 1,
      'PH1C-ONE-SHOT-NO-LEAK: the zero-box root has had its first notification');
    container.children[0].remove();
    container.ph1Width = 590;
    await ph1Frame();
    assert(liveObservers().length === 0 && resize.notifications === 1 && watch.deliveries === 1 && view.renders === 1
      && container.children.length === 0,
    'PH1C-MUTANT-DISARM-ON-NOTIFICATION-ONLY (PH1C-ONE-SHOT-NO-LEAK): a zero-box root removed after its first notification disarms both observers on the next frame through the childList signal, with no resize notification and no render');
    await settled('PH1C-ONE-SHOT-NO-LEAK: a zero-box root removed after its first notification', view, ['wide']);
  }
  for (const [label, dataviewFirst] of [['the Dataview re-run lands first', true], ['the layout notification lands first', false]]) {
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    container.ph1Width = 590;
    if (dataviewFirst) {
      container.children[0].remove();
      const rerun = view.render({ container });
      ph1Deliver();
      await rerun;
    } else {
      ph1Deliver();
      container.children[0].remove();
      view.render({ container });
    }
    await ph1Drain();
    await ph1Frame();
    assert(container.children.length === 1 && isCompact(container) && view.initiated === 2
      && view.renders - view.initiated <= 1 && liveObservers().length === 0,
    `PH1C-ONE-SHOT-NO-LEAK: a Dataview re-run and the layout notification in the same frame (${label}) leave one root, compact, at most one extra render, and nothing armed`);
    await settled(`PH1C-ONE-SHOT-NO-LEAK: Dataview re-run and layout in one frame, ${label}`,
      view, dataviewFirst ? ['wide', 'compact'] : ['wide', 'compact', 'compact'], container);
  }
  // MUTATION GUARD: PH1C-MUTANT-PER-INSTANCE-KEY turns RED if the one-shot is
  // owned per GraphView instance instead of per container: a second
  // container's render would disarm the first container's one-shot.
  {
    const view = countingView();
    const first = mountContainer(0);
    const second = mountContainer(0);
    await view.render({ container: first });
    await view.render({ container: second });
    await ph1Frame();
    const owners = liveResize().map((observer) => observer.target.parent);
    assert(liveResize().length === 2 && liveMutation().length === 2 && owners.includes(first) && owners.includes(second),
    'PH1C-MUTANT-PER-INSTANCE-KEY (PH1C-ONE-SHOT-NO-LEAK): one shared instance rendering two cold-load containers keeps one armed one-shot per container');
    first.ph1Width = 590;
    await ph1Frame();
    assert(isCompact(first) && !isCompact(second) && view.renders === 3 && liveResize().length === 1,
      'PH1C-MUTANT-PER-INSTANCE-KEY (PH1C-ONE-SHOT-NO-LEAK): the first container re-renders once and the second stays armed');
    second.ph1Width = 500;
    await ph1Frame();
    await settled('PH1C-ONE-SHOT-NO-LEAK: one instance, two cold-load containers', view, ['wide', 'wide', 'compact', 'compact']);
    assert(isCompact(second), 'PH1C-ONE-SHOT-NO-LEAK: the second container re-renders once when it lays out');
  }

  // ---- PH1C-ONE-SHOT-USES-ITS-MEASUREMENT ----
  // The re-render draws the measurement the one-shot resolved without reading
  // the width again, so a width read that alternately throws and succeeds
  // yields one extra render.
  // MUTATION GUARD: PH1C-MUTANT-RERENDER-REREADS turns RED if the one-shot's
  // re-render resolves the width again instead of using its measurement.
  {
    const at500 = await referenceRoot(500);
    const container = mountContainer(500, 500);
    container.ph1ThrowOn = (read) => read % 2 === 1;
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    assert(container.ph1Reads === 1 && !isCompact(container) && liveResize().length === 1,
      'PH1C-ONE-SHOT-USES-ITS-MEASUREMENT: the render read throws, resolves unmeasured, draws wide, and arms the one-shot');
    await ph1Frame();
    assert(view.renders === 2 && isCompact(container) && JSON.stringify(domShape(container.children[0])) === at500
      && container.ph1Reads === 2 && liveObservers().length === 0,
    'PH1C-MUTANT-RERENDER-REREADS (PH1C-ONE-SHOT-USES-ITS-MEASUREMENT): with a width read that alternately throws and succeeds, the one-shot resolves 500 and its one extra render draws the 500 compact map from that measurement without reading again');
    await settled('PH1C-ONE-SHOT-USES-ITS-MEASUREMENT: alternating throwing width read', view, ['wide', 'compact'], container);
    assert.strictEqual(container.ph1Reads, 2, 'PH1C-ONE-SHOT-USES-ITS-MEASUREMENT: nothing reads the width after the one-shot fired');
  }

  // ---- PH1C-ONE-SHOT-LATE-ATTACH ----
  // A container that is not attached yet keeps its one-shot armed, and a
  // later attach that lays out re-renders once.
  // MUTATION GUARD: PH1C-MUTANT-ISCONNECTED-REMOVAL turns RED if the one-shot
  // treats root.isConnected === false as removal.
  {
    const container = mountContainer(0);
    container.offDocument = true;
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    const [resize] = liveResize();
    assert(resize && resize.notifications === 1 && resize.live && liveMutation().length === 1 && view.renders === 1,
      'PH1C-MUTANT-ISCONNECTED-REMOVAL (PH1C-ONE-SHOT-LATE-ATTACH): a container still detached at render keeps its one-shot armed through the first frame');
    container.offDocument = false;
    await ph1Frame();
    container.ph1Width = 590;
    await ph1Frame();
    assert(view.renders === 2 && isCompact(container) && liveObservers().length === 0,
      'PH1C-ONE-SHOT-LATE-ATTACH: attached after the first frame and laid out at 590, the one-shot re-renders exactly once, compact');
    await settled('PH1C-ONE-SHOT-LATE-ATTACH: detached at render, attached, laid out at 590', view, ['wide', 'compact'], container);
  }
  // A container torn down with its root inside while still 0 wide: the root
  // is still its child, so nothing disarms and nothing fires; the harness
  // models the detached subtree's collection with ph1Collect.
  {
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    const pair = liveObservers();
    container.remove();
    await ph1Quiet();
    assert(view.renders === 1 && pendingTimers() === 0 && pair.length === 2 && pair.every((observer) => observer.live)
      && pair[0].notifications === 1 && pair[1].deliveries === 0
      && pair.every((observer) => observer.target === container || observer.target.parent === container),
    'PH1C-ONE-SHOT-LATE-ATTACH: a container torn down with its root inside while still 0 renders nothing and schedules nothing; its armed pair watches only nodes inside the detached subtree');
    ph1Collect(container);
    await settled('PH1C-ONE-SHOT-LATE-ATTACH: torn down while still 0, then collected', view, ['wide']);
  }

  // ---- PH1C-UNMEASURED-RECOVERS ----
  // PH1B-THROWING-GETTER-DROPS-CROSSING: a width read that throws is
  // unmeasured: it falls through to the is-mobile class, then wide, arms the
  // one-shot, and the next notification whose re-resolve succeeds re-renders
  // once.
  for (const [label, mobile, first] of [['without is-mobile', false, 'wide'], ['on an is-mobile body', true, 'compact']]) {
    ph1MobileClass = mobile;
    const at500 = await referenceRoot(500);
    const container = mountContainer(500, 500);
    container.ph1Throws = 1;
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    const armed = liveResize();
    assert(container.ph1Throws === 0 && view.renders === 1 && isCompact(container) === (first === 'compact')
      && armed.length === 1 && armed[0].target === container.children[0],
    `PH1B-THROWING-GETTER-DROPS-CROSSING (PH1C-UNMEASURED-RECOVERS): a clientWidth getter that throws on the render ${label} resolves unmeasured (${first}) and installs the one-shot`);
    await ph1Frame();
    assert(view.renders === 2 && isCompact(container) && armed[0].disconnected >= 1 && liveObservers().length === 0
      && armed[0].thrown.length === 0 && JSON.stringify(domShape(container.children[0])) === at500,
    `PH1C-UNMEASURED-RECOVERS: ${label}, the next notification re-resolves 500 and re-renders the 500 compact map exactly once`);
    await settled(`PH1C-UNMEASURED-RECOVERS: a getter that throws on the render ${label}`, view, [first, 'compact'], container);
    ph1MobileClass = false;
  }
  {
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    const oneShot = liveResize()[0];
    await ph1Frame();
    container.ph1Width = 500;
    container.ph1Throws = 1;
    await ph1Frame();
    assert(container.ph1Throws === 0 && oneShot.notifications === 2 && oneShot.thrown.length === 0 && oneShot.live
      && view.renders === 1,
    'PH1B-THROWING-GETTER-DROPS-CROSSING (PH1C-UNMEASURED-RECOVERS): a clientWidth getter that throws inside the one-shot notification keeps observing and does not throw out of the observer callback');
    container.ph1Content = 499.5;
    await ph1Frame();
    assert(view.renders === 2 && isCompact(container) && oneShot.disconnected >= 1 && liveObservers().length === 0,
      'PH1C-UNMEASURED-RECOVERS: the next notification whose re-resolve succeeds at 500 re-renders compact exactly once');
    await settled('PH1C-UNMEASURED-RECOVERS: a getter that throws inside the notification', view, ['wide', 'compact'], container);
  }
  {
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    const oneShot = liveResize()[0];
    await ph1Frame();
    view._resolveWidth = () => { throw new Error('resolver fault'); };
    container.ph1Width = 500;
    await ph1Frame();
    delete view._resolveWidth;
    assert(oneShot.notifications === 2 && oneShot.thrown.length === 0 && oneShot.live && view.renders === 1,
      'PH1C-UNMEASURED-RECOVERS: a resolver fault inside the notification is swallowed and the one-shot keeps observing');
    container.ph1Content = 499.5;
    await ph1Frame();
    assert(view.renders === 2 && isCompact(container) && oneShot.disconnected >= 1 && liveObservers().length === 0,
      'PH1C-UNMEASURED-RECOVERS: after a swallowed fault the next measured notification re-renders compact exactly once');
    await settled('PH1C-UNMEASURED-RECOVERS: a fault inside the notification', view, ['wide', 'compact'], container);
  }

  // ---- PH1D-ONE-SHOT-BRANCHES ----
  // PH1C-SIBLING-CHANGE-KEEPS-ARMED: a sibling added to, then removed from,
  // the container while armed delivers two childList records with the root
  // still a child, so the one-shot stays armed, and layout at 590 still
  // re-renders compact exactly once.
  // MUTATION GUARD: PH1D-MUTANT-DISARM-ON-ANY-CHILDLIST turns RED at
  // "PH1D-ONE-SHOT-BRANCHES (PH1C-SIBLING-CHANGE-KEEPS-ARMED): a sibling added
  // ..." if the childList callback disarms on any record instead of only when
  // the root was removed.
  {
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    const [resize] = liveResize();
    const [watch] = liveMutation();
    const sibling = container.createEl('div');
    await ph1Frame();
    sibling.remove();
    await ph1Frame();
    assert(resize && watch && watch.deliveries === 2 && watch.thrown.length === 0 && resize.live && watch.live
      && resize.notifications === 1 && view.renders === 1 && container.children.length === 1,
    'PH1D-ONE-SHOT-BRANCHES (PH1C-SIBLING-CHANGE-KEEPS-ARMED): a sibling added to and then removed from the container while armed delivers two childList records and leaves the one-shot armed');
    container.ph1Width = 590;
    await ph1Frame();
    assert(view.renders === 2 && view.initiated === 1 && isCompact(container) && resize.notifications === 2
      && liveObservers().length === 0,
    'PH1D-ONE-SHOT-BRANCHES (PH1C-SIBLING-CHANGE-KEEPS-ARMED): layout at 590 after the sibling changes still re-renders compact exactly once');
    await settled('PH1D-ONE-SHOT-BRANCHES (PH1C-SIBLING-CHANGE-KEEPS-ARMED): sibling added and removed while armed, then laid out at 590',
      view, ['wide', 'compact'], container);
  }
  // PH1C-RESIZE-CALLBACK-REMOVAL: without a MutationObserver API, a root laid
  // out to a 240px content box over a still-unmeasured pane is removed as the
  // pane lays out at 590; on the removal notification (240 -> 0) the
  // one-shot disarms and renders nothing into the container its root left.
  // MUTATION GUARD: PH1D-MUTANT-RESIZE-IGNORES-REMOVAL turns RED at
  // "PH1D-ONE-SHOT-BRANCHES (PH1C-RESIZE-CALLBACK-REMOVAL): with no
  // MutationObserver API, removing the laid-out root ..." if the resize
  // callback skips its removal check (it would re-resolve 590 and draw a
  // compact root the harness never asked for).
  {
    global.MutationObserver = undefined;
    const container = mountContainer(0, 240);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    global.MutationObserver = BrowserLikeMutationObserver;
    const [resize] = liveResize();
    assert(resize && resize.target === container.children[0] && liveResize().length === 1 && liveMutation().length === 0
      && view.renders === 1 && !isCompact(container),
    'PH1D-ONE-SHOT-BRANCHES (PH1C-RESIZE-CALLBACK-REMOVAL): with no MutationObserver API an unmeasured render arms the resize observer alone');
    await ph1Frame();
    assert(resize.notifications === 1 && resize.live && view.renders === 1,
      'PH1D-ONE-SHOT-BRANCHES (PH1C-RESIZE-CALLBACK-REMOVAL): the 240px content-box notification over an unmeasured pane keeps it armed');
    container.children[0].remove();
    container.ph1Width = 590;
    await ph1Frame();
    assert(resize.notifications === 2 && resize.disconnected >= 1 && resize.thrown.length === 0 && view.renders === 1
      && container.children.length === 0 && liveObservers().length === 0,
    'PH1D-ONE-SHOT-BRANCHES (PH1C-RESIZE-CALLBACK-REMOVAL): with no MutationObserver API, removing the laid-out root notifies the resize callback, which disarms and renders nothing');
    await settled('PH1D-ONE-SHOT-BRANCHES (PH1C-RESIZE-CALLBACK-REMOVAL): no MutationObserver API, a laid-out root removed as the pane lays out at 590',
      view, ['wide']);
  }
  // PH1D-RESIZE-REMOVAL-UNMEASURED (O25): without a MutationObserver API, a
  // root laid out to a 240px content box is removed while the pane still
  // measures 0; on the removal notification (240 -> 0) the one-shot
  // disconnects and renders nothing.
  // MUTATION GUARD: PH1D-MUTANT-REMOVAL-AFTER-MEASURED-RETURN (O25) turns RED
  // at "PH1D-RESIZE-REMOVAL-UNMEASURED (O25): with no MutationObserver API,
  // a laid-out root removed while the pane still measures 0 ..." if the
  // removal check moves after the fresh.source !== "measured" return.
  {
    global.MutationObserver = undefined;
    const container = mountContainer(0, 240);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    global.MutationObserver = BrowserLikeMutationObserver;
    const [resize] = liveResize();
    await ph1Frame();
    assert(resize && resize.notifications === 1 && resize.live && liveResize().length === 1 && liveMutation().length === 0
      && view.renders === 1,
    'PH1D-RESIZE-REMOVAL-UNMEASURED (O25): with no MutationObserver API a 240px content box over a 0 pane keeps the one-shot armed');
    container.children[0].remove();
    await ph1Frame();
    assert(resize.notifications === 2 && resize.disconnected >= 1 && resize.thrown.length === 0 && view.renders === 1
      && container.children.length === 0 && liveObservers().length === 0,
    'PH1D-RESIZE-REMOVAL-UNMEASURED (O25): with no MutationObserver API, a laid-out root removed while the pane still measures 0 is disarmed by its removal notification and nothing renders');
    await settled('PH1D-RESIZE-REMOVAL-UNMEASURED (O25): no MutationObserver API, a laid-out root removed while the pane measures 0',
      view, ['wide']);
  }
  // PH1D-OBSERVE-FAILURE (O28): when resize.observe() throws at cold load,
  // any childList watch already started is disconnected, no observer is
  // live, and a later layout or root removal renders nothing.
  // MUTATION GUARD: PH1D-MUTANT-OBSERVE-FAILURE-KEEPS-ARMED (O28) turns RED
  // at "PH1D-OBSERVE-FAILURE (O28): a resize observe() that throws ..." if the
  // installer's catch stops disarming what it armed.
  {
    class RefusingResizeObserver extends BrowserLikeResizeObserver {
      observe() { throw new Error('observe refused'); }
    }
    global.ResizeObserver = RefusingResizeObserver;
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    global.ResizeObserver = BrowserLikeResizeObserver;
    const refused = ph1Observers.filter((observer) => observer instanceof RefusingResizeObserver);
    const watches = ph1Observers.filter((observer) => observer instanceof BrowserLikeMutationObserver && observer.target === container);
    assert(refused.length === 1 && refused[0].target === null && watches.every((watch) => watch.disconnected >= 1)
      && liveObservers().length === 0 && view.renders === 1 && !isCompact(container),
    'PH1D-OBSERVE-FAILURE (O28): a resize observe() that throws after arming leaves nothing armed: any childList watch it started is disconnected and no observer is live');
    container.ph1Width = 590;
    await ph1Frame();
    container.children[0].remove();
    await ph1Frame();
    assert(view.renders === 1 && watches.every((watch) => watch.deliveries === 0) && liveObservers().length === 0,
      'PH1D-OBSERVE-FAILURE (O28): after the failed observe() neither a layout at 590 nor removing the root renders or delivers anything');
    await settled('PH1D-OBSERVE-FAILURE (O28): resize observe() throws at cold load', view, ['wide']);
  }
  // PH1C-RENDER-START-DISARM: without a MutationObserver API, a cold-load
  // one-shot whose zero-box root has had its first notification (0) is
  // replaced by a measured Dataview re-run of the same container, which arms
  // nothing. That container must have no live observer the moment the
  // re-render finishes, and through ten quiet seconds.
  // MUTATION GUARD: PH1D-MUTANT-NO-RENDER-START-DISARM turns RED at
  // "PH1D-ONE-SHOT-BRANCHES (PH1C-RENDER-START-DISARM): with no
  // MutationObserver API a measured re-render ..." if _renderAtWidth stops
  // disarming its container's one-shot before anything else.
  // The same instance also arms a second container before the re-render.
  // MUTATION GUARD: PH1D-MUTANT-OWNERSHIP-PER-INSTALL turns RED at the same
  // label if each install starts a fresh ownership map (the second
  // container's install forgets the first's one-shot).
  // MUTATION GUARD: PH1D-MUTANT-OWNERSHIP-NOT-RECORDED turns RED at the same
  // label if the installer never records the armed one-shot for its
  // container.
  {
    global.MutationObserver = undefined;
    const container = mountContainer(0);
    const other = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await view.render({ container: other });
    await ph1Frame();
    const stale = liveResize().find((observer) => observer.target.parent === container);
    const otherOneShot = liveResize().find((observer) => observer.target.parent === other);
    assert(stale && otherOneShot && stale.notifications === 1 && stale.live && liveResize().length === 2 && liveMutation().length === 0
      && view.renders === 2,
    'PH1D-ONE-SHOT-BRANCHES (PH1C-RENDER-START-DISARM): with no MutationObserver API two cold-load containers of one instance each arm a resize observer alone, and a zero-box first notification keeps each armed');
    container.ph1Width = 590;
    await view.render({ container });
    await ph1Drain();
    global.MutationObserver = BrowserLikeMutationObserver;
    assert(stale.disconnected >= 1 && stale.notifications === 1 && liveResize().length === 1 && liveResize()[0] === otherOneShot
      && liveMutation().length === 0 && view.renders === 3 && view.initiated === 3 && container.children.length === 1 && isCompact(container),
    'PH1D-ONE-SHOT-BRANCHES (PH1C-RENDER-START-DISARM): with no MutationObserver API a measured re-render of the same container disarms the armed one-shot as it starts and leaves zero live observers of its own (the other container stays armed)');
    other.ph1Width = 500;
    await ph1Frame();
    assert(isCompact(other) && view.renders === 4 && liveObservers().length === 0,
      'PH1D-ONE-SHOT-BRANCHES (PH1C-RENDER-START-DISARM): the other container still re-renders once when it lays out');
    await settled('PH1D-ONE-SHOT-BRANCHES (PH1C-RENDER-START-DISARM): no MutationObserver API, a measured 590 re-render replaces an armed cold-load root while another container is armed',
      view, ['wide', 'wide', 'compact', 'compact'], container);
  }
  // PH1C-ARM-ONLY-WHILE-ATTACHED: two overlapping cold-load renders of one
  // container, the older finishing last (its lifecycle read is held until
  // the newer render has finished and armed). The newer render removed the
  // older root, so when the older render finishes its root is no longer a
  // child of the container: it arms nothing and leaves the newer one-shot
  // armed, which re-renders compact once when the pane lays out at 590.
  // MUTATION GUARD: PH1D-MUTANT-ARM-AFTER-REMOVAL turns RED at
  // "PH1D-ONE-SHOT-BRANCHES (PH1C-ARM-ONLY-WHILE-ATTACHED): the older render,
  // finishing last ..." if the installer arms a root that has already left
  // its container (it would disarm the newer one-shot and watch a detached
  // root, and the map would stay wide at 590).
  {
    const container = mountContainer(0);
    const view = countingView();
    let releaseOlder = null;
    const olderHeld = new Promise((resolve) => { releaseOlder = resolve; });
    let lifecycleReads = 0;
    view._lifecycleApi = function heldLifecycleApi(...args) {
      lifecycleReads += 1;
      const api = GraphView.prototype._lifecycleApi.apply(this, args);
      return lifecycleReads === 1 ? olderHeld.then(() => api) : api;
    };
    const older = view.render({ container });
    const olderRoot = container.children[0];
    const newer = view.render({ container });
    const newerRoot = container.children[0];
    await newer;
    assert(lifecycleReads === 2 && olderRoot && newerRoot && olderRoot !== newerRoot && olderRoot.parentNode === null
      && container.children.length === 1 && liveResize().length === 1 && liveResize()[0].target === newerRoot
      && liveMutation().length === 1 && liveMutation()[0].target === container && view.trace.length === 1,
    'PH1D-ONE-SHOT-BRANCHES (PH1C-ARM-ONLY-WHILE-ATTACHED): the newer overlapping cold-load render finishes first and arms its own root');
    const newerOneShot = liveResize()[0];
    releaseOlder();
    await older;
    await ph1Drain();
    assert(view.trace.length === 2 && liveResize().length === 1 && liveResize()[0] === newerOneShot && newerOneShot.live
      && liveMutation().length === 1 && liveMutation()[0].target === container && container.children[0] === newerRoot,
    'PH1D-ONE-SHOT-BRANCHES (PH1C-ARM-ONLY-WHILE-ATTACHED): the older render, finishing last with its root already removed, arms nothing and leaves the newer one-shot armed');
    container.ph1Width = 590;
    await ph1Frame();
    assert(view.renders === 3 && view.initiated === 2 && isCompact(container) && liveObservers().length === 0,
      'PH1D-ONE-SHOT-BRANCHES (PH1C-ARM-ONLY-WHILE-ATTACHED): two overlapping cold-load renders where the older finishes last end compact at 590');
    await settled('PH1D-ONE-SHOT-BRANCHES (PH1C-ARM-ONLY-WHILE-ATTACHED): two overlapping cold-load renders, the older finishing last, then laid out at 590',
      view, ['wide', 'wide', 'compact'], container);
  }
  // ---- PH1D-ONE-SHOT-HANDOFF-BOUNDARY ----
  // A cold load of chained slices GA-H1 ... GA-H<R> at clientWidth 0 draws
  // wide and arms the one-shot. When the pane lays out at a floor boundary,
  // the one re-render draws exactly the measured width (literals from the
  // card formula, as in PH1D-HANDOFF-BOUNDARY):
  //   394, 8 ranks: 40px pills with short ids, canvas 394, padding 0
  //   393, 8 ranks: 40px pills with short ids, canvas 394, padding 14
  //   404, 5 ranks: 72px pills with full ids, canvas 404, padding 0
  //   403, 5 ranks: 71px pills with short ids, canvas 399, padding 0
  //   399, 5 ranks: 71px pills with short ids, canvas 399, padding 0
  // MUTATION GUARD: PH1D-MUTANT-ONE-SHOT-HANDOFF-MINUS-ONE turns RED at
  // "PH1D-ONE-SHOT-HANDOFF-BOUNDARY: the pane laid out at 394 ..." if the
  // re-render handed a measurement draws decided.width - 1.
  // MUTATION GUARD: PH1D-MUTANT-ONE-SHOT-HANDOFF-PLUS-ONE turns RED at
  // "PH1D-ONE-SHOT-HANDOFF-BOUNDARY: the pane laid out at 393 ..." if it draws
  // decided.width + 1.
  // MUTATION GUARD: PH1D-MUTANT-ONE-SHOT-HANDOFF-EVEN turns RED at
  // "PH1D-ONE-SHOT-HANDOFF-BOUNDARY: the pane laid out at 399 ..." if it draws
  // decided.width rounded down to an even number.
  {
    const savedAppHandoff = global.app;
    const savedCustomJSHandoff = global.customJS;
    for (const [W, R, colW, lefts, ids, canvasWidth, padding] of [
      [394, 8, 40, ph1dLefts8, 'short', 394, 0],
      [393, 8, 40, ph1dLefts8, 'short', 394, 14],
      [404, 5, 72, ph1dLefts5At72, 'full', 404, 0],
      [403, 5, 71, ph1dLefts5At71, 'short', 399, 0],
      [399, 5, 71, ph1dLefts5At71, 'short', 399, 0],
    ]) {
      ph1dUseEnv(ph1dChainEnv(R));
      const container = mountContainer(0);
      const view = countingView();
      await view.render({ container });
      await ph1Drain();
      const [oneShot] = liveResize();
      await ph1Frame();
      assert(oneShot && oneShot.live && oneShot.notifications === 1 && liveResize().length === 1
        && view.renders === 1 && !isCompact(container),
      `PH1D-ONE-SHOT-HANDOFF-BOUNDARY: a cold load of ${R} chained slices at clientWidth 0 draws wide and stays armed through the observe() notification`);
      container.ph1Width = W;
      await ph1Frame();
      assert.deepStrictEqual({ renders: view.renders, drawing: ph1dCompactDrawing(container.children[0]) },
        { renders: 2, drawing: ph1dExpectedDrawing(colW, lefts, ids, canvasWidth, padding) },
        `PH1D-ONE-SHOT-HANDOFF-BOUNDARY: the pane laid out at ${W} re-renders ${R} chained slices once, as ${colW}px pills with ${ids} ids on a ${canvasWidth}px canvas with a ${padding}px scroller padding-bottom`);
      await settled(`PH1D-ONE-SHOT-HANDOFF-BOUNDARY: ${R} chained slices, cold load, then laid out at ${W}`,
        view, ['wide', 'compact'], container);
    }
    global.app = savedAppHandoff;
    global.customJS = savedCustomJSHandoff;
  }
  // ---- PH1D-FRACTIONAL-WIDTH (one-shot) ----
  // A cold load of chained slices at clientWidth 0 draws wide and arms the
  // one-shot; the pane then measures a fractional width, and the one
  // re-render draws exactly that width (literals as in the
  // PH1D-FRACTIONAL-WIDTH rows above):
  //   403.5, 5 ranks: 71px pills with short ids, canvas 399, padding 0
  //   393.5, 8 ranks: 40px pills with short ids, canvas 394, padding 14
  //   0.5, 5 ranks: 40px pills with short ids, canvas 244, padding 14
  // MUTATION GUARD: PH1D-MUTANT-ONE-SHOT-HANDS-ROUNDED turns RED at
  // "PH1D-FRACTIONAL-WIDTH: after a cold load, the pane measuring 403.5 ..."
  // if the one-shot hands its re-render Math.round(fresh.width).
  // MUTATION GUARD: PH1D-MUTANT-ONE-SHOT-HANDS-CEIL turns RED at the same label
  // if it hands Math.ceil(fresh.width).
  // MUTATION GUARD: PH1D-MUTANT-HANDED-WIDTH-ROUNDED turns RED at the same
  // label if the re-render draws Math.round(decided.width).
  // MUTATION GUARD: PH1D-MUTANT-HANDED-WIDTH-CEIL turns RED at the same label
  // if the re-render draws Math.ceil(decided.width).
  // MUTATION GUARD: PH1D-MUTANT-ONE-SHOT-HANDS-FLOOR turns RED at
  // "PH1D-FRACTIONAL-WIDTH: after a cold load, the pane measuring 0.5 ..." if
  // the one-shot hands its re-render Math.floor(fresh.width).
  {
    const savedAppFractional = global.app;
    const savedCustomJSFractional = global.customJS;
    for (const [W, R, colW, lefts, canvasWidth, padding] of [
      [403.5, 5, 71, ph1dLefts5At71, 399, 0],
      [393.5, 8, 40, ph1dLefts8, 394, 14],
      [0.5, 5, 40, [2, 52, 102, 152, 202], 244, 14],
    ]) {
      ph1dUseEnv(ph1dChainEnv(R));
      const container = mountContainer(0);
      const view = countingView();
      await view.render({ container });
      await ph1Drain();
      await ph1Frame();
      container.ph1Width = W;
      await ph1Frame();
      assert.deepStrictEqual({ renders: view.renders, drawing: ph1dCompactDrawing(container.children[0]) },
        { renders: 2, drawing: ph1dExpectedDrawing(colW, lefts, 'short', canvasWidth, padding) },
        `PH1D-FRACTIONAL-WIDTH: after a cold load, the pane measuring ${W} re-renders ${R} chained slices once, as ${colW}px pills with short ids at left ${lefts.join(' ')} on a ${canvasWidth}px canvas with a ${padding}px scroller padding-bottom`);
      await settled(`PH1D-FRACTIONAL-WIDTH: ${R} chained slices, cold load, then measured at ${W}`,
        view, ['wide', 'compact'], container);
    }
    global.app = savedAppFractional;
    global.customJS = savedCustomJSFractional;
  }
  // ---- PH1D-ONE-SHOT-SAME-PRESENTATION ----
  // The first measured notification re-renders once even when the
  // measurement draws the same presentation as the cold-load guess: a
  // default-wide cold load whose pane then measures 1024, and an is-mobile
  // 390 compact cold load whose pane then measures 390. The re-render
  // replaces the cold-load root with a new root whose DOM equals it.
  // MUTATION GUARD: PH1D-MUTANT-SKIP-WIDE-TO-WIDE turns RED at
  // "PH1D-ONE-SHOT-SAME-PRESENTATION: a default-wide cold load ..." if the
  // one-shot skips its re-render when both the guess and the measurement are
  // wide.
  // MUTATION GUARD: PH1D-MUTANT-SKIP-UNCHANGED-WIDTH turns RED at the same
  // label if the one-shot skips its re-render when the measured width equals
  // the guessed width.
  for (const [label, mobile, W, trace] of [
    ['a default-wide cold load whose pane then measures 1024', false, 1024, ['wide', 'wide']],
    ['an is-mobile 390 compact cold load whose pane then measures 390', true, 390, ['compact', 'compact']],
  ]) {
    ph1MobileClass = mobile;
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    const coldRoot = container.children[0];
    const coldShape = JSON.stringify(domShape(coldRoot));
    await ph1Frame();
    container.ph1Width = W;
    await ph1Frame();
    ph1MobileClass = false;
    assert(view.renders === 2 && container.children.length === 1 && container.children[0] !== coldRoot && coldRoot.removed
      && JSON.stringify(domShape(container.children[0])) === coldShape && liveObservers().length === 0,
    `PH1D-ONE-SHOT-SAME-PRESENTATION: ${label} re-renders once, replacing the cold-load root with a new root of the same DOM, and leaves nothing armed`);
    await settled(`PH1D-ONE-SHOT-SAME-PRESENTATION: ${label}`, view, trace, container);
  }
  // ---- PH1D-MUTATION-API-NOT-A-FUNCTION ----
  // A MutationObserver global that is a plain object, not a function: a cold
  // load at clientWidth 0 arms one resize observer on its root and no
  // childList watch, and the pane laying out at 590 re-renders compact once.
  // MUTATION GUARD: PH1D-MUTANT-MUTATION-API-TRUTHY turns RED at
  // "PH1D-MUTATION-API-NOT-A-FUNCTION: with a MutationObserver global that is
  // a plain object, a cold load ..." if any truthy MutationObserver global is
  // constructed.
  {
    global.MutationObserver = {};
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    const armed = liveResize();
    const armedOnRoot = armed.length === 1 && armed[0].target === container.children[0] && liveMutation().length === 0;
    await ph1Frame();
    container.ph1Width = 590;
    await ph1Frame();
    global.MutationObserver = BrowserLikeMutationObserver;
    assert(armedOnRoot, 'PH1D-MUTATION-API-NOT-A-FUNCTION: with a MutationObserver global that is a plain object, a cold load at clientWidth 0 arms one resize observer on its root and no childList watch');
    assert(view.renders === 2 && isCompact(container) && liveObservers().length === 0,
      'PH1D-MUTATION-API-NOT-A-FUNCTION: with that global, the pane laying out at 590 re-renders compact once and leaves nothing armed');
    await settled('PH1D-MUTATION-API-NOT-A-FUNCTION: a plain-object MutationObserver global, cold load, then laid out at 590',
      view, ['wide', 'compact'], container);
  }
  // ---- PH1D-CONTAINER-REPLACED ----
  // A cold load into container A (clientWidth 0) draws wide and arms on A's
  // root. dv.container is then replaced by container B, which measures 590,
  // and A's root gets a 700px content box while A's clientWidth still reads
  // 0. The notification on A's root re-resolves through dv, measures 590,
  // and re-renders once, compact, into B; A keeps its wide root, and no
  // observer is live afterwards.
  // MUTATION GUARD: PH1D-MUTANT-FIRE-WITHOUT-DISARM turns RED at
  // "PH1D-CONTAINER-REPLACED: after dv.container is replaced ..." if the
  // one-shot re-renders without disarming itself first.
  // MUTATION GUARD: PH1D-MUTANT-FIRE-DISCONNECTS-RESIZE-ONLY turns RED at the
  // same label if, as it fires, the one-shot disconnects its resize observer
  // and not its childList watch.
  // MUTATION GUARD: PH1D-MUTANT-REMOVAL-AGAINST-CURRENT-CONTAINER turns RED at
  // the same label if removal compares the root's parent with the current
  // dv.container instead of the container it was armed on.
  {
    const first = mountContainer(0);
    const second = mountContainer(590);
    const dv = { container: first };
    const view = countingView();
    await view.render(dv);
    await ph1Drain();
    const coldRoot = first.children[0];
    assert(view.renders === 1 && liveResize().length === 1 && liveResize()[0].target === coldRoot
      && liveMutation().length === 1 && liveMutation()[0].target === first,
    'PH1D-CONTAINER-REPLACED: a cold load into container A arms one resize observer on its root and one childList watch on A');
    await ph1Frame();
    dv.container = second;
    first.ph1Content = 700;
    await ph1Frame();
    assert(view.renders === 2 && first.children.length === 1 && first.children[0] === coldRoot && !isCompact(first)
      && second.children.length === 1 && isCompact(second) && liveObservers().length === 0,
    'PH1D-CONTAINER-REPLACED: after dv.container is replaced by container B measuring 590, the notification on A\'s root re-renders once, compact, into B, A keeps its wide root, and no observer is live');
    await settled('PH1D-CONTAINER-REPLACED: cold load into A, dv.container replaced by B at 590, then A\'s root resized',
      view, ['wide', 'compact'], second);
  }
  // ---- PH1D-ONE-SHOT-AFTER-RENDER-ERROR ----
  // An unmeasured cold load whose render records a render_error still arms
  // one one-shot, and the pane measuring 500 re-renders compact once. Each
  // fault throws on its first call only:
  //   _applyCrossEpicStubs, without is-mobile: the default-wide render records it;
  //   _compactGeometry, on an is-mobile body: the 390 compact attempt fails
  //     and the wide fallback records it;
  //   _renderGraph, without is-mobile: the default-wide render records it and
  //     draws no graph.
  // MUTATION GUARD: PH1D-MUTANT-NO-ARM-AFTER-RENDER-ERROR turns RED at
  // "PH1D-ONE-SHOT-AFTER-RENDER-ERROR: an unmeasured cold load with a
  // cross-epic stub fault ..." if a render that recorded a render_error arms
  // nothing.
  // MUTATION GUARD: PH1D-MUTANT-ARM-ONLY-WHEN-PRESENTED-OR-WIDE turns RED at
  // "PH1D-ONE-SHOT-AFTER-RENDER-ERROR: an unmeasured cold load with a compact
  // geometry fault ..." if a narrow render arms only when its compact map was
  // presented.
  // MUTATION GUARD: PH1D-MUTANT-ARM-ONLY-AFTER-DRAWN-GRAPH turns RED at
  // "PH1D-ONE-SHOT-AFTER-RENDER-ERROR: an unmeasured cold load with a wide
  // graph fault ..." if the install runs only after a compact or wide graph
  // drew without throwing.
  for (const [label, method, fault, mobile] of [
    ['a cross-epic stub fault without is-mobile', '_applyCrossEpicStubs', 'cross-epic stub fault', false],
    ['a compact geometry fault on an is-mobile body', '_compactGeometry', 'compact geometry fault', true],
    ['a wide graph fault without is-mobile', '_renderGraph', 'wide graph fault', false],
  ]) {
    ph1MobileClass = mobile;
    const container = mountContainer(0);
    const view = countingView();
    let calls = 0;
    view[method] = function faultOnce(...args) {
      calls += 1;
      if (calls === 1) throw new Error(fault);
      return GraphView.prototype[method].apply(this, args);
    };
    await view.render({ container });
    await ph1Drain();
    ph1MobileClass = false;
    const root = container.children[0];
    const errorRows = byClass(root, 'warning-render-error');
    const [oneShot] = liveResize();
    assert(calls === 1 && view.renders === 1 && !isCompact(container)
      && errorRows.length === 1 && errorRows[0].textContent === `GraphView: ${fault}`
      && liveResize().length === 1 && oneShot.target === root && liveMutation().length === 1 && liveMutation()[0].target === container,
    `PH1D-ONE-SHOT-AFTER-RENDER-ERROR: an unmeasured cold load with ${label} records one render_error row and arms one one-shot on its root`);
    await ph1Frame();
    container.ph1Width = 500;
    await ph1Frame();
    assert(view.renders === 2 && isCompact(container) && byClass(container.children[0], 'warning-render-error').length === 0
      && liveObservers().length === 0,
    `PH1D-ONE-SHOT-AFTER-RENDER-ERROR: after ${label}, the pane measuring 500 re-renders compact exactly once with no render_error row`);
    await settled(`PH1D-ONE-SHOT-AFTER-RENDER-ERROR: ${label}`, view, ['wide', 'compact'], container);
  }
  // ---- PH1D-ONE-SHOT-SINGLE-OWNER ----
  // A container without querySelector keeps every root drawn into it. Two
  // overlapping cold-load renders of it, the older finishing last (its
  // lifecycle read is held until the newer render has finished and armed):
  // both roots stay children, the older render's install replaces the newer
  // one-shot, and exactly one one-shot is armed, on the older root. The pane
  // laying out at 590 re-renders compact once, into a third root.
  // MUTATION GUARD: PH1D-MUTANT-NO-INSTALL-DISARM turns RED at
  // "PH1D-ONE-SHOT-SINGLE-OWNER: two overlapping cold-load renders ..." if an
  // install arms without first disarming its container's one-shot.
  // MUTATION GUARD: PH1D-MUTANT-INSTALL-AFTER-CHROME turns RED at the same
  // label if the install runs right after the section chrome is drawn.
  // MUTATION GUARD: PH1D-MUTANT-INSTALL-BEFORE-AWAITS turns RED at the same
  // label if the install runs right after the scope check, before the graph
  // is drawn.
  {
    const container = mountContainer(0);
    container.querySelector = undefined;
    const view = countingView();
    let releaseOlder = null;
    const olderHeld = new Promise((resolve) => { releaseOlder = resolve; });
    let lifecycleReads = 0;
    view._lifecycleApi = function heldLifecycleApi(...args) {
      lifecycleReads += 1;
      const api = GraphView.prototype._lifecycleApi.apply(this, args);
      return lifecycleReads === 1 ? olderHeld.then(() => api) : api;
    };
    const older = view.render({ container });
    const olderRoot = container.children[0];
    const newer = view.render({ container });
    const newerRoot = container.children[1];
    await newer;
    releaseOlder();
    await older;
    await ph1Drain();
    assert(lifecycleReads === 2 && container.children.length === 2 && container.children[0] === olderRoot
      && container.children[1] === newerRoot && liveResize().length === 1 && liveResize()[0].target === olderRoot
      && liveMutation().length === 1 && liveMutation()[0].target === container,
    'PH1D-ONE-SHOT-SINGLE-OWNER: two overlapping cold-load renders of a container without querySelector, the older finishing last, keep both roots and leave exactly one one-shot armed, on the older root');
    container.ph1Width = 590;
    await ph1Frame();
    assert(view.renders === 3 && container.children.length === 3
      && byClass(container.children[2], 'graph-view-compact').length === 1 && liveObservers().length === 0,
    'PH1D-ONE-SHOT-SINGLE-OWNER: the pane laying out at 590 re-renders compact once, into a third root, and leaves nothing armed');
    await settled('PH1D-ONE-SHOT-SINGLE-OWNER: overlapping cold loads into a container without querySelector, then laid out at 590',
      view, ['wide', 'wide', 'compact']);
  }
  // ---- PH1D-ONE-SHOT-ROOT-MOVED ----
  // A root moved out of its container into another element has left that
  // container: the next frame's childList record disarms the one-shot, and
  // the pane laying out at 590 afterwards renders nothing.
  // MUTATION GUARD: PH1D-MUTANT-REMOVED-MEANS-NO-PARENT turns RED at
  // "PH1D-ONE-SHOT-ROOT-MOVED: a root moved from its container ..." if
  // removal means the root has no parent instead of a parent other than its
  // container.
  {
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    const [oneShot] = liveResize();
    const elsewhere = element();
    elsewhere.insertBefore(container.children[0], null);
    await ph1Frame();
    assert(oneShot && oneShot.disconnected >= 1 && liveObservers().length === 0
      && container.children.length === 0 && elsewhere.children.length === 1,
    'PH1D-ONE-SHOT-ROOT-MOVED: a root moved from its container into another element disarms the one-shot on the next frame');
    container.ph1Width = 590;
    elsewhere.ph1Width = 700;
    await ph1Frame();
    assert(view.renders === 1 && container.children.length === 0,
      'PH1D-ONE-SHOT-ROOT-MOVED: the pane laying out at 590 after the move renders nothing');
    await settled('PH1D-ONE-SHOT-ROOT-MOVED: a root moved into another element', view, ['wide']);
  }
  // ---- PH1D-EARLY-RETURN-DISARM ----
  // A render into a container whose cold-load one-shot is armed disarms it
  // even when that render returns early: RenderSafe finds no page, the
  // scope is unknown, or the scope is project. The early render arms
  // nothing, and the pane laying out at 590 renders nothing more.
  // MUTATION GUARD: PH1D-MUTANT-DISARM-AFTER-PAGE-CHECK turns RED at
  // "PH1D-EARLY-RETURN-DISARM: a render that finds no page ..." if the
  // render-start disarm moves after the page check.
  // MUTATION GUARD: PH1D-MUTANT-DISARM-AFTER-SCOPE-CHECK turns RED at the
  // same label if the render-start disarm moves after the scope checks.
  // MUTATION GUARD: PH1D-MUTANT-INSTALL-IN-PROJECT-SCOPE turns RED at
  // "PH1D-EARLY-RETURN-DISARM: a project-scope render ..." if a project-scope
  // render arms a one-shot.
  for (const [label, overrides, pageless] of [
    ['a render that finds no page', undefined, true],
    ['a render with an unknown scope', { scope: 'elsewhere' }, false],
    ['a project-scope render', { scope: 'project' }, false],
  ]) {
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    const [oneShot] = liveResize();
    const customJSBefore = global.customJS;
    if (pageless) global.customJS = { ...customJSBefore, RenderSafe: { page: () => null } };
    await view.render({ container }, overrides);
    await ph1Drain();
    global.customJS = customJSBefore;
    assert(oneShot && oneShot.disconnected >= 1 && liveObservers().length === 0 && view.renders === 2
      && container.children.length === 1,
    `PH1D-EARLY-RETURN-DISARM: ${label} into a container with an armed cold-load one-shot disarms it and arms nothing`);
    container.ph1Width = 590;
    await ph1Frame();
    assert.strictEqual(view.renders, 2,
      `PH1D-EARLY-RETURN-DISARM: after ${label}, the pane laying out at 590 renders nothing`);
    await settled(`PH1D-EARLY-RETURN-DISARM: ${label}`, view, ['wide', 'wide']);
  }
  // ---- PH1D-ONE-SHOT-MEASURED-ONLY ----
  // Only a measured resolution fires the one-shot. An args object whose
  // containerWidth read throws at render and reads 500 afterwards leaves the
  // render unmeasured; the notifications after it re-resolve the 500
  // override, which is not a measurement, so nothing re-renders, even after
  // the pane lays out at 590. Removing the root then disarms it.
  // MUTATION GUARD: PH1D-MUTANT-FIRE-ON-OVERRIDE turns RED at
  // "PH1D-ONE-SHOT-MEASURED-ONLY: two notifications ..." if an override
  // resolution also fires the one-shot.
  {
    const container = mountContainer(0);
    const view = countingView();
    let argReads = 0;
    const args = {
      get containerWidth() {
        argReads += 1;
        if (argReads === 1) throw new Error('args unreadable');
        return 500;
      },
    };
    await view.render({ container }, args);
    await ph1Drain();
    const [oneShot] = liveResize();
    await ph1Frame();
    container.ph1Width = 590;
    await ph1Frame();
    assert(oneShot && oneShot.live && oneShot.notifications === 2 && argReads === 3 && view.renders === 1
      && !isCompact(container),
    'PH1D-ONE-SHOT-MEASURED-ONLY: two notifications that re-resolve a 500 override, before and after the pane lays out at 590, re-render nothing and keep the one-shot armed');
    container.children[0].remove();
    await ph1Frame();
    await settled('PH1D-ONE-SHOT-MEASURED-ONLY: an override that becomes readable after an unmeasured render, then the root removed',
      view, ['wide']);
  }
  // ---- PH1D-ONE-SHOT-KEEPS-ARGS ----
  // The one-shot re-renders with the args of the render that armed it. A
  // view whose own scope is project, rendered with args { scope: 'epic' } at
  // clientWidth 0, draws the wide epic map and arms; the pane laying out at
  // 590 re-renders the epic map once, compact.
  // MUTATION GUARD: PH1D-MUTANT-RERENDER-DROPS-ARGS turns RED at
  // "PH1D-ONE-SHOT-KEEPS-ARGS: the pane laying out at 590 ..." if the one-shot
  // re-renders without the args it was armed with.
  {
    const container = mountContainer(0);
    const view = countingView();
    view._scope = 'project';
    await view.render({ container }, { scope: 'epic' });
    await ph1Drain();
    assert(view.renders === 1 && hasGraph(container.children[0]) && !isCompact(container)
      && liveResize().length === 1 && liveMutation().length === 1,
    'PH1D-ONE-SHOT-KEEPS-ARGS: a project-scope view rendered with args { scope: \'epic\' } at clientWidth 0 draws the wide epic map and arms one one-shot');
    await ph1Frame();
    container.ph1Width = 590;
    await ph1Frame();
    assert(view.renders === 2 && isCompact(container) && liveObservers().length === 0,
      'PH1D-ONE-SHOT-KEEPS-ARGS: the pane laying out at 590 re-renders the epic map once, compact');
    await settled('PH1D-ONE-SHOT-KEEPS-ARGS: args { scope: \'epic\' } on a project-scope view, cold load, then laid out at 590',
      view, ['wide', 'compact'], container);
  }
  // ---- PH1D-ONE-DISARM ----
  // Two one-shots whose observers each count exactly one disconnect() call.
  // First, a cold load at clientWidth 0 that fires when the pane lays out at
  // 590, then a measured Dataview re-run of the same container: the fired
  // one-shot's resize observer and childList watch each count one
  // disconnect(). Second, with no MutationObserver API, a root laid out to a
  // 240px content box and then removed is disarmed by its removal
  // notification; a measured re-run of the container at 590 after that
  // leaves the resize observer's count at one.
  // MUTATION GUARD: PH1D-MUTANT-OWNER-NEVER-DELETED (O22) turns RED at
  // "PH1D-ONE-DISARM: a one-shot that fired when the pane laid out at 590
  // ..." if disarming leaves the container's ownership entry in place.
  // MUTATION GUARD: PH1D-MUTANT-DISARM-AFTER-RERENDER (O32) turns RED at the
  // same label if the one-shot starts its re-render before disarming itself.
  // MUTATION GUARD: PH1D-MUTANT-REMOVAL-DISCONNECTS-RESIZE-ONLY (O57) turns RED
  // at "PH1D-ONE-DISARM: with no MutationObserver API, a laid-out root
  // removed ..." if the resize callback's removal branch disconnects the
  // resize observer instead of disarming.
  {
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    const [resize] = liveResize();
    const [watch] = liveMutation();
    container.ph1Width = 590;
    await ph1Frame();
    await view.render({ container });
    await ph1Drain();
    assert(resize && watch && resize.disconnected === 1 && watch.disconnected === 1 && view.renders === 3 && view.initiated === 2
      && isCompact(container) && liveObservers().length === 0,
    'PH1D-ONE-DISARM: a one-shot that fired when the pane laid out at 590, followed by a measured re-run of its container, counts exactly one disconnect() on its resize observer and one on its childList watch');
    await settled('PH1D-ONE-DISARM: cold load, laid out at 590, then a measured re-run', view, ['wide', 'compact', 'compact'], container);
  }
  {
    global.MutationObserver = undefined;
    const container = mountContainer(0, 240);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    const [resize] = liveResize();
    await ph1Frame();
    container.children[0].remove();
    await ph1Frame();
    container.ph1Width = 590;
    await view.render({ container });
    await ph1Drain();
    global.MutationObserver = BrowserLikeMutationObserver;
    assert(resize && resize.notifications === 2 && resize.disconnected === 1 && view.renders === 2 && isCompact(container)
      && liveObservers().length === 0,
    'PH1D-ONE-DISARM: with no MutationObserver API, a laid-out root removed and disarmed by its removal notification, followed by a measured re-run of its container at 590, counts exactly one disconnect() on the resize observer');
    await settled('PH1D-ONE-DISARM: no MutationObserver API, a laid-out root removed, then a measured re-run at 590',
      view, ['wide', 'compact'], container);
  }
  // ---- PH1D-ROOT-MOVED-DURING-RENDER ----
  // A cold-load render at clientWidth 0 whose lifecycle read is held; while
  // it is held the root is moved into another element. When the render
  // finishes its root's parent is that element, not the container, so it
  // arms nothing, and the pane laying out at 590 renders nothing.
  // MUTATION GUARD: PH1D-MUTANT-ARM-WHEN-ROOT-HAS-A-PARENT (C02) turns RED at
  // "PH1D-ROOT-MOVED-DURING-RENDER: a cold-load root moved into another
  // element while its render awaits ..." if the installer arms whenever the
  // root has any parent.
  {
    const container = mountContainer(0);
    const view = countingView();
    let release = null;
    const held = new Promise((resolve) => { release = resolve; });
    view._lifecycleApi = function heldLifecycleApi(...args) {
      const api = GraphView.prototype._lifecycleApi.apply(this, args);
      return held.then(() => api);
    };
    const rendering = view.render({ container });
    const root = container.children[0];
    const elsewhere = element();
    elsewhere.insertBefore(root, null);
    release();
    await rendering;
    await ph1Drain();
    assert(root && root.parentNode === elsewhere && hasGraph(root) && container.children.length === 0
      && liveObservers().length === 0 && view.renders === 1,
    'PH1D-ROOT-MOVED-DURING-RENDER: a cold-load root moved into another element while its render awaits draws its graph there and arms nothing when the render finishes');
    container.ph1Width = 590;
    elsewhere.ph1Width = 700;
    await ph1Frame();
    assert(view.renders === 1 && container.children.length === 0,
      'PH1D-ROOT-MOVED-DURING-RENDER: the pane laying out at 590 after that renders nothing');
    await settled('PH1D-ROOT-MOVED-DURING-RENDER: a root moved into another element while its render awaits', view, ['wide']);
  }
  // ---- PH1D-DECIDED-RENDER-DISARMS ----
  // One view and one dv. A cold load into container A arms one-shot A on
  // A's root. dv.container is replaced by container B, which has no
  // querySelector (so it keeps every root drawn into it), and a cold load
  // into B arms one-shot B. When B lays out at 590 and A's root gets a 700px
  // content box, one-shot A fires first and re-renders through dv into B;
  // that re-render disarms one-shot B as it starts, so B's old root, still
  // in B and now measuring 590, re-renders nothing more.
  // MUTATION GUARD: PH1D-MUTANT-DECIDED-RENDER-SKIPS-DISARM (C01) turns RED at
  // "PH1D-DECIDED-RENDER-DISARMS: one-shot A re-renders once, compact, into
  // B, ..." if a render handed a measurement skips the render-start disarm.
  {
    const first = mountContainer(0);
    const second = mountContainer(0);
    second.querySelector = undefined;
    const dv = { container: first };
    const view = countingView();
    await view.render(dv);
    await ph1Drain();
    await ph1Frame();
    dv.container = second;
    await view.render(dv);
    await ph1Drain();
    await ph1Frame();
    const [oneShotA, oneShotB] = liveResize();
    assert(oneShotA && oneShotB && liveResize().length === 2 && oneShotA.target === first.children[0]
      && oneShotB.target === second.children[0] && liveMutation().length === 2 && view.renders === 2,
    'PH1D-DECIDED-RENDER-DISARMS: cold loads into A and then, through the same dv, into B leave one one-shot armed on each root');
    second.ph1Width = 590;
    first.ph1Content = 700;
    await ph1Frame();
    assert(view.renders === 3 && view.initiated === 2 && oneShotB.disconnected === 1 && oneShotB.notifications === 1
      && second.children.length === 2 && byClass(second.children[1], 'graph-view-compact').length === 1 && liveObservers().length === 0,
    'PH1D-DECIDED-RENDER-DISARMS: one-shot A re-renders once, compact, into B, and that re-render disarms one-shot B before B\'s old root is notified, so nothing else renders');
    await settled('PH1D-DECIDED-RENDER-DISARMS: cold loads into A and B through one dv, then A resized while B lays out at 590',
      view, ['wide', 'wide', 'compact']);
  }
  // ---- PH1D-PARTIAL-RENDER-ARMS-NOTHING ----
  // An unmeasured render that throws out of its warnings strip ends in the
  // render-safe catch: its graph is drawn, it arms nothing, and the pane
  // laying out at 590 renders nothing.
  // MUTATION GUARD: PH1D-MUTANT-INSTALL-BEFORE-WARNINGS (O59) turns RED at
  // "PH1D-PARTIAL-RENDER-ARMS-NOTHING: an unmeasured render whose warnings
  // strip throws ..." if the one-shot is installed before the warnings strip
  // is drawn.
  {
    const container = mountContainer(0);
    const view = countingView();
    let faults = 0;
    view._renderWarnings = function faultOnce(...args) {
      faults += 1;
      if (faults === 1) throw new Error('warnings strip fault');
      return GraphView.prototype._renderWarnings.apply(this, args);
    };
    await view.render({ container });
    await ph1Drain();
    assert(faults === 1 && view.renders === 1 && hasGraph(container.children[0]) && liveObservers().length === 0,
      'PH1D-PARTIAL-RENDER-ARMS-NOTHING: an unmeasured render whose warnings strip throws draws its graph and arms nothing');
    container.ph1Width = 590;
    await ph1Frame();
    assert(view.renders === 1 && !isCompact(container),
      'PH1D-PARTIAL-RENDER-ARMS-NOTHING: the pane laying out at 590 after that renders nothing');
    await settled('PH1D-PARTIAL-RENDER-ARMS-NOTHING: an unmeasured render whose warnings strip throws', view, ['wide']);
  }
  // ---- PH1D-INTERACT-WHILE-ARMED ----
  // A cold load at clientWidth 0 arms the one-shot; after its first frame the
  // harness interacts with the drawn graph, and then the pane lays out:
  //   without the is-mobile class (wide at 1024), with one of: a tap on the
  //     first chip (its card stays open); a tap on the first chip and then
  //     Close; a tap on the first chip and then Open slice; a canvas tap;
  //     Stuck on and then off; Dim done on. The pane then lays out at 590;
  //   with the is-mobile class (compact at 390), a tap on the first pill (its
  //     card stays open). The pane then measures 800.
  // In each case the view's _disarmColdLoad, _renderAtWidth, and
  // _installColdLoadObserver are wrapped: each _disarmColdLoad call is
  // counted as inside or outside a synchronous run of the other two. The
  // interaction makes no _disarmColdLoad call outside them, and the frame
  // after the layout re-renders the map exactly once, to the measured
  // presentation, leaving one root in the container and nothing armed
  // (settled() then checks ten quiet seconds).
  // MUTATION GUARD: PH1D-MUTANT-SELECT-DISARMS (T02) turns RED at
  // "PH1D-INTERACT-WHILE-ARMED: a wide cold load, then a tap on the first
  // chip ..." if selecting a node disarms the container's one-shot.
  // MUTATION GUARD: PH1D-MUTANT-ONE-SHOT-SKIPS-OPEN-CARD (T01) turns RED at
  // "PH1D-INTERACT-WHILE-ARMED: a wide cold load, then a tap on the first
  // chip, and then the pane laid out at 590 ..." if the one-shot does not
  // re-render while a card is open.
  // MUTATION GUARD: PH1D-MUTANT-ONE-SHOT-SKIPS-DIMMED (T03) turns RED at the
  // same label if the one-shot does not re-render while a node is dimmed or
  // a filter is on.
  // MUTATION GUARD: PH1D-MUTANT-RERENDER-KEEPS-ROOT-WITH-CARD (T06) turns RED
  // at the same label if the one-shot's re-render keeps the previous root
  // when it holds a card.
  // MUTATION GUARD: PH1D-MUTANT-OPEN-CARD-DISARMS-WITHOUT-RERENDER (T07) turns RED
  // at the same label if the one-shot disarms without re-rendering while a
  // card is open.
  // MUTATION GUARD: PH1D-MUTANT-DIMMED-DISARMS-WITHOUT-RERENDER (T08) turns RED
  // at the same label if the one-shot disarms without re-rendering while a
  // node is dimmed or a filter is on.
  // MUTATION GUARD: PH1D-MUTANT-CLEAR-DISARMS (T04) turns RED at
  // "PH1D-INTERACT-WHILE-ARMED: a wide cold load, then a tap on the first
  // chip and then Close ..." if clearing the selection disarms the
  // container's one-shot.
  // MUTATION GUARD: PH1D-MUTANT-OPEN-SLICE-DISARMS (T11) turns RED at
  // "PH1D-INTERACT-WHILE-ARMED: a wide cold load, then a tap on the first
  // chip and then Open slice ..." if Open slice disarms the container's
  // one-shot.
  // MUTATION GUARD: PH1D-MUTANT-FILTER-TOGGLE-DISARMS (T05) turns RED at
  // "PH1D-INTERACT-WHILE-ARMED: a wide cold load, then Stuck on and then off
  // ..." if a filter toggle disarms the container's one-shot.
  // MUTATION GUARD: PH1D-MUTANT-PILL-TAP-DISARMS (T09) turns RED at
  // "PH1D-INTERACT-WHILE-ARMED: an is-mobile compact cold load, then a tap on
  // the first pill ..." if a pill tap disarms the container's one-shot.
  for (const [label, mobile, width, act, trace] of [
    ['a wide cold load, then a tap on the first chip', false, 590,
      (root) => { bubblingClick(byClass(root, 'graph-view-chip')[0]); }, ['wide', 'compact']],
    ['a wide cold load, then a tap on the first chip and then Close', false, 590,
      (root) => { bubblingClick(byClass(root, 'graph-view-chip')[0]); bubblingClick(byClass(root, 'graph-view-detail-close')[0]); }, ['wide', 'compact']],
    ['a wide cold load, then a tap on the first chip and then Open slice', false, 590,
      (root) => { bubblingClick(byClass(root, 'graph-view-chip')[0]); bubblingClick(byClass(root, 'graph-view-detail-open')[0]); }, ['wide', 'compact']],
    ['a wide cold load, then a canvas tap', false, 590,
      (root) => { bubblingClick(byClass(root, 'graph-view-canvas')[0]); }, ['wide', 'compact']],
    ['a wide cold load, then Stuck on and then off', false, 590,
      (root) => { bubblingClick(byClass(root, 'graph-view-filter-stuck')[0]); bubblingClick(byClass(root, 'graph-view-filter-stuck')[0]); }, ['wide', 'compact']],
    ['a wide cold load, then Dim done on', false, 590,
      (root) => { bubblingClick(byClass(root, 'graph-view-filter-done')[0]); }, ['wide', 'compact']],
    ['an is-mobile compact cold load, then a tap on the first pill', true, 800,
      (root) => { bubblingClick(byClass(root, 'graph-view-pill')[0]); }, ['compact', 'wide']],
  ]) {
    ph1MobileClass = mobile;
    const container = mountContainer(0);
    const view = countingView();
    const sites = { inside: 0, outside: 0 };
    let depth = 0;
    for (const name of ['_renderAtWidth', '_installColdLoadObserver']) {
      const original = view[name].bind(view);
      view[name] = (...args) => {
        depth += 1;
        try { return original(...args); } finally { depth -= 1; }
      };
    }
    const disarm = view._disarmColdLoad.bind(view);
    view._disarmColdLoad = (...args) => {
      sites[depth > 0 ? 'inside' : 'outside'] += 1;
      return disarm(...args);
    };
    await view.render({ container });
    await ph1Drain();
    await ph1Frame();
    ph1MobileClass = false;
    const armed = liveResize().length;
    const insideBefore = sites.inside;
    act(container.children[0]);
    assert(armed === 1 && insideBefore > 0 && sites.outside === 0 && liveResize().length === 1,
      `PH1D-INTERACT-WHILE-ARMED: ${label}: the interaction leaves the one-shot armed and makes no _disarmColdLoad call outside _renderAtWidth and _installColdLoadObserver`);
    container.ph1Width = width;
    await ph1Frame();
    assert(view.renders === 2 && view.initiated === 1 && container.children.length === 1
      && isCompact(container) === (trace[1] === 'compact') && liveObservers().length === 0 && sites.outside === 0,
    `PH1D-INTERACT-WHILE-ARMED: ${label}, and then the pane laid out at ${width}: one re-render draws the ${trace[1]} map, the container holds one root, and nothing is armed`);
    await settled(`PH1D-INTERACT-WHILE-ARMED: ${label}, then laid out at ${width}`, view, trace, container);
  }
  // ---- PH1D-COMPACT-WIDE-PARITY (width sources) ----
  // ph1dParity.run() (the replay, the parity assertions, and the model
  // anchors) runs on the render() fixture three more times. Each run's wide
  // drawing is render() at a containerWidth override of 1024; its compact
  // drawing is render() with no override, reached through:
  //   a measured clientWidth of 390;
  //   an unmeasured clientWidth of 0 with the is-mobile body class, which
  //     arms a one-shot on the compact root; after the replay the pane lays
  //     out at 800, and the one-shot re-renders the map exactly once, wide,
  //     leaving one root and nothing armed;
  //   a cold-load one-shot re-render: a render at clientWidth 0 without the
  //     is-mobile class draws wide and arms the one-shot, and when the pane
  //     lays out at 390 the one-shot re-renders the map once, compact.
  // MUTATION GUARD: PH1D-MUTANT-MEASURED-PILLS-OPEN (A4) turns RED at
  // "PH1D-COMPACT-WIDE-PARITY: render() of six slices and two cross-epic
  // stubs, compact from a measured clientWidth of 390, step 1 (tap PA-1
  // Base): ..." if compact pills drawn at a measured or mobile-class width
  // open their note instead of selecting.
  // MUTATION GUARD: PH1D-MUTANT-MEASURED-NO-OUTCOMES (A6) turns RED at the same
  // label if a compact map drawn at a measured width loads no Outcomes.
  // MUTATION GUARD: PH1D-MUTANT-MOBILE-CLASS-UNREGISTERED (A5) turns RED at
  // "PH1D-COMPACT-WIDE-PARITY: render() of six slices and two cross-epic
  // stubs, compact from an unmeasured clientWidth of 0 with the is-mobile
  // body class, step 1 (tap PA-1 Base): ..." if a compact map drawn at the
  // mobile-class width registers no pill.
  // MUTATION GUARD: PH1D-MUTANT-MOBILE-CLASS-NO-OUTCOMES (A9) turns RED at the
  // same label if a compact map drawn at the mobile-class width loads no
  // Outcomes.
  // MUTATION GUARD: PH1D-MUTANT-MOBILE-CLASS-PILLS-OPEN (A10) turns RED at the
  // same label if compact pills drawn at the mobile-class width open their
  // note instead of selecting.
  // MUTATION GUARD: PH1D-MUTANT-HANDOFF-PILLS-OPEN (A1) turns RED at
  // "PH1D-COMPACT-WIDE-PARITY: render() of six slices and two cross-epic
  // stubs, compact from a cold-load one-shot re-render at 390, step 1 (tap
  // PA-1 Base): ..." if compact pills drawn by the one-shot's re-render open
  // their note instead of selecting.
  // MUTATION GUARD: PH1D-MUTANT-HANDOFF-UNREGISTERED (A2) turns RED at the same
  // label if a compact map drawn by the one-shot's re-render registers no
  // pill.
  // MUTATION GUARD: PH1D-MUTANT-HANDOFF-NO-OUTCOMES (A3) turns RED at the same
  // label if a compact map drawn by the one-shot's re-render loads no
  // Outcomes.
  // MUTATION GUARD: PH1D-MUTANT-HANDOFF-SOURCE-LOST (A7) turns RED at
  // "PH1D-COMPACT-WIDE-PARITY: render() of six slices and two cross-epic
  // stubs, compact from a cold-load one-shot re-render at 390, step 2 (tap
  // PA-1 Base): ..." if the one-shot's re-render hands the compact map an
  // empty source path.
  {
    const savedApp = global.app;
    const savedCustomJS = global.customJS;
    let armed = null;
    const drawers = [
      ['a measured clientWidth of 390', async () => {
        const container = mountContainer(390);
        await new GraphView({ lifecycleApi, insights: new GraphInsights() }).render({ container });
        assert(isCompact(container) && liveObservers().length === 0,
          'PH1D-COMPACT-WIDE-PARITY: render() with no override at a measured clientWidth of 390 draws the compact map and arms nothing');
        return container.children[0];
      }],
      ['an unmeasured clientWidth of 0 with the is-mobile body class', async () => {
        ph1MobileClass = true;
        const container = mountContainer(0);
        const view = countingView();
        await view.render({ container });
        await ph1Drain();
        ph1MobileClass = false;
        armed = { container, view };
        assert(isCompact(container) && liveResize().length === 1 && liveResize()[0].target === container.children[0],
          'PH1D-COMPACT-WIDE-PARITY: render() with no override at an unmeasured clientWidth of 0 on an is-mobile body draws the compact map and arms one one-shot on its root');
        return container.children[0];
      }],
      ['a cold-load one-shot re-render at 390', async () => {
        const container = mountContainer(0);
        const view = countingView();
        await view.render({ container });
        await ph1Drain();
        await ph1Frame();
        container.ph1Width = 390;
        await ph1Frame();
        assert(view.renders === 2 && view.initiated === 1 && isCompact(container) && liveObservers().length === 0,
          'PH1D-COMPACT-WIDE-PARITY: a render with no override at clientWidth 0 without the is-mobile class, and then the pane laying out at 390, re-render the map once, compact, and leave nothing armed');
        return container.children[0];
      }],
    ];
    for (const [source, drawCompact] of drawers) {
      const fixture = ph1dRenderFixture(`render() of six slices and two cross-epic stubs, compact from ${source}`, drawCompact);
      ph1dUseEnv(fixture.env);
      await ph1dParity.run(fixture);
      if (armed) {
        armed.container.ph1Width = 800;
        await ph1Frame();
        await ph1Frame();
        assert(armed.view.renders === 2 && armed.view.initiated === 1 && armed.container.children.length === 1
          && !isCompact(armed.container) && hasGraph(armed.container.children[0]),
        'PH1D-COMPACT-WIDE-PARITY: after the replay on the is-mobile compact drawing, the pane laying out at 800 re-renders the map exactly once, wide, and the container holds one root');
        armed = null;
      }
      assert.deepStrictEqual([liveObservers().length, fixture.env.mutations], [0, []],
        `PH1D-COMPACT-WIDE-PARITY: after the replay on the compact drawing from ${source}, no observer is live and no vault mutator ran`);
    }
    global.app = savedApp;
    global.customJS = savedCustomJS;
  }
  // ---- PH1D-NO-RESIZE-LISTENERS ----
  // With window, visualViewport, and app.workspace.on stubs that record each
  // call: render() at a measured clientWidth of 900, at a containerWidth
  // override of 390, and at an unmeasured clientWidth of 0 whose one-shot
  // fires when the pane lays out at 590, followed by ten quiet seconds, make
  // no call to window.addEventListener, visualViewport.addEventListener, or
  // app.workspace.on.
  // MUTATION GUARD: PH1D-MUTANT-WINDOW-RESIZE-LISTENER (H1) turns RED at
  // "PH1D-NO-RESIZE-LISTENERS: render() at a measured 900 ..." if a measured
  // render registers a window resize listener.
  // MUTATION GUARD: PH1D-MUTANT-WORKSPACE-RESIZE-LISTENER (H2) turns RED at the
  // same label if a render whose width source is not 'default' registers an
  // app.workspace resize listener.
  // MUTATION GUARD: PH1D-MUTANT-VIEWPORT-RESIZE-LISTENER (H4) turns RED at the
  // same label if a render registers a visualViewport resize listener.
  {
    const calls = [];
    const recorder = (surface) => (...args) => { calls.push([surface, String(args[0])]); };
    const savedWindow = Object.getOwnPropertyDescriptor(global, 'window');
    const savedViewport = Object.getOwnPropertyDescriptor(global, 'visualViewport');
    const workspace = global.app.workspace;
    const savedOn = Object.getOwnPropertyDescriptor(workspace, 'on');
    global.window = { addEventListener: recorder('window.addEventListener') };
    global.visualViewport = { addEventListener: recorder('visualViewport.addEventListener') };
    workspace.on = recorder('app.workspace.on');
    const view = countingView();
    await view.render({ container: mountContainer(900) });
    await view.render({ container: mountContainer(0) }, { containerWidth: 390 });
    const cold = mountContainer(0);
    await view.render({ container: cold });
    await ph1Drain();
    await ph1Frame();
    cold.ph1Width = 590;
    await ph1Frame();
    await settled('PH1D-NO-RESIZE-LISTENERS: a measured 900 render, a 390 override render, and a cold load laid out at 590',
      view, ['wide', 'compact', 'wide', 'compact'], cold);
    if (savedWindow) Object.defineProperty(global, 'window', savedWindow);
    else delete global.window;
    if (savedViewport) Object.defineProperty(global, 'visualViewport', savedViewport);
    else delete global.visualViewport;
    if (savedOn) Object.defineProperty(workspace, 'on', savedOn);
    else delete workspace.on;
    assert.deepStrictEqual(calls, [],
      'PH1D-NO-RESIZE-LISTENERS: render() at a measured 900, at a 390 override, and at an unmeasured 0 whose one-shot fires at 590, then ten quiet seconds, make no call to window.addEventListener, visualViewport.addEventListener, or app.workspace.on');
  }
  assert.deepStrictEqual(ph1StubViolations, [],
    'PH1D-STUB-VIOLATIONS: no observer-stub misuse is recorded at the end of the one-shot fixtures');
  global.ResizeObserver = savedResizeObserver;
  global.MutationObserver = savedMutationObserver;
  global.setTimeout = savedSetTimeout;
  global.clearTimeout = savedClearTimeout;
  for (const receipt of ph1Receipts) console.log(`PH1C-ONE-SHOT ${receipt}`);
  if (savedDocumentDescriptor) Object.defineProperty(global, 'document', savedDocumentDescriptor);
  else delete global.document;

  // PH-1 fail-soft: geometry that fails before the host exists, and a map that
  // fails after its host is built (the edge layer throws once), both end on
  // the wide chips with a warning row and no compact host.
  const failingCompact = new GraphView({ dashboard, lifecycleApi, insights: realInsights });
  failingCompact._compactGeometry = () => { throw new Error('compact geometry fault'); };
  const failSoftContainer = element();
  await failingCompact.render({ container: failSoftContainer }, { containerWidth: 390 });
  const failSoftRoot = failSoftContainer.children[0];
  assert(byClass(failSoftRoot, 'graph-view-compact').length === 0 && byClass(failSoftRoot, 'graph-view-chip').length === 7,
    'PH1-FAIL-SOFT: a compact failure removes any compact host and renders the wide chips');
  assert(byClass(failSoftRoot, 'warning-render-error').some((row) => row.textContent.includes('compact geometry fault')),
    'PH1-FAIL-SOFT: the compact failure surfaces as a warning row');
  // MUTATION GUARD: PH1C-MUTANT-KEEP-PARTIAL-HOST turns RED if render() stops
  // removing a compact host that was built before the compact map failed.
  const partialCompact = new GraphView({ dashboard, lifecycleApi, insights: realInsights });
  partialCompact._edgeSvg = () => {
    delete partialCompact._edgeSvg;
    throw new Error('compact edge fault');
  };
  const partialContainer = element();
  await partialCompact.render({ container: partialContainer }, { containerWidth: 390 });
  const partialRoot = partialContainer.children[0];
  assert(byClass(partialRoot, 'graph-view-compact').length === 0 && byClass(partialRoot, 'graph-view-chip').length === 7
    && byClass(partialRoot, 'warning-render-error').filter((row) => row.textContent.includes('compact edge fault')).length === 1,
  'PH1C-MUTANT-KEEP-PARTIAL-HOST (PH1-FAIL-SOFT): a compact map that fails after its host is built leaves no partial host, renders the wide chips, and surfaces one warning row');

  // ---- PH1D-FAIL-SOFT-ROLLBACK ----
  // PH1C-FAIL-SOFT-WARNING-ROLLBACK: the compact legend throws once, after
  // GV-F's garbled status has pushed an unreadable_slice warning (observed
  // through the pills' warnings list at the moment of the fault). The wide
  // fallback shows exactly one unreadable_slice row beside exactly one
  // render_error row.
  // MUTATION GUARD: PH1D-MUTANT-NO-WARNING-ROLLBACK turns RED at
  // "PH1D-FAIL-SOFT-ROLLBACK (PH1C-FAIL-SOFT-WARNING-ROLLBACK): the wide
  // fallback shows exactly one unreadable_slice row ..." if render() stops
  // truncating its warnings to the length they had before the compact
  // attempt.
  const legendFault = new GraphView({ dashboard, lifecycleApi, insights: realInsights });
  let pillWarnings = null;
  let warningsAtFault = null;
  let legendCalls = 0;
  legendFault._renderPill = function trackedPill(...args) {
    pillWarnings = args[5];
    return GraphView.prototype._renderPill.apply(this, args);
  };
  legendFault._renderLegend = function faultyCompactLegend(...args) {
    legendCalls += 1;
    if (legendCalls === 1) {
      warningsAtFault = (pillWarnings || []).map((warning) => `${warning.code}:${warning.card}`);
      throw new Error('compact legend fault');
    }
    return GraphView.prototype._renderLegend.apply(this, args);
  };
  const legendFaultContainer = element();
  await legendFault.render({ container: legendFaultContainer }, { containerWidth: 390 });
  const legendFaultRoot = legendFaultContainer.children[0];
  assert(JSON.stringify(warningsAtFault) === JSON.stringify(['unreadable_slice:GV-F Malformed']) && legendCalls === 2
    && byClass(legendFaultRoot, 'graph-view-compact').length === 0 && byClass(legendFaultRoot, 'graph-view-chip').length === 7
    && byClass(legendFaultRoot, 'graph-view-legend').length === 1,
  'PH1D-FAIL-SOFT-ROLLBACK (PH1C-FAIL-SOFT-WARNING-ROLLBACK): the compact legend fails after the pills pushed an unreadable_slice warning, and render() degrades to the wide chips and one wide legend');
  const legendFaultUnreadable = byClass(legendFaultRoot, 'warning-unreadable-slice');
  const legendFaultErrors = byClass(legendFaultRoot, 'warning-render-error');
  assert(legendFaultUnreadable.length === 1 && legendFaultUnreadable[0].textContent.includes('GV-F Malformed')
    && legendFaultErrors.length === 1 && legendFaultErrors[0].textContent.includes('compact legend fault'),
  'PH1D-FAIL-SOFT-ROLLBACK (PH1C-FAIL-SOFT-WARNING-ROLLBACK): the wide fallback shows exactly one unreadable_slice row and one render_error row');

  // ---- PH1D-NARROW-WARNINGS (F11) ----
  // Through render() at 390 the garbled GV-F pill's unreadable_slice warning
  // reaches the rendered warning strip exactly once, beside the layout's own
  // dangling_dependency row, in a strip that follows the compact host, with
  // no render_error.
  // MUTATION GUARD: PH1D-MUTANT-NARROW-WARNINGS-DROPPED (F11) turns RED here
  // if the compact path's pill warnings never reach the strip: a private
  // list handed to _renderCompactGraph or to the pills, or the rollback
  // running after a successful compact render too.
  const narrowWarningsContainer = element();
  await new GraphView({ dashboard, lifecycleApi, insights: realInsights })
    .render({ container: narrowWarningsContainer }, { containerWidth: 390 });
  const narrowWarningsRoot = narrowWarningsContainer.children[0];
  const narrowStrip = byClass(narrowWarningsRoot, 'graph-view-warnings')[0];
  const narrowHost = byClass(narrowWarningsRoot, 'graph-view-compact')[0];
  const narrowUnreadable = byClass(narrowWarningsRoot, 'warning-unreadable-slice');
  assert(narrowHost && narrowStrip && narrowWarningsRoot.children.indexOf(narrowStrip) > narrowWarningsRoot.children.indexOf(narrowHost)
    && narrowUnreadable.length === 1 && narrowUnreadable[0].parent === narrowStrip
    && narrowUnreadable[0].textContent === "GV-F Malformed: slice state unreadable: 'garbled'"
    && byClass(narrowStrip, 'warning-dangling-dependency').length === 1
    && byClass(narrowWarningsRoot, 'warning-render-error').length === 0,
  'PH1D-NARROW-WARNINGS (F11): a successful narrow render() surfaces the pills\' unreadable_slice warning exactly once in the warning strip under the compact map');

  // ---- PH1D-FAILSOFT-CHROME ----
  // The fail-soft roots above (a compact geometry fault and a compact edge
  // fault at 390) against a wide render of the same fixture at 1024:
  // the same root children in the same order, each child's DOM identical
  // except the warning strip, whose rows are the wide strip's rows plus one
  // render_error row naming the fault.
  const chromeWideContainer = element();
  await new GraphView({ dashboard, lifecycleApi, insights: realInsights })
    .render({ container: chromeWideContainer }, { containerWidth: 1024 });
  const chromeWideRoot = chromeWideContainer.children[0];
  const rootChildClasses = (node) => (node?.children || []).map((child) => child.className);
  const wideChromeClasses = [
    'shared-section-divider', 'shared-section-label', 'graph-view-stuck-summary', 'graph-view-filter-toolbar',
    'graph-view-scroll', 'graph-view-legend', 'graph-view-warnings',
  ];
  const staleRowText = "GV-E Stale: depends on a card that doesn't exist: 'GV-1 GraphLayout pure layout core'";
  const garbledRowText = "GV-F Malformed: slice state unreadable: 'garbled'";
  assert(JSON.stringify(rootChildClasses(chromeWideRoot)) === JSON.stringify(wideChromeClasses)
    && JSON.stringify(chromeWideRoot.children[6].children.map((row) => row.textContent)) === JSON.stringify([staleRowText, garbledRowText]),
  'PH1D-FAILSOFT-CHROME: a wide render of the main fixture at 1024 has the root children divider, label, stuck summary, toolbar, scroller, legend, and warning strip, and the strip rows are the GV-E dangling row then the GV-F unreadable row');
  // MUTATION GUARD: PH1D-MUTANT-FAILSOFT-REMOVES-EVERY-CHILD turns RED at
  // "PH1D-FAILSOFT-CHROME: after a compact geometry fault at 390 the root
  // children are ..." if the fail-soft cleanup removes every root child
  // instead of only the compact host.
  for (const [label, failedRoot, fault] of [
    ['geometry fault', failSoftRoot, 'compact geometry fault'],
    ['edge fault', partialRoot, 'compact edge fault'],
  ]) {
    assert.deepStrictEqual(rootChildClasses(failedRoot), wideChromeClasses,
      `PH1D-FAILSOFT-CHROME: after a compact ${label} at 390 the root children are divider, label, stuck summary, toolbar, scroller, legend, and warning strip, in the wide render's order`);
    assert(failedRoot.children.slice(0, 6).every((child, index) => JSON.stringify(domShape(child)) === JSON.stringify(domShape(chromeWideRoot.children[index]))),
      `PH1D-FAILSOFT-CHROME: after a compact ${label} at 390 the divider, label, stuck summary, toolbar, scroller, and legend have the same DOM as the wide render's`);
    const failedStrip = failedRoot.children[6];
    const failedErrorRows = failedStrip.children.filter((row) => row.className.split(/\s+/).includes('warning-render-error'));
    const stripWithoutErrors = { ...domShape(failedStrip), children: failedStrip.children.filter((row) => !failedErrorRows.includes(row)).map(domShape) };
    assert(JSON.stringify(failedStrip.children.map((row) => row.textContent)) === JSON.stringify([staleRowText, `GraphView: ${fault}`, garbledRowText])
      && failedErrorRows.length === 1 && failedErrorRows[0] === failedStrip.children[1]
      && JSON.stringify(stripWithoutErrors) === JSON.stringify(domShape(chromeWideRoot.children[6])),
    `PH1D-FAILSOFT-CHROME: after a compact ${label} at 390 the warning strip is the wide strip with one render_error row "GraphView: ${fault}" between the GV-E dangling row and the GV-F unreadable row`);
  }

  // ---- PH1D-STUB-CLOSE ----
  // A stub's detail card on the compact map and on the wide canvas: its
  // controls are exactly the Open slice and Close buttons, and Close removes
  // the card, opens nothing, and leaves the DOM at its at-rest shape.
  // MUTATION GUARD: PH1D-MUTANT-STUB-WITHOUT-CLOSE turns RED at
  // "PH1D-STUB-CLOSE: tapping the compact stub pill opens one detail card
  // ..." if the detail card omits Close for a stub.
  for (const [label, draw] of [
    ['compact stub pill', (host) => ph1View._renderCompactGraph(host, { nodes: presNodes, edges: presEdges }, lifecycleApi, epicPath, [], 390)],
    ['wide stub chip', (host) => ph1View._renderGraph(host, { nodes: presNodes, edges: presEdges }, lifecycleApi, epicPath, [])],
  ]) {
    const stubHost = element();
    await draw(stubHost);
    const stubAtRest = JSON.stringify(domShape(stubHost));
    const stubTargets = byClass(stubHost, 'graph-view-stub');
    const stubTap = stubTargets.length === 1 ? bubblingClick(stubTargets[0]) : { stopped: false };
    const stubPanels = byClass(stubHost, 'graph-view-detail-panel');
    const stubControls = stubPanels.length === 1 ? byClass(stubPanels[0], 'graph-view-detail-controls')[0] : null;
    assert(stubTap.stopped && stubPanels.length === 1 && textOf(stubPanels[0]).includes('GA-X1')
      && JSON.stringify((stubControls?.children || []).map((child) => [child.tag, child.className, child.textContent])) === JSON.stringify([
        ['button', 'graph-view-detail-open', 'Open slice'], ['button', 'graph-view-detail-close', 'Close'],
      ]),
    `PH1D-STUB-CLOSE: tapping the ${label} opens one detail card for GA-X1 whose controls are exactly an Open slice button then a Close button`);
    const opensBeforeClose = opened.length;
    const stubCloseTap = bubblingClick(byClass(stubPanels[0], 'graph-view-detail-close')[0]);
    assert(stubCloseTap.stopped && opened.length === opensBeforeClose
      && byClass(stubHost, 'graph-view-detail-panel').length === 0 && JSON.stringify(domShape(stubHost)) === stubAtRest,
    `PH1D-STUB-CLOSE: Close on the ${label}'s card removes the card, opens nothing, and returns the DOM to its at-rest shape`);
  }

  // ---- PH1D-ROLLBACK-TO-BEFORE ----
  // _applyCrossEpicStubs throws, so render() holds one render_error before the
  // compact attempt; the compact legend then throws once at 390. The warning
  // strip keeps that first render_error row and adds the compact legend
  // fault's row after it.
  // MUTATION GUARD: PH1D-MUTANT-ROLLBACK-TO-ZERO turns RED at
  // "PH1D-ROLLBACK-TO-BEFORE: the warning strip rows are ..." if the
  // compact failure truncates the warnings to zero instead of to the length
  // they had before the compact attempt.
  const beforeFault = new GraphView({ dashboard, lifecycleApi, insights: realInsights });
  beforeFault._applyCrossEpicStubs = () => { throw new Error('cross-epic stub fault'); };
  let beforeFaultPillWarnings = null;
  let beforeFaultAtLegend = null;
  let beforeFaultLegendCalls = 0;
  beforeFault._renderPill = function trackedBeforeFaultPill(...args) {
    beforeFaultPillWarnings = args[5];
    return GraphView.prototype._renderPill.apply(this, args);
  };
  beforeFault._renderLegend = function faultyBeforeFaultLegend(...args) {
    beforeFaultLegendCalls += 1;
    if (beforeFaultLegendCalls === 1) {
      beforeFaultAtLegend = (beforeFaultPillWarnings || []).map((warning) => `${warning.code}:${warning.card}:${warning.detail}`);
      throw new Error('compact legend fault');
    }
    return GraphView.prototype._renderLegend.apply(this, args);
  };
  const beforeFaultContainer = element();
  await beforeFault.render({ container: beforeFaultContainer }, { containerWidth: 390 });
  const beforeFaultRoot = beforeFaultContainer.children[0];
  assert(JSON.stringify(beforeFaultAtLegend) === JSON.stringify([
    'render_error:GraphView:cross-epic stub fault', "unreadable_slice:GV-F Malformed:garbled",
  ]) && beforeFaultLegendCalls === 2
    && byClass(beforeFaultRoot, 'graph-view-compact').length === 0 && byClass(beforeFaultRoot, 'graph-view-chip').length === 7,
  'PH1D-ROLLBACK-TO-BEFORE: the compact legend throws while the warnings hold the cross-epic stub render_error and the GV-F unreadable_slice, and render() draws the 7 wide chips');
  const beforeFaultStrips = byClass(beforeFaultRoot, 'graph-view-warnings');
  assert.deepStrictEqual(beforeFaultStrips.length === 1 ? beforeFaultStrips[0].children.map((row) => [row.className.split(/\s+/)[1], row.textContent]) : null, [
    ['warning-dangling-dependency', staleRowText],
    ['warning-render-error', 'GraphView: cross-epic stub fault'],
    ['warning-render-error', 'GraphView: compact legend fault'],
    ['warning-unreadable-slice', garbledRowText],
  ], 'PH1D-ROLLBACK-TO-BEFORE: the warning strip rows are the GV-E dangling row, the "GraphView: cross-epic stub fault" render_error row, the "GraphView: compact legend fault" render_error row, and the GV-F unreadable row, in that order');

  // ---- PH1D-MEASURED-WIDE-PIN ----
  // A render with no override whose container measures 1024 resolves
  // "measured" and draws the main fixture with the same scroller and root
  // digests as the main @1024 pins.
  // MUTATION GUARD: PH1D-MUTANT-MEASURED-WIDE-ATTRIBUTE turns RED at
  // "PH1D-MEASURED-WIDE-PIN: the measured 1024 render's whole-root digest
  // ..." if render() adds an attribute to the root only when a wide width
  // was measured.
  const measuredWideContainer = element();
  measuredWideContainer.clientWidth = 1024;
  assert.deepStrictEqual(new GraphView()._resolveWidth({ container: measuredWideContainer }, undefined),
    { width: 1024, narrow: false, source: 'measured' },
    'PH1D-MEASURED-WIDE-PIN: a container whose clientWidth is 1024, with no override, resolves { width: 1024, narrow: false, source: "measured" }');
  await new GraphView().render({ container: measuredWideContainer });
  const measuredWideRoot = measuredWideContainer.children[0];
  const measuredWideScrollers = byClass(measuredWideRoot, 'graph-view-scroll');
  assert(measuredWideContainer.children.length === 1 && byClass(measuredWideRoot, 'graph-view-compact').length === 0
    && measuredWideScrollers.length === 1 && digestOf(measuredWideScrollers[0]) === PH1_WIDE_DIGESTS.main.scroller,
  'PH1D-MEASURED-WIDE-PIN: the measured 1024 render draws no compact host and its scroller digest equals the main @1024 pin');
  assert.strictEqual(digestOf(measuredWideRoot), PH1_WIDE_DIGESTS.main.root,
    'PH1D-MEASURED-WIDE-PIN: the measured 1024 render\'s whole-root digest equals the main @1024 pin');

  // ---- PH1D-EMPTY-NARROW ----
  // An epic whose board holds no slices, rendered at 390 and at 1024: the
  // 390 root holds exactly the section divider and the Dependency Graph
  // label, with no warning strip, and is DOM-identical to the 1024 root.
  // MUTATION GUARD: PH1D-MUTANT-EMPTY-NARROW-THROWS turns RED at
  // "PH1D-EMPTY-NARROW: an epic with no slices at 390 renders ..." if the
  // compact map throws for an empty node list.
  const savedAppEmpty = global.app;
  const savedCustomJSEmpty = global.customJS;
  const emptyEnv = epicEnv({ dir: 'spice/projects/phone/tasks/Empty Epic', name: 'Empty Epic', slices: [] });
  global.app = emptyEnv.app;
  global.customJS = {
    RenderSafe: { page: () => emptyEnv.page },
    GraphLayout: new GraphLayout(),
    GraphInsights: new GraphInsights(),
    EpicDashboard: new EpicDashboard({ lifecycleApi }),
    SectionLabel: sectionLabel,
    Coordinator: coordinatorSentinel,
    DeliveryCoordinator: coordinatorSentinel,
  };
  const emptyNarrowContainer = element();
  await new GraphView().render({ container: emptyNarrowContainer }, { containerWidth: 390 });
  const emptyWideContainer = element();
  await new GraphView().render({ container: emptyWideContainer }, { containerWidth: 1024 });
  global.app = savedAppEmpty;
  global.customJS = savedCustomJSEmpty;
  const emptyNarrowRoot = emptyNarrowContainer.children[0];
  assert(emptyNarrowContainer.children.length === 1 && emptyNarrowRoot?.className === 'graph-view-root'
    && byClass(emptyNarrowRoot, 'graph-view-warnings').length === 0 && byClass(emptyNarrowRoot, 'warning-render-error').length === 0,
  'PH1D-EMPTY-NARROW: an epic with no slices at 390 renders one graph-view-root with no warning strip and no render_error row');
  assert.deepStrictEqual(emptyNarrowRoot.children.map((child) => [child.tag, child.className, child.textContent]), [
    ['hr', 'shared-section-divider', ''], ['div', 'shared-section-label', 'Dependency Graph'],
  ], 'PH1D-EMPTY-NARROW: the 390 root of an epic with no slices holds exactly the section divider and the Dependency Graph label');
  assert(emptyWideContainer.children.length === 1
    && JSON.stringify(domShape(emptyNarrowRoot)) === JSON.stringify(domShape(emptyWideContainer.children[0])),
  'PH1D-EMPTY-NARROW: the 390 root of an epic with no slices has the same DOM as its 1024 root');
  assert.deepStrictEqual(emptyEnv.mutations, [], 'PH1D-EMPTY-NARROW: the 390 and 1024 renders of an epic with no slices write nothing');

  // PH-1 source scans.
  const methodSource = (signature) => widgetSource.match(new RegExp(`\\n  ${signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[\\s\\S]*?\\n  \\}\\n`))?.[0] || '';
  const resolverSource = methodSource('_resolveWidth(dv, overrides)');
  const disarmSource = methodSource('_disarmColdLoad(container)');
  const oneShotSource = methodSource('_installColdLoadObserver(dv, overrides, root, resolved)');
  const renderEntrySource = methodSource('async render(dv, overrides)');
  const renderSource = methodSource('async _renderAtWidth(dv, overrides, decided)');
  assert(resolverSource && disarmSource && oneShotSource && renderEntrySource && renderSource,
    'PH1-SOURCE-SCAN: _resolveWidth, _disarmColdLoad, the one-shot installer, render, and _renderAtWidth are named methods');
  assert(resolverSource.includes('clientWidth') && !widgetSource.replace(resolverSource, '').includes('clientWidth'),
    'PH1-SOURCE-SCAN: clientWidth appears only inside _resolveWidth');
  assert(oneShotSource.includes('globalThis.ResizeObserver') && !widgetSource.replace(oneShotSource, '').includes('ResizeObserver')
    && oneShotSource.includes('globalThis.MutationObserver') && !widgetSource.replace(oneShotSource, '').includes('MutationObserver'),
  'PH1-SOURCE-SCAN: ResizeObserver and MutationObserver appear only inside the one-shot installer');
  assert(!/matchMedia|\bdv\.current\b|isConnected/.test(widgetSource),
    'PH1-SOURCE-SCAN: no matchMedia, no dv.current, and no isConnected anywhere in graph-view.js');
  assert(disarmSource.includes('this._coldLoads?.get(container)?.disarm();')
    && oneShotSource.includes('const unmeasured = resolved?.source === "default" || resolved?.source === "mobile-class";')
    && oneShotSource.includes('const removed = () => root.parentNode !== container;')
    && oneShotSource.includes('if (removed()) return null;')
    && oneShotSource.includes('owners.set(container, armed);')
    && oneShotSource.includes('if (owners.get(container) === armed) owners.delete(container);')
    && oneShotSource.includes('childList.observe(container, { childList: true });')
    && oneShotSource.includes('const fresh = this._resolveWidth(dv, overrides);\n          if (fresh.source !== "measured") return;\n          armed.disarm();\n          this._renderAtWidth(dv, overrides, fresh);')
    && (oneShotSource.match(/\.disconnect\(\)/g) || []).length === 2
    && (oneShotSource.match(/this\._renderAtWidth\(/g) || []).length === 1
    && (oneShotSource.match(/new Resize\(/g) || []).length === 1
    && (oneShotSource.match(/new Mutation\(/g) || []).length === 1
    && !/contentRect|entries|this\.render\(/.test(oneShotSource)
    && (oneShotSource.match(/this\._[A-Za-z]+\s*=[^=]/g) || []).join() === 'this._coldLoads = '
    && (widgetSource.match(/this\._coldLoads\s*=[^=]/g) || []).length === 1,
  'PH1C-ONE-SHOT-NO-LEAK: the one-shot is owned per container through one _coldLoads map, removal is root.parentNode !== container seen by a childList watch, one disarm routine disconnects both observers, and the re-render is handed the measurement it resolved');
  assert(renderEntrySource.includes('return this._renderAtWidth(dv, overrides, null);')
    && renderSource.indexOf('this._disarmColdLoad(dv && typeof dv === "object" ? dv.container : null);') >= 0
    && renderSource.indexOf('this._disarmColdLoad(') < renderSource.indexOf('const RS = globalThis.customJS?.RenderSafe;')
    && renderSource.includes('const resolved = decided && decided.source === "measured" ? decided : this._resolveWidth(dv, overrides);')
    && renderSource.indexOf('const resolved = ') < renderSource.indexOf('previous?.remove?.();')
    && (renderSource.match(/this\._resolveWidth\(/g) || []).length === 1
    && (renderSource.match(/this\._installColdLoadObserver\(dv, overrides, root, resolved\);/g) || []).length === 1
    && (widgetSource.match(/this\._installColdLoadObserver\(/g) || []).length === 1,
  'PH1C-ONE-SHOT-COLD-LOAD: every render disarms its container before reading RenderSafe, resolves the width at most once (not when handed a measurement) before removing the previous root, and is the only caller of the one-shot installer');
  assert(!/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(widgetSource),
    'PH1-SOURCE-SCAN: no hex, rgb, or hsl colour literal anywhere in graph-view.js');
  assert.deepStrictEqual([...new Set(widgetSource.match(/var\(--[a-z0-9-]+\)/g))].sort(), PH1_ALLOWED_TOKENS,
    'PH1-SOURCE-SCAN: graph-view.js uses exactly the pre-PH-1 var(--*) token set');
  const compactSource = widgetSource.match(/\n  async _renderCompactMap\(root, result, api, source, warnings, geometry\) \{[\s\S]*?\n  \}\n/)?.[0] || '';
  assert(compactSource.includes('this._edgeSvg(') && compactSource.includes('this._selectionController({'),
    'PH1-SOURCE-SCAN: the compact map draws with the existing _edgeSvg and registers through the existing _selectionController');
  const inlineSource = widgetSource.match(/\n  _renderDetailInline\(host, node, context\) \{[\s\S]*?\n  \}\n/)?.[0] || '';
  assert(inlineSource.includes('this._renderDetailPanel(host,') && !/position:\s*fixed|document\.body/.test(inlineSource),
    'PH1-SOURCE-SCAN: the inline card is the shared labeled-rows builder mounted on its host, never a body-fixed overlay');

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

  // ---- PH1D-PROJECT-SCOPE-WIDTH ----
  // A project-scope render's root has the same domShape at a containerWidth
  // override of 390, at a measured clientWidth of 390, and at an unmeasured
  // clientWidth of 0 with the is-mobile body class as at an override of
  // 1024, and none of the four renders constructs a ResizeObserver or a
  // MutationObserver (counting stubs stand in for both globals).
  // MUTATION GUARD: PH1D-MUTANT-PROJECT-BLANK-WHEN-NARROW (C1) turns RED at
  // "PH1D-PROJECT-SCOPE-WIDTH: a project-scope render at a containerWidth
  // override of 390 ..." if a narrow project-scope render draws no graph.
  // MUTATION GUARD: PH1D-MUTANT-PROJECT-EXTRA-HOST-WHEN-NARROW (C2) turns RED at
  // the same label if a narrow project-scope render adds a compact host.
  {
    const savedDocument = Object.getOwnPropertyDescriptor(global, 'document');
    const savedResize = global.ResizeObserver;
    const savedMutation = global.MutationObserver;
    const constructed = [];
    global.ResizeObserver = class { constructor() { constructed.push('ResizeObserver'); } observe() {} disconnect() {} };
    global.MutationObserver = class { constructor() { constructed.push('MutationObserver'); } observe() {} disconnect() {} };
    let mobile = false;
    global.document = { body: { classList: { contains: (name) => name === 'is-mobile' && mobile } } };
    const shapeAt = async (clientWidth, overrides, isMobile) => {
      const container = element();
      container.clientWidth = clientWidth;
      mobile = isMobile;
      await new GraphView({ scope: 'project' }).render({ container }, overrides);
      mobile = false;
      return JSON.stringify(domShape(container.children[0]));
    };
    const wide = await shapeAt(0, { containerWidth: 1024 }, false);
    const narrow = [
      ['a containerWidth override of 390', await shapeAt(0, { containerWidth: 390 }, false)],
      ['a measured clientWidth of 390', await shapeAt(390, undefined, false)],
      ['an unmeasured clientWidth of 0 with the is-mobile body class', await shapeAt(0, undefined, true)],
    ];
    global.ResizeObserver = savedResize;
    global.MutationObserver = savedMutation;
    if (savedDocument) Object.defineProperty(global, 'document', savedDocument);
    else delete global.document;
    for (const [label, shape] of narrow) {
      assert.strictEqual(shape, wide,
        `PH1D-PROJECT-SCOPE-WIDTH: a project-scope render at ${label} has the domShape of the one at a containerWidth override of 1024`);
    }
    assert.deepStrictEqual(constructed, [],
      'PH1D-PROJECT-SCOPE-WIDTH: the four project-scope renders construct no ResizeObserver and no MutationObserver');
  }

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
  // Execution order is no longer sequential: the release:preflight registration
  // surface moved from a package.json chain string to
  // platform/test/preflight-manifest.json (2026-08-10 parallel preflight
  // cutover), which is ordered heaviest-first and whose parallel lane has no
  // execution order at all -- see
  // Docs/superpowers/specs/2026-08-10-parallel-preflight-design.md. The
  // surviving intent (the graph trio plus the independent contract sentinel all
  // stay wired into preflight) is now a membership check per harness, not an
  // order check.
  const preflightManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform/test/preflight-manifest.json'), 'utf8'));
  const preflightCmds = preflightManifest.steps.map((s) => s.cmd.join(' '));
  for (const harness of ['run-graph-layout.js', 'run-graph-view.js', 'run-graph-insights.js', 'run-graph-view-contract.js']) {
    assert.strictEqual(preflightCmds.filter((cmd) => cmd.includes(harness)).length, 1,
      `release preflight preserves the inherited graph trio, then runs the independent contract sentinel: ${harness} registered exactly once`);
  }
  assert.strictEqual(preflightCmds.filter((cmd) => cmd.includes('run-graph-view.js')).length, 1,
    'release preflight registers the harness once');
  assert.strictEqual(preflightCmds.filter((cmd) => cmd.includes('run-graph-view-contract.js')).length, 1,
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
  finishHarness();
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
