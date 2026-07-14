#!/usr/bin/env node
/**
 * run-home.js — Behavioral harness for the `home` blueprint's SpaceHome composer.
 *
 * SpaceHome is a bare CustomJS class (the loader wraps the file in `( … )` and
 * evals it as ONE expression), so we load it the same way task-entity's harness
 * does: read the source, then `new Function(src + "; return SpaceHome;")()`.
 * That exercises the REAL code — no hand-built HTML replica.
 *
 * Groups:
 *   HOME-GREET  — SpaceHome._greeting(hour) time-of-day bands (pure, injected hour)
 *   HOME-DATE   — SpaceHome._humanDate(iso, todayIso) → contains Thursday / Jul 2 / Today
 *   HOME-GLANCE — SpaceHome._glanceChips(counts) pure chip descriptor / empty sentinel
 *   HOME-RENDER — SpaceHome.render(dv, {}) mounts the dashboard via customjs-guard
 *                 with args:[{ asOf:<today>, live:true }] and emits, in DOM order,
 *                 greeting → glance → capture band (1 input + 3 buttons) → dashboard
 *                 mount, under .sauce-home
 *   HOME-CAP    — SpaceHome._captureSpec() shape (3 buttons) + per-button dispatch
 *                 wiring (meeting/sticky-note → EntityCreate.create, openDaily →
 *                 app.commands.executeCommandById("daily-notes")) + the inline
 *                 "Jot a task…" capture wired to TaskDialog.createQuick
 *
 * Usage: node platform/test/run-home.js   (exit 0 = all pass, 1 = any fail)
 */

const fs = require("fs");
const path = require("path");

const WORKSHOP = path.resolve(__dirname, "..", "..");
const SPACE_HOME_FILE = path.join(WORKSHOP, "platform", "blueprints", "home", "helpers", "space-home.js");
const SPACE_HOME_SRC = fs.readFileSync(SPACE_HOME_FILE, "utf8");

// Load the bare class (mirrors the CustomJS loader's single-expression eval).
function loadSpaceHome() {
  const fn = new Function(`${SPACE_HOME_SRC}\n; return SpaceHome;`);
  return fn();
}

// ── DOM stub (mirrors run-renderer.js) ─────────────────────────────────────
function makeEl(tag, opts) {
  const el = {
    tag,
    cls: (opts && opts.cls) || "",
    text: "",
    children: [],
    style: { cssText: "" },
    innerHTML: "",
    onclick: null,
    value: "",
    dataset: {},
    parent: null,
    _listeners: {},
    addEventListener: function (evt, cb) {
      if (evt === "click") el.onclick = cb;
      (el._listeners[evt] = el._listeners[evt] || []).push(cb);
    },
    // Fire every registered listener for `evt` (and the onclick shortcut for click).
    dispatch: function (evt, e) {
      const out = [];
      if (evt === "click" && typeof el.onclick === "function") out.push(el.onclick(e));
      for (const cb of (el._listeners[evt] || [])) out.push(cb(e));
      return out;
    },
    removeEventListener: function () {},
  };
  el.createEl = function (t, o) {
    const c = makeEl(t, o);
    c.parent = el;
    el.children.push(c);
    return c;
  };
  el.appendChild = function (child) {
    child.parent = el;
    el.children.push(child);
    return child;
  };
  el.setAttribute = function (k, v) { el[k] = v; };
  el.querySelector = function (sel) {
    if (typeof sel !== "string" || sel[0] !== ".") return null;
    const cls = sel.slice(1);
    const walk = (n) => {
      if (n.cls === cls || n.className === cls) return n;
      for (const c of n.children) {
        const found = walk(c);
        if (found) return found;
      }
      return null;
    };
    return walk(el);
  };
  el.remove = function () {
    if (el.parent) el.parent.children = el.parent.children.filter((c) => c !== el);
  };
  return el;
}

if (!global.document) {
  const _body = makeEl("body");
  global.document = {
    body: _body,
    createElement: (t) => makeEl(t),
    addEventListener: function () {},
    removeEventListener: function () {},
  };
}

// dv stub: `container` + `el(tag, content, opts)` (append to container) + a
// `view(viewPath, input)` spy that records each customjs-guard mount.
function makeDv() {
  const root = makeEl("div", { cls: "__dv_root" });
  const viewCalls = [];
  return {
    container: root,
    _viewCalls: viewCalls,
    el(tag, content, opts) {
      const e = makeEl(tag, opts);
      e.text = content || "";
      e.parent = root;
      root.children.push(e);
      return e;
    },
    async view(viewPath, input) {
      viewCalls.push({ viewPath, input });
      // Simulate the guard mounting a node into the container so DOM order is
      // observable (the real guard renders into dv.container).
      const mount = makeEl("div", { cls: "customjs-guard-mount" });
      mount.parent = root;
      root.children.push(mount);
      return mount;
    },
  };
}

// ── moment global (only live-time read SpaceHome makes) ────────────────────
// A tiny stub honouring the two calls SpaceHome makes: format("YYYY-MM-DD")
// and hour(). We freeze it to a known instant so assertions are deterministic.
function installMoment(frozenIso, frozenHour) {
  const m = function () {
    return {
      format: (fmt) => {
        if (fmt === "YYYY-MM-DD") return frozenIso;
        return frozenIso;
      },
      hour: () => frozenHour,
    };
  };
  global.moment = m;
  global.window = global.window || {};
  global.window.moment = m;
}

// ── verdict scaffolding ────────────────────────────────────────────────────
const results = [];
function assertTrue(name, cond, detail) {
  results.push([name, !!cond]);
  if (!cond && detail) console.log(`      ↳ ${detail}`);
}
function assertEq(name, actual, expected) {
  const ok = actual === expected;
  results.push([name, ok]);
  if (!ok) console.log(`      ↳ expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// Recursively collect descendants (depth-first, pre-order) of an el.
function descendants(el) {
  const out = [];
  const walk = (n) => {
    for (const c of n.children) {
      out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

(async () => {
  const SpaceHome = loadSpaceHome();
  // customJS stores an INSTANCE under window.customJS.SpaceHome and the guard
  // calls `render` on it (klass[method].call(klass, dv, …)). Mirror that: statics
  // are called on the class; render() is called on an instance.
  const home_ = new SpaceHome();

  // ── HOME-GREET ───────────────────────────────────────────────────────────
  assertEq("HOME-GREET-1 hour 6 → Good morning", SpaceHome._greeting(6), "Good morning");
  assertEq("HOME-GREET-2 hour 13 → Good afternoon", SpaceHome._greeting(13), "Good afternoon");
  assertEq("HOME-GREET-3 hour 19 → Good evening", SpaceHome._greeting(19), "Good evening");
  assertEq("HOME-GREET-4 hour 23 → Good evening", SpaceHome._greeting(23), "Good evening");
  assertEq("HOME-GREET-5 hour 2 → Good evening", SpaceHome._greeting(2), "Good evening");
  // Band edges: 5–11 morning, 12–16 afternoon, else evening.
  assertEq("HOME-GREET-6 hour 5 (edge) → Good morning", SpaceHome._greeting(5), "Good morning");
  assertEq("HOME-GREET-7 hour 11 (edge) → Good morning", SpaceHome._greeting(11), "Good morning");
  assertEq("HOME-GREET-8 hour 12 (edge) → Good afternoon", SpaceHome._greeting(12), "Good afternoon");
  assertEq("HOME-GREET-9 hour 16 (edge) → Good afternoon", SpaceHome._greeting(16), "Good afternoon");
  assertEq("HOME-GREET-10 hour 17 (edge) → Good evening", SpaceHome._greeting(17), "Good evening");

  // ── HOME-DATE ────────────────────────────────────────────────────────────
  const hd = SpaceHome._humanDate("2026-07-02", "2026-07-02");
  assertTrue("HOME-DATE-1 contains full weekday 'Thursday'", typeof hd === "string" && hd.includes("Thursday"),
    `_humanDate should return a string containing "Thursday"; got ${JSON.stringify(hd)}`);
  assertTrue("HOME-DATE-2 contains 'Jul 2'", typeof hd === "string" && hd.includes("Jul 2"),
    `_humanDate should contain the month-abbrev + day "Jul 2"; got ${JSON.stringify(hd)}`);
  assertTrue("HOME-DATE-3 contains 'Today' (same day)", typeof hd === "string" && hd.includes("Today"),
    `_humanDate(iso, iso) should include "Today"; got ${JSON.stringify(hd)}`);
  // Non-today anchor: no "Today", still a real weekday. 2026-07-01 is a Wednesday.
  const hd2 = SpaceHome._humanDate("2026-07-01", "2026-07-02");
  assertTrue("HOME-DATE-4 different day drops 'Today'", typeof hd2 === "string" && !hd2.includes("Today"),
    `_humanDate for a non-today date should NOT include "Today"; got ${JSON.stringify(hd2)}`);
  assertTrue("HOME-DATE-5 different day weekday is 'Wednesday'", typeof hd2 === "string" && hd2.includes("Wednesday"),
    `2026-07-01 is a Wednesday; got ${JSON.stringify(hd2)}`);

  // ── HOME-GLANCE: _glanceChips() pure descriptor ────────────────────────────
  // All-zero → empty sentinel with NO message (the "Clear day" text was removed).
  {
    const z = SpaceHome._glanceChips({ today: 0, overdue: 0, done: 0, meetings: 0 });
    assertTrue("HOME-GLANCE-1 all-zero → empty sentinel", z && z.empty === true,
      `all-zero counts should yield { empty:true }; got ${JSON.stringify(z)}`);
    assertTrue("HOME-GLANCE-2 empty sentinel carries NO text/chips (silent empty day)",
      z && z.text === undefined && z.chips === undefined,
      `empty sentinel should be a bare { empty:true } with no message; got ${JSON.stringify(z)}`);
    // Missing / undefined counts also → empty.
    const z2 = SpaceHome._glanceChips(undefined);
    assertTrue("HOME-GLANCE-3 undefined counts → empty sentinel", z2 && z2.empty === true,
      `undefined counts should yield the empty sentinel; got ${JSON.stringify(z2)}`);
  }
  // Single non-zero → exactly one chip, correct label.
  {
    const one = SpaceHome._glanceChips({ today: 3, overdue: 0, done: 0, meetings: 0 });
    assertTrue("HOME-GLANCE-4 single non-zero → not empty", one && one.empty === false, JSON.stringify(one));
    assertEq("HOME-GLANCE-5 single non-zero → exactly 1 chip", one && one.chips ? one.chips.length : -1, 1);
    assertEq("HOME-GLANCE-6 chip.n is the count", one.chips[0].n, 3);
    assertEq("HOME-GLANCE-7 chip.label is 'today'", one.chips[0].label, "today");
  }
  // Full → 4 chips in order today/overdue/meetings/done, overdue carries the red cls.
  {
    const full = SpaceHome._glanceChips({ today: 3, overdue: 1, meetings: 2, done: 5 });
    assertEq("HOME-GLANCE-8 full → 4 chips", full.chips.length, 4);
    assertEq("HOME-GLANCE-9 order[0] today", full.chips[0].label, "today");
    assertEq("HOME-GLANCE-10 order[1] overdue", full.chips[1].label, "overdue");
    assertEq("HOME-GLANCE-11 order[2] meetings", full.chips[2].label, "meetings");
    assertEq("HOME-GLANCE-12 order[3] done", full.chips[3].label, "done");
    assertEq("HOME-GLANCE-13 overdue chip carries the red pill class",
      full.chips[1].cls, "sauce-section-overdue-pill");
    assertTrue("HOME-GLANCE-14 non-overdue chips have no special class",
      full.chips[0].cls === "" && full.chips[2].cls === "" && full.chips[3].cls === "",
      `only overdue should carry a cls; got ${JSON.stringify(full.chips.map((c) => c.cls))}`);
  }
  // Zeros hidden mid-list; pluralization of meeting/meetings.
  {
    const hid = SpaceHome._glanceChips({ today: 0, overdue: 2, done: 0, meetings: 1 });
    assertEq("HOME-GLANCE-15 zeros hidden → only 2 chips", hid.chips.length, 2);
    assertEq("HOME-GLANCE-16 first shown chip is overdue", hid.chips[0].label, "overdue");
    assertEq("HOME-GLANCE-17 meetings===1 → singular 'meeting'", hid.chips[1].label, "meeting");
    const plural = SpaceHome._glanceChips({ meetings: 2 });
    assertEq("HOME-GLANCE-18 meetings===2 → plural 'meetings'", plural.chips[0].label, "meetings");
  }

  // ── HOME-CAP: _captureSpec() shape ─────────────────────────────────────────
  const spec = SpaceHome._captureSpec();
  {
    const keys = spec.map((s) => s.key);
    assertEq("HOME-CAP-1 capture keys meeting/sticky-note/article", JSON.stringify(keys), JSON.stringify(["meeting", "sticky-note", "article"]));
    const art = spec.find((s) => s.key === "article");
    assertTrue("HOME-CAP-1b article entry has label + icon", !!art && /Article/.test(art.label) && typeof art.icon === "string" && art.icon.length > 0);
  }
  {
    const opened = [];
    const prev = global.customJS;
    global.customJS = { ReaderArticlePaste: { open: () => opened.push(true) } };
    let threw = false;
    try { SpaceHome._dispatch("article", { container: {} }, "2026-07-13"); } catch (_e) { threw = true; }
    global.customJS = {};
    let threw2 = false;
    try { SpaceHome._dispatch("article", { container: {} }, "2026-07-13"); } catch (_e) { threw2 = true; }
    global.customJS = prev;
    assertTrue("HOME-CAP-ART dispatch(article) opens paste dialog + no-ops when absent",
       opened.length === 1 && !threw && !threw2);
  }
  const keys = Array.isArray(spec) ? spec.map((s) => s && s.key) : [];
  assertEq("HOME-CAP-2 key[0] meeting", keys[0], "meeting");
  assertEq("HOME-CAP-3 key[1] sticky-note", keys[1], "sticky-note");
  assertTrue("HOME-CAP-4 openDaily entry removed", keys.indexOf("openDaily") < 0,
    `the Open-today's-daily button must be gone; got ${JSON.stringify(keys)}`);
  assertTrue("HOME-CAP-5 no 'todo' entry remains", keys.indexOf("todo") < 0,
    `the todo button must be gone (replaced by inline capture); got ${JSON.stringify(keys)}`);
  assertTrue("HOME-CAP-6 every entry has { key, label, icon }",
    Array.isArray(spec) && spec.every((s) => s && typeof s.key === "string" && typeof s.label === "string" && typeof s.icon === "string"),
    `each capture spec entry must carry key/label/icon; got ${JSON.stringify(spec)}`);

  // ── HOME-PREV: SpaceHome._previousDailyPath — pure date math computing
  // yesterday's daily-note path from daily-notes.json's folder/format config
  // (mirrors the moment-format folder convention todo-chrome-bar.js already
  // uses for its own today/back-to-today path).
  {
    const path1 = SpaceHome._previousDailyPath("2026-07-08", {
      folder: "spice/daily", format: "YYYY/MM-MMMM/dddd-YYYY-MM-DD",
    });
    assertEq("HOME-PREV-1 computes yesterday's path from today + daily-notes config",
      path1, "spice/daily/2026/07-July/Tuesday-2026-07-07.md");

    // Month/year boundary.
    const path2 = SpaceHome._previousDailyPath("2026-01-01", {
      folder: "spice/daily", format: "YYYY/MM-MMMM/dddd-YYYY-MM-DD",
    });
    assertEq("HOME-PREV-2 crosses a year boundary correctly",
      path2, "spice/daily/2025/12-December/Wednesday-2025-12-31.md");

    // Missing/malformed config → null (caller shows a Notice, never throws).
    assertTrue("HOME-PREV-3 null config → null path", SpaceHome._previousDailyPath("2026-07-08", null) === null);
    assertTrue("HOME-PREV-4 missing folder → null path",
      SpaceHome._previousDailyPath("2026-07-08", { format: "YYYY/MM-MMMM/dddd-YYYY-MM-DD" }) === null);
  }

  // ── HOME-RENDER: render() DOM order + guard mount ──────────────────────────
  installMoment("2026-07-02", 6);
  {
    const dv = makeDv();
    // Non-zero counts so the (now-conditional) glance line renders.
    global.customJS = { SpaceDailyDashboard: { computeCounts: () => ({ today: 2, overdue: 1, done: 0, meetings: 1 }) } };
    global.window.customJS = global.customJS;
    await home_.render(dv, {});

    // (a) exactly one customjs-guard view call for SpaceDailyDashboard with asOf/live.
    const dashCalls = dv._viewCalls.filter(
      (c) => c.input && c.input.class === "SpaceDailyDashboard"
    );
    assertEq("HOME-RENDER-1 exactly one SpaceDailyDashboard mount", dashCalls.length, 1);
    const call = dashCalls[0] || {};
    assertEq("HOME-RENDER-2 mount targets customjs-guard view", call.viewPath, "ranch/views/customjs-guard");
    const args = call.input && Array.isArray(call.input.args) ? call.input.args : [];
    assertEq("HOME-RENDER-3 args is a 1-element array", args.length, 1);
    const a0 = args[0] || {};
    assertEq("HOME-RENDER-4 args[0].asOf == today", a0.asOf, "2026-07-02");
    assertEq("HOME-RENDER-5 args[0].live === true", a0.live, true);

    // (b) .sauce-home wrapper exists.
    const home = dv.container.querySelector(".sauce-home");
    assertTrue("HOME-RENDER-6 a .sauce-home wrapper is emitted", !!home,
      "render must build a .sauce-home wrapper div");

    // (c) DOM order + structure. New shape: a HEAD row (.sauce-home-head) is the
    // first child (greeting on the left + the "+" quick-add on the right), then
    // the glance line, then the dashboard mount. ALL capture lives inside the
    // head's dropdown (.sauce-home-add-menu) — there is NO always-on band.
    if (home) {
      const kids = home.children;
      const hasCls = (k, cls) => (k.cls || "").split(/\s+/).indexOf(cls) >= 0;
      const headIdx = kids.findIndex((k) => hasCls(k, "sauce-home-head"));
      const glanceIdx = kids.findIndex((k) => hasCls(k, "sauce-home-glance"));
      assertTrue("HOME-RENDER-7 head row is the first child of .sauce-home", headIdx === 0,
        `head (.sauce-home-head) should be first; children cls = ${JSON.stringify(kids.map((k) => k.cls))}`);
      assertTrue("HOME-RENDER-7b glance line follows the head row", glanceIdx > headIdx && glanceIdx >= 0,
        `glance (.sauce-home-glance) should follow the head; children cls = ${JSON.stringify(kids.map((k) => k.cls))}`);

      const head = headIdx >= 0 ? kids[headIdx] : null;
      const dsc = head ? descendants(head) : [];
      const hasD = (n, cls) => (n.cls || "").split(/\s+/).indexOf(cls) >= 0;
      assertTrue("HOME-RENDER-7c head holds the greeting", dsc.some((n) => hasD(n, "sauce-home-greeting")),
        "head should contain .sauce-home-greeting");
      const addBtns = dsc.filter((n) => n.tag === "button" && hasD(n, "sauce-home-add"));
      assertEq("HOME-RENDER-8 head holds exactly one '+' quick-add button", addBtns.length, 1);
      const menu = dsc.find((n) => hasD(n, "sauce-home-add-menu")) || null;
      assertTrue("HOME-RENDER-8b the '+' owns a .sauce-home-add-menu dropdown", !!menu,
        "there should be a .sauce-home-add-menu");

      // The menu holds all capture UI: 1 jot input + 1 Add button + 3 action items.
      const md = menu ? descendants(menu) : [];
      const inputs = md.filter((n) => n.tag === "input");
      const items = md.filter((n) => n.tag === "button" && hasD(n, "sauce-home-add-item"));
      const capAdd = md.filter((n) => n.tag === "button" && hasD(n, "sauce-home-capture-add"));
      assertEq("HOME-RENDER-10 menu holds exactly 1 jot input", inputs.length, 1);
      assertEq("HOME-RENDER-11 menu holds exactly 3 action items (meeting/sticky-note/article)", items.length, 3);
      assertEq("HOME-RENDER-12 menu holds exactly 1 Add button", capAdd.length, 1);
    }

    // Container-level order: .sauce-home first, guard mount after it.
    const top = dv.container.children;
    const homeIdx = top.findIndex((k) => (k.cls || "").includes("sauce-home"));
    const mountIdx = top.findIndex((k) => (k.cls || "").includes("customjs-guard-mount"));
    assertTrue("HOME-RENDER-9 dashboard mount is appended below the .sauce-home block",
      homeIdx >= 0 && mountIdx > homeIdx,
      `.sauce-home should precede the dashboard mount in the container; top-level cls = ${JSON.stringify(top.map((k) => k.cls))}`);
    delete global.customJS;
    global.window.customJS = undefined;
  }

  // ── HOME-GLANCE render: an empty day renders NO glance element ─────────────
  installMoment("2026-07-02", 6);
  {
    const dv = makeDv();
    global.customJS = { SpaceDailyDashboard: { computeCounts: () => ({ today: 0, overdue: 0, done: 0, meetings: 0 }) } };
    global.window.customJS = global.customJS;
    await home_.render(dv, {});
    const home = dv.container.querySelector(".sauce-home");
    const hasCls = (n, cls) => (n.cls || "").split(/\s+/).indexOf(cls) >= 0;
    const glance = home ? descendants(home).find((n) => hasCls(n, "sauce-home-glance")) : null;
    assertTrue("HOME-GLANCE-19 empty day renders NO glance element", !glance,
      "with all-zero counts the .sauce-home-glance element must not render (silent empty day)");
    delete global.customJS;
    global.window.customJS = undefined;
  }

  // ── HOME-PREV-BTN: a "‹" button renders in the header, opens yesterday's
  // daily note when it exists, and shows a Notice (never creates a file) when
  // it doesn't.
  {
    installMoment("2026-07-02", 9);
    const dv = makeDv();
    const opened = [];
    const notices = [];
    global.Notice = function (msg) { notices.push(msg); };
    global.app = {
      workspace: {
        onLayoutReady: (cb) => cb(),
        openLinkText: (p, s, nl) => opened.push({ p, s, nl }),
      },
      vault: {
        adapter: { read: async (p) => {
          if (p === ".obsidian/daily-notes.json") {
            return JSON.stringify({ folder: "spice/daily", format: "YYYY/MM-MMMM/dddd-YYYY-MM-DD" });
          }
          throw new Error("not found");
        } },
        getAbstractFileByPath: (p) => (p === "spice/daily/2026/07-July/Wednesday-2026-07-01.md" ? { path: p } : null),
      },
    };
    global.window.app = global.app;
    global.customJS = {};
    global.window.customJS = global.customJS;

    await home_.render(dv, {});
    await home_.render(dv, {}); // second render (async config load may resolve after first paint) — assert on the settled DOM

    const home = dv.container.querySelector(".sauce-home");
    const hasCls = (n, cls) => (n.cls || "").split(/\s+/).indexOf(cls) >= 0;
    const all = home ? descendants(home) : [];
    const prevBtn = all.find((n) => n.tag === "button" && hasCls(n, "sauce-home-prev-day"));
    assertTrue("HOME-PREV-BTN-1 a previous-day button renders in the header", !!prevBtn);

    if (prevBtn && typeof prevBtn.onclick === "function") await prevBtn.onclick({});
    assertEq("HOME-PREV-BTN-2 clicking it opens yesterday's existing daily note (via the correct verified weekday)",
      opened[0] && opened[0].p, "spice/daily/2026/07-July/Wednesday-2026-07-01.md");

    delete global.customJS;
    delete global.app;
    delete global.window.app;
    delete global.window.customJS;
    delete global.Notice;
  }

  // Missing-file case: same setup but getAbstractFileByPath always returns null.
  {
    installMoment("2026-07-02", 9);
    const dv = makeDv();
    const notices = [];
    global.Notice = function (msg) { notices.push(msg); };
    global.app = {
      workspace: {
        onLayoutReady: (cb) => cb(),
        openLinkText: () => { throw new Error("should not be called"); },
      },
      vault: {
        adapter: { read: async (p) => JSON.stringify({ folder: "spice/daily", format: "YYYY/MM-MMMM/dddd-YYYY-MM-DD" }) },
        getAbstractFileByPath: () => null,
      },
    };
    global.window.app = global.app;
    global.customJS = {};
    global.window.customJS = global.customJS;

    await home_.render(dv, {});
    await home_.render(dv, {});
    const home = dv.container.querySelector(".sauce-home");
    const hasCls = (n, cls) => (n.cls || "").split(/\s+/).indexOf(cls) >= 0;
    const all = home ? descendants(home) : [];
    const prevBtn = all.find((n) => n.tag === "button" && hasCls(n, "sauce-home-prev-day"));

    let threw = false;
    try { if (prevBtn && typeof prevBtn.onclick === "function") await prevBtn.onclick({}); } catch (_e) { threw = true; }
    assertTrue("HOME-PREV-BTN-3 missing yesterday note never throws", !threw);
    assertTrue("HOME-PREV-BTN-4 missing yesterday note shows a Notice, no file created",
      notices.length === 1, `expected exactly one Notice; got ${JSON.stringify(notices)}`);

    delete global.customJS;
    delete global.app;
    delete global.window.app;
    delete global.window.customJS;
    delete global.Notice;
  }

  // ── HOME-CAP: "+" toggle + per-item dispatch + inline capture ───────────────
  installMoment("2026-07-02", 6);
  {
    const dv = makeDv();

    const calls = { entityCreate: [], commandIds: [], createQuick: [], computeCounts: [] };
    global.customJS = {
      SpaceDailyDashboard: {
        computeCounts: (d, t, te) => { calls.computeCounts.push({ d, t, te }); return { today: 2, overdue: 1, done: 0, meetings: 1 }; },
      },
      TaskEntity: {},
      TaskDialog: { createQuick: (opts) => { calls.createQuick.push(opts); return Promise.resolve(); } },
      EntityCreate: { create: (opts) => { calls.entityCreate.push(opts); return Promise.resolve(); } },
    };
    global.app = { commands: { executeCommandById: (id) => calls.commandIds.push(id) } };
    global.window.customJS = global.customJS;
    global.window.app = global.app;

    await home_.render(dv, {});

    const home = dv.container.querySelector(".sauce-home");
    const hasCls = (n, cls) => (n.cls || "").split(/\s+/).indexOf(cls) >= 0;
    const all = home ? descendants(home) : [];
    const addBtn = all.find((n) => n.tag === "button" && hasCls(n, "sauce-home-add")) || null;
    const menu = all.find((n) => hasCls(n, "sauce-home-add-menu")) || null;
    const md = menu ? descendants(menu) : [];
    const items = md.filter((n) => n.tag === "button" && hasCls(n, "sauce-home-add-item"));
    const inputs = md.filter((n) => n.tag === "input");
    assertEq("HOME-CAP-7 render wired 3 action items", items.length, 3);
    assertEq("HOME-CAP-7b render wired 1 jot input", inputs.length, 1);
    assertTrue("HOME-CAP-7c render derived glance via computeCounts(dv, today, TE)",
      calls.computeCounts.length === 1 && calls.computeCounts[0].d === dv && calls.computeCounts[0].t === "2026-07-02",
      `expected one computeCounts(dv,'2026-07-02',…) call; got count=${calls.computeCounts.length}`);

    const fire = (btn, e) => (btn && typeof btn.onclick === "function") ? btn.onclick(e || {}) : undefined;

    // ── "+" toggles the dropdown open/closed (via _setClass). ──
    const isOpen = (n) => (n.cls || "").split(/\s+/).indexOf("is-open") >= 0;
    assertTrue("HOME-CAP-8a menu starts closed", menu && !isOpen(menu),
      "menu should not carry is-open before the + is clicked");
    fire(addBtn);
    assertTrue("HOME-CAP-8b clicking + opens the menu", menu && isOpen(menu) && addBtn && isOpen(addBtn),
      "clicking + should add is-open to the menu AND the + button");
    fire(addBtn);
    assertTrue("HOME-CAP-8c clicking + again closes the menu", menu && !isOpen(menu),
      "clicking + again should remove is-open");

    // ── Item dispatch: order is [meeting, sticky-note] (Open-daily removed). ──
    await fire(items[0]);
    await fire(items[1]);
    assertEq("HOME-CAP-11 meeting+sticky-note → 2 EntityCreate.create calls", calls.entityCreate.length, 2);
    assertEq("HOME-CAP-12 meeting → instance 'meeting'", calls.entityCreate[0] && calls.entityCreate[0].instance, "meeting");
    assertEq("HOME-CAP-13 sticky-note → instance 'sticky-note'", calls.entityCreate[1] && calls.entityCreate[1].instance, "sticky-note");
    assertTrue("HOME-CAP-14 EntityCreate.create receives dv", calls.entityCreate[0] && calls.entityCreate[0].dv === dv,
      "EntityCreate.create must receive the live dv");

    // ── Inline capture: Add click with typed text → createQuick. ──
    {
      inputs[0].value = "buy milk";
      const capAdd = md.find((n) => n.tag === "button" && hasCls(n, "sauce-home-capture-add"));
      await fire(capAdd);
      assertEq("HOME-CAP-18 Add click → createQuick called once", calls.createQuick.length, 1);
      assertTrue("HOME-CAP-19 Add → createQuick carries title + today + source",
        calls.createQuick[0] && calls.createQuick[0].title === "buy milk"
          && calls.createQuick[0].today === "2026-07-02" && calls.createQuick[0].source === "daily",
        `expected createQuick({title:'buy milk',today:'2026-07-02',source:'daily'}); got ${JSON.stringify(calls.createQuick[0])}`);
    }

    // ── Inline capture: Enter → createQuick (re-locate after the Add re-render). ──
    {
      calls.createQuick.length = 0;
      const home2 = dv.container.querySelector(".sauce-home");
      const menu2 = home2 ? descendants(home2).find((n) => hasCls(n, "sauce-home-add-menu")) : null;
      const input2 = menu2 ? descendants(menu2).filter((n) => n.tag === "input")[0] : null;
      input2.value = "call mom";
      let stopped = false;
      if (input2 && typeof input2.dispatch === "function") {
        await input2.dispatch("keydown", { key: "Enter", stopPropagation: () => { stopped = true; } });
      }
      assertEq("HOME-CAP-20 Enter → createQuick called once", calls.createQuick.length, 1);
      assertEq("HOME-CAP-21 Enter → createQuick carries the typed title", calls.createQuick[0] && calls.createQuick[0].title, "call mom");
      assertTrue("HOME-CAP-21b Enter → keydown handler calls stopPropagation", stopped,
        "the Enter handler must stopPropagation so a higher-level (Obsidian/document) keydown listener can't swallow or redirect the same event");
    }

    // ── Inline capture: blank / whitespace input → NO createQuick. ──
    {
      calls.createQuick.length = 0;
      const home3 = dv.container.querySelector(".sauce-home");
      const menu3 = home3 ? descendants(home3).find((n) => hasCls(n, "sauce-home-add-menu")) : null;
      const input3 = menu3 ? descendants(menu3).filter((n) => n.tag === "input")[0] : null;
      const capAdd3 = menu3 ? descendants(menu3).find((n) => n.tag === "button" && hasCls(n, "sauce-home-capture-add")) : null;
      input3.value = "   ";
      await fire(capAdd3);
      if (input3 && typeof input3.dispatch === "function") await input3.dispatch("keydown", { key: "Enter" });
      assertEq("HOME-CAP-22 blank/whitespace input → createQuick NOT called", calls.createQuick.length, 0);
    }

    delete global.customJS;
    delete global.app;
  }

  // ── HOME-CAP: graceful degrade (missing APIs must not throw) ────────────────
  installMoment("2026-07-02", 6);
  {
    const dv = makeDv();
    delete global.customJS;
    delete global.app;
    global.window.customJS = undefined;
    global.window.app = undefined;
    let threw = false;
    try {
      await home_.render(dv, {});
      const home = dv.container.querySelector(".sauce-home");
      const hasCls = (n, cls) => (n.cls || "").split(/\s+/).indexOf(cls) >= 0;
      const all = home ? descendants(home) : [];
      // Clicking the "+" (toggle) and every menu item must no-op, not throw.
      const addBtn = all.find((n) => n.tag === "button" && hasCls(n, "sauce-home-add"));
      if (addBtn && typeof addBtn.onclick === "function") addBtn.onclick({});
      const menu = all.find((n) => hasCls(n, "sauce-home-add-menu"));
      const md = menu ? descendants(menu) : [];
      for (const b of md.filter((n) => n.tag === "button")) {
        if (b && typeof b.onclick === "function") await b.onclick({});
      }
      const input = md.filter((n) => n.tag === "input")[0];
      if (input) {
        input.value = "orphan task";
        if (typeof input.dispatch === "function") await input.dispatch("keydown", { key: "Enter" });
      }
    } catch (_e) {
      threw = true;
    }
    assertTrue("HOME-CAP-17 + toggle + items + inline capture no-op gracefully when APIs absent", !threw,
      "a missing customJS/app must make the + toggle, items, and inline jot no-op, never throw");
  }

  // ── HOME-DAY: the home no longer freezes on a stale day ────────────────────
  // Root cause: Dataview only re-renders a block when its index revision changes
  // AND the view is shown; a quiet vault never re-runs the clock-only Home block
  // when you return on a new day, so the date + asOf-today dashboard freeze. Fix:
  // render() installs (once, deduped) an active-leaf-change watcher that force-
  // refreshes Dataview when the Home leaf becomes active on a new day.
  assertTrue("HOME-DAY-1a _shouldDayRefresh true for Home leaf + changed day",
    SpaceHome._shouldDayRefresh("spice/home/Home.md", "2026-07-03", "2026-07-04") === true);
  assertTrue("HOME-DAY-1b _shouldDayRefresh false same day",
    SpaceHome._shouldDayRefresh("spice/home/Home.md", "2026-07-04", "2026-07-04") === false);
  assertTrue("HOME-DAY-1c _shouldDayRefresh false for a non-Home leaf",
    SpaceHome._shouldDayRefresh("spice/x.md", "2026-07-03", "2026-07-04") === false);
  assertTrue("HOME-DAY-1d _shouldDayRefresh false / safe on null path",
    SpaceHome._shouldDayRefresh(null, "a", "b") === false);

  {
    installMoment("2026-07-02", 6);
    const listeners = [];
    const cmds = [];
    let activeFile = { path: "spice/home/Home.md" };
    const app = {
      workspace: {
        on: (ev, fn) => { listeners.push({ ev, fn }); return { ev, fn }; },
        getActiveFile: () => activeFile,
      },
      commands: { executeCommandById: (id) => cmds.push(id) },
    };
    global.app = app;
    global.window.app = app;
    global.window.__sauceHomeDayWatcher = undefined;   // clean slate for the dedup assertion
    global.customJS = { SpaceDailyDashboard: { computeCounts: () => ({ today: 0, overdue: 0, done: 0, meetings: 0 }) } };
    global.window.customJS = global.customJS;

    await home_.render(makeDv(), {});
    await home_.render(makeDv(), {});               // second render must NOT add a 2nd listener

    assertEq("HOME-DAY-2a render stamps window.__sauceHomeRenderDay", global.window.__sauceHomeRenderDay, "2026-07-02");
    const alc = listeners.filter((l) => l.ev === "active-leaf-change");
    assertEq("HOME-DAY-2b exactly one active-leaf-change watcher after 2 renders (deduped)", alc.length, 1);

    const watcher = alc[0] && alc[0].fn;
    // (a) Home active + a NEW day → force-refresh fires.
    installMoment("2026-07-03", 6);
    activeFile = { path: "spice/home/Home.md" };
    cmds.length = 0;
    if (typeof watcher === "function") watcher({});
    assertTrue("HOME-DAY-3a Home active on a new day → Dataview force-refresh",
      cmds.indexOf("dataview:dataview-force-refresh-views") >= 0,
      `expected force-refresh; got ${JSON.stringify(cmds)}`);

    // (b) same day → no refresh.
    global.window.__sauceHomeRenderDay = "2026-07-03";
    cmds.length = 0;
    if (typeof watcher === "function") watcher({});
    assertEq("HOME-DAY-3b same day → no force-refresh", cmds.length, 0);

    // (c) non-Home leaf → no refresh.
    activeFile = { path: "spice/daily/x.md" };
    global.window.__sauceHomeRenderDay = "2026-07-02";
    cmds.length = 0;
    if (typeof watcher === "function") watcher({});
    assertEq("HOME-DAY-3c non-Home active leaf → no force-refresh", cmds.length, 0);

    // (d) missing commands API → no throw.
    let threw = false;
    activeFile = { path: "spice/home/Home.md" };
    app.commands = undefined;
    try { if (typeof watcher === "function") watcher({}); } catch (_e) { threw = true; }
    assertTrue("HOME-DAY-3d missing commands API → watcher no-ops, never throws", !threw);

    delete global.app;
    global.window.app = undefined;
    global.window.__sauceHomeDayWatcher = undefined;
    delete global.customJS;
    global.window.customJS = undefined;
  }

  // ── HOME-READY: first render defers to workspace.onLayoutReady (cold-start
  // flash/reflow mitigation); later renders in the same session run immediately.
  {
    installMoment("2026-07-05", 9);
    const dv = makeDv();
    let readyCb = null;
    let layoutReady = false;
    global.app = {
      workspace: {
        onLayoutReady: (cb) => { readyCb = cb; if (layoutReady) cb(); },
        on: () => ({}),
        getActiveFile: () => null,
      },
      commands: { executeCommandById: () => {} },
    };
    global.window.app = global.app;
    delete global.window.__sauceHomeLayoutReady;

    let resolved = false;
    const p = home_.render(dv, {});
    p.then(() => { resolved = true; });
    await Promise.resolve();
    assertTrue("HOME-READY-1 render awaits onLayoutReady before painting on a cold session",
      !resolved && dv.container.querySelector(".sauce-home") === null,
      "before layout is ready, render() must not have appended .sauce-home yet");

    layoutReady = true;
    if (typeof readyCb === "function") readyCb();
    await p;
    assertTrue("HOME-READY-2 render paints once layout is ready",
      dv.container.querySelector(".sauce-home") !== null, "expected .sauce-home after onLayoutReady fires");

    // A SECOND render call in the same app session (layout already marked ready)
    // must NOT wait again — it should paint synchronously.
    const dv2 = makeDv();
    let resolved2 = false;
    const p2 = home_.render(dv2, {});
    p2.then(() => { resolved2 = true; });
    await Promise.resolve();
    assertTrue("HOME-READY-3 subsequent renders in the same session do not re-wait",
      resolved2 || dv2.container.querySelector(".sauce-home") !== null,
      "a second render() in the same session must not block on onLayoutReady again");

    delete global.customJS;
    delete global.app;
    delete global.window.app;
    delete global.window.__sauceHomeLayoutReady;
  }

  // ── HOME-HEAL: pure _healHomeChromeBody(body) string transform ─────────────
  // Load the pure helper the same way run-wiki.js loads _healWikiChromeBody:
  // slice its source out of install.js and eval it as a standalone function
  // (it must be a self-contained pure transform — no vault I/O, no closures).
  {
    const INSTALL_FILE = path.join(WORKSHOP, "platform", "install.js");
    const installSrc = fs.readFileSync(INSTALL_FILE, "utf8");
    const m = installSrc.match(/function _healHomeChromeBody\(body\) \{[\s\S]*?\n\}\n/);
    assertTrue("HOME-HEAL-0 _healHomeChromeBody is defined as a pure function in install.js", !!m,
      "expected `function _healHomeChromeBody(body) { … }` in install.js");
    const heal = m ? new Function(m[0] + "\nreturn _healHomeChromeBody;")() : () => "";

    // (a) empty / whitespace body ⇒ full canonical chrome template.
    for (const [label, input] of [["empty", ""], ["undefined", undefined], ["whitespace", "   \n\n  "]]) {
      const out = heal(input);
      assertTrue(`HOME-HEAL-1 (${label}) → chrome contains SpaceNavButtons block`,
        typeof out === "string" && /class:\s*"SpaceNavButtons"/.test(out),
        `expected the SpaceNavButtons view block; got ${JSON.stringify(out)}`);
      assertTrue(`HOME-HEAL-2 (${label}) → chrome contains SpaceHome block`,
        typeof out === "string" && /class:\s*"SpaceHome"/.test(out),
        `expected the SpaceHome view block; got ${JSON.stringify(out)}`);
      assertTrue(`HOME-HEAL-3 (${label}) → chrome contains HOME_CHROME_END marker`,
        typeof out === "string" && out.includes("HOME_CHROME_END"),
        `expected the HOME_CHROME_END marker; got ${JSON.stringify(out)}`);
    }

    // (b) idempotent: healing a healed body is a fixed point.
    const once = heal("");
    const twice = heal(once);
    assertTrue("HOME-HEAL-4 idempotent on empty-derived chrome (heal(heal('')) === heal(''))",
      once === twice, `not idempotent:\n--- once ---\n${once}\n--- twice ---\n${twice}`);

    // Idempotent on a body that already carries the chrome + user content.
    const withUser = heal("") + "\n\nMY NOTES\n- a task I typed\n";
    const healed1 = heal(withUser);
    const healed2 = heal(healed1);
    assertTrue("HOME-HEAL-5 idempotent on chrome + user content", healed1 === healed2,
      `not idempotent:\n--- once ---\n${healed1}\n--- twice ---\n${healed2}`);

    // (c) preserves user content BELOW the marker; does NOT duplicate the chrome.
    assertTrue("HOME-HEAL-6 user content ('MY NOTES') survives the heal",
      typeof healed1 === "string" && healed1.includes("MY NOTES"),
      `user content below HOME_CHROME_END must be preserved; got ${JSON.stringify(healed1)}`);
    assertTrue("HOME-HEAL-7 user content ('a task I typed') survives the heal",
      typeof healed1 === "string" && healed1.includes("a task I typed"),
      `user content below HOME_CHROME_END must be preserved; got ${JSON.stringify(healed1)}`);
    const navCount = (healed1.match(/class:\s*"SpaceNavButtons"/g) || []).length;
    const homeCount = (healed1.match(/class:\s*"SpaceHome"/g) || []).length;
    const markerCount = (healed1.match(/HOME_CHROME_END/g) || []).length;
    assertEq("HOME-HEAL-8 chrome not duplicated — exactly one SpaceNavButtons block", navCount, 1);
    assertEq("HOME-HEAL-9 chrome not duplicated — exactly one SpaceHome block", homeCount, 1);
    assertEq("HOME-HEAL-10 exactly one HOME_CHROME_END marker", markerCount, 1);

    // A body with NO chrome but pre-existing free text (no marker) ⇒ chrome is
    // rebuilt and the free text is preserved after the marker.
    const bare = heal("just some notes I wrote before the blueprint arrived\n");
    assertTrue("HOME-HEAL-11 bare body gains chrome", /class:\s*"SpaceHome"/.test(bare),
      `a chrome-less body must be re-chromed; got ${JSON.stringify(bare)}`);
    assertTrue("HOME-HEAL-12 bare body's free text preserved after marker",
      bare.includes("just some notes I wrote before the blueprint arrived"),
      `pre-existing free text must survive; got ${JSON.stringify(bare)}`);
    const bareMarkerIdx = bare.indexOf("HOME_CHROME_END");
    assertTrue("HOME-HEAL-13 bare body's free text lands BELOW the marker",
      bareMarkerIdx >= 0 && bare.indexOf("just some notes I wrote") > bareMarkerIdx,
      `free text should be appended after HOME_CHROME_END; got ${JSON.stringify(bare)}`);
  }

  // ── HOME-FMW: pure _healHomeFrontmatterEditorWidth(body) — stamps
  // editor-width: 100 into Home.md's frontmatter so the third-party
  // "editor-width-slider" community plugin (which force-overrides Obsidian's
  // --file-line-width CSS var with !important on every file-open, beating our
  // own cssclasses:[wide]) has a STABLE, deterministic value for Home instead
  // of falling back to its own slider default — eliminating the width jump on
  // every Home open. Never touches a note that already sets its own
  // editor-width (respects a user's explicit per-note override).
  {
    const INSTALL_FILE = path.join(WORKSHOP, "platform", "install.js");
    const installSrc = fs.readFileSync(INSTALL_FILE, "utf8");
    const m = installSrc.match(/function _healHomeFrontmatterEditorWidth\(body\) \{[\s\S]*?\n\}\n/);
    assertTrue("HOME-FMW-0 _healHomeFrontmatterEditorWidth is defined as a pure function in install.js", !!m,
      "expected `function _healHomeFrontmatterEditorWidth(body) { … }` in install.js");
    const healFM = m ? new Function(m[0] + "\nreturn _healHomeFrontmatterEditorWidth;")() : (b) => b;

    // (a) frontmatter without editor-width → stamps editor-width: 100.
    const noWidth = "---\ntype: home\ncssclasses:\n  - wide\n---\n\nbody content\n";
    const stamped = healFM(noWidth);
    assertTrue("HOME-FMW-1 stamps editor-width: 100 into frontmatter lacking it",
      /^editor-width:\s*100\s*$/m.test(stamped), `got: ${JSON.stringify(stamped)}`);
    assertTrue("HOME-FMW-2 preserves the rest of the frontmatter + body",
      stamped.includes("type: home") && stamped.includes("- wide") && stamped.includes("body content"),
      `got: ${JSON.stringify(stamped)}`);

    // (b) idempotent — healing an already-stamped note is a fixed point.
    const stampedTwice = healFM(stamped);
    assertTrue("HOME-FMW-3 idempotent (heal(heal(x)) === heal(x))", stampedTwice === stamped,
      `not idempotent:\n--- once ---\n${stamped}\n--- twice ---\n${stampedTwice}`);

    // (c) a note with its OWN editor-width is left completely untouched.
    const userSet = "---\ntype: home\ncssclasses:\n  - wide\neditor-width: 60\n---\n\nbody\n";
    assertTrue("HOME-FMW-4 never overwrites a user-set editor-width", healFM(userSet) === userSet,
      `got: ${JSON.stringify(healFM(userSet))}`);

    // (d) no frontmatter block at all → returns unchanged, never throws.
    const noFm = "just a bare note, no frontmatter\n";
    let threw = false;
    let noFmResult = noFm;
    try { noFmResult = healFM(noFm); } catch (_e) { threw = true; }
    assertTrue("HOME-FMW-5 no frontmatter block → never throws, returns unchanged", !threw && noFmResult === noFm,
      `got: ${JSON.stringify(noFmResult)}`);

    // (e) empty/undefined input → never throws.
    for (const input of ["", undefined, null]) {
      let threw2 = false;
      try { healFM(input); } catch (_e) { threw2 = true; }
      assertTrue(`HOME-FMW-6 (${JSON.stringify(input)}) never throws`, !threw2);
    }

    // (f) wiring: applyHomeScaffoldHeal actually composes the frontmatter
    // heal with the chrome heal for EXISTING notes, and the fresh-scaffold
    // string for brand-NEW notes already carries editor-width: 100.
    assertTrue("HOME-FMW-7 applyHomeScaffoldHeal composes _healHomeFrontmatterEditorWidth with the chrome heal",
      /_healHomeFrontmatterEditorWidth\(_healHomeChromeBody\(before\)\)/.test(installSrc),
      "expected applyHomeScaffoldHeal to run the frontmatter heal on top of the chrome heal for existing notes");
    assertTrue("HOME-FMW-8 the fresh-scaffold frontmatter string includes editor-width: 100",
      /type: home\\ncssclasses:\\n {2}- wide\\neditor-width: 100\\n---/.test(installSrc),
      "expected the brand-new-Home.md scaffold string to seed editor-width: 100 alongside cssclasses:[wide]");
  }

  // ── HOME-NOOP: a re-render with an IDENTICAL glance-count signature skips
  // the teardown/rebuild entirely (no-op) — preserving any in-progress state
  // (an open menu, a partially-typed draft) a rebuild would otherwise wipe.
  // A re-render with a DIFFERENT signature still rebuilds normally.
  {
    installMoment("2026-07-02", 9);
    const dv = makeDv();
    let countsReturn = { today: 1, overdue: 0, done: 0, meetings: 0 };
    global.customJS = { SpaceDailyDashboard: { computeCounts: () => countsReturn } };
    delete global.app;
    delete global.window.app;

    await home_.render(dv, {});
    const first = dv.container.querySelector(".sauce-home");
    assertTrue("HOME-NOOP-1 first render paints .sauce-home", !!first);

    // Simulate an in-progress draft: open the menu + type, WITHOUT submitting.
    const hasCls = (n, cls) => (n.cls || "").split(/\s+/).indexOf(cls) >= 0;
    const descendantsOf = (n) => descendants(n);
    const addBtn = descendantsOf(first).find((n) => n.tag === "button" && hasCls(n, "sauce-home-add"));
    if (addBtn && typeof addBtn.onclick === "function") addBtn.onclick({});
    const menu = descendantsOf(first).find((n) => hasCls(n, "sauce-home-add-menu"));
    const input = menu ? descendantsOf(menu).filter((n) => n.tag === "input")[0] : null;
    if (input) input.value = "unsent draft";

    // Same counts → render() again should be a complete no-op.
    await home_.render(dv, {});
    const second = dv.container.querySelector(".sauce-home");
    assertTrue("HOME-NOOP-2 identical-signature re-render reuses the SAME node (no rebuild)",
      second === first, "expected the exact same .sauce-home DOM node after a no-op render");
    assertTrue("HOME-NOOP-3 in-progress draft survives the no-op re-render",
      input && input.value === "unsent draft", `expected draft preserved; got ${input && input.value}`);
    const isOpenNoop = (n) => (n && (n.cls || "").split(/\s+/).indexOf("is-open") >= 0);
    assertTrue("HOME-NOOP-4 the menu stays open across the no-op re-render",
      isOpenNoop(menu), "the open menu state must survive a skipped render");

    // Different counts → render() must rebuild for real.
    countsReturn = { today: 2, overdue: 1, done: 0, meetings: 0 };
    await home_.render(dv, {});
    const third = dv.container.querySelector(".sauce-home");
    assertTrue("HOME-NOOP-5 a changed signature still triggers a real rebuild",
      third !== first, "expected a NEW .sauce-home node once the glance counts actually changed");

    delete global.customJS;
    delete global.window.customJS;
    if (typeof global.window !== "undefined") delete global.window.__sauceHomeLastSig;
  }

  // ── HOME-FOCUS: clicking "+" focuses the "Jot a task…" input so the user
  // can start typing immediately (an explicit click gesture, not page-load
  // autofocus).
  {
    installMoment("2026-07-02", 9);
    const dv = makeDv();
    global.customJS = { SpaceDailyDashboard: { computeCounts: () => ({ today: 0, overdue: 0, done: 0, meetings: 0 }) } };
    delete global.app;
    delete global.window.app;

    await home_.render(dv, {});
    const home = dv.container.querySelector(".sauce-home");
    const hasCls = (n, cls) => (n.cls || "").split(/\s+/).indexOf(cls) >= 0;
    const all = descendants(home);
    const addBtn = all.find((n) => n.tag === "button" && hasCls(n, "sauce-home-add"));
    const menu = all.find((n) => hasCls(n, "sauce-home-add-menu"));
    const input = menu ? descendants(menu).filter((n) => n.tag === "input")[0] : null;
    let focused = false;
    if (input) input.focus = () => { focused = true; };

    if (addBtn && typeof addBtn.onclick === "function") addBtn.onclick({});
    assertTrue("HOME-FOCUS-1 opening the menu focuses the jot-a-task input", focused);

    // Closing the menu again must NOT re-focus (only the OPEN transition does).
    focused = false;
    if (addBtn && typeof addBtn.onclick === "function") addBtn.onclick({});
    assertTrue("HOME-FOCUS-2 closing the menu does not (re-)focus the input", !focused);

    delete global.customJS;
    delete global.window.customJS;
    if (typeof global.window !== "undefined") delete global.window.__sauceHomeLastSig;
  }

  // ── HOME-CMD: HomeCommandsInit registers sauce-home:open, mirroring
  // ProjectCommandsInit's pattern (idempotent, cold-load-safe, delegates to the
  // same navigation the "Open today's daily" / Go-to launcher path uses).
  {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'blueprints', 'home', 'helpers', 'home-commands-init.js'), 'utf8'
    );
    const HomeCommandsInit = new Function(src + "; return HomeCommandsInit;")();

    // Cold-load guard: no app.commands → never throws, never registers.
    {
      let threw = false;
      try { new HomeCommandsInit().invoke(); } catch (_e) { threw = true; }
      assertTrue("HOME-CMD-1 invoke() never throws when app/commands is absent", !threw);
    }

    // Registers exactly one command, id sauce-home:open, and its callback opens Home.
    {
      const registered = [];
      global.app = { commands: { addCommand: (c) => registered.push(c) } };
      global.window.app = global.app;
      const inst = new HomeCommandsInit();
      inst.invoke();
      assertEq("HOME-CMD-2 registers exactly one command", registered.length, 1);
      assertEq("HOME-CMD-3 command id is sauce-home:open", registered[0].id, "sauce-home:open");
      assertTrue("HOME-CMD-4 command has a name", typeof registered[0].name === "string" && registered[0].name.length > 0);

      const opened = [];
      global.app.workspace = { openLinkText: (p, s, nl) => opened.push({ p, s, nl }) };
      registered[0].callback();
      assertEq("HOME-CMD-5 callback opens spice/home/Home.md", opened[0] && opened[0].p, "spice/home/Home.md");

      // Second invoke() is a no-op (idempotent).
      inst.invoke();
      assertEq("HOME-CMD-6 a second invoke() does not re-register", registered.length, 1);

      delete global.app;
      delete global.window.app;
    }
  }

  // ── HOME-HOTKEY: _planHomeHotkeyRemap — pure decision logic backing
  // applyHomeHotkeyRemapHeal. Given the parsed hotkeys.json object, decide
  // whether/how to move the Mod+[ binding from daily-notes to sauce-home:open.
  {
    const installSrc = fs.readFileSync(path.join(__dirname, '..', 'install.js'), 'utf8');
    const fnMatch = installSrc.match(/function _planHomeHotkeyRemap\([\s\S]*?\n}\n/);
    assertTrue("HOME-HOTKEY-0 _planHomeHotkeyRemap is defined in install.js", !!fnMatch,
      "expected a pure _planHomeHotkeyRemap(existing) function in platform/install.js");
    const _planHomeHotkeyRemap = new Function(fnMatch[0] + "; return _planHomeHotkeyRemap;")();

    // Case A: daily-notes bound to exactly Mod+[, sauce-home:open unbound → act.
    {
      const existing = { "daily-notes": [{ modifiers: ["Mod"], key: "[" }] };
      const plan = _planHomeHotkeyRemap(existing);
      assertTrue("HOME-HOTKEY-1 acts when daily-notes owns Mod+[ and sauce-home:open is unbound", plan.act === true);
      assertTrue("HOME-HOTKEY-2 result clears daily-notes' Mod+[ entry",
        !plan.next["daily-notes"] || plan.next["daily-notes"].length === 0,
        `got ${JSON.stringify(plan.next["daily-notes"])}`);
      assertTrue("HOME-HOTKEY-3 result binds sauce-home:open to Mod+[",
        Array.isArray(plan.next["sauce-home:open"]) && plan.next["sauce-home:open"].length === 1
          && plan.next["sauce-home:open"][0].key === "[" && deepEq(plan.next["sauce-home:open"][0].modifiers, ["Mod"]),
        `got ${JSON.stringify(plan.next["sauce-home:open"])}`);
    }

    // Case B: daily-notes has OTHER bindings too (user customized) — only the
    // Mod+[ entry is removed, any other binding for daily-notes survives.
    {
      const existing = { "daily-notes": [{ modifiers: ["Mod"], key: "[" }, { modifiers: ["Mod", "Shift"], key: "d" }] };
      const plan = _planHomeHotkeyRemap(existing);
      assertTrue("HOME-HOTKEY-4 preserves a daily-notes binding that isn't Mod+[",
        Array.isArray(plan.next["daily-notes"]) && plan.next["daily-notes"].length === 1
          && plan.next["daily-notes"][0].key === "d");
    }

    // Case C: already remapped (sauce-home:open already bound) → no-op.
    {
      const existing = { "sauce-home:open": [{ modifiers: ["Mod"], key: "[" }] };
      const plan = _planHomeHotkeyRemap(existing);
      assertTrue("HOME-HOTKEY-5 no-ops when sauce-home:open is already bound", plan.act === false);
    }

    // Case D: daily-notes never had Mod+[ (e.g. user rebound it elsewhere) → no-op.
    {
      const existing = { "daily-notes": [{ modifiers: ["Mod", "Shift"], key: "d" }] };
      const plan = _planHomeHotkeyRemap(existing);
      assertTrue("HOME-HOTKEY-6 no-ops when daily-notes doesn't own Mod+[", plan.act === false);
    }

    // Case E: fresh/empty hotkeys.json → no-op (nothing to remap; the manifest
    // hotkeys[] seed path handles brand-new installs instead).
    {
      const plan = _planHomeHotkeyRemap({});
      assertTrue("HOME-HOTKEY-7 no-ops on an empty hotkeys object", plan.act === false);
    }
  }

  // ── HOME-CSS: .sauce-home-greeting is a flex row with centered alignment,
  // so the "‹ Yesterday" button lines up with the date text instead of
  // sitting on the text baseline (the reported "vertically higher" bug).
  {
    const cssSrc = fs.readFileSync(
      path.join(__dirname, "..", "blueprints", "home", "helpers", "sauce-home.css"), "utf8"
    );
    const ruleMatch = cssSrc.match(/\.sauce-home\s+\.sauce-home-greeting\s*\{([^}]*)\}/);
    assertTrue("HOME-CSS-1 .sauce-home-greeting rule exists", !!ruleMatch);
    const rule = ruleMatch ? ruleMatch[1] : "";
    assertTrue("HOME-CSS-2 .sauce-home-greeting is a flex container", /display:\s*flex/.test(rule));
    assertTrue("HOME-CSS-3 .sauce-home-greeting centers its children", /align-items:\s*center/.test(rule));
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n=== Summary ===");
  for (const [name, ok] of results) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  const pass = results.filter(([, ok]) => ok).length;
  const fail = results.length - pass;
  console.log(`\n${pass} passed, ${fail} failed, ${results.length} total`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("run-home.js threw:", e);
  process.exit(1);
});
