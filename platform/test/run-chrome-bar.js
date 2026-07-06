#!/usr/bin/env node
/**
 * run-chrome-bar.js — ChromeBar is the shared per-surface chrome bar mechanism.
 * Drives the REAL ChromeBar (loaded via new Function — no module system in
 * customJS) against DOM + customJS stubs. ChromeBar is an INSTANCE (customJS
 * stores instances), so every case uses `new ChromeBar()`.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(relPath, className) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  return new Function(`${src}\nreturn ${className};`)();
}
const ChromeBar = loadClass('platform/mechanisms/chrome-bar/chrome-bar.js', 'ChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new ChromeBar();

// Minimal element supporting createEl (Obsidian) + appendChild/createElement +
// querySelector/getBoundingClientRect. Mirrors run-project-chrome-bar.js makeEl.
function makeEl(tag) {
  const el = { tag, textContent: '', innerHTML: '', className: '', style: { cssText: '', setProperty() {} }, children: [], onclick: null, disabled: false };
  el.createEl = (t, opts) => { const c = makeEl(t); if (opts && opts.cls) c.className = opts.cls; if (opts && opts.text) c.textContent = opts.text; el.children.push(c); return c; };
  el.appendChild = (c) => { el.children.push(c); return c; };
  el.querySelector = () => null;
  el.querySelectorAll = () => [];
  el.getBoundingClientRect = () => ({ left: 0, bottom: 0, width: 100 });
  el.remove = () => {};
  el.addEventListener = () => {};
  el.removeEventListener = () => {};
  return el;
}
function allDescendants(el) { const out = []; for (const c of (el.children || [])) { out.push(c); out.push(...allDescendants(c)); } return out; }

// ── CB-SMOKE-1 — CHROME_ICONS exposes the three control glyphs as SVG strings.
{
  const ic = inst.CHROME_ICONS;
  ok('CB-SMOKE-1 CHROME_ICONS has compass/chevronDown/moreHorizontal SVGs',
    ic && /svg/.test(ic.compass) && /svg/.test(ic.chevronDown) && /svg/.test(ic.moreHorizontal));
}

// ── (Task 3 appends CB-BTN-*, Task 4 CB-VAULT-*, Task 5 CB-RENDER-* here) ──
// PLACEHOLDER-ANCHOR: additional cases inserted above the summary block below.

function summarize() {
  const failed = results.filter(([, c]) => !c);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.error(`FAILED: ${failed.map(([n]) => n).join(', ')}`); process.exit(1); }
  process.exit(0);
}
summarize();
