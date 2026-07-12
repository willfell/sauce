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
// TCB-SPEC — hub: primary New Trip. trip atlas: primary Add link + overflow manage-links/new-section.
// trip-section: primary keyed on section_kind. trip-board-card: bare leaf.
{
  const spec = cfg.surfaceSpec;
  const h = spec({ context: 'trips-hub' });
  const a = spec({ context: 'trip' });
  const bc = spec({ context: 'trip-board-card' });
  ok('TCB-SPEC-1 hub: primary new-trip + not leaf', h.primary.id === 'new-trip' && h.leaf === false);
  ok('TCB-SPEC-2 trip atlas: primary add-link + not leaf', a.primary.id === 'add-link' && a.leaf === false);
  ok('TCB-SPEC-3 trip atlas: overflow manage-links + new-section',
    a.overflow.some(o => o.id === 'manage-links') && a.overflow.some(o => o.id === 'new-section'));
  ok('TCB-SPEC-4 flights section: primary add-flight',
    spec({ context: 'trip-section', sectionKind: 'flights' }).primary.id === 'add-flight');
  ok('TCB-SPEC-5 stay section: primary add-stay',
    spec({ context: 'trip-section', sectionKind: 'stay' }).primary.id === 'add-stay');
  ok('TCB-SPEC-6 packing-list section: primary add-packing-item',
    spec({ context: 'trip-section', sectionKind: 'packing-list' }).primary.id === 'add-packing-item');
  ok('TCB-SPEC-7 packing-list section: overflow add-packing-category',
    spec({ context: 'trip-section', sectionKind: 'packing-list' }).overflow.some(o => o.id === 'add-packing-category'));
  ok('TCB-SPEC-8 to-do section: primary add-task',
    spec({ context: 'trip-section', sectionKind: 'to-do' }).primary.id === 'add-task');
  ok('TCB-SPEC-9 notes section: primary null + leaf',
    spec({ context: 'trip-section', sectionKind: 'notes' }).primary === null && spec({ context: 'trip-section', sectionKind: 'notes' }).leaf === true);
  ok('TCB-SPEC-10 trip-board-card: bare leaf', bc.leaf === true && bc.primary === null);
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
{
  // TCB-DISPATCH-3 — new-section with no tripSlug must decline gracefully, not call _createTripSection.
  const calls2 = [];
  const prevCJS2 = global.customJS;
  global.customJS = {
    TripNavButtons: {
      _promptForSectionTitle: async () => { calls2.push('prompted'); return 'Extra'; },
      _createTripSection: async () => { calls2.push('created'); return 'x'; },
    },
  };
  global.Notice = function () {};
  await cfg.dispatch({}, { context: 'trip', tripSlug: null, tripName: 'Test Trip' }, 'new-section');
  global.customJS = prevCJS2;
  ok('TCB-DISPATCH-3 new-section with no tripSlug declines gracefully', calls2.length === 0);
}
{
  // TCB-DISPATCH-4 — per-section actions route to the right helpers via customJS instances.
  const calls = [];
  const prevCJS = global.customJS;
  class TEL {
    static _flightFields() { return [{ name: 'airline' }]; }
    static _stayFields() { return [{ name: 'name' }]; }
    static _packingItemFields(cats) { calls.push({ packFields: cats }); return [{ name: 'item' }]; }
    openAdd(dv, spec) { calls.push({ add: spec.kind, key: spec.key, fields: spec.fields }); }
    openAddCategory(dv, spec) { calls.push({ addCat: spec.key }); }
  }
  global.customJS = {
    TripEntryList: new TEL(),
    TripLinks: { openAdd() { calls.push('link-add'); }, openManage() { calls.push('link-manage'); } },
    TaskDialog: { open(o) { calls.push({ task: o.surface, slug: o.trip && o.trip.slug }); } },
  };
  const dv = { current: () => ({ packing_items: [{ category: 'Clothing' }, { category: 'Toiletries' }, { category: 'Clothing' }] }) };
  const sec = { context: 'trip-section', tripSlug: 'test-trip', tripName: 'Test Trip' };
  cfg.dispatch(dv, sec, 'add-flight');
  cfg.dispatch(dv, sec, 'add-stay');
  cfg.dispatch(dv, sec, 'add-packing-item');
  cfg.dispatch(dv, sec, 'add-packing-category');
  cfg.dispatch(dv, { context: 'trip' }, 'add-link');
  cfg.dispatch(dv, { context: 'trip' }, 'manage-links');
  cfg.dispatch(dv, sec, 'add-task');
  global.customJS = prevCJS;
  ok('TCB-DISPATCH-4 add-flight → TripEntryList.openAdd(flights)', calls.some(c => c.add === 'flights' && c.key === 'flights' && Array.isArray(c.fields)));
  ok('TCB-DISPATCH-5 add-stay → TripEntryList.openAdd(stay)', calls.some(c => c.add === 'stay' && c.key === 'stays'));
  ok('TCB-DISPATCH-6 add-packing-item → openAdd(packing) with derived categories',
    calls.some(c => c.add === 'packing' && c.key === 'packing_items') &&
    calls.some(c => c.packFields && c.packFields.length === 2 && c.packFields.includes('Clothing') && c.packFields.includes('Toiletries')));
  ok('TCB-DISPATCH-7 add-packing-category → openAddCategory(packing_items)', calls.some(c => c.addCat === 'packing_items'));
  ok('TCB-DISPATCH-8 add-link/manage-links → TripLinks', calls.includes('link-add') && calls.includes('link-manage'));
  ok('TCB-DISPATCH-9 add-task → TaskDialog.open(trip)', calls.some(c => c.task === 'trip' && c.slug === 'test-trip'));
}
{
  // TCB-DISPATCH-10 — every per-section case is guarded: missing helpers never throw.
  const prevCJS = global.customJS;
  global.customJS = {};
  let threw = false;
  const dv = { current: () => ({}) };
  const sec = { context: 'trip-section', tripSlug: 't', tripName: 'T' };
  for (const id of ['add-flight', 'add-stay', 'add-packing-item', 'add-packing-category', 'add-link', 'manage-links', 'add-task']) {
    try { cfg.dispatch(dv, sec, id); } catch (_e) { threw = true; }
  }
  global.customJS = prevCJS;
  ok('TCB-DISPATCH-10 missing helpers never throw', threw === false);
}
console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
}
main();
