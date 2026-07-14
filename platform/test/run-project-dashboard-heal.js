#!/usr/bin/env node
// run-project-dashboard-heal.js — behavioral harness for
// applyProjectDashboardConformanceHeal in platform/install.js. Zero-dep,
// in-memory adapter. Mirrors run-project-activity-panels-heal.js.
"use strict";
const path = require("path");
const install = require(path.join(__dirname, "..", "install.js"));
const { applyProjectDashboardConformanceHeal } = install;
if (typeof applyProjectDashboardConformanceHeal !== "function") {
    console.error("FATAL: applyProjectDashboardConformanceHeal not exported from install.js");
    process.exit(2);
}

function makeAdapter(initial) {
    const files = new Map(Object.entries(initial || {}));
    const dirs = new Set();
    for (const p of files.keys()) {
        const parts = p.split("/");
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    }
    return {
        async exists(p) { return files.has(p) || dirs.has(p); },
        async list(p) {
            const folders = []; const filesAt = [];
            for (const d of dirs) {
                if (d === p) continue;
                if (d.startsWith(p + "/") && d.indexOf("/", p.length + 1) === -1) folders.push(d);
            }
            for (const f of files.keys()) {
                if (f.startsWith(p + "/") && f.indexOf("/", p.length + 1) === -1) filesAt.push(f);
            }
            return { folders, files: filesAt };
        },
        async read(p) { if (!files.has(p)) throw new Error("ENOENT: " + p); return files.get(p); },
        async write(p, body) {
            files.set(p, body);
            const parts = p.split("/");
            for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
        },
        async mkdir(p) { dirs.add(p); },
        _files: files, _dirs: dirs,
    };
}
function makeTp(adapter) { return { app: { vault: { adapter } } }; }

const FENCE = "```";
function block(cls) {
    return FENCE + 'dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "' + cls + '" });\n' + FENCE;
}
function legacyHub() {
    return "---\ntype: project\nstatus: in-progress\n---\n\n" +
        [
            "ProjectChromeBar",
            "ProjectStatusWidget",
            "ProjectActivityPanel",
            "ProjectOpenTasks",
            "ProjectMeetingsPanel",
            "ProjectLinksPanel",
        ].map(block).join("\n\n") + "\n";
}
function modernHub() {
    return "---\ntype: project\nstatus: in-progress\n---\n\n" +
        ["ProjectChromeBar", "ProjectDashboard"].map(block).join("\n\n") + "\n";
}
function nonProject() {
    return "---\ntype: doc-note\n---\n\n" + block("Breadcrumb") + "\n";
}
// Partial migration: a Dashboard block WAS added, but a legacy panel block was
// left behind (the v0.221 heal skipped it because a Dashboard block existed).
function partialHub() {
    return "---\ntype: project\nstatus: in-progress\n---\n\n" +
        ["ProjectChromeBar", "ProjectDashboard", "ProjectMeetingsPanel"].map(block).join("\n\n") + "\n";
}
function countOccur(hay, needle) {
    let n = 0, i = 0;
    while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
    return n;
}

let pass = 0, fail = 0; const failures = [];
function ok(label, cond, detail) {
    if (cond) { pass++; console.log("  ok  " + label); }
    else { fail++; const m = label + (detail ? " — " + detail : ""); failures.push(m); console.log("  FAIL  " + m); }
}
const GIT = { commit: null, tag: null, dirty: null };

async function run() {
    // HEAL-1..5 — legacy → dashboard, modern untouched, backup written,
    // ChromeBar preserved, legacy blocks stripped.
    {
        const ad = makeAdapter({
            "spice/projects/dash-legacy/Dash Legacy.md": legacyHub(),
            "spice/projects/dash-modern/Dash Modern.md": modernHub(),
        });
        const before = ad._files.size;
        const h = [];
        await applyProjectDashboardConformanceHeal(makeTp(ad), {}, {}, h, GIT);
        const legacyAfter = await ad.read("spice/projects/dash-legacy/Dash Legacy.md");
        const modernAfter = await ad.read("spice/projects/dash-modern/Dash Modern.md");
        ok("HEAL-1 legacy migrated (Dashboard added)", legacyAfter.includes('class: "ProjectDashboard"'));
        ok("HEAL-2 modern untouched", modernAfter === modernHub());
        // Look for the backup path — timestamp is dynamic, match by suffix.
        const backupKey = [...ad._files.keys()].find(k => k.startsWith(".sauce-backup/") && k.endsWith("Dash Legacy.md"));
        ok("HEAL-3 backup written for legacy", !!backupKey, JSON.stringify([...ad._files.keys()]));
        ok("HEAL-4 ChromeBar preserved", legacyAfter.includes('class: "ProjectChromeBar"'));
        ok("HEAL-5 legacy panel blocks removed",
            !legacyAfter.includes('class: "ProjectStatusWidget"') &&
            !legacyAfter.includes('class: "ProjectActivityPanel"') &&
            !legacyAfter.includes('class: "ProjectOpenTasks"') &&
            !legacyAfter.includes('class: "ProjectMeetingsPanel"') &&
            !legacyAfter.includes('class: "ProjectLinksPanel"'));
        ok("HEAL-history healed event", h.some(e => e.action === "healed" && e.target && e.target.endsWith("Dash Legacy.md")));

        // HEAL-6 — second pass is idempotent.
        const snapshot = new Map();
        for (const [k, v] of ad._files) snapshot.set(k, v);
        const h2 = [];
        await applyProjectDashboardConformanceHeal(makeTp(ad), {}, {}, h2, GIT);
        let identical = ad._files.size === snapshot.size;
        if (identical) {
            for (const [k, v] of snapshot) {
                // second run adds a NEW timestamped backup dir? Should NOT — heal skips
                // when Dashboard block already present. But backup dir path from run1
                // stays; nothing new should appear.
                if (!ad._files.has(k) || ad._files.get(k) !== v) { identical = false; break; }
            }
            // ensure no new files sneaked in
            for (const k of ad._files.keys()) {
                if (!snapshot.has(k)) { identical = false; break; }
            }
        }
        ok("HEAL-6 idempotent — no writes on 2nd run", identical,
            "size before=" + snapshot.size + " after=" + ad._files.size);
        ok("HEAL-6.b history skipped_already_healed",
            h2.some(e => e.action === "skipped_already_healed" && e.target && e.target.endsWith("Dash Legacy.md")));
    }

    // HEAL-7 — non-project (doc-note) note is completely ignored.
    {
        const ad = makeAdapter({ "spice/projects/plain/notes.md": nonProject() });
        const before = await ad.read("spice/projects/plain/notes.md");
        await applyProjectDashboardConformanceHeal(makeTp(ad), {}, {}, [], GIT);
        const after = await ad.read("spice/projects/plain/notes.md");
        ok("HEAL-7 non-project note untouched", before === after);
    }

    // HEAL-8 — never throws on missing spice/projects.
    {
        const ad = makeAdapter({});
        let threw = false;
        try { await applyProjectDashboardConformanceHeal(makeTp(ad), {}, {}, [], GIT); } catch (_e) { threw = true; }
        ok("HEAL-8 no throw on empty vault", !threw);
    }

    // HEAL-9 — partial migration (Dashboard present + lingering legacy block) is
    // swept: legacy stripped, exactly ONE Dashboard block kept, backup written,
    // idempotent on 2nd run.
    {
        const ad = makeAdapter({
            "spice/projects/dash-partial/Dash Partial.md": partialHub(),
        });
        const h = [];
        await applyProjectDashboardConformanceHeal(makeTp(ad), {}, {}, h, GIT);
        const after = await ad.read("spice/projects/dash-partial/Dash Partial.md");
        ok("HEAL-9a lingering legacy block stripped", !after.includes('class: "ProjectMeetingsPanel"'), after);
        ok("HEAL-9b exactly one Dashboard block (dedupe)", countOccur(after, 'class: "ProjectDashboard"') === 1,
            String(countOccur(after, 'class: "ProjectDashboard"')));
        ok("HEAL-9c ChromeBar preserved", after.includes('class: "ProjectChromeBar"'));
        const backupKey = [...ad._files.keys()].find(k => k.startsWith(".sauce-backup/") && k.endsWith("Dash Partial.md"));
        ok("HEAL-9d backup written", !!backupKey);
        ok("HEAL-9e history healed event", h.some(e => e.action === "healed" && e.target && e.target.endsWith("Dash Partial.md")));

        // Idempotent second pass — now fully conformant → skipped, no new writes.
        const snapshot = new Map(); for (const [k, v] of ad._files) snapshot.set(k, v);
        const h2 = [];
        await applyProjectDashboardConformanceHeal(makeTp(ad), {}, {}, h2, GIT);
        let identical = ad._files.size === snapshot.size;
        if (identical) for (const [k, v] of snapshot) { if (ad._files.get(k) !== v) { identical = false; break; } }
        ok("HEAL-9f idempotent on 2nd run", identical, "size before=" + snapshot.size + " after=" + ad._files.size);
        ok("HEAL-9g 2nd run skipped_already_healed",
            h2.some(e => e.action === "skipped_already_healed" && e.target && e.target.endsWith("Dash Partial.md")));
    }

    console.log("");
    if (fail === 0) { console.log("PASS " + pass + "/" + (pass + fail)); process.exit(0); }
    else { console.log("FAIL " + fail + "/" + (pass + fail)); for (const f of failures) console.log("  - " + f); process.exit(1); }
}
run().catch(e => { console.error("UNCAUGHT: " + (e && e.stack ? e.stack : String(e))); process.exit(2); });
