#!/usr/bin/env node
// run-task-interactions.js — v0.127.0 S3 behavioral harness for the NEW
// `task-interactions@0.1.0` mechanism.
//
// Zero-dep. Loads platform/mechanisms/task-interactions/task-interactions.js
// into a sandboxed VM scope, extracts the TaskInteractions class, exercises
// every public method against minimal globals stubs:
//
//   - window.customJS.ToDoCreateTask.serializePayloadToLine
//     (delegate path; also tested with the global temporarily deleted so the
//     inline fallback executes)
//   - app.vault.getAbstractFileByPath / read / modify / process
//     (in-memory adapter; assertions inspect the final string written)
//
// All cases prefixed HC-V0127-TI-*. Verdict footer: "PASS N/N" or "FAIL X/N",
// exit 0 / 1 respectively.

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WORKSHOP = path.resolve(__dirname, "../..");
const TI_SRC = path.join(
  WORKSHOP,
  "platform/mechanisms/task-interactions/task-interactions.js"
);

// ---------------------------------------------------------------------------
// Test bookkeeping
// ---------------------------------------------------------------------------

let pass = 0;
let fail = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ok  ${label}`);
  } else {
    fail++;
    const msg = `${label}${detail ? " — " + detail : ""}`;
    failures.push(msg);
    console.log(`  FAIL  ${msg}`);
  }
}
function eq(label, actual, expected) {
  ok(
    label,
    actual === expected,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

// ---------------------------------------------------------------------------
// Stub world — in-memory vault adapter
// ---------------------------------------------------------------------------

function makeWorld() {
  const files = new Map(); // path → string
  let throwOnRead = false;

  const adapter = {
    setThrow(b) { throwOnRead = b; },
    set(p, body) { files.set(p, body); },
    get(p) { return files.get(p); },
    has(p) { return files.has(p); },
    files,
  };

  const app = {
    vault: {
      getAbstractFileByPath(p) {
        if (!files.has(p)) return null;
        return { path: p };
      },
      async read(file) {
        if (throwOnRead) throw new Error("deliberate read failure");
        if (!files.has(file.path)) throw new Error("ENOENT " + file.path);
        return files.get(file.path);
      },
      async modify(file, content) {
        files.set(file.path, content);
      },
      // `process` is the preferred atomic-write surface; the mechanism prefers
      // it when available. Mirror its contract: take a transform, run it on
      // current body, set the result.
      async process(file, transform) {
        const cur = files.has(file.path) ? files.get(file.path) : "";
        files.set(file.path, transform(cur));
      },
    },
  };
  return { app, adapter };
}

function makeWindowWithToDoStub(serializer) {
  return {
    customJS: {
      ToDoCreateTask: { serializePayloadToLine: serializer },
    },
  };
}

// ---------------------------------------------------------------------------
// Sandbox loader — load task-interactions.js into a VM context, expose the
// class via a module-export shim. The class references `window`, `app`, and
// `console` from the surrounding scope at call time, so we wire each test's
// world through the same context object.
// ---------------------------------------------------------------------------

function loadTaskInteractions(ctxOverrides) {
  const src = fs.readFileSync(TI_SRC, "utf8");
  const ctx = {
    console,
    window: ctxOverrides.window || undefined,
    app: ctxOverrides.app || undefined,
    module: { exports: {} },
  };
  // Append an exporter line so we can yank the class out of the VM.
  const wrapped = src + "\nmodule.exports = TaskInteractions;\n";
  vm.createContext(ctx);
  vm.runInContext(wrapped, ctx, { filename: "task-interactions.js" });
  return { TaskInteractions: ctx.module.exports, ctx };
}

// Convenience: build a class instance that operates against a fresh world.
function fresh(opts) {
  opts = opts || {};
  const { app, adapter } = makeWorld();
  const window = opts.noToDoStub
    ? { customJS: {} }
    : makeWindowWithToDoStub(opts.serializer || ((p) => null));
  const { TaskInteractions, ctx } = loadTaskInteractions({ app, window });
  return { TaskInteractions, ctx, app, adapter, window };
}

// ---------------------------------------------------------------------------
// Re-implementation of the to-do blueprint's serializePayloadToLine, used as
// the stand-in delegate in HC-V0127-TI-SER-* cases. Mirrors
// platform/blueprints/to-do/helpers/todo-create-task.js L36-53 so the
// delegate path is exercised against a byte-identical contract.
// ---------------------------------------------------------------------------

function refSerializePayloadToLine(payload) {
  if (!payload || !payload.title) return null;
  const parts = [`- [ ] ${payload.title.trim()}`];
  if (payload.mode === "recurring") {
    if (payload.recurrenceGrammar) parts.push(`[recurrence:: ${payload.recurrenceGrammar}]`);
    if (payload.project && payload.project.name) parts.push(`[project:: [[${payload.project.name}]]]`);
    if (payload.priority) parts.push(`[priority:: ${payload.priority}]`);
    return parts.join(" ");
  }
  if (payload.destination && payload.destination.type === "project" && payload.destination.name) {
    parts.push(`[project:: [[${payload.destination.name}]]]`);
  }
  if (payload.priority) parts.push(`[priority:: ${payload.priority}]`);
  if (payload.due) parts.push(`[due:: ${payload.due}]`);
  if (payload.scheduled) parts.push(`[scheduled:: ${payload.scheduled}]`);
  return parts.join(" ");
}

// ===========================================================================
// I. parseTaskLine — HC-V0127-TI-PARSE-A..H
// ===========================================================================

(function testParse() {
  console.log("\n=== I. parseTaskLine ===");
  const { TaskInteractions: TI } = fresh();

  {
    const p = TI.parseTaskLine("- [ ] write the report");
    eq("HC-V0127-TI-PARSE-A.title", p && p.title, "write the report");
    eq("HC-V0127-TI-PARSE-A.project", p && p.project, null);
    eq("HC-V0127-TI-PARSE-A.priority", p && p.priority, null);
    eq("HC-V0127-TI-PARSE-A.due", p && p.due, null);
    eq("HC-V0127-TI-PARSE-A.scheduled", p && p.scheduled, null);
    eq("HC-V0127-TI-PARSE-A.recurrence", p && p.recurrence, null);
    eq("HC-V0127-TI-PARSE-A.raw", p && p.raw, "- [ ] write the report");
  }

  {
    const p = TI.parseTaskLine("- [ ] x [project:: [[Databricks]]]");
    eq("HC-V0127-TI-PARSE-B.project", p && p.project, "Databricks");
    eq("HC-V0127-TI-PARSE-B.title", p && p.title, "x");
  }

  {
    const p = TI.parseTaskLine("- [ ] x [priority:: high] [due:: 2026-06-24]");
    eq("HC-V0127-TI-PARSE-C.priority", p && p.priority, "high");
    eq("HC-V0127-TI-PARSE-C.due", p && p.due, "2026-06-24");
    eq("HC-V0127-TI-PARSE-C.title", p && p.title, "x");
  }

  {
    const line = "- [ ] design review [project:: [[Graphene]]] [priority:: medium] [due:: 2026-07-01] [scheduled:: 2026-06-30]";
    const p = TI.parseTaskLine(line);
    eq("HC-V0127-TI-PARSE-D.title", p && p.title, "design review");
    eq("HC-V0127-TI-PARSE-D.project", p && p.project, "Graphene");
    eq("HC-V0127-TI-PARSE-D.priority", p && p.priority, "medium");
    eq("HC-V0127-TI-PARSE-D.due", p && p.due, "2026-07-01");
    eq("HC-V0127-TI-PARSE-D.scheduled", p && p.scheduled, "2026-06-30");
  }

  {
    const p = TI.parseTaskLine("- [ ] standup [recurrence:: every weekday] [project:: [[Sauce]]]");
    eq("HC-V0127-TI-PARSE-E.recurrence", p && p.recurrence, "every weekday");
    eq("HC-V0127-TI-PARSE-E.project", p && p.project, "Sauce");
    eq("HC-V0127-TI-PARSE-E.title", p && p.title, "standup");
  }

  {
    const p = TI.parseTaskLine("- [x] done thing");
    eq("HC-V0127-TI-PARSE-F.title", p && p.title, "done thing");
    eq("HC-V0127-TI-PARSE-F.raw", p && p.raw, "- [x] done thing");
  }

  {
    const p = TI.parseTaskLine("something else");
    eq("HC-V0127-TI-PARSE-G.null", p, null);
  }

  {
    // Title contains the substring "[x]" — parser must NOT mistake it for the
    // checkbox or for an inline field (inline fields require `::`).
    const p = TI.parseTaskLine("- [ ] write [x] vs y");
    eq("HC-V0127-TI-PARSE-H.title", p && p.title, "write [x] vs y");
    eq("HC-V0127-TI-PARSE-H.project", p && p.project, null);
  }
})();

// ===========================================================================
// II. serializeTaskLine — HC-V0127-TI-SER-A..C
// ===========================================================================

(function testSerialize() {
  console.log("\n=== II. serializeTaskLine ===");

  // A. Delegates to ToDoCreateTask when the stub is present.
  {
    const { TaskInteractions: TI } = fresh({ serializer: () => "DELEGATED" });
    const out = TI.serializeTaskLine({ title: "x" });
    eq("HC-V0127-TI-SER-A.delegated", out, "DELEGATED");
  }

  // B. Inline fallback when the global is absent. The fallback re-implements
  // the same one-shot grammar; verify byte-identical output for a known
  // payload.
  {
    const { TaskInteractions: TI } = fresh({ noToDoStub: true });
    const out = TI.serializeTaskLine({
      title: "title",
      destination: { type: "project", name: "X", slug: "x" },
      priority: "high",
      due: "2026-06-24",
    });
    eq(
      "HC-V0127-TI-SER-B.fallback",
      out,
      "- [ ] title [project:: [[X]]] [priority:: high] [due:: 2026-06-24]"
    );
  }

  // C. Round-trip. For four payload shapes that the inline fallback emits
  // (one-shot mode), parseTaskLine on the serialized line reconstructs the
  // semantic payload. Project comes back as the bare name (no wikilink).
  {
    const { TaskInteractions: TI } = fresh({ noToDoStub: true });
    const cases = [
      {
        name: "title-only",
        payload: { title: "alpha" },
        expect: { title: "alpha", project: null, priority: null, due: null, scheduled: null, recurrence: null },
      },
      {
        name: "priority+due",
        payload: { title: "beta", priority: "low", due: "2026-08-01" },
        expect: { title: "beta", project: null, priority: "low", due: "2026-08-01", scheduled: null, recurrence: null },
      },
      {
        name: "project+priority+due+scheduled",
        payload: {
          title: "gamma",
          destination: { type: "project", name: "Sauce", slug: "sauce" },
          priority: "highest",
          due: "2026-09-09",
          scheduled: "2026-09-01",
        },
        expect: { title: "gamma", project: "Sauce", priority: "highest", due: "2026-09-09", scheduled: "2026-09-01", recurrence: null },
      },
      {
        name: "recurring (recurrence + project + priority)",
        payload: {
          title: "delta",
          mode: "recurring",
          recurrenceGrammar: "every weekday",
          project: { name: "Sauce" },
          priority: "medium",
        },
        expect: { title: "delta", project: "Sauce", priority: "medium", due: null, scheduled: null, recurrence: "every weekday" },
      },
    ];
    for (const c of cases) {
      const line = TI.serializeTaskLine(c.payload);
      const parsed = TI.parseTaskLine(line);
      eq(`HC-V0127-TI-SER-C.${c.name}.title`, parsed && parsed.title, c.expect.title);
      eq(`HC-V0127-TI-SER-C.${c.name}.project`, parsed && parsed.project, c.expect.project);
      eq(`HC-V0127-TI-SER-C.${c.name}.priority`, parsed && parsed.priority, c.expect.priority);
      eq(`HC-V0127-TI-SER-C.${c.name}.due`, parsed && parsed.due, c.expect.due);
      eq(`HC-V0127-TI-SER-C.${c.name}.scheduled`, parsed && parsed.scheduled, c.expect.scheduled);
      eq(`HC-V0127-TI-SER-C.${c.name}.recurrence`, parsed && parsed.recurrence, c.expect.recurrence);
    }
  }
})();

// ===========================================================================
// III. Anchors — HC-V0127-TI-ANCHOR-A..B
// ===========================================================================

(function testAnchors() {
  console.log("\n=== III. Anchors ===");
  const { TaskInteractions: TI } = fresh();
  eq("HC-V0127-TI-ANCHOR-A.actionItemsAnchor", TI.actionItemsAnchor(), "<!-- ACTION_ITEMS_MARKER -->");
  eq("HC-V0127-TI-ANCHOR-B.todayCaptureAnchor", TI.todayCaptureAnchor(), "<!-- TODAY_CAPTURE_MARKER -->");
})();

// ===========================================================================
// Shared fixtures for injection + scan + writer tests.
// ===========================================================================

const ACTION_ITEMS_SECTION_BLOCK = [
  '```dataviewjs',
  'await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Action Items" }] });',
  '```',
].join("\n");

const TODAY_SECTION_BLOCK = [
  '```dataviewjs',
  'await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Today", top: true }] });',
  '```',
].join("\n");

const BLANK = "";

function meetingBodyNoMarker() {
  return [
    "---",
    "type: meeting",
    "---",
    "",
    "## Notes",
    "Some preceding content.",
    "",
    ACTION_ITEMS_SECTION_BLOCK,
    "",
  ].join("\n");
}

function meetingBodyWithMarker() {
  return [
    "---",
    "type: meeting",
    "---",
    "",
    "## Notes",
    "Some preceding content.",
    "",
    ACTION_ITEMS_SECTION_BLOCK,
    "",
    "<!-- ACTION_ITEMS_MARKER -->",
    "",
  ].join("\n");
}

function todayBody(includeMarker) {
  const parts = [
    "---",
    "type: to-do",
    "---",
    "",
    TODAY_SECTION_BLOCK,
  ];
  if (includeMarker) {
    parts.push("");
    parts.push("<!-- TODAY_CAPTURE_MARKER -->");
  }
  parts.push("");
  parts.push("Other content below.");
  parts.push("");
  return parts.join("\n");
}

// ===========================================================================
// IV. injectActionItemsMarker — HC-V0127-TI-INJECT-AI-A..C
// ===========================================================================

(function testInjectActionItems() {
  console.log("\n=== IV. injectActionItemsMarker ===");
  const { TaskInteractions: TI } = fresh();

  // A. Idempotency: a body that already has the marker is unchanged across 5
  // successive applies.
  {
    let body = meetingBodyWithMarker();
    const start = body;
    for (let i = 0; i < 5; i++) body = TI.injectActionItemsMarker(body);
    eq("HC-V0127-TI-INJECT-AI-A.idempotent", body, start);
  }

  // B. Insertion site: a body with the SectionLabel("Action Items") block but
  // no marker → the marker is placed on its own line AFTER the closing ```
  // fence of that block (inside the Action Items section, below the label).
  {
    const before = meetingBodyNoMarker();
    const after = TI.injectActionItemsMarker(before);
    ok("HC-V0127-TI-INJECT-AI-B.marker-present", after.includes("<!-- ACTION_ITEMS_MARKER -->"));
    const lines = after.split("\n");
    const markerIdx = lines.findIndex((l) => l.includes("<!-- ACTION_ITEMS_MARKER -->"));
    const labelIdx = lines.findIndex(
      (l) => l.includes('class: "SectionLabel", args: [{ text: "Action Items" }]')
    );
    ok("HC-V0127-TI-INJECT-AI-B.label-before-marker", labelIdx >= 0 && labelIdx < markerIdx);
    // The closing fence of the Action Items block sits between the label and the
    // marker — i.e. the marker is AFTER the block, not above it.
    const closeFenceIdx = lines.findIndex(
      (l, i) => i > labelIdx && l.trimStart().startsWith("```")
    );
    ok("HC-V0127-TI-INJECT-AI-B.marker-after-fence", closeFenceIdx > labelIdx && markerIdx > closeFenceIdx);
  }

  // C. No SectionLabel match → body returned unchanged.
  {
    const before = [
      "---",
      "type: meeting",
      "---",
      "",
      "No Action Items section here.",
      "",
    ].join("\n");
    const after = TI.injectActionItemsMarker(before);
    eq("HC-V0127-TI-INJECT-AI-C.unchanged", after, before);
  }
})();

// ===========================================================================
// V. injectTodayCaptureMarker — HC-V0127-TI-INJECT-TC-A..C
// ===========================================================================

(function testInjectTodayCapture() {
  console.log("\n=== V. injectTodayCaptureMarker ===");
  const { TaskInteractions: TI } = fresh();

  // A. Idempotency.
  {
    let body = todayBody(true);
    const start = body;
    for (let i = 0; i < 5; i++) body = TI.injectTodayCaptureMarker(body);
    eq("HC-V0127-TI-INJECT-TC-A.idempotent", body, start);
  }

  // B. Insertion after the closing fence of the SectionLabel("Today",
  // top: true) block.
  {
    const before = todayBody(false);
    const after = TI.injectTodayCaptureMarker(before);
    ok("HC-V0127-TI-INJECT-TC-B.marker-present", after.includes("<!-- TODAY_CAPTURE_MARKER -->"));
    const lines = after.split("\n");
    const labelIdx = lines.findIndex(
      (l) => l.includes('class: "SectionLabel", args: [{ text: "Today", top: true }]')
    );
    // Walk forward to closing fence after the label.
    let closingFenceIdx = -1;
    for (let i = labelIdx + 1; i < lines.length; i++) {
      if (lines[i].trimStart().startsWith("```")) { closingFenceIdx = i; break; }
    }
    const markerIdx = lines.findIndex((l) => l.includes("<!-- TODAY_CAPTURE_MARKER -->"));
    ok(
      "HC-V0127-TI-INJECT-TC-B.marker-after-closing-fence",
      labelIdx >= 0 && closingFenceIdx > labelIdx && markerIdx > closingFenceIdx
    );
  }

  // C. No anchor → unchanged.
  {
    const before = [
      "---",
      "type: to-do",
      "---",
      "",
      "No Today section.",
      "",
    ].join("\n");
    const after = TI.injectTodayCaptureMarker(before);
    eq("HC-V0127-TI-INJECT-TC-C.unchanged", after, before);
  }
})();

// ===========================================================================
// VI. findTaskLines — HC-V0127-TI-FIND-A..D
// ===========================================================================

(function testFindTaskLines() {
  console.log("\n=== VI. findTaskLines ===");
  const { TaskInteractions: TI } = fresh();

  // A. Whole-file scan returns one entry per `- [ ]` / `- [x]` outside fences.
  {
    const content = [
      "Header",
      "- [ ] task1",
      "Some text",
      "- [x] task2",
      "- [ ] task3",
    ].join("\n");
    const out = TI.findTaskLines(content);
    eq("HC-V0127-TI-FIND-A.count", out.length, 3);
    eq("HC-V0127-TI-FIND-A.first-line", out[0].line, "- [ ] task1");
    eq("HC-V0127-TI-FIND-A.second-line", out[1].line, "- [x] task2");
    eq("HC-V0127-TI-FIND-A.third-line", out[2].line, "- [ ] task3");
  }

  // B. Fence-aware: a `- [ ] inside-fence` line within a ```markdown ... ```
  // block is EXCLUDED.
  {
    const content = [
      "- [ ] real-task",
      "```markdown",
      "- [ ] inside-fence",
      "```",
      "- [ ] another-real",
    ].join("\n");
    const out = TI.findTaskLines(content);
    eq("HC-V0127-TI-FIND-B.count", out.length, 2);
    eq("HC-V0127-TI-FIND-B.first", out[0].line, "- [ ] real-task");
    eq("HC-V0127-TI-FIND-B.second", out[1].line, "- [ ] another-real");
  }

  // C. anchor scope === "todayCapture" — only tasks between the marker and
  // the next SectionLabel block are returned.
  {
    const content = [
      "- [ ] above-marker",
      "<!-- TODAY_CAPTURE_MARKER -->",
      "- [ ] inside1",
      "- [ ] inside2",
      '```dataviewjs',
      'await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Carryover" }] });',
      '```',
      "- [ ] below-section-label",
    ].join("\n");
    const out = TI.findTaskLines(content, "todayCapture");
    eq("HC-V0127-TI-FIND-C.count", out.length, 2);
    eq("HC-V0127-TI-FIND-C.first", out[0].line, "- [ ] inside1");
    eq("HC-V0127-TI-FIND-C.second", out[1].line, "- [ ] inside2");
  }

  // D. anchor scope === "actionItems" — symmetric with ACTION_ITEMS_MARKER.
  {
    const content = [
      "- [ ] above-marker",
      "<!-- ACTION_ITEMS_MARKER -->",
      "- [ ] AI-1",
      "- [x] AI-2",
      '```dataviewjs',
      'await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Next" }] });',
      '```',
      "- [ ] tail",
    ].join("\n");
    const out = TI.findTaskLines(content, "actionItems");
    eq("HC-V0127-TI-FIND-D.count", out.length, 2);
    eq("HC-V0127-TI-FIND-D.first", out[0].line, "- [ ] AI-1");
    eq("HC-V0127-TI-FIND-D.second", out[1].line, "- [x] AI-2");
  }
})();

// ===========================================================================
// VI-b. marker generalization — HC-V0127-TI-MARKER-* (#4A)
// `*` and `+` bullets are valid task markers, not just `-`.
// ===========================================================================

(function testMarkers() {
  console.log("\n=== VI-b. marker generalization ===");
  const { TaskInteractions: TI } = fresh();

  // A. parseTaskLine accepts a `*` marker and still extracts inline fields.
  {
    const p = TI.parseTaskLine("* [ ] x [priority:: high]");
    eq("HC-V0127-TI-MARKER-A.title", p && p.title, "x");
    eq("HC-V0127-TI-MARKER-A.priority", p && p.priority, "high");
  }

  // B. findTaskLines returns `* [ ]` / `+ [ ]` rows at fence-depth 0.
  {
    const content = [
      "* [ ] star-task",
      "+ [ ] plus-task",
      "- [ ] dash-task",
    ].join("\n");
    const out = TI.findTaskLines(content);
    eq("HC-V0127-TI-MARKER-B.count", out.length, 3);
    eq("HC-V0127-TI-MARKER-B.star", out[0].line, "* [ ] star-task");
    eq("HC-V0127-TI-MARKER-B.plus", out[1].line, "+ [ ] plus-task");
  }
})();

// ===========================================================================
// VII. appendTask — HC-V0127-TI-APPEND-*
// ===========================================================================

(async function testAppend() {
  console.log("\n=== VII. appendTask ===");

  // Re-usable serializer stub: emits the to-do canonical line.
  function setup() {
    return fresh({ serializer: refSerializePayloadToLine });
  }

  // APPEND-MEETING: meeting body w/ marker → new line inserted immediately
  // AFTER the marker (marker, "", line), so the task lands inside the Action
  // Items section (the marker sits just below the "Action Items" label).
  {
    const { TaskInteractions: TI, app, adapter } = setup();
    const p = "spice/meetings/m1.md";
    adapter.set(p, meetingBodyWithMarker());
    const res = await TI.appendTask(p, { title: "do thing", priority: "high" });
    ok("HC-V0127-TI-APPEND-MEETING.ok", res && res.ok === true);
    const after = adapter.get(p);
    const lines = after.split("\n");
    const markerIdx = lines.findIndex((l) => l.includes("<!-- ACTION_ITEMS_MARKER -->"));
    ok("HC-V0127-TI-APPEND-MEETING.marker-present", markerIdx >= 0);
    // Inserted line should sit two lines below the marker (marker, "", line).
    const insertedIdx = lines.findIndex((l) => l.startsWith("- [ ] do thing"));
    ok("HC-V0127-TI-APPEND-MEETING.line-below-marker", insertedIdx >= 0 && insertedIdx > markerIdx);
    eq("HC-V0127-TI-APPEND-MEETING.blank-between", lines[markerIdx + 1], "");
    ok("HC-V0127-TI-APPEND-MEETING.line-after-blank", (lines[markerIdx + 2] || "").startsWith("- [ ] do thing"));
  }

  // APPEND-MEETING-NEEDS-INJECT: meeting body w/o marker but with the
  // Action Items SectionLabel → injector runs first, then the line is
  // inserted; ONE marker present afterward.
  {
    const { TaskInteractions: TI, app, adapter } = setup();
    const p = "spice/meetings/m2.md";
    adapter.set(p, meetingBodyNoMarker());
    const res = await TI.appendTask(p, { title: "needs inject" });
    ok("HC-V0127-TI-APPEND-MEETING-NEEDS-INJECT.ok", res && res.ok === true);
    const after = adapter.get(p);
    const markerCount = (after.match(/<!-- ACTION_ITEMS_MARKER -->/g) || []).length;
    eq("HC-V0127-TI-APPEND-MEETING-NEEDS-INJECT.exactly-one-marker", markerCount, 1);
    ok(
      "HC-V0127-TI-APPEND-MEETING-NEEDS-INJECT.task-present",
      after.includes("- [ ] needs inject")
    );
  }

  // APPEND-MEETING-NO-ANCHOR: meeting note with no Action Items SectionLabel
  // at all → { ok: false, reason: 'no-action-items-anchor' }, file unchanged.
  {
    const { TaskInteractions: TI, app, adapter } = setup();
    const p = "spice/meetings/m3.md";
    const before = [
      "---",
      "type: meeting",
      "---",
      "",
      "No anchor here.",
      "",
    ].join("\n");
    adapter.set(p, before);
    const res = await TI.appendTask(p, { title: "x" });
    ok("HC-V0127-TI-APPEND-MEETING-NO-ANCHOR.failed", res && res.ok === false);
    eq("HC-V0127-TI-APPEND-MEETING-NO-ANCHOR.reason", res && res.reason, "no-action-items-anchor");
    eq("HC-V0127-TI-APPEND-MEETING-NO-ANCHOR.unchanged", adapter.get(p), before);
  }

  // APPEND-PROJECT-TODO: project-todo note with Owned Tasks SectionLabel →
  // line appended after that block's closing fence.
  {
    const { TaskInteractions: TI, app, adapter } = setup();
    const p = "spice/projects/sauce/Sauce To-Do.md";
    const body = [
      "---",
      "type: project-todo",
      "---",
      "",
      '```dataviewjs',
      'await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Owned Tasks" }] });',
      '```',
      "",
      "- [ ] existing",
      "",
    ].join("\n");
    adapter.set(p, body);
    const res = await TI.appendTask(p, { title: "new" });
    ok("HC-V0127-TI-APPEND-PROJECT-TODO.ok", res && res.ok === true);
    const after = adapter.get(p);
    const lines = after.split("\n");
    // Closing fence of the Owned Tasks block.
    let labelIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('"Owned Tasks"')) { labelIdx = i; break; }
    }
    let closingFenceIdx = -1;
    for (let i = labelIdx + 1; i < lines.length; i++) {
      if (lines[i].trimStart().startsWith("```")) { closingFenceIdx = i; break; }
    }
    const newLineIdx = lines.findIndex((l) => l.startsWith("- [ ] new"));
    ok(
      "HC-V0127-TI-APPEND-PROJECT-TODO.line-after-fence",
      labelIdx > 0 && closingFenceIdx > labelIdx && newLineIdx > closingFenceIdx
    );
  }

  // APPEND-TODAY: type:to-do note with Today SectionLabel → marker injected
  // (if absent) + line inserted immediately after marker.
  {
    const { TaskInteractions: TI, app, adapter } = setup();
    const p = "spice/to-do/2026/06-June/ToDo-2026-06-23.md";
    adapter.set(p, todayBody(false));
    const res = await TI.appendTask(p, { title: "today-task", due: "2026-06-23" });
    ok("HC-V0127-TI-APPEND-TODAY.ok", res && res.ok === true);
    const after = adapter.get(p);
    const markerCount = (after.match(/<!-- TODAY_CAPTURE_MARKER -->/g) || []).length;
    eq("HC-V0127-TI-APPEND-TODAY.exactly-one-marker", markerCount, 1);
    ok("HC-V0127-TI-APPEND-TODAY.task-present", after.includes("- [ ] today-task"));
    const lines = after.split("\n");
    const markerIdx = lines.findIndex((l) => l.includes("<!-- TODAY_CAPTURE_MARKER -->"));
    const newLineIdx = lines.findIndex((l) => l.startsWith("- [ ] today-task"));
    ok("HC-V0127-TI-APPEND-TODAY.line-after-marker", markerIdx >= 0 && newLineIdx > markerIdx);
  }

  // APPEND-UNKNOWN-TYPE: { ok: false, reason starts with 'unknown-type:' }.
  {
    const { TaskInteractions: TI, app, adapter } = setup();
    const p = "spice/random/weird.md";
    adapter.set(p, ["---", "type: weird-type", "---", "", ""].join("\n"));
    const res = await TI.appendTask(p, { title: "x" });
    ok("HC-V0127-TI-APPEND-UNKNOWN-TYPE.failed", res && res.ok === false);
    ok(
      "HC-V0127-TI-APPEND-UNKNOWN-TYPE.reason-prefix",
      res && typeof res.reason === "string" && res.reason.startsWith("unknown-type:")
    );
  }

  // APPEND-RECURRING: { ok: false, reason mentions 'ToDoCreateTask' }.
  {
    const { TaskInteractions: TI, app, adapter } = setup();
    const p = "spice/to-do/Recurring Tasks.md";
    adapter.set(p, ["---", "type: to-do-recurring", "---", "", ""].join("\n"));
    const res = await TI.appendTask(p, { title: "x" });
    ok("HC-V0127-TI-APPEND-RECURRING.failed", res && res.ok === false);
    ok(
      "HC-V0127-TI-APPEND-RECURRING.reason-mentions-ToDoCreateTask",
      res && typeof res.reason === "string" && res.reason.indexOf("ToDoCreateTask") !== -1
    );
  }

  // APPEND-NO-FRONTMATTER: { ok: false, reason: 'no-frontmatter-type' }.
  {
    const { TaskInteractions: TI, app, adapter } = setup();
    const p = "spice/random/raw.md";
    adapter.set(p, "Just a body, no frontmatter at all.\n");
    const res = await TI.appendTask(p, { title: "x" });
    ok("HC-V0127-TI-APPEND-NO-FRONTMATTER.failed", res && res.ok === false);
    eq("HC-V0127-TI-APPEND-NO-FRONTMATTER.reason", res && res.reason, "no-frontmatter-type");
  }

  // APPEND-FILE-MISSING: { ok: false, reason: 'file-not-found' }.
  {
    const { TaskInteractions: TI } = setup();
    const res = await TI.appendTask("does/not/exist.md", { title: "x" });
    ok("HC-V0127-TI-APPEND-FILE-MISSING.failed", res && res.ok === false);
    eq("HC-V0127-TI-APPEND-FILE-MISSING.reason", res && res.reason, "file-not-found");
  }

  // APPEND-NEVER-THROWS: deliberate read failure → returns { ok: false, ... },
  // doesn't propagate.
  {
    const { TaskInteractions: TI, app, adapter } = setup();
    const p = "spice/meetings/m4.md";
    adapter.set(p, meetingBodyWithMarker());
    adapter.setThrow(true);
    let threw = false;
    let res;
    try {
      res = await TI.appendTask(p, { title: "x" });
    } catch (_e) {
      threw = true;
    }
    ok("HC-V0127-TI-APPEND-NEVER-THROWS.did-not-throw", threw === false);
    ok("HC-V0127-TI-APPEND-NEVER-THROWS.failed-result", res && res.ok === false);
    ok(
      "HC-V0127-TI-APPEND-NEVER-THROWS.reason-string",
      res && typeof res.reason === "string" && res.reason.length > 0
    );
  }
})().then(testReplace).then(emit);

// ===========================================================================
// VIII. replaceTaskAt — HC-V0127-TI-REPLACE-A..C + NEVER-THROWS
// ===========================================================================

async function testReplace() {
  console.log("\n=== VIII. replaceTaskAt ===");

  function setup() {
    return fresh({ serializer: refSerializePayloadToLine });
  }

  // A. Success — { ok: true } and file content has the line at lineIdx swapped.
  {
    const { TaskInteractions: TI, app, adapter } = setup();
    const p = "spice/random/r1.md";
    const before = [
      "header",
      "- [ ] old",
      "tail",
    ].join("\n");
    adapter.set(p, before);
    const res = await TI.replaceTaskAt(p, 1, "- [ ] new");
    ok("HC-V0127-TI-REPLACE-A.ok", res && res.ok === true);
    const after = adapter.get(p);
    eq(
      "HC-V0127-TI-REPLACE-A.content",
      after,
      ["header", "- [ ] new", "tail"].join("\n")
    );
  }

  // B. Stale lineIdx — target line is not a task → { ok: false,
  // reason: 'line mismatch' } and file UNCHANGED.
  {
    const { TaskInteractions: TI, app, adapter } = setup();
    const p = "spice/random/r2.md";
    const before = [
      "header",
      "not-a-task-line",
      "- [ ] elsewhere",
    ].join("\n");
    adapter.set(p, before);
    const res = await TI.replaceTaskAt(p, 1, "- [ ] new");
    ok("HC-V0127-TI-REPLACE-B.failed", res && res.ok === false);
    eq("HC-V0127-TI-REPLACE-B.reason", res && res.reason, "line mismatch");
    eq("HC-V0127-TI-REPLACE-B.unchanged", adapter.get(p), before);
  }

  // C. lineIdx out of bounds → { ok: false, reason: 'line-out-of-bounds' }.
  {
    const { TaskInteractions: TI, app, adapter } = setup();
    const p = "spice/random/r3.md";
    const before = ["- [ ] a"].join("\n");
    adapter.set(p, before);
    const res = await TI.replaceTaskAt(p, 99, "- [ ] new");
    ok("HC-V0127-TI-REPLACE-C.failed", res && res.ok === false);
    eq("HC-V0127-TI-REPLACE-C.reason", res && res.reason, "line-out-of-bounds");
  }

  // NEVER-THROWS: read throws → returns { ok: false, ... }, doesn't propagate.
  {
    const { TaskInteractions: TI, app, adapter } = setup();
    const p = "spice/random/r4.md";
    adapter.set(p, "- [ ] a");
    adapter.setThrow(true);
    let threw = false;
    let res;
    try {
      res = await TI.replaceTaskAt(p, 0, "- [ ] b");
    } catch (_e) {
      threw = true;
    }
    ok("HC-V0127-TI-REPLACE-NEVER-THROWS.did-not-throw", threw === false);
    ok("HC-V0127-TI-REPLACE-NEVER-THROWS.failed-result", res && res.ok === false);
  }
}

// ===========================================================================
// Verdict footer
// ===========================================================================

function emit() {
  const total = pass + fail;
  if (fail === 0) {
    console.log(`\nPASS ${pass}/${total}`);
    process.exit(0);
  } else {
    console.log(`\nFAIL ${fail}/${total}`);
    console.log("Failures:");
    for (const f of failures) console.log("  " + f);
    process.exit(1);
  }
}
