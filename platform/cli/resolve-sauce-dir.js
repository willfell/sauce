// resolve-sauce-dir.js — pure-function mirror of the brew bin shim's logic.
// The shim is bash but the resolution logic is unit-tested here.
//
// Returns the absolute SAUCE_DIR that the CLI should run from:
//   - If ~/.sauce/active-pantry resolves to a directory (symlink + target dir exists),
//     return the symlink path (preserving the dev-mode link).
//   - Otherwise, return <brewPrefix>/libexec (the brew-installed pantry).

const fs = require("fs");
const path = require("path");

function resolve(opts) {
    const home = opts.home;
    const brewPrefix = opts.brewPrefix;
    if (!home || !brewPrefix) throw new Error("resolve-sauce-dir.js: home and brewPrefix are required");
    const active = path.join(home, ".sauce/active-pantry");
    try {
        const st = fs.statSync(active); // follows symlink — throws if dangling
        if (st.isDirectory()) return active;
    } catch (_e) { /* missing or dangling */ }
    return path.join(brewPrefix, "libexec");
}

module.exports = { resolve };
