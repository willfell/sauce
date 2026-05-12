#!/usr/bin/env node
// run-claude-surface.js — v0.32.0 S2 sub-asserts for aggregateClaudeSurface.
//
// Tests the registry builder in isolation: imports aggregateClaudeSurface
// from platform/install.js and exercises it with constructed Map<name,manifest>
// + subscription fixtures. No install-flow integration in S2 — that's S3.
//
// Cases:
//   CS-AG-1  zero subscribed items → empty registry + materializeList + rows
//   CS-AG-2  one blueprint w/ command + skill + claude_md_row(resolvers) →
//            registry has 3 entries, materializeList length 2, rows.resolvers length 1
//   CS-AG-3  {{module_directory}} in claude_md_row.row.path → spice/<bare>/...
//   CS-AG-4  {{skills_dir}} in skill dest → manifest.skills_dir value substituted
//   CS-AG-5  dest "/etc/passwd" rejected (error event in history; not in materializeList)
//   CS-AG-6  rows.resolvers sorted alphabetically by topic
//   CS-AG-7  unsubscribed item with claude_surface[] in manifest map → NOT in registry
//
// Usage: node platform/test/run-claude-surface.js
// Exit: 0 = all pass; 1 = any fail.

"use strict";

const path = require("path");

const WORKSHOP = path.resolve(__dirname, "../..");
const INSTALLER_PATH = path.join(WORKSHOP, "platform/install.js");

const installer = require(INSTALLER_PATH);
const aggregateClaudeSurface = installer.aggregateClaudeSurface;

let pass = 0;
let fail = 0;
const failures = [];

function assertEq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    fail++;
    failures.push(`FAIL: ${label}\n  expected ${e}\n  actual   ${a}`);
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
    return false;
  }
  pass++;
  console.log(`  PASS: ${label}`);
  return true;
}

function mkGit() {
  return { commit: "deadbeef", tag: null, dirty: false };
}

// ============================================================
// CS-AG-1: zero subscribed items → fully empty output
// ============================================================
async function caseCSAG1Empty() {
  console.log("\n--- Case CS-AG-1: aggregate with zero subscribed items ---");
  const perItemManifest = new Map();
  const subscription = { mechanisms: [], blueprints: [] };
  const history = [];
  const out = await aggregateClaudeSurface(perItemManifest, subscription, history, mkGit(), { workshop_version: "0.0.0-test" });

  assertTrue("CS-AG-1: result is an object", out && typeof out === "object");
  assertEq("CS-AG-1: registry.contributions is empty", out.registry.contributions, {});
  assertEq("CS-AG-1: materializeList empty", out.materializeList, []);
  assertEq("CS-AG-1: rows.directory-map empty", out.rows["directory-map"], []);
  assertEq("CS-AG-1: rows.resolvers empty", out.rows["resolvers"], []);
  assertEq("CS-AG-1: rows.skills-index empty", out.rows["skills-index"], []);
}

// ============================================================
// CS-AG-2: three-kind aggregation
// ============================================================
async function caseCSAG2ThreeKinds() {
  console.log("\n--- Case CS-AG-2: blueprint w/ command + skill + claude_md_row(resolvers) ---");
  const perItemManifest = new Map();
  perItemManifest.set("test-bp", {
    name: "test-bp",
    version: "0.1.0",
    kind: "blueprint",
    module_directory: "testbp",
    skills_dir: ".claude/skills/sauce",
    claude_surface: [
      { kind: "command", source: "commands/foo.md", dest: ".claude/commands/foo.md" },
      { kind: "skill", source: "skills/bar/SKILL.md", dest: "{{skills_dir}}/bar/SKILL.md" },
      { kind: "claude_md_row", table: "resolvers", row: { topic: "alpha", skill: "test-bp:alpha" } }
    ]
  });
  const subscription = { mechanisms: [], blueprints: [{ name: "test-bp", version: "0.1.0" }] };
  const history = [];
  const out = await aggregateClaudeSurface(perItemManifest, subscription, history, mkGit(), { workshop_version: "0.0.0-test" });

  assertTrue("CS-AG-2: test-bp in registry.contributions", Array.isArray(out.registry.contributions["test-bp"]));
  assertEq("CS-AG-2: test-bp has 3 contributions", out.registry.contributions["test-bp"].length, 3);
  assertEq("CS-AG-2: materializeList length 2", out.materializeList.length, 2);
  assertEq("CS-AG-2: rows.resolvers length 1", out.rows.resolvers.length, 1);
  assertEq("CS-AG-2: resolver row carries owner field", out.rows.resolvers[0].owner, "test-bp");
}

// ============================================================
// CS-AG-3: {{module_directory}} substitution in claude_md_row.row.path
// ============================================================
async function caseCSAG3ModuleDirSub() {
  console.log("\n--- Case CS-AG-3: {{module_directory}} → spice/<bare>/... in claude_md_row.row.path ---");
  const perItemManifest = new Map();
  perItemManifest.set("project", {
    name: "project",
    version: "1.0.0",
    kind: "blueprint",
    module_directory: "projects",
    claude_surface: [
      { kind: "claude_md_row", table: "directory-map", row: { path: "{{module_directory}}/Projects.md", note: "project hub" } }
    ]
  });
  const subscription = { mechanisms: [], blueprints: [{ name: "project", version: "1.0.0" }] };
  const history = [];
  const out = await aggregateClaudeSurface(perItemManifest, subscription, history, mkGit(), { workshop_version: "0.0.0-test" });

  assertEq("CS-AG-3: rows.directory-map length 1", out.rows["directory-map"].length, 1);
  const row = out.rows["directory-map"][0];
  assertEq("CS-AG-3: row.path is substituted to spice/projects/Projects.md", row.path, "spice/projects/Projects.md");
}

// ============================================================
// CS-AG-4: {{skills_dir}} substitution in skill dest
// ============================================================
async function caseCSAG4SkillsDirSub() {
  console.log("\n--- Case CS-AG-4: {{skills_dir}} → manifest.skills_dir value in skill dest ---");
  const perItemManifest = new Map();
  perItemManifest.set("platform-claude", {
    name: "platform-claude",
    version: "0.1.0",
    kind: "mechanism",
    skills_dir: ".claude/skills/test",
    claude_surface: [
      { kind: "skill", source: "skills/foo/SKILL.md", dest: "{{skills_dir}}/foo/SKILL.md" }
    ]
  });
  const subscription = { mechanisms: [{ name: "platform-claude", version: "0.1.0" }], blueprints: [] };
  const history = [];
  const out = await aggregateClaudeSurface(perItemManifest, subscription, history, mkGit(), { workshop_version: "0.0.0-test" });

  assertEq("CS-AG-4: materializeList length 1", out.materializeList.length, 1);
  assertEq("CS-AG-4: skill dest substituted", out.materializeList[0].dest, ".claude/skills/test/foo/SKILL.md");
}

// ============================================================
// CS-AG-5: destination path validation — /etc/passwd rejected
// ============================================================
async function caseCSAG5DestPathRejected() {
  console.log("\n--- Case CS-AG-5: dest \"/etc/passwd\" rejected; error event + not materialized ---");
  const perItemManifest = new Map();
  perItemManifest.set("bad", {
    name: "bad",
    version: "0.1.0",
    kind: "mechanism",
    claude_surface: [
      { kind: "command", source: "x.md", dest: "/etc/passwd" }
    ]
  });
  const subscription = { mechanisms: [{ name: "bad", version: "0.1.0" }], blueprints: [] };
  const history = [];
  const out = await aggregateClaudeSurface(perItemManifest, subscription, history, mkGit(), { workshop_version: "0.0.0-test" });

  assertEq("CS-AG-5: rejected entry NOT in materializeList", out.materializeList.length, 0);
  const errs = history.filter((h) => h.event === "error" && h.step === "claude_surface_dest_disallowed");
  assertEq("CS-AG-5: exactly one disallowed-dest error event", errs.length, 1);
}

// ============================================================
// CS-AG-6: rows.resolvers sorted alphabetically by topic
// ============================================================
async function caseCSAG6RowSort() {
  console.log("\n--- Case CS-AG-6: rows.resolvers sorted alphabetically by topic ---");
  const perItemManifest = new Map();
  perItemManifest.set("a", {
    name: "a", version: "0.1.0", kind: "mechanism",
    claude_surface: [
      { kind: "claude_md_row", table: "resolvers", row: { topic: "Zebra", skill: "a:zebra" } }
    ]
  });
  perItemManifest.set("b", {
    name: "b", version: "0.1.0", kind: "mechanism",
    claude_surface: [
      { kind: "claude_md_row", table: "resolvers", row: { topic: "Apple", skill: "b:apple" } }
    ]
  });
  const subscription = {
    mechanisms: [{ name: "a", version: "0.1.0" }, { name: "b", version: "0.1.0" }],
    blueprints: []
  };
  const history = [];
  const out = await aggregateClaudeSurface(perItemManifest, subscription, history, mkGit(), { workshop_version: "0.0.0-test" });

  assertEq("CS-AG-6: rows.resolvers length 2", out.rows.resolvers.length, 2);
  assertEq("CS-AG-6: first resolver topic is Apple", out.rows.resolvers[0].topic, "Apple");
  assertEq("CS-AG-6: second resolver topic is Zebra", out.rows.resolvers[1].topic, "Zebra");
}

// ============================================================
// CS-AG-7: unsubscribed item with claude_surface[] absent from registry
// ============================================================
async function caseCSAG7Unsubscribed() {
  console.log("\n--- Case CS-AG-7: unsubscribed item with claude_surface[] absent from registry ---");
  const perItemManifest = new Map();
  perItemManifest.set("subbed", {
    name: "subbed", version: "0.1.0", kind: "mechanism",
    claude_surface: [
      { kind: "command", source: "s.md", dest: ".claude/commands/s.md" }
    ]
  });
  perItemManifest.set("orphan", {
    name: "orphan", version: "0.1.0", kind: "mechanism",
    claude_surface: [
      { kind: "command", source: "o.md", dest: ".claude/commands/o.md" }
    ]
  });
  const subscription = { mechanisms: [{ name: "subbed", version: "0.1.0" }], blueprints: [] };
  const history = [];
  const out = await aggregateClaudeSurface(perItemManifest, subscription, history, mkGit(), { workshop_version: "0.0.0-test" });

  assertTrue("CS-AG-7: subscribed item in registry", Array.isArray(out.registry.contributions["subbed"]));
  assertTrue("CS-AG-7: unsubscribed item NOT in registry", out.registry.contributions["orphan"] === undefined);
  assertEq("CS-AG-7: materializeList only includes subscribed entry", out.materializeList.length, 1);
}

async function main() {
  if (typeof aggregateClaudeSurface !== "function") {
    console.error("FATAL: aggregateClaudeSurface is not exported from install.js");
    process.exit(1);
  }

  await caseCSAG1Empty();
  await caseCSAG2ThreeKinds();
  await caseCSAG3ModuleDirSub();
  await caseCSAG4SkillsDirSub();
  await caseCSAG5DestPathRejected();
  await caseCSAG6RowSort();
  await caseCSAG7Unsubscribed();

  console.log("\n========================================");
  console.log(`run-claude-surface: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    for (const f of failures) console.log(f);
    process.exit(1);
  }
  console.log("ALL GREEN");
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
