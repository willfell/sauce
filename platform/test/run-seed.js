// platform/test/run-seed.js — sauce seeder library + CLI verb tests.

const fs = require("fs");
const path = require("path");
const os = require("os");

const helpers = require("../seeder/helpers.js");

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ok ${label}`); pass++; }
    else { console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); fail++; }
}

function withTempVault(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-seed-"));
    try { return fn(dir); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// HEL-1 emitFrontmatter: empty object -> empty string
ok("HEL-1 emitFrontmatter empty",
    helpers.emitFrontmatter({}) === "");

// HEL-2 emitFrontmatter: keys sorted alphabetically
const fm = helpers.emitFrontmatter({ status: "active", date: "2026-04-15", title: "X" });
ok("HEL-2 emitFrontmatter keys sorted",
    /---\ndate: "2026-04-15"\nstatus: active\ntitle: X\n---\n/.test(fm),
    `got: ${JSON.stringify(fm)}`);

// HEL-3 emitFrontmatter: date-shaped value quoted
ok("HEL-3 emitFrontmatter date-shape quoted",
    /date: "2026-04-15"/.test(fm));

// HEL-4 emitFrontmatter: bool-shape quoted
const fm2 = helpers.emitFrontmatter({ flag: "true" });
ok("HEL-4 emitFrontmatter bool-shape quoted",
    /flag: "true"/.test(fm2),
    `got: ${JSON.stringify(fm2)}`);

console.log(`\nrun-seed.js: ${pass} pass · ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
