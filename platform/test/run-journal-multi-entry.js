#!/usr/bin/env node
'use strict';
// run-journal-multi-entry.js — behavioral coverage for the journal
// multi-entry cycle: JournalDayList (day-hub card list), JournalHubCards
// (global hub Days-mode day aggregation), and applyJournalMultiEntryMigration
// (install-time flat→day-folder migration, via install.js's exported fn +
// an in-memory VaultAdapter stub mirroring run-sticky-notes-rename-migration.js).
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }

let passed = 0, failed = 0;
function ok(label, cond) {
  if (cond) { passed++; console.log(`  PASS — ${label}`); }
  else { failed++; console.log(`  FAIL — ${label}`); }
}

// ---------------------------------------------------------------------
// JHC — JournalHubCards._coerceDay / _matchesFilter (pure methods, no DOM)
// ---------------------------------------------------------------------
{
  const JournalHubCards = loadClass('platform/blueprints/journal/helpers/journal-hub-cards.js', 'JournalHubCards');
  const inst = new JournalHubCards();
  ok('JHC-COERCE-1 string day sliced to 10 chars', inst._coerceDay('2026-07-11T00:00:00Z') === '2026-07-11');
  ok('JHC-COERCE-2 Luxon-like (.toISODate) day', inst._coerceDay({ toISODate: () => '2026-07-11' }) === '2026-07-11');
  ok('JHC-COERCE-3 unrecognized shape → null', inst._coerceDay(42) === null);
  ok('JHC-MATCH-1 empty needle matches everything', inst._matchesFilter({ title: 'x' }, '', '') === true);
  ok('JHC-MATCH-2 needle matches title', inst._matchesFilter({ title: 'Morning pages' }, 'morning', '') === true);
  ok('JHC-MATCH-3 needle matches body only (title miss)', inst._matchesFilter({ title: 'Untitled' }, 'gratitude', 'feeling gratitude today') === true);
  ok('JHC-MATCH-4 needle matches nothing', inst._matchesFilter({ title: 'Untitled' }, 'zzz', 'no match here') === false);
  ok('JHC-PREVIEW-1 skips frontmatter + fenced code + wikilinks, takes first prose line',
    inst._extractPreviewFromBody('---\ntype: journal-entry\n---\n\n```js\ncode\n```\n[[Journal-Day-2026-07-11]]\nActual first line of prose.\n') === 'Actual first line of prose.');
}

// ---------------------------------------------------------------------
// JDL — JournalDayList._coerceDay / _extractPreviewFromBody (pure methods)
// ---------------------------------------------------------------------
{
  const JournalDayList = loadClass('platform/blueprints/journal/helpers/journal-day-list.js', 'JournalDayList');
  const inst = new JournalDayList();
  ok('JDL-COERCE-1 string day sliced to 10 chars', inst._coerceDay('2026-07-11T00:00:00Z') === '2026-07-11');
  ok('JDL-COERCE-2 bare Date → null (timezone-safety guard)', inst._coerceDay(new Date('2026-07-11')) === null);
  ok('JDL-PREVIEW-1 first prose line after frontmatter', inst._extractPreviewFromBody('---\ntype: journal-entry\n---\n\nHello world.\n') === 'Hello world.');
}

// ---------------------------------------------------------------------
// AJME — applyJournalMultiEntryMigration, in-memory VaultAdapter stub
// ---------------------------------------------------------------------
{
  const installModule = require(path.join(ROOT, 'platform/install.js'));
  const applyJournalMultiEntryMigration = installModule.applyJournalMultiEntryMigration;
  ok('AJME-EXPORT-1 exported from install.js', typeof applyJournalMultiEntryMigration === 'function');

  function makeAdapter(initialFs) {
    const store = new Map(Object.entries(initialFs || {}));
    return {
      _store: store,
      async exists(p) { return store.has(p) || [...store.keys()].some(k => k.startsWith(p + '/')); },
      async list(p) {
        const files = []; const folders = new Set();
        const prefix = p === '' ? '' : p + '/';
        for (const k of store.keys()) {
          if (prefix !== '' && !k.startsWith(prefix)) continue;
          const rest = k.substring(prefix.length);
          const slashIdx = rest.indexOf('/');
          if (slashIdx === -1) files.push(k);
          else folders.add(`${prefix}${rest.substring(0, slashIdx)}`);
        }
        return { folders: [...folders], files };
      },
      async read(p) { if (!store.has(p)) throw new Error(`no such file ${p}`); return store.get(p); },
      async write(p, body) { store.set(p, body); },
      async remove(p) { store.delete(p); },
      async mkdir(_p) { /* no-op: directories are implicit in this flat store */ },
    };
  }

  async function run() {
    // AJME-1: a single flat journal note migrates to day-folder shape.
    {
      const adapter = makeAdapter({
        'spice/journal/2026/07-July/Journal-2026-07-11.md':
          '---\ntype: journal\ncreated_at: "2026-07-11T08:00:00Z"\nday_link: "[[Wednesday-2026-07-11]]"\n---\n\nSome entry content.\n',
      });
      const tp = { app: { vault: { adapter } } };
      const history = [];
      const git = { commit: 'abc', tag: null, dirty: false };
      await applyJournalMultiEntryMigration(tp, { name: 'journal' }, { views_path: 'ranch/views' }, history, git);

      const dayHub = adapter._store.get('spice/journal/2026/07-July/2026-07-11/Journal-Day-2026-07-11.md');
      const leaf = adapter._store.get('spice/journal/2026/07-July/2026-07-11/Journal-2026-07-11-00-00-00.md');
      const oldGone = !adapter._store.has('spice/journal/2026/07-July/Journal-2026-07-11.md');

      ok('AJME-1a day-hub created', !!dayHub && /type: journal-day/.test(dayHub));
      ok('AJME-1b leaf created with original body preserved', !!leaf && leaf.includes('Some entry content.'));
      ok('AJME-1c leaf preserves original created_at', !!leaf && leaf.includes('created_at: "2026-07-11T08:00:00Z"'));
      ok('AJME-1d leaf carries day + journal-entry type', !!leaf && /type: journal-entry/.test(leaf) && /day: "2026-07-11"/.test(leaf));
      ok('AJME-1e old flat note removed after successful migration', oldGone);
    }

    // AJME-2: idempotent — running twice on an already-migrated vault is a no-op.
    {
      const adapter = makeAdapter({
        'spice/journal/2026/07-July/Journal-2026-07-11.md':
          '---\ntype: journal\ncreated_at: "2026-07-11T08:00:00Z"\n---\n\nBody.\n',
      });
      const tp = { app: { vault: { adapter } } };
      const history = [];
      const git = { commit: 'abc', tag: null, dirty: false };
      await applyJournalMultiEntryMigration(tp, { name: 'journal' }, { views_path: 'ranch/views' }, history, git);
      const afterFirst = adapter._store.size;
      await applyJournalMultiEntryMigration(tp, { name: 'journal' }, { views_path: 'ranch/views' }, history, git);
      const afterSecond = adapter._store.size;
      ok('AJME-2 second run is a no-op (store size unchanged)', afterFirst === afterSecond);
    }

    // AJME-3: gated on manifest.name — a non-journal manifest is a no-op.
    {
      const adapter = makeAdapter({
        'spice/journal/2026/07-July/Journal-2026-07-11.md': '---\ntype: journal\n---\n\nBody.\n',
      });
      const tp = { app: { vault: { adapter } } };
      await applyJournalMultiEntryMigration(tp, { name: 'sticky-notes' }, {}, [], { commit: 'x' });
      ok('AJME-3 non-journal manifest.name → untouched store', adapter._store.has('spice/journal/2026/07-July/Journal-2026-07-11.md'));
    }

    // AJME-4: already-day-folder-shaped entries (type: journal-entry) are left alone.
    {
      const adapter = makeAdapter({
        'spice/journal/2026/07-July/2026-07-10/Journal-Day-2026-07-10.md': '---\ntype: journal-day\nday: "2026-07-10"\n---\n',
        'spice/journal/2026/07-July/2026-07-10/Journal-2026-07-10-14-00-00.md': '---\ntype: journal-entry\nday: "2026-07-10"\n---\n\nAlready migrated.\n',
      });
      const tp = { app: { vault: { adapter } } };
      await applyJournalMultiEntryMigration(tp, { name: 'journal' }, {}, [], { commit: 'x' });
      ok('AJME-4 already-migrated entries untouched', adapter._store.get('spice/journal/2026/07-July/2026-07-10/Journal-2026-07-10-14-00-00.md').includes('Already migrated.'));
    }

    console.log(`\n${passed}/${passed + failed} passed`);
    process.exit(failed === 0 ? 0 : 1);
  }

  run();
}
