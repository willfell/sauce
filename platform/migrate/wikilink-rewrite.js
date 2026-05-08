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

function rewriteString(body) {
    if (typeof body !== "string") return body;
    return body.replace(WIKILINK_RE, (whole, target, displayPart) => {
        const newTarget = _rewriteTarget(target);
        if (newTarget === target) return whole;
        return `[[${newTarget}${displayPart || ""}]]`;
    });
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
            const tmp = abs + ".tmp-" + process.pid + "-" + Date.now();
            fs.writeFileSync(tmp, after, "utf8");
            fs.renameSync(tmp, abs);
            rewrites++;
        }
    }
    return { filesScanned, rewrites };
}

module.exports = { rewriteString, rewriteAll, RULES };
