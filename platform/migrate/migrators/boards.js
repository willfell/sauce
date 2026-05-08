// platform/migrate/migrators/boards.js — v0.28.0 S5 CF-4.
//
// Path-translation migrator: relocates Accuris-shape `boards/<...>` content
// (excluding `boards/planning/<slug>/` which is owned by project migrator)
// into `spice/boards/<...>` per landmines #11 + #19. Body identity
// (legacy `Extras/Scripts/customjs-guard` → `ranch/views/customjs-guard`
// substitution happens in phase 4.5 wikilink-rewrite pass).
//
// Source examples:
//   boards/To-Do-Board.md           → spice/boards/To-Do-Board.md
//   boards/Planning-Hub.md          → spice/boards/Planning-Hub.md
//   boards/kanban-cards/X.md        → spice/boards/kanban-cards/X.md
//   boards/to-do/card-notes/Y.md    → spice/boards/to-do/card-notes/Y.md
//
// boards/planning/<slug>/ paths are NOT claimed (project migrator owns).

const fs = require("fs");
const path = require("path");

// Case-insensitive root: Accuris uses lowercase `boards/`, Ero uses
// capital `Boards/`. Both are claimed by this migrator (paths NOT under
// `<root>/planning/<slug>/` which is owned by project migrator).
const SRC_RE = /^[Bb]oards\//;
const PLANNING_RE = /^[Bb]oards\/planning\//;

function _validateRel(p) {
    const segs = p.replace(/\\/g, "/").split("/");
    if (segs.some(s => s === "..")) {
        throw new Error(`boards migrator refused path-traversal segment: ${p}`);
    }
}

function _atomicWrite(absPath, body) {
    const tmp = absPath + ".tmp-" + process.pid + "-" + Date.now();
    fs.writeFileSync(tmp, body, "utf8");
    fs.renameSync(tmp, absPath);
}

module.exports = {
    name: "boards",
    priority: 60,
    canHandle(srcRelPath, srcStat) {
        if (srcStat && typeof srcStat.isDirectory === "function" && srcStat.isDirectory()) return false;
        const norm = srcRelPath.replace(/\\/g, "/");
        if (!norm.endsWith(".md")) return false;
        if (PLANNING_RE.test(norm)) return false;
        return SRC_RE.test(norm);
    },
    plan(srcRelPath, _srcAbsPath, _ctx) {
        _validateRel(srcRelPath);
        const norm = srcRelPath.replace(/\\/g, "/");
        // Strip the leading `boards/` or `Boards/` prefix; preserve sub-path.
        const tail = norm.replace(SRC_RE, "");
        const tgt = `spice/boards/${tail}`;
        return {
            action: "rewrite_blueprint",
            src: srcRelPath,
            tgt,
            warnings: [],
            rewrite_summary: { migrator: "boards", body_regenerated: false, path_only: true }
        };
    },
    migrate(planEntry, srcAbsPath, tgtRoot, _ctx) {
        _validateRel(planEntry.src);
        _validateRel(planEntry.tgt);
        const body = fs.readFileSync(srcAbsPath, "utf8");
        const dst = path.join(tgtRoot, planEntry.tgt);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        _atomicWrite(dst, body);
    }
};
