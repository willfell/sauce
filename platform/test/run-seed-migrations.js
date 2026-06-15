#!/usr/bin/env node
// platform/test/run-seed-migrations.js — migration regression harness.
//
// Copies platform/test/seed-vault/ to a tmp dir, runs the headless installer,
// and asserts on resulting state. Each cycle adds HC-V0XYZ-SEED-* assert
// families covering its migrations.
//
// Run: node platform/test/run-seed-migrations.js
//
// House rules: zero-dep, headless, failure-loud.

const fs = require("fs");
const os = require("os");
const path = require("path");
const helpers = require("./helpers/seed-vault-helpers.js");

const REPO_ROOT = path.resolve(__dirname, "../..");
const SEED_DIR = path.join(REPO_ROOT, "platform/test/seed-vault");
const KEEP = process.env.KEEP_SEED_VAULT === "1";

let pass = 0;
let fail = 0;
const failures = [];

function ok(label, cond, detail) {
    if (cond) {
        console.log(`  ok ${label}`);
        pass++;
    } else {
        console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`);
        fail++;
        failures.push(label);
    }
}

function withTempVault(fn) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-seed-mig-"));
    try {
        return fn(tmp);
    } finally {
        if (KEEP) {
            console.log(`  KEEP_SEED_VAULT=1: ${tmp}`);
        } else {
            try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
        }
    }
}

// ----- main ------------------------------------------------------------------

if (!fs.existsSync(SEED_DIR)) {
    console.error(`seed-vault missing: ${SEED_DIR}`);
    process.exit(1);
}

console.log("run-seed-migrations: copying seed -> tmp, running install, asserting...");
console.log("");

withTempVault((vault) => {
    helpers.copyDir(SEED_DIR, vault);
    const result = helpers.runInstall(vault, REPO_ROOT);

    // ===== HC-V01100-SEED-INSTALL-* — install ran =====
    ok(
        "HC-V01100-SEED-INSTALL-1 install exit code 0",
        result.code === 0,
        `code=${result.code} stderr=${result.stderr.slice(-200)}`
    );
    ok(
        "HC-V01100-SEED-INSTALL-2 platform-installed.json exists",
        helpers.fileExists(vault, "ranch/platform-installed.json")
    );
    let installedJson = null;
    try { installedJson = helpers.readJson(vault, "ranch/platform-installed.json"); } catch (e) {}
    ok(
        "HC-V01100-SEED-INSTALL-3 platform-installed.json parses as JSON",
        installedJson !== null
    );
    ok(
        "HC-V01100-SEED-INSTALL-4 platform-installed.json has history[] array",
        installedJson && Array.isArray(installedJson.history)
    );
    ok(
        "HC-V01100-SEED-INSTALL-5 install added history entries (> 50)",
        installedJson && Array.isArray(installedJson.history) && installedJson.history.length > 50,
        `history=${installedJson && installedJson.history && installedJson.history.length}`
    );
    ok(
        "HC-V01100-SEED-INSTALL-6 workshop_version recorded",
        installedJson && typeof installedJson.workshop_version === "string" && installedJson.workshop_version.length > 0,
        `workshop_version=${installedJson && installedJson.workshop_version}`
    );

    // ===== HC-V01100-SEED-SHAPE-* — expected dirs present =====
    ok("HC-V01100-SEED-SHAPE-1 spice/ exists", helpers.dirExists(vault, "spice"));
    ok("HC-V01100-SEED-SHAPE-2 ranch/ exists", helpers.dirExists(vault, "ranch"));
    ok("HC-V01100-SEED-SHAPE-3 .claude/ exists", helpers.dirExists(vault, ".claude"));
    ok("HC-V01100-SEED-SHAPE-4 .obsidian/ exists", helpers.dirExists(vault, ".obsidian"));
    ok("HC-V01100-SEED-SHAPE-5 spice/cowork/ exists", helpers.dirExists(vault, "spice/cowork"));
    ok("HC-V01100-SEED-SHAPE-6 spice/finance/ exists", helpers.dirExists(vault, "spice/finance"));
    ok("HC-V01100-SEED-SHAPE-7 spice/projects/ exists", helpers.dirExists(vault, "spice/projects"));
    ok("HC-V01100-SEED-SHAPE-8 spice/finance/debts/ exists", helpers.dirExists(vault, "spice/finance/debts"));
    ok("HC-V01100-SEED-SHAPE-9 ranch/scripts/ exists", helpers.dirExists(vault, "ranch/scripts"));
    ok("HC-V01100-SEED-SHAPE-10 ranch/templates/ exists", helpers.dirExists(vault, "ranch/templates"));
    ok("HC-V01100-SEED-SHAPE-11 .claude/commands/ exists", helpers.dirExists(vault, ".claude/commands"));
    ok("HC-V01100-SEED-SHAPE-12 .claude/skills/ exists", helpers.dirExists(vault, ".claude/skills"));

    // ===== HC-V01100-SEED-REGISTRIES-* — registry files valid JSON =====
    const registries = [
        ["claude-surface-registry.json", "REGISTRIES-1"],
        ["nav-buttons-registry.json", "REGISTRIES-2"],
        ["entity-create-registry.json", "REGISTRIES-3"],
    ];
    for (const [filename, tag] of registries) {
        const rel = `ranch/${filename}`;
        const exists = helpers.fileExists(vault, rel);
        let parsed = null;
        if (exists) {
            try { parsed = helpers.readJson(vault, rel); } catch (e) {}
        }
        ok(`HC-V01100-SEED-${tag} ${filename} exists + valid JSON`, exists && parsed !== null);
    }

    // ===== HC-V01100-SEED-FM-* — hub note frontmatter types =====
    const hubChecks = [
        ["spice/cowork/Cowork.md", "cowork-hub", "FM-1"],
        ["spice/cowork/Daily Hub.md", "cowork-daily-hub", "FM-2"],
        ["spice/finance/Finance.md", "finance-hub", "FM-3"],
        ["spice/finance/debts/Debts.md", "debts-hub", "FM-4"],
        ["spice/finance/Budget Defaults.md", "budget-defaults", "FM-5"],
        ["spice/projects/Projects.md", "projects-hub", "FM-6"],
        ["spice/scratch/Scratch.md", "scratch-hub", "FM-7"],
        ["spice/to-do/All-ToDos.md", "to-do-hub", "FM-8"],
        ["spice/people/People.md", "people-hub", "FM-9"],
        ["spice/products/Products.md", "products-hub", "FM-10"],
    ];
    for (const [relPath, expectedType, tag] of hubChecks) {
        let actualType = null;
        if (helpers.fileExists(vault, relPath)) {
            try {
                const { frontmatter } = helpers.parseFrontmatter(helpers.readNote(vault, relPath));
                actualType = frontmatter.type;
            } catch (e) {}
        }
        ok(
            `HC-V01100-SEED-${tag} ${relPath} type=${expectedType}`,
            actualType === expectedType,
            `actual=${actualType}`
        );
    }

    // ===== HC-V01100-SEED-PRESERVE-* — hand-authored notes preserved =====
    const preserved = [
        ["spice/daily/2026-06-14.md", "PRESERVE-1"],
        ["spice/scratch/2026-06-14-test-scratch.md", "PRESERVE-2"],
        ["spice/meetings/2026-06-14 Test Meeting.md", "PRESERVE-3"],
    ];
    for (const [relPath, tag] of preserved) {
        const seedContent = helpers.fileExists(SEED_DIR, relPath)
            ? fs.readFileSync(path.join(SEED_DIR, relPath))
            : null;
        const vaultContent = helpers.fileExists(vault, relPath)
            ? fs.readFileSync(path.join(vault, relPath))
            : null;
        ok(
            `HC-V01100-SEED-${tag} ${relPath} preserved bit-for-bit`,
            seedContent !== null && vaultContent !== null && seedContent.equals(vaultContent),
            `seed=${seedContent && seedContent.length} vault=${vaultContent && vaultContent.length}`
        );
    }

    // ===== HC-V01100-SEED-CLAUDE-* — CLAUDE.md markers rewritten, outside-marker prose preserved =====
    const claudeMdExists = helpers.fileExists(vault, "CLAUDE.md");
    ok("HC-V01100-SEED-CLAUDE-1 CLAUDE.md exists", claudeMdExists);
    if (claudeMdExists) {
        const cm = helpers.readNote(vault, "CLAUDE.md");
        ok(
            "HC-V01100-SEED-CLAUDE-2 resolvers markers present",
            cm.includes("<!-- @claude-surface:resolvers BEGIN -->") &&
                cm.includes("<!-- @claude-surface:resolvers END -->")
        );
        ok(
            "HC-V01100-SEED-CLAUDE-3 directory-map markers present",
            cm.includes("<!-- @claude-surface:directory-map BEGIN -->") &&
                cm.includes("<!-- @claude-surface:directory-map END -->")
        );
        ok(
            "HC-V01100-SEED-CLAUDE-4 skills-index markers present",
            cm.includes("<!-- @claude-surface:skills-index BEGIN -->") &&
                cm.includes("<!-- @claude-surface:skills-index END -->")
        );
        ok(
            "HC-V01100-SEED-CLAUDE-5 resolvers block populated by install",
            cm.includes("/audit") || cm.includes("/cowork")
        );
        ok(
            "HC-V01100-SEED-CLAUDE-6 outside-marker prose preserved",
            cm.includes("Test consumer vault") && cm.includes("This vault has no real personal content")
        );
    }

    // ===== Idempotency phase: snapshot, second install, compare =====
    const firstSnapshot = helpers.snapshotTree(vault);
    const result2 = helpers.runInstall(vault, REPO_ROOT);
    ok(
        "HC-V01100-SEED-IDEMP-1 second install exit code 0",
        result2.code === 0,
        `code=${result2.code} stderr=${result2.stderr.slice(-200)}`
    );

    const secondSnapshot = helpers.snapshotTree(vault);
    const diff = helpers.diffSnapshots(firstSnapshot, secondSnapshot);

    // Known-mutable files (timestamps, history entries, git_commit). The install
    // path legitimately rewrites these every run; byte-equality is NOT expected.
    const KNOWN_MUTABLE = new Set([
        "ranch/platform-installed.json",
        "ranch/claude-surface-registry.json",
        "ranch/nav-buttons-registry.json",
        "ranch/entity-create-registry.json",
        ".obsidian/app.json.sauce-backup",
        ".obsidian/appearance.json.sauce-backup",
        ".obsidian/hotkeys.json.sauce-backup",
    ]);
    function isMutable(p) {
        if (KNOWN_MUTABLE.has(p)) return true;
        // .sauce-backup files are install-time transient
        if (p.endsWith(".sauce-backup")) return true;
        return false;
    }
    const unexpectedAdded = diff.added.filter((f) => !isMutable(f));
    const unexpectedChanged = diff.changed.filter((f) => !isMutable(f));

    ok(
        "HC-V01100-SEED-IDEMP-2 no unexpected files added on second install",
        unexpectedAdded.length === 0,
        `added=${unexpectedAdded.slice(0, 5).join(",")}`
    );
    ok(
        "HC-V01100-SEED-IDEMP-3 no unexpected files changed on second install",
        unexpectedChanged.length === 0,
        `changed=${unexpectedChanged.slice(0, 5).join(",")}`
    );
    ok(
        "HC-V01100-SEED-IDEMP-4 no files removed on second install",
        diff.removed.length === 0,
        `removed=${diff.removed.slice(0, 5).join(",")}`
    );
    let installedJson2 = null;
    try { installedJson2 = helpers.readJson(vault, "ranch/platform-installed.json"); } catch (e) {}
    ok(
        "HC-V01100-SEED-IDEMP-5 platform-installed.json grew (history entries appended)",
        installedJson2 && installedJson && installedJson2.history.length > installedJson.history.length,
        `before=${installedJson && installedJson.history.length} after=${installedJson2 && installedJson2.history.length}`
    );

    // User-authored notes still preserved after second install too.
    for (const [relPath, tag] of preserved) {
        const seedContent = fs.readFileSync(path.join(SEED_DIR, relPath));
        const vaultContent = fs.readFileSync(path.join(vault, relPath));
        ok(
            `HC-V01100-SEED-IDEMP-${tag}-2 ${relPath} preserved after second install`,
            seedContent.equals(vaultContent)
        );
    }
});

console.log("");
console.log(`Tests: ${pass}/${pass + fail}`);
if (fail > 0) {
    console.log(`Failures:`);
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
}
process.exit(0);
