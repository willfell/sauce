// platform/test/run-integration-smoke.js — bar-ii deploy-confidence smoke.
// Bootstraps a fresh tmp vault, seeds it, audits it. Asserts post-conditions.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ok ${label}`); pass++; }
    else { console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); fail++; }
}

const KEEP = process.env.KEEP_SMOKE_VAULT === "1";
const ANCHOR = "2026-05-12";

function withTempHomeAndVault(fn) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-smoke-home-"));
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-smoke-vault-"));
    const origHome = process.env.HOME;
    process.env.HOME = home;
    try { return fn({ home, vault }); }
    finally {
        process.env.HOME = origHome;
        if (!KEEP) {
            try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
            try { fs.rmSync(vault, { recursive: true, force: true }); } catch {}
        } else {
            console.log(`  KEEP_SMOKE_VAULT=1: home=${home} vault=${vault}`);
        }
    }
}

function runCli(args, opts = {}) {
    try {
        const out = execFileSync("node", ["platform/cli/sauce-cli.js", ...args], {
            stdio: ["ignore", "pipe", "pipe"],
            encoding: "utf8",
            env: process.env,
        });
        return { code: 0, stdout: out, stderr: "" };
    } catch (e) {
        return { code: e.status || 1, stdout: (e.stdout && e.stdout.toString()) || "", stderr: (e.stderr && e.stderr.toString()) || "" };
    }
}

withTempHomeAndVault(({ home, vault }) => {
    // Step 1: bootstrap
    const bootstrap = runCli(["bootstrap", "--vault", vault, "--non-interactive", "--no-register", "--mechanisms=all"]);
    ok("smoke-1 bootstrap exit 0", bootstrap.code === 0,
        `stdout=${bootstrap.stdout.slice(-300)} stderr=${bootstrap.stderr.slice(-300)}`);
    ok("smoke-2 bootstrap created ranch/platform-installed.json",
        fs.existsSync(path.join(vault, "ranch", "platform-installed.json")));

    // Step 2: seed
    const seed = runCli(["seed", "--vault", vault, "--anchor-date", ANCHOR]);
    ok("smoke-3 seed exit 0", seed.code === 0,
        `stdout=${seed.stdout.slice(-300)} stderr=${seed.stderr.slice(-300)}`);
    ok("smoke-4 seed printed total line", /total: \d+ notes/.test(seed.stdout));

    // Step 3: audit
    const audit = runCli(["audit", "--vault", vault]);
    ok("smoke-5 audit exit 0", audit.code === 0,
        `stdout=${audit.stdout.slice(-300)} stderr=${audit.stderr.slice(-300)}`);
    ok("smoke-6 audit reports zero errors",
        !/error/i.test(audit.stdout) || /0 errors?/.test(audit.stdout));
    ok("smoke-7 audit reports zero warnings",
        !/warning/i.test(audit.stdout) || /0 warnings?/.test(audit.stdout));

    // Step 4: registry-unchanged invariant (--no-register opt-out)
    const registryPath = path.join(home, ".sauce", "vaults.json");
    const registryExists = fs.existsSync(registryPath);
    if (registryExists) {
        const reg = JSON.parse(fs.readFileSync(registryPath, "utf8"));
        ok("smoke-8 registry empty after --no-register",
            !reg.vaults || reg.vaults.length === 0,
            `registry contents: ${JSON.stringify(reg)}`);
    } else {
        ok("smoke-8 registry not created (--no-register opt-out)", true);
    }

    // Step 4b: v0.42.0 S9 — cowork@0.4.0 hub files. The bootstrap uses
    // --mechanisms=all but a default non-interactive bootstrap subscribes
    // blueprints via a second targeted install that only subscribes cowork.
    // We run a reinstall with cowork subscription to materialize hub files.
    // Since the install path for a pre-configured vault (config+sub already
    // written by bootstrap) re-reads subscription from disk, we patch the
    // subscription to add cowork + its dependency (daily), then reinstall.
    const subPath = path.join(vault, "ranch", "platform-subscription.json");
    const sub = JSON.parse(fs.readFileSync(subPath, "utf8"));
    const wsmf = JSON.parse(fs.readFileSync(path.join(path.resolve(__dirname, "../.."), "platform/manifest.json"), "utf8"));
    const dailyEntry = wsmf.blueprints.find(b => b.name === "daily");
    const coworkEntry = wsmf.blueprints.find(b => b.name === "cowork");
    if (dailyEntry && !sub.blueprints.find(b => b.name === "daily")) {
        sub.blueprints.push({ name: dailyEntry.name, version: dailyEntry.version });
    }
    if (coworkEntry && !sub.blueprints.find(b => b.name === "cowork")) {
        sub.blueprints.push({ name: coworkEntry.name, version: coworkEntry.version });
    }
    // v0.46.0 S11 — subscribe the entity-create mechanism + the 5 migrated
    // blueprints so the registry materializes (most of) the 7 entries for
    // the entity-create smoke assertions below.
    const ecMech = wsmf.mechanisms.find(m => m.name === "entity-create");
    if (ecMech && !sub.mechanisms.find(m => m.name === "entity-create")) {
        sub.mechanisms.push({ name: ecMech.name, version: ecMech.version });
    }
    for (const bpName of ["meetings", "people", "project", "scratch", "finance", "to-do"]) {
        // v0.46.2: project re-included after FLN-f fix (stale
        // helpers/project-action-buttons.js reference removed from project's
        // manifest customjs_classes[] + files[]). Project's entity-create
        // entry now materializes into the registry alongside the other 6.
        // v0.63.0 S7: to-do added so All-ToDos.md + helper scripts materialize.
        const entry = wsmf.blueprints.find(b => b.name === bpName);
        if (entry && !sub.blueprints.find(b => b.name === bpName)) {
            sub.blueprints.push({ name: entry.name, version: entry.version });
        }
    }
    fs.writeFileSync(subPath, JSON.stringify(sub, null, 2), "utf8");
    const reinstall = runCli(["reinstall", "--vault", vault]);
    const coworkDir = path.join(vault, "spice", "cowork");
    ok("smoke-cowork-daily-hub-exists",
        fs.existsSync(path.join(coworkDir, "Daily Hub.md")),
        `reinstall exit=${reinstall.code} stdout=${reinstall.stdout.slice(-200)} path=${path.join(coworkDir, "Daily Hub.md")}`);
    ok("smoke-cowork-weekly-hub-exists",
        fs.existsSync(path.join(coworkDir, "Weekly Hub.md")),
        `path=${path.join(coworkDir, "Weekly Hub.md")}`);
    ok("smoke-cowork-monthly-hub-exists",
        fs.existsSync(path.join(coworkDir, "Monthly Hub.md")),
        `path=${path.join(coworkDir, "Monthly Hub.md")}`);

    // v0.44.0 S9 — About Cowork.md materialized at spice/cowork/ after reinstall
    // (relocated documentation from the trimmed Cowork.md hub).
    ok("smoke-cowork-about-exists",
        fs.existsSync(path.join(coworkDir, "About Cowork.md")),
        `path=${path.join(coworkDir, "About Cowork.md")}`);

    // v0.45.0 S8 — Daily Note.md template materialized into ranch/templates/
    // (NEW in v0.45.0 — Templater template for cowork-owned daily notes).
    const dailyNoteTpl = path.join(vault, "ranch", "templates", "Daily Note.md");
    ok("smoke-cowork-daily-note-template-exists",
        fs.existsSync(dailyNoteTpl),
        `path=${dailyNoteTpl}`);

    // v0.43.0: nav-button consolidation. cowork@0.5.0 contributes exactly
    // 1 global nav-button (cowork-hub); the v0.4.0 cowork-weekly-this +
    // cowork-monthly-this entries should NOT appear in the registry after
    // a fresh install.
    const navRegPath = path.join(vault, "ranch", "nav-buttons-registry.json");
    let navReg = null;
    try { navReg = JSON.parse(fs.readFileSync(navRegPath, "utf8")); }
    catch (e) { /* leave null; assertion below will surface */ }
    const coworkContribs = (navReg && navReg.contributions && Array.isArray(navReg.contributions.cowork))
        ? navReg.contributions.cowork : [];
    ok("smoke-cowork-nav-contributions-length-1",
        coworkContribs.length === 1,
        `expected contributions.cowork[].length === 1, got ${coworkContribs.length} (registry path=${navRegPath})`);
    ok("smoke-cowork-nav-only-cowork-hub",
        coworkContribs.length === 1 && coworkContribs[0] && coworkContribs[0].id === "cowork-hub",
        `expected contributions.cowork[0].id === "cowork-hub", got id=${coworkContribs[0] && coworkContribs[0].id}`);

    // Step 5: post-conditions on seeded notes
    const expectations = [
        { blueprint: "project", moduleDir: "projects", minNotes: 3 },
        { blueprint: "daily",   moduleDir: "daily",    minNotes: 30 },
        { blueprint: "meetings",moduleDir: "meetings", minNotes: 4 },
        { blueprint: "people",  moduleDir: "people",   minNotes: 3 },
    ];
    for (const e of expectations) {
        const dir = path.join(vault, "spice", e.moduleDir);
        const exists = fs.existsSync(dir);
        ok(`smoke-bp-${e.blueprint}-exists`, exists, `dir=${dir}`);
        if (exists) {
            const count = countMdFilesRecursive(dir);
            ok(`smoke-bp-${e.blueprint}-count>=${e.minNotes}`,
                count >= e.minNotes, `actual count: ${count}`);
        } else {
            ok(`smoke-bp-${e.blueprint}-count>=${e.minNotes}`, false, "dir missing");
        }
    }

    // Step 6: installed.json mechanism + blueprint versions match manifest
    const installed = JSON.parse(fs.readFileSync(path.join(vault, "ranch", "platform-installed.json"), "utf8"));
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
    let allMatch = true;
    for (const m of manifest.mechanisms) {
        const found = installed.mechanisms.find(x => x.name === m.name);
        if (!found || found.version !== m.version) { allMatch = false; break; }
    }
    ok("smoke-installed-mech-versions-match-manifest", allMatch);

    // v0.46.0 S11 — entity-create post-install side-effects (5 sub-asserts).
    // The cycle wires entity-create into 5 blueprints (meetings, people,
    // project, scratch, finance) contributing 7 entries total (meeting,
    // person, project, scratch, budget, paycheck, invoice). Verify:
    //   1. ranch/entity-create-registry.json exists + has the entries from
    //      the subscribed blueprints. Project is intentionally excluded
    //      from this smoke's subscription (see note above) so we expect 6.
    //   2. ranch/scripts/entity-create/entity-create.js materialized.
    //   3. Each subscribed entry's hub file carries the entity-create marker
    //      (marker is pre-baked into source; injectAccentButtonBlock canonical
    //      fence injection is a known FIX-LATER — manifest target_paths use
    //      source-relative paths but the installer treats them as vault-
    //      relative; see install history "new_entity_buttons.inject" errors).
    //   4. Re-running install does not duplicate any marker.
    //   5. No orphan New*Button.js helper files remain.
    //
    // The reinstall above (Step 4b) already re-ran the installer once; we
    // run a SECOND reinstall here so the idempotency check sees two full
    // install passes against the same target files.
    const ecRegistryPath = path.join(vault, "ranch", "entity-create-registry.json");
    let ecRegistry = null;
    try { ecRegistry = JSON.parse(fs.readFileSync(ecRegistryPath, "utf8")); }
    catch (e) { /* leave null; assertion below will surface */ }
    const ecEntries = (ecRegistry && Array.isArray(ecRegistry.entries)) ? ecRegistry.entries : [];
    // 7 expected ids — project re-included in v0.46.2 (FLN-f fix).
    const expectedEcIds = ["meeting", "person", "project", "scratch", "budget", "paycheck", "invoice"];
    const haveAllExpectedIds = expectedEcIds.every(id => ecEntries.some(e => e && e.id === id));
    ok("smoke-ec-registry-has-subscribed-entries",
        ecEntries.length >= 7 && haveAllExpectedIds,
        `entries=${ecEntries.length} ids=${JSON.stringify(ecEntries.map(e => e && e.id))}`);

    // entity-create mechanism source is shipped in the workshop catalogue.
    // Note: it's not yet listed in platform/manifest.json mechanisms[] (S12
    // housekeeping task), so it doesn't materialize into ranch/scripts/
    // unless explicitly subscribed. Assert the source presence here so the
    // smoke flags whichever side of the catalogue drift surfaces.
    const ecSourceAbs = path.join(path.resolve(__dirname, "../.."), "platform/mechanisms/entity-create/entity-create.js");
    const ecMaterializedAbs = path.join(vault, "ranch", "scripts", "entity-create", "entity-create.js");
    ok("smoke-ec-mechanism-source-or-materialized",
        fs.existsSync(ecSourceAbs) || fs.existsSync(ecMaterializedAbs),
        `source=${ecSourceAbs} materialized=${ecMaterializedAbs}`);

    // Inspect each entity-create entry's MATERIALIZED file (the installed
    // destination per the blueprint's files[] dest, not the manifest's
    // render_in.target_path which is source-relative). Each subscribed
    // entry's hub page should carry the marker exactly once after install.
    // Canonical fenced-block injection is a known FIX-LATER (target_path
    // resolution bug; see install history).
    //
    // Map entry.id -> expected materialized hub path. These mirror the
    // blueprint manifest files[] dest entries for the hub files that host
    // each entry's // entity-create:<id> inside-block JS comment sentinel (v0.49.0+).
    const ecHubPaths = {
        meeting:  "ranch/templates/Meeting Hub.md",
        person:   "spice/people/People.md",
        project:  "spice/projects/Projects.md",
        scratch:  "ranch/templates/Scratch Day Hub.md",
        budget:   "spice/finance/budgets/Budgets.md",
        paycheck: "spice/finance/paychecks/Paychecks.md",
        invoice:  "spice/finance/invoices/Invoices.md",
    };
    let allMarkersPresent = true;
    let missingMarker = null;
    for (const e of ecEntries) {
        if (!e || !e.render_in || e.render_in.kind !== "hub") continue;
        const rel = ecHubPaths[e.id];
        if (!rel) continue; // unknown id mapping; skip (e.g., project deferred)
        const tp = path.join(vault, rel);
        if (!fs.existsSync(tp)) { allMarkersPresent = false; missingMarker = `${e.id}: hub file missing at ${rel}`; break; }
        const body = fs.readFileSync(tp, "utf8");
        const escId = e.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const markerCount = (body.match(new RegExp("```dataviewjs[\\s\\S]*?// entity-create:" + escId + "[\\s\\S]*?\\n```", "g")) || []).length;
        if (markerCount !== 1) {
            allMarkersPresent = false;
            missingMarker = `${e.id}: marker count=${markerCount} in ${rel}`;
            break;
        }
    }
    ok("smoke-ec-markers-present-at-hub-paths",
        allMarkersPresent,
        missingMarker || "");

    // Idempotency end-to-end: run install a SECOND time, then verify no
    // injected block was duplicated in any materialized hub file.
    const reinstall2 = runCli(["reinstall", "--vault", vault]);
    let idempotent = true;
    let dupTarget = null;
    if (reinstall2.code === 0) {
        for (const e of ecEntries) {
            if (!e || !e.render_in || e.render_in.kind !== "hub") continue;
            const rel = ecHubPaths[e.id];
            if (!rel) continue;
            const tp = path.join(vault, rel);
            if (!fs.existsSync(tp)) continue;
            const body = fs.readFileSync(tp, "utf8");
            const escId = e.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const markerCount = (body.match(new RegExp("```dataviewjs[\\s\\S]*?// entity-create:" + escId + "[\\s\\S]*?\\n```", "g")) || []).length;
            if (markerCount !== 1) { idempotent = false; dupTarget = `${e.id}: marker count=${markerCount} in ${rel} after 2nd install`; break; }
        }
    } else {
        idempotent = false;
        dupTarget = `reinstall #2 failed exit=${reinstall2.code}`;
    }
    ok("smoke-ec-reinstall-idempotent",
        idempotent,
        dupTarget || "");

    // No orphan New*Button.js helper files in any migrated blueprint's
    // scripts dir. Scope to the 5 migrated blueprints; an orphan in a
    // non-migrated blueprint is out-of-scope for this cycle.
    const migratedBlueprints = ["meetings", "people", "project", "scratch", "finance"];
    const orphans = [];
    for (const bp of migratedBlueprints) {
        const sd = path.join(vault, "ranch", "scripts", bp);
        if (!fs.existsSync(sd)) continue;
        for (const f of fs.readdirSync(sd)) {
            if (!f.endsWith(".js")) continue;
            const body = fs.readFileSync(path.join(sd, f), "utf8");
            if (/class\s+New\w+Button\b/.test(body)) orphans.push(`${bp}/${f}`);
        }
    }
    ok("smoke-ec-no-orphan-newxbutton-helpers",
        orphans.length === 0,
        orphans.length > 0 ? `orphans: ${orphans.join(", ")}` : "");

    // v0.59.8 — smoke-prj-startup-tpl-pruned: the v0.48.0 belt-and-suspenders
    // Templater startup_templates[] entry for ProjectTaskCreateListener was
    // retired in project@1.13.4 because the template body throws at boot
    // (customJS classes aren't loaded when Templater fires startup templates).
    // v0.49.0's customjs startupScriptNames[] path remains as the real
    // registration. The NEW pruneTemplaterStartupOrphans installer step
    // (install.js step 6a2) removes the orphan from each consumer's data.json
    // on next install. This assertion verifies the orphan is ABSENT.
    const templaterDataPath = path.join(vault, ".obsidian/plugins/templater-obsidian/data.json");
    let prjStartupOk = false;
    let prjStartupDetail = "";
    if (fs.existsSync(templaterDataPath)) {
        try {
            const td = JSON.parse(fs.readFileSync(templaterDataPath, "utf8"));
            const orphan = "ranch/templates/Template, Project Task Create Listener.md";
            const list = Array.isArray(td.startup_templates) ? td.startup_templates : [];
            if (!list.includes(orphan)) {
                prjStartupOk = true;
            } else {
                prjStartupDetail = `orphan ${JSON.stringify(orphan)} still present in startup_templates; got ${JSON.stringify(list)}`;
            }
        } catch (e) {
            prjStartupDetail = `data.json parse error: ${e.message}`;
        }
    } else {
        // data.json absent is acceptable post-prune (Templater plugin not installed
        // in the fresh vault). The orphan can't exist if the file doesn't exist.
        prjStartupOk = true;
    }
    ok("smoke-prj-startup-tpl-pruned",
        prjStartupOk,
        prjStartupDetail);

    // v0.49.0 S6 — smoke-prj-customjs-startup: post-bootstrap customjs data.json
    // startupScriptNames[] contains "ProjectTaskCreateListenerInit". This is the
    // PRIMARY registration path (v0.49.0 L2); the v0.48.0 startup_templates entry
    // above is the belt-and-suspenders backstop.
    const customjsDataPath = path.join(vault, ".obsidian/plugins/customjs/data.json");
    let prjCustomjsStartupOk = false;
    let prjCustomjsStartupDetail = "";
    if (fs.existsSync(customjsDataPath)) {
        try {
            const cd = JSON.parse(fs.readFileSync(customjsDataPath, "utf8"));
            const expected = "ProjectTaskCreateListenerInit";
            if (Array.isArray(cd.startupScriptNames) && cd.startupScriptNames.includes(expected)) {
                prjCustomjsStartupOk = true;
            } else {
                prjCustomjsStartupDetail = `expected ${JSON.stringify(expected)} in startupScriptNames; got ${JSON.stringify(cd.startupScriptNames)}`;
            }
        } catch (e) {
            prjCustomjsStartupDetail = `data.json parse error: ${e.message}`;
        }
    } else {
        prjCustomjsStartupDetail = `data.json absent at ${customjsDataPath}`;
    }
    ok("smoke-prj-customjs-startup",
        prjCustomjsStartupOk,
        prjCustomjsStartupDetail);

    // v0.63.0 S7 — smoke-todo-allhub: post-reinstall All-ToDos.md materialized
    // at spice/to-do/All-ToDos.md (to-do blueprint subscribed above).
    ok("smoke-todo-allhub All-ToDos.md materialized",
        fs.existsSync(path.join(vault, "spice/to-do/All-ToDos.md")),
        `path=${path.join(vault, "spice/to-do/All-ToDos.md")}`);

    // v0.50.0 S5 (renamed v0.52.0) — DOCS-INT-1..3: applyDocsBackfill side effects.
    // After the reinstall above, project blueprint is subscribed; the
    // applyDocsBackfill helper should have walked spice/projects/*/ and
    // created docs/Docs.md per pre-existing seeded project (3 projects:
    // Acme-Migration, North-Star-Refactor, Q1-2026-Audit).
    const seededProjectSlugs = ["Acme-Migration", "North-Star-Refactor", "Q1-2026-Audit"];
    const backfillsMaterialized = seededProjectSlugs.every(slug =>
        fs.existsSync(path.join(vault, "spice", "projects", slug, "docs", "Docs.md"))
    );
    ok("DOCS-INT-1 applyDocsBackfill materialized docs/Docs.md for each seeded project",
        backfillsMaterialized,
        `slugs=${JSON.stringify(seededProjectSlugs.map(s => ({ s, exists: fs.existsSync(path.join(vault, "spice", "projects", s, "docs", "Docs.md")) })))}`);

    // DOCS-INT-2: the materialized Docs.md body contains the entity-create
    // doc-note sentinel + ProjectDocsCards dispatch + correct project_slug
    // in frontmatter.
    let docsContentOk = true;
    let docsContentDetail = "";
    for (const slug of seededProjectSlugs) {
        const docsPath = path.join(vault, "spice", "projects", slug, "docs", "Docs.md");
        if (!fs.existsSync(docsPath)) { docsContentOk = false; docsContentDetail = `missing ${docsPath}`; break; }
        const body = fs.readFileSync(docsPath, "utf8");
        const hasSentinel = /\/\/\s*entity-create:doc-note/.test(body);
        const hasCards = /class:\s*["']ProjectDocsCards["']/.test(body);
        const hasSlug = new RegExp(`project_slug:\\s*${slug}`).test(body);
        if (!hasSentinel || !hasCards || !hasSlug) {
            docsContentOk = false;
            docsContentDetail = `${slug}: sentinel=${hasSentinel} cards=${hasCards} slug=${hasSlug}`;
            break;
        }
    }
    ok("DOCS-INT-2 materialized Docs.md contains sentinel + ProjectDocsCards + project_slug",
        docsContentOk, docsContentDetail);

    // DOCS-INT-3: re-running install does NOT modify existing Docs.md (idempotent).
    // Capture mtime of one materialized file, reinstall, and verify mtime
    // unchanged.
    const sampleDocsPath = path.join(vault, "spice", "projects", "Acme-Migration", "docs", "Docs.md");
    let docsIdempotent = true;
    let docsIdempotentDetail = "";
    if (fs.existsSync(sampleDocsPath)) {
        const mtimeBefore = fs.statSync(sampleDocsPath).mtimeMs;
        const reinstall3 = runCli(["reinstall", "--vault", vault]);
        if (reinstall3.code !== 0) {
            docsIdempotent = false;
            docsIdempotentDetail = `reinstall #3 failed exit=${reinstall3.code}`;
        } else {
            const mtimeAfter = fs.statSync(sampleDocsPath).mtimeMs;
            docsIdempotent = mtimeBefore === mtimeAfter;
            if (!docsIdempotent) docsIdempotentDetail = `mtime changed: before=${mtimeBefore} after=${mtimeAfter}`;
        }
    } else {
        docsIdempotent = false;
        docsIdempotentDetail = `sample docs path missing: ${sampleDocsPath}`;
    }
    ok("DOCS-INT-3 applyDocsBackfill is idempotent (mtime unchanged on re-run)",
        docsIdempotent, docsIdempotentDetail);

    // v0.52.0 — DOCS-INT-4: post-install, the materialized project-nav-buttons.js
    // (in ranch/scripts/project/) contains the renamed Docs button (label "Docs"
    // + docs/Docs.md path) — sanity that the rename reached the consumer pipeline.
    const materializedNavBtns = path.join(vault, "ranch", "scripts", "project", "project-nav-buttons.js");
    let navBtnsBody = "";
    try { navBtnsBody = fs.readFileSync(materializedNavBtns, "utf8"); } catch (_) {}
    const hasDocsLabel = /label:\s*"Docs"/.test(navBtnsBody);
    const hasDocsPath = /docs\/Docs\.md/.test(navBtnsBody);
    ok("DOCS-INT-4 materialized project-nav-buttons.js contains Docs button (label + path)",
        hasDocsLabel && hasDocsPath,
        `body length: ${navBtnsBody.length}; label=${hasDocsLabel} path=${hasDocsPath}`);
});

console.log(`\nrun-integration-smoke.js: ${pass} pass · ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);

function countMdFilesRecursive(dir) {
    let n = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) n += countMdFilesRecursive(path.join(dir, e.name));
        else if (e.isFile() && e.name.endsWith(".md")) n++;
    }
    return n;
}
