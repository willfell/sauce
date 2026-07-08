#!/usr/bin/env node
'use strict';

// run-chrome-bar-cycle3-heal.js — unit harness for cycle-3's CHROME_BAR_MAP /
// LEGACY_CLASSES / applyNoteChromeHeal wiring (trips, reader, people, products,
// teams, journal). _healNoteChromeBody and _healChromeBarMigration are pure
// string transforms (no DOM, no fs) — call install.js's exported functions
// directly with synthetic note bodies. Mirrors the assertion style of
// run-project-chrome-bar-heal.js. "N passed, M failed" — exit 0 iff M === 0.

const install = require('../install.js');
const _healNoteChromeBody = install._healNoteChromeBody;

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

// ---- trips: trip-section body carries Breadcrumb + SpaceNavButtons + TripNavButtons ----
{
  const before = `---
type: trip-section
section_kind: flights
section: "Flights"
trip: "[[Dave's Wedding]]"
trip_slug: daves-wedding
created_at: "2026-01-09T09:00:00-07:00"
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripNavButtons" });
\`\`\`
`;
  const after = _healNoteChromeBody(before, 'trip-section');
  ok('CBC3-TRIPS-1: trip-section heal inserts TripsChromeBar', after.includes('class: "TripsChromeBar"'));
  ok('CBC3-TRIPS-2: trip-section heal strips legacy Breadcrumb block', !after.includes('class: "Breadcrumb"'));
  ok('CBC3-TRIPS-3: trip-section heal strips legacy SpaceNavButtons block', !after.includes('class: "SpaceNavButtons"'));
  ok('CBC3-TRIPS-4: trip-section heal strips legacy TripNavButtons block', !after.includes('class: "TripNavButtons"'));
  ok('CBC3-TRIPS-5: idempotent — second pass is a no-op', _healNoteChromeBody(after, 'trip-section') === after);
}

// ---- reader: reader-article body carries Breadcrumb + SpaceNavButtons + ReaderArticleActions ----
{
  const before = `---
type: reader-article
status: unread
url: "https://example.com/article"
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ReaderArticleActions" });
\`\`\`
`;
  const after = _healNoteChromeBody(before, 'reader-article');
  ok('CBC3-READER-1: reader-article heal inserts ReaderChromeBar', after.includes('class: "ReaderChromeBar"'));
  ok('CBC3-READER-2: reader-article heal strips legacy ReaderArticleActions block', !after.includes('class: "ReaderArticleActions"'));
}

// ---- people: person body carries ONLY PersonNavButtons (no Breadcrumb/SpaceNavButtons) ----
// This is the special case: PersonNavButtons is NOT in LEGACY_CLASSES (its identity
// row is kept), so the early-return guard must special-case type==='person' to still
// proceed past the "no legacy chrome to strip" short-circuit.
{
  const before = `---
type: person
company: ""
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "PersonNavButtons" });
\`\`\`

# [[Jane Doe]]

## Notes
-
`;
  const after = _healNoteChromeBody(before, 'person');
  ok('CBC3-PEOPLE-1: person heal inserts PeopleChromeBar even with no legacy nav/action block', after.includes('class: "PeopleChromeBar"'));
  ok('CBC3-PEOPLE-2: person heal KEEPS the PersonNavButtons block (identity row)', after.includes('class: "PersonNavButtons"'));
  ok('CBC3-PEOPLE-3: PeopleChromeBar is inserted BEFORE PersonNavButtons', after.indexOf('PeopleChromeBar') < after.indexOf('PersonNavButtons'));
  ok('CBC3-PEOPLE-4: idempotent — second pass is a no-op', _healNoteChromeBody(after, 'person') === after);
}

// ---- people-hub: SpaceNavButtons present, gets stripped + PeopleChromeBar inserted ----
{
  const before = `---
type: people-hub
tags:
  - people-hub
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "EntityCreate", args: [{ instance: "person" }] });
\`\`\`

## All People
`;
  const after = _healNoteChromeBody(before, 'people-hub');
  ok('CBC3-PEOPLEHUB-1: people-hub heal inserts PeopleChromeBar', after.includes('class: "PeopleChromeBar"'));
  ok('CBC3-PEOPLEHUB-2: people-hub heal strips legacy SpaceNavButtons', !after.includes('class: "SpaceNavButtons"'));
  ok('CBC3-PEOPLEHUB-3: people-hub heal KEEPS the EntityCreate button', after.includes('class: "EntityCreate"'));
}

// ---- products: product body carries SpaceNavButtons only ----
{
  const before = `---
type: product
name: "Acme"
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

# Acme

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProductPageCards" });
\`\`\`
`;
  const after = _healNoteChromeBody(before, 'product');
  ok('CBC3-PRODUCTS-1: product heal inserts ProductsChromeBar', after.includes('class: "ProductsChromeBar"'));
  ok('CBC3-PRODUCTS-2: product heal strips legacy SpaceNavButtons', !after.includes('class: "SpaceNavButtons"'));
  ok('CBC3-PRODUCTS-3: product heal KEEPS ProductPageCards', after.includes('class: "ProductPageCards"'));
}

// ---- teams: team body carries SpaceNavButtons only ----
{
  const before = `---
type: team
name: "Platform"
products:
  - "[[Acme]]"
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

# Platform
`;
  const after = _healNoteChromeBody(before, 'team');
  ok('CBC3-TEAMS-1: team heal inserts TeamsChromeBar', after.includes('class: "TeamsChromeBar"'));
  ok('CBC3-TEAMS-2: team heal strips legacy SpaceNavButtons', !after.includes('class: "SpaceNavButtons"'));
}

// ---- journal: SpaceNavButtons + a trailing bare "---" divider ----
{
  const before = `---
type: journal
daily_note: "[[Wednesday-2026-01-14]]"
tags:
  - life
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

---
`;
  const after = _healNoteChromeBody(before, 'journal');
  ok('CBC3-JOURNAL-1: journal heal inserts JournalChromeBar', after.includes('class: "JournalChromeBar"'));
  ok('CBC3-JOURNAL-2: journal heal strips legacy SpaceNavButtons', !after.includes('class: "SpaceNavButtons"'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
