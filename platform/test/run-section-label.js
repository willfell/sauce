#!/usr/bin/env node
/**
 * run-section-label.js — SectionLabel renders an hr + uppercase label div, and
 * the legacy project-helper copy is gone (single source of truth).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const MECH = path.join(ROOT, 'platform', 'mechanisms', 'section-label', 'section-label.js');
const LEGACY = path.join(ROOT, 'platform', 'blueprints', 'project', 'helpers', 'section-label.js');

function makeEl(tag) {
  const el = { tag, textContent: '', style: { cssText: '' }, children: [] };
  el.createEl = (t) => { const c = makeEl(t); el.children.push(c); return c; };
  return el;
}
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

const SRC = fs.existsSync(MECH) ? fs.readFileSync(MECH, 'utf8') : '';
const Cls = SRC ? new Function(`${SRC}\nreturn SectionLabel;`)() : null;

// SL1 — renders hairline hr + label div with the text (default top:false)
{
  const c = makeEl('div');
  if (Cls) new Cls().render({ container: c }, { text: 'Attendees' });
  const hasHr = c.children.some(x => x.tag === 'hr');
  const lbl = c.children.find(x => x.tag === 'div');
  ok('SL1 hr + label text', hasHr && lbl && lbl.textContent === 'Attendees');
}
// SL2 — top:true suppresses the hairline
{
  const c = makeEl('div');
  if (Cls) new Cls().render({ container: c }, { text: 'Today', top: true });
  ok('SL2 top:true no hr', !c.children.some(x => x.tag === 'hr'));
}
// SL3 — legacy project-helper copy removed (single source of truth)
ok('SL3 legacy copy gone', !fs.existsSync(LEGACY));

const allPass = results.every(([, p]) => p);
console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed`);
process.exit(allPass ? 0 : 1);
