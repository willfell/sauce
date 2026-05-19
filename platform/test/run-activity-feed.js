#!/usr/bin/env node
// run-activity-feed.js — sub-asserts for v0.62.0's NEW activity-feed
// mechanism. Two passes: manifest sanity (AF-1..3) + class source lint
// (AF-4..15). No Obsidian runtime needed — Node-only.
//
// Mirrors run-backlink-panel.js exactly.
//
// Usage: node platform/test/run-activity-feed.js
// Exit: 0 = all pass; 1 = any fail.

"use strict";

const fs = require("fs");
const path = require("path");

const WORKSHOP = path.resolve(__dirname, "../..");
const MECH_DIR = path.join(WORKSHOP, "platform/mechanisms/activity-feed");
const MANIFEST_PATH = path.join(MECH_DIR, "manifest.json");
const SOURCE_PATH = path.join(MECH_DIR, "activity-feed.js");

let pass = 0;
let fail = 0;
const failures = [];

function assertEq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    fail++;
    failures.push(`FAIL: ${label}\n  expected ${e}\n  actual   ${a}`);
    console.log(`  FAIL: ${label}`);
    return false;
  }
  pass++;
  console.log(`  PASS: ${label}`);
  return true;
}

function assertTrue(label, cond, hint) {
  if (!cond) {
    fail++;
    failures.push(`FAIL: ${label}${hint ? ` — ${hint}` : ""}`);
    console.log(`  FAIL: ${label}${hint ? ` — ${hint}` : ""}`);
    return false;
  }
  pass++;
  console.log(`  PASS: ${label}`);
  return true;
}

// ── Pass 1: manifest sanity ───────────────────────────────────────────────

console.log("\n--- Pass 1: activity-feed/manifest.json sanity ---");

assertTrue("AF-1a: manifest.json exists", fs.existsSync(MANIFEST_PATH));

let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
} catch (e) {
  assertTrue("AF-1b: manifest.json parses as JSON", false, e && e.message);
}
if (manifest) {
  assertTrue("AF-1b: manifest.json parses as JSON", true);
  assertEq("AF-1c: manifest.name === 'activity-feed'", manifest.name, "activity-feed");
  assertEq("AF-1d: manifest.version === '0.2.0'", manifest.version, "0.2.0");
  assertEq("AF-1e: manifest.kind === 'mechanism'", manifest.kind, "mechanism");

  assertEq("AF-2: customjs_classes is ['ActivityFeed']", manifest.customjs_classes, ["ActivityFeed"]);

  const deps = manifest.depends_on || [];
  const depNames = deps.map((d) => d && d.name).filter(Boolean);
  assertTrue("AF-3a: depends_on includes customjs-guard", depNames.indexOf("customjs-guard") >= 0);
  assertTrue("AF-3b: depends_on includes cards", depNames.indexOf("cards") >= 0);

  const files = manifest.files || [];
  const hasJsEntry = files.some((f) =>
    f && f.source === "activity-feed.js" &&
    typeof f.dest === "string" &&
    f.dest.indexOf("activity-feed/activity-feed.js") >= 0
  );
  assertTrue("AF-3c: files[] declares activity-feed.js → scripts_path/activity-feed/", hasJsEntry);
}

// ── Pass 2: class source lint ─────────────────────────────────────────────

console.log("\n--- Pass 2: activity-feed.js source lint ---");

assertTrue("AF-4a: activity-feed.js exists", fs.existsSync(SOURCE_PATH));

let src = "";
try {
  src = fs.readFileSync(SOURCE_PATH, "utf8");
} catch (e) {
  assertTrue("AF-4b: readFileSync succeeds", false, e && e.message);
}

if (src.length > 0) {
  // AF-4: source parses via new Function (with stub free vars).
  let parseErr = null;
  try {
    new Function("app", "customJS", "Notice", "window", src + "\nreturn ActivityFeed;");
  } catch (e) {
    parseErr = e;
  }
  assertTrue("AF-4b: source parses via new Function() without throwing",
    !parseErr, parseErr && parseErr.message);

  // AF-5: exactly one `class ActivityFeed` declaration.
  const classMatches = src.match(/class\s+ActivityFeed\b/g) || [];
  assertEq("AF-5: exactly one 'class ActivityFeed' declaration", classMatches.length, 1);

  // AF-6: all 3 scope literals present.
  for (const sc of ["today", "week", "month"]) {
    assertTrue(`AF-6.${sc}: scope literal '${sc}' present in source`,
      new RegExp("\"" + sc + "\"|'" + sc + "'").test(src));
  }

  // AF-7: canonical default blueprint types — at least these 10.
  const canonical = ["daily", "meeting", "scratch", "cowork-daily", "to-do", "journal", "project", "person", "team", "trip"];
  for (const t of canonical) {
    assertTrue(`AF-7.${t}: default blueprint type '${t}' present in source`,
      new RegExp("\"" + t + "\"").test(src));
  }

  // AF-8: default limit 50.
  assertTrue("AF-8: default limit literal 50 present",
    /\b50\b/.test(src) && /\blimit\b/.test(src));

  // AF-9: created_at reference.
  assertTrue("AF-9: 'created_at' reference present in source", /created_at/.test(src));

  // AF-10: useStatusChangedAt opt + status_changed_at branch.
  assertTrue("AF-10a: useStatusChangedAt opt referenced", /useStatusChangedAt/.test(src));
  assertTrue("AF-10b: status_changed_at branch present", /status_changed_at/.test(src));

  // AF-11: _resolveTimeWindow helper present.
  assertTrue("AF-11: _resolveTimeWindow helper present", /_resolveTimeWindow/.test(src));

  // AF-12: customJS.BeaconCards.render delegation.
  assertTrue("AF-12: customJS.BeaconCards.render delegation present",
    /customJS\.BeaconCards\.render/.test(src));

  // AF-13: dv.pages() Dataview query call.
  assertTrue("AF-13: dv.pages() query call present", /dv\.pages\(\)/.test(src));

  // AF-14: window.moment reference (or native Date fallback indicator).
  assertTrue("AF-14a: window.moment reference present (primary code path)",
    /window\.moment/.test(src));
  assertTrue("AF-14b: native Date fallback present", /new Date\(/.test(src));

  // AF-15: Notice on degraded paths.
  assertTrue("AF-15a: Notice on invalid scope / unresolved window present",
    /unable to resolve|invalid scope|time-window/i.test(src));
  assertTrue("AF-15b: Notice on BeaconCards unavailable present",
    /BeaconCards.*unavailable|unavailable.*BeaconCards/i.test(src));
}

// ── Pass 3: runtime render — asOf + includeMtime ─────────────────────────
//
// Exercises ActivityFeed.render(shim, opts) with synthetic dv/window/customJS
// shims. The source was already proven to parse via new Function() in AF-4b;
// here we instantiate the class and assert observable rendering behavior for
// the v0.64.0 S1 additions (asOf anchor + includeMtime mtime-OR).

console.log("\n--- Pass 3: runtime asOf + includeMtime ---");

// Minimal moment-like shim. Supports just enough of the API that
// _resolveTimeWindow needs for scope="today": moment(input).clone().startOf("day").format()
// and likewise endOf("day").format(). Returns ISO-shaped strings the
// _query predicate can compare lexicographically against the seeded
// created_at values.
function makeMomentShim(input) {
  let datePart;
  if (input == null) {
    datePart = "2026-05-19";
  } else if (typeof input === "string") {
    datePart = input.slice(0, 10);
  } else if (input && typeof input._date === "string") {
    datePart = input._date;
  } else {
    datePart = "2026-05-19";
  }
  let suffix = "T00:00:00-06:00";
  return {
    _date: datePart,
    clone() { return makeMomentShim(datePart); },
    startOf(_unit) { suffix = "T00:00:00-06:00"; return this; },
    endOf(_unit) { suffix = "T23:59:59-06:00"; return this; },
    format() { return datePart + suffix; },
  };
}
const windowShim = { moment: (input) => makeMomentShim(input) };

// Minimal DOM-element shim. Supports the subset ActivityFeed touches:
// createEl, textContent (read/write), innerHTML (read/write), style.cssText.
// textContent getter recurses through children so we can assert on the
// composed text after BeaconCards mock has appended cards.
function makeElShim(tag) {
  const el = {
    tag,
    children: [],
    style: { cssText: "" },
    _text: "",
    _html: "",
    get textContent() {
      let t = this._text;
      for (const c of this.children) t += " " + c.textContent;
      return t;
    },
    set textContent(v) { this._text = String(v == null ? "" : v); this.children = []; },
    get innerHTML() {
      let h = this._html;
      for (const c of this.children) h += c.innerHTML;
      return h;
    },
    set innerHTML(v) { this._html = String(v == null ? "" : v); },
    createEl(t, _opts) { const c = makeElShim(t); this.children.push(c); return c; },
    appendChild(c) { this.children.push(c); return c; },
  };
  return el;
}

// Dataview-like chainable pages collection. Supports the three calls
// _query uses: .where(pred), .sort(keyFn, dir), .slice(start, end).
// Implemented atop a plain object (NOT an Array subclass) to avoid the
// trap where Array.prototype.sort internally invokes the overridden
// .slice (or vice versa) and recurses without bound.
function makeDvPages(arr) {
  const nativeSlice = Array.prototype.slice;
  const items = nativeSlice.call(arr);
  return {
    length: items.length,
    _items: items,
    [Symbol.iterator]: function* () { for (const it of items) yield it; },
    where(pred) { return makeDvPages(items.filter(pred)); },
    sort(keyFn, dir) {
      const copy = nativeSlice.call(items);
      copy.sort(function (a, b) {
        const av = keyFn(a), bv = keyFn(b);
        if (av < bv) return dir === "desc" ? 1 : -1;
        if (av > bv) return dir === "desc" ? -1 : 1;
        return 0;
      });
      return makeDvPages(copy);
    },
    slice(start, end) {
      return makeDvPages(nativeSlice.call(items, start, end));
    },
  };
}

// BeaconCards mock: writes each page's file.name into the container
// as a child element. Used by _renderFlat (groupBy: "none") and
// _renderGroupedByBlueprint. The flat path is what AF-A1/M1/M2 exercise.
function makeCustomJsShim() {
  return {
    BeaconCards: {
      render(dv, opts) {
        for (const p of (opts && opts.pages) || []) {
          const card = dv.container.createEl("div");
          card.textContent = (opts.title ? opts.title(p) : (p.file && p.file.name)) || "";
        }
      },
    },
  };
}

// Notice shim — silent (we don't assert on Notice calls here).
function NoticeShim(_msg) { /* swallow */ }

// Load the ActivityFeed class from source via Function constructor,
// mirroring the AF-4b parse strategy.
function loadActivityFeedClass(deps) {
  const factory = new Function(
    "app", "customJS", "Notice", "window",
    src + "\nreturn ActivityFeed;"
  );
  return factory(deps.app, deps.customJS, deps.Notice, deps.window);
}

function renderAndCapture(opts, pagesSeed) {
  const customJsShim = makeCustomJsShim();
  const ActivityFeedCls = loadActivityFeedClass({
    app: {},
    customJS: customJsShim,
    Notice: NoticeShim,
    window: windowShim,
  });
  const feed = new ActivityFeedCls();
  const container = makeElShim("div");
  // _query reads dv.pages() — the chainable we mock here.
  // _renderEmpty / _renderGroupedByBlueprint / BeaconCards all write
  // into dv.container.
  const dv = {
    container,
    pages: () => makeDvPages(pagesSeed),
  };
  feed.render(dv, opts);
  return container.textContent;
}

// AF-A1 — asOf anchor.
try {
  const pageX = {
    type: "scratch",
    created_at: "2026-05-15T10:00:00-06:00",
    file: { name: "page-x.md", path: "page-x.md" },
  };
  const pageY = {
    type: "scratch",
    created_at: "2026-05-19T10:00:00-06:00",
    file: { name: "page-y.md", path: "page-y.md" },
  };
  const text = renderAndCapture(
    { scope: "today", asOf: "2026-05-15", groupBy: "none" },
    [pageX, pageY]
  );
  const hasX = text.indexOf("page-x.md") >= 0;
  const hasY = text.indexOf("page-y.md") >= 0;
  assertTrue(
    "AF-A1: asOf anchor constrains time window to anchor date",
    hasX && !hasY,
    "AF-A1: asOf anchor did not constrain time window to anchor date"
  );
} catch (e) {
  assertTrue(
    "AF-A1: asOf anchor constrains time window to anchor date",
    false,
    "AF-A1: asOf anchor did not constrain time window to anchor date (threw: " + (e && e.message) + ")"
  );
}

// AF-M1 — includeMtime: true catches mtime hits.
try {
  const pageZ = {
    type: "project",
    created_at: "2026-05-01T10:00:00-06:00",
    file: {
      name: "page-z.md",
      path: "page-z.md",
      mtime: { toISO: () => "2026-05-19T11:00:00-06:00" },
    },
  };
  const text = renderAndCapture(
    { scope: "today", asOf: "2026-05-19", includeMtime: true, groupBy: "none" },
    [pageZ]
  );
  const hasZ = text.indexOf("page-z.md") >= 0;
  assertTrue(
    "AF-M1: includeMtime ORs file.mtime into time-window predicate",
    hasZ,
    "AF-M1: includeMtime did not OR file.mtime into the time-window predicate"
  );
} catch (e) {
  assertTrue(
    "AF-M1: includeMtime ORs file.mtime into time-window predicate",
    false,
    "AF-M1: includeMtime did not OR file.mtime into the time-window predicate (threw: " + (e && e.message) + ")"
  );
}

// AF-M2 — omitting includeMtime excludes mtime hits.
try {
  const pageZ = {
    type: "project",
    created_at: "2026-05-01T10:00:00-06:00",
    file: {
      name: "page-z.md",
      path: "page-z.md",
      mtime: { toISO: () => "2026-05-19T11:00:00-06:00" },
    },
  };
  const text = renderAndCapture(
    { scope: "today", asOf: "2026-05-19", groupBy: "none" },
    [pageZ]
  );
  const hasZ = text.indexOf("page-z.md") >= 0;
  assertTrue(
    "AF-M2: omitting includeMtime excludes mtime hits",
    !hasZ,
    "AF-M2: omitting includeMtime regressed to including mtime hits"
  );
} catch (e) {
  assertTrue(
    "AF-M2: omitting includeMtime excludes mtime hits",
    false,
    "AF-M2: omitting includeMtime regressed to including mtime hits (threw: " + (e && e.message) + ")"
  );
}

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\nrun-activity-feed.js: ${pass} pass · ${fail} fail`);
if (fail > 0) {
  console.log("\n--- Failures ---");
  for (const f of failures) console.log(f);
  process.exit(1);
}
process.exit(0);
