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
    "accent-button",
    "styling",
    "convenience"  // NEW v0.26.0 — DataviewJS + copy-path hotkeys on by default
];

// CF-5: canonical path variables the platform expects in every consumer's
// platform-config.json under `variables: {}`. These are platform conventions
// (every blueprint's files[] uses {{templates_path}}/Template, X.md etc.), not
// user choices, so the wizard writes them automatically without prompting.
// Identical layout across all consumers (barebones, accuris-mirror, scratch/*).
const CANONICAL_VARIABLES = {
    views_path: "ranch/views",
    templater_scripts_path: "ranch/templater",
    scripts_path: "ranch/scripts",
    rules_path: "ranch/rules",
    templates_path: "ranch/templates",
    commands_path: "commands"
};

function _safeArray(v) {
    return Array.isArray(v) ? v : [];
}

function _findEntry(list, name) {
    return _safeArray(list).find((x) => x && x.name === name) || null;
}

/**
 * v0.26.0 CF-2 — derive a valid Obsidian tag from a vault display name.
 *
 * Obsidian tags must contain at least one non-numeric character; numbers-only
 * tags are rejected at render time (shown with strikethrough). Additionally,
 * unquoted numeric values in YAML tag arrays parse as integers, mixing types
 * with sibling string tags and triggering "Type Mismatch" in the Properties
 * panel.
 *
 * Strategy: lowercase + trim, then prefix with "vault-" when the result is
 * numbers-only, leaving alphanumeric names untouched.
 *
 *   "scratch/11"     basename "11"     → "vault-11"
 *   "MyVault"        basename "MyVault" → "myvault"
 *   "Personal Notes" basename "Personal Notes" → "personal notes"  (caller may sanitize)
 */
function _deriveVaultIdentityTag(displayName) {
    const lower = String(displayName || "vault").trim().toLowerCase();
    if (!lower) return "vault";
    if (/^\d+$/.test(lower)) return `vault-${lower}`;
    return lower;
}

/**
 * v0.26.1 P1-3c — load each blueprint's full manifest (with depends_on) from
 * <workshopPath>/platform/blueprints/<name>/manifest.json. Workshop manifest's
 * blueprints[] entries are {name, version, path} only; the depends_on array
 * lives in the per-blueprint manifest. Best-effort: missing/malformed manifests
 * are silently skipped (returns shorter array). Pure (no I/O outside readFileSync).
 */
function _loadFullBlueprintManifests(workshopPath, workshopManifest) {
    const out = [];
    const entries = _safeArray(workshopManifest && workshopManifest.blueprints);
    for (const e of entries) {
        if (!e || typeof e.name !== "string") continue;
        try {
            const p = path.join(workshopPath, "platform/blueprints", e.name, "manifest.json");
            const m = JSON.parse(fs.readFileSync(p, "utf8"));
            out.push(m);
        } catch (_e) { /* best-effort */ }
    }
    return out;
}

/**
 * v0.26.1 P1-3c — auto-add the "convenience" mechanism to selectedMechs when
 * any selected blueprint declares a depends_on entry for it. Pure: no I/O.
 *
 * - Returns input unchanged if convenience is already selected (no duplicate).
 * - Returns input unchanged if no selected blueprint depends on convenience.
 * - Otherwise returns a new array with "convenience" appended.
 *
 * @param selectedMechs - array of mechanism names already chosen
 * @param selectedBlueprints - array of blueprint names already chosen
 * @param fullBlueprints - array of full blueprint manifests (name + depends_on);
 *                         see _loadFullBlueprintManifests
 */
function _autoAddConvenienceIfDvBlueprintsSelected(selectedMechs, selectedBlueprints, fullBlueprints) {
    const mechs = _safeArray(selectedMechs);
    if (mechs.includes("convenience")) return mechs.slice();
    const bps = _safeArray(selectedBlueprints);
    const fulls = _safeArray(fullBlueprints);
    const triggering = [];
    for (const name of bps) {
        const full = fulls.find((b) => b && b.name === name);
        if (!full || !Array.isArray(full.depends_on)) continue;
        if (full.depends_on.some((d) => d && d.name === "convenience")) {
            triggering.push(name);
        }
    }
    if (triggering.length === 0) return mechs.slice();
    if (!process.env.SAUCE_TEST_MODE) {
        console.log(`[info] Auto-added convenience because ${triggering[0]} depends on it.`);
    }
    return [...mechs, "convenience"];
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

/**
 * v0.26.0 P0-1 — coerce a possibly-double-wrapped subscription entry to the flat
 * {name: string, version: string} shape. Defensive: handles three input shapes:
 *
 *   1. flat:        {name: "X", version: "1.0.0"}             → unchanged
 *   2. legacy wrap: {name: {name: "X", version: "1.0.0"}, version: "0.0.0"}
 *                   → {name: "X", version: "1.0.0"} (inner wins)
 *   3. bare string: "X"                                       → {name: "X", version}
 *
 * Version resolution priority: inner-wrap > flat-stored > manifest > "0.0.0".
 * Returns null when no usable name can be derived.
 *
 * @param entry - one element of subscription.mechanisms[] or .blueprints[]
 * @param manifestEntries - workshop manifest list to fall back to for version
 */
function _coerceSubscriptionEntry(entry, manifestEntries) {
    if (entry == null) return null;

    let name = null;
    let version = null;

    if (typeof entry === "string") {
        name = entry;
    } else if (typeof entry === "object") {
        if (entry.name && typeof entry.name === "object") {
            // Legacy double-wrap shape: inner object holds the real values.
            name = typeof entry.name.name === "string" ? entry.name.name : null;
            version =
                typeof entry.name.version === "string" && entry.name.version
                    ? entry.name.version
                    : null;
        } else if (typeof entry.name === "string") {
            name = entry.name;
            if (typeof entry.version === "string" && entry.version && entry.version !== "0.0.0") {
                version = entry.version;
            }
        }
    }

    if (!name) return null;

    if (!version) {
        const m = _findEntry(manifestEntries, name);
        if (m && typeof m.version === "string") {
            version = m.version;
        }
    }

    // I-1 (v0.26.0 quality review): mirror _buildSubscriptionEntries skip-unknown
    // behavior. When the name has no resolvable version (not in entry, not in
    // manifest), return null rather than emitting a "0.0.0" zombie entry — that
    // sentinel was the v0.25.x bug-value and propagating it perpetuates the
    // broken state. Caller filters nulls out.
    if (!version) return null;

    return { name, version };
}

/**
 * v0.26.0 P0-1 — Heal legacy double-wrapped subscription entries on writeback.
 *
 * Reads <vault>/ranch/platform-subscription.json (if it exists) to preserve any
 * pre-existing top-level fields (e.g. workshop_version), then constructs flat
 * {name: string, version: string} entries from the bare-string `selection` by
 * looking up versions in `manifestEntries`. Atomic write (tmp + rename) to
 * protect against partial writes. Idempotent — running twice with the same
 * selection produces the same file byte-for-byte.
 *
 * @param subPath - absolute path to ranch/platform-subscription.json
 * @param selection - { mechanisms: string[], blueprints: string[] } bare-string
 *                    names to subscribe to (already-deduped by caller)
 * @param manifestEntries - { mechanisms: Array, blueprints: Array } workshop
 *                          manifest entries to resolve versions from
 */
function _normalizeSubscriptionFile(subPath, selection, manifestEntries) {
    const sel = selection || {};
    const me = manifestEntries || {};
    const mechManifest = _safeArray(me.mechanisms);
    const blueprintManifest = _safeArray(me.blueprints);

    // Read existing file to preserve top-level fields (workshop_version etc.).
    // Best-effort: missing file or malformed JSON → start from empty object.
    let existing = {};
    try {
        if (fs.existsSync(subPath)) {
            existing = JSON.parse(fs.readFileSync(subPath, "utf8")) || {};
        }
    } catch (_e) {
        existing = {};
    }

    const buildFlat = (names, manifest) => {
        const out = [];
        for (const raw of _safeArray(names)) {
            // Selection should be bare strings, but coerce defensively in case
            // a legacy callsite passes already-objects (the v0.25.x bug shape).
            const coerced = _coerceSubscriptionEntry(raw, manifest);
            if (coerced) out.push(coerced);
        }
        return out;
    };

    const out = Object.assign({}, existing, {
        mechanisms: buildFlat(sel.mechanisms, mechManifest),
        blueprints: buildFlat(sel.blueprints, blueprintManifest)
    });

    // Atomic write: write to tmp + rename. Protects against partial writes if
    // the process is interrupted mid-write.
    const tmp = subPath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
    fs.renameSync(tmp, subPath);
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

    // workshopManifest may be null on first-run interactive (bootstrap.js
    // defers manifest discovery so the wizard can prompt for + validate the
    // path first — CF-3 fix). We resolve `manifestMechs` / `manifestBlueprints`
    // from the loaded manifest LATER, after the workshop_relative_path prompt.
    let resolvedManifest = workshopManifest;
    let manifestMechs = _safeArray(resolvedManifest && resolvedManifest.mechanisms);
    let manifestBlueprints = _safeArray(resolvedManifest && resolvedManifest.blueprints);

    // -------- Non-interactive short-circuit --------
    if (nonInteractive) {
        const workshopRelativePath =
            (defaults && defaults.workshopRelativePath) || "pantry";
        const displayName =
            (defaults && defaults.displayName) ||
            (vaultPath ? path.basename(vaultPath) : "vault");

        // CF-3: if workshopManifest wasn't provided, attempt to load it from
        // the resolved workshopRelativePath so subscription entries can be
        // built with real version pins. If load fails, fall back to "0.0.0"
        // + empty arrays (the BS8 harness contract: subscription is "valid"
        // — non-empty workshop_version string + arrays present).
        if (!resolvedManifest && vaultPath) {
            // Use path.resolve so absolute workshopRelativePath (BS8 contract)
            // restarts the resolution; path.join would concatenate wrongly.
            const wmPath = path.resolve(vaultPath, workshopRelativePath, "platform/manifest.json");
            try {
                resolvedManifest = JSON.parse(fs.readFileSync(wmPath, "utf8"));
                manifestMechs = _safeArray(resolvedManifest.mechanisms);
                manifestBlueprints = _safeArray(resolvedManifest.blueprints);
            } catch (_e) {
                // Stay with empty arrays — non-fatal in nonInteractive contract.
            }
        }

        // v0.22.1: align nonInteractive default-set with interactive default
        // (DEFAULT_MECHANISMS_CHECKED — 5 mechs). Honor "all" / [] / array
        // overrides. Same shape for blueprints (default empty array).
        const _resolveMechs = (v) => {
            if (v === "all") return manifestMechs.map((m) => m.name);
            if (Array.isArray(v)) return v.slice();
            return DEFAULT_MECHANISMS_CHECKED.slice();
        };
        const _resolveBlueprints = (v) => {
            if (v === "all") return manifestBlueprints.map((b) => b.name);
            if (Array.isArray(v)) return v.slice();
            return [];
        };
        let selectedMechs = _resolveMechs(defaults && defaults.mechanisms);
        const selectedBlueprints = _resolveBlueprints(defaults && defaults.blueprints);

        // v0.26.1 P1-3c: auto-add convenience when any selected blueprint
        // depends on it. Reads per-blueprint manifests from disk to learn
        // depends_on (workshop manifest's blueprints[] is name/version only).
        const workshopPathForLoad =
            (vaultPath && workshopRelativePath)
                ? path.resolve(vaultPath, workshopRelativePath)
                : null;
        if (workshopPathForLoad && resolvedManifest) {
            const fullBlueprints = _loadFullBlueprintManifests(workshopPathForLoad, resolvedManifest);
            selectedMechs = _autoAddConvenienceIfDvBlueprintsSelected(
                selectedMechs, selectedBlueprints, fullBlueprints
            );
        }

        return {
            config: {
                workshop_relative_path: workshopRelativePath,
                variables: Object.assign({}, CANONICAL_VARIABLES, {
                    workshop: displayName,
                    vault_identity_tag: _deriveVaultIdentityTag(displayName)
                })
            },
            subscription: {
                workshop_version:
                    (resolvedManifest && resolvedManifest.workshop_version) || "0.0.0",
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
        (defaults && defaults.workshopRelativePath) || "pantry";
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

    // CF-3: load the workshop manifest now that the path has validated.
    // Caller may have passed null (deferred discovery) — populate locally so
    // the mechanism + blueprint checkboxes have real choices.
    if (!resolvedManifest) {
        // path.resolve so absolute workshop_relative_path is honored.
        const wmPath = path.resolve(resolvedVaultPath, workshopRelativePath, "platform/manifest.json");
        try {
            resolvedManifest = JSON.parse(fs.readFileSync(wmPath, "utf8"));
            manifestMechs = _safeArray(resolvedManifest.mechanisms);
            manifestBlueprints = _safeArray(resolvedManifest.blueprints);
        } catch (e) {
            throw new Error(`Failed to read workshop manifest at ${wmPath}: ${e.message}`);
        }
    }

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
    let selectedMechs =
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

    // v0.26.1 P1-3c: auto-add convenience when any selected blueprint
    // depends on it. Reads per-blueprint manifests from disk to learn
    // depends_on (workshop manifest's blueprints[] is name/version only).
    {
        const workshopPathForLoad = path.resolve(resolvedVaultPath, workshopRelativePath);
        const fullBlueprints = _loadFullBlueprintManifests(workshopPathForLoad, resolvedManifest);
        selectedMechs = _autoAddConvenienceIfDvBlueprintsSelected(
            selectedMechs, selectedBlueprints, fullBlueprints
        );
    }

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
            variables: Object.assign({}, CANONICAL_VARIABLES, {
                workshop: String(displayName).trim(),
                vault_identity_tag: _deriveVaultIdentityTag(displayName)
            })
        },
        subscription: {
            workshop_version:
                (resolvedManifest && resolvedManifest.workshop_version) || "0.0.0",
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
        message: "Sauce already configured. What would you like to do?",
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
            existingConfig.workshop_relative_path || "pantry";
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

module.exports = {
    runFirstRunWizard,
    runReRunWizard,
    _normalizeSubscriptionFile,
    _coerceSubscriptionEntry,
    _loadFullBlueprintManifests,
    _autoAddConvenienceIfDvBlueprintsSelected
};
