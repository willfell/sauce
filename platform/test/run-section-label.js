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

// SL4 — divider() returns an hr chrome hairline with the VISIBLE spec (2026-07-03
// UX pass: bumped var(--background-modifier-border) 12px → var(--background-modifier-
// border-hover) 18px, because the bare faint hairline was near-invisible on dark
// themes so button/search tiers read as one dense stack).
{
  const c = makeEl('div');
  let hr = null;
  if (Cls) hr = new Cls().divider({ container: c });
  const css = hr && hr.style && hr.style.cssText;
  ok(
    'SL4 divider() hr with border-top: border-hover + margin: 18px 0',
    hr && hr.tag === 'hr' &&
    /border-top:\s*1px solid var\(--background-modifier-border-hover\)/.test(css) &&
    /margin:\s*18px 0/.test(css)
  );
}
// SL5 — divider() accepts a bare container (no `.container` wrapper)
{
  const c = makeEl('div');
  let hr = null;
  if (Cls) hr = new Cls().divider(c);
  ok('SL5 divider() bare container', hr && hr.tag === 'hr' && c.children.includes(hr));
}

const allPass = results.every(([, p]) => p);
console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed`);
process.exit(allPass ? 0 : 1);
