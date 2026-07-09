#!/usr/bin/env node
'use strict';

// run-meetings-hub-chrome-bar-heal.js — unit harness for
// applyMeetingsHubChromeBarHeal (meeting-hub is a tag-based hub — `tags:
// meetings-hub`, no `type:` field — so it falls outside applyNoteChromeHeal's
// type-keyed dispatch; see note-chrome.md §6). Two layers: (1) the pure body
// transforms (reused _healChromeBarMigration + _stripMeetingsHubEntityCreateBlock,
// v0.205.0: "+ New Meeting" moved to MeetingChromeBar's own primary) against
// REALISTIC deployed Meeting Hub note bodies; (2) the file-walking heal
// against a fake adapter.

const install = require('../install.js');
const _healChromeBarMigration = install._healChromeBarMigration;
const _stripMeetingsHubEntityCreateBlock = install._stripMeetingsHubEntityCreateBlock;
const applyMeetingsHubChromeBarHeal = install.applyMeetingsHubChromeBarHeal;

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

// A realistic pre-fix deployed Meeting Hub note body (raw SpaceNavButtons block
// + a literal `---` divider before the EntityCreate block).
const LEGACY_HUB_BODY = `---
created: 2026-07-01 09:00
tags:
  - headspace
  - meetings-hub
  - 2026/07/01
cssclasses:
  - wide
  - cards
  - cards-cols-2
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

---

\`\`\`dataviewjs
// entity-create:meeting — installer-managed; do not delete this comment
await dv.view("ranch/views/customjs-guard", { class: "EntityCreate", args: [{ instance: "meeting" }] });
\`\`\`


---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Today's Meetings" }] });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "MeetingsHubCards" });
\`\`\`

---
`;

// ---- pure transform: strips SpaceNavButtons, inserts MeetingChromeBar, strips the
// now-redundant EntityCreate block (its "+ New Meeting" moved to the bar's own
// primary), leaves the cards list content intact ----
{
  let after = _healChromeBarMigration(LEGACY_HUB_BODY, 'meeting', 'MeetingChromeBar');
  after = _stripMeetingsHubEntityCreateBlock(after);
  ok('MHCBH-1 strips the legacy SpaceNavButtons block', !after.includes('SpaceNavButtons'));
  ok('MHCBH-2 inserts a MeetingChromeBar block', /class:\s*"MeetingChromeBar"/.test(after));
  ok('MHCBH-3 strips the now-redundant entity-create block ("+ New Meeting" moved to the primary)',
    !after.includes('entity-create:meeting') && !after.includes('class: "EntityCreate"'));
  ok('MHCBH-4 leaves the cards list (MeetingsHubCards) intact', after.includes('class: "MeetingsHubCards"'));
  ok('MHCBH-5 idempotent — already-migrated body is returned unchanged',
    _stripMeetingsHubEntityCreateBlock(_healChromeBarMigration(after, 'meeting', 'MeetingChromeBar')) === after);
}

// ---- pure transform: a note ALREADY chrome-swapped last cycle (MeetingChromeBar
// present, EntityCreate block still standalone below it — the shape every real
// vault's existing hub notes carry today) still gets the EntityCreate block
// stripped, even though _healChromeBarMigration itself is a no-op (idempotent
// guard: body already contains "MeetingChromeBar") ----
{
  const ALREADY_SWAPPED_BODY = `---
tags:
  - meetings-hub
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "MeetingChromeBar" });
\`\`\`


\`\`\`dataviewjs
// entity-create:meeting — installer-managed; do not delete this comment
await dv.view("ranch/views/customjs-guard", { class: "EntityCreate", args: [{ instance: "meeting" }] });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Today's Meetings" }] });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "MeetingsHubCards" });
\`\`\`
`;
  const chromeStepNoOp = _healChromeBarMigration(ALREADY_SWAPPED_BODY, 'meeting', 'MeetingChromeBar');
  const after = _stripMeetingsHubEntityCreateBlock(chromeStepNoOp);
  ok('MHCBH-6 chrome-swap step is a true no-op on an already-swapped body', chromeStepNoOp === ALREADY_SWAPPED_BODY);
  ok('MHCBH-7 the entity-create strip still fires on that already-swapped body',
    !after.includes('entity-create:meeting') && after.includes('class: "MeetingsHubCards"'));
}

// ---- non-hub-tagged body is never touched by the file-walking heal (regex guard) ----
{
  const NON_HUB_BODY = `---
type: meeting
tags:
  - project
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "MeetingLeafActions" });
\`\`\`
`;
  ok('MHCBH-8 a meeting LEAF note (type: meeting, no meetings-hub tag) is not a hub-tag match',
    !/^\s*-\s*["']?meetings-hub["']?\s*$/m.test(NON_HUB_BODY));
}

// ---- file-walking heal against a fake adapter: reads only meetings-hub-tagged notes, backs up, writes, is idempotent ----
async function runAdapterCases() {
  function makeAdapter(files) {
    const written = {};
    const backups = {};
    return {
      files,
      written,
      backups,
      async exists(p) { return p === 'spice/meetings/hubs' || Object.prototype.hasOwnProperty.call(files, p); },
      async list(p) {
        if (p === 'spice/meetings/hubs') return { files: [], folders: ['spice/meetings/hubs/2026/07-July'] };
        if (p === 'spice/meetings/hubs/2026/07-July') return { files: Object.keys(files), folders: [] };
        return { files: [], folders: [] };
      },
      async read(p) { return files[p]; },
      async write(p, body) { written[p] = body; if (p.startsWith('.sauce-backup/')) backups[p] = body; },
      async mkdir(_p) { /* no-op */ },
    };
  }

  const history = [];
  const git = { commit: 'abc', tag: 'v0.0.0', dirty: false };
  const adapter = makeAdapter({
    'spice/meetings/hubs/2026/07-July/Meetings-2026-07-01.md': LEGACY_HUB_BODY,
  });
  const tp = { app: { vault: { adapter } } };

  await applyMeetingsHubChromeBarHeal(tp, history, git);
  const out = adapter.written['spice/meetings/hubs/2026/07-July/Meetings-2026-07-01.md'];
  ok('MHCBH-9 heals the one meetings-hub-tagged note found by the adapter walk',
    out && /class:\s*"MeetingChromeBar"/.test(out) && !out.includes('SpaceNavButtons') && !out.includes('entity-create:meeting'));
  const backedUp = Object.keys(adapter.backups).some((p) => p.includes('Meetings-2026-07-01.md'));
  ok('MHCBH-10 snapshots the pre-heal body to .sauce-backup before writing', backedUp);
  ok('MHCBH-11 pushes an info history event naming the healed target',
    history.some((h) => h.event === 'info' && h.step === 'meetings_hub_chrome_bar_heal' && h.target && h.target.includes('Meetings-2026-07-01.md')));

  // Re-run against the now-healed body — must be a true no-op (no second write).
  const history2 = [];
  const adapter2 = makeAdapter({
    'spice/meetings/hubs/2026/07-July/Meetings-2026-07-01.md': out,
  });
  const tp2 = { app: { vault: { adapter: adapter2 } } };
  await applyMeetingsHubChromeBarHeal(tp2, history2, git);
  ok('MHCBH-12 idempotent — a second run against an already-healed vault writes nothing',
    Object.keys(adapter2.written).length === 0);

  // A non-hub-tagged file under the same root is never touched.
  const history3 = [];
  const adapter3 = makeAdapter({
    'spice/meetings/hubs/2026/07-July/Meetings-2026-07-01.md': `---\ntags:\n  - personal\n---\n\nno chrome here\n`,
  });
  const tp3 = { app: { vault: { adapter: adapter3 } } };
  await applyMeetingsHubChromeBarHeal(tp3, history3, git);
  ok('MHCBH-13 skips a file under spice/meetings/hubs that lacks the meetings-hub tag',
    Object.keys(adapter3.written).length === 0);

  // Real-world shape: a note already chrome-swapped by the PRIOR cycle's heal
  // (MeetingChromeBar present, EntityCreate block still standalone) — the
  // adapter walk must still strip the now-redundant EntityCreate block.
  const ALREADY_SWAPPED_BODY = `---\ntags:\n  - meetings-hub\n---\n\n\`\`\`dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "MeetingChromeBar" });\n\`\`\`\n\n\`\`\`dataviewjs\n// entity-create:meeting — installer-managed; do not delete this comment\nawait dv.view("ranch/views/customjs-guard", { class: "EntityCreate", args: [{ instance: "meeting" }] });\n\`\`\`\n\n\`\`\`dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "MeetingsHubCards" });\n\`\`\`\n`;
  const history4 = [];
  const adapter4 = makeAdapter({
    'spice/meetings/hubs/2026/07-July/Meetings-2026-07-08.md': ALREADY_SWAPPED_BODY,
  });
  const tp4 = { app: { vault: { adapter: adapter4 } } };
  await applyMeetingsHubChromeBarHeal(tp4, history4, git);
  const out4 = adapter4.written['spice/meetings/hubs/2026/07-July/Meetings-2026-07-08.md'];
  ok('MHCBH-14 an already-chrome-swapped hub note still gets its EntityCreate block stripped',
    out4 && !out4.includes('entity-create:meeting') && out4.includes('class: "MeetingsHubCards"'));

  // Real-world stray: a note that predates the v0.49.0 marker-format
  // migration (that migration only rewrote the comment SYNTAX, it never
  // removed blocks) — outside-fence `<!-- entity-create:meeting -->` HTML
  // comment, no inside-fence JS comment at all. Found live in a real vault.
  const OLD_MARKER_FORMAT_BODY = `---\ntags:\n  - meetings-hub\ntype: meeting\n---\n\n\`\`\`dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "MeetingChromeBar" });\n\`\`\`\n\n<!-- entity-create:meeting -->\n\`\`\`dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "EntityCreate", args: [{ instance: "meeting" }] });\n\`\`\`\n\n## Today's Meetings\n\n\`\`\`dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "MeetingsHubCards" });\n\`\`\`\n`;
  const history5 = [];
  const adapter5 = makeAdapter({
    'spice/meetings/hubs/2026/05-May/Meetings-2026-05-15.md': OLD_MARKER_FORMAT_BODY,
  });
  const tp5 = { app: { vault: { adapter: adapter5 } } };
  await applyMeetingsHubChromeBarHeal(tp5, history5, git);
  const out5 = adapter5.written['spice/meetings/hubs/2026/05-May/Meetings-2026-05-15.md'];
  ok('MHCBH-15 a pre-v0.49.0 note (outside-fence <!-- entity-create:meeting --> comment) still gets stripped',
    out5 && !out5.includes('entity-create:meeting') && !out5.includes('class: "EntityCreate"') && out5.includes('class: "MeetingsHubCards"'));
}

runAdapterCases().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}).catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
