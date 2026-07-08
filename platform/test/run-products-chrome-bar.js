#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const ProductsChromeBar = loadClass('platform/blueprints/products/scripts/products-chrome-bar.js', 'ProductsChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new ProductsChromeBar();
const cfg = inst._config();

async function main() {

// PDCB-DETECT
{
  const hub = cfg.detect({}, { file: { path: 'spice/products/Products.md' }, type: 'products-hub' });
  const product = cfg.detect({}, { file: { path: 'spice/products/Acme.md' }, type: 'product' });
  const off = cfg.detect({}, { file: { path: 'spice/other/x.md' }, type: 'meeting' });
  ok('PDCB-DETECT-1 products-hub/product classify; non-products → null',
    hub && hub.context === 'products-hub' && product && product.context === 'product' && off === null);
}
// PDCB-SPEC
{
  const h = cfg.surfaceSpec({ context: 'products-hub' });
  const p = cfg.surfaceSpec({ context: 'product' });
  ok('PDCB-SPEC-1 hub: primary new-product + not leaf', h.primary.id === 'new-product' && h.leaf === false);
  ok('PDCB-SPEC-2 product: leaf + primary null + overflow empty', p.leaf === true && p.primary === null && p.overflow.length === 0);
}
// PDCB-DISPATCH
{
  const calls = [];
  const prevApp = global.app;
  global.app = {
    plugins: { plugins: { "templater-obsidian": { templater: { create_new_note_from_template: (tpl, folder) => { calls.push({ create: folder }); return Promise.resolve(); } } } } },
    vault: { getAbstractFileByPath: (p) => ({ path: p }) },
  };
  global.Notice = function () {};
  await cfg.dispatch({}, { context: 'products-hub' }, 'new-product');
  global.app = prevApp;
  ok('PDCB-DISPATCH-1 new-product → templater.create_new_note_from_template("spice/products")', calls.some(c => c.create === 'spice/products'));
}

console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
}

main();
