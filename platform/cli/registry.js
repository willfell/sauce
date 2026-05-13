// platform/cli/registry.js — per-machine vault registry at ~/.sauce/vaults.json.
// Atomic writes (temp + rename). Read-tolerant of missing file.

const fs = require("fs");
const path = require("path");
const os = require("os");

function registryDir() { return path.join(os.homedir(), ".sauce"); }
function registryPath() { return path.join(registryDir(), "vaults.json"); }

function read() {
    const p = registryPath();
    if (!fs.existsSync(p)) return { version: 1, vaults: [] };
    try { return JSON.parse(fs.readFileSync(p, "utf8")); }
    catch (_e) {
        // Salvage-copy aside before any subsequent write() overwrites the corrupt file.
        try {
            const bak = p + ".corrupt-" + new Date().toISOString().replace(/[:.]/g, "-");
            fs.copyFileSync(p, bak);
            console.warn("  WARN: " + p + " was unparseable; salvaged to " + bak);
        } catch (_e2) { /* best-effort; don't block read() */ }
        return { version: 1, vaults: [] };
    }
}

function write(reg) {
    const dir = registryDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const final = registryPath();
    const tmp = final + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(reg, null, 2) + "\n");
    fs.renameSync(tmp, final);
}

function add(vaultPath) {
    const abs = path.resolve(vaultPath);
    const reg = read();
    if (reg.vaults.some(v => v.path === abs)) return reg; // dedupe
    reg.vaults.push({ path: abs, registered_at: new Date().toISOString() });
    write(reg);
    return reg;
}

function remove(vaultPath) {
    const abs = path.resolve(vaultPath);
    const reg = read();
    reg.vaults = reg.vaults.filter(v => v.path !== abs);
    write(reg);
    return reg;
}

function list() { return read().vaults; }

function pruneMissing() {
    const reg = read();
    const kept = [], removed = [];
    for (const v of reg.vaults) {
        if (fs.existsSync(v.path)) kept.push(v); else removed.push(v.path);
    }
    reg.vaults = kept;
    write(reg);
    return removed;
}

module.exports = { read, write, add, remove, list, pruneMissing, registryPath };
