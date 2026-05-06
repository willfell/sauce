/**
 * platform/bootstrap-lib/community-plugins-index.js
 *
 * Fetches Obsidian's official community-plugins index (a JSON array of
 * { id, name, repo, ... } entries) so the bootstrap orchestrator can map
 * each subscribed plugin id to its GitHub repo.
 *
 * Contract (verbatim):
 *   fetchIndex({ httpsClient }) → Promise<{ [id]: { repo, name } }>
 *     - Single HTTPS GET to INDEX_URL
 *     - Parses JSON array from upstream (each entry has at minimum: id, repo, name)
 *     - Returns id → {repo, name} map
 *     - Caches result in module-level variable for the lifetime of the run
 *     - Throws on network error / parse error / non-200 status
 *
 *   INDEX_URL = upstream raw URL (see below)
 *
 *   Honors process.env.GITHUB_TOKEN if set
 *     (passes Authorization: Bearer <token> header).
 *
 * Notes:
 *   - The harness at platform/test/run-bootstrap.js monkey-patches
 *     `https.get` directly for the duration of each case. We therefore
 *     call `require("https").get(...)` in this module so the mock
 *     intercepts transparently. The optional opts.httpsClient parameter
 *     is preserved for forward compatibility but is not exercised by the
 *     current harness.
 *   - Failure-loud: every error path throws with a helpful message
 *     so bootstrap.js can present it to the user.
 */

const _https = require("./_https.js");

const INDEX_URL = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json";

let _cache = null;

function _clearCache() {
    _cache = null;
}

async function fetchIndex(opts) {
    if (_cache) return _cache;

    const headers = {};
    const token = process.env.GITHUB_TOKEN;
    if (token) {
        headers["Authorization"] = "Bearer " + token;
    }

    let body;
    try {
        body = await _https.getText(INDEX_URL, headers, opts);
    } catch (e) {
        throw new Error(
            `Cannot reach raw.githubusercontent.com to fetch community-plugins index (${INDEX_URL}): ${e.message}`
        );
    }

    let parsed;
    try {
        parsed = JSON.parse(body);
    } catch (e) {
        throw new Error(`Failed to parse community-plugins index from ${INDEX_URL}: ${e.message}`);
    }

    if (!Array.isArray(parsed)) {
        throw new Error(`Failed to parse community-plugins index from ${INDEX_URL}: expected JSON array, got ${typeof parsed}`);
    }

    const map = {};
    for (const entry of parsed) {
        if (!entry || typeof entry !== "object") continue;
        if (typeof entry.id !== "string" || !entry.id) continue;
        map[entry.id] = {
            repo: entry.repo,
            name: entry.name
        };
    }

    _cache = map;
    return _cache;
}

module.exports = { fetchIndex, INDEX_URL, _clearCache };
