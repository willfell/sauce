#!/usr/bin/env node
// run-project-activity-cards.js — unit harness for the pure card helpers on
// ProjectActivityPanel + ProjectOpenTasks (chrome overhaul WS2.3: type icons +
// doc section labels on activity/open-task cards). Zero-dep; loads each class
// from its source via new Function(src + "\nreturn ClassName;")() — the customJS
// bare-class contract means the file is ONE expression, so we can't require() it.
"use strict";
const fs = require("fs");
const path = require("path");

function loadClass(relPath, className) {
  const src = fs.readFileSync(path.join(__dirname, "..", relPath), "utf8");
  return new Function(src + "\nreturn " + className + ";")();
}

const ProjectActivityPanel = loadClass(
  "blueprints/project/helpers/project-activity-panel.js",
  "ProjectActivityPanel"
);
const ProjectOpenTasks = loadClass(
  "blueprints/project/helpers/project-open-tasks.js",
  "ProjectOpenTasks"
);

let pass = 0, fail = 0;
const failures = [];
function eq(label, actual, expected) {
  if (actual === expected) { pass++; console.log("  ok  " + label); }
  else {
    fail++;
    const m = `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    failures.push(m);
    console.log("  FAIL  " + m);
  }
}
function truthy(label, cond, detail) {
  if (cond) { pass++; console.log("  ok  " + label); }
  else { fail++; const m = label + (detail ? " — " + detail : ""); failures.push(m); console.log("  FAIL  " + m); }
}

// ── ProjectActivityPanel._kind ──────────────────────────────────────────────
const p = new ProjectActivityPanel();
eq("PAC-kind.meeting", p._kind({ type: "meeting" }), "meeting");
eq("PAC-kind.doc", p._kind({ type: "doc-note" }), "doc");
eq("PAC-kind.task-note", p._kind({ type: "task-note" }), "task");
// Board task shape (no type:task-note frontmatter) still reads as a task.
eq("PAC-kind.board-task", p._kind({ _isTask: true }), "task");
// Unknown / empty entries fall back to task-ish default? — spec says
// meeting/doc/task; anything not meeting/doc should behave as a task icon.
eq("PAC-kind.default-task", p._kind({}), "task");

// ── ProjectActivityPanel._cardMeta ──────────────────────────────────────────
eq("PAC-meta.doc-with-section", p._cardMeta({ type: "doc-note", section: "Workflow Loops" }), "doc · Workflow Loops");
eq("PAC-meta.doc-no-section", p._cardMeta({ type: "doc-note" }), "doc");
eq("PAC-meta.doc-empty-section", p._cardMeta({ type: "doc-note", section: "" }), "doc");
eq("PAC-meta.meeting", p._cardMeta({ type: "meeting" }), "meeting");
eq("PAC-meta.task", p._cardMeta({ type: "task-note" }), "task");
// section only labels docs — a meeting with a stray section field stays "meeting".
eq("PAC-meta.meeting-ignores-section", p._cardMeta({ type: "meeting", section: "X" }), "meeting");

// ── icon accessors exist + return SVG strings ───────────────────────────────
truthy("PAC-icon.map-present", p._icons && typeof p._icons === "object", "expected _icons map");
if (p._icons) {
  truthy("PAC-icon.meeting-svg", /<svg/.test(p._icons.meeting || ""), "meeting icon not an svg");
  truthy("PAC-icon.doc-svg", /<svg/.test(p._icons.doc || ""), "doc icon not an svg");
  truthy("PAC-icon.task-svg", /<svg/.test(p._icons.task || ""), "task icon not an svg");
}
// _cardIcon dispatches by kind.
truthy("PAC-cardIcon.meeting", /<svg/.test(p._cardIcon({ type: "meeting" }) || ""));
truthy("PAC-cardIcon.doc", /<svg/.test(p._cardIcon({ type: "doc-note" }) || ""));
truthy("PAC-cardIcon.task", /<svg/.test(p._cardIcon({ type: "task-note" }) || ""));

// ── ProjectOpenTasks task icon ──────────────────────────────────────────────
const ot = new ProjectOpenTasks();
truthy("POT-icon.task-svg", /<svg/.test(ot._taskIcon() || ""), "open-tasks task icon not an svg");

console.log("");
if (fail === 0) { console.log("PASS " + pass + "/" + (pass + fail)); process.exit(0); }
else { console.log("FAIL " + fail + "/" + (pass + fail)); for (const f of failures) console.log("  - " + f); process.exit(1); }
