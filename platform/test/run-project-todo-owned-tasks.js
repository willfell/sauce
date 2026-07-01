#!/usr/bin/env node
// run-project-todo-owned-tasks.js — behavioral harness for the "editable Owned
// Tasks on project-todo notes" feature (board card "Editing To Do Items in a
// Project").
//
// Proves the project-todo "Owned Tasks" section becomes a click-to-edit list
// (the SAME TodayCaptureEditableList used by daily to-do notes), end to end
// across the two code surfaces that make it work:
//
//   task-interactions mechanism (Node-testable statics):
//     PT-OWNED-ANCHOR         ownedTasksAnchor() sentinel is the marker.
//     PT-INJECT-*             injectOwnedTasksMarker: places the marker below the
//                             Owned Tasks SectionLabel, matches BOTH label forms
//                             ({ text: "Owned Tasks" } and { ..., top: true }),
//                             idempotent, no-op when the section is absent.
//     PT-FIND-*               findTaskLines(_, "ownedTasks") is scoped to the
//                             marker..next-section window (fence-aware).
//     PT-APPEND-*             appendTask on a project-todo note lands the task
//                             INSIDE the ownedTasks scope (below the marker), and
//                             injects the marker first if a legacy note lacks it.
//
//   install.js heal (pure body transform, exported):
//     PT-HEAL-*               _healProjectTodoOwnedTasksBody injects marker +
//                             TodayCaptureEditableList({anchor:"ownedTasks"})
//                             renderer, positions the renderer BELOW the raw task
//                             lines (so _hideRawCaptureLines can suppress the
//                             native list), is idempotent, matches both label
//                             forms, and no-ops when the section is absent.
//     PT-INTEGRATION          the healed body is actually consumable: running the
//                             mechanism's findTaskLines(_, "ownedTasks") over the
//                             heal output returns exactly the section's raw tasks.
//
// Verdict footer: "PASS N/N" or "FAIL X/N"; exit 0 / 1.

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WORKSHOP = path.resolve(__dirname, "../..");
const TI_SRC = path.join(WORKSHOP, "platform/mechanisms/task-interactions/task-interactions.js");
const install = require(path.join(WORKSHOP, "platform/install.js"));
const { _healProjectTodoOwnedTasksBody } = install;

// ---------------------------------------------------------------------------
// Bookkeeping
// ---------------------------------------------------------------------------
let pass = 0, fail = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; const m = `${label}${detail ? " — " + detail : ""}`; failures.push(m); console.log(`  FAIL  ${m}`); }
}
function eq(label, actual, expected) {
  ok(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---------------------------------------------------------------------------
// In-memory vault world + task-interactions sandbox loader (mirrors
// run-task-interactions.js so appendTask writes are inspectable).
// ---------------------------------------------------------------------------
function makeWorld() {
  const files = new Map();
  const adapter = { set: (p, b) => files.set(p, b), get: (p) => files.get(p), files };
  const app = {
    vault: {
      getAbstractFileByPath(p) { return files.has(p) ? { path: p } : null; },
      async read(file) { if (!files.has(file.path)) throw new Error("ENOENT " + file.path); return files.get(file.path); },
      async process(file, transform) { files.set(file.path, transform(files.has(file.path) ? files.get(file.path) : "")); },
    },
  };
  return { app, adapter };
}
function loadTI(app) {
  const src = fs.readFileSync(TI_SRC, "utf8") + "\nmodule.exports = TaskInteractions;\n";
  const ctx = { console, window: { customJS: {} }, app, module: { exports: {} } };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "task-interactions.js" });
  return ctx.module.exports;
}

const MARKER = "<!-- OWNED_TASKS_MARKER -->";
const RENDERER_NEEDLE = 'anchor: "ownedTasks"';

// Realistic project-todo bodies. Built with arrays to avoid backtick fences
// colliding with the template-literal in this test file.
function ownedLabel(top) {
  return top
    ? 'await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Owned Tasks", top: true }] });'
    : 'await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Owned Tasks" }] });';
}
function projectTodoBody({ top = false, ownedTasks = ["- [ ] existing owned [project:: [[Sauce]]]"], trailingStray = false } = {}) {
  const lines = [
    "---",
    "type: project-todo",
    'project: "[[Sauce]]"',
    "---",
    "",
    "```dataviewjs",
    ownedLabel(top),
    "```",
    ...ownedTasks,
    "",
    "```dataviewjs",
    'await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "From Meetings" }] });',
    "```",
    "",
    "```dataviewjs",
    'await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyProjectGroups", args: [{ scope: "project-todo" }] });',
    "```",
  ];
  // A stray raw task AFTER the From Meetings section — must NEVER be captured by
  // the ownedTasks anchor scope.
  if (trailingStray) lines.push("", "- [ ] stray after meetings");
  return lines.join("\n");
}

(async () => {
  const TI = loadTI(undefined);

  // ------------------- task-interactions statics -------------------
  eq("PT-OWNED-ANCHOR", TI.ownedTasksAnchor(), MARKER);

  // inject: marker lands below the Owned Tasks SectionLabel closing fence.
  {
    const body = projectTodoBody();
    const out = TI.injectOwnedTasksMarker(body);
    ok("PT-INJECT-present", out.includes(MARKER));
    eq("PT-INJECT-exactly-one", (out.match(/<!-- OWNED_TASKS_MARKER -->/g) || []).length, 1);
    const L = out.split("\n");
    const labelIdx = L.findIndex(l => l.includes('text: "Owned Tasks"'));
    const fenceIdx = L.findIndex((l, i) => i > labelIdx && l.trim().startsWith("```"));
    const markerIdx = L.findIndex(l => l.includes(MARKER));
    ok("PT-INJECT-below-fence", labelIdx >= 0 && fenceIdx > labelIdx && markerIdx > fenceIdx);
  }
  // inject matches the top:true (scaffold) label form too.
  ok("PT-INJECT-top-form", TI.injectOwnedTasksMarker(projectTodoBody({ top: true })).includes(MARKER));
  // inject idempotent.
  {
    const once = TI.injectOwnedTasksMarker(projectTodoBody());
    eq("PT-INJECT-idempotent", TI.injectOwnedTasksMarker(once), once);
  }
  // inject no-op when there is no Owned Tasks SectionLabel.
  {
    const noSection = ["---", "type: project-todo", "---", "", "just prose"].join("\n");
    eq("PT-INJECT-absent-noop", TI.injectOwnedTasksMarker(noSection), noSection);
  }

  // findTaskLines scope: only the Owned Tasks section's raw tasks, fence-aware,
  // excluding a stray task after From Meetings.
  {
    const withMarker = TI.injectOwnedTasksMarker(projectTodoBody({
      ownedTasks: ["- [ ] alpha", "- [x] beta"], trailingStray: true,
    }));
    const found = TI.findTaskLines(withMarker, "ownedTasks");
    eq("PT-FIND-count", found.length, 2);
    ok("PT-FIND-content", found.map(f => f.line).join("|").includes("alpha")
      && found.map(f => f.line).join("|").includes("beta"));
    ok("PT-FIND-excludes-stray", !found.some(f => f.line.includes("stray after meetings")));
  }
  // findTaskLines returns [] when the marker is absent.
  eq("PT-FIND-nomarker-empty", TI.findTaskLines(projectTodoBody(), "ownedTasks").length, 0);

  // appendTask lands the task INSIDE the ownedTasks scope (below the marker).
  {
    const { app, adapter } = makeWorld();
    const TIw = loadTI(app);
    const p = "spice/projects/sauce/Sauce To-Do.md";
    adapter.set(p, TIw.injectOwnedTasksMarker(projectTodoBody({ ownedTasks: [] })));
    const res = await TIw.appendTask(p, { title: "brand new", serializedLine: "- [ ] brand new" }, { serializedLine: "- [ ] brand new" });
    ok("PT-APPEND-ok", res && res.ok === true, JSON.stringify(res));
    const after = adapter.get(p);
    eq("PT-APPEND-one-marker", (after.match(/<!-- OWNED_TASKS_MARKER -->/g) || []).length, 1);
    const found = TIw.findTaskLines(after, "ownedTasks");
    ok("PT-APPEND-in-scope", found.some(f => f.line.includes("brand new")));
  }
  // appendTask injects the marker first when a legacy note lacks it.
  {
    const { app, adapter } = makeWorld();
    const TIw = loadTI(app);
    const p = "spice/projects/sauce/Legacy To-Do.md";
    adapter.set(p, projectTodoBody({ ownedTasks: [] })); // no marker
    const res = await TIw.appendTask(p, { title: "x", serializedLine: "- [ ] legacy add" }, { serializedLine: "- [ ] legacy add" });
    ok("PT-APPEND-legacy-ok", res && res.ok === true, JSON.stringify(res));
    const after = adapter.get(p);
    ok("PT-APPEND-legacy-marker-injected", after.includes(MARKER));
    ok("PT-APPEND-legacy-in-scope", TIw.findTaskLines(after, "ownedTasks").some(f => f.line.includes("legacy add")));
  }

  // ------------------- install.js heal -------------------
  ok("PT-HEAL-export-present", typeof _healProjectTodoOwnedTasksBody === "function");

  // heal injects marker + renderer; renderer sits BELOW the raw task line and the
  // marker ABOVE it (so the native list precedes the renderer for hiding).
  {
    const before = projectTodoBody({ ownedTasks: ["- [ ] owned one"] });
    const out = _healProjectTodoOwnedTasksBody(before);
    ok("PT-HEAL-marker", out.includes(MARKER));
    ok("PT-HEAL-renderer", out.includes(RENDERER_NEEDLE));
    const L = out.split("\n");
    const markerIdx = L.findIndex(l => l.includes(MARKER));
    const rawIdx = L.findIndex(l => l.includes("owned one"));
    const rendIdx = L.findIndex(l => l.includes(RENDERER_NEEDLE));
    ok("PT-HEAL-order-marker-raw-renderer", markerIdx >= 0 && rawIdx > markerIdx && rendIdx > rawIdx);
    eq("PT-HEAL-one-marker", (out.match(/<!-- OWNED_TASKS_MARKER -->/g) || []).length, 1);
    eq("PT-HEAL-one-renderer", (out.match(/anchor: "ownedTasks"/g) || []).length, 1);
  }
  // heal idempotent.
  {
    const once = _healProjectTodoOwnedTasksBody(projectTodoBody({ ownedTasks: ["- [ ] a"] }));
    eq("PT-HEAL-idempotent", _healProjectTodoOwnedTasksBody(once), once);
  }
  // heal matches the top:true scaffold label form.
  ok("PT-HEAL-top-form", _healProjectTodoOwnedTasksBody(projectTodoBody({ top: true })).includes(MARKER));
  // heal on an empty Owned Tasks section: marker + renderer still inserted.
  {
    const out = _healProjectTodoOwnedTasksBody(projectTodoBody({ ownedTasks: [] }));
    ok("PT-HEAL-empty-section", out.includes(MARKER) && out.includes(RENDERER_NEEDLE));
  }
  // heal no-op when there is no Owned Tasks section.
  {
    const noSection = ["---", "type: project-todo", "---", "", "prose only"].join("\n");
    eq("PT-HEAL-absent-noop", _healProjectTodoOwnedTasksBody(noSection), noSection);
  }
  // heal ALSO anchors on a plain `## Owned Tasks` H2 heading (the entity-create
  // inline_body form the version-gated H2->SectionLabel rewrite no longer
  // converts) — marker + renderer injected, ordered marker<raw<renderer, and the
  // healed output is consumable by findTaskLines.
  {
    const h2Body = [
      "---", "type: project-todo", 'project: "[[Sauce]]"', "---", "",
      "## Owned Tasks",
      "- [ ] h2 owned",
      "",
      "## From Meetings",
      "",
    ].join("\n");
    const out = _healProjectTodoOwnedTasksBody(h2Body);
    ok("PT-HEAL-h2-marker+renderer", out.includes(MARKER) && out.includes(RENDERER_NEEDLE));
    const L = out.split("\n");
    const mI = L.findIndex(l => l.includes(MARKER));
    const rI = L.findIndex(l => l.includes("h2 owned"));
    const dI = L.findIndex(l => l.includes(RENDERER_NEEDLE));
    ok("PT-HEAL-h2-order-marker-raw-renderer", mI >= 0 && rI > mI && dI > rI);
    eq("PT-HEAL-h2-idempotent", _healProjectTodoOwnedTasksBody(out), out);
    const found = TI.findTaskLines(out, "ownedTasks");
    eq("PT-HEAL-h2-integration-count", found.length, 1);
    ok("PT-HEAL-h2-integration-content", found.some(f => f.line.includes("h2 owned")));
  }

  // ------------------- integration: heal output is consumable -------------------
  // The healed body, fed to the mechanism the widget actually calls, yields
  // exactly the section's raw tasks (proves the marker/scope line up).
  {
    const healed = _healProjectTodoOwnedTasksBody(projectTodoBody({
      ownedTasks: ["- [ ] one", "- [x] two"], trailingStray: true,
    }));
    const found = TI.findTaskLines(healed, "ownedTasks");
    eq("PT-INTEGRATION-count", found.length, 2);
    ok("PT-INTEGRATION-excludes-stray", !found.some(f => f.line.includes("stray after meetings")));
    ok("PT-INTEGRATION-excludes-renderer", !found.some(f => f.line.includes("TodayCaptureEditableList")));
  }

  // ------------------- verdict -------------------
  const total = pass + fail;
  console.log("");
  if (fail === 0) { console.log(`PASS ${pass}/${total}`); process.exit(0); }
  console.log(`FAIL ${fail}/${total}`);
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
})().catch((e) => { console.error("harness threw:", e && e.stack || e); process.exit(1); });
