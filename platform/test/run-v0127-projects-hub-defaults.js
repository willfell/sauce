#!/usr/bin/env node
// run-v0127-projects-hub-defaults.js — behavioral harness for v0.127.0 §E.
//
// Loads platform/blueprints/project/helpers/projects-hub-cards.js into a vm
// sandbox + instantiates ProjectsHubCards + asserts:
//   §E1: default _activeStatuses Set literal contains all 7 statuses
//        (idea/planning/in-progress/blocked/done/superseded/cancelled).
//   §E2: _renderCards sort primary key is latestMtime DESC; status priority
//        + status_changed_at remain as tiebreakers.
//
// Stub posture: minimal DOM + minimal customJS surface — only what
// _renderCards actually calls. We monkey-patch customJS.BeaconCards.render to
// capture the sorted page array.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC_PATH = path.join(__dirname, '..', 'blueprints', 'project', 'helpers', 'projects-hub-cards.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

function makeEl() {
  const el = {
    style: { cssText: '' },
    _children: [],
    _text: '',
    _tag: '',
    createEl(tag, opts) {
      const child = makeEl();
      child._tag = tag;
      if (opts && opts.text) child._text = String(opts.text);
      this._children.push(child);
      return child;
    },
    createDiv() { return this.createEl('div'); },
    addEventListener() {},
    empty() { this._children = []; },
  };
  Object.defineProperty(el, 'textContent', {
    get() { return this._text; },
    set(v) { this._text = String(v); },
    configurable: true,
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._text; },
    set(v) { this._text = String(v); },
    configurable: true,
  });
  return el;
}

function makeSandbox() {
  const sandbox = {};
  sandbox.global = sandbox;
  sandbox.window = sandbox;
  sandbox.app = {
    vault: {
      getAbstractFileByPath: () => null,
      read: async () => '',
    },
  };
  sandbox.customJS = {
    DocSearch: {
      render: (dv, opts) => {
        const resultsContainer = makeEl();
        return { resultsContainer, query: '', tags: new Set() };
      },
      matches: () => true,
    },
    BeaconCards: { render: async () => {} },
    SectionLabel: { render: () => {} },
  };
  sandbox.window.moment = () => ({
    fromNow: () => 'just now',
    format: () => '2026-06-23',
  });
  vm.createContext(sandbox);
  vm.runInContext(src + '\nthis.ProjectsHubCards = ProjectsHubCards;', sandbox);
  return sandbox;
}

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) {
    pass++;
    console.log('  ok ' + msg);
  } else {
    fail++;
    console.log('  FAIL ' + msg);
  }
}

function makePage(name, status, mtimeTs, statusChangedAt) {
  return {
    file: {
      name,
      path: `spice/projects/${name.toLowerCase()}/${name}.md`,
      folder: `spice/projects/${name.toLowerCase()}`,
      mtime: { ts: mtimeTs },
      etags: ['#project'],
    },
    type: 'project',
    status,
    status_changed_at: statusChangedAt || '2026-01-01',
    teams: [],
    products: [],
  };
}

(async () => {
  const sandbox = makeSandbox();
  const Cls = sandbox.ProjectsHubCards;

  // ---------------------------------------------------------------------------
  // I. Sort-mode default (WS1 chrome overhaul).
  // The v0.127.0 status/team/product scope filters + group-by + recently-active
  // strip were REMOVED in the WS1 chrome overhaul. The hub is now sorted, not
  // scoped: default sort is "mtime" (most-recently-edited first), toggled to
  // "alpha" and persisted under localStorage "sauce.projects-hub.sort".
  // Assert the persisted-default source literal + the _readSortMode default.
  // ---------------------------------------------------------------------------
  {
    ok(/sauce\.projects-hub\.sort/.test(src), 'HC-V0127-PHD-DEFAULTS-A: source keys localStorage under sauce.projects-hub.sort');
    ok(!/this\._activeStatuses/.test(src), 'HC-V0127-PHD-DEFAULTS-B: status-scope Set removed (no _activeStatuses)');
    ok(!/_renderGroupSelector/.test(src) && !/_renderRecentStrip/.test(src) && !/_renderChips/.test(src),
      'HC-V0127-PHD-DEFAULTS-C: group-by + recently-active + chip bars removed');
    const inst = new Cls();
    ok(inst._readSortMode() === 'mtime', 'HC-V0127-PHD-DEFAULTS-D: _readSortMode defaults to mtime');
  }

  // ---------------------------------------------------------------------------
  // II. Sort by latestMtime DESC primary (via _sortProjects, mtime mode).
  // _renderCards now renders in the order given; _sortProjects (pure) owns the
  // ordering. Recent project must surface first.
  // ---------------------------------------------------------------------------
  {
    const inst = new Cls();
    const now = Date.now();
    const pages = [
      makePage('Old', 'done', now - 30 * 24 * 60 * 60 * 1000),        // 30 days ago
      makePage('Recent', 'in-progress', now - 60 * 1000),             // 1 minute ago
      makePage('Mid', 'planning', now - 24 * 60 * 60 * 1000),         // 1 day ago
    ];
    inst._lookup = new Map(pages.map(p => [p.file.path, {
      project: p, latestMtime: p.file.mtime, total: 0, done: 0, blocked: 0,
    }]));

    const sorted = inst._sortProjects(pages, 'mtime');
    ok(sorted[0] && sorted[0].file.name === 'Recent', 'HC-V0127-PHD-SORT-B: most-recent project first');
    ok(sorted[1] && sorted[1].file.name === 'Mid', 'HC-V0127-PHD-SORT-C: mid project second');
    ok(sorted[2] && sorted[2].file.name === 'Old', 'HC-V0127-PHD-SORT-D: oldest project last');

    // _renderCards renders in the order passed (BeaconCards.render capture).
    let captured = null;
    sandbox.customJS.BeaconCards.render = async (dv, opts) => { captured = opts.pages; };
    const fakeDv = { container: makeEl() };
    await inst._renderCards(fakeDv, sorted);
    ok(captured !== null, 'HC-V0127-PHD-SORT-A: _renderCards invoked BeaconCards.render');
    if (captured) {
      ok(captured.map(p => p.file.name).join(',') === 'Recent,Mid,Old',
        'HC-V0127-PHD-SORT-E: _renderCards preserves the passed order');
    }
  }

  // ---------------------------------------------------------------------------
  // III. Alpha sort mode — case-insensitive A–Z by display name.
  // ---------------------------------------------------------------------------
  {
    const inst = new Cls();
    const sameMtime = Date.now() - 60 * 1000;
    const pages = [
      makePage('zebra', 'idea', sameMtime),
      makePage('Apple', 'in-progress', sameMtime),
      makePage('mango', 'planning', sameMtime),
    ];
    inst._lookup = new Map(pages.map(p => [p.file.path, {
      project: p, latestMtime: p.file.mtime, total: 0, done: 0, blocked: 0,
    }]));
    const sorted = inst._sortProjects(pages, 'alpha');
    ok(sorted[0] && sorted[0].file.name === 'Apple', 'HC-V0127-PHD-TIE-B: alpha ci — Apple first');
    ok(sorted[1] && sorted[1].file.name === 'mango', 'HC-V0127-PHD-TIE-C: mango second');
    ok(sorted[2] && sorted[2].file.name === 'zebra', 'HC-V0127-PHD-TIE-D: zebra last');
  }

  console.log('');
  if (fail === 0) {
    console.log(`PASS ${pass}/${pass + fail}`);
    process.exit(0);
  } else {
    console.log(`FAIL ${fail}/${pass + fail}`);
    process.exit(1);
  }
})().catch((e) => {
  console.error('UNCAUGHT: ' + (e.stack || e.message || e));
  process.exit(2);
});
