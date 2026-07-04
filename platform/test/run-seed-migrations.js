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

// Thin fs-backed adapter over a tmp vault root. Every relPath (vault-relative)
// maps to path.join(root, relPath). list() returns entries as `dir + "/" + name`.
// Shared by every runMigrateFamily-style helper below — keep this the single
// source of truth for the adapter contract so impl-2/impl-3 (and beyond) don't
// each grow their own near-duplicate shim.
function makeFsAdapter(root) {
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
        async remove(rel) {
            try { fs.unlinkSync(abs(rel)); } catch (e) {
                if (e && e.code !== "ENOENT") throw e;
            }
        },
    };
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

    // ===== HC-V0128-SEED-MIGRATE-PLAN-* — finance v0.10.0 planning layer =====
    // applyFinancePlanScaffolding + applyFinanceSavingsScaffolding + applyFinancePlanBandInjection.
    {
        ok(
            "HC-V0128-SEED-MIGRATE-PLAN-1 Finance Plan.md scaffolded",
            helpers.fileExists(vault, "spice/finance/Finance Plan.md")
        );
        let planFm = {};
        try { planFm = helpers.parseFrontmatter(helpers.readNote(vault, "spice/finance/Finance Plan.md")).frontmatter; } catch (e) {}
        ok(
            "HC-V0128-SEED-MIGRATE-PLAN-2 Finance Plan type=finance-plan",
            planFm.type === "finance-plan"
        );
        ok(
            "HC-V0128-SEED-MIGRATE-PLAN-3 savings/ + Savings.md hub scaffolded",
            helpers.dirExists(vault, "spice/finance/savings") && helpers.fileExists(vault, "spice/finance/savings/Savings.md")
        );
        ok(
            "HC-V0128-SEED-MIGRATE-PLAN-4 Savings-Emergency-Fund.md scaffolded",
            helpers.fileExists(vault, "spice/finance/savings/Savings-Emergency-Fund.md")
        );
        let savFm = {};
        try { savFm = helpers.parseFrontmatter(helpers.readNote(vault, "spice/finance/savings/Savings-Emergency-Fund.md")).frontmatter; } catch (e) {}
        ok(
            "HC-V0128-SEED-MIGRATE-PLAN-5 Emergency Fund type=savings-account",
            savFm.type === "savings-account"
        );
        let budgetBody = "";
        try { budgetBody = helpers.readNote(vault, "spice/finance/budgets/2026-05/Budget-2026-05.md"); } catch (e) {}
        ok(
            "HC-V0128-SEED-MIGRATE-PLAN-6 PlanBand marker injected into existing Budget",
            budgetBody.includes("<!-- plan-band-v0.10.0 -->") && budgetBody.includes('class: "PlanBand"')
        );
        ok(
            "HC-V0128-SEED-MIGRATE-PLAN-7 PlanBand lands above MonthlyOverview",
            budgetBody.indexOf("plan-band-v0.10.0") !== -1 &&
            budgetBody.indexOf("plan-band-v0.10.0") < budgetBody.indexOf("monthly-overview-v0.6.3")
        );
        ok(
            "HC-V0128-SEED-MIGRATE-PLAN-8 .sauce-backup snapshot written for the injected Budget",
            helpers.dirExists(vault, ".sauce-backup")
        );
        // v0.10.2: scaffolded created_at must match the canonical-vocab pattern (no millis) —
        // new Date().toISOString() emits ".SSSZ" which the validator rejects; templates strip it.
        const CANON_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/;
        ok(
            "HC-V0128-SEED-MIGRATE-PLAN-9 scaffolded created_at matches canonical pattern (no millis)",
            CANON_TS.test(String(planFm.created_at || "")) && CANON_TS.test(String(savFm.created_at || "")),
            `plan=${planFm.created_at} ef=${savFm.created_at}`
        );
    }

    // ===== HC-V0149-SEED-MIGRATE-BUDGET-ALLOC-* — applyFinanceBudgetAllocationsBandInjection =====
    // Ungated body injection: adds the BudgetAllocationsEditor dataviewjs block
    // (after BudgetCategoriesEditor) to existing budgets lacking it. (The
    // V0149 prefix is a cosmetic label — the release pipeline computes the real
    // shipping version; this is not a version gate.)
    {
        let allocBody = "";
        try { allocBody = helpers.readNote(vault, "spice/finance/budgets/2026-05/Budget-2026-05.md"); } catch (e) {}
        ok(
            "HC-V0149-SEED-MIGRATE-BUDGET-ALLOC-1 BudgetAllocationsEditor block injected into existing budget",
            allocBody.includes('class: "BudgetAllocationsEditor"')
        );
        ok(
            "HC-V0149-SEED-MIGRATE-BUDGET-ALLOC-2 BudgetAllocationsEditor lands after BudgetCategoriesEditor",
            allocBody.indexOf('class: "BudgetCategoriesEditor"') !== -1 &&
            allocBody.indexOf('class: "BudgetAllocationsEditor"') > allocBody.indexOf('class: "BudgetCategoriesEditor"')
        );
    }

    // ===== HC-V0160-SEED-MIGRATE-BUDGET-GROUP-REPAIR-* — applyFinanceBudgetMalformedGroupRepair =====
    // The seed's Budget-2026-05.md is committed with the pre-fix CORRUPTION: an
    // inline flow-mapping category row (which already carries `group` inside the
    // braces) followed by a stray `    group: Unassigned` continuation line that
    // the old group-backfill spliced in. The repair heal must strip ONLY that
    // stray line while (a) preserving the flow-map row and (b) NOT re-injecting a
    // fresh stray line (the D1 flow-map skip). (The V0160 prefix is a cosmetic
    // label — the release pipeline computes the real shipping version; this is
    // not a version gate.)
    {
        let repairBody = "";
        try { repairBody = helpers.readNote(vault, "spice/finance/budgets/2026-05/Budget-2026-05.md"); } catch (e) {}
        ok(
            "HC-V0160-SEED-MIGRATE-BUDGET-GROUP-REPAIR-1 stray 'group: Unassigned' line stripped from flow-map row",
            !/\n    group: Unassigned/.test(repairBody)
        );
        ok(
            "HC-V0160-SEED-MIGRATE-BUDGET-GROUP-REPAIR-2 flow-map Golf row preserved (group inside braces)",
            /\{"group":"Lifestyle","name":"Golf"/.test(repairBody)
        );
        ok(
            "HC-V0160-SEED-MIGRATE-BUDGET-GROUP-REPAIR-3 repair marker appended",
            repairBody.includes("__budget_malformed_group_repaired:")
        );
        ok(
            "HC-V0160-SEED-MIGRATE-BUDGET-GROUP-REPAIR-4 original clean block Groceries row untouched",
            /group: Discretionary, name: Groceries/.test(repairBody)
        );
    }

    // ===== HC-V0151-SEED-MIGRATE-MONTHS-SENTINEL-* — applyFinanceMonthsEntityCreateSentinel =====
    // The seed's months/Months.md is committed in the MALFORMED pre-heal shape
    // (the `// entity-create:month` marker is the LAST line of the FinanceNav
    // dataviewjs block, AFTER the dv.view call — which comments out Dataview's
    // injected closing brace and throws "Evaluation Error: eval@[native code]"
    // on render). applyFinanceMonthsEntityCreateSentinel must strip that trailing
    // marker and re-insert it as the LEADING line of the block (byte-matching the
    // working content/Budgets.md format). (The V0151 prefix is a cosmetic label —
    // the release pipeline computes the real shipping version; this is not a
    // version gate.)
    {
        let monthsBody = "";
        try { monthsBody = helpers.readNote(vault, "spice/finance/months/Months.md"); } catch (e) {}
        const MARKER = "// entity-create:month";
        // The FinanceNav dv.view call line (materialized views_path == ranch/views).
        const navIdx = monthsBody.indexOf('class: "FinanceNav"');
        const markerIdx = monthsBody.indexOf(MARKER);
        ok(
            "HC-V0151-SEED-MIGRATE-MONTHS-SENTINEL-1 months/Months.md still has the FinanceNav dv.view block",
            navIdx !== -1
        );
        ok(
            "HC-V0151-SEED-MIGRATE-MONTHS-SENTINEL-2 entity-create:month marker present",
            markerIdx !== -1
        );
        ok(
            "HC-V0151-SEED-MIGRATE-MONTHS-SENTINEL-3 marker LEADS the FinanceNav call (marker index < FinanceNav index)",
            markerIdx !== -1 && navIdx !== -1 && markerIdx < navIdx,
            `markerIdx=${markerIdx} navIdx=${navIdx}`
        );
        // Everything AFTER the FinanceNav call line must contain NO entity-create:month
        // line (i.e. the malformed trailing marker was removed).
        const afterNav = navIdx !== -1
            ? monthsBody.slice(monthsBody.indexOf("\n", navIdx) + 1)
            : monthsBody;
        ok(
            "HC-V0151-SEED-MIGRATE-MONTHS-SENTINEL-4 no entity-create:month line trails the FinanceNav call",
            !afterNav.includes(MARKER),
            `afterNav still contains marker`
        );
        // NOTE: SENTINEL-1..4 assert the END-TO-END post-install contract. The
        // full-install path re-materializes months/Months.md from content/Months.md
        // (this dest is not materialize_once), so it cannot ISOLATE the heal on
        // its own — the direct-invocation family runMonthsSentinelHealFamily()
        // below proves applyFinanceMonthsEntityCreateSentinel itself repairs a
        // malformed (trailing-marker) existing hub.
    }

    // ===== HC-V0151-SEED-MIGRATE-PAYCHECK-ARCHIVE-* — applyFinancePaycheckArchiveLegacy =====
    // The seed carries a LEGACY per-check paycheck note at
    // spice/finance/paychecks/2026-05/Paycheck-2026-05-01.md (type: paycheck,
    // pay_period_start present, NO deposits[] array). The month rollup only reads
    // the NEW month-keyed notes (deposits[]) and excludes _archive/, so the
    // clean-cutover heal MOVES every legacy per-check note into
    // spice/finance/paychecks/_archive/ (copy + remove — nothing is deleted).
    // Asserts run AFTER the idempotency phase's first install; the move happens on
    // the FIRST install only (second install finds it already archived → no-op),
    // so this is inherently idempotent against the IDEMP snapshot below.
    // (The V0151 prefix is a cosmetic label; the release pipeline computes the
    // real shipping version — this is not a version gate.)
    {
        ok(
            "HC-V0151-SEED-MIGRATE-PAYCHECK-ARCHIVE-1 legacy per-check note GONE from its original path",
            !helpers.fileExists(vault, "spice/finance/paychecks/2026-05/Paycheck-2026-05-01.md")
        );
        ok(
            "HC-V0151-SEED-MIGRATE-PAYCHECK-ARCHIVE-2 legacy per-check note PRESENT under paychecks/_archive/",
            helpers.fileExists(vault, "spice/finance/paychecks/_archive/Paycheck-2026-05-01.md")
        );
        // Archived copy preserves the original body byte-for-byte.
        let archivedOk = false;
        try {
            const orig = helpers.readNote(SEED_DIR, "spice/finance/paychecks/2026-05/Paycheck-2026-05-01.md");
            const archived = helpers.readNote(vault, "spice/finance/paychecks/_archive/Paycheck-2026-05-01.md");
            archivedOk = orig === archived;
        } catch (e) {}
        ok(
            "HC-V0151-SEED-MIGRATE-PAYCHECK-ARCHIVE-3 archived copy preserves the original body byte-for-byte",
            archivedOk
        );
        ok(
            "HC-V0151-SEED-MIGRATE-PAYCHECK-ARCHIVE-4 .sauce-backup snapshot exists",
            helpers.dirExists(vault, ".sauce-backup")
        );
    }

    // ===== HC-WIKI-SEED-MIGRATE-WIKI-* — wiki blueprint seed coverage =====
    // The seed now carries a small wiki tree: a wiki-hub (Wiki.md), two nested
    // wiki-sections (infra/Infra.md, infra/aws/AWS.md), one deep wiki-page
    // (infra/aws/VPC Peering.md), and one root-level wiki-page (Loose Note.md).
    // These asserts verify that after install:
    //   1. The hub + pages exist with correct frontmatter types.
    //   2. The entity-create-registry has wiki-section + wiki-page contributions.
    //   3. The nav-buttons-registry has the wiki-hub button.
    //   4. The breadcrumb-registry has the wiki contribution including wiki-page.
    //   5. The doc-search mechanism is the single source of truth (WIKI-7).
    {
        // WIKI-1: hub note present with type: wiki-hub
        let wikiHubFm = {};
        try {
            const wikiHubNote = helpers.readNote(vault, "spice/wiki/Wiki.md");
            wikiHubFm = helpers.parseFrontmatter(wikiHubNote).frontmatter;
        } catch (e) {}
        ok(
            "HC-WIKI-SEED-MIGRATE-WIKI-1 spice/wiki/Wiki.md exists with type: wiki-hub",
            helpers.fileExists(vault, "spice/wiki/Wiki.md") && wikiHubFm.type === "wiki-hub",
            `type=${wikiHubFm.type}`
        );

        // WIKI-2: infra section present with type: wiki-section
        let infraFm = {};
        try {
            const infraNote = helpers.readNote(vault, "spice/wiki/infra/Infra.md");
            infraFm = helpers.parseFrontmatter(infraNote).frontmatter;
        } catch (e) {}
        ok(
            "HC-WIKI-SEED-MIGRATE-WIKI-2 spice/wiki/infra/Infra.md exists with type: wiki-section",
            helpers.fileExists(vault, "spice/wiki/infra/Infra.md") && infraFm.type === "wiki-section",
            `type=${infraFm.type}`
        );

        // WIKI-3: deep wiki-page preserved with type: wiki-page
        let vpcFm = {};
        try {
            const vpcNote = helpers.readNote(vault, "spice/wiki/infra/aws/VPC Peering.md");
            vpcFm = helpers.parseFrontmatter(vpcNote).frontmatter;
        } catch (e) {}
        ok(
            "HC-WIKI-SEED-MIGRATE-WIKI-3 spice/wiki/infra/aws/VPC Peering.md exists with type: wiki-page",
            helpers.fileExists(vault, "spice/wiki/infra/aws/VPC Peering.md") && vpcFm.type === "wiki-page",
            `type=${vpcFm.type}`
        );

        // WIKI-4: entity-create-registry has wiki-section + wiki-page contributions
        let ecReg = null;
        try { ecReg = helpers.readJson(vault, "ranch/entity-create-registry.json"); } catch (e) {}
        const wikiEc = ecReg && ecReg.contributions && ecReg.contributions.wiki;
        const wikiEcIds = wikiEc ? wikiEc.map((e) => e.id) : [];
        ok(
            "HC-WIKI-SEED-MIGRATE-WIKI-4 entity-create-registry has wiki-section and wiki-page contributions",
            wikiEcIds.includes("wiki-section") && wikiEcIds.includes("wiki-page"),
            `wiki contributions=${JSON.stringify(wikiEcIds)}`
        );

        // WIKI-5: nav-buttons-registry has the wiki-hub button
        let navReg = null;
        try { navReg = helpers.readJson(vault, "ranch/nav-buttons-registry.json"); } catch (e) {}
        const wikiNav = navReg && navReg.contributions && navReg.contributions.wiki;
        const wikiNavIds = wikiNav ? wikiNav.map((e) => e.id) : [];
        ok(
            "HC-WIKI-SEED-MIGRATE-WIKI-5 nav-buttons-registry has wiki-hub button",
            wikiNavIds.includes("wiki-hub"),
            `wiki nav buttons=${JSON.stringify(wikiNavIds)}`
        );

        // WIKI-6: breadcrumb-registry has wiki contribution with wiki-page type
        const bcRegPath = path.join(vault, "ranch/breadcrumb-registry.json");
        let bcReg = null;
        try { bcReg = JSON.parse(fs.readFileSync(bcRegPath, "utf8")); } catch (e) {}
        const wikiBc = bcReg && bcReg.contributions && bcReg.contributions.wiki;
        const wikiBcTypes = wikiBc && wikiBc.types ? Object.keys(wikiBc.types) : [];
        ok(
            "HC-WIKI-SEED-MIGRATE-WIKI-6 breadcrumb-registry has wiki contribution including wiki-page type",
            wikiBcTypes.includes("wiki-page") && wikiBcTypes.includes("wiki-hub"),
            `wiki breadcrumb types=${JSON.stringify(wikiBcTypes)}`
        );

        // WIKI-7: doc-search is the single source of truth — mechanism file exists at
        // REPO_ROOT and the project manifest no longer lists helpers/doc-search.js.
        // This is a repo-level check (not the installed vault), reflecting the graduation
        // from project-local helper to shared mechanism performed in Stage A.
        const docSearchMechPath = path.join(REPO_ROOT, "platform/mechanisms/doc-search/doc-search.js");
        const projectManifestPath = path.join(REPO_ROOT, "platform/blueprints/project/manifest.json");
        let projectManifest = null;
        try { projectManifest = JSON.parse(fs.readFileSync(projectManifestPath, "utf8")); } catch (e) {}
        const projectFiles = (projectManifest && projectManifest.files) ? projectManifest.files : [];
        const hasLocalDocSearch = projectFiles.some((f) => f.source === "helpers/doc-search.js");
        ok(
            "HC-WIKI-SEED-MIGRATE-WIKI-7 doc-search mechanism exists at REPO_ROOT and project manifest no longer lists helpers/doc-search.js",
            fs.existsSync(docSearchMechPath) && !hasLocalDocSearch,
            `mechExists=${fs.existsSync(docSearchMechPath)} projectLocalDocSearch=${hasLocalDocSearch}`
        );

        // WIKI-8: chrome heal collapsed the seed section hub's button chrome into the
        // WikiTree block — WikiTree renders the create/nav buttons + search + cards in
        // ONE block, so the standalone WikiHubActions block AND the legacy stacked
        // entity-create blocks are gone (no cross-block gap, no "---" before WikiTree).
        let infraBody = "";
        try { infraBody = helpers.readNote(vault, "spice/wiki/infra/Infra.md"); } catch (e) {}
        const _navToTree = (b) => b.slice(b.indexOf("SpaceNavButtons"), b.indexOf("WikiTree"));
        ok(
            "HC-WIKI-SEED-MIGRATE-WIKI-8 section hub healed: WikiTree renders buttons; no standalone WikiHubActions/entity-create block or '---'",
            /class:\s*"WikiTree"/.test(infraBody) && !/class:\s*"WikiHubActions"/.test(infraBody) &&
            !/entity-create:wiki-(section|page)/.test(infraBody) && !/^-{3,}$/m.test(_navToTree(infraBody)),
            `hasTree=${/WikiTree/.test(infraBody)} hasWHA=${/WikiHubActions/.test(infraBody)} hasLegacy=${/entity-create:wiki-/.test(infraBody)}`
        );

        // WIKI-9: the re-materialized root hub also ends in a single WikiTree block.
        let hubBody = "";
        try { hubBody = helpers.readNote(vault, "spice/wiki/Wiki.md"); } catch (e) {}
        ok(
            "HC-WIKI-SEED-MIGRATE-WIKI-9 root hub renders WikiTree only (no standalone WikiHubActions/entity-create block)",
            /class:\s*"WikiTree"/.test(hubBody) && !/class:\s*"WikiHubActions"/.test(hubBody) &&
            !/entity-create:wiki-(section|page)/.test(hubBody),
            `hasTree=${/WikiTree/.test(hubBody)} hasWHA=${/WikiHubActions/.test(hubBody)} hasLegacy=${/entity-create:wiki-/.test(hubBody)}`
        );

        // WIKI-10: breadcrumbs guaranteed on EVERY wiki section + page (path_walk chrome
        // via template + heal) — hub, both nested section hubs, and a deep page.
        let awsBody = "", vpcBody = "";
        try { awsBody = helpers.readNote(vault, "spice/wiki/infra/aws/AWS.md"); } catch (e) {}
        try { vpcBody = helpers.readNote(vault, "spice/wiki/infra/aws/VPC Peering.md"); } catch (e) {}
        const _hasBc = (b) => /class:\s*"Breadcrumb"/.test(b);
        ok(
            "HC-WIKI-SEED-MIGRATE-WIKI-10 breadcrumb present on every wiki section + page (hub/infra/aws + deep page)",
            _hasBc(hubBody) && _hasBc(infraBody) && _hasBc(awsBody) && _hasBc(vpcBody),
            `hub=${_hasBc(hubBody)} infra=${_hasBc(infraBody)} aws=${_hasBc(awsBody)} vpc=${_hasBc(vpcBody)}`
        );
    }

    // ===== HC-V0RDR-SEED-READER-* — reader blueprint seed coverage =====
    // The seed carries three flat reader-article notes under spice/reader/ with
    // DISTINCT statuses (unread / reading / archived) and distinct captured_at
    // timestamps. The reader-hub note (spice/reader/Reader.md) is deliberately NOT
    // seeded — the installer's files[] (content/Reader Hub.md) + applyReaderScaffoldHeal
    // must produce it, so these asserts exercise that scaffold/heal path end-to-end.
    // These asserts verify that after install:
    //   1. The hub note exists with the ReaderQueue chrome (scaffold + heal ran).
    //   2. The three seed articles survive with type: reader-article.
    //   3. Their frontmatter status values survive (one archived, one unread).
    {
        // READER-1: the reader-hub was scaffolded/healed and carries the ReaderQueue
        // chrome block (proves files[] install + applyReaderScaffoldHeal produced it —
        // it is NOT in the seed).
        let readerHubBody = "";
        let readerHubFm = {};
        try {
            readerHubBody = helpers.readNote(vault, "spice/reader/Reader.md");
            readerHubFm = helpers.parseFrontmatter(readerHubBody).frontmatter;
        } catch (e) {}
        ok(
            "HC-V0RDR-SEED-READER-1 spice/reader/Reader.md exists (scaffolded) with type: reader-hub and ReaderQueue chrome",
            helpers.fileExists(vault, "spice/reader/Reader.md") &&
                readerHubFm.type === "reader-hub" &&
                /class:\s*"ReaderQueue"/.test(readerHubBody),
            `type=${readerHubFm.type} hasQueue=${/class:\s*"ReaderQueue"/.test(readerHubBody)}`
        );

        // READER-2: all three seed articles survive install with type: reader-article.
        const articleRels = [
            "spice/reader/The Unix Philosophy Revisited.md",
            "spice/reader/Notes on Distributed Consensus.md",
            "spice/reader/A History of the Modular Synthesizer.md",
        ];
        const articleFms = {};
        for (const rel of articleRels) {
            try { articleFms[rel] = helpers.parseFrontmatter(helpers.readNote(vault, rel)).frontmatter; }
            catch (e) { articleFms[rel] = {}; }
        }
        const allExist = articleRels.every((rel) => helpers.fileExists(vault, rel));
        const allTyped = articleRels.every((rel) => articleFms[rel].type === "reader-article");
        ok(
            "HC-V0RDR-SEED-READER-2 all three seed articles survive with type: reader-article",
            allExist && allTyped,
            `exist=${allExist} typed=${articleRels.map((r) => articleFms[r].type).join(",")}`
        );

        // READER-3: distinct statuses survived install (proves article frontmatter is
        // preserved, not rewritten) — one unread, one reading, one archived.
        const statuses = articleRels.map((rel) => articleFms[rel].status);
        const hasUnread = statuses.includes("unread");
        const hasReading = statuses.includes("reading");
        const hasArchived = statuses.includes("archived");
        ok(
            "HC-V0RDR-SEED-READER-3 seed article statuses survive (unread + reading + archived all present)",
            hasUnread && hasReading && hasArchived,
            `statuses=${JSON.stringify(statuses)}`
        );

        // READER-4: the entity-create-registry carries the reader-article contribution
        // (proves the reader blueprint's new_entity_buttons registered on install).
        let ecReg = null;
        try { ecReg = helpers.readJson(vault, "ranch/entity-create-registry.json"); } catch (e) {}
        const readerEc = ecReg && ecReg.contributions && ecReg.contributions.reader;
        const readerEcIds = readerEc ? readerEc.map((e) => e.id) : [];
        ok(
            "HC-V0RDR-SEED-READER-4 entity-create-registry has the reader-article contribution",
            readerEcIds.includes("reader-article"),
            `reader contributions=${JSON.stringify(readerEcIds)}`
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

    // ===== HC-V01240-SEED-CHROME-* — applyNoteChromeHeal (note-chrome wave 1) =====
    // The seed carries pre-heal fixtures (SpaceNavButtons block, no Breadcrumb;
    // meeting note with raw ## H2 content headers). The per-vault heal injects
    // the Breadcrumb dataviewjs block before SpaceNavButtons and (meeting only)
    // rewrites the four ## headings to SectionLabel. Asserts run AFTER the
    // idempotency phase (two installs) so CHROME-6 proves exactly-once injection.
    const mtg = helpers.readNote(vault, "spice/meetings/notes/2026/06-June/Standup-2026-06-17.md");
    ok("HC-V01240-SEED-CHROME-1 meeting breadcrumb injected", /class:\s*"Breadcrumb"/.test(mtg));
    ok("HC-V01240-SEED-CHROME-2 meeting ## Attendees rewritten to SectionLabel",
       !/^##\s+Attendees\s*$/m.test(mtg) && /SectionLabel[\s\S]*Attendees/.test(mtg));
    const scr = helpers.readNote(vault, "spice/scratch/2026/06-June/2026-06-17/Scratch-2026-06-17-14-30.md");
    ok("HC-V01240-SEED-CHROME-3 scratch breadcrumb injected", /class:\s*"Breadcrumb"/.test(scr));
    const td = helpers.readNote(vault, "spice/to-do/2026/06-June/ToDo-2026-06-17.md");
    ok("HC-V01240-SEED-CHROME-4 to-do breadcrumb injected", /class:\s*"Breadcrumb"/.test(td));
    ok("HC-V01240-SEED-CHROME-5 .sauce-backup snapshot exists", fs.existsSync(path.join(vault, ".sauce-backup")));
    ok("HC-V01240-SEED-CHROME-6 meeting breadcrumb injected exactly once",
       (mtg.match(/class:\s*"Breadcrumb"/g) || []).length === 1);
    const sd = helpers.readNote(vault, "spice/scratch/2026/06-June/2026-06-17/Scratch-Day-2026-06-17.md");
    ok("HC-V01240-SEED-CHROME-7 scratch-day breadcrumb injected after H1, before SpaceNavButtons",
       /class:\s*"Breadcrumb"/.test(sd) &&
       sd.indexOf("# ") < sd.indexOf('class: "Breadcrumb"') &&
       sd.indexOf('class: "Breadcrumb"') < sd.indexOf('class: "SpaceNavButtons"'));

    // ===== HC-ADIV-SEED-* — action-bar divider strip (ScratchDayActions owns <hr>) =====
    // The seed scratch-day fixture brackets its ScratchDayActions block with a
    // blank-line-padded `---` (an older template shape). ScratchDayActions now
    // renders its OWN top+bottom <hr> dividers, so applyNoteChromeHeal (step 7,
    // _stripDividersAroundActionBlock) removes the now-redundant `---` on both
    // sides. `sd` is post-two-install, so a clean result also proves idempotency.
    ok("HC-ADIV-SEED-1 scratch-day `---` before ScratchDayActions stripped by heal",
       !/-{3,}[ \t]*\n+```dataviewjs\n[^`]*ScratchDayActions/.test(sd));
    ok("HC-ADIV-SEED-2 scratch-day `---` after ScratchDayActions stripped by heal",
       !/ScratchDayActions[\s\S]*?\n```\n+-{3,}/.test(sd));
    ok("HC-ADIV-SEED-3 ScratchDayActions block preserved after strip",
       /class:\s*"ScratchDayActions"/.test(sd));
    // Direct unit — _stripDividersAroundActionBlock: strips both sides, idempotent,
    // and a no-op when the block is not bracketed by `---`.
    {
      const { _stripDividersAroundActionBlock } = require("../install.js");
      const withDiv = '```dataviewjs\nawait dv.view("x", { class: "SpaceNavButtons" });\n```\n\n---\n```dataviewjs\nawait dv.view("x", { class: "ToDoLeafActions" });\n```\n---\n\n```dataviewjs\nawait dv.view("x", { class: "SectionLabel" });\n```\n';
      const once = _stripDividersAroundActionBlock(withDiv, "ToDoLeafActions");
      const twice = _stripDividersAroundActionBlock(once, "ToDoLeafActions");
      ok("HC-ADIV-UNIT-1 strip removes both `---` bracketing the action block",
         !/-{3,}[ \t]*\n+```dataviewjs\n[^`]*ToDoLeafActions/.test(once) &&
         !/ToDoLeafActions[\s\S]*?\n```\n+-{3,}/.test(once) &&
         /class:\s*"ToDoLeafActions"/.test(once));
      ok("HC-ADIV-UNIT-2 strip is idempotent", once === twice);
      const noDiv = withDiv.replace(/---\n/g, "");
      ok("HC-ADIV-UNIT-3 strip is a no-op when no `---` brackets the block",
         _stripDividersAroundActionBlock(noDiv, "ToDoLeafActions") === noDiv);
    }

    // ===== HC-V01241-SEED-DBLDIV-* — double-divider cleanup (v0.124.1) =====
    // The seed meeting fixture carries the real old Meeting.md shape: each `##`
    // content header is preceded by a `---` divider SHIELDED by a blank line
    // (...```\n\n---\n\n## Attendees). v0.124.0's H2->SectionLabel conversion only
    // dropped a `---` DIRECTLY adjacent to the heading, so the blank-shielded
    // `---` survived — leaving a markdown `---` PLUS the SectionLabel's own
    // hairline (a double divider) before Agenda/Notes/Action Items. The v0.124.1
    // normalization pass removes a fence-depth-0 `---` whose next non-blank
    // content opens a SectionLabel dataviewjs block, leaving one blank line.
    // `mtg` is the post-two-install state (asserts run after the idempotency
    // phase), so a clean `mtg` here also proves the cleanup is idempotent.
    //
    // Robust line-scan: does any `---` line have a SectionLabel dataviewjs block
    // as its next non-blank content (skipping blank lines)?
    const dividerBeforeSectionLabel = (txt) => {
        const ls = txt.split("\n");
        for (let i = 0; i < ls.length; i++) {
            if (!/^---\s*$/.test(ls[i])) continue;
            let j = i + 1;
            while (j < ls.length && ls[j].trim() === "") j++;
            if (j < ls.length && /^\s*```dataviewjs\s*$/.test(ls[j])) {
                // peek into the fence body for SectionLabel before it closes
                for (let k = j + 1; k < ls.length; k++) {
                    if (/^\s*```\s*$/.test(ls[k])) break;
                    if (/SectionLabel/.test(ls[k])) return true;
                }
            }
        }
        return false;
    };
    ok("HC-V01241-SEED-DBLDIV-1 no markdown --- precedes a SectionLabel block",
       !dividerBeforeSectionLabel(mtg));
    ok("HC-V01241-SEED-DBLDIV-2 the four SectionLabels survive the cleanup",
       /SectionLabel[\s\S]*?Attendees/.test(mtg) &&
       /SectionLabel[\s\S]*?Agenda/.test(mtg) &&
       /SectionLabel[\s\S]*?Notes/.test(mtg) &&
       /SectionLabel[\s\S]*?Action Items/.test(mtg));
    ok("HC-V01241-SEED-DBLDIV-3 idempotent: one breadcrumb + no leftover divider after two installs",
       (mtg.match(/class:\s*"Breadcrumb"/g) || []).length === 1 &&
       !dividerBeforeSectionLabel(mtg));

    // DBLDIV-4/5 — frontmatter-delimiter safety (content-safety guard, v0.124.1).
    // A nav-less meeting note (NO SpaceNavButtons block, so the breadcrumb inject
    // no-ops) whose FIRST body element is `## Notes` gets that heading rewritten
    // to a SectionLabel block as the first body element. Without the guard, the
    // double-divider cleanup would see the YAML frontmatter-closing `---` sitting
    // immediately before that SectionLabel block and EAT it — leaving only the
    // opening `---` (unterminated frontmatter, corrupted note). The fmEnd guard
    // refuses to drop any `---` at or before the leading frontmatter close.
    const navless = helpers.readNote(vault, "spice/meetings/notes/2026/06-June/Navless-2026-06-17.md");
    const navlessFm = helpers.parseFrontmatter(navless).frontmatter;
    ok("HC-V01241-SEED-DBLDIV-4 nav-less meeting frontmatter still closed + heading converted",
       navlessFm.type === "meeting" &&
       !/^##\s+Notes\s*$/m.test(navless) &&
       /SectionLabel[\s\S]*?Notes/.test(navless));
    ok("HC-V01241-SEED-DBLDIV-5 nav-less meeting prose preserved verbatim",
       navless.includes("- some user note line") && navless.includes("- another line"));

    // ===== HC-V01250-SEED-MLA-* — applyNoteChromeHeal injects MeetingLeafActions =====
    // Tasks 1–2 added the MeetingLeafActions button row to the Meeting.md template
    // so NEW meeting leaf notes carry it; this heal back-injects it into EXISTING
    // meeting leaf notes, right after the SpaceNavButtons block. Insert-only +
    // idempotent (CHROME-6-style exactly-once), hub-skipping (a meetings-hub note
    // is template-only scope). `mlaMtg` is the post-two-install state, so MLA-3
    // proves exactly-once injection. The nav-less meeting has no SpaceNavButtons
    // anchor, so the inject no-ops there (MLA-4). No meetings-hub-tagged seed note
    // exists under spice/meetings/hubs/, so the hub skip-assert (MLA-5) is omitted.
    const mlaMtg = helpers.readNote(vault, "spice/meetings/notes/2026/06-June/Standup-2026-06-17.md");
    ok("HC-V01250-SEED-MLA-1 meeting has MeetingLeafActions block", /class:\s*"MeetingLeafActions"/.test(mlaMtg));
    ok("HC-V01250-SEED-MLA-2 MeetingLeafActions sits after SpaceNavButtons", mlaMtg.indexOf('class: "SpaceNavButtons"') !== -1 && mlaMtg.indexOf('class: "SpaceNavButtons"') < mlaMtg.indexOf('class: "MeetingLeafActions"'));
    ok("HC-V01250-SEED-MLA-3 injected exactly once", (mlaMtg.match(/class:\s*"MeetingLeafActions"/g) || []).length === 1);
    const mlaNav = helpers.readNote(vault, "spice/meetings/notes/2026/06-June/Navless-2026-06-17.md");
    ok("HC-V01250-SEED-MLA-4 nav-less note NOT injected (no anchor)", !/class:\s*"MeetingLeafActions"/.test(mlaNav));

    // ===== HC-V01240-SEED-PNAME-* — applyProjectNameBackfill (note-chrome wave 1) =====
    // The seed carries a mixed-case project ("My Cool Project" under slug
    // my-cool-project) whose Project Map note has NO project_name field. The
    // per-mechanism heal resolves the display name from the project hub note's
    // basename and stamps project_name into the map's frontmatter — so the
    // breadcrumb's fm:project_name resolver shows "My Cool Project", not the slug.
    const mapNote = helpers.readNote(vault, "spice/projects/my-cool-project/Project Map.md");
    const { frontmatter: mapFm } = helpers.parseFrontmatter(mapNote);
    ok("HC-V01240-SEED-PNAME-1 map project_name backfilled", typeof mapFm.project_name === "string" && mapFm.project_name.length > 0);
    ok("HC-V01240-SEED-PNAME-2 map project_name is display name not slug", mapFm.project_name === "My Cool Project");

    // ===== HC-V01325-SEED-AIMARKER-* — applyNoteChromeHeal relocates a
    // mis-placed ACTION_ITEMS_MARKER (and the task run that landed with it).
    // The seed carries a meeting note frozen at the v0.127.0 buggy shape: the
    // marker sits ABOVE the "Action Items" SectionLabel and two button-created
    // action items are parked under Notes (directly above the marker, exactly
    // where appendTask deposited them). The per-vault note-chrome heal
    // (_relocateActionItemsMarker, _healNoteChromeBody step 5) moves the marker
    // BELOW the label and drags both tasks down into the Action Items section.
    const aim = helpers.readNote(vault, "spice/meetings/notes/2026/06-June/Action-Items-Misplaced-2026-06-18.md");
    const aimLines = aim.split("\n");
    const aimNotesIdx = aimLines.findIndex((l) => l.includes('class: "SectionLabel", args: [{ text: "Notes" }]'));
    const aimLabelIdx = aimLines.findIndex((l) => l.includes('class: "SectionLabel", args: [{ text: "Action Items" }]'));
    const aimMarkerIdx = aimLines.findIndex((l) => l.includes("<!-- ACTION_ITEMS_MARKER -->"));
    const aimTask1Idx = aimLines.findIndex((l) => l.includes("Wire up the Planner Agent"));
    const aimTask2Idx = aimLines.findIndex((l) => l.includes("Draft the CR board mapping doc"));
    ok("HC-V01325-SEED-AIMARKER-1 marker present exactly once",
       (aim.match(/<!-- ACTION_ITEMS_MARKER -->/g) || []).length === 1);
    ok("HC-V01325-SEED-AIMARKER-2 marker now sits BELOW the Action Items label",
       aimLabelIdx !== -1 && aimMarkerIdx !== -1 && aimLabelIdx < aimMarkerIdx);
    ok("HC-V01325-SEED-AIMARKER-3 both tasks relocated BELOW the marker (into Action Items)",
       aimTask1Idx > aimMarkerIdx && aimTask2Idx > aimMarkerIdx);
    ok("HC-V01325-SEED-AIMARKER-4 tasks kept in document order",
       aimTask1Idx !== -1 && aimTask2Idx !== -1 && aimTask1Idx < aimTask2Idx);
    ok("HC-V01325-SEED-AIMARKER-5 no task lines remain between Notes and the Action Items label",
       (aimNotesIdx !== -1 && aimLabelIdx !== -1 && aimNotesIdx < aimLabelIdx &&
        !aimLines.slice(aimNotesIdx + 1, aimLabelIdx).some((l) => /^[-*+] \[[ xX]\] /.test(l))));

    // ===== HC-V01330-SEED-DVGUARD-* — applyNoteChromeHeal step 4b guards the
    // eager dv.current().file.path in the PeopleRendering inline_body. The same
    // seed note carries the unguarded button-created form; the heal must rewrite
    // it to an optional-chained, active-file-fallback expression so it no longer
    // throws "Cannot read properties of undefined (reading 'file')" on cold load.
    ok("HC-V01330-SEED-DVGUARD-1 unguarded dv.current().file.path removed",
       !/dv\.current\(\)\.file\.path/.test(aim));
    ok("HC-V01330-SEED-DVGUARD-2 rewritten to optional-chained + active-file fallback",
       aim.includes("dv.current()?.file?.path") && aim.includes("app.workspace.getActiveFile()"));

    // ===== HC-DAILYTASK-SEED-* — applyDailyTasksToEntityMigration =====
    // The seed's most-recent daily (ToDo-2026-06-17.md) carries the pre-migration
    // raw-markdown shape: an open capture line with inline fields
    // (`- [ ] Apply for Credit card [due:: 2026-06-30] [project:: [[Sauce]]] [priority:: high]`),
    // a done line (`- [x] Feed the dogs`), a Carryover SectionLabel + open carryover
    // line (`- [ ] Call Shirley Septic`), plus the legacy TodayCaptureEditableList +
    // ToDoDailyCarryover dataviewjs blocks. The ungated, backup-first
    // applyDailyTasksToEntityMigration converts each OPEN line into a note-per-task
    // under spice/tasks/, leaves the done line's raw markdown untouched, swaps the
    // legacy widget blocks for a single TaskTodayList render, and stamps a
    // <!-- tasks-migrated --> sentinel. Only the MOST-RECENT daily is converted.
    //
    // Asserts run AFTER the idempotency phase (two installs), so DAILYTASK-6
    // (single task-note per unique title) also proves the migration is idempotent —
    // the sentinel + TaskTodayList block short-circuit the second install.
    {
        // Enumerate task-notes under spice/tasks/ and parse each one's frontmatter.
        const tasksDir = path.join(vault, "spice/tasks");
        const taskNotes = [];
        if (fs.existsSync(tasksDir)) {
            for (const f of fs.readdirSync(tasksDir)) {
                if (!f.endsWith(".md")) continue;
                const body = fs.readFileSync(path.join(tasksDir, f), "utf8");
                const { frontmatter } = helpers.parseFrontmatter(body);
                taskNotes.push({ file: f, fm: frontmatter, body });
            }
        }
        const byTitle = (t) => taskNotes.filter((n) => String(n.fm.title || "") === t);

        // 1. "Apply for Credit card" — inline fields carried into frontmatter.
        const credit = byTitle("Apply for Credit card");
        ok("HC-DAILYTASK-SEED-1 task-note created for 'Apply for Credit card'",
           credit.length === 1, `found ${credit.length}`);
        const creditFm = credit.length ? credit[0].fm : {};
        ok("HC-DAILYTASK-SEED-1b 'Apply for Credit card' scheduled == due (2026-06-30)",
           String(creditFm.scheduled || "") === "2026-06-30", `scheduled=${creditFm.scheduled}`);
        ok("HC-DAILYTASK-SEED-1c 'Apply for Credit card' project == [[Sauce]]",
           String(creditFm.project || "") === "[[Sauce]]", `project=${creditFm.project}`);
        ok("HC-DAILYTASK-SEED-1d 'Apply for Credit card' priority == high",
           String(creditFm.priority || "") === "high", `priority=${creditFm.priority}`);
        ok("HC-DAILYTASK-SEED-1e 'Apply for Credit card' source == daily",
           String(creditFm.source || "") === "daily", `source=${creditFm.source}`);
        ok("HC-DAILYTASK-SEED-1f 'Apply for Credit card' type == task + status open",
           String(creditFm.type || "") === "task" && String(creditFm.status || "") === "open",
           `type=${creditFm.type} status=${creditFm.status}`);

        // 2. "Call Shirley Septic" — no due → scheduled falls back to the daily's date.
        const shirley = byTitle("Call Shirley Septic");
        ok("HC-DAILYTASK-SEED-2 task-note created for 'Call Shirley Septic'",
           shirley.length === 1, `found ${shirley.length}`);
        const shirleyFm = shirley.length ? shirley[0].fm : {};
        ok("HC-DAILYTASK-SEED-2b 'Call Shirley Septic' scheduled == daily date (2026-06-17)",
           String(shirleyFm.scheduled || "") === "2026-06-17", `scheduled=${shirleyFm.scheduled}`);
        ok("HC-DAILYTASK-SEED-2c 'Call Shirley Septic' due blank",
           String(shirleyFm.due || "") === "", `due=${shirleyFm.due}`);

        // 3. "Feed the dogs" was `- [x]` (done) → NEVER converted.
        ok("HC-DAILYTASK-SEED-3 no task-note for the DONE line 'Feed the dogs'",
           byTitle("Feed the dogs").length === 0);

        // 4. .sauce-backup snapshot of the daily exists.
        let backupOfDaily = false;
        const backupRoot = path.join(vault, ".sauce-backup");
        if (fs.existsSync(backupRoot)) {
            const stack = [backupRoot];
            while (stack.length) {
                const dir = stack.pop();
                for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                    const p = path.join(dir, e.name);
                    if (e.isDirectory()) stack.push(p);
                    else if (/ToDo-2026-06-17\.md$/.test(e.name)) backupOfDaily = true;
                }
            }
        }
        ok("HC-DAILYTASK-SEED-4 .sauce-backup snapshot of the daily exists", backupOfDaily);

        // 5. Healed daily now has a TaskTodayList block + sentinel, and the migrated
        //    open lines are gone (done line stays).
        const healedDaily = helpers.readNote(vault, "spice/to-do/2026/06-June/ToDo-2026-06-17.md");
        ok("HC-DAILYTASK-SEED-5 healed daily has TaskTodayList block",
           /class:\s*"TaskTodayList"/.test(healedDaily));
        ok("HC-DAILYTASK-SEED-5b healed daily has <!-- tasks-migrated --> sentinel",
           healedDaily.includes("<!-- tasks-migrated -->"));
        ok("HC-DAILYTASK-SEED-5c migrated open lines removed from healed daily",
           !healedDaily.includes("- [ ] Apply for Credit card") &&
           !healedDaily.includes("- [ ] Call Shirley Septic"));
        ok("HC-DAILYTASK-SEED-5d done line 'Feed the dogs' left untouched in the daily",
           healedDaily.includes("- [x] Feed the dogs"));
        ok("HC-DAILYTASK-SEED-5e legacy TodayCaptureEditableList/ToDoDailyCarryover blocks swapped out",
           !/class:\s*"TodayCaptureEditableList"/.test(healedDaily) &&
           !/class:\s*"ToDoDailyCarryover"/.test(healedDaily));

        // 6. Idempotency (post two-install): exactly one task-note per unique title,
        //    no duplicates, and exactly one TaskTodayList + one sentinel.
        ok("HC-DAILYTASK-SEED-6 no duplicate task-notes after two installs",
           byTitle("Apply for Credit card").length === 1 &&
           byTitle("Call Shirley Septic").length === 1);
        ok("HC-DAILYTASK-SEED-6b sentinel + TaskTodayList each present exactly once",
           (healedDaily.match(/<!-- tasks-migrated -->/g) || []).length === 1 &&
           (healedDaily.match(/class:\s*"TaskTodayList"/g) || []).length === 1);
    }

    // ===== HC-TASKHEAL-SEED-* — applyTaskNoteHeal =====
    // The seed carries an ugly-named + bare task note at
    // spice/tasks/task-20260101-120000-abcd.md (type: task, title: "Do the thing",
    // no <!-- TASK_NOTES --> marker in its body). The ungated, backup-first,
    // idempotent applyTaskNoteHeal (1) RENAMES it to the readable
    // "Do the thing.md" and (2) INJECTS the standard chrome (SpaceNavButtons +
    // TaskNoteView + <!-- TASK_NOTES --> marker). Asserts run AFTER the
    // idempotency phase (two installs), so the "no duplicate" assert also proves
    // the heal is idempotent (a title-named + marker-present note is skipped).
    {
        const tasksDir = path.join(vault, "spice/tasks");
        const topLevel = fs.existsSync(tasksDir)
            ? fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"))
            : [];

        ok("HC-TASKHEAL-SEED-1 ugly-named task note GONE from its original path",
           !helpers.fileExists(vault, "spice/tasks/task-20260101-120000-abcd.md"));
        ok("HC-TASKHEAL-SEED-2 renamed to the readable 'Do the thing.md'",
           helpers.fileExists(vault, "spice/tasks/Do the thing.md"),
           `top-level task notes: ${topLevel.join(", ")}`);

        let healedTask = "";
        try { healedTask = helpers.readNote(vault, "spice/tasks/Do the thing.md"); } catch (e) {}
        ok("HC-TASKHEAL-SEED-3 healed task note has the <!-- TASK_NOTES --> marker",
           healedTask.includes("<!-- TASK_NOTES -->"));
        ok("HC-TASKHEAL-SEED-4 healed task note has SpaceNavButtons + TaskNoteView chrome",
           /class:\s*"SpaceNavButtons"/.test(healedTask) && /class:\s*"TaskNoteView"/.test(healedTask));
        ok("HC-TASKHEAL-SEED-5 healed task note frontmatter (title) preserved",
           /^title:\s*Do the thing\s*$/m.test(healedTask));
        ok("HC-TASKHEAL-SEED-6 .sauce-backup snapshot exists",
           helpers.dirExists(vault, ".sauce-backup"));

        // Idempotency: exactly ONE 'Do the thing' task note (no " 2" dup) after two
        // installs, and exactly one marker in it.
        const doThingNotes = topLevel.filter((f) => /^Do the thing( \d+)?\.md$/.test(f));
        ok("HC-TASKHEAL-SEED-7 no duplicate 'Do the thing' note after two installs",
           doThingNotes.length === 1, `found: ${doThingNotes.join(", ")}`);
        ok("HC-TASKHEAL-SEED-7b exactly one <!-- TASK_NOTES --> marker (no re-inject)",
           (healedTask.match(/<!-- TASK_NOTES -->/g) || []).length === 1);
    }

    // ===== HC-TRIPS-SEED-* — applyTripsConformanceHeal =====
    // The seed carries a pre-refactor trip under spice/trips/summer-trip/:
    //   - Trip Atlas.md  (type: trip, name: "Summer Trip", no Breadcrumb, [[Trip Atlas]] link)
    //   - Trip Flights.md  (legacy created: + tags: [trip], no Breadcrumb, no canonical FM)
    //   - Trip Packing List.md  (same legacy shape as Flights)
    // The heal renames atlas → "Summer Trip.md", each section → "Summer Trip — <Section>.md",
    // canonicalizes section frontmatter (type: trip-section, section_kind, section, trip,
    // trip_slug, created_at), injects Breadcrumb blocks, and repairs [[Trip Atlas]] links.
    // Asserts run AFTER the idempotency phase (two installs) so idempotency is implicit
    // (if re-inject were broken, the backup/rename logic would write extra files
    // which would fail HC-V01100-SEED-IDEMP-2/3 above).
    {
        // HC-TRIPS-SEED-1: atlas renamed to "Summer Trip.md"; original "Trip Atlas.md" gone.
        ok(
            "HC-TRIPS-SEED-1 spice/trips/summer-trip/Summer Trip.md exists (atlas renamed)",
            helpers.fileExists(vault, "spice/trips/summer-trip/Summer Trip.md")
        );
        ok(
            "HC-TRIPS-SEED-1b spice/trips/summer-trip/Trip Atlas.md no longer exists",
            !helpers.fileExists(vault, "spice/trips/summer-trip/Trip Atlas.md")
        );

        // HC-TRIPS-SEED-2: Flights section renamed + canonical frontmatter.
        ok(
            "HC-TRIPS-SEED-2 spice/trips/summer-trip/Summer Trip — Flights.md exists (section renamed)",
            helpers.fileExists(vault, "spice/trips/summer-trip/Summer Trip — Flights.md")
        );
        let flightsFm = {};
        try {
            const flightsNote = helpers.readNote(vault, "spice/trips/summer-trip/Summer Trip — Flights.md");
            flightsFm = helpers.parseFrontmatter(flightsNote).frontmatter;
        } catch (e) {}
        ok(
            "HC-TRIPS-SEED-2b Flights section type: trip-section",
            flightsFm.type === "trip-section",
            `actual type=${flightsFm.type}`
        );
        ok(
            "HC-TRIPS-SEED-2c Flights section section_kind: flights",
            flightsFm.section_kind === "flights",
            `actual section_kind=${flightsFm.section_kind}`
        );
        ok(
            "HC-TRIPS-SEED-2d Flights section section: \"Flights\"",
            flightsFm.section === "Flights",
            `actual section=${flightsFm.section}`
        );
        ok(
            "HC-TRIPS-SEED-2e Flights section trip: \"[[Summer Trip]]\"",
            flightsFm.trip === "[[Summer Trip]]",
            `actual trip=${flightsFm.trip}`
        );
        ok(
            "HC-TRIPS-SEED-2f Flights section trip_slug: summer-trip",
            flightsFm.trip_slug === "summer-trip",
            `actual trip_slug=${flightsFm.trip_slug}`
        );
        ok(
            "HC-TRIPS-SEED-2g Flights section has created_at (not bare created:)",
            typeof flightsFm.created_at === "string" && flightsFm.created_at.length > 0,
            `actual created_at=${flightsFm.created_at}`
        );
        {
            let flightsRaw = "";
            try { flightsRaw = helpers.readNote(vault, "spice/trips/summer-trip/Summer Trip — Flights.md"); } catch (e) {}
            ok(
                "HC-TRIPS-SEED-2h Flights section has NO bare 'created:' FM key",
                !/^created\s*:/m.test(flightsRaw),
                `raw contains 'created:' line`
            );
        }

        // HC-TRIPS-SEED-3: Breadcrumb injected into the Flights section body.
        {
            let flightsBody = "";
            try { flightsBody = helpers.readNote(vault, "spice/trips/summer-trip/Summer Trip — Flights.md"); } catch (e) {}
            ok(
                "HC-TRIPS-SEED-3 Flights section body contains class: \"Breadcrumb\" (breadcrumb injected)",
                /class:\s*"Breadcrumb"/.test(flightsBody)
            );
        }

        // HC-TRIPS-SEED-4: [[Trip Atlas]] link repaired to [[Summer Trip]] in the atlas body.
        {
            let atlasBody = "";
            try { atlasBody = helpers.readNote(vault, "spice/trips/summer-trip/Summer Trip.md"); } catch (e) {}
            ok(
                "HC-TRIPS-SEED-4 atlas body [[Trip Atlas]] link repaired to [[Summer Trip]]",
                atlasBody.includes("[[Summer Trip]]") && !atlasBody.includes("[[Trip Atlas]]"),
                `body excerpt=${atlasBody.slice(0, 300)}`
            );
        }

        // HC-TRIPS-SEED-5: materialized hub contains Breadcrumb and no raw ## All Trips heading.
        {
            let hubBody = "";
            try { hubBody = helpers.readNote(vault, "spice/trips/Trips.md"); } catch (e) {}
            ok(
                "HC-TRIPS-SEED-5 Trips.md hub contains class: \"Breadcrumb\"",
                /class:\s*"Breadcrumb"/.test(hubBody),
                `hub Breadcrumb missing`
            );
            ok(
                "HC-TRIPS-SEED-5b Trips.md hub does NOT contain a raw ## All Trips heading",
                !/^##\s+All Trips\s*$/m.test(hubBody),
                `hub still has ## All Trips`
            );
        }
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

        const adapter = makeFsAdapter(migRoot);
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

        // ===== HC-V0119-MERGE — mergeDuplicateRecurringSections =====
        // Stamp a daily with TWO "Recurring Today" SectionLabel blocks; run the new
        // migration; assert merge + idempotency.
        {
            const { mergeDuplicateRecurringSections } = require("../install.js");

            const F_DUPE = `${DAY_DIR}/ToDo-2026-06-17.md`;
            const LABEL =
                '```dataviewjs\n' +
                'await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Recurring Today" }] });\n' +
                '```';
            const PROJECT_GROUPS =
                '```dataviewjs\n' +
                'await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyProjectGroups" });\n' +
                '```';
            const DUPE_BODY = [
                "---", "type: to-do", "---",
                "<!-- recurring-materialized-2026-06-17: -->",
                "",
                LABEL,
                "",
                "- [ ] get your life together [recurring_from:: [[Recurring Tasks]]]",
                "",
                LABEL,
                "",
                "- [ ] test recurring task [recurring_from:: [[Recurring Tasks]]]",
                "- [ ] Monitor this Dashboard [recurring_from:: [[Recurring Tasks]]]",
                "",
                PROJECT_GROUPS,
                "",
            ].join("\n");
            writeFixture(F_DUPE, DUPE_BODY);

            const historyMerge1 = [];
            await mergeDuplicateRecurringSections(tp, { name: "to-do" }, variables, historyMerge1, git);

            const merged = readVault(F_DUPE);
            const labelCount = (merged.match(/text:\s*"Recurring Today"/g) || []).length;
            ok(
                "HC-V0119-MERGE-1 dailies with duplicate sections merged to exactly one label",
                labelCount === 1,
                `got ${labelCount} labels; merged:\n${merged}`
            );
            ok(
                "HC-V0119-MERGE-2 all task lines preserved after merge",
                /get your life together/.test(merged) &&
                /test recurring task/.test(merged) &&
                /Monitor this Dashboard/.test(merged),
                `merged:\n${merged}`
            );
            ok(
                "HC-V0119-MERGE-3 ProjectGroups block preserved",
                /class: "ToDoDailyProjectGroups"/.test(merged)
            );
            ok(
                "HC-V0119-MERGE-4 history records merged >= 1",
                historyMerge1.length > 0 && historyMerge1[0].merged >= 1,
                `got history=${JSON.stringify(historyMerge1)}`
            );

            // Idempotency: second run does nothing.
            const beforeMerge2 = readVault(F_DUPE);
            const historyMerge2 = [];
            await mergeDuplicateRecurringSections(tp, { name: "to-do" }, variables, historyMerge2, git);
            const afterMerge2 = readVault(F_DUPE);
            ok(
                "HC-V0119-MERGE-5 second invocation merged=0 (idempotent)",
                historyMerge2.length > 0 && historyMerge2[0].merged === 0,
                `got history=${JSON.stringify(historyMerge2)}`
            );
            ok(
                "HC-V0119-MERGE-6 second invocation leaves file byte-identical",
                beforeMerge2 === afterMerge2
            );

            // Single-block daily: untouched.
            const F_SINGLE = `${DAY_DIR}/ToDo-2026-06-18.md`;
            const SINGLE_BODY = [
                "---", "type: to-do", "---",
                "<!-- recurring-materialized-2026-06-18: -->",
                "",
                LABEL,
                "",
                "- [ ] single recurring [recurring_from:: [[Recurring Tasks]]]",
                "",
                PROJECT_GROUPS,
                "",
            ].join("\n");
            writeFixture(F_SINGLE, SINGLE_BODY);
            const beforeSingle = readVault(F_SINGLE);
            const historySingle = [];
            await mergeDuplicateRecurringSections(tp, { name: "to-do" }, variables, historySingle, git);
            const afterSingle = readVault(F_SINGLE);
            ok(
                "HC-V0119-MERGE-7 single-block daily untouched",
                beforeSingle === afterSingle
            );
        }

        // ===== HC-V0120-STRIP — stripPersistedRecurringSection =====
        // v0.8.0 retires materialization; this migration strips the persisted
        // SectionLabel + recurring_from task-lines + sentinel from all dailies.
        {
            const { stripPersistedRecurringSection } = require("../install.js");
            const LABEL_OLD =
                '```dataviewjs\n' +
                'await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Recurring Today" }] });\n' +
                '```';
            const LABEL_NEW =
                '```dataviewjs\n' +
                'await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Recurring" }] });\n' +
                '```';
            const PROJECT_GROUPS =
                '```dataviewjs\n' +
                'await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyProjectGroups" });\n' +
                '```';

            // STRIP-1: daily with old "Recurring Today" label + sentinel → both gone.
            const F_OLD = `${DAY_DIR}/ToDo-2026-06-20.md`;
            writeFixture(F_OLD, [
                "---", "type: to-do", "---",
                "<!-- recurring-materialized-2026-06-20: a1b2c3d -->",
                "",
                LABEL_OLD,
                "",
                "- [ ] test recurring task [recurring_from:: [[Recurring Tasks]]]",
                "- [ ] Monitor this Dashboard [recurring_from:: [[Recurring Tasks]]]",
                "",
                PROJECT_GROUPS,
                "",
            ].join("\n"));
            const hist1 = [];
            await stripPersistedRecurringSection(tp, { name: "to-do" }, variables, hist1, git);
            const after1 = readVault(F_OLD);
            ok("HC-V0120-STRIP-1 sentinel removed",
               !/recurring-materialized-/.test(after1), `after:\n${after1}`);
            ok("HC-V0120-STRIP-2 'Recurring Today' SectionLabel block removed",
               !/text:\s*"Recurring Today"/.test(after1), `after:\n${after1}`);
            ok("HC-V0120-STRIP-3 materialized task lines removed",
               !/recurring_from::/.test(after1), `after:\n${after1}`);
            ok("HC-V0120-STRIP-4 ProjectGroups block preserved",
               /class: "ToDoDailyProjectGroups"/.test(after1));
            ok("HC-V0120-STRIP-5 history records stripped >= 1",
               hist1.length > 0 && hist1[0].stripped >= 1,
               `got history=${JSON.stringify(hist1)}`);

            // STRIP-6: new "Recurring" label also stripped.
            const F_NEW = `${DAY_DIR}/ToDo-2026-06-21.md`;
            writeFixture(F_NEW, [
                "---", "type: to-do", "---",
                LABEL_NEW,
                "- [ ] new label task [recurring_from:: [[Recurring Tasks]]]",
                "",
                PROJECT_GROUPS,
                "",
            ].join("\n"));
            const hist2 = [];
            await stripPersistedRecurringSection(tp, { name: "to-do" }, variables, hist2, git);
            const after2 = readVault(F_NEW);
            ok("HC-V0120-STRIP-6 'Recurring' (new label) SectionLabel block removed",
               !/text:\s*"Recurring"/.test(after2), `after:\n${after2}`);

            // STRIP-7: idempotent.
            const before3 = readVault(F_OLD);
            const hist3 = [];
            await stripPersistedRecurringSection(tp, { name: "to-do" }, variables, hist3, git);
            const after3 = readVault(F_OLD);
            ok("HC-V0120-STRIP-7 second invocation byte-identical (idempotent)",
               before3 === after3);

            // STRIP-8: daily with no recurring section is untouched.
            const F_CLEAN = `${DAY_DIR}/ToDo-2026-06-22.md`;
            const CLEAN_BODY = [
                "---", "type: to-do", "---",
                "",
                PROJECT_GROUPS,
                "",
            ].join("\n");
            writeFixture(F_CLEAN, CLEAN_BODY);
            const histClean = [];
            await stripPersistedRecurringSection(tp, { name: "to-do" }, variables, histClean, git);
            ok("HC-V0120-STRIP-8 daily without recurring section untouched",
               readVault(F_CLEAN) === CLEAN_BODY);
        }
    } finally {
        if (KEEP) {
            console.log(`  KEEP_SEED_VAULT=1: ${migRoot}`);
        } else {
            try { fs.rmSync(migRoot, { recursive: true, force: true }); } catch (e) {}
        }
    }
}

// =============================================================================
// HC-V01190-PROJ-SEED-MIGRATE-* — project blueprint installer migrations.
//
// Self-contained, independent of the seed-based families above. Like the
// HC-V01174-MIGRATE family, the seed install short-circuits on version match
// (subscription.project = installed.project = 1.22.2), so per-blueprint
// apply* functions never fire against seed fixtures. Instead we DIRECTLY
// INVOKE each exported migration against a throwaway tmp vault built from
// the same Legacy Project fixture committed under
// platform/test/seed-vault/spice/projects/Legacy Project/.
//
// Covers 5 untested project apply* functions plus idempotency:
//   #1 applyProjectSectionsMigration       (v0.102.0) — flat docs/*.md → docs/knowledge/, sections[]
//   #2 applyProjectSectionsHubMigration    (v0.103.0) — section hubs + Docs.md rewire + wikilink convert
//   #3 applyProjectSectionsCloseRepair     (v0.103.0.1) — repair -"[[--]]" → ---
//   #4 applyEmptyProjectWikilinkRepair     (v0.105.0.2) — [[]] → [[Legacy Project]]
//   #5 applyProjectTodoBackfill            (v0.116.0) — backfill <Name> To-Do.md
//
// Execution order: close-repair (#3) FIRST so Legacy Project.md's malformed
// frontmatter heals; then wikilink-repair (#4) on `[[]]`; then sections-
// migration (#1) sees a valid FM and can register sections[]; then sections-
// hub-migration (#2); then todo-backfill (#5). This departs from install.js's
// emit order (which runs sections-migration before close-repair) so each
// contract can be unit-tested independently against this single fixture.
// =============================================================================
async function runProjectMigrateFamily() {
    const {
        applyProjectSectionsMigration,
        applyProjectSectionsHubMigration,
        applyProjectSectionsCloseRepair,
        applyEmptyProjectWikilinkRepair,
        applyProjectTodoBackfill,
    } = require("../install.js");

    const projRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-proj-mig-"));
    try {
        const LEGACY_PROJ_DIR = "spice/projects/Legacy Project";
        const SEED_LEGACY = path.join(SEED_DIR, LEGACY_PROJ_DIR);

        // Copy the committed Legacy Project fixture into the throwaway vault so
        // the asserts test the same pre-migration shape that the seed-vault carries.
        helpers.copyDir(SEED_LEGACY, path.join(projRoot, LEGACY_PROJ_DIR));

        const adapter = makeFsAdapter(projRoot);
        const tp = { app: { vault: { adapter } } };
        const git = { commit: "test", tag: "test", dirty: false };
        const variables = { views_path: "ranch/views", vault_identity_tag: "seed-test-vault" };
        const manifest = { name: "project" };
        const history = [];

        // ----- First invocation pass: close-repair → wikilink-repair → sections-
        //       migration → sections-hub-migration → todo-backfill. The order
        //       fixes Legacy Project.md's malformed frontmatter before sections-
        //       migration walks it (so sections[] can be injected — install.js
        //       runs sections-migration first and would skip the sections[]
        //       inject on this fixture, a separate findable issue out of scope
        //       for impl-1).
        await applyProjectSectionsCloseRepair(tp, manifest, variables, history, git);
        await applyEmptyProjectWikilinkRepair(tp, history, git);
        await applyProjectSectionsMigration(tp, manifest, variables, history, git);
        await applyProjectSectionsHubMigration(tp, manifest, variables, history, git);
        await applyProjectTodoBackfill(tp, manifest, variables, history, git);

        // ----- A: applyProjectSectionsMigration -----
        const aOldNoteInKnowledge = fs.existsSync(path.join(projRoot, LEGACY_PROJ_DIR, "docs/knowledge/Old Note.md"));
        ok(
            "HC-V01190-PROJ-SEED-MIGRATE-A1 Old Note moved into docs/knowledge/",
            aOldNoteInKnowledge
        );
        const aOldNoteFlatGone = !fs.existsSync(path.join(projRoot, LEGACY_PROJ_DIR, "docs/Old Note.md"));
        ok(
            "HC-V01190-PROJ-SEED-MIGRATE-A2 flat docs/Old Note.md removed by sections migration",
            aOldNoteFlatGone
        );
        const aLegacyProjFm = helpers.parseFrontmatter(
            fs.readFileSync(path.join(projRoot, LEGACY_PROJ_DIR, "Legacy Project.md"), "utf8")
        ).frontmatter;
        const aSections = Array.isArray(aLegacyProjFm.sections) ? aLegacyProjFm.sections : [];
        const aSectionsHasAll = ["Knowledge", "Notes", "Custom Section"].every(want =>
            aSections.some(s => String(s).includes(want))
        );
        ok(
            "HC-V01190-PROJ-SEED-MIGRATE-A3 sections[] registered Knowledge + Notes + Custom Section",
            aSectionsHasAll,
            `got sections=${JSON.stringify(aSections)}`
        );

        // ----- B: applyProjectSectionsHubMigration -----
        const bKnowledgeHubExists = fs.existsSync(path.join(projRoot, LEGACY_PROJ_DIR, "docs/knowledge/Knowledge.md"));
        ok(
            "HC-V01190-PROJ-SEED-MIGRATE-B1 knowledge/Knowledge.md section-hub materialized",
            bKnowledgeHubExists
        );
        const bCustomHubExists = fs.existsSync(path.join(projRoot, LEGACY_PROJ_DIR, "docs/Custom Section/Custom Section.md"));
        ok(
            "HC-V01190-PROJ-SEED-MIGRATE-B2 Custom Section/Custom Section.md section-hub materialized",
            bCustomHubExists
        );
        const bDocsBody = fs.readFileSync(path.join(projRoot, LEGACY_PROJ_DIR, "docs/Docs.md"), "utf8");
        ok(
            "HC-V01190-PROJ-SEED-MIGRATE-B3 Docs.md body rewired to customJS.ProjectDocsIndex.render",
            bDocsBody.includes("ProjectDocsIndex")
        );
        const bCustomNoteFm = helpers.parseFrontmatter(
            fs.readFileSync(path.join(projRoot, LEGACY_PROJ_DIR, "docs/Custom Section/Custom Note.md"), "utf8")
        ).frontmatter;
        ok(
            "HC-V01190-PROJ-SEED-MIGRATE-B4 Custom Note section: string converted to wikilink",
            String(bCustomNoteFm.section || "").includes("[[") && String(bCustomNoteFm.section).includes("Custom Section")
        );

        // ----- C: applyProjectSectionsCloseRepair -----
        const cLegacyBody = fs.readFileSync(path.join(projRoot, LEGACY_PROJ_DIR, "Legacy Project.md"), "utf8");
        ok(
            "HC-V01190-PROJ-SEED-MIGRATE-C1 malformed frontmatter close repaired (no -\"[[--]]\")",
            !cLegacyBody.includes('-"[[--]]"')
        );

        // ----- D: applyEmptyProjectWikilinkRepair -----
        const dBadLinkFm = helpers.parseFrontmatter(
            fs.readFileSync(path.join(projRoot, LEGACY_PROJ_DIR, "docs/Custom Section/Bad Link Note.md"), "utf8")
        ).frontmatter;
        const dProj = String(dBadLinkFm.project || "");
        const dD1 = dProj.includes("Legacy Project") && dProj.startsWith("[[") && dProj.endsWith("]]");
        ok(
            "HC-V01190-PROJ-SEED-MIGRATE-D1 empty project wikilink rewritten to [[Legacy Project]]",
            dD1
        );

        // ----- E: applyProjectTodoBackfill -----
        const eTodoPath = path.join(projRoot, LEGACY_PROJ_DIR, "Legacy Project To-Do.md");
        const eTodoExists = fs.existsSync(eTodoPath);
        ok(
            "HC-V01190-PROJ-SEED-MIGRATE-E1 Legacy Project To-Do.md backfilled",
            eTodoExists
        );
        const eTodoBody = eTodoExists ? fs.readFileSync(eTodoPath, "utf8") : "";
        ok(
            "HC-V01190-PROJ-SEED-MIGRATE-E2 backfilled to-do body uses ToDoDailyProjectGroups",
            eTodoBody.includes("ToDoDailyProjectGroups")
        );

        // ----- G: history accumulators (audit-trail contract) -----
        // Project migrations write `event: "info"` records (one or more per
        // migration step). Audit-trail contract: at least one event per
        // migration (5 distinct `step` values) and no event surfaces an
        // errors[] payload (field absent OR field present but empty).
        const gSteps = new Set(history.map(h => h && h.step).filter(Boolean));
        const gNoErrors = history.every(h => !h.errors || (Array.isArray(h.errors) && h.errors.length === 0));
        ok(
            "HC-V01190-PROJ-SEED-MIGRATE-G1 history records >= 1 event per migration with empty errors[]",
            gSteps.size >= 5 && gNoErrors,
            `got steps=${JSON.stringify([...gSteps])} hasErrors=${!gNoErrors}`
        );

        // ----- F: idempotency on a SECOND full invocation pass -----
        // Snapshot key files BEFORE the second pass so we can compare byte-identity.
        const fLegacyBefore = fs.readFileSync(path.join(projRoot, LEGACY_PROJ_DIR, "Legacy Project.md"), "utf8");
        const fTodoBefore = fs.readFileSync(path.join(projRoot, LEGACY_PROJ_DIR, "Legacy Project To-Do.md"), "utf8");
        const fKnowledgeHubPath = path.join(projRoot, LEGACY_PROJ_DIR, "docs/knowledge/Knowledge.md");
        const fCustomHubPath = path.join(projRoot, LEGACY_PROJ_DIR, "docs/Custom Section/Custom Section.md");
        const fKnowledgeBefore = fs.existsSync(fKnowledgeHubPath) ? fs.readFileSync(fKnowledgeHubPath, "utf8") : "";
        const fCustomBefore = fs.existsSync(fCustomHubPath) ? fs.readFileSync(fCustomHubPath, "utf8") : "";

        const history2 = [];
        await applyProjectSectionsCloseRepair(tp, manifest, variables, history2, git);
        await applyEmptyProjectWikilinkRepair(tp, history2, git);
        await applyProjectSectionsMigration(tp, manifest, variables, history2, git);
        await applyProjectSectionsHubMigration(tp, manifest, variables, history2, git);
        await applyProjectTodoBackfill(tp, manifest, variables, history2, git);

        const fOldNoteStill = fs.existsSync(path.join(projRoot, LEGACY_PROJ_DIR, "docs/knowledge/Old Note.md"));
        ok(
            "HC-V01190-PROJ-SEED-MIGRATE-F1 second invocation: Old Note still in knowledge/ (no second move)",
            fOldNoteStill
        );
        const fKnowledgeAfter = fs.existsSync(fKnowledgeHubPath) ? fs.readFileSync(fKnowledgeHubPath, "utf8") : "";
        const fCustomAfter = fs.existsSync(fCustomHubPath) ? fs.readFileSync(fCustomHubPath, "utf8") : "";
        ok(
            "HC-V01190-PROJ-SEED-MIGRATE-F2 second invocation: section hubs byte-identical (hub-migration idempotent)",
            fKnowledgeBefore !== "" && fKnowledgeBefore === fKnowledgeAfter && fCustomBefore === fCustomAfter
        );
        const fLegacyAfter = fs.readFileSync(path.join(projRoot, LEGACY_PROJ_DIR, "Legacy Project.md"), "utf8");
        ok(
            "HC-V01190-PROJ-SEED-MIGRATE-F3 second invocation: Legacy Project.md byte-identical (close-repair idempotent)",
            fLegacyBefore === fLegacyAfter
        );
        const fTodoAfter = fs.readFileSync(path.join(projRoot, LEGACY_PROJ_DIR, "Legacy Project To-Do.md"), "utf8");
        ok(
            "HC-V01190-PROJ-SEED-MIGRATE-F4 second invocation: To-Do.md byte-identical (backfill skip-if-exists)",
            fTodoBefore === fTodoAfter
        );
    } finally {
        if (KEEP) {
            console.log(`  KEEP_SEED_VAULT=1: ${projRoot}`);
        } else {
            try { fs.rmSync(projRoot, { recursive: true, force: true }); } catch (e) {}
        }
    }
}

// =============================================================================
// HC-DOCSHUB-SEED-MIGRATE-DOCSHUB-* — docs-hub modernize heal.
//
// applyDocsHubModernizeHeal rewrites a LEGACY docs-hub body (standalone
// DocBulkMoveActions + doubled literal `---` + no Breadcrumb + no renderActionRow)
// to the modern chrome shape. Self-contained: copies the committed
// docshub-legacy fixture into a throwaway tmp vault and DIRECTLY INVOKES the heal
// (the seed install short-circuits on project version match, so per-blueprint
// apply* fns never fire against seed fixtures). Asserts post-heal shape,
// .sauce-backup, and byte-identical idempotency on a second pass.
//
// Fixture: spice/projects/docshub-legacy/docs/Docs.md
// =============================================================================
async function runDocsHubModernizeFamily() {
    const { applyDocsHubModernizeHeal } = require("../install.js");

    const dhRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-docshub-"));
    try {
        const DH_PROJ_DIR = "spice/projects/docshub-legacy";
        const SEED_DH = path.join(SEED_DIR, DH_PROJ_DIR);
        helpers.copyDir(SEED_DH, path.join(dhRoot, DH_PROJ_DIR));

        const DOCS = path.join(dhRoot, DH_PROJ_DIR, "docs/Docs.md");
        const before = fs.readFileSync(DOCS, "utf8");

        const adapter = makeFsAdapter(dhRoot);
        const tp = { app: { vault: { adapter } } };
        const git = { commit: "test", tag: "test", dirty: false };
        const variables = { views_path: "ranch/views", vault_identity_tag: "seed-test-vault" };
        const manifest = { name: "project" };
        const history = [];

        // Sanity: the committed fixture really is the legacy shape.
        ok("HC-DOCSHUB-SEED-MIGRATE-DOCSHUB-A0 fixture is legacy shape (DocBulkMoveActions + doubled ---)",
            before.includes('class: "DocBulkMoveActions"') && /-{3,}\s*\n\s*-{3,}/.test(before.replace(/^---[\s\S]*?\n---\n/, "")));

        await applyDocsHubModernizeHeal(tp, manifest, variables, history, git);
        const after = fs.readFileSync(DOCS, "utf8");

        ok("HC-DOCSHUB-SEED-MIGRATE-DOCSHUB-A1 standalone DocBulkMoveActions block removed",
            !after.includes('class: "DocBulkMoveActions"'));
        ok("HC-DOCSHUB-SEED-MIGRATE-DOCSHUB-A2 no doubled --- left in body",
            !/-{3,}\s*\n\s*-{3,}/.test(after.replace(/^---[\s\S]*?\n---\n/, "")));
        ok("HC-DOCSHUB-SEED-MIGRATE-DOCSHUB-A3 renderActionRow block present",
            /method:\s*"renderActionRow"/.test(after) && after.includes("entity-create:doc-note"));
        ok("HC-DOCSHUB-SEED-MIGRATE-DOCSHUB-A4 Breadcrumb present (before SpaceNavButtons)",
            /class:\s*"Breadcrumb"/.test(after) && after.indexOf("Breadcrumb") < after.indexOf("SpaceNavButtons"));
        ok("HC-DOCSHUB-SEED-MIGRATE-DOCSHUB-A5 plain ProjectDocsIndex block present",
            /\{\s*class:\s*"ProjectDocsIndex"\s*\}/.test(after));

        // .sauce-backup snapshot written before the write.
        const backupRoot = path.join(dhRoot, ".sauce-backup");
        const listBackups = (dir) => {
            const out = [];
            let entries = [];
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return out; }
            for (const e of entries) {
                const full = path.join(dir, e.name);
                if (e.isDirectory()) out.push(...listBackups(full));
                else out.push(full);
            }
            return out;
        };
        const backupExists = fs.existsSync(backupRoot)
            && listBackups(backupRoot).some((f) => f.replace(/\\/g, "/").endsWith("/docs/Docs.md"));
        ok("HC-DOCSHUB-SEED-MIGRATE-DOCSHUB-A6 .sauce-backup snapshot written", backupExists);
        ok("HC-DOCSHUB-SEED-MIGRATE-DOCSHUB-A7 modernized history event recorded",
            history.some((h) => h && h.step === "docs_hub_modernize_heal" && h.action === "modernized"));

        // Idempotency — second pass is a byte-identical no-op.
        const history2 = [];
        await applyDocsHubModernizeHeal(tp, manifest, variables, history2, git);
        const afterSecond = fs.readFileSync(DOCS, "utf8");
        ok("HC-DOCSHUB-SEED-MIGRATE-DOCSHUB-F1 second pass byte-identical (idempotent)", after === afterSecond);
        ok("HC-DOCSHUB-SEED-MIGRATE-DOCSHUB-F2 second pass records skipped, heals nothing",
            history2.some((h) => h && h.summary && h.summary.skipped >= 1 && h.summary.healed === 0));
    } finally {
        if (KEEP) {
            console.log(`  KEEP_SEED_VAULT=1: ${dhRoot}`);
        } else {
            try { fs.rmSync(dhRoot, { recursive: true, force: true }); } catch (e) {}
        }
    }
}

// ===== HC-DOCSEC-BACKFILL-* — PR1 project-doc-updating-wiring =====
//
// applyDocSectionBackfill (ungated, idempotent) backfills MISSING
// section/sub_section frontmatter on project doc-notes, sourcing the
// authoritative display name from the sibling section-hub in the same folder.
//
// Self-contained: copies the committed docsec-project fixture into a throwaway
// tmp vault and DIRECTLY INVOKES applyDocSectionBackfill (the seed install
// short-circuits on project version match, so per-blueprint apply* fns never
// fire against seed fixtures). Fixtures:
//   docs/knowledge/Knowledge.md          — section-hub (section: Knowledge)
//   docs/knowledge/Depth1 Note.md        — doc-note MISSING section (depth 1)
//   docs/knowledge/advanced/Advanced.md  — sub-section-hub (section: Advanced)
//   docs/knowledge/advanced/Depth2 Note.md — doc-note MISSING section (depth 2)
//   docs/notes/No Hub Note.md            — doc-note MISSING section, NO hub → skip
//   docs/knowledge/Already Sectioned.md  — doc-note WITH section → untouched
// =============================================================================
async function runDocSectionBackfillFamily() {
    const { applyDocSectionBackfill } = require("../install.js");

    const dsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-docsec-"));
    try {
        const DS_PROJ_DIR = "spice/projects/docsec-project";
        const SEED_DS = path.join(SEED_DIR, DS_PROJ_DIR);
        helpers.copyDir(SEED_DS, path.join(dsRoot, DS_PROJ_DIR));

        const adapter = makeFsAdapter(dsRoot);
        const tp = { app: { vault: { adapter } } };
        const git = { commit: "test", tag: "test", dirty: false };
        const variables = { views_path: "ranch/views", vault_identity_tag: "seed-test-vault" };
        const manifest = { name: "project" };
        const history = [];

        const relDepth1 = path.join(DS_PROJ_DIR, "docs/knowledge/Depth1 Note.md");
        const relDepth2 = path.join(DS_PROJ_DIR, "docs/knowledge/advanced/Depth2 Note.md");
        const relNoHub = path.join(DS_PROJ_DIR, "docs/notes/No Hub Note.md");
        const relAlready = path.join(DS_PROJ_DIR, "docs/knowledge/Already Sectioned.md");

        // Snapshot the already-sectioned + no-hub bodies BEFORE for untouched checks.
        const alreadyBefore = fs.readFileSync(path.join(dsRoot, relAlready), "utf8");
        const noHubBefore = fs.readFileSync(path.join(dsRoot, relNoHub), "utf8");

        // ----- First invocation -----
        await applyDocSectionBackfill(tp, manifest, variables, history, git);

        // A: depth-1 doc backfilled section from its sibling section-hub.
        const d1Fm = helpers.parseFrontmatter(fs.readFileSync(path.join(dsRoot, relDepth1), "utf8")).frontmatter;
        ok(
            "HC-DOCSEC-BACKFILL-A1 depth-1 doc backfilled section == hub display name (Knowledge)",
            String(d1Fm.section || "") === "Knowledge",
            `got section=${JSON.stringify(d1Fm.section)}`
        );
        ok(
            "HC-DOCSEC-BACKFILL-A2 depth-1 doc has no sub_section",
            d1Fm.sub_section === undefined || d1Fm.sub_section === ""
        );

        // B: depth-2 doc backfilled BOTH section (parent hub) + sub_section (own hub).
        const d2Fm = helpers.parseFrontmatter(fs.readFileSync(path.join(dsRoot, relDepth2), "utf8")).frontmatter;
        ok(
            "HC-DOCSEC-BACKFILL-B1 depth-2 doc backfilled section == parent hub (Knowledge)",
            String(d2Fm.section || "") === "Knowledge",
            `got section=${JSON.stringify(d2Fm.section)}`
        );
        ok(
            "HC-DOCSEC-BACKFILL-B2 depth-2 doc backfilled sub_section == own hub (Advanced)",
            String(d2Fm.sub_section || "") === "Advanced",
            `got sub_section=${JSON.stringify(d2Fm.sub_section)}`
        );

        // C: no-section-hub doc is SKIPPED (still missing section, byte-identical).
        const noHubAfter = fs.readFileSync(path.join(dsRoot, relNoHub), "utf8");
        const noHubFm = helpers.parseFrontmatter(noHubAfter).frontmatter;
        ok(
            "HC-DOCSEC-BACKFILL-C1 no-hub doc still missing section (skipped)",
            noHubFm.section === undefined
        );
        ok(
            "HC-DOCSEC-BACKFILL-C2 no-hub doc byte-identical (untouched)",
            noHubBefore === noHubAfter
        );

        // D: already-sectioned doc is untouched (byte-identical).
        const alreadyAfter = fs.readFileSync(path.join(dsRoot, relAlready), "utf8");
        ok(
            "HC-DOCSEC-BACKFILL-D1 already-sectioned doc byte-identical (untouched)",
            alreadyBefore === alreadyAfter
        );

        // E: history recorded a backfill step with empty errors[].
        const eSteps = new Set(history.map(h => h && h.step).filter(Boolean));
        const eNoErrors = history.every(h => !h.errors || (Array.isArray(h.errors) && h.errors.length === 0));
        ok(
            "HC-DOCSEC-BACKFILL-E1 history recorded doc_section_backfill step with empty errors[]",
            eSteps.has("doc_section_backfill") && eNoErrors
        );
        // E2: a REAL per-doc backfill event was logged (not just the always-present
        // summary entry) — action backfilled_section + target at a backfilled doc.
        ok(
            "HC-DOCSEC-BACKFILL-E2 history has a per-doc backfilled_section event for Depth1 Note",
            history.some(h => h && h.step === "doc_section_backfill" && h.action === "backfilled_section" && typeof h.target === "string" && /Depth1 Note\.md$/.test(h.target))
        );

        // F: idempotency — a SECOND invocation is a no-op on the backfilled docs.
        const fD1Before = fs.readFileSync(path.join(dsRoot, relDepth1), "utf8");
        const fD2Before = fs.readFileSync(path.join(dsRoot, relDepth2), "utf8");
        const history2 = [];
        await applyDocSectionBackfill(tp, manifest, variables, history2, git);
        const fD1After = fs.readFileSync(path.join(dsRoot, relDepth1), "utf8");
        const fD2After = fs.readFileSync(path.join(dsRoot, relDepth2), "utf8");
        ok(
            "HC-DOCSEC-BACKFILL-F1 second invocation: depth-1 doc byte-identical (idempotent)",
            fD1Before === fD1After
        );
        ok(
            "HC-DOCSEC-BACKFILL-F2 second invocation: depth-2 doc byte-identical (idempotent)",
            fD2Before === fD2After
        );
    } finally {
        if (KEEP) {
            console.log(`  KEEP_SEED_VAULT=1: ${dsRoot}`);
        } else {
            try { fs.rmSync(dsRoot, { recursive: true, force: true }); } catch (e) {}
        }
    }
}

// ===== HC-V01190-FIN-SEED-MIGRATE-* — finance blueprint installer migrations =====
//
// Direct-invocation pattern (mirrors HC-V01190-PROJ family). See impl-2 design doc.
// 19 finance apply* fns covered via the Legacy Finance fixture at
// platform/test/seed-vault/spice/finance-legacy/.
//
// Production install order (install.js applyFinanceMigrations): defaults-scaff ->
// debt-scaff -> months-scaff -> categories-group-backfill -> budget-group-seed ->
// budget-body -> budget-monthly-band -> paycheck-body -> paycheck-debt-band ->
// paycheck-defaults-debt-linking -> paycheck-defaults-debt-backfill -> nav-row ->
// nav-row-guard-form -> hub-frontmatter-heal -> invoice-workspace-nav-injection ->
// hubs-repair -> top-hub-nav-row-dedup -> defaults-nav-row-injection -> unified-nav
// (unified-nav runs AFTER hubs-repair in production via the platform sweep). The
// test invokes these in production order and asserts each contract. Idempotency
// tested by invoking twice.
//
// The finance-legacy fixture is staged at spice/finance-legacy/ in the seed but
// gets copied INTO the tmp vault at spice/finance/ (canonical install path).
async function runFinanceMigrateFamily() {
    const install = require("../install.js");

    const finRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-fin-mig-"));
    try {
        const SEED_LEGACY = path.join(SEED_DIR, "spice/finance-legacy");
        // Copy fixture into the tmp vault at the canonical spice/finance/ path.
        helpers.copyDir(SEED_LEGACY, path.join(finRoot, "spice/finance"));

        const LEGACY_FIN_DIR = "spice/finance";  // path inside the tmp vault
        const adapter = makeFsAdapter(finRoot);
        const tp = { app: { vault: { adapter } } };
        const git = { commit: "test", tag: "test", dirty: false };
        const variables = { views_path: "ranch/views", vault_identity_tag: "seed-test-vault" };
        const manifest = { name: "finance" };
        const history = [];

        // Pass 1: invoke each finance migration in production order.
        await install.applyFinanceDefaultsScaffolding(tp, manifest, variables, history, git);
        await install.applyFinanceDebtScaffolding(tp, manifest, variables, history, git);
        await install.applyFinanceMonthsScaffolding(tp, manifest, variables, history, git);
        await install.applyFinanceCategoriesGroupBackfill(tp, manifest, variables, history, git);
        await install.applyFinanceBudgetGroupSeed(tp, manifest, variables, history, git);
        await install.applyFinanceBudgetBodyMigration(tp, manifest, variables, history, git);
        await install.applyFinanceBudgetMonthlyBandInjection(tp, manifest, variables, history, git);
        await install.applyFinancePaycheckBodyMigration(tp, manifest, variables, history, git);
        await install.applyFinancePaycheckDebtBandInjection(tp, manifest, variables, history, git);
        await install.applyFinancePaycheckDefaultsDebtLinking(tp, manifest, variables, history, git);
        await install.applyFinancePaycheckDefaultsDebtBackfill(tp, manifest, variables, history, git);
        await install.applyFinanceNavRowMigration(tp, manifest, variables, history, git);
        await install.applyFinanceNavRowGuardFormMigration(tp, manifest, variables, history, git);
        await install.applyFinanceHubFrontmatterHeal(tp, manifest, variables, history, git);
        await install.applyFinanceInvoiceWorkspaceNavInjection(tp, manifest, variables, history, git);
        await install.applyFinanceHubsRepair(tp, manifest, variables, history, git);
        await install.applyFinanceTopHubNavRowDedup(tp, manifest, variables, history, git);
        // cockpit #3 — RETIREMENT replaces the old FinanceNavRow injection (which
        // ungated-re-injected the superseded second nav row on every install).
        await install.applyFinanceDefaultsNavRowRetirement(tp, manifest, variables, history, git);
        await install.applyFinanceMonthChecklistInjection(tp, manifest, variables, history, git);
        await install.applyFinanceEditScopeBannerInjection(tp, manifest, variables, history, git);
        // Unified-nav is the FinanceHubActions/FinanceNavRow -> FinanceNav vault-wide
        // sweep; runs LAST so it sees the canonical post-repair shapes.
        await install.applyFinanceUnifiedNavMigration(tp, manifest, variables, history, git);

        // Helpers for assert blocks below.
        const readFin = (rel) => fs.readFileSync(path.join(finRoot, LEGACY_FIN_DIR, rel), "utf8");
        const existsFin = (rel) => fs.existsSync(path.join(finRoot, LEGACY_FIN_DIR, rel));

        // ===== A: hub/defaults scaffolding (#14 + #15 + #19) =====
        const a1FinBody = readFin("Finance.md");
        const a1FinFm = helpers.parseFrontmatter(a1FinBody).frontmatter;
        const a1Tags = Array.isArray(a1FinFm.tags) ? a1FinFm.tags : [];
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-A1 Finance.md hub frontmatter healed (no 'finance-hub-hub' mangled tag)",
            !a1Tags.some(t => /finance-hub-hub/.test(String(t)))
                && a1Tags.some(t => String(t) === "finance-hub"),
            `got tags=${JSON.stringify(a1Tags)}`
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-A2 Finance.md body strips FinanceHubActions (top-hub dedup + hubs-repair + unified-nav)",
            !a1FinBody.includes("FinanceHubActions")
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-A3 Finance.md body has FinanceNav reference (hubs-repair canonical)",
            /class:\s*"FinanceNav"/.test(a1FinBody)
        );
        const a4BudgetsBody = readFin("budgets/Budgets.md");
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-A4 Budgets.md body has FinanceNav reference (hubs-repair)",
            /class:\s*"FinanceNav"/.test(a4BudgetsBody)
        );
        const a5DebtsBody = readFin("debts/Debts.md");
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-A5 Debts.md body has FinanceNav reference (hubs-repair)",
            /class:\s*"FinanceNav"/.test(a5DebtsBody)
        );
        const a6PaychecksBody = readFin("paychecks/Paychecks.md");
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-A6 Paychecks.md body has FinanceNav reference (hubs-repair)",
            /class:\s*"FinanceNav"/.test(a6PaychecksBody)
        );

        // ===== B: debt (#2 + #10 + #11) =====
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-B1 debts/Debt-Discover-it.md exists (auto-scaffolded by #2 from Debt Defaults)",
            existsFin("debts/Debt-Discover-it.md")
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-B2 debts/Debt-Apple-Card.md still exists (existing entity preserved by #2)",
            existsFin("debts/Debt-Apple-Card.md")
        );
        const bPaycheckDefaultsBody = readFin("Paycheck Defaults.md");
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-B3 Paycheck Defaults expenses block contains [[Debt-Apple-Card]] wikilink (post #10 linking)",
            /debt:\s*"\[\[Debt-Apple-Card\]\]"/.test(bPaycheckDefaultsBody)
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-B4 Paycheck Defaults original url line stripped (post #10 url removal)",
            !/^\s*url:\s*["']?https:\/\/example\.com\/applecard["']?\s*$/m.test(bPaycheckDefaultsBody)
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-B5 Paycheck Defaults frontmatter has __debt_links_migrated: v0.108.0 marker",
            /__debt_links_migrated:\s*v0\.108\.0/.test(bPaycheckDefaultsBody)
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-B6 Paycheck Defaults expenses contains Discover-it entry (post #11 phase-2 orphan append)",
            /debt:\s*"\[\[Debt-Discover-it\]\]"/.test(bPaycheckDefaultsBody)
        );
        const bDebtDefaultsBody = readFin("Debt Defaults.md");
        const bAppleCardEntries = (bDebtDefaultsBody.match(/^\s+-\s+name:\s*Apple Card\b/gm) || []).length;
        const bDiscoverItEntries = (bDebtDefaultsBody.match(/^\s+-\s+name:\s*Discover it\b/gm) || []).length;
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-B7 Debt Defaults debts[] unchanged (still exactly 1 Apple Card + 1 Discover it; #2 reads but never mutates)",
            bAppleCardEntries === 1 && bDiscoverItEntries === 1,
            `got apple=${bAppleCardEntries} discover=${bDiscoverItEntries}`
        );
        const bDiscoverItBody = readFin("debts/Debt-Discover-it.md");
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-B8 Debt-Discover-it.md has kind: credit-card (from Debt Defaults entry)",
            /^kind:\s*credit-card\s*$/m.test(bDiscoverItBody)
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-B9 Debt-Discover-it.md has planned_monthly_payment: 150 (from Debt Defaults entry)",
            /^planned_monthly_payment:\s*150\s*$/m.test(bDiscoverItBody)
        );

        // ===== C: budget (#4 + #5 + #6 + #7 + #12) =====
        const cBudget01Body = readFin("budgets/2026-01/Budget-2026-01.md");
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-C1 Budget-2026-01.md groups[] seeded from Budget Defaults (Essentials + Discretionary)",
            /^\s+-\s+Essentials\s*$/m.test(cBudget01Body)
                && /^\s+-\s+Discretionary\s*$/m.test(cBudget01Body)
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-C2 Budget-2026-01.md frontmatter has __group_seed_migrated: v0.108.0 marker",
            /__group_seed_migrated:\s*v0\.108\.0/.test(cBudget01Body)
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-C3 Budget-2026-01.md body has <!-- budget-summary- marker (post #6 inject)",
            /<!--\s*budget-summary-v[\d.]+\s*-->/.test(cBudget01Body)
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-C4 Budget-2026-01.md body has <!-- monthly-overview- marker (post #7 inject)",
            /<!--\s*monthly-overview-v[\d.]+\s*-->/.test(cBudget01Body)
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-C5 Budget-2026-01.md body no longer has '## Categories' heading (#6 strip)",
            !/^## Categories\s*$/m.test(cBudget01Body)
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-C6 Budget-2026-01.md categories[0].group reassigned from Unassigned (#5 name-match to Essentials)",
            /^\s+group:\s*Essentials\s*$/m.test(cBudget01Body)
                && !/^\s+group:\s*Unassigned\s*$/m.test(cBudget01Body)
        );
        const cBudget02Body = readFin("budgets/2026-02/Budget-2026-02.md");
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-C7 Budget-2026-02.md body no longer has customJS.BudgetNavButtons direct call (#12 rewrite)",
            !cBudget02Body.includes("customJS.BudgetNavButtons")
                && !cBudget02Body.includes('class: "BudgetNavButtons"')
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-C8 Budget-2026-02.md body has FinanceNav reference (#12 rewrite + #17 unification chain)",
            /class:\s*"FinanceNav"/.test(cBudget02Body)
        );

        // ===== D: paycheck (#8 + #9) =====
        const dPaycheckBody = readFin("paychecks/2026-01/Paycheck-2026-01-15.md");
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-D1 Paycheck-2026-01-15.md body has <!-- paycheck-summary- marker (post #8 inject)",
            /<!--\s*paycheck-summary-v[\d.]+\s*-->/.test(dPaycheckBody)
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-D2 Paycheck-2026-01-15.md body has <!-- paycheck-debt-band- marker (post #9 inject)",
            /<!--\s*paycheck-debt-band-v[\d.]+\s*-->/.test(dPaycheckBody)
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-D3 Paycheck-2026-01-15.md body no longer has '## Expenses' heading (#8 strip)",
            !/^## Expenses\s*$/m.test(dPaycheckBody)
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-D4 Paycheck-2026-01-15.md body still has title heading '# Paycheck 2026-01-15' (no over-stripping)",
            /^#\s+Paycheck 2026-01-15\s*$/m.test(dPaycheckBody)
        );

        // ===== E: months (#3) =====
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-E1 spice/finance/months/ directory exists post #3 (applyFinanceMonthsScaffolding)",
            fs.existsSync(path.join(finRoot, LEGACY_FIN_DIR, "months"))
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-E2 spice/finance/months/Months.md exists post #3 (hub scaffold)",
            existsFin("months/Months.md")
        );

        // ===== F: nav (#12 + #13 + #17 + #18 + #19) =====
        // Walk every .md under spice/finance/ to perform vault-wide assertions.
        function _walkMd(root) {
            const out = [];
            function recur(dir) {
                if (!fs.existsSync(dir)) return;
                for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
                    const abs = path.join(dir, ent.name);
                    if (ent.isDirectory()) recur(abs);
                    else if (ent.isFile() && ent.name.endsWith(".md")) out.push(abs);
                }
            }
            recur(root);
            return out;
        }
        const fAllMd = _walkMd(path.join(finRoot, LEGACY_FIN_DIR));
        const fAllBodies = fAllMd.map(p => fs.readFileSync(p, "utf8")).join("\n\n---FILE---\n\n");

        ok(
            "HC-V01190-FIN-SEED-MIGRATE-F1 Budget-2026-02.md no longer has 'BudgetNavButtons' anywhere (#12 + #13)",
            !cBudget02Body.includes("BudgetNavButtons")
        );
        const fInvoiceBody = readFin("invoices/2026-01/Invoice-2026-01.md");
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-F2 Invoice-2026-01.md no longer has 'InvoiceNavButtons' anywhere (#12 + #13 + #16)",
            !fInvoiceBody.includes("InvoiceNavButtons")
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-F3 no file under spice/finance/ contains 'FinanceHubActions' (#17 + #19)",
            !fAllBodies.includes("FinanceHubActions")
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-F4 no file under spice/finance/ contains 'class: \"FinanceNavRow\"' (#17 collapses all to FinanceNav)",
            !/class:\s*"FinanceNavRow"/.test(fAllBodies)
        );
        // cockpit #3 — the dead FinanceNavRow INJECTION is RETIRED. F4 already
        // asserts no FinanceNavRow survives vault-wide; F5-F7 now assert the
        // Defaults notes carry NO dead second nav row AND gained the edit-scope
        // banner block (injected after FinanceNav, or after frontmatter when the
        // legacy Defaults fixture has no nav block).
        const fBudgetDefaultsBody = readFin("Budget Defaults.md");
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-F5 Budget Defaults has NO dead FinanceNavRow (retired) + gained FinanceEditScopeBanner",
            !/class:\s*"FinanceNavRow"/.test(fBudgetDefaultsBody)
                && /class:\s*"FinanceEditScopeBanner"/.test(fBudgetDefaultsBody)
        );
        const fPaycheckDefaultsBody = readFin("Paycheck Defaults.md");
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-F6 Paycheck Defaults has NO dead FinanceNavRow (retired) + gained FinanceEditScopeBanner",
            !/class:\s*"FinanceNavRow"/.test(fPaycheckDefaultsBody)
                && /class:\s*"FinanceEditScopeBanner"/.test(fPaycheckDefaultsBody)
        );
        const fDebtDefaultsBody = readFin("Debt Defaults.md");
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-F7 Debt Defaults has NO dead FinanceNavRow (retired) + gained FinanceEditScopeBanner",
            !/class:\s*"FinanceNavRow"/.test(fDebtDefaultsBody)
                && /class:\s*"FinanceEditScopeBanner"/.test(fDebtDefaultsBody)
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-F8 Finance.md body has NO FinanceHubActions (#19 top-hub dedup + #17)",
            !a1FinBody.includes("FinanceHubActions")
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-F9 Finance.md body has FinanceNav reference (#15 + #17 canonical)",
            /class:\s*"FinanceNav"/.test(a1FinBody)
        );
        // F10: no file vault-wide contains any of the deleted NavButtons class
        // names in either form (customJS.<X>NavButtons.render OR class: "<X>NavButtons").
        const fNoDeletedClasses =
            !/customJS\.(Budget|Paycheck|Invoice)NavButtons/.test(fAllBodies)
            && !/class:\s*"(Budget|Paycheck|Invoice)NavButtons"/.test(fAllBodies);
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-F10 no file has any deleted NavButtons class (BudgetNavButtons/PaycheckNavButtons/InvoiceNavButtons) in direct OR guard form",
            fNoDeletedClasses
        );

        // ===== G: invoice + orchestration history (#16) =====
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-G1 Invoice-2026-01.md body has <!-- invoice-workspace-nav- marker (post #16 inject)",
            /<!--\s*invoice-workspace-nav-v[\d.]+\s*-->/.test(fInvoiceBody)
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-G2 Invoice-2026-01.md body has InvoiceWorkspaceNav class reference (#16 canonical)",
            /class:\s*"InvoiceWorkspaceNav"/.test(fInvoiceBody)
        );
        // G3: history accumulator records events from each invoked migration.
        const gSteps = new Set(history.map(h => h && h.step).filter(Boolean));
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-G3 history accumulated >= 15 distinct step values (audit-trail contract across 19 invocations)",
            gSteps.size >= 15,
            `got steps=${JSON.stringify([...gSteps])} (count=${gSteps.size})`
        );

        // ===== H: idempotency on a SECOND full invocation pass =====
        // Snapshot key files BEFORE the second pass, then run all 19 migrations
        // again, then compare byte-identity.
        const hBudget01Before = readFin("budgets/2026-01/Budget-2026-01.md");
        const hPaycheckBefore = readFin("paychecks/2026-01/Paycheck-2026-01-15.md");
        const hFinanceBefore = readFin("Finance.md");
        const hPaycheckDefaultsBefore = readFin("Paycheck Defaults.md");
        const hDebtDefaultsBefore = readFin("Debt Defaults.md");
        const hAppleCardBefore = readFin("debts/Debt-Apple-Card.md");

        const history2 = [];
        await install.applyFinanceDefaultsScaffolding(tp, manifest, variables, history2, git);
        await install.applyFinanceDebtScaffolding(tp, manifest, variables, history2, git);
        await install.applyFinanceMonthsScaffolding(tp, manifest, variables, history2, git);
        await install.applyFinanceCategoriesGroupBackfill(tp, manifest, variables, history2, git);
        await install.applyFinanceBudgetGroupSeed(tp, manifest, variables, history2, git);
        await install.applyFinanceBudgetBodyMigration(tp, manifest, variables, history2, git);
        await install.applyFinanceBudgetMonthlyBandInjection(tp, manifest, variables, history2, git);
        await install.applyFinancePaycheckBodyMigration(tp, manifest, variables, history2, git);
        await install.applyFinancePaycheckDebtBandInjection(tp, manifest, variables, history2, git);
        await install.applyFinancePaycheckDefaultsDebtLinking(tp, manifest, variables, history2, git);
        await install.applyFinancePaycheckDefaultsDebtBackfill(tp, manifest, variables, history2, git);
        await install.applyFinanceNavRowMigration(tp, manifest, variables, history2, git);
        await install.applyFinanceNavRowGuardFormMigration(tp, manifest, variables, history2, git);
        await install.applyFinanceHubFrontmatterHeal(tp, manifest, variables, history2, git);
        await install.applyFinanceInvoiceWorkspaceNavInjection(tp, manifest, variables, history2, git);
        await install.applyFinanceHubsRepair(tp, manifest, variables, history2, git);
        await install.applyFinanceTopHubNavRowDedup(tp, manifest, variables, history2, git);
        await install.applyFinanceDefaultsNavRowRetirement(tp, manifest, variables, history2, git);
        await install.applyFinanceMonthChecklistInjection(tp, manifest, variables, history2, git);
        await install.applyFinanceEditScopeBannerInjection(tp, manifest, variables, history2, git);
        await install.applyFinanceUnifiedNavMigration(tp, manifest, variables, history2, git);

        ok(
            "HC-V01190-FIN-SEED-MIGRATE-H1 second invocation: Budget-2026-01.md byte-identical (group-seed + body + monthly-band idempotent)",
            hBudget01Before === readFin("budgets/2026-01/Budget-2026-01.md")
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-H2 second invocation: Paycheck-2026-01-15.md byte-identical (paycheck body + debt-band idempotent)",
            hPaycheckBefore === readFin("paychecks/2026-01/Paycheck-2026-01-15.md")
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-H3 second invocation: Finance.md byte-identical (hub-heal + hubs-repair + dedup + unified-nav idempotent)",
            hFinanceBefore === readFin("Finance.md")
        );
        // H4 deviation: Paycheck Defaults is NOT byte-identical on pass 2.
        // applyFinancePaycheckDefaultsDebtLinking short-circuits via the
        // __debt_links_migrated marker. But applyFinancePaycheckDefaultsDebt
        // Backfill phase-1 RE-runs on the mangled-by-pass-1 state: the orphan-
        // append from phase-2 split the Apple Card item's debt: continuation
        // off, leaving the bare "  - item: Apple Card payment" line looking
        // again like a debt-less item. Phase-1 re-injects debt:. This is real
        // production behavior — we test the weaker invariant: the marker is
        // present exactly once (linking idempotent) and no NEW Discover-it
        // orphan rows are appended (phase-2 idempotent — its check uses
        // _pcdReferencedDebtSlugs which scans the WHOLE block, including the
        // misplaced debt: line, so Discover-it is correctly flagged as already
        // referenced).
        const hPaycheckDefaultsAfter = readFin("Paycheck Defaults.md");
        const hMarkerCount = (hPaycheckDefaultsAfter.match(/__debt_links_migrated:\s*v0\.108\.0/g) || []).length;
        const hDiscoverItRefCount = (hPaycheckDefaultsAfter.match(/debt:\s*"\[\[Debt-Discover-it\]\]"/g) || []).length;
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-H4 second invocation: Paycheck Defaults linking marker stays exactly 1x (idempotent) + phase-2 didn't re-append Discover-it",
            hMarkerCount === 1 && hDiscoverItRefCount === 1,
            `markers=${hMarkerCount} discover-refs=${hDiscoverItRefCount}`
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-H5 second invocation: Debt Defaults.md byte-identical (no scaffolding mutation; nav inject idempotent)",
            hDebtDefaultsBefore === readFin("Debt Defaults.md")
        );
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-H6 second invocation: Debt-Apple-Card.md byte-identical (#2 skip-if-exists; #17 already canonical)",
            hAppleCardBefore === readFin("debts/Debt-Apple-Card.md")
        );

        // ===== I: history audit-trail contract =====
        const iNoErrors = history.every(h => !h.errors || (Array.isArray(h.errors) && h.errors.length === 0));
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-I1 every pass-1 history event has empty errors[] (audit-trail contract)",
            iNoErrors
        );
        const iWarnings = history.filter(h => h && h.event === "warning");
        ok(
            "HC-V01190-FIN-SEED-MIGRATE-I2 zero warning events in pass-1 history (all 19 migrations succeeded loud)",
            iWarnings.length === 0,
            `got ${iWarnings.length} warnings — first: ${iWarnings[0] ? JSON.stringify(iWarnings[0]).slice(0, 200) : "(none)"}`
        );
    } finally {
        if (KEEP) {
            console.log(`  KEEP_SEED_VAULT=1: ${finRoot}`);
        } else {
            try { fs.rmSync(finRoot, { recursive: true, force: true }); } catch (e) {}
        }
    }
}

// ===== HC-V01190-EC-SEED-MIGRATE-* — entity-create mechanism installer migrations =====
//
// Direct-invocation pattern (mirrors HC-V01190-PROJ + HC-V01190-FIN). See impl-3 design.
// 2 entity-create apply* fns covered via the Legacy EntityCreate fixture at
// platform/test/seed-vault/spice/entity-create-legacy/.
async function runEntityCreateMigrateFamily() {
    const install = require("../install.js");

    // applyNewEntityButtons + injectAccentButtonBlock construct `new Notice(...)`
    // on validation warnings (e.g., missing inside-block sentinel). The headless
    // harness has no Obsidian Notice global; shim it. Matches run-install.js's
    // approach. Restored on exit.
    const prevNotice = global.Notice;
    global.Notice = global.Notice || class Notice { constructor(_msg) { /* suppress */ } };

    const ecRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-ec-migrate-"));
    try {
        const LEGACY_EC_DIR = "spice/entity-create-legacy";
        const SEED_LEGACY = path.join(SEED_DIR, LEGACY_EC_DIR);

        // Copy fixture into the tmp vault at the same path — the guard migration
        // walks spice/ recursively so it'll find them. Also pre-create ranch/
        // so the registry write has a stable parent.
        helpers.copyDir(SEED_LEGACY, path.join(ecRoot, LEGACY_EC_DIR));
        fs.mkdirSync(path.join(ecRoot, "ranch"), { recursive: true });

        const adapter = makeFsAdapter(ecRoot);
        const tp = { app: { vault: { adapter } } };
        const git = { commit: "test", tag: "test", dirty: false };
        const variables = { views_path: "ranch/views", vault_identity_tag: "seed-test-vault" };
        const history = [];

        // Synthetic manifest for applyNewEntityButtons. Shape matches
        // resolveEntityCreateEntry's required-key checks: id (regex), label,
        // prompts: [] (array), destination.{folder_prefix, filename_prefix}
        // (strings), frontmatter_template: {} (object). render_in.kind === "hub"
        // with target_path drives injectAccentButtonBlock's verify-only path —
        // since the Legacy Hub fixture has NO sentinel comment inside its
        // dataviewjs fence, that produces a "missing_skip_inject" warning event
        // (not an error). Registry write still happens.
        const manifest = {
            name: "legacy-fixture-blueprint",
            version: "0.1.0",
            new_entity_buttons: [
                {
                    id: "legacy-doc",
                    label: "New Legacy Doc",
                    prompts: [],
                    destination: {
                        folder_prefix: "spice/entity-create-legacy/docs",
                        filename_prefix: "Legacy-Doc-",
                    },
                    frontmatter_template: { type: "legacy-doc", title: "{{title}}" },
                    render_in: { kind: "hub", target_path: "spice/entity-create-legacy/Legacy Hub.md" },
                },
                {
                    id: "legacy-detail-create",
                    label: "New Legacy Detail",
                    prompts: [],
                    destination: {
                        folder_prefix: "spice/entity-create-legacy/details",
                        filename_prefix: "Legacy-Detail-",
                    },
                    frontmatter_template: { type: "legacy-detail", title: "{{title}}" },
                },
            ],
        };

        // Snapshot Already Guarded.md BEFORE pass 1 (for B5 byte-identity check —
        // the guard migration should leave already-guarded files alone).
        const alreadyGuardedBefore = fs.readFileSync(
            path.join(ecRoot, LEGACY_EC_DIR, "Already Guarded.md"), "utf8");

        // Pass 1: invoke both migrations.
        await install.applyNewEntityButtons(tp, manifest, variables, history, git);
        await install.applyEntityCreateGuardMigration(tp, manifest, variables, history, git);

        // ===== A: applyNewEntityButtons =====
        // The migration writes ranch/entity-create-registry.json with a
        // contribution keyed by the manifest name. The hub-kind entry triggers
        // injectAccentButtonBlock which (since v0.49.0) is VERIFY-ONLY: it
        // doesn't edit the hub file, but pushes a history event recording
        // either "verified_present" (sentinel found) or "missing_skip_inject"
        // (sentinel absent). The Legacy Hub fixture has no sentinel comment,
        // so we expect the "missing_skip_inject" path.
        const aRegistryPath = path.join(ecRoot, "ranch/entity-create-registry.json");
        ok(
            "HC-V01190-EC-SEED-MIGRATE-A1 entity-create-registry.json materialized",
            fs.existsSync(aRegistryPath)
        );
        const aRegistry = JSON.parse(fs.readFileSync(aRegistryPath, "utf8"));
        ok(
            "HC-V01190-EC-SEED-MIGRATE-A2 registry has schema_version: 1",
            aRegistry.schema_version === 1
        );
        ok(
            "HC-V01190-EC-SEED-MIGRATE-A3 contributions keyed under synthetic manifest name",
            aRegistry.contributions && Array.isArray(aRegistry.contributions["legacy-fixture-blueprint"])
        );
        ok(
            "HC-V01190-EC-SEED-MIGRATE-A4 contribution has exactly 2 entries (one per new_entity_buttons[])",
            (aRegistry.contributions["legacy-fixture-blueprint"] || []).length === 2
        );
        // A5: hub-kind entry produces an injectAccentButtonBlock history event
        // recording the verify-only outcome on Legacy Hub.md. Since v0.49.0 the
        // installer does NOT edit the hub file; the only observable side-effect
        // is this history row. We assert the row exists with the expected
        // target_path + instance.
        const a5HubVerifyEvent = history.find(h =>
            h
            && (h.step === "entity_create_block_verified" || h.step === "entity_create_block_missing")
            && h.target === "spice/entity-create-legacy/Legacy Hub.md"
            && h.instance === "legacy-doc"
        );
        ok(
            "HC-V01190-EC-SEED-MIGRATE-A5 history records injectAccentButtonBlock verify event for Legacy Hub.md (hub-kind entry processed)",
            !!a5HubVerifyEvent,
            a5HubVerifyEvent ? `event=${a5HubVerifyEvent.event} action=${a5HubVerifyEvent.action}` : "no verify event found"
        );

        // ===== B: applyEntityCreateGuardMigration =====
        // Vault-wide .md walk under spice/ rewriting direct-call
        // customJS.EntityCreate.render(dv,...) → dv.view("ranch/views/customjs-guard", ...).
        // Idempotent against already-guarded files (regex requires direct-call
        // shape).
        const bHubBody = fs.readFileSync(path.join(ecRoot, LEGACY_EC_DIR, "Legacy Hub.md"), "utf8");
        ok(
            "HC-V01190-EC-SEED-MIGRATE-B1 Legacy Hub.md no longer has direct customJS.EntityCreate.render call",
            !/customJS\.EntityCreate\.render\s*\(/.test(bHubBody)
        );
        ok(
            "HC-V01190-EC-SEED-MIGRATE-B2 Legacy Hub.md has guard form dv.view ranch/views/customjs-guard",
            bHubBody.includes('dv.view("ranch/views/customjs-guard"')
        );
        const bDetailBody = fs.readFileSync(path.join(ecRoot, LEGACY_EC_DIR, "Legacy Detail.md"), "utf8");
        ok(
            "HC-V01190-EC-SEED-MIGRATE-B3 Legacy Detail.md no longer has direct call (vault-walk reached it)",
            !/customJS\.EntityCreate\.render\s*\(/.test(bDetailBody)
        );
        ok(
            "HC-V01190-EC-SEED-MIGRATE-B4 Legacy Detail.md has guard form",
            bDetailBody.includes('dv.view("ranch/views/customjs-guard"')
        );
        const bAlreadyGuardedAfter = fs.readFileSync(path.join(ecRoot, LEGACY_EC_DIR, "Already Guarded.md"), "utf8");
        ok(
            "HC-V01190-EC-SEED-MIGRATE-B5 Already Guarded.md byte-identical to fixture (idempotent on already-guarded)",
            bAlreadyGuardedAfter === alreadyGuardedBefore
        );

        // ===== D: history audit-trail =====
        // Each migration pushes >= 1 event into history. Pass 1 alone emits
        // the injectAccentButtonBlock verify event (warning, missing_skip_inject)
        // + per-file rewrite events from the guard migration + a summary event.
        // None of the events use the errors[]-array shape (which other migrations
        // populate); we still assert it stays empty as a forward-compat contract.
        ok(
            "HC-V01190-EC-SEED-MIGRATE-D1 history records >= 2 events (one per migration)",
            history.length >= 2
        );
        const dHasErrors = history.some(h => Array.isArray(h.errors) && h.errors.length > 0);
        ok(
            "HC-V01190-EC-SEED-MIGRATE-D2 no event has populated errors[]",
            !dHasErrors
        );

        // Snapshot for idempotency (C family) — AFTER pass 1, BEFORE pass 2.
        const ecHubAfterPass1 = fs.readFileSync(
            path.join(ecRoot, LEGACY_EC_DIR, "Legacy Hub.md"), "utf8");
        const ecRegistryAfterPass1 = JSON.parse(fs.readFileSync(
            path.join(ecRoot, "ranch/entity-create-registry.json"), "utf8"));
        const historyLenAfterPass1 = history.length;

        // Pass 2: invoke again for idempotency.
        await install.applyNewEntityButtons(tp, manifest, variables, history, git);
        await install.applyEntityCreateGuardMigration(tp, manifest, variables, history, git);

        // ===== C: idempotency on second invocation =====
        // Pass 2 should NOT re-rewrite Legacy Hub.md (regex requires direct-call
        // shape; pass 1 already converted it to guard form). Registry contribution
        // count should match (overwrite-with-same-array is the v0.46.0 S2 design).
        // New history events from pass 2 should record no errors.
        const cHubAfterPass2 = fs.readFileSync(path.join(ecRoot, LEGACY_EC_DIR, "Legacy Hub.md"), "utf8");
        ok(
            "HC-V01190-EC-SEED-MIGRATE-C1 second invocation: Legacy Hub.md byte-identical pass 1 vs pass 2",
            ecHubAfterPass1 === cHubAfterPass2
        );
        const cRegistryAfterPass2 = JSON.parse(fs.readFileSync(path.join(ecRoot, "ranch/entity-create-registry.json"), "utf8"));
        const cContribPass1Len = (ecRegistryAfterPass1.contributions["legacy-fixture-blueprint"] || []).length;
        const cContribPass2Len = (cRegistryAfterPass2.contributions["legacy-fixture-blueprint"] || []).length;
        ok(
            "HC-V01190-EC-SEED-MIGRATE-C2 second invocation: contribution count unchanged (no duplicates)",
            cContribPass1Len === cContribPass2Len
        );
        // history grew on pass 2 (verify event + guard summary), but the new
        // events should not have populated errors[].
        const cNewEvents = history.slice(historyLenAfterPass1);
        const cNewHasErrors = cNewEvents.some(h => Array.isArray(h.errors) && h.errors.length > 0);
        ok(
            "HC-V01190-EC-SEED-MIGRATE-C3 second invocation: no new history event has errors[]",
            !cNewHasErrors
        );
    } finally {
        if (KEEP) {
            console.log(`  KEEP_SEED_VAULT=1: ${ecRoot}`);
        } else {
            try { fs.rmSync(ecRoot, { recursive: true, force: true }); } catch (e) {}
        }
        global.Notice = prevNotice;
    }
}

// ===== HC-V01241-SEED-SECHUB-* — section-hub redundant entity-create cleanup =====
//
// v0.124.1 Task B2. The committed Reference.md fixture under
// Legacy Project/docs/reference/ carries the two standalone "+ New Section" /
// "+ New Sub-Section" entity-create blocks (pre-v0.124.1 deployed shape) plus
// the SectionHub view block, breadcrumb chrome, and hand-written user content.
// applySectionHubEntityCreateCleanup must strip ONLY the two marker blocks,
// preserving the SectionHub view + breadcrumb + user prose, and be idempotent.
async function runSectionHubCleanupFamily() {
    const { applySectionHubEntityCreateCleanup } = require("../install.js");

    const shRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-sechub-mig-"));
    try {
        const LEGACY_PROJ_DIR = "spice/projects/Legacy Project";
        const REF_REL = `${LEGACY_PROJ_DIR}/docs/reference/Reference.md`;
        const SEED_REF = path.join(SEED_DIR, REF_REL);

        // Copy just the fixture note into the throwaway vault.
        const destRef = path.join(shRoot, REF_REL);
        fs.mkdirSync(path.dirname(destRef), { recursive: true });
        fs.copyFileSync(SEED_REF, destRef);

        const adapter = makeFsAdapter(shRoot);
        const tp = { app: { vault: { adapter } } };
        const git = { commit: "test", tag: "test", dirty: false };
        const variables = { views_path: "ranch/views", vault_identity_tag: "seed-test-vault" };
        const manifest = { name: "project" };
        const history = [];

        // Sanity: the fixture starts WITH both standalone markers.
        const preBody = fs.readFileSync(destRef, "utf8");
        ok(
            "HC-V01241-SEED-SECHUB-0a fixture starts with // entity-create:section-hub marker",
            preBody.includes("// entity-create:section-hub")
        );
        ok(
            "HC-V01241-SEED-SECHUB-0b fixture starts with // entity-create:sub-section-hub marker",
            preBody.includes("// entity-create:sub-section-hub")
        );

        // ----- Pass 1: heal -----
        await applySectionHubEntityCreateCleanup(tp, manifest, variables, history, git);

        const afterBody = fs.readFileSync(destRef, "utf8");
        ok(
            "HC-V01241-SEED-SECHUB-1 section-hub standalone block removed (no // entity-create:section-hub)",
            !afterBody.includes("// entity-create:section-hub")
        );
        ok(
            "HC-V01241-SEED-SECHUB-2 sub-section-hub standalone block removed (no // entity-create:sub-section-hub)",
            !afterBody.includes("// entity-create:sub-section-hub")
        );
        ok(
            "HC-V01241-SEED-SECHUB-3 SectionHub view block preserved",
            /class:\s*["']SectionHub["']/.test(afterBody)
        );
        ok(
            "HC-V01241-SEED-SECHUB-4 Breadcrumb chrome preserved",
            /class:\s*["']Breadcrumb["']/.test(afterBody)
        );
        ok(
            "HC-V01241-SEED-SECHUB-5 hand-written user content preserved",
            afterBody.includes("Some hand-written user notes that must survive the heal.")
        );
        ok(
            "HC-V01241-SEED-SECHUB-6 EntityCreate standalone invocations gone from body",
            !/instance:\s*["']section-hub["']/.test(afterBody)
                && !/instance:\s*["']sub-section-hub["']/.test(afterBody)
        );
        ok(
            "HC-V01241-SEED-SECHUB-7 .sauce-backup snapshot of the original written",
            (() => {
                const root = path.join(shRoot, ".sauce-backup");
                if (!fs.existsSync(root)) return false;
                // Walk for a backed-up copy carrying the original markers.
                const stack = [root];
                while (stack.length) {
                    const cur = stack.pop();
                    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
                        const child = path.join(cur, ent.name);
                        if (ent.isDirectory()) stack.push(child);
                        else if (ent.name === "Reference.md"
                            && fs.readFileSync(child, "utf8").includes("// entity-create:section-hub")) {
                            return true;
                        }
                    }
                }
                return false;
            })()
        );

        // ----- Pass 2: idempotency -----
        const beforeSecond = fs.readFileSync(destRef, "utf8");
        const history2 = [];
        await applySectionHubEntityCreateCleanup(tp, manifest, variables, history2, git);
        const afterSecond = fs.readFileSync(destRef, "utf8");
        ok(
            "HC-V01241-SEED-SECHUB-8 second invocation byte-identical (idempotent, no re-write)",
            beforeSecond === afterSecond
        );
        ok(
            "HC-V01241-SEED-SECHUB-9 second pass logs the file as untouched (no second blocks_stripped)",
            !history2.some(h => h && h.action === "blocks_stripped")
        );
    } finally {
        if (KEEP) {
            console.log(`  KEEP_SEED_VAULT=1: ${shRoot}`);
        } else {
            try { fs.rmSync(shRoot, { recursive: true, force: true }); } catch (e) {}
        }
    }
}

// ===== HC-V0151-MONTHS-SENTINEL-HEAL-* — applyFinanceMonthsEntityCreateSentinel =====
//
// Direct-invocation isolation of the heal. The committed seed
// spice/finance/months/Months.md is in the MALFORMED pre-heal shape (the
// `// entity-create:month` marker TRAILS the FinanceNav dv.view call — which
// comments out Dataview's injected closing brace and throws
// "Evaluation Error: eval@[native code]" on render). The full-install family
// above re-materializes this hub from content/Months.md (dest is not
// materialize_once), so it cannot isolate the heal. Here we copy the malformed
// seed fixture into a scratch vault and run ONLY the heal, proving it converts
// a trailing marker to a leading one — the path that repairs existing consumer
// hubs — and that it is idempotent.
async function runMonthsSentinelHealFamily() {
    const install = require("../install.js");
    const MARKER = "// entity-create:month";
    const HUB = "spice/finance/months/Months.md";

    const healRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-months-sentinel-"));
    try {
        const seedMalformed = fs.readFileSync(path.join(SEED_DIR, HUB), "utf8");
        // Sanity: the committed seed fixture really starts from the bug shape
        // (trailing marker after the FinanceNav call).
        const sNavIdx = seedMalformed.indexOf('class: "FinanceNav"');
        const sAfterNav = sNavIdx !== -1
            ? seedMalformed.slice(seedMalformed.indexOf("\n", sNavIdx) + 1) : "";
        ok(
            "HC-V0151-MONTHS-SENTINEL-HEAL-1 seed fixture starts MALFORMED (marker trails the FinanceNav call)",
            sNavIdx !== -1 && sAfterNav.includes(MARKER),
            `navIdx=${sNavIdx} trailingMarker=${sAfterNav.includes(MARKER)}`
        );

        const adapter = makeFsAdapter(healRoot);
        await adapter.write(HUB, seedMalformed);
        const tp = { app: { vault: { adapter } } };
        const git = { commit: "test", tag: "test", dirty: false };
        const variables = { views_path: "ranch/views", vault_identity_tag: "seed-test-vault" };
        const manifest = { name: "finance" };
        const history = [];

        // Pass 1: run ONLY the heal.
        await install.applyFinanceMonthsEntityCreateSentinel(tp, manifest, variables, history, git);
        const healed = await adapter.read(HUB);
        const navIdx = healed.indexOf('class: "FinanceNav"');
        const markerIdx = healed.indexOf(MARKER);
        const afterNav = navIdx !== -1
            ? healed.slice(healed.indexOf("\n", navIdx) + 1) : "";
        ok(
            "HC-V0151-MONTHS-SENTINEL-HEAL-2 heal moves the marker to LEAD the FinanceNav call (and none trails)",
            markerIdx !== -1 && navIdx !== -1 && markerIdx < navIdx && !afterNav.includes(MARKER),
            `markerIdx=${markerIdx} navIdx=${navIdx} trailing=${afterNav.includes(MARKER)}`
        );
        const markerCount = (healed.match(/^[ \t]*\/\/[ \t]*entity-create:month\b/gm) || []).length;
        ok(
            "HC-V0151-MONTHS-SENTINEL-HEAL-3 heal leaves exactly one entity-create:month marker line (no dup)",
            markerCount === 1,
            `count=${markerCount}`
        );
        // The healed marker line byte-matches the working content/Budgets.md format.
        ok(
            "HC-V0151-MONTHS-SENTINEL-HEAL-4 healed marker byte-matches the canonical format",
            healed.includes("// entity-create:month — installer-managed; do not delete this comment")
        );
        // .sauce-backup snapshot of the malformed original was written.
        ok(
            "HC-V0151-MONTHS-SENTINEL-HEAL-5 .sauce-backup snapshot of the malformed original written",
            (() => {
                const root = path.join(healRoot, ".sauce-backup");
                if (!fs.existsSync(root)) return false;
                const stack = [root];
                while (stack.length) {
                    const cur = stack.pop();
                    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
                        const child = path.join(cur, ent.name);
                        if (ent.isDirectory()) stack.push(child);
                        else if (ent.name === "Months.md") {
                            const backed = fs.readFileSync(child, "utf8");
                            const bNav = backed.indexOf('class: "FinanceNav"');
                            const bAfter = bNav !== -1 ? backed.slice(backed.indexOf("\n", bNav) + 1) : "";
                            if (bAfter.includes(MARKER)) return true; // trailing marker preserved in snapshot
                        }
                    }
                }
                return false;
            })()
        );

        // Pass 2: idempotency — already-canonical file is a no-op (byte-identical, no re-write).
        await install.applyFinanceMonthsEntityCreateSentinel(tp, manifest, variables, history, git);
        const healedTwice = await adapter.read(HUB);
        ok(
            "HC-V0151-MONTHS-SENTINEL-HEAL-6 heal is idempotent (second pass byte-identical)",
            healedTwice === healed
        );
    } finally {
        if (KEEP) {
            console.log(`  KEEP_SEED_VAULT=1: ${healRoot}`);
        } else {
            try { fs.rmSync(healRoot, { recursive: true, force: true }); } catch (e) {}
        }
    }
}

// =============================================================================
// HC-TE-SURF-* — task-entity meeting/project migrations + old-chrome upgrade.
//
// Direct-invocation family (mirrors runMigrateFamily): builds a throwaway tmp
// vault with (1) a meeting note carrying an OPEN Action Items line, (2) a
// project-todo note carrying an OPEN Owned Tasks line, and (3) a v0.178-CHROME
// task-note (has <!-- TASK_NOTES --> AND a TaskNoteToDoNav block, no second
// `---`) with user notes below the marker. Then runs
// applyMeetingTasksToEntityMigration + applyProjectTasksToEntityMigration +
// applyTaskNoteHeal and asserts the real end-state: task-notes created with the
// right source/link fields, backups written, migrations idempotent on a second
// run, and the v0.178-chrome note upgraded to the NEW chrome (LOSES
// TaskNoteToDoNav, GAINS the second `---` HR) with its user notes preserved.
// =============================================================================
async function runTaskEntitySurfacesFamily() {
    const {
        applyMeetingTasksToEntityMigration,
        applyProjectTasksToEntityMigration,
        applyTaskNoteHeal,
    } = require("../install.js");

    const dv = (cls) =>
        '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "' + cls + '" });\n```';

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-te-surf-"));
    const writeFixture = (rel, content) => {
        const f = path.join(root, rel);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, content);
    };
    const readVault = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
    const listTasks = () => {
        const d = path.join(root, "spice/tasks");
        return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".md")) : [];
    };
    const taskByTitle = (title) => {
        const out = [];
        for (const f of listTasks()) {
            const body = readVault("spice/tasks/" + f);
            const tm = body.match(/^title:\s*(.*)$/m);
            const t = tm ? tm[1].trim().replace(/^"(.*)"$/, "$1") : "";
            if (t === title) out.push({ file: f, body });
        }
        return out;
    };
    const fmVal = (body, key) => {
        const m = body.match(new RegExp("^" + key + ":\\s*(.*)$", "m"));
        return m ? m[1].trim().replace(/^"(.*)"$/, "$1") : "";
    };
    const backupExists = (nameRe) => {
        const backupRoot = path.join(root, ".sauce-backup");
        if (!fs.existsSync(backupRoot)) return false;
        const stack = [backupRoot];
        while (stack.length) {
            const dir = stack.pop();
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) stack.push(p);
                else if (nameRe.test(e.name)) return true;
            }
        }
        return false;
    };

    // ----- Fixtures -----
    // (1) Meeting note with a project: frontmatter + one OPEN Action Items line
    //     (+ a done line that must NOT convert) under the ACTION_ITEMS_MARKER.
    const MEETING = "spice/meetings/notes/2026/06-June/Standup-2026-06-18.md";
    writeFixture(MEETING, [
        "---", "type: meeting", 'project: "[[Sauce]]"', "---", "",
        dv("MeetingLeafActions"), "",
        dv("SectionLabel"), "",   // Action Items label (args elided for the fixture)
        "<!-- ACTION_ITEMS_MARKER -->", "",
        "- [ ] Email the vendor [due:: 2026-06-25] [priority:: high]",
        "- [x] Already done item", "",
    ].join("\n"));

    // (2) Project-todo note with one OPEN Owned Tasks line under OWNED_TASKS_MARKER.
    const PROJ_TODO = "spice/projects/global-k8s/Global K8s To-Do.md";
    writeFixture(PROJ_TODO, [
        "---", "type: project-todo", 'project: "[[Global K8s]]"',
        "project_slug: global-k8s", "---", "",
        dv("ToDoLeafActions"), "",
        "## Owned Tasks", "",
        "<!-- OWNED_TASKS_MARKER -->", "",
        "- [ ] Provision the cluster", "",
    ].join("\n"));

    // (3) v0.178-chrome task note (marker present, HAS a TaskNoteToDoNav block,
    //     no second `---` HR before the marker) + user notes below the marker.
    const OLD_TASK = "spice/tasks/Buy milk.md";
    writeFixture(OLD_TASK, [
        "---", "type: task", "title: Buy milk", "status: open",
        "scheduled:", "due:", "priority:", "project:", "project_slug:",
        "source: manual", "source_note:", "created_at: 2026-06-01T09:00:00-06:00",
        "completed_at:", "---", "",
        dv("SpaceNavButtons"), "",
        "---", "",
        dv("TaskNoteToDoNav"), "",
        dv("TaskNoteView"), "",
        "<!-- TASK_NOTES -->",
        "",
        "My handwritten notes about the milk task.",
        "",
    ].join("\n"));

    try {
        const adapter = makeFsAdapter(root);
        const tp = { app: { vault: { adapter } } };
        const git = { commit: "test", tag: "test", dirty: false };
        const history = [];

        // ----- Pass 1 -----
        await applyMeetingTasksToEntityMigration(tp, history, git);
        await applyProjectTasksToEntityMigration(tp, history, git);
        await applyTaskNoteHeal(tp, history, git);

        // === Meeting migration ===
        const meetTasks = taskByTitle("Email the vendor");
        ok("HC-TE-SURF-1 meeting task-note created for 'Email the vendor'",
           meetTasks.length === 1, `found ${meetTasks.length}: ${listTasks().join(", ")}`);
        const mFm = meetTasks.length ? meetTasks[0].body : "";
        ok("HC-TE-SURF-1b meeting task source == meeting",
           fmVal(mFm, "source") === "meeting", `source=${fmVal(mFm, "source")}`);
        ok("HC-TE-SURF-1c meeting task source_note == [[Standup-2026-06-18]]",
           fmVal(mFm, "source_note") === "[[Standup-2026-06-18]]", `source_note=${fmVal(mFm, "source_note")}`);
        ok("HC-TE-SURF-1d meeting task inherits project [[Sauce]] + slug sauce",
           fmVal(mFm, "project") === "[[Sauce]]" && fmVal(mFm, "project_slug") === "sauce",
           `project=${fmVal(mFm, "project")} slug=${fmVal(mFm, "project_slug")}`);
        ok("HC-TE-SURF-1e meeting task due/priority carried",
           fmVal(mFm, "due") === "2026-06-25" && fmVal(mFm, "priority") === "high",
           `due=${fmVal(mFm, "due")} prio=${fmVal(mFm, "priority")}`);
        ok("HC-TE-SURF-1f done line 'Already done item' NOT converted",
           taskByTitle("Already done item").length === 0);
        const healedMeeting = readVault(MEETING);
        ok("HC-TE-SURF-1g meeting note has <!-- meeting-tasks-migrated --> sentinel",
           healedMeeting.includes("<!-- meeting-tasks-migrated -->"));
        ok("HC-TE-SURF-1h migrated open line stripped; done line kept",
           !healedMeeting.includes("- [ ] Email the vendor") &&
           healedMeeting.includes("- [x] Already done item"));
        ok("HC-TE-SURF-1i .sauce-backup snapshot of the meeting note exists",
           backupExists(/Standup-2026-06-18\.md$/));

        // === Project migration ===
        const projTasks = taskByTitle("Provision the cluster");
        ok("HC-TE-SURF-2 project task-note created for 'Provision the cluster'",
           projTasks.length === 1, `found ${projTasks.length}: ${listTasks().join(", ")}`);
        const pFm = projTasks.length ? projTasks[0].body : "";
        ok("HC-TE-SURF-2b project task source == project",
           fmVal(pFm, "source") === "project", `source=${fmVal(pFm, "source")}`);
        ok("HC-TE-SURF-2c project task project_slug == global-k8s",
           fmVal(pFm, "project_slug") === "global-k8s", `slug=${fmVal(pFm, "project_slug")}`);
        ok("HC-TE-SURF-2d project task project == [[Global K8s]]",
           fmVal(pFm, "project") === "[[Global K8s]]", `project=${fmVal(pFm, "project")}`);
        const healedProj = readVault(PROJ_TODO);
        ok("HC-TE-SURF-2e project-todo has <!-- project-tasks-migrated --> sentinel",
           healedProj.includes("<!-- project-tasks-migrated -->"));
        ok("HC-TE-SURF-2f migrated open line stripped from project-todo",
           !healedProj.includes("- [ ] Provision the cluster"));
        ok("HC-TE-SURF-2g .sauce-backup snapshot of the project-todo exists",
           backupExists(/Global K8s To-Do\.md$/));

        // === v0.178-chrome upgrade → new chrome ===
        const upgraded = readVault(OLD_TASK);
        ok("HC-TE-SURF-3 v0.178-chrome task upgraded — TaskNoteToDoNav removed",
           !/class:\s*"TaskNoteToDoNav"/.test(upgraded));
        ok("HC-TE-SURF-3a upgraded note gains the second `---` HR before the marker",
           /```\r?\n\r?\n---\r?\n\r?\n<!-- TASK_NOTES -->/.test(upgraded));
        ok("HC-TE-SURF-3b upgraded note keeps SpaceNavButtons + TaskNoteView chrome",
           /class:\s*"SpaceNavButtons"/.test(upgraded) && /class:\s*"TaskNoteView"/.test(upgraded));
        ok("HC-TE-SURF-3c user notes below the marker preserved",
           upgraded.includes("My handwritten notes about the milk task."));
        ok("HC-TE-SURF-3d exactly one <!-- TASK_NOTES --> marker after upgrade",
           (upgraded.match(/<!-- TASK_NOTES -->/g) || []).length === 1);
        ok("HC-TE-SURF-3e .sauce-backup snapshot of the old task note exists",
           backupExists(/Buy milk\.md$/));

        // ----- Pass 2: idempotency -----
        await applyMeetingTasksToEntityMigration(tp, history, git);
        await applyProjectTasksToEntityMigration(tp, history, git);
        await applyTaskNoteHeal(tp, history, git);

        ok("HC-TE-SURF-4 no duplicate meeting task-note after second run",
           taskByTitle("Email the vendor").length === 1);
        ok("HC-TE-SURF-4b no duplicate project task-note after second run",
           taskByTitle("Provision the cluster").length === 1);
        const upgradedTwice = readVault(OLD_TASK);
        ok("HC-TE-SURF-4c chrome-upgrade idempotent (still one marker, notes intact)",
           (upgradedTwice.match(/<!-- TASK_NOTES -->/g) || []).length === 1 &&
           upgradedTwice.includes("My handwritten notes about the milk task."));
        ok("HC-TE-SURF-4d meeting/project sentinels present exactly once each",
           (readVault(MEETING).match(/<!-- meeting-tasks-migrated -->/g) || []).length === 1 &&
           (readVault(PROJ_TODO).match(/<!-- project-tasks-migrated -->/g) || []).length === 1);
    } finally {
        if (KEEP) {
            console.log(`  KEEP_SEED_VAULT=1: ${root}`);
        } else {
            try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) {}
        }
    }
}

// =============================================================================
// HC-TE-LP-* — task-entity links/project heals (bug fixes B1 + B2).
//
// Direct-invocation family. Builds a throwaway tmp vault with:
//   (1) a real project hub note (type: project, slug=connectors) so the slug
//       lookup can resolve the clean name → the REAL slug;
//   (2) a MANGLED task-note (project: "[[spice/projects/connectors/Connectors.md
//       |Connectors]]", project_slug: spice-projects-connectors-connectors-md-
//       connectors) → B1 heal must un-mangle it to project: "[[Connectors]]" +
//       project_slug: connectors;
//   (3) a CLEAN task-note (project: "[[Connectors]]", project_slug: connectors)
//       → B1 heal must LEAVE it untouched (idempotent);
//   (4) a project-todo note WITHOUT a TaskProjectList block → B2 heal injects it;
//   (5) a meeting note WITHOUT a TaskMeetingList block → B2 heal injects it.
// Asserts the healed end-state, backups written, and a second run is a no-op.
// =============================================================================
async function runTaskEntityLinksProjectFamily() {
    const {
        applyTaskNoteProjectSlugHeal,
        applyProjectTodoTaskListHeal,
        applyMeetingTaskListHeal,
    } = require("../install.js");

    const dv = (cls) =>
        '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "' + cls + '" });\n```';

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-te-lp-"));
    const writeFixture = (rel, content) => {
        const f = path.join(root, rel);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, content);
    };
    const readVault = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
    const fmVal = (body, key) => {
        const m = body.match(new RegExp("^" + key + ":\\s*(.*)$", "m"));
        return m ? m[1].trim().replace(/^"(.*)"$/, "$1") : "";
    };
    const backupExists = (nameRe) => {
        const backupRoot = path.join(root, ".sauce-backup");
        if (!fs.existsSync(backupRoot)) return false;
        const stack = [backupRoot];
        while (stack.length) {
            const dir = stack.pop();
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) stack.push(p);
                else if (nameRe.test(e.name)) return true;
            }
        }
        return false;
    };

    // (1) Real project hub so the slug lookup can resolve `Connectors` → connectors.
    const PROJ_HUB = "spice/projects/connectors/Connectors.md";
    writeFixture(PROJ_HUB, [
        "---", "type: project", "project_slug: connectors", "name: Connectors", "---", "",
        "# Connectors", "",
    ].join("\n"));

    // (2) MANGLED task-note (the B1 bug output).
    const MANGLED = "spice/tasks/Wire up the webhook.md";
    writeFixture(MANGLED, [
        "---", "type: task", "title: Wire up the webhook", "status: open",
        "scheduled:", "due:", "priority:",
        'project: "[[spice/projects/connectors/Connectors.md|Connectors]]"',
        "project_slug: spice-projects-connectors-connectors-md-connectors",
        "source: meeting", "source_note: \"[[Standup]]\"",
        "created_at: 2026-07-01T09:00:00-06:00", "completed_at:", "---", "",
        dv("SpaceNavButtons"), "", "<!-- TASK_NOTES -->", "",
        "My notes about the webhook.", "",
    ].join("\n"));

    // (3) CLEAN task-note (must NOT be touched by B1).
    const CLEAN = "spice/tasks/Draft the readme.md";
    writeFixture(CLEAN, [
        "---", "type: task", "title: Draft the readme", "status: open",
        "scheduled:", "due:", "priority:",
        'project: "[[Connectors]]"', "project_slug: connectors",
        "source: project", "source_note:",
        "created_at: 2026-07-01T09:00:00-06:00", "completed_at:", "---", "",
        dv("SpaceNavButtons"), "", "<!-- TASK_NOTES -->", "",
    ].join("\n"));

    // (4) project-todo note WITHOUT a TaskProjectList block (predates B2).
    const PROJ_TODO = "spice/projects/connectors/Connectors To-Do.md";
    writeFixture(PROJ_TODO, [
        // QUOTED type (real notes are `type: "project-todo"`) — regression for
        // the _parseFrontmatterStrict quote-strip fix so the heal matches them.
        "---", 'type: "project-todo"', 'project: "[[Connectors]]"',
        'project_slug: "connectors"', "---", "",
        dv("ToDoLeafActions"), "",
        dv("SectionLabel"), "  <!-- (Owned Tasks label, args elided) -->", "",
        '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Owned Tasks" }] });\n```', "",
        "<!-- OWNED_TASKS_MARKER -->", "",
        "- [ ] Some legacy owned task", "",
    ].join("\n"));

    // (5) meeting note WITHOUT a TaskMeetingList block (predates B2).
    const MEETING = "spice/meetings/notes/2026/07-July/Kickoff-2026-07-02.md";
    writeFixture(MEETING, [
        "---", "type: meeting", 'project: "[[Connectors]]"', "---", "",
        dv("MeetingLeafActions"), "",
        '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Action Items" }] });\n```', "",
        "<!-- ACTION_ITEMS_MARKER -->", "",
        "- [ ] Some legacy action item", "",
    ].join("\n"));

    try {
        const adapter = makeFsAdapter(root);
        const tp = { app: { vault: { adapter } } };
        const git = { commit: "test", tag: "test", dirty: false };
        const history = [];

        // ----- Pass 1 -----
        await applyTaskNoteProjectSlugHeal(tp, history, git);
        await applyProjectTodoTaskListHeal(tp, history, git);
        await applyMeetingTaskListHeal(tp, history, git);

        // === B1: mangled task un-mangled ===
        const mangled = readVault(MANGLED);
        ok("HC-TE-LP-1 mangled task project → clean [[Connectors]]",
           fmVal(mangled, "project") === "[[Connectors]]", `project=${fmVal(mangled, "project")}`);
        ok("HC-TE-LP-1b mangled task project_slug → real slug connectors",
           fmVal(mangled, "project_slug") === "connectors", `slug=${fmVal(mangled, "project_slug")}`);
        ok("HC-TE-LP-1c B1 preserves other frontmatter (title/source/source_note)",
           fmVal(mangled, "title") === "Wire up the webhook" &&
           fmVal(mangled, "source") === "meeting" &&
           fmVal(mangled, "source_note") === "[[Standup]]",
           `title=${fmVal(mangled, "title")} source=${fmVal(mangled, "source")} sn=${fmVal(mangled, "source_note")}`);
        ok("HC-TE-LP-1d B1 preserves the body below the marker",
           mangled.includes("My notes about the webhook."));
        ok("HC-TE-LP-1e B1 .sauce-backup snapshot of the mangled task exists",
           backupExists(/Wire up the webhook\.md$/));

        // === B1: clean task untouched (idempotent skip) ===
        const clean = readVault(CLEAN);
        ok("HC-TE-LP-2 clean task project unchanged",
           fmVal(clean, "project") === "[[Connectors]]" && fmVal(clean, "project_slug") === "connectors",
           `project=${fmVal(clean, "project")} slug=${fmVal(clean, "project_slug")}`);
        ok("HC-TE-LP-2b clean task NOT backed up (no write on a clean note)",
           !backupExists(/Draft the readme\.md$/));

        // === B2: project-todo gains a TaskProjectList block ===
        const projTodo = readVault(PROJ_TODO);
        ok("HC-TE-LP-3 project-todo gains a TaskProjectList block",
           /class:\s*"TaskProjectList"/.test(projTodo));
        ok("HC-TE-LP-3b project-todo gains the 'Project Tasks' SectionLabel",
           /text:\s*"Project Tasks"/.test(projTodo));
        ok("HC-TE-LP-3c Project Tasks block sits BEFORE Owned Tasks",
           projTodo.indexOf('"Project Tasks"') < projTodo.indexOf('"Owned Tasks"'));
        ok("HC-TE-LP-3d project-todo .sauce-backup exists",
           backupExists(/Connectors To-Do\.md$/));

        // === B2: meeting gains a TaskMeetingList block ===
        const meeting = readVault(MEETING);
        ok("HC-TE-LP-4 meeting gains a TaskMeetingList block",
           /class:\s*"TaskMeetingList"/.test(meeting));
        ok("HC-TE-LP-4b meeting gains the 'Tasks' SectionLabel",
           /text:\s*"Tasks"/.test(meeting));
        ok("HC-TE-LP-4c TaskMeetingList sits AFTER the ACTION_ITEMS_MARKER",
           meeting.indexOf("<!-- ACTION_ITEMS_MARKER -->") < meeting.indexOf("TaskMeetingList"));
        ok("HC-TE-LP-4d meeting .sauce-backup exists",
           backupExists(/Kickoff-2026-07-02\.md$/));

        // ----- Pass 2: idempotency -----
        await applyTaskNoteProjectSlugHeal(tp, history, git);
        await applyProjectTodoTaskListHeal(tp, history, git);
        await applyMeetingTaskListHeal(tp, history, git);

        const mangled2 = readVault(MANGLED);
        ok("HC-TE-LP-5 B1 idempotent (project still clean after 2nd run)",
           fmVal(mangled2, "project") === "[[Connectors]]" && fmVal(mangled2, "project_slug") === "connectors");
        const projTodo2 = readVault(PROJ_TODO);
        ok("HC-TE-LP-5b B2 project-todo idempotent (exactly one TaskProjectList)",
           (projTodo2.match(/class:\s*"TaskProjectList"/g) || []).length === 1);
        const meeting2 = readVault(MEETING);
        ok("HC-TE-LP-5c B2 meeting idempotent (exactly one TaskMeetingList)",
           (meeting2.match(/class:\s*"TaskMeetingList"/g) || []).length === 1);
    } finally {
        if (KEEP) {
            console.log(`  KEEP_SEED_VAULT=1: ${root}`);
        } else {
            try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) {}
        }
    }
}

// =============================================================================
// HC-TE-REORDER-* — applyProjectTodoSectionReorderHeal (v0.179 UI polish).
// A project To-Do note authored in the OLD section order (Project Tasks →
// Owned Tasks → From Meetings) must be reordered to Project Tasks → From
// Meetings → Owned Tasks: the WHOLE Owned Tasks block (its SectionLabel + the
// OWNED_TASKS_MARKER + the raw `- [x]`/`- [ ]` lines + the ownedTasks editable
// list) moves BELOW From Meetings as one unit. Idempotent (a second run + an
// already-ordered note are no-ops), .sauce-backup before write.
// =============================================================================
async function runProjectTodoSectionReorderFamily() {
    const { applyProjectTodoSectionReorderHeal } = require("../install.js");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-te-reorder-"));
    const writeFixture = (rel, content) => {
        const f = path.join(root, rel);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, content);
    };
    const readVault = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
    const backupExists = (nameRe) => {
        const backupRoot = path.join(root, ".sauce-backup");
        if (!fs.existsSync(backupRoot)) return false;
        const stack = [backupRoot];
        while (stack.length) {
            const dir = stack.pop();
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) stack.push(p);
                else if (nameRe.test(e.name)) return true;
            }
        }
        return false;
    };
    const dv = (cls, args) =>
        '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "' + cls + '"' +
        (args ? ", args: " + args : "") + " });\n```";

    // (1) Owned-Tasks-IN-THE-MIDDLE note (the pre-fix order):
    // Project Tasks → Owned Tasks (label + marker + lines + editable list) → From Meetings.
    const MIDDLE = "spice/projects/connectors/Connectors To-Do.md";
    writeFixture(MIDDLE, [
        "---", 'type: "project-todo"', 'project: "[[Connectors]]"',
        'project_slug: "connectors"', "---", "",
        dv("ToDoLeafActions"), "",
        dv("SectionLabel", '[{ text: "Project Tasks", top: true }]'), "",
        dv("TaskProjectList"), "",
        dv("SectionLabel", '[{ text: "Owned Tasks" }]'), "",
        "<!-- OWNED_TASKS_MARKER -->", "",
        "- [x] Completed legacy thing", "- [ ] Still open legacy thing", "",
        dv("TodayCaptureEditableList", '[{ anchor: "ownedTasks" }]'), "",
        dv("SectionLabel", '[{ text: "From Meetings" }]'), "",
        dv("ToDoDailyProjectGroups", '[{ scope: "project-todo" }]'), "",
    ].join("\n"));

    // (2) ALREADY-ordered note (Owned Tasks already last) → must be a no-op.
    const ORDERED = "spice/projects/ordered/Ordered To-Do.md";
    writeFixture(ORDERED, [
        "---", "type: project-todo", 'project_slug: "ordered"', "---", "",
        dv("SectionLabel", '[{ text: "Project Tasks", top: true }]'), "",
        dv("TaskProjectList"), "",
        dv("SectionLabel", '[{ text: "From Meetings" }]'), "",
        dv("ToDoDailyProjectGroups", '[{ scope: "project-todo" }]'), "",
        dv("SectionLabel", '[{ text: "Owned Tasks" }]'), "",
        "<!-- OWNED_TASKS_MARKER -->", "",
    ].join("\n"));

    try {
        const adapter = makeFsAdapter(root);
        const tp = { app: { vault: { adapter } } };
        const git = { commit: "test", tag: "test", dirty: false };
        const history = [];

        // ----- Pass 1 -----
        await applyProjectTodoSectionReorderHeal(tp, history, git);

        const middle = readVault(MIDDLE);
        const idxPT = middle.indexOf('"Project Tasks"');
        const idxFM = middle.indexOf('"From Meetings"');
        const idxOT = middle.indexOf('"Owned Tasks"');
        ok("HC-TE-REORDER-1 sections ordered Project Tasks → From Meetings → Owned Tasks",
           idxPT !== -1 && idxFM !== -1 && idxOT !== -1 && idxPT < idxFM && idxFM < idxOT,
           `PT=${idxPT} FM=${idxFM} OT=${idxOT}`);
        ok("HC-TE-REORDER-2 Owned Tasks marker moved with the block (below From Meetings)",
           middle.indexOf("<!-- OWNED_TASKS_MARKER -->") > idxFM);
        ok("HC-TE-REORDER-3 raw owned task lines preserved + moved below From Meetings",
           middle.includes("- [x] Completed legacy thing") &&
           middle.includes("- [ ] Still open legacy thing") &&
           middle.indexOf("- [x] Completed legacy thing") > idxFM);
        ok("HC-TE-REORDER-4 ownedTasks editable list moved with the block",
           middle.indexOf('anchor: "ownedTasks"') > idxFM);
        ok("HC-TE-REORDER-5 From Meetings widget still present",
           /class:\s*"ToDoDailyProjectGroups"/.test(middle) && /scope: "project-todo"/.test(middle));
        ok("HC-TE-REORDER-6 .sauce-backup snapshot of the reordered note exists",
           backupExists(/Connectors To-Do\.md$/));

        // Already-ordered note untouched (no write → no backup).
        const orderedBefore = readVault(ORDERED);
        ok("HC-TE-REORDER-7 already-ordered note NOT rewritten (idempotent no-op)",
           !backupExists(/Ordered To-Do\.md$/));

        // ----- Pass 2: idempotency -----
        await applyProjectTodoSectionReorderHeal(tp, history, git);
        const middle2 = readVault(MIDDLE);
        ok("HC-TE-REORDER-8 second run is a byte-identical no-op on the reordered note",
           middle2 === middle);
        ok("HC-TE-REORDER-9 exactly one Owned Tasks label after two runs",
           (middle2.match(/text:\s*"Owned Tasks"/g) || []).length === 1);
        const ordered2 = readVault(ORDERED);
        ok("HC-TE-REORDER-10 already-ordered note still byte-identical after two runs",
           ordered2 === orderedBefore);
    } finally {
        if (KEEP) {
            console.log(`  KEEP_SEED_VAULT=1: ${root}`);
        } else {
            try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) {}
        }
    }
}

// =============================================================================
// HC-V01790-SEED-MIGRATE-CHROME-* — WS9 project-chrome overhaul install heals.
//
// Like runTaskEntityLinksProjectFamily above, this is self-contained: the heals
// (applyBoardCardBreadcrumbHeal, applyProjectChromeDividerHeal,
// applyProjectHubWorkstreamRemovalHeal) run in the platform install loop, but the
// seed install short-circuits on version match, so we DIRECTLY INVOKE them in
// their canonical run order against a throwaway tmp vault seeded with
// PRE-migration-shape fixtures (the exact legacy shapes observed in real consumer
// vaults: a Project Map with a `---` hugging the ProjectNavButtons fence between
// chrome blocks; a promoted board-card note under tasks/<Task>/<Task>.md with NO
// frontmatter `type:` and NO Breadcrumb; a type:project hub carrying a
// ProjectWorkstreamManager block plus a `## Mentions` content divider that MUST
// survive). Covers: the `---` chrome dividers gone, no doubled chrome gap, the
// board card gains a Breadcrumb + `type: task-hub`, the hub loses the
// ProjectWorkstreamManager block, content dividers preserved, .sauce-backup
// snapshots exist, and idempotency on a second pass.
// =============================================================================
async function runProjectChromeMigrateFamily() {
    const {
        applyBoardCardBreadcrumbHeal,
        applyProjectChromeDividerHeal,
        applyProjectHubWorkstreamRemovalHeal,
    } = require("../install.js");

    const dv = (cls) =>
        '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "' + cls + '" });\n```';

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-chrome-mig-"));
    const writeFixture = (rel, content) => {
        const f = path.join(root, rel);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, content);
    };
    const readVault = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
    const backupExists = (nameRe) => {
        const backupRoot = path.join(root, ".sauce-backup");
        if (!fs.existsSync(backupRoot)) return false;
        const stack = [backupRoot];
        while (stack.length) {
            const dir = stack.pop();
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) stack.push(p);
                else if (nameRe.test(e.name)) return true;
            }
        }
        return false;
    };

    // (1) PRE: Project Map with a `---` HUGGING the ProjectNavButtons fence
    //     between two chrome blocks (real Project Map.md legacy shape).
    const MAP = "spice/projects/chrome-demo/Project Map.md";
    writeFixture(MAP, [
        "---", "type: map", "project_name: Chrome Demo", "---", "",
        dv("SpaceNavButtons"), "",
        dv("ProjectNavButtons"), "---", "",
        dv("ProjectWorkstreams"), "",
    ].join("\n"));

    // (2) PRE: promoted board-card note (basename === parent folder, under
    //     /tasks/) with NO frontmatter `type:` and NO Breadcrumb — plus a
    //     `---` chrome divider between SpaceNavButtons and ProjectNavButtons.
    const CARD = "spice/projects/chrome-demo/tasks/Migrate Stage/Migrate Stage.md";
    writeFixture(CARD, [
        "---", "created_at: 2026-05-19T13:53:47-06:00",
        "tags:", "  - kanban-card", "  - project-card",
        "status: completed", "---", "",
        dv("SpaceNavButtons"), "", "---", "",
        dv("ProjectNavButtons"), "",
    ].join("\n"));

    // (3) PRE: type:project hub with a ProjectWorkstreamManager block sandwiched
    //     between `---` chrome dividers, followed by a `## Mentions` content
    //     divider (which MUST survive both P0a and P1).
    const HUB = "spice/projects/chrome-demo/Chrome Demo.md";
    writeFixture(HUB, [
        "---", "type: project", "name: Chrome Demo", "---", "",
        dv("Breadcrumb"), "",
        dv("SpaceNavButtons"), "",
        dv("ProjectNavButtons"), "---", "",
        dv("ProjectStatusWidget"), "",
        dv("ProjectMeetingsPanel"), "", "---", "",
        dv("ProjectWorkstreamManager"), "", "---", "",
        "## Mentions", "",
        dv("BacklinkPanel"), "",
    ].join("\n"));

    try {
        const adapter = makeFsAdapter(root);
        const tp = { app: { vault: { adapter } } };
        const git = { commit: "test", tag: "test", dirty: false };
        const variables = { views_path: "ranch/views" };
        const manifest = { name: "project" };
        const history = [];

        // ----- Pass 1 — canonical run order: P0b (board-card) → P0a (dividers) → P1. -----
        await applyBoardCardBreadcrumbHeal(tp, manifest, variables, history, git);
        await applyProjectChromeDividerHeal(tp, manifest, variables, history, git);
        await applyProjectHubWorkstreamRemovalHeal(tp, manifest, variables, history, git);

        // === P0a: Project Map dividers stripped, no doubled chrome gap ===
        const map1 = readVault(MAP);
        ok("HC-V01790-SEED-MIGRATE-CHROME-1 Map: hugging chrome `---` gone",
            !/```\n---\n/.test(map1) && map1.includes('class: "ProjectWorkstreams"'),
            "the `---` hugging the ProjectNavButtons fence between chrome blocks must be removed");
        ok("HC-V01790-SEED-MIGRATE-CHROME-1b Map: no doubled blank gap",
            !/\n\n\n/.test(map1),
            "consecutive chrome blocks must be single-blank-separated");

        // === P0b: board card gains type:task-hub + a leading Breadcrumb ===
        const card1 = readVault(CARD);
        ok("HC-V01790-SEED-MIGRATE-CHROME-2 board card gains type: task-hub",
            /^type: task-hub$/m.test(card1),
            "the promoted board-card note must gain `type: task-hub`");
        ok("HC-V01790-SEED-MIGRATE-CHROME-2b board card gains a Breadcrumb block",
            /class:\s*"Breadcrumb"/.test(card1),
            "the board card must gain a Breadcrumb dataviewjs block");
        ok("HC-V01790-SEED-MIGRATE-CHROME-2c Breadcrumb is the first rendered block",
            card1.indexOf("Breadcrumb") < card1.indexOf("SpaceNavButtons"),
            "the Breadcrumb must precede SpaceNavButtons");
        ok("HC-V01790-SEED-MIGRATE-CHROME-2d board card chrome `---` divider stripped",
            !/```\n\n---\n\n```dataviewjs/.test(card1),
            "P0a (running after P0b stamped the type) must strip the board card's chrome `---`");

        // === P1: hub loses the ProjectWorkstreamManager block; content divider kept ===
        const hub1 = readVault(HUB);
        ok("HC-V01790-SEED-MIGRATE-CHROME-3 hub loses ProjectWorkstreamManager block",
            !/ProjectWorkstreamManager/.test(hub1),
            "the type:project hub must lose its ProjectWorkstreamManager block");
        ok("HC-V01790-SEED-MIGRATE-CHROME-3b hub chrome `---` dividers gone",
            !/```\n---\n/.test(hub1),
            "the hub's chrome-hugging `---` dividers must be removed by P0a");
        ok("HC-V01790-SEED-MIGRATE-CHROME-3c hub `## Mentions` content divider preserved",
            /```\n\n---\n\n## Mentions/.test(hub1),
            "the `---` before the `## Mentions` heading is a content boundary and must survive");
        ok("HC-V01790-SEED-MIGRATE-CHROME-3d hub has no doubled blank gap",
            !/\n\n\n/.test(hub1),
            "the WSM-removal + divider-strip must not leave a doubled blank");

        // === .sauce-backup snapshots exist ===
        ok("HC-V01790-SEED-MIGRATE-CHROME-4 .sauce-backup snapshot for board card",
            backupExists(/^Migrate Stage\.md$/),
            "a pre-heal backup of the board card must exist");
        ok("HC-V01790-SEED-MIGRATE-CHROME-4b .sauce-backup snapshot for hub",
            backupExists(/^Chrome Demo\.md$/),
            "a pre-heal backup of the hub must exist");

        // === history recorded a healed event for each heal ===
        ok("HC-V01790-SEED-MIGRATE-CHROME-5 history records all three heal steps",
            history.some((h) => h.step === "board_card_breadcrumb_heal" && h.action === "healed") &&
            history.some((h) => h.step === "project_chrome_divider_heal" && h.action === "healed") &&
            history.some((h) => h.step === "project_hub_workstream_removal_heal" && h.action === "healed"),
            "each heal must record a `healed` history event");

        // ----- Pass 2 — idempotency: a second run touches nothing. -----
        const mapAfter = readVault(MAP);
        const cardAfter = readVault(CARD);
        const hubAfter = readVault(HUB);
        await applyBoardCardBreadcrumbHeal(tp, manifest, variables, [], git);
        await applyProjectChromeDividerHeal(tp, manifest, variables, [], git);
        await applyProjectHubWorkstreamRemovalHeal(tp, manifest, variables, [], git);
        ok("HC-V01790-SEED-MIGRATE-CHROME-6 Map byte-identical after 2nd pass",
            readVault(MAP) === mapAfter, "second pass must not re-touch the Map");
        ok("HC-V01790-SEED-MIGRATE-CHROME-6b board card byte-identical after 2nd pass",
            readVault(CARD) === cardAfter, "second pass must not re-touch the board card");
        ok("HC-V01790-SEED-MIGRATE-CHROME-6c hub byte-identical after 2nd pass",
            readVault(HUB) === hubAfter, "second pass must not re-touch the hub");
    } finally {
        if (KEEP) {
            console.log(`  KEEP_SEED_VAULT=1: ${root}`);
        } else {
            try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) {}
        }
    }
}

// =============================================================================
// Project installer-migration coverage family (HC-PROJ-MIG-COV-*). Direct
// before/after harness for the eight project-blueprint install heals that had
// no regression coverage: applyProjectMeetingsPanelHeal,
// applyProjectLinksManagerBackfill, applyProjectHubLegacyHeadingCleanup,
// applyProjectNavButtonsSeparatorGap, applyProjectsHubAllProjectsHeadingCleanup,
// applyProjectActivityPanelsHeal, applyProjectLinksHubBackfill,
// applyProjectTodoOwnedTasksHeal. Each heal runs in its OWN throwaway vault so
// the type:project scanners (Meetings/ActivityPanels/LegacyHeading) never
// cross-contaminate each other's fixtures. Every block asserts the real end
// state (heal applied), a .sauce-backup snapshot where the heal rewrites in
// place, and idempotency (a second run is a byte-identical no-op). The three
// heals with pure string helpers also assert the helper transform directly.
// =============================================================================
async function runProjectInstallerMigrationCoverageFamily() {
    const install = require("../install.js");
    const git = { commit: "test", tag: "test", dirty: false };
    const roots = [];
    const freshVault = () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-proj-mig-cov-"));
        roots.push(root);
        return root;
    };
    const writeFixture = (root, rel, content) => {
        const f = path.join(root, rel);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, content);
    };
    const readVault = (root, rel) => fs.readFileSync(path.join(root, rel), "utf8");
    const existsVault = (root, rel) => fs.existsSync(path.join(root, rel));
    const backupExistsIn = (root, nameRe) => {
        const backupRoot = path.join(root, ".sauce-backup");
        if (!fs.existsSync(backupRoot)) return false;
        const stack = [backupRoot];
        while (stack.length) {
            const dir = stack.pop();
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) stack.push(p);
                else if (nameRe.test(e.name)) return true;
            }
        }
        return false;
    };
    const dv = (cls, args) =>
        '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "' + cls + '"' +
        (args ? ", args: " + args : "") + " });\n```";
    const mkTp = (root) => ({ app: { vault: { adapter: makeFsAdapter(root) } } });

    try {
        // ----- 1. applyProjectMeetingsPanelHeal -----
        {
            const root = freshVault();
            const HUB = "spice/projects/mp-heal/Mp Heal.md";
            writeFixture(root, HUB, [
                "---", "type: project", "---", "",
                dv("ProjectStatusWidget"), "",
            ].join("\n"));
            const tp = mkTp(root), history = [];
            await install.applyProjectMeetingsPanelHeal(tp, {}, {}, history, git);
            const after = readVault(root, HUB);
            ok("HC-PROJ-MIG-COV-1a MeetingsPanel injected into type:project hub",
               after.includes('class: "ProjectMeetingsPanel"'));
            ok("HC-PROJ-MIG-COV-1b MeetingsPanel sits after the ProjectStatusWidget anchor",
               after.indexOf('class: "ProjectMeetingsPanel"') > after.indexOf('class: "ProjectStatusWidget"'));
            ok("HC-PROJ-MIG-COV-1c .sauce-backup snapshot of the healed hub exists",
               backupExistsIn(root, /Mp Heal\.md$/));
            await install.applyProjectMeetingsPanelHeal(tp, {}, {}, history, git);
            ok("HC-PROJ-MIG-COV-1d second run is a byte-identical no-op (idempotent)",
               readVault(root, HUB) === after);
            ok("HC-PROJ-MIG-COV-1e exactly one MeetingsPanel block after two runs",
               (readVault(root, HUB).match(/class: "ProjectMeetingsPanel"/g) || []).length === 1);
        }

        // ----- 2. applyProjectLinksManagerBackfill (+ _injectProjectLinksManagerBody) -----
        {
            const root = freshVault();
            const LH = "spice/projects/lm-backfill/Lm Links Hub.md";
            writeFixture(root, LH, [
                "---", "type: links-hub", "---", "",
                dv("ProjectLinksPanel"), "",
            ].join("\n"));
            const tp = mkTp(root), history = [];
            await install.applyProjectLinksManagerBackfill(tp, {}, {}, history, git);
            const after = readVault(root, LH);
            ok("HC-PROJ-MIG-COV-2a LinksManager injected into type:links-hub note",
               after.includes('class: "ProjectLinksManager"'));
            ok("HC-PROJ-MIG-COV-2b LinksManager sits ABOVE the ProjectLinksPanel it anchors on",
               after.indexOf('class: "ProjectLinksManager"') < after.indexOf('class: "ProjectLinksPanel"'));
            ok("HC-PROJ-MIG-COV-2c .sauce-backup snapshot exists",
               backupExistsIn(root, /Lm Links Hub\.md$/));
            await install.applyProjectLinksManagerBackfill(tp, {}, {}, history, git);
            ok("HC-PROJ-MIG-COV-2d second run is a byte-identical no-op (idempotent)",
               readVault(root, LH) === after);
            // pure helper: injects on an anchored body, no-ops without an anchor
            const injected = install._injectProjectLinksManagerBody(dv("ProjectLinksPanel"));
            ok("HC-PROJ-MIG-COV-2e _injectProjectLinksManagerBody adds the manager block",
               injected.includes('class: "ProjectLinksManager"'));
            ok("HC-PROJ-MIG-COV-2f _injectProjectLinksManagerBody no-ops without a ProjectLinksPanel anchor",
               install._injectProjectLinksManagerBody("no anchor here") === "no anchor here");
        }

        // ----- 3. applyProjectHubLegacyHeadingCleanup -----
        {
            const root = freshVault();
            const HUB = "spice/projects/legacy-head/Legacy Head.md";
            writeFixture(root, HUB, [
                "---", "type: project", "---", "",
                "## Status", "", dv("ProjectStatusWidget"), "",
                "## Workstreams", "", dv("ProjectWorkstreamManager"), "",
                "## Status", "", "User-authored notes below a real heading.", "",
            ].join("\n"));
            const tp = mkTp(root), history = [];
            const before = readVault(root, HUB);
            ok("HC-PROJ-MIG-COV-3-pre two ## Status headings + one ## Workstreams before heal",
               (before.match(/^## Status$/gm) || []).length === 2 && /^## Workstreams$/m.test(before));
            await install.applyProjectHubLegacyHeadingCleanup(tp, {}, {}, history, git);
            const after = readVault(root, HUB);
            ok("HC-PROJ-MIG-COV-3a widget-labelling ## Status stripped (2 -> 1)",
               (after.match(/^## Status$/gm) || []).length === 1);
            ok("HC-PROJ-MIG-COV-3b widget-labelling ## Workstreams stripped",
               !/^## Workstreams$/m.test(after));
            ok("HC-PROJ-MIG-COV-3c user-authored ## Status (over prose) preserved",
               after.includes("User-authored notes below a real heading."));
            ok("HC-PROJ-MIG-COV-3d both widget blocks still present",
               after.includes('class: "ProjectStatusWidget"') && after.includes('class: "ProjectWorkstreamManager"'));
            ok("HC-PROJ-MIG-COV-3e .sauce-backup snapshot exists",
               backupExistsIn(root, /Legacy Head\.md$/));
            await install.applyProjectHubLegacyHeadingCleanup(tp, {}, {}, history, git);
            ok("HC-PROJ-MIG-COV-3f second run is a byte-identical no-op (idempotent)",
               readVault(root, HUB) === after);
        }

        // ----- 4. applyProjectNavButtonsSeparatorGap (+ _collapseNavButtonsSeparatorGap) -----
        {
            const root = freshVault();
            const NOTE = "spice/projects/navgap/Navgap Map.md";
            writeFixture(root, NOTE, [
                dv("ProjectNavButtons"), "", "---", "", "body", "",
            ].join("\n"));
            const tp = mkTp(root), history = [];
            await install.applyProjectNavButtonsSeparatorGap(tp, {}, {}, history, git);
            const after = readVault(root, NOTE);
            ok("HC-PROJ-MIG-COV-4a separator gap collapsed (fence hugs the --- rule)",
               after.includes("```\n---") && !after.includes("```\n\n---"));
            ok("HC-PROJ-MIG-COV-4b .sauce-backup snapshot exists",
               backupExistsIn(root, /Navgap Map\.md$/));
            await install.applyProjectNavButtonsSeparatorGap(tp, {}, {}, history, git);
            ok("HC-PROJ-MIG-COV-4c second run is a byte-identical no-op (idempotent)",
               readVault(root, NOTE) === after);
            // pure helper: collapses a gap, no-ops on an already-hugged rule
            ok("HC-PROJ-MIG-COV-4d _collapseNavButtonsSeparatorGap flags a real gap as changed",
               install._collapseNavButtonsSeparatorGap(dv("ProjectNavButtons") + "\n\n---").changed === true);
            ok("HC-PROJ-MIG-COV-4e _collapseNavButtonsSeparatorGap no-ops when there is no gap",
               install._collapseNavButtonsSeparatorGap(dv("ProjectNavButtons") + "\n---").changed === false);
        }

        // ----- 5. applyProjectsHubAllProjectsHeadingCleanup (+ _stripAllProjectsHeading) -----
        {
            const root = freshVault();
            const HUB = "spice/projects/Projects.md";
            writeFixture(root, HUB, [
                "---", "type: projects-hub", "---", "",
                "## All Projects", "", dv("ProjectsHubCards"), "",
            ].join("\n"));
            const tp = mkTp(root), history = [];
            await install.applyProjectsHubAllProjectsHeadingCleanup(tp, {}, {}, history, git);
            const after = readVault(root, HUB);
            ok("HC-PROJ-MIG-COV-5a legacy ## All Projects heading stripped from projects-hub",
               !/^## All Projects$/m.test(after));
            ok("HC-PROJ-MIG-COV-5b hub cards widget preserved",
               after.includes('class: "ProjectsHubCards"'));
            ok("HC-PROJ-MIG-COV-5c .sauce-backup snapshot exists",
               backupExistsIn(root, /Projects\.md$/));
            await install.applyProjectsHubAllProjectsHeadingCleanup(tp, {}, {}, history, git);
            ok("HC-PROJ-MIG-COV-5d second run is a byte-identical no-op (idempotent)",
               readVault(root, HUB) === after);
            // pure helper
            ok("HC-PROJ-MIG-COV-5e _stripAllProjectsHeading flags the heading as changed",
               install._stripAllProjectsHeading("## All Projects\n\nx").changed === true);
            ok("HC-PROJ-MIG-COV-5f _stripAllProjectsHeading no-ops when the heading is absent",
               install._stripAllProjectsHeading("no heading here").changed === false);
        }

        // ----- 6. applyProjectActivityPanelsHeal -----
        {
            const root = freshVault();
            const HUB = "spice/projects/activity/Activity.md";
            writeFixture(root, HUB, [
                "---", "type: project", "---", "",
                dv("ProjectStatusWidget"), "",
                dv("ProjectMeetingsPanel"), "",
            ].join("\n"));
            const tp = mkTp(root), history = [];
            await install.applyProjectActivityPanelsHeal(tp, {}, {}, history, git);
            const after = readVault(root, HUB);
            ok("HC-PROJ-MIG-COV-6a ActivityPanel injected",
               after.includes('class: "ProjectActivityPanel"'));
            ok("HC-PROJ-MIG-COV-6b OpenTasks injected alongside ActivityPanel",
               after.includes('class: "ProjectOpenTasks"'));
            ok("HC-PROJ-MIG-COV-6c both panels sit ABOVE the MeetingsPanel anchor",
               after.indexOf('class: "ProjectActivityPanel"') < after.indexOf('class: "ProjectMeetingsPanel"') &&
               after.indexOf('class: "ProjectOpenTasks"') < after.indexOf('class: "ProjectMeetingsPanel"'));
            ok("HC-PROJ-MIG-COV-6d .sauce-backup snapshot exists",
               backupExistsIn(root, /Activity\.md$/));
            await install.applyProjectActivityPanelsHeal(tp, {}, {}, history, git);
            ok("HC-PROJ-MIG-COV-6e second run is a byte-identical no-op (idempotent)",
               readVault(root, HUB) === after);
        }

        // ----- 7. applyProjectLinksHubBackfill -----
        {
            const root = freshVault();
            writeFixture(root, "spice/projects/linkshub/Linkshub.md", [
                "---", "type: project", "---", "", dv("ProjectNavButtons"), "",
            ].join("\n"));
            // A project dir with NO type:project hub must NOT get a Links Hub.
            writeFixture(root, "spice/projects/nohub/Some Note.md", [
                "---", "type: note", "---", "", "not a hub", "",
            ].join("\n"));
            const tp = mkTp(root), history = [];
            await install.applyProjectLinksHubBackfill(tp, {}, {}, history, git);
            ok("HC-PROJ-MIG-COV-7a Links Hub created for the project with a hub note",
               existsVault(root, "spice/projects/linkshub/Links Hub.md"));
            const lh = existsVault(root, "spice/projects/linkshub/Links Hub.md")
                ? readVault(root, "spice/projects/linkshub/Links Hub.md") : "";
            ok("HC-PROJ-MIG-COV-7b created Links Hub carries type:links-hub + project name + slug",
               lh.includes("type: links-hub") && lh.includes('project: "[[Linkshub]]"') && lh.includes("project_slug: linkshub"));
            ok("HC-PROJ-MIG-COV-7c project WITHOUT a hub note gets no Links Hub",
               !existsVault(root, "spice/projects/nohub/Links Hub.md"));
            await install.applyProjectLinksHubBackfill(tp, {}, {}, history, git);
            ok("HC-PROJ-MIG-COV-7d second run does not recreate/duplicate the Links Hub (idempotent)",
               readVault(root, "spice/projects/linkshub/Links Hub.md") === lh);
        }

        // ----- 8. applyProjectTodoOwnedTasksHeal (+ _healProjectTodoOwnedTasksBody) -----
        {
            const root = freshVault();
            const TODO = "spice/projects/todo/Todo To-Do.md";
            writeFixture(root, TODO, [
                "---", "type: project-todo", "---", "",
                dv("SectionLabel", '[{ text: "Owned Tasks" }]'), "",
                "- [ ] a legacy owned task", "",
            ].join("\n"));
            const tp = mkTp(root), history = [];
            await install.applyProjectTodoOwnedTasksHeal(tp, history, git);
            const after = readVault(root, TODO);
            ok("HC-PROJ-MIG-COV-8a OWNED_TASKS_MARKER injected below the Owned Tasks label",
               after.includes("<!-- OWNED_TASKS_MARKER -->"));
            ok("HC-PROJ-MIG-COV-8b ownedTasks editable-list renderer injected",
               after.includes('anchor: "ownedTasks"'));
            ok("HC-PROJ-MIG-COV-8c raw legacy task line preserved",
               after.includes("- [ ] a legacy owned task"));
            ok("HC-PROJ-MIG-COV-8d .sauce-backup snapshot exists",
               backupExistsIn(root, /Todo To-Do\.md$/));
            await install.applyProjectTodoOwnedTasksHeal(tp, history, git);
            ok("HC-PROJ-MIG-COV-8e second run is a byte-identical no-op (idempotent)",
               readVault(root, TODO) === after);
            // pure helper: a body already carrying marker + renderer is returned unchanged
            ok("HC-PROJ-MIG-COV-8f _healProjectTodoOwnedTasksBody no-ops on an already-healed body",
               install._healProjectTodoOwnedTasksBody(after) === after);
        }
    } finally {
        for (const r of roots) {
            if (KEEP) console.log(`  KEEP_SEED_VAULT=1: ${r}`);
            else { try { fs.rmSync(r, { recursive: true, force: true }); } catch (e) {} }
        }
    }
}

// =============================================================================
// Home scaffold/heal family (HC-HOME-SCAFFOLD-*). Direct before/after harness for
// applyHomeScaffoldHeal — the home blueprint's install-time scaffold+heal for the
// singleton spice/home/Home.md, previously the sole uncovered home
// installer_migration fn. (1) MISSING -> scaffolds Home.md with type: home
// frontmatter + SpaceHome/SpaceNavButtons chrome, idempotent on a 2nd run.
// (2) PRESENT-but-unhealthy (no SpaceHome) -> rebuilds the chrome, preserves the
// user free-write below the HOME_CHROME_END marker, writes a .sauce-backup
// snapshot FIRST, idempotent afterwards. Drives the REAL exported fn against a
// throwaway fs-adapter vault.
// =============================================================================
async function runHomeScaffoldHealFamily() {
    const install = require("../install.js");
    const git = { commit: "test", tag: "test", dirty: false };
    const roots = [];
    const freshVault = () => {
        const r = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-home-scaffold-"));
        roots.push(r);
        return r;
    };
    const readVault = (root, rel) => fs.readFileSync(path.join(root, rel), "utf8");
    const existsVault = (root, rel) => fs.existsSync(path.join(root, rel));
    const writeFixture = (root, rel, content) => {
        const f = path.join(root, rel);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, content);
    };
    const backupExistsIn = (root, nameRe) => {
        const backupRoot = path.join(root, ".sauce-backup");
        if (!fs.existsSync(backupRoot)) return false;
        const stack = [backupRoot];
        while (stack.length) {
            const dir = stack.pop();
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) stack.push(p);
                else if (nameRe.test(e.name)) return true;
            }
        }
        return false;
    };
    const mkTp = (root) => ({ app: { vault: { adapter: makeFsAdapter(root) } } });
    const HOME = "spice/home/Home.md";

    try {
        // ----- 1. MISSING -> scaffolded + idempotent -----
        {
            const root = freshVault();
            const tp = mkTp(root), history = [];
            ok("HC-HOME-SCAFFOLD-1-pre Home.md absent before heal", !existsVault(root, HOME));
            await install.applyHomeScaffoldHeal(tp, history, git);
            ok("HC-HOME-SCAFFOLD-1a Home.md scaffolded when missing", existsVault(root, HOME));
            const body = existsVault(root, HOME) ? readVault(root, HOME) : "";
            ok("HC-HOME-SCAFFOLD-1b carries type: home frontmatter",
               /^type:\s*home\s*$/m.test(body), body.slice(0, 120));
            ok("HC-HOME-SCAFFOLD-1c has SpaceHome + SpaceNavButtons chrome",
               /class:\s*"SpaceHome"/.test(body) && /class:\s*"SpaceNavButtons"/.test(body));
            await install.applyHomeScaffoldHeal(tp, history, git);
            ok("HC-HOME-SCAFFOLD-1d second run is a byte-identical no-op (healthy note)",
               readVault(root, HOME) === body);
        }

        // ----- 2. PRESENT-but-unhealthy -> rebuilt + tail preserved + backup -----
        {
            const root = freshVault();
            const marker = "[//]: # (HOME_CHROME_END)";
            const legacy = [
                "---", "type: home", "---", "",
                "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });', "```", "",
                marker, "",
                "My personal home free-write.",
            ].join("\n");
            writeFixture(root, HOME, legacy);
            const tp = mkTp(root), history = [];
            ok("HC-HOME-SCAFFOLD-2-pre unhealthy Home.md has NO SpaceHome",
               !/class:\s*"SpaceHome"/.test(readVault(root, HOME)));
            await install.applyHomeScaffoldHeal(tp, history, git);
            const healed = readVault(root, HOME);
            ok("HC-HOME-SCAFFOLD-2a unhealthy Home.md rebuilt with SpaceHome chrome",
               /class:\s*"SpaceHome"/.test(healed));
            ok("HC-HOME-SCAFFOLD-2b user free-write below the marker preserved",
               healed.includes("My personal home free-write."));
            ok("HC-HOME-SCAFFOLD-2c .sauce-backup snapshot written before the heal",
               backupExistsIn(root, /^Home\.md\./));
            const before2 = readVault(root, HOME);
            await install.applyHomeScaffoldHeal(tp, history, git);
            ok("HC-HOME-SCAFFOLD-2d healed note is idempotent (2nd run no-op)",
               readVault(root, HOME) === before2);
        }
    } finally {
        for (const r of roots) {
            if (KEEP) console.log(`  KEEP_SEED_VAULT=1: ${r}`);
            else { try { fs.rmSync(r, { recursive: true, force: true }); } catch (e) {} }
        }
    }
}

// The MIGRATE families are async (the migrations are async). Run them to
// completion, then emit the final tally + exit code so all asserts are counted.
runMigrateFamily()
    .catch((e) => {
        console.log(`  FAIL HC-V01174-MIGRATE-FAMILY threw — ${e && e.message}`);
        fail++;
        failures.push("HC-V01174-MIGRATE-FAMILY");
    })
    .then(() => runProjectMigrateFamily())
    .catch((e) => {
        console.log(`  FAIL HC-V01190-PROJ-SEED-MIGRATE-FAMILY threw — ${e && e.message}`);
        fail++;
        failures.push("HC-V01190-PROJ-SEED-MIGRATE-FAMILY");
    })
    .then(() => runDocSectionBackfillFamily())
    .catch((e) => {
        console.log(`  FAIL HC-DOCSEC-BACKFILL-FAMILY threw — ${e && e.message}`);
        fail++;
        failures.push("HC-DOCSEC-BACKFILL-FAMILY");
    })
    .then(() => runDocsHubModernizeFamily())
    .catch((e) => {
        console.log(`  FAIL HC-DOCSHUB-SEED-MIGRATE-DOCSHUB-FAMILY threw — ${e && e.message}`);
        fail++;
        failures.push("HC-DOCSHUB-SEED-MIGRATE-DOCSHUB-FAMILY");
    })
    .then(() => runFinanceMigrateFamily())
    .catch((e) => {
        console.log(`  FAIL HC-V01190-FIN-SEED-MIGRATE-FAMILY threw — ${e && e.message}`);
        fail++;
        failures.push("HC-V01190-FIN-SEED-MIGRATE-FAMILY");
    })
    .then(() => runEntityCreateMigrateFamily())
    .catch((e) => {
        console.log(`  FAIL HC-V01190-EC-SEED-MIGRATE-FAMILY threw — ${e && e.message}`);
        fail++;
        failures.push("HC-V01190-EC-SEED-MIGRATE-FAMILY");
    })
    .then(() => runSectionHubCleanupFamily())
    .catch((e) => {
        console.log(`  FAIL HC-V01241-SEED-SECHUB-FAMILY threw — ${e && e.message}`);
        fail++;
        failures.push("HC-V01241-SEED-SECHUB-FAMILY");
    })
    .then(() => runMonthsSentinelHealFamily())
    .catch((e) => {
        console.log(`  FAIL HC-V0151-MONTHS-SENTINEL-HEAL-FAMILY threw — ${e && e.message}`);
        fail++;
        failures.push("HC-V0151-MONTHS-SENTINEL-HEAL-FAMILY");
    })
    .then(() => runTaskEntitySurfacesFamily())
    .catch((e) => {
        console.log(`  FAIL HC-TE-SURF-FAMILY threw — ${e && e.message}`);
        fail++;
        failures.push("HC-TE-SURF-FAMILY");
    })
    .then(() => runTaskEntityLinksProjectFamily())
    .catch((e) => {
        console.log(`  FAIL HC-TE-LP-FAMILY threw — ${e && e.message}`);
        fail++;
        failures.push("HC-TE-LP-FAMILY");
    })
    .then(() => runProjectTodoSectionReorderFamily())
    .catch((e) => {
        console.log(`  FAIL HC-TE-REORDER-FAMILY threw — ${e && e.message}`);
        fail++;
        failures.push("HC-TE-REORDER-FAMILY");
    })
    .then(() => runProjectChromeMigrateFamily())
    .catch((e) => {
        console.log(`  FAIL HC-V01790-SEED-MIGRATE-CHROME-FAMILY threw — ${e && e.message}`);
        fail++;
        failures.push("HC-V01790-SEED-MIGRATE-CHROME-FAMILY");
    })
    .then(() => runProjectInstallerMigrationCoverageFamily())
    .catch((e) => {
        console.log(`  FAIL HC-PROJ-MIG-COV-FAMILY threw — ${e && e.message}`);
        fail++;
        failures.push("HC-PROJ-MIG-COV-FAMILY");
    })
    .then(() => runHomeScaffoldHealFamily())
    .catch((e) => {
        console.log(`  FAIL HC-HOME-SCAFFOLD-FAMILY threw — ${e && e.message}`);
        fail++;
        failures.push("HC-HOME-SCAFFOLD-FAMILY");
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
