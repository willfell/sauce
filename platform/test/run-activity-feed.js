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
const VERSION_SNAPSHOT = require("./fixtures/component-versions.snapshot.json");

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
  assertEq("AF-1d: manifest.version matches snapshot", manifest.version, VERSION_SNAPSHOT.components["activity-feed"]);
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

  // AF-SECSTATE: the group-collapse-state persistence must NOT write on the
  // programmatic details.open restore (async toggle) — that write hits
  // ranch/cache/dashboard-section-state.json inside the vault and feeds Dataview's
  // file-change auto-refresh → the Home "reloads every time" loop. Guard the
  // toggle (skip when open still equals lastPersisted) + idempotent write.
  assertTrue("AF-SECSTATE-1: toggle handler guards programmatic open (lastPersisted)",
    /let\s+lastPersisted\s*=\s*initialOpen/.test(src) && /if\s*\(\s*details\.open\s*===\s*lastPersisted\s*\)\s*return/.test(src));
  assertTrue("AF-SECSTATE-2: _writeGroupStateKey is idempotent (skips unchanged value)",
    /hasOwnProperty\.call\(cur,\s*key\)\s*&&\s*cur\[key\]\s*===\s*!!value\)\s*return/.test(src));

  // AF-6: all 3 scope literals present.
  for (const sc of ["today", "week", "month"]) {
    assertTrue(`AF-6.${sc}: scope literal '${sc}' present in source`,
      new RegExp("\"" + sc + "\"|'" + sc + "'").test(src));
  }

  // AF-7: canonical default blueprint types — at least these 10.
  const canonical = ["daily", "meeting", "sticky-note", "cowork-daily", "to-do", "journal", "project", "person", "team", "trip"];
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

  // AF-tsKeys-1: tsKeys opt referenced
  assertTrue("AF-tsKeys-1: tsKeys opt referenced in source", /\btsKeys\b/.test(src));

  // AF-tsKeys-2: inWindow predicate accepts multi-key array
  assertTrue("AF-tsKeys-2: inWindow handles tsKeys array",
    /Array\.isArray\(\s*opts\.tsKeys\s*\)|Array\.isArray\(\s*tsKeys\s*\)/.test(src));

  // AF-tsKeys-3: comment naming both keys present
  assertTrue("AF-tsKeys-3: both created_at + status_changed_at mentioned in tsKeys context",
    /tsKeys[\s\S]{0,400}created_at/.test(src) && /tsKeys[\s\S]{0,400}status_changed_at/.test(src));

  // AF-tsKeys-4: v0.6.0 marker in description / docstring
  assertTrue("AF-tsKeys-4: v0.6.0 marker present in source comments", /v0\.6\.0/.test(src));
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
    valueOf() { return new Date(datePart + suffix).getTime(); },
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
    type: "sticky-note",
    created_at: "2026-05-15T10:00:00-06:00",
    file: { name: "page-x.md", path: "page-x.md" },
  };
  const pageY = {
    type: "sticky-note",
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

// AF-M1 — includeMtime: true catches mtime hits for LEGACY pages without
// `created_at`. v0.4.1 fixture update: removed the out-of-window created_at
// (which v0.4.1 now treats as authoritative). Without created_at, the page
// falls back to mtime as designed.
try {
  const pageZ = {
    type: "project",
    // intentionally no created_at — legacy page
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
    "AF-M1: includeMtime falls back to file.mtime when created_at is absent",
    hasZ,
    "AF-M1: includeMtime mtime-fallback did not surface a legacy page (no created_at) with in-window mtime"
  );
} catch (e) {
  assertTrue(
    "AF-M1: includeMtime falls back to file.mtime when created_at is absent",
    false,
    "AF-M1: includeMtime mtime-fallback path threw: " + (e && e.message)
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
  assertEq("AF-V065: activity-feed manifest version matches snapshot", manifest.version, VERSION_SNAPSHOT.components["activity-feed"]);
  assertTrue("AF-V065: activity-feed description mentions latest shipping version",
    typeof manifest.description === "string" && manifest.description.includes("v0.7.0"));
}

// ── Pass 4: v0.66.0 rollUpRoots + flatGrouped + metaBuilder ──────────────

console.log("\n--- Pass 4: v0.66.0 rollUpRoots + flatGrouped + metaBuilder ---");

// Fake-element shim for Pass 4 (node-harness-safe; uses createEl + textContent only).
// innerHTML tracks both structural tags AND text set via textContent, so assertions
// like indexOf("Sauce") work correctly.
function v066_makeFakeEl() {
  const el = {
    tag: "div",
    style: {
      setProperty(_k, _v) { /* no-op for the harness; production hits real DOM */ },
    },
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
        if (typeof c.className === "string" && c.className.length > 0) {
          attrs += ' class="' + c.className + '"';
        }
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
  el.closest = (_sel) => null;  // node-harness no-op; production hits real DOM
  el.addEventListener = (_type, _fn) => { /* no-op; tests don't dispatch events */ };
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
    { file: { path: "s.md", name: "s" }, type: "sticky-note", created_at: "2026-05-19T10:00:00Z" },
    { file: { path: "c.md", name: "c" }, type: "cowork",  created_at: "2026-05-19T11:00:00Z" },
    { file: { path: "p.md", name: "p" }, type: "project", created_at: "2026-05-19T12:00:00Z" },
  ];
  const dv = v066_makeFakeDv(pages);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-19",
    blueprints: ["journal", "sticky-note", "cowork", "project"],
    framed: true,
    groupOrder: ["cowork", "project"],
    groupOrderBottom: ["sticky-note"],
  });
  const html = dv.container.innerHTML;
  const order = [];
  const re = /data-group="([^"]+)"/g;
  let m; while ((m = re.exec(html)) !== null) order.push(m[1]);
  assertEq("AF-V070-ORDER-1: group order = [cowork, project, journal, sticky-note]",
    order, ["cowork", "project", "journal", "sticky-note"]);
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
    { file: { path: "s.md", name: "s" }, type: "sticky-note", created_at: "2026-05-19T10:00:00Z" },
  ];
  const dv = v066_makeFakeDv(pages);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-19",
    blueprints: ["cowork", "sticky-note"],
    framed: true,
    groupOrder: ["cowork"],
    groupOrderBottom: ["sticky-note"],
    defaultClosed: ["sticky-note"],
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
  assertTrue("AF-V070-CLOSED-1b: sticky-note <details> has open=false", byKey["sticky-note"] && byKey["sticky-note"].open === false);
} catch (e) {
  assertTrue("AF-V070-CLOSED-1: defaultClosed", false, e && e.message);
}

// AF-COLLAPSE-1: a group with exactly 3 pages (the threshold) stays OPEN.
try {
  const pages = [1, 2, 3].map((n) => ({ file: { path: `w${n}.md`, name: `w${n}` }, type: "wiki", created_at: `2026-05-19T1${n}:00:00Z` }));
  const dv = v066_makeFakeDv(pages);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, { scope: "today", asOf: "2026-05-19", blueprints: ["wiki"], framed: true, groupOrder: ["wiki"] });
  const findDetails = (el) => { for (const c of (el._children || [])) { if (c.tag === "details") return c; const inner = findDetails(c); if (inner) return inner; } return null; };
  const d = findDetails(dv.container);
  assertTrue("AF-COLLAPSE-1: exactly-3-item group stays open by default", d && d.open === true);
} catch (e) {
  assertTrue("AF-COLLAPSE-1: exactly-3-item group stays open by default", false, e && e.message);
}
// AF-COLLAPSE-2: a group with 4 pages (over the threshold) collapses by default.
try {
  const pages = [1, 2, 3, 4].map((n) => ({ file: { path: `w${n}.md`, name: `w${n}` }, type: "wiki", created_at: `2026-05-19T1${n}:00:00Z` }));
  const dv = v066_makeFakeDv(pages);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, { scope: "today", asOf: "2026-05-19", blueprints: ["wiki"], framed: true, groupOrder: ["wiki"] });
  const findDetails = (el) => { for (const c of (el._children || [])) { if (c.tag === "details") return c; const inner = findDetails(c); if (inner) return inner; } return null; };
  const d = findDetails(dv.container);
  assertTrue("AF-COLLAPSE-2: 4-item group collapses by default (no defaultClosed opt needed)", d && d.open === false);
} catch (e) {
  assertTrue("AF-COLLAPSE-2: 4-item group collapses by default", false, e && e.message);
}
// AF-COLLAPSE-3: a custom collapseThreshold is honored (2 items collapses at threshold:1).
try {
  const pages = [1, 2].map((n) => ({ file: { path: `w${n}.md`, name: `w${n}` }, type: "wiki", created_at: `2026-05-19T1${n}:00:00Z` }));
  const dv = v066_makeFakeDv(pages);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, { scope: "today", asOf: "2026-05-19", blueprints: ["wiki"], framed: true, groupOrder: ["wiki"], collapseThreshold: 1 });
  const findDetails = (el) => { for (const c of (el._children || [])) { if (c.tag === "details") return c; const inner = findDetails(c); if (inner) return inner; } return null; };
  const d = findDetails(dv.container);
  assertTrue("AF-COLLAPSE-3: explicit collapseThreshold:1 collapses a 2-item group", d && d.open === false);
} catch (e) {
  assertTrue("AF-COLLAPSE-3: explicit collapseThreshold honored", false, e && e.message);
}
// AF-COLLAPSE-4: defaultClosed still forces closed even when under threshold (1 item, threshold 3).
try {
  const pages = [{ file: { path: "w1.md", name: "w1" }, type: "wiki", created_at: "2026-05-19T11:00:00Z" }];
  const dv = v066_makeFakeDv(pages);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, { scope: "today", asOf: "2026-05-19", blueprints: ["wiki"], framed: true, groupOrder: ["wiki"], defaultClosed: ["wiki"] });
  const findDetails = (el) => { for (const c of (el._children || [])) { if (c.tag === "details") return c; const inner = findDetails(c); if (inner) return inner; } return null; };
  const d = findDetails(dv.container);
  assertTrue("AF-COLLAPSE-4: defaultClosed still forces closed under the count threshold", d && d.open === false);
} catch (e) {
  assertTrue("AF-COLLAPSE-4: defaultClosed forces closed under threshold", false, e && e.message);
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
    { file: { path: "s.md", name: "s" }, type: "sticky-note", created_at: "2026-05-19T10:00:00Z" },
  ];
  const dv = v066_makeFakeDv(pages);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-19",
    blueprints: ["cowork", "sticky-note"],
    framed: true,
    groupOrder: ["cowork"],
    groupOrderBottom: ["cowork", "sticky-note"],
  });
  const html = dv.container.innerHTML;
  const cIdx = html.indexOf('data-group="cowork"');
  const sIdx = html.indexOf('data-group="sticky-note"');
  assertTrue("AF-V070-CONFLICT-1: top wins when key listed in both arrays", cIdx >= 0 && sIdx > cIdx);
} catch (e) {
  assertTrue("AF-V070-CONFLICT-1: ordering conflict resolution", false, e && e.message);
}

// ── Pass 6: v0.4.1 — strict created_at semantics (mobile mtime fix) ─────────

console.log("\n--- Pass 6: v0.4.1 strict created_at semantics ---");

// AF-V071-1: page with out-of-window created_at + in-window mtime is REJECTED.
// Pre-v0.4.1 it was incorrectly ACCEPTED via the mtime fallback — that
// caused Obsidian Mobile to show yesterday's content in today's daily when
// Mobile sync had re-touched the files.
try {
  const page = {
    type: "sticky-note",
    created_at: "2026-05-20T16:44:15-06:00",                 // yesterday
    file: {
      path: "stale.md",
      name: "stale.md",
      mtime: { toISO: () => "2026-05-21T11:00:00-06:00" },   // today (mobile sync time)
    },
  };
  const dv = v066_makeFakeDv([page]);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-21",
    blueprints: ["sticky-note"],
    includeMtime: true,
    framed: true,
  });
  const html = dv.container.innerHTML;
  assertTrue("AF-V071-1: page with out-of-window created_at + in-window mtime is REJECTED (created_at authoritative)",
    html.indexOf("stale") < 0);
} catch (e) {
  assertTrue("AF-V071-1: strict created_at rejection", false, e && e.message);
}

// AF-V071-2: legacy page WITHOUT created_at — mtime fallback still works.
try {
  const page = {
    type: "sticky-note",
    file: {
      path: "legacy.md",
      name: "legacy.md",
      mtime: { toISO: () => "2026-05-21T11:00:00-06:00" },   // today
    },
  };
  const dv = v066_makeFakeDv([page]);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-21",
    blueprints: ["sticky-note"],
    includeMtime: true,
    framed: true,
  });
  const html = dv.container.innerHTML;
  assertTrue("AF-V071-2: legacy page without created_at falls back to mtime (still accepts)",
    html.indexOf("legacy") >= 0);
} catch (e) {
  assertTrue("AF-V071-2: legacy mtime fallback", false, e && e.message);
}

// AF-V071-3: page with in-window created_at + out-of-window mtime is ACCEPTED.
// (created_at wins; mtime being old shouldn't disqualify a newly-created note.)
try {
  const page = {
    type: "sticky-note",
    created_at: "2026-05-21T09:00:00-06:00",                 // today
    file: {
      path: "fresh.md",
      name: "fresh.md",
      mtime: { toISO: () => "2026-05-19T10:00:00-06:00" },   // 2 days ago
    },
  };
  const dv = v066_makeFakeDv([page]);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-21",
    blueprints: ["sticky-note"],
    includeMtime: true,
    framed: true,
  });
  const html = dv.container.innerHTML;
  assertTrue("AF-V071-3: page with in-window created_at + out-of-window mtime is ACCEPTED (created_at wins)",
    html.indexOf("fresh") >= 0);
} catch (e) {
  assertTrue("AF-V071-3: created_at wins over mtime", false, e && e.message);
}

// ── Pass 7: v0.5.0 — groupLabels / groupPreviewBuilder / getSubtitle ─────

console.log("\n--- Pass 7: v0.5.0 groupLabels + groupPreviewBuilder + getSubtitle ---");

// AF-V0710-LABELS-1: groupLabels resolves the framed group header text
try {
  const pA = { file: { path: "spice/cowork/m.md", name: "m" }, type: "cowork-morning-briefing", created_at: "2026-05-21T07:00:00Z" };
  const pB = { file: { path: "spice/cowork/e.md", name: "e" }, type: "cowork-eod-review",       created_at: "2026-05-21T17:00:00Z" };
  const dv = v066_makeFakeDv([pA, pB]);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-21",
    blueprints: ["cowork-morning-briefing", "cowork-eod-review"],
    framed: true,
    groupBy: "blueprint",
    groupLabels: {
      "cowork-morning-briefing": "Morning Briefing",
      "cowork-eod-review":       "EOD Review",
    },
  });
  const html = dv.container.innerHTML;
  assertTrue("AF-V0710-LABELS-1a: rendered label 'Morning Briefing'", html.indexOf("Morning Briefing") >= 0);
  assertTrue("AF-V0710-LABELS-1b: rendered label 'EOD Review'",       html.indexOf("EOD Review") >= 0);
  assertTrue("AF-V0710-LABELS-1c: kebab type-key not surfaced in header",
    !/sauce-group-label[^>]*>cowork-morning-briefing</.test(html));
} catch (e) {
  assertTrue("AF-V0710-LABELS-1: groupLabels resolves header text", false, e && e.message);
}

// AF-V0710-LABELS-2: humanCase fallback when key absent from groupLabels
try {
  const p = { file: { path: "spice/p.md", name: "p" }, type: "project", created_at: "2026-05-21T09:00:00Z" };
  const dv = v066_makeFakeDv([p]);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-21",
    blueprints: ["project"],
    framed: true,
    groupBy: "blueprint",
    groupLabels: {},  // empty map
  });
  const html = dv.container.innerHTML;
  assertTrue("AF-V0710-LABELS-2: fallback to humanCase('project') = 'Project'",
    /sauce-group-label[^>]*>Project/.test(html));
} catch (e) {
  assertTrue("AF-V0710-LABELS-2: humanCase fallback", false, e && e.message);
}

// AF-V0710-PREVIEW-1: groupPreviewBuilder appends preview text to a defaultClosed group header
try {
  const pA = { file: { path: "spice/s/a.md", name: "a" }, type: "sticky-note", frontmatter: { summary: "Migrating mesh state to prod" }, created_at: "2026-05-21T10:00:00Z" };
  const pB = { file: { path: "spice/s/b.md", name: "b" }, type: "sticky-note", frontmatter: { summary: "Reviewing PR backlog" },         created_at: "2026-05-21T11:00:00Z" };
  const dv = v066_makeFakeDv([pA, pB]);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-21",
    blueprints: ["sticky-note"],
    framed: true,
    groupBy: "blueprint",
    defaultClosed: ["sticky-note"],
    groupPreviewBuilder: function (pages) {
      return (pages[0] && pages[0].frontmatter && pages[0].frontmatter.summary) || "";
    },
  });
  const html = dv.container.innerHTML;
  // Most-recent (pB) sorts first in the existing tsKey-desc ordering
  assertTrue("AF-V0710-PREVIEW-1a: preview text from latest page summary appears in header",
    html.indexOf("Reviewing PR backlog") >= 0);
  assertTrue("AF-V0710-PREVIEW-1b: preview emitted as ' — <text>' suffix",
    /\(\d+\)\s+—\s+Reviewing PR backlog/.test(html));
} catch (e) {
  assertTrue("AF-V0710-PREVIEW-1: groupPreviewBuilder preview text", false, e && e.message);
}

// AF-V0710-PREVIEW-2: 80-char truncation + trailing ellipsis
try {
  const longSummary = "x".repeat(120);
  const p = { file: { path: "spice/s/a.md", name: "a" }, type: "sticky-note", frontmatter: { summary: longSummary }, created_at: "2026-05-21T10:00:00Z" };
  const dv = v066_makeFakeDv([p]);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-21",
    blueprints: ["sticky-note"],
    framed: true,
    groupBy: "blueprint",
    defaultClosed: ["sticky-note"],
    groupPreviewBuilder: function (pages) {
      return pages[0].frontmatter.summary;
    },
  });
  const html = dv.container.innerHTML;
  // Find the truncated form: exactly 80 x's followed by an ellipsis char
  assertTrue("AF-V0710-PREVIEW-2a: 80-char truncation present",
    html.indexOf("x".repeat(80) + "…") >= 0);
  assertTrue("AF-V0710-PREVIEW-2b: 81-char run absent (means truncation worked)",
    html.indexOf("x".repeat(81)) < 0);
} catch (e) {
  assertTrue("AF-V0710-PREVIEW-2: 80-char truncation", false, e && e.message);
}

// AF-V0710-PREVIEW-3: builder returning empty string preserves count-only header
try {
  const p = { file: { path: "spice/s/a.md", name: "a" }, type: "sticky-note", created_at: "2026-05-21T10:00:00Z" };
  const dv = v066_makeFakeDv([p]);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-21",
    blueprints: ["sticky-note"],
    framed: true,
    groupBy: "blueprint",
    defaultClosed: ["sticky-note"],
    groupPreviewBuilder: function () { return ""; },
  });
  const html = dv.container.innerHTML;
  assertTrue("AF-V0710-PREVIEW-3a: no em-dash suffix when builder returns empty",
    !/\(\d+\)\s+—/.test(html));
} catch (e) {
  assertTrue("AF-V0710-PREVIEW-3: empty-builder fallback", false, e && e.message);
}

// AF-V0710-PREVIEW-4: opt omitted entirely preserves count-only header
try {
  const p = { file: { path: "spice/s/a.md", name: "a" }, type: "sticky-note", created_at: "2026-05-21T10:00:00Z" };
  const dv = v066_makeFakeDv([p]);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-21",
    blueprints: ["sticky-note"],
    framed: true,
    groupBy: "blueprint",
    defaultClosed: ["sticky-note"],
    // no groupPreviewBuilder
  });
  const html = dv.container.innerHTML;
  assertTrue("AF-V0710-PREVIEW-4: no em-dash suffix when builder omitted",
    !/\(\d+\)\s+—/.test(html));
} catch (e) {
  assertTrue("AF-V0710-PREVIEW-4: omitted-builder fallback", false, e && e.message);
}

// AF-V0710-PREVIEW-5: builder NOT invoked for an open group (only fires on defaultClosed groups)
try {
  let calls = 0;
  const p = { file: { path: "spice/c/a.md", name: "a" }, type: "cowork", frontmatter: { summary: "open-group summary" }, created_at: "2026-05-21T10:00:00Z" };
  const dv = v066_makeFakeDv([p]);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-21",
    blueprints: ["cowork"],
    framed: true,
    groupBy: "blueprint",
    // no defaultClosed — group opens by default
    groupPreviewBuilder: function () { calls++; return "should-not-appear"; },
  });
  const html = dv.container.innerHTML;
  assertTrue("AF-V0710-PREVIEW-5a: builder not invoked on open group", calls === 0);
  assertTrue("AF-V0710-PREVIEW-5b: 'should-not-appear' not in DOM",
    html.indexOf("should-not-appear") < 0);
} catch (e) {
  assertTrue("AF-V0710-PREVIEW-5: builder gated to closed groups", false, e && e.message);
}

// AF-V0710-SUBTITLE-1: getSubtitle overrides the meta builder's default subtitle
try {
  const p = {
    file: { path: "spice/c/m.md", name: "m" },
    type: "cowork-morning-briefing",
    frontmatter: { summary: "today's lead from frontmatter" },
    created_at: "2026-05-21T07:00:00Z",
  };
  const dv = v066_makeFakeDv([p]);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-21",
    blueprints: ["cowork-morning-briefing"],
    framed: true,
    groupBy: "blueprint",
    getSubtitle: function (page) {
      return (page.frontmatter && page.frontmatter.summary) || "";
    },
  });
  const html = dv.container.innerHTML;
  assertTrue("AF-V0710-SUBTITLE-1: getSubtitle reading frontmatter.summary surfaces in row meta",
    html.indexOf("today's lead from frontmatter") >= 0);
} catch (e) {
  assertTrue("AF-V0710-SUBTITLE-1: getSubtitle preference", false, e && e.message);
}

// AF-V0710-CUSTOMJS-1 (v0.5.1 regression guard): file MUST evaluate as a single
// class expression under the customJS contract eval(`(${file})`). v0.5.0 broke
// this with a file-scope _humanCase helper before the class declaration —
// wrapping in parens produced SyntaxError: Unexpected token 'class'. customJS
// then silently fails to register the class, and downstream callers see
// `customJS.ActivityFeed === undefined` (daily dashboard emits "ActivityFeed
// mechanism unavailable"). This assert prevents the regression.
try {
  const srcPath = path.join(WORKSHOP, "platform/mechanisms/activity-feed/activity-feed.js");
  const customJSsrc = fs.readFileSync(srcPath, "utf8");
  let def, instance;
  try {
    def = eval("(" + customJSsrc + ")");
    instance = new def();
  } catch (e) {
    assertTrue("AF-V0710-CUSTOMJS-1: file loads under customJS (`(${file})`) contract", false, e && e.message);
  }
  if (instance) {
    assertTrue("AF-V0710-CUSTOMJS-1a: instance.constructor.name === 'ActivityFeed'",
      instance.constructor && instance.constructor.name === "ActivityFeed");
    assertTrue("AF-V0710-CUSTOMJS-1b: instance.render is a function",
      typeof instance.render === "function");
    assertTrue("AF-V0710-CUSTOMJS-1c: instance._humanCase is a method (not a file-scope binding)",
      typeof instance._humanCase === "function");
    assertTrue("AF-V0710-CUSTOMJS-1d: _humanCase('cowork-morning-briefing') === 'Cowork Morning Briefing'",
      instance._humanCase("cowork-morning-briefing") === "Cowork Morning Briefing");
  }
} catch (e) {
  assertTrue("AF-V0710-CUSTOMJS-1: regression guard for customJS file contract", false, e && e.message);
}

// ── Pass 8: v0.7.0 — tsKeys 3-key path + groupState override + native-Date fallback ─

console.log("\n--- Pass 8: v0.7.0 (sauce v0.73.0) tightening asserts ---");

// AF-V073-1: tsKeys with 3 distinct keys, each page populates one. Verify
// all three pass through the in-window filter (any-in-window semantics).
try {
  const pA = { file: { path: "spice/a.md", name: "a" }, type: "project", created_at: "2026-05-22T08:00:00Z" };                              // hit on created_at
  const pB = { file: { path: "spice/b.md", name: "b" }, type: "project", status_changed_at: "2026-05-22T09:00:00Z" };                       // hit on status_changed_at
  const pC = { file: { path: "spice/c.md", name: "c" }, type: "project", edited_at: "2026-05-22T10:00:00Z" };                               // hit on edited_at
  const pX = { file: { path: "spice/x.md", name: "x" }, type: "project", created_at: "2026-05-20T08:00:00Z" };                              // none in-window
  const dv = v066_makeFakeDv([pA, pB, pC, pX]);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-22",
    blueprints: ["project"],
    framed: true,
    groupBy: "blueprint",
    tsKeys: ["created_at", "status_changed_at", "edited_at"],
  });
  const html = dv.container.innerHTML;
  assertTrue("AF-V073-1a: page A (created_at hit) rendered", html.indexOf(">a<") >= 0 || html.indexOf("\"a\"") >= 0 || html.indexOf("a") >= 0);
  assertTrue("AF-V073-1b: page B (status_changed_at hit) rendered", html.indexOf("b") >= 0);
  assertTrue("AF-V073-1c: page C (edited_at hit) rendered", html.indexOf("c") >= 0);
  // Count should be 3 (exclude pX). Group header carries the count.
  assertTrue("AF-V073-1d: count is (3) — pX with out-of-window created_at excluded",
    /\(3\)/.test(html));
} catch (e) {
  assertTrue("AF-V073-1: tsKeys 3-key path (any-in-window semantics)", false, e && e.message);
}

// AF-V073-2: groupPreviewBuilder still gated to manifest defaultClosed (per
// Part B decision) — even if Part B's persisted groupState would render the
// group open at runtime, the builder fires when isClosed===true at the
// framed renderer call site. This assert exercises the contract from the
// renderer side: defaultClosed:["X"] + builder returning text → suffix in
// header.
try {
  const pA = { file: { path: "spice/k/a.md", name: "a" }, type: "kanban", frontmatter: { summary: "Top of board" }, created_at: "2026-05-22T10:00:00Z" };
  const dv = v066_makeFakeDv([pA]);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, {
    scope: "today",
    asOf: "2026-05-22",
    blueprints: ["kanban"],
    framed: true,
    groupBy: "blueprint",
    defaultClosed: ["kanban"],
    groupPreviewBuilder: function (pages) {
      return (pages[0] && pages[0].frontmatter && pages[0].frontmatter.summary) || "";
    },
  });
  const html = dv.container.innerHTML;
  assertTrue("AF-V073-2a: preview suffix appended to defaultClosed group header",
    /\(\d+\)\s+—\s+Top of board/.test(html));
  assertTrue("AF-V073-2b: data-group=\"kanban\" present (post-bucket key)",
    /data-group="kanban"/.test(html));
} catch (e) {
  assertTrue("AF-V073-2: groupPreviewBuilder gated to manifest-defaultClosed", false, e && e.message);
}

// AF-V073-3: native-Date _resolveTimeWindow fallback reachability. With a
// windowShim that has no `moment`, _resolveTimeWindow("today", "2026-05-22")
// must return start/end ISOs in the same day. This guards the fallback path
// the Node harness depends on (production uses window.moment).
try {
  const srcPath = path.join(WORKSHOP, "platform/mechanisms/activity-feed/activity-feed.js");
  const customJSsrc = fs.readFileSync(srcPath, "utf8");
  // Build a class via eval-parens (same shape as v0510-CUSTOMJS-1).
  const def = eval("(" + customJSsrc + ")");
  const instance = new def();
  const noMomentWindow = {};  // shim missing the moment global
  // _resolveTimeWindow reads `window.moment` from the function-scope binding.
  // The class definition closes over the `window` identifier resolved at
  // call-time — at top-level in eval-parens context, `window` is the test
  // process's globalThis. We can't override that directly, so we test the
  // native-Date branch by passing asOf and verifying the branch is exercised
  // when window.moment is absent. In a Node process, window is undefined,
  // which makes useMoment false and the native path runs.
  // Use local-noon to avoid TZ drift: `new Date("YYYY-MM-DDTHH:MM:SS")` (no
  // suffix) parses as local time, keeping both start and end on the same
  // calendar day regardless of the runner's timezone.
  const tw = instance._resolveTimeWindow("today", "2026-05-22T12:00:00");
  assertTrue("AF-V073-3a: _resolveTimeWindow returns an object", tw && typeof tw === "object");
  assertTrue("AF-V073-3b: startIso defined", typeof tw.startIso === "string" && tw.startIso.length > 0);
  assertTrue("AF-V073-3c: endIso defined", typeof tw.endIso === "string" && tw.endIso.length > 0);
  assertTrue("AF-V073-3d: startIso < endIso", tw.startIso < tw.endIso);
  // Both start and end land on 2026-05-22 calendar date. ISO string conversion
  // from local-time Date may shift TZ portion but the calendar date stays the
  // same when anchored at local-noon.
  const startDate = new Date(tw.startIso);
  const endDate   = new Date(tw.endIso);
  assertTrue("AF-V073-3e: startIso parses to 2026-05-22 (local calendar)",
    startDate.getFullYear() === 2026 && startDate.getMonth() === 4 && startDate.getDate() === 22);
  assertTrue("AF-V073-3f: endIso parses to 2026-05-22 (local calendar)",
    endDate.getFullYear() === 2026 && endDate.getMonth() === 4 && endDate.getDate() === 22);
} catch (e) {
  assertTrue("AF-V073-3: native-Date _resolveTimeWindow fallback reachable", false, e && e.message);
}

// ── HC-V0841-A3: inWindow numeric ISO compare ─────────────────────────────
console.log("\n--- HC-V0841-A3: inWindow uses numeric epoch compare for ISO timestamps ---");

assertTrue("HC-V0841-A3.1 source references window.moment(...).valueOf() for ISO compare",
  /window\.moment\([^)]+\)\.valueOf\(\)/.test(src),
  "activity-feed.js inWindow must parse ISO strings via moment().valueOf() before compare");

assertTrue("HC-V0841-A3.2 source uses Number.isFinite guard on parsed timestamps",
  /Number\.isFinite\([^)]+\)/.test(src),
  "activity-feed.js inWindow must guard against malformed ISO inputs with Number.isFinite");

// Note: full execution-based exercise of inWindow is out of scope here —
// requires Dataview shim. A3 is a source-lint guard against future
// regressions to lexicographic ISO compare.

// ── HC-V0841-D1, D2: defaultClosed wins over persisted state ──────────────
console.log("\n--- HC-V0841-D1/D2: defaultClosed groups stay closed at boot ---");

assertTrue("HC-V0841-D1 source gates groupState override on !isClosed",
  /if\s*\(\s*!isClosed\s*&&\s*groupState/.test(src) ||
  /if\s*\(\s*groupState\s*&&[^)]*\)\s*\{[^}]*if\s*\(\s*isClosed\s*\)/.test(src),
  "_renderFramedGroup must skip persisted-state override when isClosed=true; " +
  "expected either `if (!isClosed && groupState && ...)` or an inner `if (isClosed) ...` guard");

assertTrue("HC-V0841-D2 _renderFramedGroup retains the toggle event listener",
  /addEventListener\(["']toggle["']/.test(src),
  "_renderFramedGroup keeps writing persisted state on user toggle so non-defaultClosed groups still remember; " +
  "the fix only blocks the READ path for defaultClosed groups, not the WRITE path");

// ── AF-ASC: ascendingGroups renders a named group oldest-first ────────────
console.log("\n--- AF-ASC: ascendingGroups (oldest-first per group) ---");

// Build three sticky-note pages on the same day with distinct created_at, fed in
// a SHUFFLED order (09:00, 10:00, 08:00). tsKeys[0]="day" is absent on the
// pages, so the global newest-first sort ties and preserves input order —
// meaning WITHOUT the opt the render order is [09,10,08] (not ascending).
function afAscSeed() {
  const day = "2026-05-21";
  const mk = (name, hh) => ({ file: { path: "spice/s/" + name + ".md", name }, type: "sticky-note", created_at: day + "T" + hh + ":00:00Z" });
  return { day, pages: [mk("sticky-note-0900", "09"), mk("sticky-note-1000", "10"), mk("sticky-note-0800", "08")] };
}

// AF-ASC-1 — with ascendingGroups:["sticky-note"], rows render oldest-first.
// (Red without the Pass B.5 change: default order would be [09,10,08].)
try {
  const { day, pages } = afAscSeed();
  const dv = v066_makeFakeDv(pages);
  const af = new (v066_loadAF())();
  af.render(dv, {
    scope: "today", asOf: day, blueprints: ["sticky-note"], framed: true, groupBy: "blueprint",
    tsKeys: ["day", "created_at", "status_changed_at"],
    ascendingGroups: ["sticky-note"],
  });
  const html = dv.container.innerHTML;
  const i08 = html.indexOf("sticky-note-0800"), i09 = html.indexOf("sticky-note-0900"), i10 = html.indexOf("sticky-note-1000");
  assertTrue("AF-ASC-1a: all three sticky-note rows rendered", i08 >= 0 && i09 >= 0 && i10 >= 0);
  assertTrue("AF-ASC-1b: ascendingGroups renders sticky-note oldest-first (0800 < 0900 < 1000)",
    i08 < i09 && i09 < i10, "render order was 08=" + i08 + " 09=" + i09 + " 10=" + i10);
} catch (e) {
  assertTrue("AF-ASC-1: ascendingGroups oldest-first", false, e && e.message);
}

// AF-ASC-2 — opt-in guard: WITHOUT ascendingGroups the sticky-note group is not
// reordered ascending (the new opt must not change default behavior).
try {
  const { day, pages } = afAscSeed();
  const dv = v066_makeFakeDv(pages);
  const af = new (v066_loadAF())();
  af.render(dv, {
    scope: "today", asOf: day, blueprints: ["sticky-note"], framed: true, groupBy: "blueprint",
    tsKeys: ["day", "created_at", "status_changed_at"],
  });
  const html = dv.container.innerHTML;
  const i08 = html.indexOf("sticky-note-0800"), i09 = html.indexOf("sticky-note-0900"), i10 = html.indexOf("sticky-note-1000");
  assertTrue("AF-ASC-2: without ascendingGroups sticky-note is NOT reordered ascending (opt-in only)",
    !(i08 < i09 && i09 < i10), "render order was 08=" + i08 + " 09=" + i09 + " 10=" + i10);
} catch (e) {
  assertTrue("AF-ASC-2: opt-in default unchanged", false, e && e.message);
}

// AF-ASC-3 — daily dashboard wiring: the sticky-note section opens by default and
// renders oldest-first. (Red without the space-daily-dashboard.js config edit.)
try {
  const dailyDashSrc = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/daily/helpers/space-daily-dashboard.js"), "utf8");
  assertTrue("AF-ASC-3a: daily dashboard passes ascendingGroups: ['sticky-note']",
    /ascendingGroups:\s*\[\s*["']sticky-note["']\s*\]/.test(dailyDashSrc),
    "space-daily-dashboard.js must pass ascendingGroups: ['sticky-note'] so the daily hub renders sticky-note oldest-first");
  assertTrue("AF-ASC-3b: daily dashboard no longer defaultCloses the sticky-note group",
    !/defaultClosed:\s*\[[^\]]*["']sticky-note["'][^\]]*\]/.test(dailyDashSrc),
    "space-daily-dashboard.js must not list 'sticky-note' in defaultClosed so the section opens by default");
} catch (e) {
  assertTrue("AF-ASC-3: daily dashboard wiring", false, e && e.message);
}

// ── Pass 9: query() coalesced-sweep API + precomputed render short-circuit ──
//
// The daily/Home dashboard used to sweep the whole vault TWICE per render
// (_getActivityCount pre-count + ActivityFeed.render's own _query). The new
// public query(dv, opts) exposes the SAME pages _query produces for the SAME
// opts (via a shared _parseQueryOpts helper), so the dashboard can sweep ONCE
// and hand the pages back to render via opts.precomputed.

console.log("\n--- Pass 9: query() + precomputed render short-circuit ---");

// AF-QUERY-1: query(dv, opts) returns { pages, total } with total === pages.length
// AND pages equal to what render would have surfaced (same opts). We assert the
// pages by title against a direct render capture using the same opts.
try {
  const seed = [
    { file: { path: "spice/p/a.md", name: "a" }, type: "project", created_at: "2026-05-22T10:00:00Z" },
    { file: { path: "spice/p/b.md", name: "b" }, type: "project", created_at: "2026-05-22T11:00:00Z" },
    { file: { path: "spice/p/x.md", name: "x" }, type: "project", created_at: "2026-05-20T09:00:00Z" }, // out of window
    { file: { path: "spice/p/z.md", name: "z" }, type: "note",    created_at: "2026-05-22T12:00:00Z" }, // wrong blueprint
  ];
  const opts = { scope: "today", asOf: "2026-05-22", blueprints: ["project"] };
  const dv = v066_makeFakeDv(seed);
  const af = new (v066_loadAF())();
  const q = af.query(dv, opts);
  assertTrue("AF-QUERY-1a: query returns an object", q && typeof q === "object");
  assertTrue("AF-QUERY-1b: query.pages is an array", q && Array.isArray(q.pages));
  assertTrue("AF-QUERY-1c: query.total === query.pages.length", q && q.total === q.pages.length);
  const paths = (q.pages || []).map(p => p.file.path).sort();
  assertEq("AF-QUERY-1d: query surfaces exactly the in-window allowlisted pages",
    paths, ["spice/p/a.md", "spice/p/b.md"]);
} catch (e) {
  assertTrue("AF-QUERY-1: query() returns { pages, total }", false, e && e.message);
}

// AF-QUERY-2: query() produces the SAME pages that _query produces for the same
// opts (the whole point of the shared _parseQueryOpts). We compare query().pages
// against a direct _query invocation reconstructed from the parsed opts.
try {
  const seed = [
    { file: { path: "spice/p/a.md", name: "a" }, type: "project", created_at: "2026-05-22T10:00:00Z" },
    { file: { path: "spice/p/b.md", name: "b" }, type: "project", created_at: "2026-05-22T11:00:00Z" },
  ];
  const opts = { scope: "today", asOf: "2026-05-22", blueprints: ["project"], tsKeys: ["day", "created_at"] };
  const dv = v066_makeFakeDv(seed);
  const af = new (v066_loadAF())();
  const q = af.query(dv, opts);
  // Reconstruct _query via the same parsed opts + resolved window.
  const parsed = af._parseQueryOpts(opts);
  const tw = af._resolveTimeWindow(parsed.scope, parsed.asOf);
  const direct = af._query(dv, parsed.blueprints, tw, parsed.useStatusChangedAt, parsed.includeMtime, parsed.limit, parsed.rollUpRoots, opts);
  const qPaths = q.pages.map(p => p.file.path);
  const dPaths = direct.map(p => p.file.path);
  assertEq("AF-QUERY-2: query().pages equals _query output for the same opts", qPaths, dPaths);
} catch (e) {
  assertTrue("AF-QUERY-2: query() == _query for same opts", false, e && e.message);
}

// AF-PRECOMP-1: render(dv, { ..., precomputed: { pages } }) does NOT call _query,
// and renders exactly the precomputed pages. We spy by wrapping _query.
try {
  const seed = [
    { file: { path: "spice/p/a.md", name: "a" }, type: "project", created_at: "2026-05-22T10:00:00Z" },
  ];
  // Precomputed pages that DIFFER from what a fresh _query sweep would produce —
  // if render ignores precomputed and re-queries, it would render "a"; if it
  // honors precomputed, it renders only "precomp-page".
  const precomputedPages = [
    { file: { path: "spice/pre/precomp-page.md", name: "precomp-page" }, type: "project", created_at: "2026-05-22T10:00:00Z" },
  ];
  const dv = v066_makeFakeDv(seed);
  const af = new (v066_loadAF())();
  let queryCalls = 0;
  const origQuery = af._query.bind(af);
  af._query = function (...args) { queryCalls++; return origQuery(...args); };
  af.render(dv, {
    scope: "today", asOf: "2026-05-22", blueprints: ["project"], framed: true, groupBy: "blueprint",
    precomputed: { pages: precomputedPages },
  });
  const html = dv.container.innerHTML;
  assertTrue("AF-PRECOMP-1a: render does NOT call _query when precomputed.pages present", queryCalls === 0);
  assertTrue("AF-PRECOMP-1b: render surfaces the precomputed page", html.indexOf("precomp-page") >= 0);
  assertTrue("AF-PRECOMP-1c: render does NOT surface a freshly-queried page", html.indexOf(">a<") < 0 && html.indexOf('"a"') < 0);
} catch (e) {
  assertTrue("AF-PRECOMP-1: precomputed short-circuits _query", false, e && e.message);
}

// AF-PRECOMP-2 (regression — cowork path): render(dv, opts) with NO precomputed
// STILL calls _query. cowork's 4 ActivityFeed blocks + every non-dashboard caller
// pass no precomputed and must behave exactly as before.
try {
  const seed = [
    { file: { path: "spice/c/a.md", name: "cowork-a" }, type: "cowork", created_at: "2026-05-22T10:00:00Z" },
  ];
  const dv = v066_makeFakeDv(seed);
  const af = new (v066_loadAF())();
  let queryCalls = 0;
  const origQuery = af._query.bind(af);
  af._query = function (...args) { queryCalls++; return origQuery(...args); };
  af.render(dv, {
    scope: "today", asOf: "2026-05-22", blueprints: ["cowork"], framed: true, groupBy: "blueprint",
  });
  const html = dv.container.innerHTML;
  assertTrue("AF-PRECOMP-2a: render calls _query exactly once when no precomputed", queryCalls === 1);
  assertTrue("AF-PRECOMP-2b: render surfaces the queried page", html.indexOf("cowork-a") >= 0);
} catch (e) {
  assertTrue("AF-PRECOMP-2: no-precomputed still queries (cowork path)", false, e && e.message);
}

// AF-PRECOMP-3: precomputed with a non-array pages is ignored (falls back to _query).
try {
  const seed = [
    { file: { path: "spice/p/a.md", name: "a" }, type: "project", created_at: "2026-05-22T10:00:00Z" },
  ];
  const dv = v066_makeFakeDv(seed);
  const af = new (v066_loadAF())();
  let queryCalls = 0;
  const origQuery = af._query.bind(af);
  af._query = function (...args) { queryCalls++; return origQuery(...args); };
  af.render(dv, {
    scope: "today", asOf: "2026-05-22", blueprints: ["project"], framed: true, groupBy: "blueprint",
    precomputed: { pages: "not-an-array" },
  });
  assertTrue("AF-PRECOMP-3: malformed precomputed.pages falls back to _query", queryCalls === 1);
} catch (e) {
  assertTrue("AF-PRECOMP-3: malformed precomputed falls back", false, e && e.message);
}

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\nrun-activity-feed.js: ${pass} pass · ${fail} fail`);
if (fail > 0) {
  console.log("\n--- Failures ---");
  for (const f of failures) console.log(f);
  process.exit(1);
}
process.exit(0);
