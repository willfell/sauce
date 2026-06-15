#!/usr/bin/env node
// scripts/workshop-status.js — v0.112.0 one-shot workshop survey.
//
// Run at the start of any session to get the full state picture in <1 second:
// workshop version, blueprint versions, branch + sync state, recent cycles
// from Docs/plans/*-result.md, in-flight pointers (uncommitted briefs/designs/
// plans without a result), carry-forwards from the most recent result, and a
// cached harness gate.
//
// Pure node, zero deps, ANSI colors via raw escapes. Works from any CWD as
// long as the script lives under <workshop>/scripts/.
//
// Flags:
//   --fresh    re-run helper-cases + behavioral harness (slow; default skips)
//   --json     emit machine-readable JSON
//   --no-color disable ANSI codes
//
// Exit codes:
//   0  workshop state read successfully (may report drift / dirty state but exit 0)
//   2  not in a workshop root (platform/manifest.json missing)

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const WORKSHOP = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const FRESH = ARGS.has("--fresh");
const JSON_OUT = ARGS.has("--json");
const USE_COLOR = !ARGS.has("--no-color") && process.stdout.isTTY && !JSON_OUT;

function c(code, s) { return USE_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s; }
const dim    = (s) => c("2", s);
const bold   = (s) => c("1", s);
const green  = (s) => c("32", s);
const yellow = (s) => c("33", s);
const red    = (s) => c("31", s);
const cyan   = (s) => c("36", s);

// --------------------------------------------------------------------------- workshop
function readWorkshopManifest() {
  const p = path.join(WORKSHOP, "platform/manifest.json");
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (_e) { return null; }
}

// --------------------------------------------------------------------------- git
function git(args) {
  const r = spawnSync("git", args, { cwd: WORKSHOP, encoding: "utf8" });
  return { code: r.status, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
}

function gitState() {
  const head = git(["rev-parse", "--short", "HEAD"]).stdout || "?";
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout || "?";
  const status = git(["status", "--short"]).stdout;
  const dirty = status.length > 0;
  // Refresh remote-tracking refs is the caller's job (we don't fetch automatically).
  const ahead = parseInt((git(["rev-list", "--count", "origin/main..HEAD"]).stdout || "0"), 10);
  const behind = parseInt((git(["rev-list", "--count", "HEAD..origin/main"]).stdout || "0"), 10);
  const recent = git(["log", "--oneline", "-5"]).stdout.split("\n").filter(Boolean);
  return { head, branch, dirty, ahead, behind, status, recent };
}

// --------------------------------------------------------------------------- Docs/plans
function listResultDocs() {
  const dir = path.join(WORKSHOP, "Docs/plans");
  if (!fs.existsSync(dir)) return [];
  const all = fs.readdirSync(dir).filter(f => /-result\.md$/.test(f));
  // Filename pattern: YYYY-MM-DD-vX.Y.Z[-tag]-<topic>-result.md
  return all
    .map(f => ({ file: f, abs: path.join(dir, f) }))
    .sort((a, b) => b.file.localeCompare(a.file)); // DESC by filename (date prefix)
}

function listPlanArtifacts() {
  const dir = path.join(WORKSHOP, "Docs/plans");
  if (!fs.existsSync(dir)) return { briefs: [], designs: [], plans: [], results: [] };
  const all = fs.readdirSync(dir);
  return {
    briefs: all.filter(f => /-brief\.md$/.test(f)),
    designs: all.filter(f => /-design\.md$/.test(f)),
    plans: all.filter(f => /-plan\.md$/.test(f)),
    results: all.filter(f => /-result\.md$/.test(f)),
  };
}

// In-flight = any RECENT brief/design/plan whose <prefix>-result.md does NOT
// exist. "Recent" = prefix date within the last 14 days; older orphans are
// almost always cycles that landed under a different filename or were
// abandoned — surfacing them as in-flight is noise, not signal.
function findInFlight() {
  const { briefs, designs, plans, results } = listPlanArtifacts();
  const resultPrefixes = new Set(results.map(f => f.replace(/-result\.md$/, "")));
  const cutoff = new Date(Date.now() - 14 * 86400 * 1000);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const inFlight = new Map();
  for (const f of [...briefs, ...designs, ...plans]) {
    const prefix = f.replace(/-(brief|design|plan)\.md$/, "");
    const dateMatch = prefix.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch || dateMatch[1] < cutoffStr) continue;
    if (resultPrefixes.has(prefix)) continue;
    if (!inFlight.has(prefix)) inFlight.set(prefix, []);
    inFlight.get(prefix).push(f);
  }
  return Array.from(inFlight.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([prefix, files]) => ({ prefix, files }));
}

// Extract a one-line summary from a result doc.
function summarizeResult(file) {
  const abs = path.join(WORKSHOP, "Docs/plans", file);
  let body;
  try { body = fs.readFileSync(abs, "utf8"); }
  catch (_e) { return null; }
  // Grab `cycle_arc:` from frontmatter
  const cycleArc = (body.match(/^cycle_arc:\s*(.+)$/m) || [])[1] || "";
  // Date prefix
  const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : "????-??-??";
  // Version label — vX.Y.Z plus optional .W and optional -CF1/-CF2 tag.
  // Important: the trailing -<topic> is NOT part of the version. We anchor on
  // the LAST `vX.Y.Z(.W)?(-<tag>)?` that's followed by a hyphen and a non-dotted
  // identifier (the topic).
  const verMatch = file.match(/v(\d+\.\d+\.\d+(?:\.\d+)?(?:-CF\d+)?)/);
  const ver = verMatch ? verMatch[1] : "?";
  // Topic — strip date + version (with optional .W and -CFx tag) + -result.md
  const topic = file
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .replace(/^v\d+\.\d+\.\d+(?:\.\d+)?(?:-CF\d+)?-/, "")
    .replace(/-result\.md$/, "")
    .replace(/-/g, " ");
  return { file, date, ver, topic, cycleArc: cycleArc.trim() };
}

// Carry-forwards from the most recent result doc.
function extractCarryForwards(file) {
  const abs = path.join(WORKSHOP, "Docs/plans", file);
  let body;
  try { body = fs.readFileSync(abs, "utf8"); }
  catch (_e) { return []; }
  const cfMatch = body.match(/##\s*Carr(?:y|ies)\s+forward[s]?\s*\n([\s\S]*?)(?=^##\s|\Z)/m);
  if (!cfMatch) return [];
  const lines = cfMatch[1].split("\n");
  const out = [];
  for (const line of lines) {
    // Only match top-level `- ` bullets (avoid nested two-space-indented list items).
    if (!/^- /.test(line)) continue;
    // Strip the leading `- `, then strip markdown formatting tokens.
    let raw = line.replace(/^- /, "").trim();
    raw = raw.replace(/[`*]/g, ""); // drop backticks + asterisks
    // Split into headline + tail at the first em-dash or double-dash separator.
    const sep = raw.match(/\s+(?:—|--|-\s)\s+(.*)$/);
    let headline = raw;
    let tail = "";
    if (sep) {
      headline = raw.slice(0, raw.indexOf(sep[0])).trim();
      tail = sep[1].trim();
    }
    headline = headline.slice(0, 100);
    tail = tail.slice(0, 100);
    if (headline.length > 0) out.push({ headline, tail });
  }
  return out.slice(0, 8);
}

// --------------------------------------------------------------------------- harness cache
const CACHE_PATH = path.join(WORKSHOP, ".workshop-status-cache.json");

function readCache() {
  if (!fs.existsSync(CACHE_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")); }
  catch (_e) { return null; }
}

function writeCache(cache) {
  try { fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + "\n"); }
  catch (_e) { /* not fatal */ }
}

function runHarness(name, cmd) {
  const r = spawnSync(cmd.shift(), cmd, { cwd: WORKSHOP, encoding: "utf8", timeout: 120000 });
  const tail = (r.stdout || "").trim().split("\n").slice(-3).join("\n");
  // Look for "Result: N passed, M failed" or "passed: N\nfailed: M"
  const m1 = tail.match(/Result:\s+(\d+)\s+passed,\s+(\d+)\s+failed/);
  const m2 = tail.match(/passed:\s+(\d+)\s*\n?failed:\s+(\d+)/);
  const m = m1 || m2;
  if (!m) return { name, passed: null, failed: null, exit: r.status };
  return { name, passed: parseInt(m[1], 10), failed: parseInt(m[2], 10), exit: r.status };
}

function getHarnessCounts() {
  if (FRESH) {
    const results = [
      runHarness("helper-cases", ["node", "platform/test/run-helper-cases.js"]),
      runHarness("v01103-monthly", ["node", "platform/test/run-v01103-monthly-overview.js"]),
    ];
    const cache = { ts: new Date().toISOString(), results };
    writeCache(cache);
    return cache;
  }
  const cached = readCache();
  return cached;
}

// --------------------------------------------------------------------------- emit
function emitProse(snapshot) {
  const m = snapshot.manifest;
  const g = snapshot.git;
  const fin = (m.blueprints || []).find(b => b.name === "finance");

  const blueprints = (m.blueprints || []).length;
  const mechanisms = (m.mechanisms || []).length;

  console.log("");
  console.log(`${bold("sauce workshop")} ${green(m.workshop_version)} · finance ${fin ? cyan(fin.version) : dim("(none)")} · ${mechanisms} mechanisms · ${blueprints} blueprints`);
  const syncLabel = g.ahead === 0 && g.behind === 0 ? green("in sync") : yellow(`${g.ahead} ahead / ${g.behind} behind`);
  const dirtLabel = g.dirty ? red("dirty") : green("clean");
  console.log(`branch ${bold(g.branch)} (${dirtLabel}) · ${syncLabel} ${dim("origin/main")}`);
  console.log(`HEAD ${cyan(g.head)} ${dim(g.recent[0] ? g.recent[0].slice(g.head.length).trim() : "")}`);

  if (g.dirty) {
    console.log("");
    console.log(yellow("Uncommitted state:"));
    for (const line of g.status.split("\n").slice(0, 10)) console.log(`  ${line}`);
    if (g.status.split("\n").length > 10) console.log(dim(`  … ${g.status.split("\n").length - 10} more`));
  }

  console.log("");
  console.log(bold("Recent cycles ") + dim("(Docs/plans/*-result.md):"));
  for (const r of snapshot.recentResults.slice(0, 4)) {
    const label = `${r.date}  v${r.ver.padEnd(14)}`;
    console.log(`  ${dim(label)}  ${r.topic}`);
  }
  if (snapshot.recentResults.length === 0) console.log(dim("  (no result docs found)"));

  console.log("");
  console.log(bold("In-flight ") + dim("(briefs/designs/plans without a result):"));
  if (snapshot.inFlight.length === 0) {
    console.log(dim("  (none)"));
  } else {
    for (const x of snapshot.inFlight.slice(0, 5)) {
      const kinds = x.files.map(f => f.match(/-(brief|design|plan)\.md$/)[1]).join(" + ");
      console.log(`  ${cyan(x.prefix)} ${dim(`(${kinds})`)}`);
    }
  }

  console.log("");
  console.log(bold("Carries forward ") + dim("(from latest result doc):"));
  if (snapshot.carryForwards.length === 0) {
    console.log(dim("  (none surfaced)"));
  } else {
    for (const cf of snapshot.carryForwards) {
      const label = cf.tail ? `${cf.headline} — ${dim(cf.tail)}` : cf.headline;
      console.log(`  - ${label}`);
    }
  }

  console.log("");
  console.log(bold("Harness gate:"));
  const cache = snapshot.harness;
  if (!cache) {
    console.log(dim("  no cached runs · use --fresh to populate"));
  } else {
    const age = cache.ts ? humanAge(cache.ts) : "unknown";
    console.log(dim(`  last run ${cache.ts || "?"} (${age} ago)`));
    for (const r of (cache.results || [])) {
      const status = r.failed === 0 ? green(`${r.passed} / 0`) : red(`${r.passed} / ${r.failed}`);
      console.log(`  ${r.name.padEnd(20)} ${status}`);
    }
  }
  console.log("");
}

function humanAge(iso) {
  const then = Date.parse(iso);
  if (!isFinite(then)) return "?";
  const diff = (Date.now() - then) / 1000;
  if (diff < 60) return `${Math.round(diff)}s`;
  if (diff < 3600) return `${Math.round(diff / 60)}m`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h`;
  return `${Math.round(diff / 86400)}d`;
}

function emitJson(snapshot) {
  process.stdout.write(JSON.stringify(snapshot, null, 2) + "\n");
}

// --------------------------------------------------------------------------- main
function main() {
  const manifest = readWorkshopManifest();
  if (!manifest) {
    console.error("workshop-status: platform/manifest.json not found — are we in a workshop root?");
    process.exit(2);
  }

  const g = gitState();
  const resultDocs = listResultDocs();
  const recentResults = resultDocs.slice(0, 6).map(r => summarizeResult(r.file)).filter(Boolean);
  const inFlight = findInFlight();
  const latestResult = resultDocs[0] ? resultDocs[0].file : null;
  const carryForwards = latestResult ? extractCarryForwards(latestResult) : [];
  const harness = getHarnessCounts();

  const snapshot = { manifest, git: g, recentResults, inFlight, carryForwards, harness };

  if (JSON_OUT) emitJson(snapshot);
  else emitProse(snapshot);

  process.exit(0);
}

main();
