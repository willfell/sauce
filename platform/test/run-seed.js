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

const declarative = require("../seeder/declarative.js");
const seeder = require("../seeder/seeder.js");

// LD-1 loadDeclarativeSeed returns null if no seed dir
withTempVault((root) => {
    fs.mkdirSync(path.join(root, "platform", "blueprints", "fake"), { recursive: true });
    const r = declarative.loadDeclarativeSeed(path.join(root, "platform", "blueprints", "fake"));
    ok("LD-1 loadDeclarativeSeed returns null when missing", r === null);
});

// LD-2 loadDeclarativeSeed throws on malformed json
withTempVault((root) => {
    const bp = path.join(root, "platform", "blueprints", "bad");
    fs.mkdirSync(path.join(bp, "seed"), { recursive: true });
    fs.writeFileSync(path.join(bp, "seed", "seed.json"), "not-json");
    let threw = false;
    try { declarative.loadDeclarativeSeed(bp); } catch (e) { threw = /malformed/.test(e.message); }
    ok("LD-2 loadDeclarativeSeed throws on malformed json", threw);
});

// LD-3 loadDeclarativeSeed returns null when kind != declarative
withTempVault((root) => {
    const bp = path.join(root, "platform", "blueprints", "prog");
    fs.mkdirSync(path.join(bp, "seed"), { recursive: true });
    fs.writeFileSync(path.join(bp, "seed", "seed.json"), JSON.stringify({ schema_version: 1, kind: "programmatic" }));
    const r = declarative.loadDeclarativeSeed(bp);
    ok("LD-3 loadDeclarativeSeed null for non-declarative kind", r === null);
});

// LD-4 materializeDeclarative writes the declared notes
withTempVault((root) => {
    const bp = path.join(root, "platform", "blueprints", "ok");
    fs.mkdirSync(path.join(bp, "seed"), { recursive: true });
    fs.mkdirSync(path.join(bp, "templates"), { recursive: true });
    fs.writeFileSync(path.join(bp, "templates", "Body.md"), "Hello {{slug}}");
    fs.writeFileSync(path.join(bp, "seed", "seed.json"), JSON.stringify({
        schema_version: 1, kind: "declarative",
        notes: [{
            path: "spice/ok/{{slug}}/Note.md",
            vars: { slug: "Acme" },
            frontmatter: { type: "ok" },
            body_template: "templates/Body.md"
        }]
    }));
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-seed-vault-"));
    try {
        const parsed = declarative.loadDeclarativeSeed(bp);
        const ctx = { vaultPath: vault, moduleDir: "ok", stockVars: {} };
        const r = declarative.materializeDeclarative(parsed, ctx, bp);
        ok("LD-4a materializeDeclarative created 1", r.created === 1 && r.skipped === 0);
        const out = fs.readFileSync(path.join(vault, "spice/ok/Acme/Note.md"), "utf8");
        ok("LD-4b materializeDeclarative path-substituted", fs.existsSync(path.join(vault, "spice/ok/Acme/Note.md")));
        ok("LD-4c materializeDeclarative body rendered", out.includes("Hello Acme"));
    } finally {
        fs.rmSync(vault, { recursive: true, force: true });
    }
});

// LD-5 listSeedableBlueprints filters to dirs with seed/
withTempVault((root) => {
    fs.mkdirSync(path.join(root, "platform", "blueprints", "with"), { recursive: true });
    fs.mkdirSync(path.join(root, "platform", "blueprints", "with", "seed"));
    fs.mkdirSync(path.join(root, "platform", "blueprints", "without"), { recursive: true });
    const found = seeder.listSeedableBlueprints(root);
    ok("LD-5 listSeedableBlueprints filters", found.length === 1 && found[0] === "with");
});

const programmatic = require("../seeder/programmatic.js");

// PR-1 loadProgrammaticSeed null on missing
withTempVault((root) => {
    fs.mkdirSync(path.join(root, "platform", "blueprints", "fake"), { recursive: true });
    ok("PR-1 loadProgrammaticSeed null missing",
        programmatic.loadProgrammaticSeed(path.join(root, "platform", "blueprints", "fake")) === null);
});

// PR-2 loadProgrammaticSeed throws on missing seed() function
withTempVault((root) => {
    const bp = path.join(root, "platform", "blueprints", "broken");
    fs.mkdirSync(path.join(bp, "seed"), { recursive: true });
    fs.writeFileSync(path.join(bp, "seed", "seed.js"), "module.exports = { schema_version: 1, kind: 'programmatic' };");
    let threw = false;
    try { programmatic.loadProgrammaticSeed(bp); } catch (e) { threw = /seed\(ctx\)/.test(e.message); }
    ok("PR-2 loadProgrammaticSeed throws on missing seed()", threw);
});

// PR-3 materializeProgrammatic invokes seed() and writes notes
withTempVault((root) => {
    const bp = path.join(root, "platform", "blueprints", "ok");
    fs.mkdirSync(path.join(bp, "seed"), { recursive: true });
    fs.writeFileSync(path.join(bp, "seed", "seed.js"), `
module.exports = {
    schema_version: 1, kind: "programmatic",
    seed(ctx) {
        ctx.writeNote({ path: "spice/ok/A.md", frontmatter: {}, body: "X" });
        return { notesCreated: 1 };
    }
};
`);
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-seed-vault-"));
    try {
        const mod = programmatic.loadProgrammaticSeed(bp);
        const baseCtx = { vaultPath: vault, moduleDir: "ok", anchorDate: "2026-05-12", stockVars: {} };
        const r = programmatic.materializeProgrammatic(mod, baseCtx, "ok", bp, false);
        ok("PR-3a materializeProgrammatic created", r.created === 1);
        ok("PR-3b materializeProgrammatic file present", fs.existsSync(path.join(vault, "spice/ok/A.md")));
    } finally {
        fs.rmSync(vault, { recursive: true, force: true });
    }
});

// RNG-1 fixedRng deterministic across calls
const r1 = helpers.fixedRng("daily", "2026-05-12");
const r2 = helpers.fixedRng("daily", "2026-05-12");
const seq1 = [r1(), r1(), r1()];
const seq2 = [r2(), r2(), r2()];
ok("RNG-1 fixedRng deterministic", JSON.stringify(seq1) === JSON.stringify(seq2));

// RNG-2 fixedRng differs across blueprints
const r3 = helpers.fixedRng("project", "2026-05-12");
const seq3 = [r3(), r3(), r3()];
ok("RNG-2 fixedRng varies by blueprint", JSON.stringify(seq1) !== JSON.stringify(seq3));

// RNG-3 fixedRng differs across anchor dates
const r4 = helpers.fixedRng("daily", "2026-05-13");
const seq4 = [r4(), r4(), r4()];
ok("RNG-3 fixedRng varies by anchor", JSON.stringify(seq1) !== JSON.stringify(seq4));

// DT-1 makeDateLike formats YYYY-MM-DD
const dl = programmatic.makeDateLike(new Date("2026-05-12T00:00:00Z"));
ok("DT-1 makeDateLike YYYY-MM-DD", dl.format("YYYY-MM-DD") === "2026-05-12");

// DT-2 makeDateLike formats MM-MMMM
ok("DT-2 makeDateLike MM-MMMM", dl.format("MM-MMMM") === "05-May");

// DT-3 makeDateLike formats nested
ok("DT-3 makeDateLike nested", dl.format("YYYY/MM-MMMM/YYYY-MM-DD") === "2026/05-May/2026-05-12");

const { execFileSync } = require("child_process");

function runCli(args, env = {}) {
    try {
        const out = execFileSync("node", ["platform/cli/sauce-cli.js", ...args], {
            env: Object.assign({}, process.env, env),
            stdio: ["ignore", "pipe", "pipe"],
            encoding: "utf8",
        });
        return { code: 0, stdout: out, stderr: "" };
    } catch (e) {
        return { code: e.status || 1, stdout: (e.stdout && e.stdout.toString()) || "", stderr: (e.stderr && e.stderr.toString()) || "" };
    }
}

// R-1 --reset refused on vault without vault_kind:test
withTempVault((vault) => {
    fs.mkdirSync(path.join(vault, "ranch"), { recursive: true });
    fs.writeFileSync(path.join(vault, "ranch", "platform-config.json"), JSON.stringify({}));
    const r = runCli(["seed", "--vault", vault, "--reset"]);
    ok("R-1 --reset refused on production vault",
        r.code === 2 && /refusing to --reset/.test(r.stderr));
});

// R-2 --reset allowed on vault_kind:test — nukes the project module dir
withTempVault((vault) => {
    fs.mkdirSync(path.join(vault, "ranch"), { recursive: true });
    fs.mkdirSync(path.join(vault, "spice", "projects", "Foo"), { recursive: true });
    fs.writeFileSync(path.join(vault, "spice", "projects", "Foo", "Project.md"), "x");
    fs.writeFileSync(path.join(vault, "ranch", "platform-config.json"), JSON.stringify({ vault_kind: "test" }));
    const r = runCli(["seed", "--vault", vault, "--reset", "--blueprint", "project", "--dry-run"]);
    ok("R-2a --reset on test vault removed dir", !fs.existsSync(path.join(vault, "spice", "projects")));
    ok("R-2b --reset succeeded (exit 0)", r.code === 0);
});

// R-3 --reset only nukes specified blueprints
withTempVault((vault) => {
    fs.mkdirSync(path.join(vault, "ranch"), { recursive: true });
    fs.mkdirSync(path.join(vault, "spice", "projects"), { recursive: true });
    fs.mkdirSync(path.join(vault, "spice", "daily"), { recursive: true });
    fs.writeFileSync(path.join(vault, "spice", "projects", "X.md"), "x");
    fs.writeFileSync(path.join(vault, "spice", "daily", "Y.md"), "y");
    fs.writeFileSync(path.join(vault, "ranch", "platform-config.json"), JSON.stringify({ vault_kind: "test" }));
    runCli(["seed", "--vault", vault, "--reset", "--blueprint", "project", "--dry-run"]);
    ok("R-3a --reset nuked project", !fs.existsSync(path.join(vault, "spice", "projects")));
    ok("R-3b --reset spared daily", fs.existsSync(path.join(vault, "spice", "daily", "Y.md")));
});

console.log(`\nrun-seed.js: ${pass} pass · ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
