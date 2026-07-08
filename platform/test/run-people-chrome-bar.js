#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const PeopleChromeBar = loadClass('platform/blueprints/people/scripts/people-chrome-bar.js', 'PeopleChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new PeopleChromeBar();
const cfg = inst._config();

// PCB-DETECT — classify by frontmatter type; null off-surface.
{
  const hub = cfg.detect({}, { file: { path: 'spice/people/People.md' }, type: 'people-hub' });
  const person = cfg.detect({}, { file: { path: 'spice/people/Jane Doe.md' }, type: 'person' });
  const off = cfg.detect({}, { file: { path: 'spice/other/x.md' }, type: 'meeting' });
  ok('PCB-DETECT-1 people-hub/person classify; non-people → null',
    hub && hub.context === 'people-hub' && person && person.context === 'person' && off === null);
}
// PCB-SPEC — no primary/overflow anywhere (creation is a separate EntityCreate block on the hub); person is leaf, hub is not.
{
  const h = cfg.surfaceSpec({ context: 'people-hub' });
  const p = cfg.surfaceSpec({ context: 'person' });
  ok('PCB-SPEC-1 hub: primary null + overflow empty + not leaf',
    h.primary === null && h.overflow.length === 0 && h.leaf === false);
  ok('PCB-SPEC-2 person: primary null + overflow empty + leaf',
    p.primary === null && p.overflow.length === 0 && p.leaf === true);
}
// PCB-DISPATCH — never throws on unknown id (no-op surface).
{
  let threw = false;
  try { cfg.dispatch({}, { context: 'person' }, 'unknown-id'); } catch (_e) { threw = true; }
  ok('PCB-DISPATCH-1 dispatch never throws (no-op surface)', !threw);
}
// PCB-DEST — destinations lead with a { section:"This people" } marker + include a People label entry;
// the hub omits its own self-link.
{
  const prevCJS = global.customJS;
  global.customJS = { ChromeBar: { openNavTarget: () => {} } };
  const person = cfg.destinations({}, { context: 'person', path: 'spice/people/Jane Doe.md' });
  const hub = cfg.destinations({}, { context: 'people-hub', path: 'spice/people/People.md' });
  global.customJS = prevCJS;
  ok('PCB-DEST-1 person destinations: This people marker + People label entry',
    person[0] && person[0].section === 'This people' && person.some((e) => e && e.label === 'People'));
  ok('PCB-DEST-2 hub omits its own People self-link', !hub.some((e) => e && e._navTarget === 'spice/people/People.md'));
}
console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
