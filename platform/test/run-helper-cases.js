#!/usr/bin/env node
// run-helper-cases.js — 16 sub-asserts across 4 cases for v0.1.3's two new
// installer helpers (applyTemplaterHotkeys, applySlashCommanderBindings).
//
// Each case scaffolds a tmpdir scratch vault with a minimal layout:
//   <tmp>/Docs/Meta/platform-config.json
//   <tmp>/Docs/Meta/platform-subscription.json
//   <tmp>/Docs/Meta/Templater/platformInstall.js  (copy of canonical)
//   <tmp>/.obsidian/plugins/templater-obsidian/data.json  (per case)
//   <tmp>/.obsidian/plugins/slash-commander/data.json     (per case)
//   <tmp>/.obsidian/community-plugins.json
//   <tmp>/_fake-workshop/platform/manifest.json
//   <tmp>/_fake-workshop/platform/mechanisms/test-fixture/manifest.json
//
// Then runs the installer harness (run-install.js) against the tmp vault
// and asserts on history + final data.json + writeLog.
//
// Usage: node platform/test/run-helper-cases.js
// Exit: 0 = all cases pass; 1 = any case fails.

"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const WORKSHOP = path.resolve(__dirname, "../..");
const RUN_INSTALL = path.join(WORKSHOP, "platform/test/run-install.js");
const CANONICAL_INSTALLER = path.join(WORKSHOP, "platform/install.js");

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

async function scaffoldVault(scratchDir, opts) {
  // opts = { templaterData, slashCommanderData, manifest }
  await fsp.mkdir(path.join(scratchDir, "Docs/Meta/Templater"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, "Docs/Meta/Templates"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, "Docs/Meta/Scripts"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, "Docs/Meta/Views"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, "Docs/Meta/rules"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, ".obsidian/plugins/templater-obsidian"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, ".obsidian/plugins/slash-commander"), { recursive: true });

  // Bootstrap installer copy.
  await fsp.copyFile(CANONICAL_INSTALLER, path.join(scratchDir, "Docs/Meta/Templater/platformInstall.js"));

  // Mock workshop manifest reachable from this scratch vault: write a fake
  // workshop layout under <scratchDir>/_fake-workshop/ and override
  // workshop_relative_path.
  const fakeWorkshop = path.join(scratchDir, "_fake-workshop");
  await fsp.mkdir(path.join(fakeWorkshop, "platform/mechanisms/test-fixture"), { recursive: true });

  await fsp.writeFile(path.join(fakeWorkshop, "platform/manifest.json"), JSON.stringify({
    workshop_version: "0.0.0-test",
    mechanisms: [{ name: "test-fixture", version: "0.1.0", path: "mechanisms/test-fixture" }],
    blueprints: []
  }, null, 2), "utf8");

  await fsp.writeFile(path.join(fakeWorkshop, "platform/mechanisms/test-fixture/manifest.json"), JSON.stringify(opts.manifest, null, 2), "utf8");

  // platform-config.json: workshop_relative_path points at the fake workshop.
  await fsp.writeFile(path.join(scratchDir, "Docs/Meta/platform-config.json"), JSON.stringify({
    workshop_relative_path: "_fake-workshop",
    variables: {
      views_path: "Docs/Meta/Views",
      templater_scripts_path: "Docs/Meta/Templater",
      scripts_path: "Docs/Meta/Scripts",
      templates_path: "Docs/Meta/Templates",
      content_path: "Docs/Meta/Content",
      rules_path: "Docs/Meta/rules",
    }
  }, null, 2), "utf8");

  // Minimal subscription with the test-fixture mechanism.
  await fsp.writeFile(path.join(scratchDir, "Docs/Meta/platform-subscription.json"), JSON.stringify({
    mechanisms: [{ name: "test-fixture", version: "0.1.0" }],
    blueprints: []
  }, null, 2), "utf8");

  // Pre-seeded plugin data.jsons (per case).
  await fsp.writeFile(path.join(scratchDir, ".obsidian/plugins/templater-obsidian/data.json"), opts.templaterData, "utf8");
  await fsp.writeFile(path.join(scratchDir, ".obsidian/plugins/slash-commander/data.json"), opts.slashCommanderData, "utf8");
  await fsp.writeFile(path.join(scratchDir, ".obsidian/community-plugins.json"), JSON.stringify(["templater-obsidian", "slash-commander"]), "utf8");
}

async function runHarness(scratchDir) {
  // Run installer; capture + return parsed platform-installed.json.
  try {
    execFileSync("node", [RUN_INSTALL, scratchDir], { stdio: "pipe", encoding: "utf8" });
  } catch (e) {
    // exit 1 is fine for our purposes (we inspect history); only re-throw on
    // catastrophic process failure (no installed.json written at all).
  }
  const installedPath = path.join(scratchDir, "Docs/Meta/platform-installed.json");
  if (!fs.existsSync(installedPath)) return null;
  return JSON.parse(await fsp.readFile(installedPath, "utf8"));
}

async function readJson(p) {
  return JSON.parse(await fsp.readFile(p, "utf8"));
}

async function readRaw(p) {
  return fsp.readFile(p, "utf8");
}

const FIXTURE_MANIFEST_BASE = {
  name: "test-fixture",
  version: "0.1.0",
  files: [],
  templater_hotkeys: [{ template: "FixtureA.md" }, { template: "FixtureB.md" }],
  slash_commander_bindings: [
    { name: "fixture-a", template: "FixtureA.md" },
    { name: "fixture-b", template: "FixtureB.md" },
  ],
};

const TEMPLATER_DEFAULT = JSON.stringify({
  enabled_templates_hotkeys: [""],
  startup_templates: [""],
}, null, 2);

const SC_DEFAULT = JSON.stringify({
  version: 2,
  mainTrigger: "/",
  bindings: [],
}, null, 2);

async function case1Idempotent() {
  console.log("\n--- Case 1: idempotent merge on re-run ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-case1-"));
  try {
    await scaffoldVault(scratch, { templaterData: TEMPLATER_DEFAULT, slashCommanderData: SC_DEFAULT, manifest: FIXTURE_MANIFEST_BASE });

    // First run — expect "applied".
    const first = await runHarness(scratch);
    const firstApplied = first.history.filter((h) => h.event === "info" && h.action === "applied" && (h.step === "templater_hotkeys" || h.step === "slash_commander_bindings"));
    assertEq("case1: first run applies 4 entries (2 templater + 2 slash)", firstApplied.length, 4);

    // Snapshot data.jsons for byte-equality after second run.
    const tdataAfter1 = await readRaw(path.join(scratch, ".obsidian/plugins/templater-obsidian/data.json"));
    const sdataAfter1 = await readRaw(path.join(scratch, ".obsidian/plugins/slash-commander/data.json"));

    // Second run — bump fixture version to force re-processing.
    const fixtureManifest2 = { ...FIXTURE_MANIFEST_BASE, version: "0.1.1" };
    await fsp.writeFile(path.join(scratch, "_fake-workshop/platform/manifest.json"), JSON.stringify({
      workshop_version: "0.0.0-test",
      mechanisms: [{ name: "test-fixture", version: "0.1.1", path: "mechanisms/test-fixture" }],
      blueprints: []
    }, null, 2), "utf8");
    await fsp.writeFile(path.join(scratch, "_fake-workshop/platform/mechanisms/test-fixture/manifest.json"), JSON.stringify(fixtureManifest2, null, 2), "utf8");
    await fsp.writeFile(path.join(scratch, "Docs/Meta/platform-subscription.json"), JSON.stringify({
      mechanisms: [{ name: "test-fixture", version: "0.1.1" }],
      blueprints: []
    }, null, 2), "utf8");

    const second = await runHarness(scratch);
    const newOnSecond = second.history.slice(first.history.length);
    const secondSkipped = newOnSecond.filter((h) => h.action === "skipped_existing");
    const secondApplied = newOnSecond.filter((h) => h.action === "applied" && (h.step === "templater_hotkeys" || h.step === "slash_commander_bindings"));
    assertEq("case1: second run skips 4 entries", secondSkipped.length, 4);
    assertEq("case1: second run applies 0 entries", secondApplied.length, 0);

    const tdataAfter2 = await readRaw(path.join(scratch, ".obsidian/plugins/templater-obsidian/data.json"));
    const sdataAfter2 = await readRaw(path.join(scratch, ".obsidian/plugins/slash-commander/data.json"));
    assertTrue("case1: templater data.json byte-identical between runs", tdataAfter1 === tdataAfter2);
    assertTrue("case1: slash-commander data.json byte-identical between runs", sdataAfter1 === sdataAfter2);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function case2MalformedJson() {
  console.log("\n--- Case 2: malformed JSON guard ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-case2-"));
  try {
    await scaffoldVault(scratch, { templaterData: "{not valid json", slashCommanderData: SC_DEFAULT, manifest: FIXTURE_MANIFEST_BASE });
    const result = await runHarness(scratch);
    const errors = result.history.filter((h) => h.event === "error" && h.step === "templater_hotkeys");
    assertTrue("case2: error history entry under step=templater_hotkeys", errors.length >= 1, `got ${errors.length}`);

    const malformedAfter = await readRaw(path.join(scratch, ".obsidian/plugins/templater-obsidian/data.json"));
    assertEq("case2: malformed templater data.json untouched", malformedAfter, "{not valid json");

    // Slash Commander side should still apply (independent helpers).
    const scApplied = result.history.filter((h) => h.event === "info" && h.step === "slash_commander_bindings" && h.action === "applied");
    assertEq("case2: slash_commander side still applied", scApplied.length, 2);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function case3AdditivePreservesUserEntries() {
  console.log("\n--- Case 3: additive merge preserves user entries ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-case3-"));
  try {
    const tdata = JSON.stringify({
      enabled_templates_hotkeys: ["My Custom Template.md", ""],
      startup_templates: [""],
    }, null, 2);
    const sdata = JSON.stringify({
      version: 2,
      mainTrigger: "/",
      bindings: [
        { name: "user-binding", id: "editor:insert-table", action: "editor:insert-table", icon: "table", mode: "any", triggerMode: "anywhere" }
      ],
    }, null, 2);
    await scaffoldVault(scratch, { templaterData: tdata, slashCommanderData: sdata, manifest: FIXTURE_MANIFEST_BASE });
    await runHarness(scratch);

    const tdataAfter = await readJson(path.join(scratch, ".obsidian/plugins/templater-obsidian/data.json"));
    assertEq("case3: user entry preserved at index 0", tdataAfter.enabled_templates_hotkeys[0], "My Custom Template.md");
    assertTrue("case3: platform entries appended", tdataAfter.enabled_templates_hotkeys.includes("Docs/Meta/Templates/FixtureA.md") && tdataAfter.enabled_templates_hotkeys.includes("Docs/Meta/Templates/FixtureB.md"));
    assertEq("case3: array length is 2 user + 2 platform", tdataAfter.enabled_templates_hotkeys.length, 4);

    const sdataAfter = await readJson(path.join(scratch, ".obsidian/plugins/slash-commander/data.json"));
    assertEq("case3: user binding preserved at index 0", sdataAfter.bindings[0].name, "user-binding");
    assertTrue("case3: platform bindings appended", sdataAfter.bindings.some((b) => b.name === "fixture-a") && sdataAfter.bindings.some((b) => b.name === "fixture-b"));
    assertEq("case3: bindings length is 1 user + 2 platform", sdataAfter.bindings.length, 3);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function case4BackupOnEdit() {
  console.log("\n--- Case 4: backup-on-edit ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-case4-"));
  try {
    const tdataPre = JSON.stringify({
      enabled_templates_hotkeys: ["Pre-existing.md"],
      startup_templates: [""],
    }, null, 2);
    const sdataPre = JSON.stringify({
      version: 2,
      mainTrigger: "/",
      bindings: [{ name: "preExisting", id: "preExisting", action: "preExisting", icon: "x", mode: "any", triggerMode: "anywhere" }],
    }, null, 2);
    await scaffoldVault(scratch, { templaterData: tdataPre, slashCommanderData: sdataPre, manifest: FIXTURE_MANIFEST_BASE });
    await runHarness(scratch);

    const tBackup = await readRaw(path.join(scratch, ".obsidian/plugins/templater-obsidian/data.json.beacon-backup"));
    assertEq("case4: templater backup byte-identical to pre-edit", tBackup, tdataPre);

    const sBackup = await readRaw(path.join(scratch, ".obsidian/plugins/slash-commander/data.json.beacon-backup"));
    assertEq("case4: slash-commander backup byte-identical to pre-edit", sBackup, sdataPre);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

(async function main() {
  await case1Idempotent();
  await case2MalformedJson();
  await case3AdditivePreservesUserEntries();
  await case4BackupOnEdit();

  console.log(`\n========`);
  console.log(`Result: ${pass} passed, ${fail} failed.`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log("  " + f));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error("[run-helper-cases] uncaught:", e.stack || e.message);
  process.exit(1);
});
