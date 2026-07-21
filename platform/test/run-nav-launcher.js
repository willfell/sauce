'use strict';
// Zero-dep harness for SpaceNavButtons pure logic (entry order + daily split).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

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
  { id: 'sc', label: 'Sticky Notes', _source: 'sticky-notes', action: { type: 'openLink', target: 'S.md' } },
  { id: 'w',  label: 'Wiki',     _source: 'wiki',     action: { type: 'openLink', target: 'W.md' } },
  { id: 'pr', label: 'Projects', _source: 'project',  action: { type: 'openLink', target: 'P.md' } },
  { id: 'h',  label: 'Home',     _source: 'home',     action: { type: 'invoke_command', command_id: 'homepage:open-homepage' } },
  { id: 'j',  label: 'Journal',  _source: 'journal',  action: { type: 'openLink', target: 'J.md' } },
];
const part = inst2._partitionEntries(all);
// pinned in the FIXED source order: home, to-do, sticky-notes, project, meetings, journal.
ok('NL-6 pins exactly the 6 fixed sources', part.pinned.length === 6);
ok('NL-7 pinned are in fixed source order (home,to-do,sticky-notes,project,meetings,journal)',
  part.pinned.map(e => e._source).join(',') === 'home,to-do,sticky-notes,project,meetings,journal');
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
// is installed. Folder-PATH predicate (not basename regex: meeting/sticky-note/to-do
// notes carry date basenames and would leak through a basename gate).
ok('NL-ARROW-1 daily note in the daily folder → arrows shown',
  SpaceNavButtons._shouldShowDayArrows('spice/daily/2026-07-03.md', { folder: 'spice/daily' }) === true);
ok('NL-ARROW-2 non-daily note (even with a date basename) → NO arrows/sweep',
  SpaceNavButtons._shouldShowDayArrows('spice/meetings/notes/2026-07-03 Standup.md', { folder: 'spice/daily' }) === false);
ok('NL-ARROW-3 daily blueprint absent → no arrows',
  SpaceNavButtons._shouldShowDayArrows('spice/daily/2026-07-03.md', null) === false);
ok('NL-ARROW-4 empty path → no arrows, no throw',
  SpaceNavButtons._shouldShowDayArrows('', { folder: 'spice/daily' }) === false);

// GA-S4A2-DAILY-NAV-BUTTONS-CONTEXTUAL-DATE-FLOOR: bind the behavior whose
// introduction in nav-buttons 2.5.0 sets Daily's minimum compatible version.
{
  const originalWindow = global.window;
  const today = '2026-07-20';
  const isStrictIsoDate = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return false;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCFullYear() === Number(match[1])
      && date.getUTCMonth() === Number(match[2]) - 1
      && date.getUTCDate() === Number(match[3]);
  };
  global.window = {
    moment: (value) => value === undefined
      ? { format: () => today }
      : { isValid: () => isStrictIsoDate(value) }
  };
  try {
    ok('GA-S4A2-DAILY-NAV-BUTTONS-CONTEXTUAL-DATE-FLOOR future active-note date wins',
      inst._resolveActionDate({ current: () => ({ file: { name: 'Friday-2026-08-14' } }) }) === '2026-08-14');
    ok('GA-S4A2 contextual-date invalid active date falls back to today',
      inst._resolveActionDate({ current: () => ({ file: { name: 'Sunday-2026-02-29' } }) }) === today);
    ok('GA-S4A2 contextual-date absent active date falls back to today',
      inst._resolveActionDate({ current: () => ({ file: { name: 'Daily Notes' } }) }) === today);
  } finally {
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
  }
}

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
  const navIcons = []; // { id, icon, label, order, action, manifest }
  for (const kind of ['blueprints', 'mechanisms']) {
    const base = path.join(__dirname, '..', kind);
    for (const name of fs.readdirSync(base)) {
      const mf = path.join(base, name, 'manifest.json');
      if (!fs.existsSync(mf)) continue;
      let man;
      try { man = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (_e) { continue; }
      for (const btn of (man.nav_buttons || [])) {
        navIcons.push({ id: btn.id, icon: btn.icon, label: btn.label, order: btn.order, action: btn.action, manifest: man.name || name });
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

  const dailyManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'blueprints', 'daily', 'manifest.json'), 'utf8'));
  const dailyDependency = dailyManifest.depends_on?.find((entry) => entry.name === 'nav-buttons');
  ok('GA-S4A2-DAILY-NAV-BUTTONS-CONTEXTUAL-DATE-FLOOR dependency requires nav-buttons >=2.5.0',
    dailyDependency?.range === '>=2.5.0');

  const dailyEntries = navIcons.filter((entry) => entry.manifest === 'daily');
  const daily = dailyEntries[0];
  const dailyAction = daily?.action || {};
  ok('NL-DAILY-1 daily contributes exactly one daily-today launcher entry',
    dailyEntries.length === 1 && daily.id === 'daily-today' && daily.label === 'Daily'
    && daily.icon === 'daily' && daily.order === 100);
  ok('NL-DAILY-2 daily launcher mirrors the canonical Daily Note template route',
    dailyAction.type === 'runTemplaterTemplate'
    && dailyAction.template_source === 'Daily Note.md'
    && dailyAction.folder_prefix === '{{module_directory}}'
    && dailyAction.folder_date_pattern === 'YYYY/MM-MMMM'
    && dailyAction.filename_prefix === ''
    && dailyAction.filename_date_pattern === 'dddd-YYYY-MM-DD'
    && dailyAction.filename_suffix === '');
  const dailySettings = dailyManifest.core_plugin_settings?.find((entry) => entry.id === 'daily-notes')?.settings;
  const composedDailyFormat = `${dailyAction.folder_date_pattern}/${dailyAction.filename_prefix}${dailyAction.filename_date_pattern}${dailyAction.filename_suffix}`;
  ok('NL-DAILY-3 launcher folder+filename composition equals the core Daily Notes format',
    dailySettings?.template === '{{templates_path}}/Daily Note.md'
    && dailySettings?.folder === dailyAction.folder_prefix
    && composedDailyFormat === dailySettings.format);
  ok('NL-DAILY-4 daily icon resolves through Icons Tier-1',
    typeof iconsInst.resolve(daily?.icon) === 'string' && iconsInst.resolve(daily.icon).length > 0);

  const homeEntries = navIcons.filter((entry) => entry.manifest === 'home');
  const home = homeEntries[0];
  ok('NL-DAILY-5 Home contribution remains byte-contract unchanged',
    homeEntries.length === 1 && home.id === 'home-open' && home.label === 'Home'
    && home.icon === 'home' && home.order === 40
    && home.action?.type === 'invoke_command'
    && home.action.command_id === 'homepage:open-homepage'
    && home.action.read_mode_after === true);

  const expectedPreExisting = [
    { manifest: 'boards', id: 'boards-board', label: 'Board', icon: 'board', order: 100,
      action: { type: 'createFromTemplate', target: '{{module_directory}}/To-Do-Board.md', template_source: 'To-Do-Board.md' } },
    { manifest: 'cowork', id: 'cowork-hub', label: 'Cowork', icon: 'briefcase', order: 51,
      action: { type: 'openLink', target: '{{module_directory}}/Cowork.md' } },
    { manifest: 'finance', id: 'finance-hub', label: 'Finance', icon: 'finance', order: 120,
      action: { type: 'openLink', target: '{{module_directory}}/Finance.md' } },
    { manifest: 'home', id: 'home-open', label: 'Home', icon: 'home', order: 40,
      action: { type: 'invoke_command', command_id: 'homepage:open-homepage', read_mode_after: true } },
    { manifest: 'journal', id: 'journal-today', label: 'Journal', icon: 'notebook', order: 120,
      action: { type: 'runTemplaterTemplate', template_source: 'Journal Day Hub.md', folder_prefix: '{{module_directory}}', folder_date_pattern: 'YYYY/MM-MMMM/YYYY-MM-DD', filename_prefix: 'Journal-Day-', filename_date_pattern: 'YYYY-MM-DD', filename_suffix: '' } },
    { manifest: 'meetings', id: 'meetings-hub', label: 'Meetings', icon: 'meetings', order: 120,
      action: { type: 'openLink', target: '{{module_directory}}/Meetings.md' } },
    { manifest: 'people', id: 'people-hub', label: 'People', icon: 'people', order: 150,
      action: { type: 'openLink', target: '{{module_directory}}/People.md' } },
    { manifest: 'products', id: 'products-hub', label: 'Products', icon: 'package', order: 70,
      action: { type: 'openLink', target: '{{module_directory}}/Products.md' } },
    { manifest: 'project', id: 'projects-hub', label: 'Projects', icon: 'projects', order: 100,
      action: { type: 'openLink', target: '{{module_directory}}/Projects.md' } },
    { manifest: 'reader', id: 'reader-hub', label: 'Reader', icon: 'book-open', order: 140,
      action: { type: 'openLink', target: '{{module_directory}}/Reader.md' } },
    { manifest: 'sticky-notes', id: 'sticky-day-hub', label: 'Sticky Notes', icon: 'sticky-note', order: 130,
      action: { type: 'runTemplaterTemplate', template_source: 'Sticky Day Hub.md', folder_prefix: '{{module_directory}}', folder_date_pattern: 'YYYY/MM-MMMM/YYYY-MM-DD', filename_prefix: 'Sticky-Day-', filename_date_pattern: 'YYYY-MM-DD', filename_suffix: '' } },
    { manifest: 'teams', id: 'teams-hub', label: 'Teams', icon: 'users', order: 75,
      action: { type: 'openLink', target: '{{module_directory}}/Teams.md' } },
    { manifest: 'to-do', id: 'todo-today', label: 'To Do', icon: 'todo', order: 110,
      action: { type: 'runTemplaterTemplate', template_source: 'Today To-Do.md', folder_prefix: '{{module_directory}}', folder_date_pattern: 'YYYY/MM-MMMM', filename_prefix: 'ToDo-', filename_date_pattern: 'YYYY-MM-DD', filename_suffix: '' } },
    { manifest: 'trips', id: 'trips-hub', label: 'Trips', icon: 'trips', order: 110,
      action: { type: 'openLink', target: '{{module_directory}}/Trips.md' } },
    { manifest: 'wiki', id: 'wiki-hub', label: 'Wiki', icon: 'library', order: 65,
      action: { type: 'openLink', target: '{{module_directory}}/Wiki.md' } },
  ];
  const actualPreExisting = navIcons
    .filter((entry) => entry.manifest !== 'daily')
    .map(({ manifest, id, label, icon, order, action }) => ({ manifest, id, label, icon, order, action }))
    .sort((a, b) => a.manifest.localeCompare(b.manifest) || a.id.localeCompare(b.id));
  ok('NL-DAILY-6 every pre-existing launcher contribution is deep-contract unchanged',
    JSON.stringify(actualPreExisting) === JSON.stringify(expectedPreExisting));

  const realRegistry = { contributions: {} };
  for (const entry of navIcons) {
    (realRegistry.contributions[entry.manifest] ||= []).push(entry);
  }
  const realDaily = inst.firstEntryPerSource(realRegistry).filter((entry) => entry._source === 'daily');
  ok('NL-DAILY-7 assembled launcher registry exposes exactly one Daily representative',
    realDaily.length === 1 && realDaily[0].id === 'daily-today');
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
