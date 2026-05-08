// platform/migrate/migrators/meetings-note.js — v0.28.0 S2 (T2.3).
//
// Migrates `Timestamps/Meetings/<YYYY-MM-DD> <title>.md` →
// `spice/meetings/notes/<YYYY>/<MM-MMMM>/<title>-<YYYY-MM-DD>.md`
// per Sauce meetings@0.3.0. Filename rewrite prefix→suffix preserving
// spaces in title; folder gains date-routing.
//
// LITERAL contract preserved from S1 skeleton.

const fs = require("fs");
const path = require("path");
const { extractSection } = require("../section-extract");

const VIEWS_PATH = "ranch/views/customjs-guard";

const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

const SRC_RE = /^Timestamps\/Meetings\/(\d{4})-(\d{2})-(\d{2}) (.+)\.md$/;

function _normPath(p) {
    return p.replace(/\\/g, "/");
}

function _validateRel(srcRelPath) {
    const segs = _normPath(srcRelPath).split("/");
    if (segs.some(s => s === "..")) {
        throw new Error(`meetings-note migrator refused path-traversal segment in srcRelPath: ${srcRelPath}`);
    }
}

function _parseSrc(srcRelPath) {
    const m = _normPath(srcRelPath).match(SRC_RE);
    if (!m) return null;
    const year = m[1];
    const monthNum = m[2];
    const day = m[3];
    const title = m[4];
    const monthIdx = parseInt(monthNum, 10) - 1;
    if (monthIdx < 0 || monthIdx > 11) return null;
    const monthName = MONTH_NAMES[monthIdx];
    const date = `${year}-${monthNum}-${day}`;
    return { year, monthNum, monthName, day, title, date };
}

function _splitFrontmatter(body) {
    if (!body.startsWith("---\n") && !body.startsWith("---\r\n")) {
        return { fmLines: null, rest: body };
    }
    const lines = body.split("\n");
    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "---") { endIdx = i; break; }
    }
    if (endIdx === -1) return { fmLines: null, rest: body };
    return {
        fmLines: lines.slice(1, endIdx),
        rest: lines.slice(endIdx + 1).join("\n")
    };
}

// Returns lines[] for output frontmatter (between ---). Preserves source
// frontmatter verbatim; ensures cssclasses + attendees are present.
function _buildFrontmatter(fmLines, attendeesFromBody) {
    const out = [];
    let hasCssclasses = false;
    let hasAttendees = false;

    let i = 0;
    while (i < fmLines.length) {
        const line = fmLines[i];
        const keyMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
        if (keyMatch) {
            const key = keyMatch[1];
            // Capture this key's lines (key line + following indented/list lines).
            const blockStart = i;
            let blockEnd = i + 1;
            while (blockEnd < fmLines.length) {
                const l = fmLines[blockEnd];
                if (/^[A-Za-z_][A-Za-z0-9_-]*:/.test(l)) break;
                blockEnd++;
            }
            const blockLines = fmLines.slice(blockStart, blockEnd);

            if (key === "cssclasses") {
                hasCssclasses = true;
                out.push(...blockLines);
            } else if (key === "attendees") {
                hasAttendees = true;
                out.push(...blockLines);
            } else {
                out.push(...blockLines);
            }
            i = blockEnd;
        } else {
            out.push(line);
            i++;
        }
    }

    if (!hasAttendees && attendeesFromBody.length > 0) {
        out.push("attendees:");
        for (const a of attendeesFromBody) {
            out.push(`  - "[[${a}]]"`);
        }
    }

    if (!hasCssclasses) {
        out.push("cssclasses:");
        out.push("  - wide");
    }

    return out;
}

// Parses **Attendees**: bullet list extracted from body. Returns
// array of names (each `[[Name]]` line yields "Name").
function _parseAttendeesFromBody(body) {
    const result = extractSection(body, /^\*\*Attendees\*\*:/, { includeHeading: false });
    if (!result.found) return [];
    const names = [];
    for (const line of result.content.split("\n")) {
        const m = line.match(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
        if (m) names.push(m[1].trim());
    }
    return names;
}

function _parseAttendeesFromFrontmatter(fmLines) {
    if (!fmLines) return [];
    const names = [];
    let inAttendees = false;
    for (const line of fmLines) {
        if (/^attendees:\s*$/.test(line)) { inAttendees = true; continue; }
        if (inAttendees) {
            if (/^[A-Za-z_][A-Za-z0-9_-]*:/.test(line)) break;
            const m = line.match(/^\s*-\s*"?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]"?\s*$/);
            if (m) names.push(m[1].trim());
        }
    }
    return names;
}

function _renderBody(rest, attendees) {
    const agenda = extractSection(rest, "## Agenda/Questions", { includeHeading: false });
    const notes = extractSection(rest, "## Notes", { includeHeading: false });
    const actions = extractSection(rest, "## Action Items", { includeHeading: false });
    // Spec review IMP: preserve **Clients** block when non-empty.
    // Source shape: `**Clients**` line, then `- <name>` bullets (or empty `- `).
    // We extract content via `extractSection` matching the bold-line marker;
    // the section ends at the next `**...**` marker, `##` heading, or EOF.
    const clients = extractSection(rest, /^\*\*Clients\*\*\s*$/m, { includeHeading: false });

    const trimEnds = s => (s || "").replace(/^\n+/, "").replace(/\n+$/, "");
    const _hasMeaningfulBullets = (content) => {
        if (!content) return false;
        for (const line of content.split("\n")) {
            const m = line.match(/^\s*-\s*(.*)$/);
            if (m && m[1].trim().length > 0) return true;
        }
        return false;
    };

    const navBlock = [
        "```dataviewjs",
        `await dv.view("${VIEWS_PATH}", { class: "SpaceNavButtons" });`,
        "```"
    ].join("\n");

    const attendeesChipBlock = [
        "## Attendees",
        "",
        "```dataviewjs",
        `await dv.view("${VIEWS_PATH}", {`,
        "  class: \"PeopleRendering\",",
        "  method: \"renderMentionList\",",
        "  args: [dv, { mode: \"mentioned_in_note\", notePath: dv.current().file.path, scopePath: \"spice/people\" }, { style: \"chips\" }]",
        "});",
        "```"
    ].join("\n");

    const attendeesBullets = attendees.length > 0
        ? attendees.map(a => `- [[${a}]]`).join("\n")
        : "-";

    const agendaContent = agenda.found ? trimEnds(agenda.content) : "-";
    const notesContent = notes.found ? trimEnds(notes.content) : "";
    const actionsContent = actions.found ? trimEnds(actions.content) : "";

    const out = [
        navBlock,
        "",
        "---",
        "",
        attendeesChipBlock,
        "",
        attendeesBullets,
        ""
    ];

    if (clients.found && _hasMeaningfulBullets(clients.content)) {
        out.push("---", "", "**Clients**", "", trimEnds(clients.content), "");
    }

    out.push(
        "---",
        "",
        "## Agenda",
        "",
        agendaContent,
        "",
        "---",
        "",
        "## Notes",
        "",
        notesContent,
        "",
        "---",
        "",
        "## Action Items",
        "",
        actionsContent,
        ""
    );

    return out.join("\n");
}

module.exports = {
    name: "meetings-note",
    priority: 30,
    canHandle(srcRelPath, srcStat) {
        if (srcStat && typeof srcStat.isDirectory === "function" && srcStat.isDirectory()) return false;
        const norm = _normPath(srcRelPath);
        if (norm.endsWith(".tmp")) return false;
        return SRC_RE.test(norm);
    },
    plan(srcRelPath, srcAbsPath, ctx) {
        _validateRel(srcRelPath);
        const parsed = _parseSrc(srcRelPath);
        if (!parsed) {
            throw new Error(`meetings-note.plan: srcRelPath does not match expected shape: ${srcRelPath}`);
        }
        const { year, monthNum, monthName, title, date } = parsed;
        const tgt = `spice/meetings/notes/${year}/${monthNum}-${monthName}/${title}-${date}.md`;
        return {
            action: "rewrite_blueprint",
            src: srcRelPath,
            tgt,
            warnings: [],
            rewrite_summary: { migrator: "meetings-note", regenerate_body: true, preserve_frontmatter: true }
        };
    },
    migrate(planEntry, srcAbsPath, tgtRoot, ctx) {
        const body = fs.readFileSync(srcAbsPath, "utf8");
        const { fmLines, rest } = _splitFrontmatter(body);

        const fmAttendees = _parseAttendeesFromFrontmatter(fmLines);
        const bodyAttendees = _parseAttendeesFromBody(rest);
        const attendees = fmAttendees.length > 0 ? fmAttendees : bodyAttendees;

        const fmOut = _buildFrontmatter(fmLines || [], bodyAttendees);
        const bodyOut = _renderBody(rest, attendees);

        const out = `---\n${fmOut.join("\n")}\n---\n\n${bodyOut}`;

        const finalPath = path.join(tgtRoot, planEntry.tgt);
        const parentDir = path.dirname(finalPath);
        if (_normPath(path.relative(tgtRoot, finalPath)).startsWith("..")) {
            throw new Error(`meetings-note.migrate refused path-traversal: ${planEntry.tgt}`);
        }
        fs.mkdirSync(parentDir, { recursive: true });
        const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(tmpPath, out, "utf8");
        fs.renameSync(tmpPath, finalPath);
    }
};
