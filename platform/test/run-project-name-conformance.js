#!/usr/bin/env node
// run-project-name-conformance.js — WS2 harness: name-aware project display
// resolution + project_name backfill/repair. Zero-dep, in-memory adapter.
"use strict";
const path = require("path");
const install = require(path.join(__dirname, "..", "install.js"));
const { _injectProjectNameFrontmatter, _resolveProjectDisplayName } = install;
if (typeof _injectProjectNameFrontmatter !== "function" || typeof _resolveProjectDisplayName !== "function") {
  console.error("FATAL: _injectProjectNameFrontmatter / _resolveProjectDisplayName not exported");
  process.exit(2);
}

function makeAdapter(initial) {
  const files = new Map(Object.entries(initial || {}));
  return {
    async read(p) { if (!files.has(p)) throw new Error("ENOENT: " + p); return files.get(p); },
  };
}

let pass = 0, fail = 0; const failures = [];
function ok(label, cond, detail) {
  if (cond) { pass++; console.log("  ok  " + label); }
  else { fail++; const m = label + (detail ? " — " + detail : ""); failures.push(m); console.log("  FAIL  " + m); }
}

async function run() {
  {
    const inp = "---\ntype: map\n---\nbody\n";
    const out = _injectProjectNameFrontmatter(inp, "Denali");
    ok("PNC-1.insert", out.includes('project_name: "Denali"') && out !== inp, out);
  }
  {
    const out = _injectProjectNameFrontmatter('---\ntype: map\nproject_name: "Project"\n---\nbody\n', "Denali");
    ok("PNC-2.repair", out.includes('project_name: "Denali"') && !out.includes('"Project"'), out);
  }
  {
    const inp = '---\ntype: map\nproject_name: "Denali"\n---\nbody\n';
    ok("PNC-3.idempotent", _injectProjectNameFrontmatter(inp, "Denali") === inp);
  }
  {
    // v0.217.0 expanded the target-type whitelist to cover most
    // project-scoped types (doc-note among them) — use a genuinely
    // non-project type to exercise the no-op path.
    const inp = "---\ntype: meeting\n---\nbody\n";
    ok("PNC-4.noop-nontarget", _injectProjectNameFrontmatter(inp, "Denali") === inp);
  }
  {
    const ad = makeAdapter({ "spice/projects/cw/Project.md": '---\ntype: project\nname: "Claude CoWork"\n---\n' });
    const name = await _resolveProjectDisplayName(ad, "spice/projects/cw", ["spice/projects/cw/Project.md"]);
    ok("PNC-5.prefers-name", name === "Claude CoWork", "got: " + name);
  }
  {
    const ad = makeAdapter({ "spice/projects/sauce/Sauce.md": "---\ntype: project\n---\n" });
    const name = await _resolveProjectDisplayName(ad, "spice/projects/sauce", ["spice/projects/sauce/Sauce.md"]);
    ok("PNC-6.fallback-basename", name === "Sauce", "got: " + name);
  }

  console.log("");
  if (fail === 0) { console.log("PASS " + pass + "/" + (pass + fail)); process.exit(0); }
  else { console.log("FAIL " + fail + "/" + (pass + fail)); for (const f of failures) console.log("  - " + f); process.exit(1); }
}
run().catch(e => { console.error("UNCAUGHT: " + (e && e.stack ? e.stack : String(e))); process.exit(2); });
