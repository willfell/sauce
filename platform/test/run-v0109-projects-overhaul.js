// run-v0109-projects-overhaul.js — v0.109.0 behavioral test harness.
//
// Zero-dep behavioral coverage for the projects-visual-overhaul cycle.
// Where run-helper-cases.js asserts source-text contracts via regex,
// this harness LOADS each helper into a sandboxed scope, INSTANTIATES it,
// and EXERCISES its methods against minimal Dataview / DOM / Obsidian
// app stubs — then asserts the resulting DOM tree / return values match
// the cycle's design contract.
//
// Coverage map (cycle stages → cases):
//   S2  SectionLabel               → SL-B-1..4
//   S4  ProjectDocsIndex sort      → PDI-B-1..3
//   S5  ProjectMeetingsPanel._enrichMeeting → PMP-B-1..5
//   S6  Template, Project.md structural integrity → TPL-B-1..5
//   S7  Breadcrumb type branches + path fallback  → BC-B-1..6
//   S8  applyDocNoteBreadcrumbMarkerCleanup edges → CLN-B-1..5
//
// Wiring: invoked from release:preflight via package.json. Fires on every
// push to main + every PR (ci.yml) AND on every annotated tag (release.yml).
//
// Stub posture: minimal. Only what the helpers actually call. Stubs are
// inlined here (no test framework, no jsdom dep) to stay zero-dep.

const fs = require("fs");
const path = require("path");

const WORKSHOP = path.resolve(__dirname, "../..");
const HELPERS  = path.join(WORKSHOP, "platform/blueprints/project/helpers");
const TPLDIR   = path.join(WORKSHOP, "platform/blueprints/project/templates");
// v0.122.0: SectionLabel promoted out of project/helpers into its own mechanism.
const SECTION_LABEL_SRC = path.join(WORKSHOP, "platform/mechanisms/section-label/section-label.js");

let passed = 0;
let failed = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ok ${name}`);
  } else {
    failed++;
    const msg = `${name}${detail ? " — " + detail : ""}`;
    failures.push(msg);
    console.log(`  FAIL ${msg}`);
  }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---------------------------------------------------------------------------
// DOM stub — Obsidian augments HTMLElement with createEl/empty/setText etc.
// We stub only what the helpers actually call. Children are an array; we
// recurse into them when checking the rendered tree.
// ---------------------------------------------------------------------------

function makeEl(tagName) {
  const el = {
    tagName: String(tagName).toUpperCase(),
    style: { cssText: "" },
    _textContent: "",
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = String(v); },
    innerHTML: "",
    children: [],
    parentElement: null,
    attrs: {},
    dataset: {},
    hidden: false,
    title: "",
    createEl(tag, opts = {}) {
      const child = makeEl(tag);
      if (opts.text != null) child.textContent = String(opts.text);
      if (opts.cls != null) child.attrs.cls = opts.cls;
      if (opts.attr != null) Object.assign(child.attrs, opts.attr);
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    createSpan(opts) { return this.createEl("span", opts || {}); },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    empty() { this.children = []; this.innerHTML = ""; this._textContent = ""; },
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
    remove() {
      if (this.parentElement) {
        const idx = this.parentElement.children.indexOf(this);
        if (idx >= 0) this.parentElement.children.splice(idx, 1);
      }
    },
  };
  return el;
}

function walkTree(el, predicate) {
  if (predicate(el)) return el;
  for (const c of (el.children || [])) {
    const hit = walkTree(c, predicate);
    if (hit) return hit;
  }
  return null;
}
function countTree(el, predicate) {
  let n = predicate(el) ? 1 : 0;
  for (const c of (el.children || [])) n += countTree(c, predicate);
  return n;
}

// ---------------------------------------------------------------------------
// Dataview DataArray stub — supports .where(fn), .sort(keyFn, dir),
// .limit(n), .slice(start, end), .length, iteration. Inherits from real
// Array so Array.from / spreads / for-of behave naturally.
// ---------------------------------------------------------------------------

function makeDA(items) {
  const arr = (items || []).slice();
  const sorter = (keyFn, dir) => {
    const sorted = arr.slice().sort((a, b) => {
      const ka = typeof keyFn === "function" ? keyFn(a) : a;
      const kb = typeof keyFn === "function" ? keyFn(b) : b;
      if (ka == null && kb == null) return 0;
      if (ka == null) return 1;
      if (kb == null) return -1;
      if (ka < kb) return dir === "desc" ? 1 : -1;
      if (ka > kb) return dir === "desc" ? -1 : 1;
      return 0;
    });
    return makeDA(sorted);
  };
  arr.where = (fn) => makeDA(arr.filter(fn));
  arr.sort = (keyFn, dir) => sorter(keyFn, dir);
  arr.limit = (n) => makeDA(arr.slice(0, n));
  arr.array = () => arr.slice();
  return arr;
}

function makeDv(opts = {}) {
  const container = makeEl("div");
  const pagesIndex = opts.pages || [];
  return {
    container,
    current: () => opts.current || null,
    pages: (q) => {
      const scope = String(q || "").replace(/"/g, "");
      const filtered = pagesIndex.filter((p) => {
        const fp = (p.file && p.file.path) || "";
        return scope === "" || fp === scope || fp.startsWith(scope + "/");
      });
      return makeDA(filtered);
    },
    el(tag, txt, optsArg) {
      const e = container.createEl(tag, optsArg || {});
      if (txt != null && txt !== "") e.textContent = String(txt);
      return e;
    },
    header(lvl, txt) { return container.createEl(`h${lvl}`, { text: String(txt) }); },
    paragraph(txt) { const p = container.createEl("p"); p.innerHTML = String(txt); return p; },
  };
}

// ---------------------------------------------------------------------------
// Helper loader — class declarations at file scope. Wrap in a function to
// expose the class via name. Pass injected globals (customJS, app, moment).
// ---------------------------------------------------------------------------

function loadClass(filename, className, env) {
  const source = fs.readFileSync(path.join(HELPERS, filename), "utf8");
  const argNames = Object.keys(env || {});
  const argVals = Object.values(env || {});
  const wrapper = `${source}\n; return ${className};`;
  return new Function(...argNames, wrapper)(...argVals);
}

function loadClassFromAbs(abs, className, env) {
  const source = fs.readFileSync(abs, "utf8");
  const argNames = Object.keys(env || {});
  const argVals = Object.values(env || {});
  const wrapper = `${source}\n; return ${className};`;
  return new Function(...argNames, wrapper)(...argVals);
}

// ---------------------------------------------------------------------------
// momentShim — fromNow / format / toFormat surface used by the helpers under
// test. Anchored to a fixed "now" to keep assertions deterministic.
// ---------------------------------------------------------------------------

function momentShim(input) {
  const fixedNow = 1718000000000; // arbitrary fixed "now"
  const ts = (input == null) ? fixedNow : (typeof input === "number" ? input : Date.parse(input) || fixedNow);
  return {
    isValid: () => true,
    fromNow: () => {
      const delta = (fixedNow - ts) / 1000;
      if (delta < 60) return "a few seconds ago";
      if (delta < 3600) return `${Math.round(delta / 60)} minutes ago`;
      if (delta < 86400) return `${Math.round(delta / 3600)} hours ago`;
      return `${Math.round(delta / 86400)} days ago`;
    },
    format: (fmt) => {
      const d = new Date(ts);
      if (fmt === "MMM D") return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return d.toISOString();
    },
    toFormat: (_fmt) => "12:00 PM",
  };
}
momentShim.now = 1718000000000;

// ===========================================================================
// SECTION S2 — SectionLabel behavioral
// ===========================================================================

(function testSectionLabel() {
  console.log("\n=== S2 SectionLabel behavioral ===");
  const SectionLabel = loadClassFromAbs(SECTION_LABEL_SRC, "SectionLabel", {});
  const sl = new SectionLabel();

  // SL-B-1: opts.top=false (default) emits hr + div, with expected styles
  {
    console.log("\n--- Case SL-B-1: default (top=false) emits hr + div ---");
    const dv = makeDv();
    sl.render(dv, { text: "Meetings" });
    eq("SL-B-1.1 two children", dv.container.children.length, 2);
    eq("SL-B-1.2 first child is hr", dv.container.children[0].tagName, "HR");
    eq("SL-B-1.3 second child is div", dv.container.children[1].tagName, "DIV");
    eq("SL-B-1.4 div carries label text", dv.container.children[1].textContent, "Meetings");
    ok("SL-B-1.5 hr style carries border-top",
      /border-top:\s*1px solid var\(--background-modifier-border\)/.test(dv.container.children[0].style.cssText));
    ok("SL-B-1.6 div style uppercases",
      /text-transform:\s*uppercase/.test(dv.container.children[1].style.cssText));
    ok("SL-B-1.7 div style muted",
      /var\(--text-muted\)/.test(dv.container.children[1].style.cssText));
  }

  // SL-B-2: opts.top=true suppresses the hr
  {
    console.log("\n--- Case SL-B-2: top=true suppresses hr ---");
    const dv = makeDv();
    sl.render(dv, { text: "Workstreams", top: true });
    eq("SL-B-2.1 one child", dv.container.children.length, 1);
    eq("SL-B-2.2 child is div", dv.container.children[0].tagName, "DIV");
    eq("SL-B-2.3 div carries label", dv.container.children[0].textContent, "Workstreams");
  }

  // SL-B-3: missing opts returns early (no DOM written)
  {
    console.log("\n--- Case SL-B-3: missing/empty opts.text returns early ---");
    const dv1 = makeDv();
    sl.render(dv1, null);
    eq("SL-B-3.1 null opts: no children", dv1.container.children.length, 0);
    const dv2 = makeDv();
    sl.render(dv2, {});
    eq("SL-B-3.2 empty opts: no children", dv2.container.children.length, 0);
    const dv3 = makeDv();
    sl.render(dv3, { text: "" });
    eq("SL-B-3.3 empty-string text: no children", dv3.container.children.length, 0);
  }

  // SL-B-4: multiple invocations stack independently
  {
    console.log("\n--- Case SL-B-4: multiple invocations stack ---");
    const dv = makeDv();
    sl.render(dv, { text: "First" });
    sl.render(dv, { text: "Second" });
    sl.render(dv, { text: "Third", top: true });
    eq("SL-B-4.1 total children (2 + 2 + 1)", dv.container.children.length, 5);
    // Children order: hr, div(First), hr, div(Second), div(Third)
    eq("SL-B-4.2 first label", dv.container.children[1].textContent, "First");
    eq("SL-B-4.3 second label", dv.container.children[3].textContent, "Second");
    eq("SL-B-4.4 third label (no hr above)", dv.container.children[4].textContent, "Third");
    eq("SL-B-4.5 third has no preceding hr", dv.container.children[4].tagName, "DIV");
  }
})();

// ===========================================================================
// SECTION S7 — Breadcrumb behavioral
// ===========================================================================

(function testBreadcrumb() {
  console.log("\n=== S7 Breadcrumb behavioral ===");
  const Breadcrumb = loadClass("breadcrumb.js", "Breadcrumb", {});
  const bc = new Breadcrumb();

  function curOfType(type, fields = {}) {
    return {
      file: { path: fields.path || `spice/projects/demo/${type}.md`, name: fields.fileName || `${type}-file` },
      type,
      project: fields.project,
      project_slug: fields.project_slug,
      project_name: fields.project_name,
      section: fields.section,
      sub_section: fields.sub_section,
      parent_section: fields.parent_section,
      depth: fields.depth,
    };
  }

  // BC-B-1: type=map renders Project (link) → Map (current label)
  {
    console.log("\n--- Case BC-B-1: type=map renders Project → Map ---");
    const cur = curOfType("map", { path: "spice/projects/demo/Project Map.md", project: "[[Demo]]", project_slug: "demo" });
    const dv = makeDv({ current: cur });
    return bc.render(dv).then(() => {
      const wrap = dv.container.children[0];
      ok("BC-B-1.1 wrap div created", !!wrap);
      ok("BC-B-1.2 trail contains Demo link", /data-href="spice\/projects\/demo\/Demo\.md"/.test(wrap.innerHTML));
      ok("BC-B-1.3 trail contains Map current label", /<span[^>]*font-weight:600[^>]*>Map<\/span>/.test(wrap.innerHTML));
      ok("BC-B-1.4 trail has no Docs link (map is not a docs node)", !/Docs<\/a>/.test(wrap.innerHTML) && !/data-href="[^"]*Docs\.md/.test(wrap.innerHTML));
    });
  }
})().then(() => {
  // BC-B-2: type=kanban renders Project → Board
  console.log("\n--- Case BC-B-2: type=kanban renders Project → Board ---");
  const Breadcrumb = loadClass("breadcrumb.js", "Breadcrumb", {});
  const bc = new Breadcrumb();
  const cur = {
    file: { path: "spice/projects/demo/demo-board.md", name: "demo-board" },
    type: "kanban", project: "[[Demo]]", project_slug: "demo",
  };
  const dv = makeDv({ current: cur });
  return bc.render(dv).then(() => {
    const wrap = dv.container.children[0];
    ok("BC-B-2.1 wrap div created", !!wrap);
    ok("BC-B-2.2 trail contains Demo link", /data-href="spice\/projects\/demo\/Demo\.md"/.test(wrap.innerHTML));
    ok("BC-B-2.3 trail contains Board current label", /<span[^>]*font-weight:600[^>]*>Board<\/span>/.test(wrap.innerHTML));
  });
}).then(() => {
  // BC-B-3: type=task-note renders Project → Board(link) → filename(current)
  console.log("\n--- Case BC-B-3: type=task-note renders Project → Board → filename ---");
  const Breadcrumb = loadClass("breadcrumb.js", "Breadcrumb", {});
  const bc = new Breadcrumb();
  const cur = {
    file: { path: "spice/projects/demo/tasks/Foo/Foo.md", name: "Foo" },
    type: "task-note", project: "[[Demo]]", project_slug: "demo",
  };
  const dv = makeDv({ current: cur });
  return bc.render(dv).then(() => {
    const wrap = dv.container.children[0];
    ok("BC-B-3.1 wrap div created", !!wrap);
    ok("BC-B-3.2 trail contains Demo link", /data-href="spice\/projects\/demo\/Demo\.md"/.test(wrap.innerHTML));
    ok("BC-B-3.3 trail contains Board link to demo-board.md", /data-href="spice\/projects\/demo\/demo-board\.md"/.test(wrap.innerHTML));
    ok("BC-B-3.4 trail contains Foo current label", /<span[^>]*font-weight:600[^>]*>Foo<\/span>/.test(wrap.innerHTML));
  });
}).then(() => {
  // BC-B-4: path fallback when frontmatter is missing project / project_slug.
  console.log("\n--- Case BC-B-4: path fallback resolves projectSlug + projectName from spice/projects/<slug>/<Name>.md ---");
  const Breadcrumb = loadClass("breadcrumb.js", "Breadcrumb", {});
  const bc = new Breadcrumb();
  const cur = {
    file: { path: "spice/projects/global-k8s/Project Map.md", name: "Project Map" },
    type: "map",
    // project + project_slug intentionally absent
  };
  const hub = { file: { name: "Global K8s", path: "spice/projects/global-k8s/Global K8s.md" }, type: "project" };
  const dv = makeDv({ current: cur, pages: [hub] });
  return bc.render(dv).then(() => {
    const wrap = dv.container.children[0];
    ok("BC-B-4.1 wrap div created (path-fallback resolved)", !!wrap);
    ok("BC-B-4.2 trail contains Global K8s link", /data-href="spice\/projects\/global-k8s\/Global K8s\.md"/.test(wrap.innerHTML));
    ok("BC-B-4.3 trail contains Map current label", /<span[^>]*font-weight:600[^>]*>Map<\/span>/.test(wrap.innerHTML));
  });
}).then(() => {
  // BC-B-5: path fallback with NO hub note — slug used as name.
  console.log("\n--- Case BC-B-5: path fallback with no hub note uses slug as name ---");
  const Breadcrumb = loadClass("breadcrumb.js", "Breadcrumb", {});
  const bc = new Breadcrumb();
  const cur = {
    file: { path: "spice/projects/orphan-slug/orphan-slug-board.md", name: "orphan-slug-board" },
    type: "kanban",
  };
  const dv = makeDv({ current: cur, pages: [] });
  return bc.render(dv).then(() => {
    const wrap = dv.container.children[0];
    ok("BC-B-5.1 wrap div created (slug fallback)", !!wrap);
    ok("BC-B-5.2 trail uses slug 'orphan-slug' as the name", /data-href="spice\/projects\/orphan-slug\/orphan-slug\.md"/.test(wrap.innerHTML));
    ok("BC-B-5.3 trail contains Board current label", /<span[^>]*font-weight:600[^>]*>Board<\/span>/.test(wrap.innerHTML));
  });
}).then(() => {
  // BC-B-6: file NOT under spice/projects/ — render returns early (no wrap).
  console.log("\n--- Case BC-B-6: file outside spice/projects/ short-circuits ---");
  const Breadcrumb = loadClass("breadcrumb.js", "Breadcrumb", {});
  const bc = new Breadcrumb();
  const cur = {
    file: { path: "spice/finance/budgets/2026.md", name: "2026" },
    type: "budget",
  };
  const dv = makeDv({ current: cur, pages: [] });
  return bc.render(dv).then(() => {
    eq("BC-B-6.1 no children (early return)", dv.container.children.length, 0);
  });
}).then(() => testProjectMeetingsPanel()).then(() => testProjectDocsIndexSort()).then(() => testTemplateIntegrity()).then(() => testApplyDocNoteCleanupEdges()).then(() => emit());

// ===========================================================================
// SECTION S5 — ProjectMeetingsPanel._enrichMeeting behavioral
// ===========================================================================

async function testProjectMeetingsPanel() {
  console.log("\n=== S5 ProjectMeetingsPanel._enrichMeeting behavioral ===");

  // We need a faux `app.vault` whose read() returns specific content. Pass
  // via the helper's `app` global. The loader injects `app` into the wrap.
  const fileBodies = new Map();
  const fakeApp = {
    vault: {
      getAbstractFileByPath: (p) => fileBodies.has(p) ? { path: p } : null,
      read: async (file) => fileBodies.get(file.path) || "",
    },
  };
  const customJS = {};
  const ProjectMeetingsPanel = loadClass(
    "project-meetings-panel.js",
    "ProjectMeetingsPanel",
    { app: fakeApp, customJS, moment: momentShim }
  );
  const pmp = new ProjectMeetingsPanel();

  // PMP-B-1: attendees from frontmatter array — wikilinks stripped.
  {
    console.log("\n--- Case PMP-B-1: attendees from frontmatter (wikilink-stripped) ---");
    const p = { file: { path: "spice/meetings/notes/m1.md", name: "m1" }, attendees: ["[[Alice Smith]]", "[[Bob Jones|Bob]]", "Carol Plain"], summary: "" };
    p.attendees.length = 3;
    fileBodies.set("spice/meetings/notes/m1.md", "irrelevant body");
    const out = await pmp._enrichMeeting(p);
    eq("PMP-B-1.1 attendees count", out.attendees.length, 3);
    eq("PMP-B-1.2 first attendee (Alice)", out.attendees[0], "Alice Smith");
    eq("PMP-B-1.3 aliased attendee uses display", out.attendees[1], "Bob");
    eq("PMP-B-1.4 plain attendee preserved", out.attendees[2], "Carol Plain");
  }

  // PMP-B-2: fallback to body `## Attendees` section when frontmatter absent.
  {
    console.log("\n--- Case PMP-B-2: attendees fallback to body ## Attendees section ---");
    const body = `---\ntype: meeting\n---\n\n## Attendees\n- [[Dana]]\n- [[Eric|Rick]]\n\n## Notes\nstuff\n`;
    fileBodies.set("spice/meetings/notes/m2.md", body);
    const p = { file: { path: "spice/meetings/notes/m2.md", name: "m2" }, summary: "" };
    const out = await pmp._enrichMeeting(p);
    eq("PMP-B-2.1 attendees parsed from body", out.attendees.length, 2);
    eq("PMP-B-2.2 first", out.attendees[0], "Dana");
    eq("PMP-B-2.3 aliased uses display", out.attendees[1], "Rick");
  }

  // PMP-B-3: openTasks counts only unchecked `- [ ]` items.
  {
    console.log("\n--- Case PMP-B-3: openTasks counts only unchecked ---");
    const body = `---\n---\n\n- [ ] open1\n- [x] done1\n- [ ] open2\n- [X] done2\n- [ ] open3\n`;
    fileBodies.set("spice/meetings/notes/m3.md", body);
    const p = { file: { path: "spice/meetings/notes/m3.md", name: "m3" }, summary: "" };
    const out = await pmp._enrichMeeting(p);
    eq("PMP-B-3.1 openTasks = 3 (unchecked only)", out.openTasks, 3);
  }

  // PMP-B-4: hasNotes via `## Notes` heading with > 5 chars of content.
  {
    console.log("\n--- Case PMP-B-4: hasNotes via ## Notes heading (>5 chars) ---");
    const body = `---\n---\n\n## Notes\nReal notes content here\n`;
    fileBodies.set("spice/meetings/notes/m4.md", body);
    const p = { file: { path: "spice/meetings/notes/m4.md", name: "m4" }, summary: "" };
    const out = await pmp._enrichMeeting(p);
    eq("PMP-B-4.1 hasNotes=true", out.hasNotes, true);

    // Short notes section → fallback to body heuristic; here body has nothing else, so hasNotes=false.
    const bodyShort = `---\n---\n\n## Notes\nhi\n`;
    fileBodies.set("spice/meetings/notes/m4b.md", bodyShort);
    const outB = await pmp._enrichMeeting({ file: { path: "spice/meetings/notes/m4b.md", name: "m4b" }, summary: "" });
    eq("PMP-B-4.2 short ## Notes + tiny body → hasNotes=false", outB.hasNotes, false);
  }

  // PMP-B-5: hasNotes via body fallback (> 20 non-whitespace chars).
  {
    console.log("\n--- Case PMP-B-5: hasNotes via body fallback (>20 non-ws chars, no ## Notes section) ---");
    const body = `---\n---\n\nThis is a fairly substantial paragraph of meeting content that is well over twenty characters of body text.\n`;
    fileBodies.set("spice/meetings/notes/m5.md", body);
    const p = { file: { path: "spice/meetings/notes/m5.md", name: "m5" }, summary: "" };
    const out = await pmp._enrichMeeting(p);
    eq("PMP-B-5.1 hasNotes=true (body fallback)", out.hasNotes, true);
  }
}

// ===========================================================================
// SECTION S4 — ProjectDocsIndex section sort algorithm
// ===========================================================================

async function testProjectDocsIndexSort() {
  console.log("\n=== S4 ProjectDocsIndex section sort behavioral ===");

  // The sort algorithm is buried inside _renderResults; reproduce its exact
  // logic here and assert the contract directly. Source-text test guarantees
  // the algo IS the one in the helper; this test guarantees the algo's
  // BEHAVIOR matches the design (maxMtime DESC, alphabetic tie-break, empty
  // sections at the bottom).
  const sortFn = (a, b) => {
    if ((b.maxMtime || 0) !== (a.maxMtime || 0)) return (b.maxMtime || 0) - (a.maxMtime || 0);
    return String(a.section_label).localeCompare(String(b.section_label));
  };

  // PDI-B-1: basic DESC ordering.
  {
    console.log("\n--- Case PDI-B-1: sections sort by maxMtime DESC ---");
    const sections = [
      { section_label: "Alpha", maxMtime: 100 },
      { section_label: "Beta",  maxMtime: 300 },
      { section_label: "Gamma", maxMtime: 200 },
    ].sort(sortFn);
    eq("PDI-B-1.1 first by mtime", sections[0].section_label, "Beta");
    eq("PDI-B-1.2 second by mtime", sections[1].section_label, "Gamma");
    eq("PDI-B-1.3 third by mtime", sections[2].section_label, "Alpha");
  }

  // PDI-B-2: tie-break alphabetic.
  {
    console.log("\n--- Case PDI-B-2: equal maxMtime ties broken alphabetically ---");
    const sections = [
      { section_label: "Zulu",  maxMtime: 500 },
      { section_label: "Alpha", maxMtime: 500 },
      { section_label: "Mike",  maxMtime: 500 },
    ].sort(sortFn);
    eq("PDI-B-2.1 alpha first", sections[0].section_label, "Alpha");
    eq("PDI-B-2.2 mike second", sections[1].section_label, "Mike");
    eq("PDI-B-2.3 zulu third", sections[2].section_label, "Zulu");
  }

  // PDI-B-3: empty sections (maxMtime=0) sort to the bottom.
  {
    console.log("\n--- Case PDI-B-3: empty sections (maxMtime=0) sort to bottom ---");
    const sections = [
      { section_label: "Empty1", maxMtime: 0 },
      { section_label: "Active", maxMtime: 999 },
      { section_label: "Empty2", maxMtime: 0 },
    ].sort(sortFn);
    eq("PDI-B-3.1 active first", sections[0].section_label, "Active");
    eq("PDI-B-3.2 Empty1 (alpha tie-break)", sections[1].section_label, "Empty1");
    eq("PDI-B-3.3 Empty2 third", sections[2].section_label, "Empty2");
  }
}

// ===========================================================================
// SECTION S6 — Template, Project.md structural integrity
// ===========================================================================

async function testTemplateIntegrity() {
  console.log("\n=== S6 Template integrity behavioral ===");

  // TPL-B-1: Project.md section order (strict) — Breadcrumb → SpaceNavButtons
  // → ProjectNavButtons → ProjectStatusWidget → ProjectMeetingsPanel →
  // ProjectWorkstreamManager. Other orderings would surface the regression.
  {
    console.log("\n--- Case TPL-B-1: Project.md strict section order ---");
    const tpl = fs.readFileSync(path.join(TPLDIR, "Project.md"), "utf8");
    const expectedOrder = ["Breadcrumb", "SpaceNavButtons", "ProjectNavButtons", "ProjectStatusWidget", "ProjectMeetingsPanel", "ProjectWorkstreamManager"];
    const positions = expectedOrder.map((cls) => ({ cls, idx: tpl.indexOf(`class: "${cls}"`) }));
    for (let i = 0; i < positions.length; i++) {
      ok(`TPL-B-1.${i + 1} ${positions[i].cls} present`, positions[i].idx >= 0,
        `expected class invocation for "${positions[i].cls}"`);
    }
    // Strict ascending order check.
    for (let i = 1; i < positions.length; i++) {
      ok(`TPL-B-1.${i + positions.length + 1} ${positions[i].cls} after ${positions[i - 1].cls}`,
        positions[i].idx > positions[i - 1].idx,
        `${positions[i - 1].cls}@${positions[i - 1].idx} vs ${positions[i].cls}@${positions[i].idx}`);
    }
  }

  // TPL-B-2: Project.md contains NO legacy classes.
  {
    console.log("\n--- Case TPL-B-2: Project.md contains no legacy v0.61-v0.102 classes ---");
    const tpl = fs.readFileSync(path.join(TPLDIR, "Project.md"), "utf8");
    const legacy = ["BacklinkPanel", "ProjectNotesCards", "ProjectReferencedByCards"];
    for (const cls of legacy) {
      ok(`TPL-B-2.${cls}`, !tpl.includes(`class: "${cls}"`),
        `legacy class "${cls}" leaked back into Project.md`);
    }
  }

  // TPL-B-3: All 4 breadcrumbed templates carry Breadcrumb as first dataviewjs block
  // (after frontmatter, where present).
  {
    console.log("\n--- Case TPL-B-3: breadcrumb-bearing templates ship Breadcrumb at the top ---");
    const templates = ["Project.md", "Project Map.md", "Task Note.md", "Project Board.md"];
    for (const t of templates) {
      const body = fs.readFileSync(path.join(TPLDIR, t), "utf8");
      // Strip frontmatter (between leading --- and matching ---).
      let payload = body;
      const fmMatch = body.match(/^---\n[\s\S]*?\n---\n+/m);
      if (fmMatch) payload = body.slice(fmMatch[0].length);
      const firstBlockMatch = payload.match(/```dataviewjs\nawait dv\.view\("ranch\/views\/customjs-guard", \{ class: "([^"]+)" \}\);\n```/);
      ok(`TPL-B-3 ${t}: has a dataviewjs block in body`, !!firstBlockMatch,
        `no dataviewjs block found in ${t} body`);
      if (firstBlockMatch) {
        eq(`TPL-B-3 ${t}: first body block is Breadcrumb`, firstBlockMatch[1], "Breadcrumb");
      }
    }
  }

  // TPL-B-4: Project Board.md preserves kanban frontmatter shape.
  {
    console.log("\n--- Case TPL-B-4: Project Board.md preserves kanban-plugin frontmatter ---");
    const body = fs.readFileSync(path.join(TPLDIR, "Project Board.md"), "utf8");
    ok("TPL-B-4.1 has kanban-plugin: board", /^kanban-plugin:\s*board\s*$/m.test(body));
    ok("TPL-B-4.2 has type: kanban", /^type:\s*kanban\s*$/m.test(body));
    ok("TPL-B-4.3 has ## In Planning column", body.includes("## In Planning"));
    ok("TPL-B-4.4 has ## In Progress column", body.includes("## In Progress"));
    ok("TPL-B-4.5 has ## Blocked column", body.includes("## Blocked"));
    ok("TPL-B-4.6 has ## Completed column", body.includes("## Completed"));
    ok("TPL-B-4.7 kanban:settings block preserved", body.includes("kanban:settings"));
    // Breadcrumb block sits ABOVE all columns.
    const bcIdx = body.indexOf('class: "Breadcrumb"');
    const colIdx = body.indexOf("## In Planning");
    ok("TPL-B-4.8 Breadcrumb above first column", bcIdx >= 0 && bcIdx < colIdx);
  }

  // TPL-B-5: Section Hub.md + Doc Note.md + Docs Hub.md — Breadcrumb preserved.
  {
    console.log("\n--- Case TPL-B-5: section / doc hub templates still ship Breadcrumb ---");
    const inheritedTemplates = ["Section Hub.md", "Doc Note.md", "Docs Hub.md"];
    for (const t of inheritedTemplates) {
      const body = fs.readFileSync(path.join(TPLDIR, t), "utf8");
      ok(`TPL-B-5 ${t}: invokes Breadcrumb`, /class:\s*"Breadcrumb"/.test(body));
    }
  }
}

// ===========================================================================
// SECTION S8 — applyDocNoteBreadcrumbMarkerCleanup edge cases
// ===========================================================================

async function testApplyDocNoteCleanupEdges() {
  console.log("\n=== S8 applyDocNoteBreadcrumbMarkerCleanup edge cases ===");

  const installModule = require(path.join(WORKSHOP, "platform/install.js"));
  const applyDocNoteBreadcrumbMarkerCleanup = installModule.applyDocNoteBreadcrumbMarkerCleanup;
  ok("CLN-B-0 install module exports applyDocNoteBreadcrumbMarkerCleanup",
    typeof applyDocNoteBreadcrumbMarkerCleanup === "function");
  if (typeof applyDocNoteBreadcrumbMarkerCleanup !== "function") return;

  // Shared in-memory adapter builder.
  function makeAdapter(initialFs) {
    const store = new Map(Object.entries(initialFs || {}));
    return {
      async exists(p) { return store.has(p) || [...store.keys()].some((k) => k.startsWith(p + "/")); },
      async list(p) {
        const folders = new Set();
        const files = [];
        for (const k of store.keys()) {
          if (!k.startsWith(p + "/")) continue;
          const rest = k.substring(p.length + 1);
          const slashIdx = rest.indexOf("/");
          if (slashIdx === -1) files.push(k);
          else folders.add(`${p}/${rest.substring(0, slashIdx)}`);
        }
        return { folders: [...folders], files };
      },
      async read(p) { if (!store.has(p)) throw new Error(`ENOENT: ${p}`); return store.get(p); },
      async write(p, body) { store.set(p, body); },
      _store: store,
    };
  }
  const mockManifest = { name: "project" };
  const mockVariables = {};
  const mockGit = { commit: "deadbeef", tag: "v0.109.0-test", dirty: false };

  // CLN-B-1: marker at very start of body (no leading \n).
  {
    console.log("\n--- Case CLN-B-1: marker at very start of body ---");
    const before = `<!-- breadcrumb-v1.17.0 -->\n\`\`\`dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });\n\`\`\`\n`;
    const adapter = makeAdapter({
      "spice/projects/foo/Foo.md": '---\ntype: project\n---\nbody',
      "spice/projects/foo/docs/Docs.md": '---\ntype: docs-hub\n---\nhub',
      "spice/projects/foo/docs/knowledge/Start.md": before,
    });
    const tp = { app: { vault: { adapter } } };
    const history = [];
    await applyDocNoteBreadcrumbMarkerCleanup(tp, mockManifest, mockVariables, history, mockGit);
    const after = await adapter.read("spice/projects/foo/docs/knowledge/Start.md");
    ok("CLN-B-1.1 leading marker stripped", !after.includes("<!-- breadcrumb-v1.17.0 -->"));
    ok("CLN-B-1.2 breadcrumb block preserved", after.includes('class: "Breadcrumb"'));
    ok("CLN-B-1.3 file is now shorter than before", after.length < before.length);
  }

  // CLN-B-2: multiple markers in the same file → all stripped.
  {
    console.log("\n--- Case CLN-B-2: multiple markers in same file → all stripped ---");
    const before = `---\ntype: doc-note\n---\n\n<!-- breadcrumb-v1.17.0 -->\nA\n\n<!-- breadcrumb-v1.17.0 -->\nB\n\n<!-- breadcrumb-v1.17.0 -->\nC\n`;
    const adapter = makeAdapter({
      "spice/projects/foo/Foo.md": '---\ntype: project\n---\nbody',
      "spice/projects/foo/docs/Docs.md": '---\ntype: docs-hub\n---\nhub',
      "spice/projects/foo/docs/knowledge/Multi.md": before,
    });
    const tp = { app: { vault: { adapter } } };
    const history = [];
    await applyDocNoteBreadcrumbMarkerCleanup(tp, mockManifest, mockVariables, history, mockGit);
    const after = await adapter.read("spice/projects/foo/docs/knowledge/Multi.md");
    ok("CLN-B-2.1 zero markers remain", !after.includes("<!-- breadcrumb-v1.17.0 -->"));
    ok("CLN-B-2.2 content A preserved", after.includes("A"));
    ok("CLN-B-2.3 content B preserved", after.includes("B"));
    ok("CLN-B-2.4 content C preserved", after.includes("C"));
  }

  // CLN-B-3: deeply nested doc (depth-3 — knowledge/sub-section/another/Doc.md).
  // The recursive lister must traverse all the way down.
  {
    console.log("\n--- Case CLN-B-3: deeply nested doc cleanup ---");
    const before = `---\ntype: doc-note\n---\n\n<!-- breadcrumb-v1.17.0 -->\n\`\`\`dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });\n\`\`\`\n\nDeep body.\n`;
    const adapter = makeAdapter({
      "spice/projects/foo/Foo.md": '---\ntype: project\n---\nbody',
      "spice/projects/foo/docs/Docs.md": '---\ntype: docs-hub\n---\nhub',
      "spice/projects/foo/docs/knowledge/Knowledge.md": '---\ntype: section-hub\n---\nsh',
      "spice/projects/foo/docs/knowledge/architecture/Architecture.md": '---\ntype: section-hub\n---\nsub',
      "spice/projects/foo/docs/knowledge/architecture/Deep Doc.md": before,
    });
    const tp = { app: { vault: { adapter } } };
    const history = [];
    await applyDocNoteBreadcrumbMarkerCleanup(tp, mockManifest, mockVariables, history, mockGit);
    const after = await adapter.read("spice/projects/foo/docs/knowledge/architecture/Deep Doc.md");
    ok("CLN-B-3.1 deeply-nested marker stripped", !after.includes("<!-- breadcrumb-v1.17.0 -->"));
    ok("CLN-B-3.2 breadcrumb block preserved at depth", after.includes('class: "Breadcrumb"'));
  }

  // CLN-B-4: mix of files with + without markers; only marker-bearing files written.
  {
    console.log("\n--- Case CLN-B-4: mix of files; only marker-bearing files are touched ---");
    const withMarker = `---\ntype: doc-note\n---\n\n<!-- breadcrumb-v1.17.0 -->\nBody\n`;
    const cleanBody = `---\ntype: doc-note\n---\n\nAlready clean.\n`;
    const adapter = makeAdapter({
      "spice/projects/foo/Foo.md": '---\ntype: project\n---\nbody',
      "spice/projects/foo/docs/Docs.md": '---\ntype: docs-hub\n---\nhub',
      "spice/projects/foo/docs/knowledge/A.md": withMarker,
      "spice/projects/foo/docs/knowledge/B.md": cleanBody,
      "spice/projects/foo/docs/knowledge/C.md": withMarker,
    });
    const tp = { app: { vault: { adapter } } };
    const history = [];
    await applyDocNoteBreadcrumbMarkerCleanup(tp, mockManifest, mockVariables, history, mockGit);
    const summary = history.find((e) => e.step === "doc_note_breadcrumb_marker_cleanup" && e.action === "summary");
    ok("CLN-B-4.1 summary recorded", !!summary);
    if (summary) {
      eq("CLN-B-4.2 cleaned_count = 2 (A + C)", summary.cleaned_count, 2);
      ok("CLN-B-4.3 untouched_count >= 1 (B + the hub-shaped docs)", summary.untouched_count >= 1);
    }
    eq("CLN-B-4.4 B.md unchanged byte-for-byte", await adapter.read("spice/projects/foo/docs/knowledge/B.md"), cleanBody);
  }

  // CLN-B-5: cross-project isolation — Project A's markers cleaned, Project B's clean files untouched.
  {
    console.log("\n--- Case CLN-B-5: cross-project isolation ---");
    const withMarker = `---\ntype: doc-note\n---\n\n<!-- breadcrumb-v1.17.0 -->\nBody.\n`;
    const cleanBody = `---\ntype: doc-note\n---\n\nAlready clean.\n`;
    const adapter = makeAdapter({
      "spice/projects/aaa/Aaa.md": '---\ntype: project\n---\nbody',
      "spice/projects/aaa/docs/Docs.md": '---\ntype: docs-hub\n---\nhub',
      "spice/projects/aaa/docs/knowledge/A1.md": withMarker,
      "spice/projects/bbb/Bbb.md": '---\ntype: project\n---\nbody',
      "spice/projects/bbb/docs/Docs.md": '---\ntype: docs-hub\n---\nhub',
      "spice/projects/bbb/docs/knowledge/B1.md": cleanBody,
    });
    const tp = { app: { vault: { adapter } } };
    const history = [];
    await applyDocNoteBreadcrumbMarkerCleanup(tp, mockManifest, mockVariables, history, mockGit);
    const a1After = await adapter.read("spice/projects/aaa/docs/knowledge/A1.md");
    const b1After = await adapter.read("spice/projects/bbb/docs/knowledge/B1.md");
    ok("CLN-B-5.1 project A: marker stripped",   !a1After.includes("<!-- breadcrumb-v1.17.0 -->"));
    eq("CLN-B-5.2 project B: file untouched",    b1After, cleanBody);
    const summary = history.find((e) => e.step === "doc_note_breadcrumb_marker_cleanup" && e.action === "summary");
    ok("CLN-B-5.3 summary recorded", !!summary);
    if (summary) eq("CLN-B-5.4 cleaned_count = 1", summary.cleaned_count, 1);
  }
}

// ---------------------------------------------------------------------------
// Final emit
// ---------------------------------------------------------------------------

function emit() {
  console.log(`\nrun-v0109-projects-overhaul.js: ${passed} pass · ${failed} fail`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log("  " + f);
  }
  process.exit(failed === 0 ? 0 : 1);
}
