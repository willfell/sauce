// platform/cli/cmd-unlink.js — sauce unlink. Removes ~/.sauce/active-pantry.

const fs = require("fs");
const path = require("path");
const os = require("os");

async function run(_ctx, _args) {
    const link = path.join(os.homedir(), ".sauce/active-pantry");
    if (!fs.existsSync(link) && !_isSymlink(link)) {
        console.log("  No active-pantry symlink to remove.");
        return;
    }
    try { fs.unlinkSync(link); console.log(`  Unlinked: ${link}`); }
    catch (e) { throw new Error(`unlink failed: ${e.message}`); }
}

function _isSymlink(p) {
    try { return fs.lstatSync(p).isSymbolicLink(); } catch (_e) { return false; }
}

module.exports = { run };
