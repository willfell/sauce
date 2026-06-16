// scripts/lib/coverage-rubric.js
// Per-axis scorers + composite + priority weights.
// All functions are PURE (no fs writes, no execSync that mutates).
// Each scorer returns { score: number|null, ...details, suggested_archetype, suggested_target_file }.

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function tryGrep(pattern, dir, opts = {}) {
    try {
        const flags = opts.flags || "-r -l";
        const out = execSync(`grep ${flags} ${JSON.stringify(pattern)} ${dir}`, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
        return out.trim().split("\n").filter(Boolean);
    } catch (e) {
        return [];
    }
}

function publicMethodsFromJsFile(jsPath) {
    if (!fs.existsSync(jsPath)) return [];
    const src = fs.readFileSync(jsPath, "utf8");
    const out = new Set();
    const reserved = new Set(["constructor", "if", "for", "while", "switch", "catch", "function", "return", "do", "else", "try"]);
    // Walk class blocks. For each `class Foo ... {`, find the matching `}` via depth counter,
    // then scan only method-definition lines inside.
    const classRe = /\bclass\s+[A-Za-z_$][A-Za-z0-9_$]*[^{]*\{/g;
    let cm;
    while ((cm = classRe.exec(src)) !== null) {
        let depth = 1;
        let i = cm.index + cm[0].length;
        const start = i;
        while (i < src.length && depth > 0) {
            const ch = src[i];
            if (ch === "{") depth++;
            else if (ch === "}") depth--;
            i++;
        }
        const body = src.slice(start, i - 1);
        // method-definition lines: optional static/async, name, (args), {
        // Anchored to start-of-line (with leading whitespace); class-body brace-walk
        // already excludes top-level function decls and call expressions like `doStuff();`.
        const methodRe = /^[ \t]*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{/gm;
        let mm;
        while ((mm = methodRe.exec(body)) !== null) {
            const name = mm[1];
            if (name.startsWith("_")) continue;
            if (reserved.has(name)) continue;
            out.add(name);
        }
    }
    return [...out];
}

function findClassFile(className, repoRoot, surface) {
    // search the surface's source dir + customjs scripts dirs
    const candidates = [
        path.join(surface.dir),
        path.join(repoRoot, "platform", "mechanisms"),
        path.join(repoRoot, "platform", "blueprints")
    ];
    for (const root of candidates) {
        if (!fs.existsSync(root)) continue;
        const hits = tryGrep(`^class ${className}\\b`, root, { flags: "-r -l -E" });
        if (hits.length > 0) return hits[0];
    }
    return null;
}

function scoreCustomJSBehavioral(surface, manifest, repoRoot) {
    const classes = manifest.customjs_classes || [];
    if (classes.length === 0) {
        return { score: null, reason: "no customjs_classes", suggested_archetype: null, suggested_target_file: null };
    }
    const testDir = path.join(repoRoot, "platform", "test");
    const methodCoverage = [];
    let total = 0, covered = 0;
    for (const cls of classes) {
        const clsFile = findClassFile(cls, repoRoot, surface);
        const methods = clsFile ? publicMethodsFromJsFile(clsFile) : [];
        for (const m of methods) {
            total++;
            const pattern = `${cls}\\.${m}\\b`;
            const hits = tryGrep(pattern, testDir, { flags: "-r -l -E" });
            const isCovered = hits.length > 0;
            if (isCovered) covered++;
            methodCoverage.push({ cls, method: m, covered: isCovered, hits: hits.length });
        }
    }
    const score = total === 0 ? null : covered / total;
    return {
        score,
        covered,
        total,
        methods: methodCoverage,
        suggested_archetype: "behavioral-runner",
        suggested_target_file: `platform/test/run-${surface.name}-${manifest.customjs_classes[0] ? manifest.customjs_classes[0].toLowerCase() : surface.name}.js`
    };
}

function scoreInstallerMigration(surface, manifest, repoRoot) {
    // Find `apply*` functions added to platform/install.js that mention this surface's name
    const installJs = path.join(repoRoot, "platform", "install.js");
    if (!fs.existsSync(installJs)) {
        return { score: null, reason: "no install.js", suggested_archetype: null, suggested_target_file: null };
    }
    const src = fs.readFileSync(installJs, "utf8");
    const fnRe = /^async function (apply[A-Za-z0-9_]+)/gm;
    const allFns = [];
    let m;
    while ((m = fnRe.exec(src)) !== null) allFns.push(m[1]);
    // Heuristic: a fn "belongs" to a surface if the fn name contains the surface name as a substring (case-insensitive),
    // OR the fn body references the surface's module_directory.
    const lcName = surface.name.toLowerCase();
    const moduleDir = manifest.module_directory || "";
    const ownFns = allFns.filter(fn => {
        if (fn.toLowerCase().includes(lcName.replace(/-/g, ""))) return true;
        if (moduleDir && src.includes(`"${moduleDir}"`) && src.indexOf(`function ${fn}`) >= 0) {
            // weak signal; still include
            const i = src.indexOf(`async function ${fn}`);
            const next = src.indexOf("async function ", i + 1);
            const body = src.slice(i, next > 0 ? next : src.length);
            return body.includes(moduleDir);
        }
        return false;
    });
    if (ownFns.length === 0) {
        return {
            score: null,
            reason: "no install-time migrations attributed",
            migrations: [],
            suggested_archetype: null,
            suggested_target_file: null
        };
    }
    const seedHarness = path.join(repoRoot, "platform", "test", "run-seed-migrations.js");
    const seedSrc = fs.existsSync(seedHarness) ? fs.readFileSync(seedHarness, "utf8") : "";
    let covered = 0;
    const detail = ownFns.map(fn => {
        const isCovered = seedSrc.includes(fn);
        if (isCovered) covered++;
        return { fn, covered: isCovered };
    });
    return {
        score: covered / ownFns.length,
        covered,
        total: ownFns.length,
        migrations: detail,
        suggested_archetype: "seed-migrate",
        suggested_target_file: "platform/test/run-seed-migrations.js"
    };
}

function scoreManifestSchema(surface, manifest, repoRoot) {
    // Manifest fields we expect to be asserted somewhere:
    const expectedFields = ["name", "version", "customjs_classes", "files", "templates", "rule_fragments", "depends_on"];
    const testDir = path.join(repoRoot, "platform", "test");
    const hcSrc = fs.existsSync(path.join(testDir, "run-helper-cases.js"))
        ? fs.readFileSync(path.join(testDir, "run-helper-cases.js"), "utf8")
        : "";
    const lcName = surface.name.toLowerCase();
    // A field is "asserted" if the HC source mentions both the surface name and the field name within ~200 chars.
    let asserted = 0, applicable = 0;
    const fieldDetail = [];
    for (const f of expectedFields) {
        const presentInManifest = Object.prototype.hasOwnProperty.call(manifest, f);
        if (!presentInManifest) continue;
        applicable++;
        const re = new RegExp(`${lcName.replace(/[-]/g, "[- ]?")}[\\s\\S]{0,200}${f}|${f}[\\s\\S]{0,200}${lcName.replace(/[-]/g, "[- ]?")}`, "i");
        const isAsserted = re.test(hcSrc);
        if (isAsserted) asserted++;
        fieldDetail.push({ field: f, asserted: isAsserted });
    }
    const manifestRatio = applicable === 0 ? 1.0 : asserted / applicable;

    // Schema ownership: scan platform/schemas-index.json for entries owned by this surface.
    const schemaIdx = path.join(repoRoot, "platform", "schemas-index.json");
    let schemaOwned = 0, schemaCovered = 0;
    if (fs.existsSync(schemaIdx)) {
        const idx = JSON.parse(fs.readFileSync(schemaIdx, "utf8"));
        const entries = Array.isArray(idx.entries) ? idx.entries : (Array.isArray(idx) ? idx : []);
        for (const e of entries) {
            if ((e.owner || e.blueprint || e.mechanism || "") === surface.name) {
                schemaOwned++;
                // lint-schemas.js exercise = covered
                schemaCovered++;
            }
        }
    }
    const schemaRatio = schemaOwned === 0 ? 1.0 : schemaCovered / schemaOwned;
    const score = (manifestRatio + schemaRatio) / 2;
    return {
        score,
        manifest_ratio: manifestRatio,
        schema_ratio: schemaRatio,
        manifest_fields: fieldDetail,
        schema_owned: schemaOwned,
        suggested_archetype: "hc-family",
        suggested_target_file: "platform/test/run-helper-cases.js"
    };
}

function scoreTemplateLockstep(surface, manifest, repoRoot) {
    const files = manifest.files || [];
    const templates = files.filter(f => /templates_path|\/templates\//.test(f.dest || ""));
    const ruleFragments = manifest.rule_fragments || [];
    const total = templates.length + ruleFragments.length;
    if (total === 0) {
        return { score: null, reason: "no templates or rule_fragments", suggested_archetype: null, suggested_target_file: null };
    }
    const testDir = path.join(repoRoot, "platform", "test");
    let covered = 0;
    const detail = [];
    for (const t of templates) {
        const filename = (t.source || t.dest || "").split("/").pop();
        const hits = tryGrep(filename, testDir, { flags: "-r -l" });
        const isCovered = hits.length > 0;
        if (isCovered) covered++;
        detail.push({ kind: "template", name: filename, covered: isCovered });
    }
    for (const r of ruleFragments) {
        const target = r.target || "";
        const hits = target ? tryGrep(target, testDir, { flags: "-r -l" }) : [];
        const isCovered = hits.length > 0;
        if (isCovered) covered++;
        detail.push({ kind: "rule_fragment", name: target, covered: isCovered });
    }
    return {
        score: covered / total,
        covered,
        total,
        items: detail,
        suggested_archetype: "template-assert",
        suggested_target_file: "platform/test/run-helper-cases.js"
    };
}

function scoreWidgetRender(surface, manifest, repoRoot) {
    const classes = manifest.customjs_classes || [];
    if (classes.length === 0) {
        return { score: null, reason: "no customjs_classes", suggested_archetype: null, suggested_target_file: null };
    }
    const widgets = [];
    for (const cls of classes) {
        const f = findClassFile(cls, repoRoot, surface);
        if (!f) continue;
        const src = fs.readFileSync(f, "utf8");
        if (/\brender\s*\(/.test(src)) widgets.push(cls);
    }
    if (widgets.length === 0) {
        return { score: null, reason: "no render() widgets", suggested_archetype: null, suggested_target_file: null };
    }
    const rendererSrc = fs.existsSync(path.join(repoRoot, "platform", "test", "run-renderer.js"))
        ? fs.readFileSync(path.join(repoRoot, "platform", "test", "run-renderer.js"), "utf8")
        : "";
    let covered = 0;
    const detail = widgets.map(w => {
        const isCovered = rendererSrc.includes(w);
        if (isCovered) covered++;
        return { widget: w, covered: isCovered };
    });
    return {
        score: covered / widgets.length,
        covered,
        total: widgets.length,
        widgets: detail,
        suggested_archetype: "renderer-extend",
        suggested_target_file: "platform/test/run-renderer.js"
    };
}

function scoreIntegrationSmoke(surface, manifest, repoRoot) {
    // Heuristic: a blueprint has integration_smoke coverage if any test file in platform/test/
    // mentions the surface name AND contains an end-to-end pattern (install or seed-vault or smoke).
    const testDir = path.join(repoRoot, "platform", "test");
    const candidates = fs.readdirSync(testDir).filter(f => f.startsWith("run-") && f.endsWith(".js"));
    const lcName = surface.name.toLowerCase();
    let happyPath = false, failureMode = false;
    for (const c of candidates) {
        const src = fs.readFileSync(path.join(testDir, c), "utf8");
        if (!src.toLowerCase().includes(lcName)) continue;
        if (/smoke|integration|end-?to-?end|seed/i.test(c)) happyPath = true;
        if (/error|failure|throw|reject|fail/i.test(src) && src.toLowerCase().includes(lcName)) failureMode = true;
    }
    const score = !happyPath ? 0.0 : (failureMode ? 1.0 : 0.5);
    return {
        score,
        happy_path: happyPath,
        failure_mode: failureMode,
        suggested_archetype: happyPath ? "smoke-extend" : "behavioral-runner",
        suggested_target_file: "platform/test/run-integration-smoke.js"
    };
}

function composite(axes) {
    const vals = Object.values(axes).map(a => a.score).filter(v => v !== null);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function axisWeight(name) {
    return {
        installer_migration: 1.0,
        customjs_behavioral: 1.0,
        template_lockstep: 1.0,
        integration_smoke: 0.75,
        widget_render: 0.75,
        manifest_schema: 0.5
    }[name] || 0.75;
}

function recentIncidents(name, repoRoot) {
    // Count PATCH (X.Y.Z where Z > 0) commits in last 30 days that mention this surface name in the subject.
    try {
        const since = "30 days ago";
        const out = execSync(
            `git -C ${JSON.stringify(repoRoot)} log --since=${JSON.stringify(since)} --pretty=format:%s`,
            { encoding: "utf8" }
        );
        const lines = out.split("\n").filter(Boolean);
        const lcName = name.toLowerCase();
        return lines.filter(l => {
            const lc = l.toLowerCase();
            if (!lc.includes(lcName)) return false;
            return /v?\d+\.\d+\.[1-9]\d*/.test(l);
        }).length;
    } catch (e) {
        return 0;
    }
}

module.exports = {
    scoreCustomJSBehavioral,
    scoreInstallerMigration,
    scoreManifestSchema,
    scoreTemplateLockstep,
    scoreWidgetRender,
    scoreIntegrationSmoke,
    composite,
    axisWeight,
    recentIncidents
};
