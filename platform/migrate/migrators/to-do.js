// platform/migrate/migrators/to-do.js — v0.28.0 S2 (T2.5).
//
// Migrates `Timestamps/ToDo/<YYYY-MM-DD>-ToDo.md` →
// `spice/to-do/<YYYY>/<MM-MMMM>/ToDo-<YYYY-MM-DD>.md`. Replaces legacy
// hardcoded back-button dataviewjs block with Sauce SpaceNavButtons
// invocation. Preserves `## Today's Tasks` section verbatim. Appends
// `## Notes` if absent. Per Sauce to-do@0.1.4.

const fs = require("fs");
const path = require("path");
const { extractSection } = require("../section-extract");

const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

const SRC_REGEX = /^Timestamps\/ToDo\/(\d{4})-(\d{2})-(\d{2})-ToDo\.md$/;

function parseSrc(srcRelPath) {
    const m = srcRelPath.match(SRC_REGEX);
    if (!m) return null;
    return { year: m[1], month: m[2], day: m[3] };
}

function targetPath(parts) {
    const { year, month, day } = parts;
    const monthName = MONTH_NAMES[parseInt(month, 10) - 1];
    return `spice/to-do/${year}/${month}-${monthName}/ToDo-${year}-${month}-${day}.md`;
}

function splitFrontmatter(body) {
    if (!body.startsWith("---\n") && !body.startsWith("---\r\n")) {
        return { frontmatter: null, rest: body };
    }
    const lines = body.split("\n");
    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "---") { endIdx = i; break; }
    }
    if (endIdx === -1) return { frontmatter: null, rest: body };
    const fmLines = lines.slice(1, endIdx);
    const rest = lines.slice(endIdx + 1).join("\n");
    return { frontmatter: parseFrontmatter(fmLines), rest };
}

// Minimal YAML-ish parser for the limited frontmatter shape we expect
// (scalar key:value lines + simple `key:\n  - item` lists). Preserves
// raw value strings (quotes intact) for round-trip fidelity.
function parseFrontmatter(lines) {
    const out = {};
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
        if (!m) { i++; continue; }
        const key = m[1];
        const inlineVal = m[2];
        if (inlineVal.length > 0) {
            out[key] = { kind: "scalar", value: inlineVal };
            i++;
            continue;
        }
        const items = [];
        let j = i + 1;
        while (j < lines.length) {
            const li = lines[j].match(/^\s+-\s+(.*)$/);
            if (!li) break;
            items.push(li[1]);
            j++;
        }
        if (items.length > 0) {
            out[key] = { kind: "list", items };
            i = j;
        } else {
            out[key] = { kind: "scalar", value: "" };
            i++;
        }
    }
    return out;
}

function emitFrontmatter(fm) {
    const lines = ["---"];
    for (const key of Object.keys(fm)) {
        const v = fm[key];
        if (v.kind === "scalar") {
            lines.push(`${key}: ${v.value}`);
        } else {
            lines.push(`${key}:`);
            for (const item of v.items) lines.push(`  - ${item}`);
        }
    }
    lines.push("---");
    return lines.join("\n");
}

function buildTags(year, month, day, vaultIdentityTag) {
    return {
        kind: "list",
        items: [vaultIdentityTag, "todo", `${year}/${month}/${day}`]
    };
}

function ensureParentDir(absPath) {
    const parent = path.dirname(absPath);
    fs.mkdirSync(parent, { recursive: true });
}

function validateTargetWithinRoot(tgtRoot, tgtAbs) {
    const rootResolved = path.resolve(tgtRoot);
    const tgtResolved = path.resolve(tgtAbs);
    if (!tgtResolved.startsWith(rootResolved + path.sep) && tgtResolved !== rootResolved) {
        throw new Error(`path-traversal: target ${tgtResolved} escapes root ${rootResolved}`);
    }
}

function atomicWrite(absPath, content) {
    const tmp = absPath + ".tmp-" + process.pid + "-" + Date.now();
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, absPath);
}

const NAV_BUTTONS_BLOCK =
    "```dataviewjs\n" +
    "await dv.view(\"ranch/views/customjs-guard\", { class: \"SpaceNavButtons\" });\n" +
    "```";

module.exports = {
    name: "to-do",
    priority: 50,

    canHandle(srcRelPath, srcStat) {
        if (srcStat && typeof srcStat.isDirectory === "function" && srcStat.isDirectory()) return false;
        return SRC_REGEX.test(srcRelPath);
    },

    plan(srcRelPath, _srcAbsPath, _ctx) {
        const parts = parseSrc(srcRelPath);
        if (!parts) {
            return { migrator: "to-do", action: "skip", src: srcRelPath, tgt: null, warnings: [`unrecognized to-do path: ${srcRelPath}`] };
        }
        return {
            migrator: "to-do",
            action: "rewrite_blueprint",
            src: srcRelPath,
            tgt: targetPath(parts),
            warnings: []
        };
    },

    migrate(planEntry, srcAbsPath, tgtRoot, ctx) {
        const parts = parseSrc(planEntry.src);
        if (!parts) throw new Error(`to-do.migrate: unrecognized src ${planEntry.src}`);

        const vaultIdentityTag = (ctx && ctx.config && ctx.config.variables && ctx.config.variables.vault_identity_tag) || "accuris";

        const raw = fs.readFileSync(srcAbsPath, "utf8");
        const { frontmatter, rest } = splitFrontmatter(raw);

        const fmOut = {};
        if (frontmatter) {
            for (const key of ["created", "daily_note"]) {
                if (frontmatter[key]) fmOut[key] = frontmatter[key];
            }
            fmOut.tags = buildTags(parts.year, parts.month, parts.day, vaultIdentityTag);
            if (frontmatter.cssclasses) fmOut.cssclasses = frontmatter.cssclasses;
            else fmOut.cssclasses = { kind: "list", items: ["wide"] };
        } else {
            fmOut.tags = buildTags(parts.year, parts.month, parts.day, vaultIdentityTag);
            fmOut.cssclasses = { kind: "list", items: ["wide"] };
        }

        const tasksSection = extractSection(rest, "## Today's Tasks");
        const tasksBlock = tasksSection.found
            ? tasksSection.raw
            : "## Today's Tasks\n";

        const notesSection = extractSection(rest, "## Notes");
        const notesBlock = notesSection.found ? notesSection.raw : "## Notes\n";

        const out =
            emitFrontmatter(fmOut) + "\n" +
            "\n" +
            NAV_BUTTONS_BLOCK + "\n" +
            "\n" +
            tasksBlock.replace(/\n+$/, "") + "\n" +
            "\n" +
            notesBlock.replace(/\n+$/, "") + "\n";

        const tgtAbs = path.join(tgtRoot, planEntry.tgt);
        validateTargetWithinRoot(tgtRoot, tgtAbs);
        ensureParentDir(tgtAbs);
        atomicWrite(tgtAbs, out);
    }
};
