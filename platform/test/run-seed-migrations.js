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
    // Patch platform-config.json's sentinel workshop_relative_path -> current
    // REPO_ROOT. The seed holds a sentinel ("__SEED_REPO_ROOT__") so the
    // committed seed is portable across developer machines + CI. Tests +
    // rebaseline patch in the real path before install; rebaseline restores
    // the sentinel before writing the result back to the seed.
    const cfgPath = path.join(vault, "ranch/platform-config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    cfg.workshop_relative_path = REPO_ROOT;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");

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

        // Row-content checks on the populated markered surfaces. Each ok()
        // call asserts that a specific row substring survives the install-time
        // claude-surface regen. Catches the silent failure where a registry
        // change drops a slash command or directory-map row without any
        // visible error — only an AI session would notice.
        ok("HC-V01100-SEED-CLAUDE-7 resolvers row /install present", cm.includes("/install"));
        ok("HC-V01100-SEED-CLAUDE-8 resolvers row /cowork about present", cm.includes("/cowork about"));
        ok("HC-V01100-SEED-CLAUDE-9 resolvers row /cowork discover-people present", cm.includes("/cowork discover-people"));
        ok("HC-V01100-SEED-CLAUDE-10 resolvers row /daily present", cm.includes("/daily"));
        ok("HC-V01100-SEED-CLAUDE-11 resolvers row /project present", cm.includes("/project"));
        ok("HC-V01100-SEED-CLAUDE-12 resolvers row /upgrade present", cm.includes("/upgrade"));
        ok("HC-V01100-SEED-CLAUDE-13 directory-map row spice/resources/ present", cm.includes("spice/resources/"));
        ok("HC-V01100-SEED-CLAUDE-14 directory-map row ranch Runtime plumbing present", cm.includes("Runtime plumbing"));
        ok("HC-V01100-SEED-CLAUDE-15 directory-map row .claude/commands/ present", cm.includes(".claude/commands/"));
        ok("HC-V01100-SEED-CLAUDE-16 directory-map row .claude/skills/ present", cm.includes(".claude/skills/"));
    }

    // ===== HC-V01100-SEED-BODY-* — hub bodies reference canonical primary widget class =====
    //
    // One assert per hub note: the unique class-name substring of its primary
    // widget appears in the body. Plain String.includes — robust to both the
    // customjs-guard shim form (`class: "X"`) and the direct-call form
    // (`customJS.X.render(...)`). Catches silent-fail class: a widget renamed
    // on the workshop side renders an empty hub on consumer vaults.
    //
    // When the seed is rebaselined and a class name changes (legitimately —
    // a real workshop rename), update the table here in lockstep with the
    // rebaseline commit so the harness fails-fast on a stale assertion target.
    const bodyChecks = [
        ["spice/finance/Finance.md", "FinanceHubSummary", "BODY-1"],
        ["spice/finance/Budget Defaults.md", "BudgetDefaultsEditor", "BODY-2"],
        ["spice/finance/Debt Defaults.md", "DebtDefaultsEditor", "BODY-3"],
        ["spice/finance/Paycheck Defaults.md", "PaycheckDefaultsEditor", "BODY-4"],
        ["spice/finance/budgets/Budgets.md", "BudgetsCards", "BODY-5"],
        ["spice/finance/debts/Debts.md", "DebtsHubSummary", "BODY-6"],
        ["spice/finance/paychecks/Paychecks.md", "PaychecksCards", "BODY-7"],
        ["spice/finance/invoices/Invoices.md", "InvoicesCards", "BODY-8"],
        ["spice/cowork/Cowork.md", "CoworkHubNav", "BODY-9"],
        ["spice/cowork/Daily Hub.md", "CoworkDailyHubCards", "BODY-10"],
        ["spice/cowork/Weekly Hub.md", "CoworkWeeklyHubCards", "BODY-11"],
        ["spice/cowork/Monthly Hub.md", "CoworkMonthlyHubCards", "BODY-12"],
        ["spice/projects/Projects.md", "ProjectsHubCards", "BODY-13"],
        ["spice/people/People.md", "PeopleHubCards", "BODY-14"],
        ["spice/products/Products.md", "ProductsHubCards", "BODY-15"],
        ["spice/scratch/Scratch.md", "ScratchHubCards", "BODY-16"],
        ["spice/to-do/All-ToDos.md", "ToDoAllList", "BODY-17"],
    ];
    for (const [relPath, classSubstr, tag] of bodyChecks) {
        let body = "";
        let exists = false;
        if (helpers.fileExists(vault, relPath)) {
            exists = true;
            try { body = helpers.readNote(vault, relPath); } catch (e) {}
        }
        ok(
            `HC-V01100-SEED-${tag} ${relPath} body refs ${classSubstr}`,
            exists && body.includes(classSubstr),
            exists ? "class missing" : "note missing"
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

// =============================================================================
// HC-V01174-MIGRATE-* — direct applyToDoBlueprintMigration coverage.
//
// Self-contained, independent of the seed-based families above. The seed
// install short-circuits on version match, so seed anchors are NOT migrated
// this cycle — instead we DIRECTLY INVOKE the exported migration against a
// throwaway tmp vault and assert the real end-state. This makes the coverage
// permanent regardless of the seed's installed-version state.
//
// The function reshapes consumer to-do notes across the v0.116.0 -> v0.117.3
// arc: v0.3.3-shape daily -> 5-block v0.5.0 body; v0.4.0-shape daily ->
// SectionLabel "Today" injected; misplaced frontmatter sentinels healed;
// orphan `## Today` H2 stripped; project-todo `## Owned Tasks` H2 -> SectionLabel.
// =============================================================================
async function runMigrateFamily() {
    const { applyToDoBlueprintMigration } = require("../install.js");

    // Thin fs-backed adapter over a tmp vault root. Every relPath (vault-relative)
    // maps to path.join(root, relPath). list() returns entries as `dir + "/" + name`.
    function makeAdapter(root) {
        const abs = (rel) => path.join(root, rel);
        return {
            async exists(rel) { return fs.existsSync(abs(rel)); },
            async list(rel) {
                const dir = abs(rel);
                if (!fs.existsSync(dir)) return { files: [], folders: [] };
                const ents = fs.readdirSync(dir, { withFileTypes: true });
                const files = [], folders = [];
                for (const e of ents) {
                    const child = rel + "/" + e.name;
                    if (e.isDirectory()) folders.push(child);
                    else files.push(child);
                }
                return { files, folders };
            },
            async read(rel) { return fs.readFileSync(abs(rel), "utf8"); },
            async write(rel, content) {
                const f = abs(rel);
                fs.mkdirSync(path.dirname(f), { recursive: true });
                fs.writeFileSync(f, content);
            },
            async mkdir(rel) { fs.mkdirSync(abs(rel), { recursive: true }); },
        };
    }

    // dataviewjs block matching the real to-do templates' customjs-guard form.
    const dv = (cls, args) =>
        '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "' + cls + '"' +
        (args ? ', args: ' + args : '') + ' });\n```';

    const migRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-todo-mig-"));
    const writeFixture = (rel, content) => {
        const f = path.join(migRoot, rel);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, content);
    };

    // Daily fixtures live under a YYYY/MM-Month subtree so _walkToDos recurses.
    const DAY_DIR = "spice/to-do/2026/06-June";
    const F_V033 = `${DAY_DIR}/ToDo-2026-06-01.md`;
    const F_V040 = `${DAY_DIR}/ToDo-2026-06-02.md`;
    const F_SENTINEL = `${DAY_DIR}/ToDo-2026-06-03.md`;
    const F_ORPHAN = `${DAY_DIR}/ToDo-2026-06-04.md`;
    const F_PROJ = "spice/projects/seed-project/Seed Project To-Do.md";

    try {
        // 1. v0.3.3 shape: SpaceNavButtons + ToDoLeafActions, NO ToDoDailyCarryover.
        writeFixture(F_V033, [
            "---", "type: to-do", "---", "",
            dv("SpaceNavButtons"), "",
            dv("ToDoLeafActions"), "",
            "- [ ] anchor v033 task", "",
            "## Notes",
            "<!-- some-note-sentinel keep me -->", "",
        ].join("\n"));

        // 2. v0.4.0 shape: has ToDoDailyCarryover but NO SectionLabel "Today".
        writeFixture(F_V040, [
            "---", "type: to-do", "---", "",
            dv("SpaceNavButtons"), "",
            dv("ToDoLeafActions"), "",
            dv("ToDoDailyCarryover"), "",
            dv("ToDoDailyRecurring"), "",
            "- [ ] anchor v040 task", "",
        ].join("\n"));

        // 3. Misplaced sentinel INSIDE frontmatter (between the two `---`).
        writeFixture(F_SENTINEL, [
            "---", "type: to-do",
            "<!-- recurring-materialized-2026-06-03 -->",
            "---", "",
            dv("ToDoLeafActions"), "",
            dv("SectionLabel", '[{ text: "Today", top: true }]'), "",
            dv("ToDoDailyCarryover"), "",
        ].join("\n"));

        // 4. v0.4.0-ish body with an orphan `## Today` H2 near EOF.
        writeFixture(F_ORPHAN, [
            "---", "type: to-do", "---", "",
            dv("ToDoLeafActions"), "",
            dv("SectionLabel", '[{ text: "Today", top: true }]'), "",
            dv("ToDoDailyCarryover"), "",
            "- [ ] keep task", "",
            "## Today", "",
        ].join("\n"));

        // 5. project-todo with `## Owned Tasks` (and `## From Meetings`) H2.
        writeFixture(F_PROJ, [
            "---", "type: project-todo", "---", "",
            dv("ToDoLeafActions"), "",
            "## Owned Tasks",
            "- [ ] owned", "",
            "## From Meetings", "",
        ].join("\n"));

        const adapter = makeAdapter(migRoot);
        const tp = { app: { vault: { adapter } } };
        // git is dereferenced (git.commit/.tag/.dirty) when a file is touched —
        // null would throw, so pass a minimal stub. history is an array it pushes
        // audit entries onto.
        const git = { commit: "test", tag: "test", dirty: false };
        const history = [];
        const variables = { views_path: "ranch/views" };

        const readVault = (rel) => fs.readFileSync(path.join(migRoot, rel), "utf8");

        {
            await applyToDoBlueprintMigration(tp, { name: "to-do" }, variables, history, git);

            const v033 = readVault(F_V033);
            const v040 = readVault(F_V040);
            const sentinel = readVault(F_SENTINEL);
            const orphan = readVault(F_ORPHAN);
            const proj = readVault(F_PROJ);

            // --- v0.3.3 daily: full reshape to 5-block v0.5.0 body ---
            ok(
                "HC-V01174-MIGRATE-1 v033 daily gained ToDoDailyCarryover block",
                v033.includes('class: "ToDoDailyCarryover"')
            );
            // NOTE: the reshape emits SectionLabel "Today's Capture", but the v0.5.1
            // cosmetic rename pass then converts it to "Today" — so the ACTUAL
            // end-state text is "Today" (same as the v0.4.0 inject path; they do NOT differ).
            ok(
                "HC-V01174-MIGRATE-2 v033 daily SectionLabel text is \"Today\" (post-rename)",
                /class: "SectionLabel"[^`]*text:\s*"Today"/.test(v033),
                `body=${v033.slice(0, 400)}`
            );
            ok(
                "HC-V01174-MIGRATE-3 v033 daily preserves anchor task line",
                v033.includes("- [ ] anchor v033 task")
            );
            ok(
                "HC-V01174-MIGRATE-4 v033 daily preserves ## Notes + its sentinel",
                v033.includes("## Notes") && v033.includes("<!-- some-note-sentinel keep me -->")
            );

            // --- v0.4.0 daily: SectionLabel "Today" injected ---
            ok(
                "HC-V01174-MIGRATE-5 v040 daily gained SectionLabel \"Today\" block",
                /class: "SectionLabel"[^`]*Today/.test(v040)
            );
            ok(
                "HC-V01174-MIGRATE-6 v040 daily preserves anchor task line",
                v040.includes("- [ ] anchor v040 task")
            );

            // --- sentinel daily: misplaced sentinel relocated after closing `---` ---
            const sLines = sentinel.split("\n");
            let secondDash = -1, dashCount = 0;
            for (let i = 0; i < sLines.length; i++) {
                if (sLines[i] === "---") { dashCount++; if (dashCount === 2) { secondDash = i; break; } }
            }
            const sentLine = sLines.findIndex((l) => l.includes("recurring-materialized"));
            ok(
                "HC-V01174-MIGRATE-7 sentinel daily frontmatter valid (opens + closes with ---)",
                sLines[0] === "---" && secondDash > 0
            );
            ok(
                "HC-V01174-MIGRATE-8 sentinel no longer inside frontmatter (sits after closing ---)",
                sentLine > secondDash,
                `secondDash=${secondDash} sentLine=${sentLine}`
            );
            ok(
                "HC-V01174-MIGRATE-9 sentinel: no recurring-materialized line before closing ---",
                !sLines.slice(0, secondDash + 1).some((l) => l.includes("recurring-materialized"))
            );

            // --- orphan-H2 daily: standalone `## Today` removed ---
            ok(
                "HC-V01174-MIGRATE-10 orphan daily: raw \"## Today\" H2 gone",
                !/^## Today\s*$/m.test(orphan)
            );
            ok(
                "HC-V01174-MIGRATE-11 orphan daily: task line still present",
                orphan.includes("- [ ] keep task")
            );

            // --- project-todo: ## Owned Tasks H2 -> SectionLabel block ---
            ok(
                "HC-V01174-MIGRATE-12 project-todo: raw \"## Owned Tasks\" H2 gone",
                !/^## Owned Tasks\s*$/m.test(proj)
            );
            ok(
                "HC-V01174-MIGRATE-13 project-todo: SectionLabel \"Owned Tasks\" block present",
                /class: "SectionLabel"[^`]*text:\s*"Owned Tasks"/.test(proj)
            );

            // --- idempotency: a 2nd invocation is a no-op (byte-identical) ---
            const before2 = [F_V033, F_V040, F_SENTINEL, F_ORPHAN, F_PROJ].map(readVault);
            await applyToDoBlueprintMigration(tp, { name: "to-do" }, variables, history, git);
            const after2 = [F_V033, F_V040, F_SENTINEL, F_ORPHAN, F_PROJ].map(readVault);
            ok(
                "HC-V01174-MIGRATE-14 idempotent: 2nd invocation leaves all 5 files byte-identical",
                before2.every((b, i) => b === after2[i]),
                "one or more files mutated on second invocation"
            );
        }

        // ===== HC-V0119-MIGRATE — applyRecurringSentinelV070Migration =====
        // Stamp a fresh daily with a LEGACY date-only sentinel into the same tmp
        // vault, run the new migration directly, and assert the heal +
        // idempotency contract.
        {
            const { applyRecurringSentinelV070Migration } = require("../install.js");

            const F_LEGACY = `${DAY_DIR}/ToDo-2026-06-16.md`;
            const LEGACY_BODY = [
                "---", "type: to-do", "---",
                "<!-- recurring-materialized-2026-06-16 -->",
                "",
                "body",
                "",
            ].join("\n");
            writeFixture(F_LEGACY, LEGACY_BODY);

            const history2 = [];
            await applyRecurringSentinelV070Migration(tp, { name: "to-do" }, variables, history2, git);

            const updated = readVault(F_LEGACY);
            ok(
                "HC-V0119-MIGRATE-1 legacy date-only sentinel rewritten to empty-set form",
                /<!-- recurring-materialized-2026-06-16: -->/.test(updated),
                `got:\n${updated}`
            );
            ok(
                "HC-V0119-MIGRATE-2 no leftover date-only sentinel",
                !/<!-- recurring-materialized-2026-06-16 -->/.test(updated),
                `got:\n${updated}`
            );
            // Note: the earlier applyToDoBlueprintMigration test also seeded
            // a date-only sentinel fixture (F_SENTINEL) which this migration
            // legitimately heals — so healed >= 1 is the assertion.
            ok(
                "HC-V0119-MIGRATE-3 history records healed >= 1 (F_LEGACY at minimum)",
                history2.length > 0 && history2[0].healed >= 1,
                `got history2=${JSON.stringify(history2)}`
            );
            ok(
                "HC-V0119-MIGRATE-4 history records empty errors[]",
                history2.length > 0 && Array.isArray(history2[0].errors) && history2[0].errors.length === 0,
                `got errors=${JSON.stringify(history2[0] && history2[0].errors)}`
            );

            // Idempotency: a second invocation must heal nothing (file already in new form).
            const beforeSecond = readVault(F_LEGACY);
            const history3 = [];
            await applyRecurringSentinelV070Migration(tp, { name: "to-do" }, variables, history3, git);
            const afterSecond = readVault(F_LEGACY);
            ok(
                "HC-V0119-MIGRATE-5 second invocation healed=0 (idempotent)",
                history3.length > 0 && history3[0].healed === 0,
                `got history3=${JSON.stringify(history3)}`
            );
            ok(
                "HC-V0119-MIGRATE-6 second invocation leaves file byte-identical",
                beforeSecond === afterSecond
            );
        }
    } finally {
        if (KEEP) {
            console.log(`  KEEP_SEED_VAULT=1: ${migRoot}`);
        } else {
            try { fs.rmSync(migRoot, { recursive: true, force: true }); } catch (e) {}
        }
    }
}

// The MIGRATE family is async (the migration is async). Run it to completion,
// then emit the final tally + exit code so its asserts are counted.
runMigrateFamily()
    .catch((e) => {
        console.log(`  FAIL HC-V01174-MIGRATE-FAMILY threw — ${e && e.message}`);
        fail++;
        failures.push("HC-V01174-MIGRATE-FAMILY");
    })
    .finally(() => {
        console.log("");
        console.log(`Tests: ${pass}/${pass + fail}`);
        if (fail > 0) {
            console.log(`Failures:`);
            for (const f of failures) console.log(`  ${f}`);
            process.exit(1);
        }
        process.exit(0);
    });
