// platform/cli/cmd-run.js — `sauce run <note>`: run a graph note through the
// Sauce engine. Context-free at the dispatcher (like doctor): the vault is
// resolved from the note's own ancestors first, then the cwd walk, then
// $SAUCE_VAULT, so `sauce run /abs/path/to/note.md` works from anywhere.
//
//   sauce run <note>                  one tick, then exit
//   sauce run <note> --follow         keep ticking until a terminal node (stops at a human node
//                                     unless --wait-human)
//   sauce run <note> --dry-run        validate + print the plan; writes nothing
//   sauce run <note> --status         latest run's projection, read-only
//   sauce run --list                  every run in the vault, newest first
//   sauce run <note> --sweep          remove finished, clean worktrees of this note's runs
//   sauce run <note> --install-launchd [--interval <s>]   unattended cadence via launchd
//   sauce run <note> --uninstall-launchd
//   flags: --worker <fake|claude-code|codex>  --repo <path>  --var k=v  --interval <s>  --json
//
// Exit codes: 0 done/parked/listed, 1 the run failed, 2 usage or refusal.

const fs = require("fs");
const path = require("path");

const ENGINE = path.resolve(__dirname, "..", "engine");

function parseFlags(argv) {
    const f = { note: null, follow: false, dryRun: false, status: false, list: false, sweep: false, json: false,
        worker: null, repo: null, vars: {}, interval: 30, waitHuman: false, installLaunchd: false, uninstallLaunchd: false, help: false, vault: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--help" || a === "-h") f.help = true;
        else if (a === "--follow") f.follow = true;
        else if (a === "--dry-run") f.dryRun = true;
        else if (a === "--status") f.status = true;
        else if (a === "--list") f.list = true;
        else if (a === "--sweep") f.sweep = true;
        else if (a === "--json") f.json = true;
        else if (a === "--wait-human") f.waitHuman = true;
        else if (a === "--install-launchd") f.installLaunchd = true;
        else if (a === "--uninstall-launchd") f.uninstallLaunchd = true;
        else if (a === "--worker") f.worker = argv[++i];
        else if (a.startsWith("--worker=")) f.worker = a.slice(9);
        else if (a === "--repo") f.repo = argv[++i];
        else if (a.startsWith("--repo=")) f.repo = a.slice(7);
        else if (a === "--vault") f.vault = argv[++i];
        else if (a.startsWith("--vault=")) f.vault = a.slice(8);
        else if (a === "--interval") f.interval = parseInt(argv[++i], 10);
        else if (a.startsWith("--interval=")) f.interval = parseInt(a.slice(11), 10);
        else if (a === "--var") { const kv = String(argv[++i] || ""); const eq = kv.indexOf("="); if (eq > 0) f.vars[kv.slice(0, eq)] = kv.slice(eq + 1); }
        else if (a.startsWith("--var=")) { const kv = a.slice(6); const eq = kv.indexOf("="); if (eq > 0) f.vars[kv.slice(0, eq)] = kv.slice(eq + 1); }
        else if (a.startsWith("--")) throw usage(`unknown flag ${a}`);
        else if (!f.note) f.note = a;
        else throw usage(`unexpected argument ${a}`);
    }
    return f;
}

function usage(msg) { const e = new Error(msg); e.code = "usage"; return e; }

function emit(flags, obj, human) {
    if (flags.json) console.log(JSON.stringify(obj, null, 2));
    else if (typeof human === "function") human(obj);
    else console.log(JSON.stringify(obj, null, 2));
}

function refuse(flags, code, message, extra) {
    const body = Object.assign({ ok: false, code, message }, extra || {});
    if (flags.json) console.log(JSON.stringify(body, null, 2));
    else console.error(`sauce run: ${message}`);
    process.exitCode = 2;
    return body;
}

function resolveNote(flags, ctx) {
    if (!flags.note) return null;
    const candidates = [path.resolve(flags.note)];
    if (ctx && ctx.vaultPath) candidates.push(path.resolve(ctx.vaultPath, flags.note));
    for (const c of candidates) if (fs.existsSync(c)) return c;
    return candidates[0];
}

function resolveVault(flags, ctx, notePath) {
    const engine = require(path.join(ENGINE, "index.js"));
    if (flags.vault) return path.resolve(flags.vault);
    if (notePath) { const v = engine.resolveVaultForNote(notePath); if (v) return v; }
    if (ctx && ctx.vaultPath) return ctx.vaultPath;
    let cur = process.cwd();
    while (cur !== path.dirname(cur)) { if (fs.existsSync(path.join(cur, "ranch", "platform-config.json"))) return cur; cur = path.dirname(cur); }
    if (process.env.SAUCE_VAULT && fs.existsSync(path.join(process.env.SAUCE_VAULT, "ranch", "platform-config.json"))) return process.env.SAUCE_VAULT;
    return null;
}

function printReceipt(r) {
    console.log("");
    console.log(`  sauce run — ${r.run_id} · ${r.status}${r.final_outcome && r.final_outcome !== r.status ? ` (${r.final_outcome})` : ""}`);
    console.log("");
    for (const [id, st] of Object.entries(r.nodes || {})) console.log(`  ${st === "pass" ? "[OK]  " : st === "idle" || st === "running" ? "[..]  " : "[--]  "} ${id}: ${st}`);
    if (r.parked) { console.log(""); console.log(`  parked on "${r.parked.node}": ${r.parked.ask}`); console.log("  Tick the box in the note, then run again."); }
    console.log("");
    console.log(`  ledger: ${r.ledger}`);
    console.log("");
}

async function run(ctx, args) {
    let flags;
    try { flags = parseFlags(args || []); }
    catch (e) { return refuse({ json: false }, "usage", e.message); }
    if (flags.help) {
        console.log(fs.readFileSync(__filename, "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
        return { ok: true };
    }
    const engine = require(path.join(ENGINE, "index.js"));
    const notePath = resolveNote(flags, ctx);
    const vault = resolveVault(flags, ctx, notePath);
    if (!vault) return refuse(flags, "vault_missing", "not inside a sauce-managed vault and the note is not inside one either; cd into a vault, pass --vault, or set SAUCE_VAULT");

    if (flags.list) {
        const runs = engine.listRuns(vault);
        emit(flags, { ok: true, vault, runs }, () => {
            console.log("");
            if (!runs.length) console.log("  no runs yet");
            for (const r of runs) console.log(`  ${r.status.padEnd(8)} ${r.run_id}  ${r.graph_note || ""}${r.parked ? `  (parked on ${r.parked.node})` : ""}`);
            console.log("");
        });
        return { ok: true, runs };
    }
    if (!notePath) return refuse(flags, "usage", "a graph note path is required (or --list)");
    if (!fs.existsSync(notePath)) return refuse(flags, "note_missing", `graph note not found: ${notePath}`);

    if (flags.installLaunchd || flags.uninstallLaunchd) {
        const launchd = require(path.join(ENGINE, "launchd.js"));
        try {
            const res = flags.installLaunchd
                ? launchd.install({ notePath, intervalSeconds: flags.interval > 0 ? flags.interval : 900, cliPath: path.resolve(__dirname, "sauce-cli.js") })
                : launchd.uninstall({ notePath });
            emit(flags, Object.assign({ ok: true }, res), (o) => { console.log(`  ${o.message}`); });
            return res;
        } catch (e) { return refuse(flags, "launchd_failed", e.message); }
    }

    if (flags.sweep) {
        const latest = engine.latestRunFor(vault, notePath);
        const runs = engine.listRuns(vault, { graph_note: path.relative(vault, notePath) });
        const worktrees = [];
        let repo = null;
        for (const r of runs) {
            if (r.status === "running" || r.status === "parked") continue;
            const s = engine.reduce(engine.loadGraphNote(notePath).graph, engine.readEvents(vault, r.run_id));
            repo = repo || s.repo;
            for (const res of Object.values(s.results || {})) if (res && res.worktree) worktrees.push(res.worktree);
        }
        if (!repo || !worktrees.length) { emit(flags, { ok: true, removed: [], kept: [], latest: latest && latest.run_id }, () => console.log("  nothing to sweep")); return { ok: true, removed: [], kept: [] }; }
        const sw = engine.sweep({ repo, worktrees: Array.from(new Set(worktrees)), baseRef: require(path.join(ENGINE, "isolation.js")).defaultBase(repo) });
        emit(flags, Object.assign({ ok: true }, sw), (o) => { for (const p of o.removed) console.log(`  removed ${p}`); for (const k of o.kept) console.log(`  kept    ${k.path} (${k.reason})`); });
        return sw;
    }

    let parsed;
    try { parsed = engine.loadGraphNote(notePath); }
    catch (e) { return refuse(flags, e.code || "graph_invalid", e.message); }

    if (flags.status) {
        const latest = engine.latestRunFor(vault, notePath);
        if (!latest) { emit(flags, { ok: true, status: "never-run", note: notePath }, () => console.log("  never run")); return { ok: true, status: "never-run" }; }
        const opened = engine.openRun({ vault, notePath, runId: latest.run_id });
        const nodes = {};
        for (const [id, n] of Object.entries(opened.state.nodes)) nodes[id] = n.status === "finished" ? n.outcome : n.status;
        const r = { ok: true, run_id: latest.run_id, status: opened.state.status, final_outcome: opened.state.final_outcome, nodes, parked: opened.state.parked, ledger: path.join(engine.runsDir(vault), `${latest.run_id}.jsonl`), started_at: opened.state.started_at, ended_at: opened.state.ended_at };
        emit(flags, r, printReceipt);
        return r;
    }

    let repo = null;
    if (flags.repo || parsed.frontmatter.repo) {
        try { repo = require(path.join(ENGINE, "run.js")).expandHome(flags.repo || parsed.frontmatter.repo); }
        catch (e) { return refuse(flags, "repo_missing", e.message); }
    }

    if (flags.dryRun) {
        const plan = engine.dryRunPlan(parsed, repo ? path.resolve(repo) : null);
        const out = { ok: true, dry_run: true, vault: fs.realpathSync(vault), note: notePath, plan };
        emit(flags, out, () => {
            console.log("");
            console.log(`  plan for ${path.basename(notePath)} (${plan.nodes.length} nodes, ${plan.edges.length} edges; entry: ${plan.entries.join(", ")})`);
            for (const n of plan.nodes) console.log(`    ${n.id.padEnd(18)} ${n.type}${n.worker ? ` via ${n.worker}` : ""}${n.isolate ? ` [${n.isolate}]` : ""}`);
            for (const e of plan.edges) console.log(`    ${e.from} -> ${e.to} on ${e.on}${e.max ? ` (max ${e.max})` : ""}`);
            console.log("");
        });
        return out;
    }

    let created;
    try { created = engine.createRun({ vault, notePath, repo, workerOverride: flags.worker, vars: flags.vars }); }
    catch (e) { return refuse(flags, e.code || "run_failed", e.message); }
    const runCtx = created.ctx;
    const receipt = flags.follow
        ? engine.follow(runCtx, { intervalSeconds: flags.interval > 0 ? flags.interval : 30, beforeSleep: (r) => (r.status === "parked" ? flags.waitHuman : true) })
        : engine.tick(runCtx);
    emit(flags, receipt, printReceipt);
    process.exitCode = receipt.status === "failed" ? 1 : 0;
    return receipt;
}

module.exports = { run, _parseFlags: parseFlags };
