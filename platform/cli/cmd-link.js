// platform/cli/cmd-link.js — sauce link <path-to-workshop-checkout>.
// Creates ~/.sauce/active-pantry symlink → <path>. Validates target is a
// real workshop checkout (platform/manifest.json + platform/cli/sauce-cli.js).

const fs = require("fs");
const path = require("path");
const os = require("os");

function expandTilde(p) {
    if (!p) return p;
    if (p === "~" || p === "~/") return process.env.HOME || os.homedir();
    if (p.startsWith("~/")) return path.join(process.env.HOME || os.homedir(), p.slice(2));
    return p;
}

async function run(_ctx, args) {
    const raw = (args || [])[0];
    if (!raw) throw new Error("usage: sauce link <path-to-workshop-checkout>");
    const target = path.resolve(expandTilde(raw));
    if (!fs.existsSync(path.join(target, "platform/manifest.json"))) {
        throw new Error(`not a sauce workshop checkout (missing platform/manifest.json): ${target}`);
    }
    if (!fs.existsSync(path.join(target, "platform/cli/sauce-cli.js"))) {
        throw new Error(`not a sauce workshop checkout (missing platform/cli/sauce-cli.js): ${target}`);
    }
    const sauceDir = path.join(os.homedir(), ".sauce");
    if (!fs.existsSync(sauceDir)) fs.mkdirSync(sauceDir, { recursive: true });
    const link = path.join(sauceDir, "active-pantry");
    // Remove existing symlink (or any old file) before re-linking. Idempotent.
    try { fs.unlinkSync(link); } catch (_e) { /* missing is fine */ }
    fs.symlinkSync(target, link);
    console.log(`  Linked: ${link} → ${target}`);
}

module.exports = { run };
