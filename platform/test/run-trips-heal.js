'use strict';

// run-trips-heal.js — unit harness for the applyTripsConformanceHeal installer
// step (Task 7 of the trips-conformance refactor). The heal migrates PRE-refactor
// trip notes (folder-generic names: `Trip Atlas.md`, `Trip Flights.md`, ...) to
// the collision-free canonical shape (`<name>.md`, `<name> — <Section>.md`) with
// canonical section frontmatter + Breadcrumb/SectionLabel chrome, backing each
// trip up to .sauce-backup first. Highest-risk step: renames real user notes, so
// backup-first + idempotent + never-throws are asserted here.
//
// Zero-dep; mirrors run-wiki-to-docs-migration.js's fs-backed adapter + tmpdir
// approach. Direct require() of install.js's exported function — no vm sandbox.
//
//   node platform/test/run-trips-heal.js  → "N passed, 0 failed", exit 0 iff 0 fails.

const fs = require('fs');
const path = require('path');
const os = require('os');

const install = require('../install.js');
const applyTripsConformanceHeal = install.applyTripsConformanceHeal;

let passed = 0;
let failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

// Real-fs-backed VaultAdapter over a tmp dir. Mirrors the install-time CLI adapter
// shape (per run-wiki-to-docs-migration.js caseWTDMIG4). list() returns absolute-
// relative vault paths (folders/files) exactly as install.js expects.
function makeAdapter(tmpRoot) {
  return {
    basePath: tmpRoot,
    async exists(p) { return fs.existsSync(path.join(tmpRoot, p)); },
    async list(p) {
      const abs = path.join(tmpRoot, p);
      if (!fs.existsSync(abs)) return { folders: [], files: [] };
      const entries = fs.readdirSync(abs, { withFileTypes: true });
      const folders = entries.filter((e) => e.isDirectory()).map((e) => `${p}/${e.name}`);
      const files = entries.filter((e) => e.isFile()).map((e) => `${p}/${e.name}`);
      return { folders, files };
    },
    async read(p) { return fs.readFileSync(path.join(tmpRoot, p), 'utf8'); },
    async write(p, body) {
      const abs = path.join(tmpRoot, p);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
    },
    async remove(p) { fs.unlinkSync(path.join(tmpRoot, p)); },
    async mkdir(p) { fs.mkdirSync(path.join(tmpRoot, p), { recursive: true }); },
  };
}

// ---- Synthetic PRE-refactor trip fixture (folder-generic names, no chrome) ----
const PRE_ATLAS = `---
type: trip
name: "Dave's Wedding"
created_at: "2026-01-09T09:00:00-07:00"
start_date: "2026-06-01"
end_date: "2026-06-03"
location: "Denver, CO"
people: []
cssclasses:
  - wide
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripNavButtons" });
\`\`\`

## Mentions

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "BacklinkPanel", method: "render", args: [{ entityType: "trip" }] });
\`\`\`
`;

const PRE_FLIGHTS = `---
type: trip-section
section_kind: flights
section: "Flights"
created: 2026-01-09
tags:
  - trip
---

United 1234 departs DEN. See [[Trip Atlas]] for the itinerary. Also [[Trip Atlas|the trip]].
`;

const PRE_NOTES = `---
type: trip-section
section: "Notes"
created: 2026-01-10
tags:
  - trip
---

Random notes. Link back: [[Trip Atlas]].
`;

const PRE_HUB = `---
type: trips-hub
created_at: "2026-05-17T15:30:00-06:00"
tags:
  - trips-hub
cssclasses:
  - wide
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

## All Trips

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripsHubCards" });
\`\`\`
`;

function seed(adapter) {
  return (async () => {
    await adapter.write('spice/trips/daves-wedding/Trip Atlas.md', PRE_ATLAS);
    await adapter.write('spice/trips/daves-wedding/Trip Flights.md', PRE_FLIGHTS);
    await adapter.write('spice/trips/daves-wedding/Trip Notes.md', PRE_NOTES);
    await adapter.write('spice/trips/Trips.md', PRE_HUB);
  })();
}

// Recursively snapshot every file path -> content under tmpRoot (excludes dirs).
function snapshot(tmpRoot) {
  const out = {};
  const walk = (rel) => {
    const abs = path.join(tmpRoot, rel);
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(childRel);
      else out[childRel] = fs.readFileSync(path.join(abs, e.name), 'utf8');
    }
  };
  walk('');
  return out;
}

async function run() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trips-heal-'));
  try {
    const adapter = makeAdapter(tmpRoot);
    await seed(adapter);
    const tp = { app: { vault: { adapter } } };
    const history = [];
    const git = { commit: 'x', tag: 'y', dirty: false };

    await applyTripsConformanceHeal(tp, history, git);

    const tripDir = 'spice/trips/daves-wedding';

    // TRIPHEAL-1 — atlas renamed to the sanitized display name.
    ok('TRIPHEAL-1.1 Dave\'s Wedding.md exists', await adapter.exists(`${tripDir}/Dave's Wedding.md`));
    ok('TRIPHEAL-1.2 Trip Atlas.md gone', !(await adapter.exists(`${tripDir}/Trip Atlas.md`)));

    // TRIPHEAL-2 — section renamed + canonical frontmatter.
    ok('TRIPHEAL-2.1 "Dave\'s Wedding — Flights.md" exists', await adapter.exists(`${tripDir}/Dave's Wedding — Flights.md`));
    ok('TRIPHEAL-2.2 Trip Flights.md gone', !(await adapter.exists(`${tripDir}/Trip Flights.md`)));
    const flights = await adapter.read(`${tripDir}/Dave's Wedding — Flights.md`);
    ok('TRIPHEAL-2.3 type: trip-section', /^type:\s*trip-section\s*$/m.test(flights));
    ok('TRIPHEAL-2.4 section_kind: flights', /^section_kind:\s*flights\s*$/m.test(flights));
    ok('TRIPHEAL-2.5 section: "Flights"', /^section:\s*"Flights"\s*$/m.test(flights));
    ok('TRIPHEAL-2.6 trip: "[[Dave\'s Wedding]]"', /^trip:\s*"\[\[Dave's Wedding\]\]"\s*$/m.test(flights));
    ok('TRIPHEAL-2.7 trip_slug: daves-wedding', /^trip_slug:\s*daves-wedding\s*$/m.test(flights));
    ok('TRIPHEAL-2.8 created_at present', /^created_at:\s*/m.test(flights));
    ok('TRIPHEAL-2.9 no bare created: key', !/^created:\s*/m.test(flights));

    // TRIPHEAL-3 — Breadcrumb chrome injected on atlas, section, and hub.
    const atlas = await adapter.read(`${tripDir}/Dave's Wedding.md`);
    const hub = await adapter.read('spice/trips/Trips.md');
    ok('TRIPHEAL-3.1 Breadcrumb on atlas', atlas.includes('class: "Breadcrumb"'));
    ok('TRIPHEAL-3.2 Breadcrumb on Flights section', flights.includes('class: "Breadcrumb"'));
    ok('TRIPHEAL-3.3 Breadcrumb on hub', hub.includes('class: "Breadcrumb"'));

    // TRIPHEAL-4 — hub `## All Trips` converted to a SectionLabel block.
    ok('TRIPHEAL-4.1 hub no longer has `## All Trips`', !/^##\s+All Trips\s*$/m.test(hub));
    ok('TRIPHEAL-4.2 hub has SectionLabel "All Trips"', /class:\s*"SectionLabel"[\s\S]*All Trips/.test(hub));

    // atlas `## Mentions` → SectionLabel (present alongside a BacklinkPanel).
    ok('TRIPHEAL-4.3 atlas no longer has `## Mentions`', !/^##\s+Mentions\s*$/m.test(atlas));
    ok('TRIPHEAL-4.4 atlas has SectionLabel "Mentions"', /class:\s*"SectionLabel"[\s\S]*Mentions/.test(atlas));

    // TRIPHEAL-5 — backup taken before writes.
    const backupRoot = path.join(tmpRoot, '.sauce-backup/trips/daves-wedding');
    let backupAtlasFound = false;
    if (fs.existsSync(backupRoot)) {
      for (const tsDir of fs.readdirSync(backupRoot)) {
        if (fs.existsSync(path.join(backupRoot, tsDir, 'Trip Atlas.md'))) backupAtlasFound = true;
      }
    }
    ok('TRIPHEAL-5 .sauce-backup/trips/daves-wedding/<ts>/Trip Atlas.md exists', backupAtlasFound);

    // TRIPHEAL-6 — link repair rewrote `[[Trip Atlas]]` → `[[Dave's Wedding]]`.
    ok('TRIPHEAL-6.1 [[Trip Atlas]] repaired in Flights body', flights.includes("[[Dave's Wedding]]"));
    ok('TRIPHEAL-6.2 [[Trip Atlas|the trip]] repaired', flights.includes("[[Dave's Wedding|the trip]]"));
    ok('TRIPHEAL-6.3 no stray [[Trip Atlas]] left', !flights.includes('[[Trip Atlas]]') && !flights.includes('[[Trip Atlas|'));

    // TRIPHEAL-7 — IDEMPOTENT: second run writes zero files (snapshot equal).
    const before = snapshot(tmpRoot);
    const history2 = [];
    await applyTripsConformanceHeal(tp, history2, git);
    const after = snapshot(tmpRoot);
    const beforeKeys = Object.keys(before).sort();
    const afterKeys = Object.keys(after).sort();
    ok('TRIPHEAL-7.1 same file set after 2nd run', JSON.stringify(beforeKeys) === JSON.stringify(afterKeys),
      `before=${beforeKeys.length} after=${afterKeys.length}`);
    let allEqual = true;
    let firstDiff = null;
    for (const k of beforeKeys) {
      if (before[k] !== after[k]) { allEqual = false; firstDiff = k; break; }
    }
    ok('TRIPHEAL-7.2 all file contents identical after 2nd run', allEqual, firstDiff ? `diff at ${firstDiff}` : '');

    await runFrontmatterEdgeCases();

    console.log(`\nrun-trips-heal.js: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// TRIPHEAL-8 — frontmatter regex edge cases: a truly PRE-refactor trip whose
// atlas frontmatter has ONLY `type: trip` + `name:` (no created_at), a section
// with a MULTI-tag block (must keep `- hotels`, since the lone-`trip` strip only
// fires on the single-tag case) + a date-only `created:` (coerced to ISO+TZ) +
// no `section_kind` (derived from the legacy basename `Trip Stay` → stay), and a
// section with a LONE `trip` tag (must be stripped). Verifies + idempotency.
async function runFrontmatterEdgeCases() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trips-heal-fm-'));
  try {
    const adapter = makeAdapter(tmpRoot);
    await adapter.write('spice/trips/euro-trip/Trip Atlas.md',
      `---\ntype: trip\nname: "Euro Trip 2026"\n---\nbody [[Trip Atlas]]`);
    await adapter.write('spice/trips/euro-trip/Trip Stay.md',
      `---\ntype: note\ncreated: 2026-02-02\ntags:\n  - trip\n  - hotels\n---\nHotel Ritz. [[Trip Atlas]]`);
    await adapter.write('spice/trips/euro-trip/Trip Notes.md',
      `---\ntype: note\ntags:\n  - trip\n---\nnotes [[Trip Atlas]]`);
    const tp = { app: { vault: { adapter } } };
    const git = { commit: 'x', tag: 'y', dirty: false };
    await applyTripsConformanceHeal(tp, [], git);

    const dir = 'spice/trips/euro-trip';
    const stay = await adapter.read(`${dir}/Euro Trip 2026 — Stay.md`);
    ok('TRIPHEAL-8.1 legacy basename → section_kind: stay (no fm kind)', /^section_kind:\s*stay\s*$/m.test(stay));
    ok('TRIPHEAL-8.2 date-only created: coerced to ISO+TZ created_at',
      /^created_at:\s*"2026-02-02T00:00:00[+-]\d{2}:\d{2}"\s*$/m.test(stay));
    ok('TRIPHEAL-8.3 multi-tag block preserved (- hotels kept)', /-\s*hotels/.test(stay));
    ok('TRIPHEAL-8.4 multi-tag block preserved (- trip kept)', /-\s*trip\b/.test(stay));

    const notes = await adapter.read(`${dir}/Euro Trip 2026 — Notes.md`);
    ok('TRIPHEAL-8.5 lone `trip` tag stripped', !/^tags:/m.test(notes));
    ok('TRIPHEAL-8.6 lone-tag note got fresh created_at', /^created_at:\s*/m.test(notes));

    // Idempotency across the edge-case fixture too.
    const before = snapshot(tmpRoot);
    await applyTripsConformanceHeal(tp, [], git);
    const after = snapshot(tmpRoot);
    const same = JSON.stringify(Object.keys(before).sort()) === JSON.stringify(Object.keys(after).sort())
      && Object.keys(before).every((k) => before[k] === after[k]);
    ok('TRIPHEAL-8.7 idempotent across frontmatter edge cases', same);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

run();
