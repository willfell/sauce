// platform/cli/cmd-wizard.js — interactive fallback; delegates to runReRunWizard.
//
// Test hooks (underscore-prefixed methods on ctx) override the default
// shell-out for git/npm/installer calls. Production code uses the real
// implementations; the run-cli.js harness injects mocks.

const fs = require("fs");
const path = require("path");

async function run(ctx, args) {
    const wizard = ctx._runReRunWizard
        ? { runReRunWizard: ctx._runReRunWizard }
        : require("../bootstrap-lib/wizard.js");
    const r = await wizard.runReRunWizard({
        vaultPath: ctx.vaultPath,
        existingConfig: ctx.config,
        existingSubscription: ctx.subscription,
        workshopManifest: ctx.workshopManifest,
        nonInteractive: false
    });
    if (!r || r.action === "quit") {
        console.log("Quit.");
        return;
    }
    if (r.action === "edit-sub" && r.payload) {
        // v0.26.0 P0-1: route through wizard's _normalizeSubscriptionFile helper
        // (mirrors bootstrap.js writeback site). Payload entries from
        // runReRunWizard arrive as already-objects (from _buildSubscriptionEntries);
        // convert to bare strings so the helper's contract stays pure.
        // C-1 (v0.26.0 quality review): always disk-load wizard module for
        // _normalizeSubscriptionFile access. The ctx._runReRunWizard test hook
        // only stubs runReRunWizard; the normalization helper is a static
        // import and the conditional `wizard` shim doesn't carry it.
        const subPath = path.join(ctx.vaultPath, "ranch/platform-subscription.json");
        const wizardMod = require("../bootstrap-lib/wizard.js");
        const toNames = (arr) => (Array.isArray(arr) ? arr : [])
            .map(e => (e && typeof e === "object" && typeof e.name === "string") ? e.name : (typeof e === "string" ? e : null))
            .filter(Boolean);
        wizardMod._normalizeSubscriptionFile(
            subPath,
            {
                mechanisms: toNames(r.payload.mechanisms),
                blueprints: toNames(r.payload.blueprints)
            },
            {
                mechanisms: (ctx.workshopManifest && ctx.workshopManifest.mechanisms) || [],
                blueprints: (ctx.workshopManifest && ctx.workshopManifest.blueprints) || []
            }
        );
    }
    if (r.action === "edit-cfg" && r.payload && r.payload.config) {
        const cfgPath = path.join(ctx.vaultPath, "ranch/platform-config.json");
        const merged = Object.assign({}, ctx.config, r.payload.config);
        fs.writeFileSync(cfgPath, JSON.stringify(merged, null, 2) + "\n");
    }
    // Re-run installer to apply changes
    if (typeof ctx._runInstaller === "function") {
        await ctx._runInstaller();
    } else {
        const bootstrap = require("../bootstrap.js");
        await bootstrap.phaseRunInstaller({ vaultPath: ctx.vaultPath });
    }
}

module.exports = { run };
