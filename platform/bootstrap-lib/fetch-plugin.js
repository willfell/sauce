/**
 * platform/bootstrap-lib/fetch-plugin.js
 *
 * Fetches a single Obsidian community plugin's release assets from GitHub
 * and vendors them into <vault>/.obsidian/plugins/<id>/.
 *
 * Contract (verbatim):
 *   fetchPlugin({ id, repo, vaultPath, force, httpsClient }) → Promise<{ status, files }>
 *     status: "fetched" | "skipped" | "failed"
 *     files: { manifestJson, mainJs, stylesCss?: optional }
 *
 *   Behavior:
 *     - If !force AND fs.existsSync(<vault>/.obsidian/plugins/<id>/manifest.json):
 *         return { status: "skipped" }
 *     - Else: HTTPS GET 3 assets from
 *         https://github.com/<repo>/releases/latest/download/{manifest.json,main.js,styles.css}
 *       - manifest.json + main.js missing → throw (BS5: per-plugin failure)
 *       - styles.css missing → tolerate (BS4)
 *     - mkdir <vault>/.obsidian/plugins/<id>/ (recursive)
 *     - Write each file ATOMICALLY (.tmp + rename). If overwriting,
 *       write `<file>.sauce-backup` first (matches landmine #12 mechanic
 *       from v0.1.3+). Backup-failure is a hard fail (mirrors
 *       applyTemplaterHotkeys posture in install.js).
 *     - Return { status: "fetched", files: {...} }
 *     - A successful download is also written to the on-disk last-known-good
 *       cache (net-cache.js, entry plugins/<id>.json, keyed by repo).
 *     - If a download fails TRANSIENTLY (network / timeout / 5xx / 429, after
 *       _https.getText's retries) and the cache holds this id from the same
 *       repo, the cached files are vendored instead and the result is
 *       { status: "fetched", files, source: "cache", cachedAt }. Without a
 *       cached copy, and for every non-transient failure (404 ...), it throws
 *       exactly as before.
 *
 *   Honors process.env.GITHUB_TOKEN.
 *
 * Defense in depth:
 *   - Plugin id is validated against /^[a-z0-9][a-z0-9._-]*$/i and rejected if
 *     it would resolve outside the plugins root via path.relative — guards
 *     against a hostile upstream JSON entry or attacker-controlled --reinstall
 *     argument that contains "..".
 *   - HTTPS layer is the shared bootstrap-lib/_https.js (drains response on
 *     non-200 to free the socket).
 */

const fs = require("fs");
const path = require("path");

const _https = require("./_https.js");
const netCache = require("./net-cache.js");

const _PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

function _validatePluginPath(pluginsRoot, pluginDir, id) {
    const rel = path.relative(pluginsRoot, pluginDir);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error(`fetchPlugin: refusing unsafe plugin id '${id}' (resolves outside plugins root)`);
    }
}

function _writeAtomic(targetPath, content) {
    const tmp = targetPath + ".tmp";
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, targetPath);
}

function _writeWithBackup(targetPath, content) {
    if (fs.existsSync(targetPath)) {
        const backupPath = targetPath + ".sauce-backup";
        try {
            fs.copyFileSync(targetPath, backupPath);
        } catch (e) {
            // Failure-loud: mirrors v0.1.3 applyTemplaterHotkeys posture
            // (install.js applyTemplaterHotkeys aborts on backup failure
            // rather than silently overwriting a file we can't recover).
            throw new Error(`fetchPlugin: backup-on-edit failed for ${targetPath}: ${e.message}`);
        }
    }
    _writeAtomic(targetPath, content);
}

async function fetchPlugin(opts) {
    const { id, repo, vaultPath, force } = opts || {};
    if (!id) throw new Error("fetchPlugin: id required");
    if (!repo) throw new Error(`fetchPlugin(${id}): repo required`);
    if (!vaultPath) throw new Error(`fetchPlugin(${id}): vaultPath required`);
    if (!_PLUGIN_ID_RE.test(id)) {
        throw new Error(`fetchPlugin: invalid plugin id '${id}' (must match ${_PLUGIN_ID_RE})`);
    }

    const pluginsRoot = path.join(vaultPath, ".obsidian", "plugins");
    const pluginDir = path.join(pluginsRoot, id);
    _validatePluginPath(pluginsRoot, pluginDir, id);

    const manifestTarget = path.join(pluginDir, "manifest.json");
    const mainTarget = path.join(pluginDir, "main.js");
    const stylesTarget = path.join(pluginDir, "styles.css");

    if (!force && fs.existsSync(manifestTarget)) {
        return { status: "skipped" };
    }

    const headers = {};
    const token = process.env.GITHUB_TOKEN;
    if (token) {
        headers.Authorization = "Bearer " + token;
    }

    const cacheEntry = `plugins/${id}.json`;
    let downloaded;
    try {
        downloaded = await _downloadAssets(id, repo, headers, opts);
    } catch (e) {
        const cached = e && e.transient === true ? _readCachedPlugin(cacheEntry, repo) : null;
        if (!cached) throw e;
        fs.mkdirSync(pluginDir, { recursive: true });
        const files = _vendor(cached.files, manifestTarget, mainTarget, stylesTarget);
        return { status: "fetched", files, source: "cache", cachedAt: cached.fetched_at, networkError: e.message };
    }

    fs.mkdirSync(pluginDir, { recursive: true });
    const files = _vendor(downloaded, manifestTarget, mainTarget, stylesTarget);
    netCache.writeEntry(cacheEntry, { repo, fetched_at: new Date().toISOString(), files });
    return { status: "fetched", files };
}

function _readCachedPlugin(cacheEntry, repo) {
    const entry = netCache.readEntry(cacheEntry);
    if (!entry || entry.repo !== repo || !entry.files) return null;
    const { manifestJson, mainJs, stylesCss } = entry.files;
    if (typeof manifestJson !== "string" || typeof mainJs !== "string") return null;
    if (stylesCss !== undefined && typeof stylesCss !== "string") return null;
    return entry;
}

function _vendor(assets, manifestTarget, mainTarget, stylesTarget) {
    _writeWithBackup(manifestTarget, assets.manifestJson);
    _writeWithBackup(mainTarget, assets.mainJs);

    const files = { manifestJson: assets.manifestJson, mainJs: assets.mainJs };
    if (typeof assets.stylesCss === "string") {
        _writeWithBackup(stylesTarget, assets.stylesCss);
        files.stylesCss = assets.stylesCss;
    }
    return files;
}

// Errors keep the `transient` flag from _https.getText so fetchPlugin can tell
// a network outage from a release that is really missing an asset.
function _assetError(message, cause) {
    const err = new Error(message);
    err.transient = Boolean(cause && cause.transient === true);
    return err;
}

async function _downloadAssets(id, repo, headers, opts) {
    const baseUrl = `https://github.com/${repo}/releases/latest/download`;
    const manifestUrl = `${baseUrl}/manifest.json`;
    const mainUrl = `${baseUrl}/main.js`;
    const stylesUrl = `${baseUrl}/styles.css`;

    // Required: manifest.json. 404 (or any non-200) → throw.
    let manifestJson;
    try {
        manifestJson = await _https.getText(manifestUrl, headers, opts);
    } catch (e) {
        const m = String(e && e.message || e);
        if (m.includes("404")) {
            throw _assetError(`Failed to fetch ${id}: manifest.json returned 404`, e);
        }
        throw _assetError(`Failed to fetch ${id}: manifest.json ${m}`, e);
    }

    // Required: main.js. 404 (or any non-200) → throw.
    let mainJs;
    try {
        mainJs = await _https.getText(mainUrl, headers, opts);
    } catch (e) {
        const m = String(e && e.message || e);
        if (m.includes("404")) {
            throw _assetError(`Failed to fetch ${id}: main.js returned 404`, e);
        }
        throw _assetError(`Failed to fetch ${id}: main.js ${m}`, e);
    }

    // Optional: styles.css. 404 → tolerate (some plugins ship without styles).
    let stylesCss = null;
    try {
        stylesCss = await _https.getText(stylesUrl, headers, opts);
    } catch (e) {
        const m = String(e && e.message || e);
        if (m.includes("404")) {
            stylesCss = null;
        } else {
            // Non-404 styles.css failure is still a hard fail (mirror manifest/main posture).
            throw _assetError(`Failed to fetch ${id}: styles.css ${m}`, e);
        }
    }
    return stylesCss === null ? { manifestJson, mainJs } : { manifestJson, mainJs, stylesCss };
}

module.exports = { fetchPlugin };
