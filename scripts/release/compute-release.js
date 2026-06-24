#!/usr/bin/env node
"use strict";
// compute-release.js — per-component + umbrella semver bumper for Sauce.
// Zero-dep (Node built-ins + vendored ./lib). Default: dry-run (print plan).
// Writes version records only under --write. Never tags, pushes, or rebaselines
// the seed. Never edits test assertions. See Docs/plans/2026-06-23-v0.129.0-*.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { inc, maxLevel } = require("./lib/semver-inc.js");
const { parseCommit, bumpLevel } = require("./lib/conventional.js");

const REPO_ROOT = path.resolve(__dirname, "../..");

// Shared roots whose changes bump only the umbrella (never a component).
// Anything not under platform/blueprints/<c> or platform/mechanisms/<c>.
function loadManifest() {
    return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "platform/manifest.json"), "utf8"));
}

// index: [{ name, prefix }] sorted longest-prefix-first for unambiguous match.
function buildIndex(manifest) {
    const comps = [...(manifest.blueprints || []), ...(manifest.mechanisms || [])]
        .map((c) => ({ name: c.name, prefix: `platform/${c.path}/` }));
    comps.sort((a, b) => b.prefix.length - a.prefix.length);
    return comps;
}

// attribute(files, index) -> { components: string[], umbrellaOnly: boolean }
function attribute(files, index) {
    const hit = new Set();
    for (const f of files) {
        const norm = f.replace(/^\.\//, "");
        const c = index.find((x) => norm.startsWith(x.prefix));
        if (c) hit.add(c.name);
    }
    return { components: [...hit], umbrellaOnly: hit.size === 0 };
}

// computePlan(commits, manifest) -> { components:[{name,path,from,to,level,subjects[]}], workshop:{from,to,level}, changelog }
function computePlan(commits, manifest) {
    const index = buildIndex(manifest);
    const all = [...(manifest.blueprints || []), ...(manifest.mechanisms || [])];
    const byName = Object.fromEntries(all.map((c) => [c.name, c]));
    const levels = {};      // name -> bump level
    const releaseAs = {};   // name -> exact version
    const subjects = {};    // name -> string[]
    let workshopLevel = "none";

    for (const commit of commits) {
        const parsed = parseCommit(commit.message);
        const { components, umbrellaOnly } = attribute(commit.files, index);
        const targets = umbrellaOnly ? [] : components;
        // umbrella level always tracks the highest bump seen anywhere
        const umbLevel = parsed ? bumpLevel(parsed, manifest.workshop_version.startsWith("0.")) : "none";
        workshopLevel = maxLevel(workshopLevel, umbLevel);
        for (const name of targets) {
            const comp = byName[name];
            if (!comp) continue;
            const lvl = bumpLevel(parsed, String(comp.version).startsWith("0."));
            levels[name] = maxLevel(levels[name] || "none", lvl);
            workshopLevel = maxLevel(workshopLevel, lvl);
            if (parsed && parsed.releaseAs) releaseAs[name] = parsed.releaseAs;
            (subjects[name] = subjects[name] || []).push(parsed ? parsed.subject : commit.message.split("\n")[0]);
        }
    }

    const components = [];
    for (const name of Object.keys(levels)) {
        const comp = byName[name];
        const from = comp.version;
        const to = releaseAs[name] || inc(from, levels[name]);
        if (to === from) continue; // none-level, no change
        components.push({ name, path: comp.path, from, to, level: levels[name], subjects: subjects[name] || [] });
    }
    components.sort((a, b) => a.name.localeCompare(b.name));

    const wsFrom = manifest.workshop_version;
    const wsTo = inc(wsFrom, workshopLevel);
    const changelog = renderChangelog(components, { from: wsFrom, to: wsTo, level: workshopLevel });
    return { components, workshop: { from: wsFrom, to: wsTo, level: workshopLevel }, changelog };
}

function renderChangelog(components, workshop) {
    const lines = [`## v${workshop.to} (${workshop.level})`, ""];
    for (const c of components) {
        lines.push(`### ${c.name} ${c.from} → ${c.to} (${c.level})`);
        for (const s of c.subjects) lines.push(`- ${s}`);
        lines.push("");
    }
    return lines.join("\n");
}

// --- git range reader (CLI path) ---
function getCommits(range) {
    const RS = "\x1e", US = "\x1f";
    const fmt = `${RS}%H${US}%B${US}`;
    let out;
    try {
        out = execFileSync("git", ["log", range, "--no-merges", `--format=${fmt}`, "--name-only"],
            { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" });
    } catch (e) {
        throw new Error(`getCommits failed (signal=${e.signal || "none"}): ${e.message}`);
    }
    return out.split(RS).map((s) => s.replace(/^\n/, "")).filter((s) => s.trim()).map((rec) => {
        const [hash, body, filesBlock] = rec.split(US);
        const files = (filesBlock || "").split("\n").map((s) => s.trim()).filter(Boolean);
        return { hash: (hash || "").trim(), message: body || "", files };
    });
}

function lastTag() {
    try {
        return execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"],
            { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    } catch (e) { return null; }
}

function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n"); }

// applyPlan(plan, root) — mutate every version record under `root`. Never the contract.
function applyPlan(plan, root) {
    const toByName = Object.fromEntries(plan.components.map((c) => [c.name, c.to]));

    const manPath = path.join(root, "platform/manifest.json");
    const man = JSON.parse(fs.readFileSync(manPath, "utf8"));
    man.workshop_version = plan.workshop.to;
    for (const arr of [man.blueprints || [], man.mechanisms || []]) {
        for (const c of arr) if (toByName[c.name]) c.version = toByName[c.name];
    }
    writeJson(manPath, man);

    // per-component manifests
    for (const c of plan.components) {
        const cm = path.join(root, "platform", c.path, "manifest.json");
        if (fs.existsSync(cm)) {
            const obj = JSON.parse(fs.readFileSync(cm, "utf8"));
            obj.version = c.to;
            writeJson(cm, obj);
        }
    }

    // ranch subscription pins
    const ranchPath = path.join(root, "ranch/platform-subscription.json");
    if (fs.existsSync(ranchPath)) {
        const r = JSON.parse(fs.readFileSync(ranchPath, "utf8"));
        r.workshop_version = plan.workshop.to;
        for (const arr of [r.blueprints || [], r.mechanisms || []]) {
            for (const c of arr) if (toByName[c.name]) c.version = toByName[c.name];
        }
        writeJson(ranchPath, r);
    }

    // package.json
    const pkgPath = path.join(root, "package.json");
    if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        pkg.version = plan.workshop.to;
        writeJson(pkgPath, pkg);
    }
}

module.exports = { loadManifest, buildIndex, attribute, computePlan, renderChangelog, getCommits, lastTag, applyPlan };

// --- CLI ---
if (require.main === module) {
    const WRITE = process.argv.includes("--write");
    const manifest = loadManifest();
    const tag = lastTag();
    const range = tag ? `${tag}..HEAD` : "HEAD";
    const commits = getCommits(range);
    const plan = computePlan(commits, manifest);

    console.log(`compute-release: range ${range} — ${commits.length} commit(s)`);
    if (!plan.components.length && plan.workshop.level === "none") {
        console.log("compute-release: no releasable changes.");
        process.exit(0);
    }
    console.log(plan.changelog);
    console.log(`workshop_version: ${plan.workshop.from} -> ${plan.workshop.to} (${plan.workshop.level})`);

    if (!WRITE) {
        console.log("compute-release: dry-run (default). Re-run with --write to apply.");
        process.exit(0);
    }
    applyPlan(plan, REPO_ROOT);
    console.log("compute-release: version records updated. (No tag/push/seed — those are workflow steps.)");
    process.exit(0);
}
