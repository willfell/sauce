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

module.exports = { loadManifest, buildIndex, attribute, computePlan, renderChangelog };
