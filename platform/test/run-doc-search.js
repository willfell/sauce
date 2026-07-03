#!/usr/bin/env node
/**
 * run-doc-search.js — behavioral harness for the graduated doc-search mechanism.
 * Asserts: single source of truth (legacy gone), matches() logic, _countTags(),
 * and render() strip + resultsContainer separation.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const MECH = path.join(ROOT, 'platform', 'mechanisms', 'doc-search', 'doc-search.js');
const LEGACY = path.join(ROOT, 'platform', 'blueprints', 'project', 'helpers', 'doc-search.js');

// --- Minimal DOM stub --------------------------------------------------------
function makeEl(tag) {
  const el = {
    tag, textContent: '', innerHTML: '', title: '', value: '',
    style: { cssText: '', background: '', color: '' }, children: [], attrs: {},
  };
  el.createEl = (t, o) => { const c = makeEl(t); if (o && o.text) c.textContent = o.text; el.children.push(c); return c; };
  el.addEventListener = () => {};
  el.dispatchEvent = () => {};
  el.remove = () => {};
  el.empty = () => { el.children.length = 0; };
  el.querySelector = () => null;
  return el;
}
global.localStorage = { _d:{}, getItem(k){return this._d[k]||null;}, setItem(k,v){this._d[k]=v;} };
global.app = { commands: { executeCommandById(){} } };
global.document = { querySelector: () => null };
global.Event = class { constructor(t){ this.type=t; } };
global.window = {};
function makeDv(pages) {
  const container = makeEl('div');
  return { container, pages: () => ({ where: () => pages }), current: () => ({}) };
}

// --- Load the class ----------------------------------------------------------
const SRC = fs.existsSync(MECH) ? fs.readFileSync(MECH, 'utf8') : '';
const DS = SRC ? new Function(`${SRC}\nreturn DocSearch;`)() : null;

// --- Assertions --------------------------------------------------------------
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

// DS1 — mechanism file exists at new path; legacy copy is gone (single source of truth)
ok('DS1 single source of truth', fs.existsSync(MECH) && !fs.existsSync(LEGACY));

// DS2 — matches() returns true when hasActiveFilter is false (fast-path)
{
  const inst = DS ? new DS() : null;
  const page = { file: { name: 'Something' }, tags: ['foo'] };
  ok('DS2 matches() fast-path (no active filter)', inst ? inst.matches(page, { hasActiveFilter: false }) : false);
}

// DS3 — matches() text filter: 'vpc' matches VPC Runbook, rejects Budget
{
  const inst = DS ? new DS() : null;
  const ctx = { text: 'vpc', hasActiveFilter: true, tags: new Set() };
  const pageMatch = { file: { name: 'VPC Runbook' }, tags: [] };
  const pageReject = { file: { name: 'Budget' }, tags: [] };
  ok('DS3 text filter: VPC matches', inst ? inst.matches(pageMatch, ctx) : false);
  ok('DS3 text filter: Budget rejected', inst ? !inst.matches(pageReject, ctx) : false);
}

// DS4 — matches() tag AND-logic: page tagged [aws, networking, x] matches; page tagged [aws] only → rejects
{
  const inst = DS ? new DS() : null;
  const ctx = { tags: new Set(['aws', 'networking']), hasActiveFilter: true, text: '' };
  const pageMatch = { file: { name: 'AWS VPC' }, tags: ['aws', 'networking', 'x'] };
  const pageReject = { file: { name: 'AWS Only' }, tags: ['aws'] };
  ok('DS4 tag AND: both tags match', inst ? inst.matches(pageMatch, ctx) : false);
  ok('DS4 tag AND: single tag rejected', inst ? !inst.matches(pageReject, ctx) : false);
}

// DS5 — _countTags() excludes the entityType tag
{
  const inst = DS ? new DS() : null;
  // pages tagged ["doc-note","aws"] → counts should have aws:1 but NOT "doc-note"
  const pages = [{ tags: ['doc-note', 'aws'], file: {} }];
  const counts = inst ? inst._countTags(pages, [], 'doc-note') : {};
  ok('DS5 _countTags excludes entityType tag', !('doc-note' in counts) && counts['aws'] === 1);
}

// DS6 — render() builds a permanent strip + separate resultsContainer; ctx has text=="" and hasActiveFilter===false
{
  const inst = DS ? new DS() : null;
  const pages = [];
  const dv = makeDv(pages);
  let ctx;
  try {
    ctx = inst ? inst.render(dv, {
      scopePath: 'spice/wiki',
      entityType: 'wiki-page',
      persist: false,
      onChange: () => {},
    }) : null;
  } catch (e) {
    ctx = null;
  }
  const hasResultsContainer = ctx && ctx.resultsContainer && ctx.resultsContainer !== dv.container;
  const stripIsDistinct = ctx && ctx.resultsContainer && dv.container.children.length >= 2;
  ok('DS6 render() ctx.text=="" and hasActiveFilter===false',
    ctx && ctx.text === '' && ctx.hasActiveFilter === false);
  ok('DS6 render() resultsContainer is distinct from strip', !!(hasResultsContainer && stripIsDistinct));
}

// DS7 — hideNativeSearch: true → strip has an input but NO scoped-search button;
//       default (omitted) → the button is still present. Walk the strip subtree
//       for created <input> / <button> elements (the button lives in row1 with the
//       input, so a recursive descend covers both).
function collectTags(el, tag, acc) {
  if (!el) return acc;
  if (el.tag === tag) acc.push(el);
  for (const child of (el.children || [])) collectTags(child, tag, acc);
  return acc;
}
{
  const inst = DS ? new DS() : null;
  const mkStrip = (opts) => {
    const dv = makeDv([]);
    try { inst.render(dv, opts); } catch (_e) {}
    // The permanent strip is the first child appended to dv.container.
    return dv.container.children[0] || null;
  };

  // default (hideNativeSearch omitted) — button present.
  const stripDefault = inst ? mkStrip({ scopePath: 'spice/wiki', entityType: 'wiki-page', persist: false, onChange: () => {} }) : null;
  const defInputs = collectTags(stripDefault, 'input', []);
  const defButtons = collectTags(stripDefault, 'button', []);
  ok('DS7 default: strip has input + Search button',
    !!stripDefault && defInputs.length >= 1 && defButtons.length >= 1);

  // hideNativeSearch: true — input present, NO button.
  const stripHidden = inst ? mkStrip({ scopePath: 'spice/wiki', entityType: 'wiki-page', persist: false, hideNativeSearch: true, onChange: () => {} }) : null;
  const hidInputs = collectTags(stripHidden, 'input', []);
  const hidButtons = collectTags(stripHidden, 'button', []);
  ok('DS7 hideNativeSearch: input present but NO button',
    !!stripHidden && hidInputs.length >= 1 && hidButtons.length === 0);
}

// --- Verdict -----------------------------------------------------------------
const passed = results.filter(([, p]) => p).length;
const total = results.length;
console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
