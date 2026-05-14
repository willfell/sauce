// platform/test/run-integration-smoke.js — bar-ii deploy-confidence smoke.
// Bootstraps a fresh tmp vault, seeds it, audits it. Asserts post-conditions.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ok ${label}`); pass++; }
    else { console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); fail++; }
}

const KEEP = process.env.KEEP_SMOKE_VAULT === "1";
const ANCHOR = "2026-05-12";

function withTempHomeAndVault(fn) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-smoke-home-"));
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-smoke-vault-"));
    const origHome = process.env.HOME;
    process.env.HOME = home;
    try { return fn({ home, vault }); }
    finally {
        process.env.HOME = origHome;
        if (!KEEP) {
            try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
            try { fs.rmSync(vault, { recursive: true, force: true }); } catch {}
        } else {
            console.log(`  KEEP_SMOKE_VAULT=1: home=${home} vault=${vault}`);
        }
    }
}

function runCli(args, opts = {}) {
    try {
        const out = execFileSync("node", ["platform/cli/sauce-cli.js", ...args], {
            stdio: ["ignore", "pipe", "pipe"],
            encoding: "utf8",
            env: process.env,
        });
        return { code: 0, stdout: out, stderr: "" };
    } catch (e) {
        return { code: e.status || 1, stdout: (e.stdout && e.stdout.toString()) || "", stderr: (e.stderr && e.stderr.toString()) || "" };
    }
}

withTempHomeAndVault(({ home, vault }) => {
    // Step 1: bootstrap
    const bootstrap = runCli(["bootstrap", "--vault", vault, "--non-interactive", "--no-register", "--mechanisms=all"]);
    ok("smoke-1 bootstrap exit 0", bootstrap.code === 0,
        `stdout=${bootstrap.stdout.slice(-300)} stderr=${bootstrap.stderr.slice(-300)}`);
    ok("smoke-2 bootstrap created ranch/platform-installed.json",
        fs.existsSync(path.join(vault, "ranch", "platform-installed.json")));

    // Step 2: seed
    const seed = runCli(["seed", "--vault", vault, "--anchor-date", ANCHOR]);
    ok("smoke-3 seed exit 0", seed.code === 0,
        `stdout=${seed.stdout.slice(-300)} stderr=${seed.stderr.slice(-300)}`);
    ok("smoke-4 seed printed total line", /total: \d+ notes/.test(seed.stdout));

    // Step 3: audit
    const audit = runCli(["audit", "--vault", vault]);
    ok("smoke-5 audit exit 0", audit.code === 0,
        `stdout=${audit.stdout.slice(-300)} stderr=${audit.stderr.slice(-300)}`);
    ok("smoke-6 audit reports zero errors",
        !/error/i.test(audit.stdout) || /0 errors?/.test(audit.stdout));
    ok("smoke-7 audit reports zero warnings",
        !/warning/i.test(audit.stdout) || /0 warnings?/.test(audit.stdout));

    // Step 4: registry-unchanged invariant (--no-register opt-out)
    const registryPath = path.join(home, ".sauce", "vaults.json");
    const registryExists = fs.existsSync(registryPath);
    if (registryExists) {
        const reg = JSON.parse(fs.readFileSync(registryPath, "utf8"));
        ok("smoke-8 registry empty after --no-register",
            !reg.vaults || reg.vaults.length === 0,
            `registry contents: ${JSON.stringify(reg)}`);
    } else {
        ok("smoke-8 registry not created (--no-register opt-out)", true);
    }

    // Step 4b: v0.42.0 S9 — cowork@0.4.0 hub files. The bootstrap uses
    // --mechanisms=all but a default non-interactive bootstrap subscribes
    // blueprints via a second targeted install that only subscribes cowork.
    // We run a reinstall with cowork subscription to materialize hub files.
    // Since the install path for a pre-configured vault (config+sub already
    // written by bootstrap) re-reads subscription from disk, we patch the
    // subscription to add cowork + its dependency (daily), then reinstall.
    const subPath = path.join(vault, "ranch", "platform-subscription.json");
    const sub = JSON.parse(fs.readFileSync(subPath, "utf8"));
    const wsmf = JSON.parse(fs.readFileSync(path.join(path.resolve(__dirname, "../.."), "platform/manifest.json"), "utf8"));
    const dailyEntry = wsmf.blueprints.find(b => b.name === "daily");
    const coworkEntry = wsmf.blueprints.find(b => b.name === "cowork");
    if (dailyEntry && !sub.blueprints.find(b => b.name === "daily")) {
        sub.blueprints.push({ name: dailyEntry.name, version: dailyEntry.version });
    }
    if (coworkEntry && !sub.blueprints.find(b => b.name === "cowork")) {
        sub.blueprints.push({ name: coworkEntry.name, version: coworkEntry.version });
    }
    fs.writeFileSync(subPath, JSON.stringify(sub, null, 2), "utf8");
    const reinstall = runCli(["reinstall", "--vault", vault]);
    const coworkDir = path.join(vault, "spice", "cowork");
    ok("smoke-cowork-daily-hub-exists",
        fs.existsSync(path.join(coworkDir, "Daily Hub.md")),
        `reinstall exit=${reinstall.code} stdout=${reinstall.stdout.slice(-200)} path=${path.join(coworkDir, "Daily Hub.md")}`);
    ok("smoke-cowork-weekly-hub-exists",
        fs.existsSync(path.join(coworkDir, "Weekly Hub.md")),
        `path=${path.join(coworkDir, "Weekly Hub.md")}`);
    ok("smoke-cowork-monthly-hub-exists",
        fs.existsSync(path.join(coworkDir, "Monthly Hub.md")),
        `path=${path.join(coworkDir, "Monthly Hub.md")}`);

    // v0.44.0 S9 — About Cowork.md materialized at spice/cowork/ after reinstall
    // (relocated documentation from the trimmed Cowork.md hub).
    ok("smoke-cowork-about-exists",
        fs.existsSync(path.join(coworkDir, "About Cowork.md")),
        `path=${path.join(coworkDir, "About Cowork.md")}`);

    // v0.43.0: nav-button consolidation. cowork@0.5.0 contributes exactly
    // 1 global nav-button (cowork-hub); the v0.4.0 cowork-weekly-this +
    // cowork-monthly-this entries should NOT appear in the registry after
    // a fresh install.
    const navRegPath = path.join(vault, "ranch", "nav-buttons-registry.json");
    let navReg = null;
    try { navReg = JSON.parse(fs.readFileSync(navRegPath, "utf8")); }
    catch (e) { /* leave null; assertion below will surface */ }
    const coworkContribs = (navReg && navReg.contributions && Array.isArray(navReg.contributions.cowork))
        ? navReg.contributions.cowork : [];
    ok("smoke-cowork-nav-contributions-length-1",
        coworkContribs.length === 1,
        `expected contributions.cowork[].length === 1, got ${coworkContribs.length} (registry path=${navRegPath})`);
    ok("smoke-cowork-nav-only-cowork-hub",
        coworkContribs.length === 1 && coworkContribs[0] && coworkContribs[0].id === "cowork-hub",
        `expected contributions.cowork[0].id === "cowork-hub", got id=${coworkContribs[0] && coworkContribs[0].id}`);

    // Step 5: post-conditions on seeded notes
    const expectations = [
        { blueprint: "project", moduleDir: "projects", minNotes: 3 },
        { blueprint: "daily",   moduleDir: "daily",    minNotes: 30 },
        { blueprint: "meetings",moduleDir: "meetings", minNotes: 4 },
        { blueprint: "people",  moduleDir: "people",   minNotes: 3 },
    ];
    for (const e of expectations) {
        const dir = path.join(vault, "spice", e.moduleDir);
        const exists = fs.existsSync(dir);
        ok(`smoke-bp-${e.blueprint}-exists`, exists, `dir=${dir}`);
        if (exists) {
            const count = countMdFilesRecursive(dir);
            ok(`smoke-bp-${e.blueprint}-count>=${e.minNotes}`,
                count >= e.minNotes, `actual count: ${count}`);
        } else {
            ok(`smoke-bp-${e.blueprint}-count>=${e.minNotes}`, false, "dir missing");
        }
    }

    // Step 6: installed.json mechanism + blueprint versions match manifest
    const installed = JSON.parse(fs.readFileSync(path.join(vault, "ranch", "platform-installed.json"), "utf8"));
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
    let allMatch = true;
    for (const m of manifest.mechanisms) {
        const found = installed.mechanisms.find(x => x.name === m.name);
        if (!found || found.version !== m.version) { allMatch = false; break; }
    }
    ok("smoke-installed-mech-versions-match-manifest", allMatch);
});

console.log(`\nrun-integration-smoke.js: ${pass} pass · ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);

function countMdFilesRecursive(dir) {
    let n = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) n += countMdFilesRecursive(path.join(dir, e.name));
        else if (e.isFile() && e.name.endsWith(".md")) n++;
    }
    return n;
}
