// platform/migrate/commit.js — v0.28.0 S2 (T2.7).
//
// 5-phase --commit orchestrator. Failure-loud with abort+restore on
// phases 2-4 errors. Backup sibling at <vault>.pre-migration-<ts>/.
//
// Phases:
//   0. precheck    — verify --from valid, target writable, backup-sibling free
//   1. backup      — copy vault contents to sibling backup; wipe vault contents
//                    (preserving the vault directory entry itself for Obsidian
//                    Sync continuity)
//   2. bootstrap   — write platform-config.json + platform-subscription.json,
//                    materialize thin stub, run installer (rebuilds ranch/ +
//                    spice/ + .obsidian/ allowlisted files)
//   3. carry       — cp source → target for verbatim entries
//   4. rewrite     — invoke each migrator's migrate() per planEntry
//   4.5. wikilinks — cross-blueprint wikilink-rewrite pass
//   5. finalize    — write migration.log + migration-plan.json

const fs = require("fs");
const path = require("path");
const wikilinkRewrite = require("./wikilink-rewrite");

function _tsForBackup() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function _readJson(p) {
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

function _writeJsonAtomic(p, obj) {
    const tmp = p + ".tmp-" + process.pid + "-" + Date.now();
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
    fs.renameSync(tmp, p);
}

function _ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
}

// Belt-and-suspenders target containment check. Each migrator does its own
// raw-segment `..` rejection, but resolving + sep-prefix check catches
// pathological tgt values that escape via path.join interactions.
// Quality-review I-5.
function _assertTargetWithinRoot(tgtRoot, tgt) {
    if (!tgt || typeof tgt !== "string") {
        throw new Error(`commit: invalid target path: ${tgt}`);
    }
    const rootResolved = path.resolve(tgtRoot);
    const tgtResolved = path.resolve(rootResolved, tgt);
    if (tgtResolved !== rootResolved && !tgtResolved.startsWith(rootResolved + path.sep)) {
        throw new Error(`commit: target ${tgtResolved} escapes vault root ${rootResolved}`);
    }
}

function _cpRecursive(src, dst) {
    const st = fs.statSync(src);
    if (st.isDirectory()) {
        _ensureDir(dst);
        for (const name of fs.readdirSync(src)) {
            _cpRecursive(path.join(src, name), path.join(dst, name));
        }
    } else if (st.isFile()) {
        fs.copyFileSync(src, dst);
        try { fs.utimesSync(dst, st.atime, st.mtime); } catch (_e) { /* best-effort */ }
    }
}

// Phase 0 — precheck. Throws on failure; returns resolved paths.
function _precheck(plan, opts) {
    const ctx = opts.ctx || {};
    const fromAbs = opts.fromAbs;
    if (!fromAbs || !fs.existsSync(fromAbs) || !fs.statSync(fromAbs).isDirectory()) {
        throw new Error(`commit precheck: --from must be a valid directory: ${fromAbs}`);
    }
    const vaultPath = ctx.vaultPath || process.cwd();
    if (!fs.existsSync(vaultPath) || !fs.statSync(vaultPath).isDirectory()) {
        throw new Error(`commit precheck: target vault path does not exist: ${vaultPath}`);
    }
    if (!ctx.workshopPath) {
        throw new Error(`commit precheck: ctx.workshopPath not resolved (sauce CLI must be activated inside the target vault)`);
    }
    if (!fs.existsSync(ctx.workshopPath)) {
        throw new Error(`commit precheck: workshopPath does not exist: ${ctx.workshopPath}`);
    }
    if ((plan.collisions || []).length > 0) {
        const lines = plan.collisions.map(c => `  ${c.tgt} ← ${c.srcs.join(", ")}`).join("\n");
        throw new Error(`commit precheck: plan has ${plan.collisions.length} target collisions:\n${lines}`);
    }
    const ts = _tsForBackup();
    const backupDir = path.resolve(vaultPath, "..", path.basename(vaultPath) + ".pre-migration-" + ts);
    if (fs.existsSync(backupDir)) {
        throw new Error(`commit precheck: backup-sibling already exists: ${backupDir}`);
    }
    return { vaultPath, workshopPath: ctx.workshopPath, backupDir, fromAbs };
}

// Phase 1 — backup vault contents to sibling backup; wipe vault contents
// preserving the vault dir entry itself.
//
// Crash-safety: writes a `.in-progress` marker before copying, removes it
// after the wipe completes; sentinel JSON records vaultPath so restore can
// validate identity. precheck on subsequent runs surfaces stale in-progress
// markers as orphan-backup warnings.
function _backup(paths) {
    const { vaultPath, backupDir } = paths;
    _ensureDir(backupDir);
    const inProgressMarker = path.join(backupDir, ".in-progress");
    const sentinelPath = path.join(backupDir, ".sauce-migration-meta.json");
    fs.writeFileSync(inProgressMarker, "");
    fs.writeFileSync(sentinelPath, JSON.stringify({
        vaultPath: path.resolve(vaultPath),
        startedAt: new Date().toISOString()
    }, null, 2), "utf8");
    const entries = fs.readdirSync(vaultPath);
    for (const name of entries) {
        _cpRecursive(path.join(vaultPath, name), path.join(backupDir, name));
    }
    // Wipe vault contents; preserve vault dir entry.
    for (const name of entries) {
        const p = path.join(vaultPath, name);
        fs.rmSync(p, { recursive: true, force: true });
    }
    fs.rmSync(inProgressMarker, { force: true });
}

// Phase 2 — bootstrap. Re-establish Sauce platform state inside the empty vault.
async function _bootstrap(paths, opts) {
    const { vaultPath, workshopPath, backupDir } = paths;
    const ctx = (opts && opts.ctx) || {};
    const legacyVars = (ctx.config && ctx.config.variables) || {};
    const workshopManifest = ctx.workshopManifest || _readJson(path.join(workshopPath, "platform/manifest.json"));

    // Resolve workshop_relative_path: prefer existing config, else compute
    // from filesystem layout (workshopPath relative to vaultPath).
    const wrp = (ctx.config && ctx.config.workshop_relative_path)
        || path.relative(vaultPath, workshopPath).replace(/\\/g, "/");

    // 2a. ranch/platform-config.json — write CANONICAL Sauce paths only.
    // Migration cycles BRING vaults up to current schema; legacy variables
    // (e.g., Extras/Scripts, Extras/Templates, ranch/Templater uppercase)
    // pre-date v0.24.0/v0.25.0 lowercase + spice/ namespace renames and
    // would point at directories that no longer exist post-wipe. Only
    // vault_identity_tag (a per-vault identifier) is preserved from legacy.
    const config = {
        workshop_relative_path: wrp,
        vault_identity: legacyVars.vault_identity_tag || "accuris",
        variables: {
            views_path: "ranch/views",
            templater_scripts_path: "ranch/templater",
            scripts_path: "ranch/scripts",
            rules_path: "ranch/rules",
            templates_path: "ranch/templates",
            commands_path: "commands",
            vault_identity_tag: legacyVars.vault_identity_tag || "accuris"
        }
    };
    _ensureDir(path.join(vaultPath, "ranch"));
    _writeJsonAtomic(path.join(vaultPath, "ranch/platform-config.json"), config);

    // 2b. ranch/platform-subscription.json — subscribe to all mechs + bps
    const subscription = {
        mechanisms: (workshopManifest.mechanisms || []).map(m => ({ name: m.name, version: m.version })),
        blueprints: (workshopManifest.blueprints || []).map(b => ({ name: b.name, version: b.version }))
    };
    _writeJsonAtomic(path.join(vaultPath, "ranch/platform-subscription.json"), subscription);

    // 2c. Restore .obsidian/ from backup if present (preserves user's
    // vault-level Obsidian config + plugin installs without re-fetching).
    // After restore, scrub installer-managed plugin data files (allowlist
    // #12) so the installer's helpers write canonical entries fresh —
    // legacy paths from a pre-Sauce-rebrand consumer would otherwise win
    // first-wins merges and prevent canonical paths from being applied.
    const backupObsidian = path.join(backupDir, ".obsidian");
    if (fs.existsSync(backupObsidian)) {
        _cpRecursive(backupObsidian, path.join(vaultPath, ".obsidian"));
        const ALLOWLIST_MANAGED_PATHS = [
            ".obsidian/plugins/templater-obsidian/data.json",
            ".obsidian/plugins/slash-commander/data.json",
            ".obsidian/daily-notes.json",
            ".obsidian/appearance.json",
            ".obsidian/plugins/obsidian-style-settings/data.json",
            ".obsidian/hotkeys.json",
            ".obsidian/plugins/dataview/data.json",
            ".obsidian/plugins/customjs/data.json",
            ".obsidian/app.json"
        ];
        for (const rel of ALLOWLIST_MANAGED_PATHS) {
            const abs = path.join(vaultPath, rel);
            if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
        }
    }

    // 2d. Materialize thin stub at ranch/templater/platformInstall.js.
    const stubSrc = path.join(workshopPath, "platform/installer-stub.js");
    if (!fs.existsSync(stubSrc)) {
        throw new Error(`commit bootstrap: workshop installer-stub missing: ${stubSrc}`);
    }
    _ensureDir(path.join(vaultPath, "ranch/templater"));
    fs.copyFileSync(stubSrc, path.join(vaultPath, "ranch/templater/platformInstall.js"));

    // 2e. Run installer.
    const installer = require(path.join(workshopPath, "platform/install.js"));
    if (typeof installer.runInstall === "function") {
        await installer.runInstall(vaultPath);
    }
}

// Phase 3 — verbatim copy of all entries with action: "copy_verbatim".
// Failure-loud (matches phase 4 _rewriteBlueprints): missing source aborts
// + restores from backup. Quality-review C-1.
function _carryVerbatim(plan, paths) {
    const { vaultPath, fromAbs } = paths;
    const verbatim = require("./verbatim");
    for (const entry of plan.planEntries) {
        if (entry.action !== "copy_verbatim") continue;
        _assertTargetWithinRoot(vaultPath, entry.tgt);
        const srcAbs = path.join(fromAbs, entry.src);
        if (!fs.existsSync(srcAbs)) {
            throw new Error(`commit verbatim: source missing for ${entry.src}`);
        }
        verbatim.migrate(entry, srcAbs, vaultPath, {});
    }
}

// Phase 4 — invoke each per-blueprint migrator's migrate() per plan entry.
function _rewriteBlueprints(plan, paths, opts) {
    const { vaultPath, fromAbs } = paths;
    const ctx = (opts && opts.ctx) || {};
    const migratorsDir = path.join(__dirname, "migrators");
    const cache = {};
    function _loadByName(name) {
        if (cache[name]) return cache[name];
        const tryPath = path.join(migratorsDir, name + ".js");
        if (fs.existsSync(tryPath)) {
            cache[name] = require(tryPath);
            return cache[name];
        }
        return null;
    }
    for (const entry of plan.planEntries) {
        if (entry.action !== "rewrite_blueprint") continue;
        _assertTargetWithinRoot(vaultPath, entry.tgt);
        const m = _loadByName(entry.migrator);
        if (!m) throw new Error(`commit rewrite: cannot resolve migrator "${entry.migrator}" for ${entry.src}`);
        const srcAbs = path.join(fromAbs, entry.src);
        if (!fs.existsSync(srcAbs)) throw new Error(`commit rewrite: source missing for ${entry.src}`);
        m.migrate(entry, srcAbs, vaultPath, ctx);
    }
    // mtime preservation is applied as the FINAL step in commit() after
    // phase 4.5 wikilink-rewrite completes — not here. Two-step preservation
    // (phase 4 + phase 4.5) was racing/failing on macOS APFS for files that
    // got rewritten in phase 4.5; single post-all-writes utimesSync sweep is
    // robust.
}

// Phase 4.6 — restore source mtime on every migrated rewrite_blueprint file
// after phase 4 + 4.5 are complete. Best-effort: never aborts migration.
function _preserveMtimes(plan, paths) {
    const { vaultPath, fromAbs } = paths;
    let restored = 0;
    let failed = 0;
    for (const entry of plan.planEntries) {
        if (entry.action !== "rewrite_blueprint") continue;
        try {
            const srcAbs = path.join(fromAbs, entry.src);
            const tgtAbs = path.join(vaultPath, entry.tgt);
            if (!fs.existsSync(srcAbs) || !fs.existsSync(tgtAbs)) { continue; }
            const st = fs.statSync(srcAbs);
            fs.utimesSync(tgtAbs, st.atime, st.mtime);
            restored++;
        } catch (_e) { failed++; }
    }
    return { restored, failed };
}

// Phase 4.5 — cross-blueprint wikilink rewrite pass.
function _wikilinkRewritePass(plan, paths) {
    return wikilinkRewrite.rewriteAll(paths.vaultPath, plan.planEntries);
}

// Phase 5 — finalize. Write migration.log + migration-plan.json.
function _finalize(plan, paths, wikilinkResult) {
    const { vaultPath, backupDir, fromAbs } = paths;
    const counts = {};
    for (const e of plan.planEntries) {
        const key = e.migrator + "/" + e.action;
        counts[key] = (counts[key] || 0) + 1;
    }
    const log = {
        finishedAt: new Date().toISOString(),
        source: fromAbs,
        target: vaultPath,
        backup: backupDir,
        counts,
        warnings: plan.warnings || [],
        collisions: plan.collisions || [],
        wikilinkRewrites: wikilinkResult || null
    };
    try {
        _writeJsonAtomic(path.join(vaultPath, "migration.log"), log);
    } catch (e) {
        if (!process.env.SAUCE_TEST_MODE) {
            console.error(`finalize: failed to write migration.log: ${e.message}`);
        }
    }
    try {
        _writeJsonAtomic(path.join(vaultPath, "migration-plan.json"), {
            planEntries: plan.planEntries,
            warnings: plan.warnings || [],
            collisions: plan.collisions || [],
            counts,
            generatedAt: new Date().toISOString()
        });
    } catch (e) {
        if (!process.env.SAUCE_TEST_MODE) {
            console.error(`finalize: failed to write migration-plan.json: ${e.message}`);
        }
    }
}

// abort+restore — wipes vault contents + restores from backup.
// Validates the backup's sentinel records the same vaultPath we're about to
// restore into; refuses on mismatch. Quality-review I-2.
function restoreFromBackup(vaultDir, backupDir) {
    if (!fs.existsSync(backupDir)) {
        throw new Error(`restoreFromBackup: backup dir missing: ${backupDir}`);
    }
    const sentinelPath = path.join(backupDir, ".sauce-migration-meta.json");
    if (fs.existsSync(sentinelPath)) {
        let sentinel;
        try { sentinel = JSON.parse(fs.readFileSync(sentinelPath, "utf8")); }
        catch (e) { throw new Error(`restoreFromBackup: sentinel unreadable: ${e.message}`); }
        const expected = path.resolve(vaultDir);
        if (sentinel.vaultPath !== expected) {
            throw new Error(`restoreFromBackup: vaultDir mismatch — sentinel records ${sentinel.vaultPath}, caller passed ${expected}`);
        }
    }
    if (fs.existsSync(vaultDir)) {
        for (const name of fs.readdirSync(vaultDir)) {
            fs.rmSync(path.join(vaultDir, name), { recursive: true, force: true });
        }
    } else {
        _ensureDir(vaultDir);
    }
    for (const name of fs.readdirSync(backupDir)) {
        if (name === ".sauce-migration-meta.json" || name === ".in-progress") continue;
        _cpRecursive(path.join(backupDir, name), path.join(vaultDir, name));
    }
}

// Main entry point.
async function commit(plan, opts) {
    const paths = _precheck(plan, opts);
    if (!process.env.SAUCE_TEST_MODE) {
        console.log(`commit phase 0 — precheck OK (vault=${paths.vaultPath}, backup=${paths.backupDir})`);
    }

    _backup(paths);
    if (!process.env.SAUCE_TEST_MODE) console.log(`commit phase 1 — backup complete`);

    let wikilinkResult = null;
    try {
        await _bootstrap(paths, opts);
        if (!process.env.SAUCE_TEST_MODE) console.log(`commit phase 2 — bootstrap complete`);
        _carryVerbatim(plan, paths);
        if (!process.env.SAUCE_TEST_MODE) console.log(`commit phase 3 — verbatim carry complete`);
        _rewriteBlueprints(plan, paths, opts);
        if (!process.env.SAUCE_TEST_MODE) console.log(`commit phase 4 — blueprint rewrites complete`);
        wikilinkResult = _wikilinkRewritePass(plan, paths);
        if (!process.env.SAUCE_TEST_MODE) console.log(`commit phase 4.5 — wikilink rewrite (${wikilinkResult.rewrites} files updated of ${wikilinkResult.filesScanned} scanned)`);
        const mtimeResult = _preserveMtimes(plan, paths);
        if (!process.env.SAUCE_TEST_MODE) console.log(`commit phase 4.6 — mtime preserve (${mtimeResult.restored} restored, ${mtimeResult.failed} failed)`);
    } catch (err) {
        if (!process.env.SAUCE_TEST_MODE) console.error(`commit ABORT: ${err.message}\nrestoring from backup...`);
        try { restoreFromBackup(paths.vaultPath, paths.backupDir); } catch (re) {
            if (!process.env.SAUCE_TEST_MODE) console.error(`restore FAILED: ${re.message}\nbackup intact at: ${paths.backupDir}`);
        }
        throw err;
    }

    _finalize(plan, paths, wikilinkResult);
    if (!process.env.SAUCE_TEST_MODE) console.log(`commit phase 5 — finalize complete (migration.log + migration-plan.json written)`);

    return { paths, wikilinkResult, ok: true };
}

module.exports = { commit, restoreFromBackup, _precheck, _backup, _bootstrap, _carryVerbatim, _rewriteBlueprints, _wikilinkRewritePass, _finalize };
