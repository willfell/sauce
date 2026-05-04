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

// --------------------------------------------------------------------------
// v0.2.0 T1.1: module_directory field validation cases (M1, M2)
// --------------------------------------------------------------------------
//
// These cases use a DIFFERENT scaffold than case1-4 because they need:
//   - blueprint(s), not a mechanism
//   - the workshop manifest's blueprints[] populated
//   - the consumer subscription's blueprints[] populated
//
// scaffoldBlueprintVault writes a fake workshop with the given blueprint
// definitions and a consumer subscribing to all of them.

async function scaffoldBlueprintVault(scratchDir, blueprints, opts) {
  // blueprints: [{ name, version, manifest, sourceFiles? }]
  //   manifest      = full per-blueprint manifest body
  //   sourceFiles   = optional [{ relPath, body }] to write under
  //                   <fakeWorkshop>/platform/blueprints/<name>/<relPath>.
  // opts (optional): { extraMechanisms: [{ name, version, manifest, sourceFiles? }] }
  await fsp.mkdir(path.join(scratchDir, "Docs/Meta/Templater"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, "Docs/Meta/Templates"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, "Docs/Meta/Scripts"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, "Docs/Meta/Views"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, "Docs/Meta/rules"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, ".obsidian/plugins/templater-obsidian"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, ".obsidian/plugins/slash-commander"), { recursive: true });

  await fsp.copyFile(CANONICAL_INSTALLER, path.join(scratchDir, "Docs/Meta/Templater/platformInstall.js"));

  const fakeWorkshop = path.join(scratchDir, "_fake-workshop");
  for (const bp of blueprints) {
    const bpDir = path.join(fakeWorkshop, `platform/blueprints/${bp.name}`);
    await fsp.mkdir(bpDir, { recursive: true });
    await fsp.writeFile(
      path.join(bpDir, "manifest.json"),
      JSON.stringify(bp.manifest, null, 2),
      "utf8"
    );
    for (const sf of bp.sourceFiles || []) {
      const target = path.join(bpDir, sf.relPath);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, sf.body, "utf8");
    }
  }
  const extraMechanisms = (opts && opts.extraMechanisms) || [];
  for (const m of extraMechanisms) {
    const mDir = path.join(fakeWorkshop, `platform/mechanisms/${m.name}`);
    await fsp.mkdir(mDir, { recursive: true });
    await fsp.writeFile(
      path.join(mDir, "manifest.json"),
      JSON.stringify(m.manifest, null, 2),
      "utf8"
    );
    for (const sf of m.sourceFiles || []) {
      const target = path.join(mDir, sf.relPath);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, sf.body, "utf8");
    }
  }
  await fsp.writeFile(path.join(fakeWorkshop, "platform/manifest.json"), JSON.stringify({
    workshop_version: "0.0.0-test",
    mechanisms: extraMechanisms.map((m) => ({ name: m.name, version: m.version, path: `mechanisms/${m.name}` })),
    blueprints: blueprints.map((bp) => ({ name: bp.name, version: bp.version, path: `blueprints/${bp.name}` }))
  }, null, 2), "utf8");

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

  await fsp.writeFile(path.join(scratchDir, "Docs/Meta/platform-subscription.json"), JSON.stringify({
    mechanisms: extraMechanisms.map((m) => ({ name: m.name, version: m.version })),
    blueprints: blueprints.map((bp) => ({ name: bp.name, version: bp.version }))
  }, null, 2), "utf8");

  await fsp.writeFile(path.join(scratchDir, ".obsidian/plugins/templater-obsidian/data.json"), TEMPLATER_DEFAULT, "utf8");
  await fsp.writeFile(path.join(scratchDir, ".obsidian/plugins/slash-commander/data.json"), SC_DEFAULT, "utf8");
  await fsp.writeFile(path.join(scratchDir, ".obsidian/community-plugins.json"), JSON.stringify(["templater-obsidian", "slash-commander"]), "utf8");
}

async function caseM1MissingModuleDirectory() {
  console.log("\n--- Case M1: blueprint missing module_directory triggers error history entry and skip ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseM1-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-no-md",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-no-md",
          version: "0.1.0",
          kind: "blueprint",
          files: []
          // NOTE: NO module_directory field
        }
      }
    ]);
    const result = await runHarness(scratch);
    assertTrue("M1: platform-installed.json was written", result !== null);

    const errs = (result && result.history || []).filter(
      (h) => h.event === "error" && h.step === "module_directory_missing" && h.name === "test-fixture-no-md"
    );
    assertEq("M1: exactly one module_directory_missing error event", errs.length, 1);

    if (errs.length === 1) {
      const e = errs[0];
      assertTrue("M1: error event has git_commit field", "git_commit" in e);
      assertTrue("M1: error event has git_tag field", "git_tag" in e);
      assertTrue("M1: error event has git_dirty field", "git_dirty" in e);
      assertTrue("M1: error event has attempted_at field", typeof e.attempted_at === "string");
    }

    const installedBp = (result && result.blueprints || []).find(
      (b) => b.name === "test-fixture-no-md" && b.version === "0.1.0"
    );
    assertTrue("M1: skipped blueprint NOT recorded in blueprints[] as installed", installedBp === undefined);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseM2ModuleDirectoryCollision() {
  console.log("\n--- Case M2: two blueprints declare same module_directory; second skipped + warning ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseM2-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-collide-a",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-collide-a",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "shared",
          files: []
        }
      },
      {
        name: "test-fixture-collide-b",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-collide-b",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "shared",
          files: []
        }
      }
    ]);
    const result = await runHarness(scratch);
    assertTrue("M2: platform-installed.json was written", result !== null);

    const warns = (result && result.history || []).filter(
      (h) => h.event === "warning" && h.step === "module_directory_collision"
    );
    assertEq("M2: exactly one module_directory_collision warning event", warns.length, 1);

    if (warns.length === 1) {
      const w = warns[0];
      assertTrue(
        "M2: warning event names BOTH blueprints (in name or colliding_with fields, or message)",
        (w.name === "test-fixture-collide-b" && (w.colliding_with === "test-fixture-collide-a" || (w.message && w.message.includes("test-fixture-collide-a"))))
        || (typeof w.message === "string" && w.message.includes("test-fixture-collide-a") && w.message.includes("test-fixture-collide-b"))
      );
      assertTrue("M2: warning event has git_commit field", "git_commit" in w);
      assertTrue("M2: warning event has git_tag field", "git_tag" in w);
      assertTrue("M2: warning event has git_dirty field", "git_dirty" in w);
    }

    // First wins.
    const installedFirst = (result && result.blueprints || []).find((b) => b.name === "test-fixture-collide-a");
    assertTrue("M2: first blueprint installed normally", installedFirst !== undefined && installedFirst.version === "0.1.0");

    // Second skipped.
    const installedSecond = (result && result.blueprints || []).find((b) => b.name === "test-fixture-collide-b");
    assertTrue("M2: second blueprint NOT in blueprints[] (skipped)", installedSecond === undefined);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------
// v0.2.0 T1.2: per-blueprint {{module_directory}} substitution (M3, M4, M5)
// --------------------------------------------------------------------------

async function caseM3ModuleDirectorySubstitutes() {
  console.log("\n--- Case M3: {{module_directory}} substitutes to beacon/<name> for blueprint files ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseM3-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-md-sub",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-md-sub",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "alpha",
          files: [
            { source: "content/foo.md", dest: "{{module_directory}}/sub/foo.md" }
          ]
        },
        sourceFiles: [
          { relPath: "content/foo.md", body: "[boards link]({{module_directory}}/To-Do-Board.md)\n" }
        ]
      }
    ]);
    const result = await runHarness(scratch);
    assertTrue("M3: platform-installed.json was written", result !== null);

    const destAbs = path.join(scratch, "beacon/alpha/sub/foo.md");
    assertTrue("M3: dest file lands at beacon/alpha/sub/foo.md (substituted path)", fs.existsSync(destAbs));

    if (fs.existsSync(destAbs)) {
      const body = await readRaw(destAbs);
      assertTrue(
        "M3: dest body contains beacon/alpha/To-Do-Board.md (lenient body sub)",
        body.includes("beacon/alpha/To-Do-Board.md"),
        `body was: ${body.trim()}`
      );
      assertTrue(
        "M3: dest body does NOT contain literal {{module_directory}}",
        !body.includes("{{module_directory}}")
      );
    }

    const installedBp = (result && result.blueprints || []).find((b) => b.name === "test-fixture-md-sub");
    assertTrue("M3: blueprint installed (not skipped) in blueprints[]", installedBp !== undefined && installedBp.version === "0.1.0");

    const offending = (result && result.history || []).filter(
      (h) =>
        (h.step === "module_directory_missing" || h.step === "module_directory_collision") &&
        h.name === "test-fixture-md-sub"
    );
    assertEq("M3: NO module_directory_missing or module_directory_collision history entry", offending.length, 0);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseM4NoLeakBetweenBlueprints() {
  console.log("\n--- Case M4: {{module_directory}} does NOT leak between blueprints ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseM4-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-leak-a",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-leak-a",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "alpha",
          files: [{ source: "content/file.md", dest: "{{module_directory}}/file.md" }]
        },
        sourceFiles: [
          { relPath: "content/file.md", body: "module is {{module_directory}}\n" }
        ]
      },
      {
        name: "test-fixture-leak-b",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-leak-b",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "beta",
          files: [{ source: "content/file.md", dest: "{{module_directory}}/file.md" }]
        },
        sourceFiles: [
          { relPath: "content/file.md", body: "module is {{module_directory}}\n" }
        ]
      }
    ]);
    await runHarness(scratch);

    const aPath = path.join(scratch, "beacon/alpha/file.md");
    const bPath = path.join(scratch, "beacon/beta/file.md");
    assertTrue("M4: alpha file exists at beacon/alpha/file.md", fs.existsSync(aPath));
    assertTrue("M4: beta file exists at beacon/beta/file.md", fs.existsSync(bPath));

    if (fs.existsSync(aPath) && fs.existsSync(bPath)) {
      const aBody = await readRaw(aPath);
      const bBody = await readRaw(bPath);
      assertTrue("M4: alpha body references beacon/alpha", aBody.includes("beacon/alpha"));
      assertTrue("M4: alpha body does NOT reference beacon/beta", !aBody.includes("beacon/beta"));
      assertTrue("M4: beta body references beacon/beta", bBody.includes("beacon/beta"));
      assertTrue("M4: beta body does NOT reference beacon/alpha", !bBody.includes("beacon/alpha"));
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseM5MechanismDoesNotReceiveModuleDirectory() {
  console.log("\n--- Case M5: mechanism does NOT receive {{module_directory}} (lenient leaves literal) ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseM5-"));
  try {
    await scaffoldBlueprintVault(scratch, [], {
      extraMechanisms: [
        {
          name: "test-fixture-mech",
          version: "0.1.0",
          manifest: {
            name: "test-fixture-mech",
            version: "0.1.0",
            files: [{ source: "content/foo.md", dest: "{{scripts_path}}/foo.md" }]
          },
          sourceFiles: [
            { relPath: "content/foo.md", body: "module is {{module_directory}}\n" }
          ]
        }
      ]
    });
    const result = await runHarness(scratch);
    assertTrue("M5: platform-installed.json was written", result !== null);

    const installedMech = (result && result.mechanisms || []).find((m) => m.name === "test-fixture-mech");
    assertTrue("M5: mechanism installed", installedMech !== undefined && installedMech.version === "0.1.0");

    const destAbs = path.join(scratch, "Docs/Meta/Scripts/foo.md");
    assertTrue("M5: mechanism dest file exists", fs.existsSync(destAbs));

    if (fs.existsSync(destAbs)) {
      const body = await readRaw(destAbs);
      assertTrue(
        "M5: mechanism body retains LITERAL {{module_directory}} (lenient leaves missing var)",
        body.includes("{{module_directory}}"),
        `body was: ${body.trim()}`
      );
    }

    const mdEvents = (result && result.history || []).filter(
      (h) =>
        h.name === "test-fixture-mech" &&
        (h.step === "module_directory_missing" || h.step === "module_directory_collision" || h.step === "module_directory_substitution_missing")
    );
    assertEq("M5: NO module_directory-related history events for the mechanism", mdEvents.length, 0);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------
// v0.2.0 T1.3: Option B content overwrite mechanic for files[] (O1-O5)
// --------------------------------------------------------------------------
//
// Each case scaffolds a blueprint with one content file, OPTIONALLY primes
// the dest path before running the installer (to set up the prior-state),
// then asserts on (a) final dest content, (b) presence/absence of <dest>.bak,
// (c) presence/absence of `replace`/`file_overwrite` history events with the
// expected sha-256 fields.

const crypto = require("crypto");
function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

async function caseO1IdenticalContentSkipsOverwrite() {
  console.log("\n--- Case O1: dest content matches source → no replace event (idempotent) ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseO1-"));
  try {
    const body = "hello world\n";
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-o1",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-o1",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "o1",
          files: [{ source: "content/hello.md", dest: "{{module_directory}}/hello.md" }]
        },
        sourceFiles: [{ relPath: "content/hello.md", body }]
      }
    ]);
    // Pre-prime the dest with EXACTLY the expected post-substitution body
    // (the source body has no substitution tokens, so substituted === body).
    const destAbs = path.join(scratch, "beacon/o1/hello.md");
    await fsp.mkdir(path.dirname(destAbs), { recursive: true });
    await fsp.writeFile(destAbs, body, "utf8");

    const result = await runHarness(scratch);
    assertTrue("O1: platform-installed.json was written", result !== null);

    const finalBody = await readRaw(destAbs);
    assertEq("O1: final dest content unchanged", finalBody, body);

    const bakAbs = `${destAbs}.bak`;
    assertTrue("O1: <dest>.bak NOT created", !fs.existsSync(bakAbs));

    const replaces = (result && result.history || []).filter(
      (h) => h.event === "replace" && h.step === "file_overwrite"
    );
    assertEq("O1: NO replace/file_overwrite history entry", replaces.length, 0);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseO2DifferingContentBackupAndReplace() {
  console.log("\n--- Case O2: dest differs, prior non-empty → .bak written + replace event ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseO2-"));
  try {
    const newBody = "new content";
    const oldBody = "old content";
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-o2",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-o2",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "o2",
          files: [{ source: "content/c.md", dest: "{{module_directory}}/c.md" }]
        },
        sourceFiles: [{ relPath: "content/c.md", body: newBody }]
      }
    ]);
    const destAbs = path.join(scratch, "beacon/o2/c.md");
    await fsp.mkdir(path.dirname(destAbs), { recursive: true });
    await fsp.writeFile(destAbs, oldBody, "utf8");

    const result = await runHarness(scratch);
    assertTrue("O2: platform-installed.json was written", result !== null);

    const finalBody = await readRaw(destAbs);
    assertEq("O2: final dest content === new source body", finalBody, newBody);

    const bakAbs = `${destAbs}.bak`;
    assertTrue("O2: <dest>.bak file exists", fs.existsSync(bakAbs));
    if (fs.existsSync(bakAbs)) {
      const bakBody = await readRaw(bakAbs);
      assertEq("O2: <dest>.bak content === prior content", bakBody, oldBody);
    }

    const replaces = (result && result.history || []).filter(
      (h) => h.event === "replace" && h.step === "file_overwrite"
    );
    assertEq("O2: exactly one replace/file_overwrite history entry", replaces.length, 1);

    if (replaces.length === 1) {
      const r = replaces[0];
      assertTrue(
        "O2: prior_sha is 64-char hex string",
        typeof r.prior_sha === "string" && /^[0-9a-f]{64}$/.test(r.prior_sha)
      );
      assertTrue(
        "O2: new_sha is 64-char hex string",
        typeof r.new_sha === "string" && /^[0-9a-f]{64}$/.test(r.new_sha)
      );
      assertEq("O2: prior_sha matches sha256(old content)", r.prior_sha, sha256(oldBody));
      assertEq("O2: new_sha matches sha256(new content)", r.new_sha, sha256(newBody));
      assertTrue("O2: bak_path ends with .bak", typeof r.bak_path === "string" && r.bak_path.endsWith(".bak"));
      assertTrue("O2: git_commit field present", "git_commit" in r);
      assertTrue("O2: git_tag field present", "git_tag" in r);
      assertTrue("O2: git_dirty field present", "git_dirty" in r);
      assertTrue("O2: attempted_at is a string", typeof r.attempted_at === "string");
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseO3ZeroByteDestNoBackup() {
  console.log("\n--- Case O3: dest differs, prior is 0-byte → no .bak; just write; no replace event ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseO3-"));
  try {
    const body = "fresh content\n";
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-o3",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-o3",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "o3",
          files: [{ source: "content/c.md", dest: "{{module_directory}}/c.md" }]
        },
        sourceFiles: [{ relPath: "content/c.md", body }]
      }
    ]);
    const destAbs = path.join(scratch, "beacon/o3/c.md");
    await fsp.mkdir(path.dirname(destAbs), { recursive: true });
    await fsp.writeFile(destAbs, "", "utf8"); // 0-byte file

    const result = await runHarness(scratch);
    assertTrue("O3: platform-installed.json was written", result !== null);

    const finalBody = await readRaw(destAbs);
    assertEq("O3: final dest content === source body", finalBody, body);

    const bakAbs = `${destAbs}.bak`;
    assertTrue("O3: <dest>.bak NOT created (0-byte prior treated as fresh)", !fs.existsSync(bakAbs));

    const replaces = (result && result.history || []).filter(
      (h) => h.event === "replace" && h.step === "file_overwrite"
    );
    assertEq("O3: NO replace/file_overwrite history entry", replaces.length, 0);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseO4FreshWriteNoReplace() {
  console.log("\n--- Case O4: dest doesn't exist → fresh write; no replace event ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseO4-"));
  try {
    const body = "brand new\n";
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-o4",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-o4",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "o4",
          files: [{ source: "content/c.md", dest: "{{module_directory}}/c.md" }]
        },
        sourceFiles: [{ relPath: "content/c.md", body }]
      }
    ]);
    // DO NOT prime dest.

    const result = await runHarness(scratch);
    assertTrue("O4: platform-installed.json was written", result !== null);

    const destAbs = path.join(scratch, "beacon/o4/c.md");
    assertTrue("O4: dest file created", fs.existsSync(destAbs));
    if (fs.existsSync(destAbs)) {
      const finalBody = await readRaw(destAbs);
      assertEq("O4: final dest content === source body", finalBody, body);
    }

    const bakAbs = `${destAbs}.bak`;
    assertTrue("O4: <dest>.bak NOT created", !fs.existsSync(bakAbs));

    const replaces = (result && result.history || []).filter(
      (h) => h.event === "replace" && h.step === "file_overwrite"
    );
    assertEq("O4: NO replace/file_overwrite history entry", replaces.length, 0);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseO5SubstitutionAffectsSha() {
  console.log("\n--- Case O5: substituted-source's sha is used (post-{{module_directory}} sub) ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseO5-"));
  try {
    // Source body contains {{module_directory}} token. With module_directory="alpha",
    // post-substitution body is "see beacon/alpha/foo.md\n".
    const sourceBody = "see {{module_directory}}/foo.md\n";
    const expectedSubstituted = "see beacon/alpha/foo.md\n";
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-o5",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-o5",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "alpha",
          files: [{ source: "content/c.md", dest: "{{module_directory}}/c.md" }]
        },
        sourceFiles: [{ relPath: "content/c.md", body: sourceBody }]
      }
    ]);
    // Prime dest with EXACT post-substitution body — should be idempotent.
    const destAbs = path.join(scratch, "beacon/alpha/c.md");
    await fsp.mkdir(path.dirname(destAbs), { recursive: true });
    await fsp.writeFile(destAbs, expectedSubstituted, "utf8");

    const result = await runHarness(scratch);
    assertTrue("O5: platform-installed.json was written", result !== null);

    const finalBody = await readRaw(destAbs);
    assertEq("O5: final dest content === post-substitution body", finalBody, expectedSubstituted);

    const bakAbs = `${destAbs}.bak`;
    assertTrue("O5: <dest>.bak NOT created (idempotent post-substitution)", !fs.existsSync(bakAbs));

    const replaces = (result && result.history || []).filter(
      (h) => h.event === "replace" && h.step === "file_overwrite"
    );
    assertEq("O5: NO replace event (substituted === prior)", replaces.length, 0);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------
// v0.2.0 T1.4: pre_install[] schema with type: "delete" action (P1-P4)
// --------------------------------------------------------------------------

async function caseP1PreInstallDeletesExistingFile() {
  console.log("\n--- Case P1: pre_install delete with existing file → file removed, .pre_install_bak written, delete event ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseP1-"));
  try {
    const oldBody = "old content";
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-p1",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-p1",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "p1",
          pre_install: [
            { type: "delete", path: "foo/legacy.md", reason: "supersession test" }
          ],
          files: []
        }
      }
    ]);
    // Pre-write the legacy file at its consumer-relative path.
    const legacyAbs = path.join(scratch, "foo/legacy.md");
    await fsp.mkdir(path.dirname(legacyAbs), { recursive: true });
    await fsp.writeFile(legacyAbs, oldBody, "utf8");

    const result = await runHarness(scratch);
    assertTrue("P1: platform-installed.json was written", result !== null);

    // Asserts:
    assertTrue("P1: legacy file removed", !fs.existsSync(legacyAbs));

    const bakAbs = path.join(scratch, "foo/legacy.md.pre_install_bak");
    assertTrue("P1: .pre_install_bak file exists", fs.existsSync(bakAbs));
    if (fs.existsSync(bakAbs)) {
      const bakBody = await readRaw(bakAbs);
      assertEq("P1: .pre_install_bak content === prior content", bakBody, oldBody);
    }

    const deletes = (result && result.history || []).filter(
      (h) => h.event === "delete" && h.step === "pre_install_delete"
    );
    assertEq("P1: exactly one delete/pre_install_delete history entry", deletes.length, 1);

    if (deletes.length === 1) {
      const d = deletes[0];
      assertEq("P1: delete entry name === blueprint name", d.name, "test-fixture-p1");
      assertEq("P1: delete entry path === substituted path", d.path, "foo/legacy.md");
      assertEq("P1: delete entry reason preserved", d.reason, "supersession test");
      assertTrue(
        "P1: delete entry prior_sha is 64-char hex string",
        typeof d.prior_sha === "string" && /^[0-9a-f]{64}$/.test(d.prior_sha)
      );
      assertEq("P1: delete entry prior_sha === sha256(old content)", d.prior_sha, sha256(oldBody));
      assertTrue("P1: delete entry bak_path ends with .pre_install_bak", typeof d.bak_path === "string" && d.bak_path.endsWith(".pre_install_bak"));
      assertTrue("P1: delete entry has git_commit field", "git_commit" in d);
      assertTrue("P1: delete entry has git_tag field", "git_tag" in d);
      assertTrue("P1: delete entry has git_dirty field", "git_dirty" in d);
      assertTrue("P1: delete entry has attempted_at field", typeof d.attempted_at === "string");
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseP2PreInstallDeleteAbsentFile() {
  console.log("\n--- Case P2: pre_install delete with absent file → no-op, info skip event ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseP2-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-p2",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-p2",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "p2",
          pre_install: [
            { type: "delete", path: "does/not/exist.md", reason: "absent target" }
          ],
          files: []
        }
      }
    ]);
    // DO NOT pre-create the file.

    const result = await runHarness(scratch);
    assertTrue("P2: platform-installed.json was written", result !== null);

    const targetAbs = path.join(scratch, "does/not/exist.md");
    assertTrue("P2: target file still absent", !fs.existsSync(targetAbs));

    const bakAbs = `${targetAbs}.pre_install_bak`;
    assertTrue("P2: no .pre_install_bak created", !fs.existsSync(bakAbs));

    const skips = (result && result.history || []).filter(
      (h) => h.event === "info" && h.step === "pre_install_delete_skip"
    );
    assertEq("P2: exactly one info/pre_install_delete_skip history entry", skips.length, 1);

    if (skips.length === 1) {
      const s = skips[0];
      assertTrue(
        "P2: skip entry message mentions absent",
        typeof s.message === "string" && /absent/i.test(s.message),
        `message was: ${s.message}`
      );
      assertEq("P2: skip entry name === blueprint", s.name, "test-fixture-p2");
      assertTrue("P2: skip entry has git_commit field", "git_commit" in s);
      assertTrue("P2: skip entry has attempted_at field", typeof s.attempted_at === "string");
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseP3PreInstallDeleteDirectoryTarget() {
  console.log("\n--- Case P3: pre_install delete with directory target → warning skip event, directory untouched ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseP3-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-p3",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-p3",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "p3",
          pre_install: [
            { type: "delete", path: "dir-target", reason: "directory test" }
          ],
          files: []
        }
      }
    ]);
    // Pre-create dir-target/ as a directory containing a sentinel file.
    const dirAbs = path.join(scratch, "dir-target");
    await fsp.mkdir(dirAbs, { recursive: true });
    const sentinelAbs = path.join(dirAbs, "sentinel.md");
    await fsp.writeFile(sentinelAbs, "do not delete me", "utf8");

    const result = await runHarness(scratch);
    assertTrue("P3: platform-installed.json was written", result !== null);

    assertTrue("P3: directory still exists", fs.existsSync(dirAbs) && fs.statSync(dirAbs).isDirectory());
    assertTrue("P3: sentinel file inside directory still exists", fs.existsSync(sentinelAbs));

    const warns = (result && result.history || []).filter(
      (h) => h.event === "warning" && h.step === "pre_install_delete_skip"
    );
    assertEq("P3: exactly one warning/pre_install_delete_skip history entry", warns.length, 1);

    if (warns.length === 1) {
      const w = warns[0];
      assertTrue(
        "P3: warning entry message mentions directory",
        typeof w.message === "string" && /director/i.test(w.message),
        `message was: ${w.message}`
      );
      assertEq("P3: warning entry name === blueprint", w.name, "test-fixture-p3");
      assertTrue("P3: warning entry has git_commit field", "git_commit" in w);
    }

    // No pre_install_bak should be created for a directory target.
    const bakAbs = `${dirAbs}.pre_install_bak`;
    assertTrue("P3: no .pre_install_bak created for directory", !fs.existsSync(bakAbs));
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseP4UnknownTypeWarningOnly() {
  console.log("\n--- Case P4: unknown type → warning, no other side effects ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseP4-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-p4",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-p4",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "p4",
          pre_install: [
            { type: "rename", path: "foo.md", reason: "future schema" }
          ],
          files: []
        }
      }
    ]);
    // Create a file at foo.md to assert it isn't touched.
    const fooAbs = path.join(scratch, "foo.md");
    await fsp.writeFile(fooAbs, "do not touch", "utf8");

    const result = await runHarness(scratch);
    assertTrue("P4: platform-installed.json was written", result !== null);

    assertTrue("P4: foo.md still exists (not touched)", fs.existsSync(fooAbs));
    if (fs.existsSync(fooAbs)) {
      const body = await readRaw(fooAbs);
      assertEq("P4: foo.md content unchanged", body, "do not touch");
    }
    assertTrue("P4: no .pre_install_bak created", !fs.existsSync(`${fooAbs}.pre_install_bak`));

    const warns = (result && result.history || []).filter(
      (h) => h.event === "warning" && h.step === "pre_install_unknown_type"
    );
    assertEq("P4: exactly one warning/pre_install_unknown_type history entry", warns.length, 1);

    if (warns.length === 1) {
      const w = warns[0];
      assertEq("P4: warning entry name === blueprint", w.name, "test-fixture-p4");
      assertEq("P4: warning entry surfaces type", w.type, "rename");
      assertTrue("P4: warning entry has git_commit field", "git_commit" in w);
    }

    // No delete, info-skip, or warning-directory events for this case.
    const otherEvents = (result && result.history || []).filter(
      (h) =>
        h.name === "test-fixture-p4" &&
        (h.step === "pre_install_delete" || h.step === "pre_install_delete_skip")
    );
    assertEq("P4: NO pre_install_delete or pre_install_delete_skip events", otherEvents.length, 0);
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
  await caseM1MissingModuleDirectory();
  await caseM2ModuleDirectoryCollision();
  await caseM3ModuleDirectorySubstitutes();
  await caseM4NoLeakBetweenBlueprints();
  await caseM5MechanismDoesNotReceiveModuleDirectory();
  await caseO1IdenticalContentSkipsOverwrite();
  await caseO2DifferingContentBackupAndReplace();
  await caseO3ZeroByteDestNoBackup();
  await caseO4FreshWriteNoReplace();
  await caseO5SubstitutionAffectsSha();
  await caseP1PreInstallDeletesExistingFile();
  await caseP2PreInstallDeleteAbsentFile();
  await caseP3PreInstallDeleteDirectoryTarget();
  await caseP4UnknownTypeWarningOnly();

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
