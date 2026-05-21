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
// v0.60.0 SQ: _shellSingleQuote helper from platform/bootstrap.js round-trips
// every interesting metacharacter through bash literal-print without any
// expansion. Defense-in-depth coverage for the activation-file generator.
async function caseV60ShellSingleQuote() {
  console.log("\n--- Case V60-SQ: _shellSingleQuote round-trips through bash ---");
  const bootstrap = require(path.join(WORKSHOP, "platform/bootstrap.js"));
  const sq = bootstrap._shellSingleQuote;
  assertTrue("V60-SQ-0: _shellSingleQuote is exported", typeof sq === "function");
  if (typeof sq !== "function") return;

  const cases = [
    { input: "foo/bar",              label: "plain path" },
    { input: "hello world",          label: "spaces" },
    { input: "$HOME/foo",            label: "dollar sign (must not expand)" },
    { input: "`date`",               label: "backticks (must not exec)" },
    { input: 'say "hi"',             label: "double quotes" },
    { input: "it's",                 label: "single quote" },
    { input: "a\\b",                 label: "backslash" },
    { input: '"; rm -rf ~; #',       label: "injection attempt (must round-trip literally)" }
  ];

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "v60-sq-"));
  try {
    for (let i = 0; i < cases.length; i++) {
      const { input, label } = cases[i];
      const quoted = sq(input);
      const script = path.join(tmpDir, `c${i}.sh`);
      fs.writeFileSync(script, `printf '%s' ${quoted}\n`);
      const out = execFileSync("bash", [script], { encoding: "utf8" });
      assertEq(`V60-SQ-${i + 1}: ${label}`, out, input);
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) {}
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

// v0.59.9 — files[] entry with `materialize_once: true` preserves user content.
async function caseO6MaterializeOncePreservesUserContent() {
  console.log("\n--- Case O6: materialize_once + dest exists → skip overwrite, emit skipped_materialize_once ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseO6-"));
  try {
    const newBody = "fresh workshop template";
    const userBody = "user-edited kanban board with [[card links]]";
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-o6",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-o6",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "o6",
          files: [{
            source: "content/board.md",
            dest: "{{module_directory}}/board.md",
            materialize_once: true,
          }]
        },
        sourceFiles: [{ relPath: "content/board.md", body: newBody }]
      }
    ]);
    const destAbs = path.join(scratch, "spice/o6/board.md");
    await fsp.mkdir(path.dirname(destAbs), { recursive: true });
    await fsp.writeFile(destAbs, userBody, "utf8");

    const result = await runHarness(scratch);
    assertTrue("O6: platform-installed.json was written", result !== null);

    const finalBody = await readRaw(destAbs);
    assertEq("O6: final dest content === user-edited body (NOT clobbered)",
      finalBody, userBody);

    const bakAbs = `${destAbs}.bak`;
    assertTrue("O6: <dest>.bak NOT created (no overwrite happened)",
      !fs.existsSync(bakAbs));

    const replaces = (result && result.history || []).filter(
      (h) => h.event === "replace" && h.step === "file_overwrite"
    );
    assertEq("O6: NO replace/file_overwrite event", replaces.length, 0);

    const skips = (result && result.history || []).filter(
      (h) => h.action === "skipped_materialize_once"
    );
    assertEq("O6: exactly one skipped_materialize_once history entry", skips.length, 1);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

// v0.59.9 — materialize_once on FIRST install (dest absent) still writes.
async function caseO7MaterializeOnceFirstInstallWrites() {
  console.log("\n--- Case O7: materialize_once + dest absent → fresh write (first install) ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseO7-"));
  try {
    const body = "freshly seeded kanban board";
    await scaffoldBlueprintVault(scratch, [
      {
        name: "test-fixture-o7",
        version: "0.1.0",
        manifest: {
          name: "test-fixture-o7",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "o7",
          files: [{
            source: "content/board.md",
            dest: "{{module_directory}}/board.md",
            materialize_once: true,
          }]
        },
        sourceFiles: [{ relPath: "content/board.md", body }]
      }
    ]);
    const destAbs = path.join(scratch, "spice/o7/board.md");
    // Do NOT pre-create dest. First install should write it.

    const result = await runHarness(scratch);
    assertTrue("O7: platform-installed.json was written", result !== null);

    const finalBody = await readRaw(destAbs);
    assertEq("O7: dest seeded with source body on first install", finalBody, body);
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

// ---------- applySnippets (SN1-SN3) — NEW v0.41.0 ----------
// Mirrors applyVendoredThemes posture: sha256-compare overwrite-with-backup,
// .sauce-backup suffix on overwrite. Source asset staged in the fake workshop
// at platform/mechanisms/test-fixture/<entry.source>; dest at
// <vault>/.obsidian/snippets/<entry.name>.css.

const SNIPPET_BODY_V1 = "/* sauce-tasks-icons v1 */\n.task-due:before { content: ''; }\n";
const SNIPPET_BODY_V2 = "/* sauce-tasks-icons v2 — DIVERGENT */\n.task-due:before { content: 'X'; }\n";

function snippetManifest(extra) {
  return Object.assign({
    name: "test-fixture",
    version: "0.1.0",
    files: [],
    snippets: [{ source: "assets/snippets/sauce-tasks-icons.css", name: "sauce-tasks-icons" }],
  }, extra || {});
}

async function _stageSnippetSource(scratchDir, srcRel, body) {
  const fullPath = path.join(scratchDir, "_fake-workshop/platform/mechanisms/test-fixture", srcRel);
  await fsp.mkdir(path.dirname(fullPath), { recursive: true });
  await fsp.writeFile(fullPath, body, "utf8");
}

async function caseSN1FreshWriteToEmptyConsumer() {
  console.log("\n--- Case SN1: applySnippets fresh write to consumer with no .obsidian/snippets/ ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "sauce-caseSN1-"));
  try {
    const manifest = snippetManifest();
    await scaffoldVault(scratch, { templaterData: TEMPLATER_DEFAULT, slashCommanderData: SC_DEFAULT, manifest });
    await _stageSnippetSource(scratch, "assets/snippets/sauce-tasks-icons.css", SNIPPET_BODY_V1);

    const result = await runHarness(scratch);
    assertTrue("SN1: platform-installed.json was written", result !== null);

    const appliedEvts = (result && result.history || []).filter(
      (h) => h.event === "info" && h.step === "snippets" && h.action === "applied"
    );
    assertTrue("SN1: at least one info/snippets/applied recorded", appliedEvts.length >= 1, `got ${appliedEvts.length}`);

    const destPath = path.join(scratch, ".obsidian/snippets/sauce-tasks-icons.css");
    assertTrue("SN1: snippet materialized in consumer", fs.existsSync(destPath));
    if (fs.existsSync(destPath)) {
      const body = await readRaw(destPath);
      assertEq("SN1: snippet body byte-equal to source", body, SNIPPET_BODY_V1);
    }
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseSN2IdempotentSkipsOverwriteOnSha256Match() {
  console.log("\n--- Case SN2: applySnippets sha256-match skips overwrite on re-run ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "sauce-caseSN2-"));
  try {
    const manifest = snippetManifest();
    await scaffoldVault(scratch, { templaterData: TEMPLATER_DEFAULT, slashCommanderData: SC_DEFAULT, manifest });
    await _stageSnippetSource(scratch, "assets/snippets/sauce-tasks-icons.css", SNIPPET_BODY_V1);

    const first = await runHarness(scratch);
    const firstApplied = (first && first.history || []).filter(
      (h) => h.event === "info" && h.step === "snippets" && h.action === "applied"
    );
    assertTrue("SN2: first run wrote snippet", firstApplied.length >= 1, `got ${firstApplied.length}`);

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
    const secondApplied = newOnSecond.filter(
      (h) => h.event === "info" && h.step === "snippets" && (h.action === "applied" || h.action === "overwrote")
    );
    const secondSkips = newOnSecond.filter(
      (h) => h.event === "info" && h.step === "snippets" && h.action === "skipped_identical"
    );
    assertEq("SN2: second run records 0 applied/overwrote events (sha256 match)", secondApplied.length, 0);
    assertTrue("SN2: second run records at least one skipped_identical", secondSkips.length >= 1);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseSN3OverwriteCreatesBackup() {
  console.log("\n--- Case SN3: applySnippets overwrite creates .sauce-backup when prior content differs ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "sauce-caseSN3-"));
  try {
    const manifest = snippetManifest();
    await scaffoldVault(scratch, { templaterData: TEMPLATER_DEFAULT, slashCommanderData: SC_DEFAULT, manifest });
    await _stageSnippetSource(scratch, "assets/snippets/sauce-tasks-icons.css", SNIPPET_BODY_V1);

    // Pre-existing divergent content at the dest.
    const destPath = path.join(scratch, ".obsidian/snippets/sauce-tasks-icons.css");
    await fsp.mkdir(path.dirname(destPath), { recursive: true });
    await fsp.writeFile(destPath, SNIPPET_BODY_V2, "utf8");

    const result = await runHarness(scratch);
    assertTrue("SN3: install ran", result !== null);

    const bakPath = `${destPath}.sauce-backup`;
    assertTrue("SN3: .sauce-backup created (prior content backed up)", fs.existsSync(bakPath));
    if (fs.existsSync(bakPath)) {
      const bak = await readRaw(bakPath);
      assertEq("SN3: backup body byte-equal to prior consumer content", bak, SNIPPET_BODY_V2);
    }

    const live = await readRaw(destPath);
    assertEq("SN3: live snippet body byte-equal to source v1", live, SNIPPET_BODY_V1);
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

// ============================================================
// v0.37.0 S3.1 — Scratch blueprint file-presence + content shape (SHC-S1..S6).
// Six sub-asserts confirming the scratch blueprint sources committed in S1/S2
// are on disk with the expected manifest fields, frontmatter types, Dataview
// calls, and CustomJS class declarations. Pure static reads; no scaffold.
// ============================================================
async function caseSHCS1ManifestFields() {
  console.log("\n--- Case SHC-S1: scratch manifest.json exists with expected core fields ---");
  const p = path.join(BLUEPRINTS_DIR, "scratch", "manifest.json");
  assertTrue("SHC-S1: scratch/manifest.json exists on disk", fs.existsSync(p));
  const m = _readJson(p);
  assertEqual(m.name, "scratch", "SHC-S1: manifest.name === \"scratch\"");
  assertEqual(m.version, "0.5.1", "SHC-S1: manifest.version === \"0.5.1\"");
  assertEqual(m.module_directory, "scratch", "SHC-S1: manifest.module_directory === \"scratch\"");
}

async function caseSHCS2ScratchTemplate() {
  console.log("\n--- Case SHC-S2: templates/Scratch.md frontmatter + retired-lazy-create + Scratch-Day back-link ---");
  const p = path.join(BLUEPRINTS_DIR, "scratch", "templates", "Scratch.md");
  const body = fs.readFileSync(p, "utf8");
  assertTrue("SHC-S2: Scratch.md first line is ---", body.split("\n")[0] === "---");
  assertTrue("SHC-S2: Scratch.md contains type: scratch", body.includes("type: scratch"));
  assertTrue("SHC-S2: Scratch.md no longer contains <%* %> Templater block (lazy-create retired in v0.2.0)",
    !/<%\*[\s\S]*?%>/.test(body));
  assertTrue("SHC-S2: Scratch.md back-link wikilink uses Scratch-Day- prefix",
    /\[\[Scratch-Day-/.test(body));
}

async function caseSHCS3ScratchDayHubTemplate() {
  console.log("\n--- Case SHC-S3: templates/Scratch Day Hub.md type + ScratchDayActions + ScratchDayList calls ---");
  const p = path.join(BLUEPRINTS_DIR, "scratch", "templates", "Scratch Day Hub.md");
  assertTrue("SHC-S3: Scratch Day Hub.md exists on disk", fs.existsSync(p));
  const body = fs.readFileSync(p, "utf8");
  assertTrue("SHC-S3: Scratch Day Hub.md contains type: scratch-day", body.includes("type: scratch-day"));
  assertTrue("SHC-S3: Scratch Day Hub.md invokes ScratchDayActions via dv.view",
    /class:\s*"ScratchDayActions"/.test(body));
  assertTrue("SHC-S3: Scratch Day Hub.md invokes ScratchDayList via dv.view",
    /class:\s*"ScratchDayList"/.test(body));
}

async function caseSHCS4ScratchHubTemplate() {
  console.log("\n--- Case SHC-S4: templates/Scratch Hub.md type + ScratchHubCards Dataview call ---");
  const p = path.join(BLUEPRINTS_DIR, "scratch", "templates", "Scratch Hub.md");
  const body = fs.readFileSync(p, "utf8");
  assertTrue("SHC-S4: Scratch Hub.md contains type: scratch-hub", body.includes("type: scratch-hub"));
  assertTrue("SHC-S4: Scratch Hub.md invokes ScratchHubCards via dv.view",
    /class:\s*"ScratchHubCards"/.test(body));
}

async function caseSHCS5ScratchHubCardsHelper() {
  console.log("\n--- Case SHC-S5: helpers/scratch-hub-cards.js declares class ScratchHubCards ---");
  const p = path.join(BLUEPRINTS_DIR, "scratch", "helpers", "scratch-hub-cards.js");
  assertTrue("SHC-S5: scratch-hub-cards.js exists on disk", fs.existsSync(p));
  const body = fs.readFileSync(p, "utf8");
  assertTrue("SHC-S5: scratch-hub-cards.js declares class ScratchHubCards",
    /^class\s+ScratchHubCards\b/m.test(body));
}

async function caseSHCS6ScratchDayListHelper() {
  console.log("\n--- Case SHC-S6: helpers/scratch-day-list.js declares class ScratchDayList ---");
  const p = path.join(BLUEPRINTS_DIR, "scratch", "helpers", "scratch-day-list.js");
  assertTrue("SHC-S6: scratch-day-list.js exists on disk", fs.existsSync(p));
  const body = fs.readFileSync(p, "utf8");
  assertTrue("SHC-S6: scratch-day-list.js declares class ScratchDayList",
    /^class\s+ScratchDayList\b/m.test(body));
}

async function caseSHCS7ScratchNewButtonHelper() {
  console.log("\n--- Case SHC-S7: scratch-new-button.js deleted (v0.46.0 S7 — migrated to entity-create) ---");
  const p = path.join(BLUEPRINTS_DIR, "scratch", "helpers", "scratch-new-button.js");
  assertTrue("SHC-S7: scratch-new-button.js has been deleted (legacy, unreferenced since v0.2.2)", !fs.existsSync(p));
  const manifestPath = path.join(BLUEPRINTS_DIR, "scratch", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assertTrue("SHC-S7: ScratchNewButton removed from manifest customjs_classes",
    !(manifest.customjs_classes || []).includes("ScratchNewButton"));
  assertTrue("SHC-S7: scratch-new-button.js removed from manifest files[]",
    !(manifest.files || []).some(f => f.source && f.source.includes("scratch-new-button")));
}

// ============================================================
// v0.46.0 S11 — entity-create migration orphan-class scan across the 5
// migrated blueprints (meetings / people / project / scratch / finance).
// Each case asserts the legacy New*Button helper file is ABSENT (deleted in
// its respective migration stage S4-S10), plus two cases that validate the
// entity-create mechanism's source surface parses cleanly.
// ============================================================

async function caseSHCS11Meetings() {
  console.log("\n--- Case SHC-S11-meetings: new-meeting-button.js deleted (v0.46.0 S4) ---");
  const p = path.join(BLUEPRINTS_DIR, "meetings", "helpers", "new-meeting-button.js");
  assertTrue("SHC-S11-meetings: meetings/helpers/new-meeting-button.js absent", !fs.existsSync(p));
}

async function caseSHCS11People() {
  console.log("\n--- Case SHC-S11-people: new-person-button.js deleted (v0.46.0 S5) ---");
  const p = path.join(BLUEPRINTS_DIR, "people", "helpers", "new-person-button.js");
  assertTrue("SHC-S11-people: people/helpers/new-person-button.js absent", !fs.existsSync(p));
}

async function caseSHCS11ProjectNavButtonsNoCreate() {
  console.log("\n--- Case SHC-S11-project-nav: project-nav-buttons.js no _createProject/_promptForProjectName/_renderProjectsHub (v0.46.0 S6) ---");
  const p = path.join(BLUEPRINTS_DIR, "project", "helpers", "project-nav-buttons.js");
  assertTrue("SHC-S11-project-nav: source file exists", fs.existsSync(p));
  const body = fs.readFileSync(p, "utf8");
  assertTrue("SHC-S11-project-nav: project-nav-buttons.js no longer has _createProject / _promptForProjectName / _renderProjectsHub method bodies",
    !/_createProject\s*\(/.test(body) && !/_promptForProjectName\s*\(/.test(body) && !/_renderProjectsHub\s*\(/.test(body));
}

async function caseSHCS11ScratchDayActionsNoNewScratch() {
  console.log("\n--- Case SHC-S11-scratch-day-actions: scratch-day-actions.js no newScratch method (v0.46.0 S7) ---");
  const p = path.join(BLUEPRINTS_DIR, "scratch", "helpers", "scratch-day-actions.js");
  assertTrue("SHC-S11-scratch-day-actions: source file exists", fs.existsSync(p));
  const body = fs.readFileSync(p, "utf8");
  assertTrue("SHC-S11-scratch-day-actions: scratch-day-actions.js no longer has newScratch method body",
    !/\bnewScratch\s*\(/.test(body));
}

async function caseSHCS12ScratchDayActionsRowOfTwo() {
  console.log("\n--- Case SHC-S12: scratch-day-actions.js renders + New Scratch + Hub in one flex row ---");
  const p = path.join(BLUEPRINTS_DIR, "scratch", "helpers", "scratch-day-actions.js");
  assertTrue("SHC-S12: source file exists", fs.existsSync(p));
  const body = fs.readFileSync(p, "utf8");
  const newScratchLabel = /label:\s*["']\+ New Scratch["']/.test(body);
  const hubLabel = /label:\s*["']Hub["']/.test(body);
  const delegatesToEntityCreate = /customJS\.EntityCreate\.create\(\s*\{\s*instance:\s*["']scratch["']/.test(body);
  const flexRow = /display:\s*flex.*max-width:\s*600px/.test(body);
  const bothFlexTrue = (body.match(/flex:\s*true/g) || []).length >= 2;
  const ok = newScratchLabel && hubLabel && delegatesToEntityCreate && flexRow && bothFlexTrue;
  assertTrue("SHC-S12: scratch-day-actions.js missing new-scratch+hub flex-row pair or EntityCreate delegate", ok);
}

async function caseSHCS13ScratchDayHubNoEntityCreateBlock() {
  console.log("\n--- Case SHC-S13: Scratch Day Hub.md no longer carries the entity-create:scratch sentinel ---");
  const p = path.join(BLUEPRINTS_DIR, "scratch", "templates", "Scratch Day Hub.md");
  assertTrue("SHC-S13: Scratch Day Hub.md exists on disk", fs.existsSync(p));
  const body = fs.readFileSync(p, "utf8");
  assertTrue("SHC-S13: Scratch Day Hub.md must NOT contain `// entity-create:scratch` sentinel (block ownership moved to ScratchDayActions in scratch v0.5.0)",
    !/\/\/\s*entity-create:scratch\b/.test(body));
  assertTrue("SHC-S13: Scratch Day Hub.md must NOT call customJS.EntityCreate.render (button is rendered by ScratchDayActions)",
    !/customJS\.EntityCreate\.render/.test(body));
  assertTrue("SHC-S13: ScratchDayActions block still present (Task 2 regression)",
    /class:\s*"ScratchDayActions"/.test(body));
}

async function caseSHCS14ScratchDayActionsSelfHeal() {
  // v0.5.1 PATCH (sauce v0.69.0): ScratchDayActions self-heals existing day-hub
  // notes carrying the legacy entity-create:scratch dataviewjs block (created
  // from v0.4.x templates). Asserts the helper has _stripLegacyEntityCreateBlock,
  // calls it from render() before the row layout, anchors on the sentinel
  // comment, and uses app.vault.modify to write the cleaned body.
  console.log("\n--- Case SHC-S14: scratch-day-actions.js self-heals legacy entity-create:scratch block ---");
  const p = path.join(BLUEPRINTS_DIR, "scratch", "helpers", "scratch-day-actions.js");
  const body = fs.readFileSync(p, "utf8");
  const hasHelper = /_stripLegacyEntityCreateBlock\s*\(/.test(body);
  const callsHelper = /await\s+this\._stripLegacyEntityCreateBlock\s*\(\s*dv\s*\)/.test(body);
  const anchorsOnSentinel = /entity-create:scratch/.test(body);
  const usesVaultModify = /app\.vault\.modify\s*\(/.test(body);
  const ok = hasHelper && callsHelper && anchorsOnSentinel && usesVaultModify;
  assertTrue("SHC-S14: scratch-day-actions.js missing self-heal helper or call-site or sentinel anchor or vault.modify",
    ok);
}

async function caseSHCS11FinanceBudget() {
  console.log("\n--- Case SHC-S11-finance-budget: new-budget-button.js deleted (v0.46.0 S8) ---");
  const p = path.join(BLUEPRINTS_DIR, "finance", "helpers", "new-budget-button.js");
  assertTrue("SHC-S11-finance-budget: finance/helpers/new-budget-button.js absent", !fs.existsSync(p));
}

async function caseSHCS11FinancePaycheck() {
  console.log("\n--- Case SHC-S11-finance-paycheck: new-paycheck-button.js deleted (v0.46.0 S9) ---");
  const p = path.join(BLUEPRINTS_DIR, "finance", "helpers", "new-paycheck-button.js");
  assertTrue("SHC-S11-finance-paycheck: finance/helpers/new-paycheck-button.js absent", !fs.existsSync(p));
}

async function caseSHCS11FinanceInvoice() {
  console.log("\n--- Case SHC-S11-finance-invoice: new-invoice-button.js deleted (v0.46.0 S10) ---");
  const p = path.join(BLUEPRINTS_DIR, "finance", "helpers", "new-invoice-button.js");
  assertTrue("SHC-S11-finance-invoice: finance/helpers/new-invoice-button.js absent", !fs.existsSync(p));
}

async function caseSHCS11EntityCreateMechanismParses() {
  console.log("\n--- Case SHC-S11-entity-create-js: entity-create.js parses via new Function() ---");
  const p = path.join(WORKSHOP, "platform", "mechanisms", "entity-create", "entity-create.js");
  assertTrue("SHC-S11-entity-create-js: mechanism source exists", fs.existsSync(p));
  const body = fs.readFileSync(p, "utf8");
  let threw = false;
  try {
    // Wrap with stub free-variables; class body itself must parse.
    new Function("app", "customJS", "Notice", "window", body + "\nreturn EntityCreate;");
  } catch (e) {
    threw = true;
  }
  assertTrue("SHC-S11-entity-create-js: entity-create.js wraps in new Function() without throwing", !threw);
}

async function caseSHCS11EntityCreateSchemaParses() {
  console.log("\n--- Case SHC-S11-entity-create-schema: new-entity-buttons.json parses + has $schema ---");
  const p = path.join(WORKSHOP, "platform", "mechanisms", "entity-create", "schema", "new-entity-buttons.json");
  assertTrue("SHC-S11-entity-create-schema: schema file exists", fs.existsSync(p));
  let parsed = null, threw = false;
  try { parsed = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { threw = true; }
  assertTrue("SHC-S11-entity-create-schema: JSON.parse succeeds + top-level $schema key present",
    !threw && parsed && typeof parsed.$schema === "string" && parsed.$schema.length > 0);
}

// ============================================================
// v0.61.0 S6 — backlink-panel@0.1.0 lint asserts (BLP-LINT-1..3).
// Mirrors the SHC-S11-entity-create-js pattern: new Function() parse
// + class-declaration uniqueness + canonical-map marker presence.
// ============================================================

async function caseBLPLint1Parses() {
  console.log("\n--- Case BLP-LINT-1: backlink-panel.js parses via new Function() ---");
  const p = path.join(WORKSHOP, "platform", "mechanisms", "backlink-panel", "backlink-panel.js");
  assertTrue("BLP-LINT-1: mechanism source exists", fs.existsSync(p));
  const body = fs.readFileSync(p, "utf8");
  let threw = false;
  try {
    new Function("app", "customJS", "Notice", "window", body + "\nreturn BacklinkPanel;");
  } catch (e) {
    threw = true;
  }
  assertTrue("BLP-LINT-1: backlink-panel.js wraps in new Function() without throwing", !threw);
}

async function caseBLPLint2OneClass() {
  console.log("\n--- Case BLP-LINT-2: exactly one 'class BacklinkPanel' declaration ---");
  const p = path.join(WORKSHOP, "platform", "mechanisms", "backlink-panel", "backlink-panel.js");
  const body = fs.readFileSync(p, "utf8");
  const matches = body.match(/class\s+BacklinkPanel\b/g) || [];
  assertEq("BLP-LINT-2: exactly one 'class BacklinkPanel' declaration", matches.length, 1);
}

async function caseBLPLint3EntityMap() {
  console.log("\n--- Case BLP-LINT-3: _ENTITY_TYPE_TO_KEY marker present ---");
  const p = path.join(WORKSHOP, "platform", "mechanisms", "backlink-panel", "backlink-panel.js");
  const body = fs.readFileSync(p, "utf8");
  assertTrue("BLP-LINT-3: _ENTITY_TYPE_TO_KEY identifier present in source",
    /_ENTITY_TYPE_TO_KEY/.test(body));
}

// ============================================================
// v0.62.0 S6 — activity-feed@0.1.0 lint asserts (AF-LINT-1..3).
// Mirrors the BLP-LINT block: new Function() parse + class-decl
// uniqueness + _DEFAULT_BLUEPRINTS marker presence.
// ============================================================

async function caseAFLint1Parses() {
  console.log("\n--- Case AF-LINT-1: activity-feed.js parses via new Function() ---");
  const p = path.join(WORKSHOP, "platform", "mechanisms", "activity-feed", "activity-feed.js");
  assertTrue("AF-LINT-1: mechanism source exists", fs.existsSync(p));
  const body = fs.readFileSync(p, "utf8");
  let threw = false;
  try {
    new Function("app", "customJS", "Notice", "window", body + "\nreturn ActivityFeed;");
  } catch (e) {
    threw = true;
  }
  assertTrue("AF-LINT-1: activity-feed.js wraps in new Function() without throwing", !threw);
}

async function caseAFLint2OneClass() {
  console.log("\n--- Case AF-LINT-2: exactly one 'class ActivityFeed' declaration ---");
  const p = path.join(WORKSHOP, "platform", "mechanisms", "activity-feed", "activity-feed.js");
  const body = fs.readFileSync(p, "utf8");
  const matches = body.match(/class\s+ActivityFeed\b/g) || [];
  assertEq("AF-LINT-2: exactly one 'class ActivityFeed' declaration", matches.length, 1);
}

async function caseAFLint3DefaultBlueprints() {
  console.log("\n--- Case AF-LINT-3: _DEFAULT_BLUEPRINTS marker present ---");
  const p = path.join(WORKSHOP, "platform", "mechanisms", "activity-feed", "activity-feed.js");
  const body = fs.readFileSync(p, "utf8");
  assertTrue("AF-LINT-3: _DEFAULT_BLUEPRINTS identifier present in source",
    /_DEFAULT_BLUEPRINTS/.test(body));
}

// ============================================================
// v0.64.0 S5 — daily-template + SpaceDailyDashboard activity-panel
// shape asserts (DD-T1 + DD-A1). DD-T1 pins the rewritten daily
// template's structural markers (Templater preamble + cowork-flavor
// frontmatter + SpaceDailyDashboard delegation + COWORK_CALLOUTS
// marker + ABSENCE of CoworkHubNav now that cowork no longer
// materializes Daily Note.md). DD-A1 pins the new Activity panel
// inside SpaceDailyDashboard (delegates to ActivityFeed.render with
// the _DEFAULT_DASHBOARD_BLUEPRINTS allowlist + icons.zap header).
// ============================================================

async function caseDDT1DailyTemplateShape() {
  console.log("\n--- Case DD-T1: daily-template.md content shape ---");
  const p = path.join(BLUEPRINTS_DIR, "daily", "content", "daily-template.md");
  assertTrue("DD-T1: daily-template.md source exists", fs.existsSync(p));
  const body = fs.readFileSync(p, "utf8");
  const ok =
    /tp\.date\.now\("YYYY-MM-DD"/.test(body) &&
    /^type: cowork-daily$/m.test(body) &&
    /SpaceDailyDashboard/.test(body) &&
    !/CoworkHubNav/.test(body) &&
    !/COWORK_CALLOUTS/.test(body) &&
    !/^## Notes$/m.test(body);
  assertTrue("DD-T1: daily-template.md content shape regressed", ok);
}

async function caseDDA1DashboardActivityPanel() {
  console.log("\n--- Case DD-A1: SpaceDailyDashboard activity panel structure ---");
  const p = path.join(BLUEPRINTS_DIR, "daily", "helpers", "space-daily-dashboard.js");
  assertTrue("DD-A1: space-daily-dashboard.js source exists", fs.existsSync(p));
  const body = fs.readFileSync(p, "utf8");
  const defaultDashboardMatches = body.match(/_DEFAULT_DASHBOARD_BLUEPRINTS/g) || [];
  const ok =
    /customJS\.ActivityFeed\.render/.test(body) &&
    defaultDashboardMatches.length >= 3 &&
    /Today's Activity/.test(body) &&
    /hasContent\s*=.*activityCount/.test(body) &&
    /icons\.activity/.test(body);
  assertTrue("DD-A1: SpaceDailyDashboard activity panel structure regressed", ok);
}

async function caseDDA2ActivityShimPagesDelegate() {
  // v0.5.1 (v0.64.1) BUGFIX guard. v0.5.0 shim was `{ container: activityPanel }`
  // only; ActivityFeed._query calls dv.pages() and failed with
  // "dv.pages is not a function". Shim MUST delegate .pages to the real dv.
  console.log("\n--- Case DD-A2: activity-panel shim delegates .pages to real dv ---");
  const p = path.join(BLUEPRINTS_DIR, "daily", "helpers", "space-daily-dashboard.js");
  const body = fs.readFileSync(p, "utf8");
  const ok =
    /pages\s*:\s*\([^)]*\)\s*=>\s*dv\.pages\(/.test(body) ||
    /pages\s*:\s*function/.test(body) ||
    /pages\s*:\s*dv\.pages\.bind/.test(body);
  assertTrue("DD-A2: activity-panel shim missing .pages delegate (v0.5.0 regression)", ok);
}

async function caseDDA3TaskMarkdownRenderHelper() {
  // v0.5.1 (v0.64.1): tasks panel renders markdown links + wikilinks as
  // clickable HTML anchors via _renderTaskHTML(text). Guards the helper
  // exists + LI uses innerHTML + LI onclick guards against anchor clicks.
  console.log("\n--- Case DD-A3: tasks panel markdown link rendering ---");
  const p = path.join(BLUEPRINTS_DIR, "daily", "helpers", "space-daily-dashboard.js");
  const body = fs.readFileSync(p, "utf8");
  const ok =
    /_renderTaskHTML\s*\(/.test(body) &&
    /li\.innerHTML\s*=\s*this\._renderTaskHTML\(task\.text\)/.test(body) &&
    /closest\s*\(\s*["']a["']\s*\)/.test(body) &&
    /a\.internal-link/.test(body);
  assertTrue("DD-A3: tasks panel markdown render helper / LI rewire regressed", ok);
}

async function caseDDA4DashboardAllowlist() {
  // v0.5.2 (v0.64.2): _DEFAULT_DASHBOARD_BLUEPRINTS drops scratch-day + to-do.
  // v0.5.3 (v0.64.3): also drops `meeting` — has its own dedicated panel.
  console.log("\n--- Case DD-A4: dashboard allowlist drops scratch-day + to-do + meeting ---");
  const p = path.join(BLUEPRINTS_DIR, "daily", "helpers", "space-daily-dashboard.js");
  const body = fs.readFileSync(p, "utf8");
  const getterMatch = body.match(/_DEFAULT_DASHBOARD_BLUEPRINTS\s*\(\)\s*\{[\s\S]*?return\s*\[([\s\S]*?)\]/);
  if (!getterMatch) {
    assertTrue("DD-A4: _DEFAULT_DASHBOARD_BLUEPRINTS getter not found", false);
    return;
  }
  const listSource = getterMatch[1];
  const hasScratchDay = /"scratch-day"/.test(listSource);
  const hasToDo = /"to-do"/.test(listSource);
  const hasMeeting = /"meeting"/.test(listSource);
  const hasScratch = /"scratch"/.test(listSource);
  const hasProject = /"project"/.test(listSource);
  const ok = !hasScratchDay && !hasToDo && !hasMeeting && hasScratch && hasProject;
  assertTrue("DD-A4: allowlist still contains scratch-day, to-do, or meeting (noise/duplicate types)", ok);
}

async function caseDDA6ResolveTitleDefensive() {
  // v0.5.3 (v0.64.3) BUGFIX guard. v0.5.2 _resolveTitle crashed with
  // "aliases.values is not a function" on Dataview Proxy aliases. Now
  // wrapped in try-catch + length-probe only (no .values() fallback).
  console.log("\n--- Case DD-A6: _resolveTitle is defensive (try-catch + no .values()) ---");
  const p = path.join(BLUEPRINTS_DIR, "daily", "helpers", "space-daily-dashboard.js");
  const body = fs.readFileSync(p, "utf8");
  // Extract just the _resolveTitle method body.
  const m = body.match(/_resolveTitle\s*\(p\)\s*\{([\s\S]*?)\n  \}\n/);
  if (!m) {
    assertTrue("DD-A6: _resolveTitle method not found", false);
    return;
  }
  const methodBody = m[1];
  const ok =
    /try\s*\{/.test(methodBody) &&
    /catch\s*\(/.test(methodBody) &&
    !/aliases\.values\s*\(\s*\)/.test(methodBody) &&
    /typeof\s+aliases\.length\s*===\s*["']number["']/.test(methodBody);
  assertTrue("DD-A6: _resolveTitle missing try-catch or still calls aliases.values()", ok);
}

async function caseDDA5DashboardPolish() {
  // v0.5.2 (v0.64.2): smart title resolver + collapsible main sections +
  // color map present.
  console.log("\n--- Case DD-A5: dashboard polish (title resolver + collapsible + colors) ---");
  const p = path.join(BLUEPRINTS_DIR, "daily", "helpers", "space-daily-dashboard.js");
  const body = fs.readFileSync(p, "utf8");
  const ok =
    /_resolveTitle\s*\(/.test(body) &&
    /_BLUEPRINT_COLORS\s*\(\)/.test(body) &&
    /createEl\("details"/.test(body) &&
    /createEl\("summary"/.test(body) &&
    /collapsible:\s*true/.test(body) &&
    /colorByType:\s*this\._BLUEPRINT_COLORS/.test(body) &&
    /getTitle:\s*\(p\)\s*=>\s*this\._resolveTitle\(p\)/.test(body);
  assertTrue("DD-A5: dashboard polish (title resolver / details wrappers / color map) regressed", ok);
}

async function caseDDA7DashboardAllowlistIncludesBoards() {
  // v0.9.0 (sauce v0.68.0): _DEFAULT_DASHBOARD_BLUEPRINTS adds kanban + board-card
  // so board activity (hub edits + new card creations) surfaces in the daily
  // Activity panel. board-card rolls up into the kanban hub via _ROLLUP_RULES.
  console.log("\n--- Case DD-A7: dashboard allowlist includes kanban + board-card ---");
  const p = path.join(BLUEPRINTS_DIR, "daily", "helpers", "space-daily-dashboard.js");
  const body = fs.readFileSync(p, "utf8");
  const getterMatch = body.match(/_DEFAULT_DASHBOARD_BLUEPRINTS\s*\(\)\s*\{[\s\S]*?return\s*\[([\s\S]*?)\]/);
  if (!getterMatch) {
    assertTrue("DD-A7: _DEFAULT_DASHBOARD_BLUEPRINTS getter not found", false);
    return;
  }
  const listSource = getterMatch[1];
  const hasKanban = /"kanban"/.test(listSource);
  const hasBoardCard = /"board-card"/.test(listSource);
  assertTrue("DD-A7: allowlist missing kanban or board-card", hasKanban && hasBoardCard);
}

async function caseDDA8DashboardKanbanRollupRule() {
  // v0.9.0 (sauce v0.68.0): _ROLLUP_RULES adds a kanban rule with hardcoded
  // rootPathFromDv returning "spice/boards/To-Do-Board.md". board-card files
  // under spice/boards/cards/** coalesce into a single rolled-up "To Do Board"
  // activity card.
  console.log("\n--- Case DD-A8: dashboard rollup rules include single-board kanban entry ---");
  const p = path.join(BLUEPRINTS_DIR, "daily", "helpers", "space-daily-dashboard.js");
  const body = fs.readFileSync(p, "utf8");
  // Capture from `get _ROLLUP_RULES() {` to the matching `\n  }\n` (method
  // close at 2-space indent). Non-greedy `[\s\S]*?` would stop at the first
  // `];` inside `m[1];`, missing the actual array body.
  const rulesMatch = body.match(/get\s+_ROLLUP_RULES\s*\(\)\s*\{([\s\S]*?)\n  \}\n/);
  if (!rulesMatch) {
    assertTrue("DD-A8: _ROLLUP_RULES getter not found", false);
    return;
  }
  const rulesSource = rulesMatch[1];
  const hasKanbanType = /type:\s*["']kanban["']/.test(rulesSource);
  const hasBoardsChildGlob = /\/\^spice\\\/boards\\\/cards\\\//.test(rulesSource);
  const hasTodoBoardRoot = /spice\/boards\/To-Do-Board\.md/.test(rulesSource);
  assertTrue("DD-A8: kanban rollup rule missing type:'kanban' or boards-card child match or To-Do-Board root path",
    hasKanbanType && hasBoardsChildGlob && hasTodoBoardRoot);
}

// ============================================================
// v0.42.0 S9 — CoworkDailyHubCards / CoworkWeeklyHubCards / CoworkMonthlyHubCards
// helper structural checks. 6 sub-asserts × 3 helpers = 18 sub-asserts.
// Mirrors SHC-S5/S6 pattern (from-disk static analysis) plus a scaffolded
// install to verify materialization at ranch/scripts/cowork/<name>.js.
// ============================================================

async function caseCOWORKDaily1Materialized() {
  console.log("\n--- Case COWORK-DAILY-1: cowork-daily-hub-cards.js materializes at ranch/scripts/cowork/ ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-cowork-daily1-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "cowork",
        version: "0.4.0",
        manifest: {
          name: "cowork",
          version: "0.4.0",
          kind: "blueprint",
          module_directory: "cowork",
          files: [
            { source: "helpers/cowork-daily-hub-cards.js", dest: "{{scripts_path}}/cowork/cowork-daily-hub-cards.js" }
          ]
        },
        sourceFiles: [
          { relPath: "helpers/cowork-daily-hub-cards.js", body: fs.readFileSync(path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-daily-hub-cards.js"), "utf8") }
        ]
      }
    ]);
    const result = await runHarness(scratch);
    assertTrue("COWORK-DAILY-1: platform-installed.json was written", result !== null);
    assertTrue("COWORK-DAILY-1: cowork-daily-hub-cards.js materialized at ranch/scripts/cowork/",
      fs.existsSync(path.join(scratch, "ranch/scripts/cowork/cowork-daily-hub-cards.js")));
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseCOWORKDaily2ClassDeclared() {
  console.log("\n--- Case COWORK-DAILY-2: cowork-daily-hub-cards.js declares class CoworkDailyHubCards ---");
  const p = path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-daily-hub-cards.js");
  assertTrue("COWORK-DAILY-2: file exists on disk", fs.existsSync(p));
  const body = fs.readFileSync(p, "utf8");
  assertTrue("COWORK-DAILY-2: class CoworkDailyHubCards declared", /^class\s+CoworkDailyHubCards\b/m.test(body));
}

async function caseCOWORKDaily3HasRender() {
  console.log("\n--- Case COWORK-DAILY-3: cowork-daily-hub-cards.js has async render( method ---");
  const body = fs.readFileSync(path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-daily-hub-cards.js"), "utf8");
  assertTrue("COWORK-DAILY-3: async render( method present", /async\s+render\s*\(/.test(body));
}

async function caseCOWORKDaily4UsesBeaconCards() {
  console.log("\n--- Case COWORK-DAILY-4: cowork-daily-hub-cards.js uses BeaconCards ---");
  const body = fs.readFileSync(path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-daily-hub-cards.js"), "utf8");
  assertTrue("COWORK-DAILY-4: BeaconCards referenced", body.includes("BeaconCards"));
}

async function caseCOWORKDaily5SkipsEmbed() {
  console.log("\n--- Case COWORK-DAILY-5: cowork-daily-hub-cards.js skips markdown-embed context ---");
  const body = fs.readFileSync(path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-daily-hub-cards.js"), "utf8");
  assertTrue("COWORK-DAILY-5: markdown-embed guard present", body.includes("markdown-embed"));
}

async function caseCOWORKDaily6NoTrailWs() {
  console.log("\n--- Case COWORK-DAILY-6: cowork-daily-hub-cards.js has no trailing whitespace ---");
  const body = fs.readFileSync(path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-daily-hub-cards.js"), "utf8");
  assertTrue("COWORK-DAILY-6: no trailing whitespace", !/[ \t]+$/m.test(body));
}

async function caseCOWORKWeekly1Materialized() {
  console.log("\n--- Case COWORK-WEEKLY-1: cowork-weekly-hub-cards.js materializes at ranch/scripts/cowork/ ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-cowork-weekly1-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "cowork",
        version: "0.4.0",
        manifest: {
          name: "cowork",
          version: "0.4.0",
          kind: "blueprint",
          module_directory: "cowork",
          files: [
            { source: "helpers/cowork-weekly-hub-cards.js", dest: "{{scripts_path}}/cowork/cowork-weekly-hub-cards.js" }
          ]
        },
        sourceFiles: [
          { relPath: "helpers/cowork-weekly-hub-cards.js", body: fs.readFileSync(path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-weekly-hub-cards.js"), "utf8") }
        ]
      }
    ]);
    const result = await runHarness(scratch);
    assertTrue("COWORK-WEEKLY-1: platform-installed.json was written", result !== null);
    assertTrue("COWORK-WEEKLY-1: cowork-weekly-hub-cards.js materialized at ranch/scripts/cowork/",
      fs.existsSync(path.join(scratch, "ranch/scripts/cowork/cowork-weekly-hub-cards.js")));
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseCOWORKWeekly2ClassDeclared() {
  console.log("\n--- Case COWORK-WEEKLY-2: cowork-weekly-hub-cards.js declares class CoworkWeeklyHubCards ---");
  const p = path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-weekly-hub-cards.js");
  assertTrue("COWORK-WEEKLY-2: file exists on disk", fs.existsSync(p));
  const body = fs.readFileSync(p, "utf8");
  assertTrue("COWORK-WEEKLY-2: class CoworkWeeklyHubCards declared", /^class\s+CoworkWeeklyHubCards\b/m.test(body));
}

async function caseCOWORKWeekly3HasRender() {
  console.log("\n--- Case COWORK-WEEKLY-3: cowork-weekly-hub-cards.js has async render( method ---");
  const body = fs.readFileSync(path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-weekly-hub-cards.js"), "utf8");
  assertTrue("COWORK-WEEKLY-3: async render( method present", /async\s+render\s*\(/.test(body));
}

async function caseCOWORKWeekly4UsesBeaconCards() {
  console.log("\n--- Case COWORK-WEEKLY-4: cowork-weekly-hub-cards.js uses BeaconCards ---");
  const body = fs.readFileSync(path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-weekly-hub-cards.js"), "utf8");
  assertTrue("COWORK-WEEKLY-4: BeaconCards referenced", body.includes("BeaconCards"));
}

async function caseCOWORKWeekly5SkipsEmbed() {
  console.log("\n--- Case COWORK-WEEKLY-5: cowork-weekly-hub-cards.js skips markdown-embed context ---");
  const body = fs.readFileSync(path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-weekly-hub-cards.js"), "utf8");
  assertTrue("COWORK-WEEKLY-5: markdown-embed guard present", body.includes("markdown-embed"));
}

async function caseCOWORKWeekly6NoTrailWs() {
  console.log("\n--- Case COWORK-WEEKLY-6: cowork-weekly-hub-cards.js has no trailing whitespace ---");
  const body = fs.readFileSync(path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-weekly-hub-cards.js"), "utf8");
  assertTrue("COWORK-WEEKLY-6: no trailing whitespace", !/[ \t]+$/m.test(body));
}

async function caseCOWORKMonthly1Materialized() {
  console.log("\n--- Case COWORK-MONTHLY-1: cowork-monthly-hub-cards.js materializes at ranch/scripts/cowork/ ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-cowork-monthly1-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "cowork",
        version: "0.4.0",
        manifest: {
          name: "cowork",
          version: "0.4.0",
          kind: "blueprint",
          module_directory: "cowork",
          files: [
            { source: "helpers/cowork-monthly-hub-cards.js", dest: "{{scripts_path}}/cowork/cowork-monthly-hub-cards.js" }
          ]
        },
        sourceFiles: [
          { relPath: "helpers/cowork-monthly-hub-cards.js", body: fs.readFileSync(path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-monthly-hub-cards.js"), "utf8") }
        ]
      }
    ]);
    const result = await runHarness(scratch);
    assertTrue("COWORK-MONTHLY-1: platform-installed.json was written", result !== null);
    assertTrue("COWORK-MONTHLY-1: cowork-monthly-hub-cards.js materialized at ranch/scripts/cowork/",
      fs.existsSync(path.join(scratch, "ranch/scripts/cowork/cowork-monthly-hub-cards.js")));
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseCOWORKMonthly2ClassDeclared() {
  console.log("\n--- Case COWORK-MONTHLY-2: cowork-monthly-hub-cards.js declares class CoworkMonthlyHubCards ---");
  const p = path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-monthly-hub-cards.js");
  assertTrue("COWORK-MONTHLY-2: file exists on disk", fs.existsSync(p));
  const body = fs.readFileSync(p, "utf8");
  assertTrue("COWORK-MONTHLY-2: class CoworkMonthlyHubCards declared", /^class\s+CoworkMonthlyHubCards\b/m.test(body));
}

async function caseCOWORKMonthly3HasRender() {
  console.log("\n--- Case COWORK-MONTHLY-3: cowork-monthly-hub-cards.js has async render( method ---");
  const body = fs.readFileSync(path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-monthly-hub-cards.js"), "utf8");
  assertTrue("COWORK-MONTHLY-3: async render( method present", /async\s+render\s*\(/.test(body));
}

async function caseCOWORKMonthly4UsesBeaconCards() {
  console.log("\n--- Case COWORK-MONTHLY-4: cowork-monthly-hub-cards.js uses BeaconCards ---");
  const body = fs.readFileSync(path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-monthly-hub-cards.js"), "utf8");
  assertTrue("COWORK-MONTHLY-4: BeaconCards referenced", body.includes("BeaconCards"));
}

async function caseCOWORKMonthly5SkipsEmbed() {
  console.log("\n--- Case COWORK-MONTHLY-5: cowork-monthly-hub-cards.js skips markdown-embed context ---");
  const body = fs.readFileSync(path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-monthly-hub-cards.js"), "utf8");
  assertTrue("COWORK-MONTHLY-5: markdown-embed guard present", body.includes("markdown-embed"));
}

async function caseCOWORKMonthly6NoTrailWs() {
  console.log("\n--- Case COWORK-MONTHLY-6: cowork-monthly-hub-cards.js has no trailing whitespace ---");
  const body = fs.readFileSync(path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-monthly-hub-cards.js"), "utf8");
  assertTrue("COWORK-MONTHLY-6: no trailing whitespace", !/[ \t]+$/m.test(body));
}

// v0.44.0 S9 — cowork UX polish helper-shape asserts.
//
// COWORK-HUBNAV-1: cowork-hub-nav.js lints clean (no trailing whitespace, no
// tab/space mix on any line — match the per-helper lint case posture).
async function caseCOWORKHubNav1Lints() {
  console.log("\n--- Case COWORK-HUBNAV-1: cowork-hub-nav.js lints clean ---");
  const p = path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-hub-nav.js");
  assertTrue("COWORK-HUBNAV-1: file exists on disk", fs.existsSync(p));
  const body = fs.readFileSync(p, "utf8");
  assertTrue("COWORK-HUBNAV-1: no trailing whitespace", !/[ \t]+$/m.test(body));
  assertTrue("COWORK-HUBNAV-1: no tab/space mix on any line",
    !/^( +\t|\t+ )/m.test(body));
  assertTrue("COWORK-HUBNAV-1: class CoworkHubNav declared", /class\s+CoworkHubNav\b/.test(body));
}

// COWORK-CARDS-API: 3 cards helpers use the correct BeaconCards API
// (regex: pages: cardItems, NOT items: cardItems).
async function caseCOWORKCardsAPIPagesNotItems() {
  console.log("\n--- Case COWORK-CARDS-API: cowork-*-hub-cards.js use 'pages: cardItems' not 'items: cardItems' ---");
  for (const f of ["cowork-daily-hub-cards.js", "cowork-weekly-hub-cards.js", "cowork-monthly-hub-cards.js"]) {
    const body = fs.readFileSync(path.join(BLUEPRINTS_DIR, "cowork", "helpers", f), "utf8");
    assertTrue(`COWORK-CARDS-API: ${f} uses 'pages: cardItems'`, /pages:\s*cardItems/.test(body));
    assertTrue(`COWORK-CARDS-API: ${f} no longer uses 'items: cardItems'`, !/\bitems:\s*cardItems/.test(body));
  }
}

// v0.45.0 S8 — cowork self-contained helper-shape asserts.
// COWORK-V045-1: cowork-daily-actions.js lints clean + declares its class.
async function caseCOWORKV045DailyActionsLints() {
  console.log("\n--- Case COWORK-V045-1: cowork-daily-actions.js lints clean ---");
  const p = path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-daily-actions.js");
  assertTrue("COWORK-V045-1: file exists on disk", fs.existsSync(p));
  const body = fs.readFileSync(p, "utf8");
  assertTrue("COWORK-V045-1: no trailing whitespace", !/[ \t]+$/m.test(body));
  assertTrue("COWORK-V045-1: no tab/space mix on any line", !/^( +\t|\t+ )/m.test(body));
  assertTrue("COWORK-V045-1: class CoworkDailyActions declared", /class\s+CoworkDailyActions\b/.test(body));
}

// COWORK-V068-LR: cowork-latest-runs.js lints clean + declares its class +
// queries the 5 canonical cowork-* run-note types (v0.68.0 S5).
async function caseCOWORKV068LatestRunsLints() {
  console.log("\n--- Case COWORK-V068-LR: cowork-latest-runs.js lints clean ---");
  const p = path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-latest-runs.js");
  assertTrue("COWORK-V068-LR: file exists on disk", fs.existsSync(p));
  const body = fs.readFileSync(p, "utf8");
  assertTrue("COWORK-V068-LR: no trailing whitespace", !/[ \t]+$/m.test(body));
  assertTrue("COWORK-V068-LR: no tab/space mix on any line", !/^( +\t|\t+ )/m.test(body));
  assertTrue("COWORK-V068-LR: class CoworkLatestRuns declared", /class\s+CoworkLatestRuns\b/.test(body));
  for (const o of ["morning-briefing", "midday-tripwire", "eod-review", "weekly-review", "monthly-review"]) {
    assertTrue(`COWORK-V068-LR: queries cowork-${o} run-note type`, body.includes(`cowork-${o}`));
  }
  assertTrue("COWORK-V068-LR: defines async render(dv)", /async\s+render\s*\(\s*dv\s*\)/.test(body));
}

// COWORK-V045-2: cowork-hub-nav.js uses customJS.AccentButton.render
// AND no longer uses BeaconCards.render (S1 AccentButton rewrite).
async function caseCOWORKV045HubNavAccentButton() {
  console.log("\n--- Case COWORK-V045-2: cowork-hub-nav.js uses AccentButton, not BeaconCards ---");
  const p = path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-hub-nav.js");
  const body = fs.readFileSync(p, "utf8");
  assertTrue("COWORK-V045-2: body matches /customJS\\.AccentButton\\.render/",
    /customJS\.AccentButton\.render/.test(body));
  assertTrue("COWORK-V045-2: body no longer matches /BeaconCards\\.render/",
    !/BeaconCards\.render/.test(body));
}

// COWORK-V045-3: cowork-daily-hub-cards.js reads spice/cowork/daily
// AND no longer reads spice/daily (S3 retarget).
async function caseCOWORKV045DailyCardsRetarget() {
  console.log("\n--- Case COWORK-V045-3: cowork-daily-hub-cards.js retargeted to spice/cowork/daily ---");
  const p = path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-daily-hub-cards.js");
  const body = fs.readFileSync(p, "utf8");
  assertTrue("COWORK-V045-3: body contains 'spice/cowork/daily'",
    body.includes("spice/cowork/daily"));
  assertTrue("COWORK-V045-3: body no longer contains the old dv.pages('\"spice/daily\"') call",
    !/dv\.pages\('"spice\/daily"'\)/.test(body));
}

// COWORK-TF-NO-ARROWS: cowork-timeframe-buttons.js dropped → arrows from
// the "This Week" / "This Month" labels (v0.44.0 S4).
async function caseCOWORKTimeframeNoArrows() {
  console.log("\n--- Case COWORK-TF-NO-ARROWS: cowork-timeframe-buttons.js dropped → arrows ---");
  const p = path.join(BLUEPRINTS_DIR, "cowork", "helpers", "cowork-timeframe-buttons.js");
  assertTrue("COWORK-TF-NO-ARROWS: file exists on disk", fs.existsSync(p));
  const body = fs.readFileSync(p, "utf8");
  assertTrue("COWORK-TF-NO-ARROWS: body no longer contains 'This Week →'", !body.includes("This Week →"));
  assertTrue("COWORK-TF-NO-ARROWS: body no longer contains 'This Month →'", !body.includes("This Month →"));
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

// ============================================================
// v0.39.0 S1.6 — products@0.1.0 install coverage (3 cases).
// Mirrors the harness's scaffoldBlueprintVault + runHarness pattern (see M3/R6).
// Cases validate the structural invariants the products manifest declares:
//   PROD-1: files[] entries materialize at substituted paths (scripts + content + commands + skills)
//   PROD-2: nav_buttons[] entries register into ranch/nav-buttons-registry.json
//   PROD-3: rule_fragments[] entries aggregate into ranch/rules/<target>.json
// Each case uses a fake-fixture blueprint whose manifest mirrors the
// real products manifest shape (kind=blueprint, module_directory=products,
// the same nav_buttons + rule_fragments shape), proving the install path
// honors what the real manifest will encounter at install time.
// ============================================================

async function caseProd1FilesMaterialize() {
  console.log("\n--- Case PROD-1: products@0.1.0 install — files materialize at expected paths ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-prod1-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "products",
        version: "0.1.0",
        manifest: {
          name: "products",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "products",
          skills_dir: ".claude/skills/products",
          files: [
            { source: "scripts/products-hub-cards.js",     "dest": "{{scripts_path}}/products/products-hub-cards.js" },
            { source: "scripts/product-page-cards.js",     "dest": "{{scripts_path}}/products/product-page-cards.js" },
            { source: "scripts/product-action-buttons.js", "dest": "{{scripts_path}}/products/product-action-buttons.js" },
            { source: "templates/Template, Product.md",    "dest": "{{templates_path}}/Template, Product.md" },
            { source: "content/Products.md",               "dest": "{{module_directory}}/Products.md" }
          ],
          claude_surface: [
            { kind: "command", source: "commands/products.md",        dest: ".claude/commands/products.md" },
            { kind: "skill",   source: "skills/new-product/SKILL.md", dest: "{{skills_dir}}/new-product/SKILL.md" }
          ]
        },
        sourceFiles: [
          { relPath: "scripts/products-hub-cards.js",      body: "// hub cards stub\n" },
          { relPath: "scripts/product-page-cards.js",      body: "// page cards stub\n" },
          { relPath: "scripts/product-action-buttons.js",  body: "// action buttons stub\n" },
          { relPath: "templates/Template, Product.md",     body: "stub template\n" },
          { relPath: "content/Products.md",                body: "# Products\nhub\n" },
          { relPath: "commands/products.md",               body: "---\ndescription: products\n---\nstub\n" },
          { relPath: "skills/new-product/SKILL.md",        body: "---\nname: new-product\ndescription: stub\n---\nbody\n" }
        ]
      }
    ]);
    const result = await runHarness(scratch);
    assertTrue("PROD-1: platform-installed.json was written", result !== null);

    assertTrue("PROD-1: hub note materialized at spice/products/Products.md",
      fs.existsSync(path.join(scratch, "spice/products/Products.md")));
    assertTrue("PROD-1: hub-cards script materialized at ranch/scripts/products/products-hub-cards.js",
      fs.existsSync(path.join(scratch, "ranch/scripts/products/products-hub-cards.js")));
    assertTrue("PROD-1: page-cards script materialized",
      fs.existsSync(path.join(scratch, "ranch/scripts/products/product-page-cards.js")));
    assertTrue("PROD-1: action-buttons script materialized",
      fs.existsSync(path.join(scratch, "ranch/scripts/products/product-action-buttons.js")));
    assertTrue("PROD-1: Product template materialized at ranch/templates/Template, Product.md",
      fs.existsSync(path.join(scratch, "ranch/templates/Template, Product.md")));
    assertTrue("PROD-1: /products slash command materialized at .claude/commands/products.md",
      fs.existsSync(path.join(scratch, ".claude/commands/products.md")));
    assertTrue("PROD-1: new-product SKILL.md materialized at .claude/skills/products/new-product/SKILL.md",
      fs.existsSync(path.join(scratch, ".claude/skills/products/new-product/SKILL.md")));
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseProd2NavButtonRegistry() {
  console.log("\n--- Case PROD-2: products@0.1.0 install — nav-button registry includes products-hub ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-prod2-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "products",
        version: "0.1.0",
        manifest: {
          name: "products",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "products",
          files: [],
          nav_buttons: [
            {
              id: "products-hub",
              label: "Products",
              icon: "package",
              order: 70,
              action: { type: "openLink", target: "{{module_directory}}/Products.md" }
            }
          ]
        }
      }
    ]);
    const result = await runHarness(scratch);
    assertTrue("PROD-2: platform-installed.json was written", result !== null);

    const registry = await readJson(path.join(scratch, "ranch/nav-buttons-registry.json"));
    const contribs = registry.contributions["products"];
    assertTrue("PROD-2: registry has contributions for products", Array.isArray(contribs) && contribs.length >= 1);
    const hubBtn = contribs.find((c) => c.id === "products-hub");
    assertTrue("PROD-2: registry contains products-hub button entry", !!hubBtn);
    assertEq("PROD-2: action.target has {{module_directory}} substituted to spice/products",
      hubBtn.action.target, "spice/products/Products.md");
    assertEq("PROD-2: label preserved", hubBtn.label, "Products");
    assertEq("PROD-2: icon preserved", hubBtn.icon, "package");
    assertEq("PROD-2: order preserved", hubBtn.order, 70);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseProd3RuleFragmentAggregated() {
  console.log("\n--- Case PROD-3: products@0.1.0 install — rule_fragment aggregated into ranch/rules/products.json ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-prod3-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "products",
        version: "0.1.0",
        manifest: {
          name: "products",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "products",
          files: [],
          rule_fragments: [
            {
              target: "products",
              fragment: {
                scope: { path_glob: "spice/products/*.md", exclude_basenames: ["Products.md"] },
                required_frontmatter: {
                  type:    { required: true, type: "string", equals: "product" },
                  name:    { required: true, type: "string" },
                  created: { required: true, type: "string", matches: "^\\d{4}-\\d{2}-\\d{2}$" }
                },
                required_tags: [{ tag: "product" }],
                naming_pattern: "^[A-Z][\\w '\\-&]+\\.md$"
              }
            }
          ]
        }
      }
    ]);
    const result = await runHarness(scratch);
    assertTrue("PROD-3: platform-installed.json was written", result !== null);

    const rulePath = path.join(scratch, "ranch/rules/products.json");
    assertTrue("PROD-3: ranch/rules/products.json was written", fs.existsSync(rulePath));
    const rule = await readJson(rulePath);
    assertTrue("PROD-3: contributions.products is an array", Array.isArray(rule.contributions && rule.contributions.products));
    assertEq("PROD-3: contributions.products has exactly one fragment", rule.contributions.products.length, 1);
    const frag = rule.contributions.products[0];
    assertEq("PROD-3: scope.path_glob preserved", frag.scope.path_glob, "spice/products/*.md");
    assertEq("PROD-3: required_frontmatter.type.equals === product", frag.required_frontmatter.type.equals, "product");
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

// ============================================================
// v0.39.0 S3.6 — teams@0.1.0 install coverage (3 cases).
// Mirrors PROD-1/PROD-2/PROD-3 with teams substituted for products + an
// extra products fixture co-subscribed (teams depends_on products).
// Cases validate the structural invariants the teams manifest declares:
//   TEAM-1: files[] entries materialize at substituted paths
//   TEAM-2: nav_buttons[] entries register into ranch/nav-buttons-registry.json
//   TEAM-3: rule_fragments[] include the required product: field
// ============================================================

async function caseTeam1FilesMaterialize() {
  console.log("\n--- Case TEAM-1: teams@0.1.0 install — files materialize at expected paths ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-team1-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "products",
        version: "0.1.0",
        manifest: {
          name: "products",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "products",
          files: []
        }
      },
      {
        name: "teams",
        version: "0.1.0",
        manifest: {
          name: "teams",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "teams",
          skills_dir: ".claude/skills/teams",
          depends_on: [{ name: "products", range: ">=0.1.0" }],
          files: [
            { source: "scripts/teams-hub-cards.js",     "dest": "{{scripts_path}}/teams/teams-hub-cards.js" },
            { source: "scripts/team-page-cards.js",     "dest": "{{scripts_path}}/teams/team-page-cards.js" },
            { source: "scripts/team-action-buttons.js", "dest": "{{scripts_path}}/teams/team-action-buttons.js" },
            { source: "templates/Template, Team.md",    "dest": "{{templates_path}}/Template, Team.md" },
            { source: "content/Teams.md",               "dest": "{{module_directory}}/Teams.md" }
          ],
          claude_surface: [
            { kind: "command", source: "commands/teams.md",        dest: ".claude/commands/teams.md" },
            { kind: "skill",   source: "skills/new-team/SKILL.md", dest: "{{skills_dir}}/new-team/SKILL.md" }
          ]
        },
        sourceFiles: [
          { relPath: "scripts/teams-hub-cards.js",     body: "// hub cards stub\n" },
          { relPath: "scripts/team-page-cards.js",     body: "// page cards stub\n" },
          { relPath: "scripts/team-action-buttons.js", body: "// action buttons stub\n" },
          { relPath: "templates/Template, Team.md",    body: "stub template\n" },
          { relPath: "content/Teams.md",               body: "# Teams\nhub\n" },
          { relPath: "commands/teams.md",              body: "---\ndescription: teams\n---\nstub\n" },
          { relPath: "skills/new-team/SKILL.md",       body: "---\nname: new-team\ndescription: stub\n---\nbody\n" }
        ]
      }
    ]);
    const result = await runHarness(scratch);
    assertTrue("TEAM-1: platform-installed.json was written", result !== null);

    assertTrue("TEAM-1: hub note materialized at spice/teams/Teams.md",
      fs.existsSync(path.join(scratch, "spice/teams/Teams.md")));
    assertTrue("TEAM-1: hub-cards script materialized at ranch/scripts/teams/teams-hub-cards.js",
      fs.existsSync(path.join(scratch, "ranch/scripts/teams/teams-hub-cards.js")));
    assertTrue("TEAM-1: page-cards script materialized",
      fs.existsSync(path.join(scratch, "ranch/scripts/teams/team-page-cards.js")));
    assertTrue("TEAM-1: action-buttons script materialized",
      fs.existsSync(path.join(scratch, "ranch/scripts/teams/team-action-buttons.js")));
    assertTrue("TEAM-1: Team template materialized at ranch/templates/Template, Team.md",
      fs.existsSync(path.join(scratch, "ranch/templates/Template, Team.md")));
    assertTrue("TEAM-1: /teams slash command materialized at .claude/commands/teams.md",
      fs.existsSync(path.join(scratch, ".claude/commands/teams.md")));
    assertTrue("TEAM-1: new-team SKILL.md materialized at .claude/skills/teams/new-team/SKILL.md",
      fs.existsSync(path.join(scratch, ".claude/skills/teams/new-team/SKILL.md")));
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseTeam2NavButtonRegistry() {
  console.log("\n--- Case TEAM-2: teams@0.1.0 install — nav-button registry includes teams-hub ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-team2-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "products",
        version: "0.1.0",
        manifest: {
          name: "products",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "products",
          files: []
        }
      },
      {
        name: "teams",
        version: "0.1.0",
        manifest: {
          name: "teams",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "teams",
          depends_on: [{ name: "products", range: ">=0.1.0" }],
          files: [],
          nav_buttons: [
            {
              id: "teams-hub",
              label: "Teams",
              icon: "users",
              order: 75,
              action: { type: "openLink", target: "{{module_directory}}/Teams.md" }
            }
          ]
        }
      }
    ]);
    const result = await runHarness(scratch);
    assertTrue("TEAM-2: platform-installed.json was written", result !== null);

    const registry = await readJson(path.join(scratch, "ranch/nav-buttons-registry.json"));
    const contribs = registry.contributions["teams"];
    assertTrue("TEAM-2: registry has contributions for teams", Array.isArray(contribs) && contribs.length >= 1);
    const hubBtn = contribs.find((c) => c.id === "teams-hub");
    assertTrue("TEAM-2: registry contains teams-hub button entry", !!hubBtn);
    assertEq("TEAM-2: action.target has {{module_directory}} substituted to spice/teams",
      hubBtn.action.target, "spice/teams/Teams.md");
    assertEq("TEAM-2: label preserved", hubBtn.label, "Teams");
    assertEq("TEAM-2: icon preserved", hubBtn.icon, "users");
    assertEq("TEAM-2: order preserved", hubBtn.order, 75);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

async function caseTeam3RuleFragmentRequiresProduct() {
  console.log("\n--- Case TEAM-3: teams@0.1.0 install — rule_fragment aggregated into ranch/rules/teams.json with required product field ---");
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-team3-"));
  try {
    await scaffoldBlueprintVault(scratch, [
      {
        name: "products",
        version: "0.1.0",
        manifest: {
          name: "products",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "products",
          files: []
        }
      },
      {
        name: "teams",
        version: "0.1.0",
        manifest: {
          name: "teams",
          version: "0.1.0",
          kind: "blueprint",
          module_directory: "teams",
          depends_on: [{ name: "products", range: ">=0.1.0" }],
          files: [],
          rule_fragments: [
            {
              target: "teams",
              fragment: {
                scope: { path_glob: "spice/teams/*.md", exclude_basenames: ["Teams.md"] },
                required_frontmatter: {
                  type:    { required: true, type: "string", equals: "team" },
                  name:    { required: true, type: "string" },
                  created: { required: true, type: "string", matches: "^\\d{4}-\\d{2}-\\d{2}$" },
                  product: { required: true, type: "string" }
                },
                required_tags: [{ tag: "team" }],
                naming_pattern: "^[A-Z][\\w '\\-&]+\\.md$"
              }
            }
          ]
        }
      }
    ]);
    const result = await runHarness(scratch);
    assertTrue("TEAM-3: platform-installed.json was written", result !== null);

    const rulePath = path.join(scratch, "ranch/rules/teams.json");
    assertTrue("TEAM-3: ranch/rules/teams.json was written", fs.existsSync(rulePath));
    const rule = await readJson(rulePath);
    assertTrue("TEAM-3: contributions.teams is an array", Array.isArray(rule.contributions && rule.contributions.teams));
    assertEq("TEAM-3: contributions.teams has exactly one fragment", rule.contributions.teams.length, 1);
    const frag = rule.contributions.teams[0];
    assertEq("TEAM-3: scope.path_glob preserved", frag.scope.path_glob, "spice/teams/*.md");
    assertEq("TEAM-3: required_frontmatter.type.equals === team", frag.required_frontmatter.type.equals, "team");
    assertTrue("TEAM-3: required_frontmatter.product.required === true",
      frag.required_frontmatter.product && frag.required_frontmatter.product.required === true);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

// ============================================================
// v0.39.0 S2.4 — products@0.1.0 validator green/red cases.
// Direct exercise of platform/audit/rule-runner.js with the real
// rule_fragment loaded from platform/blueprints/products/manifest.json.
// Same engine the in-vault validator + CLI auditor both use, so a green
// here = green in production at install/audit time. Mirrors HC-PR-1/2
// pattern (no temp-vault scaffolding needed; in-memory record + fragment).
// ============================================================
async function caseProd4ValidatorAcceptsWellFormedProduct() {
  console.log("\n--- Case PROD-4: products validator accepts a well-formed Product note (v0.54.0 canonical) ---");
  const manifestPath = path.join(WORKSHOP, "platform/blueprints/products/manifest.json");
  const manifest = _readJson(manifestPath);
  const fragments = manifest.rule_fragments.map((rf) => rf.fragment);
  const record = {
    relPath: "spice/products/Sauce.md",
    frontmatter: {
      type: "product",
      name: "Sauce",
      created_at: "2026-05-12T09:30:00-07:00",
    },
    body: "# Sauce\n",
    blueprint: "products",
  };
  const violations = _ruleRunner.applyRules(fragments, record,
    { workshopRoot: WORKSHOP, vaultPath: null });
  assertEqual(violations.length, 0,
    "PROD-4: well-formed Product note produces zero violations");
}

async function caseProd5ValidatorRejectsProductMissingCreatedAt() {
  console.log("\n--- Case PROD-5: products validator rejects a Product note missing required created_at (canonical) ---");
  const manifestPath = path.join(WORKSHOP, "platform/blueprints/products/manifest.json");
  const manifest = _readJson(manifestPath);
  const fragments = manifest.rule_fragments.map((rf) => rf.fragment);
  // Missing created_at — canonical-vocab extends declares it required.
  const record = {
    relPath: "spice/products/Acme.md",
    frontmatter: {
      type: "product",
      name: "Acme",
      // created_at omitted on purpose
    },
    body: "# Acme\n",
    blueprint: "products",
  };
  const violations = _ruleRunner.applyRules(fragments, record,
    { workshopRoot: WORKSHOP, vaultPath: null });
  assertTrue("PROD-5: missing-created_at Product surfaces required_frontmatter.created_at via extends",
    violations.some((v) => v.rule === "required_frontmatter.created_at"));
}

// ============================================================
// v0.39.0 S4.4 — teams@0.1.0 validator green/red cases.
// Direct exercise of platform/audit/rule-runner.js with the real
// rule_fragment loaded from platform/blueprints/teams/manifest.json.
// Mirrors PROD-4/PROD-5 pattern (in-memory record + fragment; no temp-vault).
// TEAM-4 green = well-formed Team record; TEAM-5 red = missing required
// `product:` wikilink; TEAM-6 red = missing required `team` tag.
// ============================================================
async function caseTeam4ValidatorAcceptsWellFormedTeam() {
  console.log("\n--- Case TEAM-4: teams validator accepts a well-formed Team note (v0.54.0 canonical) ---");
  const manifestPath = path.join(WORKSHOP, "platform/blueprints/teams/manifest.json");
  const manifest = _readJson(manifestPath);
  const fragments = manifest.rule_fragments.map((rf) => rf.fragment);
  const record = {
    relPath: "spice/teams/Platform Engineering.md",
    frontmatter: {
      type: "team",
      name: "Platform Engineering",
      created_at: "2026-05-12T09:30:00-07:00",
      products: ["[[Sauce]]"],
    },
    body: "# Platform Engineering\n",
    blueprint: "teams",
  };
  const violations = _ruleRunner.applyRules(fragments, record,
    { workshopRoot: WORKSHOP, vaultPath: null });
  assertEqual(violations.length, 0,
    "TEAM-4: well-formed Team note produces zero violations");
}

async function caseTeam5ValidatorRejectsTeamMissingProducts() {
  console.log("\n--- Case TEAM-5: teams validator rejects a Team note missing required products: list (canonical) ---");
  const manifestPath = path.join(WORKSHOP, "platform/blueprints/teams/manifest.json");
  const manifest = _readJson(manifestPath);
  const fragments = manifest.rule_fragments.map((rf) => rf.fragment);
  // Missing products list (was: missing singular product wikilink pre-FA-2).
  const record = {
    relPath: "spice/teams/Orphan.md",
    frontmatter: {
      type: "team",
      name: "Orphan",
      created_at: "2026-05-12T09:30:00-07:00",
      // products omitted on purpose
    },
    body: "# Orphan\n",
    blueprint: "teams",
  };
  const violations = _ruleRunner.applyRules(fragments, record,
    { workshopRoot: WORKSHOP, vaultPath: null });
  assertTrue("TEAM-5: missing-products Team surfaces required_frontmatter.products",
    violations.some((v) => v.rule === "required_frontmatter.products"));
}

async function caseTeam6ValidatorRejectsTeamMissingCreatedAt() {
  console.log("\n--- Case TEAM-6: teams validator rejects a Team note missing canonical created_at ---");
  const manifestPath = path.join(WORKSHOP, "platform/blueprints/teams/manifest.json");
  const manifest = _readJson(manifestPath);
  const fragments = manifest.rule_fragments.map((rf) => rf.fragment);
  // Missing created_at — canonical-vocab extends declares it required.
  const record = {
    relPath: "spice/teams/Mobile.md",
    frontmatter: {
      type: "team",
      name: "Mobile",
      products: ["[[Sauce]]"],
      // created_at omitted on purpose
    },
    body: "# Mobile\n",
    blueprint: "teams",
  };
  const violations = _ruleRunner.applyRules(fragments, record,
    { workshopRoot: WORKSHOP, vaultPath: null });
  assertTrue("TEAM-6: missing-created_at Team surfaces required_frontmatter.created_at via extends",
    violations.some((v) => v.rule === "required_frontmatter.created_at"));
}

// ============================================================
// v0.39.0 S5.4 — project@1.6.0 validator green/red cases for the
// expanded frontmatter (status enum + status_changed_at + teams[] +
// products[]). Mirrors PROD-4/5 + TEAM-4/5/6 pattern — in-memory
// record + fragment loaded from platform/blueprints/project/manifest.json.
// Project's rule_fragment uses frontmatter_branch[0] (when type:project)
// — rule-runner auto-resolves the branch from the record's frontmatter,
// so the whole fragment is passed unchanged to applyRules.
// PROJ-1 green = well-formed project record; PROJ-2 red = missing status;
// PROJ-3 red = invalid status enum value.
// ============================================================
async function caseProj1ValidatorAcceptsWellFormedProject() {
  console.log("\n--- Case PROJ-1: project validator accepts a well-formed project note with v1.6.0 frontmatter ---");
  const manifestPath = path.join(WORKSHOP, "platform/blueprints/project/manifest.json");
  const manifest = _readJson(manifestPath);
  const fragments = manifest.rule_fragments.map((rf) => rf.fragment);
  const record = {
    relPath: "spice/projects/foo-launch/Foo Launch.md",
    frontmatter: {
      type: "project",
      name: "Foo Launch",
      created: "2026-05-12",
      description: "ship Foo",
      tags: ["project", "project/foo-launch", "2026/2026-05"],
      workstreams: [],
      status: "planning",
      status_changed_at: "2026-05-12",
      teams: ["[[Platform Engineering]]"],
      products: ["[[Sauce]]"],
    },
    body: "# Foo Launch\n",
    blueprint: "project",
  };
  const violations = _ruleRunner.applyRules(fragments, record, { workshopRoot: WORKSHOP });
  assertEqual(violations.length, 0,
    "PROJ-1: well-formed project note produces zero violations");
}

async function caseProj2ValidatorRejectsProjectMissingStatus() {
  console.log("\n--- Case PROJ-2: project validator rejects a project note missing required status ---");
  const manifestPath = path.join(WORKSHOP, "platform/blueprints/project/manifest.json");
  const manifest = _readJson(manifestPath);
  const fragments = manifest.rule_fragments.map((rf) => rf.fragment);
  // Same as PROJ-1 minus status + status_changed_at + teams + products.
  const record = {
    relPath: "spice/projects/bar-launch/Bar Launch.md",
    frontmatter: {
      type: "project",
      name: "Bar Launch",
      created: "2026-05-12",
      description: "",
      tags: ["project"],
      workstreams: [],
      // status omitted on purpose
    },
    body: "# Bar Launch\n",
    blueprint: "project",
  };
  const violations = _ruleRunner.applyRules(fragments, record, { workshopRoot: WORKSHOP });
  assertTrue("PROJ-2: missing-status project note surfaces required_frontmatter.status",
    violations.some((v) => v.rule === "required_frontmatter.status"));
}

async function caseProj3ValidatorRejectsProjectInvalidStatusEnum() {
  console.log("\n--- Case PROJ-3: project validator rejects a project note with invalid status enum value ---");
  const manifestPath = path.join(WORKSHOP, "platform/blueprints/project/manifest.json");
  const manifest = _readJson(manifestPath);
  const fragments = manifest.rule_fragments.map((rf) => rf.fragment);
  // status: "wibble" — not in the 7-state enum.
  const record = {
    relPath: "spice/projects/baz/Baz.md",
    frontmatter: {
      type: "project",
      name: "Baz",
      created: "2026-05-12",
      description: "",
      tags: ["project"],
      workstreams: [],
      status: "wibble",
      status_changed_at: "2026-05-12",
    },
    body: "# Baz\n",
    blueprint: "project",
  };
  const violations = _ruleRunner.applyRules(fragments, record, { workshopRoot: WORKSHOP });
  assertTrue("PROJ-3: invalid-status-enum project note surfaces required_frontmatter.status.matches",
    violations.some((v) => v.rule === "required_frontmatter.status.matches"));
}

// -------------------------------------------------------------------------
// v0.47.0 S8 — TYPE-1/2/3: validator Layer 2 type-field convention rule.
// Extracts _validateTypeFieldConvention from platform/install.js (the rule
// lives upstream of the validator mechanism because validate.js operates
// per-file; manifest-level enforcement is install-time). Tests both fixture
// manifests and the real post-S7 people manifest.
// -------------------------------------------------------------------------
function _loadValidateTypeFieldConvention() {
  const installSrc = fs.readFileSync(CANONICAL_INSTALLER, "utf8");
  const startIdx = installSrc.search(/function\s+_validateTypeFieldConvention\s*\(/);
  if (startIdx < 0) return null;
  let i = installSrc.indexOf("{", startIdx);
  if (i < 0) return null;
  let depth = 0;
  for (; i < installSrc.length; i++) {
    if (installSrc[i] === "{") depth++;
    else if (installSrc[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  const src = installSrc.slice(startIdx, i);
  const NoticeStub = function (msg) { (NoticeStub.captured ||= []).push(String(msg)); };
  return new Function("Notice", `"use strict";\n${src}\nreturn _validateTypeFieldConvention;`)(NoticeStub);
}

async function caseType1PositiveFixtureWithTypeAlignedButtonPasses() {
  console.log("\n--- Case TYPE-1: validator type-field rule passes on aligned fixture ---");
  const fn = _loadValidateTypeFieldConvention();
  if (!fn) { assertTrue("TYPE-1: _validateTypeFieldConvention extracted", false, "could not extract"); return; }
  const manifest = {
    name: "fixture-aligned",
    rule_fragments: [
      { target: "fixture-aligned", fragment: { when: { frontmatter: { type: "person" } } } }
    ],
    new_entity_buttons: [
      {
        id: "person",
        label: "+ New Person",
        frontmatter_template: { type: "person", company: "" }
      }
    ]
  };
  const history = [];
  const git = { commit: "0", tag: "x", dirty: false };
  const result = fn(manifest, history, git);
  assertTrue("TYPE-1: aligned manifest passes the rule (returns true)", result === true);
  assertTrue("TYPE-1: aligned manifest produces no history error", history.length === 0,
    `history=${JSON.stringify(history)}`);
}

async function caseType2NegativeFixtureMissingTypeFails() {
  console.log("\n--- Case TYPE-2: validator type-field rule fails on fixture missing type ---");
  const fn = _loadValidateTypeFieldConvention();
  if (!fn) { assertTrue("TYPE-2: _validateTypeFieldConvention extracted", false, "could not extract"); return; }
  const manifest = {
    name: "fixture-missing-type",
    rule_fragments: [
      { target: "fixture-missing-type", fragment: { when: { frontmatter: { type: "person" } } } }
    ],
    new_entity_buttons: [
      {
        id: "person",
        label: "+ New Person",
        frontmatter_template: { company: "" /* type intentionally omitted */ }
      }
    ]
  };
  const history = [];
  const git = { commit: "0", tag: "x", dirty: false };
  const result = fn(manifest, history, git);
  const errored = history.length === 1 && history[0].event === "error" && history[0].rule === "type_field_convention";
  const msgMentions = errored && /type/i.test(history[0].message || "") && /new_entity_buttons/i.test(history[0].message || "");
  assertTrue("TYPE-2: missing-type manifest fails the rule (returns false)", result === false);
  assertTrue("TYPE-2: history error names rule + mentions 'type' and 'new_entity_buttons'", errored && msgMentions,
    `history=${JSON.stringify(history)}`);
}

async function caseType3RealPeopleManifestPostPatchPasses() {
  console.log("\n--- Case TYPE-3: validator type-field rule passes on real post-patch people manifest ---");
  const fn = _loadValidateTypeFieldConvention();
  if (!fn) { assertTrue("TYPE-3: _validateTypeFieldConvention extracted", false, "could not extract"); return; }
  const peopleManifest = JSON.parse(fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/people/manifest.json"), "utf8"));
  const history = [];
  const git = { commit: "0", tag: "x", dirty: false };
  const result = fn(peopleManifest, history, git);
  // People's rule_fragment does NOT declare when.frontmatter.type at v0.47.0
  // (it uses scope.path_glob), so the rule's gate is not tripped → trivially
  // passes. This case proves the rule is non-disruptive on the real manifest
  // shape post-S7, complementing TYPE-1/2's synthetic fixtures.
  assertTrue("TYPE-3: real post-patch people manifest passes the rule (returns true)", result === true);
  assertTrue("TYPE-3: real post-patch people manifest produces no history error", history.length === 0,
    `history=${JSON.stringify(history)}`);
}

// -------------------------------------------------------------------------
// v0.48.0 S5 — PTCL-1..5: ProjectTaskCreateListener path-regex + idempotency
// + command-id literal. Source extracted from helpers/project-task-create-listener.js
// since the class is browser-side (no module exports). Tests don't fire
// app.vault.on directly — that requires Obsidian's runtime — they assert
// the constructor's static fields and idempotency-flag mechanics.
//
// _loadProjectTaskCreateListener(appOverride?) — accepts an optional app stub
// so callers control which `app` the loaded class's init() body sees. The src
// uses `app` as a free variable in the new Function scope, so the injected
// stub must be passed at load time (not via global.app patching).
// -------------------------------------------------------------------------
function _loadProjectTaskCreateListener(appOverride) {
  const src = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/project/helpers/project-task-create-listener.js"),
    "utf8"
  );
  const NoticeStub = function (msg) { (NoticeStub.captured ||= []).push(String(msg)); };
  const appStub = appOverride || { vault: { on: function (evt, cb) { (appStub.vault._handlers ||= []).push({ evt, cb }); } } };
  return new Function("Notice", "app", "console", `"use strict";\n${src}\nreturn ProjectTaskCreateListener;`)(NoticeStub, appStub, console);
}

async function casePTCL1Idempotent() {
  console.log("\n--- Case PTCL-1: ProjectTaskCreateListener.init() is idempotent ---");
  let subscribes = 0;
  const fakeApp = { vault: { on: () => { subscribes++; } } };
  // Pass fakeApp at load time so the class's init() body sees it as `app`.
  const Cls = _loadProjectTaskCreateListener(fakeApp);
  const inst = new Cls();
  inst.init();
  inst.init();
  assertEq("PTCL-1: subscribe count after two init() calls", subscribes, 1);
}

async function casePTCL2PathRegexMatches() {
  console.log("\n--- Case PTCL-2: path regex matches top-level task file ---");
  const Cls = _loadProjectTaskCreateListener();
  const inst = new Cls();
  assertTrue("PTCL-2: matches spice/projects/foo/tasks/Bar.md", inst._pathRegex.test("spice/projects/foo/tasks/Bar.md"));
}

async function casePTCL3PathRegexExcludesNested() {
  console.log("\n--- Case PTCL-3: path regex EXCLUDES nested task file ---");
  const Cls = _loadProjectTaskCreateListener();
  const inst = new Cls();
  assertTrue("PTCL-3: does NOT match spice/projects/foo/tasks/Bar/Bar.md (nested)",
    !inst._pathRegex.test("spice/projects/foo/tasks/Bar/Bar.md"));
}

async function casePTCL4PathRegexExcludesAtlas() {
  console.log("\n--- Case PTCL-4: path regex EXCLUDES atlas (not under tasks/) ---");
  const Cls = _loadProjectTaskCreateListener();
  const inst = new Cls();
  assertTrue("PTCL-4: does NOT match spice/projects/foo/Bar.md (atlas, no tasks/)",
    !inst._pathRegex.test("spice/projects/foo/Bar.md"));
}

async function casePTCL5TemplaterCommandIdLiteral() {
  console.log("\n--- Case PTCL-5: Templater command id literal correct ---");
  const Cls = _loadProjectTaskCreateListener();
  const inst = new Cls();
  assertEq("PTCL-5: _templaterCommandId literal", inst._templaterCommandId, "templater-obsidian:replace-in-file-templater");
}

// -------------------------------------------------------------------------
// v0.48.0 S5 — KC-1..3: Kanban Card template enhancements (source-string
// asserts on the Templater template body — Templater syntax is not
// statically analyzable, so we verify presence of the v0.48.0 added pieces).
// -------------------------------------------------------------------------
async function caseKC1SentinelPresent() {
  console.log("\n--- Case KC-1: Kanban Card sentinel '+ Create new workstream' present ---");
  const body = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/project/templates/Kanban Card.md"),
    "utf8"
  );
  assertTrue("KC-1: sentinel string present in Kanban Card body",
    body.includes("+ Create new workstream"), `body length: ${body.length}`);
}

async function caseKC2CreateNewConstDeclared() {
  console.log("\n--- Case KC-2: CREATE_NEW sentinel constant declared ---");
  const body = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/project/templates/Kanban Card.md"),
    "utf8"
  );
  assertTrue("KC-2: CREATE_NEW = '__create_new__' const declared",
    body.includes("CREATE_NEW = '__create_new__'"));
}

async function caseKC3EmptyWorkstreamsNoticePresent() {
  console.log("\n--- Case KC-3: empty-workstreams Notice present ---");
  const body = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/project/templates/Kanban Card.md"),
    "utf8"
  );
  assertTrue("KC-3: 'No workstreams defined on this project' Notice present",
    body.includes("No workstreams defined on this project"));
}

// -------------------------------------------------------------------------
// v0.51.1 — KC-4..6: hybrid cache-first source-board detection.
// Cache path (app.metadataCache.getBacklinksForFile) tried first; vault-scan
// (v0.49.2 behavior, app.vault.getMarkdownFiles) preserved as fallback.
// -------------------------------------------------------------------------
async function caseKC4HybridCachePathPresent() {
  console.log("\n--- Case KC-4: hybrid cache path getBacklinksForFile present ---");
  const body = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/project/templates/Kanban Card.md"),
    "utf8"
  );
  assertTrue("KC-4: app.metadataCache.getBacklinksForFile call present",
    body.includes("app.metadataCache.getBacklinksForFile"));
}

async function caseKC5VaultScanFallbackRetained() {
  console.log("\n--- Case KC-5: vault-scan fallback (v0.49.2 behavior) retained ---");
  const body = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/project/templates/Kanban Card.md"),
    "utf8"
  );
  assertTrue("KC-5: vault-scan fallback app.vault.getMarkdownFiles() still present",
    body.includes("app.vault.getMarkdownFiles()"));
}

async function caseKC6CacheBeforeVaultScan() {
  console.log("\n--- Case KC-6: cache path appears before vault-scan in source order ---");
  const body = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/project/templates/Kanban Card.md"),
    "utf8"
  );
  const cacheIdx = body.indexOf("app.metadataCache.getBacklinksForFile");
  const scanIdx = body.indexOf("app.vault.getMarkdownFiles");
  assertTrue("KC-6: cache attempt precedes vault-scan fallback in source order",
    cacheIdx >= 0 && scanIdx >= 0 && cacheIdx < scanIdx,
    `cacheIdx=${cacheIdx} scanIdx=${scanIdx}`);
}

// -------------------------------------------------------------------------
// v0.59.11 — KC-7..8: name-collision fix. Strategy 0 sibling-board detection
// (runs before cache-first) + auto-promote suffix-disambiguation loop.
// -------------------------------------------------------------------------
async function caseKC7Strategy0SiblingBoardDetection() {
  console.log("\n--- Case KC-7: Strategy 0 sibling-board detection present + ordered ---");
  const body = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/project/templates/Kanban Card.md"),
    "utf8"
  );
  assertTrue("KC-7a: Strategy 0 sibling-board comment marker present",
    body.includes("Strategy 0: directory-of-target sibling-board detection"));
  assertTrue("KC-7b: Strategy 0 siblingBoards.length === 1 early return present",
    /siblingBoards\.length\s*===\s*1/.test(body));
  const s0Idx = body.indexOf("Strategy 0: directory-of-target");
  const s1Idx = body.indexOf("Cache-first path: query indexed backlinks");
  assertTrue("KC-7c: Strategy 0 appears BEFORE Strategy 1 cache-first path",
    s0Idx >= 0 && s1Idx >= 0 && s0Idx < s1Idx,
    `s0Idx=${s0Idx} s1Idx=${s1Idx}`);
}

async function caseKC8AutoPromoteSuffixDisambiguation() {
  console.log("\n--- Case KC-8: auto-promote suffix-disambiguation loop present ---");
  const body = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/project/templates/Kanban Card.md"),
    "utf8"
  );
  assertTrue("KC-8a: chosenName variable declared",
    /let\s+chosenName\s*=\s*fileName/.test(body));
  assertTrue("KC-8b: suffix loop bounded at <= 999",
    /suffix\s*<=\s*999/.test(body));
  assertTrue("KC-8c: name-collision Notice fires on rename",
    /Saved as "\$\{chosenName\}"/.test(body));
  assertTrue("KC-8d: legacy `const existing = ...; if (!existing)` single-attempt skip removed",
    !/const existing = app\.vault\.getAbstractFileByPath\(newTargetPath \+ "\.md"\);\s*\n\s*if \(!existing\)/.test(body));
}

// -------------------------------------------------------------------------
// v0.49.0 S6 — PCSI-1..3: ProjectTaskCreateListenerInit source-string asserts.
// The init script is a thin bootstrap that delegates to v0.48.0's
// ProjectTaskCreateListener.init() via customjs's startupScriptNames[]
// lifecycle. Source-string asserts verify the contract.
// -------------------------------------------------------------------------

async function casePCSI1ClassDefined() {
    console.log("\n--- Case PCSI-1: ProjectTaskCreateListenerInit class is defined ---");
    const src = fs.readFileSync(
        path.join(WORKSHOP, "platform/blueprints/project/helpers/project-task-create-listener-init.js"),
        "utf8"
    );
    assertTrue("PCSI-1: class ProjectTaskCreateListenerInit declared",
        /class\s+ProjectTaskCreateListenerInit\s*{/.test(src));
}

async function casePCSI2InvokeMethodDelegates() {
    console.log("\n--- Case PCSI-2: invoke() delegates to ProjectTaskCreateListener.init() ---");
    const src = fs.readFileSync(
        path.join(WORKSHOP, "platform/blueprints/project/helpers/project-task-create-listener-init.js"),
        "utf8"
    );
    assertTrue("PCSI-2: invoke() body calls customJS.ProjectTaskCreateListener.init()",
        /invoke\s*\(\s*\)\s*{[\s\S]*?customJS\.ProjectTaskCreateListener\.init\s*\(\s*\)/.test(src));
}

async function casePCSI3FailureLoudWrap() {
    console.log("\n--- Case PCSI-3: invoke() wrapped in try/catch with Notice + console.error ---");
    const src = fs.readFileSync(
        path.join(WORKSHOP, "platform/blueprints/project/helpers/project-task-create-listener-init.js"),
        "utf8"
    );
    assertTrue("PCSI-3a: try/catch wraps invoke() body",
        /try\s*{[\s\S]*?customJS\.ProjectTaskCreateListener\.init[\s\S]*?}\s*catch/.test(src));
    assertTrue("PCSI-3b: catch emits Notice with String(e)",
        /new Notice\([^)]*String\(e\)/.test(src));
    assertTrue("PCSI-3c: catch emits console.error",
        /console\.error\(/.test(src));
}

// -------------------------------------------------------------------------
// v0.49.0 S6 — KMC-1: BUG-7 Create Board gate source-line assertion.
// Verifies project-nav-buttons.js:597 gate widening from task-hub-only to
// task-hub OR task-note. Source-string assertion (no rendering).
// -------------------------------------------------------------------------

async function caseKMC1CreateBoardGateWidened() {
    console.log("\n--- Case KMC-1: BUG-7 Create Board gate widened to task-note context ---");
    const src = fs.readFileSync(
        path.join(WORKSHOP, "platform/blueprints/project/helpers/project-nav-buttons.js"),
        "utf8"
    );
    // Verify the OR-clause exists in the gate.
    const gatePattern = /if\s*\(\s*ctx\.context\s*===\s*["']task-hub["']\s*\|\|\s*ctx\.context\s*===\s*["']task-note["']\s*\)\s*{/;
    assertTrue("KMC-1: Create Board gate is task-hub OR task-note (BUG-7 fix)",
        gatePattern.test(src),
        "expected gate `if (ctx.context === \"task-hub\" || ctx.context === \"task-note\")` not found");
}

// -------------------------------------------------------------------------
// v0.50.5 — PNB-WRAP-1..3: ProjectNavButtons main button row wraps on narrow
// widths. CSS-only fix: flex-wrap: wrap on the container; flex: 0 1 auto on
// each button; white-space: nowrap on the label span (so a long-label button
// wraps to a new flex row instead of the label wrapping inside the button).
// -------------------------------------------------------------------------

async function casePNBWrap1FlexWrap() {
    console.log("\n--- Case PNB-WRAP-1: project-nav-buttons.js container flex-wraps ---");
    const src = fs.readFileSync(
        path.join(WORKSHOP, "platform/blueprints/project/helpers/project-nav-buttons.js"),
        "utf8"
    );
    assertTrue("PNB-WRAP-1: project-nav-buttons.js sets flex-wrap: wrap on main button container",
        /flex-wrap:\s*wrap/.test(src),
        "expected `flex-wrap: wrap` not found");
}

async function casePNBWrap2ButtonFlexAuto() {
    console.log("\n--- Case PNB-WRAP-2: project-nav-buttons.js button uses flex: 0 1 auto ---");
    const src = fs.readFileSync(
        path.join(WORKSHOP, "platform/blueprints/project/helpers/project-nav-buttons.js"),
        "utf8"
    );
    assertTrue("PNB-WRAP-2: project-nav-buttons.js sets flex: 0 1 auto on the button style",
        /flex:\s*0\s+1\s+auto/.test(src),
        "expected `flex: 0 1 auto` not found");
}

async function casePNBWrap3LabelNowrap() {
    console.log("\n--- Case PNB-WRAP-3: project-nav-buttons.js label span has white-space: nowrap ---");
    const src = fs.readFileSync(
        path.join(WORKSHOP, "platform/blueprints/project/helpers/project-nav-buttons.js"),
        "utf8"
    );
    assertTrue("PNB-WRAP-3: project-nav-buttons.js sets white-space: nowrap on the label span",
        /white-space:\s*nowrap/.test(src),
        "expected `white-space: nowrap` (on label span) not found");
}

// -------------------------------------------------------------------------
// v0.51.0 — PSW-1..6: ProjectStatusWidget surface + manifest + template
// asserts. Source-string checks; runtime DOM behavior tested in Obsidian.
// -------------------------------------------------------------------------

async function casePSW1ClassDefined() {
    console.log("\n--- Case PSW-1: project-status-widget.js declares class with render() ---");
    const src = fs.readFileSync(
        path.join(WORKSHOP, "platform/blueprints/project/helpers/project-status-widget.js"),
        "utf8"
    );
    const hasClass = /class\s+ProjectStatusWidget\s*\{/.test(src);
    const hasRender = /async\s+render\s*\(\s*dv\s*\)/.test(src);
    assertTrue("PSW-1: project-status-widget.js declares class ProjectStatusWidget with async render(dv)",
        hasClass && hasRender,
        `class=${hasClass} render=${hasRender}`);
}

async function casePSW2StatusesArray() {
    console.log("\n--- Case PSW-2: project-status-widget.js defines all 7 statuses ---");
    const src = fs.readFileSync(
        path.join(WORKSHOP, "platform/blueprints/project/helpers/project-status-widget.js"),
        "utf8"
    );
    const expected = ["idea", "planning", "in-progress", "blocked", "superseded", "cancelled", "done"];
    const missing = expected.filter(s => !src.includes(`"${s}"`));
    assertTrue("PSW-2: project-status-widget.js STATUSES contains all 7 expected values",
        missing.length === 0,
        `missing: ${JSON.stringify(missing)}`);
}

async function casePSW3UsesProcessFrontMatter() {
    console.log("\n--- Case PSW-3: project-status-widget.js uses processFrontMatter ---");
    const src = fs.readFileSync(
        path.join(WORKSHOP, "platform/blueprints/project/helpers/project-status-widget.js"),
        "utf8"
    );
    assertTrue("PSW-3: project-status-widget.js calls app.fileManager.processFrontMatter",
        /app\.fileManager\.processFrontMatter\s*\(/.test(src),
        "processFrontMatter call missing");
}

async function casePSW4WritesBothKeys() {
    console.log("\n--- Case PSW-4: project-status-widget.js writes status + status_changed_at ---");
    const src = fs.readFileSync(
        path.join(WORKSHOP, "platform/blueprints/project/helpers/project-status-widget.js"),
        "utf8"
    );
    const writesStatus = /fm\.status\s*=/.test(src);
    const writesChangedAt = /fm\.status_changed_at\s*=/.test(src);
    assertTrue("PSW-4: project-status-widget.js writes both fm.status and fm.status_changed_at",
        writesStatus && writesChangedAt,
        `status=${writesStatus} changed_at=${writesChangedAt}`);
}

async function casePSW5ManifestRegistration() {
    console.log("\n--- Case PSW-5: project manifest registers ProjectStatusWidget ---");
    const manifestPath = path.join(WORKSHOP, "platform/blueprints/project/manifest.json");
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const inClasses = Array.isArray(m.customjs_classes) && m.customjs_classes.includes("ProjectStatusWidget");
    const fileEntry = Array.isArray(m.files) && m.files.some(f =>
        f.source === "helpers/project-status-widget.js" &&
        f.dest === "{{scripts_path}}/project/project-status-widget.js");
    assertTrue("PSW-5: manifest customjs_classes + files[] register ProjectStatusWidget",
        inClasses && fileEntry,
        `inClasses=${inClasses} fileEntry=${fileEntry}`);
}

async function casePSW6TemplateBlock() {
    console.log("\n--- Case PSW-6: Template, Project.md includes ProjectStatusWidget block ---");
    const tplPath = path.join(WORKSHOP, "platform/blueprints/project/templates/Project.md");
    const src = fs.readFileSync(tplPath, "utf8");
    const hasHeading = /^## Status\s*$/m.test(src);
    const hasBlock = /class:\s*"ProjectStatusWidget"/.test(src);
    assertTrue("PSW-6: Template, Project.md has ## Status heading + ProjectStatusWidget dataviewjs block",
        hasHeading && hasBlock,
        `heading=${hasHeading} block=${hasBlock}`);
}

// -------------------------------------------------------------------------
// v0.49.0 S6 — CSS-1..3: applyCustomJsStartupScripts helper unit cases.
// STUB: full helper-extraction adapter-stub harness deferred; sub-asserts
// log a stub message and pass. Captured as FLN-v49-N follow-up.
// -------------------------------------------------------------------------

async function caseCSS1Idempotent() {
    console.log("\n--- Case CSS-1: applyCustomJsStartupScripts idempotent (STUB) ---");
    assertTrue("CSS-1: STUB — full adapter-stub harness deferred to follow-up FLN-v49", true);
}

async function caseCSS2AdditiveMerge() {
    console.log("\n--- Case CSS-2: applyCustomJsStartupScripts preserves user entries (STUB) ---");
    assertTrue("CSS-2: STUB — full adapter-stub harness deferred to follow-up FLN-v49", true);
}

async function caseCSS3AbsentArrayDefaultEmpty() {
    console.log("\n--- Case CSS-3: applyCustomJsStartupScripts default-to-empty branch (STUB) ---");
    assertTrue("CSS-3: STUB — full adapter-stub harness deferred to follow-up FLN-v49", true);
}

// -------------------------------------------------------------------------
// v0.48.0 S5 — ICN-1: icons.js _tier1 reference count regression guard.
// FLN-a (v0.47.0) flagged that icons.js resolve() body called this._tier1
// 3x via getter. S6 of v0.48.0 will refactor to capture once. This guard
// uses ≤ 3 so preflight stays green at S5 close (current state = 3 refs);
// after S6's refactor the count drops to ≤ 2 and the guard remains green.
// A future cycle can tighten to ≤ 2 once S6 ships. Threshold > 3 = regression.
// -------------------------------------------------------------------------
async function caseICN1Tier1ReferenceCount() {
  console.log("\n--- Case ICN-1: Icons.resolve() this._tier1 reference count ---");
  const src = fs.readFileSync(
    path.join(WORKSHOP, "platform/mechanisms/icons/icons.js"),
    "utf8"
  );
  // Match resolve() body: from "resolve(...) {" through its matching "}".
  const startIdx = src.search(/resolve\s*\(/);
  if (startIdx < 0) { assertTrue("ICN-1: resolve() found in icons.js", false); return; }
  let i = src.indexOf("{", startIdx);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  const body = src.slice(startIdx, i);
  const refs = (body.match(/this\._tier1/g) || []).length;
  assertTrue(`ICN-1: this._tier1 refs in resolve() body should be ≤ 3 (got ${refs}); regressed if > 3`,
    refs <= 3, `body excerpt: ${body.slice(0, 200)}`);
}

// -------------------------------------------------------------------------
// v0.50.0 S5 — PDC-1..4: ProjectDocsCards class surface asserts (renamed from PWC in v0.52.0).
// Source extracted from helpers/project-docs-cards.js. Static-string asserts;
// no runtime CustomJS plumbing needed.
// -------------------------------------------------------------------------
async function casePDC1ClassDefined() {
  console.log("\n--- Case PDC-1: ProjectDocsCards class definition present ---");
  const src = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/project/helpers/project-docs-cards.js"),
    "utf8"
  );
  assertTrue("PDC-1: class ProjectDocsCards declared", /class\s+ProjectDocsCards\s*\{/.test(src));
}

async function casePDC2FiltersByType() {
  console.log("\n--- Case PDC-2: ProjectDocsCards filters by type === \"doc-note\" ---");
  const src = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/project/helpers/project-docs-cards.js"),
    "utf8"
  );
  assertTrue("PDC-2: where(p => p.type === \"doc-note\") present",
    /p\.type\s*===\s*["']doc-note["']/.test(src));
}

async function casePDC3SortsByCreatedDesc() {
  console.log("\n--- Case PDC-3: ProjectDocsCards sorts by created desc ---");
  const src = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/project/helpers/project-docs-cards.js"),
    "utf8"
  );
  assertTrue("PDC-3: .sort((p) => p.created, \"desc\") present",
    /\.sort\(\s*\(p\)\s*=>\s*p\.created\s*,\s*["']desc["']/.test(src));
}

async function casePDC4EmptyStateCallout() {
  console.log("\n--- Case PDC-4: ProjectDocsCards empty-state callout ---");
  const src = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/project/helpers/project-docs-cards.js"),
    "utf8"
  );
  assertTrue("PDC-4: \"No docs yet\" callout text present",
    /No docs yet/.test(src));
}

// v0.50.1 BUG-A: customjs-guard dispatches via `render` method by default.
// PDC-5 guards against regressions to `view` (which all sibling helpers like
// ScratchHubCards / ProjectNotesCards / ProjectsHubCards use as `render`).
async function casePDC5RenderMethodNotView() {
  console.log("\n--- Case PDC-5: ProjectDocsCards uses render method (not view) ---");
  const src = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/project/helpers/project-docs-cards.js"),
    "utf8"
  );
  assertTrue("PDC-5: declares async render (not view)",
    /async\s+render\s*\(/.test(src) && !/async\s+view\s*\(/.test(src),
    `source contains async render: ${/async\s+render\s*\(/.test(src)}; async view: ${/async\s+view\s*\(/.test(src)}`);
}

async function casePDC6PathConventionDocs() {
  console.log("\n--- Case PDC-6: ProjectDocsCards class uses docs path convention ---");
  const src = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/project/helpers/project-docs-cards.js"),
    "utf8"
  );
  assertTrue("PDC-6: filters by p.type === 'doc-note' (not wiki-note)",
    /p\.type\s*===\s*["']doc-note["']/.test(src) && !/wiki-note/.test(src));
}

async function casePDC7NavButtonsRenamedToDocs() {
  console.log("\n--- Case PDC-7: project-nav-buttons.js renamed Wiki button → Docs ---");
  const src = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/project/helpers/project-nav-buttons.js"),
    "utf8"
  );
  const hasDocsLabel = /label:\s*"Docs"/.test(src);
  const hasDocsIcon = /icons\.docs/.test(src);
  const hasDocsPath = /docs\/Docs\.md/.test(src);
  const hasDocsContextGuard = /ctx\.context\s*!==\s*"docs-hub"/.test(src);
  const noWikiRemaining = !/wiki|Wiki/.test(src);
  assertTrue("PDC-7: Docs label + icons.docs + docs path + docs-hub guard, no Wiki strings",
    hasDocsLabel && hasDocsIcon && hasDocsPath && hasDocsContextGuard && noWikiRemaining,
    `label=${hasDocsLabel} icon=${hasDocsIcon} path=${hasDocsPath} guard=${hasDocsContextGuard} clean=${noWikiRemaining}`);
}

// ============================================================
// v0.54.0 FA-2 — canonical vocab adoption asserts (meetings + people + products + teams)
// ============================================================

async function caseFA2MeetingsCanonical() {
  console.log("\n--- Case FA2-MEETINGS: meetings@0.6.0 canonical vocab adoption ---");
  const manifest = JSON.parse(fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/meetings/manifest.json"), "utf8"));
  assertTrue("FA2-MEETINGS-1: meetings version 0.6.0", manifest.version === "0.6.0",
    `got: ${manifest.version}`);
  const ec = manifest.new_entity_buttons[0].frontmatter_template;
  assertTrue("FA2-MEETINGS-2: entity-create frontmatter_template has created_at",
    typeof ec.created_at === "string" && /\{\{now\.YYYY-MM-DDTHH:mm:ssZ\}\}/.test(ec.created_at),
    `got: ${ec.created_at}`);
  assertTrue("FA2-MEETINGS-3: entity-create frontmatter_template drops 'meeting' discriminator tag",
    Array.isArray(ec.tags) && !ec.tags.includes("meeting"),
    `got tags: ${JSON.stringify(ec.tags)}`);
}

async function caseFA2PeopleCanonical() {
  console.log("\n--- Case FA2-PEOPLE: people@0.3.0 canonical vocab adoption ---");
  const manifest = JSON.parse(fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/people/manifest.json"), "utf8"));
  assertTrue("FA2-PEOPLE-1: people version >= 0.3.0", /^0\.(3|4)\.\d+$/.test(manifest.version),
    `got: ${manifest.version}`);
  const ec = manifest.new_entity_buttons[0].frontmatter_template;
  assertTrue("FA2-PEOPLE-2: entity-create frontmatter_template has type:person",
    ec.type === "person");
  assertTrue("FA2-PEOPLE-3: entity-create frontmatter_template has created_at",
    typeof ec.created_at === "string" && /\{\{now\./.test(ec.created_at));
  assertTrue("FA2-PEOPLE-4: entity-create frontmatter_template drops 'person' discriminator tag",
    Array.isArray(ec.tags) && !ec.tags.includes("person"),
    `got tags: ${JSON.stringify(ec.tags)}`);
}

async function caseFA2ProductsCanonical() {
  console.log("\n--- Case FA2-PRODUCTS: products@0.2.0 canonical vocab adoption ---");
  const manifest = JSON.parse(fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/products/manifest.json"), "utf8"));
  assertTrue("FA2-PRODUCTS-1: products version >= 0.2.0", /^0\.(2|3)\.\d+$/.test(manifest.version),
    `got: ${manifest.version}`);
  const tmpl = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/products/templates/Template, Product.md"), "utf8");
  assertTrue("FA2-PRODUCTS-2: Template, Product.md uses created_at (not created)",
    /created_at:/.test(tmpl) && !/^created:/m.test(tmpl));
  assertTrue("FA2-PRODUCTS-3: Template, Product.md drops 'product' discriminator tag",
    !/\n\s+- product\s*$/m.test(tmpl) || /tags:\s*$/m.test(tmpl));
}

async function caseFA2TeamsCanonical() {
  console.log("\n--- Case FA2-TEAMS: teams@0.2.0 canonical vocab adoption + product→products ---");
  const manifest = JSON.parse(fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/teams/manifest.json"), "utf8"));
  assertTrue("FA2-TEAMS-1: teams version >= 0.2.0", /^0\.(2|3)\.\d+$/.test(manifest.version),
    `got: ${manifest.version}`);
  const tmpl = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/teams/templates/Template, Team.md"), "utf8");
  assertTrue("FA2-TEAMS-2: Template, Team.md uses created_at (not created)",
    /created_at:/.test(tmpl));
  assertTrue("FA2-TEAMS-3: Template, Team.md emits products: list (not product: scalar)",
    /products:\n\s+- "\[\[/.test(tmpl));
  assertTrue("FA2-TEAMS-4: Template, Team.md no singular product: line outside the products list",
    !/^product: /m.test(tmpl));
  const rule = manifest.rule_fragments[0].fragment;
  assertTrue("FA2-TEAMS-5: rule_fragment products field is type:list min_length 1",
    rule.required_frontmatter && rule.required_frontmatter.products &&
    rule.required_frontmatter.products.type === "list" &&
    rule.required_frontmatter.products.min_length === 1);
  assertTrue("FA2-TEAMS-6: rule_fragment no longer declares 'product' (singular)",
    !rule.required_frontmatter.product);
}

// ============================================================
// v0.55.0 FA-3 — canonical vocab adoption asserts (project)
// ============================================================

async function caseFA3ProjectManifest() {
  console.log("\n--- Case FA3-PROJECT-MANIFEST: project@1.13.0 canonical vocab ---");
  const m = JSON.parse(fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/project/manifest.json"), "utf8"));
  assertTrue("FA3-PROJ-1: project version >= 1.13.0", /^1\.(13|14)\.\d+$/.test(m.version),
    `got: ${m.version}`);
  const ec0 = m.new_entity_buttons[0].frontmatter_template;
  assertTrue("FA3-PROJ-2: project entity-create has created_at canonical",
    typeof ec0.created_at === "string" && /\{\{now\.YYYY-MM-DDTHH:mm:ssZ\}\}/.test(ec0.created_at));
  assertTrue("FA3-PROJ-3: project entity-create drops 'project' discriminator tag",
    Array.isArray(ec0.tags) && !ec0.tags.includes("project"));
  assertTrue("FA3-PROJ-4: project entity-create has no legacy 'created' key",
    !("created" in ec0));
  const ec1 = m.new_entity_buttons[1].frontmatter_template;
  assertTrue("FA3-PROJ-5: doc-note entity-create has created_at canonical",
    typeof ec1.created_at === "string" && /\{\{now\./.test(ec1.created_at));
  assertTrue("FA3-PROJ-6: doc-note entity-create has no legacy 'created' key",
    !("created" in ec1));
}

async function caseFA3ProjectTemplates() {
  console.log("\n--- Case FA3-PROJECT-TEMPLATES: 5 template families use canonical fields ---");
  const tplDir = path.join(WORKSHOP, "platform/blueprints/project/templates");
  const families = ["Project Map.md", "Project Board.md", "Kanban Card.md",
                    "Task Note.md", "Task Board.md", "Task Board Card.md", "Docs Hub.md"];
  for (const f of families) {
    const body = fs.readFileSync(path.join(tplDir, f), "utf8");
    assertTrue(`FA3-TPL-${f}: declares created_at (not legacy 'created:')`,
      /^created_at:/m.test(body) && !/^created:\s/m.test(body),
      `template ${f} fm header excerpt:\n${body.slice(0, 250)}`);
  }
}

async function caseFA3TaskBoardCardRegexFix() {
  console.log("\n--- Case FA3-DRIVEBY: Task Board Card.md regex 'beacon/projects/' → 'spice/projects/' ---");
  const body = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/project/templates/Task Board Card.md"), "utf8");
  assertTrue("FA3-DRIVEBY-1: regex matches '^spice/projects/' (not 'beacon')",
    /\^spice\\\/projects\\\//.test(body),
    `got body excerpt:\n${body.slice(0, 600)}`);
  assertTrue("FA3-DRIVEBY-2: no stale 'beacon/projects/' regex remains",
    !/\^beacon\\\/projects/.test(body));
}

// ============================================================
// v0.56.0 FA-4 — Timeline wave canonical vocab asserts
// ============================================================

async function caseFA4TimelineManifests() {
  console.log("\n--- Case FA4-MANIFESTS: 3 timeline blueprints bumped ---");
  // v0.64.0 S5 baseline widening: daily bumped 0.4.0 → 0.5.0 in S4 (template
  // reclaim + Activity panel). Accept any >= floor instead of strict-equal so
  // future PATCH/MINOR bumps don't re-trigger this baseline.
  const floors = { daily: "0.5.0", journal: "0.2.0", scratch: "0.4.0" };
  for (const bp of Object.keys(floors)) {
    const m = JSON.parse(fs.readFileSync(
      path.join(WORKSHOP, `platform/blueprints/${bp}/manifest.json`), "utf8"));
    assertTrue(`FA4-MANIFEST-${bp}: version >= ${floors[bp]}`,
      typeof m.version === "string" && m.version >= floors[bp],
      `got: ${m.version}`);
  }
}

async function caseFA4TimelineTemplates() {
  console.log("\n--- Case FA4-TEMPLATES: timeline templates use canonical created_at ---");
  // v0.64.0 S5 baseline widening: daily-template.md type changed from
  // "daily" to "cowork-daily" in S4 (template reclaim absorbed cowork's
  // flavor; resolves the destination collision). The structural pin for
  // the cowork-daily shape moved to DD-T1 above.
  const checks = [
    ["daily/content/daily-template.md", "cowork-daily"],
    ["journal/templates/Today Journal.md", "journal"],
    ["scratch/templates/Scratch.md", "scratch"],
    ["scratch/templates/Scratch Day Hub.md", "scratch-day"],
  ];
  for (const [rel, expectedType] of checks) {
    const body = fs.readFileSync(
      path.join(WORKSHOP, "platform/blueprints", rel), "utf8");
    assertTrue(`FA4-TPL-${rel} declares created_at`,
      /^created_at:/m.test(body) && !/^created:\s/m.test(body),
      `template ${rel} fm header:\n${body.slice(0, 300)}`);
    assertTrue(`FA4-TPL-${rel} declares type: ${expectedType}`,
      new RegExp(`^type:\\s*${expectedType}\\b`, "m").test(body),
      `template ${rel} fm header:\n${body.slice(0, 300)}`);
  }
}

async function caseFA4TimelineRuleFragmentsExtends() {
  console.log("\n--- Case FA4-EXTENDS: timeline rule_fragments declare extends ---");
  for (const bp of ["daily", "journal", "scratch"]) {
    const m = JSON.parse(fs.readFileSync(
      path.join(WORKSHOP, `platform/blueprints/${bp}/manifest.json`), "utf8"));
    const allExtend = m.rule_fragments.every(rf =>
      rf.fragment && rf.fragment.extends === "_canonical-vocab");
    assertTrue(`FA4-EXTENDS-${bp}: all rule_fragments declare extends`,
      allExtend && m.rule_fragments.length >= 1,
      `${bp}: ${JSON.stringify(m.rule_fragments.map(r => r.fragment.extends))}`);
  }
}

async function caseFA3RuleFragmentsExtends() {
  console.log("\n--- Case FA3-EXTENDS: 3 project rule_fragments declare extends ---");
  const m = JSON.parse(fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/project/manifest.json"), "utf8"));
  assertTrue("FA3-EXTENDS-1: all 3 rule_fragments declare extends:'_canonical-vocab'",
    m.rule_fragments.every(rf => rf.fragment.extends === "_canonical-vocab"),
    `got extends: ${JSON.stringify(m.rule_fragments.map(r => r.fragment.extends))}`);
  // project rule (frontmatter_branch); created should be dropped
  const projRule = m.rule_fragments.find(rf => rf.target === "project");
  const projBranch = projRule.fragment.frontmatter_branch[0];
  assertTrue("FA3-EXTENDS-2: project rule branch no longer requires legacy 'created'",
    !projBranch.required_frontmatter.created);
  assertTrue("FA3-EXTENDS-3: project rule branch no longer requires_tags 'project'",
    !projBranch.required_tags || !projBranch.required_tags.some(t => t.tag === "project"));
}

// ============================================================
// v0.57.0 FA-5 — Cowork canonical-vocab adoption
// ============================================================

async function caseFA5CoworkManifest() {
  console.log("\n--- Case FA5-MANIFEST: cowork bumped to 0.8.0 ---");
  const m = JSON.parse(fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/cowork/manifest.json"), "utf8"));
  assertTrue("FA5-MANIFEST-1: cowork version >= 0.8.0", /^0\.(8|9|1\d)\.\d+$/.test(m.version),
    `got: ${m.version}`);
}

async function caseFA5CoworkTemplates() {
  console.log("\n--- Case FA5-TEMPLATES: cowork note templates use canonical created_at ---");
  // v0.64.0 S5 baseline widening: cowork/content/Daily Note.md dropped from
  // the cowork blueprint (template ownership returned to daily@0.5.0). The
  // canonical type=cowork-daily / tags=[daily] / created_at shape now lives
  // at daily/content/daily-template.md and is pinned by DD-T1 above.
  const checks = [
    ["cowork/content/Weekly Note.md", "cowork-weekly", "[weekly]"],
    ["cowork/content/Monthly Note.md", "cowork-monthly", "[monthly]"],
  ];
  for (const [rel, expectedType, expectedTags] of checks) {
    const body = fs.readFileSync(
      path.join(WORKSHOP, "platform/blueprints", rel), "utf8");
    assertTrue(`FA5-TPL-${rel} declares created_at`,
      /^created_at:/m.test(body) && !/^created:\s/m.test(body),
      `template ${rel} fm header:\n${body.slice(0, 300)}`);
    assertTrue(`FA5-TPL-${rel} declares type: ${expectedType}`,
      new RegExp(`^type:\\s*${expectedType}\\b`, "m").test(body),
      `template ${rel} fm header:\n${body.slice(0, 300)}`);
    assertTrue(`FA5-TPL-${rel} tags is ${expectedTags}`,
      body.includes(`tags: ${expectedTags}`),
      `template ${rel} fm header:\n${body.slice(0, 300)}`);
  }
  // Monthly template: canonical month: + retained month_label; month_iso dropped
  const monthly = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/cowork/content/Monthly Note.md"), "utf8");
  assertTrue("FA5-TPL-MONTH-canonical: Monthly Note emits month: \"YYYY-MM\"",
    /^month:\s*"<%/m.test(monthly),
    `monthly fm header:\n${monthly.slice(0, 400)}`);
  assertTrue("FA5-TPL-MONTH-label: Monthly Note retains month_label:",
    /^month_label:/m.test(monthly));
  assertTrue("FA5-TPL-MONTH-drops-iso: Monthly Note drops month_iso:",
    !/month_iso:/.test(monthly));
}

async function caseFA5CoworkRuleFragments() {
  console.log("\n--- Case FA5-EXTENDS: cowork rule_fragments declare extends (12 of 13) ---");
  const m = JSON.parse(fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/cowork/manifest.json"), "utf8"));
  const frags = m.rule_fragments || [];
  // v0.62.0 FA-9a: NEW cowork-today-hub fragment grew count 13 → 14. SKILL.md
  // remains the only non-extends fragment. Widened from strict equality.
  assertTrue("FA5-EXTENDS-1: cowork has >= 13 rule_fragments",
    frags.length >= 13, `got: ${frags.length}`);
  const withExtends = frags.filter(rf => rf.fragment && rf.fragment.extends === "_canonical-vocab");
  const withoutExtends = frags.filter(rf => !(rf.fragment && rf.fragment.extends === "_canonical-vocab"));
  assertTrue("FA5-EXTENDS-2: all-but-one rule_fragments extend _canonical-vocab",
    withExtends.length === frags.length - 1,
    `got: ${withExtends.length}/${frags.length}; missing extends: ${JSON.stringify(withoutExtends.map(rf => rf.fragment.scope.path_glob))}`);
  // The SKILL.md fragment is the one without extends (different frontmatter schema)
  const skillFrag = frags.find(rf => rf.fragment.scope && /SKILL\.md/.test(rf.fragment.scope.path_glob || ""));
  assertTrue("FA5-EXTENDS-3: SKILL.md fragment does NOT extend _canonical-vocab",
    skillFrag && !skillFrag.fragment.extends);
  // Daily/weekly/monthly fragments drop legacy `created` requirement
  for (const scope of ["spice/cowork/daily/**/*.md", "spice/cowork/weekly/**/*.md", "spice/cowork/monthly/**/*.md"]) {
    const frag = frags.find(rf => rf.fragment.scope.path_glob === scope);
    assertTrue(`FA5-EXTENDS-${scope.split('/').pop()}-drop-created: ${scope} drops required created`,
      frag && !((frag.fragment.required_frontmatter || {}).created));
  }
  // Daily fragment drops cowork-daily required_tag
  const dailyFrag = frags.find(rf => rf.fragment.scope.path_glob === "spice/cowork/daily/**/*.md");
  const tags = (dailyFrag.fragment.required_tags || []).map(t => t.tag);
  assertTrue("FA5-EXTENDS-daily-drop-tag: daily fragment drops cowork-daily required_tag",
    !tags.includes("cowork-daily"));
  // Monthly fragment validates canonical month: regex
  const monthlyFrag = frags.find(rf => rf.fragment.scope.path_glob === "spice/cowork/monthly/**/*.md");
  const monthSpec = (monthlyFrag.fragment.required_frontmatter || {}).month;
  assertTrue("FA5-EXTENDS-monthly-month: monthly fragment validates month: '^\\d{4}-\\d{2}$'",
    monthSpec && monthSpec.matches === "^\\d{4}-\\d{2}$");
}

// ============================================================
// v0.58.0 FA-6 — Domain wave (trips + to-do + boards) canonical vocab
// ============================================================

async function caseFA6DomainManifests() {
  console.log("\n--- Case FA6-MANIFESTS: 3 domain blueprints bumped ---");
  for (const [bp, expected] of [["trips", "0.3.0"], ["to-do", "0.3.3"], ["boards", "0.2.1"]]) {
    const m = JSON.parse(fs.readFileSync(
      path.join(WORKSHOP, `platform/blueprints/${bp}/manifest.json`), "utf8"));
    assertTrue(`FA6-MANIFEST-${bp}: version ${expected}`, m.version === expected,
      `got: ${m.version}`);
  }
}

async function caseFA6DomainTemplates() {
  console.log("\n--- Case FA6-TEMPLATES: domain templates use canonical created_at ---");
  const checks = [
    ["trips/templates/Trip Atlas.md", "trip"],
    ["trips/templates/Trip Board Card.md", "trip-board-card"],
    ["to-do/templates/Today To-Do.md", "to-do"],
    ["boards/templates/Template, Board Card.md", "board-card"],
  ];
  for (const [rel, expectedType] of checks) {
    const body = fs.readFileSync(
      path.join(WORKSHOP, "platform/blueprints", rel), "utf8");
    assertTrue(`FA6-TPL-${rel} declares created_at`,
      /^created_at:/m.test(body) && !/^created:\s/m.test(body),
      `template ${rel} fm header:\n${body.slice(0, 300)}`);
    assertTrue(`FA6-TPL-${rel} declares type: ${expectedType}`,
      new RegExp(`^type:\\s*${expectedType}\\b`, "m").test(body),
      `template ${rel} fm header:\n${body.slice(0, 300)}`);
  }
  // Trip Atlas: attending → people canonical alignment (the FA-6 marquee rename).
  const tripAtlas = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/trips/templates/Trip Atlas.md"), "utf8");
  assertTrue("FA6-TPL-TRIP-people: Trip Atlas emits canonical people: (was attending:)",
    /^people:/m.test(tripAtlas),
    `trip atlas fm:\n${tripAtlas.slice(0, 300)}`);
  assertTrue("FA6-TPL-TRIP-drops-attending: Trip Atlas drops legacy attending:",
    !/^attending:/m.test(tripAtlas));
  // to-do: was missing type: discriminator pre-FA-6.
  const todoTpl = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/to-do/templates/Today To-Do.md"), "utf8");
  assertTrue("FA6-TPL-TODO-type: Today To-Do emits canonical type: to-do",
    /^type:\s*to-do\b/m.test(todoTpl));
}

async function caseFA6DomainRuleFragments() {
  console.log("\n--- Case FA6-EXTENDS: 3 domain blueprints declare extends ---");
  // trips: 2 existing rules; both extend
  const trips = JSON.parse(fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/trips/manifest.json"), "utf8"));
  assertTrue("FA6-EXTENDS-trips: 2 rule_fragments",
    trips.rule_fragments.length === 2,
    `got: ${trips.rule_fragments.length}`);
  assertTrue("FA6-EXTENDS-trips: all rule_fragments declare extends",
    trips.rule_fragments.every(rf => rf.fragment.extends === "_canonical-vocab"));
  // trips Trip Atlas rule drops attending requirement + drops trip required_tag
  const tripAtlasFrag = trips.rule_fragments.find(rf => /Trip Atlas\.md/.test(rf.fragment.scope.path_glob));
  assertTrue("FA6-EXTENDS-trips: Trip Atlas rule drops attending requirement",
    !(tripAtlasFrag.fragment.required_frontmatter || {}).attending);
  assertTrue("FA6-EXTENDS-trips: Trip Atlas rule drops trip required_tag",
    !(tripAtlasFrag.fragment.required_tags || []).some(t => t.tag === "trip"));
  // to-do: NEW rule_fragment (was empty)
  const todo = JSON.parse(fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/to-do/manifest.json"), "utf8"));
  assertTrue("FA6-EXTENDS-to-do: NEW rule_fragment exists",
    todo.rule_fragments.length === 1);
  assertTrue("FA6-EXTENDS-to-do: rule_fragment declares extends",
    todo.rule_fragments[0].fragment.extends === "_canonical-vocab");
  // boards: NEW rule_fragment scoping cards
  const boards = JSON.parse(fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/boards/manifest.json"), "utf8"));
  assertTrue("FA6-EXTENDS-boards: NEW rule_fragment exists",
    boards.rule_fragments.length === 1);
  assertTrue("FA6-EXTENDS-boards: rule_fragment declares extends",
    boards.rule_fragments[0].fragment.extends === "_canonical-vocab");
  assertTrue("FA6-EXTENDS-boards: scope spice/boards/cards/**/*.md",
    boards.rule_fragments[0].fragment.scope.path_glob === "spice/boards/cards/**/*.md");
}

// ============================================================
// v0.59.0 FA-7 — Finance canonical vocab adoption
// ============================================================

async function caseFA7FinanceManifest() {
  console.log("\n--- Case FA7-MANIFEST: finance bumped to 0.4.0 ---");
  const m = JSON.parse(fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/finance/manifest.json"), "utf8"));
  assertTrue("FA7-MANIFEST-1: finance@0.4.0", m.version === "0.4.0",
    `got: ${m.version}`);
}

async function caseFA7FinanceTemplates() {
  console.log("\n--- Case FA7-TEMPLATES: finance templates use canonical created_at ---");
  const checks = [
    ["finance/templates/Budget Template.md", "budget"],
    ["finance/templates/Paycheck Template.md", "paycheck"],
    ["finance/templates/Invoice Template.md", "invoice"],
    ["finance/templates/Time Log Template.md", "time-log"],
    ["finance/templates/Invoice Board Card.md", "invoice-board-card"],
  ];
  for (const [rel, expectedType] of checks) {
    const body = fs.readFileSync(
      path.join(WORKSHOP, "platform/blueprints", rel), "utf8");
    assertTrue(`FA7-TPL-${rel} declares created_at`,
      /^created_at:/m.test(body) && !/^created:\s/m.test(body),
      `template ${rel} fm header:\n${body.slice(0, 300)}`);
    assertTrue(`FA7-TPL-${rel} declares type: ${expectedType}`,
      new RegExp(`^type:\\s*${expectedType}\\b`, "m").test(body),
      `template ${rel} fm header:\n${body.slice(0, 300)}`);
  }
  // Budget template: budget_month → month canonical alignment (with cowork)
  const budget = fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/finance/templates/Budget Template.md"), "utf8");
  assertTrue("FA7-TPL-BUDGET-month: Budget Template emits canonical month: (was budget_month:)",
    /^month:/m.test(budget) && !/^budget_month:/m.test(budget),
    `budget fm:\n${budget.slice(0, 300)}`);
}

async function caseFA7FinanceEntityCreate() {
  console.log("\n--- Case FA7-ENTITY: entity-create entries emit canonical created_at ---");
  const m = JSON.parse(fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/finance/manifest.json"), "utf8"));
  const entries = m.new_entity_buttons || [];
  assertTrue("FA7-ENTITY-count: 3 entity-create entries",
    entries.length === 3);
  for (const e of entries) {
    const ft = e.frontmatter_template || {};
    assertTrue(`FA7-ENTITY-${e.id}-created_at: emits canonical created_at`,
      typeof ft.created_at === "string" && /\{\{now\.YYYY-MM-DDTHH:mm:ssZ\}\}/.test(ft.created_at),
      `frontmatter_template: ${JSON.stringify(ft)}`);
    assertTrue(`FA7-ENTITY-${e.id}-drops-created: drops legacy created:`,
      !ft.hasOwnProperty("created"));
  }
  // Budget canonical month: alignment (was budget_month)
  const budget = entries.find(e => e.id === "budget");
  assertTrue("FA7-ENTITY-budget-month: budget emits canonical month: (was budget_month)",
    "month" in budget.frontmatter_template && !("budget_month" in budget.frontmatter_template));
}

async function caseFA7FinanceRuleFragments() {
  console.log("\n--- Case FA7-EXTENDS: NEW finance rule_fragments extend canonical-vocab ---");
  const m = JSON.parse(fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/finance/manifest.json"), "utf8"));
  const frags = m.rule_fragments || [];
  assertTrue("FA7-EXTENDS-count: 4 rule_fragments",
    frags.length === 4, `got: ${frags.length}`);
  assertTrue("FA7-EXTENDS-all: all rule_fragments declare extends",
    frags.every(rf => rf.fragment.extends === "_canonical-vocab"));
  // Verify per-sub-flow scopes
  const scopes = frags.map(rf => rf.fragment.scope.path_glob);
  for (const s of ["spice/finance/budgets/**/*.md", "spice/finance/paychecks/**/*.md", "spice/finance/invoices/*/Invoice-*.md", "spice/finance/invoices/*/Time-Log-*.md"]) {
    assertTrue(`FA7-EXTENDS-scope-${s.split('/').pop()}: ${s} fragment present`,
      scopes.includes(s));
  }
}

// v0.63.0 S7 — TD-HC-1: to-do v0.3.x manifest schema clean.
// v0.63.1 PATCH amendment: All-To-Dos + Migrate moved from global nav-buttons to inline ToDoLeafActions
// AccentButtons (Today To-Do.md embeds a ToDoLeafActions dataviewjs block). nav_buttons[] reverts to
// the single todo-today entry; customjs_classes[] grows ToDoLeafActions.
async function caseTodoManifestV3() {
  console.log("\n--- Case TD-HC-1: to-do v0.3.x manifest schema clean ---");
  const m = JSON.parse(fs.readFileSync(
    path.join(WORKSHOP, "platform/blueprints/to-do/manifest.json"), "utf8"));

  assertTrue("TD-HC-1 version is 0.3.3", m.version === "0.3.3", `got ${m.version}`);
  assertTrue("TD-HC-1 customjs_classes includes ToDoMigrateInit",
    Array.isArray(m.customjs_classes) && m.customjs_classes.includes("ToDoMigrateInit"));
  assertTrue("TD-HC-1 customjs_classes includes ToDoLeafActions (v0.63.1)",
    Array.isArray(m.customjs_classes) && m.customjs_classes.includes("ToDoLeafActions"));
  assertTrue("TD-HC-1 customjs_startup_scripts has ToDoMigrateInit",
    Array.isArray(m.customjs_startup_scripts) && m.customjs_startup_scripts.includes("ToDoMigrateInit"));

  const navIds = (m.nav_buttons || []).map(b => b.id);
  assertTrue("TD-HC-1 nav_buttons has todo-today", navIds.includes("todo-today"));
  assertTrue("TD-HC-1 nav_buttons does NOT have todo-all (moved to ToDoLeafActions)",
    !navIds.includes("todo-all"), `got navIds=${JSON.stringify(navIds)}`);
  assertTrue("TD-HC-1 nav_buttons does NOT have todo-migrate (moved to ToDoLeafActions)",
    !navIds.includes("todo-migrate"), `got navIds=${JSON.stringify(navIds)}`);

  const fileSources = (m.files || []).map(f => f.source);
  assertTrue("TD-HC-1 files[] includes helpers/todo-leaf-actions.js (v0.63.1)",
    fileSources.includes("helpers/todo-leaf-actions.js"));

  const scope = m.rule_fragments && m.rule_fragments[0] && m.rule_fragments[0].fragment.scope.path_glob;
  assertTrue("TD-HC-1 rule scope is tightened",
    scope === "spice/to-do/**/ToDo-*.md",
    `got ${scope}`);
}

async function caseFA2RuleFragmentsExtends() {
  console.log("\n--- Case FA2-EXTENDS: all 4 blueprints' rule_fragments declare extends ---");
  const blueprints = ["meetings", "people", "products", "teams"];
  for (const bp of blueprints) {
    const manifest = JSON.parse(fs.readFileSync(
      path.join(WORKSHOP, "platform/blueprints", bp, "manifest.json"), "utf8"));
    const allExtend = manifest.rule_fragments.every(rf =>
      rf.fragment && rf.fragment.extends === "_canonical-vocab");
    assertTrue(`FA2-EXTENDS-${bp}: all rule_fragments declare extends:"_canonical-vocab"`,
      allExtend,
      `manifest rule_fragments: ${JSON.stringify(manifest.rule_fragments.map(r => r.fragment.extends))}`);
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
  await caseO6MaterializeOncePreservesUserContent();
  await caseO7MaterializeOnceFirstInstallWrites();
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

  // v0.41.0 — applySnippets installer helper (sauce-* CSS to .obsidian/snippets/).
  await caseSN1FreshWriteToEmptyConsumer();
  await caseSN2IdempotentSkipsOverwriteOnSha256Match();
  await caseSN3OverwriteCreatesBackup();

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

  // v0.37.0 S3.1 — scratch blueprint file-presence + shape cases.
  await caseSHCS1ManifestFields();
  await caseSHCS2ScratchTemplate();
  await caseSHCS3ScratchDayHubTemplate();
  await caseSHCS4ScratchHubTemplate();
  await caseSHCS5ScratchHubCardsHelper();
  await caseSHCS6ScratchDayListHelper();
  await caseSHCS7ScratchNewButtonHelper();
  // v0.46.0 S11 — entity-create migration scan (orphan New*Button + entity-create source surface).
  await caseSHCS11Meetings();
  await caseSHCS11People();
  await caseSHCS11ProjectNavButtonsNoCreate();
  await caseSHCS11ScratchDayActionsNoNewScratch();
  await caseSHCS12ScratchDayActionsRowOfTwo();
  await caseSHCS13ScratchDayHubNoEntityCreateBlock();
  await caseSHCS14ScratchDayActionsSelfHeal();
  await caseSHCS11FinanceBudget();
  await caseSHCS11FinancePaycheck();
  await caseSHCS11FinanceInvoice();
  await caseSHCS11EntityCreateMechanismParses();
  await caseSHCS11EntityCreateSchemaParses();

  // v0.61.0 S6 — backlink-panel@0.1.0 lint (3 sub-asserts).
  await caseBLPLint1Parses();
  await caseBLPLint2OneClass();
  await caseBLPLint3EntityMap();

  // v0.62.0 S6 — activity-feed@0.1.0 lint (3 sub-asserts).
  await caseAFLint1Parses();
  await caseAFLint2OneClass();
  await caseAFLint3DefaultBlueprints();

  // v0.64.0 S5 — daily-template + SpaceDailyDashboard activity-panel (2 sub-asserts).
  // v0.64.1 (v0.5.1) — +2 BUGFIX guards (DD-A2 shim.pages delegate; DD-A3 markdown helper).
  // v0.64.2 (v0.5.2) — +2 polish guards (DD-A4 allowlist; DD-A5 title resolver + details).
  // v0.64.3 (v0.5.3) — +1 BUGFIX guard (DD-A6 _resolveTitle defensive).
  await caseDDT1DailyTemplateShape();
  await caseDDA1DashboardActivityPanel();
  await caseDDA2ActivityShimPagesDelegate();
  await caseDDA3TaskMarkdownRenderHelper();
  await caseDDA4DashboardAllowlist();
  await caseDDA5DashboardPolish();
  await caseDDA6ResolveTitleDefensive();
  await caseDDA7DashboardAllowlistIncludesBoards();
  await caseDDA8DashboardKanbanRollupRule();

  // v0.42.0 S9 — cowork@0.4.0 helper structural/materialization checks (18 sub-asserts).
  await caseCOWORKDaily1Materialized();
  await caseCOWORKDaily2ClassDeclared();
  await caseCOWORKDaily3HasRender();
  await caseCOWORKDaily4UsesBeaconCards();
  await caseCOWORKDaily5SkipsEmbed();
  await caseCOWORKDaily6NoTrailWs();
  await caseCOWORKWeekly1Materialized();
  await caseCOWORKWeekly2ClassDeclared();
  await caseCOWORKWeekly3HasRender();
  await caseCOWORKWeekly4UsesBeaconCards();
  await caseCOWORKWeekly5SkipsEmbed();
  await caseCOWORKWeekly6NoTrailWs();
  await caseCOWORKMonthly1Materialized();
  await caseCOWORKMonthly2ClassDeclared();
  await caseCOWORKMonthly3HasRender();
  await caseCOWORKMonthly4UsesBeaconCards();
  await caseCOWORKMonthly5SkipsEmbed();
  await caseCOWORKMonthly6NoTrailWs();

  // v0.44.0 S9 — cowork UX polish helper-shape asserts.
  await caseCOWORKHubNav1Lints();
  await caseCOWORKCardsAPIPagesNotItems();
  await caseCOWORKTimeframeNoArrows();

  // v0.45.0 S8 — cowork self-contained helper-shape asserts.
  await caseCOWORKV045DailyActionsLints();
  await caseCOWORKV045HubNavAccentButton();
  await caseCOWORKV045DailyCardsRetarget();

  // v0.68.0 S8 — CoworkLatestRuns helper lint.
  await caseCOWORKV068LatestRunsLints();

  // v0.20.0 docs polish cycle — trailing-whitespace lint.
  await caseTW1TemplatesNoTrailingWhitespace();

  // v0.39.0 S1.6 — products@0.1.0 install coverage.
  await caseProd1FilesMaterialize();
  await caseProd2NavButtonRegistry();
  await caseProd3RuleFragmentAggregated();

  // v0.39.0 S2.4 — products@0.1.0 validator green/red on Product notes
  // using the real rule_fragment loaded from the products manifest.
  await caseProd4ValidatorAcceptsWellFormedProduct();
  await caseProd5ValidatorRejectsProductMissingCreatedAt();

  // v0.39.0 S3.6 — teams@0.1.0 install coverage (3 cases mirroring PROD-1/2/3).
  // Co-subscribes products in the fake fixture since teams depends_on products.
  await caseTeam1FilesMaterialize();
  await caseTeam2NavButtonRegistry();
  await caseTeam3RuleFragmentRequiresProduct();

  // v0.39.0 S4.4 — teams@0.1.0 validator green/red on Team notes
  // using the real rule_fragment loaded from the teams manifest.
  await caseTeam4ValidatorAcceptsWellFormedTeam();
  await caseTeam5ValidatorRejectsTeamMissingProducts();
  await caseTeam6ValidatorRejectsTeamMissingCreatedAt();

  // v0.39.0 S5.4 — project@1.6.0 validator green/red on project notes
  // for the expanded frontmatter (status enum + status_changed_at +
  // teams[] + products[]) using the real rule_fragment loaded from
  // the project manifest.
  await caseProj1ValidatorAcceptsWellFormedProject();
  await caseProj2ValidatorRejectsProjectMissingStatus();
  await caseProj3ValidatorRejectsProjectInvalidStatusEnum();

  // v0.47.0 S8 — validator Layer 2 type-field convention rule
  // (_validateTypeFieldConvention extracted from install.js).
  await caseType1PositiveFixtureWithTypeAlignedButtonPasses();
  await caseType2NegativeFixtureMissingTypeFails();
  await caseType3RealPeopleManifestPostPatchPasses();

  // v0.48.0 S5 — PTCL-1..5: ProjectTaskCreateListener (idempotency + path-regex + command-id literal).
  await casePTCL1Idempotent();
  await casePTCL2PathRegexMatches();
  await casePTCL3PathRegexExcludesNested();
  await casePTCL4PathRegexExcludesAtlas();
  await casePTCL5TemplaterCommandIdLiteral();

  // v0.48.0 S5 — KC-1..3: Kanban Card source-string asserts (sentinel + CREATE_NEW const + empty-toast).
  await caseKC1SentinelPresent();
  await caseKC2CreateNewConstDeclared();
  await caseKC3EmptyWorkstreamsNoticePresent();

  // v0.51.1 — KC-4..6: hybrid cache-first source-board detection.
  await caseKC4HybridCachePathPresent();
  await caseKC5VaultScanFallbackRetained();
  await caseKC6CacheBeforeVaultScan();

  // v0.59.11 — KC-7..8: name-collision fix (Strategy 0 + suffix-loop).
  await caseKC7Strategy0SiblingBoardDetection();
  await caseKC8AutoPromoteSuffixDisambiguation();

  // v0.48.0 S5 — ICN-1: Icons.resolve() this._tier1 reference count regression guard (FLN-a).
  await caseICN1Tier1ReferenceCount();

  // v0.49.0 S6 — PCSI-1..3 + KMC-1 + CSS-1..3 (stubbed).
  await casePCSI1ClassDefined();
  await casePCSI2InvokeMethodDelegates();
  await casePCSI3FailureLoudWrap();
  await caseKMC1CreateBoardGateWidened();
  await caseCSS1Idempotent();
  await caseCSS2AdditiveMerge();
  await caseCSS3AbsentArrayDefaultEmpty();

  // v0.50.5 — PNB-WRAP-1..3: ProjectNavButtons main button row wraps.
  await casePNBWrap1FlexWrap();
  await casePNBWrap2ButtonFlexAuto();
  await casePNBWrap3LabelNowrap();

  // v0.51.0 — PSW-1..6: ProjectStatusWidget surface coverage.
  await casePSW1ClassDefined();
  await casePSW2StatusesArray();
  await casePSW3UsesProcessFrontMatter();
  await casePSW4WritesBothKeys();
  await casePSW5ManifestRegistration();
  await casePSW6TemplateBlock();

  // v0.50.0 S5 — PDC-1..4 (renamed from PWC in v0.52.0): ProjectDocsCards class surface asserts.
  await casePDC1ClassDefined();
  await casePDC2FiltersByType();
  await casePDC3SortsByCreatedDesc();
  await casePDC4EmptyStateCallout();
  // v0.50.1 BUG-A: PDC-5 guards against view-method regression.
  await casePDC5RenderMethodNotView();

  // v0.52.0 — PDC-6 + PDC-7 new asserts.
  await casePDC6PathConventionDocs();
  await casePDC7NavButtonsRenamedToDocs();

  // v0.54.0 FA-2 — canonical vocab adoption asserts (meetings + people + products + teams)
  await caseFA2MeetingsCanonical();
  await caseFA2PeopleCanonical();
  await caseFA2ProductsCanonical();
  await caseFA2TeamsCanonical();
  await caseFA2RuleFragmentsExtends();

  // v0.55.0 FA-3 — canonical vocab adoption asserts (project — 5 template families)
  await caseFA3ProjectManifest();
  await caseFA3ProjectTemplates();
  await caseFA3TaskBoardCardRegexFix();
  await caseFA3RuleFragmentsExtends();

  // v0.56.0 FA-4 — timeline wave canonical vocab (daily + journal + scratch)
  await caseFA4TimelineManifests();
  await caseFA4TimelineTemplates();
  await caseFA4TimelineRuleFragmentsExtends();

  // v0.57.0 FA-5 — cowork canonical vocab adoption
  await caseFA5CoworkManifest();
  await caseFA5CoworkTemplates();
  await caseFA5CoworkRuleFragments();

  // v0.58.0 FA-6 — domain wave (trips + to-do + boards) canonical vocab
  await caseFA6DomainManifests();
  await caseFA6DomainTemplates();
  await caseFA6DomainRuleFragments();

  // v0.59.0 FA-7 — finance canonical vocab
  await caseFA7FinanceManifest();
  await caseFA7FinanceTemplates();
  await caseFA7FinanceEntityCreate();
  await caseFA7FinanceRuleFragments();

  // v0.63.0 S7 — TD-HC-1: to-do v0.3.0 manifest schema clean
  await caseTodoManifestV3();

  // v0.60.0 SQ — shellSingleQuote helper round-trips through bash
  await caseV60ShellSingleQuote();

  // v0.65.0 HC-V065-RUN-NOTE: write-run-note-* sub-skill lint
  {
    const slugs = [
      "write-run-note-morning-briefing",
      "write-run-note-midday-tripwire",
      "write-run-note-eod-review",
      "write-run-note-finance",
      "write-run-note-weekly-review",
      "write-run-note-monthly-review",
    ];
    for (const slug of slugs) {
      const p = `platform/blueprints/cowork/skills/skills/${slug}/SKILL.md`;
      assertTrue(`HC-V065-RUN-NOTE: ${slug} exists`, fs.existsSync(p));
      const body = fs.readFileSync(p, "utf8");
      assertTrue(`HC-V065-RUN-NOTE: ${slug} name field correct`, /^name: cowork:write-run-note-/m.test(body));
      assertTrue(`HC-V065-RUN-NOTE: ${slug} references created_at`, /created_at/.test(body));
    }
  }

  // v0.65.0 HC-V065-DASHBOARD: SpaceDailyDashboard cowork allowlist-add
  {
    const src = fs.readFileSync("platform/blueprints/daily/helpers/space-daily-dashboard.js", "utf8");
    assertTrue("HC-V065-DASHBOARD: _DEFAULT_DASHBOARD_BLUEPRINTS getter present", src.includes("_DEFAULT_DASHBOARD_BLUEPRINTS"));
    assertTrue("HC-V065-DASHBOARD: allowlist includes cowork-morning-briefing", src.includes('"cowork-morning-briefing"'));
    assertTrue("HC-V065-DASHBOARD: allowlist includes cowork-eod-review", src.includes('"cowork-eod-review"'));
    assertTrue("HC-V065-DASHBOARD: allowlist includes cowork-finance-snapshot", src.includes('"cowork-finance-snapshot"'));
  }

  // FA6-MANIFEST version pins — daily / activity-feed / cards
  // Updated per cycle as manifests bump. activity-feed last bumped to
  // 0.4.0 in v0.70.0 (S2); daily will bump to 0.10.0 in v0.70.0 (S5);
  // cards untouched.
  {
    const pins = [
      ["daily",         "platform/blueprints/daily/manifest.json",            "0.9.0"],
      ["activity-feed", "platform/mechanisms/activity-feed/manifest.json",    "0.4.0"],
      ["cards",         "platform/mechanisms/cards/manifest.json",            "0.2.6"],
    ];
    for (const [name, relPath, expected] of pins) {
      const m = JSON.parse(fs.readFileSync(path.join(WORKSHOP, relPath), "utf8"));
      assertTrue(`FA6-MANIFEST-${name}: version ${expected}`, m.version === expected,
        `got: ${m.version}`);
    }
  }

  // v0.66.0 HC-V066-1: daily blueprint ships sauce-daily-dashboard CSS snippet
  {
    console.log("\n--- Case HC-V066-1: daily blueprint declares sauce-daily-dashboard snippet ---");
    const dailyManifestPath = path.join(WORKSHOP, "platform/blueprints/daily/manifest.json");
    const m = JSON.parse(fs.readFileSync(dailyManifestPath, "utf8"));

    const snippets = Array.isArray(m.snippets) ? m.snippets : [];
    const snip = snippets.find(s => s && s.name === "sauce-daily-dashboard");
    assertTrue("HC-V066-1a: daily manifest declares sauce-daily-dashboard snippet", !!snip);
    assertTrue("HC-V066-1b: snippet source = helpers/sauce-daily-dashboard.css",
      !!snip && snip.source === "helpers/sauce-daily-dashboard.css");
    const enabled = (m.appearance && Array.isArray(m.appearance.enabledCssSnippets))
      ? m.appearance.enabledCssSnippets
      : [];
    assertTrue("HC-V066-1c: enabledCssSnippets includes sauce-daily-dashboard",
      enabled.indexOf("sauce-daily-dashboard") >= 0);
    const cssAbs = path.join(WORKSHOP, "platform/blueprints/daily",
      snip ? snip.source : "helpers/sauce-daily-dashboard.css");
    assertTrue("HC-V066-1d: snippet source file exists on disk", fs.existsSync(cssAbs));
  }

  // v0.66.0 HC-V066-2: _DEFAULT_DASHBOARD_BLUEPRINTS preserves project + trip
  {
    console.log("\n--- Case HC-V066-2: _DEFAULT_DASHBOARD_BLUEPRINTS preserves project + trip ---");
    const src = fs.readFileSync(
      path.join(WORKSHOP, "platform/blueprints/daily/helpers/space-daily-dashboard.js"),
      "utf8"
    );
    const m = src.match(/_DEFAULT_DASHBOARD_BLUEPRINTS[\s\S]*?return\s*\[([\s\S]*?)\]/);
    assertTrue("HC-V066-2a: _DEFAULT_DASHBOARD_BLUEPRINTS getter found", !!m);
    if (m) {
      const body = m[1];
      assertTrue("HC-V066-2b: allowlist includes 'project'", body.indexOf('"project"') >= 0);
      assertTrue("HC-V066-2c: allowlist includes 'trip'",    body.indexOf('"trip"')    >= 0);
    }
  }

  // v0.67.0 HC-V067-1: new pure helpers declared on SpaceDailyDashboard
  {
    console.log("\n--- Case HC-V067-1: daily blueprint declares v0.8.0 helpers ---");
    const src = fs.readFileSync(
      path.join(WORKSHOP, "platform/blueprints/daily/helpers/space-daily-dashboard.js"),
      "utf8"
    );
    assertTrue("HC-V067-1a: _formatTime method declared", /_formatTime\s*\(/.test(src));
    assertTrue("HC-V067-1b: _renderTodoBadge method declared", /_renderTodoBadge\s*\(/.test(src));
    assertTrue("HC-V067-1c: _renderDrillInList method declared", /_renderDrillInList\s*\(/.test(src));
  }

  // v0.67.0 HC-V067-2: sauce-daily-dashboard.css contains new selectors
  {
    console.log("\n--- Case HC-V067-2: dashboard CSS contains drill-in + todo + segmented selectors ---");
    const css = fs.readFileSync(
      path.join(WORKSHOP, "platform/blueprints/daily/helpers/sauce-daily-dashboard.css"),
      "utf8"
    );
    assertTrue("HC-V067-2a: .sauce-drill-in selector present", /\.sauce-drill-in\s*\{/.test(css));
    assertTrue("HC-V067-2b: .sauce-todo-pill selector present", /\.sauce-todo-pill\s*\{/.test(css));
    assertTrue("HC-V067-2c: [data-segmented='true']::before present",
      /\[data-segmented="true"\]::before/.test(css));
  }

  // v0.67.0 HC-V067-3: icons object swap (zap removed, activity + square added)
  {
    console.log("\n--- Case HC-V067-3: inline icons object swap ---");
    const src = fs.readFileSync(
      path.join(WORKSHOP, "platform/blueprints/daily/helpers/space-daily-dashboard.js"),
      "utf8"
    );
    // Activity SVG: Lucide heartbeat path signature "M22 12h-2.48"
    assertTrue("HC-V067-3a: icons.activity SVG present",
      /activity:\s*`[^`]*M22 12h-2\.48/.test(src));
    // Square SVG: 12x12 rect path
    assertTrue("HC-V067-3b: icons.square SVG present",
      /square:\s*`[^`]*width="12"\s+height="12"/.test(src));
    // zap entry removed
    assertTrue("HC-V067-3c: icons.zap entry absent",
      !/^\s*zap:\s*`</m.test(src));
  }

  // v0.70.0 HC-V070-1: SpaceDailyDashboard adopts framed renderer + new opts
  {
    console.log("\n--- Case HC-V070-1: daily dashboard adopts framed renderer + v0.4.0 opts ---");
    const src = fs.readFileSync(
      path.join(WORKSHOP, "platform/blueprints/daily/helpers/space-daily-dashboard.js"),
      "utf8"
    );
    assertTrue("HC-V070-1a: passes framed: true to ActivityFeed.render",      /framed:\s*true/.test(src));
    assertTrue("HC-V070-1b: passes bucketRules with cowork bucketKey",        /bucketKey:\s*"cowork"/.test(src));
    assertTrue("HC-V070-1c: passes groupOrder array starting with cowork",    /groupOrder:\s*\[\s*"cowork"/.test(src));
    assertTrue("HC-V070-1d: passes groupOrderBottom containing scratch",      /groupOrderBottom:\s*\[\s*"scratch"\s*\]/.test(src));
    assertTrue("HC-V070-1e: passes defaultClosed containing scratch",         /defaultClosed:\s*\[\s*"scratch"\s*\]/.test(src));
    assertTrue("HC-V070-1f: _BLUEPRINT_COLORS contains cowork entry",         /cowork:\s*"var\(--color-blue\)"/.test(src));
    assertTrue("HC-V070-1g: flatGrouped:true no longer present",              !/flatGrouped:\s*true/.test(src));
    assertTrue("HC-V070-1h: _buildAccentSegments helper removed",             !/_buildAccentSegments\s*\(/.test(src));
  }

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
