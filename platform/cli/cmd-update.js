// platform/cli/cmd-update.js — git fetch + reset --hard origin/main + reinstall.
//
// Test hooks (underscore-prefixed methods on ctx) override the default
// shell-out for git/npm/installer calls. Production code uses the real
// implementations; the run-cli.js harness injects mocks.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const section = require("../visual/section.js");

async function run(ctx, args) {
    const force = (args || []).includes("--force");
    const total = 4;

    process.stdout.write("  " + section.step(1, total, "Fetching origin/main...") + "  ");
    const fetched = _gitExec(ctx, ["fetch", "origin", "main"]);
    if (fetched.code !== 0) {
        console.log(section.fail());
        throw new Error("git fetch failed: " + fetched.stderr);
    }
    console.log(section.ok());

    process.stdout.write("  " + section.step(2, total, "Checking working tree...") + "  ");
    const status = _gitExec(ctx, ["status", "--short"]);
    const dirty = (status.stdout || "").trim().length > 0;
    if (dirty && !force) {
        console.log(section.fail("dirty"));
        const detail = (status.stdout || "").trim().split("\n").map(l => "    " + l).join("\n");
        throw new Error("pantry/ working tree is dirty:\n" + detail + "\n  Pass --force to override.");
    }
    console.log(section.ok(dirty ? "dirty (override via --force)" : "clean"));

    process.stdout.write("  " + section.step(3, total, "Resetting pantry/ to origin/main...") + "  ");
    const reset = _gitExec(ctx, ["reset", "--hard", "origin/main"]);
    if (reset.code !== 0) {
        console.log(section.fail());
        throw new Error("git reset failed: " + reset.stderr);
    }
    console.log(section.ok());

    // npm install if package.json SHA changed (compare HEAD@{1}:package.json vs HEAD)
    const pkgChanged = _gitExec(ctx, ["diff", "--name-only", "HEAD@{1}", "HEAD"]);
    if (pkgChanged.code === 0 && /package(-lock)?\.json/.test(pkgChanged.stdout || "")) {
        await _npmInstall(ctx);
    }

    process.stdout.write("  " + section.step(4, total, "Re-running installer...") + "  ");
    await _runInstaller(ctx);
    console.log(section.ok());

    console.log("");
    console.log("  Tip: Cmd+R Obsidian to pick up changes.");
}

function _gitExec(ctx, args) {
    if (typeof ctx._gitExec === "function") return ctx._gitExec(args);
    const r = spawnSync("git", args, { cwd: ctx.workshopPath, encoding: "utf8" });
    return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

async function _npmInstall(ctx) {
    if (typeof ctx._npmInstall === "function") return ctx._npmInstall();
    const r = spawnSync("npm", ["install", "--omit=dev"], { cwd: ctx.workshopPath, encoding: "utf8", stdio: "inherit" });
    if (r.status !== 0) throw new Error("npm install failed");
}

async function _runInstaller(ctx) {
    if (typeof ctx._runInstaller === "function") return ctx._runInstaller();
    const bootstrap = require("../bootstrap.js");
    await bootstrap.phaseRunInstaller({ vaultPath: ctx.vaultPath });
}

module.exports = { run };
