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
 */

const MAX_REDIRECTS = 5;

function getText(url, headers, opts, _depth) {
    const depth = _depth || 0;
    const httpsClient = (opts && opts.httpsClient) || require("https");
    return new Promise((resolve, reject) => {
        const req = httpsClient.get(url, { headers: headers || {} }, (res) => {
            const status = res.statusCode;

            // Follow redirects (CF-1, surfaced at first real GitHub fetch in
            // Phase A — release-asset URLs respond 302 to the actual content
            // URL on a CDN, never 200 directly).
            if (status >= 300 && status < 400 && res.headers && res.headers.location) {
                if (typeof res.resume === "function") res.resume();
                if (depth >= MAX_REDIRECTS) {
                    return reject(new Error(`HTTPS ${url} exceeded ${MAX_REDIRECTS} redirects`));
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
                return getText(nextUrl, headers, opts, depth + 1).then(resolve, reject);
            }

            if (status !== 200) {
                // Drain the response so the socket is freed. Resume is preferred
                // over destroy because some mocks don't implement destroy().
                if (typeof res.resume === "function") res.resume();
                return reject(new Error(`HTTPS ${url} returned ${status}`));
            }
            const chunks = [];
            res.on("data", c => chunks.push(c));
            res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
            res.on("error", reject);
        });
        req.on("error", (e) => reject(new Error(`Cannot reach ${url}: ${e.message}`)));
    });
}

module.exports = { getText };
