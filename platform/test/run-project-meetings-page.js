#!/usr/bin/env node
"use strict";

// run-project-meetings-page.js — behavioral harness for the per-project
// Meetings page (project-scoped meetings list).
//
// The bug this page fixes: the project dashboard's Meetings tile counted
// project-scoped meetings but navigated to the GLOBAL spice/meetings/Meetings.md
// browse page (all meetings, every project). The fix ships a per-project
// `spice/projects/<slug>/Meetings.md` note rendering ProjectMeetingsList (a
// project-filtered, month-grouped list), scaffolded for new projects via
// entity-create extra_files[] and for existing projects via
// applyProjectMeetingsPageBackfill in install.js.
//
// Coverage (HC-PMP-*):
//   REF-*    — ProjectMeetingsList._projectRef: current-page → {path, name}.
//   MATCH-*  — ProjectMeetingsList._matches: meeting `project:` field shapes.
//   RENDER-* — render() filters to the current project; renders nothing on a
//              page with no project ref; never throws; embed no-op.
//   BF-*     — applyProjectMeetingsPageBackfill mirrors the Links Hub backfill:
//              create / idempotent / never-overwrite / no-atlas skip / absent
//              root / sibling skip / DRIFT GUARD vs the manifest extra_files
//              scaffold for NEW projects.
//   CHROME-* — navTarget("meetings") existence gate, project-meetings context
//              (both detectContext copies), leaf surface spec, dashboard tile
//              routed through navTarget, go-meetings command, breadcrumb
//              contribution, manifest wiring.
//
// Verdict: "PASS N/N" exit 0, "FAIL X/N" exit 1, fatal exit 2.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

function loadClass(rel, name) {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  return new Function(`${src}\nreturn ${name};`)();
}

let pass = 0, fail = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; const m = `${label}${detail ? " — " + detail : ""}`; failures.push(m); console.log(`  FAIL  ${m}`); }
}

// ---------------------------------------------------------------------------
// Load surfaces under test
// ---------------------------------------------------------------------------
let ProjectMeetingsList = null;
try {
  ProjectMeetingsList = loadClass(
    "platform/blueprints/project/helpers/project-meetings-list.js",
    "ProjectMeetingsList"
  );
} catch (e) {
  console.error("FATAL: project-meetings-list.js failed to load:", e.message);
  process.exit(2);
}

const install = require(path.join(ROOT, "platform", "install.js"));
const {
  applyProjectMeetingsPageBackfill,
  _renderProjectMeetingsNote,
  _projectMeetingsBody,
} = install;
for (const [name, fn] of [
  ["applyProjectMeetingsPageBackfill", applyProjectMeetingsPageBackfill],
  ["_renderProjectMeetingsNote", _renderProjectMeetingsNote],
  ["_projectMeetingsBody", _projectMeetingsBody],
]) {
  if (typeof fn !== "function") {
    console.error(`FATAL: ${name} not exported from install.js`);
    process.exit(2);
  }
}

const manifest = JSON.parse(fs.readFileSync(
  path.join(ROOT, "platform", "blueprints", "project", "manifest.json"), "utf8"));

// ---------------------------------------------------------------------------
// PMP-REF — _projectRef(page)
// ---------------------------------------------------------------------------
{
  const ref = ProjectMeetingsList._projectRef({
    project: { path: "spice/projects/obs/Observability.md", display: "Observability" },
  });
  ok("PMP-REF-1 Link object → {path, name}",
    ref && ref.path === "spice/projects/obs/Observability.md" && ref.name === "Observability");
}
{
  const ref = ProjectMeetingsList._projectRef({ project: { path: "spice/projects/obs/Observability.md" } });
  ok("PMP-REF-2 Link without display → name from path basename",
    ref && ref.name === "Observability");
}
{
  const ref = ProjectMeetingsList._projectRef({ project: "[[Observability]]" });
  ok("PMP-REF-3 wikilink string → name, null path",
    ref && ref.name === "Observability" && !ref.path);
}
{
  const ref = ProjectMeetingsList._projectRef({ project: "[[Observability|Obs]]" });
  ok("PMP-REF-4 aliased wikilink → link TARGET, not alias",
    ref && ref.name === "Observability");
}
{
  const ref = ProjectMeetingsList._projectRef({ project_name: "Observability" });
  ok("PMP-REF-5 project_name fallback when project field absent",
    ref && ref.name === "Observability");
}
{
  let threw = false; let a, b;
  try {
    a = ProjectMeetingsList._projectRef({});
    b = ProjectMeetingsList._projectRef(null);
  } catch (_e) { threw = true; }
  ok("PMP-REF-6 no project identity → null, no throw", !threw && a === null && b === null);
}

// ---------------------------------------------------------------------------
// PMP-MATCH — _matches(field, ref)
// ---------------------------------------------------------------------------
{
  const ref = { path: "spice/projects/obs/Observability.md", name: "Observability" };
  ok("PMP-MATCH-1 string [[Name]]",
    ProjectMeetingsList._matches("[[Observability]]", ref) === true);
  ok("PMP-MATCH-2 string [[Name|alias]]",
    ProjectMeetingsList._matches("[[Observability|obs sync]]", ref) === true);
  ok("PMP-MATCH-3 bare string name",
    ProjectMeetingsList._matches("Observability", ref) === true);
  ok("PMP-MATCH-4 Link object path",
    ProjectMeetingsList._matches({ path: "spice/projects/obs/Observability.md" }, ref) === true);
  ok("PMP-MATCH-5 Link object display",
    ProjectMeetingsList._matches({ display: "Observability" }, ref) === true);
  ok("PMP-MATCH-6 other project → false",
    ProjectMeetingsList._matches("[[Other Project]]", ref) === false);
  let threw = false; let r;
  try { r = ProjectMeetingsList._matches(null, ref); } catch (_e) { threw = true; }
  ok("PMP-MATCH-7 empty field → false, no throw", !threw && r === false);
}

// ---------------------------------------------------------------------------
// PMP-RENDER — render() against stub dv + customJS
// ---------------------------------------------------------------------------
function makeEl() {
  const el = {
    children: [],
    style: {},
    textContent: "",
    createEl(tag, opts) {
      const c = makeEl();
      if (opts && opts.text != null) c.textContent = String(opts.text);
      this.children.push(c);
      return c;
    },
    setAttribute() {},
    classList: { add() {} },
    closest() { return null; },
    querySelector() { return null; },
  };
  return el;
}

function chain(items) {
  return {
    where(fn) { return chain(items.filter(fn)); },
    array() { return items.slice(); },
    get length() { return items.length; },
    [Symbol.iterator]: function* () { yield* items; },
  };
}

const MEETINGS = [
  { type: "meeting", date: "2026-09-01", project: "[[Observability]]",
    file: { name: "2026-09-01 Obs sync", path: "spice/meetings/notes/2026/09-September/2026-09-01 Obs sync.md" } },
  { type: "meeting", date: "2026-08-15", project: { path: "spice/projects/obs/Observability.md", display: "Observability" },
    file: { name: "2026-08-15 Obs review", path: "spice/meetings/notes/2026/08-August/2026-08-15 Obs review.md" } },
  { type: "meeting", date: "2026-09-02", project: "[[Other Project]]",
    file: { name: "2026-09-02 Other standup", path: "spice/meetings/notes/2026/09-September/2026-09-02 Other standup.md" } },
];

function makeDv(page, meetings) {
  return {
    container: makeEl(),
    current() { return page; },
    pages(q) {
      if (String(q).includes("spice/meetings/notes")) return chain(meetings || []);
      if (String(q).includes("spice/tasks")) return chain([]);
      return chain([]);
    },
  };
}

async function withCustomJS(stub, fn) {
  const prev = globalThis.customJS;
  globalThis.customJS = stub;
  try { return await fn(); } finally {
    if (prev === undefined) delete globalThis.customJS;
    else globalThis.customJS = prev;
  }
}

function makeCustomJSStub(calls) {
  return {
    RenderSafe: { page: (dv) => dv.current() },
    SectionLabel: { render: (dv, opts) => calls.labels.push(opts && opts.text) },
    BeaconCards: { render: async (dv, opts) => calls.cards.push(opts.pages.map(p => p.file.name)) },
  };
}

(async () => {
  // RENDER-1 — project page renders ONLY this project's meetings, newest month first.
  {
    const calls = { labels: [], cards: [] };
    const page = {
      type: "project-meetings",
      project: { path: "spice/projects/obs/Observability.md", display: "Observability" },
      project_name: "Observability",
      file: { name: "Meetings", path: "spice/projects/obs/Meetings.md" },
    };
    const dv = makeDv(page, MEETINGS);
    await withCustomJS(makeCustomJSStub(calls), () => new ProjectMeetingsList().render(dv));
    const rendered = calls.cards.flat();
    ok("PMP-RENDER-1a only this project's meetings rendered",
      rendered.length === 2
      && rendered.includes("2026-09-01 Obs sync")
      && rendered.includes("2026-08-15 Obs review")
      && !rendered.includes("2026-09-02 Other standup"),
      `rendered=${JSON.stringify(rendered)}`);
    ok("PMP-RENDER-1b month labels newest-first",
      calls.labels.length === 2
      && calls.labels[0] === "September 2026" && calls.labels[1] === "August 2026",
      `labels=${JSON.stringify(calls.labels)}`);
  }

  // RENDER-2 — page with no project identity renders NOTHING.
  {
    const calls = { labels: [], cards: [] };
    const page = { file: { name: "Meetings", path: "spice/projects/obs/Meetings.md" } };
    const dv = makeDv(page, MEETINGS);
    await withCustomJS(makeCustomJSStub(calls), () => new ProjectMeetingsList().render(dv));
    ok("PMP-RENDER-2 no project ref → renders nothing",
      calls.labels.length === 0 && calls.cards.length === 0);
  }

  // RENDER-3 — zero matching meetings renders NOTHING (empty = nothing rule).
  {
    const calls = { labels: [], cards: [] };
    const page = {
      project: "[[Lonely Project]]", project_name: "Lonely Project",
      file: { name: "Meetings", path: "spice/projects/lonely/Meetings.md" },
    };
    const dv = makeDv(page, MEETINGS);
    await withCustomJS(makeCustomJSStub(calls), () => new ProjectMeetingsList().render(dv));
    ok("PMP-RENDER-3 zero matches → renders nothing",
      calls.labels.length === 0 && calls.cards.length === 0);
  }

  // RENDER-4 — throwing dv.current never escapes.
  {
    let threw = false;
    const dv = makeDv(null, MEETINGS);
    dv.current = () => { throw new Error("cold"); };
    try {
      await withCustomJS({ RenderSafe: { page: (d) => d.current() } },
        () => new ProjectMeetingsList().render(dv));
    } catch (_e) { threw = true; }
    ok("PMP-RENDER-4 cold-load throw contained", !threw);
  }

  // RENDER-5 — embedded context is a no-op.
  {
    const calls = { labels: [], cards: [] };
    const page = {
      project: "[[Observability]]",
      file: { name: "Meetings", path: "spice/projects/obs/Meetings.md" },
    };
    const dv = makeDv(page, MEETINGS);
    dv.container.closest = () => ({});
    await withCustomJS(makeCustomJSStub(calls), () => new ProjectMeetingsList().render(dv));
    ok("PMP-RENDER-5 markdown-embed → no-op",
      calls.labels.length === 0 && calls.cards.length === 0);
  }

  // -------------------------------------------------------------------------
  // PMP-BF — applyProjectMeetingsPageBackfill
  // -------------------------------------------------------------------------
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
      get _writes() { return writes; },
    };
  }
  const makeTp = (adapter) => ({ app: { vault: { adapter } } });
  const GIT = { commit: null, tag: null, dirty: null };
  const HUB = [
    "---", "type: project", "project_name: Demo Project", "---", "", "# Demo Project", "",
  ].join("\n");

  // BF-A — created with right frontmatter + body + history entry.
  {
    const adapter = makeAdapter({ "spice/projects/demo/Demo Project.md": HUB });
    const history = [];
    await applyProjectMeetingsPageBackfill(makeTp(adapter), {}, {}, history, GIT);
    const got = adapter._files.get("spice/projects/demo/Meetings.md");
    ok("PMP-BF-A1 Meetings.md created", typeof got === "string");
    ok("PMP-BF-A2 type: project-meetings", /^type:\s*project-meetings\s*$/m.test(got || ""));
    ok("PMP-BF-A3 project wikilink", (got || "").includes('project: "[[Demo Project]]"'));
    ok("PMP-BF-A4 project_slug", /^project_slug:\s*demo\s*$/m.test(got || ""));
    ok("PMP-BF-A5 body renders ProjectMeetingsList",
      (got || "").includes('class: "ProjectMeetingsList"'));
    ok("PMP-BF-A6 body leads with ProjectChromeBar",
      (got || "").includes('class: "ProjectChromeBar"'));
    ok("PMP-BF-A7 created history entry",
      history.some(h => h.step === "project_meetings_page_backfill" && h.action === "created"));
  }

  // BF-B — idempotent second pass: no new writes, byte-identical.
  {
    const adapter = makeAdapter({ "spice/projects/demo/Demo Project.md": HUB });
    await applyProjectMeetingsPageBackfill(makeTp(adapter), {}, {}, [], GIT);
    const first = adapter._files.get("spice/projects/demo/Meetings.md");
    const writesAfterFirst = adapter._writes;
    await applyProjectMeetingsPageBackfill(makeTp(adapter), {}, {}, [], GIT);
    ok("PMP-BF-B idempotent (no rewrite, byte-identical)",
      adapter._writes === writesAfterFirst
      && adapter._files.get("spice/projects/demo/Meetings.md") === first);
  }

  // BF-C — pre-existing Meetings.md never overwritten.
  {
    const user = "---\ntype: project-meetings\n---\nMY CONTENT\n";
    const adapter = makeAdapter({
      "spice/projects/demo/Demo Project.md": HUB,
      "spice/projects/demo/Meetings.md": user,
    });
    await applyProjectMeetingsPageBackfill(makeTp(adapter), {}, {}, [], GIT);
    ok("PMP-BF-C user content preserved",
      adapter._files.get("spice/projects/demo/Meetings.md") === user);
  }

  // BF-D — no type:project hub in dir → nothing created.
  {
    const adapter = makeAdapter({ "spice/projects/random/notes.md": "just a note\n" });
    await applyProjectMeetingsPageBackfill(makeTp(adapter), {}, {}, [], GIT);
    ok("PMP-BF-D dir without an atlas skipped",
      !adapter._files.has("spice/projects/random/Meetings.md"));
  }

  // BF-E — absent spice/projects/ → no throw, no writes.
  {
    const adapter = makeAdapter({});
    let threw = false;
    try { await applyProjectMeetingsPageBackfill(makeTp(adapter), {}, {}, [], GIT); }
    catch (_e) { threw = true; }
    ok("PMP-BF-E absent projects root is a no-op", !threw && adapter._writes === 0);
  }

  // BF-F — sibling To-Do / Map / board / Links Hub notes are skipped in hub detection.
  {
    const adapter = makeAdapter({
      "spice/projects/demo/Demo Project To-Do.md": "---\ntype: project-todo\n---\n",
      "spice/projects/demo/Project Map.md": "---\ntype: map\n---\n",
      "spice/projects/demo/demo-board.md": "---\ntype: kanban\n---\n",
      "spice/projects/demo/Links Hub.md": "---\ntype: links-hub\n---\n",
      "spice/projects/demo/Demo Project.md": HUB,
    });
    await applyProjectMeetingsPageBackfill(makeTp(adapter), {}, {}, [], GIT);
    const got = adapter._files.get("spice/projects/demo/Meetings.md") || "";
    ok("PMP-BF-F hub detection lands on the atlas note",
      got.includes('project: "[[Demo Project]]"'));
  }

  // BF-G — DRIFT GUARD: backfilled note ≡ entity-create scaffold for NEW projects.
  {
    const projBtn = (manifest.new_entity_buttons || []).find(b => b.id === "project");
    const efEntry = projBtn && (projBtn.extra_files || []).find(e => e.filename_pattern === "Meetings.md");
    ok("PMP-BF-G1 manifest extra_files has Meetings.md entry", !!efEntry);
    const fmT = (efEntry && efEntry.frontmatter_template) || {};
    ok("PMP-BF-G2 manifest frontmatter type",
      fmT.type === "project-meetings");
    const note = _renderProjectMeetingsNote({
      name: "Demo Project", slug: "demo", viewsPath: "ranch/views", nowIso: "2026-01-01T00:00:00Z",
    });
    ok("PMP-BF-G3 backfilled body ≡ manifest inline_body",
      typeof efEntry?.inline_body === "string"
      && note.endsWith("\n" + efEntry.inline_body.replace(/\n$/, "") + "\n")
      && _projectMeetingsBody("ranch/views") === efEntry.inline_body,
      "backfill body and entity-create inline_body diverged");
    const fmKeys = Object.keys(fmT);
    const noteFm = (note.match(/^---\n([\s\S]*?)\n---/) || [])[1] || "";
    ok("PMP-BF-G4 backfilled frontmatter carries every manifest field",
      fmKeys.length > 0 && fmKeys.every(k => new RegExp(`^${k}:`, "m").test(noteFm)),
      `keys=${fmKeys.join(",")} fm=${JSON.stringify(noteFm)}`);
  }

  // -------------------------------------------------------------------------
  // PMP-CHROME — navigation wiring
  // -------------------------------------------------------------------------
  const chromeSrc = fs.readFileSync(path.join(ROOT,
    "platform/blueprints/project/helpers/project-chrome-bar.js"), "utf8");
  const navBtnSrc = fs.readFileSync(path.join(ROOT,
    "platform/blueprints/project/helpers/project-nav-buttons.js"), "utf8");
  const dashSrc = fs.readFileSync(path.join(ROOT,
    "platform/blueprints/project/helpers/project-dashboard.js"), "utf8");
  const cmdSrc = fs.readFileSync(path.join(ROOT,
    "platform/blueprints/project/helpers/project-commands-init.js"), "utf8");

  ok("PMP-CHROME-1 chrome bar detects project-meetings context",
    chromeSrc.includes('"project-meetings"'));
  ok("PMP-CHROME-2 nav-buttons detectContext copy kept in sync",
    navBtnSrc.includes('"project-meetings"'));
  ok("PMP-CHROME-3 dashboard Meetings tile routes through navTarget (noNav dropped)",
    !/key:\s*"meetings"[^\n]*noNav/.test(dashSrc)
    && /key:\s*"meetings"[^\n]*fallback:\s*"spice\/meetings\/Meetings\.md"/.test(dashSrc));
  ok("PMP-CHROME-4 go-meetings command registered",
    cmdSrc.includes('"sauce-project:go-meetings"') && /arg:\s*"meetings"/.test(cmdSrc));

  // Behavioral: navTarget("meetings") existence gate + leaf surface spec.
  {
    const ProjectChromeBar = loadClass(
      "platform/blueprints/project/helpers/project-chrome-bar.js", "ProjectChromeBar");
    const prevApp = globalThis.app;
    globalThis.app = {
      vault: { getAbstractFileByPath: (p) => (p === "spice/projects/obs/Meetings.md" ? {} : null) },
      metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    };
    try {
      const bar = new ProjectChromeBar();
      const ctx = { projectDir: "spice/projects/obs", projectSlug: "obs" };
      ok("PMP-CHROME-5 navTarget meetings → per-project page when it exists",
        bar.navTarget({}, ctx, "meetings") === "spice/projects/obs/Meetings.md");
      const ctx2 = { projectDir: "spice/projects/none", projectSlug: "none" };
      ok("PMP-CHROME-6 navTarget meetings → null when the page is missing",
        bar.navTarget({}, ctx2, "meetings") === null);
      const spec = bar._surfaceSpec("project-meetings");
      ok("PMP-CHROME-7 project-meetings surface is a leaf",
        spec && spec.leaf === true && spec.primary === null);

      // Behavioral detectContext — Meetings.md directly under the project dir.
      const prevCJS = globalThis.customJS;
      globalThis.customJS = { RenderSafe: { page: () => ({ file: { name: "Meetings" }, type: "project-meetings" }) } };
      try {
        const ctx3 = bar.detectContext("spice/projects/obs/Meetings.md", {});
        ok("PMP-CHROME-8 detectContext classifies the per-project Meetings page",
          ctx3 && ctx3.context === "project-meetings" && ctx3.projectDir === "spice/projects/obs");
      } finally {
        if (prevCJS === undefined) delete globalThis.customJS; else globalThis.customJS = prevCJS;
      }
    } finally {
      if (prevApp === undefined) delete globalThis.app; else globalThis.app = prevApp;
    }
  }

  // Manifest wiring.
  ok("PMP-CHROME-9 customjs_classes registers ProjectMeetingsList",
    (manifest.customjs_classes || []).includes("ProjectMeetingsList"));
  ok("PMP-CHROME-10 files[] materializes the helper",
    (manifest.files || []).some(f =>
      f.source === "helpers/project-meetings-list.js"
      && f.dest === "{{scripts_path}}/project/project-meetings-list.js"));
  {
    const bc = manifest.breadcrumb && manifest.breadcrumb.types
      && manifest.breadcrumb.types["project-meetings"];
    ok("PMP-CHROME-11 breadcrumb contribution for project-meetings",
      !!bc && JSON.stringify(bc).includes("lit:Meetings"));
  }

  // -------------------------------------------------------------------------
  console.log(failures.length ? `\nFAIL ${fail}/${pass + fail}` : `\nPASS ${pass}/${pass + fail}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error("FATAL:", e && e.stack || e);
  process.exit(2);
});
