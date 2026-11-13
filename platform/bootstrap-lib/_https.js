/**
 * Shared HTTPS helper for bootstrap-lib.
 *
 * One promise-wrapped GET. Drains the response on the rejection path so the
 * underlying socket is freed (otherwise Node holds the keepalive socket open
 * until the response stream is consumed or destroyed — a real leak under
 * partial-failure conditions like 404 styles.css through a redirect chain).
 *
 * Both `community-plugins-index.js` and `fetch-plugin.js` use this. Single
 * source of truth means a future tweak to header / redirect / auth handling
 * lands in one place and can't drift between the two callers.
 *
 * Transient failures are retried. A request that never reached a response
 * (DNS failure, refused or reset connection, timeout) or that got a 5xx / 429
 * is attempted RETRY_DELAYS_MS.length + 1 times in all, waiting each listed
 * delay in between. Anything else (404, other 4xx) is final on the first
 * attempt. Every rejection carries `transient: true|false` and, when a
 * response arrived, `status`, so callers can tell "the network is down" from
 * "the server said no" without parsing messages.
 */

const MAX_REDIRECTS = 5;
const RETRY_DELAYS_MS = [500, 2000];
const REQUEST_TIMEOUT_MS = 30000;

function isTransientStatus(status) {
    return status === 429 || (status >= 500 && status < 600);
}

function statusError(url, status) {
    const err = new Error(`HTTPS ${url} returned ${status}`);
    err.status = status;
    err.transient = isTransientStatus(status);
    return err;
}

function networkError(url, cause) {
    const err = new Error(`Cannot reach ${url}: ${cause && cause.message}`);
    err.code = cause && cause.code;
    err.transient = true;
    return err;
}

function getOnce(url, headers, opts, _depth) {
    const depth = _depth || 0;
    const httpsClient = (opts && opts.httpsClient) || require("https");
    const timeoutMs = (opts && opts.timeoutMs) || REQUEST_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
        const req = httpsClient.get(url, { headers: headers || {} }, (res) => {
            const status = res.statusCode;

            // Follow redirects (CF-1, surfaced at first real GitHub fetch in
            // Phase A — release-asset URLs respond 302 to the actual content
            // URL on a CDN, never 200 directly).
            if (status >= 300 && status < 400 && res.headers && res.headers.location) {
                if (typeof res.resume === "function") res.resume();
                if (depth >= MAX_REDIRECTS) {
                    const err = new Error(`HTTPS ${url} exceeded ${MAX_REDIRECTS} redirects`);
                    err.transient = false;
                    return reject(err);
                }
                const next = res.headers.location;
                // Resolve relative redirects against the original URL.
                let nextUrl = next;
                if (next.startsWith("/")) {
                    const u = new URL(url);
                    nextUrl = u.origin + next;
                } else if (!/^https?:\/\//i.test(next)) {
                    nextUrl = new URL(next, url).toString();
                }
                return getOnce(nextUrl, headers, opts, depth + 1).then(resolve, reject);
            }

            if (status !== 200) {
                // Drain the response so the socket is freed. Resume is preferred
                // over destroy because some mocks don't implement destroy().
                if (typeof res.resume === "function") res.resume();
                return reject(statusError(url, status));
            }
            const chunks = [];
            res.on("data", c => chunks.push(c));
            res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
            res.on("error", (e) => reject(networkError(url, e)));
        });
        req.on("error", (e) => reject(networkError(url, e)));
        // A request with no deadline waits forever on a stalled connection, so
        // a dead network would hang the install instead of failing it.
        if (typeof req.setTimeout === "function") {
            req.setTimeout(timeoutMs, () => {
                const e = new Error(`no response within ${timeoutMs}ms`);
                e.code = "ETIMEDOUT";
                if (typeof req.destroy === "function") req.destroy(e);
                reject(networkError(url, e));
            });
        }
    });
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getText(url, headers, opts) {
    const delays = (opts && Array.isArray(opts.retryDelaysMs)) ? opts.retryDelaysMs : RETRY_DELAYS_MS;
    for (let attempt = 0; ; attempt++) {
        try {
            return await getOnce(url, headers, opts);
        } catch (err) {
            if (!err || err.transient !== true || attempt >= delays.length) throw err;
            await wait(delays[attempt]);
        }
    }
}

module.exports = { getText, RETRY_DELAYS_MS, REQUEST_TIMEOUT_MS };
