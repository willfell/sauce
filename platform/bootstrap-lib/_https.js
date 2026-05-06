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

function getText(url, headers, opts) {
    const httpsClient = (opts && opts.httpsClient) || require("https");
    return new Promise((resolve, reject) => {
        const req = httpsClient.get(url, { headers: headers || {} }, (res) => {
            const status = res.statusCode;
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
