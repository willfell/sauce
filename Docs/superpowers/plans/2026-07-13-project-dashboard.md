# Project Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single compact "at-a-glance" card at the top of every project note that replaces the ProjectStatusWidget + ProjectActivityPanel + ProjectOpenTasks + ProjectMeetingsPanel + ProjectLinksPanel stack with 5 clickable navigation tiles (Docs / Board / To-Do / Map / Meetings), a Recent-activity strip, and Links chips.

**Architecture:** New `ProjectDashboard` customJS class in `platform/blueprints/project/helpers/project-dashboard.js`. Subsumes 4 retired panels; keeps `ProjectStatusWidget` (imports its `STATES` + `_writeStatus`). Template body simplifies from 6 dataviewjs blocks to 2 (ChromeBar + Dashboard). Install heal `applyProjectDashboardConformanceHeal` migrates existing project notes idempotently with `.bak` backups. No new mechanism — reuses `section-label`, `menu-popover`, `render-safe`, `cards`, and the icon set already vendored on `ProjectChromeBar.ICON`.

**Tech Stack:** JavaScript (customJS module pattern), Obsidian dataviewjs API, `app.metadataCache` / `app.vault.read` / `app.fileManager.processFrontMatter`, Node.js test harness (`run-project.js`), Playwright HTML visual harness.

**Spec:** `Docs/superpowers/specs/2026-07-13-project-dashboard-design.md`

**Working branch:** `feature/project-dashboard` (already checked out, spec committed at 57bc3569).

---

## Reference — canonical patterns to reuse

All paths relative to `/Users/willfellhoelter/projects/repos/sauce/.claude/worktrees/bridge-cse_01GZakZrnokU3Ga4Yk2KjAoe`.

### Status states (import from `project-status-widget.js` lines 11–20)

```javascript
const STATUSES = ["idea", "planning", "in-progress", "blocked", "superseded", "cancelled", "done"];
const COLORS = {
  idea:          "var(--text-muted)",
  planning:      "var(--color-blue)",
  "in-progress": "var(--color-green)",
  blocked:       "var(--color-red)",
  superseded:    "var(--color-orange)",
  cancelled:     "var(--text-faint)",
  done:          "var(--color-purple)",
};
```

Status write (frontmatter mutation, `project-status-widget.js` lines 137–149):

```javascript
async _writeStatus(file, newStatus) {
  const today = new Date().toISOString().split("T")[0];
  try {
    await app.fileManager.processFrontMatter(file, fm => {
      fm.status = newStatus;
      fm.status_changed_at = today;
    });
  } catch (e) {}
}
```

### Board parse (from `project-open-tasks.js` lines 22–30)

```javascript
// Read file content, count unchecked outside "Completed" lane
let lane = "";
let count = 0;
for (const line of content.split("\n")) {
  if (line.startsWith("## ")) { lane = line.replace("## ", "").trim(); continue; }
  const m = line.match(/^- \[ \] (.+)$/);
  if (m && lane !== "Completed") count += 1;
}
return count;
```

Note: the source function caps at 5 for LIST rendering. For COUNTS, remove the cap.

### `_projectMatches` (from `project-activity-panel.js` lines 112–122)

```javascript
static _projectMatches(field, currentPath, projectName) {
  if (!field) return false;
  if (typeof field === "string") {
    return field.includes(`[[${projectName}]]`)
        || field.includes(`[[${projectName}|`)
        || field === projectName;
  }
  if (field.path) return field.path === currentPath;
  if (field.display) return field.display === projectName;
  return false;
}
```

### Recent merge (from `project-activity-panel.js` lines 18–33)

```javascript
const rows = [];
try {
  for (const p of dv.pages(`"${folder}/docs"`).where(p => p && p.type === "doc-note")) {
    rows.push({ page: p, kind: "doc", mtime: p.file?.mtime?.ts || 0 });
  }
} catch (_e) {}
try {
  for (const p of dv.pages('"spice/meetings/notes"')
      .where(p => p && p.type === "meeting" && ProjectDashboard._projectMatches(p.project, currentPath, projectName))) {
    rows.push({ page: p, kind: "meeting", mtime: p.file?.mtime?.ts || 0 });
  }
} catch (_e) {}
try {
  for (const p of dv.pages(`"${folder}/tasks"`).where(p => p && p.type === "task-note")) {
    rows.push({ page: p, kind: "task", mtime: p.file?.mtime?.ts || 0 });
  }
} catch (_e) {}
const top = rows.filter(r => r.mtime > 0).sort((a, b) => b.mtime - a.mtime).slice(0, 5);
```

### SectionLabel (from `section-label.js` lines 10–27)

```javascript
customJS.SectionLabel.render(dv, { text: "Recent", top: true });
// top:true = NO hairline above (perfect for inside-card labels)
```

### MenuPopover (from `menu-popover.js` lines 11–28)

```javascript
customJS.MenuPopover.open(entries, { anchor: statusPill, title: "Set status" });
// entries = [{ label, icon?, onSelect, danger? } | { section: "…" }]
```

### ProjectChromeBar.ICON (lines 45–60)

Import via `customJS.ProjectChromeBar.ICON.docs` etc. Keys available: `project, map, board, task, docs, todo, links, plus, minus, gear, move, sort`.

### `Template, Project.md` reference — current shape

Uses `dv.view("ranch/views/customjs-guard", { class: "XYZ" })` per block. Six blocks today (ChromeBar / StatusWidget / ActivityPanel / OpenTasks / MeetingsPanel / LinksPanel).

### Heal function pattern — model on `applyTripsConformanceHeal` in `platform/install.js` lines 12717–12850

Key steps: scan → plan writes → backup → apply → history log. Wrap every step in try/catch; never throw.

### Manifest current state

`platform/blueprints/project/manifest.json` — version currently `1.49.1`. Bump minor to `1.50.0` (or per-release pipeline). Classes to remove: `ProjectActivityPanel` (wait — this isn't in the manifest list currently; the list is: `ProjectStatusWidget, ProjectMeetingsPanel, ProjectLinksPanel` + 20 others). We drop: `ProjectStatusWidget, ProjectMeetingsPanel, ProjectLinksPanel`. We ADD: `ProjectDashboard`. We KEEP: `ProjectStatusWidget` IF the dashboard imports from it — actually we're inlining STATES + `_writeStatus` into ProjectDashboard so `ProjectStatusWidget` can go. Verify no other consumer uses it via grep before deleting.

Also drop: `ProjectActivityPanel` and `ProjectOpenTasks` — but these aren't in the manifest customjs_classes list either (they may be loaded via `extra_files`). Verify by grepping the manifest file itself.

---

## Task 1: Skeleton class + first passing harness test

**Files:**
- Create: `platform/blueprints/project/helpers/project-dashboard.js`
- Modify: `platform/test/harness/run-project.js` — add PROJDASH-* group

- [ ] **Step 1: Write the failing test**

Add to `platform/test/harness/run-project.js` (before the final `process.exit` line). First, find where other test groups are declared — the harness ends with `process.exit(fails === 0 ? 0 : 1)`. Insert BEFORE that line:

```javascript
// ---- ProjectDashboard --------------------------------------------------------
{
  const dash = new ProjectDashboard();
  ok('PROJDASH-1 class instantiates without throwing',
     dash !== null && typeof dash.render === 'function');
}
```

Add the customJS stub near the top with the other stubs:

```javascript
// Load the file under test
require("../../blueprints/project/helpers/project-dashboard.js");
// After require: global.ProjectDashboard should be defined by the file
```

- [ ] **Step 2: Verify test fails**

Run: `node platform/test/harness/run-project.js`
Expected: FAIL with `ReferenceError: ProjectDashboard is not defined` or similar.

- [ ] **Step 3: Write minimal implementation**

Create `platform/blueprints/project/helpers/project-dashboard.js`:

```javascript
class ProjectDashboard {
  async render(dv) {
    // implementation coming in later tasks
  }
}

// customJS pattern — expose to global so both real Obsidian and node harness see it
if (typeof module !== "undefined" && module.exports) {
  module.exports = ProjectDashboard;
}
if (typeof global !== "undefined") {
  global.ProjectDashboard = ProjectDashboard;
}
```

Follow the exact export pattern used by neighboring helpers — grep any existing helper like `project-status-widget.js` for how they expose the class. Match it exactly (customJS auto-registers files that end with `class Name {} ... module.exports = Name;`).

- [ ] **Step 4: Verify test passes**

Run: `node platform/test/harness/run-project.js`
Expected: `PROJDASH-1 class instantiates without throwing … OK`

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/project/helpers/project-dashboard.js platform/test/harness/run-project.js
git commit -m "feat(project): scaffold ProjectDashboard class with harness stub"
```

---

## Task 2: `_projectMatches` static (extracted from ProjectActivityPanel)

**Files:**
- Modify: `platform/blueprints/project/helpers/project-dashboard.js`
- Modify: `platform/test/harness/run-project.js`

- [ ] **Step 1: Write failing tests**

Add to `run-project.js` PROJDASH block:

```javascript
{
  const m = ProjectDashboard._projectMatches;
  const path = "spice/projects/foo/Foo.md";
  ok('PROJDASH-2a string plain match', m("Foo", path, "Foo") === true);
  ok('PROJDASH-2b string wikilink match', m("[[Foo]]", path, "Foo") === true);
  ok('PROJDASH-2c string wikilink alias match', m("[[Foo|Aliased]]", path, "Foo") === true);
  ok('PROJDASH-2d field object path match', m({ path }, path, "Foo") === true);
  ok('PROJDASH-2e field object display match', m({ display: "Foo" }, path, "Foo") === true);
  ok('PROJDASH-2f no match', m("Bar", path, "Foo") === false);
  ok('PROJDASH-2g falsy field', m(null, path, "Foo") === false);
}
```

- [ ] **Step 2: Verify failing**

Run: `node platform/test/harness/run-project.js`
Expected: FAIL — `_projectMatches` undefined.

- [ ] **Step 3: Implement**

Add to `ProjectDashboard`:

```javascript
static _projectMatches(field, currentPath, projectName) {
  if (!field) return false;
  if (typeof field === "string") {
    return field.includes(`[[${projectName}]]`)
        || field.includes(`[[${projectName}|`)
        || field === projectName;
  }
  if (field.path) return field.path === currentPath;
  if (field.display) return field.display === projectName;
  return false;
}
```

- [ ] **Step 4: Verify all 7 tests pass**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(project): ProjectDashboard._projectMatches (extracted from ActivityPanel)"
```

---

## Task 3: `_counts` — per-tile queries with fixture tests

**Files:**
- Modify: `platform/blueprints/project/helpers/project-dashboard.js`
- Modify: `platform/test/harness/run-project.js`

- [ ] **Step 1: Add stub for `app.vault.read`**

At the top of `run-project.js` in the stub block, ensure `app.vault.read` is stubbable. Add a helper factory:

```javascript
function makeApp(files) {
  // files: { "path/to/file.md": "content string" }
  return {
    vault: {
      read: async (file) => {
        const path = typeof file === "string" ? file : file?.path;
        return files[path] ?? "";
      },
      getAbstractFileByPath: (path) => (files[path] !== undefined ? { path } : null),
    },
    metadataCache: {
      getFileCache: () => null,
    },
  };
}
```

- [ ] **Step 2: Write failing tests**

```javascript
{
  const dash = new ProjectDashboard();
  const currentPath = "spice/projects/foo/Foo.md";
  const projectName = "Foo";
  const folder = "spice/projects/foo";
  const slug = "foo";

  // Fixture: 3 docs, 2 open board tasks (Todo + In Progress), 1 open todo, 2 workstreams, 4 meetings
  const dv = {
    current: () => ({ workstreams: ["ws1", "ws2"], file: { path: currentPath } }),
    pages: (query) => {
      if (query.includes("/docs")) return _stubList(3, "doc-note");
      if (query.includes("meetings/notes")) return _stubList(4, "meeting", { project: "[[Foo]]" });
      if (query.includes("/tasks")) return _stubList(0, "task-note");
      return _stubList(0, null);
    },
  };
  const boardContent = "## Todo\n- [ ] a\n- [ ] b\n## In Progress\n## Completed\n- [ ] should-not-count\n";
  const todoContent = "- [ ] one\n- [x] done\n";
  const app = makeApp({
    [`${folder}/${slug}-board.md`]: boardContent,
    [`${folder}/${projectName} To-Do.md`]: todoContent,
  });

  const counts = await dash._counts(dv, { app, folder, slug, projectName, currentPath });
  ok('PROJDASH-3a docs count',     counts.docs === 3);
  ok('PROJDASH-3b board count',    counts.board === 2);
  ok('PROJDASH-3c todo count',     counts.todo === 1);
  ok('PROJDASH-3d map count',      counts.map === 2);
  ok('PROJDASH-3e meetings count', counts.meetings === 4);
}
```

Add stub helper `_stubList` at top of harness:

```javascript
function _stubList(n, type, extra = {}) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push({ type, ...extra, file: { path: `stub-${i}.md`, mtime: { ts: 1_000_000 + i } } });
  // Fake .where — matches ActivityPanel pattern
  arr.where = function(pred) { return this.filter(pred); };
  arr.length = n;
  return arr;
}
```

- [ ] **Step 3: Verify failing**

Run: `node platform/test/harness/run-project.js`
Expected: `_counts is not a function`.

- [ ] **Step 4: Implement**

```javascript
async _counts(dv, ctx) {
  const { app, folder, slug, projectName, currentPath } = ctx;
  const counts = { docs: 0, board: 0, todo: 0, map: 0, meetings: 0 };

  // Docs
  try {
    counts.docs = dv.pages(`"${folder}/docs"`).where(p => p && p.type === "doc-note").length || 0;
  } catch (_e) {}

  // Board — read file, count unchecked outside Completed lane
  try {
    const boardPath = `${folder}/${slug}-board.md`;
    const file = app.vault.getAbstractFileByPath(boardPath);
    if (file) {
      const content = await app.vault.read(file);
      let lane = "";
      for (const line of String(content || "").split("\n")) {
        if (line.startsWith("## ")) { lane = line.replace("## ", "").trim(); continue; }
        if (/^- \[ \] /.test(line) && lane !== "Completed") counts.board += 1;
      }
    }
  } catch (_e) {}

  // To-Do — read the {ProjectName} To-Do.md, count unchecked
  try {
    const todoPath = `${folder}/${projectName} To-Do.md`;
    const file = app.vault.getAbstractFileByPath(todoPath);
    if (file) {
      const content = await app.vault.read(file);
      for (const line of String(content || "").split("\n")) {
        if (/^- \[ \] /.test(line)) counts.todo += 1;
      }
    }
  } catch (_e) {}

  // Map — workstreams array on current page frontmatter
  try {
    const cur = dv.current() || {};
    counts.map = Array.isArray(cur.workstreams) ? cur.workstreams.length : 0;
  } catch (_e) {}

  // Meetings — dv.pages meetings folder, filter by project match
  try {
    counts.meetings = dv.pages('"spice/meetings/notes"')
      .where(p => p && p.type === "meeting" && ProjectDashboard._projectMatches(p.project, currentPath, projectName))
      .length || 0;
  } catch (_e) {}

  return counts;
}
```

- [ ] **Step 5: Verify all 5 tests pass**

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(project): ProjectDashboard._counts — docs/board/todo/map/meetings queries"
```

---

## Task 4: `_recent` — merged mtime-sorted list

**Files:**
- Modify: `platform/blueprints/project/helpers/project-dashboard.js`
- Modify: `platform/test/harness/run-project.js`

- [ ] **Step 1: Write failing test**

```javascript
{
  const dash = new ProjectDashboard();
  const dv = {
    pages: (query) => {
      if (query.includes("/docs")) return _stubListWithMtimes([{ ts: 3000, name: "doc-newest" }], "doc-note");
      if (query.includes("meetings/notes")) return _stubListWithMtimes([{ ts: 5000, name: "mtg-newest", project: "[[Foo]]" }], "meeting");
      if (query.includes("/tasks")) return _stubListWithMtimes([{ ts: 4000, name: "task-mid" }], "task-note");
      return _stubList(0, null);
    },
  };
  const items = dash._recent(dv, { folder: "spice/projects/foo", projectName: "Foo", currentPath: "spice/projects/foo/Foo.md" });
  ok('PROJDASH-4a recent order',       items.length === 3 && items[0].kind === "meeting" && items[1].kind === "task" && items[2].kind === "doc");
  ok('PROJDASH-4b recent caps at 5',   items.length <= 5);
}
```

Add helper:

```javascript
function _stubListWithMtimes(specs, type) {
  const arr = specs.map(s => ({
    type,
    ...s,
    file: { path: `${s.name}.md`, mtime: { ts: s.ts }, name: s.name },
  }));
  arr.where = function(pred) { return this.filter(pred); };
  return arr;
}
```

- [ ] **Step 2: Verify failing**

- [ ] **Step 3: Implement**

```javascript
_recent(dv, ctx) {
  const { folder, projectName, currentPath } = ctx;
  const rows = [];
  try {
    for (const p of dv.pages(`"${folder}/docs"`).where(p => p && p.type === "doc-note")) {
      rows.push({ page: p, kind: "doc", mtime: p?.file?.mtime?.ts || 0 });
    }
  } catch (_e) {}
  try {
    for (const p of dv.pages('"spice/meetings/notes"')
        .where(p => p && p.type === "meeting" && ProjectDashboard._projectMatches(p.project, currentPath, projectName))) {
      rows.push({ page: p, kind: "meeting", mtime: p?.file?.mtime?.ts || 0 });
    }
  } catch (_e) {}
  try {
    for (const p of dv.pages(`"${folder}/tasks"`).where(p => p && p.type === "task-note")) {
      rows.push({ page: p, kind: "task", mtime: p?.file?.mtime?.ts || 0 });
    }
  } catch (_e) {}
  return rows.filter(r => r.mtime > 0).sort((a, b) => b.mtime - a.mtime).slice(0, 5);
}
```

- [ ] **Step 4: Verify passes**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(project): ProjectDashboard._recent — merged mtime-sorted docs+meetings+tasks"
```

---

## Task 5: `_renderHeader` — status pill + click → MenuPopover

**Files:**
- Modify: `platform/blueprints/project/helpers/project-dashboard.js`
- Modify: `platform/test/harness/run-project.js`

- [ ] **Step 1: Add DOM stubs**

In run-project.js verify a `makeEl()` helper exists (already present in `run-trips.js`). If not present in `run-project.js`, port it from `run-trips.js`. It must support `createEl(tag, opts)`, `.textContent`, `.style.cssText`, `.addEventListener("click", fn)`, `.click()`, `.setAttr(k,v)`, `.remove()`, and a `.__children` array.

- [ ] **Step 2: Add MenuPopover stub**

```javascript
global.customJS = global.customJS || {};
global.__mpCalls = [];
global.customJS.MenuPopover = {
  open: (entries, opts) => { global.__mpCalls.push({ entries, opts }); return { __navClose: () => {} }; },
};
global.customJS.SectionLabel = {
  render: (dv, opts) => {
    const c = dv.container || dv;
    const lbl = c.createEl("div");
    lbl.textContent = String(opts?.text || "");
  },
  divider: (dv) => (dv.container || dv).createEl("hr"),
};
```

- [ ] **Step 3: Write failing test**

```javascript
{
  const dash = new ProjectDashboard();
  const container = makeEl("div");
  const currentPage = { status: "in-progress", file: { path: "spice/projects/foo/Foo.md" } };
  const ctx = { currentPage, app: { fileManager: { processFrontMatter: async () => {} } }, file: currentPage.file };

  global.__mpCalls = [];
  dash._renderHeader(container, ctx);

  const pill = container.__children.find(el => el.__isStatusPill);
  ok('PROJDASH-5a pill rendered', pill && pill.textContent.toLowerCase() === "in-progress");

  pill.click();
  ok('PROJDASH-5b click opens MenuPopover', global.__mpCalls.length === 1);
  ok('PROJDASH-5c popover has 7 entries', global.__mpCalls[0].entries.filter(e => e.label).length === 7);
}
```

- [ ] **Step 4: Verify failing**

- [ ] **Step 5: Implement**

Add to `ProjectDashboard`:

```javascript
static get STATUSES() {
  return ["idea", "planning", "in-progress", "blocked", "superseded", "cancelled", "done"];
}
static get STATUS_COLORS() {
  return {
    idea:          "var(--text-muted)",
    planning:      "var(--color-blue)",
    "in-progress": "var(--color-green)",
    blocked:       "var(--color-red)",
    superseded:    "var(--color-orange)",
    cancelled:     "var(--text-faint)",
    done:          "var(--color-purple)",
  };
}

_renderHeader(container, ctx) {
  const { currentPage, app, file } = ctx;
  const status = String(currentPage?.status || "idea");
  const color = ProjectDashboard.STATUS_COLORS[status] || "var(--text-muted)";

  const row = container.createEl("div");
  row.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom:12px;";

  const pill = row.createEl("div");
  pill.__isStatusPill = true;
  pill.textContent = status;
  pill.style.cssText = `display:inline-block; padding:2px 10px; border-radius:999px; ` +
    `font-size:0.75em; font-weight:600; text-transform:lowercase; ` +
    `color:var(--text-on-accent); background:${color}; cursor:pointer;`;
  pill.addEventListener("click", () => {
    const entries = ProjectDashboard.STATUSES.map(s => ({
      label: s,
      onSelect: async () => {
        try {
          await app.fileManager.processFrontMatter(file, fm => {
            fm.status = s;
            fm.status_changed_at = new Date().toISOString().split("T")[0];
          });
        } catch (_e) {}
      },
    }));
    try {
      customJS.MenuPopover.open(entries, { anchor: pill, title: "Set status" });
    } catch (_e) {}
  });
}
```

- [ ] **Step 6: Verify passes**

- [ ] **Step 7: Commit**

```bash
git commit -am "feat(project): ProjectDashboard._renderHeader — status pill + picker"
```

---

## Task 6: `_renderTiles` — 5 tiles, icons, counts, click routing

**Files:**
- Modify: `platform/blueprints/project/helpers/project-dashboard.js`
- Modify: `platform/test/harness/run-project.js`

- [ ] **Step 1: Add ProjectChromeBar stub**

```javascript
global.customJS.ProjectChromeBar = {
  ICON: {
    docs: '<svg data-icon="docs"/>',
    board: '<svg data-icon="board"/>',
    todo: '<svg data-icon="todo"/>',
    map: '<svg data-icon="map"/>',
    project: '<svg data-icon="project"/>',
    task: '<svg data-icon="task"/>',
    links: '<svg data-icon="links"/>',
  },
};
global.__opens = [];
global.app = { workspace: { openLinkText: (target, src, newLeaf) => { global.__opens.push({ target, src, newLeaf }); } } };
```

- [ ] **Step 2: Write failing test**

```javascript
{
  const dash = new ProjectDashboard();
  const container = makeEl("div");
  const counts = { docs: 3, board: 2, todo: 1, map: 2, meetings: 4 };
  const ctx = {
    folder: "spice/projects/foo",
    slug: "foo",
    projectName: "Foo",
    currentPath: "spice/projects/foo/Foo.md",
  };
  dash._renderTiles(container, ctx, counts);

  const tiles = container.__descendants().filter(el => el.__isTile);
  ok('PROJDASH-6a five tiles', tiles.length === 5);
  const labels = tiles.map(t => t.__label).join("|");
  ok('PROJDASH-6b labels order', labels === "Docs|Board|To-Do|Map|Meetings");
  const counts2 = tiles.map(t => t.__count);
  ok('PROJDASH-6c counts', JSON.stringify(counts2) === JSON.stringify([3, 2, 1, 2, 4]));

  global.__opens = [];
  tiles[0].click();
  ok('PROJDASH-6d docs tile navigates', global.__opens[0]?.target === "spice/projects/foo/Docs.md");
  tiles[1].click();
  ok('PROJDASH-6e board tile navigates', global.__opens[1]?.target === "spice/projects/foo/foo-board.md");
  tiles[2].click();
  ok('PROJDASH-6f todo tile navigates', global.__opens[2]?.target === "spice/projects/foo/Foo To-Do.md");
  tiles[3].click();
  ok('PROJDASH-6g map tile navigates', global.__opens[3]?.target === "spice/projects/foo/Map.md");
  tiles[4].click();
  ok('PROJDASH-6h meetings tile navigates', global.__opens[4]?.target === "spice/meetings/Meetings.md");
}
```

Ensure `makeEl` supports `.__descendants()` recursion. If not present, add it — walks `.__children` recursively.

- [ ] **Step 3: Verify failing**

- [ ] **Step 4: Implement**

```javascript
_renderTiles(container, ctx, counts) {
  const { folder, slug, projectName, currentPath } = ctx;
  const ICON = (customJS.ProjectChromeBar && customJS.ProjectChromeBar.ICON) || {};
  const tiles = [
    { key: "docs",     label: "Docs",    icon: ICON.docs,  count: counts.docs,     target: `${folder}/Docs.md` },
    { key: "board",    label: "Board",   icon: ICON.board, count: counts.board,    target: `${folder}/${slug}-board.md` },
    { key: "todo",     label: "To-Do",   icon: ICON.todo,  count: counts.todo,     target: `${folder}/${projectName} To-Do.md` },
    { key: "map",      label: "Map",     icon: ICON.map,   count: counts.map,      target: `${folder}/Map.md` },
    { key: "meetings", label: "Meetings",icon: ICON.project, count: counts.meetings, target: "spice/meetings/Meetings.md" },
  ];

  const row = container.createEl("div");
  row.style.cssText = "display:flex; flex-wrap:wrap; gap:8px; margin-top:0;";

  for (const t of tiles) {
    const tile = row.createEl("div");
    tile.__isTile = true;
    tile.__label = t.label;
    tile.__count = t.count;
    tile.style.cssText =
      "display:flex; flex-direction:column; align-items:flex-start; gap:4px; " +
      "min-width:116px; flex:1 0 116px; max-width:180px; padding:10px 12px; " +
      "border-radius:8px; background:var(--background-primary); " +
      "border:1px solid var(--background-modifier-border); cursor:pointer;";

    // Icon row
    const iconWrap = tile.createEl("div");
    iconWrap.style.cssText = "color:var(--text-muted); font-size:0;"; // SVG width defines
    if (typeof iconWrap.innerHTML !== "undefined" && t.icon) iconWrap.innerHTML = t.icon;

    // Label
    const lbl = tile.createEl("div");
    lbl.textContent = t.label;
    lbl.style.cssText = "text-transform:uppercase; letter-spacing:0.03em; font-size:0.72em; color:var(--text-muted);";

    // Count chip
    const chip = tile.createEl("div");
    chip.textContent = String(t.count);
    const chipColor = t.count > 0 ? "var(--interactive-accent)" : "var(--text-faint)";
    chip.style.cssText = `font-size:1.4em; font-weight:600; color:${chipColor};`;

    tile.addEventListener("click", () => {
      try {
        const cp = (typeof app !== "undefined" ? app : global.app);
        cp.workspace.openLinkText(t.target, currentPath, false);
      } catch (_e) {}
    });
  }
}
```

- [ ] **Step 5: Verify all 8 tests pass**

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(project): ProjectDashboard._renderTiles — 5 clickable nav tiles"
```

---

## Task 7: `_renderRecent` — labeled row list, empty-hides

**Files:**
- Modify: `platform/blueprints/project/helpers/project-dashboard.js`
- Modify: `platform/test/harness/run-project.js`

- [ ] **Step 1: Write failing tests**

```javascript
{
  const dash = new ProjectDashboard();
  const container = makeEl("div");
  const items = [
    { kind: "meeting", page: { file: { path: "m1.md", name: "Meeting one", mtime: { ts: 5000 } } }, mtime: 5000 },
    { kind: "doc",     page: { file: { path: "d1.md", name: "Doc one",     mtime: { ts: 4000 } } }, mtime: 4000 },
  ];
  dash._renderRecent(container, { currentPath: "cp.md" }, items);
  const rows = container.__descendants().filter(el => el.__isRecentRow);
  ok('PROJDASH-7a rows rendered', rows.length === 2);
  ok('PROJDASH-7b label rendered', container.__descendants().some(el => el.textContent === "Recent"));

  const empty = makeEl("div");
  dash._renderRecent(empty, { currentPath: "cp.md" }, []);
  ok('PROJDASH-7c empty renders nothing', empty.__children.length === 0);

  global.__opens = [];
  rows[0].click();
  ok('PROJDASH-7d row click opens', global.__opens[0]?.target === "m1.md");
}
```

- [ ] **Step 2: Verify failing**

- [ ] **Step 3: Implement**

```javascript
_renderRecent(container, ctx, items) {
  if (!items || items.length === 0) return;
  const { currentPath } = ctx;

  // Inline label (NOT SectionLabel — we don't want the hairline)
  const wrap = container.createEl("div");
  wrap.style.cssText = "margin-top:12px;";

  const lbl = wrap.createEl("div");
  lbl.textContent = "Recent";
  lbl.style.cssText = "text-transform:uppercase; letter-spacing:0.03em; font-size:0.72em; color:var(--text-muted); margin-bottom:4px;";

  const list = wrap.createEl("div");
  list.style.cssText = "display:flex; flex-direction:column;";

  const ICON = (customJS.ProjectChromeBar && customJS.ProjectChromeBar.ICON) || {};
  const iconFor = (kind) => kind === "meeting" ? ICON.project : (kind === "task" ? ICON.task : ICON.docs);

  for (const item of items) {
    const row = list.createEl("div");
    row.__isRecentRow = true;
    row.style.cssText = "display:flex; align-items:center; gap:8px; padding:4px 0; cursor:pointer;";

    const ic = row.createEl("div");
    ic.style.cssText = "color:var(--text-muted); font-size:0;";
    if (typeof ic.innerHTML !== "undefined") ic.innerHTML = iconFor(item.kind);

    const title = row.createEl("div");
    title.textContent = String(item.page?.file?.name || "");
    title.style.cssText = "flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.9em;";

    const time = row.createEl("div");
    time.textContent = ProjectDashboard._relTime(item.mtime);
    time.style.cssText = "margin-left:auto; font-size:0.75em; color:var(--text-muted);";

    row.addEventListener("click", () => {
      try {
        const cp = (typeof app !== "undefined" ? app : global.app);
        cp.workspace.openLinkText(item.page.file.path, currentPath, false);
      } catch (_e) {}
    });
  }
}

static _relTime(ts) {
  const now = Date.now();
  const delta = Math.max(0, Math.floor((now - Number(ts || 0)) / 1000));
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  const days = Math.floor(delta / 86400);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  return new Date(Number(ts)).toISOString().split("T")[0];
}
```

- [ ] **Step 4: Verify passes**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(project): ProjectDashboard._renderRecent — mtime-sorted row list"
```

---

## Task 8: `_renderLinks` — chips, empty-hides

**Files:**
- Modify: `platform/blueprints/project/helpers/project-dashboard.js`
- Modify: `platform/test/harness/run-project.js`

- [ ] **Step 1: Write failing tests**

```javascript
{
  const dash = new ProjectDashboard();
  const container = makeEl("div");
  const links = [
    "https://example.com",
    "[GitHub](https://github.com)",
    "[[Related Note]]",
  ];
  dash._renderLinks(container, { currentPath: "cp.md" }, links);
  const chips = container.__descendants().filter(el => el.__isLinkChip);
  ok('PROJDASH-8a three chips', chips.length === 3);
  ok('PROJDASH-8b chip labels', chips.map(c => c.textContent).join("|") === "example.com|GitHub|Related Note");

  const empty = makeEl("div");
  dash._renderLinks(empty, { currentPath: "cp.md" }, []);
  ok('PROJDASH-8c empty renders nothing', empty.__children.length === 0);
  const empty2 = makeEl("div");
  dash._renderLinks(empty2, { currentPath: "cp.md" }, null);
  ok('PROJDASH-8d null renders nothing', empty2.__children.length === 0);
}
```

- [ ] **Step 2: Verify failing**

- [ ] **Step 3: Implement**

```javascript
_renderLinks(container, ctx, links) {
  const parsed = ProjectDashboard._parseLinks(links);
  if (!parsed || parsed.length === 0) return;
  const { currentPath } = ctx;

  const wrap = container.createEl("div");
  wrap.style.cssText = "margin-top:12px;";

  const lbl = wrap.createEl("div");
  lbl.textContent = "Links";
  lbl.style.cssText = "text-transform:uppercase; letter-spacing:0.03em; font-size:0.72em; color:var(--text-muted); margin-bottom:6px;";

  const row = wrap.createEl("div");
  row.style.cssText = "display:flex; flex-wrap:wrap; gap:6px;";

  for (const link of parsed) {
    const chip = row.createEl("div");
    chip.__isLinkChip = true;
    chip.textContent = link.label;
    chip.style.cssText = "display:inline-block; padding:3px 10px; border-radius:999px; " +
      "background:var(--background-modifier-hover); color:var(--text-normal); " +
      "font-size:0.78em; cursor:pointer;";
    chip.addEventListener("click", () => {
      try {
        if (link.kind === "external") {
          if (typeof window !== "undefined" && window.open) window.open(link.target, "_blank");
        } else {
          const cp = (typeof app !== "undefined" ? app : global.app);
          cp.workspace.openLinkText(link.target, currentPath, false);
        }
      } catch (_e) {}
    });
  }
}

static _parseLinks(links) {
  const raw = Array.isArray(links) ? links : (typeof links === "string" ? [links] : []);
  const out = [];
  for (const item of raw) {
    if (!item) continue;
    const s = String(item).trim();
    if (!s) continue;
    // [Label](url)
    const md = s.match(/^\[([^\]]+)\]\((.+)\)$/);
    if (md) { out.push({ kind: "external", label: md[1], target: md[2] }); continue; }
    // [[Wiki]] or [[Wiki|Alias]]
    const wl = s.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
    if (wl) { out.push({ kind: "internal", label: wl[2] || wl[1], target: wl[1] }); continue; }
    // bare URL — use hostname
    try {
      const u = new URL(/^https?:/.test(s) ? s : `https://${s}`);
      out.push({ kind: "external", label: u.hostname, target: u.toString() });
    } catch (_e) {
      out.push({ kind: "external", label: s, target: s });
    }
  }
  return out;
}
```

- [ ] **Step 4: Verify passes**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(project): ProjectDashboard._renderLinks — chips + parser (md/wiki/bare)"
```

---

## Task 9: Wire `render()` — full happy-path test

**Files:**
- Modify: `platform/blueprints/project/helpers/project-dashboard.js`
- Modify: `platform/test/harness/run-project.js`

- [ ] **Step 1: Write failing test**

```javascript
{
  const dash = new ProjectDashboard();
  const container = makeEl("div");
  const dv = {
    container,
    current: () => ({
      status: "in-progress",
      workstreams: ["ws1", "ws2"],
      links: ["https://foo.com"],
      file: { path: "spice/projects/foo/Foo.md", name: "Foo" },
    }),
    pages: (q) => {
      if (q.includes("/docs"))   return _stubListWithMtimes([{ ts: 3000, name: "doc-a" }], "doc-note");
      if (q.includes("meetings/notes")) return _stubListWithMtimes([{ ts: 5000, name: "mtg-a", project: "[[Foo]]" }], "meeting");
      if (q.includes("/tasks"))  return _stubListWithMtimes([], "task-note");
      return _stubList(0, null);
    },
  };
  global.app = {
    workspace: { openLinkText: () => {} },
    vault: {
      read: async (f) => "## Todo\n- [ ] a\n- [ ] b\n",
      getAbstractFileByPath: (p) => p.endsWith("board.md") ? { path: p } : null,
    },
    fileManager: { processFrontMatter: async () => {} },
  };

  await dash.render(dv);
  const pill = container.__descendants().find(el => el.__isStatusPill);
  const tiles = container.__descendants().filter(el => el.__isTile);
  const rows  = container.__descendants().filter(el => el.__isRecentRow);
  const chips = container.__descendants().filter(el => el.__isLinkChip);

  ok('PROJDASH-9a status pill rendered', pill && pill.textContent === "in-progress");
  ok('PROJDASH-9b tiles rendered',       tiles.length === 5);
  ok('PROJDASH-9c recent rows',          rows.length === 2);
  ok('PROJDASH-9d links chips',          chips.length === 1);
}
```

- [ ] **Step 2: Verify failing**

- [ ] **Step 3: Implement full `render()`**

```javascript
async render(dv) {
  try {
    // Cold-load safety
    let cur = null;
    try { cur = customJS.RenderSafe ? customJS.RenderSafe.page(dv) : dv.current(); } catch (_e) { cur = dv.current(); }
    if (!cur || !cur.file) return;

    const currentPath = String(cur.file.path || "");
    const projectName = String(cur.file.name || "");
    const parts = currentPath.split("/");
    // spice/projects/<slug>/<Name>.md → folder = spice/projects/<slug>, slug = <slug>
    const slug = parts[2] || "";
    const folder = parts.slice(0, 3).join("/");

    // Get real file handle for status writes
    const realApp = (typeof app !== "undefined" ? app : global.app);
    const file = realApp.vault.getAbstractFileByPath(currentPath) || cur.file;

    const ctx = {
      app: realApp,
      file,
      currentPage: cur,
      currentPath,
      projectName,
      slug,
      folder,
    };

    // Card container
    const c = dv.container;
    const card = c.createEl("div");
    card.style.cssText = "background:var(--background-secondary); border-radius:10px; padding:12px; max-width:720px;";

    // Delegate to sub-renders
    this._renderHeader(card, ctx);
    const counts = await this._counts(dv, ctx);
    this._renderTiles(card, ctx, counts);
    const items = this._recent(dv, ctx);
    this._renderRecent(card, ctx, items);
    this._renderLinks(card, ctx, cur.links);
  } catch (_e) {}
}
```

- [ ] **Step 4: Verify all 4 tests pass**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(project): ProjectDashboard.render — wire header/tiles/recent/links pipeline"
```

---

## Task 10: Template + manifest + retire helpers

**Files:**
- Modify: `platform/blueprints/project/templates/Template, Project.md`
- Modify: `platform/blueprints/project/manifest.json`
- Delete: `platform/blueprints/project/helpers/project-activity-panel.js`
- Delete: `platform/blueprints/project/helpers/project-open-tasks.js`
- Delete: `platform/blueprints/project/helpers/project-meetings-panel.js`
- Delete: `platform/blueprints/project/helpers/project-links-panel.js`
- Delete: `platform/blueprints/project/helpers/project-status-widget.js`

- [ ] **Step 1: Read Template body first**

Run: `cat "platform/blueprints/project/templates/Template, Project.md"`

Note the exact block boundaries between ChromeBar / StatusWidget / ActivityPanel / OpenTasks / MeetingsPanel / LinksPanel dataviewjs blocks. Preserve any surrounding user content (H1, frontmatter). If ANY block is not one of the 5 targets, STOP and ask.

- [ ] **Step 2: Modify template**

Replace the 5 dataviewjs blocks (StatusWidget + Activity + OpenTasks + Meetings + Links) with a single block:

````markdown
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectDashboard" });
```
````

Keep the ProjectChromeBar block above it as-is. Do not touch frontmatter.

- [ ] **Step 3: Grep for external consumers of retired classes**

```bash
grep -rn "ProjectStatusWidget\|ProjectActivityPanel\|ProjectOpenTasks\|ProjectMeetingsPanel\|ProjectLinksPanel" \
  --include="*.js" --include="*.json" --include="*.md" \
  platform/ ranch/
```

If any hits outside `helpers/` or the templates/manifest, STOP and evaluate — that's a hidden consumer we need to migrate first.

- [ ] **Step 4: Delete 5 helper files**

```bash
git rm platform/blueprints/project/helpers/project-activity-panel.js
git rm platform/blueprints/project/helpers/project-open-tasks.js
git rm platform/blueprints/project/helpers/project-meetings-panel.js
git rm platform/blueprints/project/helpers/project-links-panel.js
git rm platform/blueprints/project/helpers/project-status-widget.js
```

- [ ] **Step 5: Update manifest.json**

- Bump `version` from `1.49.1` to `1.50.0`.
- In `customjs_classes` list, REMOVE any of these that appear: `ProjectActivityPanel`, `ProjectOpenTasks`, `ProjectMeetingsPanel`, `ProjectLinksPanel`, `ProjectStatusWidget`.
- ADD `"ProjectDashboard"` alphabetically or at end (match existing conventions in the list).

- [ ] **Step 6: Preflight — run harness against retired-classes check**

```bash
node platform/test/harness/run-project.js
```

Expected: all PROJDASH-* tests pass. Any residual test referencing retired classes should also be scrubbed.

- [ ] **Step 7: Commit**

```bash
git add platform/blueprints/project/
git commit -m "refactor(project): retire StatusWidget + 4 panels, wire ProjectDashboard template"
```

---

## Task 11: Install heal — `applyProjectDashboardConformanceHeal`

**Files:**
- Modify: `platform/install.js`
- Create: `platform/test/seed-vault/spice/projects/dash-legacy/Dash Legacy.md` (legacy body fixture)
- Create: `platform/test/seed-vault/spice/projects/dash-modern/Dash Modern.md` (already-migrated fixture)
- Create: `platform/test/harness/run-project-dashboard-heal.js` (new heal-focused harness)
- Modify: `package.json` — add `test:project-dashboard-heal` script

- [ ] **Step 1: Read heal reference**

Grep `platform/install.js` for `applyTripsConformanceHeal`, `applyReaderScaffoldHeal`, or `applyDocsHubModernizeHeal`. Read the shortest/clearest one to copy its structure (backup pattern, dry-run flag, error logging).

- [ ] **Step 2: Create legacy seed fixture**

```markdown
---
title: Dash Legacy
type: project
status: in-progress
created_at: 2026-01-01T00:00:00.000Z
---

# Dash Legacy

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectStatusWidget" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectActivityPanel" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectOpenTasks" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectMeetingsPanel" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectLinksPanel" });
```
```

Note the fenced code blocks must be preserved literally in the file — use double backticks to escape when copying.

- [ ] **Step 3: Create modern seed fixture (already migrated)**

```markdown
---
title: Dash Modern
type: project
status: in-progress
created_at: 2026-01-01T00:00:00.000Z
---

# Dash Modern

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectDashboard" });
```
```

- [ ] **Step 4: Write failing heal test**

Create `platform/test/harness/run-project-dashboard-heal.js`:

```javascript
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { pass += 1; console.log("OK  " + label); }
  else      { fail += 1; console.log("FAIL " + label + (detail ? " :: " + detail : "")); }
}

// Bring in install.js exports
const install = require("../../install.js");
const applyHeal = install.applyProjectDashboardConformanceHeal;
if (!applyHeal) { console.log("FAIL applyProjectDashboardConformanceHeal not exported"); process.exit(1); }

// Build in-memory app stub around seed-vault directory
const SEED_DIR = path.resolve(__dirname, "../seed-vault");

function makeAppSnapshot() {
  const files = {};
  function walk(dir, prefix = "") {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full, rel);
      else files[rel] = fs.readFileSync(full, "utf8");
    }
  }
  walk(SEED_DIR);
  return files;
}

async function run() {
  const before = makeAppSnapshot();

  const writes = {};
  const app = {
    vault: {
      getMarkdownFiles: () => Object.keys(before).filter(p => p.endsWith(".md")).map(p => ({ path: p })),
      read: async (f) => before[f.path],
      modify: async (f, content) => { writes[f.path] = content; },
      getAbstractFileByPath: (p) => before[p] !== undefined ? { path: p } : null,
      create: async (p, content) => { writes[p] = content; },
    },
    metadataCache: {
      getFileCache: (file) => {
        const content = before[file.path] || "";
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!fmMatch) return null;
        const fm = {};
        for (const line of fmMatch[1].split("\n")) {
          const m = line.match(/^([\w-]+):\s*(.*)$/);
          if (m) fm[m[1]] = m[2];
        }
        return { frontmatter: fm };
      },
    },
  };

  // First run — legacy note migrated, modern note untouched, .bak written for legacy
  await applyHeal(app);
  ok('HEAL-1 legacy migrated', writes["spice/projects/dash-legacy/Dash Legacy.md"]?.includes('class: "ProjectDashboard"'));
  ok('HEAL-2 modern untouched', writes["spice/projects/dash-modern/Dash Modern.md"] === undefined);
  ok('HEAL-3 backup written for legacy', writes["spice/projects/dash-legacy/Dash Legacy.md.bak"] !== undefined);
  ok('HEAL-4 chromebar preserved', writes["spice/projects/dash-legacy/Dash Legacy.md"]?.includes('class: "ProjectChromeBar"'));
  ok('HEAL-5 legacy blocks removed', !writes["spice/projects/dash-legacy/Dash Legacy.md"]?.includes('class: "ProjectStatusWidget"'));

  // Second run — idempotent, no writes
  const priorWrites = { ...writes };
  Object.keys(writes).forEach(k => delete writes[k]);
  // Now the vault "sees" the migrated content
  before["spice/projects/dash-legacy/Dash Legacy.md"] = priorWrites["spice/projects/dash-legacy/Dash Legacy.md"];
  await applyHeal(app);
  ok('HEAL-6 idempotent — no writes on 2nd run', Object.keys(writes).length === 0);

  process.exit(fail === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
```

Add to `package.json` scripts:

```json
"test:project-dashboard-heal": "node platform/test/harness/run-project-dashboard-heal.js"
```

- [ ] **Step 5: Verify failing**

Run: `node platform/test/harness/run-project-dashboard-heal.js`
Expected: FAIL — `applyProjectDashboardConformanceHeal` not exported.

- [ ] **Step 6: Implement heal**

Add to `platform/install.js`:

```javascript
async function applyProjectDashboardConformanceHeal(app) {
  const DASHBOARD_BLOCK = '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "ProjectDashboard" });\n```';
  const LEGACY_CLASSES = ["ProjectStatusWidget", "ProjectActivityPanel", "ProjectOpenTasks", "ProjectMeetingsPanel", "ProjectLinksPanel"];

  let migrated = 0, skipped = 0, errored = 0;

  const files = app.vault.getMarkdownFiles ? app.vault.getMarkdownFiles() : [];
  for (const file of files) {
    try {
      const cache = app.metadataCache?.getFileCache?.(file);
      const fm = cache?.frontmatter || {};
      if (fm.type !== "project") continue;

      const content = await app.vault.read(file);
      if (content.includes('class: "ProjectDashboard"')) { skipped += 1; continue; }

      // Strip legacy dataviewjs blocks
      const blockRegex = /```dataviewjs\s*[\s\S]*?```/g;
      let newContent = content.replace(blockRegex, (match) => {
        for (const cls of LEGACY_CLASSES) {
          if (match.includes(`class: "${cls}"`)) return "";
        }
        return match;
      });

      // Collapse resulting multiple blank lines
      newContent = newContent.replace(/\n{3,}/g, "\n\n");

      // Insert dashboard block right after the ChromeBar block
      const chromebarRegex = /(```dataviewjs\s*[\s\S]*?class:\s*"ProjectChromeBar"[\s\S]*?```)/;
      if (chromebarRegex.test(newContent)) {
        newContent = newContent.replace(chromebarRegex, `$1\n\n${DASHBOARD_BLOCK}`);
      } else {
        // No ChromeBar block — prepend after frontmatter
        const fmEndMatch = newContent.match(/^---\n[\s\S]*?\n---\n/);
        if (fmEndMatch) {
          newContent = fmEndMatch[0] + "\n" + DASHBOARD_BLOCK + "\n" + newContent.slice(fmEndMatch[0].length);
        } else {
          newContent = DASHBOARD_BLOCK + "\n\n" + newContent;
        }
      }

      // Write backup then updated content
      const bakPath = file.path + ".bak";
      if (app.vault.create) {
        try { await app.vault.create(bakPath, content); } catch (_e) {}
      }
      await app.vault.modify(file, newContent);
      migrated += 1;
    } catch (_e) {
      errored += 1;
    }
  }
  console.log(`[project-dashboard-heal] ${migrated} migrated · ${skipped} skipped · ${errored} errored`);
}

// Export
if (typeof module !== "undefined") {
  module.exports.applyProjectDashboardConformanceHeal = applyProjectDashboardConformanceHeal;
}
```

Then WIRE it into the install sequence: find the block in `install.js` where other conformance heals are called (grep for `applyTripsConformanceHeal`) and add `await applyProjectDashboardConformanceHeal(app);` in the same phase.

- [ ] **Step 7: Verify heal test passes**

Run: `node platform/test/harness/run-project-dashboard-heal.js`
Expected: all 6 tests pass.

- [ ] **Step 8: Commit**

```bash
git add platform/install.js platform/test/harness/run-project-dashboard-heal.js platform/test/seed-vault/spice/projects/dash-legacy platform/test/seed-vault/spice/projects/dash-modern package.json
git commit -m "feat(project): install heal migrates legacy panel stack → ProjectDashboard"
```

---

## Task 12: Playwright visual verification (mobile wrap + dark theme)

**Files:**
- Create: `platform/test/visual/project-dashboard.html`
- Create: `platform/test/visual/project-dashboard.spec.md` (manual run doc)

- [ ] **Step 1: Build faithful HTML replica**

Create `platform/test/visual/project-dashboard.html` — a standalone page with the dashboard rendered by hand-copied HTML (or a minimal harness that loads the class). Include CSS var definitions matching Obsidian's dark theme (background-secondary, primary, modifier-border, interactive-accent, text-muted, text-faint, color-blue/green/red/orange/purple, background-modifier-border-hover, background-modifier-hover).

Sample scaffold:

```html
<!doctype html>
<html><head>
<style>
:root {
  --background-primary: #202124;
  --background-secondary: #262626;
  --background-modifier-border: #383838;
  --background-modifier-border-hover: #4a4a4a;
  --background-modifier-hover: #333333;
  --interactive-accent: #7f6df2;
  --text-normal: #dcddde;
  --text-muted: #a3a3a3;
  --text-faint: #6b6b6b;
  --text-on-accent: #ffffff;
  --color-blue: #4c78e6;
  --color-green: #58cc7c;
  --color-red: #e15c5c;
  --color-orange: #f0a04b;
  --color-purple: #a56bd8;
}
body { background: var(--background-primary); color: var(--text-normal); font-family: -apple-system, sans-serif; padding: 16px; }
</style>
</head>
<body>
  <div id="dashboard"></div>
  <script>
    // Bootstrap the dashboard via mocked customJS + dv, mirroring the harness stubs.
    // ... hand-fill with 5 tiles, 5 rows, 2 chips
  </script>
</body></html>
```

- [ ] **Step 2: Serve + screenshot**

Run: `python3 -m http.server 8765 --directory platform/test/visual`

Then via Playwright:

```
mcp__plugin_playwright_playwright__browser_navigate → http://localhost:8765/project-dashboard.html
mcp__plugin_playwright_playwright__browser_resize → 390x800
mcp__plugin_playwright_playwright__browser_take_screenshot → project-dashboard-mobile.png
mcp__plugin_playwright_playwright__browser_resize → 720x600
mcp__plugin_playwright_playwright__browser_take_screenshot → project-dashboard-desktop.png
```

- [ ] **Step 3: Assert visually**

Verify (by inspecting the screenshots):
- Mobile 390px: tiles wrap 3+2.
- Desktop 720px: tiles in one row of 5.
- Status pill has visible color contrast on dark background.
- Count chips visible (accent color on background-primary).
- No visible divider between ChromeBar area (unrendered here) and dashboard card.
- Divider inside the card (if any) invisible / not present.

- [ ] **Step 4: If visual regression found — fix and re-screenshot**

Common issues per `lesson_verify_chrome_visually_with_playwright_harness`:
- `min-width` too small → tiles collapse; bump to 116px.
- Accent color unreadable on dark → verify contrast, add fallback.
- Count chip cut off → increase tile padding.

- [ ] **Step 5: Commit visuals**

```bash
git add platform/test/visual/
git commit -m "test(project): Playwright visual harness for ProjectDashboard (mobile+desktop)"
```

---

## Task 13: Preflight, PR, merge, release, deploy

**Files:** none new; running scripts.

- [ ] **Step 1: Run full preflight**

```bash
npm run status
npm run lint-schemas 2>&1 | tail -20
node platform/test/harness/run-project.js
node platform/test/harness/run-project-dashboard-heal.js
```

Expected: everything green. If any test fails, back up to the relevant task and fix.

- [ ] **Step 2: Merge origin/main to detect autoloop drift**

```bash
git fetch origin
git merge origin/main --no-edit
```

If merge conflicts, resolve carefully — autoloop may have touched adjacent files.

- [ ] **Step 3: Push branch**

```bash
git push -u origin feature/project-dashboard
```

- [ ] **Step 4: Open PR**

```bash
gh pr create --title "feat(project): compact ProjectDashboard replaces StatusWidget + 4 panels" \
  --body "$(cat <<'EOF'
## Summary

- New `ProjectDashboard` at top of every project note: status pill + 5 clickable nav tiles (Docs / Board / To-Do / Map / Meetings) + Recent-activity strip + Links chips.
- Replaces `ProjectStatusWidget`, `ProjectActivityPanel`, `ProjectOpenTasks`, `ProjectMeetingsPanel`, `ProjectLinksPanel` — 5 blocks collapse to 1.
- Actionable counts (open) for Board + To-Do; totals for Docs / Map / Meetings.
- Install heal `applyProjectDashboardConformanceHeal` migrates existing project notes idempotently (`.bak` backup, ChromeBar preserved).
- No new mechanism; reuses `chrome-bar` icons, `menu-popover`, `render-safe`, `section-label`.

Spec: `Docs/superpowers/specs/2026-07-13-project-dashboard-design.md`
Plan: `Docs/superpowers/plans/2026-07-13-project-dashboard.md`

## Test plan

- [x] `node platform/test/harness/run-project.js` — PROJDASH-1…9 green
- [x] `node platform/test/harness/run-project-dashboard-heal.js` — HEAL-1…6 green
- [x] Playwright visual harness at 390px + 720px viewports

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Wait for CI green**

Poll every ~120s:

```bash
gh pr checks --watch
```

If red, diagnose + fix + repush + wait.

- [ ] **Step 6: Merge PR (admin if needed)**

```bash
gh pr merge --squash --delete-branch
```

If pipeline requires admin merge because CI is technically passing but the branch fell BEHIND main via autoloop, use `--admin`.

- [ ] **Step 7: Wait for release PR — DO NOT hand-merge**

The bumper opens a release PR against main. It **auto-merges** once its CI is green. Do NOT `gh pr merge` it manually. Poll:

```bash
gh pr list --state open --label release
gh pr checks <release-pr-num> --watch
```

- [ ] **Step 8: Wait for tap PR + auto-merge**

Tap PR opens against `will-fell/homebrew-sauce` after release PR merges. Same rule — pipeline auto-merges. Poll:

```bash
gh -R will-fell/homebrew-sauce pr list --state open
```

- [ ] **Step 9: Update brew + deploy consumers**

```bash
brew update && brew upgrade sauce
sauce --version
```

Then, from EACH consumer vault (accuris, headspace, ero):

```bash
bash -c 'cd /Users/willfellhoelter/projects/repos/accuris && sauce update --force'
bash -c 'cd /Users/willfellhoelter/projects/repos/headspace && sauce update --force'
bash -c 'cd /Users/willfellhoelter/projects/repos/ero && sauce update --force'
```

(Verify actual consumer vault paths from `Docs/agent-guides/vault-paths.md` if uncertain.)

- [ ] **Step 10: Verify deploy allOk**

After `sauce update --force` for each vault, check the CLI's final line — expect `allOk` per vault. If any vault reports errors (e.g. missing dep pins), diagnose per memory landmine `lesson_redeploy_version_bump_needs_pin_bump`.

- [ ] **Step 11: Verify each vault's project note renders new dashboard**

For at least one project note in each of the 3 consumer vaults, verify the healed body:

```bash
grep -l 'type: project' <vault>/spice/projects/*/*.md | head -3 | while read f; do
  echo "=== $f ==="
  grep -c 'class: "ProjectDashboard"' "$f"
  grep -c 'class: "ProjectStatusWidget"' "$f"
done
```

Expected: ProjectDashboard count = 1, ProjectStatusWidget count = 0, per healed note.

- [ ] **Step 12: Report back to user**

Include:
- Workshop version shipped (from release PR).
- Deploy results per vault (allOk?).
- Any notes migrated / skipped counts from heal.
- Cmd+R reminder for the user to reload consumer vaults.
