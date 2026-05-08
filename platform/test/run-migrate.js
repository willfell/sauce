#!/usr/bin/env node
/**
 * Migrate harness — TDD-first (v0.28.0 S1)
 *
 * 42 cases across 9 selectors. References platform/migrate/* modules
 * that are SKELETONS at S1 close (throw NotImplementedError) — so this
 * harness FAILS on first run. S2 implementation flips them GREEN.
 *
 * Selectors: dispatcher | verbatim | people | daily | meetings-note |
 *            meetings-hub | to-do | wikilink | commit | all (default)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const FIXTURE_SRC = path.join(ROOT, "platform/test/fixtures/migrate-source");

let _passed = 0, _failed = 0;
const _failures = [];

function assertTrue(cond, label) {
    if (cond) { _passed++; return; }
    _failed++; _failures.push(label); console.log("    FAIL: " + label);
}
function assertEqual(actual, expected, label) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    assertTrue(ok, label + (ok ? "" : `\n      actual:   ${JSON.stringify(actual)}\n      expected: ${JSON.stringify(expected)}`));
}
async function expectThrow(fn, label) {
    try { await fn(); _failed++; _failures.push(label + " (expected throw, none)"); console.log("    FAIL: " + label + " (expected throw)"); }
    catch (_) { _passed++; }
}
async function expectNoThrow(fn, label) {
    try { const r = await fn(); _passed++; return r; }
    catch (e) { _failed++; _failures.push(label + ": " + e.message); console.log("    FAIL: " + label + ": " + e.message); return null; }
}

async function withTempVault(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-migrate-"));
    try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function tryRequire(modPath) {
    try { return require(modPath); } catch (e) { return { __error: e }; }
}

// =====================================================================
// dispatcher cases (M1-M5)
// =====================================================================

async function caseM1DispatcherWalksAndCategorizes() {
    console.log("=== M1 — dispatcher walks source and emits planEntries with correct categorization ===");
    const dispatcher = tryRequire("../migrate/dispatcher");
    if (dispatcher.__error) { _failed++; console.log("    FAIL M1: dispatcher unavailable: " + dispatcher.__error.message); return; }
    let plan;
    try { plan = await dispatcher.run({ ctx: {}, fromAbs: FIXTURE_SRC, flags: { from: FIXTURE_SRC, commit: false, dryRun: true } }); }
    catch (e) { _failed++; console.log("    FAIL M1: dispatcher.run threw: " + e.message); return; }
    assertTrue(plan && Array.isArray(plan.planEntries), "M1 plan.planEntries is array");
    if (!plan || !plan.planEntries) return;
    const byMigrator = {};
    for (const e of plan.planEntries) byMigrator[e.migrator] = (byMigrator[e.migrator] || 0) + 1;
    assertEqual(byMigrator["people"], 2, "M1 people count");
    assertEqual(byMigrator["daily"], 1, "M1 daily count");
    assertEqual(byMigrator["meetings-note"], 1, "M1 meetings-note count");
    assertEqual(byMigrator["meetings-hub"], 1, "M1 meetings-hub count");
    assertEqual(byMigrator["to-do"], 1, "M1 to-do count");
    assertTrue((byMigrator["verbatim"] || 0) >= 2, "M1 verbatim >= 2 (Cowork/notes.md + attachments/img.png)");
}

async function caseM2DispatcherPriorityOrder() {
    console.log("=== M2 — canHandle priority order: people (10) wins over verbatim (9999) ===");
    const people = tryRequire("../migrate/migrators/people");
    const verbatim = tryRequire("../migrate/verbatim");
    if (people.__error || verbatim.__error) { _failed++; console.log("    FAIL M2: modules unavailable"); return; }
    assertTrue(people.priority < verbatim.priority, "M2 people.priority < verbatim.priority");
    assertEqual(people.priority, 10, "M2 people.priority === 10");
    assertEqual(verbatim.priority, 9999, "M2 verbatim.priority === 9999");
}

async function caseM3DispatcherCollisionAborts() {
    console.log("=== M3 — collision detection: two source files mapping to same tgt → abort ===");
    const dispatcher = tryRequire("../migrate/dispatcher");
    if (dispatcher.__error) { _failed++; console.log("    FAIL M3: dispatcher unavailable"); return; }
    return withTempVault(async (tmpSrc) => {
        // Two People notes with same target filename (impossible at filesystem level, but exercise logic)
        // Instead we test collision detection at the API layer with synthesized planEntries.
        // For S1: just verify dispatcher exposes a collision-detect helper or returns collisions[]
        let plan;
        try { plan = await dispatcher.run({ ctx: {}, fromAbs: FIXTURE_SRC, flags: { from: FIXTURE_SRC, commit: false } }); }
        catch (e) { _failed++; console.log("    FAIL M3: " + e.message); return; }
        assertTrue(plan && Array.isArray(plan.collisions), "M3 plan.collisions is array");
        // Fixture has no collisions; expect empty array
        assertEqual(plan.collisions, [], "M3 fixture has no collisions");
    });
}

async function caseM4DispatcherSkipList() {
    console.log("=== M4 — skip-list excludes .obsidian / *.tmp / Invalid date / venv / .venv / __pycache__ / .smart-env / *.pyc ===");
    const dispatcher = tryRequire("../migrate/dispatcher");
    if (dispatcher.__error) { _failed++; console.log("    FAIL M4: dispatcher unavailable"); return; }
    let plan;
    try { plan = await dispatcher.run({ ctx: {}, fromAbs: FIXTURE_SRC, flags: { from: FIXTURE_SRC, commit: false } }); }
    catch (e) { _failed++; console.log("    FAIL M4: " + e.message); return; }
    if (!plan || !plan.planEntries) return;
    const sources = plan.planEntries.map(e => e.src);
    assertTrue(!sources.some(s => s.includes(".obsidian/")), "M4 .obsidian/ excluded");
    assertTrue(!sources.some(s => s.endsWith(".tmp")), "M4 *.tmp excluded");
    assertTrue(!sources.some(s => s.includes("Invalid date/")), "M4 Invalid date/ excluded");
    assertTrue(!sources.some(s => s.includes("venv/")), "M4 venv/ excluded");
    assertTrue(!sources.some(s => s.includes(".venv/")), "M4 .venv/ excluded");
    assertTrue(!sources.some(s => s.includes("__pycache__/")), "M4 __pycache__/ excluded");
    assertTrue(!sources.some(s => s.includes(".smart-env/")), "M4 .smart-env/ excluded");
    assertTrue(!sources.some(s => s.endsWith(".pyc")), "M4 *.pyc excluded");
}

async function caseM5DispatcherReturnsShape() {
    console.log("=== M5 — dispatcher.run returns { planEntries, warnings, collisions } ===");
    const dispatcher = tryRequire("../migrate/dispatcher");
    if (dispatcher.__error) { _failed++; console.log("    FAIL M5: dispatcher unavailable"); return; }
    let plan;
    try { plan = await dispatcher.run({ ctx: {}, fromAbs: FIXTURE_SRC, flags: { from: FIXTURE_SRC, commit: false } }); }
    catch (e) { _failed++; console.log("    FAIL M5: " + e.message); return; }
    assertTrue(plan && typeof plan === "object", "M5 plan is object");
    assertTrue(plan && Array.isArray(plan.planEntries), "M5 planEntries array");
    assertTrue(plan && Array.isArray(plan.warnings), "M5 warnings array");
    assertTrue(plan && Array.isArray(plan.collisions), "M5 collisions array");
}

// =====================================================================
// verbatim cases (V1-V3)
// =====================================================================

async function caseV1VerbatimContract() {
    console.log("=== V1 — verbatim has priority 9999 + canHandle returns true for any path ===");
    const v = tryRequire("../migrate/verbatim");
    if (v.__error) { _failed++; console.log("    FAIL V1: verbatim unavailable"); return; }
    assertEqual(v.name, "verbatim", "V1 name");
    assertEqual(v.priority, 9999, "V1 priority");
    assertTrue(typeof v.canHandle === "function", "V1 canHandle is fn");
    let result;
    try { result = v.canHandle("any/path/file.md", { isDirectory: () => false }); }
    catch (e) { _failed++; console.log("    FAIL V1: canHandle threw: " + e.message); return; }
    assertEqual(result, true, "V1 canHandle returns true");
}

async function caseV2VerbatimPlan() {
    console.log("=== V2 — verbatim.plan returns action: copy_verbatim with tgt === src ===");
    const v = tryRequire("../migrate/verbatim");
    if (v.__error) { _failed++; console.log("    FAIL V2: unavailable"); return; }
    let entry;
    try { entry = v.plan("Cowork/notes.md", path.join(FIXTURE_SRC, "Cowork/notes.md"), {}); }
    catch (e) { _failed++; console.log("    FAIL V2: plan threw: " + e.message); return; }
    assertEqual(entry.action, "copy_verbatim", "V2 action");
    assertEqual(entry.src, "Cowork/notes.md", "V2 src");
    assertEqual(entry.tgt, "Cowork/notes.md", "V2 tgt = src");
    assertTrue(Array.isArray(entry.warnings), "V2 warnings array");
}

async function caseV3VerbatimMigrate() {
    console.log("=== V3 — verbatim.migrate copies file + creates parent dirs ===");
    const v = tryRequire("../migrate/verbatim");
    if (v.__error) { _failed++; console.log("    FAIL V3: unavailable"); return; }
    return withTempVault((tgtRoot) => {
        const planEntry = { migrator: "verbatim", action: "copy_verbatim", src: "Cowork/notes.md", tgt: "Cowork/notes.md" };
        try { v.migrate(planEntry, path.join(FIXTURE_SRC, "Cowork/notes.md"), tgtRoot, {}); }
        catch (e) { _failed++; console.log("    FAIL V3: migrate threw: " + e.message); return; }
        const dst = path.join(tgtRoot, "Cowork/notes.md");
        assertTrue(fs.existsSync(dst), "V3 target file exists");
        if (fs.existsSync(dst)) {
            const body = fs.readFileSync(dst, "utf8");
            assertTrue(body.includes("verbatim carry"), "V3 body matches");
        }
    });
}

// =====================================================================
// people cases (MP1-MP5)
// =====================================================================

async function caseMP1PeopleCanHandle() {
    console.log("=== MP1 — people.canHandle('Extras/People/Alex Bennett.md') === true ===");
    const m = tryRequire("../migrate/migrators/people");
    if (m.__error) { _failed++; console.log("    FAIL MP1: unavailable"); return; }
    try {
        assertEqual(m.canHandle("Extras/People/Alex Bennett.md", { isDirectory: () => false }), true, "MP1 People md handled");
        assertEqual(m.canHandle("Cowork/notes.md", { isDirectory: () => false }), false, "MP1 non-People not handled");
    } catch (e) { _failed++; console.log("    FAIL MP1: " + e.message); }
}

async function caseMP2PeoplePlanTarget() {
    console.log("=== MP2 — people.plan emits tgt: spice/people/<Name>.md ===");
    const m = tryRequire("../migrate/migrators/people");
    if (m.__error) { _failed++; console.log("    FAIL MP2: unavailable"); return; }
    try {
        const entry = m.plan("Extras/People/Alex Bennett.md", path.join(FIXTURE_SRC, "Extras/People/Alex Bennett.md"), {});
        assertEqual(entry.tgt, "spice/people/Alex Bennett.md", "MP2 tgt");
        assertEqual(entry.action, "rewrite_blueprint", "MP2 action");
    } catch (e) { _failed++; console.log("    FAIL MP2: " + e.message); }
}

async function caseMP3PeopleFrontmatterIdentity() {
    console.log("=== MP3 — people.migrate preserves source frontmatter (company/email/title) ===");
    const m = tryRequire("../migrate/migrators/people");
    if (m.__error) { _failed++; console.log("    FAIL MP3: unavailable"); return; }
    return withTempVault((tgt) => {
        try {
            const entry = m.plan("Extras/People/Alex Bennett.md", path.join(FIXTURE_SRC, "Extras/People/Alex Bennett.md"), {});
            m.migrate(entry, path.join(FIXTURE_SRC, "Extras/People/Alex Bennett.md"), tgt, {});
            const body = fs.readFileSync(path.join(tgt, entry.tgt), "utf8");
            assertTrue(body.includes("company: Accuris"), "MP3 company preserved");
            assertTrue(body.includes("email: Alex.Bennett@accuristech.com"), "MP3 email preserved");
            assertTrue(body.includes("title: Lead, Architecture Engineering"), "MP3 title preserved");
        } catch (e) { _failed++; console.log("    FAIL MP3: " + e.message); }
    });
}

async function caseMP4PeopleEmptyAliasesDropped() {
    console.log("=== MP4 — people.migrate drops empty aliases + missing phone ===");
    const m = tryRequire("../migrate/migrators/people");
    if (m.__error) { _failed++; console.log("    FAIL MP4: unavailable"); return; }
    return withTempVault((tgt) => {
        try {
            const src = "Extras/People/Empty Aliases.md";
            const entry = m.plan(src, path.join(FIXTURE_SRC, src), {});
            m.migrate(entry, path.join(FIXTURE_SRC, src), tgt, {});
            const body = fs.readFileSync(path.join(tgt, entry.tgt), "utf8");
            // Empty aliases line should not survive (or should be in form `aliases: []`)
            assertTrue(!body.match(/^aliases:\s*$/m), "MP4 empty aliases dropped");
            assertTrue(!body.includes("phone:"), "MP4 phone (absent in source) not added");
        } catch (e) { _failed++; console.log("    FAIL MP4: " + e.message); }
    });
}

async function caseMP5PeopleNotesPreserved() {
    console.log("=== MP5 — people.migrate preserves ## Notes section verbatim ===");
    const m = tryRequire("../migrate/migrators/people");
    if (m.__error) { _failed++; console.log("    FAIL MP5: unavailable"); return; }
    return withTempVault((tgt) => {
        try {
            const src = "Extras/People/Alex Bennett.md";
            const entry = m.plan(src, path.join(FIXTURE_SRC, src), {});
            m.migrate(entry, path.join(FIXTURE_SRC, src), tgt, {});
            const body = fs.readFileSync(path.join(tgt, entry.tgt), "utf8");
            assertTrue(body.includes("First note line about Alex."), "MP5 ## Notes line 1 preserved");
            assertTrue(body.includes("Second note line."), "MP5 ## Notes line 2 preserved");
            assertTrue(body.includes("# [[Alex Bennett]]"), "MP5 H1 wikilink heading present");
        } catch (e) { _failed++; console.log("    FAIL MP5: " + e.message); }
    });
}

// =====================================================================
// daily cases (MD1-MD6)
// =====================================================================

async function caseMD1DailyCanHandle() {
    console.log("=== MD1 — daily.canHandle date-prefix daily files ===");
    const m = tryRequire("../migrate/migrators/daily");
    if (m.__error) { _failed++; console.log("    FAIL MD1: unavailable"); return; }
    try {
        assertEqual(m.canHandle("Timestamps/2026/05-May/2026-05-01-Friday.md", { isDirectory: () => false }), true, "MD1 daily handled");
        assertEqual(m.canHandle("Timestamps/Meetings/2025-04-29 X.md", { isDirectory: () => false }), false, "MD1 meeting not handled");
        assertEqual(m.canHandle("Extras/People/X.md", { isDirectory: () => false }), false, "MD1 people not handled");
    } catch (e) { _failed++; console.log("    FAIL MD1: " + e.message); }
}

async function caseMD2DailyFilenameRewrite() {
    console.log("=== MD2 — daily.plan rewrites filename prefix→suffix (Friday-2026-05-01.md) ===");
    const m = tryRequire("../migrate/migrators/daily");
    if (m.__error) { _failed++; console.log("    FAIL MD2: unavailable"); return; }
    try {
        const entry = m.plan("Timestamps/2026/05-May/2026-05-01-Friday.md", "", {});
        assertTrue(entry.tgt.endsWith("Friday-2026-05-01.md"), "MD2 filename suffix-style: " + entry.tgt);
    } catch (e) { _failed++; console.log("    FAIL MD2: " + e.message); }
}

async function caseMD3DailyTargetPath() {
    console.log("=== MD3 — daily.plan tgt = spice/daily/2026/05-May/Friday-2026-05-01.md ===");
    const m = tryRequire("../migrate/migrators/daily");
    if (m.__error) { _failed++; console.log("    FAIL MD3: unavailable"); return; }
    try {
        const entry = m.plan("Timestamps/2026/05-May/2026-05-01-Friday.md", "", {});
        assertEqual(entry.tgt, "spice/daily/2026/05-May/Friday-2026-05-01.md", "MD3 tgt path");
    } catch (e) { _failed++; console.log("    FAIL MD3: " + e.message); }
}

async function caseMD4DailyPlatformBlocksRegenerated() {
    console.log("=== MD4 — daily.migrate replaces legacy Extras/Scripts/customjs-guard with ranch/views/customjs-guard ===");
    const m = tryRequire("../migrate/migrators/daily");
    if (m.__error) { _failed++; console.log("    FAIL MD4: unavailable"); return; }
    return withTempVault((tgt) => {
        try {
            const src = "Timestamps/2026/05-May/2026-05-01-Friday.md";
            const entry = m.plan(src, path.join(FIXTURE_SRC, src), {});
            m.migrate(entry, path.join(FIXTURE_SRC, src), tgt, {});
            const body = fs.readFileSync(path.join(tgt, entry.tgt), "utf8");
            assertTrue(!body.includes("Extras/Scripts/customjs-guard"), "MD4 legacy path removed");
            assertTrue(body.includes("ranch/views/customjs-guard") || body.includes("customjs-guard"), "MD4 sauce path present");
        } catch (e) { _failed++; console.log("    FAIL MD4: " + e.message); }
    });
}

async function caseMD5DailyMorningBriefingPreserved() {
    console.log("=== MD5 — daily.migrate preserves Morning Briefing callout ===");
    const m = tryRequire("../migrate/migrators/daily");
    if (m.__error) { _failed++; console.log("    FAIL MD5: unavailable"); return; }
    return withTempVault((tgt) => {
        try {
            const src = "Timestamps/2026/05-May/2026-05-01-Friday.md";
            const entry = m.plan(src, path.join(FIXTURE_SRC, src), {});
            m.migrate(entry, path.join(FIXTURE_SRC, src), tgt, {});
            const body = fs.readFileSync(path.join(tgt, entry.tgt), "utf8");
            assertTrue(body.includes("Morning Briefing"), "MD5 Morning Briefing label preserved");
            assertTrue(body.includes("Nevado Scrum"), "MD5 schedule entry preserved");
        } catch (e) { _failed++; console.log("    FAIL MD5: " + e.message); }
    });
}

async function caseMD6DailyFreeFormPreserved() {
    console.log("=== MD6 — daily.migrate preserves free-form text below dashboard ===");
    const m = tryRequire("../migrate/migrators/daily");
    if (m.__error) { _failed++; console.log("    FAIL MD6: unavailable"); return; }
    return withTempVault((tgt) => {
        try {
            const src = "Timestamps/2026/05-May/2026-05-01-Friday.md";
            const entry = m.plan(src, path.join(FIXTURE_SRC, src), {});
            m.migrate(entry, path.join(FIXTURE_SRC, src), tgt, {});
            const body = fs.readFileSync(path.join(tgt, entry.tgt), "utf8");
            assertTrue(body.includes("Free-form note text below the dashboard."), "MD6 free-form line 1");
            assertTrue(body.includes("Some user content here."), "MD6 free-form line 2");
        } catch (e) { _failed++; console.log("    FAIL MD6: " + e.message); }
    });
}

// =====================================================================
// meetings-note cases (MM1-MM7)
// =====================================================================

async function caseMM1MeetingsNoteCanHandle() {
    console.log("=== MM1 — meetings-note.canHandle date-prefix meeting note ===");
    const m = tryRequire("../migrate/migrators/meetings-note");
    if (m.__error) { _failed++; console.log("    FAIL MM1: unavailable"); return; }
    try {
        assertEqual(m.canHandle("Timestamps/Meetings/2025-04-29 Test Meeting.md", { isDirectory: () => false }), true, "MM1 handled");
        assertEqual(m.canHandle("Timestamps/MeetingHubs/2026-01-06-Meetings.md", { isDirectory: () => false }), false, "MM1 hub not handled");
    } catch (e) { _failed++; console.log("    FAIL MM1: " + e.message); }
}

async function caseMM2MeetingsNoteFilenameRewrite() {
    console.log("=== MM2 — meetings-note.plan filename: 'Test Meeting-2025-04-29.md' (spaces preserved) ===");
    const m = tryRequire("../migrate/migrators/meetings-note");
    if (m.__error) { _failed++; console.log("    FAIL MM2: unavailable"); return; }
    try {
        const entry = m.plan("Timestamps/Meetings/2025-04-29 Test Meeting.md", "", {});
        assertTrue(entry.tgt.endsWith("Test Meeting-2025-04-29.md"), "MM2 filename: " + entry.tgt);
    } catch (e) { _failed++; console.log("    FAIL MM2: " + e.message); }
}

async function caseMM3MeetingsNoteTargetPath() {
    console.log("=== MM3 — meetings-note.plan tgt under spice/meetings/notes/2025/04-April/ ===");
    const m = tryRequire("../migrate/migrators/meetings-note");
    if (m.__error) { _failed++; console.log("    FAIL MM3: unavailable"); return; }
    try {
        const entry = m.plan("Timestamps/Meetings/2025-04-29 Test Meeting.md", "", {});
        assertEqual(entry.tgt, "spice/meetings/notes/2025/04-April/Test Meeting-2025-04-29.md", "MM3 tgt path");
    } catch (e) { _failed++; console.log("    FAIL MM3: " + e.message); }
}

async function caseMM4MeetingsNoteAttendeesChipBlock() {
    console.log("=== MM4 — meetings-note.migrate prepends ## Attendees chip dataviewjs block ===");
    const m = tryRequire("../migrate/migrators/meetings-note");
    if (m.__error) { _failed++; console.log("    FAIL MM4: unavailable"); return; }
    return withTempVault((tgt) => {
        try {
            const src = "Timestamps/Meetings/2025-04-29 Test Meeting.md";
            const entry = m.plan(src, path.join(FIXTURE_SRC, src), {});
            m.migrate(entry, path.join(FIXTURE_SRC, src), tgt, {});
            const body = fs.readFileSync(path.join(tgt, entry.tgt), "utf8");
            assertTrue(body.includes("## Attendees"), "MM4 ## Attendees heading present");
            assertTrue(body.includes("```dataviewjs") && body.match(/PeopleRendering|customjs-guard/), "MM4 chip dataviewjs block present");
        } catch (e) { _failed++; console.log("    FAIL MM4: " + e.message); }
    });
}

async function caseMM5MeetingsNoteLegacyMOCDropped() {
    console.log("=== MM5 — meetings-note.migrate drops 'tags: [[🗣 Meetings MOC]]' line ===");
    const m = tryRequire("../migrate/migrators/meetings-note");
    if (m.__error) { _failed++; console.log("    FAIL MM5: unavailable"); return; }
    return withTempVault((tgt) => {
        try {
            const src = "Timestamps/Meetings/2025-04-29 Test Meeting.md";
            const entry = m.plan(src, path.join(FIXTURE_SRC, src), {});
            m.migrate(entry, path.join(FIXTURE_SRC, src), tgt, {});
            const body = fs.readFileSync(path.join(tgt, entry.tgt), "utf8");
            assertTrue(!body.includes("Meetings MOC"), "MM5 legacy MOC line dropped");
        } catch (e) { _failed++; console.log("    FAIL MM5: " + e.message); }
    });
}

async function caseMM6MeetingsNoteDateLineDropped() {
    console.log("=== MM6 — meetings-note.migrate drops 'Date: [[...]]' body line ===");
    const m = tryRequire("../migrate/migrators/meetings-note");
    if (m.__error) { _failed++; console.log("    FAIL MM6: unavailable"); return; }
    return withTempVault((tgt) => {
        try {
            const src = "Timestamps/Meetings/2025-04-29 Test Meeting.md";
            const entry = m.plan(src, path.join(FIXTURE_SRC, src), {});
            m.migrate(entry, path.join(FIXTURE_SRC, src), tgt, {});
            const body = fs.readFileSync(path.join(tgt, entry.tgt), "utf8");
            assertTrue(!body.match(/^Date: \[\[/m), "MM6 'Date: [[' body line dropped");
        } catch (e) { _failed++; console.log("    FAIL MM6: " + e.message); }
    });
}

async function caseMM7MeetingsNotePersonTagsPreserved() {
    console.log("=== MM7 — meetings-note.migrate preserves person/X frontmatter tags verbatim ===");
    const m = tryRequire("../migrate/migrators/meetings-note");
    if (m.__error) { _failed++; console.log("    FAIL MM7: unavailable"); return; }
    return withTempVault((tgt) => {
        try {
            const src = "Timestamps/Meetings/2025-04-29 Test Meeting.md";
            const entry = m.plan(src, path.join(FIXTURE_SRC, src), {});
            m.migrate(entry, path.join(FIXTURE_SRC, src), tgt, {});
            const body = fs.readFileSync(path.join(tgt, entry.tgt), "utf8");
            assertTrue(body.includes("person/Jon-Levin"), "MM7 person/Jon-Levin preserved");
            assertTrue(body.includes("person/Karen-Davtyan"), "MM7 person/Karen-Davtyan preserved");
            assertTrue(body.includes("project/Dev-Enablement"), "MM7 project/Dev-Enablement preserved");
        } catch (e) { _failed++; console.log("    FAIL MM7: " + e.message); }
    });
}

// =====================================================================
// meetings-hub cases (MMH1-MMH4)
// =====================================================================

async function caseMMH1HubCanHandle() {
    console.log("=== MMH1 — meetings-hub.canHandle hub files ===");
    const m = tryRequire("../migrate/migrators/meetings-hub");
    if (m.__error) { _failed++; console.log("    FAIL MMH1: unavailable"); return; }
    try {
        assertEqual(m.canHandle("Timestamps/MeetingHubs/2026-01-06-Meetings.md", { isDirectory: () => false }), true, "MMH1 handled");
        assertEqual(m.canHandle("Timestamps/Meetings/2025-04-29 X.md", { isDirectory: () => false }), false, "MMH1 note not handled");
    } catch (e) { _failed++; console.log("    FAIL MMH1: " + e.message); }
}

async function caseMMH2HubFilenameAndFolder() {
    console.log("=== MMH2 — meetings-hub.plan filename + folder date-routed ===");
    const m = tryRequire("../migrate/migrators/meetings-hub");
    if (m.__error) { _failed++; console.log("    FAIL MMH2: unavailable"); return; }
    try {
        const entry = m.plan("Timestamps/MeetingHubs/2026-01-06-Meetings.md", "", {});
        assertEqual(entry.tgt, "spice/meetings/hubs/2026/01-January/Meetings-2026-01-06.md", "MMH2 tgt path");
    } catch (e) { _failed++; console.log("    FAIL MMH2: " + e.message); }
}

async function caseMMH3HubBodyFullyRegenerated() {
    console.log("=== MMH3 — meetings-hub.migrate regenerates body 100% (no legacy 'Daily Navigation Footer' content) ===");
    const m = tryRequire("../migrate/migrators/meetings-hub");
    if (m.__error) { _failed++; console.log("    FAIL MMH3: unavailable"); return; }
    return withTempVault((tgt) => {
        try {
            const src = "Timestamps/MeetingHubs/2026-01-06-Meetings.md";
            const entry = m.plan(src, path.join(FIXTURE_SRC, src), {});
            m.migrate(entry, path.join(FIXTURE_SRC, src), tgt, {});
            const body = fs.readFileSync(path.join(tgt, entry.tgt), "utf8");
            assertTrue(!body.includes("Daily Navigation Footer"), "MMH3 legacy footer dropped");
            assertTrue(!body.includes("Timestamps/2026/01-January"), "MMH3 legacy hardcoded path dropped");
        } catch (e) { _failed++; console.log("    FAIL MMH3: " + e.message); }
    });
}

async function caseMMH4HubCssclassesPreserved() {
    console.log("=== MMH4 — meetings-hub.migrate preserves cssclasses frontmatter ===");
    const m = tryRequire("../migrate/migrators/meetings-hub");
    if (m.__error) { _failed++; console.log("    FAIL MMH4: unavailable"); return; }
    return withTempVault((tgt) => {
        try {
            const src = "Timestamps/MeetingHubs/2026-01-06-Meetings.md";
            const entry = m.plan(src, path.join(FIXTURE_SRC, src), {});
            m.migrate(entry, path.join(FIXTURE_SRC, src), tgt, {});
            const body = fs.readFileSync(path.join(tgt, entry.tgt), "utf8");
            assertTrue(body.includes("cards-cols-2"), "MMH4 cssclasses preserved");
        } catch (e) { _failed++; console.log("    FAIL MMH4: " + e.message); }
    });
}

// =====================================================================
// to-do cases (MT1-MT4)
// =====================================================================

async function caseMT1ToDoCanHandle() {
    console.log("=== MT1 — to-do.canHandle date-prefix to-do file ===");
    const m = tryRequire("../migrate/migrators/to-do");
    if (m.__error) { _failed++; console.log("    FAIL MT1: unavailable"); return; }
    try {
        assertEqual(m.canHandle("Timestamps/ToDo/2026-01-05-ToDo.md", { isDirectory: () => false }), true, "MT1 handled");
        assertEqual(m.canHandle("Timestamps/2026/05-May/2026-05-01-Friday.md", { isDirectory: () => false }), false, "MT1 daily not handled");
    } catch (e) { _failed++; console.log("    FAIL MT1: " + e.message); }
}

async function caseMT2ToDoFilenameAndFolder() {
    console.log("=== MT2 — to-do.plan tgt = spice/to-do/2026/01-January/ToDo-2026-01-05.md ===");
    const m = tryRequire("../migrate/migrators/to-do");
    if (m.__error) { _failed++; console.log("    FAIL MT2: unavailable"); return; }
    try {
        const entry = m.plan("Timestamps/ToDo/2026-01-05-ToDo.md", "", {});
        assertEqual(entry.tgt, "spice/to-do/2026/01-January/ToDo-2026-01-05.md", "MT2 tgt path");
    } catch (e) { _failed++; console.log("    FAIL MT2: " + e.message); }
}

async function caseMT3ToDoTasksPreserved() {
    console.log("=== MT3 — to-do.migrate preserves ## Today's Tasks checkbox list verbatim ===");
    const m = tryRequire("../migrate/migrators/to-do");
    if (m.__error) { _failed++; console.log("    FAIL MT3: unavailable"); return; }
    return withTempVault((tgt) => {
        try {
            const src = "Timestamps/ToDo/2026-01-05-ToDo.md";
            const entry = m.plan(src, path.join(FIXTURE_SRC, src), {});
            m.migrate(entry, path.join(FIXTURE_SRC, src), tgt, {});
            const body = fs.readFileSync(path.join(tgt, entry.tgt), "utf8");
            assertTrue(body.includes("- [x] task done"), "MT3 done task preserved");
            assertTrue(body.includes("- [ ] task pending"), "MT3 pending task preserved");
            assertTrue(body.includes("- [ ] another task"), "MT3 another task preserved");
        } catch (e) { _failed++; console.log("    FAIL MT3: " + e.message); }
    });
}

async function caseMT4ToDoBackButtonRegenerated() {
    console.log("=== MT4 — to-do.migrate regenerates back-button block (no legacy hardcoded paths) ===");
    const m = tryRequire("../migrate/migrators/to-do");
    if (m.__error) { _failed++; console.log("    FAIL MT4: unavailable"); return; }
    return withTempVault((tgt) => {
        try {
            const src = "Timestamps/ToDo/2026-01-05-ToDo.md";
            const entry = m.plan(src, path.join(FIXTURE_SRC, src), {});
            m.migrate(entry, path.join(FIXTURE_SRC, src), tgt, {});
            const body = fs.readFileSync(path.join(tgt, entry.tgt), "utf8");
            assertTrue(!body.includes("Timestamps/2026/01-January/2026-01-05-Monday.md"), "MT4 legacy hardcoded path dropped");
        } catch (e) { _failed++; console.log("    FAIL MT4: " + e.message); }
    });
}

// =====================================================================
// wikilink-rewrite cases (WL1-WL5)
// =====================================================================

async function caseWL1DailyPrefixToSuffix() {
    console.log("=== WL1 — wikilink rewrite: [[2025-04-29-Tuesday]] → [[Tuesday-2025-04-29]] ===");
    const w = tryRequire("../migrate/wikilink-rewrite");
    if (w.__error) { _failed++; console.log("    FAIL WL1: unavailable"); return; }
    try {
        const out = w.rewriteString("see [[2025-04-29-Tuesday]] for details");
        assertEqual(out, "see [[Tuesday-2025-04-29]] for details", "WL1 daily rewrite");
    } catch (e) { _failed++; console.log("    FAIL WL1: " + e.message); }
}

async function caseWL2HubPrefixToSuffix() {
    console.log("=== WL2 — wikilink rewrite: [[2026-01-06-Meetings]] → [[Meetings-2026-01-06]] ===");
    const w = tryRequire("../migrate/wikilink-rewrite");
    if (w.__error) { _failed++; console.log("    FAIL WL2: unavailable"); return; }
    try {
        const out = w.rewriteString("hub [[2026-01-06-Meetings]] yes");
        assertEqual(out, "hub [[Meetings-2026-01-06]] yes", "WL2 hub rewrite");
    } catch (e) { _failed++; console.log("    FAIL WL2: " + e.message); }
}

async function caseWL3ToDoPrefixToSuffix() {
    console.log("=== WL3 — wikilink rewrite: [[2026-01-05-ToDo]] → [[ToDo-2026-01-05]] ===");
    const w = tryRequire("../migrate/wikilink-rewrite");
    if (w.__error) { _failed++; console.log("    FAIL WL3: unavailable"); return; }
    try {
        const out = w.rewriteString("todo [[2026-01-05-ToDo]]");
        assertEqual(out, "todo [[ToDo-2026-01-05]]", "WL3 to-do rewrite");
    } catch (e) { _failed++; console.log("    FAIL WL3: " + e.message); }
}

async function caseWL4FullyQualifiedPath() {
    console.log("=== WL4 — wikilink rewrite: [[Extras/People/Jane|Jane]] → [[spice/people/Jane|Jane]] ===");
    const w = tryRequire("../migrate/wikilink-rewrite");
    if (w.__error) { _failed++; console.log("    FAIL WL4: unavailable"); return; }
    try {
        const out = w.rewriteString("see [[Extras/People/Jane|Jane]]");
        assertEqual(out, "see [[spice/people/Jane|Jane]]", "WL4 path rewrite");
    } catch (e) { _failed++; console.log("    FAIL WL4: " + e.message); }
}

async function caseWL5IdempotentAndNonMatching() {
    console.log("=== WL5 — wikilink rewrite is idempotent + preserves non-matching wikilinks ===");
    const w = tryRequire("../migrate/wikilink-rewrite");
    if (w.__error) { _failed++; console.log("    FAIL WL5: unavailable"); return; }
    try {
        const once = w.rewriteString("[[2025-04-29-Tuesday]] [[Random Note]]");
        const twice = w.rewriteString(once);
        assertEqual(once, twice, "WL5 idempotent");
        assertTrue(twice.includes("[[Random Note]]"), "WL5 non-matching preserved");
    } catch (e) { _failed++; console.log("    FAIL WL5: " + e.message); }
}

// =====================================================================
// commit cases (CM1-CM3)
// =====================================================================

async function caseCM1DryRunNoWrites() {
    console.log("=== CM1 — dry-run (--commit absent) writes no files to vault ===");
    const dispatcher = tryRequire("../migrate/dispatcher");
    if (dispatcher.__error) { _failed++; console.log("    FAIL CM1: unavailable"); return; }
    return withTempVault(async (tgt) => {
        // Pre-populate vault with marker file
        fs.writeFileSync(path.join(tgt, ".marker"), "marker");
        try {
            await dispatcher.run({ ctx: { vaultPath: tgt }, fromAbs: FIXTURE_SRC, flags: { from: FIXTURE_SRC, commit: false } });
        } catch (e) { _failed++; console.log("    FAIL CM1: " + e.message); return; }
        // Verify NO migration writes happened (vault still has only marker; spice/ absent)
        assertTrue(!fs.existsSync(path.join(tgt, "spice")), "CM1 no spice/ written in dry-run");
        assertTrue(!fs.existsSync(path.join(tgt, "Cowork")), "CM1 no Cowork/ written in dry-run");
        assertTrue(fs.existsSync(path.join(tgt, ".marker")), "CM1 marker preserved (no writes)");
    });
}

async function caseCM2CommitOrchestratorShape() {
    console.log("=== CM2 — commit.commit exposes 5-phase orchestrator API ===");
    const c = tryRequire("../migrate/commit");
    if (c.__error) { _failed++; console.log("    FAIL CM2: unavailable"); return; }
    assertTrue(typeof c.commit === "function", "CM2 commit.commit is fn");
    // Smoke: commit accepts opts shape
    assertTrue(c.commit.length >= 1, "CM2 commit.commit accepts at least 1 arg");
}

async function caseCM3RestoreOnFailure() {
    console.log("=== CM3 — commit.restoreFromBackup helper exists for abort+restore semantics ===");
    const c = tryRequire("../migrate/commit");
    if (c.__error) { _failed++; console.log("    FAIL CM3: unavailable"); return; }
    assertTrue(typeof c.restoreFromBackup === "function" || typeof c._restoreFromBackup === "function", "CM3 restore helper exposed");
}

// =====================================================================
// Selector dispatch
// =====================================================================

const SELECTORS = {
    "dispatcher":     [caseM1DispatcherWalksAndCategorizes, caseM2DispatcherPriorityOrder, caseM3DispatcherCollisionAborts, caseM4DispatcherSkipList, caseM5DispatcherReturnsShape],
    "verbatim":       [caseV1VerbatimContract, caseV2VerbatimPlan, caseV3VerbatimMigrate],
    "people":         [caseMP1PeopleCanHandle, caseMP2PeoplePlanTarget, caseMP3PeopleFrontmatterIdentity, caseMP4PeopleEmptyAliasesDropped, caseMP5PeopleNotesPreserved],
    "daily":          [caseMD1DailyCanHandle, caseMD2DailyFilenameRewrite, caseMD3DailyTargetPath, caseMD4DailyPlatformBlocksRegenerated, caseMD5DailyMorningBriefingPreserved, caseMD6DailyFreeFormPreserved],
    "meetings-note":  [caseMM1MeetingsNoteCanHandle, caseMM2MeetingsNoteFilenameRewrite, caseMM3MeetingsNoteTargetPath, caseMM4MeetingsNoteAttendeesChipBlock, caseMM5MeetingsNoteLegacyMOCDropped, caseMM6MeetingsNoteDateLineDropped, caseMM7MeetingsNotePersonTagsPreserved],
    "meetings-hub":   [caseMMH1HubCanHandle, caseMMH2HubFilenameAndFolder, caseMMH3HubBodyFullyRegenerated, caseMMH4HubCssclassesPreserved],
    "to-do":          [caseMT1ToDoCanHandle, caseMT2ToDoFilenameAndFolder, caseMT3ToDoTasksPreserved, caseMT4ToDoBackButtonRegenerated],
    "wikilink":       [caseWL1DailyPrefixToSuffix, caseWL2HubPrefixToSuffix, caseWL3ToDoPrefixToSuffix, caseWL4FullyQualifiedPath, caseWL5IdempotentAndNonMatching],
    "commit":         [caseCM1DryRunNoWrites, caseCM2CommitOrchestratorShape, caseCM3RestoreOnFailure],
};

(async () => {
    const selector = process.argv[2] || "all";
    const order = ["dispatcher", "verbatim", "people", "daily", "meetings-note", "meetings-hub", "to-do", "wikilink", "commit"];
    for (const s of order) {
        if (selector === "all" || selector === s) {
            for (const fn of SELECTORS[s]) await fn();
        }
    }
    console.log("\n========");
    console.log(`Result: ${_passed} passed, ${_failed} failed.`);
    if (_failed > 0) process.exit(1);
})();
