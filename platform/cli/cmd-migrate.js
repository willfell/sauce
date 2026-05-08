// platform/cli/cmd-migrate.js — `sauce migrate` verb (v0.28.0).
//
// Migrates a real source vault (read-only) into the current sauce-managed
// vault by walking source paths, routing per-file to a per-blueprint
// migrator (people/daily/meetings-note/meetings-hub/to-do) or a verbatim
// fallback, then either emitting a plan (dry-run default) or executing
// the 5-phase --commit flow (precheck → backup → bootstrap → carry →
// rewrite-blueprints → wikilink-rewrite → finalize).
//
// Source vault is NEVER modified. Target vault is wiped in-place per
// design Section 4 with sibling backup at <vault>.pre-migration-<ts>/.

const fs = require("fs");
const path = require("path");

// Test-hook seam (mirrors cmd-bootstrap.js + cmd-wizard.js DI pattern).
exports._dispatcherImpl = null;

exports._parseFlags = function(argv) {
    const flags = { from: null, commit: false, keepBackups: true };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--from" && i + 1 < argv.length) {
            flags.from = argv[++i];
        } else if (a.startsWith("--from=")) {
            flags.from = a.slice("--from=".length);
        } else if (a === "--commit") {
            flags.commit = true;
        } else if (a === "--no-keep-backups") {
            flags.keepBackups = false;
        }
    }
    return flags;
};

exports.run = async function(ctx, args) {
    const flags = exports._parseFlags(args || []);
    if (!flags.from) {
        console.error("usage: sauce migrate --from <source-vault-path> [--commit]");
        process.exit(2);
        return;
    }
    const fromAbs = path.resolve(process.cwd(), flags.from);
    if (!fs.existsSync(fromAbs) || !fs.statSync(fromAbs).isDirectory()) {
        console.error(`error: --from path does not exist or is not a directory: ${fromAbs}`);
        process.exit(2);
        return;
    }
    const dispatcher = exports._dispatcherImpl || require("../migrate/dispatcher");
    return await dispatcher.run({ ctx, fromAbs, flags });
};
