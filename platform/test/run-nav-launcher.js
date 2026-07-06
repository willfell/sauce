'use strict';
// Zero-dep harness for SpaceNavButtons pure logic (entry order + daily split).
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'mechanisms', 'nav-buttons', 'space-nav-buttons.js'),
  'utf8'
);
// Load the bare class expression the same way customJS does, then hand back the ctor.
const SpaceNavButtons = new Function(`return (${SRC});`)();

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  PASS: ${name}`); } else { fail++; console.log(`  FAIL: ${name}`); } };

// ── _orderedEntries: flatten contributions + sort by (order, source, id) ──
const inst = new SpaceNavButtons();
const registry = {
  contributions: {
    zeta: [{ id: 'z1', label: 'Zeta', icon: 'board', order: 100, action: { type: 'openLink', target: 'Z.md' } }],
    alpha: [
      { id: 'a2', label: 'Alpha2', icon: 'daily', order: 50, action: { type: 'openLink', target: 'A2.md' } },
      { id: 'a1', label: 'Alpha1', icon: 'todo', order: 50, action: { type: 'openLink', target: 'A1.md' } },
    ],
  },
};
const ordered = inst._orderedEntries(registry);
ok('NL-1 flattens all contributions', ordered.length === 3);
ok('NL-2 sorts by order first (a2/a1 before z1)', ordered[2].id === 'z1');
ok('NL-3 tie on order → source then id (a1 before a2)', ordered[0].id === 'a1' && ordered[1].id === 'a2');
ok('NL-4 carries _source tag', ordered[0]._source === 'alpha');
ok('NL-5 empty/absent contributions → []', inst._orderedEntries({}).length === 0 && inst._orderedEntries({ contributions: {} }).length === 0);

// ── _partitionEntries: fixed pinned quick-nav set (by _source order) + rest ──
const inst2 = new SpaceNavButtons();
// Registry-ish ordered entries across many sources (order sort already applied).
const all = [
  { id: 'd',  label: 'Daily',    _source: 'daily',    action: { type: 'invoke_command', command_id: 'daily-notes' } },
  { id: 'co', label: 'Cowork',   _source: 'cowork',   action: { type: 'openLink', target: 'C.md' } },
  { id: 'pe', label: 'People',   _source: 'people',   action: { type: 'openLink', target: 'Pe.md' } },
  { id: 't',  label: 'To Do',    _source: 'to-do',    action: { type: 'openLink', target: 'T.md' } },
  { id: 'me', label: 'Meetings', _source: 'meetings', action: { type: 'openLink', target: 'M.md' } },
  { id: 'sc', label: 'Scratch',  _source: 'scratch',  action: { type: 'openLink', target: 'S.md' } },
  { id: 'w',  label: 'Wiki',     _source: 'wiki',     action: { type: 'openLink', target: 'W.md' } },
  { id: 'pr', label: 'Projects', _source: 'project',  action: { type: 'openLink', target: 'P.md' } },
  { id: 'h',  label: 'Home',     _source: 'home',     action: { type: 'invoke_command', command_id: 'homepage:open-homepage' } },
];
const part = inst2._partitionEntries(all);
// pinned in the FIXED source order: home, to-do, scratch, project, meetings.
ok('NL-6 pins exactly the 5 fixed sources', part.pinned.length === 5);
ok('NL-7 pinned are in fixed source order (home,to-do,scratch,project,meetings)',
  part.pinned.map(e => e._source).join(',') === 'home,to-do,scratch,project,meetings');
ok('NL-8 rest = everything else (incl. Daily now), original order preserved',
  part.rest.map(e => e.id).join(',') === 'd,co,pe,w');
// Absent pinned source simply drops its cell; extra entries per source → rest.
const partial = inst2._partitionEntries([
  { id: 'h',  label: 'Home',   _source: 'home',   action: {} },
  { id: 'x',  label: 'X',      _source: 'other',  action: {} },
  { id: 'h2', label: 'Home 2', _source: 'home',   action: {} }, // second home → rest
]);
ok('NL-9 missing pins drop out; only first-per-source pins; extras → rest',
  partial.pinned.length === 1 && partial.pinned[0].id === 'h'
  && partial.rest.map(e => e.id).join(',') === 'x,h2');

// ── _shouldShowDayArrows: gate the prev/next-day arrow sweep to daily notes ──
// The whole-vault getMarkdownFiles() sweep must fire ONLY when viewing a note
// inside the daily folder — not on every note merely because the daily blueprint
// is installed. Folder-PATH predicate (not basename regex: meeting/scratch/to-do
// notes carry date basenames and would leak through a basename gate).
ok('NL-ARROW-1 daily note in the daily folder → arrows shown',
  SpaceNavButtons._shouldShowDayArrows('spice/daily/2026-07-03.md', { folder: 'spice/daily' }) === true);
ok('NL-ARROW-2 non-daily note (even with a date basename) → NO arrows/sweep',
  SpaceNavButtons._shouldShowDayArrows('spice/meetings/notes/2026-07-03 Standup.md', { folder: 'spice/daily' }) === false);
ok('NL-ARROW-3 daily blueprint absent → no arrows',
  SpaceNavButtons._shouldShowDayArrows('spice/daily/2026-07-03.md', null) === false);
ok('NL-ARROW-4 empty path → no arrows, no throw',
  SpaceNavButtons._shouldShowDayArrows('', { folder: 'spice/daily' }) === false);

// ── firstEntryPerSource: ONE representative per source, sorted (order, source, id) ──
{
  const reg = { contributions: {
    zeta:  [{ id: 'z1', label: 'Z', order: 100, action: { type: 'openLink', target: 'z.md' } }],
    alpha: [{ id: 'a1', label: 'A', order: 100, action: { type: 'openLink', target: 'a.md' } },
            { id: 'a2', label: 'A2', order: 100, action: { type: 'openLink', target: 'a2.md' } }],
    mid:   [{ id: 'm1', label: 'M', order: 50,  action: { type: 'openLink', target: 'm.md' } }],
  } };
  const reps = inst.firstEntryPerSource(reg);
  ok('NL-FEPS-1 one entry per source (a source with 2 contributions yields 1 rep)',
    reps.length === 3);
  ok('NL-FEPS-2 each rep is tagged with its _source',
    reps.every((r) => typeof r._source === 'string') &&
    reps.filter((r) => r._source === 'alpha').length === 1);
  ok('NL-FEPS-3 the alpha rep is that source\'s registry list[0] (id a1, not a2)',
    (reps.find((r) => r._source === 'alpha') || {}).id === 'a1');
  ok('NL-FEPS-4 ordered by (order, source, id): mid(50) first, then alpha, then zeta',
    reps[0]._source === 'mid' && reps[1]._source === 'alpha' && reps[2]._source === 'zeta');
  ok('NL-FEPS-5 empty/absent contributions → []',
    inst.firstEntryPerSource({}).length === 0 &&
    inst.firstEntryPerSource({ contributions: {} }).length === 0);
}

// ── nav_button icon uniqueness + Tier-1 resolvability (Go-to launcher) ──
// Every nav_button across all manifests must carry a DISTINCT icon so the
// Go-to launcher never renders two buttons with the same glyph. Regression
// guard for the wiki/journal/reader collision (all read as "book").
{
  const navIcons = []; // { icon, label, manifest }
  for (const kind of ['blueprints', 'mechanisms']) {
    const base = path.join(__dirname, '..', kind);
    for (const name of fs.readdirSync(base)) {
      const mf = path.join(base, name, 'manifest.json');
      if (!fs.existsSync(mf)) continue;
      let man;
      try { man = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (_e) { continue; }
      for (const btn of (man.nav_buttons || [])) {
        navIcons.push({ icon: btn.icon, label: btn.label, manifest: man.name || name });
      }
    }
  }
  const seen = new Map(); // icon -> first {label, manifest}
  const dups = [];
  for (const e of navIcons) {
    if (seen.has(e.icon)) dups.push(`${e.icon} (${seen.get(e.icon).manifest}/${seen.get(e.icon).label} ↔ ${e.manifest}/${e.label})`);
    else seen.set(e.icon, e);
  }
  ok(`NL-ICON-1 all nav_button icons are unique (found ${navIcons.length}; dups: ${dups.join('; ') || 'none'})`, dups.length === 0);

  // The three previously-colliding book-family buttons must be pairwise distinct.
  const iconOf = (mfName) => { const f = navIcons.find(e => e.manifest === mfName); return f ? f.icon : null; };
  const wiki = iconOf('wiki'), journal = iconOf('journal'), reader = iconOf('reader');
  ok('NL-ICON-2 wiki / journal / reader carry three distinct icons',
    wiki && journal && reader && wiki !== journal && journal !== reader && wiki !== reader);

  // Each of the three must resolve via Icons Tier-1 (Tier-2 setIcon() is
  // unavailable in the launcher overlay path — book-open lesson v0.194.0).
  const ICONS_SRC = fs.readFileSync(path.join(__dirname, '..', 'mechanisms', 'icons', 'icons.js'), 'utf8');
  const Icons = new Function(`return (${ICONS_SRC});`)();
  const iconsInst = new Icons();
  for (const [nm, ic] of [['wiki', wiki], ['journal', journal], ['reader', reader]]) {
    const svg = iconsInst.resolve(ic);
    ok(`NL-ICON-3 ${nm} icon "${ic}" resolves via Icons Tier-1 (non-empty svg)`,
      typeof svg === 'string' && svg.length > 0);
  }
}

// ── _loadRegistry: cache the per-render 2.8KB registry disk-read (session) ──
(async () => {
  let reads = 0;
  const appStub = { vault: { adapter: { read: async () => { reads++; return JSON.stringify({ contributions: {} }); } } } };
  const i = new SpaceNavButtons();
  const r1 = await i._loadRegistry(appStub);
  const r2 = await i._loadRegistry(appStub);
  ok('NL-REG-1 registry read memoized (1 read across 2 loads) + both ok', reads === 1 && r1.ok === true && r2.ok === true);

  const enoent = new SpaceNavButtons();
  const re = await enoent._loadRegistry({ vault: { adapter: { read: async () => { throw new Error('ENOENT: no such file'); } } } });
  ok('NL-REG-2 ENOENT → {ok:false, empty:true} (render draws nothing)', re.ok === false && re.empty === true);

  const bad = new SpaceNavButtons();
  const rb = await bad._loadRegistry({ vault: { adapter: { read: async () => 'not json{' } } });
  ok('NL-REG-3 parse error → {ok:false, reason:/parse/}', rb.ok === false && /parse/.test(rb.reason || ''));

  console.log(`\n  ${pass} pass · ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
