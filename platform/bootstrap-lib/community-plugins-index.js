/**
 * platform/bootstrap-lib/community-plugins-index.js
 *
 * Fetches Obsidian's official community-plugins index (a JSON array of
 * { id, name, repo, ... } entries) so the bootstrap orchestrator can map
 * each subscribed plugin id to its GitHub repo.
 *
 * Contract (verbatim):
 *   loadIndex({ httpsClient, retryDelaysMs }) →
 *       Promise<{ index: { [id]: { repo, name } }, source, cachedAt?, networkError? }>
 *     - HTTPS GET to INDEX_URL through _https.getText, which retries
 *       transient failures (DNS, connection, timeout, 5xx, 429)
 *     - Parses JSON array from upstream (each entry has at minimum: id, repo, name)
 *     - On success: source "network"; the map is also written to the
 *       on-disk last-known-good cache (net-cache.js)
 *     - On a TRANSIENT failure with a valid cached copy: source "cache",
 *       cachedAt = when that copy was fetched, networkError = the failure
 *     - Throws on a transient failure with no cached copy, and on every
 *       non-transient failure (404, other 4xx, unparseable body), cache or not:
 *       a server that answers wrongly is a real problem a stale copy would hide
 *     - Result (including its source) cached in module-level variable for
 *       the lifetime of the run; a transient failure with nothing cached is
 *       rethrown without a request for FAILURE_MEMO_MS
 *
 *   fetchIndex(opts) → Promise<{ [id]: { repo, name } }>
 *     loadIndex(opts).index, for callers that do not care where it came from.
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
 *     is preserved for forward compatibility.
 *   - Failure-loud: every error path throws with a helpful message
 *     so bootstrap.js can present it to the user.
 */

const _https = require("./_https.js");
const netCache = require("./net-cache.js");

const INDEX_URL = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json";
const CACHE_ENTRY = "community-plugins-index.json";

// How long a transient failure with nothing cached is remembered. The
// installer asks once per manifest; without this, an outage costs every
// manifest the full retry schedule instead of the first one only. Short, so a
// long-lived Obsidian process tries the network again soon after it returns.
const FAILURE_MEMO_MS = 60000;

let _cache = null;
let _failure = null;

function _clearCache() {
    _cache = null;
    _failure = null;
}

function readCachedIndex() {
    const entry = netCache.readEntry(CACHE_ENTRY);
    if (!entry || entry.url !== INDEX_URL || !entry.index || typeof entry.index !== "object") return null;
    const ids = Object.keys(entry.index);
    if (!ids.some((id) => entry.index[id] && typeof entry.index[id].repo === "string")) return null;
    return entry;
}

async function loadIndex(opts) {
    if (_cache) return { ..._cache };
    if (_failure && Date.now() - _failure.at < FAILURE_MEMO_MS) throw new Error(_failure.message);

    const headers = {};
    const token = process.env.GITHUB_TOKEN;
    if (token) {
        headers["Authorization"] = "Bearer " + token;
    }

    let body;
    try {
        body = await _https.getText(INDEX_URL, headers, opts);
    } catch (e) {
        const reason = `Cannot reach raw.githubusercontent.com to fetch community-plugins index (${INDEX_URL}): ${e.message}`;
        const transient = Boolean(e && e.transient === true);
        const cached = transient ? readCachedIndex() : null;
        if (!cached) {
            if (transient) _failure = { message: reason, at: Date.now() };
            throw new Error(reason);
        }
        _cache = { index: cached.index, source: "cache", cachedAt: cached.fetched_at, networkError: reason };
        return { ..._cache };
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

    if (Object.keys(map).length > 0) {
        netCache.writeEntry(CACHE_ENTRY, { url: INDEX_URL, fetched_at: new Date().toISOString(), index: map });
    }
    _cache = { index: map, source: "network" };
    return { ..._cache };
}

async function fetchIndex(opts) {
    return (await loadIndex(opts)).index;
}

module.exports = { fetchIndex, loadIndex, INDEX_URL, CACHE_ENTRY, _clearCache };
