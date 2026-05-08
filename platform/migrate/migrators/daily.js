// platform/migrate/migrators/daily.js — v0.28.0 S2 T2.2.
//
// Migrates `Timestamps/<YYYY>/<MM-MMMM>/<YYYY-MM-DD>-<Day>.md` →
// `spice/daily/<YYYY>/<MM-MMMM>/<Day>-<YYYY-MM-DD>.md` per Sauce
// daily@0.2.3. Filename rewrite prefix→suffix. Frontmatter preserved
// (created/tags/cssclasses). Regenerate top dataviewjs blocks
// (SpaceNavButtons + SpaceDailyDashboard) under the Sauce
// `ranch/views/customjs-guard` view path; preserve Morning Briefing
// callout + free-form notes below the dashboard markers.

const fs = require("fs");
const path = require("path");
const { extractSection } = require("../section-extract");

// Source basename pattern. Anchored — partial matches must NOT canHandle.
const SRC_PATTERN = /^Timestamps\/(\d{4})\/(\d{2}-\w+)\/(\d{4}-\d{2}-\d{2})-(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\.md$/;

const SAUCE_VIEW_PATH = "ranch/views/customjs-guard";

function _rejectTraversal(p) {
    if (p.split("/").includes("..")) {
        throw new Error(`daily.migrator: refusing path with traversal segment: ${p}`);
    }
}

// Minimal YAML frontmatter slicer. Returns { fm, body } where fm is
// the inner text (between the leading/trailing `---` lines) and body
// is everything after the closing `---`. If no frontmatter present,
// fm is "" and body is the entire input.
function _splitFrontmatter(text) {
    if (!text.startsWith("---\n")) return { fm: "", body: text };
    const closeIdx = text.indexOf("\n---", 4);
    if (closeIdx === -1) return { fm: "", body: text };
    const fm = text.slice(4, closeIdx);
    let rest = text.slice(closeIdx + 4);
    if (rest.startsWith("\n")) rest = rest.slice(1);
    return { fm, body: rest };
}

// Tolerant frontmatter parser scoped to the canonical key set
// (created / tags / cssclasses). Returns { created, tags[], cssclasses[] }.
// Block-list values (lines beginning with "- ") are accepted; tags/cssclasses
// outside that shape are coerced to single-element arrays.
function _parseFrontmatter(fm) {
    const out = { created: null, tags: [], cssclasses: [] };
    if (!fm) return out;
    const lines = fm.split("\n");
    let mode = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const keyMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
        if (keyMatch) {
            const k = keyMatch[1];
            const v = keyMatch[2];
            if (k === "created") {
                out.created = v.trim();
                mode = null;
            } else if (k === "tags" || k === "cssclasses") {
                mode = k;
                if (v.trim() !== "") {
                    out[k].push(v.trim().replace(/^["']|["']$/g, ""));
                    mode = null;
                }
            } else {
                mode = null;
            }
            continue;
        }
        const itemMatch = line.match(/^\s+-\s+(.*)$/);
        if (itemMatch && (mode === "tags" || mode === "cssclasses")) {
            out[mode].push(itemMatch[1].trim().replace(/^["']|["']$/g, ""));
        }
    }
    return out;
}

function _renderFrontmatter(fm, vaultIdentityTag) {
    // Tag rules: ensure vault_identity_tag is present (replaces literal
    // `accuris` carry-through if it's still the default), preserve any
    // user-authored date or topic tags, ensure `daily` present.
    const seen = new Set();
    const tagsOut = [];
    const push = (t) => {
        const tt = String(t).trim();
        if (!tt || seen.has(tt)) return;
        seen.add(tt);
        tagsOut.push(tt);
    };
    push(vaultIdentityTag);
    push("daily");
    for (const t of fm.tags) push(t);

    const css = (fm.cssclasses && fm.cssclasses.length > 0) ? fm.cssclasses.slice() : ["wide"];

    const lines = ["---"];
    if (fm.created) lines.push(`created: ${fm.created}`);
    lines.push("tags:");
    for (const t of tagsOut) lines.push(`  - "${t}"`);
    lines.push("cssclasses:");
    for (const c of css) lines.push(`  - ${c}`);
    lines.push("---");
    return lines.join("\n");
}

function _buildBody(sourceBody) {
    const navBlock = "```dataviewjs\nawait dv.view(\"" + SAUCE_VIEW_PATH + "\", { class: \"SpaceNavButtons\" });\n```";
    const dashBlock = "```dataviewjs\nawait dv.view(\"" + SAUCE_VIEW_PATH + "\", { class: \"SpaceDailyDashboard\" });\n```";

    // Lift everything from the Morning Briefing callout (or the first
    // non-platform line below the dashboard block) through end-of-source.
    // Sauce platform blocks are regenerated; user-authored content below
    // them is preserved verbatim.
    const briefing = extractSection(sourceBody, /^> \[!summary\][- ]+\s*Morning Briefing/m);

    let preservedTail = "";
    if (briefing.found) {
        const lines = sourceBody.split("\n");
        preservedTail = lines.slice(briefing.startLine).join("\n");
    } else {
        // No Morning Briefing — preserve everything after the second
        // closing dataviewjs fence (legacy SpaceDailyDashboard block).
        const re = /```dataviewjs[\s\S]*?SpaceDailyDashboard[\s\S]*?```/m;
        const m = sourceBody.match(re);
        if (m && typeof m.index === "number") {
            preservedTail = sourceBody.slice(m.index + m[0].length).replace(/^\n+/, "");
        }
    }

    const hasNotes = /^##\s+Notes\s*$/m.test(preservedTail);
    const trailing = hasNotes ? "" : "\n## Notes\n";

    return [navBlock, "", "---", "", dashBlock, "", preservedTail.replace(/\s+$/, ""), trailing].join("\n").replace(/\n{3,}/g, "\n\n");
}

function _resolveVaultIdentityTag(ctx) {
    return (ctx && ctx.config && ctx.config.variables && ctx.config.variables.vault_identity_tag) || "accuris";
}

function canHandle(srcRelPath, srcStat) {
    if (!srcRelPath || typeof srcRelPath !== "string") return false;
    if (srcStat && typeof srcStat.isDirectory === "function" && srcStat.isDirectory()) return false;
    return SRC_PATTERN.test(srcRelPath);
}

function plan(srcRelPath, srcAbsPath, ctx) {
    _rejectTraversal(srcRelPath);
    const m = srcRelPath.match(SRC_PATTERN);
    if (!m) {
        return {
            action: "skip",
            src: srcRelPath,
            tgt: null,
            warnings: [`daily.plan: srcRelPath did not match expected pattern: ${srcRelPath}`],
            rewrite_summary: ""
        };
    }
    const [, year, monthDir, date, dayName] = m;
    const tgt = `spice/daily/${year}/${monthDir}/${dayName}-${date}.md`;
    return {
        action: "rewrite_blueprint",
        src: srcRelPath,
        tgt,
        warnings: [],
        rewrite_summary: `daily: ${date} (${dayName}) — filename prefix→suffix; regenerate platform blocks; preserve Morning Briefing + free-form notes`
    };
}

function migrate(planEntry, srcAbsPath, tgtRoot, ctx) {
    if (!planEntry || planEntry.action !== "rewrite_blueprint") return;
    _rejectTraversal(planEntry.src);
    _rejectTraversal(planEntry.tgt);

    const raw = fs.readFileSync(srcAbsPath, "utf8");
    const { fm: fmText, body } = _splitFrontmatter(raw);
    const fm = _parseFrontmatter(fmText);

    const vaultIdentityTag = _resolveVaultIdentityTag(ctx);
    const renderedFm = _renderFrontmatter(fm, vaultIdentityTag);
    const renderedBody = _buildBody(body);

    const out = renderedFm + "\n\n" + renderedBody.replace(/^\n+/, "");

    const dst = path.join(tgtRoot, planEntry.tgt);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    // Atomic write: stage to sibling tmp file, then rename. Avoids
    // half-written targets if the process is interrupted.
    const tmp = dst + ".tmp-" + process.pid + "-" + Date.now();
    fs.writeFileSync(tmp, out, "utf8");
    fs.renameSync(tmp, dst);
}

module.exports = {
    name: "daily",
    priority: 20,
    canHandle,
    plan,
    migrate
};
