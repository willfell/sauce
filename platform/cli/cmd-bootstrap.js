// platform/cli/cmd-bootstrap.js — first-run install. Called by install.sh post-clone.
//
// Test hooks (underscore-prefixed methods on ctx) override the default
// shell-out for git/npm/installer calls. Production code uses the real
// implementations; the run-cli.js harness injects mocks.

const path = require("path");
const banner = require("../visual/banner.js");
const section = require("../visual/section.js");

function _parseFlags(args) {
    let nonInteractive = false;
    let mechanismsArg, blueprintsArg;
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--non-interactive") nonInteractive = true;
        else if (a.startsWith("--mechanisms=")) mechanismsArg = a.slice("--mechanisms=".length);
        else if (a.startsWith("--blueprints=")) blueprintsArg = a.slice("--blueprints=".length);
    }
    return { nonInteractive, mechanismsArg, blueprintsArg };
}

function _resolveListArg(arg) {
    // undefined → undefined (caller falls through to default)
    // "all" → literal string "all" (wizard branch resolves to manifest entries)
    // "none" or "" → []
    // otherwise → CSV split
    if (arg === undefined) return undefined;
    if (arg === "all") return "all";
    if (arg === "none" || arg === "") return [];
    return arg.split(",").map(s => s.trim()).filter(Boolean);
}

async function run(ctx, args) {
    // ctx may be partial — install.sh just-cloned-vault has config but no
    // platform-subscription.json yet. We accept ctx.vaultPath and call the
    // existing runBootstrap, which handles first-run wizard internally.
    const bootstrap = require("../bootstrap.js");
    const { nonInteractive, mechanismsArg, blueprintsArg } = _parseFlags(args || []);
    const wizardDefaults = {};
    const mechs = _resolveListArg(mechanismsArg);
    if (mechs !== undefined) wizardDefaults.mechanisms = mechs;
    const bps = _resolveListArg(blueprintsArg);
    if (bps !== undefined) wizardDefaults.blueprints = bps;

    console.log(banner.render({
        version: (ctx.workshopManifest && ctx.workshopManifest.workshop_version) || ""
    }));
    console.log("");
    const report = await bootstrap.runBootstrap({
        vaultPath: ctx.vaultPath,
        nonInteractive,
        wizardDefaults: Object.keys(wizardDefaults).length > 0 ? wizardDefaults : undefined
    });

    // Write activation artifacts after install completes.
    process.stdout.write("  " + section.step(5, 5, "Writing activation artifacts...") + "  ");
    await bootstrap.phaseWriteActivation({
        vaultPath: ctx.vaultPath,
        workshopAbsPath: ctx.workshopPath
    });
    console.log(section.ok());

    console.log("");
    console.log("  Sauce installed at " + ctx.workshopPath);
    console.log("");
    console.log("  To activate in this shell:");
    console.log("    source pantry/Scripts/activate.sh");
    console.log("");
    console.log("  Then try:");
    console.log("    sauce status");

    return report;
}

module.exports = { run, _parseFlags, _resolveListArg };
