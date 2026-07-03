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

  // ── HOME-CAP: dispatch wiring per button ───────────────────────────────────
  installMoment("2026-07-02", 6);
  {
    const dv = makeDv();

    // Spies on the real APIs.
    const calls = { taskOpen: [], entityCreate: [], commandIds: [] };
    global.customJS = {
      TaskDialog: { open: (opts) => calls.taskOpen.push(opts) },
      EntityCreate: { create: (opts) => { calls.entityCreate.push(opts); return Promise.resolve(); } },
    };
    global.app = { commands: { executeCommandById: (id) => calls.commandIds.push(id) } };
    global.window.customJS = global.customJS;
    global.window.app = global.app;

    await home_.render(dv, {});

    const home = dv.container.querySelector(".sauce-home");
    const band = home ? home.children.find((k) => (k.cls || "").includes("sauce-home-capture")) : null;
    const buttons = band ? descendants(band).filter((n) => n.tag === "button") : [];
    assertEq("HOME-CAP-7 render wired 4 capture buttons", buttons.length, 4);

    // Invoke each button's click handler and assert the dispatch.
    const fire = (btn) => {
      if (btn && typeof btn.onclick === "function") return btn.onclick({});
      return undefined;
    };

    // Button 0 = todo → TaskDialog.open({ surface:'daily', today })
    await fire(buttons[0]);
    assertEq("HOME-CAP-8 todo → TaskDialog.open called once", calls.taskOpen.length, 1);
    assertTrue("HOME-CAP-9 todo → open opts carry surface 'daily'",
      calls.taskOpen[0] && calls.taskOpen[0].surface === "daily",
      `expected TaskDialog.open({ surface:'daily', … }); got ${JSON.stringify(calls.taskOpen[0])}`);
    assertTrue("HOME-CAP-10 todo → open opts carry today",
      calls.taskOpen[0] && calls.taskOpen[0].today === "2026-07-02",
      `expected today == '2026-07-02'; got ${JSON.stringify(calls.taskOpen[0])}`);

    // Button 1 = meeting → EntityCreate.create({ instance:'meeting', dv })
    await fire(buttons[1]);
    // Button 2 = scratch → EntityCreate.create({ instance:'scratch', dv })
    await fire(buttons[2]);
    assertEq("HOME-CAP-11 meeting+scratch → 2 EntityCreate.create calls", calls.entityCreate.length, 2);
    assertEq("HOME-CAP-12 meeting → instance 'meeting'", calls.entityCreate[0] && calls.entityCreate[0].instance, "meeting");
    assertEq("HOME-CAP-13 scratch → instance 'scratch'", calls.entityCreate[1] && calls.entityCreate[1].instance, "scratch");
    assertTrue("HOME-CAP-14 EntityCreate.create receives dv",
      calls.entityCreate[0] && calls.entityCreate[0].dv === dv,
      "EntityCreate.create must receive the live dv");

    // Button 3 = openDaily → app.commands.executeCommandById('daily-notes')
    await fire(buttons[3]);
    assertEq("HOME-CAP-15 openDaily → executeCommandById once", calls.commandIds.length, 1);
    assertEq("HOME-CAP-16 openDaily → command id 'daily-notes'", calls.commandIds[0], "daily-notes");

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
      const band = home ? home.children.find((k) => (k.cls || "").includes("sauce-home-capture")) : null;
      const buttons = band ? descendants(band).filter((n) => n.tag === "button") : [];
      for (const b of buttons) {
        if (b && typeof b.onclick === "function") await b.onclick({});
      }
    } catch (_e) {
      threw = true;
    }
    assertTrue("HOME-CAP-17 buttons no-op gracefully when APIs absent", !threw,
      "a missing customJS/app must make the capture buttons no-op, never throw");
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
