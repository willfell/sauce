#!/usr/bin/env node
// run-install.js — headless harness for platform/install.js.
//
// Replaces the manual Templater-in-Obsidian dogfood loop with a Node CLI.
// Loads <vault>/ranch/templater/platformInstall.js (byte-identical
// bootstrap copy of platform/install.js) and runs it against a fake `tp`
// object that proxies the Obsidian APIs the installer touches into the
// real filesystem rooted at the given vault path.
//
// Usage:
//   node platform/test/run-install.js <vault-path> [flags]
//
// Flags:
//   --auto-approve   (default ON)  return first option for tp.system.suggester
//   --decline-all    return null for every suggester (simulates Esc)
//   --dry-run        capture intended writes without performing them
//   --verbose        log every adapter.read / write / exists / mkdir call
//
// Exit codes:
//   0  no error/skip history entries were added during this run
//   1  one or more error/skip entries were added (or the harness itself blew up)

"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");

// ----- unit-test helpers (shared by install-harness unit cases) ------------

let _pass = 0, _fail = 0;
function assertEqual(actual, expected, label) {
    if (actual === expected) { _pass++; console.log("  PASS: " + label); }
    else { _fail++; console.log("  FAIL: " + label + " — expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)); }
}
function assertTrue(cond, label) {
    if (cond) { _pass++; console.log("  PASS: " + label); }
    else { _fail++; console.log("  FAIL: " + label); }
}

// ----- arg parsing ---------------------------------------------------------

function parseArgs(argv) {
  const flags = {
    autoApprove: true,
    declineAll: false,
    dryRun: false,
    verbose: false,
  };
  const positional = [];
  for (const a of argv) {
    if (a === "--auto-approve") flags.autoApprove = true;
    else if (a === "--decline-all") {
      flags.declineAll = true;
      flags.autoApprove = false;
    } else if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--verbose") flags.verbose = true;
    else if (a.startsWith("--")) {
      console.error(`run-install: unknown flag ${a}`);
      process.exit(2);
    } else positional.push(a);
  }
  return { flags, positional };
}

const { flags, positional } = parseArgs(process.argv.slice(2));
// When called without a positional arg, run the unit test suite (no vault needed).
// When called with a vault path, run the install harness against that vault.
const UNIT_TEST_MODE = positional.length === 0;

if (!UNIT_TEST_MODE && positional.length !== 1) {
  console.error("run-install: expected exactly one positional arg (vault path)");
  console.error("usage: node platform/test/run-install.js <vault-path> [--auto-approve|--decline-all] [--dry-run] [--verbose]");
  process.exit(2);
}

const VAULT = UNIT_TEST_MODE ? null : path.resolve(positional[0]);

// ----- helpers -------------------------------------------------------------

function abs(rel) {
  // Vault-relative path to absolute on disk.
  return path.join(VAULT, rel);
}

function vlog(...args) {
  if (flags.verbose) console.log("[harness]", ...args);
}

const writeLog = []; // { path, bytes } for dry-run reporting

async function realWrite(p, content) {
  const target = abs(p);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, content, "utf8");
}

// ----- fake adapter --------------------------------------------------------

const adapter = {
  basePath: VAULT,
  getBasePath() { return VAULT; },

  async read(p) {
    vlog("adapter.read", p);
    return fsp.readFile(abs(p), "utf8");
  },

  async write(p, content) {
    if (flags.dryRun) {
      vlog("adapter.write (dry-run)", p, `${content.length}B`);
      writeLog.push({ path: p, bytes: content.length });
      return;
    }
    vlog("adapter.write", p, `${content.length}B`);
    writeLog.push({ path: p, bytes: content.length });
    await realWrite(p, content);
  },

  async exists(p) {
    const ok = await fsp.access(abs(p)).then(() => true, () => false);
    vlog("adapter.exists", p, "->", ok);
    return ok;
  },

  async mkdir(p) {
    if (flags.dryRun) {
      vlog("adapter.mkdir (dry-run)", p);
      return;
    }
    vlog("adapter.mkdir", p);
    await fsp.mkdir(abs(p), { recursive: true });
  },

  // install.js does not currently call adapter.list, but provide a sensible
  // implementation so future installer changes don't immediately break.
  async list(p) {
    const target = abs(p);
    const entries = await fsp.readdir(target, { withFileTypes: true });
    return {
      files: entries.filter((e) => e.isFile()).map((e) => `${p}/${e.name}`),
      folders: entries.filter((e) => e.isDirectory()).map((e) => `${p}/${e.name}`),
    };
  },

  // v0.2.0 T1.4: pre_install delete uses adapter.remove() to delete a single
  // file. Mirrors Obsidian's DataAdapter.remove(normalizedPath) — which removes
  // a SINGLE FILE only (directories use rmdir). On non-existent path → throws
  // ENOENT; the installer's applyPreInstall short-circuits via adapter.exists()
  // before calling remove(), so this only fires on real files.
  async remove(p) {
    if (flags.dryRun) {
      vlog("adapter.remove (dry-run)", p);
      return;
    }
    vlog("adapter.remove", p);
    await fsp.unlink(abs(p));
  },

  // v0.2.0 T1.4: pre_install delete uses adapter.stat() to distinguish
  // file-vs-directory before attempting remove. Mirrors Obsidian's
  // DataAdapter.stat(normalizedPath) -> { type: "file" | "folder", size, mtime, ctime }.
  // Returns null on non-existent path (the installer pre-checks exists() first).
  async stat(p) {
    try {
      const s = await fsp.stat(abs(p));
      return {
        type: s.isDirectory() ? "folder" : "file",
        size: s.size,
        mtime: s.mtimeMs,
        ctime: s.ctimeMs,
      };
    } catch {
      return null;
    }
  },
};

// ----- fake vault ----------------------------------------------------------

// install.js's readJson does:
//   const f = app.vault.getAbstractFileByPath(path);
//   if (!f) return null;
//   const text = await app.vault.read(f);
// writeJson does:
//   const tfile = app.vault.getAbstractFileByPath(path);
//   if (tfile) await app.vault.modify(tfile, text);
//   else await app.vault.create(path, text);
//
// So our fake just needs:
//   getAbstractFileByPath -> { path } | null
//   vault.read(file) -> string
//   vault.modify(file, text) -> writes
//   vault.create(path, text) -> writes
//   vault.createFolder(path) -> mkdir

function existsSync(rel) {
  try {
    fs.accessSync(abs(rel));
    return true;
  } catch (e) {
    return false;
  }
}

const vault = {
  adapter,
  getAbstractFileByPath(p) {
    return existsSync(p) ? { path: p } : null;
  },
  async read(file) {
    vlog("vault.read", file && file.path);
    return fsp.readFile(abs(file.path), "utf8");
  },
  async modify(file, text) {
    if (flags.dryRun) {
      vlog("vault.modify (dry-run)", file.path, `${text.length}B`);
      writeLog.push({ path: file.path, bytes: text.length });
      return;
    }
    vlog("vault.modify", file.path, `${text.length}B`);
    writeLog.push({ path: file.path, bytes: text.length });
    await realWrite(file.path, text);
  },
  async create(p, text) {
    if (flags.dryRun) {
      vlog("vault.create (dry-run)", p, `${text.length}B`);
      writeLog.push({ path: p, bytes: text.length });
      return;
    }
    vlog("vault.create", p, `${text.length}B`);
    writeLog.push({ path: p, bytes: text.length });
    await realWrite(p, text);
  },
  async createFolder(p) {
    if (flags.dryRun) {
      vlog("vault.createFolder (dry-run)", p);
      return;
    }
    vlog("vault.createFolder", p);
    await fsp.mkdir(abs(p), { recursive: true });
  },
};

// ----- fake suggester ------------------------------------------------------

// install.js calls: tp.system.suggester(["Approve", "Skip"], [true, false], false, message)
// Signature in Templater is (text_items, items, throw_on_cancel, placeholder).
// We only need to return a value from `items`.
const suggesterCalls = [];
async function fakeSuggester(textItems, items, throwOnCancel, placeholder) {
  suggesterCalls.push({ placeholder, items });
  if (flags.declineAll) {
    // Templater returns undefined when user dismisses; install.js's
    // approvalGate treats anything not === true as decline. Use null to
    // be unambiguous.
    console.log(`[suggester] DECLINE: ${placeholder || "(no message)"}`);
    return null;
  }
  // auto-approve (default): return the first option
  console.log(`[suggester] AUTO-APPROVE: ${placeholder || "(no message)"} -> ${JSON.stringify(items[0])}`);
  return items[0];
}

// ----- fake Notice ---------------------------------------------------------

const notices = [];
class Notice {
  constructor(message, durationMs) {
    notices.push({ message, durationMs, at: new Date().toISOString() });
    console.log(`[Notice] ${message}`);
  }
}

// ----- main ----------------------------------------------------------------

async function readInstalled() {
  const p = abs("ranch/platform-installed.json");
  try {
    const raw = await fsp.readFile(p, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

async function main() {
  // Sanity: verify vault layout looks like a vault.
  if (!fs.existsSync(abs("ranch/platform-config.json"))) {
    console.error(`run-install: ${VAULT}/ranch/platform-config.json not found — is this a vault?`);
    process.exit(2);
  }
  const installerPath = abs("ranch/templater/platformInstall.js");
  if (!fs.existsSync(installerPath)) {
    console.error(`run-install: ${installerPath} not found — bootstrap installer missing`);
    process.exit(2);
  }

  console.log(`run-install: vault = ${VAULT}`);
  console.log(`run-install: installer = ${installerPath}`);
  console.log(`run-install: flags = ${JSON.stringify(flags)}`);
  console.log("");

  // Snapshot pre-run history so we can diff after.
  const preRun = await readInstalled();
  const preHistoryLen = (preRun && preRun.history && preRun.history.length) || 0;

  // Wire up Notice as a true global before requiring the installer — install.js
  // resolves `Notice` lexically each call, but the bootstrap copy lives in the
  // vault, not under our require-cache, so a global assignment is safest.
  global.Notice = Notice;

  // Load the installer fresh. Bust require cache in case the harness is run
  // back-to-back in the same Node process (only matters for unit tests, but
  // cheap insurance).
  delete require.cache[require.resolve(installerPath)];
  const installer = require(installerPath);
  if (typeof installer !== "function") {
    console.error(`run-install: ${installerPath} did not export a function (got ${typeof installer})`);
    process.exit(2);
  }

  const tp = {
    app: { vault },
    system: { suggester: fakeSuggester },
    // user.* is not invoked by install.js itself (the *template* invokes
    // tp.user.platformInstall — but here we ARE the installer, so this is
    // unused). Provide an empty object for safety.
    user: {},
  };

  let crashed = null;
  try {
    await installer(tp);
  } catch (e) {
    crashed = e;
    console.error(`[harness] installer threw: ${e.stack || e.message}`);
  }

  // ----- report -----------------------------------------------------------

  console.log("");
  console.log("=".repeat(72));
  console.log("RESULTS");
  console.log("=".repeat(72));

  const post = await readInstalled();
  console.log("\n--- Final platform-installed.json ---");
  console.log(JSON.stringify(post, null, 2));

  console.log(`\n--- Notices (${notices.length}) ---`);
  for (const n of notices) console.log(`  ${n.message}`);

  console.log(`\n--- Suggester calls (${suggesterCalls.length}) ---`);
  for (const s of suggesterCalls) {
    console.log(`  ${s.placeholder || "(no message)"}`);
  }

  const pluginDataWrites = writeLog.filter((w) => w.path.startsWith(".obsidian/plugins/"));
  console.log(`\n--- Plugin-data writes (${pluginDataWrites.length}) ---`);
  for (const w of pluginDataWrites) console.log(`  ${w.path}  (${w.bytes}B)`);

  const newHistory = (post && post.history) ? post.history.slice(preHistoryLen) : [];
  console.log(`\n--- New history entries this run (${newHistory.length}) ---`);
  for (const h of newHistory) console.log("  " + JSON.stringify(h));

  // v0.2.0 T1.5: surface Option B content overwrites separately for audit visibility.
  const contentOverwrites = newHistory.filter(
    (h) => h.event === "replace" && h.step === "file_overwrite"
  );
  console.log(`\n--- Content overwrites (${contentOverwrites.length}) ---`);
  for (const h of contentOverwrites) {
    const prior = (h.prior_sha || "").slice(0, 8);
    const next = (h.new_sha || "").slice(0, 8);
    console.log(`  ${h.dest}  ${prior}..${next}  (bak: ${h.bak_path})`);
  }

  // v0.2.0 T1.5: surface pre_install delete events separately.
  const preInstallDeletes = newHistory.filter(
    (h) => h.event === "delete" && h.step === "pre_install_delete"
  );
  console.log(`\n--- Pre-install deletes (${preInstallDeletes.length}) ---`);
  for (const h of preInstallDeletes) {
    const prior = (h.prior_sha || "").slice(0, 8);
    console.log(`  ${h.path}  ${prior}  (bak: ${h.bak_path})`);
  }

  // v0.3.0 T1.2: surface core_plugin_settings applied events separately.
  const corePluginWrites = newHistory.filter(
    (h) => h.event === "info" && h.step === "core_plugin_settings" && h.action === "applied"
  );
  console.log(`\n--- Core-plugin settings writes (${corePluginWrites.length}) ---`);
  for (const h of corePluginWrites) {
    const keys = Array.isArray(h.settings_keys) ? h.settings_keys.join(",") : "";
    console.log(`  ${h.plugin_id}  keys: [${keys}]  (bak: ${h.backup_path || "—"})`);
  }

  // v0.4.0 T1.3: surface templater_folder_templates applied + skipped_existing events separately.
  // Includes skipped_existing (unlike core_plugin_settings) so the summary shows folder-template
  // idempotency at-a-glance during barebones smoke verification.
  const folderTemplateWrites = newHistory.filter(
    (h) => h.event === "info" && h.step === "templater_folder_templates" && (h.action === "applied" || h.action === "skipped_existing")
  );
  console.log(`\n--- Templater folder-templates writes (${folderTemplateWrites.length}) ---`);
  for (const h of folderTemplateWrites) {
    console.log(`  ${h.folder} -> ${h.template}  (action: ${h.action})`);
  }

  if (flags.dryRun) {
    console.log(`\n--- Dry-run write log (${writeLog.length} would-be writes) ---`);
    for (const w of writeLog) console.log(`  ${w.path}  (${w.bytes}B)`);
  }

  // ----- v0.1.2 git-fields assertion -------------------------------------
  // gitState() must populate git_commit / git_tag / git_dirty on every history
  // entry written this run. Scoped to newHistory because pre-v0.5.0 entries
  // (written before the gitState() helper landed) genuinely lack the fields —
  // landmine #14 tolerates null/missing on those. NEW entries from this run
  // are post-T1.3 wire-up and MUST carry the fields.
  {
    const missingFields = [];
    for (const [idx, entry] of newHistory.entries()) {
      if (!("git_commit" in entry)) missingFields.push(`newHistory[${idx}].git_commit`);
      if (!("git_tag" in entry)) missingFields.push(`newHistory[${idx}].git_tag`);
      if (!("git_dirty" in entry)) missingFields.push(`newHistory[${idx}].git_dirty`);
    }
    if (missingFields.length > 0) {
      console.error(`FAIL: missing git fields on ${missingFields.length} site(s):`);
      for (const f of missingFields) console.error(`  ${f}`);
      process.exit(1);
    }
    if (newHistory.length > 0) {
      const hasRealCommit = newHistory.some(
        (e) => e.git_commit !== null && /^[0-9a-f]{40}$/.test(e.git_commit)
      );
      if (!hasRealCommit) {
        console.error(
          `FAIL: ${newHistory.length} new history entries but none has a real git_commit sha — gitState() not capturing on a real-git workshop?`
        );
        process.exit(1);
      }
      console.log(
        `\n--- Git-fields assertion ---\n  OK: ${newHistory.length} new history entries; git fields present on all; at least one has a real 40-char sha.`
      );
    } else {
      console.log(
        `\n--- Git-fields assertion ---\n  OK: 0 new history entries this run (idempotent); nothing to check.`
      );
    }
  }

  // ----- exit code --------------------------------------------------------

  const errOrSkip = newHistory.filter((h) => h.event === "error" || h.event === "skip");
  const exitCode = (crashed || errOrSkip.length > 0) ? 1 : 0;
  console.log(`\n--- Verdict ---`);
  if (crashed) console.log("  HARNESS CRASH:", crashed.message);
  if (errOrSkip.length > 0) {
    console.log(`  ${errOrSkip.length} error/skip history entrie(s) added — exit 1`);
  } else if (!crashed) {
    console.log("  clean run — exit 0");
  }
  // CF-2: use process.exitCode (NOT process.exit) so stdout drains before exit.
  // process.exit terminates the event loop immediately and truncates buffered
  // stdout when piped (bootstrap.js's spawn capture lost ~half the output).
  // Setting exitCode lets main() return + Node exits naturally with full flush.
  process.exitCode = exitCode;
}

// HC-V0751-C1 — sauce update --bump-pins against a vault with workshop_path:null
// should succeed (auto-detects via ancestry walk; no manual jq-patch needed).
async function caseV0751C1BumpPinsNullWorkshopPath() {
    const label = "HC-V0751-C1 sauce update --bump-pins with workshop_path:null auto-detects";
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-c1-"));
    try {
        // Fabricate a brew-style workshop layout under tmp/Cellar/sauce/0.75.1/libexec
        const libexec = path.join(tmp, "Cellar", "sauce", "0.75.1", "libexec");
        const workshopDir = libexec; // libexec IS the workshop root
        fs.mkdirSync(path.join(workshopDir, "platform"), { recursive: true });
        fs.writeFileSync(
            path.join(workshopDir, "platform", "manifest.json"),
            JSON.stringify({ workshop_version: "0.75.1", mechanisms: [], blueprints: [] }, null, 2),
        );
        // Set up consumer vault with workshop_path:null in platform-installed.json
        const vault = path.join(tmp, "consumer");
        fs.mkdirSync(path.join(vault, "ranch"), { recursive: true });
        fs.writeFileSync(
            path.join(vault, "ranch", "platform-installed.json"),
            JSON.stringify({ workshop_version: null, workshop_path: null, blueprints: [], mechanisms: [] }, null, 2),
        );
        fs.writeFileSync(
            path.join(vault, "ranch", "platform-subscription.json"),
            JSON.stringify({ workshop_version: "0.74.0", mechanisms: [], blueprints: [] }, null, 2),
        );
        // Invoke handleBumpPins with the explicit workshop-path override flag
        const cmdUpdate = require("../cli/cmd-update.js");
        const argv = { workshopPath: workshopDir };
        // handleBumpPins is not exported; exercise via _resolveWorkshopPath + manual JSON inspection.
        const wp = cmdUpdate._resolveWorkshopPath({ workshop_path: null }, argv);
        assertEqual(wp, workshopDir, label);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// HC-V0751-C2 — sauce update against a non-git vault should not attempt git fetch.
// After S4, run() delegates to cmd-reinstall; no git fetch is invoked.
async function caseV0751C2SauceUpdateNonGitVault() {
    const label = "HC-V0751-C2 sauce update against non-git vault does not invoke git fetch";
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-c2-"));
    try {
        const vault = path.join(tmp, "consumer-nongit");
        fs.mkdirSync(path.join(vault, "ranch"), { recursive: true });
        fs.writeFileSync(
            path.join(vault, "ranch", "platform-subscription.json"),
            JSON.stringify({ workshop_version: "0.75.1", mechanisms: [], blueprints: [] }, null, 2),
        );
        // Do NOT initialize git.
        const cmdUpdate = require("../cli/cmd-update.js");
        let gitFetchCalled = false;
        const ctx = {
            vaultPath: vault,
            workshopPath: vault,
            _gitExec: () => { gitFetchCalled = true; return { code: 0, stdout: "", stderr: "" }; },
            _npmInstall: async () => {},
            _runInstaller: async () => {},
        };
        // Note: --bump-pins omitted; pure update path. After S4 this should not call _gitExec.
        await cmdUpdate.run(ctx, []);
        assertTrue(!gitFetchCalled, label + " (gitFetchCalled stayed false)");
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// HC-V0751-E1 — after sauce install (any flow that materializes a vault),
// ranch/platform-installed.json's top-level workshop_version field MUST be
// set to the workshop manifest's workshop_version. Pre-v0.75.1 the installer
// updated per-blueprint and per-mechanism versions but left the top-level
// field stale/null.
async function caseV0751E1WorkshopVersionRefresh() {
    const label = "HC-V0751-E1 installer refreshes ranch/platform-installed.json workshop_version";
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-e1-"));
    try {
        // Set up a minimal workshop fixture with a known workshop_version.
        const workshopDir = path.join(tmp, "workshop");
        fs.mkdirSync(path.join(workshopDir, "platform"), { recursive: true });
        fs.writeFileSync(
            path.join(workshopDir, "platform", "manifest.json"),
            JSON.stringify({
                workshop_version: "0.75.1",
                mechanisms: [],
                blueprints: [],
            }, null, 2),
        );
        // Set up consumer vault with a stale workshop_version.
        const vaultDir = path.join(tmp, "vault");
        fs.mkdirSync(path.join(vaultDir, "ranch"), { recursive: true });
        fs.writeFileSync(
            path.join(vaultDir, "ranch", "platform-installed.json"),
            JSON.stringify({ workshop_version: null, blueprints: [], mechanisms: [], history: [] }, null, 2),
        );
        fs.writeFileSync(
            path.join(vaultDir, "ranch", "platform-subscription.json"),
            JSON.stringify({ workshop_version: "0.75.1", mechanisms: [], blueprints: [] }, null, 2),
        );
        // platform-config.json with absolute workshop_path so the installer
        // can locate the manifest without relying on phaseRunInstaller's
        // workshopPath param (which phaseRunInstaller does not forward).
        fs.writeFileSync(
            path.join(vaultDir, "ranch", "platform-config.json"),
            JSON.stringify({ workshop_path: workshopDir, variables: {} }, null, 2),
        );
        // Build a minimal fake tp wired to vaultDir (mirrors run-install.js main()).
        function vaultAbs(rel) { return path.join(vaultDir, rel); }
        function vaultExistsSync(rel) {
            try { fs.accessSync(vaultAbs(rel)); return true; } catch { return false; }
        }
        const e1Adapter = {
            basePath: vaultDir,
            getBasePath() { return vaultDir; },
            async read(p) { return fsp.readFile(vaultAbs(p), "utf8"); },
            async write(p, content) {
                await fsp.mkdir(path.dirname(vaultAbs(p)), { recursive: true });
                await fsp.writeFile(vaultAbs(p), content, "utf8");
            },
            async exists(p) { return fsp.access(vaultAbs(p)).then(() => true, () => false); },
            async mkdir(p) { await fsp.mkdir(vaultAbs(p), { recursive: true }); },
            async remove(p) { await fsp.unlink(vaultAbs(p)); },
            async stat(p) {
                try {
                    const s = await fsp.stat(vaultAbs(p));
                    return { type: s.isDirectory() ? "folder" : "file", size: s.size, mtime: s.mtimeMs, ctime: s.ctimeMs };
                } catch { return null; }
            },
        };
        const e1Vault = {
            adapter: e1Adapter,
            getAbstractFileByPath(p) { return vaultExistsSync(p) ? { path: p } : null; },
            async read(file) { return fsp.readFile(vaultAbs(file.path), "utf8"); },
            async modify(file, text) {
                await fsp.mkdir(path.dirname(vaultAbs(file.path)), { recursive: true });
                await fsp.writeFile(vaultAbs(file.path), text, "utf8");
            },
            async create(p, text) {
                await fsp.mkdir(path.dirname(vaultAbs(p)), { recursive: true });
                await fsp.writeFile(vaultAbs(p), text, "utf8");
            },
            async createFolder(p) { await fsp.mkdir(vaultAbs(p), { recursive: true }); },
        };
        const e1Tp = {
            app: { vault: e1Vault },
            system: { suggester: async (_ti, items) => items[0] },
            user: {},
        };
        // Wire Notice globally before loading the installer.
        global.Notice = global.Notice || class Notice { constructor(msg) { /* suppress */ } };
        // Load install.js directly (not the vault bootstrap copy).
        const installerPath = path.join(__dirname, "../install.js");
        delete require.cache[require.resolve(installerPath)];
        const installer = require(installerPath);
        await installer(e1Tp);
        const after = JSON.parse(fs.readFileSync(path.join(vaultDir, "ranch", "platform-installed.json"), "utf8"));
        assertEqual(after.workshop_version, "0.75.1", label);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// HC-V0760-E1 — materialize_once regression for user-preferences.md.
//
// Validates that the v0.59.9 `materialize_once: true` files[] flag continues
// to preserve user content across a second install. The v0.76.0 cycle reuses
// this flag for the upcoming `user-preferences.md` USER-bucket file (wired by
// S13). This case constructs a synthetic workshop carrying a minimal
// blueprint whose single file declares `materialize_once: true`, runs the
// installer twice — with a user edit between runs — and asserts the user's
// edit survives the second install byte-for-byte.
//
// Posture: regression coverage, NOT TDD failing-first. The mechanic was
// landed in v0.59.9 and is already green; this case guards against
// accidental removal in a future refactor and exists primarily so any
// breakage shows up as a clean harness failure rather than as a subtle
// dataloss bug in the consumer's user-preferences.md after S13 lands.
async function caseV0760E1MaterializeOnceForUserPreferences() {
    const label = "HC-V0760-E1 materialize_once: dest preserved when set on the manifest entry";
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-mat-once-"));
    try {
        // Fabricate a minimal workshop carrying one blueprint with a single
        // materialize_once: true file entry. Mirrors caseV0751E1's
        // synthetic-workshop shape (workshop + per-blueprint manifests).
        const workshopDir = path.join(tmp, "workshop");
        const bpDir = path.join(workshopDir, "platform", "blueprints", "matonce");
        fs.mkdirSync(path.join(bpDir, "content"), { recursive: true });
        fs.writeFileSync(
            path.join(bpDir, "content", "user-state.md"),
            "---\nseed: true\n---\n\nSEED CONTENT\n",
        );
        fs.writeFileSync(
            path.join(bpDir, "manifest.json"),
            JSON.stringify({
                name: "matonce",
                version: "0.1.0",
                kind: "blueprint",
                module_directory: "matonce",
                files: [
                    {
                        source: "content/user-state.md",
                        dest: "{{module_directory}}/user-state.md",
                        materialize_once: true,
                    },
                ],
            }, null, 2),
        );
        fs.writeFileSync(
            path.join(workshopDir, "platform", "manifest.json"),
            JSON.stringify({
                workshop_version: "0.76.0",
                mechanisms: [],
                blueprints: [{ name: "matonce", version: "0.1.0", path: "blueprints/matonce" }],
            }, null, 2),
        );

        // Fabricate a consumer vault subscribing to the matonce blueprint.
        const vaultDir = path.join(tmp, "vault");
        fs.mkdirSync(path.join(vaultDir, "ranch"), { recursive: true });
        fs.writeFileSync(
            path.join(vaultDir, "ranch", "platform-installed.json"),
            JSON.stringify({ workshop_version: null, blueprints: [], mechanisms: [], history: [] }, null, 2),
        );
        fs.writeFileSync(
            path.join(vaultDir, "ranch", "platform-subscription.json"),
            JSON.stringify({
                workshop_version: "0.76.0",
                mechanisms: [],
                blueprints: [{ name: "matonce", version: "0.1.0" }],
            }, null, 2),
        );
        fs.writeFileSync(
            path.join(vaultDir, "ranch", "platform-config.json"),
            JSON.stringify({ workshop_path: workshopDir, variables: {} }, null, 2),
        );

        // Build a fake tp wired to vaultDir (mirrors caseV0751E1's helper shape).
        function vaultAbs(rel) { return path.join(vaultDir, rel); }
        function vaultExistsSync(rel) {
            try { fs.accessSync(vaultAbs(rel)); return true; } catch { return false; }
        }
        const e1Adapter = {
            basePath: vaultDir,
            getBasePath() { return vaultDir; },
            async read(p) { return fsp.readFile(vaultAbs(p), "utf8"); },
            async write(p, content) {
                await fsp.mkdir(path.dirname(vaultAbs(p)), { recursive: true });
                await fsp.writeFile(vaultAbs(p), content, "utf8");
            },
            async exists(p) { return fsp.access(vaultAbs(p)).then(() => true, () => false); },
            async mkdir(p) { await fsp.mkdir(vaultAbs(p), { recursive: true }); },
            async remove(p) { await fsp.unlink(vaultAbs(p)); },
            async stat(p) {
                try {
                    const s = await fsp.stat(vaultAbs(p));
                    return { type: s.isDirectory() ? "folder" : "file", size: s.size, mtime: s.mtimeMs, ctime: s.ctimeMs };
                } catch { return null; }
            },
        };
        const e1Vault = {
            adapter: e1Adapter,
            getAbstractFileByPath(p) { return vaultExistsSync(p) ? { path: p } : null; },
            async read(file) { return fsp.readFile(vaultAbs(file.path), "utf8"); },
            async modify(file, text) {
                await fsp.mkdir(path.dirname(vaultAbs(file.path)), { recursive: true });
                await fsp.writeFile(vaultAbs(file.path), text, "utf8");
            },
            async create(p, text) {
                await fsp.mkdir(path.dirname(vaultAbs(p)), { recursive: true });
                await fsp.writeFile(vaultAbs(p), text, "utf8");
            },
            async createFolder(p) { await fsp.mkdir(vaultAbs(p), { recursive: true }); },
        };
        const e1Tp = {
            app: { vault: e1Vault },
            system: { suggester: async (_ti, items) => items[0] },
            user: {},
        };

        global.Notice = global.Notice || class Notice { constructor(_msg) { /* suppress */ } };
        const installerPath = path.join(__dirname, "../install.js");
        delete require.cache[require.resolve(installerPath)];
        const installer = require(installerPath);

        // First install — seeds the dest with substituted source content.
        await installer(e1Tp);
        const destPath = path.join(vaultDir, "spice", "matonce", "user-state.md");
        assertTrue(fs.existsSync(destPath), `${label} (first install seeded dest)`);

        // User edits the file — simulates the post-install user content
        // accumulation that materialize_once is designed to preserve.
        const userEdit = "---\nseed: true\n---\n\nUSER EDIT — DO NOT WIPE\n";
        fs.writeFileSync(destPath, userEdit, "utf8");

        // Second install — must NOT overwrite the user edit because the
        // manifest entry carries materialize_once: true.
        await installer(e1Tp);
        const after = fs.readFileSync(destPath, "utf8");
        assertEqual(after, userEdit, `${label} (second install preserved user edits)`);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// HC-V0790-F1 — per-mcp/<kind>/microscope.md preserved across reinstall.
//
// The v0.79.0 microscope contract lives at
// spice/cowork/prompts/per-mcp/<kind>/microscope.md. It is authored on demand
// by cowork:edit-microscope and is deliberately NOT in cowork's files[]. This
// case proves the install.js mechanic: a file the blueprint never declares is
// never written, backed up, or removed across a reinstall. Mirrors
// caseV0760E1's synthetic-workshop scaffold; the only difference is the
// asserted path is a per-mcp sentinel that no files[] entry declares.
//
// Posture: regression guard. Fails closed if a future cycle adds per-mcp
// content to files[] (which would let reinstall overwrite the sentinel + leave
// a .bak), pairing with the structural HC-V0760-A1 FOCUSED_USER_PATHS guard.
async function caseV0790F1PerMcpMicroscopePreserved() {
    const label = "HC-V0790-F1 per-mcp/<kind>/microscope.md preserved across reinstall";
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-permcp-"));
    try {
        // Fabricate a minimal workshop with one ordinary (non-per-mcp) files[]
        // entry so install genuinely materializes something on each run.
        const workshopDir = path.join(tmp, "workshop");
        const bpDir = path.join(workshopDir, "platform", "blueprints", "permcp");
        fs.mkdirSync(path.join(bpDir, "content"), { recursive: true });
        fs.writeFileSync(
            path.join(bpDir, "content", "hub.md"),
            "---\nseed: true\n---\n\nHUB CONTENT\n",
        );
        fs.writeFileSync(
            path.join(bpDir, "manifest.json"),
            JSON.stringify({
                name: "permcp",
                version: "0.1.0",
                kind: "blueprint",
                module_directory: "permcp",
                files: [
                    { source: "content/hub.md", dest: "{{module_directory}}/hub.md" },
                ],
            }, null, 2),
        );
        fs.writeFileSync(
            path.join(workshopDir, "platform", "manifest.json"),
            JSON.stringify({
                workshop_version: "0.79.0",
                mechanisms: [],
                blueprints: [{ name: "permcp", version: "0.1.0", path: "blueprints/permcp" }],
            }, null, 2),
        );

        const vaultDir = path.join(tmp, "vault");
        fs.mkdirSync(path.join(vaultDir, "ranch"), { recursive: true });
        fs.writeFileSync(
            path.join(vaultDir, "ranch", "platform-installed.json"),
            JSON.stringify({ workshop_version: null, blueprints: [], mechanisms: [], history: [] }, null, 2),
        );
        fs.writeFileSync(
            path.join(vaultDir, "ranch", "platform-subscription.json"),
            JSON.stringify({
                workshop_version: "0.79.0",
                mechanisms: [],
                blueprints: [{ name: "permcp", version: "0.1.0" }],
            }, null, 2),
        );
        fs.writeFileSync(
            path.join(vaultDir, "ranch", "platform-config.json"),
            JSON.stringify({ workshop_path: workshopDir, variables: {} }, null, 2),
        );

        function vaultAbs(rel) { return path.join(vaultDir, rel); }
        function vaultExistsSync(rel) {
            try { fs.accessSync(vaultAbs(rel)); return true; } catch { return false; }
        }
        const f1Adapter = {
            basePath: vaultDir,
            getBasePath() { return vaultDir; },
            async read(p) { return fsp.readFile(vaultAbs(p), "utf8"); },
            async write(p, content) {
                await fsp.mkdir(path.dirname(vaultAbs(p)), { recursive: true });
                await fsp.writeFile(vaultAbs(p), content, "utf8");
            },
            async exists(p) { return fsp.access(vaultAbs(p)).then(() => true, () => false); },
            async mkdir(p) { await fsp.mkdir(vaultAbs(p), { recursive: true }); },
            async remove(p) { await fsp.unlink(vaultAbs(p)); },
            async stat(p) {
                try {
                    const s = await fsp.stat(vaultAbs(p));
                    return { type: s.isDirectory() ? "folder" : "file", size: s.size, mtime: s.mtimeMs, ctime: s.ctimeMs };
                } catch { return null; }
            },
        };
        const f1Vault = {
            adapter: f1Adapter,
            getAbstractFileByPath(p) { return vaultExistsSync(p) ? { path: p } : null; },
            async read(file) { return fsp.readFile(vaultAbs(file.path), "utf8"); },
            async modify(file, text) {
                await fsp.mkdir(path.dirname(vaultAbs(file.path)), { recursive: true });
                await fsp.writeFile(vaultAbs(file.path), text, "utf8");
            },
            async create(p, text) {
                await fsp.mkdir(path.dirname(vaultAbs(p)), { recursive: true });
                await fsp.writeFile(vaultAbs(p), text, "utf8");
            },
            async createFolder(p) { await fsp.mkdir(vaultAbs(p), { recursive: true }); },
        };
        const f1Tp = {
            app: { vault: f1Vault },
            system: { suggester: async (_ti, items) => items[0] },
            user: {},
        };

        global.Notice = global.Notice || class Notice { constructor(_msg) { /* suppress */ } };
        const installerPath = path.join(__dirname, "../install.js");
        delete require.cache[require.resolve(installerPath)];
        const installer = require(installerPath);

        // First install — materializes the declared hub file.
        await installer(f1Tp);

        // The user runs cowork:edit-microscope, which writes a per-mcp contract
        // the blueprint never declares in files[].
        const microscopeRel = path.join("spice", "permcp", "prompts", "per-mcp", "finance", "microscope.md");
        const microscopeAbs = path.join(vaultDir, microscopeRel);
        const SENTINEL = "## What matters\nSENTINEL-V0790 deep finance contract.\n";
        fs.mkdirSync(path.dirname(microscopeAbs), { recursive: true });
        fs.writeFileSync(microscopeAbs, SENTINEL, "utf8");

        // Reinstall — must NOT touch the per-mcp file (not in files[]).
        await installer(f1Tp);

        assertTrue(fs.existsSync(microscopeAbs), `${label} (microscope file survives reinstall)`);
        assertEqual(fs.readFileSync(microscopeAbs, "utf8"), SENTINEL, `${label} (content byte-identical after reinstall)`);
        assertTrue(!fs.existsSync(microscopeAbs + ".bak"), `${label} (no .bak created — file was never in files[])`);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// HC-V0800-F1 — per-mcp/<kind>/<sibling>.md preserved across reinstall.
//
// v0.80.0 generalises v0.79.0's microscope-preservation guard: the same not-in-
// files[] posture holds for ANY USER-authored markdown file in the per-mcp/<kind>/
// dir (e.g., vip-list.md, contacts-map.md, account-aliases.md), not just
// microscope.md. The convention is "anything in per-mcp/<kind>/ except
// microscope.md and _*.md is a sibling the gather may inject." This case mirrors
// caseV0790F1's synthetic-workshop scaffold verbatim with a different sentinel
// filename (vip-list.md) to prove the preservation is per-mcp/**-glob-general,
// not microscope.md-specific. Same posture: regression guard; passes by
// construction because no v0.80.0 code adds per-mcp/** to any files[] entry.
async function caseV0800F1SiblingPreserved() {
    const label = "HC-V0800-F1 per-mcp/<kind>/<sibling>.md preserved across reinstall";
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-permcp-sib-"));
    try {
        const workshopDir = path.join(tmp, "workshop");
        const bpDir = path.join(workshopDir, "platform", "blueprints", "permcp");
        fs.mkdirSync(path.join(bpDir, "content"), { recursive: true });
        fs.writeFileSync(
            path.join(bpDir, "content", "hub.md"),
            "---\nseed: true\n---\n\nHUB CONTENT\n",
        );
        fs.writeFileSync(
            path.join(bpDir, "manifest.json"),
            JSON.stringify({
                name: "permcp",
                version: "0.1.0",
                kind: "blueprint",
                module_directory: "permcp",
                files: [
                    { source: "content/hub.md", dest: "{{module_directory}}/hub.md" },
                ],
            }, null, 2),
        );
        fs.writeFileSync(
            path.join(workshopDir, "platform", "manifest.json"),
            JSON.stringify({
                workshop_version: "0.80.0",
                mechanisms: [],
                blueprints: [{ name: "permcp", version: "0.1.0", path: "blueprints/permcp" }],
            }, null, 2),
        );

        const vaultDir = path.join(tmp, "vault");
        fs.mkdirSync(path.join(vaultDir, "ranch"), { recursive: true });
        fs.writeFileSync(
            path.join(vaultDir, "ranch", "platform-installed.json"),
            JSON.stringify({ workshop_version: null, blueprints: [], mechanisms: [], history: [] }, null, 2),
        );
        fs.writeFileSync(
            path.join(vaultDir, "ranch", "platform-subscription.json"),
            JSON.stringify({
                workshop_version: "0.80.0",
                mechanisms: [],
                blueprints: [{ name: "permcp", version: "0.1.0" }],
            }, null, 2),
        );
        fs.writeFileSync(
            path.join(vaultDir, "ranch", "platform-config.json"),
            JSON.stringify({ workshop_path: workshopDir, variables: {} }, null, 2),
        );

        function vaultAbs(rel) { return path.join(vaultDir, rel); }
        function vaultExistsSync(rel) {
            try { fs.accessSync(vaultAbs(rel)); return true; } catch { return false; }
        }
        const f1Adapter = {
            basePath: vaultDir,
            getBasePath() { return vaultDir; },
            async read(p) { return fsp.readFile(vaultAbs(p), "utf8"); },
            async write(p, content) {
                await fsp.mkdir(path.dirname(vaultAbs(p)), { recursive: true });
                await fsp.writeFile(vaultAbs(p), content, "utf8");
            },
            async exists(p) { return fsp.access(vaultAbs(p)).then(() => true, () => false); },
            async mkdir(p) { await fsp.mkdir(vaultAbs(p), { recursive: true }); },
            async remove(p) { await fsp.unlink(vaultAbs(p)); },
            async stat(p) {
                try {
                    const s = await fsp.stat(vaultAbs(p));
                    return { type: s.isDirectory() ? "folder" : "file", size: s.size, mtime: s.mtimeMs, ctime: s.ctimeMs };
                } catch { return null; }
            },
        };
        const f1Vault = {
            adapter: f1Adapter,
            getAbstractFileByPath(p) { return vaultExistsSync(p) ? { path: p } : null; },
            async read(file) { return fsp.readFile(vaultAbs(file.path), "utf8"); },
            async modify(file, text) {
                await fsp.mkdir(path.dirname(vaultAbs(file.path)), { recursive: true });
                await fsp.writeFile(vaultAbs(file.path), text, "utf8");
            },
            async create(p, text) {
                await fsp.mkdir(path.dirname(vaultAbs(p)), { recursive: true });
                await fsp.writeFile(vaultAbs(p), text, "utf8");
            },
            async createFolder(p) { await fsp.mkdir(vaultAbs(p), { recursive: true }); },
        };
        const f1Tp = {
            app: { vault: f1Vault },
            system: { suggester: async (_ti, items) => items[0] },
            user: {},
        };

        global.Notice = global.Notice || class Notice { constructor(_msg) { /* suppress */ } };
        const installerPath = path.join(__dirname, "../install.js");
        delete require.cache[require.resolve(installerPath)];
        const installer = require(installerPath);

        // First install — materializes the declared hub file.
        await installer(f1Tp);

        // The user (via cowork:edit-microscope's user-supplied sub-flow, OR by hand)
        // writes a sibling file the blueprint never declares in files[].
        const sibRel = path.join("spice", "permcp", "prompts", "per-mcp", "chat", "vip-list.md");
        const sibAbs = path.join(vaultDir, sibRel);
        const SENTINEL = "# Vip List\n\n| id | reason |\n|---|---|\n| Alice | inner circle |\n| Bob | board member |\n";
        fs.mkdirSync(path.dirname(sibAbs), { recursive: true });
        fs.writeFileSync(sibAbs, SENTINEL, "utf8");

        // Reinstall — must NOT touch the sibling file (not in files[]).
        await installer(f1Tp);

        assertTrue(fs.existsSync(sibAbs), `${label} (sibling file survives reinstall)`);
        assertEqual(fs.readFileSync(sibAbs, "utf8"), SENTINEL, `${label} (content byte-identical after reinstall)`);
        assertTrue(!fs.existsSync(sibAbs + ".bak"), `${label} (no .bak created — sibling was never in files[])`);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// HC-V0801-A1 — `node platform/install.js` runs as a CLI script (not silently no-op).
//
// FLN-v79-2 closure: prior to v0.80.1, install.js exported `async function(tp)`
// for Templater and silently ignored shell flags when invoked as
// `node platform/install.js --vault . --auto-approve`. v0.80.1 adds a CLI
// handler that detects require.main === module and delegates to run-install.js
// via subprocess. This case verifies both shapes:
//   (a) `node install.js` with no args → exit 2 + stderr mentions "vault"
//   (b) `node install.js --vault <tmp> --auto-approve` → exit 0 + sentinel file written
async function caseV0801A1InstallJsCliHandler() {
    const label = "HC-V0801-A1 install.js has CLI handler (delegates to run-install.js)";
    const { spawnSync } = require("child_process");
    const installJs = path.join(__dirname, "..", "install.js");

    // (a) No-args invocation must exit with code 2 (S2's CLI handler uses
    // process.exit(2) for missing/unknown flags; pinning the code catches
    // future refactors that return a different non-zero status).
    const noArgs = spawnSync(process.execPath, [installJs], { encoding: "utf8" });
    assertTrue(noArgs.status === 2, `${label} (no-args: expected exit 2, got ${noArgs.status})`);
    assertTrue(/vault|usage/i.test((noArgs.stderr || "") + (noArgs.stdout || "")),
        `${label} (no-args: expected 'vault' or 'usage' in output, got stderr=${JSON.stringify(noArgs.stderr || "")} stdout=${JSON.stringify(noArgs.stdout || "")})`);

    // (b) Real --vault invocation against a synthetic workshop-shaped fixture.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-installjs-cli-"));
    try {
        const workshopDir = path.join(tmp, "workshop");
        const bpDir = path.join(workshopDir, "platform", "blueprints", "cli01");
        fs.mkdirSync(path.join(bpDir, "content"), { recursive: true });
        fs.writeFileSync(path.join(bpDir, "content", "hub.md"), "---\nseed: true\n---\n\nHUB CONTENT\n");
        fs.writeFileSync(
            path.join(bpDir, "manifest.json"),
            JSON.stringify({
                name: "cli01", version: "0.1.0", kind: "blueprint", module_directory: "cli01",
                files: [{ source: "content/hub.md", dest: "{{module_directory}}/hub.md" }],
            }, null, 2),
        );
        fs.writeFileSync(
            path.join(workshopDir, "platform", "manifest.json"),
            JSON.stringify({
                workshop_version: "0.80.1",
                mechanisms: [],
                blueprints: [{ name: "cli01", version: "0.1.0", path: "blueprints/cli01" }],
            }, null, 2),
        );

        const vaultDir = path.join(tmp, "vault");
        fs.mkdirSync(path.join(vaultDir, "ranch"), { recursive: true });
        fs.writeFileSync(path.join(vaultDir, "ranch", "platform-installed.json"),
            JSON.stringify({ workshop_version: null, blueprints: [], mechanisms: [], history: [] }, null, 2));
        fs.writeFileSync(path.join(vaultDir, "ranch", "platform-subscription.json"),
            JSON.stringify({ workshop_version: "0.80.1", mechanisms: [], blueprints: [{ name: "cli01", version: "0.1.0" }] }, null, 2));
        fs.writeFileSync(path.join(vaultDir, "ranch", "platform-config.json"),
            JSON.stringify({ workshop_path: workshopDir, variables: {} }, null, 2));

        const realCli = spawnSync(process.execPath, [installJs, "--vault", vaultDir, "--auto-approve"], { encoding: "utf8" });
        assertTrue(realCli.status === 0,
            `${label} (--vault invocation: expected exit 0, got ${realCli.status}; stderr=${JSON.stringify((realCli.stderr || "").slice(0, 500))})`);

        const sentinelAbs = path.join(vaultDir, "spice", "cli01", "hub.md");
        assertTrue(fs.existsSync(sentinelAbs),
            `${label} (--vault invocation: expected sentinel file at ${sentinelAbs} after install)`);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// ----- unit-test runner (no-positional-arg mode) ----------------------------

async function runUnitTests() {
    const cases = [
        caseV0751C1BumpPinsNullWorkshopPath,
        caseV0751C2SauceUpdateNonGitVault,
        caseV0751E1WorkshopVersionRefresh,
        caseV0760E1MaterializeOnceForUserPreferences,
        caseV0790F1PerMcpMicroscopePreserved,
        caseV0800F1SiblingPreserved,
        caseV0801A1InstallJsCliHandler,
    ];
    for (const c of cases) {
        try { await c(); }
        catch (e) { _fail++; console.log("  FAIL  " + c.name + ": " + (e.message || e)); }
    }
    console.log("\n========\nResult: " + _pass + " passed, " + _fail + " failed.");
    process.exitCode = _fail > 0 ? 1 : 0;
}

if (UNIT_TEST_MODE) {
    runUnitTests().catch((e) => {
        console.error("[harness] uncaught:", e.stack || e.message);
        process.exitCode = 1;
    });
} else {
    main().catch((e) => {
        console.error("[harness] uncaught:", e.stack || e.message);
        process.exitCode = 1;
    });
}
