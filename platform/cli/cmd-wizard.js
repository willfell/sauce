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
        const subPath = path.join(ctx.vaultPath, "ranch/platform-subscription.json");
        const merged = _mergeSubscription(ctx.subscription, r.payload, ctx.workshopManifest);
        fs.writeFileSync(subPath, JSON.stringify(merged, null, 2) + "\n");
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

function _mergeSubscription(existing, payload, workshopManifest) {
    const out = Object.assign({}, existing);
    const wm = workshopManifest || {};
    if (Array.isArray(payload.mechanisms)) {
        out.mechanisms = payload.mechanisms.map(name => {
            const m = (wm.mechanisms || []).find(x => x.name === name);
            return { name, version: m ? m.version : (existing.mechanisms || []).find(x => x.name === name)?.version || "0.0.0" };
        });
    }
    if (Array.isArray(payload.blueprints)) {
        out.blueprints = payload.blueprints.map(name => {
            const b = (wm.blueprints || []).find(x => x.name === name);
            return { name, version: b ? b.version : (existing.blueprints || []).find(x => x.name === name)?.version || "0.0.0" };
        });
    }
    return out;
}

module.exports = { run };
