// platform/migrate/migrators/meetings-hub.js — v0.28.0 S2 T2.4.
//
// Migrates `Timestamps/MeetingHubs/<YYYY-MM-DD>-Meetings.md` →
// `spice/meetings/hubs/<YYYY>/<MM-MMMM>/Meetings-<YYYY-MM-DD>.md`
// per Sauce meetings@0.3.0 hub template. Body is 100% regenerated
// (hubs are pure platform; legacy "Daily Navigation Footer" + hardcoded
// paths are dropped). Frontmatter preserves created / daily_note (if
// present) / cssclasses; tags are regenerated from filename date.

const fs = require("fs");
const path = require("path");

const SRC_PATTERN = /^Timestamps\/MeetingHubs\/(\d{4})-(\d{2})-(\d{2})-Meetings\.md$/;

const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

const SAUCE_VIEW_PATH = "ranch/views/customjs-guard";

function _rejectTraversal(p) {
    if (p.split("/").includes("..")) {
        throw new Error(`meetings-hub.migrator: refusing path with traversal segment: ${p}`);
    }
}

function _splitFrontmatter(text) {
    if (!text.startsWith("---\n")) return { fm: "", body: text };
    const closeIdx = text.indexOf("\n---", 4);
    if (closeIdx === -1) return { fm: "", body: text };
    const fm = text.slice(4, closeIdx);
    let rest = text.slice(closeIdx + 4);
    if (rest.startsWith("\n")) rest = rest.slice(1);
    return { fm, body: rest };
}

// Tolerant frontmatter parser scoped to keys we preserve:
// created (scalar), daily_note (scalar; may be absent), cssclasses (block list).
function _parseFrontmatter(fm) {
    const out = { created: null, daily_note: null, cssclasses: [] };
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
            } else if (k === "daily_note") {
                out.daily_note = v.trim();
                mode = null;
            } else if (k === "cssclasses") {
                mode = "cssclasses";
                if (v.trim() !== "") {
                    out.cssclasses.push(v.trim().replace(/^["']|["']$/g, ""));
                    mode = null;
                }
            } else {
                mode = null;
            }
            continue;
        }
        const itemMatch = line.match(/^\s+-\s+(.*)$/);
        if (itemMatch && mode === "cssclasses") {
            out.cssclasses.push(itemMatch[1].trim().replace(/^["']|["']$/g, ""));
        }
    }
    return out;
}

function _resolveVaultIdentityTag(ctx) {
    return (ctx && ctx.config && ctx.config.variables && ctx.config.variables.vault_identity_tag) || "accuris";
}

function _renderFrontmatter(parsedFm, vaultIdentityTag, year, month, day) {
    const css = (parsedFm.cssclasses && parsedFm.cssclasses.length > 0)
        ? parsedFm.cssclasses.slice()
        : ["wide", "cards", "cards-cols-2"];

    const lines = ["---"];
    if (parsedFm.created) lines.push(`created: ${parsedFm.created}`);
    lines.push("tags:");
    lines.push(`  - "${vaultIdentityTag}"`);
    lines.push(`  - meetings-hub`);
    lines.push(`  - ${year}/${month}/${day}`);
    lines.push("cssclasses:");
    for (const c of css) lines.push(`  - ${c}`);
    if (parsedFm.daily_note) lines.push(`daily_note: ${parsedFm.daily_note}`);
    lines.push("---");
    return lines.join("\n");
}

function _buildBody() {
    return [
        "```dataviewjs",
        `await dv.view("${SAUCE_VIEW_PATH}", { class: "SpaceNavButtons" });`,
        "```",
        "",
        "---",
        "",
        "```dataviewjs",
        `await dv.view("${SAUCE_VIEW_PATH}", { class: "NewMeetingButton" });`,
        "```",
        "",
        "",
        "---",
        "",
        "## Today's Meetings",
        "",
        "```dataviewjs",
        `await dv.view("${SAUCE_VIEW_PATH}", { class: "MeetingsHubCards" });`,
        "```",
        "",
        "---",
        ""
    ].join("\n");
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
            warnings: [`meetings-hub.plan: srcRelPath did not match expected pattern: ${srcRelPath}`],
            rewrite_summary: ""
        };
    }
    const [, year, month, day] = m;
    const monthIdx = parseInt(month, 10) - 1;
    const monthDir = `${month}-${MONTH_NAMES[monthIdx]}`;
    const tgt = `spice/meetings/hubs/${year}/${monthDir}/Meetings-${year}-${month}-${day}.md`;
    return {
        action: "rewrite_blueprint",
        src: srcRelPath,
        tgt,
        warnings: [],
        rewrite_summary: `meetings-hub: ${year}-${month}-${day} — filename prefix→suffix + folder date-routed; body 100% regenerated; preserve created/daily_note/cssclasses`
    };
}

function migrate(planEntry, srcAbsPath, tgtRoot, ctx) {
    if (!planEntry || planEntry.action !== "rewrite_blueprint") return;
    _rejectTraversal(planEntry.src);
    _rejectTraversal(planEntry.tgt);

    const m = planEntry.src.match(SRC_PATTERN);
    if (!m) throw new Error(`meetings-hub.migrate: planEntry.src does not match pattern: ${planEntry.src}`);
    const [, year, month, day] = m;

    const raw = fs.readFileSync(srcAbsPath, "utf8");
    const { fm: fmText } = _splitFrontmatter(raw);
    const parsedFm = _parseFrontmatter(fmText);

    const vaultIdentityTag = _resolveVaultIdentityTag(ctx);
    const renderedFm = _renderFrontmatter(parsedFm, vaultIdentityTag, year, month, day);
    const renderedBody = _buildBody();

    const out = renderedFm + "\n\n" + renderedBody;

    const dst = path.join(tgtRoot, planEntry.tgt);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const tmp = dst + ".tmp-" + process.pid + "-" + Date.now();
    fs.writeFileSync(tmp, out, "utf8");
    fs.renameSync(tmp, dst);
}

module.exports = {
    name: "meetings-hub",
    priority: 40,
    canHandle,
    plan,
    migrate
};
