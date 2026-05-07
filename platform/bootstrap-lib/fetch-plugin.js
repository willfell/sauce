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
            throw new Error(`Failed to fetch ${id}: manifest.json returned 404`);
        }
        throw new Error(`Failed to fetch ${id}: manifest.json ${m}`);
    }

    // Required: main.js. 404 (or any non-200) → throw.
    let mainJs;
    try {
        mainJs = await _https.getText(mainUrl, headers, opts);
    } catch (e) {
        const m = String(e && e.message || e);
        if (m.includes("404")) {
            throw new Error(`Failed to fetch ${id}: main.js returned 404`);
        }
        throw new Error(`Failed to fetch ${id}: main.js ${m}`);
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
            throw new Error(`Failed to fetch ${id}: styles.css ${m}`);
        }
    }

    fs.mkdirSync(pluginDir, { recursive: true });

    _writeWithBackup(manifestTarget, manifestJson);
    _writeWithBackup(mainTarget, mainJs);

    const files = { manifestJson, mainJs };
    if (stylesCss !== null) {
        _writeWithBackup(stylesTarget, stylesCss);
        files.stylesCss = stylesCss;
    }

    return { status: "fetched", files };
}

module.exports = { fetchPlugin };
