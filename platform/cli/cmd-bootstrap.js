// platform/cli/cmd-bootstrap.js — first-run install. Called by install.sh post-clone.
//
// Test hooks (underscore-prefixed methods on ctx) override the default
// shell-out for git/npm/installer calls. Production code uses the real
// implementations; the run-cli.js harness injects mocks.

const path = require("path");
const banner = require("../visual/banner.js");
const section = require("../visual/section.js");

async function run(ctx, args) {
    // ctx may be partial — install.sh just-cloned-vault has config but no
    // platform-subscription.json yet. We accept ctx.vaultPath and call the
    // existing runBootstrap, which handles first-run wizard internally.
    const bootstrap = require("../bootstrap.js");
    console.log(banner.render({
        version: (ctx.workshopManifest && ctx.workshopManifest.workshop_version) || ""
    }));
    console.log("");
    const report = await bootstrap.runBootstrap({
        vaultPath: ctx.vaultPath,
        nonInteractive: false
    });

    // Write activation artifacts after install completes.
    process.stdout.write("  " + section.step(5, 5, "Writing activation artifacts...") + "  ");
    await bootstrap.phaseWriteActivation({
        vaultPath: ctx.vaultPath,
        workshopAbsPath: ctx.workshopPath
    });
    console.log(section.ok());

    console.log("");
    console.log("  Beacon installed at " + ctx.workshopPath);
    console.log("");
    console.log("  To activate in this shell:");
    console.log("    source Beacon/Scripts/activate.sh");
    console.log("");
    console.log("  Then try:");
    console.log("    beacon status");

    return report;
}

module.exports = { run };
