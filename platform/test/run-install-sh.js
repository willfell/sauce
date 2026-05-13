#!/usr/bin/env node
// run-install-sh.js — verify install.sh emits the brew deprecation redirect.
//
// install.sh stopped being the install entry point in v0.36.0. The script
// now exits 2 with a message pointing at `brew install willfell/sauce/sauce`.
// This harness pins that behavior so the redirect doesn't silently disappear.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

let pass = 0, fail = 0;

function assertTrue(cond, label) {
    if (cond) { pass++; console.log("  PASS: " + label); }
    else { fail++; console.log("  FAIL: " + label); }
}

const repoRoot = path.resolve(__dirname, "..", "..");
const installSh = path.join(repoRoot, "install.sh");

(async () => {
    // I1: install.sh exists and is executable
    const stat = fs.statSync(installSh);
    assertTrue((stat.mode & 0o111) !== 0, "I1 install.sh is executable");

    // I2: exits 2
    const r = spawnSync("bash", [installSh], { encoding: "utf8" });
    assertTrue(r.status === 2, "I2 install.sh exits 2");

    // I3: message mentions brew install command
    const all = (r.stdout || "") + (r.stderr || "");
    assertTrue(all.includes("brew install willfell/sauce/sauce"), "I3 message names the brew install command");

    // I4: message mentions v0.36
    assertTrue(/v0\.36/.test(all), "I4 message mentions v0.36 deprecation");

    // I5: message mentions migrate-layout for legacy users
    assertTrue(all.includes("sauce migrate-layout"), "I5 message points legacy users at migrate-layout");

    console.log(`\n  ${pass} pass · ${fail} fail`);
    process.exit(fail > 0 ? 1 : 0);
})();
