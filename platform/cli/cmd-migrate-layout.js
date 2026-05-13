// platform/cli/cmd-migrate-layout.js — move <vault>/pantry/ → archive,
// re-install from brew-prefixed pantry. 8-step state machine per design §3
// of Docs/plans/2026-05-12-sauce-homebrew-distribution-design.md.
//
// Steps:
//   1. Detect: <vault>/pantry/.git/ exists
//   2. Preflight brew: _brewPrefix("sauce") returns a path
//   3. Version-skew: refuse downgrade unless --allow-downgrade
//   4. Archive: fs.renameSync pantry/ → pantry.legacy.<ts>.bak/
//   5. Rewrite-installed: strip "pantry/" prefix from ranch/platform-installed.json string values
//   6. Register: registry.add(vaultPath)
//   7. Run installer
//   8. Audit. If --purge AND audit.ok, rm -rf the archive.
//
// --dry-run halts after step 3 (validation only; no mutations).
//
// Test hooks (mockable on ctx): _brewPrefix, _brewWorkshopVersion,
// _runInstaller, _auditStrict. Production fallbacks below.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const registry = require("./registry.js");

function expandTilde(p) {
    if (!p) return p;
    if (p === "~" || p === "~/") return process.env.HOME || os.homedir();
    if (p.startsWith("~/")) return path.join(process.env.HOME || os.homedir(), p.slice(2));
    return p;
}

function semverGt(a, b) {
    const pa = String(a).split(".").map(n => parseInt(n, 10) || 0);
    const pb = String(b).split(".").map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
        const x = pa[i] || 0, y = pb[i] || 0;
        if (x > y) return true;
        if (x < y) return false;
    }
    return false;
}

function _brewPrefix(ctx, name) {
    if (ctx && typeof ctx._brewPrefix === "function") return ctx._brewPrefix(name);
    const r = spawnSync("brew", ["--prefix", name], { encoding: "utf8" });
    if (r.status !== 0) return null;
    return (r.stdout || "").trim() || null;
}

function _brewWorkshopVersion(ctx) {
    if (ctx && typeof ctx._brewWorkshopVersion === "function") return ctx._brewWorkshopVersion();
    const prefix = _brewPrefix(ctx, "sauce");
    if (!prefix) return null;
    const mp = path.join(prefix, "libexec/platform/manifest.json");
    if (!fs.existsSync(mp)) return null;
    try { return JSON.parse(fs.readFileSync(mp, "utf8")).workshop_version || null; }
    catch (_e) { return null; }
}

async function _runInstaller(ctx, opts) {
    if (ctx && typeof ctx._runInstaller === "function") return ctx._runInstaller(opts);
    const bootstrap = require("../bootstrap.js");
    return bootstrap.phaseRunInstaller(opts);
}

async function _auditStrict(ctx, vaultPath) {
    if (ctx && typeof ctx._auditStrict === "function") return ctx._auditStrict(vaultPath);
    // v0.36.1 I3 honesty pass: cmd-audit.js does not currently expose a
    // programmatic strict-check function. Production audit integration
    // deferred to a future cycle (FIX-LATER-NOTE). Production callers must
    // NOT treat this as a real audit gate — `--purge` now uses step 1-7
    // success as its precondition instead (see run() below). Test harnesses
    // still inject `ctx._auditStrict` to exercise the gate semantics.
    return { ok: true, _stub: true };
}

function timestampedBakName() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `pantry.legacy.${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.bak`;
}

async function run(ctx, args) {
    const flags = args || [];
    const dryRun = flags.includes("--dry-run");
    const allowDowngrade = flags.includes("--allow-downgrade");
    const purge = flags.includes("--purge");
    const vaultIdx = flags.indexOf("--vault");
    const vaultPath = vaultIdx >= 0 && flags[vaultIdx + 1]
        ? path.resolve(expandTilde(flags[vaultIdx + 1]))
        : (ctx && ctx.vaultPath);
    if (!vaultPath) throw new Error("usage: sauce migrate-layout --vault <path>");

    // Step 1: detect
    const pantry = path.join(vaultPath, "pantry");
    const hasLegacy = fs.existsSync(path.join(pantry, ".git"));
    if (!hasLegacy) {
        console.log(`  No legacy <vault>/pantry/.git found at ${vaultPath}. Nothing to do.`);
        return;
    }

    // Step 2: preflight brew
    const brewPrefix = _brewPrefix(ctx, "sauce");
    if (!brewPrefix) {
        throw new Error("brew --prefix sauce failed. Install sauce first:\n    brew install willfell/sauce/sauce");
    }

    // Step 3: version-skew
    let legacyVersion = null;
    const legacyManifest = path.join(pantry, "platform/manifest.json");
    if (fs.existsSync(legacyManifest)) {
        try { legacyVersion = JSON.parse(fs.readFileSync(legacyManifest, "utf8")).workshop_version || null; }
        catch (_e) { legacyVersion = null; }
    }
    const brewVersion = _brewWorkshopVersion(ctx);
    if (legacyVersion && brewVersion && semverGt(legacyVersion, brewVersion) && !allowDowngrade) {
        throw new Error(`refusing downgrade: legacy pantry workshop_version ${legacyVersion} > brew-installed ${brewVersion}. Pass --allow-downgrade to override.`);
    }

    // Dry-run: print plan and stop.
    if (dryRun) {
        console.log(`  Plan for ${vaultPath}:`);
        console.log(`    1. Legacy pantry detected (workshop ${legacyVersion || "unknown"})`);
        console.log(`    2. Brew prefix: ${brewPrefix} (workshop ${brewVersion || "unknown"})`);
        console.log(`    3. Archive pantry/ → pantry.legacy.<ts>.bak/`);
        console.log(`    4. Register vault in ~/.sauce/vaults.json`);
        console.log(`    5. Run installer with brew prefix as SAUCE_DIR`);
        console.log(`    6. Audit. ${purge ? "Purge archive on clean." : "Keep archive."}`);
        return;
    }

    // Step 4: archive
    const bakName = timestampedBakName();
    const bakPath = path.join(vaultPath, bakName);
    fs.renameSync(pantry, bakPath);
    console.log(`  Archived: pantry/ → ${bakName}`);

    // Step 5: rewrite-installed (defensive scan)
    const installedPath = path.join(vaultPath, "ranch/platform-installed.json");
    if (fs.existsSync(installedPath)) {
        try {
            const text = fs.readFileSync(installedPath, "utf8");
            // Replace any "pantry/..." string-values with the same path minus prefix.
            // Conservative regex on quoted strings only.
            const rewritten = text.replace(/"pantry\/([^"]+)"/g, '"$1"');
            if (rewritten !== text) {
                fs.writeFileSync(installedPath, rewritten);
                console.log("  Rewrote pantry/-relative paths in ranch/platform-installed.json");
            }
        } catch (_e) { /* best-effort */ }
    }

    // Step 6: register
    registry.add(vaultPath);
    console.log(`  Registered: ${vaultPath}`);

    // Step 7: run installer
    await _runInstaller(ctx, { vaultPath });
    console.log(`  Installer complete.`);

    // Step 8: audit (test-only real-audit hook; production stub is a no-op).
    // v0.36.1 I3 honesty pass: in production, `_auditStrict` returns
    // `{ok: true, _stub: true}` — so `--purge` MUST NOT key off it. The
    // precondition for purge is "steps 1-7 succeeded", which is implicit
    // by virtue of reaching this point (any failure in 1-7 throws).
    const audit = await _auditStrict(ctx, vaultPath);
    if (audit && audit.ok) {
        if (audit._stub) {
            console.log("  Audit: skipped (production audit integration deferred — see FIX-LATER-NOTE).");
        } else {
            console.log("  Audit: OK");
        }
        if (purge) {
            fs.rmSync(bakPath, { recursive: true, force: true });
            console.log(`  Purged: ${bakName}`);
        }
    } else {
        console.log(`  Audit: FAILED${audit && audit.message ? " — " + audit.message : ""}`);
        process.exitCode = 1;
    }
}

module.exports = { run };
