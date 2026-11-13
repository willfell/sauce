#!/usr/bin/env node
"use strict";
// run-retired-blueprints.js — applyRetiredBlueprintsHeal (platform/install.js).
//
// The finance blueprint was removed from the workshop. Consumer vaults still
// list {"name":"finance"} in ranch/platform-subscription.json and carry its
// platform-owned plumbing (ranch/scripts/finance/, ranch/rules/finance.json)
// next to the user's spice/finance/ notes. The heal unsubscribes the retired
// blueprint and deletes the plumbing; it must never touch spice/finance/.
//
// RB-REAL-*   drive the REAL CLI entrypoint (`node platform/install.js --vault`)
//             over a vault subscribed to nothing but finance, so the heal is
//             proven to run unconditionally (landmine #32), not as a side
//             effect of some component's version-gated installItem pass.
// RB-IDEM-*   a second real install is a no-op for the heal.
// RB-SAFE-*   direct calls: a misconfigured scripts_path that would resolve
//             into spice/ is refused; a snapshot failure leaves the plumbing in
//             place and is reported loudly; a vault without finance is untouched.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const INSTALL_JS = path.join(REPO_ROOT, "platform", "install.js");
const installer = require(INSTALL_JS);

let pass = 0;
let fail = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { pass++; console.log(`  ok ${label}`); }
  else { fail++; failures.push(label); console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
}

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function filesBelow(root) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p); else out.push(p);
    }
  }
  return out.sort();
}

function treeHash(root) {
  const h = crypto.createHash("sha256");
  for (const f of filesBelow(root)) {
    h.update(path.relative(root, f));
    h.update("\0");
    h.update(fs.readFileSync(f));
    h.update("\0");
  }
  return h.digest("hex");
}

const USER_NOTES = {
  "spice/finance/Finance.md": "---\ntype: finance-hub\n---\n\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"FinanceChromeBar\" });\n```\n",
  "spice/finance/budgets/2026-05/Budget-2026-05.md": "---\ntype: budget\nmonth: \"2026-05\"\ncategories:\n  - name: Groceries\n    planned: 600\n    actual: 412\n---\n\nUser notes about May.\n",
  "spice/finance/debts/Debt-Card.md": "---\ntype: debt\nname: Card\ncurrent_balance: 1200\n---\n",
  "spice/finance/scripts/my-own.js": "// a user file that happens to live under spice/finance\n",
};
const PLUMBING = {
  "ranch/scripts/finance/finance-math.js": "class FinanceMath {}\n",
  "ranch/scripts/finance/finance-chrome-bar.js": "class FinanceChromeBar {}\n",
  "ranch/scripts/finance/sub/nested.js": "class Nested {}\n",
  "ranch/rules/finance.json": "{\"target\":\"finance\",\"contributions\":{}}\n",
};

function seedVault(vaultDir, subscriptionBlueprints) {
  fs.mkdirSync(path.join(vaultDir, ".obsidian"), { recursive: true });
  write(vaultDir, "ranch/platform-config.json", JSON.stringify({
    workshop_path: REPO_ROOT,
    workshop_relative_path: path.relative(vaultDir, REPO_ROOT),
    variables: { scripts_path: "ranch/scripts", rules_path: "ranch/rules", templates_path: "ranch/templates", views_path: "ranch/views" },
  }, null, 2));
  write(vaultDir, "ranch/platform-subscription.json", JSON.stringify({ mechanisms: [], blueprints: subscriptionBlueprints }, null, 2));
  write(vaultDir, "ranch/platform-installed.json", JSON.stringify({
    workshop_version: null,
    mechanisms: [],
    blueprints: subscriptionBlueprints.map((b) => ({ name: b.name, version: b.version, installed_at: "2026-01-01T00:00:00.000Z" })),
    history: [],
  }, null, 2));
  fs.mkdirSync(path.join(vaultDir, "ranch", "templater"), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, "platform", "installer-stub.js"), path.join(vaultDir, "ranch", "templater", "platformInstall.js"));
}

function runCli(vaultDir) {
  return spawnSync(process.execPath, [INSTALL_JS, "--vault", vaultDir, "--auto-approve"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function readJson(vaultDir, rel) {
  return JSON.parse(fs.readFileSync(path.join(vaultDir, rel), "utf8"));
}

// fs-backed tp for direct calls: the heal uses tp.app.vault.adapter, and
// writeJson goes through tp.app.vault.{getAbstractFileByPath,modify,create}.
function fsTp(root, overrides = {}) {
  const abs = (rel) => path.join(root, rel);
  const adapter = {
    basePath: root,
    async exists(rel) { return fs.existsSync(abs(rel)); },
    async stat(rel) {
      try { const s = fs.statSync(abs(rel)); return { type: s.isDirectory() ? "folder" : "file" }; } catch (_e) { return null; }
    },
    async list(rel) {
      const ents = fs.readdirSync(abs(rel), { withFileTypes: true });
      return {
        files: ents.filter((e) => e.isFile()).map((e) => `${rel}/${e.name}`),
        folders: ents.filter((e) => e.isDirectory()).map((e) => `${rel}/${e.name}`),
      };
    },
    async read(rel) { return fs.readFileSync(abs(rel), "utf8"); },
    async write(rel, content) { fs.mkdirSync(path.dirname(abs(rel)), { recursive: true }); fs.writeFileSync(abs(rel), content); },
    async mkdir(rel) { fs.mkdirSync(abs(rel), { recursive: true }); },
    async remove(rel) { fs.unlinkSync(abs(rel)); },
    async rmdir(rel) { fs.rmdirSync(abs(rel)); },
    ...overrides,
  };
  const vault = {
    adapter,
    getAbstractFileByPath: (p) => (fs.existsSync(abs(p)) ? { path: p } : null),
    read: (f) => adapter.read(f.path),
    modify: (f, text) => adapter.write(f.path, text),
    create: (p, text) => adapter.write(p, text),
  };
  return { app: { vault } };
}

const GIT = { commit: null, tag: null, dirty: null };
global.Notice = global.Notice || class Notice { constructor() {} };

async function main() {
  ok("RB-0 installer exports applyRetiredBlueprintsHeal + RETIRED_BLUEPRINTS lists finance",
    typeof installer.applyRetiredBlueprintsHeal === "function"
      && Array.isArray(installer.RETIRED_BLUEPRINTS)
      && installer.RETIRED_BLUEPRINTS.some((r) => r.name === "finance"));
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "platform", "manifest.json"), "utf8"));
  ok("RB-0b the workshop catalogue no longer ships a finance blueprint",
    !(manifest.blueprints || []).some((b) => b.name === "finance")
      && !fs.existsSync(path.join(REPO_ROOT, "platform", "blueprints", "finance")));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-retired-bp-"));
  try {
    // ---------------------------------------------------------------- real CLI
    const vault = path.join(tmp, "vault");
    seedVault(vault, [{ name: "finance", version: "0.23.2" }]);
    for (const [rel, body] of Object.entries(USER_NOTES)) write(vault, rel, body);
    for (const [rel, body] of Object.entries(PLUMBING)) write(vault, rel, body);
    const userBefore = treeHash(path.join(vault, "spice", "finance"));

    const r1 = runCli(vault);
    ok("RB-REAL-1 install exits 0 (no `workshop has no item` skip, no error)", r1.status === 0,
      `status=${r1.status} stderr=${(r1.stderr || "").slice(-400)}`);
    const sub1 = readJson(vault, "ranch/platform-subscription.json");
    ok("RB-REAL-2 finance dropped from the subscription's blueprints[]",
      Array.isArray(sub1.blueprints) && !sub1.blueprints.some((b) => b && b.name === "finance"),
      JSON.stringify(sub1.blueprints));
    ok("RB-REAL-3 ranch/scripts/finance/ deleted", !fs.existsSync(path.join(vault, "ranch", "scripts", "finance")));
    ok("RB-REAL-4 ranch/rules/finance.json deleted", !fs.existsSync(path.join(vault, "ranch", "rules", "finance.json")));
    ok("RB-REAL-5 spice/finance/ survives byte-identical (every user note, including user .js)",
      treeHash(path.join(vault, "spice", "finance")) === userBefore
        && Object.keys(USER_NOTES).every((rel) => fs.readFileSync(path.join(vault, rel), "utf8") === USER_NOTES[rel]));

    const backupRoot = path.join(vault, ".sauce-backup");
    const backups = filesBelow(backupRoot).map((f) => path.relative(backupRoot, f).split(path.sep).slice(1).join("/"));
    ok("RB-REAL-6 every deleted plumbing file was snapshotted under .sauce-backup/",
      Object.keys(PLUMBING).every((rel) => backups.includes(rel)), JSON.stringify(backups));
    const subSnap = filesBelow(backupRoot).find((f) => f.endsWith(path.join("ranch", "platform-subscription.json")));
    ok("RB-REAL-7 the pre-heal subscription (still listing finance) was snapshotted",
      !!subSnap && JSON.parse(fs.readFileSync(subSnap, "utf8")).blueprints.some((b) => b.name === "finance"));

    const inst1 = readJson(vault, "ranch/platform-installed.json");
    const heals = (inst1.history || []).filter((h) => h.step === "retired_blueprint" && h.event === "heal");
    ok("RB-REAL-8 history records the unsubscribe + both plumbing removals",
      heals.some((h) => h.action === "unsubscribed" && h.name === "finance")
        && heals.filter((h) => h.action === "removed_plumbing").map((h) => h.path).sort().join(",") === "ranch/rules/finance.json,ranch/scripts/finance",
      JSON.stringify(heals.map((h) => [h.action, h.path])));
    ok("RB-REAL-9 no skip/warning/error mentions finance",
      !(inst1.history || []).some((h) => ["skip", "warning", "error"].includes(h.event) && JSON.stringify(h).includes("finance")));
    ok("RB-REAL-10 the installed ledger no longer lists finance (subscription-aware prune saw the healed subscription)",
      !(inst1.blueprints || []).some((b) => b && b.name === "finance"));
    ok("RB-REAL-11 the heal never re-creates a finance blueprint surface",
      !fs.existsSync(path.join(vault, "ranch", "scripts", "finance")) && !fs.existsSync(path.join(vault, "spice", "finance", "Finance Plan.md")));

    // ------------------------------------------------------------ idempotency
    const backupsBefore = filesBelow(backupRoot).length;
    const subBefore = fs.readFileSync(path.join(vault, "ranch", "platform-subscription.json"), "utf8");
    const r2 = runCli(vault);
    ok("RB-IDEM-1 second install exits 0", r2.status === 0, `status=${r2.status}`);
    const inst2 = readJson(vault, "ranch/platform-installed.json");
    const heals2 = (inst2.history || []).filter((h) => h.step === "retired_blueprint" && h.event === "heal");
    ok("RB-IDEM-2 second install records no further heal events", heals2.length === heals.length);
    ok("RB-IDEM-3 second install still logs that the heal ran (summary info event)",
      (inst2.history || []).filter((h) => h.step === "retired_blueprint" && h.event === "info").length
        > (inst1.history || []).filter((h) => h.step === "retired_blueprint" && h.event === "info").length);
    ok("RB-IDEM-4 second install takes no new retire snapshots and leaves the subscription bytes alone",
      filesBelow(backupRoot).length === backupsBefore
        && fs.readFileSync(path.join(vault, "ranch", "platform-subscription.json"), "utf8") === subBefore);
    ok("RB-IDEM-5 spice/finance/ still byte-identical after the second install",
      treeHash(path.join(vault, "spice", "finance")) === userBefore);

    // ------------------------------------------------------- direct: safety
    {
      const v = path.join(tmp, "unsafe");
      for (const [rel, body] of Object.entries(USER_NOTES)) write(v, rel, body);
      write(v, "ranch/platform-subscription.json", JSON.stringify({ mechanisms: [], blueprints: [] }, null, 2));
      const before = treeHash(path.join(v, "spice"));
      const history = [];
      await installer.applyRetiredBlueprintsHeal(fsTp(v), { mechanisms: [], blueprints: [] }, { scripts_path: "spice", rules_path: "spice" }, history, GIT);
      ok("RB-SAFE-1 a scripts_path/rules_path resolving into spice/ is refused; spice/ untouched",
        treeHash(path.join(v, "spice")) === before && fs.existsSync(path.join(v, "spice", "finance")));
      ok("RB-SAFE-2 the refusal is recorded loudly (warning per refused path)",
        history.filter((h) => h.event === "warning" && h.step === "retired_blueprint" && /unsafe plumbing path/.test(h.message)).length === 2);
    }
    {
      const v = path.join(tmp, "snapfail");
      for (const [rel, body] of Object.entries(PLUMBING)) write(v, rel, body);
      const realWrite = async (rel, content) => { fs.mkdirSync(path.dirname(path.join(v, rel)), { recursive: true }); fs.writeFileSync(path.join(v, rel), content); };
      const tp = fsTp(v, {
        async write(rel, content) {
          if (rel.startsWith(".sauce-backup/")) throw new Error("disk full");
          return realWrite(rel, content);
        },
      });
      const history = [];
      await installer.applyRetiredBlueprintsHeal(tp, { mechanisms: [], blueprints: [] }, {}, history, GIT);
      ok("RB-SAFE-3 a failed snapshot leaves the plumbing in place (never delete without a backup)",
        Object.keys(PLUMBING).every((rel) => fs.existsSync(path.join(v, rel))));
      ok("RB-SAFE-4 the snapshot failure is recorded as a warning",
        history.some((h) => h.event === "warning" && h.step === "retired_blueprint" && /could not snapshot/.test(h.message)));
    }
    {
      const v = path.join(tmp, "clean");
      const subBody = JSON.stringify({ mechanisms: [], blueprints: [{ name: "daily", version: "1.0.0" }] }, null, 2);
      write(v, "ranch/platform-subscription.json", subBody);
      const sub = JSON.parse(subBody);
      const history = [];
      const out = await installer.applyRetiredBlueprintsHeal(fsTp(v), sub, {}, history, GIT);
      ok("RB-SAFE-5 a vault that never had finance is a no-op (subscription untouched, no snapshot dir)",
        Array.isArray(out) && out.length === 0
          && fs.readFileSync(path.join(v, "ranch", "platform-subscription.json"), "utf8") === subBody
          && sub.blueprints.length === 1 && !fs.existsSync(path.join(v, ".sauce-backup")));
      ok("RB-SAFE-6 the no-op run records only the summary info event",
        history.length === 1 && history[0].event === "info" && history[0].step === "retired_blueprint");
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\nrun-retired-blueprints: ${pass} passed, ${fail} failed`);
  if (fail) {
    for (const f of failures) console.log(`  FAIL ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
