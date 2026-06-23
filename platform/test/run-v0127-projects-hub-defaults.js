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
  // I. Default _activeStatuses — source-text literal check.
  // The class initializer for _activeStatuses lives inside an async render()
  // method; rather than wire up the full Dataview surface to trip the init
  // line, we assert against the source literal directly. The static check is
  // strong: any future drift away from the 7-state set fails this test.
  // ---------------------------------------------------------------------------
  {
    const reMatch = src.match(/this\._activeStatuses\s*=\s*new\s+Set\(\[([^\]]+)\]\)/);
    ok(reMatch !== null, 'HC-V0127-PHD-DEFAULTS-A: source has Set literal init');
    if (reMatch) {
      const setContents = reMatch[1];
      ok(setContents.includes('"idea"'), 'HC-V0127-PHD-DEFAULTS-B: contains idea');
      ok(setContents.includes('"planning"'), 'HC-V0127-PHD-DEFAULTS-C: contains planning');
      ok(setContents.includes('"in-progress"'), 'HC-V0127-PHD-DEFAULTS-D: contains in-progress');
      ok(setContents.includes('"blocked"'), 'HC-V0127-PHD-DEFAULTS-E: contains blocked');
      ok(setContents.includes('"done"'), 'HC-V0127-PHD-DEFAULTS-F: contains done');
      ok(setContents.includes('"superseded"'), 'HC-V0127-PHD-DEFAULTS-G: contains superseded');
      ok(setContents.includes('"cancelled"'), 'HC-V0127-PHD-DEFAULTS-H: contains cancelled');
    }
  }

  // ---------------------------------------------------------------------------
  // II. Sort by latestMtime DESC primary.
  // Build pages + lookup; monkey-patch customJS.BeaconCards.render to capture
  // the sorted array. Recent project must surface first.
  // ---------------------------------------------------------------------------
  {
    const inst = new Cls();
    const now = Date.now();
    const pages = [
      makePage('Old', 'done', now - 30 * 24 * 60 * 60 * 1000),        // 30 days ago
      makePage('Recent', 'in-progress', now - 60 * 1000),             // 1 minute ago
      makePage('Mid', 'planning', now - 24 * 60 * 60 * 1000),         // 1 day ago
    ];
    const lookup = new Map(pages.map(p => [p.file.path, {
      project: p,
      latestMtime: p.file.mtime,
      total: 0,
      done: 0,
      blocked: 0,
    }]));
    inst._lookup = lookup;

    let captured = null;
    sandbox.customJS.BeaconCards.render = async (dv, opts) => {
      captured = opts.pages;
    };

    const fakeContainer = makeEl();
    const fakeDv = { container: fakeContainer };
    await inst._renderCards(fakeDv, pages);

    ok(captured !== null, 'HC-V0127-PHD-SORT-A: _renderCards invoked BeaconCards.render');
    if (captured) {
      ok(captured[0] && captured[0].file.name === 'Recent', 'HC-V0127-PHD-SORT-B: most-recent project first');
      ok(captured[1] && captured[1].file.name === 'Mid', 'HC-V0127-PHD-SORT-C: mid project second');
      ok(captured[2] && captured[2].file.name === 'Old', 'HC-V0127-PHD-SORT-D: oldest project last');
    }
  }

  // ---------------------------------------------------------------------------
  // III. Tiebreaker — identical mtime falls back to status priority.
  // Three projects share the SAME latestMtime ts; expected order: in-progress,
  // planning, idea (per PRIORITY map: in-progress=0, planning=1, idea=3).
  // ---------------------------------------------------------------------------
  {
    const inst = new Cls();
    const sameMtime = Date.now() - 60 * 1000;
    const pages = [
      makePage('Idea', 'idea', sameMtime),
      makePage('InProgress', 'in-progress', sameMtime),
      makePage('Planning', 'planning', sameMtime),
    ];
    const lookup = new Map(pages.map(p => [p.file.path, {
      project: p,
      latestMtime: p.file.mtime,
      total: 0,
      done: 0,
      blocked: 0,
    }]));
    inst._lookup = lookup;

    let captured = null;
    sandbox.customJS.BeaconCards.render = async (dv, opts) => {
      captured = opts.pages;
    };

    const fakeContainer = makeEl();
    const fakeDv = { container: fakeContainer };
    await inst._renderCards(fakeDv, pages);

    ok(captured !== null, 'HC-V0127-PHD-TIE-A: invoked');
    if (captured) {
      ok(captured[0] && captured[0].file.name === 'InProgress', 'HC-V0127-PHD-TIE-B: in-progress wins tiebreaker');
      ok(captured[1] && captured[1].file.name === 'Planning', 'HC-V0127-PHD-TIE-C: planning second');
      ok(captured[2] && captured[2].file.name === 'Idea', 'HC-V0127-PHD-TIE-D: idea last');
    }
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
