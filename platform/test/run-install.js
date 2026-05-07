#!/usr/bin/env node
// run-install.js — headless harness for platform/install.js.
//
// Replaces the manual Templater-in-Obsidian dogfood loop with a Node CLI.
// Loads <vault>/ranch/Templater/platformInstall.js (byte-identical
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
if (positional.length !== 1) {
  console.error("run-install: expected exactly one positional arg (vault path)");
  console.error("usage: node platform/test/run-install.js <vault-path> [--auto-approve|--decline-all] [--dry-run] [--verbose]");
  process.exit(2);
}

const VAULT = path.resolve(positional[0]);

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
  const installerPath = abs("ranch/Templater/platformInstall.js");
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

main().catch((e) => {
  console.error("[harness] uncaught:", e.stack || e.message);
  process.exitCode = 1;
});
