#!/usr/bin/env node
'use strict';

// run-daily-home-chrome-bar-heal.js — behavioral harness for the Daily/Home
// chrome-bar forward-migration heal. Mirrors run-project-chrome-bar-heal.js:
// an in-memory vault-adapter stub feeds the ACTUAL exported install.js
// functions (applyDailyHomeChromeBarHeal async driver + the two pure body
// transforms _dailyChromeBarBody / _homeChromeBarBody), then asserts on the
// rewritten file bytes, the .sauce-backup snapshot, and the history events.
//
// WHY a bespoke heal (not a CHROME_BAR_MAP entry driven by applyNoteChromeHeal):
// applyNoteChromeHeal runs early in the install sequence, BEFORE
// applyHomeScaffoldHeal scaffolds spice/home/Home.md. This heal is wired to run
// immediately AFTER applyHomeScaffoldHeal so a freshly-scaffolded Home is in
// scope. It matches applyProjectChromeBarHeal's posture: .sauce-backup-first,
// idempotent, never throws, git-fielded history events.

const install = require('../install.js');
const {
  applyDailyHomeChromeBarHeal,
  _dailyChromeBarBody,
  _homeChromeBarBody,
} = install;

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

// In-memory adapter stub mirroring run-project-chrome-bar-heal.js exactly:
// directory existence is DERIVED from every file path's ancestor segments, so
// adapter.exists("spice/daily") is true even with no explicit mkdir — matching
// the real Obsidian adapter (folders report as existing) that the heal's
// `if (!(await adapter.exists("spice/daily")))` discovery guard relies on.
function makeAdapter(initial) {
  const files = new Map(Object.entries(initial || {}));
  const dirs = new Set();
  const seedDirs = (p) => { const parts = p.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')); };
  for (const p of files.keys()) seedDirs(p);
  return {
    async exists(p) { return files.has(p) || dirs.has(p); },
    async list(p) {
      const folders = [], filesAt = [];
      for (const d of dirs) { if (d !== p && d.startsWith(p + '/') && d.indexOf('/', p.length + 1) === -1) folders.push(d); }
      for (const f of files.keys()) { if (f.startsWith(p + '/') && f.indexOf('/', p.length + 1) === -1) filesAt.push(f); }
      return { folders, files: filesAt };
    },
    async read(p) { if (!files.has(p)) throw new Error('ENOENT ' + p); return files.get(p); },
    async write(p, b) { files.set(p, b); seedDirs(p); },
    async mkdir(p) { dirs.add(p); },
    _files: files,
  };
}
const makeTp = (adapter) => ({ app: { vault: { adapter } } });
// applyProjectChromeBarHeal reads git.commit/git.tag/git.dirty on every history
// push, so the stub must expose those keys (null is fine — it's only stamped).
const GIT = { commit: 'abcdef1234567890', tag: null, dirty: false };

const LEGACY_DAILY = `---
type: cowork-daily
day: "2026-07-08"
day_label: "Wednesday, July 8, 2026"
created_at: "2026-07-08T08:00:00-0700"
cssclasses:
  - wide
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceDailyDashboard" });
\`\`\`

---
`;

// LEGACY_DAILY_OLD_TYPE — the shape real consumer-vault notes still carry
// from before the daily@v0.5.0 cowork-flavor frontmatter rename: type: daily
// (not cowork-daily), no day/day_label fields. Found live on a deployed
// vault: 232/282 real daily notes still have this exact shape and were
// silently skipped by a heal gated on "cowork-daily" alone.
const LEGACY_DAILY_OLD_TYPE = `---
created_at: "2025-10-14T08:16:00-06:00"
tags:
  - "accuris"
cssclasses:
  - wide
type: daily
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceDailyDashboard" });
\`\`\`

---
`;

const LEGACY_HOME = `---
type: home
cssclasses:
  - wide
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceHome" });
\`\`\`

[//]: # (HOME_CHROME_END)
`;

async function run() {
  // Sanity: the functions we're testing must actually be exported.
  ok('EXPORT applyDailyHomeChromeBarHeal is a function', typeof applyDailyHomeChromeBarHeal === 'function');
  ok('EXPORT _dailyChromeBarBody is a function', typeof _dailyChromeBarBody === 'function');
  ok('EXPORT _homeChromeBarBody is a function', typeof _homeChromeBarBody === 'function');

  // DHH-1: daily note migrates — one DailyChromeBar block, no SpaceNavButtons, no literal ---.
  {
    const p = 'spice/daily/2026/07-July/Wednesday-2026-07-08.md';
    const adapter = makeAdapter({ [p]: LEGACY_DAILY });
    const history = [];
    await applyDailyHomeChromeBarHeal(makeTp(adapter), { name: 'daily' }, {}, history, GIT);
    const after = adapter._files.get(p);
    ok('DHH-1a daily migrated: one DailyChromeBar block', (after.match(/class:\s*"DailyChromeBar"/g) || []).length === 1);
    ok('DHH-1b daily migrated: no SpaceNavButtons block remains', !after.includes('class: "SpaceNavButtons"'));
    ok('DHH-1c daily migrated: SpaceDailyDashboard content preserved', after.includes('class: "SpaceDailyDashboard"'));
    ok('DHH-1d daily migrated: no bare literal --- line remains in the body', !/^-{3,}\s*$/m.test(after.slice(after.indexOf('\n---\n', 4) + 5)));
    ok('DHH-1e .sauce-backup written for the daily note', [...adapter._files.keys()].some((k) => k.startsWith('.sauce-backup/') && k.endsWith('/' + p)));
    ok('DHH-1f history event logged for the daily note', history.some((h) => h.step === 'daily_home_chrome_bar_heal' && h.action === 'migrated' && h.target === p));
    ok('DHH-1g bar precedes dashboard in the body', after.indexOf('DailyChromeBar') < after.indexOf('SpaceDailyDashboard'));
  }

  // DHH-2: home note migrates — one HomeChromeBar block, no SpaceNavButtons.
  {
    const p = 'spice/home/Home.md';
    const adapter = makeAdapter({ [p]: LEGACY_HOME });
    const history = [];
    await applyDailyHomeChromeBarHeal(makeTp(adapter), { name: 'home' }, {}, history, GIT);
    const after = adapter._files.get(p);
    ok('DHH-2a home migrated: one HomeChromeBar block', (after.match(/class:\s*"HomeChromeBar"/g) || []).length === 1);
    ok('DHH-2b home migrated: no SpaceNavButtons block remains', !after.includes('class: "SpaceNavButtons"'));
    ok('DHH-2c home migrated: SpaceHome content preserved', after.includes('class: "SpaceHome"'));
    ok('DHH-2d home migrated: HOME_CHROME_END marker preserved', after.includes('[//]: # (HOME_CHROME_END)'));
    ok('DHH-2e .sauce-backup written for the home note', [...adapter._files.keys()].some((k) => k.startsWith('.sauce-backup/') && k.endsWith('/' + p)));
    ok('DHH-2f bar precedes SpaceHome in the body', after.indexOf('HomeChromeBar') < after.indexOf('SpaceHome'));
  }

  // DHH-3: idempotent — second pass on already-migrated bodies is a byte-for-byte no-op.
  {
    const p1 = 'spice/daily/2026/07-July/Wednesday-2026-07-08.md';
    const p2 = 'spice/home/Home.md';
    const adapter = makeAdapter({ [p1]: LEGACY_DAILY, [p2]: LEGACY_HOME });
    await applyDailyHomeChromeBarHeal(makeTp(adapter), { name: 'daily' }, {}, [], GIT);
    const afterFirst1 = adapter._files.get(p1), afterFirst2 = adapter._files.get(p2);
    const history2 = [];
    await applyDailyHomeChromeBarHeal(makeTp(adapter), { name: 'daily' }, {}, history2, GIT);
    ok('DHH-3a second pass is a no-op (byte-identical)', adapter._files.get(p1) === afterFirst1 && adapter._files.get(p2) === afterFirst2);
    ok('DHH-3b second pass migrates nothing (summary healed:0)', history2.some((h) => h.summary && h.summary.healed === 0));
  }

  // DHH-3-pure: the pure transforms are idempotent in isolation too.
  {
    const dailyOnce = _dailyChromeBarBody(LEGACY_DAILY);
    ok('DHH-3c _dailyChromeBarBody idempotent', _dailyChromeBarBody(dailyOnce) === dailyOnce);
    const homeOnce = _homeChromeBarBody(LEGACY_HOME);
    ok('DHH-3d _homeChromeBarBody idempotent', _homeChromeBarBody(homeOnce) === homeOnce);
  }

  // DHH-6: a note with the LEGACY type: daily (pre-cowork-rename) also migrates
  // — not just type: cowork-daily. This is the exact shape found live on a
  // deployed vault that a "cowork-daily"-only gate silently skipped.
  {
    const p = 'spice/daily/2025/10-October/Tuesday-2025-10-14.md';
    const adapter = makeAdapter({ [p]: LEGACY_DAILY_OLD_TYPE });
    const history = [];
    await applyDailyHomeChromeBarHeal(makeTp(adapter), { name: 'daily' }, {}, history, GIT);
    const after = adapter._files.get(p);
    ok('DHH-6a legacy type:daily note migrated: one DailyChromeBar block', (after.match(/class:\s*"DailyChromeBar"/g) || []).length === 1);
    ok('DHH-6b legacy type:daily note migrated: no SpaceNavButtons block remains', !after.includes('class: "SpaceNavButtons"'));
    ok('DHH-6c legacy type:daily note migrated: original type: daily frontmatter preserved', /type:\s*daily\b/.test(after));
    ok('DHH-6d history event logged for the legacy-type daily note', history.some((h) => h.step === 'daily_home_chrome_bar_heal' && h.action === 'migrated' && h.target === p));
  }

  // DHH-4: no daily/home notes present → heal is a silent, harmless no-op.
  {
    const adapter = makeAdapter({});
    const history = [];
    await applyDailyHomeChromeBarHeal(makeTp(adapter), { name: 'daily' }, {}, history, GIT);
    ok('DHH-4 no candidates → still logs a summary event with healed:0', history.some((h) => h.summary && h.summary.healed === 0));
  }

  // DHH-5: a non-daily .md under spice/daily/ (wrong type) is skipped, not mangled.
  {
    const daily = 'spice/daily/2026/07-July/Wednesday-2026-07-08.md';
    const stray = 'spice/daily/README.md';
    const strayBody = '---\ntype: doc-note\n---\n\nnot a daily note.\n';
    const adapter = makeAdapter({ [daily]: LEGACY_DAILY, [stray]: strayBody });
    const history = [];
    await applyDailyHomeChromeBarHeal(makeTp(adapter), { name: 'daily' }, {}, history, GIT);
    ok('DHH-5a stray non-daily note left byte-identical', adapter._files.get(stray) === strayBody);
    ok('DHH-5b the real daily note still migrated alongside it', adapter._files.get(daily).includes('class: "DailyChromeBar"'));
  }

  const failed = results.filter(([, c]) => !c);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.error(`FAILED: ${failed.map(([n]) => n).join(', ')}`); process.exit(1); }
  process.exit(0);
}
run().catch((e) => { console.error('CRASH:', e); process.exit(1); });
