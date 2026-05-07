// platform/cli/cmd-status.js — read-only diff: vault + workshop + drift.
//
// Test hooks (underscore-prefixed methods on ctx) override the default
// shell-out for git/npm/installer calls. Production code uses the real
// implementations; the run-cli.js harness injects mocks.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const banner = require("../visual/banner.js");

async function run(ctx, args) {
    const lines = [];
    const ver = (ctx.workshopManifest && ctx.workshopManifest.workshop_version) || "?";
    lines.push(banner.render({ version: ver }));
    lines.push("");
    lines.push("  Vault:        " + ctx.vaultPath);

    // Workshop git head + clean/dirty + commits-behind
    const wsHead = _gitExec(ctx, ["rev-parse", "--short", "HEAD"]);
    const wsStatus = _gitExec(ctx, ["status", "--short"]);
    const dirty = (wsStatus.stdout || "").trim().length > 0;
    const head = ((wsHead.stdout || "?").trim()) || "?";
    const cleanLabel = dirty ? "dirty" : "clean";
    let behindLabel = "?";
    const wsFetch = _gitExec(ctx, ["rev-list", "--count", "HEAD..origin/main"]);
    if (wsFetch.code === 0) behindLabel = ((wsFetch.stdout || "0").trim() || "0") + " behind";
    lines.push(`  Workshop:     ${path.basename(ctx.workshopPath)}/  (git head ${head}, ${cleanLabel}, ${behindLabel} origin/main)`);

    // Subscription counts + drift
    const subM = (ctx.subscription.mechanisms || []).length;
    const subB = (ctx.subscription.blueprints || []).length;
    lines.push(`  Subscribed:   ${subM} mechanisms · ${subB} blueprints`);

    // Drift: subscribed.version vs platform-installed.json history latest
    const installedPath = path.join(ctx.vaultPath, "ranch/platform-installed.json");
    let installed = { history: [] };
    if (fs.existsSync(installedPath)) {
        try { installed = JSON.parse(fs.readFileSync(installedPath, "utf8")); }
        catch (_e) { installed = { history: [] }; }
    }
    const driftedNames = [];
    for (const m of (ctx.subscription.mechanisms || [])) {
        const last = (installed.history || []).filter(h => h.kind === "mechanisms" && h.name === m.name).pop();
        if (last && last.version !== m.version) driftedNames.push(`${m.name} (sub ${m.version} ≠ installed ${last.version})`);
    }
    for (const b of (ctx.subscription.blueprints || [])) {
        const last = (installed.history || []).filter(h => h.kind === "blueprints" && h.name === b.name).pop();
        if (last && last.version !== b.version) driftedNames.push(`${b.name} (sub ${b.version} ≠ installed ${last.version})`);
    }
    lines.push("  Drift:        " + (driftedNames.length === 0 ? "none" : driftedNames.join(", ")));

    if (!process.env.SAUCE_TEST_MODE) {
        for (const l of lines) console.log(l);
    }
    return { lines };
}

function _gitExec(ctx, args) {
    if (typeof ctx._gitExec === "function") return ctx._gitExec(args);
    const r = spawnSync("git", args, { cwd: ctx.workshopPath, encoding: "utf8" });
    return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

module.exports = { run };
