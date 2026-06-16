#!/usr/bin/env node
// scripts/regen-coverage-matrix.js
// Re-runnable audit script. Produces platform/test/coverage-matrix.json.
// See Docs/plans/2026-06-16-test-coverage-arc-design.md for the rubric.

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const BLUEPRINTS_DIR = path.join(REPO_ROOT, "platform", "blueprints");
const MECHANISMS_DIR = path.join(REPO_ROOT, "platform", "mechanisms");
const TEST_DIR = path.join(REPO_ROOT, "platform", "test");
const BLAST_RADIUS_SEED = path.join(TEST_DIR, "blast-radius-seed.json");
const OUT_JSON = path.join(TEST_DIR, "coverage-matrix.json");

const rubric = require("./lib/coverage-rubric.js");

function readJson(p) {
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

function listSurfaces() {
    const blueprints = fs.readdirSync(BLUEPRINTS_DIR)
        .filter(n => fs.statSync(path.join(BLUEPRINTS_DIR, n)).isDirectory())
        .map(n => ({ kind: "blueprint", name: n, dir: path.join(BLUEPRINTS_DIR, n) }));
    const mechanisms = fs.readdirSync(MECHANISMS_DIR)
        .filter(n => fs.statSync(path.join(MECHANISMS_DIR, n)).isDirectory())
        .map(n => ({ kind: "mechanism", name: n, dir: path.join(MECHANISMS_DIR, n) }));
    return [...blueprints, ...mechanisms];
}

function readManifest(surface) {
    const p = path.join(surface.dir, "manifest.json");
    if (!fs.existsSync(p)) return null;
    return readJson(p);
}

function scoreSurface(surface, manifest, blastRadiusSeed) {
    const axes = {
        customjs_behavioral: rubric.scoreCustomJSBehavioral(surface, manifest, REPO_ROOT),
        installer_migration:  rubric.scoreInstallerMigration(surface, manifest, REPO_ROOT),
        manifest_schema:      rubric.scoreManifestSchema(surface, manifest, REPO_ROOT),
        template_lockstep:    rubric.scoreTemplateLockstep(surface, manifest, REPO_ROOT),
        widget_render:        rubric.scoreWidgetRender(surface, manifest, REPO_ROOT),
        integration_smoke:    rubric.scoreIntegrationSmoke(surface, manifest, REPO_ROOT)
    };
    const composite = rubric.composite(axes);
    const blastTier = blastRadiusSeed[surface.name] || { tier: "low", rationale: "unassigned" };
    return {
        kind: surface.kind,
        name: surface.name,
        current_version: manifest ? manifest.version : null,
        axes,
        composite_score: composite,
        blast_radius: blastTier.tier,
        blast_radius_rationale: blastTier.rationale,
        recent_incidents_30d: rubric.recentIncidents(surface.name, REPO_ROOT),
        priority_score: 0
    };
}

function applyPriority(entry) {
    const blastVal = { low: 0.3, med: 0.6, high: 1.0 }[entry.blast_radius] || 0.3;
    const incidentFactor = 1.0 + Math.min(1.0, entry.recent_incidents_30d * 0.2);
    let topGap = null, topGapScore = -1;
    for (const [axis, val] of Object.entries(entry.axes)) {
        if (val.score === null) continue;
        const debt = 1.0 - val.score;
        const axisWeight = rubric.axisWeight(axis);
        const score = blastVal * debt * incidentFactor * axisWeight;
        if (score > topGapScore) {
            topGapScore = score;
            topGap = { axis, score, archetype: val.suggested_archetype, target_file: val.suggested_target_file };
        }
    }
    entry.priority_score = topGapScore;
    entry.top_gap = topGap;
    return entry;
}

function main() {
    const blastRadiusSeed = fs.existsSync(BLAST_RADIUS_SEED)
        ? readJson(BLAST_RADIUS_SEED)
        : {};
    const surfaces = listSurfaces();
    const entries = surfaces
        .map(s => {
            const m = readManifest(s);
            if (!m) return null;
            return scoreSurface(s, m, blastRadiusSeed);
        })
        .filter(Boolean)
        .map(applyPriority)
        .sort((a, b) => b.priority_score - a.priority_score);

    const workshopVersion = readJson(path.join(REPO_ROOT, "package.json")).version;
    const out = {
        generated_at: workshopVersion,
        rubric_version: "1.0.0",
        entries
    };
    fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + "\n");
    console.log(`Wrote ${OUT_JSON} — ${entries.length} surfaces scored.`);
    console.log(`Top 5 by priority_score:`);
    for (const e of entries.slice(0, 5)) {
        console.log(`  ${e.priority_score.toFixed(3)}  ${e.kind}/${e.name}  axis=${e.top_gap?.axis}  archetype=${e.top_gap?.archetype}`);
    }
}

main();
