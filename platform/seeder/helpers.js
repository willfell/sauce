// platform/seeder/helpers.js — pure-Node helpers, no deps.
// Workshop-only; never installed into consumer vaults.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const NEEDS_QUOTE = /^(\d{4}-\d{2}(-\d{2})?|true|false|yes|no|null)$/i;

function emitFrontmatter(fm) {
    if (!fm || typeof fm !== "object") return "";
    const keys = Object.keys(fm).sort();
    if (keys.length === 0) return "";
    const lines = ["---"];
    for (const k of keys) {
        const raw = fm[k];
        let v;
        if (raw == null) v = "null";
        else if (typeof raw === "number" || typeof raw === "boolean") v = String(raw);
        else if (Array.isArray(raw)) v = `[${raw.map(item => quoteIfNeeded(String(item))).join(", ")}]`;
        else v = quoteIfNeeded(String(raw));
        lines.push(`${k}: ${v}`);
    }
    lines.push("---");
    return lines.join("\n") + "\n";
}

function quoteIfNeeded(s) {
    if (NEEDS_QUOTE.test(s)) return `"${s}"`;
    if (s.includes(":") || s.includes("#") || s.startsWith(" ") || s.endsWith(" ")) return `"${s.replace(/"/g, '\\"')}"`;
    return s;
}

function ensureDir(absDir) {
    fs.mkdirSync(absDir, { recursive: true });
}

class ModuleDirectoryEscapeError extends Error {}

function writeNote(ctx, opts) {
    // ctx must carry { vaultPath, moduleDir }; opts: { path, frontmatter, body }
    if (!opts || !opts.path) throw new Error("writeNote: opts.path is required");
    const moduleDir = ctx.moduleDir;
    if (!moduleDir) throw new Error("writeNote: ctx.moduleDir is required");
    // path may be relative — interpret as relative to vaultPath. Then enforce moduleDir prefix.
    const rel = opts.path.replace(/^\/+/, "");
    const expectedPrefix = path.posix.join("spice", moduleDir);
    if (!rel.startsWith(expectedPrefix + "/") && rel !== `${expectedPrefix}.md`) {
        throw new ModuleDirectoryEscapeError(
            `seed write '${rel}' escapes blueprint module_directory '${expectedPrefix}'`
        );
    }
    const abs = path.join(ctx.vaultPath, rel);
    ensureDir(path.dirname(abs));
    if (!opts.overwrite && fs.existsSync(abs)) {
        return { skipped: true, path: rel };
    }
    const fm = emitFrontmatter(opts.frontmatter);
    const body = (opts.body || "").replace(/\r\n/g, "\n");
    fs.writeFileSync(abs, fm + body, { encoding: "utf8" });
    return { skipped: false, path: rel };
}

function fixedRng(blueprint, anchorDate) {
    // SHA256(blueprint + anchorDate) → uint32 seed → Mulberry32
    const h = crypto.createHash("sha256");
    h.update(`sauce-test-vault-v1:${blueprint}:${anchorDate}`);
    const digest = h.digest();
    let seed = digest.readUInt32BE(0);
    return function rng() {
        seed = (seed + 0x6D2B79F5) | 0;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function substituteLenient(template, vars) {
    if (!template) return template;
    return template.replace(/\{\{(\w+)\}\}/g, (m, key) => {
        return vars && Object.prototype.hasOwnProperty.call(vars, key)
            ? String(vars[key])
            : m; // leave unresolved {{x}} literal — same as install.js policy
    });
}

module.exports = {
    emitFrontmatter,
    quoteIfNeeded,
    ensureDir,
    writeNote,
    fixedRng,
    substituteLenient,
    ModuleDirectoryEscapeError,
};
