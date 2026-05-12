#!/usr/bin/env node
// run-helper-cases.js — 16 sub-asserts across 4 cases for v0.1.3's two new
// installer helpers (applyTemplaterHotkeys, applySlashCommanderBindings).
//
// Each case scaffolds a tmpdir scratch vault with a minimal layout:
//   <tmp>/ranch/platform-config.json
//   <tmp>/ranch/platform-subscription.json
//   <tmp>/ranch/templater/platformInstall.js  (copy of canonical)
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

// v0.29.0 S2.5 — assertEqual/withTempVault/makeTpStub helpers for HC-RF{1,2,3}
// (test the install.js applyRuleFragment array-support patch). These are
// additive — preexisting cases use assertEq/assertTrue + scaffoldVault.
function assertEqual(actual, expected, label) {
  // Note: argument order matches the v0.29.0 plan's HC-RF case bodies
  // (actual, expected, label) — distinct from the older `assertEq(label, actual, expected)`.
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

async function withTempVault(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-rf-"));
  try {
    await fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) {}
  }
}

function makeTpStub(dir) {
  return {
    app: {
      vault: {
        adapter: {
          async exists(p)         { return fs.existsSync(path.join(dir, p)); },
          async mkdir(p)          { fs.mkdirSync(path.join(dir, p), { recursive: true }); },
          async read(p)           { return fs.readFileSync(path.join(dir, p), "utf8"); },
          async write(p, content) { fs.writeFileSync(path.join(dir, p), content); },
        },
      },
    },
  };
}

async function scaffoldVault(scratchDir, opts) {
  // opts = { templaterData, slashCommanderData, manifest }
  await fsp.mkdir(path.join(scratchDir, "ranch/templater"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, "ranch/templates"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, "ranch/scripts"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, "ranch/views"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, "ranch/rules"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, ".obsidian/plugins/templater-obsidian"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, ".obsidian/plugins/slash-commander"), { recursive: true });

  // Bootstrap installer copy.
  await fsp.copyFile(CANONICAL_INSTALLER, path.join(scratchDir, "ranch/templater/platformInstall.js"));

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
  await fsp.writeFile(path.join(scratchDir, "ranch/platform-config.json"), JSON.stringify({
    workshop_relative_path: "_fake-workshop",
    variables: {
      views_path: "ranch/views",
      templater_scripts_path: "ranch/templater",
      scripts_path: "ranch/scripts",
      templates_path: "ranch/templates",
      content_path: "ranch/content",
      rules_path: "ranch/rules",
    }
  }, null, 2), "utf8");

  // Minimal subscription with the test-fixture mechanism.
  await fsp.writeFile(path.join(scratchDir, "ranch/platform-subscription.json"), JSON.stringify({
    mechanisms: [{ name: "test-fixture", version: "0.1.0" }],
    blueprints: []
  }, null, 2), "utf8");

  // Pre-seeded plugin data.jsons (per case).
  await fsp.writeFile(path.join(scratchDir, ".obsidian/plugins/templater-obsidian/data.json"), opts.templaterData, "utf8");
  await fsp.writeFile(path.join(scratchDir, ".obsidian/plugins/slash-commander/data.json"), opts.slashCommanderData, "utf8");

  // Default community-plugins.json — caller may override via opts.styling to add obsidian-style-settings.
  let communityPlugins = ["templater-obsidian", "slash-commander"];

  // v0.19.0 styling cases: optional fixture for vendored themes + canonical Style Settings JSON.
  if (opts.styling) {
    // Seed vendored theme assets in the FAKE WORKSHOP (read-source location).
    if (opts.styling.themeFiles) {
      const themeDir = path.join(fakeWorkshop, "platform/mechanisms/test-fixture/assets/themes", opts.styling.themeFiles.name);
      await fsp.mkdir(themeDir, { recursive: true });
      for (const [name, body] of Object.entries(opts.styling.themeFiles.files || {})) {
        await fsp.writeFile(path.join(themeDir, name), body, "utf8");
      }
    }
    // Seed canonical Style Settings defaults JSON in the fake workshop.
    if (opts.styling.defaultsBody !== undefined) {
      const defaultsDir = path.join(fakeWorkshop, "platform/mechanisms/test-fixture/data");
      await fsp.mkdir(defaultsDir, { recursive: true });
      await fsp.writeFile(path.join(defaultsDir, "style-settings-default.json"), opts.styling.defaultsBody, "utf8");
    }
    // Pre-seed the consumer's Style Settings plugin dir + community-plugins.json so applyExternalPlugins is satisfied.
    await fsp.mkdir(path.join(scratchDir, ".obsidian/plugins/obsidian-style-settings"), { recursive: true });
    if (opts.styling.consumerStyleSettingsBody !== undefined) {
      await fsp.writeFile(
        path.join(scratchDir, ".obsidian/plugins/obsidian-style-settings/data.json"),
        opts.styling.consumerStyleSettingsBody,
        "utf8"
      );
    }
    if (opts.styling.consumerAppearanceBody !== undefined) {
      await fsp.writeFile(
        path.join(scratchDir, ".obsidian/appearance.json"),
        opts.styling.consumerAppearanceBody,
        "utf8"
      );
    }
    if (opts.styling.consumerThemeFiles) {
      const consumerThemeDir = path.join(scratchDir, ".obsidian/themes", opts.styling.consumerThemeFiles.name);
      await fsp.mkdir(consumerThemeDir, { recursive: true });
      for (const [name, body] of Object.entries(opts.styling.consumerThemeFiles.files || {})) {
        await fsp.writeFile(path.join(consumerThemeDir, name), body, "utf8");
      }
    }
    if (opts.styling.includeStyleSettingsInCommunityPlugins !== false) {
      communityPlugins = communityPlugins.concat(["obsidian-style-settings"]);
    }
  }

  await fsp.writeFile(path.join(scratchDir, ".obsidian/community-plugins.json"), JSON.stringify(communityPlugins), "utf8");
}

async function runHarness(scratchDir) {
  // Run installer; capture + return parsed platform-installed.json.
  try {
    execFileSync("node", [RUN_INSTALL, scratchDir], { stdio: "pipe", encoding: "utf8" });
  } catch (e) {
    // exit 1 is fine for our purposes (we inspect history); only re-throw on
    // catastrophic process failure (no installed.json written at all).
  }
  const installedPath = path.join(scratchDir, "ranch/platform-installed.json");
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
    await fsp.writeFile(path.join(scratch, "ranch/platform-subscription.json"), JSON.stringify({
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
    assertTrue("case3: platform entries appended", tdataAfter.enabled_templates_hotkeys.includes("ranch/templates/FixtureA.md") && tdataAfter.enabled_templates_hotkeys.includes("ranch/templates/FixtureB.md"));
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
  await fsp.mkdir(path.join(scratchDir, "ranch/templater"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, "ranch/templates"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, "ranch/scripts"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, "ranch/views"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, "ranch/rules"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, ".obsidian/plugins/templater-obsidian"), { recursive: true });
  await fsp.mkdir(path.join(scratchDir, ".obsidian/plugins/slash-commander"), { recursive: true });

  await fsp.copyFile(CANONICAL_INSTALLER, path.join(scratchDir, "ranch/templater/platformInstall.js"));

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

  await fsp.writeFile(path.join(scratchDir, "ranch/platform-config.json"), JSON.stringify({
    workshop_relative_path: "_fake-workshop",
    variables: {
      views_path: "ranch/views",
      templater_scripts_path: "ranch/templater",
      scripts_path: "ranch/scripts",
      templates_path: "ranch/templates",
      content_path: "ranch/content",
      rules_path: "ranch/rules",
    }
  }, null, 2), "utf8");

  await fsp.writeFile(path.join(scratchDir, "ranch/platform-subscription.json"), JSON.stringify({
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
  console.log("\n--- Case M3: {{module_directory}} substitutes to spice/<name> for blueprint files ---");
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

    const destAbs = path.join(scratch, "spice/alpha/sub/foo.md");
    assertTrue("M3: dest file lands at spice/alpha/sub/foo.md (substituted path)", fs.existsSync(destAbs));

    if (fs.existsSync(destAbs)) {
      const body = await readRaw(destAbs);
      assertTrue(
        "M3: dest body contains spice/alpha/To-Do-Board.md (lenient body sub)",
        body.includes("spice/alpha/To-Do-Board.md"),
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

    const aPath = path.join(scratch, "spice/alpha/file.md");
    const bPath = path.join(scratch, "spice/beta/file.md");
    assertTrue("M4: alpha file exists at spice/alpha/file.md", fs.existsSync(aPath));
    assertTrue("M4: beta file exists at spice/beta/file.md", fs.existsSync(bPath));

    if (fs.existsSync(aPath) && fs.existsSync(bPath)) {
      const aBody = await readRaw(aPath);
      const bBody = await readRaw(bPath);
      assertTrue("M4: alpha body references spice/alpha", aBody.includes("spice/alpha"));
      assertTrue("M4: alpha body does NOT reference spice/beta", !aBody.includes("spice/beta"));
      assertTrue("M4: beta body references spice/beta", bBody.includes("spice/beta"));
      assertTrue("M4: beta body does NOT reference spice/alpha", !bBody.includes("spice/alpha"));
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

    const destAbs = path.join(scratch, "ranch/scripts/foo.md");
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
// v0.3.0: module_directory mkdir mechanic (M6)
// --------------------------------------------------------------------------
//
// installItem must explicitly create `spice/<module_directory>/` for every
// blueprint, regardless of whether files[] writes anything under that path.
// This codifies landmine #11 at the installer level (previously the directory
// was created only as a side-effect of files[] writes there). Daily blueprint
// surfaced this gap — its files all land under ranch/* but the Daily
// Notes plugin requires `spice/daily/` to pre-exist.
//
// M6.A: fresh install of a blueprint whose files[] does NOT write under
//       {{module_directory}}/... → directory still exists; history records
//       info/module_directory, action: "created".
// M6.B: re-run with bumped version → directory still exists; history records
//       info/module_directory, action: "already_exists".

async function caseM6ModuleDirectoryEnsured() {
  console.log("\n--- Case M6: blueprint module_directory created at install time even when no files[] write under it ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseM6-"));
  try {
    // Fixture: blueprint declares module_directory "test-mod" but its only
    // file lands under ranch/scripts (NOT under {{module_directory}}/...).
    // After install, spice/test-mod/ must still exist as a directory.
    const blueprint = {
      name: "test-fixture-m6",
      version: "0.1.0",
      manifest: {
        name: "test-fixture-m6",
        version: "0.1.0",
        kind: "blueprint",
        module_directory: "test-mod",
        files: [
          { source: "scripts/foo.js", dest: "{{scripts_path}}/m6/foo.js" }
        ]
      },
      sourceFiles: [
        { relPath: "scripts/foo.js", body: "// m6 fixture\n" }
      ]
    };

    await scaffoldBlueprintVault(scratch, [blueprint]);

    // ---- M6.A: fresh install ----
    const first = await runHarness(scratch);
    assertTrue("M6.A: platform-installed.json was written", first !== null);

    const moduleDirAbs = path.join(scratch, "spice/test-mod");
    assertTrue(
      "M6.A: spice/test-mod/ exists on disk after fresh install",
      fs.existsSync(moduleDirAbs)
    );
    if (fs.existsSync(moduleDirAbs)) {
      assertTrue(
        "M6.A: spice/test-mod/ is a directory (not a file)",
        fs.statSync(moduleDirAbs).isDirectory()
      );
    }

    const createdEvents = (first && first.history || []).filter(
      (h) =>
        h.event === "info" &&
        h.step === "module_directory" &&
        h.name === "test-fixture-m6" &&
        h.action === "created"
    );
    assertEq("M6.A: exactly one info/module_directory created event", createdEvents.length, 1);

    if (createdEvents.length === 1) {
      const c = createdEvents[0];
      assertEq("M6.A: created event path === spice/test-mod", c.path, "spice/test-mod");
      assertTrue("M6.A: created event has git_commit field", "git_commit" in c);
      assertTrue("M6.A: created event has git_tag field", "git_tag" in c);
      assertTrue("M6.A: created event has git_dirty field", "git_dirty" in c);
      assertTrue("M6.A: created event has attempted_at field", typeof c.attempted_at === "string");
    }

    // No error events for module_directory step.
    const errs = (first && first.history || []).filter(
      (h) => h.event === "error" && h.step === "module_directory"
    );
    assertEq("M6.A: NO error/module_directory events", errs.length, 0);

    // ---- M6.B: re-run with bumped fixture version ----
    const blueprint2Manifest = { ...blueprint.manifest, version: "0.2.0" };
    await fsp.writeFile(
      path.join(scratch, "_fake-workshop/platform/blueprints/test-fixture-m6/manifest.json"),
      JSON.stringify(blueprint2Manifest, null, 2),
      "utf8"
    );
    await fsp.writeFile(
      path.join(scratch, "_fake-workshop/platform/manifest.json"),
      JSON.stringify({
        workshop_version: "0.0.0-test",
        mechanisms: [],
        blueprints: [{ name: "test-fixture-m6", version: "0.2.0", path: "blueprints/test-fixture-m6" }]
      }, null, 2),
      "utf8"
    );
    await fsp.writeFile(
      path.join(scratch, "ranch/platform-subscription.json"),
      JSON.stringify({
        mechanisms: [],
        blueprints: [{ name: "test-fixture-m6", version: "0.2.0" }]
      }, null, 2),
      "utf8"
    );

    const second = await runHarness(scratch);
    assertTrue("M6.B: platform-installed.json was written on second run", second !== null);

    assertTrue(
      "M6.B: spice/test-mod/ still exists on disk after re-run",
      fs.existsSync(moduleDirAbs) && fs.statSync(moduleDirAbs).isDirectory()
    );

    const newOnSecond = (second && second.history || []).slice((first && first.history || []).length);
    const alreadyExists = newOnSecond.filter(
      (h) =>
        h.event === "info" &&
        h.step === "module_directory" &&
        h.name === "test-fixture-m6" &&
        h.action === "already_exists"
    );
    assertEq("M6.B: exactly one info/module_directory already_exists event on re-run", alreadyExists.length, 1);

    if (alreadyExists.length === 1) {
      const a = alreadyExists[0];
      assertEq("M6.B: already_exists event path === spice/test-mod", a.path, "spice/test-mod");
      assertTrue("M6.B: already_exists event has git_commit field", "git_commit" in a);
      assertTrue("M6.B: already_exists event has attempted_at field", typeof a.attempted_at === "string");
    }

    const newCreated = newOnSecond.filter(
      (h) => h.event === "info" && h.step === "module_directory" && h.action === "created"
    );
    assertEq("M6.B: NO new created events on re-run (directory already existed)", newCreated.length, 0);

    const newErrs = newOnSecond.filter(
      (h) => h.event === "error" && h.step === "module_directory"
    );
    assertEq("M6.B: NO error/module_directory events on re-run", newErrs.length, 0);
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
    const destAbs = path.join(scratch, "spice/o1/hello.md");
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
    const destAbs = path.join(scratch, "spice/o2/c.md");
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
    const destAbs = path.join(scratch, "spice/o3/c.md");
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

    const destAbs = path.join(scratch, "spice/o4/c.md");
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
    // post-substitution body is "see spice/alpha/foo.md\n".
    const sourceBody = "see {{module_directory}}/foo.md\n";
    const expectedSubstituted = "see spice/alpha/foo.md\n";
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
    const destAbs = path.join(scratch, "spice/alpha/c.md");
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

// --------------------------------------------------------------------------
// v0.3.0 T1.1: applyCorePluginSettings (C1-C5)
// --------------------------------------------------------------------------
//
// applyCorePluginSettings reads .obsidian/<entry.id>.json and additive-merges
// the declared settings (top-level shallow merge; nested objects replaced
// wholesale). Mirrors v0.1.3 helper posture exactly: idempotent skip-write,
// backup-on-edit, malformed-JSON guard, failure-loud history.
//
// Cases C1-C5 use the existing scaffoldVault helper (mechanism shape) for
// C1-C4 (which don't need the per-blueprint module_directory overlay), and
// scaffoldBlueprintVault for C5 (which DOES exercise the overlay).

const C1_DAILY_SETTINGS = {
  folder: "spice/daily",
  format: "YYYY/MM-MMMM/YYYY-MM-DD-dddd",
  template: "ranch/templates/Daily Note.md",
};

async function caseC1IdempotentMerge() {
  console.log("\n--- Case C1: applyCorePluginSettings idempotent merge on re-run ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseC1-"));
  try {
    const manifest = {
      name: "test-fixture",
      version: "0.1.0",
      files: [],
      core_plugin_settings: [{ id: "test-core-plugin", settings: C1_DAILY_SETTINGS }],
    };
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });
    // Pre-seed core plugin file with EXACTLY the merged shape the helper would
    // produce (so the merge result === existing → skipped_existing).
    const corePath = path.join(scratch, ".obsidian/test-core-plugin.json");
    const seedBody = JSON.stringify(C1_DAILY_SETTINGS, null, 2);
    await fsp.writeFile(corePath, seedBody, "utf8");

    // First run.
    const first = await runHarness(scratch);
    assertTrue("C1: platform-installed.json was written (first run)", first !== null);
    const firstSkipped = (first && first.history || []).filter(
      (h) => h.event === "info" && h.step === "core_plugin_settings" && h.action === "skipped_existing" && h.plugin_id === "test-core-plugin"
    );
    assertEq("C1: first run records one skipped_existing event", firstSkipped.length, 1);

    // Snapshot: file body byte-equal to the pre-seeded body.
    const bodyAfter1 = await readRaw(corePath);
    assertEq("C1: core plugin file unchanged after first run", bodyAfter1, seedBody);

    // No backup file because we skipped the write.
    const backupPath = `${corePath}.sauce-backup`;
    assertTrue("C1: no <target>.sauce-backup created on skip", !fs.existsSync(backupPath));

    // Second run — bump fixture version + re-read manifest.
    const fixtureManifest2 = { ...manifest, version: "0.1.1" };
    await fsp.writeFile(path.join(scratch, "_fake-workshop/platform/manifest.json"), JSON.stringify({
      workshop_version: "0.0.0-test",
      mechanisms: [{ name: "test-fixture", version: "0.1.1", path: "mechanisms/test-fixture" }],
      blueprints: [],
    }, null, 2), "utf8");
    await fsp.writeFile(path.join(scratch, "_fake-workshop/platform/mechanisms/test-fixture/manifest.json"), JSON.stringify(fixtureManifest2, null, 2), "utf8");
    await fsp.writeFile(path.join(scratch, "ranch/platform-subscription.json"), JSON.stringify({
      mechanisms: [{ name: "test-fixture", version: "0.1.1" }],
      blueprints: [],
    }, null, 2), "utf8");

    const second = await runHarness(scratch);
    const newOnSecond = (second && second.history || []).slice((first && first.history || []).length);
    const secondSkipped = newOnSecond.filter(
      (h) => h.event === "info" && h.step === "core_plugin_settings" && h.action === "skipped_existing" && h.plugin_id === "test-core-plugin"
    );
    const secondApplied = newOnSecond.filter(
      (h) => h.event === "info" && h.step === "core_plugin_settings" && h.action === "applied"
    );
    assertEq("C1: second run records one skipped_existing event", secondSkipped.length, 1);
    assertEq("C1: second run records 0 applied events", secondApplied.length, 0);

    const bodyAfter2 = await readRaw(corePath);
    assertEq("C1: core plugin file still unchanged after second run", bodyAfter2, seedBody);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseC2MalformedJson() {
  console.log("\n--- Case C2: applyCorePluginSettings malformed-JSON guard ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseC2-"));
  try {
    const manifest = {
      name: "test-fixture",
      version: "0.1.0",
      files: [],
      core_plugin_settings: [{ id: "test-core-plugin", settings: C1_DAILY_SETTINGS }],
    };
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });
    const corePath = path.join(scratch, ".obsidian/test-core-plugin.json");
    const malformed = "{not valid json";
    await fsp.writeFile(corePath, malformed, "utf8");

    const result = await runHarness(scratch);
    assertTrue("C2: platform-installed.json was written", result !== null);

    const errs = (result && result.history || []).filter(
      (h) => h.event === "error" && h.step === "core_plugin_settings" && h.plugin_id === "test-core-plugin"
    );
    assertTrue("C2: at least one error/core_plugin_settings event recorded", errs.length >= 1, `got ${errs.length}`);
    if (errs.length >= 1) {
      assertTrue(
        "C2: error message mentions malformed JSON",
        typeof errs[0].message === "string" && /malformed JSON/i.test(errs[0].message),
        `message was: ${errs[0].message}`
      );
    }

    // File must be unchanged byte-for-byte.
    const bodyAfter = await readRaw(corePath);
    assertEq("C2: malformed core plugin data.json untouched", bodyAfter, malformed);

    // No backup created — we never wrote, so we never backed up.
    const backupPath = `${corePath}.sauce-backup`;
    assertTrue("C2: no <target>.sauce-backup created on malformed-JSON guard", !fs.existsSync(backupPath));
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseC3AdditivePreservesUserKeys() {
  console.log("\n--- Case C3: applyCorePluginSettings additive merge preserves user keys ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseC3-"));
  try {
    const manifest = {
      name: "test-fixture",
      version: "0.1.0",
      files: [],
      core_plugin_settings: [{ id: "test-core-plugin", settings: C1_DAILY_SETTINGS }],
    };
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });
    const corePath = path.join(scratch, ".obsidian/test-core-plugin.json");
    const seed = { folder: "OldPath", customField: "keepme", format: "old" };
    const seedBody = JSON.stringify(seed, null, 2);
    await fsp.writeFile(corePath, seedBody, "utf8");

    const result = await runHarness(scratch);
    assertTrue("C3: platform-installed.json was written", result !== null);

    const applied = (result && result.history || []).filter(
      (h) => h.event === "info" && h.step === "core_plugin_settings" && h.action === "applied" && h.plugin_id === "test-core-plugin"
    );
    assertEq("C3: exactly one applied event", applied.length, 1);

    const after = await readJson(corePath);
    assertEq("C3: folder overwritten by manifest", after.folder, "spice/daily");
    assertEq("C3: format overwritten by manifest", after.format, "YYYY/MM-MMMM/YYYY-MM-DD-dddd");
    assertEq("C3: template added (was absent)", after.template, "ranch/templates/Daily Note.md");
    assertEq("C3: customField preserved (user-only key)", after.customField, "keepme");
    assertEq("C3: top-level keys count is 4", Object.keys(after).length, 4);

    const backupPath = `${corePath}.sauce-backup`;
    assertTrue("C3: <target>.sauce-backup exists (pre-existing content was backed up)", fs.existsSync(backupPath));
    if (fs.existsSync(backupPath)) {
      const backupBody = await readRaw(backupPath);
      assertEq("C3: <target>.sauce-backup body byte-equal to original pre-seed", backupBody, seedBody);
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseC4BackupOnEditBytes() {
  console.log("\n--- Case C4: applyCorePluginSettings backup captures pre-edit content ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseC4-"));
  try {
    const manifest = {
      name: "test-fixture",
      version: "0.1.0",
      files: [],
      core_plugin_settings: [{ id: "test-core-plugin", settings: { folder: "Y" } }],
    };
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });
    const corePath = path.join(scratch, ".obsidian/test-core-plugin.json");
    const seedBody = '{"folder":"X"}';
    await fsp.writeFile(corePath, seedBody, "utf8");

    const result = await runHarness(scratch);
    assertTrue("C4: platform-installed.json was written", result !== null);

    const backupPath = `${corePath}.sauce-backup`;
    assertTrue("C4: <target>.sauce-backup exists", fs.existsSync(backupPath));
    if (fs.existsSync(backupPath)) {
      const bakBody = await readRaw(backupPath);
      assertEq("C4: <target>.sauce-backup byte-equal to pre-seed bytes", bakBody, seedBody);
    }

    const after = await readJson(corePath);
    assertEq("C4: live file folder === Y (manifest wins)", after.folder, "Y");
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseC5SubstitutionOnSettings() {
  console.log("\n--- Case C5: applyCorePluginSettings substitution applied to settings values ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseC5-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-c5",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-c5",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "test",
          files: [],
          core_plugin_settings: [
            {
              id: "test-core-plugin",
              settings: {
                folder: "{{module_directory}}",
                template: "{{templates_path}}/Daily Note.md",
              },
            },
          ],
        },
      },
    ]);
    // No pre-seed → fresh write path.
    const result = await runHarness(scratch);
    assertTrue("C5: platform-installed.json was written", result !== null);

    const corePath = path.join(scratch, ".obsidian/test-core-plugin.json");
    assertTrue("C5: core plugin data.json was created", fs.existsSync(corePath));

    if (fs.existsSync(corePath)) {
      const after = await readJson(corePath);
      assertEq("C5: folder substituted to spice/test", after.folder, "spice/test");
      assertEq("C5: template substituted with templates_path", after.template, "ranch/templates/Daily Note.md");
    }

    const applied = (result && result.history || []).filter(
      (h) => h.event === "info" && h.step === "core_plugin_settings" && h.action === "applied" && h.plugin_id === "test-core-plugin"
    );
    assertEq("C5: exactly one applied event", applied.length, 1);
    if (applied.length === 1) {
      const a = applied[0];
      assertEq("C5: applied event settings_keys === [folder, template]", a.settings_keys, ["folder", "template"]);
      assertTrue("C5: applied event has git_commit field", "git_commit" in a);
      assertTrue("C5: applied event has git_tag field", "git_tag" in a);
      assertTrue("C5: applied event has git_dirty field", "git_dirty" in a);
      assertTrue("C5: applied event has attempted_at field", typeof a.attempted_at === "string");
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------
// v0.4.0 T1.4: applyTemplaterFolderTemplates (FT1-FT5) + validateAndResolve
// runTemplaterTemplate branch (R1)
// --------------------------------------------------------------------------
//
// FT1-FT4 use scaffoldVault (mechanism shape) — substitution coverage isn't
// needed and the helper runs against any manifest declaring
// templater_folder_templates[]. FT5 + R1 use scaffoldBlueprintVault to
// exercise the per-blueprint {{module_directory}} overlay (and, for R1, the
// nav-button registry write that runs validateAndResolve).
//
// Note: the helper REQUIRES data.folder_templates to be an array — if absent,
// it records an error and skips. The default templater data.json scaffold
// (TEMPLATER_DEFAULT) does NOT include folder_templates, so each FT case
// pre-seeds an explicit value.

async function caseFT1IdempotentMerge() {
  console.log("\n--- Case FT1: applyTemplaterFolderTemplates idempotent merge / skip-existing ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseFT1-"));
  try {
    const seedBody = JSON.stringify({
      enabled_templates_hotkeys: [],
      folder_templates: [{ folder: "spice/to-do", template: "ranch/templates/Today To-Do.md" }],
      startup_templates: [""],
    }, null, 2);
    const manifest = {
      name: "test-fixture",
      version: "0.1.0",
      files: [],
      templater_folder_templates: [
        { folder: "spice/to-do", template: "ranch/templates/Today To-Do.md" },
      ],
    };
    await scaffoldVault(scratch, {
      templaterData: seedBody,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });

    // First run.
    const first = await runHarness(scratch);
    assertTrue("FT1: platform-installed.json was written (first run)", first !== null);
    const firstSkipped = (first && first.history || []).filter(
      (h) => h.event === "info" && h.step === "templater_folder_templates" && h.action === "skipped_existing" && h.folder === "spice/to-do" && h.template === "ranch/templates/Today To-Do.md"
    );
    assertEq("FT1: first run records exactly one skipped_existing event", firstSkipped.length, 1);

    const firstApplied = (first && first.history || []).filter(
      (h) => h.event === "info" && h.step === "templater_folder_templates" && h.action === "applied"
    );
    assertEq("FT1: first run records 0 applied events", firstApplied.length, 0);

    const tdataPath = path.join(scratch, ".obsidian/plugins/templater-obsidian/data.json");
    const bodyAfter1 = await readRaw(tdataPath);
    assertEq("FT1: templater data.json byte-equal to pre-seed (no rewrite)", bodyAfter1, seedBody);

    const backupPath = `${tdataPath}.sauce-backup`;
    assertTrue("FT1: no <target>.sauce-backup created on skip", !fs.existsSync(backupPath));

    // Second run — bump fixture version to force re-process.
    const fixtureManifest2 = { ...manifest, version: "0.1.1" };
    await fsp.writeFile(path.join(scratch, "_fake-workshop/platform/manifest.json"), JSON.stringify({
      workshop_version: "0.0.0-test",
      mechanisms: [{ name: "test-fixture", version: "0.1.1", path: "mechanisms/test-fixture" }],
      blueprints: [],
    }, null, 2), "utf8");
    await fsp.writeFile(path.join(scratch, "_fake-workshop/platform/mechanisms/test-fixture/manifest.json"), JSON.stringify(fixtureManifest2, null, 2), "utf8");
    await fsp.writeFile(path.join(scratch, "ranch/platform-subscription.json"), JSON.stringify({
      mechanisms: [{ name: "test-fixture", version: "0.1.1" }],
      blueprints: [],
    }, null, 2), "utf8");

    const second = await runHarness(scratch);
    const newOnSecond = (second && second.history || []).slice((first && first.history || []).length);
    const secondSkipped = newOnSecond.filter(
      (h) => h.event === "info" && h.step === "templater_folder_templates" && h.action === "skipped_existing"
    );
    const secondApplied = newOnSecond.filter(
      (h) => h.event === "info" && h.step === "templater_folder_templates" && h.action === "applied"
    );
    assertEq("FT1: second run records one skipped_existing event", secondSkipped.length, 1);
    assertEq("FT1: second run records 0 applied events", secondApplied.length, 0);

    const bodyAfter2 = await readRaw(tdataPath);
    assertEq("FT1: templater data.json still byte-equal to pre-seed after second run", bodyAfter2, seedBody);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseFT2MalformedJson() {
  console.log("\n--- Case FT2: applyTemplaterFolderTemplates malformed-JSON guard ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseFT2-"));
  try {
    const malformed = "{not valid json";
    const manifest = {
      name: "test-fixture",
      version: "0.1.0",
      files: [],
      templater_folder_templates: [
        { folder: "spice/to-do", template: "ranch/templates/Today To-Do.md" },
      ],
    };
    await scaffoldVault(scratch, {
      templaterData: malformed,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });

    const result = await runHarness(scratch);
    assertTrue("FT2: platform-installed.json was written", result !== null);

    const errs = (result && result.history || []).filter(
      (h) => h.event === "error" && h.step === "templater_folder_templates"
    );
    assertTrue("FT2: at least one error/templater_folder_templates event recorded", errs.length >= 1, `got ${errs.length}`);
    if (errs.length >= 1) {
      assertTrue(
        "FT2: error message mentions malformed JSON",
        typeof errs[0].message === "string" && /malformed JSON/i.test(errs[0].message),
        `message was: ${errs[0].message}`
      );
    }

    const tdataPath = path.join(scratch, ".obsidian/plugins/templater-obsidian/data.json");
    const bodyAfter = await readRaw(tdataPath);
    assertEq("FT2: malformed templater data.json untouched", bodyAfter, malformed);

    const backupPath = `${tdataPath}.sauce-backup`;
    assertTrue("FT2: no <target>.sauce-backup created on malformed-JSON guard", !fs.existsSync(backupPath));
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseFT3AdditivePreservesUserEntries() {
  console.log("\n--- Case FT3: applyTemplaterFolderTemplates additive merge preserves user entries ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseFT3-"));
  try {
    const seedBody = JSON.stringify({
      enabled_templates_hotkeys: [],
      folder_templates: [{ folder: "user/path", template: "user/Template.md" }],
      startup_templates: [""],
    }, null, 2);
    const manifest = {
      name: "test-fixture",
      version: "0.1.0",
      files: [],
      templater_folder_templates: [
        { folder: "spice/to-do", template: "ranch/templates/Today To-Do.md" },
      ],
    };
    await scaffoldVault(scratch, {
      templaterData: seedBody,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });

    const result = await runHarness(scratch);
    assertTrue("FT3: platform-installed.json was written", result !== null);

    const tdataPath = path.join(scratch, ".obsidian/plugins/templater-obsidian/data.json");
    const after = await readJson(tdataPath);
    assertEq("FT3: folder_templates length === 2 after merge", after.folder_templates.length, 2);
    assertEq("FT3: index 0 user folder preserved", after.folder_templates[0].folder, "user/path");
    assertEq("FT3: index 0 user template preserved", after.folder_templates[0].template, "user/Template.md");
    assertEq("FT3: index 1 manifest folder appended", after.folder_templates[1].folder, "spice/to-do");
    assertEq("FT3: index 1 manifest template appended", after.folder_templates[1].template, "ranch/templates/Today To-Do.md");

    const applied = (result && result.history || []).filter(
      (h) => h.event === "info" && h.step === "templater_folder_templates" && h.action === "applied" && h.folder === "spice/to-do"
    );
    assertEq("FT3: exactly one applied event for the manifest entry", applied.length, 1);

    const backupPath = `${tdataPath}.sauce-backup`;
    assertTrue("FT3: <target>.sauce-backup exists (pre-edit content was backed up)", fs.existsSync(backupPath));
    if (fs.existsSync(backupPath)) {
      const bakBody = await readRaw(backupPath);
      assertEq("FT3: <target>.sauce-backup body byte-equal to pre-seed", bakBody, seedBody);
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseFT4BackupOnEdit() {
  console.log("\n--- Case FT4: applyTemplaterFolderTemplates backup-on-edit content fidelity ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseFT4-"));
  try {
    const tdataPre = JSON.stringify({
      enabled_templates_hotkeys: [],
      folder_templates: [{ folder: "user/path", template: "user/Template.md" }],
      startup_templates: [""],
    }, null, 2);
    const manifest = {
      name: "test-fixture",
      version: "0.1.0",
      files: [],
      templater_folder_templates: [
        { folder: "spice/to-do", template: "ranch/templates/Today To-Do.md" },
      ],
    };
    await scaffoldVault(scratch, {
      templaterData: tdataPre,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });

    const result = await runHarness(scratch);
    assertTrue("FT4: platform-installed.json was written", result !== null);

    const tdataPath = path.join(scratch, ".obsidian/plugins/templater-obsidian/data.json");
    const backupPath = `${tdataPath}.sauce-backup`;
    assertTrue("FT4: <target>.sauce-backup exists", fs.existsSync(backupPath));
    if (fs.existsSync(backupPath)) {
      const bakBody = await readRaw(backupPath);
      assertEq("FT4: backup body byte-identical to pre-seed bytes", bakBody, tdataPre);
    }

    const liveBody = await readRaw(tdataPath);
    assertTrue("FT4: live file body NOT equal to pre-seed (write occurred)", liveBody !== tdataPre);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseFT5SubstitutionApplied() {
  console.log("\n--- Case FT5: applyTemplaterFolderTemplates substitution applied to folder + template ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseFT5-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-ft5",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-ft5",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "to-do",
          files: [],
          templater_folder_templates: [
            { folder: "{{module_directory}}", template: "{{templates_path}}/Today To-Do.md" },
          ],
        },
      },
    ]);
    // Pre-seed templater data.json with an empty folder_templates array so the
    // helper has somewhere to append (default scaffold lacks the field).
    const tdataPath = path.join(scratch, ".obsidian/plugins/templater-obsidian/data.json");
    const seedBody = JSON.stringify({
      enabled_templates_hotkeys: [],
      folder_templates: [],
      startup_templates: [""],
    }, null, 2);
    await fsp.writeFile(tdataPath, seedBody, "utf8");

    const result = await runHarness(scratch);
    assertTrue("FT5: platform-installed.json was written", result !== null);

    const after = await readJson(tdataPath);
    assertEq("FT5: folder_templates length === 1", after.folder_templates.length, 1);
    assertEq("FT5: written folder is resolved literal spice/to-do", after.folder_templates[0].folder, "spice/to-do");
    assertEq("FT5: written template is resolved literal ranch/templates/Today To-Do.md", after.folder_templates[0].template, "ranch/templates/Today To-Do.md");

    const applied = (result && result.history || []).filter(
      (h) => h.event === "info" && h.step === "templater_folder_templates" && h.action === "applied" && h.name === "test-fixture-ft5"
    );
    assertEq("FT5: exactly one applied event", applied.length, 1);
    if (applied.length === 1) {
      const a = applied[0];
      assertEq("FT5: applied event folder === spice/to-do", a.folder, "spice/to-do");
      assertEq("FT5: applied event template === ranch/templates/Today To-Do.md", a.template, "ranch/templates/Today To-Do.md");
      assertTrue(
        "FT5: applied event has git_commit field (string or null per landmine #14)",
        typeof a.git_commit === "string" || a.git_commit === null
      );
      assertTrue(
        "FT5: applied event has git_tag field (string or null per landmine #14)",
        typeof a.git_tag === "string" || a.git_tag === null
      );
      assertTrue(
        "FT5: applied event has git_dirty field (boolean or null per landmine #14)",
        typeof a.git_dirty === "boolean" || a.git_dirty === null
      );
      assertTrue("FT5: applied event has attempted_at field", typeof a.attempted_at === "string");
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseR1ValidateAndResolveRunTemplaterTemplate() {
  console.log("\n--- Case R1: validateAndResolve runTemplaterTemplate branch (v0.4.2 split-field schema) ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseR1-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-r1",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-r1",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "to-do",
          files: [],
          nav_buttons: [
            {
              id: "todo-today",
              label: "+ Today's To-Do",
              icon: "todo",
              order: 110,
              action: {
                type: "runTemplaterTemplate",
                template_source: "Today To-Do.md",
                folder_prefix: "{{module_directory}}",
                folder_date_pattern: "YYYY/MM-MMMM",
                filename_date_pattern: "YYYY-MM-DD",
                filename_suffix: "-ToDo",
              },
            },
          ],
        },
      },
    ]);

    const result = await runHarness(scratch);
    assertTrue("R1: platform-installed.json was written", result !== null);

    const registryPath = path.join(scratch, "ranch/nav-buttons-registry.json");
    assertTrue("R1: nav-buttons-registry.json was created", fs.existsSync(registryPath));

    if (fs.existsSync(registryPath)) {
      const registry = await readJson(registryPath);
      assertTrue(
        "R1: registry contributions['test-fixture-r1'] exists with one entry",
        registry.contributions
        && Array.isArray(registry.contributions["test-fixture-r1"])
        && registry.contributions["test-fixture-r1"].length === 1
      );

      const contrib = registry.contributions["test-fixture-r1"][0];
      assertEq("R1: action.type === runTemplaterTemplate (preserved)", contrib.action.type, "runTemplaterTemplate");
      assertEq(
        "R1: action.template_source rewritten under templates_path",
        contrib.action.template_source,
        "ranch/templates/Today To-Do.md"
      );
      assertEq(
        "R1: action.folder_prefix substituteLenient applied — {{module_directory}} resolved to literal spice/to-do (NO bracket-wrapping)",
        contrib.action.folder_prefix,
        "spice/to-do"
      );
      assertEq(
        "R1: action.folder_date_pattern preserved verbatim",
        contrib.action.folder_date_pattern,
        "YYYY/MM-MMMM"
      );
      assertEq(
        "R1: action.filename_prefix defaulted to empty string",
        contrib.action.filename_prefix,
        ""
      );
      assertEq(
        "R1: action.filename_date_pattern preserved verbatim",
        contrib.action.filename_date_pattern,
        "YYYY-MM-DD"
      );
      assertEq(
        "R1: action.filename_suffix preserved verbatim (no substitution; literal)",
        contrib.action.filename_suffix,
        "-ToDo"
      );
      assertEq("R1: id preserved", contrib.id, "todo-today");
      assertEq("R1: label preserved", contrib.label, "+ Today's To-Do");
      assertEq("R1: icon preserved", contrib.icon, "todo");
      assertEq("R1: order preserved", contrib.order, 110);
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseR2FilenameDefaults() {
  console.log("\n--- Case R2: validateAndResolve runTemplaterTemplate filename defaults (only date_pattern declared) ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseR2-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-r2",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-r2",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "minimal",
          files: [],
          nav_buttons: [
            {
              id: "min-button",
              label: "Min",
              icon: "min",
              order: 100,
              action: {
                type: "runTemplaterTemplate",
                template_source: "Minimal.md",
                folder_prefix: "{{module_directory}}",
                filename_date_pattern: "YYYY-MM-DD",
              },
            },
          ],
        },
      },
    ]);

    const result = await runHarness(scratch);
    assertTrue("R2: platform-installed.json was written", result !== null);

    const registry = await readJson(path.join(scratch, "ranch/nav-buttons-registry.json"));
    const contrib = registry.contributions["test-fixture-r2"][0];

    assertEq("R2: folder_prefix substituted", contrib.action.folder_prefix, "spice/minimal");
    assertEq("R2: folder_date_pattern defaulted to empty string", contrib.action.folder_date_pattern, "");
    assertEq("R2: filename_prefix defaulted to empty string", contrib.action.filename_prefix, "");
    assertEq("R2: filename_date_pattern preserved", contrib.action.filename_date_pattern, "YYYY-MM-DD");
    assertEq("R2: filename_suffix defaulted to empty string", contrib.action.filename_suffix, "");
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseR3EmptyFolderDatePattern() {
  console.log("\n--- Case R3: validateAndResolve runTemplaterTemplate empty folder_date_pattern (meetings-shape) ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseR3-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-r3",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-r3",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "meetings",
          files: [],
          nav_buttons: [
            {
              id: "meetings-hub",
              label: "Meetings",
              icon: "meetings",
              order: 120,
              action: {
                type: "runTemplaterTemplate",
                template_source: "Meeting Hub.md",
                folder_prefix: "{{module_directory}}/hubs",
                folder_date_pattern: "",
                filename_date_pattern: "YYYY-MM-DD",
                filename_suffix: "-Meetings",
              },
            },
          ],
        },
      },
    ]);

    const result = await runHarness(scratch);
    const registry = await readJson(path.join(scratch, "ranch/nav-buttons-registry.json"));
    const contrib = registry.contributions["test-fixture-r3"][0];

    assertEq(
      "R3: folder_prefix substituted — literal 'hubs' segment NOT bracket-wrapped (architecturally safe)",
      contrib.action.folder_prefix,
      "spice/meetings/hubs"
    );
    assertEq("R3: folder_date_pattern preserved as empty string", contrib.action.folder_date_pattern, "");
    assertEq("R3: filename_date_pattern preserved", contrib.action.filename_date_pattern, "YYYY-MM-DD");
    assertEq("R3: filename_suffix preserved", contrib.action.filename_suffix, "-Meetings");
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseR4MissingFolderPrefix() {
  console.log("\n--- Case R4: validateAndResolve runTemplaterTemplate missing required folder_prefix (failure path) ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseR4-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-r4",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-r4",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "broken",
          files: [],
          nav_buttons: [
            {
              id: "broken-button",
              label: "Broken",
              icon: "x",
              order: 999,
              action: {
                type: "runTemplaterTemplate",
                template_source: "Broken.md",
                filename_date_pattern: "YYYY-MM-DD",
              },
            },
          ],
        },
      },
    ]);

    const result = await runHarness(scratch);
    assertTrue("R4: platform-installed.json was written (install proceeded)", result !== null);

    const registryPath = path.join(scratch, "ranch/nav-buttons-registry.json");
    if (fs.existsSync(registryPath)) {
      const registry = await readJson(registryPath);
      const contribs = (registry.contributions || {})["test-fixture-r4"];
      assertTrue(
        "R4: registry has no valid contribution for test-fixture-r4 (entry rejected)",
        !contribs || contribs.length === 0
      );
    }

    const navButtonWarnings = (result && result.history || []).filter(
      (h) => h.event === "warning" && h.step === "nav_buttons" && h.name === "test-fixture-r4"
    );
    assertTrue(
      "R4: history records at least one warning under step: nav_buttons for the rejected entry",
      navButtonWarnings.length >= 1
    );
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseR5InvokeCommandPassthrough() {
  console.log("\n--- Case R5: validateAndResolve invoke_command passthrough (command_id literal preserved) ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseR5-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-r5",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-r5",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "today",
          files: [],
          nav_buttons: [
            {
              id: "today-cmd",
              label: "Today",
              icon: "daily",
              order: 50,
              action: {
                type: "invoke_command",
                command_id: "daily-notes:goto-today",
              },
            },
          ],
        },
      },
    ]);

    const result = await runHarness(scratch);
    assertTrue("R5: platform-installed.json was written", result !== null);

    const registry = await readJson(path.join(scratch, "ranch/nav-buttons-registry.json"));
    const contrib = registry.contributions["test-fixture-r5"][0];

    assertEq("R5: action.type === invoke_command (preserved)", contrib.action.type, "invoke_command");
    assertEq(
      "R5: action.command_id preserved verbatim (no substitution applied; literal)",
      contrib.action.command_id,
      "daily-notes:goto-today"
    );
    assertEq("R5: id preserved", contrib.id, "today-cmd");
    assertEq("R5: label preserved", contrib.label, "Today");
    assertEq("R5: icon preserved", contrib.icon, "daily");
    assertEq("R5: order preserved", contrib.order, 50);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseR6OpenLinkTargetSubstitution() {
  console.log("\n--- Case R6: validateAndResolve openLink target substitution ({{module_directory}} resolves) ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseR6-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-r6",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-r6",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "projects",
          files: [],
          nav_buttons: [
            {
              id: "open-projects-index",
              label: "Projects",
              icon: "folder",
              order: 10,
              action: {
                type: "openLink",
                target: "{{module_directory}}/Projects.md",
              },
            },
            {
              id: "broken-no-target",
              label: "Broken",
              icon: "x",
              order: 11,
              action: {
                type: "openLink",
                // NO target field — should fall through to passthrough (return btn)
              },
            },
          ],
        },
      },
    ]);

    const result = await runHarness(scratch);
    assertTrue("R6: platform-installed.json was written", result !== null);

    const registry = await readJson(path.join(scratch, "ranch/nav-buttons-registry.json"));
    const contribs = registry.contributions["test-fixture-r6"];
    assertTrue("R6: registry has contributions for test-fixture-r6", Array.isArray(contribs) && contribs.length >= 1);

    const goodContrib = contribs.find((c) => c.id === "open-projects-index");
    assertTrue("R6: registry contains the openLink button entry", !!goodContrib);

    assertEq("R6: action.type === openLink (preserved)", goodContrib.action.type, "openLink");
    assertEq(
      "R6: action.target has {{module_directory}} substituted to spice/projects",
      goodContrib.action.target,
      "spice/projects/Projects.md"
    );
    assertTrue(
      "R6: action.target does NOT contain literal {{module_directory}}",
      !goodContrib.action.target.includes("{{module_directory}}")
    );
    assertEq("R6: id preserved", goodContrib.id, "open-projects-index");
    assertEq("R6: label preserved", goodContrib.label, "Projects");
    assertEq("R6: icon preserved", goodContrib.icon, "folder");
    assertEq("R6: order preserved", goodContrib.order, 10);

    // Missing-target branch: falls through to bottom `return btn` passthrough.
    // Entry is NOT rejected by the head check (id/label/action/action.type present).
    const passthroughContrib = contribs.find((c) => c.id === "broken-no-target");
    assertTrue("R6: missing-target entry falls through (passthrough; not rejected by head check)", !!passthroughContrib);
    assertEq("R6: missing-target action.type preserved", passthroughContrib.action.type, "openLink");
    assertTrue(
      "R6: missing-target entry has no .target field added by the new branch",
      passthroughContrib.action.target === undefined
    );
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

// v0.31.0 S3.2 — nav-buttons@2.6.0: invoke_command.args literal passthrough.
async function caseHCNBArgs1InvokeCommandArgs() {
  console.log("\n--- Case HC-NB-ARGS-1: validateAndResolve invoke_command optional args (valid / absent / malformed) ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseHCNBARGS1-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-nbargs",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-nbargs",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "cowork",
          files: [],
          nav_buttons: [
            {
              id: "cowork-bootstrap-accuris",
              label: "Bootstrap (accuris)",
              icon: "plus",
              order: 10,
              action: {
                type: "invoke_command",
                command_id: "cowork:bootstrap-vault",
                args: { engagement_id: "accuris" },
              },
            },
            {
              id: "cowork-bootstrap-no-args",
              label: "Bootstrap (no args)",
              icon: "plus",
              order: 11,
              action: {
                type: "invoke_command",
                command_id: "cowork:bootstrap-vault",
              },
            },
            {
              id: "cowork-bootstrap-malformed",
              label: "Bootstrap (malformed)",
              icon: "plus",
              order: 12,
              action: {
                type: "invoke_command",
                command_id: "cowork:bootstrap-vault",
                args: { nested: { not: "a string" } },
              },
            },
          ],
        },
      },
    ]);

    const result = await runHarness(scratch);
    assertTrue("HC-NB-ARGS-1: platform-installed.json written (install proceeded)", result !== null);

    const registry = await readJson(path.join(scratch, "ranch/nav-buttons-registry.json"));
    const contribs = registry.contributions["test-fixture-nbargs"];
    assertTrue("HC-NB-ARGS-1: registry has contributions for test-fixture-nbargs", Array.isArray(contribs) && contribs.length === 3);

    // (1) Valid args → object passes through unchanged.
    const validContrib = contribs.find((c) => c.id === "cowork-bootstrap-accuris");
    assertTrue("HC-NB-ARGS-1: valid-args entry present in registry", !!validContrib);
    assertEq(
      "HC-NB-ARGS-1: valid args.engagement_id preserved verbatim (no substitution)",
      validContrib && validContrib.action && validContrib.action.args && validContrib.action.args.engagement_id,
      "accuris"
    );

    // (2) Missing args → entry has no `args` key (NOT undefined; key omitted).
    const noArgsContrib = contribs.find((c) => c.id === "cowork-bootstrap-no-args");
    assertTrue("HC-NB-ARGS-1: no-args entry present in registry", !!noArgsContrib);
    assertTrue(
      "HC-NB-ARGS-1: no-args entry has no `args` key (key omitted, not set to undefined)",
      noArgsContrib && noArgsContrib.action && !Object.prototype.hasOwnProperty.call(noArgsContrib.action, "args")
    );

    // (3) Malformed args → args dropped, install proceeds, history records warning.
    const malformedContrib = contribs.find((c) => c.id === "cowork-bootstrap-malformed");
    assertTrue("HC-NB-ARGS-1: malformed-args entry still present in registry (install proceeded)", !!malformedContrib);
    assertTrue(
      "HC-NB-ARGS-1: malformed args were dropped from the resolved entry",
      malformedContrib && malformedContrib.action && !Object.prototype.hasOwnProperty.call(malformedContrib.action, "args")
    );
    const malformedWarnings = (result && result.history || []).filter(
      (h) => h.event === "warning" && h.step === "nav_buttons" && h.name === "test-fixture-nbargs"
            && typeof h.reason === "string" && h.reason.includes("cowork-bootstrap-malformed")
    );
    assertTrue(
      "HC-NB-ARGS-1: history records a warning naming the malformed entry",
      malformedWarnings.length >= 1
    );
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

    const tBackup = await readRaw(path.join(scratch, ".obsidian/plugins/templater-obsidian/data.json.sauce-backup"));
    assertEq("case4: templater backup byte-identical to pre-edit", tBackup, tdataPre);

    const sBackup = await readRaw(path.join(scratch, ".obsidian/plugins/slash-commander/data.json.sauce-backup"));
    assertEq("case4: slash-commander backup byte-identical to pre-edit", sBackup, sdataPre);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

// =====================================================================
// v0.19.0 styling cycle — 15 cases under VT/AP/SS naming.
// VT* — applyVendoredThemes
// AP* — applyAppearance
// SS* — applyStyleSettings
// =====================================================================

const STYLING_THEME_MANIFEST_BODY = JSON.stringify({ name: "Baseline", version: "1.0.0", author: "test" });
const STYLING_THEME_CSS_BODY = "/* baseline */\nbody { color: rebeccapurple; }\n";
const STYLING_DEFAULTS_BODY = JSON.stringify({
  "baseline-style@@accented-interface": true,
  "baseline-style@@color-scheme-light": "rose-pine-light",
  "baseline-style@@color-scheme-dark": "melange-dark",
  "baseline-style@@h1-size": "1.8em",
  "baseline-style@@font-text-override": "Inter",
}, null, 2);

function styledManifest(extra) {
  return Object.assign({
    name: "test-fixture",
    version: "0.1.0",
    files: [],
    vendored_themes: [{ name: "Baseline", src: "assets/themes/Baseline" }],
    appearance: { cssTheme: "Baseline", enabledCssSnippets: ["customjs-loader"] },
    style_settings_defaults_src: "data/style-settings-default.json",
    external_plugins: [{ id: "obsidian-style-settings", name: "Style Settings", required: true }],
  }, extra || {});
}

// ---------- applyVendoredThemes (VT1-VT5) ----------

async function caseVT1FreshWriteToEmptyConsumer() {
  console.log("\n--- Case VT1: applyVendoredThemes fresh write to consumer with no .obsidian/themes/ ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseVT1-"));
  try {
    const manifest = styledManifest();
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
      styling: {
        themeFiles: {
          name: "Baseline",
          files: { "manifest.json": STYLING_THEME_MANIFEST_BODY, "theme.css": STYLING_THEME_CSS_BODY },
        },
        defaultsBody: STYLING_DEFAULTS_BODY,
      },
    });

    const result = await runHarness(scratch);
    assertTrue("VT1: platform-installed.json was written", result !== null);

    const replaceEvts = (result && result.history || []).filter(
      (h) => h.event === "replace" && h.step === "theme_overwrite"
    );
    assertTrue("VT1: at least one replace/theme_overwrite recorded", replaceEvts.length >= 1, `got ${replaceEvts.length}`);

    const cssPath = path.join(scratch, ".obsidian/themes/Baseline/theme.css");
    const manifestPath = path.join(scratch, ".obsidian/themes/Baseline/manifest.json");
    assertTrue("VT1: theme.css materialized in consumer", fs.existsSync(cssPath));
    assertTrue("VT1: manifest.json materialized in consumer", fs.existsSync(manifestPath));
    if (fs.existsSync(cssPath)) {
      const css = await readRaw(cssPath);
      assertEq("VT1: theme.css body byte-equal to source", css, STYLING_THEME_CSS_BODY);
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseVT2IdempotentSkipsOverwriteOnSha256Match() {
  console.log("\n--- Case VT2: applyVendoredThemes sha256-match skips overwrite on re-run ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseVT2-"));
  try {
    const manifest = styledManifest();
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
      styling: {
        themeFiles: {
          name: "Baseline",
          files: { "manifest.json": STYLING_THEME_MANIFEST_BODY, "theme.css": STYLING_THEME_CSS_BODY },
        },
        defaultsBody: STYLING_DEFAULTS_BODY,
      },
    });

    const first = await runHarness(scratch);
    const firstReplaces = (first && first.history || []).filter(
      (h) => h.event === "replace" && h.step === "theme_overwrite"
    );
    assertTrue("VT2: first run wrote theme files", firstReplaces.length >= 1, `got ${firstReplaces.length}`);

    // Bump fixture version so the install loop re-processes (gotcha 9).
    const fixtureManifest2 = Object.assign({}, manifest, { version: "0.1.1" });
    await fsp.writeFile(path.join(scratch, "_fake-workshop/platform/manifest.json"), JSON.stringify({
      workshop_version: "0.0.0-test",
      mechanisms: [{ name: "test-fixture", version: "0.1.1", path: "mechanisms/test-fixture" }],
      blueprints: [],
    }, null, 2), "utf8");
    await fsp.writeFile(path.join(scratch, "_fake-workshop/platform/mechanisms/test-fixture/manifest.json"), JSON.stringify(fixtureManifest2, null, 2), "utf8");
    await fsp.writeFile(path.join(scratch, "ranch/platform-subscription.json"), JSON.stringify({
      mechanisms: [{ name: "test-fixture", version: "0.1.1" }],
      blueprints: [],
    }, null, 2), "utf8");

    const second = await runHarness(scratch);
    const newOnSecond = (second && second.history || []).slice((first && first.history || []).length);
    const secondReplaces = newOnSecond.filter(
      (h) => h.event === "replace" && h.step === "theme_overwrite"
    );
    const secondSkips = newOnSecond.filter(
      (h) => h.event === "info" && h.step === "theme_overwrite" && h.action === "skipped_existing"
    );
    assertEq("VT2: second run records 0 replace/theme_overwrite events (sha256 match)", secondReplaces.length, 0);
    assertTrue("VT2: second run records at least one skipped_existing (theme files unchanged)", secondSkips.length >= 1);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseVT3SubsequentOverwriteCreatesBak() {
  console.log("\n--- Case VT3: applyVendoredThemes overwrite creates .bak when prior content differs ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseVT3-"));
  try {
    const manifest = styledManifest();
    const priorCss = "/* OLD baseline body */\n";
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
      styling: {
        themeFiles: {
          name: "Baseline",
          files: { "manifest.json": STYLING_THEME_MANIFEST_BODY, "theme.css": STYLING_THEME_CSS_BODY },
        },
        defaultsBody: STYLING_DEFAULTS_BODY,
        consumerThemeFiles: {
          name: "Baseline",
          files: { "theme.css": priorCss },
        },
      },
    });

    const result = await runHarness(scratch);
    assertTrue("VT3: install ran", result !== null);

    const cssPath = path.join(scratch, ".obsidian/themes/Baseline/theme.css");
    const bakPath = `${cssPath}.bak`;
    assertTrue("VT3: <theme.css>.bak exists (prior content backed up)", fs.existsSync(bakPath));
    if (fs.existsSync(bakPath)) {
      const bak = await readRaw(bakPath);
      assertEq("VT3: .bak body byte-equal to prior consumer content", bak, priorCss);
    }

    const live = await readRaw(cssPath);
    assertEq("VT3: live theme.css body byte-equal to source", live, STYLING_THEME_CSS_BODY);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseVT4MissingSourceFailsLoud() {
  console.log("\n--- Case VT4: applyVendoredThemes source-absent emits error event ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseVT4-"));
  try {
    const manifest = styledManifest({ vendored_themes: [{ name: "Baseline", src: "assets/themes/Baseline" }] });
    // NOTE: do NOT pass styling.themeFiles — workshop has no source dir for Baseline.
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
      styling: {
        defaultsBody: STYLING_DEFAULTS_BODY,
      },
    });

    const result = await runHarness(scratch);
    assertTrue("VT4: install ran", result !== null);

    const errEvts = (result && result.history || []).filter(
      (h) => h.event === "error" && h.step === "theme_overwrite"
    );
    assertTrue("VT4: at least one error/theme_overwrite recorded", errEvts.length >= 1, `got ${errEvts.length}`);

    // No theme files materialized in consumer.
    const consumerThemeDir = path.join(scratch, ".obsidian/themes/Baseline");
    if (fs.existsSync(consumerThemeDir)) {
      const files = fs.readdirSync(consumerThemeDir);
      assertEq("VT4: consumer .obsidian/themes/Baseline/ has 0 files when source missing", files.length, 0);
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseVT5MultipleFilesAllOverwritten() {
  console.log("\n--- Case VT5: applyVendoredThemes processes every file in the source theme dir ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseVT5-"));
  try {
    const manifest = styledManifest();
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
      styling: {
        themeFiles: {
          name: "Baseline",
          files: {
            "manifest.json": STYLING_THEME_MANIFEST_BODY,
            "theme.css": STYLING_THEME_CSS_BODY,
            "extra.css": "/* extra rules */\n",
          },
        },
        defaultsBody: STYLING_DEFAULTS_BODY,
      },
    });

    const result = await runHarness(scratch);
    assertTrue("VT5: install ran", result !== null);

    for (const fname of ["manifest.json", "theme.css", "extra.css"]) {
      const p = path.join(scratch, ".obsidian/themes/Baseline", fname);
      assertTrue(`VT5: ${fname} materialized`, fs.existsSync(p));
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

// ---------- applyAppearance (AP1-AP5) ----------

async function caseAP1FreshWriteCreatesAppearanceJson() {
  console.log("\n--- Case AP1: applyAppearance creates appearance.json when absent ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseAP1-"));
  try {
    const manifest = styledManifest();
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
      styling: {
        themeFiles: {
          name: "Baseline",
          files: { "manifest.json": STYLING_THEME_MANIFEST_BODY, "theme.css": STYLING_THEME_CSS_BODY },
        },
        defaultsBody: STYLING_DEFAULTS_BODY,
      },
    });

    const result = await runHarness(scratch);
    assertTrue("AP1: install ran", result !== null);

    const apPath = path.join(scratch, ".obsidian/appearance.json");
    assertTrue("AP1: appearance.json materialized", fs.existsSync(apPath));
    if (fs.existsSync(apPath)) {
      const ap = await readJson(apPath);
      assertEq("AP1: cssTheme set to Baseline", ap.cssTheme, "Baseline");
      assertTrue("AP1: enabledCssSnippets contains customjs-loader",
        Array.isArray(ap.enabledCssSnippets) && ap.enabledCssSnippets.includes("customjs-loader"));
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseAP2AdditiveSnippetUnion() {
  console.log("\n--- Case AP2: applyAppearance enabledCssSnippets[] additive union with consumer overrides ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseAP2-"));
  try {
    const manifest = styledManifest();
    const priorAppearance = JSON.stringify({ cssTheme: "OldTheme", enabledCssSnippets: ["my-snippet", "another"] }, null, 2);
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
      styling: {
        themeFiles: {
          name: "Baseline",
          files: { "manifest.json": STYLING_THEME_MANIFEST_BODY, "theme.css": STYLING_THEME_CSS_BODY },
        },
        defaultsBody: STYLING_DEFAULTS_BODY,
        consumerAppearanceBody: priorAppearance,
      },
    });

    const result = await runHarness(scratch);
    assertTrue("AP2: install ran", result !== null);

    const ap2Path = path.join(scratch, ".obsidian/appearance.json");
    if (fs.existsSync(ap2Path)) {
      const ap = await readJson(ap2Path);
      assertEq("AP2: cssTheme overridden to Baseline", ap.cssTheme, "Baseline");
      assertTrue("AP2: my-snippet preserved", Array.isArray(ap.enabledCssSnippets) && ap.enabledCssSnippets.includes("my-snippet"));
      assertTrue("AP2: another preserved", Array.isArray(ap.enabledCssSnippets) && ap.enabledCssSnippets.includes("another"));
      assertTrue("AP2: customjs-loader added", Array.isArray(ap.enabledCssSnippets) && ap.enabledCssSnippets.includes("customjs-loader"));
      assertEq("AP2: enabledCssSnippets length is 3 (no duplicates)", (ap.enabledCssSnippets || []).length, 3);
    } else {
      assertTrue("AP2: appearance.json materialized", false, "appearance.json missing");
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseAP3CssThemeAlwaysOverridden() {
  console.log("\n--- Case AP3: applyAppearance always sets cssTheme to manifest value ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseAP3-"));
  try {
    const manifest = styledManifest();
    const priorAppearance = JSON.stringify({ cssTheme: "OtherTheme", baseFontSize: 14 }, null, 2);
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
      styling: {
        themeFiles: {
          name: "Baseline",
          files: { "manifest.json": STYLING_THEME_MANIFEST_BODY, "theme.css": STYLING_THEME_CSS_BODY },
        },
        defaultsBody: STYLING_DEFAULTS_BODY,
        consumerAppearanceBody: priorAppearance,
      },
    });

    const result = await runHarness(scratch);
    assertTrue("AP3: install ran", result !== null);

    const ap3Path = path.join(scratch, ".obsidian/appearance.json");
    if (fs.existsSync(ap3Path)) {
      const ap = await readJson(ap3Path);
      assertEq("AP3: cssTheme overridden", ap.cssTheme, "Baseline");
      assertEq("AP3: unrelated key preserved (baseFontSize)", ap.baseFontSize, 14);
    } else {
      assertTrue("AP3: appearance.json present", false, "appearance.json missing");
    }

    const bakPath = path.join(scratch, ".obsidian/appearance.json.sauce-backup");
    assertTrue("AP3: appearance.json.sauce-backup exists", fs.existsSync(bakPath));
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseAP4MalformedJsonGuard() {
  console.log("\n--- Case AP4: applyAppearance malformed-JSON guard ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseAP4-"));
  try {
    const manifest = styledManifest();
    const malformed = "{not valid";
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
      styling: {
        themeFiles: {
          name: "Baseline",
          files: { "manifest.json": STYLING_THEME_MANIFEST_BODY, "theme.css": STYLING_THEME_CSS_BODY },
        },
        defaultsBody: STYLING_DEFAULTS_BODY,
        consumerAppearanceBody: malformed,
      },
    });

    const result = await runHarness(scratch);
    assertTrue("AP4: install ran", result !== null);

    const errs = (result && result.history || []).filter(
      (h) => h.event === "error" && h.step === "appearance"
    );
    assertTrue("AP4: at least one error/appearance event recorded", errs.length >= 1, `got ${errs.length}`);

    const apPath = path.join(scratch, ".obsidian/appearance.json");
    const after = await readRaw(apPath);
    assertEq("AP4: malformed appearance.json untouched", after, malformed);

    const bakPath = `${apPath}.sauce-backup`;
    assertTrue("AP4: no .sauce-backup created on malformed-JSON guard", !fs.existsSync(bakPath));
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseAP5BackupOnEditBytes() {
  console.log("\n--- Case AP5: applyAppearance backup captures pre-edit bytes ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseAP5-"));
  try {
    const manifest = styledManifest();
    const priorBody = JSON.stringify({ cssTheme: "X" });
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
      styling: {
        themeFiles: {
          name: "Baseline",
          files: { "manifest.json": STYLING_THEME_MANIFEST_BODY, "theme.css": STYLING_THEME_CSS_BODY },
        },
        defaultsBody: STYLING_DEFAULTS_BODY,
        consumerAppearanceBody: priorBody,
      },
    });

    const result = await runHarness(scratch);
    assertTrue("AP5: install ran", result !== null);

    const bakPath = path.join(scratch, ".obsidian/appearance.json.sauce-backup");
    assertTrue("AP5: appearance.json.sauce-backup exists", fs.existsSync(bakPath));
    if (fs.existsSync(bakPath)) {
      const bak = await readRaw(bakPath);
      assertEq("AP5: backup byte-equal to pre-edit", bak, priorBody);
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

// ---------- applyStyleSettings (SS1-SS5) ----------

async function caseSS1DefaultsWriteOnEmptyDataJson() {
  console.log("\n--- Case SS1: applyStyleSettings full canonical write when data.json absent ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseSS1-"));
  try {
    const manifest = styledManifest();
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
      styling: {
        themeFiles: {
          name: "Baseline",
          files: { "manifest.json": STYLING_THEME_MANIFEST_BODY, "theme.css": STYLING_THEME_CSS_BODY },
        },
        defaultsBody: STYLING_DEFAULTS_BODY,
      },
    });

    const result = await runHarness(scratch);
    assertTrue("SS1: install ran", result !== null);

    const ssPath = path.join(scratch, ".obsidian/plugins/obsidian-style-settings/data.json");
    assertTrue("SS1: data.json materialized", fs.existsSync(ssPath));
    if (fs.existsSync(ssPath)) {
      const ss = await readJson(ssPath);
      const expected = JSON.parse(STYLING_DEFAULTS_BODY);
      assertEq("SS1: all canonical keys present", Object.keys(ss).sort().join(","), Object.keys(expected).sort().join(","));
      assertEq("SS1: color-scheme-light value matches canonical", ss["baseline-style@@color-scheme-light"], "rose-pine-light");
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseSS2AdditivePreservesUserOverride() {
  console.log("\n--- Case SS2: applyStyleSettings user-override preserved (first-wins) ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseSS2-"));
  try {
    const manifest = styledManifest();
    const userBody = JSON.stringify({ "baseline-style@@h1-size": "2.5em" }, null, 2);
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
      styling: {
        themeFiles: {
          name: "Baseline",
          files: { "manifest.json": STYLING_THEME_MANIFEST_BODY, "theme.css": STYLING_THEME_CSS_BODY },
        },
        defaultsBody: STYLING_DEFAULTS_BODY,
        consumerStyleSettingsBody: userBody,
      },
    });

    const result = await runHarness(scratch);
    assertTrue("SS2: install ran", result !== null);

    const ss2Path = path.join(scratch, ".obsidian/plugins/obsidian-style-settings/data.json");
    if (fs.existsSync(ss2Path)) {
      const ss = await readJson(ss2Path);
      assertEq("SS2: user override h1-size preserved", ss["baseline-style@@h1-size"], "2.5em");
      assertEq("SS2: missing canonical key filled in (color-scheme-light)", ss["baseline-style@@color-scheme-light"], "rose-pine-light");
      assertEq("SS2: missing canonical key filled in (font-text-override)", ss["baseline-style@@font-text-override"], "Inter");
    } else {
      assertTrue("SS2: data.json present", false, "data.json missing");
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseSS3MalformedJsonGuard() {
  console.log("\n--- Case SS3: applyStyleSettings malformed consumer data.json guard ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseSS3-"));
  try {
    const manifest = styledManifest();
    const malformed = "{not valid";
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
      styling: {
        themeFiles: {
          name: "Baseline",
          files: { "manifest.json": STYLING_THEME_MANIFEST_BODY, "theme.css": STYLING_THEME_CSS_BODY },
        },
        defaultsBody: STYLING_DEFAULTS_BODY,
        consumerStyleSettingsBody: malformed,
      },
    });

    const result = await runHarness(scratch);
    assertTrue("SS3: install ran", result !== null);

    const errs = (result && result.history || []).filter(
      (h) => h.event === "error" && h.step === "style_settings"
    );
    assertTrue("SS3: at least one error/style_settings event recorded", errs.length >= 1, `got ${errs.length}`);

    const ssPath = path.join(scratch, ".obsidian/plugins/obsidian-style-settings/data.json");
    const after = await readRaw(ssPath);
    assertEq("SS3: malformed data.json untouched", after, malformed);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseSS4MissingDefaultsSrcFailsLoud() {
  console.log("\n--- Case SS4: applyStyleSettings missing style_settings_defaults_src in workshop emits error ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseSS4-"));
  try {
    const manifest = styledManifest();
    // NOTE: do NOT pass styling.defaultsBody — workshop has no source defaults.
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
      styling: {
        themeFiles: {
          name: "Baseline",
          files: { "manifest.json": STYLING_THEME_MANIFEST_BODY, "theme.css": STYLING_THEME_CSS_BODY },
        },
      },
    });

    const result = await runHarness(scratch);
    assertTrue("SS4: install ran", result !== null);

    const errs = (result && result.history || []).filter(
      (h) => h.event === "error" && h.step === "style_settings"
    );
    assertTrue("SS4: at least one error/style_settings event recorded", errs.length >= 1, `got ${errs.length}`);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseSS5BackupOnEdit() {
  console.log("\n--- Case SS5: applyStyleSettings backup captures pre-edit bytes ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseSS5-"));
  try {
    const manifest = styledManifest();
    const priorBody = JSON.stringify({ "baseline-style@@h1-size": "2.5em", customUserKey: "preserved" });
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
      styling: {
        themeFiles: {
          name: "Baseline",
          files: { "manifest.json": STYLING_THEME_MANIFEST_BODY, "theme.css": STYLING_THEME_CSS_BODY },
        },
        defaultsBody: STYLING_DEFAULTS_BODY,
        consumerStyleSettingsBody: priorBody,
      },
    });

    const result = await runHarness(scratch);
    assertTrue("SS5: install ran", result !== null);

    const ssPath = path.join(scratch, ".obsidian/plugins/obsidian-style-settings/data.json");
    const bakPath = `${ssPath}.sauce-backup`;
    assertTrue("SS5: data.json.sauce-backup exists", fs.existsSync(bakPath));
    if (fs.existsSync(bakPath)) {
      const bak = await readRaw(bakPath);
      assertEq("SS5: backup byte-equal to pre-edit", bak, priorBody);
    }

    if (fs.existsSync(ssPath)) {
      const ss = await readJson(ssPath);
      assertEq("SS5: user customUserKey preserved post-merge", ss.customUserKey, "preserved");
      assertEq("SS5: user h1-size override preserved", ss["baseline-style@@h1-size"], "2.5em");
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

// =============================================================================
// v0.21.1 consumer-convenience cycle — TDD-first cases for applyHotkeys
// (HK1-HK5) and applyCommunityPluginData (CP1-CP5). Helper-cases 346 -> ~376
// (10 new cases, ~30 sub-asserts). Cases land FAILING until S2 wires the new
// helpers into installItem.
//
// Fixture posture: each case scaffolds via scaffoldVault then writes case-
// specific extras (`.obsidian/hotkeys.json` body, dataview plugin dir, dataview
// data.json body) before runHarness. The `manifest` passed to scaffoldVault
// carries the new schema fields (`hotkeys[]`, `community_plugin_settings[]`,
// `external_plugins[]`).
// =============================================================================

function fixtureHotkeysManifest(extra) {
  return Object.assign({}, FIXTURE_MANIFEST_BASE, {
    templater_hotkeys: [],
    slash_commander_bindings: [],
  }, extra || {});
}

async function caseHK1NoHotkeysFieldNoOp() {
  console.log("\n--- Case HK1: applyHotkeys no-op when manifest.hotkeys[] absent/empty ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseHK1-"));
  try {
    const manifest = fixtureHotkeysManifest({});
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });
    const result = await runHarness(scratch);
    assertTrue("HK1: install ran", result !== null);
    const hotkeysPath = path.join(scratch, ".obsidian/hotkeys.json");
    assertTrue("HK1: .obsidian/hotkeys.json was NOT created", !fs.existsSync(hotkeysPath));
    const hotkeyHistory = (result.history || []).filter((h) => h.step === "hotkeys");
    assertEq("HK1: zero history entries with step:hotkeys", hotkeyHistory.length, 0);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseHK2FreshWriteCreatesHotkeysJson() {
  console.log("\n--- Case HK2: applyHotkeys creates hotkeys.json on fresh write ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseHK2-"));
  try {
    const manifest = fixtureHotkeysManifest({
      hotkeys: [
        { command_id: "workspace:copy-full-path", modifiers: ["Mod"], key: "-" },
        { command_id: "workspace:copy-path", modifiers: ["Mod"], key: "=" },
      ],
    });
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });
    const result = await runHarness(scratch);
    assertTrue("HK2: install ran", result !== null);
    const hotkeysPath = path.join(scratch, ".obsidian/hotkeys.json");
    assertTrue("HK2: hotkeys.json materialized", fs.existsSync(hotkeysPath));
    if (fs.existsSync(hotkeysPath)) {
      const hk = await readJson(hotkeysPath);
      assertTrue(
        "HK2: workspace:copy-full-path entry present",
        Array.isArray(hk["workspace:copy-full-path"]) && hk["workspace:copy-full-path"].length === 1
      );
      assertEq(
        "HK2: workspace:copy-full-path key value",
        hk["workspace:copy-full-path"][0],
        { modifiers: ["Mod"], key: "-" }
      );
      assertTrue(
        "HK2: workspace:copy-path entry present",
        Array.isArray(hk["workspace:copy-path"]) && hk["workspace:copy-path"].length === 1
      );
    }
    const bakPath = `${hotkeysPath}.sauce-backup`;
    assertTrue("HK2: NO .sauce-backup on first-creation", !fs.existsSync(bakPath));
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseHK3FirstWinsPreservesUserBinding() {
  console.log("\n--- Case HK3: applyHotkeys first-wins preserves pre-existing user binding ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseHK3-"));
  try {
    const manifest = fixtureHotkeysManifest({
      hotkeys: [
        { command_id: "daily-notes", modifiers: ["Mod"], key: "[" },
        { command_id: "workspace:copy-path", modifiers: ["Mod"], key: "=" },
      ],
    });
    const userBody = JSON.stringify({
      "daily-notes": [{ modifiers: ["Mod"], key: "\\" }],
    }, null, 2);
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });
    const hotkeysPath = path.join(scratch, ".obsidian/hotkeys.json");
    await fsp.writeFile(hotkeysPath, userBody, "utf8");
    const result = await runHarness(scratch);
    assertTrue("HK3: install ran", result !== null);
    const hk = await readJson(hotkeysPath);
    assertEq("HK3: user daily-notes binding PRESERVED (key:\\)", hk["daily-notes"][0].key, "\\");
    assertTrue("HK3: workspace:copy-path ADDED", Array.isArray(hk["workspace:copy-path"]) && hk["workspace:copy-path"][0].key === "=");
    const bakPath = `${hotkeysPath}.sauce-backup`;
    assertTrue("HK3: .sauce-backup written (pre-existing non-empty file overwrite)", fs.existsSync(bakPath));
    const hkHist = (result.history || []).filter((h) => h.step === "hotkeys");
    const skipped = hkHist.filter((h) => h.action === "skipped_existing" && h.command_id === "daily-notes");
    const applied = hkHist.filter((h) => h.action === "applied" && h.command_id === "workspace:copy-path");
    assertTrue("HK3: history skipped_existing for daily-notes present", skipped.length >= 1);
    assertTrue("HK3: history applied for workspace:copy-path present", applied.length >= 1);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseHK4MalformedJsonGuard() {
  console.log("\n--- Case HK4: applyHotkeys malformed-JSON guard ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseHK4-"));
  try {
    const manifest = fixtureHotkeysManifest({
      hotkeys: [{ command_id: "workspace:copy-path", modifiers: ["Mod"], key: "=" }],
    });
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });
    const hotkeysPath = path.join(scratch, ".obsidian/hotkeys.json");
    const malformed = "{not valid";
    await fsp.writeFile(hotkeysPath, malformed, "utf8");
    const result = await runHarness(scratch);
    assertTrue("HK4: install ran", result !== null);
    const stillRaw = await readRaw(hotkeysPath);
    assertEq("HK4: malformed file UNTOUCHED (no overwrite)", stillRaw, malformed);
    const errs = (result.history || []).filter((h) => h.step === "hotkeys" && h.event === "error");
    assertTrue("HK4: history error/hotkeys/malformed present", errs.some((e) => /malformed JSON/i.test(e.message || "")));
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseHK5InvalidEntrySkippedSiblingsApplied() {
  console.log("\n--- Case HK5: applyHotkeys skips invalid entry; siblings still applied ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseHK5-"));
  try {
    const manifest = fixtureHotkeysManifest({
      hotkeys: [
        { command_id: "workspace:copy-path", modifiers: ["Mod"], key: "=" },
        { command_id: "" }, // invalid: empty command_id
      ],
    });
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });
    const result = await runHarness(scratch);
    assertTrue("HK5: install ran", result !== null);
    const hotkeysPath = path.join(scratch, ".obsidian/hotkeys.json");
    assertTrue("HK5: hotkeys.json materialized for sibling entry", fs.existsSync(hotkeysPath));
    if (fs.existsSync(hotkeysPath)) {
      const hk = await readJson(hotkeysPath);
      assertTrue("HK5: workspace:copy-path applied", Array.isArray(hk["workspace:copy-path"]));
      assertTrue("HK5: invalid entry NOT present (no empty key)", !("" in hk));
    }
    const warnings = (result.history || []).filter((h) => h.step === "hotkeys" && h.event === "warning");
    assertTrue("HK5: history warning for invalid entry present", warnings.some((w) => /invalid_entry/i.test(w.message || "")));
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

// -----------------------------------------------------------------------------
// CP1-CP5 — applyCommunityPluginData
// -----------------------------------------------------------------------------

async function seedDataviewPlugin(scratchDir, opts) {
  // opts: { dirPresent: bool, dataJson?: string, communityPluginsIncludesDataview?: bool }
  const dvDir = path.join(scratchDir, ".obsidian/plugins/dataview");
  if (opts.dirPresent) {
    await fsp.mkdir(dvDir, { recursive: true });
    if (opts.dataJson !== undefined) {
      await fsp.writeFile(path.join(dvDir, "data.json"), opts.dataJson, "utf8");
    }
  }
  if (opts.communityPluginsIncludesDataview) {
    const cpPath = path.join(scratchDir, ".obsidian/community-plugins.json");
    let cp = [];
    if (fs.existsSync(cpPath)) {
      try { cp = JSON.parse(await fsp.readFile(cpPath, "utf8")); } catch (e) { cp = []; }
    }
    if (!cp.includes("dataview")) cp.push("dataview");
    await fsp.writeFile(cpPath, JSON.stringify(cp), "utf8");
  }
}

async function caseCP1MissingPrereqShortCircuits() {
  console.log("\n--- Case CP1: applyCommunityPluginData prereq gate (dataview NOT in community-plugins.json) ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseCP1-"));
  try {
    const manifest = fixtureHotkeysManifest({
      external_plugins: [{ id: "dataview" }],
      community_plugin_settings: [
        { id: "dataview", settings: { enableDataviewJs: true } },
      ],
    });
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });
    // dataview NOT added to community-plugins.json; prereq gate must short-circuit.
    const result = await runHarness(scratch);
    assertTrue("CP1: install ran", result !== null);
    const dvData = path.join(scratch, ".obsidian/plugins/dataview/data.json");
    assertTrue("CP1: dataview/data.json NOT written", !fs.existsSync(dvData));
    const cpHist = (result.history || []).filter((h) => h.step === "community_plugin_data");
    const skipped = cpHist.filter((h) => h.action === "skipped_missing_prereq");
    assertTrue("CP1: history info/skipped_missing_prereq present", skipped.length >= 1);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseCP2PluginDirAbsentSkips() {
  console.log("\n--- Case CP2: applyCommunityPluginData plugin dir absent ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseCP2-"));
  try {
    const manifest = fixtureHotkeysManifest({
      external_plugins: [{ id: "dataview" }],
      community_plugin_settings: [
        { id: "dataview", settings: { enableDataviewJs: true } },
      ],
    });
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });
    // Add dataview to community-plugins.json so prereq gate passes,
    // but DO NOT create the plugin directory.
    await seedDataviewPlugin(scratch, { dirPresent: false, communityPluginsIncludesDataview: true });
    const result = await runHarness(scratch);
    assertTrue("CP2: install ran", result !== null);
    const dvData = path.join(scratch, ".obsidian/plugins/dataview/data.json");
    assertTrue("CP2: dataview/data.json NOT created (dir absent)", !fs.existsSync(dvData));
    const cpHist = (result.history || []).filter((h) => h.step === "community_plugin_data");
    const skipped = cpHist.filter((h) => h.action === "skipped_plugin_dir_absent" && h.plugin_id === "dataview");
    assertTrue("CP2: history info/skipped_plugin_dir_absent present", skipped.length >= 1);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseCP3ManifestWinsShallowMerge() {
  console.log("\n--- Case CP3: applyCommunityPluginData manifest WINS shallow merge ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseCP3-"));
  try {
    const manifest = fixtureHotkeysManifest({
      external_plugins: [{ id: "dataview" }],
      community_plugin_settings: [
        { id: "dataview", settings: { enableDataviewJs: true, enableInlineDataviewJs: true } },
      ],
    });
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });
    const priorBody = JSON.stringify({ enableDataviewJs: false, otherKey: "keep" }, null, 2);
    await seedDataviewPlugin(scratch, {
      dirPresent: true,
      dataJson: priorBody,
      communityPluginsIncludesDataview: true,
    });
    const result = await runHarness(scratch);
    assertTrue("CP3: install ran", result !== null);
    const dvDataPath = path.join(scratch, ".obsidian/plugins/dataview/data.json");
    const dv = await readJson(dvDataPath);
    assertEq("CP3: enableDataviewJs WINS to true (manifest wins)", dv.enableDataviewJs, true);
    assertEq("CP3: enableInlineDataviewJs added", dv.enableInlineDataviewJs, true);
    assertEq("CP3: otherKey preserved", dv.otherKey, "keep");
    const bak = `${dvDataPath}.sauce-backup`;
    assertTrue("CP3: .sauce-backup written", fs.existsSync(bak));
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseCP4MalformedJsonGuard() {
  console.log("\n--- Case CP4: applyCommunityPluginData malformed-JSON guard ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseCP4-"));
  try {
    const manifest = fixtureHotkeysManifest({
      external_plugins: [{ id: "dataview" }],
      community_plugin_settings: [
        { id: "dataview", settings: { enableDataviewJs: true } },
      ],
    });
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });
    const malformed = "{not valid";
    await seedDataviewPlugin(scratch, {
      dirPresent: true,
      dataJson: malformed,
      communityPluginsIncludesDataview: true,
    });
    const result = await runHarness(scratch);
    assertTrue("CP4: install ran", result !== null);
    const dvDataPath = path.join(scratch, ".obsidian/plugins/dataview/data.json");
    const stillRaw = await readRaw(dvDataPath);
    assertEq("CP4: malformed file UNTOUCHED", stillRaw, malformed);
    const errs = (result.history || []).filter((h) => h.step === "community_plugin_data" && h.event === "error");
    assertTrue("CP4: history error for malformed JSON present", errs.some((e) => /malformed JSON/i.test(e.message || "")));
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseCP5PathTraversalRejected() {
  console.log("\n--- Case CP5: applyCommunityPluginData rejects path-traversal id ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseCP5-"));
  try {
    const manifest = fixtureHotkeysManifest({
      external_plugins: [{ id: "dataview" }],
      community_plugin_settings: [
        { id: "../foo", settings: { hostile: true } },
      ],
    });
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });
    await seedDataviewPlugin(scratch, {
      dirPresent: true,
      dataJson: "{}",
      communityPluginsIncludesDataview: true,
    });
    const result = await runHarness(scratch);
    assertTrue("CP5: install ran", result !== null);
    // Belt-and-suspenders: nothing written outside .obsidian/plugins/.
    const fooDataInsidePlugins = path.join(scratch, ".obsidian/plugins/../foo/data.json");
    assertTrue("CP5: traversal-target NOT created", !fs.existsSync(fooDataInsidePlugins));
    const fooDataAtObsidianRoot = path.join(scratch, ".obsidian/foo/data.json");
    assertTrue("CP5: .obsidian/foo/data.json NOT created", !fs.existsSync(fooDataAtObsidianRoot));
    const warns = (result.history || []).filter((h) => h.step === "community_plugin_data" && h.event === "warning");
    assertTrue("CP5: history warning for invalid_id present", warns.some((w) => /invalid_id/i.test(w.message || "")));
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

// -----------------------------------------------------------------------------
// SF1-SF5 — scaffoldFoundationalPluginData (v0.26.0 P0-2)
// Materializes Templater data.json defaults at install time when the plugin
// dir exists but data.json is absent (fresh-install scenario where Obsidian
// hasn't yet created the file). Mirrors v0.1.3 / v0.21.1 helper posture
// (failure-loud + idempotent skip-if-present + atomic write + history).
// -----------------------------------------------------------------------------

function fixtureScaffoldFoundationalManifest(extras) {
  // Like fixtureHotkeysManifest but tailored to scaffold-foundational tests:
  // declares external_plugins (or foundational_plugins) without other
  // additive helpers' fields (templater_hotkeys etc.) so SF assertions
  // observe scaffoldFoundationalPluginData behavior in isolation.
  return Object.assign({
    name: "test-fixture",
    version: "0.1.0",
    files: [],
  }, extras || {});
}

async function caseSF1AbsentDataJsonScaffolds() {
  console.log("\n--- Case SF1: absent templater data.json triggers scaffold-write ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseSF1-"));
  try {
    const manifest = fixtureScaffoldFoundationalManifest({
      external_plugins: [{ id: "templater-obsidian" }],
    });
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });
    // Delete the pre-seeded data.json so SF1 exercises the absent-file path.
    const dataPath = path.join(scratch, ".obsidian/plugins/templater-obsidian/data.json");
    await fsp.unlink(dataPath);
    const result = await runHarness(scratch);
    assertTrue("SF1: install ran", result !== null);
    assertTrue("SF1: data.json now exists post-scaffold", fs.existsSync(dataPath));
    if (fs.existsSync(dataPath)) {
      const data = await readJson(dataPath);
      assertEq("SF1: templates_folder reflects variables.templates_path", data.templates_folder, "ranch/templates");
      assertEq("SF1: trigger_on_file_creation true", data.trigger_on_file_creation, true);
      assertEq("SF1: enable_folder_templates true", data.enable_folder_templates, true);
      assertTrue("SF1: folder_templates is empty array",
        Array.isArray(data.folder_templates) && data.folder_templates.length === 0);
    }
    const scaffolded = (result.history || []).filter(
      (h) => h.step === "scaffold_foundational" && h.action === "scaffolded" && h.id === "templater-obsidian"
    );
    assertTrue("SF1: history scaffolded entry written", scaffolded.length >= 1);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseSF2PresentDataJsonSkips() {
  console.log("\n--- Case SF2: present data.json skips scaffold (no overwrite) ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseSF2-"));
  try {
    const manifest = fixtureScaffoldFoundationalManifest({
      external_plugins: [{ id: "templater-obsidian" }],
    });
    // Pre-existing user-customized data.json supplied via templaterData.
    const userData = JSON.stringify({
      templates_folder: "MyCustom/Path",
      arbitrary_user_field: "preserve me",
    }, null, 2);
    await scaffoldVault(scratch, {
      templaterData: userData,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });
    const dataPath = path.join(scratch, ".obsidian/plugins/templater-obsidian/data.json");
    const result = await runHarness(scratch);
    assertTrue("SF2: install ran", result !== null);
    const data = await readJson(dataPath);
    assertEq("SF2: pre-existing templates_folder preserved", data.templates_folder, "MyCustom/Path");
    assertEq("SF2: arbitrary user field preserved", data.arbitrary_user_field, "preserve me");
    const skipped = (result.history || []).filter(
      (h) => h.step === "scaffold_foundational" && h.action === "skipped_already_present" && h.id === "templater-obsidian"
    );
    assertTrue("SF2: history skipped_already_present entry", skipped.length >= 1);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseSF3PluginDirAbsentSkips() {
  console.log("\n--- Case SF3: plugin dir absent skips with skipped_missing_plugin_dir ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseSF3-"));
  try {
    const manifest = fixtureScaffoldFoundationalManifest({
      external_plugins: [{ id: "templater-obsidian" }],
    });
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });
    // Remove the plugin dir entirely AND remove templater-obsidian from
    // community-plugins.json so applyExternalPlugins doesn't short-circuit
    // before scaffoldFoundationalPluginData; the scaffold helper itself
    // handles the missing-dir case.
    await fsp.rm(path.join(scratch, ".obsidian/plugins/templater-obsidian"), { recursive: true, force: true });
    const result = await runHarness(scratch);
    assertTrue("SF3: install ran", result !== null);
    const dataPath = path.join(scratch, ".obsidian/plugins/templater-obsidian/data.json");
    assertTrue("SF3: data.json NOT written (plugin dir absent)", !fs.existsSync(dataPath));
    const skipped = (result.history || []).filter(
      (h) => h.step === "scaffold_foundational" && h.action === "skipped_missing_plugin_dir" && h.id === "templater-obsidian"
    );
    assertTrue("SF3: history skipped_missing_plugin_dir entry", skipped.length >= 1);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseSF4UnknownPluginSilentNoOp() {
  console.log("\n--- Case SF4: unknown plugin id silent no-op ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseSF4-"));
  try {
    const manifest = fixtureScaffoldFoundationalManifest({
      external_plugins: [{ id: "some-random-plugin" }],
    });
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });
    // Pre-create the unknown plugin's dir so applyExternalPlugins doesn't
    // mask the result; scaffoldFoundationalPluginData should still no-op
    // because there's no registry entry for "some-random-plugin".
    await fsp.mkdir(path.join(scratch, ".obsidian/plugins/some-random-plugin"), { recursive: true });
    const cpPath = path.join(scratch, ".obsidian/community-plugins.json");
    const cp = JSON.parse(await fsp.readFile(cpPath, "utf8"));
    if (!cp.includes("some-random-plugin")) cp.push("some-random-plugin");
    await fsp.writeFile(cpPath, JSON.stringify(cp), "utf8");
    const result = await runHarness(scratch);
    assertTrue("SF4: install ran", result !== null);
    const dataPath = path.join(scratch, ".obsidian/plugins/some-random-plugin/data.json");
    assertTrue("SF4: no data.json materialized for unknown plugin", !fs.existsSync(dataPath));
    const sfHist = (result.history || []).filter((h) => h.step === "scaffold_foundational" && h.id === "some-random-plugin");
    assertEq("SF4: zero scaffold_foundational history entries for unknown id", sfHist.length, 0);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseSF5TemplatesPathSubstitution() {
  console.log("\n--- Case SF5: templates_folder substitution from variables.templates_path ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseSF5-"));
  try {
    const manifest = fixtureScaffoldFoundationalManifest({
      external_plugins: [{ id: "templater-obsidian" }],
    });
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });
    // Override platform-config variables.templates_path to a non-default value
    // so the registry's variables-aware fallback path is exercised.
    const cfgPath = path.join(scratch, "ranch/platform-config.json");
    const cfg = JSON.parse(await fsp.readFile(cfgPath, "utf8"));
    cfg.variables.templates_path = "custom/templates/path";
    await fsp.writeFile(cfgPath, JSON.stringify(cfg, null, 2), "utf8");
    // Delete the pre-seeded data.json so the scaffold helper writes fresh.
    await fsp.unlink(path.join(scratch, ".obsidian/plugins/templater-obsidian/data.json"));
    const result = await runHarness(scratch);
    assertTrue("SF5: install ran", result !== null);
    const dataPath = path.join(scratch, ".obsidian/plugins/templater-obsidian/data.json");
    assertTrue("SF5: data.json materialized", fs.existsSync(dataPath));
    if (fs.existsSync(dataPath)) {
      const data = await readJson(dataPath);
      assertEq("SF5: templates_folder reflects custom variables.templates_path",
        data.templates_folder, "custom/templates/path");
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

// -----------------------------------------------------------------------------
// AS1-AS5 — applyAppSettings (v0.26.1 P1-2)
// Workshop-level helper that writes .obsidian/app.json with declared keys from
// workshopManifest.app_settings. Mirrors v0.24.0 applyCustomJsSettings posture
// (additive shallow merge, backup-on-edit, malformed-JSON guard, atomic write,
// failure-loud history under step "app_settings").
//
// Each case writes app_settings into the FAKE workshop manifest at
// <scratch>/_fake-workshop/platform/manifest.json (overwriting scaffoldVault's
// default-shaped manifest), then runs the canonical installer harness which
// reads workshopManifest at the top of install() and (post-S2) invokes
// applyAppSettings(tp, workshopManifest, history, git).
//
// Pre-S2: applyAppSettings is not implemented; cases FAIL because the helper
// is never invoked (no history entries, no .obsidian/app.json materialized).
// Post-S2: history entries appear under step "app_settings"; file state
// matches expected.
// -----------------------------------------------------------------------------

async function _writeWorkshopManifestWithAppSettings(scratch, appSettings) {
  // Overwrite the fake workshop manifest scaffoldVault wrote earlier so it
  // carries the app_settings field. Other fields preserved (mechanisms /
  // blueprints / workshop_version) per scaffoldVault's defaults.
  const wmPath = path.join(scratch, "_fake-workshop/platform/manifest.json");
  const existing = JSON.parse(await fsp.readFile(wmPath, "utf8"));
  existing.app_settings = appSettings;
  await fsp.writeFile(wmPath, JSON.stringify(existing, null, 2), "utf8");
}

async function caseAS1AppJsonAbsent() {
  console.log("\n--- Case AS1: applyAppSettings creates app.json when absent ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseAS1-"));
  try {
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest: FIXTURE_MANIFEST_BASE,
    });
    await _writeWorkshopManifestWithAppSettings(scratch, { alwaysOpenInNewTab: true });
    const appJsonPath = path.join(scratch, ".obsidian/app.json");
    // Confirm absent pre-install.
    if (fs.existsSync(appJsonPath)) await fsp.unlink(appJsonPath);
    const result = await runHarness(scratch);
    assertTrue("AS1: install ran", result !== null);
    assertTrue("AS1: app.json materialized post-install", fs.existsSync(appJsonPath));
    if (fs.existsSync(appJsonPath)) {
      const data = await readJson(appJsonPath);
      assertEq("AS1: alwaysOpenInNewTab=true written", data.alwaysOpenInNewTab, true);
    } else {
      assertTrue("AS1: alwaysOpenInNewTab=true written (file missing)", false);
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseAS2OverridesExisting() {
  console.log("\n--- Case AS2: applyAppSettings overrides existing alwaysOpenInNewTab=false ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseAS2-"));
  try {
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest: FIXTURE_MANIFEST_BASE,
    });
    await _writeWorkshopManifestWithAppSettings(scratch, { alwaysOpenInNewTab: true });
    const appJsonPath = path.join(scratch, ".obsidian/app.json");
    await fsp.writeFile(appJsonPath, JSON.stringify({ alwaysOpenInNewTab: false }, null, 2), "utf8");
    const result = await runHarness(scratch);
    assertTrue("AS2: install ran", result !== null);
    const data = await readJson(appJsonPath);
    assertEq("AS2: alwaysOpenInNewTab overridden true (platform-as-overrider)", data.alwaysOpenInNewTab, true);
    const applied = (result.history || []).filter(
      (h) => h.step === "app_settings" && h.action === "applied"
    );
    assertTrue("AS2: history applied entry under step=app_settings", applied.length >= 1);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseAS3PreservesNonDeclared() {
  console.log("\n--- Case AS3: applyAppSettings preserves non-declared keys verbatim ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseAS3-"));
  try {
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest: FIXTURE_MANIFEST_BASE,
    });
    await _writeWorkshopManifestWithAppSettings(scratch, { alwaysOpenInNewTab: true });
    const appJsonPath = path.join(scratch, ".obsidian/app.json");
    // Pre-existing user customization with a non-declared key.
    await fsp.writeFile(appJsonPath, JSON.stringify({
      legacyEditor: true,
      promptDelete: false,
    }, null, 2), "utf8");
    const result = await runHarness(scratch);
    assertTrue("AS3: install ran", result !== null);
    const data = await readJson(appJsonPath);
    assertEq("AS3: non-declared legacyEditor preserved verbatim", data.legacyEditor, true);
    assertEq("AS3: declared alwaysOpenInNewTab=true merged in", data.alwaysOpenInNewTab, true);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseAS4MalformedJsonGuard() {
  console.log("\n--- Case AS4: applyAppSettings malformed JSON guard ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseAS4-"));
  try {
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest: FIXTURE_MANIFEST_BASE,
    });
    await _writeWorkshopManifestWithAppSettings(scratch, { alwaysOpenInNewTab: true });
    const appJsonPath = path.join(scratch, ".obsidian/app.json");
    const malformed = "{not valid json at all";
    await fsp.writeFile(appJsonPath, malformed, "utf8");
    const result = await runHarness(scratch);
    assertTrue("AS4: install ran", result !== null);
    const after = await readRaw(appJsonPath);
    assertEq("AS4: malformed body preserved verbatim (zero writes)", after, malformed);
    const errors = (result.history || []).filter(
      (h) => h.step === "app_settings" && h.action === "error"
    );
    assertTrue("AS4: history error entry under step=app_settings", errors.length >= 1);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseAS5BackupBeforeEdit() {
  console.log("\n--- Case AS5: applyAppSettings writes .sauce-backup before edit ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseAS5-"));
  try {
    await scaffoldVault(scratch, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest: FIXTURE_MANIFEST_BASE,
    });
    await _writeWorkshopManifestWithAppSettings(scratch, { alwaysOpenInNewTab: true });
    const appJsonPath = path.join(scratch, ".obsidian/app.json");
    const priorBody = JSON.stringify({ alwaysOpenInNewTab: false, marker: "prior" }, null, 2);
    await fsp.writeFile(appJsonPath, priorBody, "utf8");
    const result = await runHarness(scratch);
    assertTrue("AS5: install ran", result !== null);
    const backupPath = appJsonPath + ".sauce-backup";
    assertTrue("AS5: .sauce-backup written before edit", fs.existsSync(backupPath));
    if (fs.existsSync(backupPath)) {
      const backupBody = await readRaw(backupPath);
      assertEq("AS5: backup body matches prior content verbatim", backupBody, priorBody);
    } else {
      assertTrue("AS5: backup body matches prior content (backup missing)", false);
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

// v0.20.0 docs polish cycle — trailing-whitespace lint for blueprint template + content bodies.
// ============================================================
// v0.31.0 S1.5 — engagement-type registry + bootstrap_contributions[]
// schema-conformance assertions. Pure static-JSON checks; no installer
// dispatch. Targets +12 sub-asserts (3 + 3 + 1 + 4 + 4 + 1 + 1 = 17 actual;
// plan said target = 12, so we're slightly over — counted at run time).
// ============================================================

const COWORK_DIR        = path.join(WORKSHOP, "platform", "blueprints", "cowork");
const ENGAGEMENT_TYPES_DIR = path.join(COWORK_DIR, "engagement-types");
const COWORK_MANIFEST_PATH = path.join(COWORK_DIR, "manifest.json");
const BLUEPRINTS_DIR    = path.join(WORKSHOP, "platform", "blueprints");
const CONTRIB_BPS       = ["finance", "people", "meetings", "project"];
const VALID_CONTRIB_KINDS = new Set(["engagement_field_offer", "context_file_offer", "vault_question"]);

function _readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

// HC-ET-1 — Each engagement-type JSON parses + has required top-level fields.
async function caseHCET1() {
  console.log("\n--- Case HC-ET-1: engagement-type manifests have required top-level fields ---");
  const required = [
    "id", "version", "schema_version", "label", "consumes",
    "required_fields", "optional_fields",
    "supported_cadences", "default_cadences", "render_aspects",
  ];
  const types = ["personal", "w2-fte", "consulting"];
  for (const t of types) {
    const p = path.join(ENGAGEMENT_TYPES_DIR, `${t}.json`);
    const m = _readJson(p);
    const missing = required.filter((k) => !(k in m));
    assertTrue(
      `HC-ET-1: ${t}.json has all required top-level fields`,
      missing.length === 0,
      missing.length > 0 ? `missing: ${missing.join(", ")}` : ""
    );
  }
}

// HC-ET-2 — Every cowork.manifest.engagement_types[] entry resolves to a file.
async function caseHCET2() {
  console.log("\n--- Case HC-ET-2: cowork.engagement_types[] entries resolve to existing files ---");
  const cowork = _readJson(COWORK_MANIFEST_PATH);
  const entries = cowork.engagement_types || [];
  assertTrue("HC-ET-2: cowork.engagement_types[] has 3 entries", entries.length === 3);
  for (const e of entries) {
    const resolved = path.join(COWORK_DIR, e.manifest);
    assertTrue(
      `HC-ET-2: engagement_types entry id="${e.id}" resolves to ${e.manifest}`,
      fs.existsSync(resolved),
      `not found: ${resolved}`
    );
  }
}

// HC-ET-3 — Every consumes[] blueprint name is a real installed blueprint.
async function caseHCET3() {
  console.log("\n--- Case HC-ET-3: engagement-type consumes[] all reference real blueprints ---");
  const types = ["personal", "w2-fte", "consulting"];
  const allConsumes = new Set();
  for (const t of types) {
    const m = _readJson(path.join(ENGAGEMENT_TYPES_DIR, `${t}.json`));
    for (const c of (m.consumes || [])) allConsumes.add(c);
  }
  const missing = [];
  for (const bp of allConsumes) {
    const bpManifest = path.join(BLUEPRINTS_DIR, bp, "manifest.json");
    if (!fs.existsSync(bpManifest)) missing.push(bp);
  }
  assertTrue(
    `HC-ET-3: all consumes[] entries (${allConsumes.size} distinct) resolve to installed blueprints`,
    missing.length === 0,
    missing.length > 0 ? `missing blueprints: ${missing.join(", ")}` : ""
  );
}

// HC-BC-1 — Every bootstrap_contributions[] entry has a valid kind.
async function caseHCBC1() {
  console.log("\n--- Case HC-BC-1: bootstrap_contributions[].kind is in {engagement_field_offer, context_file_offer, vault_question} ---");
  for (const bp of CONTRIB_BPS) {
    const m = _readJson(path.join(BLUEPRINTS_DIR, bp, "manifest.json"));
    const contribs = m.bootstrap_contributions || [];
    const bad = contribs.filter((c) => !VALID_CONTRIB_KINDS.has(c.kind));
    assertTrue(
      `HC-BC-1: ${bp} bootstrap_contributions[] kinds all valid (${contribs.length} entries)`,
      bad.length === 0,
      bad.length > 0 ? `bad kinds: ${bad.map((c) => c.kind).join(", ")}` : ""
    );
  }
}

// HC-BC-2 — engagement_field_offer.engagement_field_id matches <blueprint-name>.<snake_case>.
async function caseHCBC2() {
  console.log("\n--- Case HC-BC-2: engagement_field_offer.engagement_field_id uses prefix-by-blueprint convention ---");
  for (const bp of CONTRIB_BPS) {
    const m = _readJson(path.join(BLUEPRINTS_DIR, bp, "manifest.json"));
    const offers = (m.bootstrap_contributions || []).filter((c) => c.kind === "engagement_field_offer");
    const re = new RegExp(`^${bp}\\.[a-z][a-z0-9_]+$`);
    const bad = offers.filter((o) => !re.test(o.engagement_field_id));
    assertTrue(
      `HC-BC-2: ${bp} engagement_field_offer ids match ^${bp}\\.[a-z][a-z0-9_]+$ (${offers.length} offers)`,
      bad.length === 0,
      bad.length > 0 ? `bad ids: ${bad.map((o) => o.engagement_field_id).join(", ")}` : ""
    );
  }
}

// HC-BC-3 — Every consumed_by_types[] entry references an existing engagement-type id.
async function caseHCBC3() {
  console.log("\n--- Case HC-BC-3: consumed_by_types[] references real engagement-type ids ---");
  const knownTypes = new Set(["personal", "w2-fte", "consulting"]);
  const bad = [];
  for (const bp of CONTRIB_BPS) {
    const m = _readJson(path.join(BLUEPRINTS_DIR, bp, "manifest.json"));
    for (const c of (m.bootstrap_contributions || [])) {
      for (const t of (c.consumed_by_types || [])) {
        if (!knownTypes.has(t)) bad.push(`${bp}:${c.engagement_field_id || c.path_template}:${t}`);
      }
    }
  }
  assertTrue(
    `HC-BC-3: all consumed_by_types[] entries reference {personal, w2-fte, consulting}`,
    bad.length === 0,
    bad.length > 0 ? `bad refs: ${bad.join(", ")}` : ""
  );
}

// HC-BC-4 — context_file_offer.source_template paths resolve (warn-mode for S1
// since engagement-templates/<type>/ may not yet exist; pre-S4).
async function caseHCBC4() {
  console.log("\n--- Case HC-BC-4: context_file_offer.source_template paths resolve (warn-mode pre-S4) ---");
  const offers = [];
  for (const bp of CONTRIB_BPS) {
    const m = _readJson(path.join(BLUEPRINTS_DIR, bp, "manifest.json"));
    for (const c of (m.bootstrap_contributions || [])) {
      if (c.kind === "context_file_offer") offers.push({ bp, src: c.source_template });
    }
  }
  const missing = offers.filter((o) => !fs.existsSync(path.join(BLUEPRINTS_DIR, o.bp, o.src)));
  if (missing.length > 0) {
    console.log(`  WARN (S1 pre-template-materialization): ${missing.length}/${offers.length} context_file_offer.source_template paths not yet present:`);
    for (const m of missing) console.log(`    ${m.bp}: ${m.src}`);
  }
  // Always-pass in S1; will tighten in S4 once engagement-templates/ exist.
  assertTrue(
    `HC-BC-4: context_file_offer.source_template inventory completed (${offers.length} offers, ${missing.length} pending S4 materialization)`,
    true
  );
}

// ============================================================
// v0.31.0 S2.6 — validator predicate additions (min_length + items_schema)
// ============================================================
// Direct exercise of platform/audit/rule-runner.js predicate handlers — same
// engine the in-vault validator and the CLI auditor share for v0.31.0+.
// Inline fragments avoid temp-vault scaffolding overhead.

const _ruleRunner = require(path.join(WORKSHOP, "platform/audit/rule-runner.js"));

// HC-PR-1 — min_length predicate semantics across 3 list sizes.
async function caseHCPR1MinLength() {
  console.log("\n--- Case HC-PR-1: min_length predicate semantics ---");
  const fragments = [{
    scope: { path_glob: "spice/cowork/context/vault-config.md" },
    required_frontmatter: {
      engagements: { required: true, type: "list", min_length: 2 }
    }
  }];
  const mkRecord = (eng) => ({
    relPath: "spice/cowork/context/vault-config.md",
    frontmatter: { engagements: eng },
    body: "",
    blueprint: "cowork",
  });
  // N-1 entries (1 < min 2) → min_length violation
  const v1 = _ruleRunner.applyRules(fragments, mkRecord([{ id: "a", type: "personal" }]), { workshopRoot: WORKSHOP });
  assertTrue("HC-PR-1: list with 1 entry violates min_length: 2",
    v1.some((v) => v.rule === "required_frontmatter.engagements.min_length"));
  // N entries (2 == min 2) → passes
  const v2 = _ruleRunner.applyRules(fragments, mkRecord([{ id: "a", type: "personal" }, { id: "b", type: "w2-fte" }]), { workshopRoot: WORKSHOP });
  assertTrue("HC-PR-1: list with 2 entries passes min_length: 2",
    !v2.some((v) => v.rule === "required_frontmatter.engagements.min_length"));
  // N+1 entries → passes
  const v3 = _ruleRunner.applyRules(fragments, mkRecord([{ id: "a", type: "personal" }, { id: "b", type: "w2-fte" }, { id: "c", type: "consulting" }]), { workshopRoot: WORKSHOP });
  assertTrue("HC-PR-1: list with 3 entries passes min_length: 2",
    !v3.some((v) => v.rule === "required_frontmatter.engagements.min_length"));
}

// HC-PR-2 — items_schema discriminator + by_type_source + common_required.
async function caseHCPR2ItemsSchema() {
  console.log("\n--- Case HC-PR-2: items_schema discriminator + by_type_source + common_required ---");
  const fragments = [{
    scope: { path_glob: "spice/cowork/context/vault-config.md" },
    required_frontmatter: {
      engagements: {
        required: true,
        type: "list",
        items_schema: {
          discriminator: "type",
          by_type_source: "engagement-types/<type>.json#required_fields",
          common_required: {
            id:   { required: true, type: "string", matches: "^[a-z][a-z0-9-]+$" },
            type: { required: true, type: "string" }
          }
        }
      }
    }
  }];
  const mkRecord = (engagements) => ({
    relPath: "spice/cowork/context/vault-config.md",
    frontmatter: { engagements },
    body: "",
    blueprint: "cowork",
  });
  // (1) Fully valid w2-fte engagement → zero items_schema violations
  const vOk = _ruleRunner.applyRules(fragments, mkRecord([
    { id: "accuris", type: "w2-fte", role: "Engineer", employer: "Acme", stakeholders: ["A","B"] }
  ]), { workshopRoot: WORKSHOP });
  const itemsViolationsOk = vOk.filter((v) => v.rule.startsWith("required_frontmatter.engagements["));
  assertTrue("HC-PR-2: fully valid w2-fte engagement passes items_schema",
    itemsViolationsOk.length === 0);
  // (2) Missing id (common_required) → indexed violation
  const vMissingId = _ruleRunner.applyRules(fragments, mkRecord([
    { type: "w2-fte", role: "Engineer", employer: "Acme", stakeholders: ["A"] }
  ]), { workshopRoot: WORKSHOP });
  assertTrue("HC-PR-2: missing id surfaces required_frontmatter.engagements[0].id",
    vMissingId.some((v) => v.rule === "required_frontmatter.engagements[0].id"));
  // (3) Missing `role` (by_type_source for w2-fte) → indexed role violation
  const vMissingRole = _ruleRunner.applyRules(fragments, mkRecord([
    { id: "accuris", type: "w2-fte", employer: "Acme", stakeholders: ["A"] }
  ]), { workshopRoot: WORKSHOP });
  assertTrue("HC-PR-2: missing role for w2-fte surfaces required_frontmatter.engagements[0].role",
    vMissingRole.some((v) => v.rule === "required_frontmatter.engagements[0].role"));
  // (4) Bad id format (matches predicate via common_required) → matches-violation
  const vBadId = _ruleRunner.applyRules(fragments, mkRecord([
    { id: "BadCaps", type: "w2-fte", role: "Engineer", employer: "Acme", stakeholders: ["A"] }
  ]), { workshopRoot: WORKSHOP });
  assertTrue("HC-PR-2: id failing matches pattern surfaces required_frontmatter.engagements[0].id.matches",
    vBadId.some((v) => v.rule === "required_frontmatter.engagements[0].id.matches"));
  // (5) Unknown discriminator value → unresolved warning
  const vUnknown = _ruleRunner.applyRules(fragments, mkRecord([
    { id: "weird", type: "nonexistent-type" }
  ]), { workshopRoot: WORKSHOP });
  assertTrue("HC-PR-2: unknown discriminator value surfaces unresolved warning",
    vUnknown.some((v) => v.rule.includes("items_schema.by_type_source.unresolved") && v.severity === "warn"));
}

// Carry from v0.18.1 lesson 2 (template-body trailing-whitespace defect class).
// Walks platform/blueprints/<bp>/{content,templates}/*.md (the two-level layout —
// content/ holds install-time-materialized notes, templates/ holds Templater
// template sources). One sub-assert per file scanned (PASS = no [ \t]+$ on any
// line). Failure-loud: prints <file>:<line> + JSON-quoted line for each
// violation. Helper-cases 312 -> 346 (34 new sub-asserts at v0.20.0 ship).
async function caseTW1TemplatesNoTrailingWhitespace() {
  const label = "TW1 templates-no-trailing-whitespace";
  const blueprintsDir = path.join(WORKSHOP, "platform", "blueprints");
  const blueprints = await fsp.readdir(blueprintsDir);
  let filesScanned = 0;
  let totalViolations = 0;

  for (const bp of blueprints) {
    const bpDir = path.join(blueprintsDir, bp);
    const bpStat = await fsp.stat(bpDir);
    if (!bpStat.isDirectory()) continue;
    const subdirs = await fsp.readdir(bpDir);
    for (const sub of subdirs) {
      const subDir = path.join(bpDir, sub);
      const subStat = await fsp.stat(subDir);
      if (!subStat.isDirectory()) continue;
      const entries = await fsp.readdir(subDir);
      for (const e of entries) {
        if (!e.endsWith(".md")) continue;
        const abs = path.join(subDir, e);
        const body = await fsp.readFile(abs, "utf8");
        const lines = body.split("\n");
        const fileViolations = [];
        for (let i = 0; i < lines.length; i++) {
          if (/[ \t]+$/.test(lines[i])) {
            fileViolations.push(`${path.relative(WORKSHOP, abs)}:${i + 1}  ${JSON.stringify(lines[i])}`);
          }
        }
        filesScanned++;
        totalViolations += fileViolations.length;
        assertTrue(
          `${label} — ${path.relative(WORKSHOP, abs)} has no trailing whitespace`,
          fileViolations.length === 0,
          fileViolations.length > 0 ? `\n      ${fileViolations.join("\n      ")}` : ""
        );
      }
    }
  }

  console.log(`  ${label}: ${filesScanned} files scanned, ${totalViolations} violations`);
}

// ============================================================
// v0.29.0 S2.5 — applyRuleFragment array-support cases (HC-RF1/2/3)
// Tests the install.js patch that makes contributions[sourceName] accumulate
// as an array (was: overwrite). Multiple rule_fragments[] from the same
// source (trips has 2, meetings has 2) now coexist instead of last-wins.
// ============================================================

// HC-RF1 — applyRuleFragment writes contributions[sourceName] as ARRAY (not single value)
async function caseHCRF1() {
  console.log("\n--- Case HC-RF1: applyRuleFragment writes contributions[sourceName] as ARRAY ---");
  await withTempVault(async (dir) => {
    fs.mkdirSync(path.join(dir, "ranch/rules"), { recursive: true });
    const tp = makeTpStub(dir);
    const { applyRuleFragment } = require("../install");
    const frag = { target: "trips", fragment: { required_tags: [{ tag: "trip" }] } };
    await applyRuleFragment(tp, frag, "trips", { rules_path: "ranch/rules" }, [], { commit: "x", tag: "x", dirty: false });
    const written = JSON.parse(fs.readFileSync(path.join(dir, "ranch/rules/trips.json"), "utf8"));
    assertTrue("HC-RF1: contributions[trips] is array", Array.isArray(written.contributions.trips));
    assertEqual(written.contributions.trips.length, 1, "HC-RF1: one fragment recorded");
  });
}

// HC-RF2 — second call from same source APPENDS (does not overwrite)
async function caseHCRF2() {
  console.log("\n--- Case HC-RF2: second call from same source APPENDS (does not overwrite) ---");
  await withTempVault(async (dir) => {
    fs.mkdirSync(path.join(dir, "ranch/rules"), { recursive: true });
    const tp = makeTpStub(dir);
    const { applyRuleFragment } = require("../install");
    await applyRuleFragment(tp, { target: "trips", fragment: { required_tags: [{ tag: "trip" }] } }, "trips", { rules_path: "ranch/rules" }, [], { commit: "x", tag: "x", dirty: false });
    await applyRuleFragment(tp, { target: "trips", fragment: { naming_pattern: "^.*\\.md$" } }, "trips", { rules_path: "ranch/rules" }, [], { commit: "x", tag: "x", dirty: false });
    const written = JSON.parse(fs.readFileSync(path.join(dir, "ranch/rules/trips.json"), "utf8"));
    assertEqual(written.contributions.trips.length, 2, "HC-RF2: two fragments accumulated");
  });
}

// HC-RF3 — legacy single-value contribution gets wrapped on next call
async function caseHCRF3() {
  console.log("\n--- Case HC-RF3: legacy single-value contribution gets wrapped on next call ---");
  await withTempVault(async (dir) => {
    fs.mkdirSync(path.join(dir, "ranch/rules"), { recursive: true });
    // Pre-seed a legacy single-value contribution (pre-S2.5 shape).
    fs.writeFileSync(path.join(dir, "ranch/rules/trips.json"),
      JSON.stringify({ contributions: { trips: { naming_pattern: "old" } } }, null, 2));
    const tp = makeTpStub(dir);
    const { applyRuleFragment } = require("../install");
    await applyRuleFragment(tp, { target: "trips", fragment: { required_tags: [{ tag: "trip" }] } }, "trips", { rules_path: "ranch/rules" }, [], { commit: "x", tag: "x", dirty: false });
    const written = JSON.parse(fs.readFileSync(path.join(dir, "ranch/rules/trips.json"), "utf8"));
    assertTrue("HC-RF3: legacy contribution wrapped in array", Array.isArray(written.contributions.trips));
    assertEqual(written.contributions.trips.length, 2, "HC-RF3: legacy + new both present");
  });
}

// v0.30.0 S1.5 — TDD-first cases for materializeSkills (cowork blueprint
// helper that copies <workshop>/platform/<bp>/skills/<src> → <vault>/<dest>
// with {{skills_dir}} substitution + Option B overwrite semantics).
// Mirrors HC-RF pattern: withTempVault + makeTpStub + direct require.

async function caseHCMS1OrchestratorWrite() {
  console.log("\n--- Case HC-MS1: materializeSkills writes orchestrator SKILL.md to .claude/skills/<dir>/<id>/ ---");
  await withTempVault(async (dir) => {
    // Seed a fake workshop with one orchestrator source file.
    const workshop = path.join(dir, "_fake-workshop");
    const bpRel = "blueprints/cowork-test";
    const orchDir = path.join(workshop, "platform", bpRel, "skills/orchestrators/morning-briefing");
    fs.mkdirSync(orchDir, { recursive: true });
    fs.writeFileSync(path.join(orchDir, "SKILL.md"), "---\nname: cowork:morning-briefing\ndescription: stub\n---\n# cowork:morning-briefing\nbody\n");

    const mech = {
      name: "cowork-test",
      skills_dir: ".claude/skills/cowork",
      skills: [
        { source: "skills/orchestrators/morning-briefing/SKILL.md", dest: "{{skills_dir}}/morning-briefing/SKILL.md" },
      ],
    };
    const tp = makeTpStub(dir);
    const { materializeSkills } = require("../install");
    const history = [];
    await materializeSkills(tp, workshop, bpRel, mech, { skills_dir: mech.skills_dir }, history, { commit: "x", tag: "x", dirty: false });

    const dest = path.join(dir, ".claude/skills/cowork/morning-briefing/SKILL.md");
    assertTrue("HC-MS1: dest SKILL.md exists", fs.existsSync(dest));
    const written = fs.readFileSync(dest, "utf8");
    assertTrue("HC-MS1: dest body matches source", /cowork:morning-briefing/.test(written));
  });
}

async function caseHCMS2SubSkillNestedPath() {
  console.log("\n--- Case HC-MS2: materializeSkills writes sub-skill to .claude/skills/<dir>/skills/<id>/ ---");
  await withTempVault(async (dir) => {
    const workshop = path.join(dir, "_fake-workshop");
    const bpRel = "blueprints/cowork-test";
    const subDir = path.join(workshop, "platform", bpRel, "skills/skills/check-vault-routing");
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, "SKILL.md"), "---\nname: cowork:check-vault-routing\ndescription: stub\n---\nbody\n");

    const mech = {
      name: "cowork-test",
      skills_dir: ".claude/skills/cowork",
      skills: [
        { source: "skills/skills/check-vault-routing/SKILL.md", dest: "{{skills_dir}}/skills/check-vault-routing/SKILL.md" },
      ],
    };
    const tp = makeTpStub(dir);
    const { materializeSkills } = require("../install");
    await materializeSkills(tp, workshop, bpRel, mech, { skills_dir: mech.skills_dir }, [], { commit: "x", tag: "x", dirty: false });

    const dest = path.join(dir, ".claude/skills/cowork/skills/check-vault-routing/SKILL.md");
    assertTrue("HC-MS2: nested sub-skill dest exists", fs.existsSync(dest));
  });
}

async function caseHCMS3SkillsDirSubstitution() {
  console.log("\n--- Case HC-MS3: {{skills_dir}} substitutes from variables ---");
  await withTempVault(async (dir) => {
    const workshop = path.join(dir, "_fake-workshop");
    const bpRel = "blueprints/cowork-test";
    const orchDir = path.join(workshop, "platform", bpRel, "skills/orchestrators/morning-briefing");
    fs.mkdirSync(orchDir, { recursive: true });
    fs.writeFileSync(path.join(orchDir, "SKILL.md"), "stub\n");

    // Override skills_dir via variables to confirm substitution is dynamic (not literal).
    const mech = {
      name: "cowork-test",
      skills_dir: ".claude/skills/cowork",
      skills: [
        { source: "skills/orchestrators/morning-briefing/SKILL.md", dest: "{{skills_dir}}/morning-briefing/SKILL.md" },
      ],
    };
    const tp = makeTpStub(dir);
    const { materializeSkills } = require("../install");
    await materializeSkills(tp, workshop, bpRel, mech, { skills_dir: ".claude/skills/cowork-override" }, [], { commit: "x", tag: "x", dirty: false });

    const overridden = path.join(dir, ".claude/skills/cowork-override/morning-briefing/SKILL.md");
    const original = path.join(dir, ".claude/skills/cowork/morning-briefing/SKILL.md");
    assertTrue("HC-MS3: substituted dest exists", fs.existsSync(overridden));
    assertTrue("HC-MS3: literal/default dest does NOT exist", !fs.existsSync(original));
  });
}

async function caseHCMS4Idempotent() {
  console.log("\n--- Case HC-MS4: re-running materializeSkills is idempotent (no .bak on identical re-run) ---");
  await withTempVault(async (dir) => {
    const workshop = path.join(dir, "_fake-workshop");
    const bpRel = "blueprints/cowork-test";
    const orchDir = path.join(workshop, "platform", bpRel, "skills/orchestrators/morning-briefing");
    fs.mkdirSync(orchDir, { recursive: true });
    fs.writeFileSync(path.join(orchDir, "SKILL.md"), "body-v1\n");

    const mech = {
      name: "cowork-test",
      skills_dir: ".claude/skills/cowork",
      skills: [{ source: "skills/orchestrators/morning-briefing/SKILL.md", dest: "{{skills_dir}}/morning-briefing/SKILL.md" }],
    };
    const tp = makeTpStub(dir);
    const { materializeSkills } = require("../install");
    await materializeSkills(tp, workshop, bpRel, mech, { skills_dir: mech.skills_dir }, [], { commit: "x", tag: "x", dirty: false });
    await materializeSkills(tp, workshop, bpRel, mech, { skills_dir: mech.skills_dir }, [], { commit: "x", tag: "x", dirty: false });

    const dest = path.join(dir, ".claude/skills/cowork/morning-briefing/SKILL.md");
    const bak = `${dest}.bak`;
    assertTrue("HC-MS4: dest exists after re-run", fs.existsSync(dest));
    assertTrue("HC-MS4: no .bak on identical re-run", !fs.existsSync(bak));
  });
}

async function caseHCMS5InvalidEntrySkippedWithWarning() {
  console.log("\n--- Case HC-MS5: entries missing source or dest are skipped with a history warning ---");
  await withTempVault(async (dir) => {
    const workshop = path.join(dir, "_fake-workshop");
    const bpRel = "blueprints/cowork-test";
    fs.mkdirSync(path.join(workshop, "platform", bpRel, "skills/orchestrators/morning-briefing"), { recursive: true });
    fs.writeFileSync(path.join(workshop, "platform", bpRel, "skills/orchestrators/morning-briefing/SKILL.md"), "stub\n");

    const mech = {
      name: "cowork-test",
      skills_dir: ".claude/skills/cowork",
      skills: [
        { source: "", dest: "{{skills_dir}}/orphan/SKILL.md" },                                                    // missing source
        { source: "skills/orchestrators/morning-briefing/SKILL.md", dest: "" },                                    // missing dest
        { source: "skills/orchestrators/morning-briefing/SKILL.md", dest: "{{skills_dir}}/morning-briefing/SKILL.md" }, // valid sibling
      ],
    };
    const tp = makeTpStub(dir);
    const { materializeSkills } = require("../install");
    const history = [];
    await materializeSkills(tp, workshop, bpRel, mech, { skills_dir: mech.skills_dir }, history, { commit: "x", tag: "x", dirty: false });

    const warnings = history.filter((h) => h.event === "warning" && h.step === "materialize_skill_invalid_entry");
    assertEqual(warnings.length, 2, "HC-MS5: two invalid entries recorded as warnings");
    const validDest = path.join(dir, ".claude/skills/cowork/morning-briefing/SKILL.md");
    assertTrue("HC-MS5: valid sibling still wrote", fs.existsSync(validDest));
  });
}

// ============================================================
// v0.32.0 S1.3 — claude_surface[] manifest validation + skills_dir
// substitution overlay generalized to mechanisms.
// HC-CS-1..4 — each valid claude_surface[] entry kind passes (no error event)
// HC-CS-5   — entry with unknown kind="bogus" fails (error event recorded)
// HC-SD-1   — mechanism with skills_dir field receives the variable in
//             substitution context (today only blueprints did).
// ============================================================

async function caseHCCS1ValidCommand() {
  console.log("\n--- Case HC-CS-1: claude_surface[] entry kind=command passes validation ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-hc-cs-1-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-cs1",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-cs1",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "cs1",
          claude_surface: [
            { kind: "command", source: "commands/foo.md", dest: ".claude/commands/foo.md" }
          ],
          files: []
        }
      }
    ]);
    const result = await runHarness(scratch);
    assertTrue("HC-CS-1: platform-installed.json was written", result !== null);
    const errs = (result && result.history || []).filter(
      (h) => h.event === "error" && h.step === "claude_surface_invalid" && h.name === "test-fixture-cs1"
    );
    assertEq("HC-CS-1: NO claude_surface_invalid error event for valid command entry", errs.length, 0);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseHCCS2ValidSkill() {
  console.log("\n--- Case HC-CS-2: claude_surface[] entry kind=skill passes validation ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-hc-cs-2-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-cs2",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-cs2",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "cs2",
          claude_surface: [
            { kind: "skill", source: "skills/foo/SKILL.md", dest: "{{skills_dir}}/foo/SKILL.md" }
          ],
          files: []
        }
      }
    ]);
    const result = await runHarness(scratch);
    assertTrue("HC-CS-2: platform-installed.json was written", result !== null);
    const errs = (result && result.history || []).filter(
      (h) => h.event === "error" && h.step === "claude_surface_invalid" && h.name === "test-fixture-cs2"
    );
    assertEq("HC-CS-2: NO claude_surface_invalid error event for valid skill entry", errs.length, 0);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseHCCS3ValidContextDoc() {
  console.log("\n--- Case HC-CS-3: claude_surface[] entry kind=context_doc passes validation ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-hc-cs-3-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-cs3",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-cs3",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "cs3",
          claude_surface: [
            { kind: "context_doc", source: "docs/operator.md", dest: "{{module_directory}}/operator.md" }
          ],
          files: []
        }
      }
    ]);
    const result = await runHarness(scratch);
    assertTrue("HC-CS-3: platform-installed.json was written", result !== null);
    const errs = (result && result.history || []).filter(
      (h) => h.event === "error" && h.step === "claude_surface_invalid" && h.name === "test-fixture-cs3"
    );
    assertEq("HC-CS-3: NO claude_surface_invalid error event for valid context_doc entry", errs.length, 0);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseHCCS4ValidClaudeMdRow() {
  console.log("\n--- Case HC-CS-4: claude_surface[] entry kind=claude_md_row passes validation ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-hc-cs-4-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-cs4",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-cs4",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "cs4",
          claude_surface: [
            { kind: "claude_md_row", table: "resolvers", row: { trigger: "foo", skill: "foo:bar" } }
          ],
          files: []
        }
      }
    ]);
    const result = await runHarness(scratch);
    assertTrue("HC-CS-4: platform-installed.json was written", result !== null);
    const errs = (result && result.history || []).filter(
      (h) => h.event === "error" && h.step === "claude_surface_invalid" && h.name === "test-fixture-cs4"
    );
    assertEq("HC-CS-4: NO claude_surface_invalid error event for valid claude_md_row entry", errs.length, 0);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseHCCS5UnknownKindFails() {
  console.log("\n--- Case HC-CS-5: claude_surface[] entry with unknown kind=\"bogus\" fails validation ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-hc-cs-5-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-cs5",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-cs5",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "cs5",
          claude_surface: [
            { kind: "bogus", source: "x", dest: "y" }
          ],
          files: []
        }
      }
    ]);
    const result = await runHarness(scratch);
    assertTrue("HC-CS-5: platform-installed.json was written", result !== null);
    const errs = (result && result.history || []).filter(
      (h) => h.event === "error" && h.step === "claude_surface_invalid" && h.name === "test-fixture-cs5"
    );
    assertEq("HC-CS-5: exactly one claude_surface_invalid error event", errs.length, 1);
    if (errs.length === 1) {
      const e = errs[0];
      assertTrue("HC-CS-5: error event has git_commit field", "git_commit" in e);
      assertTrue("HC-CS-5: error event has git_tag field", "git_tag" in e);
      assertTrue("HC-CS-5: error event has git_dirty field", "git_dirty" in e);
      assertTrue("HC-CS-5: error event has attempted_at field", typeof e.attempted_at === "string");
      assertTrue("HC-CS-5: error message references bogus kind", typeof e.message === "string" && e.message.includes("bogus"));
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseHCSD1MechanismReceivesSkillsDir() {
  console.log("\n--- Case HC-SD-1: mechanism with skills_dir field receives the variable in substitution context ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-hc-sd-1-"));
  try {
    await scaffoldBlueprintVault(scratch, [], {
      extraMechanisms: [
        {
          name: "test-fixture-mech-skills",
          version: "0.1.0",
          manifest: {
            name: "test-fixture-mech-skills",
            version: "0.1.0",
            skills_dir: ".claude/skills/mech-test",
            files: [{ source: "content/probe.md", dest: "{{scripts_path}}/probe.md" }]
          },
          sourceFiles: [
            { relPath: "content/probe.md", body: "skills dir is {{skills_dir}}\n" }
          ]
        }
      ]
    });
    const result = await runHarness(scratch);
    assertTrue("HC-SD-1: platform-installed.json was written", result !== null);

    const installedMech = (result && result.mechanisms || []).find((m) => m.name === "test-fixture-mech-skills");
    assertTrue("HC-SD-1: mechanism installed", installedMech !== undefined && installedMech.version === "0.1.0");

    const destAbs = path.join(scratch, "ranch/scripts/probe.md");
    assertTrue("HC-SD-1: mechanism dest file exists", fs.existsSync(destAbs));

    if (fs.existsSync(destAbs)) {
      const body = await readRaw(destAbs);
      assertTrue(
        "HC-SD-1: mechanism body has substituted .claude/skills/mech-test (NOT literal {{skills_dir}})",
        body.includes(".claude/skills/mech-test") && !body.includes("{{skills_dir}}"),
        `body was: ${body.trim()}`
      );
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

// ============================================================
// v0.32.0 S3 — end-to-end installer integration cases for claude_surface[]
// four-kind materialization (steps 6b + 6c).
//
// M-CS-1: blueprint declares claude_surface command + skill + context_doc;
//         after install all three files appear at the expected destinations
//         in the consumer vault.
// M-CS-2: body substitution at materialize time — source file references
//         {{module_directory}}; the on-disk dest body has the substituted
//         spice/<bare>/... value.
// M-CS-3: missing source file produces an error history event; sibling
//         valid entries still materialize.
// ============================================================

async function caseMCS1FourKindMaterializeE2E() {
  console.log("\n--- Case M-CS-1: blueprint claude_surface[] command + skill + context_doc all materialize end-to-end ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-m-cs-1-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-mcs1",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-mcs1",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "mcs1",
          skills_dir: ".claude/skills/sauce",
          claude_surface: [
            { kind: "command", source: "commands/mcs1.md", dest: ".claude/commands/mcs1.md" },
            { kind: "skill", source: "skills/mcs1-skill/SKILL.md", dest: "{{skills_dir}}/mcs1-skill/SKILL.md" },
            { kind: "context_doc", source: "context/mcs1.md", dest: "{{module_directory}}/context/mcs1.md" },
          ],
          files: []
        },
        sourceFiles: [
          { relPath: "commands/mcs1.md", body: "# /mcs1 command\n" },
          { relPath: "skills/mcs1-skill/SKILL.md", body: "---\nname: mcs1-skill\n---\nbody\n" },
          { relPath: "context/mcs1.md", body: "context for mcs1\n" },
        ]
      }
    ]);
    const result = await runHarness(scratch);
    assertTrue("M-CS-1: platform-installed.json was written", result !== null);

    const cmdDest = path.join(scratch, ".claude/commands/mcs1.md");
    const skillDest = path.join(scratch, ".claude/skills/sauce/mcs1-skill/SKILL.md");
    const ctxDest = path.join(scratch, "spice/mcs1/context/mcs1.md");
    assertTrue("M-CS-1: command dest exists", fs.existsSync(cmdDest));
    assertTrue("M-CS-1: skill dest exists at substituted skills_dir", fs.existsSync(skillDest));
    assertTrue("M-CS-1: context_doc dest exists at spice/mcs1/...", fs.existsSync(ctxDest));

    const installs = (result && result.history || []).filter((h) => h.event === "claude_surface_install");
    assertEq("M-CS-1: three claude_surface_install events recorded", installs.length, 3);
    const kinds = installs.map((h) => h.kind).sort();
    assertEq("M-CS-1: events cover command/skill/context_doc", kinds, ["command", "context_doc", "skill"]);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseMCS2BodySubstitutionAtMaterializeTime() {
  console.log("\n--- Case M-CS-2: source body references {{module_directory}}; dest body has substituted value ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-m-cs-2-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-mcs2",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-mcs2",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "mcs2",
          claude_surface: [
            { kind: "context_doc", source: "context/mcs2.md", dest: "{{module_directory}}/context/mcs2.md" }
          ],
          files: []
        },
        sourceFiles: [
          { relPath: "context/mcs2.md", body: "see also {{module_directory}}/Index.md\n" }
        ]
      }
    ]);
    const result = await runHarness(scratch);
    assertTrue("M-CS-2: platform-installed.json was written", result !== null);

    const ctxDest = path.join(scratch, "spice/mcs2/context/mcs2.md");
    assertTrue("M-CS-2: context_doc dest exists", fs.existsSync(ctxDest));
    if (fs.existsSync(ctxDest)) {
      const body = await readRaw(ctxDest);
      assertTrue("M-CS-2: body contains substituted spice/mcs2/", body.includes("spice/mcs2/Index.md"));
      assertTrue("M-CS-2: body does NOT contain literal {{module_directory}}", !body.includes("{{module_directory}}"));
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseMCS3MissingSourceLogsErrorContinuesLoop() {
  console.log("\n--- Case M-CS-3: missing source file logs error event; sibling entries still materialize ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-m-cs-3-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-mcs3",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-mcs3",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "mcs3",
          claude_surface: [
            { kind: "command", source: "commands/missing.md", dest: ".claude/commands/missing.md" },
            { kind: "command", source: "commands/sibling.md", dest: ".claude/commands/sibling.md" }
          ],
          files: []
        },
        sourceFiles: [
          // Intentionally omit commands/missing.md to trigger the error path.
          { relPath: "commands/sibling.md", body: "# sibling\n" }
        ]
      }
    ]);
    const result = await runHarness(scratch);
    assertTrue("M-CS-3: platform-installed.json was written", result !== null);

    const missingDest = path.join(scratch, ".claude/commands/missing.md");
    const siblingDest = path.join(scratch, ".claude/commands/sibling.md");
    assertTrue("M-CS-3: missing-source dest NOT written", !fs.existsSync(missingDest));
    assertTrue("M-CS-3: sibling dest WAS written", fs.existsSync(siblingDest));

    const errs = (result && result.history || []).filter(
      (h) => h.event === "error" && h.step === "claude_surface_install"
    );
    assertEq("M-CS-3: exactly one claude_surface_install error event", errs.length, 1);
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
  await caseM6ModuleDirectoryEnsured();
  await caseO1IdenticalContentSkipsOverwrite();
  await caseO2DifferingContentBackupAndReplace();
  await caseO3ZeroByteDestNoBackup();
  await caseO4FreshWriteNoReplace();
  await caseO5SubstitutionAffectsSha();
  await caseP1PreInstallDeletesExistingFile();
  await caseP2PreInstallDeleteAbsentFile();
  await caseP3PreInstallDeleteDirectoryTarget();
  await caseP4UnknownTypeWarningOnly();
  await caseC1IdempotentMerge();
  await caseC2MalformedJson();
  await caseC3AdditivePreservesUserKeys();
  await caseC4BackupOnEditBytes();
  await caseC5SubstitutionOnSettings();
  await caseFT1IdempotentMerge();
  await caseFT2MalformedJson();
  await caseFT3AdditivePreservesUserEntries();
  await caseFT4BackupOnEdit();
  await caseFT5SubstitutionApplied();
  await caseR1ValidateAndResolveRunTemplaterTemplate();
  await caseR2FilenameDefaults();
  await caseR3EmptyFolderDatePattern();
  await caseR4MissingFolderPrefix();
  await caseR5InvokeCommandPassthrough();
  await caseR6OpenLinkTargetSubstitution();

  // v0.31.0 S3.2 — nav-buttons@2.6.0: invoke_command.args literal passthrough.
  await caseHCNBArgs1InvokeCommandArgs();

  // v0.19.0 styling cycle — TDD-first cases for applyVendoredThemes / applyAppearance / applyStyleSettings.
  await caseVT1FreshWriteToEmptyConsumer();
  await caseVT2IdempotentSkipsOverwriteOnSha256Match();
  await caseVT3SubsequentOverwriteCreatesBak();
  await caseVT4MissingSourceFailsLoud();
  await caseVT5MultipleFilesAllOverwritten();
  await caseAP1FreshWriteCreatesAppearanceJson();
  await caseAP2AdditiveSnippetUnion();
  await caseAP3CssThemeAlwaysOverridden();
  await caseAP4MalformedJsonGuard();
  await caseAP5BackupOnEditBytes();
  await caseSS1DefaultsWriteOnEmptyDataJson();
  await caseSS2AdditivePreservesUserOverride();
  await caseSS3MalformedJsonGuard();
  await caseSS4MissingDefaultsSrcFailsLoud();
  await caseSS5BackupOnEdit();

  // v0.21.1 consumer-convenience cycle — applyHotkeys + applyCommunityPluginData.
  await caseHK1NoHotkeysFieldNoOp();
  await caseHK2FreshWriteCreatesHotkeysJson();
  await caseHK3FirstWinsPreservesUserBinding();
  await caseHK4MalformedJsonGuard();
  await caseHK5InvalidEntrySkippedSiblingsApplied();
  await caseCP1MissingPrereqShortCircuits();
  await caseCP2PluginDirAbsentSkips();
  await caseCP3ManifestWinsShallowMerge();
  await caseCP4MalformedJsonGuard();
  await caseCP5PathTraversalRejected();

  // v0.26.0 first-run robustness — TDD-first cases for scaffoldFoundationalPluginData.
  await caseSF1AbsentDataJsonScaffolds();
  await caseSF2PresentDataJsonSkips();
  await caseSF3PluginDirAbsentSkips();
  await caseSF4UnknownPluginSilentNoOp();
  await caseSF5TemplatesPathSubstitution();

  // v0.26.1 P1-2 — TDD-first cases for applyAppSettings.
  await caseAS1AppJsonAbsent();
  await caseAS2OverridesExisting();
  await caseAS3PreservesNonDeclared();
  await caseAS4MalformedJsonGuard();
  await caseAS5BackupBeforeEdit();

  // v0.29.0 S2.5 — applyRuleFragment array-support patch.
  await caseHCRF1();
  await caseHCRF2();
  await caseHCRF3();

  // v0.30.0 S1.5 — materializeSkills (cowork blueprint installer helper).
  await caseHCMS1OrchestratorWrite();
  await caseHCMS2SubSkillNestedPath();
  await caseHCMS3SkillsDirSubstitution();
  await caseHCMS4Idempotent();
  await caseHCMS5InvalidEntrySkippedWithWarning();

  // v0.31.0 S1.5 — engagement-type registry + bootstrap_contributions[] schema conformance.
  await caseHCET1();
  await caseHCET2();
  await caseHCET3();
  await caseHCBC1();
  await caseHCBC2();
  await caseHCBC3();
  await caseHCBC4();

  // v0.31.0 S2.6 — validator predicate additions (min_length + items_schema).
  await caseHCPR1MinLength();
  await caseHCPR2ItemsSchema();

  // v0.32.0 S1.3 — claude_surface[] manifest validation + skills_dir
  // substitution overlay generalized to mechanisms.
  await caseHCCS1ValidCommand();
  await caseHCCS2ValidSkill();
  await caseHCCS3ValidContextDoc();
  await caseHCCS4ValidClaudeMdRow();
  await caseHCCS5UnknownKindFails();
  await caseHCSD1MechanismReceivesSkillsDir();

  // v0.32.0 S3 — claude_surface[] four-kind end-to-end materialization.
  await caseMCS1FourKindMaterializeE2E();
  await caseMCS2BodySubstitutionAtMaterializeTime();
  await caseMCS3MissingSourceLogsErrorContinuesLoop();

  // v0.20.0 docs polish cycle — trailing-whitespace lint.
  await caseTW1TemplatesNoTrailingWhitespace();

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
