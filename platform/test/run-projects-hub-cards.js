#!/usr/bin/env node
// run-projects-hub-cards.js — behavioral harness for the projects hub chrome
// overhaul (WS1). Loads platform/blueprints/project/helpers/projects-hub-cards.js
// via `new Function(src + "\nreturn ProjectsHubCards;")` (bare-class loader) and
// asserts the PURE sort function + localStorage sort-mode helpers.
//
// Contract under test:
//   • _sortProjects(pages, mode) — pure, no DOM. Reads latestMtime from
//     this._lookup (the same accessor the render path uses). mode "mtime"
//     sorts by latestMtime.ts DESC; mode "alpha" sorts by display name
//     (name || file.name) case-insensitive ASC.
//   • _readSortMode() / _writeSortMode(mode) — localStorage round-trip under
//     key "sauce.projects-hub.sort"; default "mtime" when unset/invalid.

const fs = require("fs");
const path = require("path");

const SRC_PATH = path.join(
  __dirname, "..", "blueprints", "project", "helpers", "projects-hub-cards.js"
);
const src = fs.readFileSync(SRC_PATH, "utf8");

// In-memory localStorage shim injected into the class scope via the loader.
function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    _store: store,
  };
}

function loadClass(env) {
  const argNames = Object.keys(env || {});
  const argVals = Object.values(env || {});
  const wrapper = `${src}\nreturn ProjectsHubCards;`;
  return new Function(...argNames, wrapper)(...argVals);
}

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ok " + name); }
  else { fail++; failures.push(name + (detail ? " — " + detail : "")); console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
}
function eqArr(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// A page fixture. mtimeTs feeds the enriched lookup latestMtime.
function makePage(name, mtimeTs) {
  return {
    file: {
      name,
      path: `spice/projects/${name.toLowerCase()}/${name}.md`,
      folder: `spice/projects/${name.toLowerCase()}`,
      mtime: { ts: mtimeTs },
    },
  };
}

(function main() {
  const ls = makeLocalStorage();
  const Cls = loadClass({ localStorage: ls, window: { localStorage: ls } });

  // -------------------------------------------------------------------------
  // I. _sortProjects — mtime DESC (default).
  // -------------------------------------------------------------------------
  {
    console.log("\n=== PHC-SORT: _sortProjects ===");
    const hub = new Cls();
    const beta = makePage("Beta", 200);
    const alpha = makePage("alpha", 100);
    const pages = [beta, alpha];
    // The render path enriches into this._lookup keyed by file.path with
    // { latestMtime }. _sortProjects must read the SAME accessor.
    hub._lookup = new Map(pages.map((p) => [p.file.path, { project: p, latestMtime: p.file.mtime }]));

    eqArr("PHC-SORT-1 mtime desc", hub._sortProjects(pages, "mtime").map((p) => p.file.name), ["Beta", "alpha"]);
    eqArr("PHC-SORT-2 alpha case-insensitive", hub._sortProjects(pages, "alpha").map((p) => p.file.name), ["alpha", "Beta"]);
  }

  // -------------------------------------------------------------------------
  // II. _sortProjects — purity + stability edges.
  // -------------------------------------------------------------------------
  {
    const hub = new Cls();
    const a = makePage("Zeta", 500);
    const b = makePage("mid", 500);   // same mtime → alpha would order mid, Zeta
    const c = makePage("Aardvark", 500);
    const pages = [a, b, c];
    hub._lookup = new Map(pages.map((p) => [p.file.path, { project: p, latestMtime: p.file.mtime }]));

    // Does not mutate the input array.
    const before = pages.map((p) => p.file.name);
    hub._sortProjects(pages, "alpha");
    eqArr("PHC-SORT-3 input not mutated", pages.map((p) => p.file.name), before);

    eqArr("PHC-SORT-4 alpha ci across mixed case",
      hub._sortProjects(pages, "alpha").map((p) => p.file.name), ["Aardvark", "mid", "Zeta"]);

    // Missing lookup entry → mtime treated as 0 (sorts last under mtime), no throw.
    const orphan = makePage("Orphan", 999);
    const withOrphan = [orphan, a];
    const hub2 = new Cls();
    hub2._lookup = new Map([[a.file.path, { project: a, latestMtime: a.file.mtime }]]);
    const sorted = hub2._sortProjects(withOrphan, "mtime");
    eqArr("PHC-SORT-5 missing-lookup mtime=0 sinks last", sorted.map((p) => p.file.name), ["Zeta", "Orphan"]);
  }

  // -------------------------------------------------------------------------
  // III. Sort-mode localStorage helpers.
  // -------------------------------------------------------------------------
  {
    console.log("\n=== PHC-MODE: _readSortMode / _writeSortMode ===");
    const hub = new Cls();
    ls._store.clear();
    ok("PHC-MODE-1 default mtime when unset", hub._readSortMode() === "mtime");

    hub._writeSortMode("alpha");
    ok("PHC-MODE-2 write+read round-trips alpha", hub._readSortMode() === "alpha");
    ok("PHC-MODE-3 stored under sauce.projects-hub.sort", ls.getItem("sauce.projects-hub.sort") === "alpha");

    hub._writeSortMode("mtime");
    ok("PHC-MODE-4 write mtime round-trips", hub._readSortMode() === "mtime");

    ls.setItem("sauce.projects-hub.sort", "garbage");
    ok("PHC-MODE-5 invalid value falls back to mtime", hub._readSortMode() === "mtime");
  }

  console.log("");
  if (fail === 0) {
    console.log(`PASS ${pass}/${pass + fail}`);
    process.exit(0);
  } else {
    console.log(`FAIL ${fail}/${pass + fail}`);
    for (const f of failures) console.log("  - " + f);
    process.exit(1);
  }
})();
