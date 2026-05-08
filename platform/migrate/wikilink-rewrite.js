// platform/migrate/wikilink-rewrite.js — v0.28.0 S2 (T2.6b).
//
// Phase 4.5 cross-blueprint pass. Walks every migrated `.md` file
// (NOT verbatim carries) and applies the WIKILINK_REWRITE_RULES
// registry per design Section 5. Idempotent: re-applying produces
// no further changes.
//
// Public API:
//   rewriteString(body) → rewrittenBody
//   rewriteAll(targetVaultRoot, planEntries) → { filesScanned, rewrites }

const fs = require("fs");
const path = require("path");

// Registry — order matters: more-specific patterns first. Each rule
// transforms the wikilink TARGET (the bit between [[ and either | or ]]).
const RULES = [
    // MeetingHub: 2026-01-06-Meetings → Meetings-2026-01-06
    { match: /^(\d{4}-\d{2}-\d{2})-Meetings$/, replace: "Meetings-$1" },
    // To-do: 2026-01-05-ToDo → ToDo-2026-01-05
    { match: /^(\d{4}-\d{2}-\d{2})-ToDo$/, replace: "ToDo-$1" },
    // Daily: 2025-04-29-Tuesday → Tuesday-2025-04-29
    { match: /^(\d{4}-\d{2}-\d{2})-((?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day)$/, replace: "$2-$1" },
    // Fully-qualified path: Extras/People/X → spice/people/X
    { match: /^Extras\/People\/(.+)$/, replace: "spice/people/$1" },
    // Headspace fully-qualified: Resources/People/X → spice/people/X
    { match: /^Resources\/People\/(.+)$/, replace: "spice/people/$1" }
];

function _rewriteTarget(target) {
    for (const rule of RULES) {
        const m = target.match(rule.match);
        if (m) return target.replace(rule.match, rule.replace);
    }
    return target;
}

// Match a wikilink: [[target]] or [[target|display]]. Capture target +
// optional `|display`. We avoid greedy matches across multiple [[...]]
// by disallowing `]` inside target.
const WIKILINK_RE = /\[\[([^\]|\n]+)(\|[^\]\n]*)?\]\]/g;

// Legacy → canonical path substitutions applied to the whole body (NOT
// wikilink-scoped). Used to fix dataviewjs `dv.view("Extras/Scripts/...")`
// invocations, hardcoded `boards/planning/<slug>/...` baseDir strings in
// project atlas dataviewjs, etc. Idempotent (canonical paths don't match
// legacy patterns).
//
// Order matters: more-specific rules first. `boards/planning/` → `spice/
// projects/` MUST run before `boards/` → `spice/boards/` so the planning
// content is correctly routed to projects.
const LEGACY_PATH_SUBSTITUTIONS = [
    { from: /Extras\/Scripts\/customjs-guard/g, to: "ranch/views/customjs-guard" },
    { from: /Extras\/Templates\//g, to: "ranch/templates/" },
    { from: /Extras\/Scripts\//g, to: "ranch/scripts/" },
    { from: /Docs\/Meta\/Scripts\//g, to: "ranch/scripts/" },
    { from: /Docs\/Meta\/Templates\//g, to: "ranch/templates/" },
    { from: /Docs\/Meta\/Views\//g, to: "ranch/views/" },
    { from: /boards\/planning\//g, to: "spice/projects/" },
    { from: /boards\/kanban-cards\//g, to: "spice/boards/kanban-cards/" },
    { from: /boards\/to-do\//g, to: "spice/boards/to-do/" },
    { from: /boards\/Planning-Hub\.md/g, to: "spice/boards/Planning-Hub.md" },
    { from: /boards\/To-Do-Board\.md/g, to: "spice/boards/To-Do-Board.md" }
];

function rewriteString(body) {
    if (typeof body !== "string") return body;
    let out = body.replace(WIKILINK_RE, (whole, target, displayPart) => {
        const newTarget = _rewriteTarget(target);
        if (newTarget === target) return whole;
        return `[[${newTarget}${displayPart || ""}]]`;
    });
    for (const rule of LEGACY_PATH_SUBSTITUTIONS) {
        out = out.replace(rule.from, rule.to);
    }
    return out;
}

function rewriteAll(targetVaultRoot, planEntries) {
    let filesScanned = 0;
    let rewrites = 0;
    for (const entry of (planEntries || [])) {
        if (entry.action !== "rewrite_blueprint") continue;
        if (!entry.tgt || !entry.tgt.endsWith(".md")) continue;
        const abs = path.join(targetVaultRoot, entry.tgt);
        if (!fs.existsSync(abs)) continue;
        const before = fs.readFileSync(abs, "utf8");
        const after = rewriteString(before);
        filesScanned++;
        if (after !== before) {
            // Capture pre-rewrite mtime so the temp+rename below doesn't
            // flatten Obsidian recency-sort. Orchestrator already set
            // target mtime to source mtime in phase 4; we restore it here
            // post-rewrite. Best-effort utimesSync.
            let preserveMtime = null;
            try { preserveMtime = fs.statSync(abs); } catch (_e) {}
            const tmp = abs + ".tmp-" + process.pid + "-" + Date.now();
            fs.writeFileSync(tmp, after, "utf8");
            fs.renameSync(tmp, abs);
            if (preserveMtime) {
                try { fs.utimesSync(abs, preserveMtime.atime, preserveMtime.mtime); } catch (_e) {}
            }
            rewrites++;
        }
    }
    return { filesScanned, rewrites };
}

module.exports = { rewriteString, rewriteAll, RULES };
