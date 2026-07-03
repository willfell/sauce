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
 *   HOME-RENDER — SpaceHome.render(dv, {}) mounts the dashboard via customjs-guard
 *                 with args:[{ asOf:<today>, live:true }] and emits, in DOM order,
 *                 greeting → capture band (4 buttons) → dashboard mount, under .sauce-home
 *   HOME-CAP    — SpaceHome._captureSpec() shape + per-button dispatch wiring
 *                 (todo → TaskDialog.open, meeting/scratch → EntityCreate.create,
 *                  openDaily → app.commands.executeCommandById("daily-notes"))
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
    dataset: {},
    parent: null,
    addEventListener: function (evt, cb) {
      if (evt === "click") el.onclick = cb;
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

  // ── HOME-CAP: _captureSpec() shape ─────────────────────────────────────────
  const spec = SpaceHome._captureSpec();
  assertTrue("HOME-CAP-1 _captureSpec returns an array of 4", Array.isArray(spec) && spec.length === 4,
    `_captureSpec should return exactly 4 entries; got ${JSON.stringify(spec)}`);
  const keys = Array.isArray(spec) ? spec.map((s) => s && s.key) : [];
  assertEq("HOME-CAP-2 key[0] todo", keys[0], "todo");
  assertEq("HOME-CAP-3 key[1] meeting", keys[1], "meeting");
  assertEq("HOME-CAP-4 key[2] scratch", keys[2], "scratch");
  assertEq("HOME-CAP-5 key[3] openDaily", keys[3], "openDaily");
  assertTrue("HOME-CAP-6 every entry has { key, label, icon }",
    Array.isArray(spec) && spec.every((s) => s && typeof s.key === "string" && typeof s.label === "string" && typeof s.icon === "string"),
    `each capture spec entry must carry key/label/icon; got ${JSON.stringify(spec)}`);

  // ── HOME-RENDER: render() DOM order + guard mount ──────────────────────────
  installMoment("2026-07-02", 6);
  {
    const dv = makeDv();
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

    // (c) DOM order. Greeting → capture band live INSIDE .sauce-home (greeting
    // first). The dashboard mount is appended by the guard into dv.container (the
    // note's own container — the same one .sauce-home lives in), so in the real
    // DOM it is a SIBLING of .sauce-home appended AFTER it (render() calls the
    // guard last). We assert both: intra-.sauce-home order + container-level
    // "dashboard comes after .sauce-home".
    if (home) {
      const kids = home.children;
      const greetingIdx = kids.findIndex((k) => (k.cls || "").includes("sauce-home-greeting"));
      const bandIdx = kids.findIndex((k) => (k.cls || "").includes("sauce-home-capture"));
      assertTrue("HOME-RENDER-7 greeting is the first child of .sauce-home", greetingIdx === 0,
        `greeting (.sauce-home-greeting) should be first; children cls = ${JSON.stringify(kids.map((k) => k.cls))}`);
      assertTrue("HOME-RENDER-8 capture band follows greeting", bandIdx > greetingIdx && bandIdx >= 0,
        `capture band (.sauce-home-capture) should follow the greeting; children cls = ${JSON.stringify(kids.map((k) => k.cls))}`);

      // (d) capture band contains exactly 4 buttons.
      const band = bandIdx >= 0 ? kids[bandIdx] : null;
      const buttons = band ? descendants(band).filter((n) => n.tag === "button") : [];
      assertEq("HOME-RENDER-10 capture band holds 4 buttons", buttons.length, 4);
    }

    // Container-level order: .sauce-home first, guard mount after it.
    const top = dv.container.children;
    const homeIdx = top.findIndex((k) => (k.cls || "").includes("sauce-home"));
    const mountIdx = top.findIndex((k) => (k.cls || "").includes("customjs-guard-mount"));
    assertTrue("HOME-RENDER-9 dashboard mount is appended below the .sauce-home block",
      homeIdx >= 0 && mountIdx > homeIdx,
      `.sauce-home should precede the dashboard mount in the container; top-level cls = ${JSON.stringify(top.map((k) => k.cls))}`);
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
