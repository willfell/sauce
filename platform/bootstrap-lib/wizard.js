/**
 * platform/bootstrap-lib/wizard.js
 *
 * Interactive first-run + re-run wizards for the consumer-bootstrap orchestrator
 * (T3.4 of v0.21.0). Drives @inquirer/prompts to gather config + subscription
 * inputs from the user. When `nonInteractive=true`, every choice is supplied via
 * the `defaults` parameter (or hardcoded fallbacks) and inquirer is NEVER called
 * — this is the path the run-bootstrap harness (BS8) uses for deterministic test
 * execution without a TTY.
 *
 * Exports:
 *   - runFirstRunWizard({ vaultPath, workshopManifest, defaults, nonInteractive })
 *       → Promise<{ config, subscription }>
 *   - runReRunWizard({ vaultPath, existingConfig, existingSubscription,
 *                      workshopManifest, nonInteractive, action })
 *       → Promise<{ action, payload? }>
 */

const path = require("path");
const fs = require("fs");

// ----------------------------------------------------------------------------
// Lazy-load @inquirer/prompts so non-interactive callers don't pay the cost
// (and so the harness can run even if the dep tree is partial). Only required
// when interactive prompting is actually needed.
// ----------------------------------------------------------------------------

function _loadInquirer() {
    return require("@inquirer/prompts");
}

// ----------------------------------------------------------------------------
// Defaults helpers
// ----------------------------------------------------------------------------

const DEFAULT_MECHANISMS_CHECKED = [
    "customjs-guard",
    "nav-buttons",
    "cards",
    "beacon-button",
    "styling"
];

function _safeArray(v) {
    return Array.isArray(v) ? v : [];
}

function _findEntry(list, name) {
    return _safeArray(list).find((x) => x && x.name === name) || null;
}

function _buildSubscriptionEntries(selectedNames, manifestEntries) {
    const out = [];
    for (const name of _safeArray(selectedNames)) {
        const m = _findEntry(manifestEntries, name);
        if (m) {
            out.push({ name, version: m.version });
        }
    }
    return out;
}

// ----------------------------------------------------------------------------
// runFirstRunWizard
// ----------------------------------------------------------------------------

async function runFirstRunWizard(opts) {
    const {
        vaultPath,
        workshopManifest,
        defaults = {},
        nonInteractive = false
    } = opts || {};

    const manifestMechs = _safeArray(workshopManifest && workshopManifest.mechanisms);
    const manifestBlueprints = _safeArray(workshopManifest && workshopManifest.blueprints);

    // -------- Non-interactive short-circuit --------
    if (nonInteractive) {
        const workshopRelativePath =
            (defaults && defaults.workshopRelativePath) || "../beacon";
        const displayName =
            (defaults && defaults.displayName) ||
            (vaultPath ? path.basename(vaultPath) : "vault");

        const selectedMechs = Array.isArray(defaults.mechanisms)
            ? defaults.mechanisms.slice()
            : ["customjs-guard"];
        const selectedBlueprints = Array.isArray(defaults.blueprints)
            ? defaults.blueprints.slice()
            : [];

        return {
            config: {
                workshop_relative_path: workshopRelativePath,
                variables: { workshop: displayName }
            },
            subscription: {
                workshop_version:
                    (workshopManifest && workshopManifest.workshop_version) || "0.0.0",
                mechanisms: _buildSubscriptionEntries(selectedMechs, manifestMechs),
                blueprints: _buildSubscriptionEntries(selectedBlueprints, manifestBlueprints)
            }
        };
    }

    // -------- Interactive path --------
    const { input, checkbox, confirm } = _loadInquirer();

    // 1. Vault path (skip prompt if caller supplied one).
    let resolvedVaultPath = vaultPath;
    if (!resolvedVaultPath) {
        resolvedVaultPath = await input({
            message: "Vault path:",
            default: process.cwd(),
            validate: (v) => {
                if (!v) return "Path required";
                try {
                    const st = fs.statSync(v);
                    if (!st.isDirectory()) return `Not a directory: ${v}`;
                    return true;
                } catch (_e) {
                    return `Path does not exist: ${v}`;
                }
            }
        });
    }

    // 2. Workshop relative path.
    const defaultWorkshopRel =
        (defaults && defaults.workshopRelativePath) || "../beacon";
    const workshopRelativePath = await input({
        message: "Workshop relative path (from vault root):",
        default: defaultWorkshopRel,
        validate: (v) => {
            if (!v) return "Required";
            const candidate = path.join(resolvedVaultPath, v, "platform", "manifest.json");
            try {
                fs.statSync(candidate);
                return true;
            } catch (_e) {
                return `No platform/manifest.json found at ${candidate}`;
            }
        }
    });

    // 3. Vault display name.
    const defaultDisplayName =
        (defaults && defaults.displayName) || path.basename(resolvedVaultPath);
    const displayName = await input({
        message: "Vault display name:",
        default: defaultDisplayName,
        validate: (v) => (v && v.trim() ? true : "Required")
    });

    // 4. Mechanisms checkbox.
    const mechDefaultSet = new Set(
        Array.isArray(defaults.mechanisms)
            ? defaults.mechanisms
            : DEFAULT_MECHANISMS_CHECKED
    );
    const mechChoices = manifestMechs.map((m) => ({
        name: `${m.name}@${m.version}`,
        value: m.name,
        checked: mechDefaultSet.has(m.name)
    }));
    const selectedMechs =
        mechChoices.length > 0
            ? await checkbox({
                  message: "Select mechanisms to subscribe to:",
                  choices: mechChoices
              })
            : [];

    // 5. Blueprints checkbox.
    const blueprintDefaultSet = new Set(
        Array.isArray(defaults.blueprints) ? defaults.blueprints : []
    );
    const blueprintChoices = manifestBlueprints.map((b) => ({
        name: `${b.name}@${b.version}`,
        value: b.name,
        checked: blueprintDefaultSet.has(b.name)
    }));
    const selectedBlueprints =
        blueprintChoices.length > 0
            ? await checkbox({
                  message: "Select blueprints to subscribe to:",
                  choices: blueprintChoices
              })
            : [];

    // 6. Confirm.
    const proceed = await confirm({
        message: `Generate config + subscription for "${displayName}" (workshop=${workshopRelativePath}, ${selectedMechs.length} mechanisms, ${selectedBlueprints.length} blueprints)?`,
        default: true
    });
    if (!proceed) {
        throw new Error("First-run wizard aborted by user.");
    }

    // Trim on assignment — quality review #7. Validators reject empty strings
    // but don't strip leading/trailing whitespace; if the user types "  trips  "
    // the literal string would propagate into config.variables.workshop and
    // corrupt every materialized {{workshop}} substitution.
    return {
        config: {
            workshop_relative_path: String(workshopRelativePath).trim(),
            variables: { workshop: String(displayName).trim() }
        },
        subscription: {
            workshop_version:
                (workshopManifest && workshopManifest.workshop_version) || "0.0.0",
            mechanisms: _buildSubscriptionEntries(selectedMechs, manifestMechs),
            blueprints: _buildSubscriptionEntries(selectedBlueprints, manifestBlueprints)
        }
    };
}

// ----------------------------------------------------------------------------
// runReRunWizard
// ----------------------------------------------------------------------------

async function runReRunWizard(opts) {
    const {
        vaultPath,
        existingConfig = {},
        existingSubscription = {},
        workshopManifest = {},
        nonInteractive = false,
        action: actionOverride
    } = opts || {};

    // -------- Non-interactive short-circuit --------
    if (nonInteractive) {
        if (actionOverride) {
            return { action: actionOverride };
        }
        // Default fallback to "quit" so the bootstrap doesn't attempt destructive ops.
        return { action: "quit" };
    }

    // -------- Interactive path --------
    const { input, checkbox, select } = _loadInquirer();

    const action = await select({
        message: "Beacon already configured. What would you like to do?",
        choices: [
            {
                name: "Just install plugins + run installer (skip-if-present)",
                value: "install"
            },
            { name: "Edit subscription (mechanisms + blueprints)", value: "edit-sub" },
            { name: "Edit config (workshop path + display name)", value: "edit-cfg" },
            { name: "Force re-download plugins", value: "force-redl" },
            { name: "Quit", value: "quit" }
        ]
    });

    if (action === "install" || action === "quit") {
        return { action };
    }

    if (action === "edit-sub") {
        const manifestMechs = _safeArray(workshopManifest.mechanisms);
        const manifestBlueprints = _safeArray(workshopManifest.blueprints);

        const currentMechSet = new Set(
            _safeArray(existingSubscription.mechanisms).map((m) => m && m.name).filter(Boolean)
        );
        const currentBlueprintSet = new Set(
            _safeArray(existingSubscription.blueprints).map((b) => b && b.name).filter(Boolean)
        );

        const mechChoices = manifestMechs.map((m) => ({
            name: `${m.name}@${m.version}`,
            value: m.name,
            checked: currentMechSet.has(m.name)
        }));
        const selectedMechs =
            mechChoices.length > 0
                ? await checkbox({
                      message: "Mechanisms (toggle):",
                      choices: mechChoices
                  })
                : [];

        const blueprintChoices = manifestBlueprints.map((b) => ({
            name: `${b.name}@${b.version}`,
            value: b.name,
            checked: currentBlueprintSet.has(b.name)
        }));
        const selectedBlueprints =
            blueprintChoices.length > 0
                ? await checkbox({
                      message: "Blueprints (toggle):",
                      choices: blueprintChoices
                  })
                : [];

        return {
            action: "edit-sub",
            payload: {
                mechanisms: _buildSubscriptionEntries(selectedMechs, manifestMechs),
                blueprints: _buildSubscriptionEntries(selectedBlueprints, manifestBlueprints)
            }
        };
    }

    if (action === "edit-cfg") {
        const defaultRel =
            existingConfig.workshop_relative_path || "../beacon";
        const defaultDisplay =
            (existingConfig.variables && existingConfig.variables.workshop) ||
            (vaultPath ? path.basename(vaultPath) : "vault");

        const newRel = await input({
            message: "Workshop relative path:",
            default: defaultRel,
            validate: (v) => {
                if (!v) return "Required";
                if (!vaultPath) return true; // no validation possible without vault path
                const candidate = path.join(vaultPath, v, "platform", "manifest.json");
                try {
                    fs.statSync(candidate);
                    return true;
                } catch (_e) {
                    return `No platform/manifest.json found at ${candidate}`;
                }
            }
        });
        const newDisplay = await input({
            message: "Vault display name:",
            default: defaultDisplay,
            validate: (v) => (v && v.trim() ? true : "Required")
        });

        return {
            action: "edit-cfg",
            payload: {
                config: {
                    ...existingConfig,
                    workshop_relative_path: newRel,
                    variables: { ...(existingConfig.variables || {}), workshop: newDisplay }
                }
            }
        };
    }

    if (action === "force-redl") {
        // List currently-installed plugin ids from <vaultPath>/.obsidian/plugins/.
        // Quality review #8: filter to dirs that contain a manifest.json — otherwise
        // legacy junk dirs (.bak, half-deleted abandoned installs) leak into the
        // checkbox and selecting one fails opaquely at upstream-index lookup.
        let pluginIds = [];
        if (vaultPath) {
            const pluginsDir = path.join(vaultPath, ".obsidian", "plugins");
            try {
                pluginIds = fs
                    .readdirSync(pluginsDir, { withFileTypes: true })
                    .filter((d) => d.isDirectory())
                    .filter((d) => fs.existsSync(path.join(pluginsDir, d.name, "manifest.json")))
                    .map((d) => d.name);
            } catch (_e) {
                pluginIds = [];
            }
        }
        const choices = pluginIds.map((id) => ({ name: id, value: id, checked: false }));
        const selected =
            choices.length > 0
                ? await checkbox({
                      message: "Select plugins to force re-download:",
                      choices
                  })
                : [];
        return { action: "force-redl", payload: { ids: selected } };
    }

    // Fallback (shouldn't reach here)
    return { action: "quit" };
}

module.exports = { runFirstRunWizard, runReRunWizard };
