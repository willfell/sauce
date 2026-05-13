// platform/cli/cmd-doctor.js — sauce doctor: read-only platform health check.
// Like vault/reinstall/migrate-layout, runs WITHOUT a vault context.
//
// Five checks, in order:
//   1. brew sauce installed (_brewPrefix resolves)
//   2. node >= 18
//   3. each registry vault path exists on disk
//   4. no legacy <vault>/pantry/.git in any registered vault
//   5. ~/.sauce/active-pantry symlink (if present) points to a valid checkout
//
// FAIL rows set process.exitCode = 1; WARNs do not.
// Test hooks (mockable on ctx): _brewPrefix, _nodeVersion.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const registry = require("./registry.js");

function _brewPrefix(ctx, name) {
    if (ctx && typeof ctx._brewPrefix === "function") return ctx._brewPrefix(name);
    const r = spawnSync("brew", ["--prefix", name], { encoding: "utf8" });
    if (r.status !== 0) return null;
    return (r.stdout || "").trim() || null;
}

function _nodeVersion(ctx) {
    if (ctx && typeof ctx._nodeVersion === "function") return ctx._nodeVersion();
    return (process.versions && process.versions.node) || "0.0.0";
}

function brewWorkshopVersionOrNull(prefix) {
    if (!prefix) return null;
    const mp = path.join(prefix, "libexec/platform/manifest.json");
    if (!fs.existsSync(mp)) return null;
    try { return JSON.parse(fs.readFileSync(mp, "utf8")).workshop_version || null; }
    catch (_e) { return null; }
}

function row(severity, message, fix) {
    return { severity, message, fix };
}

async function run(ctx, _args) {
    const rows = [];

    // 1. brew sauce
    const prefix = _brewPrefix(ctx, "sauce");
    if (!prefix) rows.push(row("fail", "brew sauce not installed", "brew install willfell/sauce/sauce"));
    else {
        const v = brewWorkshopVersionOrNull(prefix);
        rows.push(row("pass", `brew sauce installed (${v || "unknown version"})`));
    }

    // 2. node >= 18
    const nv = _nodeVersion(ctx);
    const major = parseInt(String(nv).split(".")[0], 10) || 0;
    if (major < 18) rows.push(row("fail", `node version ${nv} (need >= 18)`, "brew install node"));
    else rows.push(row("pass", `node version v${nv} (>= 18)`));

    // 3. registry vault paths exist
    for (const v of registry.list()) {
        if (!fs.existsSync(v.path)) {
            rows.push(row("warn", `registry vault ${v.path} not found`, `sauce vault remove ${v.path}`));
        }
    }

    // 4. no legacy pantry/.git in any registered vault
    for (const v of registry.list()) {
        if (!fs.existsSync(v.path)) continue; // covered by check 3
        if (fs.existsSync(path.join(v.path, "pantry/.git"))) {
            rows.push(row("warn", `legacy pantry/.git found in ${v.path}`, `sauce migrate-layout --vault ${v.path}`));
        }
    }

    // 5. active-pantry symlink
    const active = path.join(os.homedir(), ".sauce/active-pantry");
    try {
        if (fs.lstatSync(active).isSymbolicLink()) {
            const target = fs.readlinkSync(active);
            const targetAbs = path.isAbsolute(target) ? target : path.join(path.dirname(active), target);
            const ok = fs.existsSync(targetAbs) && fs.existsSync(path.join(targetAbs, "platform/cli/sauce-cli.js"));
            if (!ok) rows.push(row("fail", `active-pantry symlink dangles -> ${target}`, "sauce unlink"));
            else rows.push(row("pass", `active-pantry -> ${target}`));
        }
    } catch (_e) { /* no symlink — that's the normal case */ }

    console.log("");
    console.log("  Sauce doctor — v0.36.0");
    console.log("");
    let passN = 0, warnN = 0, failN = 0;
    for (const r of rows) {
        const tag = r.severity === "pass" ? "[OK]  " : r.severity === "warn" ? "[WARN]" : "[FAIL]";
        console.log(`  ${tag} ${r.message}`);
        if (r.fix) console.log(`         fix: ${r.fix}`);
        if (r.severity === "pass") passN++;
        else if (r.severity === "warn") warnN++;
        else failN++;
    }
    console.log("");
    console.log(`  ${failN} fail · ${warnN} warn · ${passN} ok`);
    console.log("");

    if (failN > 0) process.exitCode = 1;
}

module.exports = { run };
