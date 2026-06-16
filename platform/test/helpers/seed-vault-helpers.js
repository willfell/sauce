// platform/test/helpers/seed-vault-helpers.js — assertion helpers for
// run-seed-migrations.js. Zero-dep. Node built-ins only.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

// ----- filesystem helpers ----------------------------------------------------

function copyDir(src, dst) {
    fs.cpSync(src, dst, { recursive: true, force: true });
}

function fileExists(vaultPath, relPath) {
    return fs.existsSync(path.join(vaultPath, relPath));
}

function dirExists(vaultPath, relPath) {
    const p = path.join(vaultPath, relPath);
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
}

function readNote(vaultPath, relPath) {
    return fs.readFileSync(path.join(vaultPath, relPath), "utf8");
}

function readJson(vaultPath, relPath) {
    return JSON.parse(fs.readFileSync(path.join(vaultPath, relPath), "utf8"));
}

// ----- frontmatter -----------------------------------------------------------

// Minimal YAML frontmatter parser for sauce note frontmatter. Supports:
//   - scalar key: value (string, optionally quoted)
//   - inline list: key: [a, b, c]
//   - block list (key:\n  - foo\n  - bar)
// Does NOT support nested objects (none in scope for the seed asserts).
function parseFrontmatter(content) {
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) return { frontmatter: {}, body: content };
    const [, fmText, body] = m;
    const fm = {};
    const lines = fmText.split(/\r?\n/);
    let currentKey = null;
    for (const raw of lines) {
        if (!raw.trim()) { currentKey = null; continue; }
        const blockListMatch = raw.match(/^\s+-\s+(.*)$/);
        if (blockListMatch && currentKey) {
            const val = blockListMatch[1].trim().replace(/^"(.*)"$/, "$1");
            if (!Array.isArray(fm[currentKey])) fm[currentKey] = [];
            fm[currentKey].push(val);
            continue;
        }
        const kv = raw.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
        if (!kv) { currentKey = null; continue; }
        const [, key, rest] = kv;
        const trimmed = rest.trim();
        if (trimmed === "") {
            currentKey = key;
            fm[key] = [];
            continue;
        }
        currentKey = null;
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
            // inline list
            const inner = trimmed.slice(1, -1);
            fm[key] = inner.split(",").map(s => s.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean);
        } else if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
            fm[key] = trimmed.slice(1, -1);
        } else {
            fm[key] = trimmed;
        }
    }
    return { frontmatter: fm, body };
}

// ----- installer subprocess --------------------------------------------------

function runInstall(vaultPath, repoRoot) {
    try {
        const stdout = execFileSync(
            "node",
            [path.join(repoRoot, "platform/install.js"), "--vault", vaultPath, "--auto-approve"],
            { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
        );
        return { code: 0, stdout, stderr: "" };
    } catch (e) {
        return {
            code: e.status || 1,
            stdout: (e.stdout && e.stdout.toString()) || "",
            stderr: (e.stderr && e.stderr.toString()) || "",
            signal: e.signal,
            err: e.message || String(e),
        };
    }
}

// ----- tree snapshots --------------------------------------------------------

function snapshotTree(root) {
    const out = {};
    function walk(dir, rel) {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const abs = path.join(dir, ent.name);
            const rl = rel ? path.posix.join(rel, ent.name) : ent.name;
            if (ent.isDirectory()) walk(abs, rl);
            else if (ent.isFile()) {
                const buf = fs.readFileSync(abs);
                out[rl] = crypto.createHash("sha256").update(buf).digest("hex");
            }
        }
    }
    walk(root, "");
    return out;
}

function diffSnapshots(a, b) {
    const added = [];
    const removed = [];
    const changed = [];
    for (const [f, h] of Object.entries(b)) {
        if (!(f in a)) added.push(f);
        else if (a[f] !== h) changed.push(f);
    }
    for (const f of Object.keys(a)) if (!(f in b)) removed.push(f);
    return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}

module.exports = {
    copyDir,
    fileExists,
    dirExists,
    readNote,
    readJson,
    parseFrontmatter,
    runInstall,
    snapshotTree,
    diffSnapshots,
};
