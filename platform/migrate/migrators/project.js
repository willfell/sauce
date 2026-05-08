// platform/migrate/migrators/project.js — v0.28.0 S5 CF-5.
//
// Path-translation migrator: relocates Accuris-shape per-project planning
// content (`boards/planning/<slug>/<...>`) into Sauce per-project module
// (`spice/projects/<slug>/<...>`) per landmines #11 + #19. Body identity
// (legacy `Extras/Scripts/customjs-guard` → `ranch/views/customjs-guard`
// substitution happens in phase 4.5 wikilink-rewrite pass).
//
// Source examples:
//   boards/planning/microservice-atlas/Add team data.md
//     → spice/projects/microservice-atlas/Add team data.md
//   boards/planning/<slug>/<sub-dir>/<file>.md
//     → spice/projects/<slug>/<sub-dir>/<file>.md
//
// v1: simple path translation. Full Sauce project shape (Atlas / Structure /
// Board / tasks subdirs) is NOT generated; user can promote individual
// projects to full Sauce shape via the project blueprint's nav-buttons UX
// post-migration. Carry-forward to v0.29.x.

const fs = require("fs");
const path = require("path");

const SRC_RE = /^boards\/planning\/([^\/]+)\/(.+)$/;

function _validateRel(p) {
    const segs = p.replace(/\\/g, "/").split("/");
    if (segs.some(s => s === "..")) {
        throw new Error(`project migrator refused path-traversal segment: ${p}`);
    }
}

function _atomicWrite(absPath, body) {
    const tmp = absPath + ".tmp-" + process.pid + "-" + Date.now();
    fs.writeFileSync(tmp, body, "utf8");
    fs.renameSync(tmp, absPath);
}

module.exports = {
    name: "project",
    priority: 70,
    canHandle(srcRelPath, srcStat) {
        if (srcStat && typeof srcStat.isDirectory === "function" && srcStat.isDirectory()) return false;
        const norm = srcRelPath.replace(/\\/g, "/");
        if (!norm.endsWith(".md")) return false;
        return SRC_RE.test(norm);
    },
    plan(srcRelPath, _srcAbsPath, _ctx) {
        _validateRel(srcRelPath);
        const norm = srcRelPath.replace(/\\/g, "/");
        const m = norm.match(SRC_RE);
        if (!m) {
            return {
                action: "skip",
                src: srcRelPath,
                tgt: null,
                warnings: [`project.plan: srcRelPath did not match boards/planning/<slug>/<rest>: ${srcRelPath}`],
                rewrite_summary: ""
            };
        }
        const [, slug, rest] = m;
        const tgt = `spice/projects/${slug}/${rest}`;
        return {
            action: "rewrite_blueprint",
            src: srcRelPath,
            tgt,
            warnings: [],
            rewrite_summary: { migrator: "project", slug, body_regenerated: false, path_only: true }
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
