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
  assertEq("AF-1d: manifest.version === '0.4.0'", manifest.version, "0.4.0");
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
    array() { return nativeSlice.call(items); },
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
    page: (path) => pagesSeed.find(p => p && p.file && p.file.path === path) || null,
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

// AF-V065: _DEFAULT_BLUEPRINTS widening for 6 cowork run-note types
{
  const src = fs.readFileSync("platform/mechanisms/activity-feed/activity-feed.js", "utf8");
  const types = [
    "cowork-morning-briefing", "cowork-midday-tripwire", "cowork-eod-review",
    "cowork-finance-snapshot", "cowork-weekly-review", "cowork-monthly-review",
  ];
  for (const t of types) {
    assertTrue(`AF-V065: _DEFAULT_BLUEPRINTS contains "${t}"`, src.includes(`"${t}"`));
  }
  const manifest = JSON.parse(fs.readFileSync("platform/mechanisms/activity-feed/manifest.json", "utf8"));
  assertEq("AF-V065: activity-feed manifest version is 0.3.2", manifest.version, "0.3.2");
  assertTrue("AF-V065: activity-feed description mentions 0.2.0", typeof manifest.description === "string" && manifest.description.includes("0.2.0"));
}

// ── Pass 4: v0.66.0 rollUpRoots + flatGrouped + metaBuilder ──────────────

console.log("\n--- Pass 4: v0.66.0 rollUpRoots + flatGrouped + metaBuilder ---");

// Fake-element shim for Pass 4 (node-harness-safe; uses createEl + textContent only).
// innerHTML tracks both structural tags AND text set via textContent, so assertions
// like indexOf("Sauce") work correctly.
function v066_makeFakeEl() {
  const el = {
    tag: "div",
    style: {},
    dataset: {},
    _html: "",
    _children: [],
    _text: "",
    className: "",
    open: false,
    classList: { add: () => {}, remove: () => {} },
  };
  Object.defineProperty(el, "innerHTML", {
    get() {
      // Lazy serialization: emit each child's open-tag with its dataset
      // attributes, then recurse. _html holds any innerHTML that was
      // set directly (e.g., chevron SVG); _text holds textContent.
      const serializeChild = (c) => {
        let attrs = "";
        if (c.dataset && typeof c.dataset === "object") {
          for (const k of Object.keys(c.dataset)) {
            attrs += ' data-' + k + '="' + String(c.dataset[k]) + '"';
          }
        }
        return "<" + c.tag + attrs + ">" + c.innerHTML;
      };
      return el._text + el._html + el._children.map(serializeChild).join("");
    },
    set(v) { el._html = String(v || ""); el._text = ""; el._children = []; },
  });
  Object.defineProperty(el, "textContent", {
    get() { return el._text + el._children.map(c => c.textContent).join(""); },
    set(v) { el._text = String(v == null ? "" : v); el._children = []; },
  });
  el.createEl = (t) => { const c = v066_makeFakeEl(); c.tag = t; el._children.push(c); return c; };
  el.appendChild = (c) => { el._children.push(c); return c; };
  return el;
}

// Fake-DV shim for Pass 4: supports pages(), page(), container, and the
// chainable .where().array() pattern that the new _query uses.
function v066_makeFakeDv(pages) {
  const arr = pages.slice();
  function chainOver(items) {
    const c = {
      _arr: items.slice(),
      where(fn) { return chainOver(this._arr.filter(fn)); },
      sort(fn) { const s = this._arr.slice(); try { s.sort((a,b) => { const av = fn(a); const bv = fn(b); return av > bv ? 1 : av < bv ? -1 : 0; }); } catch(_) {} return chainOver(s); },
      slice(a, b) { return chainOver(this._arr.slice(a, b)); },
      array() { return this._arr.slice(); },
    };
    c[Symbol.iterator] = function* () { for (const p of c._arr) yield p; };
    Object.defineProperty(c, "length", { get() { return c._arr.length; } });
    return c;
  }
  const container = v066_makeFakeEl();
  return {
    container,
    pages: () => chainOver(arr),
    page:  (path) => arr.find(p => p && p.file && p.file.path === path) || null,
    el:    (t) => container.createEl(t),
  };
}

// Load ActivityFeed for Pass 4 tests (uses same src + shims as Pass 3)
function v066_loadAF() {
  const customJsShim = {
    BeaconCards: {
      render(dv, opts) {
        const container = dv.container || dv;
        for (const p of (opts && opts.pages) || []) {
          const card = container.createEl("div");
          const name = (opts.title ? opts.title(p) : (p.file && p.file.name)) || "";
          card.textContent = name;
          if (typeof opts.meta === "function") {
            const metaEl = card.createEl("span");
            opts.meta(p, metaEl);
          }
        }
      },
    },
  };
  const factory = new Function(
    "app", "customJS", "Notice", "window",
    src + "\nreturn ActivityFeed;"
  );
  return factory({}, customJsShim, function(){}, windowShim);
}

// AF-V066-RU-1: single child rolls up into synthetic page (root not in window)
try {
  const root = { file: { path: "spice/projects/sauce/Sauce.md", name: "Sauce", mtime: { toISO: () => "2026-05-19T08:00:00Z" } }, type: "project", created_at: "2026-05-18" };
  const child = { file: { path: "spice/projects/sauce/tasks/foo/foo.md", name: "foo", mtime: { toISO: () => "2026-05-19T10:24:00Z" } }, type: "project-task", created_at: "2026-05-19T10:24:00Z" };
  const dv = v066_makeFakeDv([root, child]);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-19",
    blueprints: ["project"],
    flatGrouped: true,
    includeMtime: true,
    rollUpRoots: [{
      type: "project",
      childMatch: (p) => /^spice\/projects\/[^/]+\//.test(p.file.path) && p.type !== "project",
      rootPath: (p) => "spice/projects/sauce/Sauce.md",
    }],
  });
  assertTrue("AF-V066-RU-1: child rolls up into root card (no 'foo' in HTML)",
    dv.container.innerHTML.indexOf("Sauce") >= 0 &&
    dv.container.innerHTML.indexOf("foo") < 0);
} catch (e) {
  assertTrue("AF-V066-RU-1: child rolls up into root card (no 'foo' in HTML)", false, e && e.message);
}

// AF-V066-RU-2: root + child both in window → root is decorated, not duplicated
try {
  const root2 = { file: { path: "spice/projects/sauce/Sauce.md", name: "Sauce", mtime: { toISO: () => "2026-05-19T08:00:00Z" } }, type: "project", created_at: "2026-05-19T07:00:00Z" };
  const child2 = { file: { path: "spice/projects/sauce/tasks/foo/foo.md", name: "foo", mtime: { toISO: () => "2026-05-19T10:24:00Z" } }, type: "project-task", created_at: "2026-05-19T10:24:00Z" };
  const dv2 = v066_makeFakeDv([root2, child2]);
  const ActivityFeed2 = v066_loadAF();
  const af2 = new ActivityFeed2();
  let metaPages = [];
  af2.render(dv2, {
    scope: "today",
    asOf: "2026-05-19",
    blueprints: ["project"],
    flatGrouped: true,
    includeMtime: true,
    rollUpRoots: [{
      type: "project",
      childMatch: (p) => /^spice\/projects\/[^/]+\//.test(p.file.path) && p.type !== "project",
      rootPath: (p) => "spice/projects/sauce/Sauce.md",
    }],
    metaBuilder: (p, el) => { metaPages.push(p); el.textContent = (p._isRollUp ? "rollup-" + p._rollUpChildren : "raw"); },
  });
  assertTrue("AF-V066-RU-2a: root surfaces once (no dup)", metaPages.length === 1);
  assertTrue("AF-V066-RU-2b: root decorated with _isRollUp",  metaPages[0] && metaPages[0]._isRollUp === true);
  assertTrue("AF-V066-RU-2c: _rollUpChildren counts child",   metaPages[0] && metaPages[0]._rollUpChildren === 1);
} catch (e) {
  assertTrue("AF-V066-RU-2a: root surfaces once (no dup)", false, e && e.message);
  assertTrue("AF-V066-RU-2b: root decorated with _isRollUp", false, e && e.message);
  assertTrue("AF-V066-RU-2c: _rollUpChildren counts child", false, e && e.message);
}

// AF-V066-RU-3: exclude() strips template-named children
try {
  const root3 = { file: { path: "spice/trips/big/big.md", name: "big" }, type: "trip", created_at: "2026-05-19" };
  const tpl3  = { file: { path: "spice/trips/big/Template, Trip Atlas.md", name: "Template, Trip Atlas" }, type: "trip", created_at: "2026-05-19" };
  const dv3 = v066_makeFakeDv([root3, tpl3]);
  const ActivityFeed3 = v066_loadAF();
  const af3 = new ActivityFeed3();
  af3.render(dv3, {
    scope: "today",
    asOf: "2026-05-19",
    blueprints: ["trip"],
    flatGrouped: true,
    rollUpRoots: [{
      type: "trip",
      childMatch: (p) => /^spice\/trips\/[^/]+\//.test(p.file.path) && p.file.path !== "spice/trips/big/big.md",
      rootPath:   (p) => "spice/trips/big/big.md",
      exclude:    (p) => /^Template,/i.test(p.file.name),
    }],
  });
  assertTrue("AF-V066-RU-3: template-named child excluded", dv3.container.innerHTML.indexOf("Template") < 0);
} catch (e) {
  assertTrue("AF-V066-RU-3: template-named child excluded", false, e && e.message);
}

// AF-V066-RU-4: flatGrouped renders NO inner <details>
try {
  const root4 = { file: { path: "spice/projects/sauce/Sauce.md", name: "Sauce" }, type: "project", created_at: "2026-05-19" };
  const dv4 = v066_makeFakeDv([root4]);
  const ActivityFeed4 = v066_loadAF();
  const af4 = new ActivityFeed4();
  af4.render(dv4, { scope: "today", asOf: "2026-05-19", blueprints: ["project"], flatGrouped: true, groupBy: "blueprint" });
  const detailsCount = (dv4.container.innerHTML.match(/<details/g) || []).length;
  assertTrue("AF-V066-RU-4: flatGrouped emits no inner <details>", detailsCount === 0);
} catch (e) {
  assertTrue("AF-V066-RU-4: flatGrouped emits no inner <details>", false, e && e.message);
}

// AF-V066-RU-5: metaBuilder invoked with (page, parentEl)
try {
  const root5 = { file: { path: "spice/projects/sauce/Sauce.md", name: "Sauce" }, type: "project", created_at: "2026-05-19" };
  const dv5 = v066_makeFakeDv([root5]);
  const ActivityFeed5 = v066_loadAF();
  const af5 = new ActivityFeed5();
  let lastArgs = null;
  af5.render(dv5, {
    scope: "today",
    asOf: "2026-05-19",
    blueprints: ["project"],
    flatGrouped: true,
    metaBuilder: function (p, el) { lastArgs = { arity: arguments.length, p, el }; },
  });
  assertTrue("AF-V066-RU-5a: metaBuilder receives 2 args", lastArgs && lastArgs.arity === 2);
  assertTrue("AF-V066-RU-5b: metaBuilder page is the root", lastArgs && lastArgs.p && lastArgs.p.file && lastArgs.p.file.path === "spice/projects/sauce/Sauce.md");
} catch (e) {
  assertTrue("AF-V066-RU-5a: metaBuilder receives 2 args", false, e && e.message);
  assertTrue("AF-V066-RU-5b: metaBuilder page is the root", false, e && e.message);
}

// AF-V066-RU-6: empty rollUpRoots is a no-op
try {
  const root6 = { file: { path: "spice/projects/sauce/Sauce.md", name: "Sauce" }, type: "project", created_at: "2026-05-19" };
  const dv6 = v066_makeFakeDv([root6]);
  const ActivityFeed6 = v066_loadAF();
  const af6 = new ActivityFeed6();
  af6.render(dv6, { scope: "today", asOf: "2026-05-19", blueprints: ["project"], rollUpRoots: [] });
  assertTrue("AF-V066-RU-6: empty rollUpRoots renders normally", dv6.container.innerHTML.indexOf("Sauce") >= 0);
} catch (e) {
  assertTrue("AF-V066-RU-6: empty rollUpRoots renders normally", false, e && e.message);
}

// AF-V067-RUC-1: synthetic page carries _rollUpChildrenPages as array
try {
  const root = { file: { path: "spice/projects/sauce/Sauce.md", name: "Sauce", mtime: { toISO: () => "2026-05-19T08:00:00Z" } }, type: "project", created_at: "2026-05-18" };
  const c1 = { file: { path: "spice/projects/sauce/tasks/a/a.md", name: "a", mtime: { toISO: () => "2026-05-19T10:00:00Z" } }, type: "project-task", created_at: "2026-05-19T10:00:00Z" };
  const c2 = { file: { path: "spice/projects/sauce/tasks/b/b.md", name: "b", mtime: { toISO: () => "2026-05-19T11:00:00Z" } }, type: "project-task", created_at: "2026-05-19T11:00:00Z" };
  const dv = v066_makeFakeDv([root, c1, c2]);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  let capturedPage = null;
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-19",
    blueprints: ["project"],
    flatGrouped: true,
    rollUpRoots: [{
      type: "project",
      childMatch: (p) => /^spice\/projects\/sauce\/tasks\//.test(p.file.path),
      rootPath:   (p) => "spice/projects/sauce/Sauce.md",
    }],
    metaBuilder: (p, el) => { if (p && p._isRollUp) capturedPage = p; },
  });
  assertTrue("AF-V067-RUC-1a: synthetic page captured", !!capturedPage);
  assertTrue("AF-V067-RUC-1b: _rollUpChildrenPages is an array",
    capturedPage && Array.isArray(capturedPage._rollUpChildrenPages));
} catch (e) {
  assertTrue("AF-V067-RUC-1a: synthetic page captured", false, e && e.message);
  assertTrue("AF-V067-RUC-1b: _rollUpChildrenPages is an array", false, e && e.message);
}

// AF-V067-RUC-2: _rollUpChildrenPages.length === _rollUpChildren
try {
  const root = { file: { path: "spice/projects/sauce/Sauce.md", name: "Sauce", mtime: { toISO: () => "2026-05-19T08:00:00Z" } }, type: "project", created_at: "2026-05-18" };
  const c1 = { file: { path: "spice/projects/sauce/tasks/a/a.md", name: "a", mtime: { toISO: () => "2026-05-19T10:00:00Z" } }, type: "project-task", created_at: "2026-05-19T10:00:00Z" };
  const c2 = { file: { path: "spice/projects/sauce/tasks/b/b.md", name: "b", mtime: { toISO: () => "2026-05-19T11:00:00Z" } }, type: "project-task", created_at: "2026-05-19T11:00:00Z" };
  const dv = v066_makeFakeDv([root, c1, c2]);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  let capturedPage = null;
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-19",
    blueprints: ["project"],
    flatGrouped: true,
    rollUpRoots: [{
      type: "project",
      childMatch: (p) => /^spice\/projects\/sauce\/tasks\//.test(p.file.path),
      rootPath:   (p) => "spice/projects/sauce/Sauce.md",
    }],
    metaBuilder: (p, el) => { if (p && p._isRollUp) capturedPage = p; },
  });
  assertTrue("AF-V067-RUC-2: _rollUpChildrenPages.length === _rollUpChildren",
    capturedPage && capturedPage._rollUpChildrenPages.length === capturedPage._rollUpChildren);
} catch (e) {
  assertTrue("AF-V067-RUC-2: _rollUpChildrenPages.length === _rollUpChildren", false, e && e.message);
}

// AF-V067-RUC-3: every entry in _rollUpChildrenPages matches an original child page by path
try {
  const root = { file: { path: "spice/projects/sauce/Sauce.md", name: "Sauce", mtime: { toISO: () => "2026-05-19T08:00:00Z" } }, type: "project", created_at: "2026-05-18" };
  const c1 = { file: { path: "spice/projects/sauce/tasks/a/a.md", name: "a", mtime: { toISO: () => "2026-05-19T10:00:00Z" } }, type: "project-task", created_at: "2026-05-19T10:00:00Z" };
  const c2 = { file: { path: "spice/projects/sauce/tasks/b/b.md", name: "b", mtime: { toISO: () => "2026-05-19T11:00:00Z" } }, type: "project-task", created_at: "2026-05-19T11:00:00Z" };
  const dv = v066_makeFakeDv([root, c1, c2]);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  let capturedPage = null;
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-19",
    blueprints: ["project"],
    flatGrouped: true,
    rollUpRoots: [{
      type: "project",
      childMatch: (p) => /^spice\/projects\/sauce\/tasks\//.test(p.file.path),
      rootPath:   (p) => "spice/projects/sauce/Sauce.md",
    }],
    metaBuilder: (p, el) => { if (p && p._isRollUp) capturedPage = p; },
  });
  const expectedPaths = ["spice/projects/sauce/tasks/a/a.md", "spice/projects/sauce/tasks/b/b.md"].sort();
  const actualPaths = (capturedPage && capturedPage._rollUpChildrenPages.map(c => c.file.path).sort()) || [];
  assertEq("AF-V067-RUC-3: child paths match original pages", actualPaths, expectedPaths);
} catch (e) {
  assertTrue("AF-V067-RUC-3: child paths match original pages", false, e && e.message);
}

// AF-V067-RUC-4: decorated-existing-survivor branch also carries _rollUpChildrenPages
try {
  const root = { file: { path: "spice/projects/sauce/Sauce.md", name: "Sauce", mtime: { toISO: () => "2026-05-19T08:00:00Z" } }, type: "project", created_at: "2026-05-19T08:00:00Z" };
  const c1 = { file: { path: "spice/projects/sauce/tasks/a/a.md", name: "a", mtime: { toISO: () => "2026-05-19T10:00:00Z" } }, type: "project-task", created_at: "2026-05-19T10:00:00Z" };
  const dv = v066_makeFakeDv([root, c1]);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  let capturedPage = null;
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-19",
    blueprints: ["project"],
    flatGrouped: true,
    rollUpRoots: [{
      type: "project",
      childMatch: (p) => /^spice\/projects\/sauce\/tasks\//.test(p.file.path),
      rootPath:   (p) => "spice/projects/sauce/Sauce.md",
    }],
    metaBuilder: (p, el) => { if (p && p._isRollUp) capturedPage = p; },
  });
  // Root IS in windowed (created_at on 2026-05-19), so existing-survivor branch fires.
  assertTrue("AF-V067-RUC-4a: decorated page is the survivor root",
    capturedPage && capturedPage.file && capturedPage.file.path === "spice/projects/sauce/Sauce.md");
  assertTrue("AF-V067-RUC-4b: decorated page carries _rollUpChildrenPages",
    capturedPage && Array.isArray(capturedPage._rollUpChildrenPages) && capturedPage._rollUpChildrenPages.length === 1);
} catch (e) {
  assertTrue("AF-V067-RUC-4a: decorated page is the survivor root", false, e && e.message);
  assertTrue("AF-V067-RUC-4b: decorated page carries _rollUpChildrenPages", false, e && e.message);
}

// AF-V067-RUC-5: backwards-compat — caller that doesn't read _rollUpChildrenPages sees unchanged HTML
try {
  const root = { file: { path: "spice/projects/sauce/Sauce.md", name: "Sauce", mtime: { toISO: () => "2026-05-19T08:00:00Z" } }, type: "project", created_at: "2026-05-18" };
  const c1 = { file: { path: "spice/projects/sauce/tasks/a/a.md", name: "a", mtime: { toISO: () => "2026-05-19T10:00:00Z" } }, type: "project-task", created_at: "2026-05-19T10:00:00Z" };
  const dv = v066_makeFakeDv([root, c1]);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-19",
    blueprints: ["project"],
    flatGrouped: true,
    rollUpRoots: [{
      type: "project",
      childMatch: (p) => /^spice\/projects\/sauce\/tasks\//.test(p.file.path),
      rootPath:   (p) => "spice/projects/sauce/Sauce.md",
    }],
  });
  // No metaBuilder; render must still complete and emit the root card.
  assertTrue("AF-V067-RUC-5: render with no metaBuilder emits root card",
    dv.container.innerHTML.indexOf("Sauce") >= 0);
} catch (e) {
  assertTrue("AF-V067-RUC-5: render with no metaBuilder emits root card", false, e && e.message);
}

// ── Pass 5: v0.70.0 — bucketRules / groupOrder / defaultClosed / framed ────

console.log("\n--- Pass 5: v0.70.0 framed renderer + bucketing + ordering ---");

// AF-V070-BUCKET-1: bucketRules merges cowork-* into a single "cowork" group
try {
  const pA = { file: { path: "spice/cowork/eod.md",     name: "eod"     }, type: "cowork-eod-review",       created_at: "2026-05-19T17:00:00Z" };
  const pB = { file: { path: "spice/cowork/morning.md", name: "morning" }, type: "cowork-morning-briefing", created_at: "2026-05-19T04:30:00Z" };
  const dv = v066_makeFakeDv([pA, pB]);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-19",
    blueprints: ["cowork-eod-review", "cowork-morning-briefing"],
    framed: true,
    bucketRules: [{ bucketKey: "cowork", match: (t) => t.indexOf("cowork-") === 0 }],
  });
  const html = dv.container.innerHTML;
  const coworkGroups = (html.match(/data-group="cowork"/g) || []).length;
  const subGroups    = (html.match(/data-group="cowork-/g) || []).length;
  assertTrue("AF-V070-BUCKET-1a: exactly one data-group=\"cowork\" emitted", coworkGroups === 1);
  assertTrue("AF-V070-BUCKET-1b: no data-group=\"cowork-...\" sub-group survives", subGroups === 0);
  assertTrue("AF-V070-BUCKET-1c: both child titles render inside the bucket",
    html.indexOf("eod") >= 0 && html.indexOf("morning") >= 0);
} catch (e) {
  assertTrue("AF-V070-BUCKET-1: bucketRules merge", false, e && e.message);
}

// AF-V070-ORDER-1: groupOrder pins keys to the top in given order; middle alphabetical; groupOrderBottom pinned last
try {
  const pages = [
    { file: { path: "j.md", name: "j" }, type: "journal", created_at: "2026-05-19T09:00:00Z" },
    { file: { path: "s.md", name: "s" }, type: "scratch", created_at: "2026-05-19T10:00:00Z" },
    { file: { path: "c.md", name: "c" }, type: "cowork",  created_at: "2026-05-19T11:00:00Z" },
    { file: { path: "p.md", name: "p" }, type: "project", created_at: "2026-05-19T12:00:00Z" },
  ];
  const dv = v066_makeFakeDv(pages);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-19",
    blueprints: ["journal", "scratch", "cowork", "project"],
    framed: true,
    groupOrder: ["cowork", "project"],
    groupOrderBottom: ["scratch"],
  });
  const html = dv.container.innerHTML;
  const order = [];
  const re = /data-group="([^"]+)"/g;
  let m; while ((m = re.exec(html)) !== null) order.push(m[1]);
  assertEq("AF-V070-ORDER-1: group order = [cowork, project, journal, scratch]",
    order, ["cowork", "project", "journal", "scratch"]);
} catch (e) {
  assertTrue("AF-V070-ORDER-1: group order", false, e && e.message);
}

// AF-V070-ORDER-2: empty groupOrder entry is silently skipped
try {
  const pages = [
    { file: { path: "c.md", name: "c" }, type: "cowork", created_at: "2026-05-19T11:00:00Z" },
  ];
  const dv = v066_makeFakeDv(pages);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-19",
    blueprints: ["cowork", "project"],
    framed: true,
    groupOrder: ["cowork", "project", "trip"],
  });
  const html = dv.container.innerHTML;
  assertTrue("AF-V070-ORDER-2a: cowork group emitted",  /data-group="cowork"/.test(html));
  assertTrue("AF-V070-ORDER-2b: empty project group not emitted", !/data-group="project"/.test(html));
  assertTrue("AF-V070-ORDER-2c: empty trip group not emitted",    !/data-group="trip"/.test(html));
} catch (e) {
  assertTrue("AF-V070-ORDER-2: empty groupOrder entries skipped", false, e && e.message);
}

// AF-V070-CLOSED-1: defaultClosed keys omit the `open` attribute on <details>
try {
  const pages = [
    { file: { path: "c.md", name: "c" }, type: "cowork",  created_at: "2026-05-19T11:00:00Z" },
    { file: { path: "s.md", name: "s" }, type: "scratch", created_at: "2026-05-19T10:00:00Z" },
  ];
  const dv = v066_makeFakeDv(pages);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-19",
    blueprints: ["cowork", "scratch"],
    framed: true,
    groupOrder: ["cowork"],
    groupOrderBottom: ["scratch"],
    defaultClosed: ["scratch"],
  });
  const findGroups = (el) => {
    const out = [];
    for (const c of (el._children || [])) {
      if (c.tag === "div" && (c.dataset && c.dataset.group)) out.push(c);
      out.push(...findGroups(c));
    }
    return out;
  };
  const findDetails = (el) => {
    for (const c of (el._children || [])) {
      if (c.tag === "details") return c;
      const inner = findDetails(c);
      if (inner) return inner;
    }
    return null;
  };
  const groupEls = findGroups(dv.container);
  const byKey = {};
  for (const g of groupEls) byKey[g.dataset.group] = findDetails(g);
  assertTrue("AF-V070-CLOSED-1a: cowork <details> has open=true",  byKey.cowork  && byKey.cowork.open === true);
  assertTrue("AF-V070-CLOSED-1b: scratch <details> has open=false", byKey.scratch && byKey.scratch.open === false);
} catch (e) {
  assertTrue("AF-V070-CLOSED-1: defaultClosed", false, e && e.message);
}

// AF-V070-FRAMED-1: framed DOM emits .sauce-group > details > summary.sauce-group-header + .sauce-group-body
try {
  const pages = [
    { file: { path: "c.md", name: "c" }, type: "cowork", created_at: "2026-05-19T11:00:00Z" },
  ];
  const dv = v066_makeFakeDv(pages);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-19",
    blueprints: ["cowork"],
    framed: true,
  });
  const html = dv.container.innerHTML;
  assertTrue("AF-V070-FRAMED-1a: structural <details> emitted under .sauce-group", html.indexOf("<details") >= 0);
  assertTrue("AF-V070-FRAMED-1b: <summary> emitted",                                 html.indexOf("<summary") >= 0);
  assertTrue("AF-V070-FRAMED-1c: data-group attribute carries the group key",        html.indexOf("cowork") >= 0);
} catch (e) {
  assertTrue("AF-V070-FRAMED-1: framed DOM shape", false, e && e.message);
}

// AF-V070-FRAMED-2: framed renderer does NOT call BeaconCards.render for inner rows
try {
  const pages = [
    { file: { path: "c.md", name: "c" }, type: "cowork", created_at: "2026-05-19T11:00:00Z" },
  ];
  const dv = v066_makeFakeDv(pages);
  let beaconCalled = false;
  const customJsShim = {
    BeaconCards: {
      render(_dv, _opts) { beaconCalled = true; },
    },
  };
  const factory = new Function("app", "customJS", "Notice", "window", src + "\nreturn ActivityFeed;");
  const ActivityFeed = factory({}, customJsShim, function(){}, windowShim);
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-19",
    blueprints: ["cowork"],
    framed: true,
  });
  assertTrue("AF-V070-FRAMED-2: framed path does not delegate inner rows to BeaconCards", beaconCalled === false);
} catch (e) {
  assertTrue("AF-V070-FRAMED-2: framed path bypasses BeaconCards", false, e && e.message);
}

// AF-V070-META-1: metaBuilder is invoked with (page, parentEl) per row under framed
try {
  const pages = [
    { file: { path: "a.md", name: "a" }, type: "cowork", created_at: "2026-05-19T11:00:00Z" },
    { file: { path: "b.md", name: "b" }, type: "cowork", created_at: "2026-05-19T10:00:00Z" },
  ];
  const dv = v066_makeFakeDv(pages);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  const seen = [];
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-19",
    blueprints: ["cowork"],
    framed: true,
    metaBuilder: (p, el) => { seen.push({ path: p.file.path, hasEl: !!el }); el.textContent = "meta"; },
  });
  assertTrue("AF-V070-META-1a: metaBuilder invoked twice",       seen.length === 2);
  assertTrue("AF-V070-META-1b: metaBuilder received an element", seen.every(s => s.hasEl === true));
} catch (e) {
  assertTrue("AF-V070-META-1: metaBuilder under framed", false, e && e.message);
}

// AF-V070-FLAT-1: flatGrouped opt is now ignored (no-op) — the framed path is the only group renderer
try {
  const pages = [
    { file: { path: "c.md", name: "c" }, type: "cowork", created_at: "2026-05-19T11:00:00Z" },
  ];
  const dv = v066_makeFakeDv(pages);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-19",
    blueprints: ["cowork"],
    flatGrouped: true,
  });
  const html = dv.container.innerHTML;
  assertTrue("AF-V070-FLAT-1: flatGrouped no longer emits sauce-group-header", !/sauce-group-header/.test(html));
} catch (e) {
  assertTrue("AF-V070-FLAT-1: flatGrouped removed", false, e && e.message);
}

// AF-V070-CONFLICT-1: when groupOrder + groupOrderBottom both list the same key, top wins
try {
  const pages = [
    { file: { path: "c.md", name: "c" }, type: "cowork", created_at: "2026-05-19T11:00:00Z" },
    { file: { path: "s.md", name: "s" }, type: "scratch", created_at: "2026-05-19T10:00:00Z" },
  ];
  const dv = v066_makeFakeDv(pages);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-19",
    blueprints: ["cowork", "scratch"],
    framed: true,
    groupOrder: ["cowork"],
    groupOrderBottom: ["cowork", "scratch"],
  });
  const html = dv.container.innerHTML;
  const cIdx = html.indexOf('data-group="cowork"');
  const sIdx = html.indexOf('data-group="scratch"');
  assertTrue("AF-V070-CONFLICT-1: top wins when key listed in both arrays", cIdx >= 0 && sIdx > cIdx);
} catch (e) {
  assertTrue("AF-V070-CONFLICT-1: ordering conflict resolution", false, e && e.message);
}

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\nrun-activity-feed.js: ${pass} pass · ${fail} fail`);
if (fail > 0) {
  console.log("\n--- Failures ---");
  for (const f of failures) console.log(f);
  process.exit(1);
}
process.exit(0);
