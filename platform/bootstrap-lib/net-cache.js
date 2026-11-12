/**
 * platform/bootstrap-lib/net-cache.js
 *
 * Last-known-good copies of what bootstrap-lib downloads, kept on this machine
 * so that a network outage does not turn into a failed install when the same
 * content was fetched successfully before.
 *
 * Location: $SAUCE_NET_CACHE_DIR if set, else <os.tmpdir()>/sauce-net-cache.
 * Never inside a vault. os.tmpdir() rather than a HOME-relative cache directory
 * because harnesses and the coordinator's isolated self-install point HOME at a
 * fresh temp directory, which would give every run an empty cache.
 *
 * Writes are atomic (unique temp file + rename), so concurrent installs never
 * see a partial entry. Both reads and writes are best-effort: a missing,
 * unreadable or malformed entry reads as null and a failed write returns
 * false. The cache can only ever help; it never makes an install fail.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const CACHE_DIR_ENV = "SAUCE_NET_CACHE_DIR";

function cacheDir() {
    return process.env[CACHE_DIR_ENV] || path.join(os.tmpdir(), "sauce-net-cache");
}

function entryPath(name) {
    return path.join(cacheDir(), name);
}

function writeEntry(name, value) {
    const target = entryPath(name);
    const tmp = `${target}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify(value));
        fs.renameSync(tmp, target);
        return true;
    } catch (_e) {
        try { fs.rmSync(tmp, { force: true }); } catch (_e2) { /* best-effort */ }
        return false;
    }
}

function readEntry(name) {
    try {
        return JSON.parse(fs.readFileSync(entryPath(name), "utf8"));
    } catch (_e) {
        return null;
    }
}

module.exports = { cacheDir, writeEntry, readEntry, CACHE_DIR_ENV };
