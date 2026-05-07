// platform/cli/cmd-help.js — global usage screen.
//
// Routed from sauce-cli.js dispatcher when verb is "help", "--help", "-h",
// or undefined (bare `sauce`). Works outside any vault — does NOT call
// resolveContext; ctx may be null. SAUCE_TEST_MODE suppresses console.log
// (mirrors cmd-status.js) so harness can inspect lines[].

const fs = require("fs");
const path = require("path");

async function run(ctx, args) {
    let version = "?";
    if (ctx && ctx.workshopManifest && ctx.workshopManifest.workshop_version) {
        version = ctx.workshopManifest.workshop_version;
    } else {
        // Best-effort: look for workshop manifest relative to this script.
        const guess = path.resolve(__dirname, "..", "manifest.json");
        if (fs.existsSync(guess)) {
            try {
                version = JSON.parse(fs.readFileSync(guess, "utf8")).workshop_version || "?";
            } catch (_e) { /* keep "?" */ }
        }
    }
    const lines = [
        `sauce — Sauce platform CLI (workshop_version ${version})`,
        "",
        "Usage:",
        "  sauce <verb> [args]",
        "",
        "Verbs:",
        "  bootstrap   First-time install in this vault. Runs the wizard, fetches plugins, runs the installer.",
        "  update      Pull origin/main of the workshop clone + re-run the installer.",
        "  status      Read-only: show vault/workshop git head, drift, subscription counts.",
        "  wizard      Re-run the first-run wizard to edit subscription or config.",
        "  help        Print this screen.",
        "",
        "Examples:",
        "  sauce status",
        "  sauce update --force",
        "  sauce wizard",
        "",
        "Vault context:",
        "  Detected by walking the cwd ancestors for ranch/platform-config.json,",
        "  or override via $SAUCE_VAULT.",
        "",
        "Docs:",
        "  https://github.com/willfell/sauce  (Docs/install.md, Docs/use.md, Docs/how.md)"
    ];
    if (!process.env.SAUCE_TEST_MODE) {
        for (const l of lines) console.log(l);
    }
    return { lines };
}

module.exports = { run };
