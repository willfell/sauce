// platform/seeder/declarative.js — loads + materializes seed.json (kind: "declarative").

const fs = require("fs");
const path = require("path");
const helpers = require("./helpers.js");

function loadDeclarativeSeed(blueprintRoot) {
    const seedPath = path.join(blueprintRoot, "seed", "seed.json");
    if (!fs.existsSync(seedPath)) return null;
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
    } catch (e) {
        throw new Error(`seed.json malformed at ${seedPath}: ${e.message}`);
    }
    if (parsed.schema_version !== 1) {
        throw new Error(`seed.json at ${seedPath}: unsupported schema_version ${parsed.schema_version}`);
    }
    if (parsed.kind !== "declarative") {
        return null; // wrong loader for this kind
    }
    if (!Array.isArray(parsed.notes)) {
        throw new Error(`seed.json at ${seedPath}: notes[] must be an array`);
    }
    return parsed;
}

function renderBodyTemplate(blueprintRoot, relPath, vars) {
    if (!relPath) return "";
    const abs = path.join(blueprintRoot, relPath);
    if (!fs.existsSync(abs)) {
        throw new Error(`body_template not found: ${abs}`);
    }
    const raw = fs.readFileSync(abs, "utf8");
    return helpers.substituteLenient(raw, vars);
}

function materializeDeclarative(parsed, ctx, blueprintRoot) {
    let created = 0, skipped = 0;
    for (const note of parsed.notes) {
        const vars = Object.assign({}, ctx.stockVars, note.vars || {});
        const resolvedPath = helpers.substituteLenient(note.path, vars);
        const resolvedFm = {};
        for (const [k, v] of Object.entries(note.frontmatter || {})) {
            resolvedFm[k] = typeof v === "string" ? helpers.substituteLenient(v, vars) : v;
        }
        const body = renderBodyTemplate(blueprintRoot, note.body_template, vars);
        const result = helpers.writeNote(ctx, {
            path: resolvedPath,
            frontmatter: resolvedFm,
            body,
        });
        if (result.skipped) skipped++; else created++;
    }
    return { created, skipped };
}

module.exports = { loadDeclarativeSeed, materializeDeclarative };
