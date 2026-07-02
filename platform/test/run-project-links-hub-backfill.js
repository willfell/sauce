#!/usr/bin/env node
// run-project-links-hub-backfill.js — Project Links Wiring PR3 behavioral
// harness for applyProjectLinksHubBackfill in platform/install.js.
//
// Zero-dep. Requires install.js (side-effect-safe: install.js guards its CLI
// entry on require.main === module), pulls applyProjectLinksHubBackfill +
// _renderLinksHubNote + _linksHubBody off module.exports, and exercises the
// heal against an in-memory adapter stub (mirrors run-v0127-project-hub-heal.js).
//
// Coverage (HC-PLHB-*):
//   A — project dir with a type:project hub + no Links Hub.md → Links Hub.md
//       created with the right frontmatter + body; a "created" history entry.
//   B — idempotent: a second pass creates nothing new + the note is byte-identical.
//   C — a pre-existing Links Hub.md (user content) is NEVER overwritten.
//   D — a project dir with NO type:project hub note → no Links Hub.md created.
//   E — empty / absent spice/projects/ → no throw, no writes.
//   F — hub-detection skips To-Do/Map/board sibling notes (uses the true hub).
//   G — DRIFT GUARD: the backfilled body is byte-identical to the project
//       blueprint's entity-create scaffold for a NEW project's Links Hub.md
//       (manifest new_entity_buttons[].extra_files[] filename_pattern
//       "Links Hub.md" inline_body), and the frontmatter carries the same
//       static fields — so new + backfilled hubs can never silently diverge.
//
// Verdict: "PASS N/N" exit 0, "FAIL X/N" exit 1, fatal exit 2.

"use strict";

const path = require("path");
const fs = require("fs");

const install = require(path.join(__dirname, "..", "install.js"));
const { applyProjectLinksHubBackfill, _renderLinksHubNote, _linksHubBody } = install;

for (const [name, fn] of [
  ["applyProjectLinksHubBackfill", applyProjectLinksHubBackfill],
  ["_renderLinksHubNote", _renderLinksHubNote],
  ["_linksHubBody", _linksHubBody],
]) {
  if (typeof fn !== "function") {
    console.error(`FATAL: ${name} not exported from install.js`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// In-memory adapter stub (subset of FileSystemAdapter used by the heal):
// exists, list, read, write, mkdir. write() tracks a call count so the
// idempotency case can assert no redundant writes.
// ---------------------------------------------------------------------------
function makeAdapter(initial) {
  const files = new Map(Object.entries(initial || {}));
  const dirs = new Set();
  for (const p of files.keys()) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  let writes = 0;
  return {
    async exists(p) { return files.has(p) || dirs.has(p); },
    async list(p) {
      const folders = [];
      const filesAt = [];
      for (const d of dirs) {
        if (d === p) continue;
        if (d.startsWith(p + "/") && d.indexOf("/", p.length + 1) === -1) folders.push(d);
      }
      for (const f of files.keys()) {
        if (f.startsWith(p + "/") && f.indexOf("/", p.length + 1) === -1) filesAt.push(f);
      }
      return { folders, files: filesAt };
    },
    async read(p) {
      if (!files.has(p)) throw new Error("ENOENT: " + p);
      return files.get(p);
    },
    async write(p, body) {
      writes++;
      files.set(p, body);
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    },
    async mkdir(p) { dirs.add(p); },
    _files: files,
    _dirs: dirs,
    get _writes() { return writes; },
  };
}

const makeTp = (adapter) => ({ app: { vault: { adapter } } });

const HUB = `---
type: project
name: Demo Project
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });
\`\`\`
`;

const GIT = { commit: null, tag: null, dirty: null };

// ---------------------------------------------------------------------------
let pass = 0, fail = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; const m = `${label}${detail ? " — " + detail : ""}`; failures.push(m); console.log(`  FAIL  ${m}`); }
}

async function run() {
  // Case A — hub present, no Links Hub.md → created with right FM + body + history.
  {
    const adapter = makeAdapter({ "spice/projects/demo/Demo Project.md": HUB });
    const history = [];
    await applyProjectLinksHubBackfill(makeTp(adapter), {}, {}, history, GIT);
    const p = "spice/projects/demo/Links Hub.md";
    const got = adapter._files.get(p);
    ok("HC-PLHB-A.created", typeof got === "string", "Links Hub.md not created");
    ok("HC-PLHB-A.type", /^type:\s*links-hub\s*$/m.test(got || ""), "missing type: links-hub");
    ok("HC-PLHB-A.project-wikilink", (got || "").includes('project: "[[Demo Project]]"'),
      "project wikilink must use the hub basename (display name)");
    ok("HC-PLHB-A.slug", /^project_slug:\s*demo\s*$/m.test(got || ""), "project_slug must be the dir basename");
    ok("HC-PLHB-A.empty-links", /^links:\s*\[\]\s*$/m.test(got || ""), "links must default to []");
    ok("HC-PLHB-A.tag", /- links-hub\s*$/m.test(got || ""), "missing links-hub tag");
    ok("HC-PLHB-A.panel", (got || "").includes('class: "ProjectLinksPanel"'), "missing ProjectLinksPanel block");
    ok("HC-PLHB-A.nav", (got || "").includes('class: "ProjectNavButtons"') && (got || "").includes('class: "SpaceNavButtons"') && (got || "").includes('class: "Breadcrumb"'),
      "missing the standard chrome blocks");
    ok("HC-PLHB-A.history-created",
      history.some((h) => h.step === "project_links_hub_backfill" && h.action === "created" && h.path === p),
      "no created history entry");
  }

  // Case B — idempotent: a second pass writes nothing new and leaves the note identical.
  {
    const adapter = makeAdapter({ "spice/projects/demo/Demo Project.md": HUB });
    await applyProjectLinksHubBackfill(makeTp(adapter), {}, {}, [], GIT);
    const afterFirst = adapter._files.get("spice/projects/demo/Links Hub.md");
    const writesAfterFirst = adapter._writes;
    const history2 = [];
    await applyProjectLinksHubBackfill(makeTp(adapter), {}, {}, history2, GIT);
    const afterSecond = adapter._files.get("spice/projects/demo/Links Hub.md");
    ok("HC-PLHB-B.byte-identical", afterFirst === afterSecond, "second pass changed the note");
    ok("HC-PLHB-B.no-extra-write", adapter._writes === writesAfterFirst, "second pass wrote again (not skip-if-exists)");
    ok("HC-PLHB-B.summary-skipped",
      history2.some((h) => h.step === "project_links_hub_backfill" && h.summary && h.summary.skipped >= 1 && h.summary.created === 0),
      "second pass should record skipped>=1, created=0");
  }

  // Case C — a pre-existing Links Hub.md (user content) is never overwritten.
  {
    const userBody = "---\ntype: links-hub\nlinks:\n  - https://example.com\n---\n\nmy own notes\n";
    const adapter = makeAdapter({
      "spice/projects/demo/Demo Project.md": HUB,
      "spice/projects/demo/Links Hub.md": userBody,
    });
    await applyProjectLinksHubBackfill(makeTp(adapter), {}, {}, [], GIT);
    ok("HC-PLHB-C.preserved", adapter._files.get("spice/projects/demo/Links Hub.md") === userBody,
      "existing Links Hub.md was overwritten");
  }

  // Case D — no type:project hub note under the dir → no Links Hub.md created.
  {
    const adapter = makeAdapter({
      "spice/projects/orphan/Orphan To-Do.md": "---\ntype: project-todo\n---\n",
    });
    await applyProjectLinksHubBackfill(makeTp(adapter), {}, {}, [], GIT);
    ok("HC-PLHB-D.no-create", !adapter._files.has("spice/projects/orphan/Links Hub.md"),
      "Links Hub.md created for a dir with no project hub");
  }

  // Case D2 — hub detection is by frontmatter TYPE, not filename. A dir whose
  // only direct note has a NON-excluded filename but is NOT type:project (a doc
  // note) must NOT yield a Links Hub. This pins the `type: project` check: an
  // `if (true)` mutation of it would treat Readme.md as the hub and create a
  // bogus `project: "[[Readme]]"` hub — this case fails red on that mutation.
  {
    const adapter = makeAdapter({
      "spice/projects/docsonly/Readme.md": "---\ntype: doc-note\n---\n\njust a doc\n",
    });
    await applyProjectLinksHubBackfill(makeTp(adapter), {}, {}, [], GIT);
    ok("HC-PLHB-D2.type-gated", !adapter._files.has("spice/projects/docsonly/Links Hub.md"),
      "a non-project note with a non-excluded filename must not be treated as the hub");
  }

  // Case E — empty spice/projects (and absent root) run without throwing.
  {
    let threw = false;
    try { await applyProjectLinksHubBackfill(makeTp(makeAdapter({})), {}, {}, [], GIT); }
    catch (_e) { threw = true; }
    ok("HC-PLHB-E.no-throw", !threw, "empty/absent spice/projects threw");
  }

  // Case F — hub detection skips To-Do/Map/board siblings and uses the real hub.
  {
    const adapter = makeAdapter({
      "spice/projects/multi/Multi.md": HUB.replace("Demo Project", "Multi"),
      "spice/projects/multi/Multi To-Do.md": "---\ntype: project-todo\n---\n",
      "spice/projects/multi/Project Map.md": "---\ntype: map\n---\n",
      "spice/projects/multi/multi-board.md": "---\ntype: kanban\n---\n",
    });
    await applyProjectLinksHubBackfill(makeTp(adapter), {}, {}, [], GIT);
    const got = adapter._files.get("spice/projects/multi/Links Hub.md");
    ok("HC-PLHB-F.uses-hub", typeof got === "string" && got.includes('project: "[[Multi]]"'),
      "must resolve the hub note (Multi.md), not a To-Do/Map/board sibling");
  }

  // Case G — DRIFT GUARD: backfilled body == entity-create scaffold inline_body;
  // frontmatter shares the entity-create static fields.
  {
    const manifest = require(path.join(__dirname, "..", "blueprints", "project", "manifest.json"));
    // Locate the Links Hub.md entity-create scaffold anywhere under new_entity_buttons[].extra_files[].
    let scaffold = null;
    for (const btn of (manifest.new_entity_buttons || [])) {
      for (const ef of (btn.extra_files || [])) {
        if (ef.filename_pattern === "Links Hub.md") { scaffold = ef; break; }
      }
      if (scaffold) break;
    }
    ok("HC-PLHB-G.scaffold-found", !!scaffold,
      "project manifest must carry a Links Hub.md entity-create scaffold");
    if (scaffold) {
      const bodyDefault = _linksHubBody();               // default views_path == ranch/views
      ok("HC-PLHB-G.body-parity", bodyDefault === scaffold.inline_body,
        "backfill body must be byte-identical to the entity-create inline_body");
      const fm = scaffold.frontmatter_template || {};
      ok("HC-PLHB-G.fm-type", fm.type === "links-hub", "scaffold type must be links-hub");
      ok("HC-PLHB-G.fm-links-empty", Array.isArray(fm.links) && fm.links.length === 0, "scaffold links must be []");
      ok("HC-PLHB-G.fm-tag", Array.isArray(fm.tags) && fm.tags.includes("links-hub"), "scaffold tags must include links-hub");
      // The rendered note must satisfy the same static-field contract.
      const note = _renderLinksHubNote({ name: "X", slug: "x", nowIso: "2026-07-01T00:00:00Z" });
      ok("HC-PLHB-G.render-type", /^type:\s*links-hub\s*$/m.test(note), "rendered note missing type: links-hub");
      ok("HC-PLHB-G.render-links", /^links:\s*\[\]\s*$/m.test(note), "rendered note missing links: []");
      ok("HC-PLHB-G.render-tag", /- links-hub\s*$/m.test(note), "rendered note missing links-hub tag");
    }
  }

  // Sanity: the source template file the card references also matches the scaffold body.
  {
    const tplPath = path.join(__dirname, "..", "blueprints", "project", "templates", "Links Hub.md");
    let tpl = null;
    try { tpl = fs.readFileSync(tplPath, "utf8"); } catch (_e) { /* ok */ }
    ok("HC-PLHB-H.template-has-panel", !!tpl && tpl.includes('class: "ProjectLinksPanel"'),
      "templates/Links Hub.md must render ProjectLinksPanel");
  }

  console.log("");
  if (fail === 0) { console.log(`PASS ${pass}/${pass + fail}`); process.exit(0); }
  console.log(`FAIL ${fail}/${pass + fail}`);
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}

run().catch((e) => {
  console.error("UNCAUGHT: " + (e && e.stack ? e.stack : String(e)));
  process.exit(2);
});
