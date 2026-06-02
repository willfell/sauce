// platform/cli/cmd-update.js — bump-pins + thin delegation to installer.
// v0.75.1 Workstream B collapsed away the legacy git-fetch + reset --hard
// path that targeted the pre-v0.36 pantry/ checkout layout. Modern brew-
// distributed sauce has pantry shipped via brew; nothing to fetch.

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// _resolveWorkshopPath — locate the brew-installed workshop without relying on
// ranch/platform-installed.json's workshop_path field (which is null on every
// pre-v0.75.1 consumer vault). Precedence:
//   1. argv.workshopPath  — explicit --workshop-path CLI override
//   2. installed.workshop_path — preserved when present AND not stale
//      (v0.85.0 S1: if ancestry-walked path diverges from stored, PREFER
//      ancestry — protects against legacy workshop_path values pointing at
//      a prior brew keg the user no longer wants resolved against).
//   3. Ancestry walk from __filename (or test hook _callerFile)
//   4. Throw with explicit message
// Exposed via module.exports._resolveWorkshopPath for HC-V0751-B1..B4 +
// HC-V0850-G1.
// ---------------------------------------------------------------------------
function _resolveWorkshopPath(installed, argv, hooks) {
    if (argv && argv.workshopPath) return argv.workshopPath;

    // Workstream A (v0.76.0): walk from __filename, NOT process.execPath.
    // process.execPath is the Node binary (e.g., /opt/homebrew/Cellar/node/.../bin/node)
    // whose ancestry contains no libexec/platform — the v0.75.1 helper walked
    // it pointlessly. cmd-update.js itself lives at <workshop>/platform/cli/cmd-update.js;
    // walking from __filename reaches the workshop in 3 hops.
    //
    // v0.85.0 S1: computed up-front so we can compare against
    // installed.workshop_path (FLN-v83-2 defensive hardening — see precedence
    // note above).
    function _ancestryWalk() {
        const startFile = (hooks && hooks._callerFile) || __filename;
        let dir = path.dirname(startFile);
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
        return null;
    }
    const ancestryPath = _ancestryWalk();

    // Workstream B (v0.76.0): validate stored path before returning. When brew
    // cleans up an old keg, installed.workshop_path becomes a dead path;
    // returning it causes downstream "workshop manifest not parseable" failures.
    // Probe for platform/manifest.json — falls through to ancestry walk if dead.
    if (installed && installed.workshop_path) {
        const stored = installed.workshop_path;
        const manifestProbe = path.join(stored, "platform", "manifest.json");
        if (fs.existsSync(manifestProbe)) {
            // v0.85.0 S1 FLN-v83-2 defensive hardening: if the ancestry-walked
            // path diverges from the stored path, the running sauce binary's
            // libexec is the source of truth (brew shim resolved through the
            // currently-active keg). The stored workshop_path may point at a
            // prior keg that brew hasn't cleaned up yet; reading its older
            // manifest would silently bypass --bump-pins diff detection
            // (older manifest's blueprint versions match the consumer's
            // current pins → "nothing to bump").
            if (ancestryPath && path.resolve(ancestryPath) !== path.resolve(stored)) {
                return ancestryPath;
            }
            return stored;
        }
        // stale: fall through to ancestry walk below
    }

    if (ancestryPath) return ancestryPath;

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

    // ----------------------------------------------------------------------
    // v0.75.1 Workstream B: collapse to thin wrapper around the installer.
    // The pre-v0.36 git-fetch + reset --hard path was dead architecture in
    // modern brew-distributed sauce; consumer vaults aren't git checkouts.
    // We now delegate directly to bootstrap.phaseRunInstaller, which is the
    // same code-path cmd-reinstall uses.
    // ----------------------------------------------------------------------
    await _runInstaller(ctx);
}

async function _runInstaller(ctx) {
    if (typeof ctx._runInstaller === "function") return ctx._runInstaller();
    const bootstrap = require("../bootstrap.js");
    await bootstrap.phaseRunInstaller({ vaultPath: ctx.vaultPath });
}

module.exports = { run, _resolveWorkshopPath };
