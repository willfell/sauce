#!/usr/bin/env node
// run-install-sh.js — drives platform/../install.sh against a temp dir
// with mocked git + npm via PATH-prefixed shim scripts.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

let pass = 0, fail = 0;
const REPO_ROOT = path.resolve(__dirname, "../..");
const INSTALL_SH = path.join(REPO_ROOT, "install.sh");

function assertTrue(c, l) { if (c) { pass++; console.log("  PASS  " + l); } else { fail++; console.log("  FAIL  " + l); } }
function assertEqual(a, e, l) { if (a === e) { pass++; console.log("  PASS  " + l); } else { fail++; console.log("  FAIL  " + l + " — expected " + JSON.stringify(e) + " got " + JSON.stringify(a)); } }

function withShimEnv(setup, fn) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "beacon-installsh-"));
    const shimDir = path.join(tmp, "shim");
    fs.mkdirSync(shimDir, { recursive: true });
    try {
        if (typeof setup === "function") setup(tmp, shimDir);
        const env = Object.assign({}, process.env, { PATH: shimDir + ":" + process.env.PATH });
        return fn(tmp, shimDir, env);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function writeShim(shimDir, name, body) {
    const p = path.join(shimDir, name);
    fs.writeFileSync(p, "#!/usr/bin/env bash\n" + body, { mode: 0o755 });
}

function runInstallSh(env, vaultPath, extraStdin) {
    return spawnSync("bash", [INSTALL_SH, "--vault", vaultPath, "--non-interactive"],
        { env, input: extraStdin || "", encoding: "utf8" });
}

// I1: missing node detected
function caseI1MissingNode() {
    const label = "I1 install.sh fails loud when node missing";
    withShimEnv((tmp, shimDir) => {
        // Shim: which-style probe — write `node` shim that exits non-zero
        // OR provide a `command` shim — simplest is to have install.sh use
        // `command -v node` and our PATH-only shim provides nothing for node.
        // We do NOT write a node shim; rely on install.sh's preflight.
        writeShim(shimDir, "git", "exit 0");
        writeShim(shimDir, "npm", "exit 0");
    }, (tmp, shimDir, env) => {
        // Override env.PATH to ONLY shimDir + /usr/bin (which lacks node in this test)
        env.PATH = shimDir + ":/usr/bin";
        const r = runInstallSh(env, tmp);
        assertTrue(r.status !== 0, label + ": exit non-zero");
        assertTrue(/node/i.test(r.stderr || r.stdout), label + ": message mentions node");
    });
}

// I2: missing git detected (similar to I1)
function caseI2MissingGit() {
    const label = "I2 install.sh fails loud when git missing";
    withShimEnv((tmp, shimDir) => {
        // Shim: provide a node fake; do NOT provide git
        writeShim(shimDir, "node", "exit 0");
        writeShim(shimDir, "npm", "exit 0");
    }, (tmp, shimDir, env) => {
        env.PATH = shimDir + ":/usr/bin";
        const r = runInstallSh(env, tmp);
        assertTrue(r.status !== 0, label + ": exit non-zero");
        assertTrue(/git/i.test(r.stderr || r.stdout), label + ": message mentions git");
    });
}

// I3: clones into vault correctly (with full mock-git)
function caseI3ClonesIntoVault() {
    const label = "I3 install.sh clones beacon into <vault>/Beacon/";
    withShimEnv((tmp, shimDir) => {
        const vaultPath = path.join(tmp, "vault");
        fs.mkdirSync(vaultPath, { recursive: true });
        // git shim: when invoked as `git clone <url> <dest>`, mkdir dest/platform/cli + write a stub manifest + node entry
        writeShim(shimDir, "git", `
case "$1" in
  clone)
    DEST="$3"
    mkdir -p "$DEST/platform/cli"
    echo '{ "workshop_version": "0.22.0", "mechanisms": [], "blueprints": [], "foundational_plugins": [] }' > "$DEST/platform/manifest.json"
    cat > "$DEST/platform/cli/beacon-cli.js" <<'JS'
#!/usr/bin/env node
// stub: success path — write a marker so the test can assert the hand-off happened.
require("fs").writeFileSync(require("path").join(process.argv[3] || ".", ".beacon-cli-ran"), "ok");
JS
    chmod +x "$DEST/platform/cli/beacon-cli.js"
    exit 0
    ;;
  *) exit 0 ;;
esac
        `);
        writeShim(shimDir, "npm", "exit 0");
        writeShim(shimDir, "node", "/usr/bin/env node \"$@\"");  // pass through to real node
    }, (tmp, shimDir, env) => {
        env.PATH = shimDir + ":" + process.env.PATH;
        const vaultPath = path.join(tmp, "vault");
        const r = runInstallSh(env, vaultPath);
        const beaconCli = path.join(vaultPath, "Beacon/platform/cli/beacon-cli.js");
        assertTrue(fs.existsSync(beaconCli), label + ": Beacon/platform/cli/beacon-cli.js exists post-clone");
    });
}

// I4: refuses to overwrite existing Beacon/ without confirm
function caseI4RefusesOverwrite() {
    const label = "I4 install.sh refuses overwrite without confirm";
    withShimEnv((tmp, shimDir) => {
        const vaultPath = path.join(tmp, "vault");
        fs.mkdirSync(path.join(vaultPath, "Beacon"), { recursive: true });
        fs.writeFileSync(path.join(vaultPath, "Beacon/SENTINEL"), "preexisting\n");
        writeShim(shimDir, "git", "exit 0");
        writeShim(shimDir, "npm", "exit 0");
        writeShim(shimDir, "node", "exit 0");
    }, (tmp, shimDir, env) => {
        env.PATH = shimDir + ":" + process.env.PATH;
        const vaultPath = path.join(tmp, "vault");
        const r = runInstallSh(env, vaultPath);
        assertTrue(r.status !== 0, label + ": exit non-zero");
        assertTrue(fs.existsSync(path.join(vaultPath, "Beacon/SENTINEL")), label + ": existing Beacon/ untouched");
    });
}

// I5: --overwrite flag → backup + replace (Beacon → Beacon.bak)
function caseI5OverwriteBackup() {
    const label = "I5 install.sh --overwrite backs up Beacon to Beacon.bak";
    withShimEnv((tmp, shimDir) => {
        const vaultPath = path.join(tmp, "vault");
        fs.mkdirSync(path.join(vaultPath, "Beacon"), { recursive: true });
        fs.writeFileSync(path.join(vaultPath, "Beacon/SENTINEL"), "preexisting\n");
        writeShim(shimDir, "git", "exit 0");
        writeShim(shimDir, "npm", "exit 0");
        writeShim(shimDir, "node", "exit 0");
    }, (tmp, shimDir, env) => {
        env.PATH = shimDir + ":" + process.env.PATH;
        const vaultPath = path.join(tmp, "vault");
        const r = spawnSync("bash", [INSTALL_SH, "--vault", vaultPath, "--non-interactive", "--overwrite"],
            { env, encoding: "utf8" });
        const sentinelInBak = path.join(vaultPath, "Beacon.bak/SENTINEL");
        assertTrue(fs.existsSync(sentinelInBak), label + ": prior contents moved to Beacon.bak");
    });
}

// I6: exec hand-off to node CLI succeeds
function caseI6ExecHandoff() {
    const label = "I6 install.sh execs node CLI after clone + npm install";
    withShimEnv((tmp, shimDir) => {
        const vaultPath = path.join(tmp, "vault");
        fs.mkdirSync(vaultPath, { recursive: true });
        // Same git shim as I3; node passthrough
        writeShim(shimDir, "git", `
case "$1" in
  clone)
    DEST="$3"
    mkdir -p "$DEST/platform/cli"
    echo '{ "workshop_version": "0.22.0", "mechanisms": [], "blueprints": [], "foundational_plugins": [] }' > "$DEST/platform/manifest.json"
    cat > "$DEST/platform/cli/beacon-cli.js" <<'JS'
require("fs").writeFileSync(require("path").join(process.env.HANDOFF_MARKER || ".", ".handoff"), "ok");
JS
    exit 0 ;;
  *) exit 0 ;;
esac
        `);
        writeShim(shimDir, "npm", "exit 0");
        writeShim(shimDir, "node", "/usr/bin/env node \"$@\"");
    }, (tmp, shimDir, env) => {
        env.PATH = shimDir + ":" + process.env.PATH;
        env.HANDOFF_MARKER = tmp;
        const vaultPath = path.join(tmp, "vault");
        runInstallSh(env, vaultPath);
        assertTrue(fs.existsSync(path.join(tmp, ".handoff")), label + ": handoff marker written");
    });
}

(async function main() {
    caseI1MissingNode();
    caseI2MissingGit();
    caseI3ClonesIntoVault();
    caseI4RefusesOverwrite();
    caseI5OverwriteBackup();
    caseI6ExecHandoff();
    console.log("\n========\nResult: " + pass + " passed, " + fail + " failed.");
    process.exitCode = fail > 0 ? 1 : 0;
})();
