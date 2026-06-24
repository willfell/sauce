#!/usr/bin/env node
// scripts/rebaseline-seed.js — rebaseline the migration-regression seed vault.
//
// Copies platform/test/seed-vault/ to a tmp dir, runs the canonical install
// against it, then writes the result back to platform/test/seed-vault/. After
// a cycle close, this ratchets the seed forward to represent the just-released
// workshop version. The next cycle's migrations then have an up-to-date starting
// point.
//
// Usage:
//   node scripts/rebaseline-seed.js              (apply: replace seed-vault)
//   node scripts/rebaseline-seed.js --dry-run    (print diff summary only)
//
// House rules:
// - Zero-dep. Node built-ins only.
// - Failure-loud. Exits non-zero on any error.
// - Cleans up its tmp dir on success AND failure.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const SEED_DIR = path.join(REPO_ROOT, "platform/test/seed-vault");
const INSTALL_JS = path.join(REPO_ROOT, "platform/install.js");

const DRY_RUN = process.argv.includes("--dry-run");

function copyDir(src, dst) {
    // Recursive copy, preserving directory structure + symlinks-as-files.
    // Native fs.cpSync is available on Node 16.7+.
    fs.cpSync(src, dst, { recursive: true, force: true });
}

function listFiles(root) {
    const out = [];
    function walk(dir, rel) {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const abs = path.join(dir, ent.name);
            const rl = rel ? path.join(rel, ent.name) : ent.name;
            if (ent.isDirectory()) walk(abs, rl);
            else out.push(rl);
        }
    }
    walk(root, "");
    return out.sort();
}

function diffTree(a, b) {
    const aFiles = new Set(listFiles(a));
    const bFiles = new Set(listFiles(b));
    const added = [];
    const removed = [];
    const changed = [];
    for (const f of bFiles) {
        if (!aFiles.has(f)) added.push(f);
        else {
            const aBuf = fs.readFileSync(path.join(a, f));
            const bBuf = fs.readFileSync(path.join(b, f));
            if (!aBuf.equals(bBuf)) changed.push(f);
        }
    }
    for (const f of aFiles) if (!bFiles.has(f)) removed.push(f);
    return { added, removed, changed };
}

function main() {
    // Seed rebaseline is a MANUAL, reviewed action only. Auto-running it in CI
    // (the release.yml rebaseline-seed job) over-heals the pre-heal migration
    // fixtures and wedges run-seed-migrations on main (incident: v0.132.0,
    // commit 68b75aa9). Skip in CI; run locally to ratchet the seed deliberately.
    // See build-test-verify.md § Seed-vault rebaseline.
    if (process.env.GITHUB_ACTIONS) {
        console.log("rebaseline-seed: skipping in CI — manual-only (auto-rebaseline over-heals fixtures).");
        return;
    }
    if (!fs.existsSync(SEED_DIR)) {
        console.error(`seed dir missing: ${SEED_DIR}`);
        process.exit(1);
    }
    if (!fs.existsSync(INSTALL_JS)) {
        console.error(`installer missing: ${INSTALL_JS}`);
        process.exit(1);
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-rebaseline-"));
    try {
        console.log(`rebaseline-seed: copying seed -> ${tmp}`);
        copyDir(SEED_DIR, tmp);

        // Patch sentinel workshop_relative_path -> current REPO_ROOT so
        // install can find the workshop. The sentinel is restored before
        // writing the result back to the seed (see step at bottom).
        const cfgPath = path.join(tmp, "ranch/platform-config.json");
        const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        cfg.workshop_relative_path = REPO_ROOT;
        fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");

        console.log(`rebaseline-seed: running install...`);
        execFileSync("node", [INSTALL_JS, "--vault", tmp, "--auto-approve"], {
            cwd: REPO_ROOT,
            stdio: "inherit",
        });

        // Restore sentinel before writing back to seed (portability).
        const cfgAfter = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        cfgAfter.workshop_relative_path = "__SEED_REPO_ROOT__";
        fs.writeFileSync(cfgPath, JSON.stringify(cfgAfter, null, 2) + "\n");

        const diff = diffTree(SEED_DIR, tmp);
        console.log(`rebaseline-seed: diff vs current seed:`);
        console.log(`  added:   ${diff.added.length}`);
        console.log(`  removed: ${diff.removed.length}`);
        console.log(`  changed: ${diff.changed.length}`);
        if (diff.added.length) console.log(`  added files:\n    ${diff.added.slice(0, 20).join("\n    ")}${diff.added.length > 20 ? `\n    ... (+${diff.added.length - 20} more)` : ""}`);
        if (diff.removed.length) console.log(`  removed files:\n    ${diff.removed.slice(0, 20).join("\n    ")}${diff.removed.length > 20 ? `\n    ... (+${diff.removed.length - 20} more)` : ""}`);
        if (diff.changed.length) console.log(`  changed files:\n    ${diff.changed.slice(0, 20).join("\n    ")}${diff.changed.length > 20 ? `\n    ... (+${diff.changed.length - 20} more)` : ""}`);

        if (DRY_RUN) {
            console.log(`rebaseline-seed: --dry-run, not writing back.`);
            return;
        }

        console.log(`rebaseline-seed: replacing seed-vault with new state...`);
        fs.rmSync(SEED_DIR, { recursive: true, force: true });
        copyDir(tmp, SEED_DIR);
        console.log(`rebaseline-seed: done.`);
    } finally {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    }
}

main();
