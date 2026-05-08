// platform/migrate/migrators/people.js — v0.28.0 S2 (T2.1).
//
// Migrates `Extras/People/<Name>.md` (Accuris/Ero) and
// `Resources/People/<Name>.md` (Headspace) into `spice/people/<Name>.md`
// per Sauce people@0.1.0 schema.
//
// LITERAL contract preserved from S1 skeleton.

const fs = require("fs");
const path = require("path");
const { extractSection } = require("../section-extract");

const VIEWS_PATH = "ranch/views/customjs-guard";
const FRONTMATTER_KEYS = ["company", "location", "title", "email", "website", "aliases", "phone"];

function _isPeopleSourcePath(srcRelPath) {
    const norm = srcRelPath.replace(/\\/g, "/");
    if (!norm.endsWith(".md")) return false;
    return norm.startsWith("Extras/People/") || norm.startsWith("Resources/People/");
}

function _splitFrontmatter(body) {
    if (!body.startsWith("---\n") && !body.startsWith("---\r\n")) {
        return { fm: null, rest: body };
    }
    const lines = body.split("\n");
    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "---") { endIdx = i; break; }
    }
    if (endIdx === -1) return { fm: null, rest: body };
    return {
        fm: lines.slice(1, endIdx),
        rest: lines.slice(endIdx + 1).join("\n")
    };
}

// Parses frontmatter lines into a map of { key: { rawLines, hasValue, listItems } }.
// Preserves line ordering for round-trip.
function _parseFrontmatterLines(fmLines) {
    const fields = {};
    const order = [];
    let currentKey = null;
    for (const line of fmLines) {
        const keyMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
        if (keyMatch) {
            currentKey = keyMatch[1];
            const inlineVal = keyMatch[2];
            if (!fields[currentKey]) order.push(currentKey);
            fields[currentKey] = {
                rawLines: [line],
                hasInlineValue: inlineVal.trim().length > 0,
                inlineValue: inlineVal,
                listItems: []
            };
        } else if (currentKey && /^\s*-\s/.test(line)) {
            fields[currentKey].rawLines.push(line);
            const itemMatch = line.match(/^\s*-\s*(.*)$/);
            fields[currentKey].listItems.push(itemMatch ? itemMatch[1].trim() : "");
        } else if (currentKey && /^\s+\S/.test(line)) {
            fields[currentKey].rawLines.push(line);
        }
    }
    return { fields, order };
}

function _resolveVaultIdentityTag(ctx) {
    const v = ctx && ctx.config && ctx.config.variables && ctx.config.variables.vault_identity_tag;
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
    return "accuris";
}

function _renderTargetFrontmatter(fields, order, ctx) {
    const out = [];
    const seen = new Set();

    for (const key of order) {
        if (!FRONTMATTER_KEYS.includes(key) && key !== "tags") continue;
        if (key === "tags") continue;
        const f = fields[key];
        // Drop empty aliases (no inline value AND no list items).
        if (key === "aliases" && !f.hasInlineValue && f.listItems.length === 0) {
            seen.add(key);
            continue;
        }
        // Drop empty location/title/email/website/company that have no value (per identity-copy:
        // we still preserve them as empty if source had the key — except aliases per spec).
        out.push(...f.rawLines);
        seen.add(key);
    }

    // phone: only if present in source (already handled by `order` walk).
    // If not in source, do not add.

    // tags: merge source tags + ensure vault_identity_tag + ensure "person".
    const srcTags = fields.tags ? fields.tags.listItems.filter(s => s.length > 0) : [];
    const merged = [];
    const tagSeen = new Set();
    for (const t of srcTags) {
        if (!tagSeen.has(t)) { merged.push(t); tagSeen.add(t); }
    }
    const vaultTag = _resolveVaultIdentityTag(ctx);
    if (!tagSeen.has(vaultTag)) { merged.push(vaultTag); tagSeen.add(vaultTag); }
    if (!tagSeen.has("person")) { merged.push("person"); tagSeen.add("person"); }

    out.push("tags:");
    for (const t of merged) out.push(`  - ${t}`);

    return out.join("\n");
}

function _renderBody(name, notesContent) {
    const notesBlock = (notesContent && notesContent.replace(/^\n+|\n+$/g, "").length > 0)
        ? notesContent.replace(/^\n+/, "").replace(/\n+$/, "")
        : "-";
    return [
        "```dataviewjs",
        `await dv.view("${VIEWS_PATH}", { class: "PersonNavButtons" });`,
        "```",
        "",
        `# [[${name}]]`,
        "",
        "## Notes",
        notesBlock,
        "",
        "## Meetings",
        "```dataviewjs",
        `await dv.view("${VIEWS_PATH}", {`,
        "  class: \"PeopleRendering\",",
        "  method: \"renderMentionList\",",
        "  args: [dv, { mode: \"mentioning_person\", personLink: dv.current().file.link, scopePath: \"spice/meetings\" }, { style: \"cards\", limit: 50 }]",
        "});",
        "```",
        "",
        "## Daily Mentions",
        "```dataviewjs",
        `await dv.view("${VIEWS_PATH}", {`,
        "  class: \"PeopleRendering\",",
        "  method: \"renderMentionList\",",
        "  args: [dv, { mode: \"mentioning_person\", personLink: dv.current().file.link, scopePath: \"spice/daily\" }, { style: \"list\", limit: 30 }]",
        "});",
        "```",
        ""
    ].join("\n");
}

function _validateRel(srcRelPath) {
    const segs = srcRelPath.replace(/\\/g, "/").split("/");
    if (segs.some(s => s === "..")) {
        throw new Error(`people migrator refused path-traversal segment in srcRelPath: ${srcRelPath}`);
    }
}

module.exports = {
    name: "people",
    priority: 10,
    canHandle(srcRelPath, srcStat) {
        if (srcStat && typeof srcStat.isDirectory === "function" && srcStat.isDirectory()) return false;
        return _isPeopleSourcePath(srcRelPath);
    },
    plan(srcRelPath, srcAbsPath, ctx) {
        _validateRel(srcRelPath);
        const base = path.basename(srcRelPath);
        const tgt = `spice/people/${base}`;
        return {
            action: "rewrite_blueprint",
            src: srcRelPath,
            tgt,
            warnings: [],
            rewrite_summary: { migrator: "people", regenerate_body: true, drop_empty_aliases: true }
        };
    },
    migrate(planEntry, srcAbsPath, tgtRoot, ctx) {
        const body = fs.readFileSync(srcAbsPath, "utf8");
        const { fm, rest } = _splitFrontmatter(body);
        const fmLines = fm || [];
        const { fields, order } = _parseFrontmatterLines(fmLines);

        const fmRendered = _renderTargetFrontmatter(fields, order, ctx || {});
        const name = path.basename(planEntry.src).replace(/\.md$/, "");

        const notesSection = extractSection(rest, "## Notes", { includeHeading: false });
        const notesContent = notesSection.found ? notesSection.content : "";

        const out = `---\n${fmRendered}\n---\n${_renderBody(name, notesContent)}`;

        const finalPath = path.join(tgtRoot, planEntry.tgt);
        const parentDir = path.dirname(finalPath);
        fs.mkdirSync(parentDir, { recursive: true });
        const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(tmpPath, out, "utf8");
        fs.renameSync(tmpPath, finalPath);
    }
};
