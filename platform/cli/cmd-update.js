// platform/cli/cmd-update.js — git fetch + reset --hard origin/main + reinstall.
//
// Test hooks (underscore-prefixed methods on ctx) override the default
// shell-out for git/npm/installer calls. Production code uses the real
// implementations; the run-cli.js harness injects mocks.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const section = require("../visual/section.js");

// ---------------------------------------------------------------------------
// _resolveWorkshopPath — locate the brew-installed workshop without relying on
// ranch/platform-installed.json's workshop_path field (which is null on every
// pre-v0.75.1 consumer vault). Precedence:
//   1. argv.workshopPath  — explicit --workshop-path CLI override
//   2. installed.workshop_path — preserved when present
//   3. Ancestry walk from process.execPath (or test hook _execPath)
//   4. Throw with explicit message
// Exposed via module.exports._resolveWorkshopPath for HC-V0751-B1..B4.
// ---------------------------------------------------------------------------
function _resolveWorkshopPath(installed, argv, hooks) {
    if (argv && argv.workshopPath) return argv.workshopPath;
    if (installed && installed.workshop_path) return installed.workshop_path;
    const startExecPath = (hooks && hooks._execPath) || process.execPath;
    let dir = path.dirname(startExecPath);
    const root = path.parse(dir).root;
    while (dir !== root) {
        if (
            path.basename(dir) === "libexec" &&
            fs.existsSync(path.join(dir, "platform"))
        ) {
            return dir;
        }
        dir = path.dirname(dir);
    }
    throw new Error(
        "Could not auto-detect workshop_path. Pass --workshop-path <path> explicitly.",
    );
}

// ---------------------------------------------------------------------------
// --bump-pins: reads the brew-installed workshop's platform/manifest.json and
// rewrites the consumer vault's ranch/platform-subscription.json to match.
// Returns true if normal update flow should continue, false if the process
// should stop (--dry-run with a non-empty diff exits 0 here).
// ---------------------------------------------------------------------------
function handleBumpPins(cwd, opts) {
    const { keepComparators, dryRun } = opts || {};
    const subscriptionPath = path.join(cwd, "ranch", "platform-subscription.json");
    if (!fs.existsSync(subscriptionPath)) {
        process.stderr.write("sauce: --bump-pins requires a consumer vault; cwd must contain ranch/platform-subscription.json\n");
        process.exit(2);
    }
    const installedPath = path.join(cwd, "ranch", "platform-installed.json");
    if (!fs.existsSync(installedPath)) {
        process.stderr.write("sauce: ranch/platform-installed.json missing; run sauce install first\n");
        process.exit(3);
    }
    const installed = JSON.parse(fs.readFileSync(installedPath, "utf8"));
    const workshopPath = _resolveWorkshopPath(installed, { workshopPath: opts.workshopPath });
    const workshopManifestPath = path.join(workshopPath, "platform", "manifest.json");
    let workshopManifest;
    try {
        workshopManifest = JSON.parse(fs.readFileSync(workshopManifestPath, "utf8"));
    } catch (_e) {
        process.stderr.write(`sauce: workshop manifest not parseable at ${workshopManifestPath}\n`);
        process.exit(4);
    }
    const subscription = JSON.parse(fs.readFileSync(subscriptionPath, "utf8"));
    const newSubscription = JSON.parse(JSON.stringify(subscription));
    const diff = [];

    // Top-level workshop_version
    if (newSubscription.workshop_version !== workshopManifest.workshop_version) {
        diff.push(`  workshop_version: ${newSubscription.workshop_version} -> ${workshopManifest.workshop_version}`);
        newSubscription.workshop_version = workshopManifest.workshop_version;
    }

    // Build lookup maps from workshop manifest (uses "name" field)
    const bpManifestMap = {};
    for (const bp of (workshopManifest.blueprints || [])) bpManifestMap[bp.name] = bp.version;
    const mechManifestMap = {};
    for (const m of (workshopManifest.mechanisms || [])) mechManifestMap[m.name] = m.version;

    // Blueprint pins (subscription uses top-level "blueprints[]" with "name" field)
    for (const pin of (newSubscription.blueprints || [])) {
        const key = pin.name;
        const wsVer = bpManifestMap[key];
        if (!wsVer) {
            diff.push(`  pinned.blueprints.${key}: WARNING — not in workshop manifest, leaving at ${pin.version}`);
            continue;
        }
        const oldVer = pin.version;
        const newPin = keepComparators ? oldVer.replace(/[\d.]+$/, wsVer) : wsVer;
        if (oldVer !== newPin) {
            diff.push(`  pinned.blueprints.${key}: ${oldVer} -> ${newPin}`);
            pin.version = newPin;
        }
    }

    // Mechanism pins (subscription uses top-level "mechanisms[]" with "name" field)
    for (const pin of (newSubscription.mechanisms || [])) {
        const key = pin.name;
        const wsVer = mechManifestMap[key];
        if (!wsVer) {
            diff.push(`  pinned.mechanisms.${key}: WARNING — not in workshop manifest, leaving at ${pin.version}`);
            continue;
        }
        const oldVer = pin.version;
        const newPin = keepComparators ? oldVer.replace(/[\d.]+$/, wsVer) : wsVer;
        if (oldVer !== newPin) {
            diff.push(`  pinned.mechanisms.${key}: ${oldVer} -> ${newPin}`);
            pin.version = newPin;
        }
    }

    // New-in-workshop items not in subscription
    const subscribedBp = new Set((newSubscription.blueprints || []).map(p => p.name));
    for (const bp of (workshopManifest.blueprints || [])) {
        if (!subscribedBp.has(bp.name)) diff.push(`  pinned.blueprints.${bp.name}: (new in workshop — not subscribed, skipped)`);
    }
    const subscribedMech = new Set((newSubscription.mechanisms || []).map(p => p.name));
    for (const m of (workshopManifest.mechanisms || [])) {
        if (!subscribedMech.has(m.name)) diff.push(`  pinned.mechanisms.${m.name}: (new in workshop — not subscribed, skipped)`);
    }

    if (diff.length === 0) {
        process.stdout.write("sauce: subscription pins already match workshop; nothing to bump.\n");
        return true; // continue to normal update flow
    }

    process.stdout.write(`sauce: bumping subscription pins from workshop manifest at ${workshopManifestPath}\n`);
    for (const line of diff) process.stdout.write(line + "\n");

    if (dryRun) {
        process.stdout.write("sauce: --dry-run set; subscription NOT written.\n");
        process.exit(0);
    }

    fs.writeFileSync(subscriptionPath, JSON.stringify(newSubscription, null, 2) + "\n");
    process.stdout.write("sauce: subscription updated; running standard sauce update flow.\n");
    return true; // continue to normal update flow
}

async function run(ctx, args) {
    const argList = args || [];
    const bumpPins = argList.includes("--bump-pins");
    const dryRun = argList.includes("--dry-run");
    const keepComparators = argList.includes("--keep-comparators");
    const force = argList.includes("--force");
    // --workshop-path <path> — explicit workshop_path override (v0.75.1 Workstream A)
    let workshopPathFlag = null;
    const wpIdx = argList.indexOf("--workshop-path");
    if (wpIdx >= 0 && argList[wpIdx + 1]) workshopPathFlag = argList[wpIdx + 1];

    if (bumpPins) {
        const cwd = (ctx && ctx.vaultPath) ? ctx.vaultPath : process.cwd();
        handleBumpPins(cwd, { keepComparators, dryRun, workshopPath: workshopPathFlag });
        // handleBumpPins exits on --dry-run with a non-empty diff; returns here only to continue
        if (dryRun) return; // --dry-run + no diff (nothing to bump) — don't run normal flow
    }

    const total = 4;
    process.stdout.write("  " + section.step(1, total, "Fetching origin/main...") + "  ");
    const fetched = _gitExec(ctx, ["fetch", "origin", "main"]);
    if (fetched.code !== 0) {
        console.log(section.fail());
        _printMigrationHint();
        throw new Error("git fetch failed: " + fetched.stderr);
    }
    console.log(section.ok());

    process.stdout.write("  " + section.step(2, total, "Checking working tree...") + "  ");
    const status = _gitExec(ctx, ["status", "--short"]);
    const dirty = (status.stdout || "").trim().length > 0;
    const dirtyLines = (status.stdout || "").trim().split("\n").filter(Boolean);
    if (dirty && dirtyLines.length > 20) {
        _printMigrationHint();
        // continue with existing dirty-tree behavior — don't override
    }
    if (dirty && !force) {
        console.log(section.fail("dirty"));
        const detail = (status.stdout || "").trim().split("\n").map(l => "    " + l).join("\n");
        throw new Error("pantry/ working tree is dirty:\n" + detail + "\n  Pass --force to override.");
    }
    console.log(section.ok(dirty ? "dirty (override via --force)" : "clean"));

    process.stdout.write("  " + section.step(3, total, "Resetting pantry/ to origin/main...") + "  ");
    const reset = _gitExec(ctx, ["reset", "--hard", "origin/main"]);
    if (reset.code !== 0) {
        console.log(section.fail());
        throw new Error("git reset failed: " + reset.stderr);
    }
    console.log(section.ok());

    // npm install if package.json SHA changed (compare HEAD@{1}:package.json vs HEAD)
    const pkgChanged = _gitExec(ctx, ["diff", "--name-only", "HEAD@{1}", "HEAD"]);
    if (pkgChanged.code === 0 && /package(-lock)?\.json/.test(pkgChanged.stdout || "")) {
        await _npmInstall(ctx);
    }

    process.stdout.write("  " + section.step(4, total, "Re-running installer...") + "  ");
    await _runInstaller(ctx);
    console.log(section.ok());

    console.log("");
    console.log("  Tip: Cmd+R Obsidian to pick up changes.");
}

function _gitExec(ctx, args) {
    if (typeof ctx._gitExec === "function") return ctx._gitExec(args);
    const r = spawnSync("git", args, { cwd: ctx.workshopPath, encoding: "utf8" });
    return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

async function _npmInstall(ctx) {
    if (typeof ctx._npmInstall === "function") return ctx._npmInstall();
    const r = spawnSync("npm", ["install", "--omit=dev"], { cwd: ctx.workshopPath, encoding: "utf8", stdio: "inherit" });
    if (r.status !== 0) throw new Error("npm install failed");
}

async function _runInstaller(ctx) {
    if (typeof ctx._runInstaller === "function") return ctx._runInstaller();
    const bootstrap = require("../bootstrap.js");
    await bootstrap.phaseRunInstaller({ vaultPath: ctx.vaultPath });
}

function _printMigrationHint() {
    console.log("");
    console.log("  Hint: This pantry/ working tree looks like the pre-v0.36 layout.");
    console.log("        Sauce now distributes pantry via Homebrew.");
    console.log("        Migrate: sauce migrate-layout --vault <path>");
    console.log("        Docs:    Docs/plans/2026-05-12-sauce-homebrew-distribution-design.md");
    console.log("");
}

module.exports = { run, _resolveWorkshopPath };
