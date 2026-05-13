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

// v0.36.1 I5: resolve the brew-installed `libexec` path so we can refuse a
// link target that would defeat brew upgrades. Mockable via `ctx._brewPrefix`
// for unit-testing without invoking real homebrew.
function _brewLibexec(ctx) {
    if (ctx && typeof ctx._brewPrefix === "function") {
        const p = ctx._brewPrefix("sauce");
        return p ? path.join(p, "libexec") : null;
    }
    const { spawnSync } = require("child_process");
    const r = spawnSync("brew", ["--prefix", "sauce"], { encoding: "utf8" });
    if (r.status !== 0) return null;
    const out = (r.stdout || "").trim();
    if (!out) return null;
    return path.join(out, "libexec");
}

async function run(ctx, args) {
    const raw = (args || [])[0];
    if (!raw) throw new Error("usage: sauce link <path-to-workshop-checkout>");
    const target = path.resolve(expandTilde(raw));
    if (!fs.existsSync(path.join(target, "platform/manifest.json"))) {
        throw new Error(`not a sauce workshop checkout (missing platform/manifest.json): ${target}`);
    }
    if (!fs.existsSync(path.join(target, "platform/cli/sauce-cli.js"))) {
        throw new Error(`not a sauce workshop checkout (missing platform/cli/sauce-cli.js): ${target}`);
    }
    // v0.36.1 I5: refuse to link to the brew-installed pantry. The link would
    // win over brew's bin shim resolution, silently defeating `brew upgrade`.
    const brewLibexec = _brewLibexec(ctx);
    if (brewLibexec && (target === brewLibexec || target === path.resolve(brewLibexec))) {
        throw new Error(`refusing to link to the brew-installed pantry (${brewLibexec}). Use the symlink only for dev checkouts; brew upgrades manage libexec themselves.`);
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
