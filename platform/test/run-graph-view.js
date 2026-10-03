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
// MUTATION GUARD convention, for the PH-2 and PH2B guards: a guard turns its
// named assertion RED when earlier assertions are neutralised, and in a
// fail-fast run it may first fail at an earlier assertion.
// MUTATION GUARD: PH1D-MUTANT-NARROW-NEVER-SETTLES turns RED at the exit
// guard below if a narrow render never settles (_renderCompactMap awaiting
// a promise nothing resolves): without that guard node exits 0 with no pass
// line; with it the exit code is 1 and stderr names the "PH1D-HARNESS-FLOOR
// (PH1C-HARNESS-NOT-VACUOUS)" abort.
// MUTATION GUARD: PH1D-MUTANT-COLD-LOAD-NEVER-SETTLES turns RED at the exit
// guard below the same way if the pane-width watch's re-render (the render
// handed a measurement) never settles, so the pane-width fixtures' drain
// waits forever.
let assertionCount = 0;
const counted = (check) => (...args) => {
  assertionCount += 1;
  return check(...args);
};
const assert = Object.assign(counted(nodeAssert), nodeAssert, Object.fromEntries([
  'ok', 'equal', 'notEqual', 'strictEqual', 'notStrictEqual', 'deepEqual', 'notDeepEqual', 'deepStrictEqual',
  'notDeepStrictEqual', 'throws', 'doesNotThrow', 'rejects', 'doesNotReject', 'match', 'doesNotMatch', 'fail',
].map((name) => [name, counted(nodeAssert[name])])));
const ASSERTION_FLOOR = 4064;
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
    // PH-9c: a model of Element.closest for a comma-separated list of
    // .class selectors; the element itself counts.
    closest(selector) {
      const wanted = String(selector).split(',').map((part) => part.trim().replace(/^\./, ''));
      for (let cursor = this; cursor; cursor = cursor.parent) {
        if (String(cursor.className || '').split(/\s+/).some((name) => wanted.includes(name))) return cursor;
      }
      return null;
    },
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
// PH1C-WIDE-BYTE-IDENTICAL pins (PH1-WIDE-DIGEST-PINS). Each entry holds
// sha256 digests of domShape() at rest for a pre-existing epic-scope
// fixture: scroller, its canvas scroller subtree as the pre-PH-1 renderer
// (graph-view.js at fff7ad69) draws it; preFrontierRoot, its whole root as
// that renderer draws it; and root, its whole root with the PH-2 frontier
// list.
// PH2B-WHOLE-ROOT-REPIN (PH2-WHOLE-ROOT-REPIN): the whole-root pins are
// re-pinned for the frontier list as the only difference: assertWideDigest
// removes that root child and compares the rest with preFrontierRoot.
const PH1_WIDE_DIGESTS = {
  main: {
    root: '3e8a03d0c83199eca3970b064b9e947d31ed474baec3ce92fef6736020fd1b7c',
    preFrontierRoot: '48bdadf60733de6867a92ae2922311c43481c4664dc5a674d133e135afa21776',
    scroller: '5e4d7cfcbd16b2a3ecb5ff747aa7bfa77b1598e9557c17ded9753ca1a4f68df0',
  },
  clean: {
    root: '0ddcf625ed628ac0befd5fcd03b75429355bc0f7098e1fe7ad1f18afdd75b5bf',
    preFrontierRoot: 'bb15204729eb48779151562d99d23ca60bcdfae2e4c2a0b185cb0e8f4f758400',
    scroller: 'afd575ede4abca0d0e40860c7712dbf36af2c5e41db4a88ac68e10861233e102',
  },
  stubLifecycle: {
    root: '3df49b4de904743aeb4f90a836e2221f645382e08466814c2804d15d44ec1bfa',
    preFrontierRoot: 'a730b21c4640eec736d849bb1760fea59900745cc38f39c25816696ebebc76d0',
    scroller: '320a964a6f047540197aaf1afedf42213adfc06c81e680617ed75b586e12b8b6',
  },
  crossEpic: {
    root: 'bcd79b504136e63fed85e736588bab537f0165e27267fb10d019dc40873bc784',
    preFrontierRoot: '480d6b985de32eecd904e26d1d7d6c192832f6d7b416fec714eb30cf3a5d2f33',
    scroller: '1388a531760a13ec7f33bd4d63a75448fa10cbdb9a9597e5eb1e9e51e3270f84',
  },
  mx: {
    root: 'c10cd890f4ddb48f288e15f8b6cdf14fd0a0a60d1cfecb96beec3f9a96b1b3c1',
    preFrontierRoot: '7e4d53c843c43950af4fa76aa74465bb51557232eb856f9fa32db3713f60a0e6',
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
  const lists = root.children.filter((child) => child.className === 'graph-view-frontier');
  const legend = root.children.findIndex((child) => child.className === 'graph-view-legend');
  assert(lists.length === 1 && legend >= 0 && root.children.indexOf(lists[0]) === legend + 1,
    `PH2B-WHOLE-ROOT-REPIN: ${label} root holds one frontier list, directly after the legend`);
  assert.strictEqual(digestOf({ ...root, children: root.children.filter((child) => child !== lists[0]) }), expected.preFrontierRoot,
    `PH2B-WHOLE-ROOT-REPIN (PH2-WHOLE-ROOT-REPIN): ${label} whole root without its frontier list equals the pre-PH-2 renderer's`);
  assert.strictEqual(digestOf(root), expected.root,
    `PH1C-WIDE-BYTE-IDENTICAL (PH1-WIDE-DIGEST-PINS): ${label} whole-root digest equals its pin`);
}
// PH-2 frontier list readers: a row as [id, status (with the needs-you glyph
// when drawn), marker, wait line], and a root's one list as its groups
// (class, label, rows), its Everything shipped line, and its done strip.
function ph2RowOf(row) {
  const pill = byClass(row, 'graph-view-frontier-pill')[0];
  const glyphs = byClass(row, 'graph-view-needs-you-glyph').map((glyph) => `${glyph.textContent} `).join('');
  const markers = [...byClass(row, 'graph-view-frontier-next'), ...byClass(row, 'graph-view-frontier-ready')]
    .map((marker) => marker.textContent);
  return [
    byClass(row, 'graph-view-frontier-id')[0]?.textContent ?? null,
    `${glyphs}${byClass(pill, 'graph-view-frontier-status')[0]?.textContent ?? ''}`,
    markers.join() || null,
    byClass(row, 'graph-view-frontier-wait')[0]?.textContent ?? null,
  ];
}
function ph2Read(root) {
  const lists = byClass(root, 'graph-view-frontier');
  if (lists.length !== 1) return { lists: lists.length };
  return {
    groups: byClass(lists[0], 'graph-view-frontier-group').map((group) => [
      group.className,
      byClass(group, 'graph-view-frontier-label')[0]?.textContent ?? null,
      ...byClass(group, 'graph-view-frontier-row').map(ph2RowOf),
    ]),
    shipped: byClass(lists[0], 'graph-view-frontier-shipped').map((node) => node.textContent),
    strip: byClass(lists[0], 'graph-view-frontier-done-strip').map((node) => node.textContent),
  };
}
// PH-1 compact geometry helpers: compactColW, compactNatural, compactHit,
// compactPos, and compactEdgeD compute expected compact column widths, canvas
// widths, hit boxes, visual pill positions, and edge paths. PH-12b: row r's
// hit box spans pad + r*44 to pad + r*44 + 44 and its 26px visual pill starts
// 9px below the hit box's top.
const PH1 = { pad: 2, gap: 10, hitH: 44, pillH: 26, pillInset: 9, minCol: 40, maxCol: 140, shortIdBelow: 72 };
function compactColW(R, W) {
  return Math.min(PH1.maxCol, Math.max(PH1.minCol, Math.floor((W - 2 * PH1.pad - (R - 1) * PH1.gap) / R)));
}
function compactNatural(R, colW) { return R * colW + (R - 1) * PH1.gap + 2 * PH1.pad; }
// PH-12b: a compact hit box's visual pill, its only child, and an element's
// effective left, top, width, and height.
function pillFace(pill) {
  const children = pill?.children || [];
  return children.length === 1 && children[0].className === 'graph-view-pill-face' ? children[0] : null;
}
function pillBox(node) {
  const css = cssEffective(node?.style?.cssText);
  return `${css.left} ${css.top} ${css.width} ${css.height}`;
}
function compactHit(rankIndex, row, colW) {
  return { x: PH1.pad + rankIndex * (colW + PH1.gap), y: PH1.pad + row * PH1.hitH, w: colW, h: PH1.hitH };
}
function compactPos(rankIndex, row, colW) {
  return {
    x: PH1.pad + rankIndex * (colW + PH1.gap), y: PH1.pad + row * PH1.hitH + PH1.pillInset,
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
  // W=1024 override both match the pinned digests.
  assertWideDigest('main (default width)', root, PH1_WIDE_DIGESTS.main);
  const wideMainContainer = element();
  await new GraphView().render({ container: wideMainContainer }, { containerWidth: 1024 });
  assertWideDigest('main @1024', wideMainContainer.children[0], PH1_WIDE_DIGESTS.main);
  // PH2B-WHOLE-ROOT-REPIN: the frontier list inside the main pins. This
  // render has no GraphInsights, so its groups are the fail-soft ones.
  for (const [label, drawn] of [['default width', root], ['@1024', wideMainContainer.children[0]]]) {
    assert.deepStrictEqual(ph2Read(drawn), {
      groups: [
        ['graph-view-frontier-group frontier-needs-you', 'Needs you 2',
          ['GV-C', '⚑ waiting', null, 'Waiting for Director sign-off'], ['GV-G', '⚑ waiting', null, longReason]],
        ['graph-view-frontier-group frontier-in-progress', 'In progress 1', ['GV-B', 'in progress', null, null]],
        ['graph-view-frontier-group frontier-planned', 'Planned 3',
          ['GV-E', 'planning', null, null], ['GV-F', 'unrecognized: garbled', null, null], ['GV-D', 'blocked', null, 'needs GV-B']],
        ['graph-view-frontier-group frontier-done', 'Done 1', ['GV-A', 'done', null, null]],
      ],
      shipped: [],
      strip: [],
    }, `PH2B-WHOLE-ROOT-REPIN: main (${label}) draws the fail-soft groups Needs you, In progress, Planned, and Done`);
  }
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
  assert.deepStrictEqual([cleanRoot, wideCleanContainer.children[0]].map(ph2Read), [0, 1].map(() => ({
    groups: [
      ['graph-view-frontier-group frontier-in-progress', 'In progress 1', ['GV-B', 'in progress', null, null]],
      ['graph-view-frontier-group frontier-done', null],
    ],
    shipped: [],
    strip: ['1 done · show'],
  })), 'PH2B-WHOLE-ROOT-REPIN: clean draws In progress 1 and the folded 1 done strip at both widths');
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
  assert.deepStrictEqual([stubContainer.children[0], wideStubContainer.children[0]].map(ph2Read), [0, 1].map(() => ({
    groups: [
      ['graph-view-frontier-group frontier-planned', 'Planned 6',
        ['GV-E', 'unrecognized: planning', null, null], ['GV-F', 'unrecognized: garbled', null, null],
        ['GV-C', 'unrecognized: parked', null, 'Waiting for Director sign-off'], ['GV-B', 'unrecognized: in_progress', null, null],
        ['GV-G', 'unrecognized: parked', null, longReason], ['GV-D', 'unrecognized: blocked', null, 'needs GV-B']],
      ['graph-view-frontier-group frontier-done', 'Done 1', ['GV-A', 'done', null, null]],
    ],
    shipped: [],
    strip: [],
  })), 'PH2B-WHOLE-ROOT-REPIN: stub lifecycle groups by the injected lifecycle answer at both widths: one done slice, and every other slice Planned');
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
  assert.deepStrictEqual([bRoot, wideBContainer.children[0]].map(ph2Read), [0, 1].map(() => ({
    groups: [
      ['graph-view-frontier-group frontier-next', 'Next up 1', ['HB-2', 'planning', 'next', null]],
      ['graph-view-frontier-group frontier-in-progress', 'In progress 1', ['HB-1', 'in progress', null, null]],
    ],
    shipped: [],
    strip: [],
  })), 'PH2B-WHOLE-ROOT-REPIN: cross-epic stub draws Next up and In progress at both widths, and no row for the stub');

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
  assert.deepStrictEqual([mxRoot, wideMxContainer.children[0]].map(ph2Read), [0, 1].map(() => ({
    groups: [
      ['graph-view-frontier-group frontier-needs-you', 'Needs you 1', ['MX-D', '⚑ waiting', null, mxParkReason]],
      ['graph-view-frontier-group frontier-next', 'Next up 1', ['MX-A', 'planning', 'next', null]],
      ['graph-view-frontier-group frontier-blocked', 'Blocked 1', ['MX-C', 'blocked', null, 'needs MX-A']],
      ['graph-view-frontier-group frontier-ready', 'Ready 1', ['MX-B', 'planning', 'ready', null]],
    ],
    shipped: [],
    strip: [],
  })), 'PH2B-WHOLE-ROOT-REPIN: MX draws Needs you, Next up (MX-A), Blocked, and Ready at both widths');
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
  // document.body is stubbed from here through the pane-width fixtures so the
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
  // exactly min-height:44px;padding:5px 10px;cursor:pointer; on the compact
  // card (re-pinned from 32px by PH-12b, PH12-CONTROLS-44).
  // MUTATION GUARD: PH1D-MUTANT-CLOSE-BUTTON-DECLARATION turns RED at
  // "PH1D-DETAIL-BUTTONS: the compact card's Close button ..." if the Close
  // button's min-height drops to 24px.
  // MUTATION GUARD: PH1D-MUTANT-OPEN-BUTTON-DECLARATION turns RED at
  // "PH1D-DETAIL-BUTTONS: the compact card's Open slice button ..." if the
  // Open slice button's min-height drops to 24px.
  // MUTATION GUARD: PH12B-MUTANT-CARD-BUTTONS-32 turns RED at
  // "PH1D-DETAIL-BUTTONS: the compact card's Open slice button ..." if the
  // compact card's buttons keep the wide 32px min-height.
  for (const [name, button] of [['Open slice', mxOpenSlice], ['Close', mxClose]]) {
    assert(button?.tag === 'button' && button.style.cssText === 'min-height:44px;padding:5px 10px;cursor:pointer;',
      `PH1D-DETAIL-BUTTONS: the compact card's ${name} button carries exactly min-height:44px;padding:5px 10px;cursor:pointer;`);
  }
  // ---- PH12-CONTROLS-44 ----
  // The compact toolbar's Stuck and Dim done toggles carry exactly the wide
  // toggles' declarations with min-height:44px in place of 32px.
  // MUTATION GUARD: PH12B-MUTANT-TOGGLES-32 turns RED at "PH12-CONTROLS-44:
  // the compact toolbar's Stuck toggle ..." if the compact toggles keep the
  // wide 32px min-height.
  for (const [name, className] of [['Stuck', 'graph-view-filter-stuck'], ['Dim done', 'graph-view-filter-done']]) {
    const toggle = byClass(mxNarrowToolbar, className)[0];
    assert(toggle?.tag === 'button' && toggle.textContent === name
      && toggle.style.cssText === 'min-height:44px;padding:5px 12px;border-radius:999px;cursor:pointer;'
        + 'border:1px solid var(--background-modifier-border);background:var(--background-secondary);',
    `PH12-CONTROLS-44: the compact toolbar's ${name} toggle carries exactly min-height:44px;padding:5px 12px;border-radius:999px;cursor:pointer; and the wide toggle's border and background`);
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
    'PH1C-WIDE-BYTE-IDENTICAL: closing the wide card returns the root to its pinned at-rest shape');

  // MX-writes: the presentation render (including Outcome reads) mutates nothing.
  assert.deepStrictEqual(mxMutations, [],
    'MX: auto-width render invokes no vault, adapter, frontmatter, or metadata mutator');
  global.app = savedAppMX;
  global.customJS = savedCustomJSMX;

  // ---- PH-1 phone-first: width resolver and compact geometry ----
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
  // MUTATION GUARD: PH12B-MUTANT-HIT-IS-PILL turns RED at
  // "PH12B-PILL-HEIGHT-REPINNED (PH1C-NO-SIDEWAYS-SCROLL): hit box 44, visual
  // pill 26 inset 9 ..." if the hit box is the 26px visual pill.
  // MUTATION GUARD: PH12B-MUTANT-TOP-ROW-ABOVE-CANVAS turns RED at
  // "PH12B-PILL-HEIGHT-REPINNED (PH1C-NO-SIDEWAYS-SCROLL): rank 0 hit box
  // sits at ..." if each hit box starts 9px above its row, so the top row's
  // starts above the canvas.
  // MUTATION GUARD: PH12B-MUTANT-HIT-OVERLAPS-NEXT-ROW turns RED at the same
  // label if hit boxes are 54px tall on the 44px pitch.
  // MUTATION GUARD: PH12B-MUTANT-CANVAS-PLUS-ONE turns RED at
  // "PH12B-PILL-HEIGHT-REPINNED (PH1C-NO-SIDEWAYS-SCROLL): a single-row map
  // ..." if the canvas is one pixel taller than rowCount*44 + 2*pad.
  // MUTATION GUARD: PH12B-MUTANT-COLUMN-ROUNDED turns RED at
  // "PH1C-NO-SIDEWAYS-SCROLL: 7-rank column width ..." if colW rounds the
  // column quotient instead of flooring it.
  for (const R of [1, 4, 7]) {
    const geometry = ph1View._compactGeometry(ph1Nodes(R), ph1Ranks(R), 390);
    assert.strictEqual(geometry.colW, compactColW(R, 390),
      `PH1C-NO-SIDEWAYS-SCROLL: ${R}-rank column width is clamp(floor((390 - 4 - ${R - 1}*10) / ${R}), 40, 140) = ${compactColW(R, 390)}`);
    assert(geometry.canvasWidth <= 390 && geometry.scrolls === false && geometry.canvasWidth === compactNatural(R, geometry.colW),
      `PH1C-NO-SIDEWAYS-SCROLL: ${R} ranks at 390 fit without horizontal scroll (canvas ${geometry.canvasWidth}px)`);
    // PH-12b re-pin: pill height 26 and row gap 8 became a 44px hit box with
    // its 26px visual pill 9px below its top, and the one-row canvas 30
    // became 48.
    assert.deepStrictEqual([geometry.hitH, geometry.pillH, geometry.pillInset, geometry.pad, geometry.gap], [44, 26, 9, 2, 10],
      'PH12B-PILL-HEIGHT-REPINNED (PH1C-NO-SIDEWAYS-SCROLL): hit box 44, visual pill 26 inset 9, pad 2, gap 10 are the emitted numbers');
    for (let index = 0; index < R; index += 1) {
      assert.deepStrictEqual(geometry.hitBoxes.get(`GA-ML${index + 1} Step ${index + 1}`), compactHit(index, 0, geometry.colW),
        `PH12B-PILL-HEIGHT-REPINNED (PH1C-NO-SIDEWAYS-SCROLL): rank ${index} hit box sits at pad + rank*(colW + gap), top 2, 44 tall`);
      assert.deepStrictEqual(geometry.positions.get(`GA-ML${index + 1} Step ${index + 1}`), compactPos(index, 0, geometry.colW),
        `PH1C-NO-SIDEWAYS-SCROLL: rank ${index} pill sits at pad + rank*(colW + gap)`);
    }
    assert.strictEqual(geometry.canvasHeight, 48,
      'PH12B-PILL-HEIGHT-REPINNED (PH1C-NO-SIDEWAYS-SCROLL): a single-row map is pad + 44 + pad = 48 tall');
  }
  // ---- PH12B-HIT-ROWS-TILE-CANVAS (PH12-HIT-BOX-OUTSIDE-CANVAS) ----
  // Expected values are literals from the PH-12b formula: row r's hit box
  // spans 2 + 44r to 2 + 44r + 44 (tops 2, 46, 90, 134, 178, 222, 266, 310),
  // its pill spans 11 + 44r to 37 + 44r, and n rows make a canvas 44n + 4
  // tall (48, 92, 136, 180, 224, 268, 312, 356 for n = 1 ... 8). One rank at
  // W=390 is a 140px column on a 144px canvas. A node with no rank lays out
  // in the rank-0 column.
  // MUTATION GUARD: PH12B-MUTANT-PITCH-34 turns RED at
  // "PH12B-HIT-ROWS-TILE-CANVAS: the 2-row hit boxes ..." if hit-box rows sit
  // on a 34px pitch.
  // MUTATION GUARD: PH12B-MUTANT-PILLS-ON-OLD-PITCH turns RED at
  // "PH12B-HIT-ROWS-TILE-CANVAS: 2 rows at W=390 ..." if the visual pills
  // keep the 34px pitch inside 44px hit boxes.
  // MUTATION GUARD: PH12B-MUTANT-CANVAS-CAP-6 turns RED at
  // "PH12B-HIT-ROWS-TILE-CANVAS: the 7-row hit boxes ..." if the canvas
  // counts at most six rows.
  // MUTATION GUARD: PH12B-MUTANT-RANK-NO-DEFAULT turns RED at
  // "PH12B-HIT-ROWS-TILE-CANVAS: a node with no rank ..." if a node's column
  // is looked up by its raw rank.
  {
    const layOut = (nodes, ranks, width) => {
      try { return ph1View._compactGeometry(nodes, ranks, width); } catch (error) { return { error: String(error?.message || error) }; }
    };
    const hitTops = [2, 46, 90, 134, 178, 222, 266, 310];
    const canvasHeights = [48, 92, 136, 180, 224, 268, 312, 356];
    for (let rows = 1; rows <= 8; rows += 1) {
      const nodes = Array.from({ length: rows }, (_, row) => ({ card: `GA-HB${row + 1} Hit ${row + 1}`, rank: 0, row }));
      const geometry = layOut(nodes, [0], 390);
      const hits = nodes.map((node) => geometry.hitBoxes?.get(node.card) || null);
      assert(hits.every((hit, row) => hit && hit.y >= 0 && hit.y + hit.h <= geometry.canvasHeight
        && hit.x >= 0 && hit.x + hit.w <= geometry.canvasWidth
        && (row === 0 ? hit.y === geometry.pad : hit.y === hits[row - 1].y + hits[row - 1].h))
        && hits[rows - 1].y + hits[rows - 1].h + geometry.pad === geometry.canvasHeight,
      `PH12B-HIT-ROWS-TILE-CANVAS: the ${rows}-row hit boxes, the top and bottom rows included, lie inside the canvas and stack from pad down to the canvas height minus pad with no gap`);
      assert.deepStrictEqual({
        hits,
        pills: nodes.map((node) => geometry.positions?.get(node.card) || null),
        canvas: [geometry.canvasWidth, geometry.canvasHeight],
        numbers: [geometry.hitH, geometry.pillH, geometry.pillInset, geometry.pad, geometry.gap],
      }, {
        hits: hitTops.slice(0, rows).map((y) => ({ x: 2, y, w: 140, h: 44 })),
        pills: hitTops.slice(0, rows).map((y) => ({ x: 2, y: y + 9, w: 140, h: 26 })),
        canvas: [144, canvasHeights[rows - 1]],
        numbers: [44, 26, 9, 2, 10],
      }, `PH12B-HIT-ROWS-TILE-CANVAS: ${rows} row${rows === 1 ? '' : 's'} at W=390 lay out hit boxes at top ${hitTops.slice(0, rows).join(', ')}, 44 tall, with 26px pills 9px below their tops, on a 144 x ${canvasHeights[rows - 1]} canvas`);
    }
    const rankless = layOut([{ card: 'GA-NR1 No rank', row: 0 }], undefined, 390);
    assert.deepStrictEqual([rankless.hitBoxes?.get('GA-NR1 No rank'), rankless.positions?.get('GA-NR1 No rank')],
      [{ x: 2, y: 2, w: 140, h: 44 }, { x: 2, y: 11, w: 140, h: 26 }],
      'PH12B-HIT-ROWS-TILE-CANVAS: a node with no rank lays out its hit box at left 2, top 2 and its pill at left 2, top 11 in the one 140px column');
  }

  // ---- PH12-HIT-BOXES-DISJOINT ----
  // _renderCompactGraph over R = 1, 4, 7, 8, and 12 ranks at W=390, first
  // with rank i holding 6 - (i mod 6) rows (six rows in rank 0), then with
  // rank i holding 1 + (i mod 6) rows (one row in rank 0; labelled "rows
  // rising by rank"). Columns are the card formula's literals (R: colW,
  // canvas width): 1: 140, 144; 4: 89, 390; 7: 46, 386; 8: 40, 394; 12: 40,
  // 594. The canvas is 44 * (most rows in a rank) + 4 tall: 268 for the
  // first layout, and 48, 180, 268, 268, 268 for the second. Rank i's hit
  // boxes sit at left 2 + i*(colW + 10), top 2 + 44r.
  // Within a rank of two or more rows a depends edge runs from row 0 to row
  // 1 and order edges from row 1 to row 2, row 2 to row 3, and so on, up to
  // the rank's last row; a depends edge runs from the last row of rank i to
  // row 0 of rank i + 1. A
  // same-column edge runs from the upper pill's bottom (2 + 44r + 35) to the
  // lower pill's top (2 + 44(r+1) + 9) at the column's centre; a cross-rank
  // edge runs from the pill's right edge at its mid-height (2 + 44r + 22) to
  // the next pill's left edge at its mid-height, bending by
  // max(24, (x2 - x1) / 2).
  // MUTATION GUARD: PH12B-MUTANT-DRAWN-HIT-OVERLAPS turns RED at
  // "PH12-HIT-BOXES-DISJOINT: 1 rank: no two of the 6 hit boxes ..." if the
  // drawn hit boxes are 54px tall.
  // MUTATION GUARD: PH12B-MUTANT-EDGES-ON-HIT-BOXES turns RED at
  // "PH12-HIT-BOXES-DISJOINT: 1 rank ..." if the edge layer attaches edges
  // to the hit boxes instead of the visual pills.
  // MUTATION GUARD: PH12B-MUTANT-ROWCOUNT-FIRST-RANK turns RED at
  // "PH12-HIT-BOXES-DISJOINT: 4 ranks (rows rising by rank) at W=390 draw
  // ..." if the row count reads only the first rank's nodes.
  for (const [rising, R, colW, canvasWidth, canvasHeight] of [
    [false, 1, 140, 144, 268], [false, 4, 89, 390, 268], [false, 7, 46, 386, 268], [false, 8, 40, 394, 268], [false, 12, 40, 594, 268],
    [true, 1, 140, 144, 48], [true, 4, 89, 390, 180], [true, 7, 46, 386, 268], [true, 8, 40, 394, 268], [true, 12, 40, 594, 268],
  ]) {
    const rowsOf = (rank) => (rising ? 1 + (rank % 6) : 6 - (rank % 6));
    const named = `${R} rank${R === 1 ? '' : 's'}${rising ? ' (rows rising by rank)' : ''}`;
    const cardOf = (rank, row) => `GA-D${rank}R${row} Cell`;
    const nodes = [];
    const edges = [];
    for (let rank = 0; rank < R; rank += 1) {
      for (let row = 0; row < rowsOf(rank); row += 1) {
        nodes.push({ card: cardOf(rank, row), path: `${board}/${cardOf(rank, row)}.md`, status: 'planning', rank, row });
        if (row === 1) edges.push({ from: cardOf(rank, 0), to: cardOf(rank, 1), kind: 'depends' });
        if (row >= 2) edges.push({ from: cardOf(rank, row - 1), to: cardOf(rank, row), kind: 'order' });
      }
      if (rank > 0) edges.push({ from: cardOf(rank - 1, rowsOf(rank - 1) - 1), to: cardOf(rank, 0), kind: 'depends' });
    }
    const root = element();
    await ph1View._renderCompactGraph(root, { nodes, edges }, lifecycleApi, epicPath, [], 390);
    const leftOf = (rank) => 2 + rank * (colW + 10);
    const boxOf = (cssText) => {
      const css = cssEffective(cssText);
      return [parseFloat(css.left), parseFloat(css.top), parseFloat(css.width), parseFloat(css.height)];
    };
    const drawn = new Map(byClass(root, 'graph-view-pill').map((pill) => [pill.attrs.title, pill]));
    const boxes = [...drawn.values()].map((pill) => boxOf(pill.style.cssText));
    const overlapping = [];
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => {
      if (Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]) > 0
        && Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]) > 0) overlapping.push([a, b]);
    }));
    assert(boxes.length === nodes.length && overlapping.length === 0
      && boxes.every(([x, y, w, h]) => x >= 0 && y >= 0 && x + w <= canvasWidth && y + h <= canvasHeight),
    `PH12-HIT-BOXES-DISJOINT: ${named}: no two of the ${nodes.length} hit boxes intersect and each lies inside the ${canvasWidth} x ${canvasHeight} canvas`);
    assert.deepStrictEqual({
      hits: nodes.map((node) => (drawn.get(node.card) ? boxOf(drawn.get(node.card).style.cssText) : null)),
      faces: nodes.map((node) => (pillFace(drawn.get(node.card)) ? boxOf(pillFace(drawn.get(node.card)).style.cssText) : null)),
      canvas: byClass(root, 'graph-view-compact-canvas')[0]?.style.cssText,
      count: drawn.size,
    }, {
      hits: nodes.map((node) => [leftOf(node.rank), 2 + 44 * node.row, colW, 44]),
      faces: nodes.map(() => [0, 9, colW, 26]),
      canvas: `position:relative;width:${canvasWidth}px;height:${canvasHeight}px;`,
      count: nodes.length,
    }, `PH12-HIT-BOXES-DISJOINT: ${named} at W=390 draw ${nodes.length} ${colW}px hit boxes 44 tall at top 2 + 44r, each holding a 26px pill 9px down, on a ${canvasWidth} x ${canvasHeight} canvas`);
    const vertical = (rank, row) => {
      const x = leftOf(rank) + colW / 2;
      return `M ${x} ${2 + 44 * row + 35} L ${x} ${2 + 44 * (row + 1) + 9}`;
    };
    const across = (rank, row) => {
      const x1 = leftOf(rank) + colW;
      const y1 = 2 + 44 * row + 22;
      const x2 = leftOf(rank + 1);
      const bend = Math.max(24, (x2 - x1) / 2);
      return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} 24, ${x2} 24`;
    };
    const expectedDepends = [];
    const expectedOrder = [];
    for (let rank = 0; rank < R; rank += 1) {
      for (let row = 0; row + 1 < rowsOf(rank); row += 1) (row === 0 ? expectedDepends : expectedOrder).push(vertical(rank, row));
      if (rank + 1 < R) expectedDepends.push(across(rank, rowsOf(rank) - 1));
    }
    assert.deepStrictEqual({
      depends: svgPaths(root, 'edge-depends').map(dOf).sort(),
      order: svgPaths(root, 'edge-order').map(dOf).sort(),
    }, { depends: expectedDepends.sort(), order: expectedOrder.sort() },
    `PH12-HIT-BOXES-DISJOINT: ${named}: every edge attaches to the visual pills (same-column edges from a pill's bottom to the next pill's top, cross-rank edges at pill mid-height), not to the hit boxes`);
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
    assert(byClass(rendered, 'graph-view-pill').every((pill) => pill.style.cssText.includes(`width:${colW}px;height:44px;`)
      && pillBox(pillFace(pill)) === `0px 9px ${colW}px 26px`),
      `PH1D-GEOMETRY-BOUNDARIES (PH1C-SHORT-ID-BOUNDARY): the rendered W=${W} hit boxes are ${colW}px wide and 44px tall, each holding a ${colW}px by 26px pill 9px down (re-pinned by PH-12b)`);
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
      && JSON.stringify(ph1Ranks(R).map((index) => geometry.hitBoxes.get(`GA-ML${index + 1} Step ${index + 1}`)))
        === JSON.stringify(lefts.map((x) => ({ x, y: 2, w: colW, h: 44 })))
      && JSON.stringify(ph1Ranks(R).map((index) => geometry.positions.get(`GA-ML${index + 1} Step ${index + 1}`)))
        === JSON.stringify(lefts.map((x) => ({ x, y: 11, w: colW, h: 26 }))),
    `PH1D-COLUMN-FORMULA (G21, G50): ${R} ranks at W=${W} give colW ${colW}, lefts ${lefts.join(' ')}, and a ${canvas}px canvas that fits without scrolling (hit boxes at top 2, 44 tall, pills at top 11, 26 tall, re-pinned by PH-12b)`);
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
    && JSON.stringify(gapped.positions.get('GA-ML1 Step 1')) === JSON.stringify({ x: 2, y: 11, w: 140, h: 26 })
    && JSON.stringify(gapped.positions.get('GA-ML4 Step 4')) === JSON.stringify({ x: 152, y: 11, w: 140, h: 26 }),
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
      && JSON.stringify(listed.positions.get('GA-ML1 Step 1')) === JSON.stringify({ x: 2, y: 11, w: 122, h: 26 })
      && JSON.stringify(listed.positions.get('GA-ML3 Step 3')) === JSON.stringify({ x: 266, y: 11, w: 122, h: 26 }),
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
  assert(chainPills.every((pill) => pill.style.cssText.includes(`width:${chainColW}px;height:44px;`)
    && pillBox(pillFace(pill)) === `0px 9px ${chainColW}px 26px`),
  'PH1C-FALLBACK-DOCUMENTED: 12 ranks at 390 render 40px by 44px hit boxes around 40px by 26px pills (re-pinned by PH-12b)');
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
  const chainCanvasHeight = 48;
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
    const pos = compactHit(index, 0, chainColW);
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
  // One row, so the canvas is 2 + 44 + 2 = 48 tall (re-pinned by PH-12b from
  // 2 + 26 + 2 = 30) and each depends edge runs at the visual pill's
  // mid-height (2 + 9 + 13 = 24) from a pill's right edge to the next pill's
  // left edge, bending by max(24, gap/2) = 24: M x1 24 C x1+24 24, x2-24 24, x2 24.
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
      && lefts.every((x, index) => widthPillFor(`GA-W${index + 1}`)?.style.cssText.includes(`left:${x}px;top:2px;width:${colW}px;height:44px;`))
      && widthCanvas?.style.cssText.includes(`width:${canvasWidth}px;height:48px;`),
    `PH1D-RESOLVED-WIDTH-BOUND (F10, F12): ${label} draws ${colW}px pills at left ${lefts.join(' ')} on a ${canvasWidth}px canvas (44px hit boxes on a 48px canvas, re-pinned by PH-12b)`);
    const expectedEdges = lefts.slice(1).map((x2, index) => {
      const x1 = lefts[index] + colW;
      return `M ${x1} 24 C ${x1 + 24} 24, ${x2 - 24} 24, ${x2} 24`;
    });
    assert(byClass(widthRoot, 'graph-view-edges')[0]?.innerHTML.startsWith(`<svg width="${canvasWidth}" height="48" viewBox="0 0 ${canvasWidth} 48"`)
      && JSON.stringify(svgPaths(widthRoot, 'edge-depends').map(dOf).sort()) === JSON.stringify(expectedEdges.sort()),
    `PH1D-RESOLVED-WIDTH-BOUND (F10, F12): ${label} sizes the edge SVG to ${canvasWidth}x48 and runs every depends edge between those pills`);
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
  // Every pill's hit box is top 2, height 44, with its pill 9px down and
  // 26px tall, and the canvas is 48 tall. A measured
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
  // The drawn compact map as literals: each pill hit box's id text, left,
  // top, width, and height (in left order), the distinct left, top, width,
  // and height of the visual pills inside them (PH-12b), the canvas cssText,
  // and the compact scroller's padding-bottom.
  const ph1dCompactDrawing = (root) => ({
    pills: byClass(root, 'graph-view-pill').map((pill) => {
      const css = cssEffective(pill.style.cssText);
      return [byClass(pill, 'graph-view-pill-id')[0]?.textContent, css.left, css.top, css.width, css.height];
    }).sort((left, right) => parseFloat(left[1]) - parseFloat(right[1])),
    faces: [...new Set(byClass(root, 'graph-view-pill').map((pill) => pillBox(pillFace(pill))))].sort(),
    canvas: byClass(root, 'graph-view-compact-canvas')[0]?.style.cssText,
    padding: cssEffective(byClass(root, 'graph-view-compact-scroll')[0]?.style.cssText)['padding-bottom'],
  });
  const ph1dExpectedDrawing = (colW, lefts, ids, canvasWidth, padding) => ({
    pills: lefts.map((x, index) => [ids === 'short' ? `H${index + 1}` : `GA-H${index + 1}`, `${x}px`, '2px', `${colW}px`, '44px']),
    faces: [`0px 9px ${colW}px 26px`],
    canvas: `position:relative;width:${canvasWidth}px;height:48px;`,
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
  // edge SVG, 48px tall (30 before PH-12b), and a 14px scroller
  // padding-bottom (644 > 390). Each depends edge runs at y 24 from a pill's
  // right edge to the next pill's left edge.
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
    const expectedEdges = lefts13.slice(1).map((x2, index) => `M ${lefts13[index] + 40} 24 C ${lefts13[index] + 64} 24, ${x2 - 24} 24, ${x2} 24`);
    assert(byClass(root, 'graph-view-edges')[0]?.innerHTML.startsWith('<svg width="644" height="48" viewBox="0 0 644 48"')
      && JSON.stringify(svgPaths(root, 'edge-depends').map(dOf).sort()) === JSON.stringify(expectedEdges.sort()),
    'PH1D-MANY-RANKS: the 13-rank edge SVG is 644 x 48 and runs each of the 12 depends edges between adjacent pills');
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
  // Row geometry from the card formula as re-pinned by PH-12b (pad 2, hit
  // box 44 with its 26px pill 9px below its top; before PH-12b, pill 26 and row gap
  // 8): row r's hit box sits at top 2 + 44r (2, 46, 90, 134, 178), its pill
  // at top 11 + 44r (11, 55, 99, 143, 187), and n rows make a canvas
  // 4 + 44n tall (48, 92, 136, 180, 224 for n = 1 ... 5).
  // render() at an override of 390 over GA-R1 ... GA-R6 in lane order, where
  // GA-R5 depends on GA-R3 and GA-R6 on GA-R4: rank 0 holds GA-R1 ... GA-R4
  // in rows 0 ... 3 and rank 1 holds GA-R5 and GA-R6 in rows 0 and 1, as
  // 140px pills (colW = min(140, floor((390 - 14) / 2))) at left 2 and 152,
  // on a 294 x 180 canvas. The depends edges run from the rank-0 pill's
  // right edge (142) at its mid-height to the rank-1 pill's left edge (152)
  // at its mid-height, bending by 24: row 2 (y 112) to row 0 (y 24) and
  // row 3 (y 156) to row 1 (y 68). The order edges between lane neighbours
  // in one rank drop from a pill's bottom-centre to the next pill's top:
  // x 72 from 37 to 55, 81 to 99, and 125 to 143, and x 222 from 37 to 55.
  // MUTATION GUARD: PH1D-MUTANT-ROW-GAP-ONCE turns RED at
  // "PH12B-HIT-ROWS-TILE-CANVAS: the 3-row hit boxes ..." if a hit box's top
  // adds the 44px pitch once instead of once per row above it.
  // MUTATION GUARD: PH1D-MUTANT-HEIGHT-ROW-GAP-ONCE turns RED at
  // "PH12B-HIT-ROWS-TILE-CANVAS: the 2-row hit boxes ..." if the canvas
  // height adds the 44px pitch once instead of once per row.
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
        ['GA-R1', '2px', '2px', '140px', '44px'], ['GA-R2', '2px', '46px', '140px', '44px'],
        ['GA-R3', '2px', '90px', '140px', '44px'], ['GA-R4', '2px', '134px', '140px', '44px'],
        ['GA-R5', '152px', '2px', '140px', '44px'], ['GA-R6', '152px', '46px', '140px', '44px'],
      ],
      canvas: 'position:relative;width:294px;height:180px;',
    }, 'PH1D-MULTI-ROW: a rank with 4 rows at an override of 390 draws its hit boxes at top 2, 46, 90, and 134, the next rank at top 2 and 46, on a 294 x 180 canvas');
    assert(byClass(root, 'graph-view-edges')[0]?.innerHTML.startsWith('<svg width="294" height="180" viewBox="0 0 294 180"')
      && JSON.stringify(svgPaths(root, 'edge-depends').map(dOf).sort()) === JSON.stringify([
        'M 142 112 C 166 112, 128 24, 152 24', 'M 142 156 C 166 156, 128 68, 152 68',
      ].sort())
      && JSON.stringify(svgPaths(root, 'edge-order').map(dOf).sort()) === JSON.stringify([
        'M 72 37 L 72 55', 'M 72 81 L 72 99', 'M 72 125 L 72 143', 'M 222 37 L 222 55',
      ].sort()),
    'PH1D-MULTI-ROW: the 294 x 180 edge SVG runs the depends edges from rows 2 and 3 at y 112 and 156 to rows 0 and 1 at y 24 and 68, and the order edges between rows 0-1, 1-2, and 2-3');
    const oneRank = (rows) => Array.from(rows, (row) => ({ card: `GA-ML${row + 1} Step ${row + 1}`, rank: 0, row }));
    const stacked = [1, 2, 3, 4, 5].map((count) => {
      const geometry = ph1dLayOut(oneRank(Array.from({ length: count }, (_, row) => row)), [0], 390);
      return [count, geometry.hitBoxes ? [...geometry.hitBoxes.values()].map((at) => at.y) : null,
        geometry.positions ? [...geometry.positions.values()].map((at) => at.y) : null, geometry.canvasHeight];
    });
    assert.deepStrictEqual(stacked, [
      [1, [2], [11], 48], [2, [2, 46], [11, 55], 92], [3, [2, 46, 90], [11, 55, 99], 136],
      [4, [2, 46, 90, 134], [11, 55, 99, 143], 180], [5, [2, 46, 90, 134, 178], [11, 55, 99, 143, 187], 224],
    ], 'PH1D-MULTI-ROW: _compactGeometry stacks 1 to 5 rows of hit boxes at top 2, 46, 90, 134, and 178 with pills at top 11, 55, 99, 143, and 187 on canvases 48, 92, 136, 180, and 224 tall');
    const sparse = ph1dLayOut(oneRank([0, 3]), [0], 390);
    assert(JSON.stringify(sparse.hitBoxes ? [...sparse.hitBoxes.values()].map((at) => at.y) : null) === JSON.stringify([2, 134])
      && JSON.stringify(sparse.positions ? [...sparse.positions.values()].map((at) => at.y) : null) === JSON.stringify([11, 143])
      && sparse.canvasHeight === 180,
    'PH1D-MULTI-ROW: _compactGeometry with pills in rows 0 and 3 only draws their hit boxes at top 2 and 134 and their pills at top 11 and 143 on a canvas 180 tall');
  }

  // ---- PH1D-STUB-ROWS ----
  // GA-T1 depends on GB-1 and GB-2, two slices on another epic's board, so
  // render() draws two cross-epic stubs in the column after GA-T1, in rows 0
  // and 1. At an override of 390 (two ranks, colW 140): GA-T1's hit box at
  // left 2, top 2; GB-1's and GB-2's at left 152, top 2 and 46; a 294 x 92
  // canvas. Each stub edge runs from the stub's right edge (292) at its
  // mid-height (24, 68) back to GA-T1's left edge (2) at 24, bending by 24.
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
        ['GA-T1', '2px', '2px', '140px', '44px'], ['GB-1', '152px', '2px', '140px', '44px'], ['GB-2', '152px', '46px', '140px', '44px'],
      ],
      canvas: 'position:relative;width:294px;height:92px;',
      stubs: 2,
    }, 'PH1D-STUB-ROWS: two cross-epic stubs at an override of 390 draw at left 152, top 2 and 46, beside GA-T1 at left 2, on a 294 x 92 canvas');
    assert(byClass(root, 'graph-view-edges')[0]?.innerHTML.startsWith('<svg width="294" height="92" viewBox="0 0 294 92"')
      && JSON.stringify(svgPaths(root, 'edge-depends').map(dOf).sort()) === JSON.stringify([
        'M 292 24 C 316 24, -22 24, 2 24', 'M 292 68 C 316 68, -22 24, 2 24',
      ].sort()),
    'PH1D-STUB-ROWS: the 294 x 92 edge SVG runs each stub edge from the stub\'s right edge at y 24 and 68 to GA-T1\'s left edge at y 24');
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
      ['GA-S1', '2px', '2px', '122px', '44px'], ['GA-S2', '134px', '2px', '122px', '44px'], ['GA-S3', '266px', '2px', '122px', '44px'],
    ]) && JSON.stringify(svgPaths(root, 'edge-depends').map(dOf).sort()) === JSON.stringify([
      'M 124 24 C 148 24, 110 24, 134 24', 'M 256 24 C 280 24, 242 24, 266 24', 'M 124 24 C 195 24, 195 24, 266 24',
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
    const pos = compactHit(rank, row, bl5ColW);
    assert(bl5CompactPillFor(id).style.cssText.includes(`left:${pos.x}px;top:${pos.y}px;width:${pos.w}px;height:${pos.h}px;`),
      `PH1-COMPACT-GEOMETRY: ${id} hit box sits at left:${pos.x}px;top:${pos.y}px;width:${pos.w}px;height:${pos.h}px (re-pinned by PH-12b)`);
  }
  const bl5CompactCanvas = byClass(bl5Compact, 'graph-view-compact-canvas')[0];
  const bl5CompactHeight = 92;
  assert(bl5CompactCanvas.style.cssText.includes(`width:${compactNatural(3, bl5ColW)}px;height:${bl5CompactHeight}px;`),
    'PH1-COMPACT-GEOMETRY: the canvas is the natural width and pad + rows*44 + pad = 92 tall (re-pinned by PH-12b)');
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
    // The border, background, and glyph live on the visual pill inside the
    // hit box (PH-12b).
    const face = pillFace(pill);
    // MUTATION GUARD: PH1D-MUTANT-UNTINTED-BORDER turns RED here if the pill
    // border stops mixing the shared presentation colour (another colour, or
    // another strength than 40%).
    assert(face?.style.cssText.includes(`border:1px solid color-mix(in srgb, ${expected.color} 40%, transparent);`),
      `PH1D-PILL-PRESENTATION (PH1C-PILL-TINTS): ${id} pill's border is the shared colour ${expected.color} tinted 40%`);
    // MUTATION GUARD: PH1D-MUTANT-UNTINTED-BACKGROUND turns RED here if the
    // pill background stops mixing the shared presentation colour (another
    // colour, or another strength than 10%).
    assert(face?.style.cssText.includes(`background:color-mix(in srgb, ${expected.color} 10%, var(--background-primary));`),
      `PH1D-PILL-PRESENTATION (PH1C-PILL-TINTS): ${id} pill's background is the shared colour ${expected.color} tinted 10% over the primary background`);
    const glyph = byClass(pill, 'graph-view-status-glyph')[0];
    assert(glyph && glyph.textContent === expected.glyph && glyph.attrs['aria-hidden'] === 'true'
      && face.children.indexOf(glyph) === 0 && face.children.indexOf(byClass(pill, 'graph-view-pill-id')[0]) === 1,
    `PH1-COMPACT-PRESENTATION: ${id} pill carries the shared glyph ${expected.glyph} before its id`);
    // MUTATION GUARD: PH1D-MUTANT-GLYPH-UNCOLOURED (P12) turns RED here if
    // the glyph span stops carrying the shared status colour (or its shared
    // status class).
    assert(cssEffective(glyph.style.cssText).color === expected.color
      && glyph.className === `graph-view-status-glyph ${expected.className}`,
    `PH1D-GLYPH-COLOUR (P12): ${id} pill's glyph carries the shared colour ${expected.color} and the shared status class`);
  }
  for (const id of ['PR-B', 'PR-C']) {
    assert(pillFace(presPillFor(id))?.style.cssText.includes('border-left:2px solid var(--text-error);'),
      `PH1-COMPACT-STUCK-HAIRLINE: stuck ${id} carries the 2px error hairline on the left`);
  }
  for (const id of ['PR-A', 'PR-D', 'PR-E']) {
    assert(pillFace(presPillFor(id))?.style.cssText.includes('border:1px solid')
      && !pillFace(presPillFor(id)).style.cssText.includes('border-left:')
      && !cssDeclarations(presPillFor(id).style.cssText).some(([property]) => property.startsWith('border')),
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
    assert.deepStrictEqual(effectiveBorders(pillFace(presPillFor(id))?.style.cssText),
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
    && pillFace(parkedStubPill)?.style.cssText.includes('border:1px dashed')
    && !pillFace(parkedStubPill).style.cssText.includes('border-left:'),
  'PH1D-PILL-PRESENTATION (PH1C-NEEDS-YOU-NOT-ON-STUB): a parked stub carries no needs-you class and no stuck hairline, while the parked slice beside it carries the needs-you class');
  const presStub = presPillFor('GA-X1');
  assert(presStub && presStub.className.split(/\s+/).includes('graph-view-stub')
    && pillFace(presStub)?.style.cssText.includes('border:1px dashed')
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
  // 2 101 200 299, hit-box rows at top 2 and 46, canvas 390 x 92; before
  // PH-12b, pill rows at top 2 and 36 on a 390 x 64 canvas): the host, the
  // scroller, the canvas, the edge layer, a plain, two stuck, and a stub
  // pill (its hit box and the visual pill inside it) with their id spans,
  // and the plain pill's glyph span. Colours come from the shared
  // presentation.
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
    const hitBase = (left, top) => `position:absolute;left:${left}px;top:${top}px;width:89px;height:44px;`
      + 'box-sizing:border-box;cursor:pointer;';
    const faceBase = 'position:absolute;left:0px;top:9px;width:89px;height:26px;'
      + 'display:inline-flex;align-items:center;gap:4px;padding:0 6px;border-radius:999px;box-sizing:border-box;'
      + 'min-width:0;font-family:var(--font-monospace);font-size:11px;font-weight:600;';
    const tinted = (color, stuck) => `border:1px solid color-mix(in srgb, ${color} 40%, transparent);`
      + (stuck ? 'border-left:2px solid var(--text-error);' : '')
      + `background:color-mix(in srgb, ${color} 10%, var(--background-primary));`;
    const presCanvas = byClass(presRoot, 'graph-view-compact-canvas')[0];
    const presScroller = byClass(presRoot, 'graph-view-compact-scroll')[0];
    const presEdgeLayer = byClass(presRoot, 'graph-view-edges')[0];
    assert(presHost.className === 'graph-view-compact' && presHost.style.cssText === 'display:grid;gap:0;min-width:0;max-width:100%;'
      && presScroller.parent === presHost && presScroller.className === 'graph-view-scroll graph-view-compact-scroll'
      && presScroller.style.cssText === 'overflow-x:auto;overflow-y:hidden;max-width:100%;padding-bottom:0px;box-sizing:content-box;'
      && presCanvas.parent === presScroller && presCanvas.className === 'graph-view-canvas graph-view-compact-canvas'
      && presCanvas.style.cssText === 'position:relative;width:390px;height:92px;'
      && presEdgeLayer.parent === presCanvas && presCanvas.children[0] === presEdgeLayer
      && presEdgeLayer.style.cssText === 'position:absolute;inset:0;pointer-events:none;',
    'PH1D-COMPACT-DECLARATIONS: the host, scroller, canvas, and edge layer carry exactly their pinned classes and declarations, the edge layer first inside the canvas');
    assert(presPills.every((pill) => pill.parent === presCanvas),
      'PH1D-COMPACT-DECLARATIONS: every pill is drawn inside the canvas, never on the host');
    for (const [id, className, cssText, faceCss] of [
      ['PR-A', `graph-view-chip graph-view-pill ${planning.className}`, hitBase(2, 2) + `color:${planning.color};`,
        faceBase + tinted(planning.color, false)],
      ['PR-B', `graph-view-chip graph-view-pill ${blocked.className}`, hitBase(2, 46) + `color:${blocked.color};`,
        faceBase + tinted(blocked.color, true)],
      ['PR-C', `graph-view-chip graph-view-pill ${parkedPresentation.className} graph-view-needs-you`,
        hitBase(101, 2) + `color:${parkedPresentation.color};`, faceBase + tinted(parkedPresentation.color, true)],
      ['GA-X1', 'graph-view-chip graph-view-pill graph-view-stub', hitBase(299, 2) + 'color:var(--text-muted);opacity:0.75;',
        faceBase + 'border:1px dashed color-mix(in srgb, var(--text-muted) 45%, transparent);'
        + 'background:color-mix(in srgb, var(--text-muted) 6%, var(--background-primary));'],
    ]) {
      const pill = presPillFor(id);
      const face = pillFace(pill);
      assert(pill && pill.className === className && pill.style.cssText === cssText
        && face && face.style.cssText === faceCss,
        `PH1D-COMPACT-DECLARATIONS: ${id} pill carries exactly its pinned classes and declarations on its hit box and on the visual pill inside it`);
      const idSpan = byClass(pill, 'graph-view-pill-id')[0];
      assert(idSpan && idSpan.className === 'graph-view-pill-id' && face.children.at(-1) === idSpan
        && idSpan.style.cssText === 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
      `PH1D-COMPACT-DECLARATIONS: ${id} pill's id span is the visual pill's last child and ellipsizes inside the pill`);
    }
    const planningGlyph = byClass(presPillFor('PR-A'), 'graph-view-status-glyph')[0];
    assert(planningGlyph && planningGlyph.style.cssText === `flex:none;font-weight:700;color:${planning.color};`,
      'PH1D-COMPACT-DECLARATIONS: the glyph span carries exactly its pinned declarations');
  }

  // ---- PH12-CONTROLS-44 (taps) ----
  // A tap on a pill's hit box, on its visual pill, or on its id span selects
  // that pill identically: the same DOM afterwards, no note opened; a second
  // tap on any of them opens the slice once. Without GraphInsights a tap on
  // any of them opens the slice once.
  // MUTATION GUARD: PH12B-MUTANT-FACE-SWALLOWS-TAP turns RED at
  // "PH12-CONTROLS-44: a tap on GA-D1R0's hit box, visual pill, or id span
  // ..." if the visual pill stops a tap from reaching the hit box.
  // MUTATION GUARD: PH12B-MUTANT-LISTENER-ON-FACE turns RED at
  // "PH1C-DETAIL-INLINE-OUTCOME: the first pill tap selects without
  // navigation ..." if the tap listener sits on the visual pill instead of
  // the hit box.
  // MUTATION GUARD: PH12B-MUTANT-LISTENER-ON-BOTH turns RED at
  // "PH12-CONTROLS-44: without GraphInsights, a tap on the visual pill ..."
  // if the visual pill also carries the tap listener.
  // One GraphView instance then draws a compact map and a wide canvas, in
  // both orders, and a pill or chip tap on each opens GA-D1R0's card, whose
  // buttons are Open slice, Close, and the prerequisite link to GA-D0R0:
  // each has a 44px min-height on the compact map; on the wide canvas Open
  // slice and Close have 32px and the link none.
  // MUTATION GUARD: PH12B-MUTANT-CONTROL-HEIGHT-ON-INSTANCE turns RED at
  // "PH12-CONTROLS-44: one instance drawing compact then wide ..." if the
  // card reads its button height from the instance the latest render set.
  // MUTATION GUARD: PH12B-MUTANT-LINK-HEIGHT-ON-INSTANCE turns RED at the
  // same label if the card reads its link height from the instance the
  // latest render set.
  // MUTATION GUARD: PH12B-MUTANT-LINKS-WITHOUT-LINK-HEIGHT turns RED at the
  // same label if the card's link buttons are drawn without the link height.
  {
    const nodes = [0, 1, 2, 3].map((rank) => ({
      card: `GA-D${rank}R0 Cell`, path: `${board}/GA-D${rank}R0 Cell.md`, status: 'planning', rank, row: 0,
    }));
    const edges = [{ from: 'GA-D0R0 Cell', to: 'GA-D1R0 Cell', kind: 'depends' }];
    const tapped = {};
    for (const target of ['hit box', 'visual pill', 'id span']) {
      const view = new GraphView({ dashboard, lifecycleApi, insights: realInsights });
      const opened = [];
      view._open = (notePath, source) => { opened.push([notePath, source]); };
      const root = element();
      await view._renderCompactGraph(root, { nodes, edges }, lifecycleApi, epicPath, [], 390);
      const pill = byClass(root, 'graph-view-pill').find((entry) => entry.attrs.title === 'GA-D1R0 Cell');
      const tapTarget = { 'hit box': pill, 'visual pill': pillFace(pill), 'id span': byClass(pill, 'graph-view-pill-id')[0] }[target];
      const first = bubblingClick(tapTarget);
      tapped[target] = {
        stopped: first.stopped,
        opened: opened.length,
        cards: byClass(root, 'graph-view-detail-panel').map((panel) => byClass(panel, 'graph-view-detail-id')[0]?.textContent),
        shape: JSON.stringify(domShape(root)),
      };
      bubblingClick(tapTarget);
      tapped[target].second = opened.slice();
    }
    const selected = (shape) => ({
      stopped: true, opened: 0, cards: ['GA-D1R0'], shape, second: [[`${board}/GA-D1R0 Cell.md`, epicPath]],
    });
    assert.deepStrictEqual(tapped, {
      'hit box': selected(tapped['hit box'].shape),
      'visual pill': selected(tapped['hit box'].shape),
      'id span': selected(tapped['hit box'].shape),
    }, 'PH12-CONTROLS-44: a tap on GA-D1R0\'s hit box, visual pill, or id span selects it and opens its card without navigating, each leaving the same DOM, and a second tap opens the slice once');
    for (const target of ['visual pill', 'id span', 'hit box']) {
      const view = new GraphView({ dashboard, lifecycleApi, insights: {} });
      const opened = [];
      view._open = (notePath, source) => { opened.push([notePath, source]); };
      const root = element();
      await view._renderCompactGraph(root, { nodes, edges }, lifecycleApi, epicPath, [], 390);
      const pill = byClass(root, 'graph-view-pill').find((entry) => entry.attrs.title === 'GA-D1R0 Cell');
      bubblingClick({ 'hit box': pill, 'visual pill': pillFace(pill), 'id span': byClass(pill, 'graph-view-pill-id')[0] }[target]);
      assert.deepStrictEqual({ opened, cards: byClass(root, 'graph-view-detail-panel').length },
        { opened: [[`${board}/GA-D1R0 Cell.md`, epicPath]], cards: 0 },
        `PH12-CONTROLS-44: without GraphInsights, a tap on the ${target} of GA-D1R0 opens the slice once and renders no card`);
    }
    for (const order of [['compact', 'wide'], ['wide', 'compact']]) {
      const view = new GraphView({ dashboard, lifecycleApi, insights: realInsights });
      view._open = () => {};
      const roots = {};
      for (const kind of order) {
        roots[kind] = element();
        if (kind === 'compact') await view._renderCompactGraph(roots[kind], { nodes, edges }, lifecycleApi, epicPath, [], 390);
        else await view._renderGraph(roots[kind], { nodes, edges }, lifecycleApi, epicPath, []);
      }
      const heights = {};
      for (const kind of order.slice().reverse()) {
        const chip = byClass(roots[kind], 'graph-view-chip').find((entry) => textOf(entry).includes('GA-D1R0'));
        bubblingClick(chip);
        const panel = byClass(roots[kind], 'graph-view-detail-panel')[0];
        heights[kind] = panel ? flatten(panel).filter((node) => node.tag === 'button')
          .map((button) => [button.className, cssEffective(button.style.cssText)['min-height'] ?? null])
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)) : null;
      }
      assert.deepStrictEqual(heights, {
        compact: [['graph-view-detail-close', '44px'], ['graph-view-detail-open', '44px'], ['graph-view-detail-prerequisite', '44px']],
        wide: [['graph-view-detail-close', '32px'], ['graph-view-detail-open', '32px'], ['graph-view-detail-prerequisite', null]],
      }, `PH12-CONTROLS-44: one instance drawing ${order[0]} then ${order[1]} opens GA-D1R0 cards whose buttons (Open slice, Close, and the prerequisite link) all have a 44px min-height on the compact map, and on the wide canvas Open slice and Close 32px and the link none`);
    }
    // GA-L2 depends on GA-L1, and GA-L3 on GA-L2, so GA-L2's card carries a
    // prerequisite link button and a dependent link button. Every button
    // element in its compact card has a 44px min-height. In its wide card each
    // link button carries exactly the pre-PH-12b link declarations, and Open
    // slice and Close carry their 32px declarations.
    // MUTATION GUARD: PH12B-MUTANT-DEPENDENT-LINKS-WITHOUT-LINK-HEIGHT turns RED
    // at "PH12-CONTROLS-44: every button element in GA-L2's compact card ..."
    // if the card's dependent link buttons are drawn without the link height.
    // MUTATION GUARD: PH12B-MUTANT-WIDE-DEPENDENT-LINK-32 turns RED at
    // "PH12-WIDE-UNCHANGED: GA-L2's wide card ..." if a wide dependent link
    // button takes a 32px min-height.
    {
      const chain = [1, 2, 3].map((index) => ({
        card: `GA-L${index} Link ${index}`, path: `${board}/GA-L${index} Link ${index}.md`, status: 'planning', rank: index - 1, row: 0,
      }));
      const chainEdges = [
        { from: 'GA-L1 Link 1', to: 'GA-L2 Link 2', kind: 'depends' },
        { from: 'GA-L2 Link 2', to: 'GA-L3 Link 3', kind: 'depends' },
      ];
      const cardButtons = {};
      for (const kind of ['compact', 'wide']) {
        const view = new GraphView({ dashboard, lifecycleApi, insights: realInsights });
        view._open = () => {};
        const root = element();
        if (kind === 'compact') await view._renderCompactGraph(root, { nodes: chain, edges: chainEdges }, lifecycleApi, epicPath, [], 390);
        else await view._renderGraph(root, { nodes: chain, edges: chainEdges }, lifecycleApi, epicPath, []);
        bubblingClick(byClass(root, 'graph-view-chip').find((chip) => textOf(chip).includes('GA-L2')));
        const panel = byClass(root, 'graph-view-detail-panel')[0];
        cardButtons[kind] = panel ? flatten(panel).filter((node) => node.tag === 'button')
          .map((button) => [button.className, button.style.cssText]) : null;
      }
      const linkCss = 'display:inline-flex;align-items:center;gap:5px;justify-self:start;width:max-content;max-width:100%;'
        + 'padding:3px 8px;border:1px solid var(--background-modifier-border);border-radius:999px;'
        + 'background:var(--background-primary);color:var(--link-color);cursor:pointer;text-align:left;overflow-wrap:anywhere;';
      assert(cardButtons.compact
        && JSON.stringify(cardButtons.compact.map(([name]) => name).sort()) === JSON.stringify([
          'graph-view-detail-close', 'graph-view-detail-dependent', 'graph-view-detail-open', 'graph-view-detail-prerequisite',
        ])
        && cardButtons.compact.every(([, cssText]) => cssEffective(cssText)['min-height'] === '44px'),
      'PH12-CONTROLS-44: every button element in GA-L2\'s compact card (Open slice, Close, and its prerequisite and dependent link buttons) has a 44px min-height');
      assert.deepStrictEqual(cardButtons.wide && Object.fromEntries(cardButtons.wide), {
        'graph-view-detail-open': 'min-height:32px;padding:5px 10px;cursor:pointer;',
        'graph-view-detail-close': 'min-height:32px;padding:5px 10px;cursor:pointer;',
        'graph-view-detail-prerequisite': linkCss,
        'graph-view-detail-dependent': linkCss,
      }, 'PH12-WIDE-UNCHANGED: GA-L2\'s wide card draws its prerequisite and dependent link buttons with exactly the pre-PH-12b declarations, and Open slice and Close with their 32px declarations');
    }
  }

  // ---- PH1D-COMPACT-WIDE-PARITY ----
  // The compact map and the wide canvas present one layout result. Each
  // drawing gets its own selection controller instance from the one builder
  // _selectionController. Each run of ph1dParity.run() draws its fixture
  // twice, compact and wide. The render() fixture's wide drawing is render()
  // at a containerWidth override of 1024, and its compact drawing is render()
  // reached through one width source per run: a containerWidth override of
  // 390 (the run below), and a measured clientWidth of 390, an unmeasured
  // clientWidth of 0 with the is-mobile body class, and a pane-width watch
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
    // PH-12b: a compact pill's drawn box is its visual pill's box offset by
    // the hit box's left and top, and its border and background are read
    // from the visual pill.
    const boxOf = (kind, chip) => {
      const css = cssEffective(chip.style.cssText);
      const box = { left: parseFloat(css.left), top: parseFloat(css.top), width: parseFloat(css.width), height: parseFloat(css.height) };
      if (kind !== 'compact') return box;
      const face = cssEffective(pillFace(chip)?.style.cssText);
      return {
        left: box.left + parseFloat(face.left), top: box.top + parseFloat(face.top),
        width: parseFloat(face.width), height: parseFloat(face.height),
      };
    };
    const paintOf = (kind, chip) => cssEffective((kind === 'compact' ? pillFace(chip) : chip)?.style.cssText);
    // PH-12b: heightsOf() lists the class and min-height of every button
    // element in a drawing. read() leaves button min-heights out: its card
    // digest removes every min-height declaration from button elements.
    // MUTATION GUARD: PH12B-MUTANT-STUB-CARD-BUTTONS-32 turns RED at
    // "PH12-CONTROLS-44: render() of six slices and two cross-epic stubs,
    // step 13 (tap PB-1 Far One) ..." if a stub's compact card keeps 32px
    // buttons.
    const linkClasses = ['graph-view-detail-prerequisite', 'graph-view-detail-dependent', 'graph-view-detail-root-cause-link'];
    const heightsOf = (root) => flatten(root).filter((node) => node.tag === 'button')
      .map((button) => [button.className, cssEffective(button.style.cssText)['min-height'] ?? null]);
    const cardDigestOf = (panel) => {
      const scrub = (shape) => ({
        ...shape,
        cssText: shape.tag === 'button' ? shape.cssText.replace(/min-height:[^;]*;/g, '') : shape.cssText,
        children: shape.children.map(scrub),
      });
      return crypto.createHash('sha256').update(JSON.stringify(scrub(domShape(panel)))).digest('hex');
    };
    const read = (kind, root, nodes, opened, warnings) => {
      const elements = elementsOf(kind, root, nodes);
      const boxes = new Map([...elements].filter(([, chip]) => chip).map(([card, chip]) => [card, boxOf(kind, chip)]));
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
          const paint = paintOf(kind, chip);
          const glyphs = byClass(chip, 'graph-view-status-glyph');
          return [node.card, {
            dimmed: classesOf(chip).includes('graph-view-dimmed'),
            dimStyle: chip.style.cssText.endsWith(dimTail),
            selected: heading !== null && heading === headingOf(node),
            cell: [lefts.indexOf(box.left), tops.indexOf(box.top)],
            status: {
              classes: classesOf(chip).filter((name) => name.startsWith('status-')),
              color: css.color ?? null,
              border: paint.border ?? null,
              background: paint.background ?? null,
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
          digest: cardDigestOf(panel),
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
        const heights = { compact: heightsOf(drawn.compact.root), wide: heightsOf(drawn.wide.root) };
        assert.deepStrictEqual(heights, {
          compact: heights.compact.map(([name]) => [name, '44px']),
          wide: heights.wide.map(([name]) => [name, linkClasses.includes(name) ? null : '32px']),
        }, `PH12-CONTROLS-44: ${fixture.label}, step ${index} (${step.join(' ')}): every button element in the compact drawing, the card's link buttons included, has a 44px min-height; in the wide drawing every link button has no min-height and every other button a 32px one`);
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
            ['S1', '2px', '2px', '69px', '44px'], ['S2', '81px', '2px', '69px', '44px'], ['S3', '160px', '2px', '69px', '44px'],
            ['S4', '239px', '2px', '69px', '44px'], ['Z9', '318px', '2px', '69px', '44px'],
          ],
          faces: ['0px 9px 69px 26px'],
          canvas: 'position:relative;width:389px;height:48px;',
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
        pills: labels.map((label, index) => [label, `${2 + index * 79}px`, '2px', '69px', '44px']),
        faces: ['0px 9px 69px 26px'],
        canvas: 'position:relative;width:389px;height:48px;',
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
          ['S1', '2px', '2px', '66px', '44px'], ['S2', '78px', '2px', '66px', '44px'],
          ['S3', '154px', '2px', '66px', '44px'], ['Z9', '230px', '2px', '66px', '44px'],
        ],
        faces: ['0px 9px 66px 26px'],
        canvas: 'position:relative;width:298px;height:48px;',
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
      && effectiveBorders(pillFace(drawn.pill)?.style.cssText)?.left === '2px solid var(--text-error)',
    `PH1D-NONCANONICAL-STATUS: the ${JSON.stringify(raw)} pill ${needsYou ? 'carries' : 'does not carry'} the needs-you class, and its effective left border is the 2px error hairline`);
  }

  // ---- PH9C: one live pane-width watch per epic-scope mount ----
  // PH1-BROWSER-LIKE-OBSERVER-STUB: BrowserLikeResizeObserver models a
  // browser ResizeObserver. observe() owes one notification, delivered at the
  // next layout frame (ph1Frame) with the target's current box, not
  // synchronously. After that it notifies only when a frame finds the
  // observed box changed; it never sends a size-less tick. A disconnected
  // observer is silent, and so is one whose target sits in a collected
  // subtree. A detached (or off-document) target reports 0.
  // Two kinds of target are modelled. A note pane (mountPane) is a
  // .markdown-preview-view (or .cm-scroller) element created with one mount
  // container. Its offsetWidth is its border box (pane.ph9Width). Inside the
  // border box sit its left and right borders (pane.ph9BorderLeft,
  // pane.ph9BorderRight), its scrollbar space, and its left and right
  // padding (pane.ph9PadLeft, pane.ph9PadRight). The scrollbar space is
  // the reserved gutter (pane.ph9Reserved) when the pane's scrollbar gutter
  // is stable, and otherwise the scrollbar shown while `root` is drawn in its
  // container (pane.ph9Gutter(root, pane)). Its clientWidth is the border box
  // less the borders and the scrollbar space; every offsetWidth and
  // clientWidth read is counted in pane.ph9Reads, and
  // pane.ph9ThrowOn(readNumber) makes chosen reads throw. Its observed box is
  // the content box (the clientWidth less the padding); no readable line
  // width is modelled. getComputedStyle(pane)
  // reports that padding, those borders, and scrollbarGutter 'auto', or the
  // fixture's stable value ('stable' unless it names another).
  // A bare mount container (mountContainer) has a modelled clientWidth
  // (container.ph1Width: a number or a function of the drawn root;
  // container.ph1Throws and container.ph1ThrowOn inject throwing reads,
  // counted in container.ph1Reads), and its observed box is
  // container.ph1Content when set, its clientWidth otherwise.
  // BrowserLikeMutationObserver watches one container's childList and, at
  // the next frame, delivers one record of the children removed and added
  // since the last frame, before any resize notification. Timers run on a
  // stubbed clock (ph1Clock). A callback that throws is recorded in the
  // observer's thrown list instead of propagating. ph1Collect(node) marks a
  // detached node collected; ph9Discard(node) detaches and collects it.
  const ph1Observers = [];
  // PH1D-STUB-VIOLATIONS: a stub check that threw inside an observer method
  // could be caught by the widget's own try/catch, so a misuse of either stub
  // is recorded here instead, and settled() and the end of this section
  // assert the record empty.
  const ph1StubViolations = [];
  const hasGraph = (root) => Boolean(root && byClass(root, 'graph-view-canvas').length);
  const isWideGraph = (root) => hasGraph(root) && !byClass(root, 'graph-view-compact').length;
  const collected = (node) => {
    for (let cursor = node; cursor; cursor = cursor.parent) if (cursor.ph1Collected) return true;
    return false;
  };
  const ph1Layout = {
    clientWidthOf(container) {
      const model = container.ph1Width;
      return typeof model === 'function' ? model(container.children[0] || null, container) : (Number(model) || 0);
    },
    contentWidthOf(target) {
      if (!target || !target.isConnected) return 0;
      if (target.ph9Pane) return target.ph9InnerNow();
      return target.ph1Content == null ? ph1Layout.clientWidthOf(target) : Number(target.ph1Content);
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
      if (this.target) ph1StubViolations.push('PH1-BROWSER-LIKE-OBSERVER-STUB: a ResizeObserver observes one target once');
      this.target = target;
      this.owesFirst = true;
    }
    unobserve() {}
    disconnect() { this.disconnected += 1; }
    frame() {
      if (!this.live || collected(this.target)) return;
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
      if (!this.live || collected(this.target)) return;
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
  const savedGetComputedStyle = Object.getOwnPropertyDescriptor(global, 'getComputedStyle');
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
    const timer = { id: ph1Clock.nextId, fn, ms: Number(ms) || 0, due: ph1Clock.now + (Number(ms) || 0), cleared: false, fired: false };
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
  const ph1Collect = (node) => {
    assert(!node.isConnected, 'ph1Collect: only a detached node can be collected');
    node.ph1Collected = true;
  };
  const ph9Discard = (...nodes) => {
    for (const node of nodes) {
      node.offDocument = true;
      ph1Collect(node);
    }
  };
  const liveOf = (kind) => ph1Observers.filter((observer) => observer instanceof kind && observer.live && !collected(observer.target));
  const liveResize = () => liveOf(BrowserLikeResizeObserver);
  const liveMutation = () => liveOf(BrowserLikeMutationObserver);
  const liveObservers = () => [...liveResize(), ...liveMutation()];
  const pendingTimers = () => ph1Clock.pending().length;
  const pendingDelays = () => ph1Clock.pending().map((timer) => timer.ms);
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
  // A note pane created with one mount container. `gutter(root, pane)` is the
  // scrollbar shown, in px, while `root` is drawn in the container; options
  // give the padding and border on each side (pad and border for both sides,
  // or padLeft, padRight, borderLeft, and borderRight) and a stable gutter's
  // reserved width; inset narrows the mount container's client width by
  // that many px. With the defaults (no padding, no border, no stable gutter) the
  // measured width is the pane's offsetWidth, so the dynamic scenarios read
  // literally.
  const mountPane = (width, gutter = () => 0, paneClass = 'markdown-preview-view', { pad = 0, border = 0, padLeft = pad, padRight = pad, borderLeft = border, borderRight = border, stable = false, reserved = 0, gutterValue = 'stable', inset = 0 } = {}) => {
    const pane = element('div', { cls: paneClass });
    pane.ph9Pane = true;
    pane.ph9Width = width;
    pane.ph9Gutter = gutter;
    pane.ph9PadLeft = padLeft;
    pane.ph9PadRight = padRight;
    pane.ph9BorderLeft = borderLeft;
    pane.ph9BorderRight = borderRight;
    pane.ph9Stable = stable;
    pane.ph9Reserved = reserved;
    pane.ph9Reads = 0;
    pane.ph9ThrowOn = null;
    const scrollbarFor = (root) => (pane.ph9Stable ? pane.ph9Reserved : pane.ph9Gutter(root, pane));
    const borders = () => pane.ph9BorderLeft + pane.ph9BorderRight;
    pane.ph9Inner = (root) => pane.ph9Width - borders() - scrollbarFor(root) - pane.ph9PadLeft - pane.ph9PadRight;
    const container = mountContainer((root) => pane.ph9Inner(root) - inset);
    pane.ph9InnerNow = () => pane.ph9Inner(container.children[0] || null);
    container.parent = pane;
    pane.children.push(container);
    const read = (value) => {
      pane.ph9Reads += 1;
      if (typeof pane.ph9ThrowOn === 'function' && pane.ph9ThrowOn(pane.ph9Reads)) throw new Error('pane width unreadable');
      return value();
    };
    Object.defineProperty(pane, 'offsetWidth', { configurable: true, get() { return read(() => pane.ph9Width); } });
    Object.defineProperty(pane, 'clientWidth', {
      configurable: true,
      get() { return read(() => pane.ph9Width - borders() - scrollbarFor(container.children[0] || null)); },
    });
    pane.ph9Style = () => ({
      paddingLeft: `${pane.ph9PadLeft}px`, paddingRight: `${pane.ph9PadRight}px`,
      borderLeftWidth: `${pane.ph9BorderLeft}px`, borderRightWidth: `${pane.ph9BorderRight}px`,
      scrollbarGutter: pane.ph9Stable ? gutterValue : 'auto',
    });
    return { pane, container };
  };
  // A model of getComputedStyle: a pane reports its own style; any other
  // element reports no padding, no border, and an auto scrollbar gutter.
  const ph9ComputedStyle = (node) => (typeof node?.ph9Style === 'function' ? node.ph9Style() : {
    paddingLeft: '0px', paddingRight: '0px', borderLeftWidth: '0px', borderRightWidth: '0px', scrollbarGutter: 'auto',
  });
  global.getComputedStyle = ph9ComputedStyle;
  const ph9TargetOf = (container) => (container?.parent?.ph9Pane ? container.parent : container);
  // Counts _renderAtWidth calls (renders) and, separately, the render() calls
  // the harness itself made (initiated). Each trace entry classifies the
  // child that call added to its mount container before returning its
  // promise. With `delay`, every render waits that many ms of the stubbed
  // clock before it reads the lifecycle API, and is not awaited by
  // ph1Drain (the clock must advance for it to finish).
  const countingView = ({ delay = 0 } = {}) => {
    const view = new GraphView({ lifecycleApi, insights: new GraphInsights() });
    if (delay) {
      view._lifecycleApi = async function delayedLifecycleApi(...args) {
        await new Promise((resolve) => global.setTimeout(resolve, delay));
        return GraphView.prototype._lifecycleApi.apply(this, args);
      };
    }
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
      if (!delay) ph1InFlight.push(inFlight);
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
  // The 120ms debounce elapses (its re-render, if any, finishes), then one
  // frame delivers the new watch's observe() notification.
  const ph9Debounce = async () => {
    await ph1Clock.advance(120);
    await ph1Drain();
    await ph1Frame();
  };
  // PH9C-SETTLED-INVARIANT: ten quiet seconds (a frame each second), then
  // the pinned end state: no recorded stub misuse, zero pending timers,
  // exactly one live ResizeObserver per live epic-scope mount (options.watched,
  // by default the passed container), each on that mount's note scroll
  // container (its pane) or, without one, the mount container itself; one
  // live childList watch per watched mount (options.childLists overrides the
  // count); the exact render trace and count (a null trace pins only the end
  // presentation, options.ends); and, when a container is passed, its drawn
  // presentation.
  const ph1Receipts = [];
  const settled = async (label, view, trace, container = null, options = {}) => {
    const watched = options.watched || (container ? [container] : []);
    const targets = watched.map((mount, index) => options.targets?.[index] || ph9TargetOf(mount));
    const childLists = options.childLists ?? watched.length;
    await ph1Quiet();
    const runs = view.trace.reduce((out, entry) => { const last = out[out.length - 1]; if (last && last[0] === entry) last[1] += 1; else out.push([entry, 1]); return out; }, []);
    ph1Receipts.push(`${label} => ${runs.map(([entry, count]) => (count > 1 ? `${entry} x${count}` : entry)).join(' > ')} | renders ${view.renders} (initiated ${view.initiated}) | live resize ${liveResize().length} | live childList ${liveMutation().length} | pending timers ${pendingTimers()}`);
    assert.deepStrictEqual(ph1StubViolations, [], `PH1D-STUB-VIOLATIONS: ${label}: no observer-stub misuse was recorded`);
    assert.strictEqual(pendingTimers(), 0, `PH9C-SETTLED-INVARIANT: ${label}: nothing pending after ten quiet seconds`);
    const liveTargets = liveResize().map((observer) => observer.target);
    assert(liveTargets.length === targets.length
      && targets.every((target) => liveTargets.filter((entry) => entry === target).length === targets.filter((entry) => entry === target).length),
    `PH9C-SETTLED-INVARIANT: ${label}: exactly ${targets.length} live ResizeObserver(s), one per live epic-scope mount, on its note scroll container (or its mount container when it has none)`);
    assert(liveMutation().length === childLists && liveMutation().every((observer) => watched.includes(observer.target)),
      `PH9C-SETTLED-INVARIANT: ${label}: exactly ${childLists} live childList watch(es), each on a watched mount container`);
    if (trace) {
      assert.deepStrictEqual(view.trace, trace, `${label}: render trace is exactly ${trace.join(' -> ')}`);
      assert.strictEqual(view.renders, trace.length, `${label}: exactly ${trace.length} render(s)`);
    }
    if (container) {
      const ends = trace ? trace[trace.length - 1] : options.ends;
      assert.strictEqual(isCompact(container), ends === 'compact', `${label}: ends ${ends}`);
    }
  };

  // Stub self-tests.
  {
    const holder = element();
    const probe = holder.createEl('div');
    probe.ph1Width = 700;
    const seen = [];
    const probeObserver = new BrowserLikeResizeObserver((entries) => seen.push(entries.map((entry) => entry.contentRect.width)));
    probeObserver.observe(probe);
    const synchronous = seen.length;
    await ph1Frame();
    await ph1Frame();
    probe.ph1Width = 650;
    await ph1Frame();
    probe.ph1Content = 650;
    await ph1Frame();
    probe.remove();
    await ph1Frame();
    await ph1Frame();
    probeObserver.disconnect();
    const silent = new BrowserLikeResizeObserver((entries) => seen.push(['silent', ...entries]));
    silent.observe(holder.createEl('div'));
    silent.disconnect();
    const zeroHolder = element();
    const zeroBox = zeroHolder.createEl('div');
    zeroBox.ph1Width = 0;
    const zeroSeen = [];
    const zeroObserver = new BrowserLikeResizeObserver((entries) => zeroSeen.push(entries[0].contentRect.width));
    zeroObserver.observe(zeroBox);
    await ph1Frame();
    zeroBox.remove();
    await ph1Frame();
    zeroObserver.disconnect();
    assert(synchronous === 0 && JSON.stringify(seen) === JSON.stringify([[700], [650], [0]])
      && JSON.stringify(zeroSeen) === JSON.stringify([0]) && liveObservers().length === 0 && pendingTimers() === 0,
    'PH1-BROWSER-LIKE-OBSERVER-STUB: observe() owes one notification delivered at the next frame, then one per size change and none for an unchanged size; a detached target reports a zero box once, and a zero-box target removed reports nothing; a disconnected observer is silent; every notification carries a size');
    const { pane, container } = mountPane(610, (root) => (root ? 15 : 0));
    const paneSeen = [];
    const paneObserver = new BrowserLikeResizeObserver((entries) => paneSeen.push(entries[0].contentRect.width));
    paneObserver.observe(pane);
    await ph1Frame();
    const drawnRoot = container.createEl('div');
    await ph1Frame();
    const insideClientWidth = container.clientWidth;
    pane.ph9Width = 625;
    await ph1Frame();
    pane.ph9ThrowOn = (read) => read === 2;
    const reads = [pane.offsetWidth];
    try { reads.push(pane.offsetWidth); } catch (_error) { reads.push('threw'); }
    reads.push(pane.offsetWidth);
    drawnRoot.remove();
    pane.ph9Width = 640;
    await ph1Frame();
    paneObserver.disconnect();
    ph9Discard(pane);
    await ph1Frame();
    assert(JSON.stringify(paneSeen) === JSON.stringify([610, 595, 610, 640]) && insideClientWidth === 595
      && JSON.stringify(reads) === JSON.stringify([625, 'threw', 625]) && pane.ph9Reads === 3
      && container.closest('.markdown-preview-view, .cm-scroller') === pane && pane.closest('.cm-scroller') === null
      && element().closest('.markdown-preview-view, .cm-scroller') === null && liveObservers().length === 0,
    'PH1-BROWSER-LIKE-OBSERVER-STUB: a note pane notifies with its content box (its border box less its borders, its scrollbar space, and its padding), its container reads that content box as clientWidth, its offsetWidth is the border box with counted and injectable throwing reads, and closest() finds it from its container');
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
      'PH1-BROWSER-LIKE-OBSERVER-STUB: a ResizeObserver observes one target once',
    ], 'PH1D-STUB-VIOLATIONS: the stubs record a subtree watch and a second observe() instead of throwing');
    assert(liveObservers().length === 0, 'PH1D-STUB-VIOLATIONS: the misuse probes leave no live observer');
  }

  // ---- PH9-PRESENTATION-INDEPENDENT-MEASUREMENT ----
  // _resolveWidth measures the content width of
  // dv.container.closest(".markdown-preview-view, .cm-scroller") and falls
  // back to dv.container.clientWidth when no scroller or no computed style
  // is found. A 610
  // pane with no padding, no border, and no stable gutter, whose container
  // reads 610 with no graph and 595 or 593 with one drawn (15px and 17px
  // scrollbars), resolves the same wide measurement in every state.
  // MUTATION GUARD: PH9C-MUTANT-CONTAINER-CLIENTWIDTH turns RED at
  // "PH9-PRESENTATION-INDEPENDENT-MEASUREMENT: a 610 pane ..." if the width
  // is measured as dv.container.clientWidth instead of the scroller's
  // content width.
  // MUTATION GUARD: PH9C-MUTANT-SCROLLER-CLIENTWIDTH turns RED at the same
  // label if the scroller's clientWidth is measured as it is (without its
  // padding subtracted, and, without a stable gutter, less the scrollbar the
  // graph shows) instead of its content width.
  // MUTATION GUARD: PH9C-MUTANT-READING-VIEW-ONLY turns RED at
  // "PH9-PRESENTATION-INDEPENDENT-MEASUREMENT: a .cm-scroller pane ..." if
  // the scroller lookup drops .cm-scroller.
  // MUTATION GUARD: PH9C-MUTANT-EDITOR-ONLY turns RED at
  // "PH9-PRESENTATION-INDEPENDENT-MEASUREMENT: a 610 pane ..." if the lookup
  // drops .markdown-preview-view.
  // MUTATION GUARD: PH9C-MUTANT-ZERO-SCROLLER-FALLS-BACK turns RED at
  // "PH9-PRESENTATION-INDEPENDENT-MEASUREMENT: a found scroller whose
  // offsetWidth is 0 ..." if a zero scroller width falls back to the
  // container's clientWidth.
  // MUTATION GUARD: PH9C-MUTANT-THROW-FALLS-BACK turns RED at
  // "PH9-PRESENTATION-INDEPENDENT-MEASUREMENT: a scroller whose offsetWidth
  // throws ..." if a throwing scroller read falls back to the container's
  // clientWidth.
  // MUTATION GUARD: PH9C-MUTANT-CLOSEST-REQUIRED turns RED at
  // "PH9-PRESENTATION-INDEPENDENT-MEASUREMENT: a container without closest
  // ..." if a container that cannot be searched is unmeasured instead of
  // measured by its clientWidth.
  {
    const probe = new GraphView();
    for (const [paneClass, label] of [['markdown-preview-view', 'a 610 pane'], ['cm-scroller', 'a .cm-scroller pane']]) {
      for (const gutter of [15, 17]) {
        const { pane, container } = mountPane(610, (root) => (hasGraph(root) ? gutter : 0), paneClass);
        const empty = probe._resolveWidth({ container }, undefined);
        const emptyInner = container.clientWidth;
        const root = container.createEl('div');
        root.createEl('div', { cls: 'graph-view-canvas' });
        const drawn = probe._resolveWidth({ container }, {});
        const drawnInner = container.clientWidth;
        assert(emptyInner === 610 && drawnInner === 610 - gutter
          && JSON.stringify([empty, drawn]) === JSON.stringify([
            { width: 610, narrow: false, source: 'measured' }, { width: 610, narrow: false, source: 'measured' },
          ]) && pane.ph9Reads === 2,
        `PH9-PRESENTATION-INDEPENDENT-MEASUREMENT: ${label} whose container reads 610 with no graph and ${610 - gutter} with one drawn (a ${gutter}px scrollbar) resolves the same wide measurement, 610, in both states`);
      }
    }
    for (const [W, narrow] of [[599, true], [599.5, true], [599.99, true], [600, false]]) {
      const { container } = mountPane(W, () => 15);
      assert.deepStrictEqual(probe._resolveWidth({ container }, {}), { width: W, narrow, source: 'measured' },
        `PH9-PRESENTATION-INDEPENDENT-MEASUREMENT: a pane with no padding, borders, or stable gutter whose offsetWidth is ${W} resolves a ${narrow ? 'narrow' : 'wide'} measurement of ${W} (its container reads ${W - 15} beside a 15px scrollbar)`);
    }
    {
      const { container } = mountPane(900);
      assert.deepStrictEqual(probe._resolveWidth({ container }, { containerWidth: 390 }), { width: 390, narrow: true, source: 'override' },
        'PH9-PRESENTATION-INDEPENDENT-MEASUREMENT: an override still beats the pane measurement');
      assert.deepStrictEqual(probe._resolveWidth({ container }, { containerWidth: 599.996 }), { width: 599.996, narrow: true, source: 'override' },
        'PH9-PRESENTATION-INDEPENDENT-MEASUREMENT: an override of 599.996 resolves narrow');
    }
    {
      const bare = mountContainer(500);
      assert.deepStrictEqual(probe._resolveWidth({ container: bare }, {}), { width: 500, narrow: true, source: 'measured' },
        'PH9-PRESENTATION-INDEPENDENT-MEASUREMENT: with no scroller around it the mount container\'s clientWidth decides');
      const plain = { clientWidth: 500 };
      assert.deepStrictEqual(probe._resolveWidth({ container: plain }, {}), { width: 500, narrow: true, source: 'measured' },
        'PH9-PRESENTATION-INDEPENDENT-MEASUREMENT: a container without closest is measured by its clientWidth');
    }
    for (const mobile of [false, true]) {
      ph1MobileClass = mobile;
      const { pane, container } = mountPane(0);
      container.ph1Width = 500;
      const zero = probe._resolveWidth({ container }, {});
      pane.ph9Width = 700;
      pane.ph9ThrowOn = () => true;
      const thrown = probe._resolveWidth({ container }, {});
      ph1MobileClass = false;
      const unmeasured = mobile ? { width: 390, narrow: true, source: 'mobile-class' } : { width: 1024, narrow: false, source: 'default' };
      assert.deepStrictEqual(zero, unmeasured,
        `PH9-PRESENTATION-INDEPENDENT-MEASUREMENT: a found scroller whose offsetWidth is 0 is unmeasured ${mobile ? 'on an is-mobile body' : 'without is-mobile'} even though its container reads 500`);
      assert.deepStrictEqual(thrown, unmeasured,
        `PH9-PRESENTATION-INDEPENDENT-MEASUREMENT: a scroller whose offsetWidth throws is unmeasured ${mobile ? 'on an is-mobile body' : 'without is-mobile'} even though its container reads 500`);
    }
    {
      const closestThrows = mountContainer(500);
      closestThrows.closest = () => { throw new Error('closest unreadable'); };
      assert.deepStrictEqual(probe._resolveWidth({ container: closestThrows }, {}), { width: 1024, narrow: false, source: 'default' },
        'PH9-PRESENTATION-INDEPENDENT-MEASUREMENT: a scroller lookup that throws is unmeasured');
    }
  }

  // ---- PH9D-CONTENT-WIDTH ----
  // Evidence, Obsidian 1.13.7's app.css: .markdown-preview-view, and the
  // .cm-scroller of a .markdown-source-view under .view-content or in a
  // hover popover, carry padding: var(--file-margins); --file-margins-x is
  // 32px by default and 24px under .is-mobile, and --file-margins is 20px in
  // the side docks; .markdown-preview-view and
  // .markdown-source-view.mod-cm6 .cm-scroller carry scrollbar-gutter:
  // stable. The measured width is the scroller's content width: its
  // clientWidth less its padding when its computed scrollbar gutter includes
  // "stable", and otherwise its offsetWidth less its borders and padding.
  // The 600 threshold applies to that width.
  // MUTATION GUARD: PH9D-MUTANT-IGNORE-PADDING turns RED at
  // "PH9D-CONTENT-WIDTH: a 390 phone reading view with 24px margins ..." if the
  // scroller's padding is not subtracted.
  // MUTATION GUARD: PH9D-MUTANT-ONE-SIDE-PADDING turns RED at the same label
  // if only the left padding is subtracted.
  // MUTATION GUARD: PH9D-MUTANT-STABLE-IGNORED turns RED at
  // "PH9D-CONTENT-WIDTH: a desktop reading view (32px margins, 12px stable
  // gutter) ..." if a stable gutter is measured as part of the content.
  // MUTATION GUARD: PH9D-MUTANT-GUTTER-EXACT-MATCH turns RED at
  // "PH9D-CONTENT-WIDTH: a scroller whose gutter is stable both-edges ..." if
  // only a computed value of exactly "stable" counts as stable.
  // MUTATION GUARD: PH9D-MUTANT-BORDER-BOX-THRESHOLD turns RED at
  // "PH9D-CONTENT-WIDTH: the 600 threshold applies to the content width ..."
  // if the border box decides narrow or wide.
  // MUTATION GUARD: PH9D-MUTANT-CLIENTWIDTH-SCROLLBAR turns RED at
  // "PH9D-CONTENT-WIDTH: without a stable gutter ..." if the scrollbar the
  // graph shows is subtracted (the scroller's clientWidth less padding).
  // MUTATION GUARD: PH9D-MUTANT-IGNORE-BORDERS turns RED at the same label if
  // the scroller's borders are not subtracted.
  // MUTATION GUARD: PH9D-MUTANT-NO-CSSOM-USES-SCROLLER turns RED at
  // "PH9D-CONTENT-WIDTH: without getComputedStyle ..." if a scroller whose
  // style cannot be read is measured by its offsetWidth.
  {
    const probe = new GraphView();
    const desktop = { pad: 32, stable: true, reserved: 12 };
    for (const [label, W, paneClass, options, expected] of [
      ['a 390 phone reading view with 24px margins and overlay scrollbars resolves 342', 390, 'markdown-preview-view', { pad: 24, stable: true, reserved: 0 }, 342],
      ['a desktop reading view (32px margins, 12px stable gutter) 700 wide resolves 624', 700, 'markdown-preview-view', desktop, 624],
      ['a Live Preview editor (.cm-scroller, 32px margins, 12px stable gutter) 500 wide resolves 424', 500, 'cm-scroller', desktop, 424],
      ['a side-dock reading view (20px margins, 12px stable gutter) 300 wide resolves 248', 300, 'markdown-preview-view', { pad: 20, stable: true, reserved: 12 }, 248],
      ['a scroller whose gutter is stable both-edges (32px margins, 12px on each edge) 500 wide resolves 412', 500, 'markdown-preview-view', { pad: 32, stable: true, reserved: 24, gutterValue: 'stable both-edges' }, 412],
    ]) {
      const { container } = mountPane(W, (root) => (hasGraph(root) ? 15 : 0), paneClass, options);
      const resolved = probe._resolveWidth({ container }, {});
      const inner = container.clientWidth;
      assert(JSON.stringify(resolved) === JSON.stringify({ width: expected, narrow: expected < 600, source: 'measured' }) && inner === expected,
        `PH9D-CONTENT-WIDTH: ${label}, the width its mount container reads`);
    }
    {
      const popover = element('div', { cls: 'popover hover-popover' });
      const { pane, container } = mountPane(450, () => 0, 'markdown-preview-view', desktop);
      pane.parent = popover;
      popover.children.push(pane);
      assert.deepStrictEqual(probe._resolveWidth({ container }, {}), { width: 374, narrow: true, source: 'measured' },
        'PH9D-CONTENT-WIDTH: a hover popover\'s reading view (32px margins, 12px stable gutter) 450 wide resolves 374');
    }
    for (const [W, expected] of [[675, { width: 599, narrow: true }], [675.5, { width: 599.5, narrow: true }], [676, { width: 600, narrow: false }]]) {
      const { container } = mountPane(W, () => 0, 'markdown-preview-view', desktop);
      assert.deepStrictEqual(probe._resolveWidth({ container }, {}), { ...expected, source: 'measured' },
        `PH9D-CONTENT-WIDTH: the 600 threshold applies to the content width: a desktop reading view ${W} wide (content ${expected.width}) resolves ${expected.narrow ? 'narrow' : 'wide'}`);
    }
    {
      const { pane, container } = mountPane(612, (root) => (hasGraph(root) ? 15 : 0), 'markdown-preview-view', { pad: 32, border: 1 });
      const empty = probe._resolveWidth({ container }, {});
      const emptyInner = container.clientWidth;
      const root = container.createEl('div');
      root.createEl('div', { cls: 'graph-view-canvas' });
      const drawn = probe._resolveWidth({ container }, {});
      const drawnInner = container.clientWidth;
      assert(JSON.stringify([empty, drawn]) === JSON.stringify([
        { width: 546, narrow: true, source: 'measured' }, { width: 546, narrow: true, source: 'measured' },
      ]) && emptyInner === 546 && drawnInner === 531 && pane.ph9Reads === 2,
      'PH9D-CONTENT-WIDTH: without a stable gutter, a 612 pane with 1px borders and 32px margins resolves 546 whether or not the graph shows its 15px scrollbar (its container reads 546, then 531)');
    }
    {
      const savedStyle = Object.getOwnPropertyDescriptor(global, 'getComputedStyle');
      delete global.getComputedStyle;
      const resolved = probe._resolveWidth({ container: { clientWidth: 342, closest: () => ({ offsetWidth: 390, clientWidth: 390 }) } }, {});
      Object.defineProperty(global, 'getComputedStyle', savedStyle);
      assert.deepStrictEqual(resolved, { width: 342, narrow: true, source: 'measured' },
        'PH9D-CONTENT-WIDTH: without getComputedStyle, a scroller measuring 390 around a container measuring 342 resolves 342, the container\'s width');
    }
    // Asymmetric panes: 1px left and 3px right borders, 23.75px left and
    // 24.5px right padding.
    // MUTATION GUARD: PH9D-MUTANT-STABLE-SUBTRACTS-BORDERS turns RED at
    // "PH9D-CONTENT-WIDTH: under a stable gutter ..." if the stable branch
    // also subtracts the borders.
    // MUTATION GUARD: PH9D-MUTANT-PADDING-PARSEINT turns RED at the same label
    // if the computed padding is read with parseInt.
    // MUTATION GUARD: PH9D-MUTANT-LEFT-PADDING-TWICE turns RED at the same
    // label if the left padding is subtracted twice and the right not at all.
    // MUTATION GUARD: PH9D-MUTANT-RIGHT-PADDING-TWICE turns RED at the same
    // label if the right padding is subtracted twice and the left not at all.
    // MUTATION GUARD: PH9D-MUTANT-LEFT-BORDER-TWICE turns RED at
    // "PH9D-CONTENT-WIDTH: without a stable gutter, the offset width less each
    // side's border ..." if the left border is subtracted twice and the right
    // not at all.
    // MUTATION GUARD: PH9D-MUTANT-RIGHT-BORDER-TWICE turns RED at the same
    // label if the right border is subtracted twice and the left not at all.
    const asymmetric = { padLeft: 23.75, padRight: 24.5, borderLeft: 1, borderRight: 3 };
    for (const [W, expected] of [[664, { width: 599.75, narrow: true }], [665, { width: 600.75, narrow: false }]]) {
      const { container } = mountPane(W, () => 0, 'markdown-preview-view', { ...asymmetric, stable: true, reserved: 12 });
      assert.deepStrictEqual(probe._resolveWidth({ container }, {}), { ...expected, source: 'measured' },
        `PH9D-CONTENT-WIDTH: under a stable gutter, the client width less each side's padding once, fractional, with no border subtracted: a ${W} pane (1px and 3px borders, a 12px gutter, 23.75px and 24.5px padding, client width ${W - 16}) resolves ${expected.width}`);
    }
    for (const [W, expected] of [[652, { width: 599.75, narrow: true }], [653, { width: 600.75, narrow: false }]]) {
      const { container } = mountPane(W, (root) => (hasGraph(root) ? 15 : 0), 'markdown-preview-view', asymmetric);
      const empty = probe._resolveWidth({ container }, {});
      const root = container.createEl('div');
      root.createEl('div', { cls: 'graph-view-canvas' });
      const drawn = probe._resolveWidth({ container }, {});
      assert.deepStrictEqual([empty, drawn], [{ ...expected, source: 'measured' }, { ...expected, source: 'measured' }],
        `PH9D-CONTENT-WIDTH: without a stable gutter, the offset width less each side's border and padding once, fractional: a ${W} pane (1px and 3px borders, 23.75px and 24.5px padding) resolves ${expected.width} with and without the graph's 15px scrollbar`);
    }
  }
  // The drawn compact maps pin these literals (from the card formula,
  // chained slices GA-H1 ... GA-H<R>):
  //   phone reading view 390 (24px margins, is-mobile), 5 ranks at 342:
  //     59px pills with short ids, canvas 339;
  //   desktop reading view 675 (content 599), 4 ranks: 140px pills with full
  //     ids, canvas 594;
  //   side-dock reading view 300 (content 248), 3 ranks: 74px pills with
  //     full ids, canvas 246;
  //   Live Preview 500 (content 424), 5 ranks: 76px pills with full ids,
  //     canvas 424;
  //   no stable gutter, 612 with 1px borders (content 546), 5 ranks: 100px
  //     pills with full ids, canvas 544, in a container reading 531 while the
  //     graph shows its 15px scrollbar.
  {
    const savedAppContent = global.app;
    const savedCustomJSContent = global.customJS;
    for (const [label, W, paneClass, options, mobile, R, colW, lefts, ids, canvasWidth, inner] of [
      ['a 390 phone with 24px margins', 390, 'markdown-preview-view', { pad: 24, stable: true, reserved: 0 }, true, 5, 59, [2, 71, 140, 209, 278], 'short', 339, 342],
      ['a desktop reading view 675 wide', 675, 'markdown-preview-view', { pad: 32, stable: true, reserved: 12 }, false, 4, 140, [2, 152, 302, 452], 'full', 594, 599],
      ['a side-dock reading view 300 wide', 300, 'markdown-preview-view', { pad: 20, stable: true, reserved: 12 }, false, 3, 74, [2, 86, 170], 'full', 246, 248],
      ['a Live Preview editor 500 wide', 500, 'cm-scroller', { pad: 32, stable: true, reserved: 12 }, false, 5, 76, [2, 88, 174, 260, 346], 'full', 424, 424],
      ['a 612 pane without a stable gutter', 612, 'markdown-preview-view', { pad: 32, border: 1 }, false, 5, 100, [2, 112, 222, 332, 442], 'full', 544, 531],
    ]) {
      ph1dUseEnv(ph1dChainEnv(R));
      ph1MobileClass = mobile;
      const { pane, container } = mountPane(W, (root) => (hasGraph(root) ? 15 : 0), paneClass, options);
      await new GraphView({ lifecycleApi, insights: new GraphInsights() }).render({ container });
      ph1MobileClass = false;
      const drawing = ph1dCompactDrawing(container.children[0]);
      const containerWidth = container.clientWidth;
      assert.deepStrictEqual({ drawing, containerWidth }, { drawing: ph1dExpectedDrawing(colW, lefts, ids, canvasWidth, 0), containerWidth: inner },
        `PH9D-CONTENT-WIDTH: ${label} draws ${R} chained slices as ${colW}px pills with ${ids} ids on a ${canvasWidth}px canvas, and its container reads ${inner}`);
      if (options.stable) {
        const drawnCanvas = Number.parseFloat(/width:([\d.]+)px/.exec(drawing.canvas || '')?.[1]);
        assert(drawnCanvas <= containerWidth,
          `PH9D-CONTENT-WIDTH: ${label}: the drawn ${drawnCanvas}px canvas is no wider than its container's ${containerWidth}px client width`);
      }
      ph9Discard(pane);
    }
    global.app = savedAppContent;
    global.customJS = savedCustomJSContent;
  }

  // ---- PH9B-OBSERVER-AFTER-MEASURED (PH1C-NO-CONTINUOUS-OBSERVER inverted) ----
  // A measured render watches its pane: exactly one live ResizeObserver, on
  // the note scroll container, one childList watch on its mount container,
  // and nothing pending; its observe() notification re-resolves the drawn
  // presentation and arms nothing. A containerWidth override watches
  // nothing, and later pane changes render nothing.
  // MUTATION GUARD: PH1C-MUTANT-OBSERVER-AFTER-MEASURED turns RED at
  // "PH1C-MUTANT-OBSERVER-AFTER-MEASURED (PH9B-OBSERVER-AFTER-MEASURED): a
  // measured 900 render ..." if a measured render watches nothing (only an
  // unmeasured render would).
  // MUTATION GUARD: PH9C-MUTANT-WATCH-MOUNT-CONTAINER turns RED at the same
  // label if the watch observes the mount container although a note scroll
  // container was found.
  // MUTATION GUARD: PH9C-MUTANT-WATCH-ON-OVERRIDE turns RED at
  // "PH9B-OBSERVER-AFTER-MEASURED: an override 1024 over a measured 390 pane
  // ..." if a render pinned by an override watches.
  for (const [W, drawn] of [[900, 'wide'], [390, 'compact']]) {
    const { pane, container } = mountPane(W);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    const resize = liveResize();
    const watch = liveMutation();
    assert(resize.length === 1 && resize[0].target === pane && watch.length === 1 && watch[0].target === container
      && pendingTimers() === 0 && view.renders === 1 && isCompact(container) === (drawn === 'compact'),
    `PH1C-MUTANT-OBSERVER-AFTER-MEASURED (PH9B-OBSERVER-AFTER-MEASURED): a measured ${W} render draws ${drawn} and leaves exactly one live ResizeObserver, on the note scroll container, one childList watch on its mount container, and zero pending timers`);
    await ph1Frame();
    assert(resize[0].notifications === 1 && view.renders === 1 && pendingTimers() === 0,
      `PH9B-OBSERVER-AFTER-MEASURED: the observe() notification after a measured ${W} render re-resolves ${W}, the drawn presentation, and arms nothing`);
    await settled(`PH9B-OBSERVER-AFTER-MEASURED: measured ${W}`, view, [drawn], container);
    ph9Discard(pane);
  }
  for (const [label, measured, override, drawn] of [
    ['override 1024 over a measured 390 pane', 390, 1024, 'wide'],
    ['override 390 over a measured 900 pane', 900, 390, 'compact'],
    ['override 390 over an unmeasured (0) pane', 0, 390, 'compact'],
  ]) {
    const { pane, container } = mountPane(measured);
    const view = countingView();
    await view.render({ container }, { containerWidth: override });
    await ph1Drain();
    assert(liveObservers().length === 0 && pendingTimers() === 0,
      `PH9B-OBSERVER-AFTER-MEASURED: an ${label} watches nothing and leaves zero pending timers`);
    pane.ph9Width = measured ? 1400 - measured : 590;
    await ph1Frame();
    await ph1Clock.advance(400);
    await settled(`PH9B-OBSERVER-AFTER-MEASURED: ${label}`, view, [drawn], container, { watched: [] });
    ph9Discard(pane);
  }
  // PH1-OBSERVER-DISAGREEMENT-LOOP: with no scroller the watch observes its
  // mount container. Its content box and its clientWidth straddle 600, and
  // content-box ticks after the measured render re-resolve the unchanged
  // clientWidth and render nothing.
  for (const [clientWidth, contentWidth] of [[600, 599.75], [590, 610], [610, 590]]) {
    const container = mountContainer(clientWidth, contentWidth);
    const view = countingView();
    await view.render({ container });
    for (const tick of [contentWidth - 0.25, contentWidth, contentWidth - 0.5]) {
      container.ph1Content = tick;
      await ph1Frame();
      await ph1Clock.advance(130);
    }
    await settled(`PH1-OBSERVER-DISAGREEMENT-LOOP (PH9C-SETTLED-INVARIANT): container ${clientWidth} / observed box ${contentWidth}`,
      view, [clientWidth < 600 ? 'compact' : 'wide'], container);
    ph9Discard(container);
  }

  // Drives a pane on the stubbed clock: one frame every 10ms from 0 to
  // `until`; each change is [ms, width] or [ms, action].
  const ph9Drive = async (pane, changes, until) => {
    for (let at = 0; at <= until; at += 10) {
      for (const [when, change] of changes) {
        if (when !== at) continue;
        if (typeof change === 'function') change();
        else pane.ph9Width = change;
      }
      ph1Deliver();
      await settle();
      await ph1Clock.advance(10);
    }
  };
  // A scenario: a pane at `start`, one render (finished, and its observe()
  // notification delivered), the drive, then settled().
  const ph9Scenario = async (label, { start, changes, until, trace = null, ends = null, delay = 0, gutter, paneClass = 'markdown-preview-view', paneOptions = {}, compactAtEnd = null }) => {
    const { pane, container } = mountPane(start, gutter, paneClass, paneOptions);
    const view = countingView({ delay });
    const rendering = view.render({ container });
    if (delay) await ph1Clock.advance(delay);
    await rendering;
    await ph1Drain();
    await ph1Frame();
    await ph9Drive(pane, changes.map(([when, change]) => [when, change === 'rerun' ? () => { view.render({ container }); } : change]), until);
    await settled(label, view, trace, container, { ends });
    const widths = changes.filter(([, change]) => typeof change === 'number');
    const final = widths.length ? widths[widths.length - 1][1] : start;
    assert.strictEqual(isCompact(container), compactAtEnd ?? final < 600,
      `${label}: the drawn map is ${(compactAtEnd ?? final < 600) ? 'compact' : 'wide'} at the final pane width ${final}`);
    ph9Discard(pane);
    return view;
  };

  // ---- PH9-OBSERVER-CONVERGES ----
  // One frame every 10ms. Each notification, unless the watch is gone,
  // re-resolves the pane's content width; one that resolves a different
  // measured presentation (re)starts a 120ms debounce, which, unless the
  // watch is gone, re-resolves the width again and re-renders only if the
  // presentation (the wide map, or the compact map at the width it was
  // measured at) differs from the one the render resolved.
  // PH1-FLIP-CAP-LOST-CROSSING: crossings 400ms and 1500ms apart ending at
  // 900 each render once and end wide.
  // MUTATION GUARD: PH1C-MUTANT-ONE-SHOT-TWICE turns RED at
  // "PH1C-MUTANT-ONE-SHOT-TWICE (PH9-OBSERVER-CONVERGES): a crossing that
  // reverses inside the debounce ..." if a notification re-renders at once instead of (re)starting the
  // 120ms debounce, so one crossing and its reversal render twice.
  // MUTATION GUARD: PH9C-MUTANT-DEBOUNCE-SKIPS-RERESOLVE turns RED at
  // "PH9-OBSERVER-CONVERGES: 700 -> 590, then 605 with a scrollbar ..." if the
  // debounce decides from the measurement its notification resolved instead
  // of re-resolving.
  // MUTATION GUARD: PH1D-MUTANT-SKIP-WIDE-TO-WIDE turns RED at
  // "PH9-OBSERVER-CONVERGES: 900 -> 700 ..." if the watch re-renders when the
  // measurement resolves the drawn presentation.
  for (const [label, spec] of [
    ['700 -> 500 re-renders once', { start: 700, changes: [[0, 500]], until: 400, trace: ['wide', 'compact'] }],
    ['900 -> 700 does not re-render', { start: 900, changes: [[0, 700]], until: 400, trace: ['wide'] }],
    ['PH1-FLIP-CAP-LOST-CROSSING: four crossings 400ms apart ending at 900', {
      start: 900, changes: [[0, 500], [400, 900], [800, 500], [1200, 900]], until: 1600,
      trace: ['wide', 'compact', 'wide', 'compact', 'wide'],
    }],
    ['PH1-FLIP-CAP-LOST-CROSSING: crossings every 1500ms ending at 900', {
      start: 900, changes: [[0, 500], [1500, 900], [3000, 500], [4500, 900]], until: 4900,
      trace: ['wide', 'compact', 'wide', 'compact', 'wide'],
    }],
    ['a slow resize 700 -> 610 -> 590 -> 560 in 200ms steps ends compact', {
      start: 700, changes: [[0, 610], [200, 590], [400, 560]], until: 800, trace: ['wide', 'compact', 'compact'],
    }],
    ['PH1C-MUTANT-ONE-SHOT-TWICE (PH9-OBSERVER-CONVERGES): a crossing that reverses inside the debounce renders nothing (700 -> 590 -> 700 at 110ms)', {
      start: 700, changes: [[0, 590], [110, 700]], until: 400, trace: ['wide'],
    }],
    ['a crossing that reverses inside the debounce renders nothing (500 -> 610 -> 500 at 60ms)', {
      start: 500, changes: [[0, 610], [60, 500]], until: 400, trace: ['compact'],
    }],
    ['600 -> 599.5 re-renders once, compact', { start: 600, changes: [[0, 599.5]], until: 400, trace: ['wide', 'compact'] }],
    ['600 -> 599.99 re-renders once, compact', { start: 600, changes: [[0, 599.99]], until: 400, trace: ['wide', 'compact'] }],
    ['599.5 -> 600 re-renders once, wide', { start: 599.5, changes: [[0, 600]], until: 400, trace: ['compact', 'wide'] }],
    ['a desktop reading view (32px margins, 12px stable gutter) narrowed from 776 to 675 (content 599) re-renders compact once', {
      start: 776, changes: [[0, 675]], until: 400, trace: ['wide', 'compact'], paneOptions: { pad: 32, stable: true, reserved: 12 },
      gutter: (root) => (hasGraph(root) ? 15 : 0), compactAtEnd: true,
    }],
    ['a desktop reading view (32px margins, 12px stable gutter) widened from 675 to 676 (content 600) re-renders wide once', {
      start: 675, changes: [[0, 676]], until: 400, trace: ['compact', 'wide'], paneOptions: { pad: 32, stable: true, reserved: 12 },
      gutter: (root) => (hasGraph(root) ? 15 : 0), compactAtEnd: false,
    }],
    ['a 390 phone with 24px margins widened to 648 (content 600) re-renders wide once', {
      start: 390, changes: [[0, 648]], until: 400, trace: ['compact', 'wide'], paneOptions: { pad: 24, stable: true, reserved: 0 },
      compactAtEnd: false,
    }],
    ['700 -> 590, then 605 with a scrollbar that keeps the observed box at 590, ends wide', {
      start: 700, changes: [[0, 590], [60, 605]], until: 400, trace: ['wide'],
      gutter: (_root, pane) => (pane.ph9Width === 605 ? 15 : 0),
    }],
  ]) {
    await ph9Scenario(label.startsWith('PH1C-MUTANT-') ? label : `PH9-OBSERVER-CONVERGES: ${label}`, spec);
  }
  {
    const { pane, container } = mountPane(700);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    pane.ph9Width = 590;
    await ph1Frame();
    assert.deepStrictEqual(pendingDelays(), [120], 'PH9-OBSERVER-CONVERGES: a notification that crosses to 590 arms one 120ms debounce');
    pane.ph9Width = 700;
    await ph1Frame();
    assert(pendingTimers() === 0 && view.renders === 1,
      'PH9-OBSERVER-CONVERGES: a notification back at the drawn presentation cancels the pending debounce');
    pane.ph9Width = 590;
    await ph1Frame();
    await ph1Clock.advance(60);
    pane.ph9Width = 580;
    await ph1Frame();
    await ph1Clock.advance(119);
    assert(view.renders === 1 && JSON.stringify(pendingDelays()) === JSON.stringify([120]),
      'PH9-OBSERVER-CONVERGES: each notification restarts the 120ms debounce, so 119ms after the last one nothing has rendered');
    await ph1Clock.advance(1);
    await ph1Drain();
    assert(view.renders === 2 && isCompact(container) && pendingTimers() === 0,
      'PH9-OBSERVER-CONVERGES: 120ms after the last notification the debounce re-renders compact once');
    await settled('PH9-OBSERVER-CONVERGES: the debounce restarts on each notification', view, ['wide', 'compact'], container);
    ph9Discard(pane);
  }

  // ---- PH9D-CONTENT-WIDTH: the watch redraws a compact map at the measured width ----
  // Literals from the card formula, chained slices GA-H1 ... GA-H<R>:
  //   a 390 phone cold load (24px margins, is-mobile, the pane measuring 0
  //     at render): the 390 guess draws 122px pills with full ids on a 390
  //     canvas (3 ranks) or 69px pills with short ids on a 389 canvas (5
  //     ranks); the pane laying out at 390 (content 342) re-renders once:
  //     106px pills with full ids on a 342 canvas, or 59px pills with short
  //     ids on a 339 canvas;
  //   a desktop reading view (32px margins, 12px stable gutter), 5 ranks,
  //     narrowed from 666 (content 590: 109px pills with full ids on a 589
  //     canvas) to 476 (content 400) re-renders once: 71px pills with short
  //     ids on a 399 canvas;
  //   the same pane dragged from 666 to 476 in 50ms steps re-renders once,
  //     after the debounce, at content 400.
  // MUTATION GUARD: PH9D-MUTANT-NARROW-ONLY-PRESENTATION turns RED at
  // "PH9D-CONTENT-WIDTH: a 390 phone cold load with 24px margins and 3
  // chained slices ..." if the watch compares only compact against wide.
  // MUTATION GUARD: PH9D-MUTANT-UNMEASURED-NEVER-RERENDERS turns RED at the
  // same label if a compact map drawn from an unmeasured resolution is never
  // redrawn at a measured width.
  // MUTATION GUARD: PH9D-MUTANT-WIDTH-WITHOUT-DEBOUNCE turns RED at
  // "PH9D-CONTENT-WIDTH: the same pane dragged from 666 to 476 ..." if a
  // compact-to-compact width change re-renders at the notification instead
  // of arming the 120ms debounce.
  {
    const savedAppWatch = global.app;
    const savedCustomJSWatch = global.customJS;
    for (const [R, coldColW, coldLefts, coldIds, coldCanvas, colW, lefts, ids, canvasWidth] of [
      [3, 122, [2, 134, 266], 'full', 390, 106, [2, 118, 234], 'full', 342],
      [5, 69, [2, 81, 160, 239, 318], 'short', 389, 59, [2, 71, 140, 209, 278], 'short', 339],
    ]) {
      ph1dUseEnv(ph1dChainEnv(R));
      ph1MobileClass = true;
      const { pane, container } = mountPane(0, () => 0, 'markdown-preview-view', { pad: 24, stable: true, reserved: 0 });
      const view = countingView();
      await view.render({ container });
      await ph1Drain();
      const cold = ph1dCompactDrawing(container.children[0]);
      await ph1Frame();
      pane.ph9Width = 390;
      await ph1Frame();
      await ph9Debounce();
      ph1MobileClass = false;
      assert.deepStrictEqual(
        { cold, drawing: ph1dCompactDrawing(container.children[0]), renders: view.renders, containerWidth: container.clientWidth },
        { cold: ph1dExpectedDrawing(coldColW, coldLefts, coldIds, coldCanvas, 0), drawing: ph1dExpectedDrawing(colW, lefts, ids, canvasWidth, 0), renders: 2, containerWidth: 342 },
        `PH9D-CONTENT-WIDTH: a 390 phone cold load with 24px margins and ${R} chained slices draws the ${coldCanvas}px guess, then re-renders once when the pane measures 342: ${colW}px pills with ${ids} ids on a ${canvasWidth}px canvas`);
      await settled(`PH9D-CONTENT-WIDTH: a 390 phone cold load with ${R} chained slices`, view, ['compact', 'compact'], container);
      ph9Discard(pane);
    }
    ph1dUseEnv(ph1dChainEnv(5));
    const desktop = { pad: 32, stable: true, reserved: 12 };
    {
      const { pane, container } = mountPane(666, () => 0, 'markdown-preview-view', desktop);
      const view = countingView();
      await view.render({ container });
      await ph1Drain();
      const before = ph1dCompactDrawing(container.children[0]);
      await ph1Frame();
      pane.ph9Width = 476;
      await ph1Frame();
      await ph9Debounce();
      assert.deepStrictEqual(
        { before, after: ph1dCompactDrawing(container.children[0]), renders: view.renders, containerWidth: container.clientWidth },
        { before: ph1dExpectedDrawing(109, [2, 121, 240, 359, 478], 'full', 589, 0), after: ph1dExpectedDrawing(71, [2, 83, 164, 245, 326], 'short', 399, 0), renders: 2, containerWidth: 400 },
        'PH9D-CONTENT-WIDTH: a desktop reading view (32px margins, 12px stable gutter) with 5 chained slices narrowed from 666 (content 590) to 476 (content 400) re-renders once: 109px pills on a 589px canvas, then 71px pills with short ids on a 399px canvas');
      await settled('PH9D-CONTENT-WIDTH: a desktop reading view narrowed from 666 to 476', view, ['compact', 'compact'], container);
      // PH12-CONTROLS-44 after the width-change re-render: GA-H2's card on the
      // re-rendered compact map carries Open slice, Close, a prerequisite link
      // button (GA-H1), and three dependent link buttons (GA-H3 to GA-H5),
      // each with a 44px min-height.
      // MUTATION GUARD: PH12B-MUTANT-RERENDER-LINKS-NULL turns RED at
      // "PH12-CONTROLS-44: after the 666 to 476 re-render ..." if a re-render
      // of the compact map draws its card links without the link height.
      bubblingClick(byClass(container.children[0], 'graph-view-pill').find((pill) => pill.attrs.title === 'GA-H2 Handoff 2'));
      const rerenderedCard = byClass(container.children[0], 'graph-view-detail-panel')[0];
      assert.deepStrictEqual(rerenderedCard ? flatten(rerenderedCard).filter((node) => node.tag === 'button')
        .map((button) => [button.className, cssEffective(button.style.cssText)['min-height'] ?? null])
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)) : null, [
        ['graph-view-detail-close', '44px'], ['graph-view-detail-dependent', '44px'], ['graph-view-detail-dependent', '44px'],
        ['graph-view-detail-dependent', '44px'], ['graph-view-detail-open', '44px'], ['graph-view-detail-prerequisite', '44px'],
      ], 'PH12-CONTROLS-44: after the 666 to 476 re-render, every button in GA-H2\'s compact card (Open slice, Close, one prerequisite and three dependent link buttons) has a 44px min-height');
      ph9Discard(pane);
    }
    {
      const { pane, container } = mountPane(666, () => 0, 'markdown-preview-view', desktop);
      const view = countingView();
      await view.render({ container });
      await ph1Drain();
      await ph1Frame();
      await ph9Drive(pane, [[0, 626], [50, 586], [100, 546], [150, 506], [200, 476]], 400);
      assert.deepStrictEqual({ drawing: ph1dCompactDrawing(container.children[0]), renders: view.renders },
        { drawing: ph1dExpectedDrawing(71, [2, 83, 164, 245, 326], 'short', 399, 0), renders: 2 },
        'PH9D-CONTENT-WIDTH: the same pane dragged from 666 to 476 in 50ms steps re-renders once, after the debounce, at content 400: 71px pills with short ids on a 399px canvas');
      await settled('PH9D-CONTENT-WIDTH: the same pane dragged from 666 to 476', view, ['compact', 'compact'], container);
      ph9Discard(pane);
    }
    global.app = savedAppWatch;
    global.customJS = savedCustomJSWatch;
  }

  // ---- PH9-DRAG-ENDS-CORRECT ----
  // PH1B-FALSE-BISTABLE-PROOF: the pane is dragged across 600 (590 and 610
  // alternately) every 300ms and every 150ms for five seconds, with renders
  // taking 0ms and 200ms of the stubbed clock, then stops at 605, 610, 619,
  // 640, 595, 581, or 560. A 17px scrollbar shows only under the wide graph,
  // on a pane with no padding, borders, or stable gutter.
  // Each run ends on the side of the final width with nothing pending and
  // one live watch, and renders at most once per width change.
  for (const cadence of [300, 150]) {
    for (const delay of [0, 200]) {
      for (const final of [605, 610, 619, 640, 595, 581, 560]) {
        const changes = [];
        for (let at = 0, index = 0; at < 5000; at += cadence, index += 1) changes.push([at, index % 2 ? 610 : 590]);
        changes.push([5000, final]);
        const view = await ph9Scenario(
          `PH9-DRAG-ENDS-CORRECT (PH1B-FALSE-BISTABLE-PROOF): a drag every ${cadence}ms with ${delay}ms renders, stopping at ${final}`,
          { start: 610, changes, until: 5500, ends: final < 600 ? 'compact' : 'wide', delay, gutter: (root) => (isWideGraph(root) ? 17 : 0) },
        );
        assert(view.initiated === 1 && view.renders >= 2 && view.renders <= changes.length + 1,
          `PH9-DRAG-ENDS-CORRECT: a drag every ${cadence}ms with ${delay}ms renders, stopping at ${final}, renders at most once per width change (${view.renders} renders for ${changes.length} changes)`);
      }
    }
  }

  // ---- PH9-SCROLLBAR-CANNOT-FLIP ----
  // PH1B-SCROLLBAR-DEPENDENT-MEASUREMENT: panes of 610, 608, 600, and 599.5,
  // with no padding, borders, or stable gutter, whose scrollbar appears only
  // while a graph is drawn, only under the wide graph, or only under the
  // compact map: each renders exactly once and never oscillates, although
  // the container's clientWidth moves with the scrollbar.
  // MUTATION GUARD: PH9C-MUTANT-CONTAINER-CLIENTWIDTH turns RED here too.
  // MUTATION GUARD: PH1C-MUTANT-OBSERVER-OWN-MEASUREMENT turns RED here too
  // if the watch re-renders on the observer entry's box.
  for (const W of [610, 608, 600, 599.5]) {
    for (const [desc, gutter] of [
      ['15px scrollbar while a graph is drawn', (root) => (hasGraph(root) ? 15 : 0)],
      ['17px scrollbar only under the wide graph', (root) => (isWideGraph(root) ? 17 : 0)],
      ['15px scrollbar only under the compact map', (root) => (hasGraph(root) && !isWideGraph(root) ? 15 : 0)],
    ]) {
      const drawn = W < 600 ? 'compact' : 'wide';
      const label = `PH9-SCROLLBAR-CANNOT-FLIP (PH1B-SCROLLBAR-DEPENDENT-MEASUREMENT): a ${W} pane with a ${desc}`;
      const { pane, container } = mountPane(W, gutter);
      const view = countingView();
      await view.render({ container });
      await ph1Frame();
      const inner = container.clientWidth;
      await settled(label, view, [drawn], container);
      assert(inner === W - gutter(container.children[0], pane),
        `${label}: the drawn ${drawn} root leaves the container reading ${inner}`);
      ph9Discard(pane);
    }
  }
  // S9, S9b: the pane moves while a 200ms observer-driven re-render is in
  // flight; S10: a Dataview re-run lands while the pane narrows to 590.
  // PH1B-PERMANENT-HOLD: 900 -> 610 -> 500 with nothing following ends
  // compact.
  for (const [label, spec] of [
    ['S9: 700 -> 590, with 620 and 595 during the 200ms re-render', {
      start: 700, delay: 200, changes: [[0, 590], [170, 620], [270, 595]], until: 800, trace: ['wide', 'compact', 'compact'],
      gutter: (root) => (hasGraph(root) ? 15 : 0),
    }],
    ['S9: 700 -> 590, with 595 and 620 during the 200ms re-render', {
      start: 700, delay: 200, changes: [[0, 590], [170, 595], [270, 620]], until: 800, trace: ['wide', 'compact', 'wide'],
      gutter: (root) => (hasGraph(root) ? 15 : 0),
    }],
    ['S9b: 560 -> 640, with 585 and 625 during the 200ms re-render', {
      start: 560, delay: 200, changes: [[0, 640], [170, 585], [270, 625]], until: 800, trace: ['compact', 'wide'],
      gutter: (root) => (isWideGraph(root) ? 17 : 0),
    }],
    ['S10: a Dataview re-run at 0 while the pane narrows to 590 at 50', {
      start: 700, delay: 200, changes: [[0, 'rerun'], [50, 590]], until: 800, trace: ['wide', 'wide', 'compact'],
    }],
    ['S10: the pane narrows to 590 at 0 and a Dataview re-run lands at 50', {
      start: 700, delay: 200, changes: [[0, 590], [50, 'rerun']], until: 800, trace: ['wide', 'compact'],
    }],
    ['S10: a Dataview re-run with 0ms renders at 50 while a debounce is pending', {
      start: 700, changes: [[0, 590], [50, 'rerun']], until: 400, trace: ['wide', 'compact'],
    }],
    ['PH1B-PERMANENT-HOLD: 900 -> 610 -> 500 with nothing following ends compact', {
      start: 900, changes: [[0, 610], [200, 500]], until: 600, trace: ['wide', 'compact'],
    }],
  ]) {
    await ph9Scenario(`PH9-SCROLLBAR-CANNOT-FLIP: ${label}`, spec);
  }

  // ---- PH9-UNREADABLE-KEEPS-AND-RECHECKS ----
  // PH1B-THROWING-GETTER-DROPS-CROSSING: the pane (no stable gutter, so its
  // offsetWidth is the width read) throws once,
  // at a chosen read, while the pane crosses 600. The reads, in order: 1 the
  // render, 2 its observe() notification, 3 the crossing notification, 4 the
  // debounce check. The drawn presentation is kept, one 250ms re-check is
  // armed, and the next readable measurement decides.
  // MUTATION GUARD: PH9C-MUTANT-UNREADABLE-DEFAULTS-WIDE turns RED at
  // "PH9-UNREADABLE-KEEPS-AND-RECHECKS (PH1B-THROWING-GETTER-DROPS-CROSSING):
  // a throw at the crossing notification ..." if an unreadable measurement
  // resolves as wide.
  // MUTATION GUARD: PH9C-MUTANT-UNREADABLE-NO-RECHECK turns RED at the same
  // label if an unreadable measurement arms no re-check.
  for (const [label, throwAt, crossTo, midTrace, trace] of [
    ['a throw at the crossing notification', 3, 500, ['wide'], ['wide', 'compact']],
    ['a throw at the debounce check', 4, 500, ['wide'], ['wide', 'compact']],
    ['a throw at the crossing notification, narrow to wide', 3, 700, ['compact'], ['compact', 'wide']],
  ]) {
    const start = crossTo < 600 ? 700 : 500;
    const { pane, container } = mountPane(start);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    pane.ph9ThrowOn = (read) => read === throwAt;
    pane.ph9Width = crossTo;
    await ph1Frame();
    if (throwAt === 4) await ph1Clock.advance(120);
    assert(pane.ph9Reads === throwAt && JSON.stringify(view.trace) === JSON.stringify(midTrace) && view.renders === 1
      && JSON.stringify(pendingDelays()) === JSON.stringify([250]) && isCompact(container) === (midTrace[0] === 'compact'),
    `PH9-UNREADABLE-KEEPS-AND-RECHECKS (PH1B-THROWING-GETTER-DROPS-CROSSING): ${label} keeps the drawn ${midTrace[0]} presentation and arms one 250ms re-check`);
    await ph1Clock.advance(249);
    assert(view.renders === 1, `PH9-UNREADABLE-KEEPS-AND-RECHECKS: ${label}: nothing renders 249ms after the unreadable read`);
    await ph1Clock.advance(1);
    await ph1Drain();
    assert(view.renders === 2 && pane.ph9Reads === throwAt + 1 && isCompact(container) === (crossTo < 600),
      `PH9-UNREADABLE-KEEPS-AND-RECHECKS: ${label}: 250ms later the re-check reads ${crossTo} and re-renders once`);
    await settled(`PH9-UNREADABLE-KEEPS-AND-RECHECKS: ${label}`, view, trace, container);
    ph9Discard(pane);
  }
  // An unreadable notification while the debounce is pending replaces the
  // debounce with the re-check.
  // MUTATION GUARD: PH9C-MUTANT-UNREADABLE-KEEPS-PENDING-DEBOUNCE turns RED at
  // "PH9-UNREADABLE-KEEPS-AND-RECHECKS: an unreadable notification while the
  // debounce is pending ..." if the pending debounce is kept instead.
  {
    const { pane, container } = mountPane(700);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    pane.ph9Width = 500;
    await ph1Frame();
    pane.ph9ThrowOn = (read) => read === 4;
    pane.ph9Width = 490;
    await ph1Frame();
    assert(pane.ph9Reads === 4 && view.renders === 1 && JSON.stringify(pendingDelays()) === JSON.stringify([250]),
      'PH9-UNREADABLE-KEEPS-AND-RECHECKS: an unreadable notification while the debounce is pending replaces it with one 250ms re-check');
    await ph1Clock.advance(250);
    await ph1Drain();
    await settled('PH9-UNREADABLE-KEEPS-AND-RECHECKS: an unreadable notification while the debounce is pending', view, ['wide', 'compact'], container);
    ph9Discard(pane);
  }
  // A throw at the render's own measurement: the render resolves unmeasured
  // and draws the default wide presentation; the watch's observe()
  // notification reads 500 and the debounce re-renders compact once.
  // A throw at the first notification after an observer-driven re-render
  // keeps the re-rendered presentation and re-checks.
  {
    const { pane, container } = mountPane(500);
    pane.ph9ThrowOn = (read) => read === 1;
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    assert(view.renders === 1 && !isCompact(container) && JSON.stringify(pendingDelays()) === JSON.stringify([120]),
      'PH9-UNREADABLE-KEEPS-AND-RECHECKS: a throw at the render\'s own measurement draws the default wide presentation and the observe() notification reading 500 arms the debounce');
    await ph9Debounce();
    await settled('PH9-UNREADABLE-KEEPS-AND-RECHECKS: a throw at the render\'s own measurement', view, ['wide', 'compact'], container);
    ph9Discard(pane);
  }
  {
    const { pane, container } = mountPane(700);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    pane.ph9Width = 500;
    await ph1Frame();
    pane.ph9ThrowOn = (read) => read === 5;
    await ph1Clock.advance(120);
    await ph1Drain();
    pane.ph9Width = 700;
    await ph1Frame();
    assert(pane.ph9Reads === 5 && view.renders === 2 && isCompact(container) && JSON.stringify(pendingDelays()) === JSON.stringify([250]),
      'PH9-UNREADABLE-KEEPS-AND-RECHECKS: a throw at the first notification after an observer-driven re-render keeps the compact map and arms one re-check');
    await ph1Clock.advance(250);
    await ph1Drain();
    await settled('PH9-UNREADABLE-KEEPS-AND-RECHECKS: a throw at the first notification after an observer-driven re-render',
      view, ['wide', 'compact', 'wide'], container);
    ph9Discard(pane);
  }
  // A pane that measures 0 (hidden) is unmeasured: the drawn map is kept,
  // one re-check still reads 0, and nothing is pending until the pane shows
  // again at 700, which re-renders wide once.
  // MUTATION GUARD: PH9C-MUTANT-RECHECK-REPEATS turns RED at
  // "PH9-UNREADABLE-KEEPS-AND-RECHECKS: a pane hidden at 0 ..." if a re-check
  // that is still unmeasured arms another re-check.
  {
    const { pane, container } = mountPane(500);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    pane.ph9Width = 0;
    await ph1Frame();
    await ph1Clock.advance(250);
    await ph1Drain();
    await ph1Clock.advance(1000);
    assert(view.renders === 1 && isCompact(container) && pendingTimers() === 0 && liveResize().length === 1,
      'PH9-UNREADABLE-KEEPS-AND-RECHECKS: a pane hidden at 0 keeps the compact map, and after its one re-check still reads 0 nothing is pending');
    pane.ph9Width = 700;
    await ph1Frame();
    await ph9Debounce();
    await settled('PH9-UNREADABLE-KEEPS-AND-RECHECKS: a pane hidden at 0, then shown at 700', view, ['compact', 'wide'], container);
    ph9Discard(pane);
  }

  // ---- PH9-LIFECYCLE ----
  // Removing the root while a debounce or a re-check is pending disconnects
  // the watch and renders nothing, through the childList record and, with
  // no mutation-observer API, when the timer fires.
  // MUTATION GUARD: PH9C-MUTANT-DISCONNECT-KEEPS-TIMER turns RED at
  // "PH9-LIFECYCLE: removing the root while a debounce is pending ..." if
  // disconnecting leaves the pending timer armed.
  for (const [label, pendingKind, withMutation] of [
    ['removing the root while a debounce is pending', 'debounce', true],
    ['removing the root while a re-check is pending', 'recheck', true],
    ['with no MutationObserver API, removing the root while a debounce is pending', 'debounce', false],
    ['with no MutationObserver API, removing the root while a re-check is pending', 'recheck', false],
  ]) {
    if (!withMutation) global.MutationObserver = undefined;
    const { pane, container } = mountPane(700);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    if (pendingKind === 'recheck') pane.ph9ThrowOn = (read) => read === 3;
    pane.ph9Width = 500;
    await ph1Frame();
    const [resize] = liveResize();
    const armedDelays = pendingDelays();
    container.children[0].remove();
    await ph1Frame();
    if (withMutation) {
      assert(resize.disconnected === 1 && liveObservers().length === 0 && pendingTimers() === 0,
        `PH9-LIFECYCLE: ${label} disconnects the watch and clears its timer on the next frame`);
    }
    await ph1Clock.advance(300);
    await ph1Drain();
    global.MutationObserver = BrowserLikeMutationObserver;
    assert(JSON.stringify(armedDelays) === JSON.stringify([pendingKind === 'debounce' ? 120 : 250]) && resize.disconnected === 1
      && liveObservers().length === 0 && view.renders === 1 && container.children.length === 0 && resize.thrown.length === 0,
    `PH9-LIFECYCLE: ${label} disconnects and renders nothing`);
    await settled(`PH9-LIFECYCLE: ${label}`, view, ['wide']);
    ph9Discard(pane);
  }
  // A Dataview re-run that replaces the root disconnects the previous
  // observer as it starts, clearing a pending debounce, while the re-run's
  // own 200ms render is still in flight; fifty Dataview re-runs on the same
  // container leave exactly one live observer and zero pending timers.
  // MUTATION GUARD: PH9C-MUTANT-RERUN-KEEPS-OBSERVER turns RED at
  // "PH9-LIFECYCLE: a Dataview re-run that replaces the root ..." if the
  // previous observer stays connected on a Dataview re-run.
  {
    const { pane, container } = mountPane(700);
    const view = countingView({ delay: 200 });
    const initial = view.render({ container });
    await ph1Clock.advance(200);
    await initial;
    await ph1Frame();
    const [previous] = liveResize();
    pane.ph9Width = 500;
    await ph1Frame();
    const rerun = view.render({ container });
    assert(previous.disconnected === 1 && liveObservers().length === 0 && JSON.stringify(pendingDelays()) === JSON.stringify([200]),
      'PH9-LIFECYCLE: a Dataview re-run that replaces the root disconnects the previous observer as it starts and clears its pending debounce');
    await ph1Clock.advance(200);
    await rerun;
    assert(view.renders === 2 && isCompact(container) && liveResize().length === 1 && liveResize()[0] !== previous
      && liveResize()[0].target === pane && liveMutation().length === 1 && container.children.length === 1,
    'PH9-LIFECYCLE: the re-run draws compact once and leaves one watch on the pane');
    let most = 0;
    for (let run = 0; run < 50; run += 1) {
      const next = view.render({ container });
      await ph1Clock.advance(200);
      await next;
      await ph1Frame();
      most = Math.max(most, liveResize().length, liveMutation().length);
    }
    assert(most === 1 && liveResize().length === 1 && liveMutation().length === 1 && pendingTimers() === 0 && view.renders === 52,
      'PH9-LIFECYCLE: fifty Dataview re-runs on the same container leave exactly one live observer after every render and zero pending timers');
    await settled('PH9-LIFECYCLE: fifty Dataview re-runs on the same container', view, ['wide', ...Array(51).fill('compact')], container);
    ph9Discard(pane);
  }
  // A new mount container replacing the old one inside the same pane (the
  // old one leaves with its root inside): the new watch disconnects the old
  // one as it is installed. A mount container that leaves its pane with its
  // root inside disconnects at its pane's next notification.
  // MUTATION GUARD: PH9C-MUTANT-NO-PANE-PRUNE turns RED at "PH9-LIFECYCLE: a
  // new mount container in the same pane ..." if a new watch leaves a gone
  // watch on the same pane connected.
  // MUTATION GUARD: PH9C-MUTANT-KEEPS-LEFT-PANE turns RED at "PH9-LIFECYCLE:
  // a mount container that left its pane ..." if a watch whose container
  // left the pane it watches stays connected.
  {
    const { pane, container: old } = mountPane(700);
    const view = countingView();
    await view.render({ container: old });
    await ph1Frame();
    const [oldResize] = liveResize();
    old.remove();
    const replacement = mountContainer((root) => pane.ph9Inner(root));
    replacement.parent = pane;
    pane.children.push(replacement);
    await view.render({ container: replacement });
    await ph1Drain();
    assert(oldResize.disconnected === 1 && liveResize().length === 1 && liveResize()[0].target === pane
      && liveMutation().length === 1 && liveMutation()[0].target === replacement,
    'PH9-LIFECYCLE: a new mount container in the same pane disconnects the watch of the one it replaced as its own watch is installed');
    await settled('PH9-LIFECYCLE: a new mount container in the same pane', view, ['wide', 'wide'], replacement,
      { targets: [pane] });
    ph9Discard(pane);
  }
  {
    const { pane, container } = mountPane(700);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    const [resize] = liveResize();
    container.remove();
    pane.ph9Width = 500;
    await ph1Frame();
    assert(resize.disconnected === 1 && liveObservers().length === 0 && pendingTimers() === 0 && view.renders === 1,
      'PH9-LIFECYCLE: a mount container that left its pane with its root inside disconnects at the pane\'s next notification and renders nothing');
    await settled('PH9-LIFECYCLE: a mount container that left its pane', view, ['wide']);
    ph9Discard(pane);
  }
  // A mount container moved, root inside, from a 700 pane into a 900 pane:
  // the old pane's next notification disconnects its watch and renders
  // nothing; after a Dataview re-run, the new pane narrowing to 500
  // re-renders compact once.
  // MUTATION GUARD: PH9D-MUTANT-GONE-ONLY-WITHOUT-SCROLLER turns RED at
  // "PH9-LIFECYCLE: a mount container moved into another pane ..." if a
  // container inside a different scroll container stays watched by its old
  // one.
  {
    const { pane: first, container } = mountPane(700);
    const { pane: second, container: spare } = mountPane(900);
    spare.remove();
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    const [resize] = liveResize();
    second.insertBefore(container, null);
    first.ph9Width = 680;
    await ph1Frame();
    await ph1Clock.advance(1000);
    await ph1Drain();
    assert(resize.disconnected === 1 && liveObservers().length === 0 && pendingTimers() === 0 && view.renders === 1
      && container.closest('.markdown-preview-view, .cm-scroller') === second,
    'PH9-LIFECYCLE: a mount container moved into another pane disconnects its old pane\'s watch at that pane\'s next notification and renders nothing');
    await view.render({ container });
    await ph1Frame();
    assert(liveResize().length === 1 && liveResize()[0].target === second && view.renders === 2,
      'PH9-LIFECYCLE: a Dataview re-run of the moved container watches the new pane');
    second.ph9Width = 500;
    await ph1Frame();
    await ph9Debounce();
    assert(view.renders === 3 && isCompact(container),
      'PH9-LIFECYCLE: the new pane narrowing to 500 re-renders the moved container compact once');
    await settled('PH9-LIFECYCLE: a mount container moved into another pane', view, ['wide', 'wide', 'compact'], container,
      { targets: [second] });
    ph9Discard(first, second);
  }
  // Two mount containers in one pane (two graph blocks in one note) each
  // keep their own watch on the pane, and both follow a crossing.
  // MUTATION GUARD: PH9C-MUTANT-PRUNE-EVERY-PEER turns RED at "PH9-LIFECYCLE:
  // two mount containers in one pane ..." if a new watch disconnects every
  // watch on its pane, gone or not.
  // MUTATION GUARD: PH1C-MUTANT-PER-INSTANCE-KEY turns RED at the same label
  // if the watch is owned per GraphView instance instead of per container.
  // MUTATION GUARD: PH9D-MUTANT-PANE-SET-COPIED turns RED at "PH9-LIFECYCLE:
  // ten alternating Dataview re-runs ..." if each install copies the pane's
  // watch set, so a disconnected watch stays in the copy.
  {
    const { pane, container: first } = mountPane(700);
    const second = mountContainer((root) => pane.ph9Inner(root));
    second.parent = pane;
    pane.children.push(second);
    const view = countingView();
    await view.render({ container: first });
    await view.render({ container: second });
    await ph1Frame();
    assert(liveResize().length === 2 && liveResize().every((observer) => observer.target === pane) && liveMutation().length === 2,
      'PH9-LIFECYCLE: two mount containers in one pane each keep their own watch on the pane');
    pane.ph9Width = 500;
    await ph1Frame();
    await ph9Debounce();
    assert(isCompact(first) && isCompact(second) && view.renders === 4 && liveResize().length === 2,
      'PH9-LIFECYCLE: two mount containers in one pane both re-render compact once when the pane crosses to 500');
    await settled('PH9-LIFECYCLE: two mount containers in one pane', view, ['wide', 'wide', 'compact', 'compact'], null,
      { watched: [first, second], targets: [pane, pane] });
    for (let run = 0; run < 10; run += 1) await view.render({ container: run % 2 ? second : first });
    await ph1Drain();
    assert(view._paneWatches.get(pane).size === 2 && liveResize().length === 2,
      'PH9-LIFECYCLE: ten alternating Dataview re-runs of two mount containers in one pane leave the pane\'s watch set holding exactly its two live watches');
    ph9Discard(pane);
  }
  // A compact map that fails and falls back to wide: the watch compares
  // against the presentation the render resolved (compact at 500), so a
  // notification that still measures 500 re-renders nothing, and the pane
  // narrowing to 480 re-renders once.
  // MUTATION GUARD: PH9C-MUTANT-DRAWN-FROM-DOM turns RED at "PH9-LIFECYCLE:
  // a 500 pane whose compact map always fails ..." if the watch compares
  // against the presentation found in the drawn DOM.
  {
    const { pane, container } = mountPane(500, (_root, target) => target.ph9Bar || 0);
    const view = countingView();
    view._compactGeometry = () => { throw new Error('compact geometry fault'); };
    await view.render({ container });
    await ph1Frame();
    assert(liveResize().length === 1 && liveResize()[0].target === pane,
      'PH9-LIFECYCLE: a 500 pane whose compact map always fails watches the pane with one resize observer after the render that recorded the fault');
    const [resize] = liveResize();
    pane.ph9Bar = 15;
    await ph1Frame();
    await ph1Clock.advance(1000);
    await ph1Drain();
    assert(view.renders === 1 && resize.notifications === 2 && !isCompact(container) && hasGraph(container.children[0]) && pendingTimers() === 0,
      'PH9-LIFECYCLE: a 500 pane whose compact map always fails draws the wide fallback once, and a notification that still measures 500 re-renders nothing');
    pane.ph9Width = 480;
    await ph1Frame();
    await ph9Debounce();
    assert(view.renders === 2 && !isCompact(container) && hasGraph(container.children[0]),
      'PH9-LIFECYCLE: the pane narrowing to 480 re-renders the failing compact map once, to the wide fallback');
    await settled('PH9-LIFECYCLE: a compact map that always fails', view, ['wide', 'wide'], container);
    ph9Discard(pane);
  }

  // ---- PH9D: interaction, pruning, multiple widgets, cutoffs, throws ----
  // MUTATION GUARD: PH9D-MUTANT-INTERACTION-CANCELS-DEBOUNCE turns RED at
  // "PH9-OBSERVER-CONVERGES: a chip tap 60ms into a pending debounce ..."
  // (and at the stuck filter toggle and canvas tap labels) if that
  // interaction cancels the pending debounce.
  // MUTATION GUARD: PH9D-MUTANT-INTERACTION-DEFERS-TO-RECHECK turns RED at
  // the chip tap label if a tap replaces the pending debounce with a 250ms
  // re-check.
  for (const [what, act] of [
    ['a chip tap', (root) => bubblingClick(byClass(root, 'graph-view-chip')[0])],
    ['a stuck filter toggle', (root) => bubblingClick(byClass(root, 'graph-view-filter-stuck')[0])],
    ['a canvas tap', (root) => bubblingClick(byClass(root, 'graph-view-canvas')[0])],
  ]) {
    const { pane, container } = mountPane(700);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    pane.ph9Width = 590;
    await ph1Frame();
    await ph1Clock.advance(60);
    act(container.children[0]);
    const afterTap = pendingDelays();
    await ph1Clock.advance(60);
    await ph1Drain();
    assert(JSON.stringify(afterTap) === JSON.stringify([120]) && view.renders === 2 && isCompact(container),
      `PH9-OBSERVER-CONVERGES: ${what} 60ms into a pending debounce leaves the 120ms debounce pending, and 120ms after the 590 notification the map re-renders compact once`);
    await settled(`PH9-OBSERVER-CONVERGES: ${what} 60ms into a pending debounce`, view, ['wide', 'compact'], container);
    ph9Discard(pane);
  }
  // MUTATION GUARD: PH9D-MUTANT-INTERACTION-CANCELS-RECHECK turns RED at
  // "PH9-UNREADABLE-KEEPS-AND-RECHECKS: a chip tap 100ms into a pending
  // re-check ..." if a tap cancels a pending re-check.
  {
    const { pane, container } = mountPane(700);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    pane.ph9ThrowOn = (read) => read === 3;
    pane.ph9Width = 590;
    await ph1Frame();
    await ph1Clock.advance(100);
    bubblingClick(byClass(container.children[0], 'graph-view-chip')[0]);
    const afterTap = pendingDelays();
    await ph1Clock.advance(150);
    await ph1Drain();
    assert(JSON.stringify(afterTap) === JSON.stringify([250]) && view.renders === 2 && isCompact(container),
      'PH9-UNREADABLE-KEEPS-AND-RECHECKS: a chip tap 100ms into a pending re-check leaves it pending, and 250ms after the unreadable notification the re-check reads 590 and re-renders compact once');
    await settled('PH9-UNREADABLE-KEEPS-AND-RECHECKS: a chip tap 100ms into a pending re-check', view, ['wide', 'compact'], container);
    ph9Discard(pane);
  }
  // MUTATION GUARD: PH9D-MUTANT-WIDENING-DEBOUNCE-119 turns RED at
  // "PH9-OBSERVER-CONVERGES: a pane widened from 500 to 700 ..." if the
  // debounce toward wide is 119ms.
  {
    const { pane, container } = mountPane(500);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    pane.ph9Width = 700;
    await ph1Frame();
    const delays = pendingDelays();
    await ph1Clock.advance(119);
    await ph1Drain();
    const at119 = view.renders;
    await ph1Clock.advance(1);
    await ph1Drain();
    assert(JSON.stringify(delays) === JSON.stringify([120]) && at119 === 1 && view.renders === 2 && !isCompact(container),
      'PH9-OBSERVER-CONVERGES: a pane widened from 500 to 700 arms one 120ms debounce, nothing renders 119ms later, and at 120ms the map re-renders wide once');
    await settled('PH9-OBSERVER-CONVERGES: a pane widened from 500 to 700', view, ['compact', 'wide'], container);
    ph9Discard(pane);
  }
  // MUTATION GUARD: PH9D-MUTANT-PEERS-CLEARED turns RED at "PH9-LIFECYCLE:
  // two mount containers in one 700 pane, the first leaving ..." if a pane's
  // watch set is cleared after a prune.
  // MUTATION GUARD: PH9D-MUTANT-PRUNE-FIRST-GONE-ONLY turns RED at
  // "PH9-LIFECYCLE: three mount containers in one 700 pane, two leaving ..."
  // if a prune stops after the first gone watch.
  // MUTATION GUARD: PH9D-MUTANT-PRUNE-LAST-PEER-ONLY turns RED at the same
  // label if a prune checks only the last watch.
  for (const [label, total, leaving] of [
    ['two mount containers in one 700 pane, the first leaving with its root, then a third mounting', 2, 1],
    ['three mount containers in one 700 pane, two leaving with their roots, then a fourth mounting', 3, 2],
  ]) {
    const { pane, container: c1 } = mountPane(700);
    const mount = () => {
      const added = mountContainer((root) => pane.ph9Inner(root));
      added.parent = pane;
      pane.children.push(added);
      return added;
    };
    const mounts = [c1];
    while (mounts.length < total) mounts.push(mount());
    const view = countingView();
    for (const mounted of mounts) await view.render({ container: mounted });
    await ph1Frame();
    const watches = liveResize();
    const gone = mounts.slice(0, leaving);
    for (const left of gone) left.remove();
    const added = mount();
    await view.render({ container: added });
    await ph1Drain();
    const kept = [...mounts.slice(leaving), added];
    assert(watches.slice(0, leaving).every((observer) => observer.disconnected === 1) && liveResize().length === kept.length
      && liveResize().every((observer) => observer.target === pane),
    `PH9-LIFECYCLE: ${label} disconnects each gone watch as the new one is installed and leaves ${kept.length} live watches on the pane`);
    await settled(`PH9-LIFECYCLE: ${label}`, view, Array(total + 1).fill('wide'), null, { watched: kept, targets: kept.map(() => pane) });
    ph9Discard(pane, ...gone);
  }
  // MUTATION GUARD: PH9D-MUTANT-DRAWN-STATE-ON-INSTANCE turns RED at
  // "PH9-LIFECYCLE: one instance draws compact maps in a 500 pane and a 400
  // pane ..." if the drawn width is kept on the instance, and at
  // "PH9-LIFECYCLE: one instance draws a compact map in a 500 pane, then a
  // wide map in a 700 pane ..." if the drawn compact-or-wide state is.
  {
    const savedAppWidgets = global.app;
    const savedCustomJSWidgets = global.customJS;
    ph1dUseEnv(ph1dChainEnv(5));
    const { pane: first, container: a } = mountPane(500);
    const { pane: second, container: b } = mountPane(400);
    const view = countingView();
    await view.render({ container: a });
    await ph1Frame();
    await view.render({ container: b });
    await ph1Frame();
    first.ph9Width = 400;
    await ph1Frame();
    await ph9Debounce();
    assert.deepStrictEqual({ drawing: ph1dCompactDrawing(a.children[0]), renders: view.renders },
      { drawing: ph1dExpectedDrawing(71, [2, 83, 164, 245, 326], 'short', 399, 0), renders: 3 },
      'PH9-LIFECYCLE: one instance draws compact maps in a 500 pane and a 400 pane; the 500 pane narrowing to 400 redraws its map once: 71px pills with short ids on a 399px canvas');
    await settled('PH9-LIFECYCLE: one instance, compact maps in a 500 pane and a 400 pane', view, ['compact', 'compact', 'compact'], null,
      { watched: [a, b], targets: [first, second] });
    ph9Discard(first, second);
    global.app = savedAppWidgets;
    global.customJS = savedCustomJSWidgets;
  }
  {
    const { pane: wide, container: a } = mountPane(700);
    const { pane: narrow, container: b } = mountPane(500);
    const view = countingView();
    await view.render({ container: b });
    await ph1Frame();
    await view.render({ container: a });
    await ph1Frame();
    narrow.ph9Width = 800;
    await ph1Frame();
    await ph9Debounce();
    assert(view.renders === 3 && !isCompact(b) && !isCompact(a),
      'PH9-LIFECYCLE: one instance draws a compact map in a 500 pane, then a wide map in a 700 pane; the 500 pane widening to 800 redraws its map wide once');
    await settled('PH9-LIFECYCLE: one instance, a compact map in a 500 pane and a wide map in a 700 pane', view, ['compact', 'wide', 'wide'], null,
      { watched: [b, a], targets: [narrow, wide] });
    ph9Discard(wide, narrow);
  }
  // MUTATION GUARD: PH9D-MUTANT-COMPACT-WIDTH-TOLERANCE turns RED at
  // "PH9D-CONTENT-WIDTH: a 393 phone pane ... moved to 390 ..." if compact
  // widths within 3px compare equal, and at the "moved to 392" label if
  // widths within 1px do.
  {
    const savedAppTolerance = global.app;
    const savedCustomJSTolerance = global.customJS;
    for (const [to, content] of [[390, 342], [392, 344]]) {
      ph1dUseEnv(ph1dChainEnv(3));
      const { pane, container } = mountPane(393, () => 0, 'markdown-preview-view', { pad: 24, stable: true, reserved: 0 });
      const view = countingView();
      await view.render({ container });
      await ph1Drain();
      const before = ph1dCompactDrawing(container.children[0]);
      await ph1Frame();
      pane.ph9Width = to;
      await ph1Frame();
      await ph9Debounce();
      assert.deepStrictEqual({ before, after: ph1dCompactDrawing(container.children[0]), renders: view.renders },
        { before: ph1dExpectedDrawing(107, [2, 119, 236], 'full', 345, 0), after: ph1dExpectedDrawing(106, [2, 118, 234], 'full', 342, 0), renders: 2 },
        `PH9D-CONTENT-WIDTH: a 393 phone pane with 24px margins and 3 chained slices, drawn at content 345 (107px pills on a 345px canvas), moved to ${to} (content ${content}) redraws once: 106px pills on a 342px canvas`);
      await settled(`PH9D-CONTENT-WIDTH: a 393 phone pane moved to ${to}`, view, ['compact', 'compact'], container);
      ph9Discard(pane);
    }
    global.app = savedAppTolerance;
    global.customJS = savedCustomJSTolerance;
  }
  // MUTATION GUARD: PH9D-MUTANT-STABLE-READS-CONTAINER turns RED at
  // "PH9D-CONTENT-WIDTH: a 700 desktop pane ... whose mount container is
  // inset 48px ..." if the stable branch reads the mount container's client
  // width.
  {
    const { pane, container } = mountPane(700, () => 0, 'markdown-preview-view', { pad: 32, stable: true, reserved: 12, inset: 48 });
    assert.deepStrictEqual({ resolved: new GraphView()._resolveWidth({ container }, {}), containerWidth: container.clientWidth },
      { resolved: { width: 624, narrow: false, source: 'measured' }, containerWidth: 576 },
      'PH9D-CONTENT-WIDTH: a 700 desktop pane (32px margins, 12px stable gutter) whose mount container is inset 48px (client width 576) resolves 624 wide');
    ph9Discard(pane);
  }
  // MUTATION GUARD: PH9D-MUTANT-STABLE-THROW-USES-OFFSET turns RED at
  // "PH9-UNREADABLE-KEEPS-AND-RECHECKS: a stable-gutter pane whose client
  // width throws ..." if a throwing client width read falls back to the
  // offset width.
  {
    const { pane, container } = mountPane(700, () => 0, 'markdown-preview-view', { pad: 32, stable: true, reserved: 12 });
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    pane.ph9ThrowOn = (read) => read === 3;
    pane.ph9Width = 600;
    await ph1Frame();
    const delays = pendingDelays();
    const reads = pane.ph9Reads;
    const kept = view.renders;
    await ph1Clock.advance(250);
    await ph1Drain();
    assert(reads === 3 && JSON.stringify(delays) === JSON.stringify([250]) && kept === 1 && view.renders === 2 && isCompact(container),
      'PH9-UNREADABLE-KEEPS-AND-RECHECKS: a stable-gutter pane whose client width throws at the 600 notification keeps the wide map and arms one 250ms re-check, which reads content 524 and re-renders compact once');
    await settled('PH9-UNREADABLE-KEEPS-AND-RECHECKS: a stable-gutter pane whose client width throws', view, ['wide', 'compact'], container);
    ph9Discard(pane);
  }

  // ---- PH9B-SCOPED-TIMER-BAN ----
  // The only timers are the 120ms debounce and the 250ms re-check, armed
  // through one setTimeout call and cleared through one clearTimeout call,
  // both inside the watch installer; there is no interval, no animation
  // frame, and no band, settle, streak, hold, or bistable state.
  {
    const installer = widgetSource.match(/\n {2}_watchPaneWidth\(dv, overrides, root, resolved\) \{[\s\S]*?\n {2}\}\n/)?.[0] || '';
    const outside = widgetSource.replace(installer, '');
    assert(installer.length > 0
      && (installer.match(/globalThis\.setTimeout\(/g) || []).length === 1 && (installer.match(/globalThis\.clearTimeout\(/g) || []).length === 1
      && !/setTimeout|clearTimeout/.test(outside)
      && JSON.stringify((installer.match(/\barm\((\d+),/g) || []).map((call) => Number(call.slice(4, -1))).sort((a, b) => a - b)) === JSON.stringify([120, 250]),
    'PH9B-SCOPED-TIMER-BAN: setTimeout and clearTimeout appear once each, inside the watch installer, and the only delays armed are 120 and 250');
    for (const identifier of [
      '_flipStreak', '_flipStreaks', '_widthFlipAllowed', 'settleCheck', 'boundedCheck', 'bistable', 'withinBand',
      'sawCompactWide', 'sawWideNarrow', '_handoffWidthRender', '_beginWidthRender', '_resetWidthState', '_widthState',
      '_widthHandoffs', 'setInterval', 'requestAnimationFrame',
    ]) {
      assert(!widgetSource.includes(identifier), `PH9B-SCOPED-TIMER-BAN: graph-view.js contains no ${identifier}`);
    }
    assert(!/band|settle|streak|hold|bistable/i.test(widgetSource),
      'PH9B-SCOPED-TIMER-BAN: graph-view.js names no band, settle, streak, hold, or bistable state anywhere');
  }

  // ---- PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-COLD-LOAD) ----
  // The PH-1c cold load, through the continuous watch. A render at
  // clientWidth 0 with no note scroll container draws default wide and
  // watches its mount container. Each notification re-resolves the same
  // measurement render() uses: while it is unmeasured the drawn map is kept
  // and one re-check is armed; when the pane lays out at 590 the 120ms
  // debounce re-renders compact exactly once, and that render watches anew.
  // MUTATION GUARD: PH1-MUTANT-RERENDER-EVERY-TICK turns RED at
  // "PH1-MUTANT-RERENDER-EVERY-TICK (PH9C-ONE-SHOT-EQUIVALENTS): the
  // observe() notification ..." if an unmeasured notification arms the
  // debounce or re-renders instead of keeping the drawn map and arming the
  // re-check.
  // MUTATION GUARD: PH1C-MUTANT-OBSERVER-OWN-MEASUREMENT turns RED at
  // "PH1C-MUTANT-OBSERVER-OWN-MEASUREMENT (PH9C-ONE-SHOT-EQUIVALENTS): a
  // notification with a 300px box ..." if the watch re-renders on the
  // observer entry's box without re-resolving.
  // MUTATION GUARD: PH9C-MUTANT-DEBOUNCE-119 turns RED at
  // "PH9C-ONE-SHOT-EQUIVALENTS: 119ms after the notification at 590 ..." if
  // the debounce is 119ms.
  // MUTATION GUARD: PH9C-MUTANT-DEBOUNCE-121 turns RED at
  // "PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-COLD-LOAD): 120ms after the
  // notification at 590 ..." if the debounce is 121ms.
  // MUTATION GUARD: PH9C-MUTANT-RECHECK-249 turns RED at
  // "PH9C-ONE-SHOT-EQUIVALENTS: 249ms after the unmeasured notification ..."
  // if the re-check is 249ms.
  // MUTATION GUARD: PH9C-MUTANT-RECHECK-251 turns RED at
  // "PH9C-ONE-SHOT-EQUIVALENTS: 250ms after the unmeasured notification ..."
  // if the re-check is 251ms.
  {
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    const [resize] = liveResize();
    const [watch] = liveMutation();
    assert(view.renders === 1 && !isCompact(container) && liveResize().length === 1 && resize.target === container
      && liveMutation().length === 1 && watch.target === container && pendingTimers() === 0,
    'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-COLD-LOAD): a render at clientWidth 0 with no note scroll container renders wide and watches with exactly one ResizeObserver, on its mount container, plus one childList watch');
    await ph1Frame();
    assert(resize.notifications === 1 && view.renders === 1 && resize.live && JSON.stringify(pendingDelays()) === JSON.stringify([250]),
      'PH1-MUTANT-RERENDER-EVERY-TICK (PH9C-ONE-SHOT-EQUIVALENTS): the observe() notification re-resolves 0, keeps the drawn map, and arms one 250ms re-check');
    await ph1Clock.advance(249);
    assert(pendingTimers() === 1 && container.ph1Reads === 2,
      'PH9C-ONE-SHOT-EQUIVALENTS: 249ms after the unmeasured notification the re-check has not read the width');
    await ph1Clock.advance(1);
    assert(pendingTimers() === 0 && container.ph1Reads === 3 && view.renders === 1 && resize.live,
      'PH9C-ONE-SHOT-EQUIVALENTS: 250ms after the unmeasured notification the re-check reads 0 once more, keeps the map, and leaves nothing pending');
    container.ph1Content = 300;
    await ph1Frame();
    await ph1Clock.advance(1000);
    await ph1Drain();
    assert(resize.notifications === 2 && view.renders === 1 && resize.live && pendingTimers() === 0,
      'PH1C-MUTANT-OBSERVER-OWN-MEASUREMENT (PH9C-ONE-SHOT-EQUIVALENTS): a notification with a 300px box while clientWidth still reads 0 does not re-render');
    container.ph1Width = 590;
    container.ph1Content = null;
    await ph1Frame();
    assert(view.renders === 1 && JSON.stringify(pendingDelays()) === JSON.stringify([120]),
      'PH9C-ONE-SHOT-EQUIVALENTS: the notification at 590 arms the 120ms debounce and renders nothing yet');
    await ph1Clock.advance(119);
    assert(view.renders === 1,
      'PH9C-ONE-SHOT-EQUIVALENTS: 119ms after the notification at 590 nothing has rendered');
    await ph1Clock.advance(1);
    await ph1Drain();
    assert(view.renders === 2 && isCompact(container) && resize.disconnected === 1 && liveResize().length === 1
      && liveResize()[0] !== resize && liveResize()[0].target === container && resize.thrown.length === 0,
    'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-COLD-LOAD): 120ms after the notification at 590 the watch disconnects and re-renders compact exactly once, and the re-render watches with a new observer');
    await settled('PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-COLD-LOAD): cold load at 0, the pane lays out at 590', view, ['wide', 'compact'], container);
    ph9Discard(container);
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
    const [resize] = liveResize();
    assert(isCompact(container) && JSON.stringify(domShape(container.children[0])) === at390
      && liveResize().length === 1 && resize.target === container && liveMutation().length === 1,
    'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-COLD-LOAD): an is-mobile cold load (clientWidth 0) renders the 390 compact map and watches with exactly one observer');
    await ph1Frame();
    await ph1Clock.advance(250);
    assert(view.renders === 1 && resize.live && pendingTimers() === 0,
      'PH9C-ONE-SHOT-EQUIVALENTS: on is-mobile the unmeasured notification and its re-check keep the compact map');
    container.ph1Width = 800;
    await ph1Frame();
    await ph9Debounce();
    assert(view.renders === 2 && !isCompact(container) && resize.disconnected === 1 && liveResize().length === 1,
      'PH9C-ONE-SHOT-EQUIVALENTS: when the is-mobile container measures 800 the watch re-renders once, to wide');
    await settled('PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-COLD-LOAD): is-mobile cold load at 390 compact, the pane measures 800',
      view, ['compact', 'wide'], container);
    ph1MobileClass = false;
    ph9Discard(container);
  }
  // Removing the root disconnects the watch (and clears its re-check)
  // without rendering, even when the pane has meanwhile laid out at 590.
  for (const [label, laidOut] of [['before its first notification', false], ['after a laid-out 240px box', true]]) {
    const container = mountContainer(0, laidOut ? 240 : null);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    const [resize] = liveResize();
    if (laidOut) {
      await ph1Frame();
      assert(resize && resize.notifications === 1 && resize.live && view.renders === 1 && pendingTimers() === 1,
        'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-COLD-LOAD): a 240px box over an unmeasured pane keeps observing with one re-check armed');
    }
    container.children[0].remove();
    container.ph1Width = 590;
    await ph1Frame();
    assert(resize && resize.disconnected === 1 && view.renders === 1 && container.children.length === 0
      && liveObservers().length === 0 && pendingTimers() === 0 && resize.thrown.length === 0,
    `PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-COLD-LOAD): removing the root ${label} disconnects the watch without rendering`);
    await settled(`PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-COLD-LOAD): root removed ${label}`, view, ['wide']);
    ph9Discard(container);
  }
  // A new mount container replaces the old one at cold load: the old
  // container leaves the document with its root inside, so its watch stays on
  // that detached subtree (one notification, the one observe() owes, and no
  // render; the harness collects it); the new container's watch re-renders
  // once when its pane lays out.
  // MUTATION GUARD: PH1C-MUTANT-PER-INSTANCE-KEY turns RED here too: keyed per
  // instance, the replacement's render disconnects the old container's watch.
  // MUTATION GUARD: PH1C-MUTANT-ISCONNECTED-REMOVAL turns RED here too: a
  // detached container is not a removed root, so its watch stays.
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
      'PH1C-MUTANT-PER-INSTANCE-KEY (PH9C-ONE-SHOT-EQUIVALENTS): each container owns its own watch');
    await ph1Frame();
    replacement.ph1Width = 590;
    await ph1Frame();
    await ph9Debounce();
    await ph1Quiet();
    assert(view.renders === 3 && isCompact(replacement) && old.children.length === 1 && !isCompact(old)
      && oldPair.every((observer) => observer.live && observer.thrown.length === 0) && oldPair[0].notifications === 1
      && liveObservers().length === 4 && pendingTimers() === 0,
    'PH1C-MUTANT-ISCONNECTED-REMOVAL (PH9C-ONE-SHOT-EQUIVALENTS): when a new mount container replaces the old one at cold load the new watch re-renders exactly once; the old watch stays on its detached container, notified once and not rendering');
    ph1Collect(old);
    await settled('PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-COLD-LOAD): a new mount container replaces the old one at cold load',
      view, ['wide', 'wide', 'compact'], replacement);
    ph9Discard(replacement);
  }
  // Without a ResizeObserver API an unmeasured render still succeeds and
  // watches nothing; without a MutationObserver API the watch still observes
  // and re-renders once.
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
      'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-COLD-LOAD): without a ResizeObserver API an unmeasured is-mobile render still draws compact and watches nothing');
    ph9Discard(container);
  }
  {
    global.MutationObserver = undefined;
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    assert(liveResize().length === 1 && liveMutation().length === 0,
      'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-COLD-LOAD): without a MutationObserver API the watch still observes');
    await ph1Frame();
    container.ph1Width = 590;
    await ph1Frame();
    await ph9Debounce();
    global.MutationObserver = BrowserLikeMutationObserver;
    await settled('PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-COLD-LOAD): no MutationObserver API, the pane lays out at 590', view, ['wide', 'compact'], container,
      { childLists: 0 });
    ph9Discard(container);
  }

  // ---- PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-NO-LEAK) ----
  // Re-runs into the same container leave exactly one watch, and removing
  // the root disconnects it through the childList record.
  // MUTATION GUARD: PH1C-MUTANT-DISARM-ON-NOTIFICATION-ONLY turns RED at
  // "PH1C-MUTANT-DISARM-ON-NOTIFICATION-ONLY (PH9C-ONE-SHOT-EQUIVALENTS): a
  // root removed after the watch's first notification ..." if the watch sees
  // a removal only at its own notification or timer (no childList watch).
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
    'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-NO-LEAK): 50 Dataview re-runs at clientWidth 0 leave exactly one watch (one resize and one childList observer) after every render');
    container.ph1Width = 590;
    await ph1Frame();
    await ph9Debounce();
    assert(view.renders === 52 && view.renders - view.initiated === 1 && isCompact(container) && liveResize().length === 1 && liveMutation().length === 1,
      'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-NO-LEAK): when the pane lays out at 590 exactly one extra render draws compact and exactly one watch stays live');
    await settled('PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-NO-LEAK): 50 Dataview re-runs at clientWidth 0, then the pane lays out at 590',
      view, [...Array(51).fill('wide'), 'compact'], container);
    ph9Discard(container);
  }
  {
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    const [resize] = liveResize();
    const [watch] = liveMutation();
    assert(resize && watch && resize.notifications === 1 && view.renders === 1,
      'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-NO-LEAK): the watch on the zero-width container has had its first notification');
    container.children[0].remove();
    container.ph1Width = 590;
    await ph1Frame();
    assert(liveObservers().length === 0 && resize.notifications === 1 && watch.deliveries === 1 && view.renders === 1
      && container.children.length === 0 && pendingTimers() === 0,
    'PH1C-MUTANT-DISARM-ON-NOTIFICATION-ONLY (PH9C-ONE-SHOT-EQUIVALENTS): a root removed after the watch\'s first notification disconnects both observers and clears the re-check on the next frame through the childList record, before any resize notification, with no render');
    await settled('PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-NO-LEAK): a root removed after the watch\'s first notification', view, ['wide']);
    ph9Discard(container);
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
    await ph1Clock.advance(300);
    await ph1Drain();
    assert(container.children.length === 1 && isCompact(container) && view.initiated === 2
      && view.renders === 2 && liveResize().length === 1 && pendingTimers() === 0,
    `PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-NO-LEAK): a Dataview re-run and the layout notification in the same frame (${label}) leave one root, compact, no extra render, and one watch`);
    await settled(`PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-NO-LEAK): Dataview re-run and layout in one frame, ${label}`,
      view, ['wide', 'compact'], container);
    ph9Discard(container);
  }
  // MUTATION GUARD: PH1C-MUTANT-PER-INSTANCE-KEY turns RED if the watch is
  // owned per GraphView instance instead of per container: a second
  // container's render would disconnect the first container's watch.
  {
    const view = countingView();
    const first = mountContainer(0);
    const second = mountContainer(0);
    await view.render({ container: first });
    await view.render({ container: second });
    await ph1Frame();
    const owners = liveResize().map((observer) => observer.target);
    assert(liveResize().length === 2 && liveMutation().length === 2 && owners.includes(first) && owners.includes(second),
      'PH1C-MUTANT-PER-INSTANCE-KEY (PH9C-ONE-SHOT-EQUIVALENTS): one shared instance rendering two cold-load containers keeps one watch per container');
    first.ph1Width = 590;
    await ph1Frame();
    await ph9Debounce();
    assert(isCompact(first) && !isCompact(second) && view.renders === 3 && liveResize().length === 2,
      'PH1C-MUTANT-PER-INSTANCE-KEY (PH9C-ONE-SHOT-EQUIVALENTS): the first container re-renders once and the second keeps its watch');
    second.ph1Width = 500;
    await ph1Frame();
    await ph9Debounce();
    await settled('PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-NO-LEAK): one instance, two cold-load containers', view, ['wide', 'wide', 'compact', 'compact'], null,
      { watched: [first, second] });
    assert(isCompact(second), 'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-NO-LEAK): the second container re-renders once when it lays out');
    ph9Discard(first, second);
  }

  // ---- PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-USES-ITS-MEASUREMENT) ----
  // The watch's re-render draws the measurement its debounce resolved
  // without reading the width again.
  // MUTATION GUARD: PH1C-MUTANT-RERENDER-REREADS turns RED if the watch's
  // re-render resolves the width again instead of using its measurement.
  {
    const at500 = await referenceRoot(500);
    const container = mountContainer(500, 500);
    container.ph1ThrowOn = (read) => read === 1;
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    assert(container.ph1Reads === 1 && !isCompact(container) && liveResize().length === 1,
      'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-USES-ITS-MEASUREMENT): the render read throws, resolves unmeasured, draws wide, and watches');
    await ph1Frame();
    await ph1Clock.advance(120);
    await ph1Drain();
    assert(view.renders === 2 && isCompact(container) && JSON.stringify(domShape(container.children[0])) === at500
      && container.ph1Reads === 3,
    'PH1C-MUTANT-RERENDER-REREADS (PH9C-ONE-SHOT-EQUIVALENTS): the notification and the debounce each read 500, and the one extra render draws the 500 compact map from the debounce measurement without reading again');
    await settled('PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-USES-ITS-MEASUREMENT): a width read that throws on the render', view, ['wide', 'compact'], container);
    ph9Discard(container);
  }

  // ---- PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-LATE-ATTACH) ----
  // A container that is not attached yet keeps its watch, and a later attach
  // that lays out converges.
  // MUTATION GUARD: PH1C-MUTANT-ISCONNECTED-REMOVAL turns RED if the watch
  // treats root.isConnected === false as removal.
  {
    const container = mountContainer(0);
    container.offDocument = true;
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    const [resize] = liveResize();
    assert(resize && resize.notifications === 1 && resize.live && liveMutation().length === 1 && view.renders === 1,
      'PH1C-MUTANT-ISCONNECTED-REMOVAL (PH9C-ONE-SHOT-EQUIVALENTS): a container still detached at render keeps its watch through the first frame');
    container.offDocument = false;
    await ph1Frame();
    container.ph1Width = 590;
    await ph1Frame();
    await ph9Debounce();
    assert(view.renders === 2 && isCompact(container) && liveResize().length === 1,
      'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-LATE-ATTACH): attached after the first frame and laid out at 590, the watch re-renders exactly once, compact');
    await settled('PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-LATE-ATTACH): detached at render, attached, laid out at 590', view, ['wide', 'compact'], container);
    ph9Discard(container);
  }
  // A container rendered before it is placed in its note pane watches
  // itself; placed in a 590 pane, it converges to compact, and the
  // re-render watches the pane.
  {
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    const pane = element('div', { cls: 'markdown-preview-view' });
    pane.ph9Pane = true;
    pane.ph9Width = 590;
    pane.ph9InnerNow = () => pane.ph9Width;
    Object.defineProperty(pane, 'offsetWidth', { get() { return pane.ph9Width; } });
    container.parent = pane;
    pane.children.push(container);
    container.ph1Width = 590;
    await ph1Frame();
    await ph9Debounce();
    assert(view.renders === 2 && isCompact(container) && liveResize().length === 1 && liveResize()[0].target === pane,
      'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-LATE-ATTACH): a container rendered before it is placed in a 590 pane re-renders compact once and then watches the pane');
    await settled('PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-LATE-ATTACH): rendered outside its pane, then placed in a 590 pane', view, ['wide', 'compact'], container);
    ph9Discard(pane);
  }
  // A container torn down with its root inside while still 0 wide: the root
  // is still its child, so nothing disconnects and nothing renders; the
  // harness models the detached subtree's collection with ph1Collect.
  {
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    const pair = liveObservers();
    container.remove();
    await ph1Quiet();
    assert(view.renders === 1 && pendingTimers() === 0 && pair.length === 2 && pair.every((observer) => observer.live)
      && pair[0].notifications === 1 && pair[1].deliveries === 0 && pair.every((observer) => observer.target === container),
    'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-LATE-ATTACH): a container torn down with its root inside while still 0 renders nothing and leaves nothing pending; its watch observes only the detached container');
    ph1Collect(container);
    await settled('PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-LATE-ATTACH): torn down while still 0, then collected', view, ['wide']);
  }

  // ---- PH9C-ONE-SHOT-EQUIVALENTS (PH1C-UNMEASURED-RECOVERS) ----
  // PH1B-THROWING-GETTER-DROPS-CROSSING: a width read that throws on the
  // render is unmeasured: it falls through to the is-mobile class, then wide,
  // and the watch's next readable measurement decides. Without is-mobile the
  // measured 500 differs from the drawn wide map and re-renders compact
  // once; on an is-mobile body the unmeasured 390 compact map re-renders
  // once at 500.
  for (const [label, mobile, trace] of [['without is-mobile', false, ['wide', 'compact']], ['on an is-mobile body', true, ['compact', 'compact']]]) {
    ph1MobileClass = mobile;
    const expected = await referenceRoot(500);
    const container = mountContainer(500, 500);
    container.ph1Throws = 1;
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    const [resize] = liveResize();
    assert(container.ph1Throws === 0 && view.renders === 1 && isCompact(container) === mobile
      && liveResize().length === 1 && resize.target === container,
    `PH1B-THROWING-GETTER-DROPS-CROSSING (PH9C-ONE-SHOT-EQUIVALENTS): a clientWidth getter that throws on the render ${label} resolves unmeasured (${trace[0]}) and watches`);
    await ph1Frame();
    await ph9Debounce();
    assert(view.renders === trace.length && isCompact(container) && resize.thrown.length === 0
      && JSON.stringify(domShape(container.children[0])) === expected,
    `PH9C-ONE-SHOT-EQUIVALENTS (PH1C-UNMEASURED-RECOVERS): ${label}, the next notification re-resolves 500 and ends on the re-rendered 500 compact map`);
    await settled(`PH9C-ONE-SHOT-EQUIVALENTS (PH1C-UNMEASURED-RECOVERS): a getter that throws on the render ${label}`, view, trace, container);
    ph1MobileClass = false;
    ph9Discard(container);
  }
  {
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    const [resize] = liveResize();
    await ph1Frame();
    container.ph1Width = 500;
    container.ph1Throws = 1;
    await ph1Frame();
    assert(container.ph1Throws === 0 && resize.notifications === 2 && resize.thrown.length === 0 && resize.live
      && view.renders === 1 && JSON.stringify(pendingDelays()) === JSON.stringify([250]),
    'PH1B-THROWING-GETTER-DROPS-CROSSING (PH9C-ONE-SHOT-EQUIVALENTS): a clientWidth getter that throws inside the notification keeps the drawn map, arms one re-check, and does not throw out of the observer callback');
    await ph1Clock.advance(250);
    await ph1Drain();
    assert(view.renders === 2 && isCompact(container) && resize.disconnected === 1 && liveResize().length === 1,
      'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-UNMEASURED-RECOVERS): the re-check reads 500 and re-renders compact exactly once');
    await settled('PH9C-ONE-SHOT-EQUIVALENTS (PH1C-UNMEASURED-RECOVERS): a getter that throws inside the notification', view, ['wide', 'compact'], container);
    ph9Discard(container);
  }
  {
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    const [resize] = liveResize();
    await ph1Frame();
    await ph1Clock.advance(250);
    view._resolveWidth = () => { throw new Error('resolver fault'); };
    container.ph1Width = 500;
    await ph1Frame();
    delete view._resolveWidth;
    assert(resize.notifications === 2 && resize.thrown.length === 0 && resize.live && view.renders === 1 && pendingTimers() === 0,
      'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-UNMEASURED-RECOVERS): a resolver fault inside the notification is swallowed and the watch keeps observing');
    container.ph1Content = 499.5;
    await ph1Frame();
    await ph9Debounce();
    assert(view.renders === 2 && isCompact(container) && resize.disconnected === 1 && liveResize().length === 1,
      'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-UNMEASURED-RECOVERS): after a swallowed fault the next measured notification re-renders compact exactly once');
    await settled('PH9C-ONE-SHOT-EQUIVALENTS (PH1C-UNMEASURED-RECOVERS): a fault inside the notification', view, ['wide', 'compact'], container);
    ph9Discard(container);
  }

  // ---- PH9C-ONE-SHOT-EQUIVALENTS: the PH1D one-shot branches ----
  // PH1C-SIBLING-CHANGE-KEEPS-ARMED: a sibling added to, then removed from,
  // the container delivers two childList records with the root still a
  // child, so the watch keeps observing, and layout at 590 still re-renders
  // compact exactly once.
  // MUTATION GUARD: PH1D-MUTANT-DISARM-ON-ANY-CHILDLIST turns RED at
  // "PH9C-ONE-SHOT-EQUIVALENTS (PH1C-SIBLING-CHANGE-KEEPS-ARMED): a sibling
  // added ..." if the childList callback disconnects on any record instead of
  // only when the root was removed.
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
    'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-SIBLING-CHANGE-KEEPS-ARMED): a sibling added to and then removed from the container delivers two childList records and the watch keeps observing');
    container.ph1Width = 590;
    await ph1Frame();
    await ph9Debounce();
    assert(view.renders === 2 && view.initiated === 1 && isCompact(container) && resize.notifications === 2
      && liveResize().length === 1,
    'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-SIBLING-CHANGE-KEEPS-ARMED): layout at 590 after the sibling changes still re-renders compact exactly once');
    await settled('PH9C-ONE-SHOT-EQUIVALENTS (PH1C-SIBLING-CHANGE-KEEPS-ARMED): sibling added and removed, then laid out at 590',
      view, ['wide', 'compact'], container);
    ph9Discard(container);
  }
  // PH1C-RESIZE-CALLBACK-REMOVAL: without a MutationObserver API, the root is
  // removed as the pane lays out at 590; the notification that layout brings
  // finds the root gone, disconnects, and renders nothing into the container
  // its root left.
  // MUTATION GUARD: PH1D-MUTANT-RESIZE-IGNORES-REMOVAL turns RED at
  // "PH9C-ONE-SHOT-EQUIVALENTS (PH1C-RESIZE-CALLBACK-REMOVAL): with no
  // MutationObserver API, removing the root ..." if the watch's steps skip
  // the removal check (it would re-resolve 590 and draw a compact root the
  // harness never asked for).
  {
    global.MutationObserver = undefined;
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    const [resize] = liveResize();
    assert(resize && resize.target === container && liveResize().length === 1 && liveMutation().length === 0
      && view.renders === 1 && !isCompact(container),
    'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-RESIZE-CALLBACK-REMOVAL): with no MutationObserver API an unmeasured render watches with the resize observer alone');
    await ph1Frame();
    await ph1Clock.advance(250);
    container.children[0].remove();
    container.ph1Width = 590;
    await ph1Frame();
    await ph1Clock.advance(1000);
    await ph1Drain();
    global.MutationObserver = BrowserLikeMutationObserver;
    assert(resize.notifications === 2 && resize.disconnected === 1 && resize.thrown.length === 0 && view.renders === 1
      && container.children.length === 0 && liveObservers().length === 0,
    'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-RESIZE-CALLBACK-REMOVAL): with no MutationObserver API, removing the root as the pane lays out at 590 notifies the watch, which disconnects and renders nothing');
    await settled('PH9C-ONE-SHOT-EQUIVALENTS (PH1C-RESIZE-CALLBACK-REMOVAL): no MutationObserver API, the root removed as the pane lays out at 590',
      view, ['wide']);
    ph9Discard(container);
  }
  // PH1D-RESIZE-REMOVAL-UNMEASURED (O25): without a MutationObserver API, the
  // root is removed while the pane still measures 0; the pending re-check,
  // and separately a notification, find it gone and disconnect, and nothing
  // renders.
  // MUTATION GUARD: PH1D-MUTANT-REMOVAL-AFTER-MEASURED-RETURN (O25) turns RED
  // at "PH1D-RESIZE-REMOVAL-UNMEASURED (O25): with no MutationObserver API,
  // a root removed while the pane still measures 0 ..." if the removal check
  // moves after the unmeasured return.
  for (const [label, by] of [['its pending re-check', 'recheck'], ['a notification', 'notify']]) {
    global.MutationObserver = undefined;
    const container = mountContainer(0, 240);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    const [resize] = liveResize();
    await ph1Frame();
    if (by === 'notify') await ph1Clock.advance(250);
    container.children[0].remove();
    if (by === 'notify') {
      container.ph1Content = 239;
      await ph1Frame();
    } else {
      await ph1Clock.advance(250);
    }
    global.MutationObserver = BrowserLikeMutationObserver;
    assert(resize && resize.disconnected === 1 && resize.thrown.length === 0 && view.renders === 1
      && container.children.length === 0 && liveObservers().length === 0 && pendingTimers() === 0,
    `PH1D-RESIZE-REMOVAL-UNMEASURED (O25): with no MutationObserver API, a root removed while the pane still measures 0 is found gone by ${label}, which disconnects, and nothing renders`);
    await settled(`PH1D-RESIZE-REMOVAL-UNMEASURED (O25): no MutationObserver API, a root removed while the pane measures 0, seen by ${label}`,
      view, ['wide']);
    ph9Discard(container);
  }
  // PH1D-OBSERVE-FAILURE (O28): when resize.observe() throws, the childList
  // watch already started is disconnected, no observer is live, and a later
  // layout or root removal renders nothing.
  // MUTATION GUARD: PH1D-MUTANT-OBSERVE-FAILURE-KEEPS-ARMED (O28) turns RED
  // at "PH1D-OBSERVE-FAILURE (O28): a resize observe() that throws ..." if the
  // installer's catch stops disconnecting what it started.
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
    assert(refused.length === 1 && refused[0].target === null && watches.length === 1 && watches.every((watch) => watch.disconnected >= 1)
      && liveObservers().length === 0 && view.renders === 1 && !isCompact(container),
    'PH1D-OBSERVE-FAILURE (O28): a resize observe() that throws leaves nothing watching: the childList watch it started is disconnected and no observer is live');
    container.ph1Width = 590;
    await ph1Frame();
    container.children[0].remove();
    await ph1Frame();
    assert(view.renders === 1 && watches.every((watch) => watch.deliveries === 0) && liveObservers().length === 0,
      'PH1D-OBSERVE-FAILURE (O28): after the failed observe() neither a layout at 590 nor removing the root renders or delivers anything');
    await settled('PH1D-OBSERVE-FAILURE (O28): resize observe() throws at cold load', view, ['wide']);
    ph9Discard(container);
  }
  // PH1C-RENDER-START-DISARM: without a MutationObserver API, a watch whose
  // 120ms debounce is pending (its container, which has no querySelector and
  // so keeps its old root, laid out at 590) is replaced by a Dataview re-run
  // of the same container whose lifecycle read is held past the debounce. The re-run disconnects the watch as it starts, so the
  // debounce never fires, and the re-run draws compact once. The same
  // instance also watches a second container.
  // MUTATION GUARD: PH1D-MUTANT-NO-RENDER-START-DISARM turns RED at
  // "PH9C-ONE-SHOT-EQUIVALENTS (PH1C-RENDER-START-DISARM): with no
  // MutationObserver API a Dataview re-run ..." if _renderAtWidth stops
  // disconnecting its container's watch before anything else.
  // MUTATION GUARD: PH1D-MUTANT-OWNERSHIP-PER-INSTALL turns RED at the same
  // label if each install starts a fresh ownership map (the second
  // container's install forgets the first's watch).
  // MUTATION GUARD: PH1D-MUTANT-OWNERSHIP-NOT-RECORDED turns RED at the same
  // label if the installer never records the watch for its container.
  {
    global.MutationObserver = undefined;
    const container = mountContainer(0);
    container.querySelector = undefined;
    const other = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await view.render({ container: other });
    await ph1Frame();
    await ph1Clock.advance(250);
    const stale = liveResize().find((observer) => observer.target === container);
    const otherWatch = liveResize().find((observer) => observer.target === other);
    assert(stale && otherWatch && stale.notifications === 1 && stale.live && liveResize().length === 2 && liveMutation().length === 0
      && view.renders === 2,
    'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-RENDER-START-DISARM): with no MutationObserver API two cold-load containers of one instance each watch with a resize observer alone');
    container.ph1Width = 590;
    await ph1Frame();
    let release = null;
    const held = new Promise((resolve) => { release = resolve; });
    view._lifecycleApi = function heldLifecycleApi(...args) {
      const api = GraphView.prototype._lifecycleApi.apply(this, args);
      return held.then(() => api);
    };
    const rerun = view.render({ container });
    await ph1Clock.advance(200);
    await settle();
    delete view._lifecycleApi;
    release();
    await rerun;
    await ph1Drain();
    global.MutationObserver = BrowserLikeMutationObserver;
    assert(stale.disconnected === 1 && stale.notifications === 2 && liveResize().length === 2 && liveResize().includes(otherWatch)
      && liveMutation().length === 0 && view.renders === 3 && view.initiated === 3 && container.children.length === 2
      && !byClass(container.children[0], 'graph-view-compact').length && byClass(container.children[1], 'graph-view-compact').length === 1,
    'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-RENDER-START-DISARM): with no MutationObserver API a Dataview re-run into a container that keeps its old root disconnects the container\'s watch as it starts, so the pending debounce never fires, and draws compact once (the other container keeps its watch)');
    other.ph1Width = 500;
    await ph1Frame();
    await ph9Debounce();
    assert(isCompact(other) && view.renders === 4,
      'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-RENDER-START-DISARM): the other container still re-renders once when it lays out');
    await settled('PH9C-ONE-SHOT-EQUIVALENTS (PH1C-RENDER-START-DISARM): no MutationObserver API, a held Dataview re-run replaces a watch with a pending debounce while another container is watched',
      view, ['wide', 'wide', 'compact', 'compact'], null, { watched: [container, other], childLists: 1 });
    ph9Discard(container, other);
  }
  // PH1C-ARM-ONLY-WHILE-ATTACHED: two overlapping cold-load renders of one
  // container, the older finishing last (its lifecycle read is held until
  // the newer render has finished and watches). The newer render removed the
  // older root, so when the older render finishes its root is no longer a
  // child of the container: it installs nothing and leaves the newer watch,
  // which re-renders compact once when the pane lays out at 590.
  // MUTATION GUARD: PH1D-MUTANT-ARM-AFTER-REMOVAL turns RED at
  // "PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ARM-ONLY-WHILE-ATTACHED): the older
  // render, finishing last ..." if the installer watches for a root that has
  // already left its container (it would disconnect the newer watch).
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
      && container.children.length === 1 && liveResize().length === 1 && liveResize()[0].target === container
      && liveMutation().length === 1 && liveMutation()[0].target === container && view.trace.length === 1,
    'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ARM-ONLY-WHILE-ATTACHED): the newer overlapping cold-load render finishes first and watches');
    const newerWatch = liveResize()[0];
    releaseOlder();
    await older;
    await ph1Drain();
    assert(view.trace.length === 2 && liveResize().length === 1 && liveResize()[0] === newerWatch && newerWatch.live
      && liveMutation().length === 1 && liveMutation()[0].target === container && container.children[0] === newerRoot,
    'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ARM-ONLY-WHILE-ATTACHED): the older render, finishing last with its root already removed, installs nothing and leaves the newer watch');
    await ph1Frame();
    container.ph1Width = 590;
    await ph1Frame();
    await ph9Debounce();
    assert(view.renders === 3 && view.initiated === 2 && isCompact(container) && liveResize().length === 1,
      'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ARM-ONLY-WHILE-ATTACHED): two overlapping cold-load renders where the older finishes last end compact at 590');
    await settled('PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ARM-ONLY-WHILE-ATTACHED): two overlapping cold-load renders, the older finishing last, then laid out at 590',
      view, ['wide', 'wide', 'compact'], container);
    ph9Discard(container);
  }
  // ---- PH1D-ONE-SHOT-HANDOFF-BOUNDARY ----
  // A cold load of chained slices GA-H1 ... GA-H<R> at clientWidth 0 draws
  // wide and watches. When the pane lays out at a floor boundary, the one
  // re-render draws exactly the measured width (literals from the card
  // formula, as in PH1D-HANDOFF-BOUNDARY):
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
      const [resize] = liveResize();
      await ph1Frame();
      assert(resize && resize.live && resize.notifications === 1 && liveResize().length === 1
        && view.renders === 1 && !isCompact(container),
      `PH1D-ONE-SHOT-HANDOFF-BOUNDARY: a cold load of ${R} chained slices at clientWidth 0 draws wide and keeps watching through the observe() notification`);
      container.ph1Width = W;
      await ph1Frame();
      await ph9Debounce();
      assert.deepStrictEqual({ renders: view.renders, drawing: ph1dCompactDrawing(container.children[0]) },
        { renders: 2, drawing: ph1dExpectedDrawing(colW, lefts, ids, canvasWidth, padding) },
        `PH1D-ONE-SHOT-HANDOFF-BOUNDARY: the pane laid out at ${W} re-renders ${R} chained slices once, as ${colW}px pills with ${ids} ids on a ${canvasWidth}px canvas with a ${padding}px scroller padding-bottom`);
      await settled(`PH1D-ONE-SHOT-HANDOFF-BOUNDARY: ${R} chained slices, cold load, then laid out at ${W}`,
        view, ['wide', 'compact'], container);
      ph9Discard(container);
    }
    global.app = savedAppHandoff;
    global.customJS = savedCustomJSHandoff;
  }
  // ---- PH1D-FRACTIONAL-WIDTH (watch) ----
  // A cold load of chained slices at clientWidth 0 draws wide and watches;
  // the pane then measures a fractional width, and the one re-render draws
  // exactly that width (literals as in the PH1D-FRACTIONAL-WIDTH rows above):
  //   403.5, 5 ranks: 71px pills with short ids, canvas 399, padding 0
  //   393.5, 8 ranks: 40px pills with short ids, canvas 394, padding 14
  //   0.5, 5 ranks: 40px pills with short ids, canvas 244, padding 14
  // MUTATION GUARD: PH1D-MUTANT-ONE-SHOT-HANDS-ROUNDED turns RED at
  // "PH1D-FRACTIONAL-WIDTH: after a cold load, the pane measuring 403.5 ..."
  // if the watch hands its re-render Math.round(fresh.width).
  // MUTATION GUARD: PH1D-MUTANT-ONE-SHOT-HANDS-CEIL turns RED at the same label
  // if it hands Math.ceil(fresh.width).
  // MUTATION GUARD: PH1D-MUTANT-HANDED-WIDTH-ROUNDED turns RED at the same
  // label if the re-render draws Math.round(decided.width).
  // MUTATION GUARD: PH1D-MUTANT-HANDED-WIDTH-CEIL turns RED at the same label
  // if the re-render draws Math.ceil(decided.width).
  // MUTATION GUARD: PH1D-MUTANT-ONE-SHOT-HANDS-FLOOR turns RED at
  // "PH1D-FRACTIONAL-WIDTH: after a cold load, the pane measuring 0.5 ..." if
  // the watch hands its re-render Math.floor(fresh.width).
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
      await ph9Debounce();
      assert.deepStrictEqual({ renders: view.renders, drawing: ph1dCompactDrawing(container.children[0]) },
        { renders: 2, drawing: ph1dExpectedDrawing(colW, lefts, 'short', canvasWidth, padding) },
        `PH1D-FRACTIONAL-WIDTH: after a cold load, the pane measuring ${W} re-renders ${R} chained slices once, as ${colW}px pills with short ids at left ${lefts.join(' ')} on a ${canvasWidth}px canvas with a ${padding}px scroller padding-bottom`);
      await settled(`PH1D-FRACTIONAL-WIDTH: ${R} chained slices, cold load, then measured at ${W}`,
        view, ['wide', 'compact'], container);
      ph9Discard(container);
    }
    global.app = savedAppFractional;
    global.customJS = savedCustomJSFractional;
  }
  // ---- PH1D-ONE-SHOT-SAME-PRESENTATION ----
  // A default-wide cold load whose pane then measures 1024 keeps its root.
  // An is-mobile 390 compact cold load re-renders once when its pane
  // measures: at 390 into a new root of the same DOM, and at 500 into the
  // 500 compact map.
  // MUTATION GUARD: PH1D-MUTANT-SKIP-WIDE-TO-WIDE turns RED at
  // "PH1D-ONE-SHOT-SAME-PRESENTATION: a default-wide cold load ..." if the
  // watch re-renders when the measurement resolves the drawn presentation.
  // MUTATION GUARD: PH1D-MUTANT-SKIP-UNCHANGED-WIDTH turns RED at
  // "PH1D-ONE-SHOT-SAME-PRESENTATION: an is-mobile 390 compact cold load
  // whose pane then measures 390 ..." if a compact map drawn from the
  // unmeasured guess is kept when the measurement equals the guessed width.
  for (const [label, mobile, W, trace] of [
    ['a default-wide cold load whose pane then measures 1024', false, 1024, ['wide']],
    ['an is-mobile 390 compact cold load whose pane then measures 390', true, 390, ['compact', 'compact']],
    ['an is-mobile 390 compact cold load whose pane then measures 500', true, 500, ['compact', 'compact']],
  ]) {
    ph1MobileClass = mobile;
    const expected = await referenceRoot(W);
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    const coldRoot = container.children[0];
    await ph1Frame();
    container.ph1Width = W;
    await ph1Frame();
    await ph9Debounce();
    ph1MobileClass = false;
    const kept = trace.length === 1;
    assert(view.renders === trace.length && container.children.length === 1 && (container.children[0] === coldRoot) === kept
      && !coldRoot.removed === kept && JSON.stringify(domShape(container.children[0])) === expected
      && liveResize().length === 1 && pendingTimers() === 0,
    kept
      ? `PH1D-ONE-SHOT-SAME-PRESENTATION: ${label} re-renders nothing and keeps its root and its watch`
      : `PH1D-ONE-SHOT-SAME-PRESENTATION: ${label} re-renders once, into a new root with the DOM of a ${W} render, and watches`);
    await settled(`PH1D-ONE-SHOT-SAME-PRESENTATION: ${label}`, view, trace, container);
    ph9Discard(container);
  }
  // ---- PH1D-MUTATION-API-NOT-A-FUNCTION ----
  // A MutationObserver global that is a plain object, not a function: a cold
  // load at clientWidth 0 watches with one resize observer on its container
  // and no childList watch, and the pane laying out at 590 re-renders
  // compact once.
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
    const watchingAlone = armed.length === 1 && armed[0].target === container && liveMutation().length === 0;
    await ph1Frame();
    container.ph1Width = 590;
    await ph1Frame();
    await ph9Debounce();
    global.MutationObserver = BrowserLikeMutationObserver;
    assert(watchingAlone, 'PH1D-MUTATION-API-NOT-A-FUNCTION: with a MutationObserver global that is a plain object, a cold load at clientWidth 0 watches with one resize observer on its container and no childList watch');
    assert(view.renders === 2 && isCompact(container) && liveResize().length === 1 && liveMutation().length === 0,
      'PH1D-MUTATION-API-NOT-A-FUNCTION: with that global, the pane laying out at 590 re-renders compact once');
    await settled('PH1D-MUTATION-API-NOT-A-FUNCTION: a plain-object MutationObserver global, cold load, then laid out at 590',
      view, ['wide', 'compact'], container, { childLists: 0 });
    ph9Discard(container);
  }
  // ---- PH1D-CONTAINER-REPLACED ----
  // A cold load into container A (clientWidth 0) draws wide and watches A.
  // dv.container is then replaced by container B, which measures 590, and A
  // gets a 700px box while A's clientWidth still reads 0. The notification
  // on A re-resolves through dv, measures 590, and after the debounce
  // re-renders once, compact, into B; A keeps its wide root, A's watch is
  // disconnected, and B's re-render watches B.
  // MUTATION GUARD: PH1D-MUTANT-FIRE-WITHOUT-DISARM turns RED at
  // "PH1D-CONTAINER-REPLACED: after dv.container is replaced ..." if the
  // watch re-renders without disconnecting itself first.
  // MUTATION GUARD: PH1D-MUTANT-FIRE-DISCONNECTS-RESIZE-ONLY turns RED at the
  // same label if, as it re-renders, the watch disconnects its resize
  // observer and not its childList watch.
  // MUTATION GUARD: PH1D-MUTANT-REMOVAL-AGAINST-CURRENT-CONTAINER turns RED at
  // the same label if removal compares the root's parent with the current
  // dv.container instead of the container it was installed on.
  {
    const first = mountContainer(0);
    const second = mountContainer(590);
    const dv = { container: first };
    const view = countingView();
    await view.render(dv);
    await ph1Drain();
    const coldRoot = first.children[0];
    const [resizeA] = liveResize();
    const [watchA] = liveMutation();
    assert(view.renders === 1 && liveResize().length === 1 && resizeA.target === first
      && liveMutation().length === 1 && watchA.target === first,
    'PH1D-CONTAINER-REPLACED: a cold load into container A watches A with one resize observer and one childList watch');
    await ph1Frame();
    await ph1Clock.advance(250);
    dv.container = second;
    first.ph1Content = 700;
    await ph1Frame();
    await ph9Debounce();
    assert(view.renders === 2 && first.children.length === 1 && first.children[0] === coldRoot && !isCompact(first)
      && second.children.length === 1 && isCompact(second) && !resizeA.live && !watchA.live
      && liveResize().length === 1 && liveResize()[0].target === second && liveMutation().length === 1 && liveMutation()[0].target === second,
    'PH1D-CONTAINER-REPLACED: after dv.container is replaced by container B measuring 590, the notification on A re-renders once, compact, into B, A keeps its wide root, A\'s watch is disconnected, and B is watched');
    await settled('PH1D-CONTAINER-REPLACED: cold load into A, dv.container replaced by B at 590, then A resized',
      view, ['wide', 'compact'], second);
    ph9Discard(first, second);
  }
  // ---- PH1D-ONE-SHOT-AFTER-RENDER-ERROR ----
  // An unmeasured cold load whose render records a render_error still
  // watches. Each fault throws on its first call only:
  //   _applyCrossEpicStubs, without is-mobile: the default-wide render records
  //     it, and the pane measuring 500 re-renders compact once;
  //   _compactGeometry, on an is-mobile body: the 390 compact attempt fails
  //     and the wide fallback records it; the pane measuring 500 re-renders
  //     compact once, and the pane measuring 800 re-renders wide once;
  //   _renderGraph, without is-mobile: the default-wide render records it and
  //     draws no graph, and the pane measuring 500 re-renders compact once.
  // MUTATION GUARD: PH1D-MUTANT-NO-ARM-AFTER-RENDER-ERROR turns RED first at
  // "PH9-LIFECYCLE: a 500 pane whose compact map always fails watches the
  // pane ..." if a render that recorded a render_error watches nothing.
  // MUTATION GUARD: PH1D-MUTANT-ARM-ONLY-WHEN-PRESENTED-OR-WIDE turns RED
  // first at the same label if a narrow render watches only when its compact
  // map was presented.
  // MUTATION GUARD: PH1D-MUTANT-ARM-ONLY-AFTER-DRAWN-GRAPH turns RED at
  // "PH1D-ONE-SHOT-AFTER-RENDER-ERROR: an unmeasured cold load with a wide
  // graph fault ..." if the install runs only after a compact or wide graph
  // drew without throwing.
  for (const [label, method, fault, mobile, W, trace] of [
    ['a cross-epic stub fault without is-mobile', '_applyCrossEpicStubs', 'cross-epic stub fault', false, 500, ['wide', 'compact']],
    ['a compact geometry fault on an is-mobile body', '_compactGeometry', 'compact geometry fault', true, 800, ['wide', 'compact', 'wide']],
    ['a wide graph fault without is-mobile', '_renderGraph', 'wide graph fault', false, 500, ['wide', 'compact']],
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
    const [resize] = liveResize();
    assert(calls === 1 && view.renders === 1 && !isCompact(container)
      && errorRows.length === 1 && errorRows[0].textContent === `GraphView: ${fault}`
      && liveResize().length === 1 && resize.target === container && liveMutation().length === 1 && liveMutation()[0].target === container,
    `PH1D-ONE-SHOT-AFTER-RENDER-ERROR: an unmeasured cold load with ${label} records one render_error row and watches its container`);
    await ph1Frame();
    await ph1Clock.advance(250);
    if (mobile) {
      container.ph1Width = 500;
      await ph1Frame();
      await ph9Debounce();
      assert(view.renders === 2 && isCompact(container) && liveResize().length === 1 && pendingTimers() === 0,
        `PH1D-ONE-SHOT-AFTER-RENDER-ERROR: after ${label}, the pane measuring 500 re-renders compact once`);
    }
    container.ph1Width = W;
    await ph1Frame();
    await ph9Debounce();
    const last = trace[trace.length - 1];
    assert(view.renders === trace.length && isCompact(container) === (last === 'compact') && byClass(container.children[0], 'warning-render-error').length === 0
      && liveResize().length === 1,
    `PH1D-ONE-SHOT-AFTER-RENDER-ERROR: after ${label}, the pane measuring ${W} re-renders ${last} exactly once with no render_error row`);
    await settled(`PH1D-ONE-SHOT-AFTER-RENDER-ERROR: ${label}`, view, trace, container);
    ph9Discard(container);
  }
  // ---- PH1D-ONE-SHOT-SINGLE-OWNER ----
  // A container without querySelector keeps every root drawn into it. Two
  // overlapping cold-load renders of it, the older finishing last (its
  // lifecycle read is held until the newer render has finished and
  // watches): both roots stay children, the older render's install replaces
  // the newer watch, and exactly one watch is live. The pane laying out at
  // 590 re-renders compact once, into a third root.
  // MUTATION GUARD: PH1D-MUTANT-NO-INSTALL-DISARM turns RED at
  // "PH1D-ONE-SHOT-SINGLE-OWNER: two overlapping cold-load renders ..." if an
  // install watches without first disconnecting its container's watch.
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
    const newerWatch = liveResize()[0];
    releaseOlder();
    await older;
    await ph1Drain();
    assert(lifecycleReads === 2 && container.children.length === 2 && container.children[0] === olderRoot
      && container.children[1] === newerRoot && newerWatch && !newerWatch.live && liveResize().length === 1 && liveResize()[0].target === container
      && liveMutation().length === 1 && liveMutation()[0].target === container,
    'PH1D-ONE-SHOT-SINGLE-OWNER: two overlapping cold-load renders of a container without querySelector, the older finishing last, keep both roots and leave exactly one watch, the older render\'s');
    await ph1Frame();
    container.ph1Width = 590;
    await ph1Frame();
    await ph9Debounce();
    assert(view.renders === 3 && container.children.length === 3
      && byClass(container.children[2], 'graph-view-compact').length === 1 && liveResize().length === 1,
    'PH1D-ONE-SHOT-SINGLE-OWNER: the pane laying out at 590 re-renders compact once, into a third root, and one watch stays live');
    await settled('PH1D-ONE-SHOT-SINGLE-OWNER: overlapping cold loads into a container without querySelector, then laid out at 590',
      view, ['wide', 'wide', 'compact'], null, { watched: [container] });
    ph9Discard(container);
  }
  // ---- PH1D-ONE-SHOT-ROOT-MOVED ----
  // A root moved out of its container into another element has left that
  // container: the next frame's childList record disconnects the watch, and
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
    const [resize] = liveResize();
    const elsewhere = element();
    elsewhere.insertBefore(container.children[0], null);
    await ph1Frame();
    assert(resize && resize.disconnected === 1 && liveObservers().length === 0 && pendingTimers() === 0
      && container.children.length === 0 && elsewhere.children.length === 1,
    'PH1D-ONE-SHOT-ROOT-MOVED: a root moved from its container into another element disconnects the watch on the next frame');
    container.ph1Width = 590;
    elsewhere.ph1Width = 700;
    await ph1Frame();
    await ph9Debounce();
    assert(view.renders === 1 && container.children.length === 0,
      'PH1D-ONE-SHOT-ROOT-MOVED: the pane laying out at 590 after the move renders nothing');
    await settled('PH1D-ONE-SHOT-ROOT-MOVED: a root moved into another element', view, ['wide']);
    ph9Discard(container, elsewhere);
  }
  // ---- PH1D-EARLY-RETURN-DISARM ----
  // A render into a watched container disconnects its watch even when that
  // render returns early: RenderSafe finds no page, the scope is unknown, or
  // the scope is project. The early render watches nothing, and the pane
  // laying out at 590 renders nothing more.
  // MUTATION GUARD: PH1D-MUTANT-DISARM-AFTER-PAGE-CHECK turns RED at
  // "PH1D-EARLY-RETURN-DISARM: a render that finds no page ..." if the
  // render-start disconnect moves after the page check.
  // MUTATION GUARD: PH1D-MUTANT-DISARM-AFTER-SCOPE-CHECK turns RED at the
  // same label if the render-start disconnect moves after the scope checks.
  // MUTATION GUARD: PH1D-MUTANT-INSTALL-IN-PROJECT-SCOPE turns RED at
  // "PH1D-EARLY-RETURN-DISARM: a project-scope render ..." if a project-scope
  // render watches.
  for (const [label, overrides, pageless] of [
    ['a render that finds no page', undefined, true],
    ['a render with an unknown scope', { scope: 'elsewhere' }, false],
    ['a project-scope render', { scope: 'project' }, false],
  ]) {
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    const [resize] = liveResize();
    const customJSBefore = global.customJS;
    if (pageless) global.customJS = { ...customJSBefore, RenderSafe: { page: () => null } };
    await view.render({ container }, overrides);
    await ph1Drain();
    global.customJS = customJSBefore;
    assert(resize && resize.disconnected === 1 && liveObservers().length === 0 && pendingTimers() === 0 && view.renders === 2
      && container.children.length === 1,
    `PH1D-EARLY-RETURN-DISARM: ${label} into a watched container disconnects its watch and watches nothing`);
    container.ph1Width = 590;
    await ph1Frame();
    await ph9Debounce();
    assert.strictEqual(view.renders, 2,
      `PH1D-EARLY-RETURN-DISARM: after ${label}, the pane laying out at 590 renders nothing`);
    await settled(`PH1D-EARLY-RETURN-DISARM: ${label}`, view, ['wide', 'wide']);
    ph9Discard(container);
  }
  // ---- PH1D-ONE-SHOT-MEASURED-ONLY ----
  // Only a measured resolution re-renders. An args object whose
  // containerWidth read throws at render and reads 500 afterwards leaves the
  // render unmeasured; the notifications and re-checks after it re-resolve
  // the 500 override, which is not a measurement, so nothing re-renders,
  // even after the pane lays out at 590. Removing the root then disconnects.
  // MUTATION GUARD: PH1D-MUTANT-FIRE-ON-OVERRIDE turns RED at
  // "PH1D-ONE-SHOT-MEASURED-ONLY: two notifications ..." if an override
  // resolution also re-renders.
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
    const [resize] = liveResize();
    await ph1Frame();
    await ph1Clock.advance(250);
    container.ph1Width = 590;
    await ph1Frame();
    await ph1Clock.advance(250);
    await ph1Drain();
    assert(resize && resize.live && resize.notifications === 2 && argReads === 5 && view.renders === 1
      && !isCompact(container) && pendingTimers() === 0,
    'PH1D-ONE-SHOT-MEASURED-ONLY: two notifications and their re-checks that re-resolve a 500 override, before and after the pane lays out at 590, re-render nothing and keep watching');
    container.children[0].remove();
    await ph1Frame();
    await settled('PH1D-ONE-SHOT-MEASURED-ONLY: an override that becomes readable after an unmeasured render, then the root removed',
      view, ['wide']);
    ph9Discard(container);
  }
  // ---- PH1D-ONE-SHOT-KEEPS-ARGS ----
  // The watch re-renders with the args of the render that installed it. A
  // view whose own scope is project, rendered with args { scope: 'epic' } at
  // clientWidth 0, draws the wide epic map and watches; the pane laying out
  // at 590 re-renders the epic map once, compact.
  // MUTATION GUARD: PH1D-MUTANT-RERENDER-DROPS-ARGS turns RED at
  // "PH1D-ONE-SHOT-KEEPS-ARGS: the pane laying out at 590 ..." if the watch
  // re-renders without the args it was installed with.
  {
    const container = mountContainer(0);
    const view = countingView();
    view._scope = 'project';
    await view.render({ container }, { scope: 'epic' });
    await ph1Drain();
    assert(view.renders === 1 && hasGraph(container.children[0]) && !isCompact(container)
      && liveResize().length === 1 && liveMutation().length === 1,
    'PH1D-ONE-SHOT-KEEPS-ARGS: a project-scope view rendered with args { scope: \'epic\' } at clientWidth 0 draws the wide epic map and watches');
    await ph1Frame();
    container.ph1Width = 590;
    await ph1Frame();
    await ph9Debounce();
    assert(view.renders === 2 && isCompact(container) && liveResize().length === 1,
      'PH1D-ONE-SHOT-KEEPS-ARGS: the pane laying out at 590 re-renders the epic map once, compact');
    await settled('PH1D-ONE-SHOT-KEEPS-ARGS: args { scope: \'epic\' } on a project-scope view, cold load, then laid out at 590',
      view, ['wide', 'compact'], container);
    ph9Discard(container);
  }
  // ---- PH1D-ONE-DISARM ----
  // Each watch disconnects exactly once. First, a cold load whose watch
  // re-renders when the pane lays out at 590, then a measured Dataview
  // re-run of the same container: the first watch's resize observer and
  // childList watch each count one disconnect(), and so do the second's.
  // Second, with no MutationObserver API, a removed root found gone by the
  // re-check, followed by a measured re-run of the container at 590, leaves
  // the resize observer's count at one.
  // MUTATION GUARD: PH1D-MUTANT-OWNER-NEVER-DELETED (O22) turns RED at
  // "PH1D-ONE-DISARM: a watch that re-rendered when the pane laid out at 590
  // ..." if disconnecting leaves the container's ownership entry in place.
  // MUTATION GUARD: PH1D-MUTANT-DISARM-AFTER-RERENDER (O32) turns RED at the
  // same label if the watch starts its re-render before disconnecting itself.
  // MUTATION GUARD: PH1D-MUTANT-REMOVAL-DISCONNECTS-RESIZE-ONLY (O57) turns RED
  // at "PH1D-ONE-DISARM: with no MutationObserver API, a removed root ..." if
  // the removal branch disconnects the resize observer instead of the whole
  // watch.
  {
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Frame();
    const [resize] = liveResize();
    const [watch] = liveMutation();
    container.ph1Width = 590;
    await ph1Frame();
    await ph9Debounce();
    const [secondResize] = liveResize();
    const [secondWatch] = liveMutation();
    await view.render({ container });
    await ph1Drain();
    assert(resize && watch && secondResize && secondWatch && secondResize !== resize
      && resize.disconnected === 1 && watch.disconnected === 1 && secondResize.disconnected === 1 && secondWatch.disconnected === 1
      && view.renders === 3 && view.initiated === 2 && isCompact(container) && liveResize().length === 1,
    'PH1D-ONE-DISARM: a watch that re-rendered when the pane laid out at 590, followed by a measured re-run of its container, counts exactly one disconnect() on each observer of both watches');
    await settled('PH1D-ONE-DISARM: cold load, laid out at 590, then a measured re-run', view, ['wide', 'compact', 'compact'], container);
    ph9Discard(container);
  }
  {
    global.MutationObserver = undefined;
    const container = mountContainer(0);
    const view = countingView();
    await view.render({ container });
    await ph1Drain();
    const [resize] = liveResize();
    await ph1Frame();
    container.children[0].remove();
    await ph1Clock.advance(250);
    container.ph1Width = 590;
    await view.render({ container });
    await ph1Drain();
    global.MutationObserver = BrowserLikeMutationObserver;
    assert(resize && resize.notifications === 1 && resize.disconnected === 1 && view.renders === 2 && isCompact(container)
      && liveResize().length === 1 && liveResize()[0] !== resize,
    'PH1D-ONE-DISARM: with no MutationObserver API, a removed root found gone by the re-check, followed by a measured re-run of its container at 590, counts exactly one disconnect() on the resize observer');
    await settled('PH1D-ONE-DISARM: no MutationObserver API, a removed root, then a measured re-run at 590',
      view, ['wide', 'compact'], container, { childLists: 0 });
    ph9Discard(container);
  }
  // ---- PH1D-ROOT-MOVED-DURING-RENDER ----
  // A cold-load render at clientWidth 0 whose lifecycle read is held; while
  // it is held the root is moved into another element. When the render
  // finishes its root's parent is that element, not the container, so it
  // watches nothing, and the pane laying out at 590 renders nothing.
  // MUTATION GUARD: PH1D-MUTANT-ARM-WHEN-ROOT-HAS-A-PARENT (C02) turns RED at
  // "PH1D-ROOT-MOVED-DURING-RENDER: a cold-load root moved into another
  // element while its render awaits ..." if the installer watches whenever
  // the root has any parent.
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
    'PH1D-ROOT-MOVED-DURING-RENDER: a cold-load root moved into another element while its render awaits draws its graph there and watches nothing when the render finishes');
    container.ph1Width = 590;
    elsewhere.ph1Width = 700;
    await ph1Frame();
    await ph9Debounce();
    assert(view.renders === 1 && container.children.length === 0,
      'PH1D-ROOT-MOVED-DURING-RENDER: the pane laying out at 590 after that renders nothing');
    await settled('PH1D-ROOT-MOVED-DURING-RENDER: a root moved into another element while its render awaits', view, ['wide']);
    ph9Discard(container, elsewhere);
  }
  // ---- PH1D-DECIDED-RENDER-DISARMS ----
  // One view whose renders take 200ms of the stubbed clock, and one dv. A
  // cold load into container A watches A. dv.container is replaced by
  // container B, which has no querySelector (so it keeps every root drawn
  // into it), and a cold load into B watches B. When B lays out at 590 and A
  // gets a 700px box in the same frame, both watches arm their debounce, A's
  // first. A's debounce starts a re-render through dv into B, handed its
  // measurement, and that re-render disconnects B's watch as it starts, so
  // B's debounce, due in the same instant, never fires.
  // MUTATION GUARD: PH1D-MUTANT-DECIDED-RENDER-SKIPS-DISARM (C01) turns RED at
  // "PH1D-DECIDED-RENDER-DISARMS: A's watch re-renders once, compact, into
  // B, ..." if a render handed a measurement skips the render-start
  // disconnect.
  {
    const first = mountContainer(0);
    const second = mountContainer(0);
    second.querySelector = undefined;
    const dv = { container: first };
    const view = countingView({ delay: 200 });
    const intoFirst = view.render(dv);
    await ph1Clock.advance(200);
    await intoFirst;
    await ph1Frame();
    dv.container = second;
    const intoSecond = view.render(dv);
    await ph1Clock.advance(200);
    await intoSecond;
    await ph1Frame();
    await ph1Clock.advance(250);
    const [watchA, watchB] = liveResize();
    assert(watchA && watchB && liveResize().length === 2 && watchA.target === first
      && watchB.target === second && liveMutation().length === 2 && view.renders === 2 && pendingTimers() === 0,
    'PH1D-DECIDED-RENDER-DISARMS: cold loads into A and then, through the same dv, into B leave one watch on each');
    second.ph1Width = 590;
    first.ph1Content = 700;
    await ph1Frame();
    assert(JSON.stringify(pendingDelays()) === JSON.stringify([120, 120]),
      'PH1D-DECIDED-RENDER-DISARMS: in that frame both watches arm their debounce');
    await ph1Clock.advance(120);
    await ph1Clock.advance(200);
    await settle();
    await ph1Frame();
    await ph1Clock.advance(1000);
    await settle();
    assert(view.renders === 3 && view.initiated === 2 && watchB.disconnected === 1 && watchB.notifications === 2
      && second.children.length === 2 && byClass(second.children[1], 'graph-view-compact').length === 1
      && liveResize().length === 1 && liveResize()[0].target === second,
    'PH1D-DECIDED-RENDER-DISARMS: A\'s watch re-renders once, compact, into B, and that re-render disconnects B\'s watch as it starts, so nothing else renders');
    await settled('PH1D-DECIDED-RENDER-DISARMS: cold loads into A and B through one dv, then A resized while B lays out at 590',
      view, ['wide', 'wide', 'compact'], null, { watched: [second] });
    ph9Discard(first, second);
  }
  // ---- PH1D-PARTIAL-RENDER-ARMS-NOTHING ----
  // An unmeasured render that throws out of its warnings strip ends in the
  // render-safe catch: its graph is drawn, it watches nothing, and the pane
  // laying out at 590 renders nothing.
  // MUTATION GUARD: PH1D-MUTANT-INSTALL-BEFORE-WARNINGS (O59) turns RED at
  // "PH1D-PARTIAL-RENDER-ARMS-NOTHING: an unmeasured render whose warnings
  // strip throws ..." if the watch is installed before the warnings strip is
  // drawn.
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
      'PH1D-PARTIAL-RENDER-ARMS-NOTHING: an unmeasured render whose warnings strip throws draws its graph and watches nothing');
    container.ph1Width = 590;
    await ph1Frame();
    await ph9Debounce();
    assert(view.renders === 1 && !isCompact(container),
      'PH1D-PARTIAL-RENDER-ARMS-NOTHING: the pane laying out at 590 after that renders nothing');
    await settled('PH1D-PARTIAL-RENDER-ARMS-NOTHING: an unmeasured render whose warnings strip throws', view, ['wide']);
    ph9Discard(container);
  }
  // ---- PH1D-INTERACT-WHILE-ARMED ----
  // A cold load at clientWidth 0 watches; after its first frame the harness
  // interacts with the drawn graph, and then the pane lays out:
  //   without the is-mobile class (wide at 1024), with one of: a tap on the
  //     first chip (its card stays open); a tap on the first chip and then
  //     Close; a tap on the first chip and then Open slice; a canvas tap;
  //     Stuck on and then off; Dim done on. The pane then lays out at 590;
  //   with the is-mobile class (compact at 390), a tap on the first pill (its
  //     card stays open). The pane then measures 800.
  // In each case the view's _disconnectWidthWatch, _renderAtWidth, and
  // _watchPaneWidth are wrapped: each _disconnectWidthWatch call is counted
  // as inside or outside a synchronous run of the other two. The
  // interaction makes no _disconnectWidthWatch call outside them, and the
  // debounce after the layout re-renders the map exactly once, to the
  // measured presentation, leaving one root in the container and one watch
  // (settled() then checks ten quiet seconds).
  // MUTATION GUARD: PH1D-MUTANT-SELECT-DISARMS (T02) turns RED at
  // "PH1D-INTERACT-WHILE-ARMED: a wide cold load, then a tap on the first
  // chip ..." if selecting a node disconnects the container's watch.
  // MUTATION GUARD: PH1D-MUTANT-ONE-SHOT-SKIPS-OPEN-CARD (T01) turns RED at
  // "PH1D-INTERACT-WHILE-ARMED: a wide cold load, then a tap on the first
  // chip, and then the pane laid out at 590 ..." if the watch does not
  // re-render while a card is open.
  // MUTATION GUARD: PH1D-MUTANT-ONE-SHOT-SKIPS-DIMMED (T03) turns RED at the
  // same label if the watch does not re-render while a node is dimmed or a
  // filter is on.
  // MUTATION GUARD: PH1D-MUTANT-RERENDER-KEEPS-ROOT-WITH-CARD (T06) turns RED
  // at the same label if the watch's re-render keeps the previous root when
  // it holds a card.
  // MUTATION GUARD: PH1D-MUTANT-OPEN-CARD-DISARMS-WITHOUT-RERENDER (T07) turns RED
  // at the same label if the watch disconnects without re-rendering while a
  // card is open.
  // MUTATION GUARD: PH1D-MUTANT-DIMMED-DISARMS-WITHOUT-RERENDER (T08) turns RED
  // at the same label if the watch disconnects without re-rendering while a
  // node is dimmed or a filter is on.
  // MUTATION GUARD: PH1D-MUTANT-CLEAR-DISARMS (T04) turns RED at
  // "PH1D-INTERACT-WHILE-ARMED: a wide cold load, then a tap on the first
  // chip and then Close ..." if clearing the selection disconnects the
  // container's watch.
  // MUTATION GUARD: PH1D-MUTANT-OPEN-SLICE-DISARMS (T11) turns RED at
  // "PH1D-INTERACT-WHILE-ARMED: a wide cold load, then a tap on the first
  // chip and then Open slice ..." if Open slice disconnects the container's
  // watch.
  // MUTATION GUARD: PH1D-MUTANT-FILTER-TOGGLE-DISARMS (T05) turns RED at
  // "PH1D-INTERACT-WHILE-ARMED: a wide cold load, then Stuck on and then off
  // ..." if a filter toggle disconnects the container's watch.
  // MUTATION GUARD: PH1D-MUTANT-PILL-TAP-DISARMS (T09) turns RED at
  // "PH1D-INTERACT-WHILE-ARMED: an is-mobile compact cold load, then a tap on
  // the first pill ..." if a pill tap disconnects the container's watch.
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
    for (const name of ['_renderAtWidth', '_watchPaneWidth']) {
      const original = view[name].bind(view);
      view[name] = (...args) => {
        depth += 1;
        try { return original(...args); } finally { depth -= 1; }
      };
    }
    const disconnect = view._disconnectWidthWatch.bind(view);
    view._disconnectWidthWatch = (...args) => {
      sites[depth > 0 ? 'inside' : 'outside'] += 1;
      return disconnect(...args);
    };
    await view.render({ container });
    await ph1Drain();
    await ph1Frame();
    ph1MobileClass = false;
    const watching = liveResize().length;
    const insideBefore = sites.inside;
    act(container.children[0]);
    assert(watching === 1 && insideBefore > 0 && sites.outside === 0 && liveResize().length === 1,
      `PH1D-INTERACT-WHILE-ARMED: ${label}: the interaction leaves the watch live and makes no _disconnectWidthWatch call outside _renderAtWidth and _watchPaneWidth`);
    container.ph1Width = width;
    await ph1Frame();
    await ph9Debounce();
    assert(view.renders === 2 && view.initiated === 1 && container.children.length === 1
      && isCompact(container) === (trace[1] === 'compact') && liveResize().length === 1 && sites.outside === 0,
    `PH1D-INTERACT-WHILE-ARMED: ${label}, and then the pane laid out at ${width}: one re-render draws the ${trace[1]} map, the container holds one root, and one watch is live`);
    await settled(`PH1D-INTERACT-WHILE-ARMED: ${label}, then laid out at ${width}`, view, trace, container);
    ph9Discard(container);
  }
  // ---- PH1D-COMPACT-WIDE-PARITY (width sources) ----
  // ph1dParity.run() (the replay, the parity assertions, and the model
  // anchors) runs on the render() fixture three more times. Each run's wide
  // drawing is render() at a containerWidth override of 1024; its compact
  // drawing is render() with no override, reached through:
  //   a measured clientWidth of 390, which watches its container;
  //   an unmeasured clientWidth of 0 with the is-mobile body class, which
  //     watches its container; after the replay the pane lays out at 800,
  //     and the watch re-renders the map exactly once, wide, leaving one
  //     root and one watch;
  //   a watch re-render: a render at clientWidth 0 without the is-mobile
  //     class draws wide and watches, and when the pane lays out at 390 the
  //     debounce re-renders the map once, compact.
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
  // stubs, compact from a watch re-render at 390, step 1 (tap PA-1 Base):
  // ..." if compact pills drawn by the watch's re-render open their note
  // instead of selecting.
  // MUTATION GUARD: PH1D-MUTANT-HANDOFF-UNREGISTERED (A2) turns RED at the same
  // label if a compact map drawn by the watch's re-render registers no pill.
  // MUTATION GUARD: PH1D-MUTANT-HANDOFF-NO-OUTCOMES (A3) turns RED at the same
  // label if a compact map drawn by the watch's re-render loads no Outcomes.
  // MUTATION GUARD: PH1D-MUTANT-HANDOFF-SOURCE-LOST (A7) turns RED at
  // "PH1D-COMPACT-WIDE-PARITY: render() of six slices and two cross-epic
  // stubs, compact from a watch re-render at 390, step 2 (tap PA-1 Base):
  // ..." if the watch's re-render hands the compact map an empty source
  // path.
  {
    const savedApp = global.app;
    const savedCustomJS = global.customJS;
    let armed = null;
    let mounted = null;
    const drawers = [
      ['a measured clientWidth of 390', async () => {
        const container = mountContainer(390);
        mounted = container;
        await new GraphView({ lifecycleApi, insights: new GraphInsights() }).render({ container });
        assert(isCompact(container) && liveResize().length === 1 && liveResize()[0].target === container,
          'PH1D-COMPACT-WIDE-PARITY: render() with no override at a measured clientWidth of 390 draws the compact map and watches its container');
        return container.children[0];
      }],
      ['an unmeasured clientWidth of 0 with the is-mobile body class', async () => {
        ph1MobileClass = true;
        const container = mountContainer(0);
        mounted = container;
        const view = countingView();
        await view.render({ container });
        await ph1Drain();
        ph1MobileClass = false;
        armed = { container, view };
        assert(isCompact(container) && liveResize().length === 1 && liveResize()[0].target === container,
          'PH1D-COMPACT-WIDE-PARITY: render() with no override at an unmeasured clientWidth of 0 on an is-mobile body draws the compact map and watches its container');
        return container.children[0];
      }],
      ['a watch re-render at 390', async () => {
        const container = mountContainer(0);
        mounted = container;
        const view = countingView();
        await view.render({ container });
        await ph1Drain();
        await ph1Frame();
        container.ph1Width = 390;
        await ph1Frame();
        await ph9Debounce();
        assert(view.renders === 2 && view.initiated === 1 && isCompact(container) && liveResize().length === 1,
          'PH1D-COMPACT-WIDE-PARITY: a render with no override at clientWidth 0 without the is-mobile class, and then the pane laying out at 390, re-render the map once, compact, and keep one watch');
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
        await ph9Debounce();
        assert(armed.view.renders === 2 && armed.view.initiated === 1 && armed.container.children.length === 1
          && !isCompact(armed.container) && hasGraph(armed.container.children[0]),
        'PH1D-COMPACT-WIDE-PARITY: after the replay on the is-mobile compact drawing, the pane laying out at 800 re-renders the map exactly once, wide, and the container holds one root');
        armed = null;
      }
      assert.deepStrictEqual([liveResize().map((observer) => observer.target === mounted), fixture.env.mutations], [[true], []],
        `PH1D-COMPACT-WIDE-PARITY: after the replay on the compact drawing from ${source}, exactly one watch is live, on its container, and no vault mutator ran`);
      ph9Discard(mounted);
    }
    global.app = savedApp;
    global.customJS = savedCustomJS;
  }
  // ---- PH1D-NO-RESIZE-LISTENERS ----
  // With window, visualViewport, and app.workspace.on stubs that record each
  // call: render() at a measured clientWidth of 900, at a containerWidth
  // override of 390, and at an unmeasured clientWidth of 0 whose watch
  // re-renders when the pane lays out at 590, followed by ten quiet seconds,
  // make no call to window.addEventListener, visualViewport.addEventListener,
  // or app.workspace.on.
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
    const measured = mountContainer(900);
    await view.render({ container: measured });
    const pinned = mountContainer(0);
    await view.render({ container: pinned }, { containerWidth: 390 });
    const cold = mountContainer(0);
    await view.render({ container: cold });
    await ph1Drain();
    await ph1Frame();
    cold.ph1Width = 590;
    await ph1Frame();
    await ph9Debounce();
    await settled('PH1D-NO-RESIZE-LISTENERS: a measured 900 render, a 390 override render, and a cold load laid out at 590',
      view, ['wide', 'compact', 'wide', 'compact'], cold, { watched: [measured, cold] });
    if (savedWindow) Object.defineProperty(global, 'window', savedWindow);
    else delete global.window;
    if (savedViewport) Object.defineProperty(global, 'visualViewport', savedViewport);
    else delete global.visualViewport;
    if (savedOn) Object.defineProperty(workspace, 'on', savedOn);
    else delete workspace.on;
    assert.deepStrictEqual(calls, [],
      'PH1D-NO-RESIZE-LISTENERS: render() at a measured 900, at a 390 override, and at an unmeasured 0 whose watch re-renders at 590, then ten quiet seconds, make no call to window.addEventListener, visualViewport.addEventListener, or app.workspace.on');
    ph9Discard(measured, pinned, cold);
  }
  // ---- PH-2: frontier taps while a pane-width debounce is pending ----
  // MUTATION GUARD: PH2-MUTANT-JUMP-CLEARS turns RED at "PH-2: a Root cause
  // jump 60ms into a pending debounce ..." if the jump link clears the
  // selection instead of selecting the root blocker.
  {
    const savedApp = global.app;
    const savedCustomJS = global.customJS;
    ph1dUseEnv(epicEnv({
      dir: 'spice/projects/phone/tasks/Pending Frontier', name: 'Pending Frontier',
      slices: [
        { card: 'GA-PE1 One', status: 'completed' },
        { card: 'GA-PE2 Two', status: 'completed' },
        { card: 'GA-PE3 Three', status: 'parked', resume_condition: 'Resume after review.' },
        { card: 'GA-PE4 Four', status: 'blocked', depends_on: ['[[GA-PE3 Three]]'] },
      ],
    }));
    for (const [what, act] of [
      ['a frontier row tap', (root) => bubblingClick(byClass(root, 'graph-view-frontier-row')[0])],
      ['a done strip tap', (root) => bubblingClick(byClass(root, 'graph-view-frontier-done-strip')[0])],
      ['a Root cause jump', (root) => {
        bubblingClick(byClass(root, 'graph-view-frontier-row').find((row) => byClass(row, 'graph-view-frontier-id')[0]?.textContent === 'GA-PE4'));
        bubblingClick(byClass(root, 'graph-view-detail-root-cause-link')[0]);
      }],
    ]) {
      const { pane, container } = mountPane(700);
      const view = countingView();
      await view.render({ container });
      await ph1Frame();
      pane.ph9Width = 590;
      await ph1Frame();
      await ph1Clock.advance(60);
      const before = container.children[0];
      act(before);
      const tapped = byClass(before, 'graph-view-detail-panel').length + byClass(before, 'graph-view-frontier-done-rows').length;
      const afterTap = pendingDelays();
      const rendersAfterTap = view.renders;
      await ph1Clock.advance(60);
      await ph1Drain();
      assert(tapped === 1 && JSON.stringify(afterTap) === JSON.stringify([120]) && rendersAfterTap === 1 && view.renders === 2
        && isCompact(container) && byClass(container.children[0], 'graph-view-frontier').length === 1,
      `PH-2: ${what} 60ms into a pending debounce leaves one card or the done rows open, re-renders nothing, and leaves the 120ms debounce pending, whose compact re-render draws the frontier list`);
      await settled(`PH-2: ${what} 60ms into a pending debounce`, view, ['wide', 'compact'], container);
      ph9Discard(pane);
    }
    global.app = savedApp;
    global.customJS = savedCustomJS;
  }
  assert.deepStrictEqual([ph1StubViolations, liveObservers().length, pendingTimers()], [[], 0, 0],
    'PH1D-STUB-VIOLATIONS: no observer-stub misuse is recorded at the end of the pane-width fixtures, no observer is live, and no timer is pending');
  global.ResizeObserver = savedResizeObserver;
  global.MutationObserver = savedMutationObserver;
  global.setTimeout = savedSetTimeout;
  global.clearTimeout = savedClearTimeout;
  if (savedGetComputedStyle) Object.defineProperty(global, 'getComputedStyle', savedGetComputedStyle);
  else delete global.getComputedStyle;
  for (const receipt of ph1Receipts) console.log(`PH9C-WATCH ${receipt}`);
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
    'graph-view-scroll', 'graph-view-legend', 'graph-view-frontier', 'graph-view-warnings',
  ];
  const staleRowText = "GV-E Stale: depends on a card that doesn't exist: 'GV-1 GraphLayout pure layout core'";
  const garbledRowText = "GV-F Malformed: slice state unreadable: 'garbled'";
  assert(JSON.stringify(rootChildClasses(chromeWideRoot)) === JSON.stringify(wideChromeClasses)
    && JSON.stringify(chromeWideRoot.children[7].children.map((row) => row.textContent)) === JSON.stringify([staleRowText, garbledRowText]),
  'PH1D-FAILSOFT-CHROME: a wide render of the main fixture at 1024 has the root children divider, label, stuck summary, toolbar, scroller, legend, frontier list, and warning strip, and the strip rows are the GV-E dangling row then the GV-F unreadable row');
  // MUTATION GUARD: PH1D-MUTANT-FAILSOFT-REMOVES-EVERY-CHILD turns RED at
  // "PH1D-FAILSOFT-CHROME: after a compact geometry fault at 390 the root
  // children are ..." if the fail-soft cleanup removes every root child
  // instead of only the compact host.
  for (const [label, failedRoot, fault] of [
    ['geometry fault', failSoftRoot, 'compact geometry fault'],
    ['edge fault', partialRoot, 'compact edge fault'],
  ]) {
    assert.deepStrictEqual(rootChildClasses(failedRoot), wideChromeClasses,
      `PH1D-FAILSOFT-CHROME: after a compact ${label} at 390 the root children are divider, label, stuck summary, toolbar, scroller, legend, frontier list, and warning strip, in the wide render's order`);
    assert(failedRoot.children.slice(0, 7).every((child, index) => JSON.stringify(domShape(child)) === JSON.stringify(domShape(chromeWideRoot.children[index]))),
      `PH1D-FAILSOFT-CHROME: after a compact ${label} at 390 the divider, label, stuck summary, toolbar, scroller, legend, and frontier list have the same DOM as the wide render's`);
    const failedStrip = failedRoot.children[7];
    const failedErrorRows = failedStrip.children.filter((row) => row.className.split(/\s+/).includes('warning-render-error'));
    const stripWithoutErrors = { ...domShape(failedStrip), children: failedStrip.children.filter((row) => !failedErrorRows.includes(row)).map(domShape) };
    assert(JSON.stringify(failedStrip.children.map((row) => row.textContent)) === JSON.stringify([staleRowText, `GraphView: ${fault}`, garbledRowText])
      && failedErrorRows.length === 1 && failedErrorRows[0] === failedStrip.children[1]
      && JSON.stringify(stripWithoutErrors) === JSON.stringify(domShape(chromeWideRoot.children[7])),
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
  const scrollerSource = methodSource('_noteScroller(container)');
  const disconnectSource = methodSource('_disconnectWidthWatch(container)');
  const watchSource = methodSource('_watchPaneWidth(dv, overrides, root, resolved)');
  const renderEntrySource = methodSource('async render(dv, overrides)');
  const renderSource = methodSource('async _renderAtWidth(dv, overrides, decided)');
  assert(resolverSource && scrollerSource && disconnectSource && watchSource && renderEntrySource && renderSource,
    'PH1-SOURCE-SCAN: _resolveWidth, _noteScroller, _disconnectWidthWatch, the watch installer, render, and _renderAtWidth are named methods');
  // PH9B-RESOLVER-SENTINEL (PH9-RESOLVER-SENTINEL-OFFSETWIDTH): the measured
  // width is the scroller's content width read from its computed style (its
  // client width less padding under a stable gutter, otherwise its offset
  // width less borders and padding), with the container's clientWidth as the
  // fallback, read inside one try.
  assert(resolverSource.includes('const scroller = this._noteScroller(container);')
    && resolverSource.includes('? globalThis.getComputedStyle(scroller)')
    && resolverSource.includes('measured = Number(container?.clientWidth);')
    && resolverSource.includes('const padding = px("paddingLeft") + px("paddingRight");')
    && resolverSource.includes('measured = String(style.scrollbarGutter || "").includes("stable")\n            ? Number(scroller.clientWidth) - padding\n            : Number(scroller.offsetWidth) - px("borderLeftWidth") - px("borderRightWidth") - padding;')
    && scrollerSource.includes('container.closest(".markdown-preview-view, .cm-scroller")')
    && !widgetSource.replace(resolverSource, '').includes('clientWidth') && !widgetSource.replace(resolverSource, '').includes('offsetWidth')
    && !widgetSource.replace(resolverSource, '').includes('getComputedStyle')
    && (widgetSource.match(/\.closest\(/g) || []).length === 1 && scrollerSource.includes('.closest('),
  'PH9B-RESOLVER-SENTINEL (PH9-RESOLVER-SENTINEL-OFFSETWIDTH): _resolveWidth measures the content width of dv.container.closest(".markdown-preview-view, .cm-scroller") from its computed style and falls back to dv.container.clientWidth; offsetWidth, clientWidth, and getComputedStyle appear only inside _resolveWidth and .closest( calls appear only inside _noteScroller');
  // PH9D-BOUNDED-WIDTH-CLAIMS: none of the width-comparison phrasings
  // refuted at bbecfb85 appears in the helper or this harness, including
  // across wrapped comment lines.
  {
    const refuted = /at\s+most\s+the\s+scrollbar|exceeds?\s+the\s+(?:mount\s+)?container|border\s+box\s+exceeds|within\s+the\s+scrollbar|over\s+by\s+no\s+more\s+than/i;
    const unwrap = (text) => text.replace(/\n\s*(?:\/\/|\*)?\s*/g, ' ');
    for (const [name, text] of [['graph-view.js', widgetSource], ['run-graph-view.js', fs.readFileSync(__filename, 'utf8')]]) {
      assert(!refuted.test(unwrap(text)),
        `PH9D-BOUNDED-WIDTH-CLAIMS: ${name} carries none of the width-comparison phrasings refuted at bbecfb85`);
    }
  }
  assert(watchSource.includes('globalThis.ResizeObserver') && !widgetSource.replace(watchSource, '').includes('ResizeObserver')
    && watchSource.includes('globalThis.MutationObserver') && !widgetSource.replace(watchSource, '').includes('MutationObserver'),
  'PH1-SOURCE-SCAN: ResizeObserver and MutationObserver appear only inside the watch installer');
  assert(!/matchMedia|\bdv\.current\b|isConnected/.test(widgetSource),
    'PH1-SOURCE-SCAN: no matchMedia, no dv.current, and no isConnected anywhere in graph-view.js');
  assert(disconnectSource.includes('this._widthWatches?.get(container)?.disconnect();')
    && watchSource.includes('resolved.source === "override"')
    && watchSource.includes('const removed = () => root.parentNode !== container;')
    && watchSource.includes('if (removed()) return null;')
    && watchSource.indexOf('if (removed()) return null;') < watchSource.indexOf('this._disconnectWidthWatch(container);')
    && watchSource.includes('const target = this._noteScroller(container) || container;')
    && watchSource.includes('owners.set(container, watch);')
    && watchSource.includes('if (owners.get(container) === watch) owners.delete(container);')
    && watchSource.includes('childList.observe(container, { childList: true });')
    && watchSource.includes('resize.observe(target);')
    && watchSource.includes('const fresh = this._resolveWidth(dv, overrides);')
    && watchSource.includes('watch.disconnect();\n          this._renderAtWidth(dv, overrides, fresh);')
    && (watchSource.match(/\.disconnect\(\)/g) || []).length === 7
    && watchSource.includes('watch?.disconnect();\n      return null;')
    && (watchSource.match(/this\._renderAtWidth\(/g) || []).length === 1
    && (watchSource.match(/new Resize\(/g) || []).length === 1
    && (watchSource.match(/new Mutation\(/g) || []).length === 1
    && !/contentRect|entries|this\.render\(/.test(watchSource)
    && (watchSource.match(/this\._[A-Za-z]+\s*=[^=]/g) || []).join() === 'this._widthWatches = ,this._paneWatches = '
    && (widgetSource.match(/this\._widthWatches\s*=[^=]/g) || []).length === 1,
  'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-NO-LEAK): the watch is owned per container through one _widthWatches map, observes the note scroll container or the mount container, never reads the notification box, removal is root.parentNode !== container seen by a childList watch, and the re-render is handed the measurement the watch resolved');
  assert(renderEntrySource.includes('return this._renderAtWidth(dv, overrides, null);')
    && renderSource.indexOf('this._disconnectWidthWatch(dv && typeof dv === "object" ? dv.container : null);') >= 0
    && renderSource.indexOf('this._disconnectWidthWatch(') < renderSource.indexOf('const RS = globalThis.customJS?.RenderSafe;')
    && renderSource.includes('const resolved = decided && decided.source === "measured" ? decided : this._resolveWidth(dv, overrides);')
    && renderSource.indexOf('const resolved = ') < renderSource.indexOf('previous?.remove?.();')
    && (renderSource.match(/this\._resolveWidth\(/g) || []).length === 1
    && (renderSource.match(/this\._watchPaneWidth\(dv, overrides, root, resolved\);/g) || []).length === 1
    && (widgetSource.match(/this\._watchPaneWidth\(/g) || []).length === 1
    && !/_disarmColdLoad|_installColdLoadObserver|_coldLoads/.test(widgetSource),
  'PH9C-ONE-SHOT-EQUIVALENTS (PH1C-ONE-SHOT-COLD-LOAD): every render disconnects its container\'s watch before reading RenderSafe, resolves the width at most once (not when handed a measurement) before removing the previous root, and is the only caller of the watch installer; the PH-1c one-shot is gone');
  // MUTATION GUARD: PH2-MUTANT-COLOUR-LITERAL turns RED here too if the
  // ready word is drawn in a hex, rgb, or hsl colour literal.
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
  // MUTATION GUARD: PH12B-MUTANT-PROJECT-TOGGLES-44 turns RED at
  // "PH12-WIDE-UNCHANGED: the project toolbar's Stuck toggle ..." if the
  // project scope's toolbar takes the compact 44px min-height.
  for (const [name, className] of [['Stuck', 'graph-view-filter-stuck'], ['Dim done', 'graph-view-filter-done']]) {
    const toggle = byClass(projectToolbar[0], className)[0];
    assert(toggle?.tag === 'button' && toggle.textContent === name
      && toggle.style.cssText === 'min-height:32px;padding:5px 12px;border-radius:999px;cursor:pointer;'
        + 'border:1px solid var(--background-modifier-border);background:var(--background-secondary);',
    `PH12-WIDE-UNCHANGED: the project toolbar's ${name} toggle keeps exactly min-height:32px;padding:5px 12px;border-radius:999px;cursor:pointer; and its border and background`);
  }
  // PH12-WIDE-UNCHANGED: a fresh project-scope render, each chip tapped in
  // turn. Every Open slice and Close button in each card carries exactly
  // min-height:32px;padding:5px 10px;cursor:pointer;, and every link button
  // exactly the pre-PH-12b link declarations.
  // MUTATION GUARD: PH12B-MUTANT-PROJECT-LINKS-44 turns RED at
  // "PH12-WIDE-UNCHANGED: every button in the project-scope cards ..." if
  // the project scope's card links take a 44px min-height.
  // MUTATION GUARD: PH12B-MUTANT-PROJECT-CARD-44 turns RED at the same label
  // if the project scope's Open slice and Close take a 44px min-height.
  {
    const container = element();
    await new GraphView({ scope: 'project' }).render({ container });
    const root = container.children.find((child) => child.className === 'graph-view-root');
    const seen = [];
    for (const chip of byClass(root, 'graph-view-chip')) {
      bubblingClick(chip);
      const panel = byClass(root, 'graph-view-detail-panel')[0];
      if (panel) seen.push(...flatten(panel).filter((node) => node.tag === 'button').map((button) => [button.className, button.style.cssText]));
    }
    const linkCss = 'display:inline-flex;align-items:center;gap:5px;justify-self:start;width:max-content;max-width:100%;'
      + 'padding:3px 8px;border:1px solid var(--background-modifier-border);border-radius:999px;'
      + 'background:var(--background-primary);color:var(--link-color);cursor:pointer;text-align:left;overflow-wrap:anywhere;';
    const expectedCss = (name) => (['graph-view-detail-open', 'graph-view-detail-close'].includes(name)
      ? 'min-height:32px;padding:5px 10px;cursor:pointer;' : linkCss);
    assert(seen.some(([name]) => name === 'graph-view-detail-prerequisite') && seen.some(([name]) => name === 'graph-view-detail-dependent')
      && seen.some(([name]) => name === 'graph-view-detail-open') && seen.some(([name]) => name === 'graph-view-detail-close'),
    'PH12-WIDE-UNCHANGED: the project-scope cards draw Open slice, Close, and prerequisite and dependent link buttons');
    assert.deepStrictEqual(seen, seen.map(([name]) => [name, expectedCss(name)]),
      'PH12-WIDE-UNCHANGED: every button in the project-scope cards carries its exact pre-PH-12b declarations: Open slice and Close min-height:32px;padding:5px 10px;cursor:pointer;, and each link button the link declarations with no min-height');
  }
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
  // PH-2 draws no frontier list and no Root cause row at project scope: the
  // same blocker render with GraphInsights, at rest, with E2-1 (one hop
  // below the root blocker E1-2) selected, and cleared, matches the digests
  // the pre-PH-2 renderer (origin/main at v0.298.0) draws.
  {
    projectFrontmatter.set(e12Path, { ...healthyE12, status: 'blocked' });
    const projectContainer = element();
    await new GraphView({ scope: 'project', insights: realInsights }).render({ container: projectContainer });
    projectFrontmatter.set(e12Path, healthyE12);
    const projectRoot = projectContainer.children[0];
    const projectChipFor = (id) => byClass(projectRoot, 'graph-view-chip')
      .find((chip) => flatten(chip).some((node) => String(node.textContent || '').startsWith(id)));
    const atRest = digestOf(projectRoot);
    bubblingClick(projectChipFor('E2-1'));
    const selected = digestOf(projectRoot);
    const labels = byClass(projectRoot, 'graph-view-detail-label').map((label) => label.textContent);
    bubblingClick(byClass(projectRoot, 'graph-view-canvas')[0]);
    assert.deepStrictEqual([atRest, selected, labels, digestOf(projectRoot), byClass(projectRoot, 'graph-view-frontier').length], [
      '7d83b8437aeddbed7165228b38a0f188a07e9951e6c28cd763eddf2b4f3688b1',
      '428f5b63c00e02d944891af0c00511d8028af2a3c77d26d0bfebbc1e7228eadc',
      ['Unmet prerequisites', 'Outcome', 'Gates'],
      '7d83b8437aeddbed7165228b38a0f188a07e9951e6c28cd763eddf2b4f3688b1',
      0,
    ], 'PH2-ROOT-CAUSE-BLOCK: at project scope the blocker render matches the pre-PH-2 digests at rest, with E2-1 selected (no Root cause row), and cleared, and draws no frontier list');
  }
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
  const panelSource = widgetSource.match(/_panelLink\(parent, node, api, source, className, linkHeight, onActivate\) \{[\s\S]*?\n  \/\/ Stuck filtering/)?.[0] || '';
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

  // ---- PH-2 frontier list (epic scope, both presentations) ----
  const ph2Saved = { app: global.app, customJS: global.customJS };
  const ph2Env = (name, slices, laneOrder = []) => epicEnv({
    dir: `spice/projects/phone/tasks/${name}`, name, slices, laneOrder,
  });
  const ph2Draw = async (env, width, { insights = true, view = null } = {}) => {
    ph1dUseEnv(env);
    if (!insights) delete global.customJS.GraphInsights;
    const container = element();
    await (view || new GraphView({ lifecycleApi })).render({ container }, { containerWidth: width });
    return container.children[0];
  };
  const ph2RowFor = (root, id) => byClass(root, 'graph-view-frontier-row')
    .find((row) => byClass(row, 'graph-view-frontier-id')[0]?.textContent === id);
  const ph2MapNodeFor = (root, id) => byClass(root, 'graph-view-chip').find((chip) => (
    byClass(chip, 'graph-view-pill-id')[0]?.textContent === id
    || byClass(chip, 'graph-view-chip-id')[0]?.textContent === id));
  const ph2Labels = (root) => byClass(root, 'graph-view-frontier-label').map((label) => label.textContent);
  // The Mobile Load Performance shape: seven slices done, GA-ML8 parked,
  // GA-ML9 blocked behind it, and GA-ML10 blocked behind GA-ML9.
  const ph2MlCard = (n) => `GA-ML${n} ${['', 'Bundle audit', 'Image budget', 'Font subset', 'Route split', 'Cache headers',
    'Prefetch hints', 'Worker warmup', 'Device lab rerun', 'Lazy route chunks', 'Cold start budget'][n]}`;
  const ph2MlEnv = () => ph2Env('Mobile Load Performance', [
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ card: ph2MlCard(n), status: 'completed' })),
    { card: ph2MlCard(8), status: 'parked', depends_on: [`[[${ph2MlCard(7)}]]`], resume_condition: 'Resume when the device lab is back online.' },
    { card: ph2MlCard(9), status: 'blocked', depends_on: [`[[${ph2MlCard(8)}]]`] },
    { card: ph2MlCard(10), status: 'blocked', depends_on: [`[[${ph2MlCard(9)}]]`] },
  ], [ph2MlCard(8), ph2MlCard(9), ph2MlCard(10)]);
  // The Dataview shape: three slices done, one in progress, one queued
  // behind it.
  const ph2DvEnv = () => ph2Env('Dataview Indexing', [
    { card: 'GA-DV1 Field index', status: 'completed' },
    { card: 'GA-DV2 Inline fields', status: 'completed' },
    { card: 'GA-DV3 Task index', status: 'completed', depends_on: ['[[GA-DV2 Inline fields]]'] },
    { card: 'GA-DV4 Query cache', status: 'in_progress', depends_on: ['[[GA-DV3 Task index]]'] },
    { card: 'GA-DV5 Cache eviction', status: 'planning', depends_on: ['[[GA-DV4 Query cache]]'] },
  ], ['GA-DV4 Query cache', 'GA-DV5 Cache eviction']);
  // The Perf shape: every slice done.
  const ph2PerfEnv = () => ph2Env('Perf Budget', [
    { card: 'GA-PF1 Baseline trace', status: 'completed' },
    { card: 'GA-PF2 Paint budget', status: 'completed', depends_on: ['[[GA-PF1 Baseline trace]]'] },
    { card: 'GA-PF3 Script budget', status: 'completed', depends_on: ['[[GA-PF1 Baseline trace]]'] },
    { card: 'GA-PF4 Budget gate', status: 'completed', depends_on: ['[[GA-PF2 Paint budget]]', '[[GA-PF3 Script budget]]'] },
  ]);
  // Every GraphInsights group, then Done, at once. laneOrder names GA-AG6
  // before GA-AG7, and GA-AG7 is drawn first.
  const ph2AgEnv = () => ph2Env('Frontier Groups', [
    { card: 'GA-AG1 Schema', status: 'completed' },
    { card: 'GA-AG2 Review gate', status: 'parked', resume_condition: 'Resume after the design review.' },
    { card: 'GA-AG3 Migration', status: 'blocked', depends_on: ['[[GA-AG2 Review gate]]'] },
    { card: 'GA-AG4 Importer', status: 'in_progress', depends_on: ['[[GA-AG1 Schema]]'] },
    { card: 'GA-AG5 Backfill', status: 'planning', depends_on: ['[[GA-AG4 Importer]]'] },
    { card: 'GA-AG6 Exporter', status: 'planning', depends_on: ['[[GA-AG1 Schema]]'] },
    { card: 'GA-AG7 Docs', status: 'planning' },
  ], ['GA-AG6 Exporter', 'GA-AG7 Docs']);
  const ph2Envs = [];
  const ph2Track = (env) => { ph2Envs.push(env); return env; };

  // ---- PH2-GROUPS-EXACT (FL3-TRIAGE-COUNTS) ----
  // MUTATION GUARD: PH2-MUTANT-GROUPS-REORDERED turns RED at
  // "PH2-GROUPS-EXACT: Frontier Groups ..." if Blocked is drawn before In
  // progress.
  // MUTATION GUARD: PH2-MUTANT-EMPTY-GROUP-DRAWN turns RED at
  // "PH2-GROUPS-EXACT: Mobile Load Performance ..." if a group with no rows
  // is drawn.
  // MUTATION GUARD: PH2-MUTANT-BLOCKED-BY-LAST-CAUSE turns RED at
  // "PH2-GROUPS-EXACT: multiple root causes ..." if a Blocked row names its
  // last root cause.
  for (const width of [390, 1024]) {
    const ml = await ph2Draw(ph2Track(ph2MlEnv()), width);
    assert.deepStrictEqual(ph2Read(ml), {
      groups: [
        ['graph-view-frontier-group frontier-needs-you', 'Needs you 1',
          ['GA-ML8', '⚑ waiting', null, 'Resume when the device lab is back online.']],
        ['graph-view-frontier-group frontier-blocked', 'Blocked 2',
          ['GA-ML9', 'blocked', null, 'blocked by GA-ML8 · 1 hop up'],
          ['GA-ML10', 'blocked', null, 'blocked by GA-ML8 · 2 hops up']],
        ['graph-view-frontier-group frontier-done', null],
      ],
      shipped: [],
      strip: ['7 done · show'],
    }, `PH2-GROUPS-EXACT: Mobile Load Performance at ${width}: Needs you 1, Blocked 2, and the folded 7 done strip, and no other group`);
    assert.deepStrictEqual(['GA-ML9', 'GA-ML10'].map((id) => {
      const row = ph2RowFor(ml, id);
      return `${byClass(row, 'graph-view-frontier-id')[0].textContent} ${byClass(row, 'graph-view-frontier-wait')[0].textContent}`;
    }), ['GA-ML9 blocked by GA-ML8 · 1 hop up', 'GA-ML10 blocked by GA-ML8 · 2 hops up'],
    `PH2-GROUPS-EXACT: Mobile Load Performance at ${width}: the Blocked rows read GA-ML9 blocked by GA-ML8 · 1 hop up and GA-ML10 blocked by GA-ML8 · 2 hops up`);
    const dv = await ph2Draw(ph2Track(ph2DvEnv()), width);
    assert.deepStrictEqual(ph2Read(dv), {
      groups: [
        ['graph-view-frontier-group frontier-in-progress', 'In progress 1', ['GA-DV4', 'in progress', null, null]],
        ['graph-view-frontier-group frontier-queued', 'Queued 1', ['GA-DV5', 'planning', null, 'after GA-DV4']],
        ['graph-view-frontier-group frontier-done', null],
      ],
      shipped: [],
      strip: ['3 done · show'],
    }, `PH2-GROUPS-EXACT: Dataview at ${width}: In progress 1 and Queued 1 (after GA-DV4), no Next up, and the folded 3 done strip`);
    const perf = await ph2Draw(ph2Track(ph2PerfEnv()), width);
    assert.deepStrictEqual(ph2Read(perf), {
      groups: [['graph-view-frontier-group frontier-done', null]],
      shipped: ['Everything shipped'],
      strip: ['4 done · show'],
    }, `PH2-GROUPS-EXACT: Perf at ${width}: no group but Done, the folded 4 done strip, and the line Everything shipped`);
    const ag = await ph2Draw(ph2Track(ph2AgEnv()), width);
    assert.deepStrictEqual(ph2Read(ag), {
      groups: [
        ['graph-view-frontier-group frontier-needs-you', 'Needs you 1',
          ['GA-AG2', '⚑ waiting', null, 'Resume after the design review.']],
        ['graph-view-frontier-group frontier-next', 'Next up 1', ['GA-AG6', 'planning', 'next', null]],
        ['graph-view-frontier-group frontier-in-progress', 'In progress 1', ['GA-AG4', 'in progress', null, null]],
        ['graph-view-frontier-group frontier-blocked', 'Blocked 1', ['GA-AG3', 'blocked', null, 'blocked by GA-AG2 · 1 hop up']],
        ['graph-view-frontier-group frontier-ready', 'Ready 1', ['GA-AG7', 'planning', 'ready', null]],
        ['graph-view-frontier-group frontier-queued', 'Queued 1', ['GA-AG5', 'planning', null, 'after GA-AG4']],
        ['graph-view-frontier-group frontier-done', 'Done 1', ['GA-AG1', 'done', null, null]],
      ],
      shipped: [],
      strip: [],
    }, `PH2-GROUPS-EXACT: Frontier Groups at ${width}: Needs you, Next up, In progress, Blocked, Ready, Queued, then Done listed under its label`);
    assert.deepStrictEqual(byClass(ag, 'graph-view-chip').map((chip) => (byClass(chip, 'graph-view-pill-id')[0] || byClass(chip, 'graph-view-chip-id')[0]).textContent),
      ['GA-AG7', 'GA-AG1', 'GA-AG2', 'GA-AG6', 'GA-AG3', 'GA-AG4', 'GA-AG5'],
      `PH2-GROUPS-EXACT: Frontier Groups at ${width}: the map draws GA-AG7 first and GA-AG6 after it`);
    const ids = byClass(ag, 'graph-view-frontier-row').map((row) => byClass(row, 'graph-view-frontier-title')[0].textContent);
    assert.deepStrictEqual(ids, ['Review gate', 'Exporter', 'Importer', 'Migration', 'Docs', 'Backfill', 'Schema'],
      `PH2-GROUPS-EXACT: Frontier Groups at ${width}: each row's title text is its slice title`);
  }
  // Multiple root causes: GA-MR3 is blocked behind the parked GA-MR1 and the
  // blocked GA-MR2, each a root blocker; its row names the first one
  // GraphInsights lists.
  {
    const env = ph2Track(ph2Env('Many Roots', [
      { card: 'GA-MR1 Vendor', status: 'parked', resume_condition: 'Resume after the vendor call.' },
      { card: 'GA-MR2 Legal', status: 'blocked' },
      { card: 'GA-MR3 Launch', status: 'blocked', depends_on: ['[[GA-MR2 Legal]]', '[[GA-MR1 Vendor]]'] },
    ]));
    const root = await ph2Draw(env, 1024);
    assert.deepStrictEqual(ph2Read(root).groups, [
      ['graph-view-frontier-group frontier-needs-you', 'Needs you 1', ['GA-MR1', '⚑ waiting', null, 'Resume after the vendor call.']],
      ['graph-view-frontier-group frontier-blocked', 'Blocked 2',
        ['GA-MR2', 'blocked', null, null],
        ['GA-MR3', 'blocked', null, 'blocked by GA-MR1 · 1 hop up']],
    ], 'PH2-GROUPS-EXACT: multiple root causes: a blocked root blocker with nothing to wait on has no wait line, and GA-MR3 names its first root cause, GA-MR1');
  }
  // A card name with no id: the parked root blocker "Vendor sign-off" has
  // no id, GA-V2 is blocked behind it, and GA-V3 is planned behind it.
  // MUTATION GUARD: PH2-MUTANT-BLOCKED-ID-NO-FALLBACK turns RED at
  // "PH2-GROUPS-EXACT: Idless Roots ..." if the Blocked row names a root
  // blocker that has no id by its id alone.
  // MUTATION GUARD: PH2-MUTANT-AFTER-ID-NO-FALLBACK turns RED at the same
  // label if the Queued row names a prerequisite that has no id by its id
  // alone.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2Env('Idless Roots', [
      { card: 'Vendor sign-off', status: 'parked', resume_condition: 'Resume after the vendor call.' },
      { card: 'GA-V2 Launch', status: 'blocked', depends_on: ['[[Vendor sign-off]]'] },
      { card: 'GA-V3 Docs', status: 'planning', depends_on: ['[[Vendor sign-off]]'] },
    ])), width);
    assert.deepStrictEqual(ph2Read(root).groups.map((group) => group.slice(1)), [
      ['Needs you 1', [null, '⚑ waiting', null, 'Resume after the vendor call.']],
      ['Blocked 1', ['GA-V2', 'blocked', null, 'blocked by Vendor sign-off · 1 hop up']],
      ['Queued 1', ['GA-V3', 'planning', null, 'after Vendor sign-off']],
    ], `PH2-GROUPS-EXACT: Idless Roots at ${width}: the Blocked row reads blocked by Vendor sign-off · 1 hop up and the Queued row reads after Vendor sign-off, naming the id-less card by its whole name`);
  }
  // A planning slice queued behind a cross-epic stub, drawn through
  // render(): GA-CQ2 depends on GA-OX1, a slice in the Other Ops epic.
  // MUTATION GUARD: PH2-MUTANT-WIDE-RETURNS-NO-STUBS turns RED at
  // "PH2-GROUPS-EXACT: Cross Queue at 1024 ..." if _renderGraph hands the
  // list its nodes without the cross-epic stubs.
  // MUTATION GUARD: PH2-MUTANT-COMPACT-RETURNS-NO-STUBS turns RED at
  // "PH2-GROUPS-EXACT: Cross Queue at 390 ..." if _renderCompactMap hands
  // the list its nodes without the cross-epic stubs.
  for (const width of [390, 1024]) {
    const env = ph2Track(ph2Env('Cross Queue', [
      { card: 'GA-CQ1 Base', status: 'completed' },
      { card: 'GA-CQ2 Consumer', status: 'planning', depends_on: ['[[GA-OX1 Upstream]]'] },
    ]));
    const otherPath = 'spice/projects/phone/tasks/Other Ops/board/GA-OX1 Upstream.md';
    env.app.vault.getMarkdownFiles().push(file(otherPath, 99));
    const ownCache = env.app.metadataCache.getFileCache;
    env.app.metadataCache.getFileCache = (entry) => (entry.path === otherPath
      ? { frontmatter: { type: 'slice', status: 'in_progress' } }
      : ownCache(entry));
    const root = await ph2Draw(env, width);
    assert.deepStrictEqual([byClass(root, 'graph-view-stub').length, ph2Read(root)], [1, {
      groups: [
        ['graph-view-frontier-group frontier-queued', 'Queued 1', ['GA-CQ2', 'planning', null, 'after GA-OX1']],
        ['graph-view-frontier-group frontier-done', null],
      ],
      shipped: [],
      strip: ['1 done · show'],
    }], `PH2-GROUPS-EXACT: Cross Queue at ${width}: render() draws one cross-epic stub, and GA-CQ2 lists under Queued with the wait line after GA-OX1`);
  }
  // FL3-TRIAGE-COUNTS: the Needs you and Blocked labels show GraphInsights'
  // summary counts, not the number of rows drawn under them.
  // MUTATION GUARD: PH2-MUTANT-NEEDS-YOU-COUNTS-ROWS turns RED at
  // "PH2-GROUPS-EXACT (FL3-TRIAGE-COUNTS): ..." if the Needs you label
  // counts its rows.
  // MUTATION GUARD: PH2-MUTANT-BLOCKED-COUNTS-ROWS turns RED at the same
  // label if the Blocked label counts its rows.
  // MUTATION GUARD: PH2-MUTANT-SUMMARY-SWAPPED turns RED at the same label
  // if the two summary fields are read the other way round.
  {
    const triage = {
      analyzeGraph(nodes, edges) {
        const analysis = new GraphInsights().analyzeGraph(nodes, edges);
        return { ...analysis, summary: { ...analysis.summary, needsYouCount: 7, blockedCount: 9 } };
      },
    };
    for (const width of [390, 1024]) {
      const root = await ph2Draw(ph2Track(ph2MlEnv()), width, { view: new GraphView({ lifecycleApi, insights: triage }) });
      assert.deepStrictEqual(ph2Labels(root), ['Needs you 7', 'Blocked 9'],
        `PH2-GROUPS-EXACT (FL3-TRIAGE-COUNTS): at ${width} the Needs you and Blocked labels read GraphInsights' needsYouCount 7 and blockedCount 9 over one parked and two blocked rows`);
    }
    const real = new GraphInsights().analyzeGraph(
      [{ card: 'A', status: 'parked' }, { card: 'B', status: 'blocked' }, { card: 'C', status: 'blocked' }], []);
    assert.deepStrictEqual([real.summary.needsYouCount, real.summary.blockedCount], [1, 2],
      'PH2-GROUPS-EXACT (FL3-TRIAGE-COUNTS): GraphInsights counts one parked and two blocked records');
    for (const [label, bad] of [['not a number', 'many'], ['missing', undefined], ['a numeric string', '7'], ['not finite', Infinity]]) {
      const odd = { analyzeGraph(nodes, edges) {
        const analysis = new GraphInsights().analyzeGraph(nodes, edges);
        return { ...analysis, summary: { ...analysis.summary, needsYouCount: bad, blockedCount: bad } };
      } };
      const root = await ph2Draw(ph2Track(ph2MlEnv()), 1024, { view: new GraphView({ lifecycleApi, insights: odd }) });
      assert.deepStrictEqual(ph2Labels(root), ['Needs you 1', 'Blocked 2'],
        `PH2-GROUPS-EXACT (FL3-TRIAGE-COUNTS): a summary count that is ${label} falls back to the rows drawn`);
    }
    const listSource = methodSource('_renderFrontierList(root, nodes, analysis, laneOrder, options)');
    assert(listSource.includes('summaryCount("needsYouCount")') && listSource.includes('summaryCount("blockedCount")')
      && !/\.(?:stuckCount|readyCount|gatedTotal|rootBlockers)\b|"(?:stuckCount|readyCount|gatedTotal|rootBlockers)"/.test(listSource)
      && !/upstream|downstream|\bqueue\b|\bvisited\b/.test(listSource),
    'PH2-GROUPS-EXACT (FL3-TRIAGE-COUNTS): _renderFrontierList reads needsYouCount and blockedCount from the summary, reads no other summary count, and walks no upstream or downstream closure');
  }

  // ---- PH2-NEXT-UP-RULE (FL2-NEXT-UP-BADGE, FL2-READY-MARKER, FL2-NO-MARKER-ON-NON-READY) ----
  // Direct calls over hand-built nodes, with GraphInsights' analysis unless
  // a case hands in its own.
  // MUTATION GUARD: PH2-MUTANT-NEXT-BY-DRAW-ORDER turns RED at
  // "PH2-NEXT-UP-RULE: laneOrder [Y, X] ..." if Next up is the first ready
  // slice in draw order while laneOrder is non-empty.
  // MUTATION GUARD: PH2-MUTANT-NEXT-FIRST-LANE-ENTRY turns RED at
  // "PH2-NEXT-UP-RULE: laneOrder [C, B] ..." if Next up is the first laneOrder
  // entry whether or not it is ready.
  // MUTATION GUARD: PH2-MUTANT-NO-DRAW-ORDER-FALLBACK turns RED at
  // "PH2-NEXT-UP-RULE: laneOrder [GA-Z9] ..." if a laneOrder naming no ready
  // slice leaves Next up empty.
  // MUTATION GUARD: PH2-MUTANT-BADGE-EVERY-READY turns RED at
  // "PH2-NEXT-UP-RULE: empty laneOrder ..." if every ready row carries the
  // next badge.
  // MUTATION GUARD: PH2-MUTANT-MARK-NON-READY turns RED at
  // "PH2-NEXT-UP-RULE (FL2-NO-MARKER-ON-NON-READY): ..." if a Queued row
  // carries the ready word.
  // MUTATION GUARD: PH2-MUTANT-READY-INCLUDES-IN-PROGRESS turns RED at
  // "PH2-NEXT-UP-RULE: an in-progress slice ..." if a ready in-progress slice
  // can be Next up.
  // MUTATION GUARD: PH2-MUTANT-READY-IGNORES-INSIGHTS turns RED at
  // "PH2-NEXT-UP-RULE: laneOrder [C, B] ..." if every planning slice counts
  // as ready.
  const ph2Node = (card, status, extra = {}) => ({ card, status, path: `spice/x/${card}.md`, rank: 0, row: 0, ...extra });
  const ph2Depends = (from, to) => ({ from, to, kind: 'depends' });
  const ph2List = (nodes, edges, laneOrder, options = {}) => {
    const { analysis, select = null, view = null } = options;
    const scope = Object.prototype.hasOwnProperty.call(options, 'scope') ? options.scope : 'epic';
    const root = element();
    const drawn = (view || new GraphView({ dashboard, lifecycleApi }))._renderFrontierList(root, nodes,
      analysis === undefined ? new GraphInsights().analyzeGraph(nodes, edges) : analysis, laneOrder,
      { scope, api: lifecycleApi, source: 'spice/x/Epic.md', select, edges });
    return { root, drawn };
  };
  {
    const I = ph2Node('GA-I Running', 'in_progress');
    const C = ph2Node('GA-C Waits on I', 'planning');
    const B = ph2Node('GA-B Free', 'planning');
    const { root } = ph2List([I, C, B], [ph2Depends(I.card, C.card)], [C.card, B.card]);
    assert.deepStrictEqual(ph2Read(root).groups.map((group) => group.slice(1)), [
      ['Next up 1', ['GA-B', 'planning', 'next', null]],
      ['In progress 1', ['GA-I', 'in progress', null, null]],
      ['Queued 1', ['GA-C', 'planning', null, 'after GA-I']],
    ], 'PH2-NEXT-UP-RULE: laneOrder [C, B] with B the one ready planning slice: B is the one Next up row and C queues after GA-I');
    const X = ph2Node('GA-X First', 'planning');
    const Y = ph2Node('GA-Y Second', 'planning');
    for (const [label, laneOrder, expected] of [
      ['empty laneOrder', [], [['Next up 1', ['GA-X', 'planning', 'next', null]], ['Ready 1', ['GA-Y', 'planning', 'ready', null]]]],
      ['laneOrder [Y, X]', [Y.card, X.card], [['Next up 1', ['GA-Y', 'planning', 'next', null]], ['Ready 1', ['GA-X', 'planning', 'ready', null]]]],
      ['laneOrder [GA-Z9]', ['GA-Z9 Elsewhere'], [['Next up 1', ['GA-X', 'planning', 'next', null]], ['Ready 1', ['GA-Y', 'planning', 'ready', null]]]],
      ['laneOrder that is not an array', 'GA-Y Second', [['Next up 1', ['GA-X', 'planning', 'next', null]], ['Ready 1', ['GA-Y', 'planning', 'ready', null]]]],
      ['laneOrder [X, Y, X]', [X.card, Y.card, X.card], [['Next up 1', ['GA-X', 'planning', 'next', null]], ['Ready 1', ['GA-Y', 'planning', 'ready', null]]]],
      ['laneOrder [GA-Z9, Y, X]', ['GA-Z9 Elsewhere', Y.card, X.card], [['Next up 1', ['GA-Y', 'planning', 'next', null]], ['Ready 1', ['GA-X', 'planning', 'ready', null]]]],
    ]) {
      const { root: drawnRoot } = ph2List([X, Y], [], laneOrder);
      assert.deepStrictEqual(ph2Read(drawnRoot).groups.map((group) => group.slice(1)), expected,
        `PH2-NEXT-UP-RULE: ${label}: the expected slice is the one Next up row (FL2-NEXT-UP-BADGE) and the other ready slice lists under Ready with the ready word (FL2-READY-MARKER)`);
    }
    const Z = ph2Node('GA-Z Third', 'planning');
    const { root: threeReady } = ph2List([X, Y, Z], [], [Z.card]);
    assert.deepStrictEqual(ph2Read(threeReady).groups.map((group) => group.slice(1)), [
      ['Next up 1', ['GA-Z', 'planning', 'next', null]],
      ['Ready 2', ['GA-X', 'planning', 'ready', null], ['GA-Y', 'planning', 'ready', null]],
    ], 'PH2-NEXT-UP-RULE: three ready slices with laneOrder [Z]: Z is Next up and X then Y list under Ready in draw order');
    const P = ph2Node('GA-P Done', 'completed');
    const R = ph2Node('GA-R Running', 'in_progress');
    const { root: inProgressReady } = ph2List([P, R], [ph2Depends(P.card, R.card)], [R.card]);
    assert.deepStrictEqual(ph2Read(inProgressReady).groups.map((group) => group.slice(1)), [
      ['In progress 1', ['GA-R', 'in progress', null, null]],
      [null],
    ], 'PH2-NEXT-UP-RULE: an in-progress slice that GraphInsights marks ready lists under In progress with no marker, and no Next up or Ready group is drawn');
    assert.strictEqual(new GraphInsights().analyzeGraph([P, R], [ph2Depends(P.card, R.card)]).perNode[R.card].isReady, true,
      'PH2-NEXT-UP-RULE: GraphInsights marks that in-progress slice ready');
    const { root: noneReady } = ph2List([I, C], [ph2Depends(I.card, C.card)], [C.card]);
    assert(ph2Labels(noneReady).every((label) => !/^(?:Next up|Ready) /.test(label))
      && byClass(noneReady, 'graph-view-frontier-next').length === 0 && byClass(noneReady, 'graph-view-frontier-ready').length === 0,
    'PH2-NEXT-UP-RULE: zero ready slices draw neither Next up nor Ready and no marker');
  }
  // MUTATION GUARD: PH2-MUTANT-READY-TRUTHY turns RED at "PH2-NEXT-UP-RULE:
  // per-node analysis with isReady "true" ..." if a truthy isReady other
  // than true counts as ready.
  {
    const nodes = [ph2Node('GA-X First', 'planning'), ph2Node('GA-Y Second', 'planning')];
    for (const [label, isReady] of [['without isReady', undefined], ['with isReady "true"', 'true'], ['with isReady 1', 1]]) {
      const real = new GraphInsights().analyzeGraph(nodes, []);
      const perNode = Object.fromEntries(Object.entries(real.perNode).map(([card, entry]) => [card, { ...entry, isReady }]));
      const { root } = ph2List(nodes, [], [], { analysis: { ...real, perNode } });
      assert.deepStrictEqual(ph2Read(root).groups.map((group) => group.slice(1)), [
        ['Queued 2', ['GA-X', 'planning', null, null], ['GA-Y', 'planning', null, null]],
      ], `PH2-NEXT-UP-RULE: per-node analysis ${label} marks no slice ready, so both queue and neither Next up nor Ready is drawn`);
    }
  }
  // FL2-NO-MARKER-ON-NON-READY: a stub, a parked, a blocked, an
  // in-progress, a completed, a null-status, and an unrecognized slice,
  // beside one ready slice and one after the stub.
  {
    const done = ph2Node('GA-N1 Done', 'completed');
    const nodes = [
      ph2Node('GA-N0 Other epic', null, { isStub: true, stubLabel: 'Other · GA-N0' }),
      done,
      ph2Node('GA-N2 Parked', 'parked'),
      ph2Node('GA-N3 Blocked', 'blocked'),
      ph2Node('GA-N4 Running', 'in_progress'),
      ph2Node('GA-N5 No status', null),
      ph2Node('GA-N6 Odd', 'garbled'),
      ph2Node('GA-N7 Ready', 'planning'),
      ph2Node('GA-N8 After stub', 'planning'),
    ];
    const edges = [ph2Depends('GA-N0 Other epic', 'GA-N8 After stub')];
    const { root } = ph2List(nodes, edges, []);
    const read = ph2Read(root);
    assert.deepStrictEqual(read.groups.map((group) => group.slice(1)), [
      ['Needs you 1', ['GA-N2', '⚑ waiting', null, null]],
      ['Next up 1', ['GA-N7', 'planning', 'next', null]],
      ['In progress 1', ['GA-N4', 'in progress', null, null]],
      ['Blocked 1', ['GA-N3', 'blocked', null, null]],
      ['Queued 3', ['GA-N5', 'unrecognized: (missing)', null, null], ['GA-N6', 'unrecognized: garbled', null, null],
        ['GA-N8', 'planning', null, 'after GA-N0']],
      ['Done 1', ['GA-N1', 'done', null, null]],
    ], 'PH2-NEXT-UP-RULE (FL2-NO-MARKER-ON-NON-READY): stub, parked, blocked, in-progress, completed, null-status, and unrecognized slices carry no marker, a stub gets no row, and a slice after a stub queues after it');
    assert.strictEqual(byClass(root, 'graph-view-frontier-row').length, 8,
      'PH2-NEXT-UP-RULE (FL2-NO-MARKER-ON-NON-READY): one row per slice and none for the stub');
    const after = [
      ph2Node('GA-W1 Done', 'completed'), ph2Node('GA-W2 Running', 'in_progress'), ph2Node('GA-W3 Sibling', 'planning'),
      ph2Node('GA-W5 Spec', 'blocked'), ph2Node('GA-W4 Waits', 'planning'), ph2Node('Untitled follow-up', 'planning'),
    ];
    const { root: afterRoot } = ph2List(after, [
      ph2Depends('GA-W1 Done', 'GA-W4 Waits'), ph2Depends('GA-W2 Running', 'GA-W4 Waits'),
      { from: 'GA-W3 Sibling', to: 'GA-W4 Waits', kind: 'order' }, ph2Depends('GA-W5 Spec', 'GA-W4 Waits'),
      ph2Depends('GA-W4 Waits', 'Untitled follow-up'),
    ], []);
    assert.deepStrictEqual(ph2Read(afterRoot).groups.filter((group) => group[1]?.startsWith('Queued')).map((group) => group.slice(1)), [
      ['Queued 2', ['GA-W4', 'planning', null, 'after GA-W2, GA-W5'], [null, 'planning', null, 'after GA-W4']],
    ], 'PH2-NEXT-UP-RULE (FL2-NO-MARKER-ON-NON-READY): a queued row names its unfinished depends prerequisites, comma-separated, and not a done one or an order sibling, and a card with no id draws no id chip');
    const untitled = byClass(afterRoot, 'graph-view-frontier-row').at(-2);
    assert(byClass(untitled, 'graph-view-frontier-id').length === 0
      && byClass(untitled, 'graph-view-frontier-title')[0]?.textContent === 'Untitled follow-up',
    'PH2-NEXT-UP-RULE: a card with no id draws no id chip and shows its whole name as the title');
    const next = byClass(root, 'graph-view-frontier-next');
    assert(next.length === 1 && next[0].style.cssText === 'padding:1px 7px;border-radius:999px;font-weight:700;color:var(--interactive-accent);'
      + 'border:1px solid color-mix(in srgb, var(--interactive-accent) 45%, transparent);',
    'PH2-NEXT-UP-RULE (FL2-NEXT-UP-BADGE): the one next badge is drawn in var(--interactive-accent) only');
    // MUTATION GUARD: PH2-MUTANT-COLOUR-LITERAL turns RED at
    // "PH2-NEXT-UP-RULE (FL2-READY-MARKER): ..." if the ready word is drawn
    // in a local colour literal.
    const { root: readyRoot } = ph2List([ph2Node('GA-Q1 One', 'planning'), ph2Node('GA-Q2 Two', 'planning')], [], []);
    const readyWords = byClass(readyRoot, 'graph-view-frontier-ready');
    assert(readyWords.length === 1 && readyWords[0].textContent === 'ready'
      && readyWords[0].style.cssText === 'font-weight:700;color:var(--interactive-accent);',
    'PH2-NEXT-UP-RULE (FL2-READY-MARKER): the ready word is drawn in var(--interactive-accent) only');
  }

  // ---- PH2-DONE-FOLD-THRESHOLD ----
  // MUTATION GUARD: PH2-MUTANT-FOLD-BELOW-HALF turns RED at
  // "PH2-DONE-FOLD-THRESHOLD: 5 of 12 done ..." if done folds below half.
  // MUTATION GUARD: PH2-MUTANT-FOLD-ABOVE-HALF-ONLY turns RED at
  // "PH2-DONE-FOLD-THRESHOLD: 6 of 12 done ..." if exactly half lists.
  // MUTATION GUARD: PH2-MUTANT-STUBS-COUNT-TOWARD-RATIO turns RED at
  // "PH2-DONE-FOLD-THRESHOLD: 5 of 10 done with two stubs ..." if stubs count
  // toward the ratio.
  // MUTATION GUARD: PH2-MUTANT-FOLD-AT-49 turns RED at
  // "PH2-DONE-FOLD-THRESHOLD: 49 of 100 done ..." if done folds from 0.49.
  const ph2Ratio = (doneCount, liveCount, stubs = 0) => {
    const nodes = [
      ...Array.from({ length: stubs }, (_, index) => ph2Node(`GA-S${index + 1} Stub`, null, { isStub: true })),
      ...Array.from({ length: liveCount }, (_, index) => ph2Node(`GA-D${index + 1} Slice`, index < doneCount ? 'completed' : 'in_progress')),
    ];
    return ph2List(nodes, [], []).root;
  };
  for (const [doneCount, liveCount, stubs, folds] of [
    [6, 12, 0, true], [5, 12, 0, false], [12, 12, 0, true], [5, 11, 0, false], [6, 11, 0, true],
    [4, 9, 0, false], [5, 9, 0, true], [1, 1, 0, true], [1, 2, 0, true], [1, 3, 0, false],
    [49, 100, 0, false], [50, 100, 0, true], [5, 10, 2, true], [4, 10, 2, false], [0, 3, 0, null],
  ]) {
    const root = ph2Ratio(doneCount, liveCount, stubs);
    const read = ph2Read(root);
    const doneGroup = read.groups.find((group) => group[0].includes('frontier-done')) || null;
    const expected = folds === null ? null : folds
      ? { strip: [`${doneCount} done · show`], group: ['graph-view-frontier-group frontier-done', null] }
      : { strip: [], group: ['graph-view-frontier-group frontier-done', `Done ${doneCount}`,
        ...Array.from({ length: doneCount }, (_, index) => [`GA-D${index + 1}`, 'done', null, null])] };
    assert.deepStrictEqual({ strip: read.strip, group: doneGroup }, expected || { strip: [], group: null },
      `PH2-DONE-FOLD-THRESHOLD: ${doneCount} of ${liveCount} done${stubs ? ` with ${stubs === 2 ? 'two' : stubs} stubs` : ''} ${folds === null ? 'draws no Done group' : folds ? `folds into the strip "${doneCount} done · show"` : `lists ${doneCount} done rows under a Done label`}`);
  }
  // Tapping the strip expands the done rows; tapping it again restores the
  // folded DOM exactly.
  // MUTATION GUARD: PH2-MUTANT-STRIP-EXPANDS-ONCE turns RED at
  // "PH2-DONE-FOLD-THRESHOLD: a second strip tap ..." if the strip cannot
  // fold again.
  // MUTATION GUARD: PH2-MUTANT-STRIP-TAP-BUBBLES turns RED at
  // "PH2-DONE-FOLD-THRESHOLD: a strip tap ..." if the strip tap bubbles.
  for (const width of [390, 1024]) {
    const env = ph2Track(ph2PerfEnv());
    const root = await ph2Draw(env, width);
    const atRest = JSON.stringify(domShape(root));
    const strip = byClass(root, 'graph-view-frontier-done-strip')[0];
    const tap = bubblingClick(strip);
    const expandedRows = byClass(root, 'graph-view-frontier-done-rows')[0];
    assert(tap.stopped && strip.textContent === '4 done · hide' && strip.attrs['aria-expanded'] === 'true'
      && expandedRows?.parent === strip.parent && strip.parent.children.indexOf(expandedRows) === strip.parent.children.indexOf(strip) + 1
      && JSON.stringify(byClass(root, 'graph-view-frontier-done-rows').map((rows) => rows.children.map(ph2RowOf))) === JSON.stringify([[
        ['GA-PF1', 'done', null, null], ['GA-PF2', 'done', null, null], ['GA-PF3', 'done', null, null], ['GA-PF4', 'done', null, null],
      ]]),
    `PH2-DONE-FOLD-THRESHOLD: a strip tap at ${width} stops there, expands the four done rows in draw order as the strip's next sibling, and the strip reads 4 done · hide`);
    bubblingClick(strip);
    assert.strictEqual(JSON.stringify(domShape(root)), atRest,
      `PH2-DONE-FOLD-THRESHOLD: a second strip tap at ${width} folds the rows again and restores the folded DOM exactly`);
    bubblingClick(strip);
    assert.strictEqual(byClass(root, 'graph-view-frontier-done-rows')[0]?.children.length, 4,
      `PH2-DONE-FOLD-THRESHOLD: a third strip tap at ${width} expands the four rows again`);
  }

  // ---- PH2-ROW-TAP-SELECTS ----
  // A row tap and a tap on the slice's map pill (390) or chip (1024) leave
  // the same DOM; a second tap on the row opens the note.
  // MUTATION GUARD: PH2-MUTANT-ROW-OPENS turns RED at "PH2-ROW-TAP-SELECTS:
  // at 390 a GA-ML9 row tap ..." if a row tap opens the note instead of
  // selecting.
  // MUTATION GUARD: PH2-MUTANT-ROW-SELECTS-WITHOUT-INSIGHTS turns RED at
  // "PH2-INSIGHTS-ABSENT-FAIL-SOFT: at 390 a row tap ..." if a row tap
  // without GraphInsights does nothing.
  for (const width of [390, 1024]) {
    const env = ph2Track(ph2MlEnv());
    const byRow = await ph2Draw(env, width);
    const byMap = await ph2Draw(env, width);
    const atRest = JSON.stringify(domShape(byRow));
    const rowTap = bubblingClick(ph2RowFor(byRow, 'GA-ML9'));
    bubblingClick(ph2MapNodeFor(byMap, 'GA-ML9'));
    const panel = byClass(byRow, 'graph-view-detail-panel');
    assert(rowTap.stopped && env.opened.length === 0 && panel.length === 1
      && byClass(panel[0], 'graph-view-detail-id')[0]?.textContent === 'GA-ML9'
      && JSON.stringify(domShape(byRow)) === JSON.stringify(domShape(byMap)),
    `PH2-ROW-TAP-SELECTS: at ${width} a GA-ML9 row tap stops there, opens nothing, and leaves the same DOM (chain highlight and card) as a tap on its ${width === 390 ? 'pill' : 'chip'}`);
    bubblingClick(ph2RowFor(byRow, 'GA-ML9'));
    assert.deepStrictEqual(env.opened, [[`${env.boardDir}/${ph2MlCard(9)}`, env.epicPath, false]],
      `PH2-ROW-TAP-SELECTS: at ${width} a second GA-ML9 row tap opens its note`);
    bubblingClick(ph2RowFor(byRow, 'GA-ML10'));
    bubblingClick(ph2MapNodeFor(byRow, 'GA-ML10'));
    assert.deepStrictEqual(env.opened.at(-1), [`${env.boardDir}/${ph2MlCard(10)}`, env.epicPath, false],
      `PH2-ROW-TAP-SELECTS: at ${width} a GA-ML10 row tap then a tap on its ${width === 390 ? 'pill' : 'chip'} opens its note`);
    bubblingClick(byClass(byRow, 'graph-view-canvas')[0]);
    assert.strictEqual(JSON.stringify(domShape(byRow)), atRest,
      `PH2-ROW-TAP-SELECTS: at ${width} a canvas tap after row taps restores the at-rest DOM`);
  }

  // A row tap in each group does what a tap on its slice in the map does.
  // With GraphInsights, the Frontier Groups rows GA-AG2 (Needs you), GA-AG6
  // (Next up), GA-AG4 (In progress), GA-AG3 (Blocked), GA-AG7 (Ready), and
  // GA-AG5 (Queued) each select their slice; without it, the Planned rows
  // GA-AG7, GA-AG6, GA-AG3, and GA-AG5 each open their note.
  // MUTATION GUARD: PH2C-MUTANT-NEEDS-YOU-ROWS-OPEN turns RED at
  // "PH2C-GROUP-ROW-TAP-SELECTS: at 390 the Needs you row GA-AG2 ..." if the
  // Needs you rows open their note instead of selecting.
  // MUTATION GUARD: PH2C-MUTANT-NEXT-ROWS-OPEN turns RED at
  // "PH2C-GROUP-ROW-TAP-SELECTS: at 390 the Next up row GA-AG6 ..." if the
  // Next up row opens its note instead of selecting.
  // MUTATION GUARD: PH2C-MUTANT-IN-PROGRESS-ROWS-OPEN turns RED at
  // "PH2C-GROUP-ROW-TAP-SELECTS: at 390 the In progress row GA-AG4 ..." if
  // the In progress rows open their note instead of selecting.
  // MUTATION GUARD: PH2C-MUTANT-BLOCKED-ROWS-OPEN turns RED at
  // "PH2C-GROUP-ROW-TAP-SELECTS: at 390 the Blocked row GA-AG3 ..." if the
  // Blocked rows open their note instead of selecting.
  // MUTATION GUARD: PH2C-MUTANT-READY-ROWS-OPEN turns RED at
  // "PH2C-GROUP-ROW-TAP-SELECTS: at 390 the Ready row GA-AG7 ..." if the
  // Ready rows open their note instead of selecting.
  // MUTATION GUARD: PH2C-MUTANT-QUEUED-ROWS-OPEN turns RED at
  // "PH2C-GROUP-ROW-TAP-SELECTS: at 390 the Queued row GA-AG5 ..." if the
  // Queued rows open their note instead of selecting.
  for (const width of [390, 1024]) {
    const mapNode = width === 390 ? 'pill' : 'chip';
    for (const [key, label, id] of [
      ['needs-you', 'Needs you', 'GA-AG2'], ['next', 'Next up', 'GA-AG6'], ['in-progress', 'In progress', 'GA-AG4'],
      ['blocked', 'Blocked', 'GA-AG3'], ['ready', 'Ready', 'GA-AG7'], ['queued', 'Queued', 'GA-AG5'],
    ]) {
      const env = ph2Track(ph2AgEnv());
      const byRow = await ph2Draw(env, width);
      const byMap = await ph2Draw(env, width);
      const row = ph2RowFor(byRow, id);
      const tap = bubblingClick(row);
      bubblingClick(ph2MapNodeFor(byMap, id));
      const panel = byClass(byRow, 'graph-view-detail-panel');
      assert(row?.parent?.className === `graph-view-frontier-group frontier-${key}`
        && tap.stopped && env.opened.length === 0 && panel.length === 1
        && byClass(panel[0], 'graph-view-detail-id')[0]?.textContent === id
        && JSON.stringify(domShape(byRow)) === JSON.stringify(domShape(byMap)),
      `PH2C-GROUP-ROW-TAP-SELECTS: at ${width} the ${label} row ${id} sits under ${label}, and its tap stops there, opens nothing, and leaves the same DOM as a tap on its ${mapNode}`);
    }
    for (const card of ['GA-AG7 Docs', 'GA-AG6 Exporter', 'GA-AG3 Migration', 'GA-AG5 Backfill']) {
      const id = card.split(' ')[0];
      const env = ph2Track(ph2AgEnv());
      const byRow = await ph2Draw(env, width, { insights: false });
      const byMap = await ph2Draw(env, width, { insights: false });
      const row = ph2RowFor(byRow, id);
      bubblingClick(row);
      const openedByRow = JSON.stringify(env.opened);
      bubblingClick(ph2MapNodeFor(byMap, id));
      const opened = [`${env.boardDir}/${card}`, env.epicPath, false];
      assert(row?.parent?.className === 'graph-view-frontier-group frontier-planned'
        && openedByRow === JSON.stringify([opened]) && JSON.stringify(env.opened) === JSON.stringify([opened, opened])
        && JSON.stringify(domShape(byRow)) === JSON.stringify(domShape(byMap)),
      `PH2C-GROUP-ROW-TAP-SELECTS: at ${width} with GraphInsights missing, the Planned row ${id}'s tap opens its note, as a tap on its ${mapNode} then does, and both leave the same DOM`);
    }
  }
  // ---- PH2-ROOT-CAUSE-BLOCK (FL3-ROOT-CAUSE-BLOCK) ----
  // MUTATION GUARD: PH2-MUTANT-ROOT-CAUSE-OPENS turns RED at
  // "PH2-ROOT-CAUSE-BLOCK: at 390 the GA-ML8 jump link ..." if the jump link
  // opens the root blocker's note instead of selecting it.
  // MUTATION GUARD: PH2-MUTANT-ROOT-CAUSE-ON-ROOT turns RED at
  // "PH2-ROOT-CAUSE-BLOCK: at 390 selecting GA-ML8 ..." if a root blocker
  // lists itself.
  // MUTATION GUARD: PH2-MUTANT-ROOT-CAUSE-AT-PROJECT turns RED at
  // "PH2-ROOT-CAUSE-BLOCK: at project scope ..." if project-scope cards get
  // the block.
  // MUTATION GUARD: PH2-MUTANT-ROOT-CAUSE-LINK-NO-HEIGHT turns RED at
  // "PH2-ROOT-CAUSE-BLOCK: at 390 selecting GA-ML10 ..." if the compact jump
  // link drops its 44px min-height.
  const parkedGlyph = EpicDashboard.STATUS_GLYPHS.parked;
  for (const width of [390, 1024]) {
    const env = ph2Track(ph2MlEnv());
    const root = await ph2Draw(env, width);
    const causeOf = (panelNode) => byClass(panelNode, 'graph-view-detail-root-cause-line').map((line) => [
      byClass(line, 'graph-view-detail-link-id')[0]?.textContent,
      byClass(line, 'graph-view-detail-link-status')[0]?.textContent,
      line.children.map((child) => child.className).join() === 'graph-view-detail-root-cause-link,graph-view-detail-root-cause-hops'
        ? line.children[1].textContent : 'out of order',
    ]);
    bubblingClick(ph2RowFor(root, 'GA-ML10'));
    const panel = byClass(root, 'graph-view-detail-panel')[0];
    const link = byClass(panel, 'graph-view-detail-root-cause-link')[0];
    assert(JSON.stringify(byClass(panel, 'graph-view-detail-label').map((label) => label.textContent))
        === JSON.stringify(['Waiting on', 'Root cause', 'Unmet prerequisites', 'Gates'])
      && JSON.stringify(causeOf(panel)) === JSON.stringify([['GA-ML8', ` · ${parkedGlyph} waiting`, '2 hops up']])
      && link?.tag === 'button' && cssEffective(link.style.cssText)['min-height'] === (width === 390 ? '44px' : undefined),
    `PH2-ROOT-CAUSE-BLOCK: at ${width} selecting GA-ML10 draws a Root cause row after Waiting on naming GA-ML8 with its ${parkedGlyph} glyph, its waiting word, and 2 hops up, as a link button${width === 390 ? ' with min-height 44px' : ' with no min-height'}`);
    const block = byClass(panel, 'graph-view-detail-root-cause')[0];
    assert(block?.className === 'graph-view-detail-fact graph-view-detail-root-cause'
      && byClass(block, 'graph-view-detail-label')[0]?.style.cssText
        === 'font-size:0.7em;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);',
    `PH2-ROOT-CAUSE-BLOCK (FL3-ROOT-CAUSE-BLOCK): at ${width} the Root cause row uses the VP-4 labeled-row grammar`);
    const opensBefore = env.opened.length;
    const jump = bubblingClick(link);
    const jumped = byClass(root, 'graph-view-detail-panel');
    assert(jump.stopped && env.opened.length === opensBefore && jumped.length === 1
      && byClass(jumped[0], 'graph-view-detail-id')[0]?.textContent === 'GA-ML8'
      && byClass(jumped[0], 'graph-view-detail-root-cause').length === 0,
    `PH2-ROOT-CAUSE-BLOCK: at ${width} the GA-ML8 jump link selects GA-ML8 without opening a note, and selecting GA-ML8 draws no Root cause row`);
    const viaPill = await ph2Draw(env, width);
    bubblingClick(ph2MapNodeFor(viaPill, 'GA-ML8'));
    assert.strictEqual(JSON.stringify(domShape(root)), JSON.stringify(domShape(viaPill)),
      `PH2-ROOT-CAUSE-BLOCK: at ${width} the jump leaves the same DOM as a tap on GA-ML8's ${width === 390 ? 'pill' : 'chip'}`);
    bubblingClick(ph2RowFor(root, 'GA-ML9'));
    assert.deepStrictEqual(causeOf(byClass(root, 'graph-view-detail-panel')[0]), [['GA-ML8', ` · ${parkedGlyph} waiting`, '1 hop up']],
      `PH2-ROOT-CAUSE-BLOCK: at ${width} selecting GA-ML9 names GA-ML8 at 1 hop up`);
    bubblingClick(ph2RowFor(root, 'GA-ML8'));
    assert.strictEqual(byClass(root, 'graph-view-detail-root-cause').length, 0,
      `PH2-ROOT-CAUSE-BLOCK: at ${width} selecting GA-ML8 itself draws no Root cause row`);
    const many = await ph2Draw(ph2Track(ph2Env('Many Roots', [
      { card: 'GA-MR1 Vendor', status: 'parked' },
      { card: 'GA-MR2 Legal', status: 'blocked' },
      { card: 'GA-MR3 Launch', status: 'planning', depends_on: ['[[GA-MR2 Legal]]', '[[GA-MR1 Vendor]]'] },
      { card: 'GA-MR4 Rollout', status: 'planning', depends_on: ['[[GA-MR3 Launch]]'] },
    ])), width);
    bubblingClick(ph2RowFor(many, 'GA-MR4'));
    assert.deepStrictEqual(causeOf(byClass(many, 'graph-view-detail-panel')[0]), [
      ['GA-MR1', ` · ${parkedGlyph} waiting`, '2 hops up'],
      ['GA-MR2', ` · ${EpicDashboard.STATUS_GLYPHS.blocked} blocked`, '2 hops up'],
    ], `PH2-ROOT-CAUSE-BLOCK: at ${width} a queued slice two hops below two root blockers lists both, GA-MR1 then GA-MR2, each 2 hops up`);
  }
  {
    const pick = (analysis) => ({ analyzeGraph(nodes, edges) {
      const real = new GraphInsights().analyzeGraph(nodes, edges);
      return { ...real, perNode: analysis(real.perNode) };
    } });
    for (const [label, perNode] of [
      ['a root cause naming no drawn node', (nodes) => ({ ...nodes, [ph2MlCard(10)]: { ...nodes[ph2MlCard(10)], rootCauses: [{ card: 'GA-ZZ Gone', hops: 1 }] } })],
      ['rootCauses that is not an array', (nodes) => ({ ...nodes, [ph2MlCard(10)]: { ...nodes[ph2MlCard(10)], rootCauses: 'GA-ML8' } })],
      ['rootCauses that is an array-like object', (nodes) => ({ ...nodes, [ph2MlCard(10)]: { ...nodes[ph2MlCard(10)], rootCauses: { 0: { card: ph2MlCard(8), hops: 2 }, length: 1 } } })],
    ]) {
      const env = ph2Track(ph2MlEnv());
      const root = await ph2Draw(env, 1024, { view: new GraphView({ lifecycleApi, insights: pick(perNode) }) });
      bubblingClick(ph2RowFor(root, 'GA-ML10'));
      assert(byClass(root, 'graph-view-detail-panel').length === 1 && byClass(root, 'graph-view-detail-root-cause').length === 0
        && byClass(ph2RowFor(root, 'GA-ML10'), 'graph-view-frontier-wait')[0]?.textContent === 'needs GA-ML9',
      `PH2-ROOT-CAUSE-BLOCK: ${label} draws no Root cause row, and the Blocked row falls back to its wait line`);
    }
    // MUTATION GUARD: PH2-MUTANT-HOPS-CONVERTED turns RED at
    // "PH2-ROOT-CAUSE-BLOCK: at 390, a root cause whose hop count is not a
    // finite number ..." if the row and the card convert the hop count with
    // Number() before the finite check.
    for (const width of [390, 1024]) {
      for (const [shown, hops] of [["'two'", 'two'], ['null', null], ['""', ''], ['"2"', '2'], ['true', true], ['[]', []], ['NaN', NaN]]) {
        const odd = pick((nodes) => ({ ...nodes, [ph2MlCard(10)]: { ...nodes[ph2MlCard(10)], rootCauses: [{ card: ph2MlCard(8), hops }] } }));
        const root = await ph2Draw(ph2Track(ph2MlEnv()), width, { view: new GraphView({ lifecycleApi, insights: odd }) });
        bubblingClick(ph2RowFor(root, 'GA-ML10'));
        assert(byClass(root, 'graph-view-detail-panel').length === 1 && byClass(root, 'graph-view-detail-root-cause').length === 0
          && byClass(ph2RowFor(root, 'GA-ML10'), 'graph-view-frontier-wait')[0]?.textContent === 'needs GA-ML9',
        `PH2-ROOT-CAUSE-BLOCK: at ${width}, a root cause whose hop count is not a finite number ('two', null, "", "2", true, [], NaN) draws no Root cause row, and the Blocked row falls back to its wait line; here the hop count is ${shown}`);
      }
    }
  }

  // Where the Blocked row or the Root cause row shows a hop count, it is
  // shown unrounded (1.5 reads 1.5 hops up).
  {
    const fractional = { analyzeGraph(nodes, edges) {
      const real = new GraphInsights().analyzeGraph(nodes, edges);
      const perNode = { ...real.perNode, [ph2MlCard(10)]: { ...real.perNode[ph2MlCard(10)], rootCauses: [{ card: ph2MlCard(8), hops: 1.5 }] } };
      return { ...real, perNode };
    } };
    const root = await ph2Draw(ph2Track(ph2MlEnv()), 390, { view: new GraphView({ lifecycleApi, insights: fractional }) });
    bubblingClick(ph2RowFor(root, 'GA-ML10'));
    assert(byClass(ph2RowFor(root, 'GA-ML10'), 'graph-view-frontier-wait')[0]?.textContent === 'blocked by GA-ML8 · 1.5 hops up'
      && byClass(root, 'graph-view-detail-root-cause-hops')[0]?.textContent === '1.5 hops up',
    'PH2-ROOT-CAUSE-BLOCK: a hop count of 1.5 from GraphInsights reads 1.5 hops up in the Blocked row and the Root cause row');
  }

  // ---- PH2C-ROOT-CAUSE-EACH-HOPS, PH2C-EVERY-ROOT, PH2C-BLOCKED-ROOT-WORDING ----
  // Fixtures drawn through render() at 390 and 1024 with the real
  // GraphLayout and, unless a fixture removes it, the real GraphInsights. A
  // card's Root cause lines read as [id, hop count] pairs, or null when no
  // detail card is open.
  const ph2cCauseLines = (root) => {
    const panel = byClass(root, 'graph-view-detail-panel')[0];
    return panel ? byClass(panel, 'graph-view-detail-root-cause-line').map((line) => [
      byClass(line, 'graph-view-detail-link-id')[0]?.textContent ?? null,
      byClass(line, 'graph-view-detail-root-cause-hops')[0]?.textContent ?? null,
    ]) : null;
  };
  // Uneven Roots: GA-UR1 is parked, GA-UR2 is blocked, GA-UR3 is planned
  // after GA-UR2, and GA-UR4 is blocked after GA-UR1 and GA-UR3, so GA-UR4
  // has two root blockers, GA-UR1 at 1 hop and GA-UR2 at 2 hops.
  // MUTATION GUARD: PH2C-MUTANT-CARD-LINES-FIRST-HOPS turns RED at
  // "PH2C-ROOT-CAUSE-EACH-HOPS: Uneven Roots at 390 ..." if every Root cause
  // line shows the hop count of the first one.
  // MUTATION GUARD: PH2C-MUTANT-ROOT-CAUSE-NEAREST-ONLY turns RED at
  // "PH2C-EVERY-ROOT: Uneven Roots at 390 ..." if the Root cause row keeps
  // only the root blockers with the fewest hops.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2Env('Uneven Roots', [
      { card: 'GA-UR1 Vendor', status: 'parked', resume_condition: 'Resume after the vendor call.' },
      { card: 'GA-UR2 Legal', status: 'blocked' },
      { card: 'GA-UR3 Spec', status: 'planning', depends_on: ['[[GA-UR2 Legal]]'] },
      { card: 'GA-UR4 Launch', status: 'blocked', depends_on: ['[[GA-UR1 Vendor]]', '[[GA-UR3 Spec]]'] },
    ])), width);
    assert.deepStrictEqual(ph2Read(root), {
      groups: [
        ['graph-view-frontier-group frontier-needs-you', 'Needs you 1', ['GA-UR1', '⚑ waiting', null, 'Resume after the vendor call.']],
        ['graph-view-frontier-group frontier-blocked', 'Blocked 2',
          ['GA-UR2', 'blocked', null, null],
          ['GA-UR4', 'blocked', null, 'blocked by GA-UR1 · 1 hop up']],
        ['graph-view-frontier-group frontier-queued', 'Queued 1', ['GA-UR3', 'planning', null, 'after GA-UR2']],
      ],
      shipped: [],
      strip: [],
    }, `PH2C-UNEVEN-ROOTS-LIST: Uneven Roots at ${width}: the list is Needs you 1 (GA-UR1), Blocked 2 (GA-UR2 with no wait line, then GA-UR4 blocked by GA-UR1 · 1 hop up), and Queued 1 (GA-UR3 after GA-UR2), with no other group, no Everything shipped line, and no done strip`);
    bubblingClick(ph2RowFor(root, 'GA-UR4'));
    const lines = ph2cCauseLines(root);
    assert.deepStrictEqual(lines, [['GA-UR1', '1 hop up'], ['GA-UR2', '2 hops up']],
      `PH2C-ROOT-CAUSE-EACH-HOPS: Uneven Roots at ${width}: selecting GA-UR4 draws the Root cause lines [GA-UR1, 1 hop up] and [GA-UR2, 2 hops up], in that order`);
    assert.deepStrictEqual((lines || []).map(([id]) => id), ['GA-UR1', 'GA-UR2'],
      `PH2C-EVERY-ROOT: Uneven Roots at ${width}: the Root cause lines on GA-UR4's card name exactly GA-UR1 and GA-UR2`);
  }
  // Blocked Chain: GA-BB1, GA-BB2, and GA-BB3 are all blocked, GA-BB2 after
  // GA-BB1 and GA-BB3 after GA-BB2, so the root blocker behind GA-BB2 and
  // GA-BB3 is blocked, not parked.
  // MUTATION GUARD: PH2C-MUTANT-BLOCKED-BY-PARKED-ROOT-ONLY turns RED at
  // "PH2C-BLOCKED-ROOT-WORDING: Blocked Chain at 390: the list ..." if a
  // Blocked row reads blocked by only when its root blocker is parked.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2Env('Blocked Chain', [
      { card: 'GA-BB1 Legal', status: 'blocked' },
      { card: 'GA-BB2 Contract', status: 'blocked', depends_on: ['[[GA-BB1 Legal]]'] },
      { card: 'GA-BB3 Launch', status: 'blocked', depends_on: ['[[GA-BB2 Contract]]'] },
    ])), width);
    assert.deepStrictEqual(ph2Read(root), {
      groups: [
        ['graph-view-frontier-group frontier-blocked', 'Blocked 3',
          ['GA-BB1', 'blocked', null, null],
          ['GA-BB2', 'blocked', null, 'blocked by GA-BB1 · 1 hop up'],
          ['GA-BB3', 'blocked', null, 'blocked by GA-BB1 · 2 hops up']],
      ],
      shipped: [],
      strip: [],
    }, `PH2C-BLOCKED-ROOT-WORDING: Blocked Chain at ${width}: the list is exactly Blocked 3, with GA-BB1 (no wait line), GA-BB2 blocked by GA-BB1 · 1 hop up, and GA-BB3 blocked by GA-BB1 · 2 hops up`);
    bubblingClick(ph2RowFor(root, 'GA-BB3'));
    assert.deepStrictEqual(ph2cCauseLines(root), [['GA-BB1', '2 hops up']],
      `PH2C-BLOCKED-ROOT-WORDING: Blocked Chain at ${width}: selecting GA-BB3 draws one Root cause line, [GA-BB1, 2 hops up]`);
  }
  // Far First: GA-FF1 is parked, GA-FF2 is planned after GA-FF1, GA-FF3 is
  // blocked, and GA-FF4 is blocked after GA-FF2 and GA-FF3. GraphInsights
  // lists GA-FF4's root causes as GA-FF1 at 2 hops, then GA-FF3 at 1 hop, so
  // its first root cause is not its nearest.
  // MUTATION GUARD: PH2C-MUTANT-BLOCKED-BY-NEAREST-CAUSE turns RED at
  // "PH2C-BLOCKED-FIRST-CAUSE: Far First at 390 ..." if a Blocked row names
  // its nearest root cause instead of its first.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2Env('Far First', [
      { card: 'GA-FF1 Vendor', status: 'parked', resume_condition: 'Resume after the vendor call.' },
      { card: 'GA-FF2 Spec', status: 'planning', depends_on: ['[[GA-FF1 Vendor]]'] },
      { card: 'GA-FF3 Legal', status: 'blocked' },
      { card: 'GA-FF4 Launch', status: 'blocked', depends_on: ['[[GA-FF2 Spec]]', '[[GA-FF3 Legal]]'] },
    ])), width);
    bubblingClick(ph2RowFor(root, 'GA-FF4'));
    assert.deepStrictEqual([
      ph2cCauseLines(root),
      byClass(ph2RowFor(root, 'GA-FF4'), 'graph-view-frontier-wait')[0]?.textContent ?? null,
    ], [[['GA-FF1', '2 hops up'], ['GA-FF3', '1 hop up']], 'blocked by GA-FF1 · 2 hops up'],
    `PH2C-BLOCKED-FIRST-CAUSE: Far First at ${width}: GA-FF4's Root cause lines are [GA-FF1, 2 hops up] then [GA-FF3, 1 hop up], and its Blocked row reads blocked by GA-FF1 · 2 hops up`);
  }
  // Rootless Blocked: GA-RB2 is blocked after the in-progress GA-RB1, so it
  // has no root cause, and GA-RB4 is planned after GA-RB3, which is
  // completed, and GA-RB1.
  // MUTATION GUARD: PH2C-MUTANT-ROOTLESS-BLOCKED-AFTER turns RED at
  // "PH2C-ROOTLESS-BLOCKED: Rootless Blocked at 390 ..." if a Blocked row
  // with no root cause reads its unmet prerequisites as after <deps>
  // instead of its wait line.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2Env('Rootless Blocked', [
      { card: 'GA-RB1 Build', status: 'in_progress' },
      { card: 'GA-RB2 Ship', status: 'blocked', depends_on: ['[[GA-RB1 Build]]'] },
      { card: 'GA-RB3 Base', status: 'completed' },
      { card: 'GA-RB4 Docs', status: 'planning', depends_on: ['[[GA-RB3 Base]]', '[[GA-RB1 Build]]'] },
    ])), width);
    const listed = ph2Read(root).groups.map((group) => group.slice(1));
    bubblingClick(ph2RowFor(root, 'GA-RB2'));
    assert.deepStrictEqual([listed, ph2cCauseLines(root)], [[
      ['In progress 1', ['GA-RB1', 'in progress', null, null]],
      ['Blocked 1', ['GA-RB2', 'blocked', null, 'needs GA-RB1']],
      ['Queued 1', ['GA-RB4', 'planning', null, 'after GA-RB1']],
      ['Done 1', ['GA-RB3', 'done', null, null]],
    ], []], `PH2C-ROOTLESS-BLOCKED: Rootless Blocked at ${width}: the Blocked row of GA-RB2, blocked behind the in-progress GA-RB1, reads its wait line needs GA-RB1, and its card has no Root cause line; GA-RB4's Queued row reads after GA-RB1, without the completed GA-RB3`);
  }
  // Odd Status: GA-OS1 is parked and GA-OS2, whose status review is not a
  // lifecycle status, depends on it.
  // MUTATION GUARD: PH2C-MUTANT-ROOT-CAUSE-BLOCKED-OR-PLANNING-ONLY turns RED
  // at "PH2C-ODD-STATUS: Odd Status at 390 ..." if only a blocked or
  // planning slice's card gets a Root cause row.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2Env('Odd Status', [
      { card: 'GA-OS1 Vendor', status: 'parked', resume_condition: 'Resume after the vendor call.' },
      { card: 'GA-OS2 Review', status: 'review', depends_on: ['[[GA-OS1 Vendor]]'] },
    ])), width);
    const queued = ph2Read(root).groups.find((group) => group[0] === 'graph-view-frontier-group frontier-queued') || null;
    bubblingClick(ph2RowFor(root, 'GA-OS2'));
    assert.deepStrictEqual([queued?.slice(1) ?? null, ph2cCauseLines(root)], [
      ['Queued 1', ['GA-OS2', 'unrecognized: review', null, 'after GA-OS1']],
      [['GA-OS1', '1 hop up']],
    ], `PH2C-ODD-STATUS: Odd Status at ${width}: GA-OS2 lists under Queued after GA-OS1 with its unrecognized: review word, and its card draws the Root cause line [GA-OS1, 1 hop up]`);
  }
  // Quoted Status: the statuses are written with literal quote characters.
  // The lifecycle API reads them as parked and blocked, so each slice gets a
  // row under Needs you or Blocked, and GraphInsights does not, so its
  // needsYouCount and blockedCount are 0; each label shows that finite 0.
  // MUTATION GUARD: PH2C-MUTANT-SUMMARY-ZERO-COUNTS-ROWS turns RED at
  // "PH2C-SUMMARY-ZERO: Quoted Status at 390 ..." if a summary count of 0
  // falls back to the rows drawn.
  for (const width of [390, 1024]) {
    const slices = [
      { card: 'GA-QS1 Vendor', status: '"parked"' },
      { card: 'GA-QS2 Legal', status: "'blocked'" },
    ];
    const root = await ph2Draw(ph2Track(ph2Env('Quoted Status', slices)), width);
    assert.deepStrictEqual(ph2Read(root).groups.map((group) => [group[1], group.slice(2).map((row) => row[0])]), [
      ['Needs you 0', ['GA-QS1']],
      ['Blocked 0', ['GA-QS2']],
    ], `PH2C-SUMMARY-ZERO: Quoted Status at ${width}: GA-QS1 is the one row under Needs you 0 and GA-QS2 the one row under Blocked 0`);
  }
  {
    const summary = new GraphInsights().analyzeGraph(
      [{ card: 'GA-QS1 Vendor', status: '"parked"' }, { card: 'GA-QS2 Legal', status: "'blocked'" }], []).summary;
    assert.deepStrictEqual([summary.needsYouCount, summary.blockedCount, ['"parked"', "'blocked'"].map((value) => delivery.normalizeStatus(value))],
      [0, 0, ['parked', 'blocked']],
      'PH2C-SUMMARY-ZERO: GraphInsights counts the quoted statuses as 0 parked and 0 blocked, and delivery normalizeStatus, which the fixture lifecycle API calls, reads them as parked and blocked');
  }

  // Done Between: GA-DB1 is parked, GA-DB2 is completed after it, and GA-DB3
  // is planned after GA-DB2, so GA-DB3's one direct prerequisite is done and
  // its root cause, GA-DB1, is two hops up.
  // MUTATION GUARD: PH2C-MUTANT-ROOT-CAUSE-NEEDS-UNMET turns RED at
  // "PH2C-DONE-BETWEEN: Done Between at 390 ..." if the Root cause row is
  // drawn only for a slice with an unmet direct prerequisite.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2Env('Done Between', [
      { card: 'GA-DB1 Vendor', status: 'parked', resume_condition: 'Resume after the vendor call.' },
      { card: 'GA-DB2 Schema', status: 'completed', depends_on: ['[[GA-DB1 Vendor]]'] },
      { card: 'GA-DB3 Import', status: 'planning', depends_on: ['[[GA-DB2 Schema]]'] },
    ])), width);
    const queued = ph2Read(root).groups.find((group) => group[0] === 'graph-view-frontier-group frontier-queued') || null;
    bubblingClick(ph2RowFor(root, 'GA-DB3'));
    assert.deepStrictEqual([queued?.slice(1) ?? null, ph2cCauseLines(root)], [
      ['Queued 1', ['GA-DB3', 'planning', null, null]],
      [['GA-DB1', '2 hops up']],
    ], `PH2C-DONE-BETWEEN: Done Between at ${width}: GA-DB3, whose one prerequisite GA-DB2 is done, lists under Queued with no wait line, and its card draws the Root cause line [GA-DB1, 2 hops up]`);
  }
  // A done row's tap does what a tap on its slice in the map does, whether
  // the row is listed under Done or expanded from the strip.
  // MUTATION GUARD: PH2C-MUTANT-DONE-ROWS-OPEN turns RED at
  // "PH2C-DONE-ROW-TAP-SELECTS: at 390 a GA-AG1 row tap ..." if a row listed
  // under Done opens its note instead of selecting.
  // MUTATION GUARD: PH2C-MUTANT-EXPANDED-ROWS-OPEN turns RED at
  // "PH2C-DONE-ROW-TAP-SELECTS: at 390 an expanded GA-PF2 row tap ..." if a
  // row expanded from the strip opens its note instead of selecting.
  for (const width of [390, 1024]) {
    const listedEnv = ph2Track(ph2AgEnv());
    const listedByRow = await ph2Draw(listedEnv, width);
    const listedByMap = await ph2Draw(listedEnv, width);
    const listedTap = bubblingClick(ph2RowFor(listedByRow, 'GA-AG1'));
    bubblingClick(ph2MapNodeFor(listedByMap, 'GA-AG1'));
    const listedPanel = byClass(listedByRow, 'graph-view-detail-panel');
    assert(ph2RowFor(listedByRow, 'GA-AG1')?.parent?.className === 'graph-view-frontier-group frontier-done'
      && listedTap.stopped && listedEnv.opened.length === 0 && listedPanel.length === 1
      && byClass(listedPanel[0], 'graph-view-detail-id')[0]?.textContent === 'GA-AG1'
      && JSON.stringify(domShape(listedByRow)) === JSON.stringify(domShape(listedByMap)),
    `PH2C-DONE-ROW-TAP-SELECTS: at ${width} a GA-AG1 row tap under Done stops there, opens nothing, and leaves the same DOM as a tap on its ${width === 390 ? 'pill' : 'chip'}`);
    const foldedEnv = ph2Track(ph2PerfEnv());
    const foldedByRow = await ph2Draw(foldedEnv, width);
    const foldedByMap = await ph2Draw(foldedEnv, width);
    for (const root of [foldedByRow, foldedByMap]) bubblingClick(byClass(root, 'graph-view-frontier-done-strip')[0]);
    const foldedRow = ph2RowFor(foldedByRow, 'GA-PF2');
    const foldedTap = bubblingClick(foldedRow);
    bubblingClick(ph2MapNodeFor(foldedByMap, 'GA-PF2'));
    const foldedPanel = byClass(foldedByRow, 'graph-view-detail-panel');
    assert(foldedRow?.parent?.className === 'graph-view-frontier-done-rows'
      && foldedTap.stopped && foldedEnv.opened.length === 0 && foldedPanel.length === 1
      && byClass(foldedPanel[0], 'graph-view-detail-id')[0]?.textContent === 'GA-PF2'
      && JSON.stringify(domShape(foldedByRow)) === JSON.stringify(domShape(foldedByMap)),
    `PH2C-DONE-ROW-TAP-SELECTS: at ${width} an expanded GA-PF2 row tap stops there, opens nothing, and leaves the same DOM as a tap on its ${width === 390 ? 'pill' : 'chip'} with the strip expanded`);
  }
  // Without GraphInsights a row tap opens the note, and a tap on an expanded
  // done row leaves the strip expanded.
  // MUTATION GUARD: PH2C-MUTANT-STRIP-LISTENS-ON-SECTION turns RED at
  // "PH2C-FAIL-SOFT-EXPANDED-ROW: at 390 ..." if the strip's tap handler is
  // on the Done section, so an expanded row's tap folds the rows again.
  for (const width of [390, 1024]) {
    const env = ph2Track(ph2PerfEnv());
    const root = await ph2Draw(env, width, { insights: false });
    const strip = byClass(root, 'graph-view-frontier-done-strip')[0];
    bubblingClick(strip);
    bubblingClick(ph2RowFor(root, 'GA-PF2'));
    assert.deepStrictEqual([
      env.opened,
      byClass(root, 'graph-view-frontier-done-rows').map((rows) => rows.children.length),
      strip?.textContent ?? null,
    ], [[[`${env.boardDir}/GA-PF2 Paint budget`, env.epicPath, false]], [4], '4 done · hide'],
    `PH2C-FAIL-SOFT-EXPANDED-ROW: at ${width} with GraphInsights missing, a tap on the expanded GA-PF2 row opens its note, and the four done rows stay expanded under 4 done · hide`);
  }

  // One Slice: an epic with one planning slice, GA-SO1.
  // MUTATION GUARD: PH2C-MUTANT-LIST-NEEDS-TWO-NODES turns RED at
  // "PH2C-ONE-SLICE: One Slice at 390 ..." if render() draws the list only
  // when the map has more than one node.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2Env('One Slice', [{ card: 'GA-SO1 Only', status: 'planning' }])), width);
    assert.deepStrictEqual(ph2Read(root), {
      groups: [['graph-view-frontier-group frontier-next', 'Next up 1', ['GA-SO1', 'planning', 'next', null]]],
      shipped: [],
      strip: [],
    }, `PH2C-ONE-SLICE: One Slice at ${width}: the list is exactly Next up 1, with GA-SO1 badged next`);
  }
  // Behind Parked: GA-PB1 is parked, and GA-PB2 (parked) and GA-PB3 (in
  // progress) both depend on it, so each has GA-PB1 as a root cause.
  // MUTATION GUARD: PH2C-MUTANT-NEEDS-YOU-BLOCKED-WORDING turns RED at
  // "PH2C-BEHIND-PARKED: Behind Parked at 390 ..." if a Needs you row with a
  // root cause reads blocked by <root> instead of its resume condition.
  // MUTATION GUARD: PH2C-MUTANT-IN-PROGRESS-BLOCKED-WORDING turns RED at the
  // same label if an In progress row with a root cause reads blocked by
  // <root>.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2Env('Behind Parked', [
      { card: 'GA-PB1 Vendor', status: 'parked', resume_condition: 'Resume after the vendor call.' },
      { card: 'GA-PB2 Legal', status: 'parked', depends_on: ['[[GA-PB1 Vendor]]'], resume_condition: 'Resume after legal review.' },
      { card: 'GA-PB3 Build', status: 'in_progress', depends_on: ['[[GA-PB1 Vendor]]'] },
    ])), width);
    assert.deepStrictEqual(ph2Read(root), {
      groups: [
        ['graph-view-frontier-group frontier-needs-you', 'Needs you 2',
          ['GA-PB1', '⚑ waiting', null, 'Resume after the vendor call.'],
          ['GA-PB2', '⚑ waiting', null, 'Resume after legal review.']],
        ['graph-view-frontier-group frontier-in-progress', 'In progress 1', ['GA-PB3', 'in progress', null, null]],
      ],
      shipped: [],
      strip: [],
    }, `PH2C-BEHIND-PARKED: Behind Parked at ${width}: the list is exactly Needs you 2 (GA-PB1 and GA-PB2, each with its resume condition) and In progress 1 (GA-PB3 with no wait line)`);
  }
  // Three Waits: GA-TW4 is planned after GA-TW3 (blocked), GA-TW1 (in
  // progress), and GA-TW2 (planning), listed in that order in its
  // depends_on.
  // MUTATION GUARD: PH2C-MUTANT-AFTER-FIRST-TWO turns RED at
  // "PH2C-THREE-WAITS: Three Waits at 390 ..." if a Queued row names at most
  // two prerequisites.
  // MUTATION GUARD: PH2C-MUTANT-AFTER-SORTED turns RED at the same label if
  // a Queued row sorts its prerequisites.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2Env('Three Waits', [
      { card: 'GA-TW1 Zeta', status: 'in_progress' },
      { card: 'GA-TW2 Alpha', status: 'planning' },
      { card: 'GA-TW3 Mid', status: 'blocked' },
      { card: 'GA-TW4 Join', status: 'planning', depends_on: ['[[GA-TW3 Mid]]', '[[GA-TW1 Zeta]]', '[[GA-TW2 Alpha]]'] },
    ])), width);
    assert.deepStrictEqual(ph2Read(root), {
      groups: [
        ['graph-view-frontier-group frontier-next', 'Next up 1', ['GA-TW2', 'planning', 'next', null]],
        ['graph-view-frontier-group frontier-in-progress', 'In progress 1', ['GA-TW1', 'in progress', null, null]],
        ['graph-view-frontier-group frontier-blocked', 'Blocked 1', ['GA-TW3', 'blocked', null, null]],
        ['graph-view-frontier-group frontier-queued', 'Queued 1', ['GA-TW4', 'planning', null, 'after GA-TW3, GA-TW1, GA-TW2']],
      ],
      shipped: [],
      strip: [],
    }, `PH2C-THREE-WAITS: Three Waits at ${width}: the list is exactly Next up 1 (GA-TW2), In progress 1 (GA-TW1), Blocked 1 (GA-TW3), and Queued 1, whose GA-TW4 row reads after GA-TW3, GA-TW1, GA-TW2`);
  }

  // Three Roots: GA-TR1 is parked, GA-TR2 and GA-TR3 are blocked, and
  // GA-TR4 is blocked after all three, so GA-TR4 has three root blockers,
  // each 1 hop up.
  // MUTATION GUARD: PH2C-MUTANT-ROOT-CAUSE-FIRST-TWO turns RED at
  // "PH2C-THREE-ROOTS: Three Roots at 390 ..." if the Root cause row keeps
  // only its first two lines.
  // MUTATION GUARD: PH2C-MUTANT-ROOT-CAUSE-DROP-LAST-WHEN-THREE turns RED at
  // the same label if the Root cause row drops its last line when it has
  // three or more.
  // MUTATION GUARD: PH2C-MUTANT-ROOT-CAUSE-LABEL-PLURAL turns RED at the
  // same label if a Root cause row with more than one line is labelled Root
  // causes.
  // MUTATION GUARD: PH2C-MUTANT-BLOCKED-LAST-CAUSE-WHEN-THREE turns RED at
  // the same label if a Blocked row with three or more root causes names
  // the last one.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2Env('Three Roots', [
      { card: 'GA-TR1 Vendor', status: 'parked', resume_condition: 'Resume after the vendor call.' },
      { card: 'GA-TR2 Legal', status: 'blocked' },
      { card: 'GA-TR3 Budget', status: 'blocked' },
      { card: 'GA-TR4 Launch', status: 'blocked', depends_on: ['[[GA-TR1 Vendor]]', '[[GA-TR2 Legal]]', '[[GA-TR3 Budget]]'] },
    ])), width);
    const listed = ph2Read(root);
    bubblingClick(ph2RowFor(root, 'GA-TR4'));
    assert.deepStrictEqual([
      listed,
      ph2cCauseLines(root),
      byClass(root, 'graph-view-detail-root-cause').map((block) => byClass(block, 'graph-view-detail-label')[0]?.textContent ?? null),
    ], [{
      groups: [
        ['graph-view-frontier-group frontier-needs-you', 'Needs you 1', ['GA-TR1', '⚑ waiting', null, 'Resume after the vendor call.']],
        ['graph-view-frontier-group frontier-blocked', 'Blocked 3',
          ['GA-TR2', 'blocked', null, null],
          ['GA-TR3', 'blocked', null, null],
          ['GA-TR4', 'blocked', null, 'blocked by GA-TR1 · 1 hop up']],
      ],
      shipped: [],
      strip: [],
    }, [['GA-TR1', '1 hop up'], ['GA-TR2', '1 hop up'], ['GA-TR3', '1 hop up']], ['Root cause']],
    `PH2C-THREE-ROOTS: Three Roots at ${width}: the list is exactly Needs you 1 and Blocked 3, whose GA-TR4 row reads blocked by GA-TR1 · 1 hop up, and GA-TR4's card has one block labelled Root cause with three lines, [GA-TR1, 1 hop up], [GA-TR2, 1 hop up], and [GA-TR3, 1 hop up]`);
  }
  // Four Roots: GA-FR1 to GA-FR4 are blocked, and GA-FR5 is blocked after
  // all four.
  // MUTATION GUARD: PH2C-MUTANT-ROOT-CAUSE-FIRST-THREE turns RED at
  // "PH2C-FOUR-ROOTS: Four Roots at 390 ..." if the Root cause row keeps
  // only its first three lines.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2Env('Four Roots', [
      { card: 'GA-FR1 Legal', status: 'blocked' },
      { card: 'GA-FR2 Budget', status: 'blocked' },
      { card: 'GA-FR3 Vendor', status: 'blocked' },
      { card: 'GA-FR4 Audit', status: 'blocked' },
      { card: 'GA-FR5 Launch', status: 'blocked', depends_on: ['[[GA-FR1 Legal]]', '[[GA-FR2 Budget]]', '[[GA-FR3 Vendor]]', '[[GA-FR4 Audit]]'] },
    ])), width);
    bubblingClick(ph2RowFor(root, 'GA-FR5'));
    assert.deepStrictEqual(ph2cCauseLines(root), [['GA-FR1', '1 hop up'], ['GA-FR2', '1 hop up'], ['GA-FR3', '1 hop up'], ['GA-FR4', '1 hop up']],
      `PH2C-FOUR-ROOTS: Four Roots at ${width}: GA-FR5's card draws four Root cause lines, GA-FR1 to GA-FR4, each 1 hop up`);
  }
  // Blocked First: GA-BF1 is blocked, GA-BF2 is parked, and GA-BF3 is
  // blocked after both, so GraphInsights lists the blocked GA-BF1 before
  // the parked GA-BF2.
  // MUTATION GUARD: PH2C-MUTANT-BLOCKED-PREFERS-PARKED-ROOT turns RED at
  // "PH2C-BLOCKED-FIRST: Blocked First at 390 ..." if a Blocked row names a
  // parked root cause ahead of its first one.
  // MUTATION GUARD: PH2C-MUTANT-ROOT-CAUSE-PARKED-FIRST turns RED at the same
  // label if the Root cause row puts parked root blockers first.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2Env('Blocked First', [
      { card: 'GA-BF1 Legal', status: 'blocked' },
      { card: 'GA-BF2 Vendor', status: 'parked', resume_condition: 'Resume after the vendor call.' },
      { card: 'GA-BF3 Launch', status: 'blocked', depends_on: ['[[GA-BF1 Legal]]', '[[GA-BF2 Vendor]]'] },
    ])), width);
    const listed = ph2Read(root).groups.map((group) => group.slice(1));
    bubblingClick(ph2RowFor(root, 'GA-BF3'));
    assert.deepStrictEqual([listed, ph2cCauseLines(root)], [[
      ['Needs you 1', ['GA-BF2', '⚑ waiting', null, 'Resume after the vendor call.']],
      ['Blocked 2', ['GA-BF1', 'blocked', null, null], ['GA-BF3', 'blocked', null, 'blocked by GA-BF1 · 1 hop up']],
    ], [['GA-BF1', '1 hop up'], ['GA-BF2', '1 hop up']]],
    `PH2C-BLOCKED-FIRST: Blocked First at ${width}: GA-BF3's Blocked row reads blocked by GA-BF1 · 1 hop up, and its Root cause lines are [GA-BF1, 1 hop up] then [GA-BF2, 1 hop up]`);
  }
  // Rank Order: GA-RO9 is blocked with no prerequisite, GA-RO1 is blocked
  // after the completed GA-RO0, and GA-RO5 is blocked after GA-RO9 and
  // GA-RO1.
  // MUTATION GUARD: PH2C-MUTANT-BLOCKED-ALPHA-FIRST turns RED at
  // "PH2C-RANK-ORDER: Rank Order at 390 ..." if a Blocked row names the
  // alphabetically first root cause.
  // MUTATION GUARD: PH2C-MUTANT-ROOT-CAUSE-SORTED-BY-CARD turns RED at the
  // same label if the Root cause row sorts its lines by card name.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2Env('Rank Order', [
      { card: 'GA-RO0 Base', status: 'completed' },
      { card: 'GA-RO9 Legal', status: 'blocked' },
      { card: 'GA-RO1 Vendor', status: 'blocked', depends_on: ['[[GA-RO0 Base]]'] },
      { card: 'GA-RO5 Launch', status: 'blocked', depends_on: ['[[GA-RO9 Legal]]', '[[GA-RO1 Vendor]]'] },
    ])), width);
    const listed = ph2Read(root).groups.map((group) => group.slice(1));
    bubblingClick(ph2RowFor(root, 'GA-RO5'));
    assert.deepStrictEqual([listed, ph2cCauseLines(root)], [[
      ['Blocked 3', ['GA-RO9', 'blocked', null, null], ['GA-RO1', 'blocked', null, null], ['GA-RO5', 'blocked', null, 'blocked by GA-RO9 · 1 hop up']],
      ['Done 1', ['GA-RO0', 'done', null, null]],
    ], [['GA-RO9', '1 hop up'], ['GA-RO1', '1 hop up']]],
    `PH2C-RANK-ORDER: Rank Order at ${width}: GA-RO5's Blocked row reads blocked by GA-RO9 · 1 hop up, and its Root cause lines are [GA-RO9, 1 hop up] then [GA-RO1, 1 hop up]`);
  }
  // Four Waits: GA-FW5 is planned after GA-FW1, GA-FW2, GA-FW3, and GA-FW4,
  // none of them completed.
  // MUTATION GUARD: PH2C-MUTANT-AFTER-FIRST-THREE turns RED at
  // "PH2C-FOUR-WAITS: Four Waits at 390 ..." if a Queued row names at most
  // three prerequisites.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2Env('Four Waits', [
      { card: 'GA-FW1 Alpha', status: 'in_progress' },
      { card: 'GA-FW2 Beta', status: 'blocked' },
      { card: 'GA-FW3 Gamma', status: 'planning' },
      { card: 'GA-FW4 Delta', status: 'in_progress' },
      { card: 'GA-FW5 Join', status: 'planning', depends_on: ['[[GA-FW1 Alpha]]', '[[GA-FW2 Beta]]', '[[GA-FW3 Gamma]]', '[[GA-FW4 Delta]]'] },
    ])), width);
    const queued = ph2Read(root).groups.find((group) => group[0] === 'graph-view-frontier-group frontier-queued') || null;
    assert.deepStrictEqual(queued?.slice(1) ?? null, ['Queued 1', ['GA-FW5', 'planning', null, 'after GA-FW1, GA-FW2, GA-FW3, GA-FW4']],
      `PH2C-FOUR-WAITS: Four Waits at ${width}: the Queued group is GA-FW5 alone, reading after GA-FW1, GA-FW2, GA-FW3, GA-FW4`);
  }
  // Parked No Resume: GA-PN2 is parked after the in-progress GA-PN1 and has
  // no resume condition, so its wait reason is "waiting on: GA-PN1 Build".
  // MUTATION GUARD: PH2C-MUTANT-NEEDS-YOU-RAW-WAIT turns RED at
  // "PH2C-PARKED-NO-RESUME: Parked No Resume at 390 ..." if a Needs you row
  // shows its raw wait reason instead of the shared wait line.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2Env('Parked No Resume', [
      { card: 'GA-PN1 Build', status: 'in_progress' },
      { card: 'GA-PN2 Vendor', status: 'parked', depends_on: ['[[GA-PN1 Build]]'] },
    ])), width);
    assert.deepStrictEqual(ph2Read(root).groups.map((group) => group.slice(1)), [
      ['Needs you 1', ['GA-PN2', '⚑ waiting', null, 'needs GA-PN1']],
      ['In progress 1', ['GA-PN1', 'in progress', null, null]],
    ], `PH2C-PARKED-NO-RESUME: Parked No Resume at ${width}: the list is exactly Needs you 1, whose GA-PN2 row reads needs GA-PN1, and In progress 1 (GA-PN1)`);
  }
  // Draw Order: the lane order draws GA-DO8, GA-DO3, GA-DO9, GA-DO7, GA-DO2,
  // GA-DO6, GA-DO4, which puts the Needs you, Ready, and Queued rows out of
  // card-name order.
  // MUTATION GUARD: PH2C-MUTANT-NEEDS-YOU-ROWS-SORTED turns RED at
  // "PH2C-DRAW-ORDER: Draw Order at 390 ..." if the Needs you rows are
  // sorted by card name.
  // MUTATION GUARD: PH2C-MUTANT-READY-ROWS-SORTED turns RED at the same
  // label if the Ready rows are sorted by card name.
  // MUTATION GUARD: PH2C-MUTANT-QUEUED-ROWS-SORTED turns RED at the same
  // label if the Queued rows are sorted by card name.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2Env('Draw Order', [
      { card: 'GA-DO3 Legal', status: 'parked', resume_condition: 'Resume after legal review.' },
      { card: 'GA-DO8 Vendor', status: 'parked', resume_condition: 'Resume after the vendor call.' },
      { card: 'GA-DO2 Docs', status: 'planning' },
      { card: 'GA-DO7 Export', status: 'planning' },
      { card: 'GA-DO9 Import', status: 'planning' },
      { card: 'GA-DO4 Rollout', status: 'planning', depends_on: ['[[GA-DO8 Vendor]]'] },
      { card: 'GA-DO6 Review', status: 'planning', depends_on: ['[[GA-DO3 Legal]]'] },
    ], ['GA-DO8 Vendor', 'GA-DO3 Legal', 'GA-DO9 Import', 'GA-DO7 Export', 'GA-DO2 Docs', 'GA-DO6 Review', 'GA-DO4 Rollout'])), width);
    assert.deepStrictEqual([
      byClass(root, 'graph-view-chip').map((chip) => (byClass(chip, 'graph-view-pill-id')[0] || byClass(chip, 'graph-view-chip-id')[0])?.textContent ?? null),
      ph2Read(root).groups.map((group) => group.slice(1)),
    ], [['GA-DO8', 'GA-DO3', 'GA-DO9', 'GA-DO7', 'GA-DO2', 'GA-DO6', 'GA-DO4'], [
      ['Needs you 2', ['GA-DO8', '⚑ waiting', null, 'Resume after the vendor call.'], ['GA-DO3', '⚑ waiting', null, 'Resume after legal review.']],
      ['Next up 1', ['GA-DO9', 'planning', 'next', null]],
      ['Ready 2', ['GA-DO7', 'planning', 'ready', null], ['GA-DO2', 'planning', 'ready', null]],
      ['Queued 2', ['GA-DO6', 'planning', null, 'after GA-DO3'], ['GA-DO4', 'planning', null, 'after GA-DO8']],
    ]], `PH2C-DRAW-ORDER: Draw Order at ${width}: the map draws GA-DO8, GA-DO3, GA-DO9, GA-DO7, GA-DO2, GA-DO6, GA-DO4, and the Needs you (GA-DO8, GA-DO3), Ready (GA-DO7, GA-DO2), and Queued (GA-DO6, GA-DO4) rows follow that order`);
  }
  // A Gates link on a detail card opens its note rather than selecting its
  // slice.
  // MUTATION GUARD: PH2C-MUTANT-GATES-LINK-SELECTS turns RED at
  // "PH2C-GATES-LINK-OPENS: at 390 ..." if a Gates link selects its slice
  // instead of opening its note.
  for (const width of [390, 1024]) {
    const env = ph2Track(ph2MlEnv());
    const root = await ph2Draw(env, width);
    bubblingClick(ph2RowFor(root, 'GA-ML8'));
    const gate = byClass(root, 'graph-view-detail-dependent')
      .find((link) => byClass(link, 'graph-view-detail-link-id')[0]?.textContent === 'GA-ML9');
    const tap = bubblingClick(gate);
    assert(tap.stopped && JSON.stringify(env.opened) === JSON.stringify([[`${env.boardDir}/${ph2MlCard(9)}`, env.epicPath, false]])
      && byClass(root, 'graph-view-detail-panel').length === 1
      && byClass(root, 'graph-view-detail-id')[0]?.textContent === 'GA-ML8',
    `PH2C-GATES-LINK-OPENS: at ${width} a tap on the GA-ML9 Gates link on GA-ML8's card stops there, opens GA-ML9's note, and leaves GA-ML8's card open`);
  }

  // Each Root cause link on GA-UR4's card (GA-UR1 parked, GA-UR2 blocked),
  // GA-TR4's card (GA-TR1 parked, GA-TR2 and GA-TR3 blocked), and GA-BB3's
  // card (GA-BB1 blocked) selects its own root blocker.
  // MUTATION GUARD: PH2C-MUTANT-JUMP-ALWAYS-FIRST-ROOT turns RED at
  // "PH2C-ROOT-CAUSE-JUMPS: Uneven Roots at 390 ..." if every Root cause link
  // selects the first line's root blocker.
  // MUTATION GUARD: PH2C-MUTANT-JUMP-FIRST-LINE-ONLY turns RED at the same
  // label if only the first Root cause link selects and the others open
  // their note.
  // MUTATION GUARD: PH2C-MUTANT-JUMP-ONLY-ONE-LINE turns RED at the same
  // label if a Root cause link selects only when the row has one line.
  // MUTATION GUARD: PH2C-MUTANT-JUMP-PARKED-ROOT-ONLY turns RED at the same
  // label if only a parked root blocker's link selects.
  // MUTATION GUARD: PH2C-MUTANT-BLOCKED-ROOT-LINK-OPENS turns RED at the
  // same label if a blocked root blocker's link opens its note.
  const ph2cJumpCases = [
    ['Uneven Roots', [
      { card: 'GA-UR1 Vendor', status: 'parked', resume_condition: 'Resume after the vendor call.' },
      { card: 'GA-UR2 Legal', status: 'blocked' },
      { card: 'GA-UR3 Spec', status: 'planning', depends_on: ['[[GA-UR2 Legal]]'] },
      { card: 'GA-UR4 Launch', status: 'blocked', depends_on: ['[[GA-UR1 Vendor]]', '[[GA-UR3 Spec]]'] },
    ], 'GA-UR4', ['GA-UR1', 'GA-UR2']],
    ['Three Roots', [
      { card: 'GA-TR1 Vendor', status: 'parked', resume_condition: 'Resume after the vendor call.' },
      { card: 'GA-TR2 Legal', status: 'blocked' },
      { card: 'GA-TR3 Budget', status: 'blocked' },
      { card: 'GA-TR4 Launch', status: 'blocked', depends_on: ['[[GA-TR1 Vendor]]', '[[GA-TR2 Legal]]', '[[GA-TR3 Budget]]'] },
    ], 'GA-TR4', ['GA-TR1', 'GA-TR2', 'GA-TR3']],
    ['Blocked Chain', [
      { card: 'GA-BB1 Legal', status: 'blocked' },
      { card: 'GA-BB2 Contract', status: 'blocked', depends_on: ['[[GA-BB1 Legal]]'] },
      { card: 'GA-BB3 Launch', status: 'blocked', depends_on: ['[[GA-BB2 Contract]]'] },
    ], 'GA-BB3', ['GA-BB1']],
  ];
  for (const width of [390, 1024]) {
    const mapNode = width === 390 ? 'pill' : 'chip';
    for (const [name, slices, from, roots] of ph2cJumpCases) {
      for (const [index, id] of roots.entries()) {
        const env = ph2Track(ph2Env(name, slices));
        const root = await ph2Draw(env, width);
        const viaMap = await ph2Draw(env, width);
        bubblingClick(ph2RowFor(root, from));
        const link = byClass(root, 'graph-view-detail-root-cause-link')[index];
        const linkId = link ? byClass(link, 'graph-view-detail-link-id')[0]?.textContent ?? null : null;
        const tap = link ? bubblingClick(link) : { stopped: false };
        bubblingClick(ph2MapNodeFor(viaMap, id));
        assert(linkId === id && tap.stopped && env.opened.length === 0
          && byClass(root, 'graph-view-detail-panel').length === 1
          && byClass(root, 'graph-view-detail-id')[0]?.textContent === id
          && JSON.stringify(domShape(root)) === JSON.stringify(domShape(viaMap)),
        `PH2C-ROOT-CAUSE-JUMPS: ${name} at ${width}: Root cause link ${index + 1} on ${from}'s card names ${id}, and its tap stops there, opens nothing, selects ${id}, and leaves the same DOM as a tap on ${id}'s ${mapNode}`);
      }
    }
  }
  // Long Chain: GA-LC1 to GA-LC4 are blocked, each after the one before, so
  // GA-LC4 is three hops below its root blocker, GA-LC1.
  // MUTATION GUARD: PH2C-MUTANT-CARD-HOPS-CAP-TWO turns RED at
  // "PH2C-LONG-CHAIN: Long Chain at 390 ..." if a Root cause line shows at
  // most 2 hops.
  // MUTATION GUARD: PH2C-MUTANT-ROW-HOPS-CAP-TWO turns RED at the same label
  // if a Blocked row shows at most 2 hops.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2Env('Long Chain', [
      { card: 'GA-LC1 Legal', status: 'blocked' },
      { card: 'GA-LC2 Contract', status: 'blocked', depends_on: ['[[GA-LC1 Legal]]'] },
      { card: 'GA-LC3 Build', status: 'blocked', depends_on: ['[[GA-LC2 Contract]]'] },
      { card: 'GA-LC4 Launch', status: 'blocked', depends_on: ['[[GA-LC3 Build]]'] },
    ])), width);
    const listed = ph2Read(root);
    bubblingClick(ph2RowFor(root, 'GA-LC4'));
    assert.deepStrictEqual([listed, ph2cCauseLines(root)], [{
      groups: [['graph-view-frontier-group frontier-blocked', 'Blocked 4',
        ['GA-LC1', 'blocked', null, null],
        ['GA-LC2', 'blocked', null, 'blocked by GA-LC1 · 1 hop up'],
        ['GA-LC3', 'blocked', null, 'blocked by GA-LC1 · 2 hops up'],
        ['GA-LC4', 'blocked', null, 'blocked by GA-LC1 · 3 hops up']]],
      shipped: [],
      strip: [],
    }, [['GA-LC1', '3 hops up']]],
    `PH2C-LONG-CHAIN: Long Chain at ${width}: the list is exactly Blocked 4, whose GA-LC4 row reads blocked by GA-LC1 · 3 hops up, and GA-LC4's card draws one Root cause line, [GA-LC1, 3 hops up]`);
  }
  // The Idless Roots shape again: GA-V2's card names the root blocker that
  // has no id, "Vendor sign-off", by its whole name.
  // MUTATION GUARD: PH2C-MUTANT-IDLESS-ROOT-NO-LINK turns RED at
  // "PH2C-IDLESS-ROOT-LINE: at 390 ..." if a Root cause line draws no link
  // for a root blocker that has no id.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2Env('Idless Roots', [
      { card: 'Vendor sign-off', status: 'parked', resume_condition: 'Resume after the vendor call.' },
      { card: 'GA-V2 Launch', status: 'blocked', depends_on: ['[[Vendor sign-off]]'] },
      { card: 'GA-V3 Docs', status: 'planning', depends_on: ['[[Vendor sign-off]]'] },
    ])), width);
    bubblingClick(ph2RowFor(root, 'GA-V2'));
    assert.deepStrictEqual(ph2cCauseLines(root), [['Vendor sign-off', '1 hop up']],
      `PH2C-IDLESS-ROOT-LINE: at ${width} GA-V2's card draws one Root cause line, whose link names Vendor sign-off, 1 hop up`);
  }
  // Odd Prereq and No Status: GA-OP2 is planned after GA-OP1, whose status
  // review is not a lifecycle status, and GA-NS2 is planned after GA-NS1,
  // which has no status.
  // MUTATION GUARD: PH2C-MUTANT-AFTER-DROPS-UNRECOGNIZED turns RED at
  // "PH2C-ODD-PREREQ: at 390 ..." if a Queued row leaves out a prerequisite
  // whose status is not a lifecycle status.
  // MUTATION GUARD: PH2C-MUTANT-AFTER-DROPS-NO-STATUS turns RED at the same
  // label if a Queued row leaves out a prerequisite with no status.
  for (const width of [390, 1024]) {
    const odd = await ph2Draw(ph2Track(ph2Env('Odd Prereq', [
      { card: 'GA-OP1 Review', status: 'review' },
      { card: 'GA-OP2 Ship', status: 'planning', depends_on: ['[[GA-OP1 Review]]'] },
    ])), width);
    const none = await ph2Draw(ph2Track(ph2Env('No Status', [
      { card: 'GA-NS1 Draft' },
      { card: 'GA-NS2 Ship', status: 'planning', depends_on: ['[[GA-NS1 Draft]]'] },
    ])), width);
    assert.deepStrictEqual([odd, none].map((root) => ph2Read(root).groups.map((group) => group.slice(1))), [
      [['Queued 2', ['GA-OP1', 'unrecognized: review', null, null], ['GA-OP2', 'planning', null, 'after GA-OP1']]],
      [['Queued 2', ['GA-NS1', 'unrecognized: (missing)', null, null], ['GA-NS2', 'planning', null, 'after GA-NS1']]],
    ], `PH2C-ODD-PREREQ: at ${width} GA-OP2 reads after GA-OP1 and GA-NS2 reads after GA-NS1, each list being exactly Queued 2`);
  }
  // Blocked With Resume: GA-BR2 is blocked after the parked GA-BR1 and has
  // a resume condition that starts with "Resume".
  // MUTATION GUARD: PH2C-MUTANT-ROOT-CAUSE-SKIPS-RESUME turns RED at
  // "PH2C-BLOCKED-WITH-RESUME: at 390 ..." if a slice whose wait reason
  // starts with Resume gets no Root cause row.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2Env('Blocked With Resume', [
      { card: 'GA-BR1 Vendor', status: 'parked', resume_condition: 'Resume after the vendor call.' },
      { card: 'GA-BR2 Audit', status: 'blocked', depends_on: ['[[GA-BR1 Vendor]]'], resume_condition: 'Resume after the audit.' },
    ])), width);
    const row = byClass(ph2RowFor(root, 'GA-BR2'), 'graph-view-frontier-wait')[0]?.textContent ?? null;
    bubblingClick(ph2RowFor(root, 'GA-BR2'));
    assert.deepStrictEqual([row, ph2cCauseLines(root), byClass(root, 'graph-view-detail-label').map((label) => label.textContent)], [
      'blocked by GA-BR1 · 1 hop up', [['GA-BR1', '1 hop up']], ['Waiting on', 'Root cause', 'Unmet prerequisites', 'Gates'],
    ], `PH2C-BLOCKED-WITH-RESUME: at ${width} GA-BR2's Blocked row reads blocked by GA-BR1 · 1 hop up, and its card has the labels Waiting on, Root cause, Unmet prerequisites, and Gates, with the Root cause line [GA-BR1, 1 hop up]`);
  }
  // Stub Order: GA-SX2 is planned after the in-progress GA-SX1 and GA-OX1, a
  // slice in the Other Ops epic, in that depends_on order.
  // MUTATION GUARD: PH2C-MUTANT-AFTER-STUB-FIRST turns RED at
  // "PH2C-STUB-ORDER: at 390 ..." if a Queued row names cross-epic
  // prerequisites first.
  for (const width of [390, 1024]) {
    const env = ph2Track(ph2Env('Stub Order', [
      { card: 'GA-SX1 Build', status: 'in_progress' },
      { card: 'GA-SX2 Ship', status: 'planning', depends_on: ['[[GA-SX1 Build]]', '[[GA-OX1 Upstream]]'] },
    ]));
    const otherPath = 'spice/projects/phone/tasks/Other Ops/board/GA-OX1 Upstream.md';
    env.app.vault.getMarkdownFiles().push(file(otherPath, 99));
    const ownCache = env.app.metadataCache.getFileCache;
    env.app.metadataCache.getFileCache = (entry) => (entry.path === otherPath
      ? { frontmatter: { type: 'slice', status: 'in_progress' } }
      : ownCache(entry));
    const root = await ph2Draw(env, width);
    assert.deepStrictEqual(ph2Read(root).groups.map((group) => group.slice(1)), [
      ['In progress 1', ['GA-SX1', 'in progress', null, null]],
      ['Queued 1', ['GA-SX2', 'planning', null, 'after GA-SX1, GA-OX1']],
    ], `PH2C-STUB-ORDER: at ${width} the list is exactly In progress 1 and Queued 1, whose GA-SX2 row reads after GA-SX1, GA-OX1`);
  }
  // Two Builds: GA-TB2 and GA-TB1 are in progress, and the lane order names
  // GA-TB2 first.
  // MUTATION GUARD: PH2C-MUTANT-IN-PROGRESS-ROWS-REVERSED turns RED at
  // "PH2C-TWO-BUILDS: at 390 with GraphInsights ..." if the In progress rows
  // are reversed.
  // MUTATION GUARD: PH2C-MUTANT-FAIL-SOFT-IN-PROGRESS-REVERSED turns RED at
  // "PH2C-TWO-BUILDS: at 390 without GraphInsights ..." if the fail-soft In
  // progress rows are reversed.
  for (const width of [390, 1024]) {
    for (const insights of [true, false]) {
      const root = await ph2Draw(ph2Track(ph2Env('Two Builds', [
        { card: 'GA-TB2 Server', status: 'in_progress' },
        { card: 'GA-TB1 Client', status: 'in_progress' },
      ], ['GA-TB2 Server', 'GA-TB1 Client'])), width, { insights });
      assert.deepStrictEqual(ph2Read(root), {
        groups: [['graph-view-frontier-group frontier-in-progress', 'In progress 2',
          ['GA-TB2', 'in progress', null, null], ['GA-TB1', 'in progress', null, null]]],
        shipped: [],
        strip: [],
      }, `PH2C-TWO-BUILDS: at ${width} ${insights ? 'with' : 'without'} GraphInsights the list is exactly In progress 2, GA-TB2 then GA-TB1`);
    }
  }
  // Without GraphInsights, the Perf epic, whose slices are all done, still
  // says Everything shipped.
  // MUTATION GUARD: PH2C-MUTANT-SHIPPED-NEEDS-INSIGHTS turns RED at
  // "PH2C-FAIL-SOFT-SHIPPED: at 390 ..." if the Everything shipped line is
  // drawn only with GraphInsights.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2PerfEnv()), width, { insights: false });
    assert.deepStrictEqual(ph2Read(root), {
      groups: [['graph-view-frontier-group frontier-done', null]],
      shipped: ['Everything shipped'],
      strip: ['4 done · show'],
    }, `PH2C-FAIL-SOFT-SHIPPED: at ${width} without GraphInsights the Perf list is the folded 4 done strip and the line Everything shipped`);
  }

  // No Lanes: three ready planning slices and an empty lane order, so Next
  // up is the first ready slice the map draws.
  // MUTATION GUARD: PH2C-MUTANT-NO-LANES-NEXT-LAST-READY turns RED at
  // "PH2C-NO-LANES: at 390 ..." if, with no lane match, Next up is the last
  // ready slice drawn.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2Env('No Lanes', [
      { card: 'GA-NL2 Export', status: 'planning' },
      { card: 'GA-NL1 Import', status: 'planning' },
      { card: 'GA-NL3 Docs', status: 'planning' },
    ])), width);
    assert.deepStrictEqual([
      byClass(root, 'graph-view-chip').map((chip) => (byClass(chip, 'graph-view-pill-id')[0] || byClass(chip, 'graph-view-chip-id')[0])?.textContent ?? null),
      ph2Read(root).groups.map((group) => group.slice(1)),
      [...byClass(root, 'graph-view-frontier-next'), ...byClass(root, 'graph-view-frontier-ready')]
        .map((marker) => cssEffective(marker.style.cssText).color),
    ], [['GA-NL1', 'GA-NL2', 'GA-NL3'], [
      ['Next up 1', ['GA-NL1', 'planning', 'next', null]],
      ['Ready 2', ['GA-NL2', 'planning', 'ready', null], ['GA-NL3', 'planning', 'ready', null]],
    ], ['var(--interactive-accent)', 'var(--interactive-accent)', 'var(--interactive-accent)']],
    `PH2C-NO-LANES: at ${width} the map draws GA-NL1, GA-NL2, GA-NL3, GA-NL1 is Next up, GA-NL2 and GA-NL3 list under Ready, and the next badge and both ready words are coloured var(--interactive-accent)`);
  }
  // Fold Edges through render(): 2 of 5 live slices done lists them under a
  // Done label, and 2 of 4 folds them into the strip.
  // MUTATION GUARD: PH2C-MUTANT-FOLD-ONE-BELOW-HALF turns RED at
  // "PH2C-FOLD-EDGES: at 390 ..." if done folds when twice the done count
  // is one less than the live count.
  for (const width of [390, 1024]) {
    const read = [];
    for (const [doneCount, liveCount] of [[2, 5], [2, 4]]) {
      const root = await ph2Draw(ph2Track(ph2Env('Fold Edges', Array.from({ length: liveCount }, (_, index) => ({
        card: `GA-FE${index + 1} Step`, status: index < doneCount ? 'completed' : 'in_progress',
      })))), width);
      const done = ph2Read(root);
      read.push({ done: done.groups.find((group) => group[0] === 'graph-view-frontier-group frontier-done') || null, strip: done.strip });
    }
    assert.deepStrictEqual(read, [
      { done: ['graph-view-frontier-group frontier-done', 'Done 2', ['GA-FE1', 'done', null, null], ['GA-FE2', 'done', null, null]], strip: [] },
      { done: ['graph-view-frontier-group frontier-done', null], strip: ['2 done · show'] },
    ], `PH2C-FOLD-EDGES: at ${width} 2 of 5 done lists GA-FE1 and GA-FE2 under Done 2, and 2 of 4 done folds into the strip 2 done · show`);
  }
  // At 390 too, a summary count that is not a finite number falls back to
  // the rows drawn.
  // MUTATION GUARD: PH2C-MUTANT-SUMMARY-ANY-VALUE turns RED at
  // "PH2C-SUMMARY-FALLBACK: at 390 ..." if any summary count other than
  // undefined or null is shown as it is.
  for (const [label, bad] of [['not a number', 'many'], ['missing', undefined], ['a numeric string', '7'], ['not finite', Infinity]]) {
    const odd = { analyzeGraph(nodes, edges) {
      const analysis = new GraphInsights().analyzeGraph(nodes, edges);
      return { ...analysis, summary: { ...analysis.summary, needsYouCount: bad, blockedCount: bad } };
    } };
    const root = await ph2Draw(ph2Track(ph2MlEnv()), 390, { view: new GraphView({ lifecycleApi, insights: odd }) });
    assert.deepStrictEqual(ph2Labels(root), ['Needs you 1', 'Blocked 2'],
      `PH2C-SUMMARY-FALLBACK: at 390 a summary count that is ${label} falls back to the rows drawn`);
  }

  // Idless Pair: GA-IP3 is blocked after the parked "Vendor sign-off", which
  // has no id, and the blocked GA-IP2.
  // MUTATION GUARD: PH2C-MUTANT-IDLESS-LINK-ONLY-WHEN-ALONE turns RED at
  // "PH2C-IDLESS-PAIR: at 390 ..." if a root blocker with no id gets a Root
  // cause link only when it is the card's one root cause.
  for (const width of [390, 1024]) {
    const env = ph2Track(ph2Env('Idless Pair', [
      { card: 'Vendor sign-off', status: 'parked', resume_condition: 'Resume after the vendor call.' },
      { card: 'GA-IP2 Legal', status: 'blocked' },
      { card: 'GA-IP3 Launch', status: 'blocked', depends_on: ['[[Vendor sign-off]]', '[[GA-IP2 Legal]]'] },
    ]));
    const root = await ph2Draw(env, width);
    bubblingClick(ph2RowFor(root, 'GA-IP3'));
    const lines = ph2cCauseLines(root);
    const link = byClass(root, 'graph-view-detail-root-cause-link')[1];
    const tap = link ? bubblingClick(link) : { stopped: false };
    assert.deepStrictEqual([lines, tap.stopped, env.opened.length, byClass(root, 'graph-view-detail-id').map((heading) => heading.textContent)],
      [[['GA-IP2', '1 hop up'], ['Vendor sign-off', '1 hop up']], true, 0, ['Vendor sign-off']],
      `PH2C-IDLESS-PAIR: at ${width} GA-IP3's card draws the Root cause lines [GA-IP2, 1 hop up] and [Vendor sign-off, 1 hop up], and a tap on the Vendor sign-off link stops there, opens nothing, and opens the Vendor sign-off card`);
  }

  // ---- PH2-NEEDS-YOU-GLYPH-PARKED-ONLY (FL3-NEEDS-YOU-MARKER) ----
  // MUTATION GUARD: PH2-MUTANT-NEEDS-YOU-ON-BLOCKED turns RED at
  // "PH2-NEEDS-YOU-GLYPH-PARKED-ONLY: at 390 ..." if a blocked row's pill
  // carries the needs-you glyph.
  // MUTATION GUARD: PH2-MUTANT-NEEDS-YOU-OUTSIDE-PILL turns RED at the same
  // label if the glyph is drawn outside the status pill.
  for (const width of [390, 1024]) {
    const root = await ph2Draw(ph2Track(ph2AgEnv()), width);
    bubblingClick(ph2RowFor(root, 'GA-AG2'));
    const glyphs = byClass(root, 'graph-view-needs-you-glyph');
    const parkedRow = ph2RowFor(root, 'GA-AG2');
    const pill = byClass(parkedRow, 'graph-view-frontier-pill')[0];
    assert(glyphs.length === 1 && glyphs[0].parent === pill && glyphs[0].textContent === '⚑'
      && pill.children.indexOf(glyphs[0]) === 0 && pill.children[1]?.className === 'graph-view-frontier-status'
      && pill.children[1].textContent === 'waiting' && pill.children.length === 2
      && parkedRow.className === 'graph-view-frontier-row graph-view-needs-you'
      && byClass(root, 'graph-view-frontier-row').filter((row) => row.className.includes('graph-view-needs-you')).length === 1,
    `PH2-NEEDS-YOU-GLYPH-PARKED-ONLY: at ${width} the needs-you glyph is drawn once in the whole root, inside the parked row's pill before its waiting word, while that slice's card is open`);
    assert(EpicDashboard.STATUS_DISPLAY.parked === 'waiting'
      && byClass(root, 'graph-view-legend-label').every((label) => !/ready|next|needs you/i.test(label.textContent)),
    `PH2-NEEDS-YOU-GLYPH-PARKED-ONLY (FL3-NEEDS-YOU-MARKER): at ${width} STATUS_DISPLAY.parked stays waiting and the legend names no ready, next, or needs-you entry`);
    for (const row of byClass(root, 'graph-view-frontier-row')) {
      const pillOf = byClass(row, 'graph-view-frontier-pill')[0];
      const word = byClass(pillOf, 'graph-view-frontier-status')[0];
      assert(pillOf.parent?.className === 'graph-view-frontier-meta' && word?.parent === pillOf
        && pillOf.children.at(-1) === word,
      `PH2-NEEDS-YOU-GLYPH-PARKED-ONLY: at ${width} every row's status word is its pill's last child`);
    }
  }
  assert(!/STATUS_GLYPHS|"⚑"\s*:/.test(widgetSource) && (widgetSource.match(/⚑/g) || []).length === 1
    && !Object.values(EpicDashboard.STATUS_GLYPHS).includes('⚑'),
  'PH2-NEEDS-YOU-GLYPH-PARKED-ONLY: graph-view.js draws the needs-you glyph at one site, and it is none of the shared status glyphs');

  // ---- PH2-INSIGHTS-ABSENT-FAIL-SOFT ----
  // MUTATION GUARD: PH2-MUTANT-FAIL-SOFT-KEEPS-BLOCKED turns RED at
  // "PH2-INSIGHTS-ABSENT-FAIL-SOFT: at 390 with GraphInsights missing ..." if
  // the fail-soft groups keep a Blocked group.
  for (const width of [390, 1024]) {
    for (const [label, options] of [
      ['missing', { insights: false }],
      ['throwing', { view: new GraphView({ lifecycleApi, insights: { analyzeGraph() { throw new Error('insights fault'); } } }) }],
      ['malformed', { view: new GraphView({ lifecycleApi, insights: { analyzeGraph: () => ({ perNode: null }) } }) }],
    ]) {
      const env = ph2Track(ph2AgEnv());
      const root = await ph2Draw(env, width, options);
      assert.deepStrictEqual(ph2Read(root), {
        groups: [
          ['graph-view-frontier-group frontier-needs-you', 'Needs you 1', ['GA-AG2', '⚑ waiting', null, 'Resume after the design review.']],
          ['graph-view-frontier-group frontier-in-progress', 'In progress 1', ['GA-AG4', 'in progress', null, null]],
          ['graph-view-frontier-group frontier-planned', 'Planned 4',
            ['GA-AG7', 'planning', null, null], ['GA-AG6', 'planning', null, null],
            ['GA-AG3', 'blocked', null, 'needs GA-AG2'], ['GA-AG5', 'planning', null, null]],
          ['graph-view-frontier-group frontier-done', 'Done 1', ['GA-AG1', 'done', null, null]],
        ],
        shipped: [],
        strip: [],
      }, `PH2-INSIGHTS-ABSENT-FAIL-SOFT: at ${width} with GraphInsights ${label} the groups are Needs you, In progress, Planned, and Done, with no Next up, Blocked, or Ready label and no marker`);
      bubblingClick(ph2RowFor(root, 'GA-AG7'));
      assert(byClass(root, 'graph-view-detail-panel').length === 0
        && JSON.stringify(env.opened) === JSON.stringify([[`${env.boardDir}/GA-AG7 Docs`, env.epicPath, false]]),
      `PH2-INSIGHTS-ABSENT-FAIL-SOFT: at ${width} a row tap with GraphInsights ${label} opens the note, as a tap on its ${width === 390 ? 'pill' : 'chip'} does`);
      bubblingClick(ph2MapNodeFor(root, 'GA-AG7'));
      assert.strictEqual(env.opened.length, 2,
        `PH2-INSIGHTS-ABSENT-FAIL-SOFT: at ${width} with GraphInsights ${label} the ${width === 390 ? 'pill' : 'chip'} tap opens the note too`);
    }
  }

  // ---- PH2B-TAP-TARGETS (PH2-ROWS-44) ----
  // MUTATION GUARD: PH2B-MUTANT-ROWS-32 turns RED at "PH2B-TAP-TARGETS
  // (PH2-ROWS-44): at 390, ..." if a row's min-height is 32px.
  // MUTATION GUARD: PH2B-MUTANT-STRIP-32 turns RED at the same label if the
  // strip's min-height is 32px.
  // MUTATION GUARD: PH2B-MUTANT-ROW-CONTENT-BOX turns RED at the same label
  // if a row's box-sizing is content-box.
  for (const make of [ph2MlEnv, ph2AgEnv, ph2PerfEnv]) {
    const root = await ph2Draw(ph2Track(make()), 390);
    for (const strip of byClass(root, 'graph-view-frontier-done-strip')) bubblingClick(strip);
    const targets = [...byClass(root, 'graph-view-frontier-row'), ...byClass(root, 'graph-view-frontier-done-strip')];
    assert(targets.length > 0 && targets.every((target) => {
      const css = cssEffective(target.style.cssText);
      return css['min-height'] === '44px' && css['box-sizing'] === 'border-box' && !('height' in css) && !('max-height' in css);
    }) && byClass(root, 'graph-view-frontier-done-rows').every((rows) => rows.children.length > 0),
    `PH2B-TAP-TARGETS (PH2-ROWS-44): at 390, ${targets.length} frontier rows and done strips, expanded rows included, each have min-height 44px with border-box sizing and no height or max-height`);
  }

  // ---- PH2-ZERO-WRITES ----
  // The list sits after the legend on both presentations: in the root right
  // after the compact host, whose last child is the legend, at 390, and
  // right after the legend at 1024.
  // MUTATION GUARD: PH2-MUTANT-LIST-BEFORE-MAP turns RED at
  // "PH2-ZERO-WRITES: at 390 ..." if the list is drawn before the map.
  for (const make of [ph2MlEnv, ph2AgEnv, ph2DvEnv, ph2PerfEnv]) {
    const compact = await ph2Draw(ph2Track(make()), 390);
    const host = byClass(compact, 'graph-view-compact')[0];
    const list = byClass(compact, 'graph-view-frontier')[0];
    assert(host && list && list.parent === compact && compact.children.indexOf(list) === compact.children.indexOf(host) + 1
      && host.children.at(-1)?.className === 'graph-view-legend',
    `PH2-ZERO-WRITES: at 390 the ${make === ph2MlEnv ? 'Mobile Load Performance' : make === ph2AgEnv ? 'Frontier Groups' : make === ph2DvEnv ? 'Dataview' : 'Perf'} list follows the compact host, whose last child is the legend`);
    const wide = await ph2Draw(ph2Track(make()), 1024);
    const wideList = byClass(wide, 'graph-view-frontier')[0];
    assert(wideList && wide.children.indexOf(wideList) === wide.children.findIndex((child) => child.className === 'graph-view-legend') + 1,
      'PH2-ZERO-WRITES: at 1024 the list directly follows the legend');
  }
  assert.deepStrictEqual(ph2Envs.flatMap((env) => env.mutations), [],
    `PH2-ZERO-WRITES: the ${ph2Envs.length} tracked PH-2 fixture vaults record no vault, adapter, frontmatter, or metadata mutator call across their renders and row, pill, chip, strip, and jump-link taps`);

  // ---- PH-2 render plumbing ----
  // MUTATION GUARD: PH2-MUTANT-LIST-THROW-ESCAPES turns RED at "PH-2: a
  // frontier list that throws ..." if the fault escapes render().
  // MUTATION GUARD: PH2-MUTANT-LIST-ANY-SCOPE turns RED at "PH-2:
  // _renderFrontierList at scope project ..." if the scope guard is dropped.
  // MUTATION GUARD: PH2-MUTANT-NO-LANE-ORDER-HANDOFF turns RED at
  // "PH-2: render() hands the board's lane order ..." if render() passes an
  // empty laneOrder.
  {
    class FaultyFrontier extends GraphView {
      _renderFrontierList() { throw new Error('frontier fault'); }
    }
    for (const width of [390, 1024]) {
      const root = await ph2Draw(ph2Track(ph2MlEnv()), width, { view: new FaultyFrontier({ lifecycleApi }) });
      assert(byClass(root, 'graph-view-canvas').length === 1 && byClass(root, 'graph-view-frontier').length === 0
        && JSON.stringify(byClass(root, 'warning-render-error').map((row) => row.textContent)) === JSON.stringify(['GraphView: frontier fault']),
      `PH-2: a frontier list that throws at ${width} leaves the map drawn and adds one render_error row naming the fault`);
    }
    for (const scope of ['project', undefined, 'Epic']) {
      const { root, drawn } = ph2List([ph2Node('GA-X First', 'planning')], [], [], { scope });
      assert(drawn === null && root.children.length === 0,
        `PH-2: _renderFrontierList at scope ${String(scope)} draws nothing and returns null`);
    }
    const { root: truthyStub, drawn: truthyDrawn } = ph2List([ph2Node('GA-S1 Stub', null, { isStub: 1 }), ph2Node('GA-X First', 'planning')], [], [], { analysis: null });
    assert(truthyDrawn && byClass(truthyStub, 'graph-view-frontier-row').length === 1
      && byClass(truthyStub, 'graph-view-frontier-id')[0]?.textContent === 'GA-X',
    'PH-2: a node whose isStub is truthy but not true gets no row, as the legend skips it');
    const { root: noOptions } = (() => {
      const root = element();
      return { root, drawn: new GraphView({ dashboard, lifecycleApi })._renderFrontierList(root, [ph2Node('GA-X First', 'planning')], null, [], null) };
    })();
    assert.strictEqual(noOptions.children.length, 0, 'PH-2: _renderFrontierList with no options draws nothing');
    const { root: stubsOnly, drawn: stubsDrawn } = ph2List([ph2Node('GA-S1 Stub', null, { isStub: true })], [], []);
    assert(stubsDrawn === null && stubsOnly.children.length === 0,
      'PH-2: _renderFrontierList over cross-epic stubs only draws nothing and returns null');
    // GA-LH2 is first in the In Planning lane and drawn after GA-LH1.
    const handoff = ph2Track(ph2Env('Lane Handoff', [
      { card: 'GA-LH0 Base', status: 'completed' },
      { card: 'GA-LH1 Alpha', status: 'planning' },
      { card: 'GA-LH2 Beta', status: 'planning', depends_on: ['[[GA-LH0 Base]]'] },
    ], ['GA-LH2 Beta', 'GA-LH1 Alpha']));
    for (const width of [390, 1024]) {
      const root = await ph2Draw(handoff, width);
      assert.deepStrictEqual(byClass(root, 'graph-view-chip').map((chip) => (byClass(chip, 'graph-view-pill-id')[0] || byClass(chip, 'graph-view-chip-id')[0]).textContent),
        ['GA-LH1', 'GA-LH0', 'GA-LH2'], `PH-2: render() at ${width} draws GA-LH1 before GA-LH2`);
      assert.deepStrictEqual(ph2Read(root).groups.map((group) => group.slice(1)), [
        ['Next up 1', ['GA-LH2', 'planning', 'next', null]],
        ['Ready 1', ['GA-LH1', 'planning', 'ready', null]],
        ['Done 1', ['GA-LH0', 'done', null, null]],
      ], `PH-2: render() hands the board's lane order to the list at ${width}, so GA-LH2, first in In Planning and drawn after GA-LH1, is Next up`);
    }
  }
  // Two widgets drawn by one GraphView instance keep separate list state.
  // MUTATION GUARD: PH2-MUTANT-STRIP-STATE-ON-INSTANCE turns RED at
  // "PH-2: two Perf roots drawn by one instance ..." if the strip's expanded
  // state lives on the instance.
  for (const width of [390, 1024]) {
    const view = new GraphView({ lifecycleApi });
    const first = await ph2Draw(ph2Track(ph2PerfEnv()), width, { view });
    const second = await ph2Draw(ph2Track(ph2PerfEnv()), width, { view });
    const secondAtRest = JSON.stringify(domShape(second));
    bubblingClick(byClass(first, 'graph-view-frontier-done-strip')[0]);
    const secondUntouched = JSON.stringify(domShape(second)) === secondAtRest;
    bubblingClick(byClass(second, 'graph-view-frontier-done-strip')[0]);
    bubblingClick(byClass(first, 'graph-view-frontier-done-strip')[0]);
    assert(secondUntouched && byClass(first, 'graph-view-frontier-done-rows').length === 0
      && byClass(second, 'graph-view-frontier-done-rows')[0]?.children.length === 4
      && byClass(second, 'graph-view-frontier-done-strip')[0].textContent === '4 done · hide',
    `PH-2: two Perf roots drawn by one instance at ${width}: expanding the first leaves the second folded, and folding the first leaves the second expanded`);
    const ml = await ph2Draw(ph2Track(ph2MlEnv()), width, { view });
    const ag = await ph2Draw(ph2Track(ph2AgEnv()), width, { view });
    bubblingClick(ph2RowFor(ml, 'GA-ML9'));
    bubblingClick(ph2RowFor(ag, 'GA-AG6'));
    assert(byClass(ml, 'graph-view-detail-id')[0]?.textContent === 'GA-ML9' && byClass(ag, 'graph-view-detail-id')[0]?.textContent === 'GA-AG6'
      && byClass(ag, 'graph-view-frontier-next').length === 1 && ph2RowFor(ag, 'GA-AG6').children.length === 2
      && byClass(ml, 'graph-view-frontier-next').length === 0,
    `PH-2: Mobile Load Performance and Frontier Groups roots drawn by one instance at ${width} each select their own row, and only Frontier Groups draws a next badge`);
  }
  global.app = ph2Saved.app;
  global.customJS = ph2Saved.customJS;

  console.log(`BL6-RECEIPTS ${JSON.stringify(bl6ReceiptSnapshot())}`);
  finishHarness();
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
