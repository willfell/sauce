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

// MD-1 writeNote rejects path outside module_directory
withTempVault((vault) => {
    const ctx = { vaultPath: vault, moduleDir: "projects" };
    let threw = false;
    try {
        helpers.writeNote(ctx, { path: "spice/daily/2026-05-12.md", frontmatter: {}, body: "x" });
    } catch (e) {
        threw = e instanceof helpers.ModuleDirectoryEscapeError;
    }
    ok("MD-1 writeNote rejects cross-module path", threw);
});

// MD-2 writeNote allows path inside module_directory
withTempVault((vault) => {
    const ctx = { vaultPath: vault, moduleDir: "projects" };
    const r = helpers.writeNote(ctx, { path: "spice/projects/Foo/Project.md", frontmatter: { type: "project" }, body: "body" });
    ok("MD-2 writeNote inside module ok", !r.skipped);
    const written = fs.readFileSync(path.join(vault, "spice/projects/Foo/Project.md"), "utf8");
    ok("MD-3 writeNote produced file with frontmatter",
        written.startsWith("---\n") && written.includes("type: project"));
});

// MD-4 writeNote skips if file exists (additive default)
withTempVault((vault) => {
    const ctx = { vaultPath: vault, moduleDir: "projects" };
    helpers.writeNote(ctx, { path: "spice/projects/A/Project.md", frontmatter: { type: "project" }, body: "v1" });
    const r = helpers.writeNote(ctx, { path: "spice/projects/A/Project.md", frontmatter: { type: "project" }, body: "v2" });
    ok("MD-4 writeNote additive skip", r.skipped === true);
    const stillV1 = fs.readFileSync(path.join(vault, "spice/projects/A/Project.md"), "utf8").includes("v1");
    ok("MD-5 additive skip preserved original body", stillV1);
});

console.log(`\nrun-seed.js: ${pass} pass · ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
