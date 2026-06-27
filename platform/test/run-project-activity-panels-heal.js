#!/usr/bin/env node
// run-project-activity-panels-heal.js — behavioral harness for
// applyProjectActivityPanelsHeal in platform/install.js. Zero-dep, in-memory
// adapter. Mirrors run-v0127-project-hub-heal.js.
"use strict";
const path = require("path");
const install = require(path.join(__dirname, "..", "install.js"));
const { applyProjectActivityPanelsHeal } = install;
if (typeof applyProjectActivityPanelsHeal !== "function") {
  console.error("FATAL: applyProjectActivityPanelsHeal not exported from install.js");
  process.exit(2);
}

function makeAdapter(initial) {
  const files = new Map(Object.entries(initial || {}));
  const dirs = new Set();
  for (const p of files.keys()) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return {
    async exists(p) { return files.has(p) || dirs.has(p); },
    async list(p) {
      const folders = []; const filesAt = [];
      for (const d of dirs) {
        if (d === p) continue;
        if (d.startsWith(p + "/") && d.indexOf("/", p.length + 1) === -1) folders.push(d);
      }
      for (const f of files.keys()) {
        if (f.startsWith(p + "/") && f.indexOf("/", p.length + 1) === -1) filesAt.push(f);
      }
      return { folders, files: filesAt };
    },
    async read(p) { if (!files.has(p)) throw new Error("ENOENT: " + p); return files.get(p); },
    async write(p, body) {
      files.set(p, body);
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    },
    async mkdir(p) { dirs.add(p); },
    _files: files, _dirs: dirs,
  };
}
function makeTp(adapter) { return { app: { vault: { adapter } } }; }

const FENCE = "```";
function block(cls) {
  return FENCE + "dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"" + cls + "\" });\n" + FENCE;
}
function hub(classes) {
  return "---\ntype: project\n---\n\n" + classes.map(block).join("\n\n") + "\n";
}

const HUB_STATUS_MEETINGS = hub(["Breadcrumb","SpaceNavButtons","ProjectNavButtons","ProjectStatusWidget","ProjectMeetingsPanel","ProjectWorkstreamManager"]);
const HUB_NO_STATUS       = hub(["SpaceNavButtons","ProjectNavButtons","ProjectMeetingsPanel","ProjectWorkstreamManager"]);
const HUB_MEETINGS_ONLY   = hub(["ProjectMeetingsPanel"]);
const HUB_STATUS_NO_MEET  = hub(["Breadcrumb","ProjectStatusWidget","ProjectWorkstreamManager"]);
const HUB_NO_DATAVIEWJS   = "---\ntype: project\n---\n\n# Plain hub\nSome text.\n";
const NON_PROJECT         = "---\ntype: project-todo\n---\n\n" + block("Breadcrumb") + "\n";

let pass = 0, fail = 0; const failures = [];
function ok(label, cond, detail) {
  if (cond) { pass++; console.log("  ok  " + label); }
  else { fail++; const m = label + (detail ? " — " + detail : ""); failures.push(m); console.log("  FAIL  " + m); }
}
const GIT = { commit: null, tag: null, dirty: null };
function order(result) {
  return {
    a: result.indexOf("ProjectActivityPanel"),
    o: result.indexOf("ProjectOpenTasks"),
    m: result.indexOf("ProjectMeetingsPanel"),
    s: result.indexOf("ProjectStatusWidget"),
    n: result.indexOf("ProjectNavButtons"),
    w: result.indexOf("ProjectWorkstreamManager"),
  };
}

async function run() {
  {
    const ad = makeAdapter({ "spice/projects/ems/EMS.md": HUB_STATUS_MEETINGS });
    const h = [];
    await applyProjectActivityPanelsHeal(makeTp(ad), {}, {}, h, GIT);
    const r = await ad.read("spice/projects/ems/EMS.md");
    const x = order(r);
    ok("PAP-A.inserted", x.a > -1 && x.o > -1);
    ok("PAP-A.order", x.s < x.a && x.a < x.o && x.o < x.m && x.m < x.w, JSON.stringify(x));
    ok("PAP-A.history", h.some(e => e.action === "healed" && e.target && e.target.includes("EMS.md")));
  }
  {
    const ad = makeAdapter({ "spice/projects/conn/Project.md": HUB_NO_STATUS });
    const h = [];
    await applyProjectActivityPanelsHeal(makeTp(ad), {}, {}, h, GIT);
    const r = await ad.read("spice/projects/conn/Project.md");
    const x = order(r);
    ok("PAP-B.order", x.n < x.a && x.a < x.o && x.o < x.m, JSON.stringify(x));
  }
  {
    const ad = makeAdapter({ "spice/projects/cw/Project.md": HUB_MEETINGS_ONLY });
    const h = [];
    await applyProjectActivityPanelsHeal(makeTp(ad), {}, {}, h, GIT);
    const r = await ad.read("spice/projects/cw/Project.md");
    const x = order(r);
    ok("PAP-C.order", x.a > -1 && x.a < x.o && x.o < x.m, JSON.stringify(x));
  }
  {
    const ad = makeAdapter({ "spice/projects/ems/EMS.md": HUB_STATUS_MEETINGS });
    await applyProjectActivityPanelsHeal(makeTp(ad), {}, {}, [], GIT);
    const after1 = await ad.read("spice/projects/ems/EMS.md");
    const h = [];
    await applyProjectActivityPanelsHeal(makeTp(ad), {}, {}, h, GIT);
    const after2 = await ad.read("spice/projects/ems/EMS.md");
    ok("PAP-D.idempotent", after1 === after2, "2nd pass changed file");
    ok("PAP-D.history-skipped", h.some(e => e.action === "skipped_already_healed"));
  }
  {
    const ad = makeAdapter({ "spice/projects/x/X.md": HUB_STATUS_NO_MEET });
    const h = [];
    await applyProjectActivityPanelsHeal(makeTp(ad), {}, {}, h, GIT);
    const r = await ad.read("spice/projects/x/X.md");
    const x = order(r);
    ok("PAP-E.order", x.s > -1 && x.s < x.a && x.a < x.o, JSON.stringify(x));
  }
  {
    const ad = makeAdapter({ "spice/projects/p/Plain.md": HUB_NO_DATAVIEWJS });
    const before = await ad.read("spice/projects/p/Plain.md");
    const h = [];
    await applyProjectActivityPanelsHeal(makeTp(ad), {}, {}, h, GIT);
    const after = await ad.read("spice/projects/p/Plain.md");
    ok("PAP-F.unchanged", before === after);
    ok("PAP-F.history-warning", h.some(e => e.action === "no_anchor_found"));
  }
  {
    const ad = makeAdapter({ "spice/projects/dbk/Databricks To-Do.md": NON_PROJECT });
    const before = await ad.read("spice/projects/dbk/Databricks To-Do.md");
    const h = [];
    await applyProjectActivityPanelsHeal(makeTp(ad), {}, {}, h, GIT);
    const after = await ad.read("spice/projects/dbk/Databricks To-Do.md");
    ok("PAP-G.unchanged", before === after);
    ok("PAP-G.no-target-history", !h.some(e => e.target && e.target.includes("Databricks To-Do.md")));
  }
  {
    const ad = makeAdapter({});
    let threw = false;
    try { await applyProjectActivityPanelsHeal(makeTp(ad), {}, {}, [], GIT); } catch (_e) { threw = true; }
    ok("PAP-H.no-throw", !threw);
  }

  console.log("");
  if (fail === 0) { console.log("PASS " + pass + "/" + (pass + fail)); process.exit(0); }
  else { console.log("FAIL " + fail + "/" + (pass + fail)); for (const f of failures) console.log("  - " + f); process.exit(1); }
}
run().catch(e => { console.error("UNCAUGHT: " + (e && e.stack ? e.stack : String(e))); process.exit(2); });
