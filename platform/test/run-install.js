#!/usr/bin/env node
// run-install.js — headless harness for platform/install.js.
//
// Replaces the manual Templater-in-Obsidian dogfood loop with a Node CLI.
// Loads <vault>/Docs/Meta/Templater/platformInstall.js (byte-identical
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
  const p = abs("Docs/Meta/platform-installed.json");
  try {
    const raw = await fsp.readFile(p, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

async function main() {
  // Sanity: verify vault layout looks like a vault.
  if (!fs.existsSync(abs("Docs/Meta/platform-config.json"))) {
    console.error(`run-install: ${VAULT}/Docs/Meta/platform-config.json not found — is this a vault?`);
    process.exit(2);
  }
  const installerPath = abs("Docs/Meta/Templater/platformInstall.js");
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

  const newHistory = (post && post.history) ? post.history.slice(preHistoryLen) : [];
  console.log(`\n--- New history entries this run (${newHistory.length}) ---`);
  for (const h of newHistory) console.log("  " + JSON.stringify(h));

  if (flags.dryRun) {
    console.log(`\n--- Dry-run write log (${writeLog.length} would-be writes) ---`);
    for (const w of writeLog) console.log(`  ${w.path}  (${w.bytes}B)`);
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
  process.exit(exitCode);
}

main().catch((e) => {
  console.error("[harness] uncaught:", e.stack || e.message);
  process.exit(1);
});
