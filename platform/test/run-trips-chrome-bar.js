#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const TripsChromeBar = loadClass('platform/blueprints/trips/helpers/trips-chrome-bar.js', 'TripsChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new TripsChromeBar();
const cfg = inst._config();

// TCB-DETECT — classify by frontmatter type; kanban board notes are NOT matched.
{
  const hub = cfg.detect({}, { file: { path: 'spice/trips/Trips.md' }, type: 'trips-hub' });
  const atlas = cfg.detect({}, { file: { path: "spice/trips/daves-wedding/Dave's Wedding.md" }, type: 'trip', name: "Dave's Wedding", trip_slug: 'daves-wedding' });
  const section = cfg.detect({}, { file: { path: "spice/trips/daves-wedding/Dave's Wedding — Flights.md" }, type: 'trip-section', trip_slug: 'daves-wedding', section_kind: 'flights' });
  const card = cfg.detect({}, { file: { path: 'spice/trips/daves-wedding/board/Book flights.md' }, type: 'trip-board-card' });
  const board = cfg.detect({}, { file: { path: 'spice/trips/daves-wedding/board/daves-wedding-board.md' }, type: 'kanban' });
  const off = cfg.detect({}, { file: { path: 'spice/other/x.md' }, type: 'meeting' });
  ok('TCB-DETECT-1 trips-hub/trip/trip-section/trip-board-card classify',
    hub && hub.context === 'trips-hub' && atlas && atlas.context === 'trip' && section && section.context === 'trip-section' && card && card.context === 'trip-board-card');
  ok('TCB-DETECT-2 kanban board + non-trip → null', board === null && off === null);
}
// TCB-SPEC — hub: primary New Trip, not leaf. trip/trip-section/trip-board-card: overflow New Section.
{
  const h = cfg.surfaceSpec({ context: 'trips-hub' });
  const a = cfg.surfaceSpec({ context: 'trip' });
  const s = cfg.surfaceSpec({ context: 'trip-section' });
  const c = cfg.surfaceSpec({ context: 'trip-board-card' });
  ok('TCB-SPEC-1 hub: primary new-trip + not leaf', h.primary.id === 'new-trip' && h.leaf === false);
  ok('TCB-SPEC-2 trip atlas: primary null + overflow new-section + not leaf', a.primary === null && a.overflow.some(o => o.id === 'new-section') && a.leaf === false);
  ok('TCB-SPEC-3 trip-section: leaf + overflow new-section', s.leaf === true && s.overflow.some(o => o.id === 'new-section'));
  ok('TCB-SPEC-4 trip-board-card: leaf + overflow new-section', c.leaf === true && c.overflow.some(o => o.id === 'new-section'));
}
// TCB-DISPATCH — new-trip → prompt+_createTrip; new-section → prompt+_createTripSection.
async function main() {
{
  const calls = [];
  const prevCJS = global.customJS;
  global.customJS = {
    TripNavButtons: {
      _promptForTripDetails: async () => ({ name: 'Test Trip', slug: 'test-trip', start_date: '', end_date: '', location: '' }),
      _createTrip: async (details) => { calls.push({ createTrip: details.slug }); return 'spice/trips/test-trip/Test Trip.md'; },
      _promptForSectionTitle: async () => 'Extra',
      _createTripSection: async (tripDir, title) => { calls.push({ createSection: tripDir + '/' + title }); return tripDir + '/Test Trip — Extra.md'; },
    },
  };
  const dv = { current: () => ({ file: { path: 'spice/trips/test-trip/Test Trip.md' } }) };
  await cfg.dispatch(dv, { context: 'trips-hub' }, 'new-trip');
  await cfg.dispatch(dv, { context: 'trip', tripSlug: 'test-trip', tripName: 'Test Trip' }, 'new-section');
  global.customJS = prevCJS;
  ok('TCB-DISPATCH-1 new-trip → TripNavButtons._createTrip', calls.some(c => c.createTrip === 'test-trip'));
  ok('TCB-DISPATCH-2 new-section → TripNavButtons._createTripSection', calls.some(c => c.createSection && c.createSection.includes('Extra')));
}
console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
}
main();
