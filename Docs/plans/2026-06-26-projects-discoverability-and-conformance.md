# Projects Discoverability + Hub Name Conformance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make projects easy to find (hub recent-strip) and projects' contents visible at a glance (Recent activity + Open tasks panels), and fix the legacy `Project.md` hubs that surface as literal "Project" in pickers.

**Architecture:** Two independent workstreams. WS1 = two new CustomJS helpers + a hub-helper tweak + a template change + an idempotent install heal that injects the two blocks into existing hubs (anchored before the universal `ProjectMeetingsPanel` block). WS2 = harden every project enumerator to prefer frontmatter `name:`, upgrade the name backfill to repair mis-stamped `project_name`, and (manual, post-deploy) rename 6 legacy hubs in Obsidian.

**Tech Stack:** CustomJS helpers (loaded via `ranch/views/customjs-guard`), Dataview, `BeaconCards` + `SectionLabel` mechanisms, Node zero-dep behavioral harnesses, `platform/install.js` heals.

**Spec:** `Docs/prompts/2026-06-26-projects-blueprint-discoverability-design.md` (rationale; do not duplicate it here).

**Conventions (non-negotiable):** see `Docs/agent-guides/code-conventions.md` + `project-blueprint-ui.md`. Single class per helper file (the file loads under `(${file})` — NO file-scope helpers before the class). Empty output renders NOTHING. Card meta: lowercase, ` · `, no emoji. Heals: per-note try/catch, `.sauce-backup` snapshot, history events, NEVER throw. No manual versioning/tagging. No Co-Authored-By trailer in this repo.

---

## Task 1: `ProjectActivityPanel` helper (Surface B)

**Files:**
- Create: `platform/blueprints/project/helpers/project-activity-panel.js`
- Modify: `platform/blueprints/project/manifest.json` (add to `files[]`)
- Modify: `platform/test/run-project-render-guards.js` (add to `widgets[]`)

- [ ] **Step 1: Create the helper**

```js
// project-activity-panel.js — ProjectActivityPanel (Surface B).
//
// "Recent activity" panel on the project hub: the project's most-recently-
// touched docs + linked meetings + task notes, newest-first, capped at 5.
// SectionLabel + BeaconCards; empty-renders-nothing. Deliberately NOT the
// vault-wide time-windowed activity-feed mechanism (wrong axis — see the
// 2026-06-26 design spec). Single class per file (customjs contract).
class ProjectActivityPanel {
  async render(dv, opts = {}) {
    const cur = dv.current && dv.current();
    if (!cur || !cur.file) return;            // cold-load guard (landmine #1/#2)
    const folder = cur.file.folder;
    if (!folder) return;
    const currentPath = cur.file.path;
    const projectName = cur.name || cur.file.name;

    const rows = [];
    try {
      for (const p of dv.pages(`"${folder}/docs"`).where((p) => p && p.type === "doc-note")) {
        rows.push(this._row(p, "doc"));
      }
    } catch (_e) {}
    try {
      for (const p of dv.pages('"spice/meetings/notes"')
          .where((p) => p && p.type === "meeting" && this._projectMatches(p.project, currentPath, projectName))) {
        rows.push(this._row(p, "mtg"));
      }
    } catch (_e) {}
    try {
      for (const p of dv.pages(`"${folder}/tasks"`).where((p) => p && p.type === "task-note")) {
        rows.push(this._row(p, "task"));
      }
    } catch (_e) {}

    const valid = rows.filter((r) => r && r.mtime > 0);
    if (valid.length === 0) return;            // empty-renders-nothing

    valid.sort((a, b) => b.mtime - a.mtime);
    const top = valid.slice(0, 5);
    const byPath = new Map(top.map((r) => [r.page.file.path, r.tag]));

    customJS.SectionLabel.render(dv, { text: "Recent activity" });

    await customJS.BeaconCards.render(dv, {
      pages: top.map((r) => r.page),
      layout: "row",
      title: (p) => {
        const n = String(p.file.name || "");
        return n.replace(/-\d{4}-\d{2}-\d{2}$/, "") || p.file.name;
      },
      meta: (p) => {
        const tag = byPath.get(p.file.path) || "";
        const label = { doc: "doc", mtg: "meeting", task: "task" }[tag] || tag;
        const ts = (p.file.mtime && p.file.mtime.ts) ? p.file.mtime.ts : 0;
        const when = ts ? window.moment(ts).fromNow() : "";
        return when ? `${label} · ${when}` : label;
      },
      target: (p) => p.file.path,
    });
  }

  _row(p, tag) {
    const mtime = (p && p.file && p.file.mtime && p.file.mtime.ts) ? p.file.mtime.ts : 0;
    return { page: p, tag, mtime };
  }

  // Verbatim port of ProjectMeetingsPanel._projectMatches (3 field shapes).
  _projectMatches(field, currentPath, projectName) {
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
}
```

- [ ] **Step 2: Wire the manifest.** Read `platform/blueprints/project/manifest.json`, find the `files[]` entry for `project-meetings-panel.js`, and add an identical-shaped entry for `project-activity-panel.js` (source `platform/blueprints/project/helpers/project-activity-panel.js` → dest `{{scripts_path}}/project/project-activity-panel.js`, matching the exact key names the sibling uses).

- [ ] **Step 3: Add to render-guard harness.** In `platform/test/run-project-render-guards.js`, add to the `widgets` array:

```js
    { name: 'ProjectActivityPanel',       path: 'platform/blueprints/project/helpers/project-activity-panel.js' },
```

- [ ] **Step 4: Run the guards + contract.**

Run: `node platform/test/run-project-render-guards.js && node platform/test/run-customjs-contract.js`
Expected: PASS (the helper's leading `dv.current()` guard satisfies the render-guard; single-class file satisfies the contract).

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/project/helpers/project-activity-panel.js platform/blueprints/project/manifest.json platform/test/run-project-render-guards.js
git commit -m "feat(project): ProjectActivityPanel — recent docs/meetings/tasks panel"
```

---

## Task 2: `ProjectOpenTasks` helper (Surface C)

**Files:**
- Create: `platform/blueprints/project/helpers/project-open-tasks.js`
- Modify: `platform/blueprints/project/manifest.json`
- Modify: `platform/test/run-project-render-guards.js`

- [ ] **Step 1: Create the helper**

```js
// project-open-tasks.js — ProjectOpenTasks (Surface C).
//
// "Open tasks" panel on the project hub: top unchecked tasks from the project's
// Kanban board <slug>-board.md (excluding the Completed lane), in board order.
// Reuses the same board-parse shape as ProjectsHubCards. SectionLabel +
// BeaconCards; empty-renders-nothing. Single class per file.
class ProjectOpenTasks {
  async render(dv, opts = {}) {
    const cur = dv.current && dv.current();
    if (!cur || !cur.file) return;            // cold-load guard
    const folder = cur.file.folder;
    if (!folder) return;
    const slug = folder.split("/").pop();
    const boardPath = `${folder}/${slug}-board.md`;
    const boardFile = app.vault.getAbstractFileByPath(boardPath);
    if (!boardFile) return;                    // empty-renders-nothing

    let content = "";
    try { content = await app.vault.read(boardFile); } catch (_e) { return; }

    const open = [];
    let lane = "";
    for (const line of content.split("\n")) {
      if (line.startsWith("## ")) { lane = line.replace("## ", "").trim(); continue; }
      const m = line.match(/^- \[ \] (.+)$/);
      if (m && lane !== "Completed") {
        open.push({ text: m[1].trim(), lane });
        if (open.length >= 5) break;
      }
    }
    if (open.length === 0) return;             // empty-renders-nothing

    customJS.SectionLabel.render(dv, { text: "Open tasks" });

    const pages = open.map((t) => ({
      file: { name: t.text, path: boardPath, folder },
      _lane: t.lane,
    }));

    await customJS.BeaconCards.render(dv, {
      pages,
      layout: "row",
      title: (p) => p.file.name,
      meta: (p) => p._lane || "",
      target: (p) => p.file.path,
    });
  }
}
```

- [ ] **Step 2: Wire the manifest.** Add a `files[]` entry for `project-open-tasks.js` mirroring Task 1 Step 2.

- [ ] **Step 3: Add to render-guard harness.** In `run-project-render-guards.js` `widgets`:

```js
    { name: 'ProjectOpenTasks',           path: 'platform/blueprints/project/helpers/project-open-tasks.js' },
```

- [ ] **Step 4: Run guards + contract.**

Run: `node platform/test/run-project-render-guards.js && node platform/test/run-customjs-contract.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/project/helpers/project-open-tasks.js platform/blueprints/project/manifest.json platform/test/run-project-render-guards.js
git commit -m "feat(project): ProjectOpenTasks — top open board tasks panel"
```

---

## Task 3: Hub "Recently active" strip (Surface A)

**Files:**
- Modify: `platform/blueprints/project/helpers/projects-hub-cards.js` (inside `_renderInner`, after `enriched`/`this._lookup` are built, BEFORE `this._renderChips(dv, statusFiltered)`)

The strip reuses `enriched` (already computed with `latestMtime` per project). Render it at the very top of the results, recency-sorted, capped at 4, drawing from the current filtered set so it stays consistent with the grid.

- [ ] **Step 1: Add the strip renderer method** to the `ProjectsHubCards` class (place after `_renderGroupSelector`):

```js
    _renderRecentStrip(dv, enriched) {
        if (!enriched || enriched.length === 0) return;   // empty-renders-nothing
        const sorted = [...enriched].sort((a, b) => {
            const ma = (a.latestMtime && a.latestMtime.ts) || 0;
            const mb = (b.latestMtime && b.latestMtime.ts) || 0;
            return mb - ma;
        }).slice(0, 4);

        customJS.SectionLabel.render(dv, { text: "Recently active" });
        const bar = dv.container.createEl("div");
        bar.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 10px 0;";
        for (const e of sorted) {
            const p = e.project;
            const name = p.name || p.file.name;
            const when = (e.latestMtime && e.latestMtime.ts) ? window.moment(e.latestMtime.ts).fromNow() : "";
            const chip = bar.createEl("span");
            chip.textContent = when ? `${name} · ${when}` : name;
            chip.style.cssText = "cursor:pointer;padding:3px 12px;border-radius:12px;font-size:0.85em;background:var(--background-secondary);color:var(--text-normal);border:1px solid var(--background-modifier-border);";
            chip.addEventListener("click", () => {
                try { app.workspace.openLinkText(p.file.path, ""); } catch (_e) {}
            });
        }
    }
```

- [ ] **Step 2: Call it** in `_renderInner`, immediately after `this._lookup = new Map(...)` is assigned and before `this._renderChips(dv, statusFiltered);`. Insert:

```js
        this._renderRecentStrip(dv, enriched);
```

- [ ] **Step 3: Manual sanity (no harness — DOM render).** Confirm the file still parses and the contract holds.

Run: `node platform/test/run-customjs-contract.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add platform/blueprints/project/helpers/projects-hub-cards.js
git commit -m "feat(project): hub 'Recently active' strip (top-4 recency, respects filters)"
```

---

## Task 4: Project template — wire the two new blocks

**Files:**
- Modify: `platform/blueprints/project/templates/Project.md`

- [ ] **Step 1: Insert the two blocks** between the `ProjectStatusWidget` block and the `ProjectMeetingsPanel` block. After the `ProjectStatusWidget` fenced block, insert:

````markdown

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectActivityPanel" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectOpenTasks" });
```
````

Resulting block order: Breadcrumb → SpaceNavButtons → ProjectNavButtons → ProjectStatusWidget → **ProjectActivityPanel → ProjectOpenTasks** → ProjectMeetingsPanel → ProjectWorkstreamManager.

- [ ] **Step 2: Commit**

```bash
git add "platform/blueprints/project/templates/Project.md"
git commit -m "feat(project): template wires ProjectActivityPanel + ProjectOpenTasks"
```

---

## Task 5: Install heal `applyProjectActivityPanelsHeal` + harness

**Files:**
- Modify: `platform/install.js` (new function near `applyProjectMeetingsPanelHeal` ~line 2418; call site ~line 1154; export ~line 14228)
- Create: `platform/test/run-project-activity-panels-heal.js`
- Modify: `package.json` (`release:preflight` chain)

- [ ] **Step 1: Write the heal function.** Insert immediately AFTER `applyProjectMeetingsPanelHeal` ends (after its closing `}`):

```js
// applyProjectActivityPanelsHeal — injects ProjectActivityPanel + ProjectOpenTasks
// dataviewjs blocks into existing type:project hubs. Anchor preference:
//   1. BEFORE the opening fence of the `class: "ProjectMeetingsPanel"` block
//      (universal across all live hubs → primary)
//   2. after the closing fence of `class: "ProjectStatusWidget"`
//   3. after the closing fence of `class: "ProjectNavButtons"`
//   4. after the closing fence of the first dataviewjs block
//   5. none → warning, no write.
// Mirrors applyProjectMeetingsPanelHeal: exact type:project match, idempotent
// (skip when ProjectActivityPanel already present), .sauce-backup snapshot,
// per-project try/catch, history events, never throws. Both blocks inserted
// together. MUST run AFTER applyProjectMeetingsPanelHeal so the primary anchor
// exists on hubs that just received a Meetings block this pass.
async function applyProjectActivityPanelsHeal(tp, manifest, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const root = "spice/projects";
  if (!(await adapter.exists(root))) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let healed = 0, skipped = 0, warned = 0;

  let projectDirs;
  try {
    const listing = await adapter.list(root);
    projectDirs = (listing.folders || []).filter((f) => f.startsWith(root + "/"));
  } catch (e) {
    if (history) history.push({ event: "warning", step: "project_activity_panels_heal",
      reason: `list failed for ${root}: ${e && e.message ? e.message : String(e)}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    return;
  }

  const blockA = '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "ProjectActivityPanel" });\n```';
  const blockB = '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "ProjectOpenTasks" });\n```';

  for (const projectDir of projectDirs) {
    try {
      const sub = await adapter.list(projectDir);
      const candidates = (sub.files || []).filter((p) => p.endsWith(".md"));
      let hubPath = null;
      for (const cand of candidates) {
        const body = await adapter.read(cand);
        if (_noteChromeFrontmatterType(body) === "project") { hubPath = cand; break; }
      }
      if (!hubPath) continue;

      const before = await adapter.read(hubPath);
      if (before.includes('class: "ProjectActivityPanel"')) {
        skipped += 1;
        if (history) history.push({ event: "info", step: "project_activity_panels_heal", target: hubPath,
          action: "skipped_already_healed", git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
        continue;
      }

      let after = null;
      // 1. before the ProjectMeetingsPanel opening fence
      const pmpIdx = before.indexOf('class: "ProjectMeetingsPanel"');
      if (pmpIdx !== -1) {
        const openIdx = before.lastIndexOf("```dataviewjs", pmpIdx);
        if (openIdx !== -1) {
          after = before.slice(0, openIdx) + blockA + "\n\n" + blockB + "\n\n" + before.slice(openIdx);
        }
      }
      // 2/3. after Status / Nav closing fence
      if (after === null) {
        for (const anchorClass of ["ProjectStatusWidget", "ProjectNavButtons"]) {
          const anchorIdx = before.indexOf(`class: "${anchorClass}"`);
          if (anchorIdx === -1) continue;
          const closeRel = before.indexOf("\n```", anchorIdx);
          if (closeRel === -1) continue;
          const insertAt = closeRel + 4;
          after = before.slice(0, insertAt) + "\n\n" + blockA + "\n\n" + blockB + before.slice(insertAt);
          break;
        }
      }
      // 4. after first dataviewjs closing fence
      if (after === null) {
        const firstDvIdx = before.indexOf("```dataviewjs");
        if (firstDvIdx !== -1) {
          const closeRel = before.indexOf("\n```", firstDvIdx);
          if (closeRel !== -1) {
            const insertAt = closeRel + 4;
            after = before.slice(0, insertAt) + "\n\n" + blockA + "\n\n" + blockB + before.slice(insertAt);
          }
        }
      }
      if (after === null) {
        warned += 1;
        if (history) history.push({ event: "warning", step: "project_activity_panels_heal", target: hubPath,
          action: "no_anchor_found", reason: "no MeetingsPanel/Status/Nav/dataviewjs block to anchor on",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
        continue;
      }
      if (after === before) { skipped += 1; continue; }

      const backupPath = `.sauce-backup/${ts}/${hubPath}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) {}
      try { await adapter.write(backupPath, before); } catch (_e) {}

      await adapter.write(hubPath, after);
      healed += 1;
      if (history) history.push({ event: "info", step: "project_activity_panels_heal", target: hubPath,
        action: "healed", git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    } catch (e) {
      warned += 1;
      if (history) history.push({ event: "warning", step: "project_activity_panels_heal",
        reason: `${projectDir}: ${e && e.message ? e.message : String(e)}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    }
  }

  if (history) history.push({ event: "info", step: "project_activity_panels_heal", name: "vault",
    reason: `healed ${healed}; skipped ${skipped}; ${warned} warning(s)`,
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
}
```

- [ ] **Step 2: Wire the call site.** Find the line `await applyProjectMeetingsPanelHeal(tp, mech, variables, history, git);` (~1154). Immediately AFTER it add:

```js
  await applyProjectActivityPanelsHeal(tp, mech, variables, history, git); // injects ProjectActivityPanel + ProjectOpenTasks before the MeetingsPanel block (insert-only, idempotent)
```

- [ ] **Step 3: Export it.** Find `module.exports.applyProjectMeetingsPanelHeal = applyProjectMeetingsPanelHeal;` (~14228). After it add:

```js
    module.exports.applyProjectActivityPanelsHeal = applyProjectActivityPanelsHeal;
```

- [ ] **Step 4: Write the behavioral harness.** Create `platform/test/run-project-activity-panels-heal.js` by copying the scaffold of `platform/test/run-v0127-project-hub-heal.js` (the `makeAdapter`, `makeTp`, `ok`, `GIT`, `run()` wrapper verbatim), then replace the require, fixtures, and cases:

```js
const install = require(path.join(__dirname, "..", "install.js"));
const { applyProjectActivityPanelsHeal } = install;
if (typeof applyProjectActivityPanelsHeal !== "function") {
  console.error("FATAL: applyProjectActivityPanelsHeal not exported"); process.exit(2);
}
```

Fixtures (frontmatter `type: project`, dataviewjs blocks; use real backtick fences):

- `HUB_STATUS_MEETINGS` — Breadcrumb, SpaceNavButtons, ProjectNavButtons, ProjectStatusWidget, ProjectMeetingsPanel, ProjectWorkstreamManager.
- `HUB_NO_STATUS` — SpaceNavButtons, ProjectNavButtons, ProjectMeetingsPanel, ProjectWorkstreamManager.
- `HUB_MEETINGS_ONLY` — only ProjectMeetingsPanel.
- `HUB_STATUS_NO_MEETINGS` — Breadcrumb, ProjectStatusWidget, ProjectWorkstreamManager.
- `HUB_NO_DATAVIEWJS` — frontmatter + plain prose.
- `NON_PROJECT` — `type: project-todo` with a Breadcrumb block.

Cases (each `ok(...)` asserts a substring/order; use `result.indexOf(...)`):

```js
// A — Status + Meetings: both inserted; Status < Activity < OpenTasks < Meetings < Workstream
// B — no Status: Nav < Activity < OpenTasks < Meetings
// C — Meetings-only: Activity < OpenTasks < Meetings
// D — already-healed (run twice): second pass byte-identical + skipped_already_healed history
// E — Status, no Meetings: inserted after Status fence; Status < Activity < OpenTasks
// F — no dataviewjs: unchanged + no_anchor_found history
// G — type:project-todo: unchanged + no per-target history entry
// H — empty spice/projects/: no throw
```

For each ordering assert use the pattern:
```js
const a = result.indexOf("ProjectActivityPanel");
const o = result.indexOf("ProjectOpenTasks");
const m = result.indexOf("ProjectMeetingsPanel");
ok("PAP-A.order", a > -1 && o > a && m > o, `a=${a} o=${o} m=${m}`);
```

- [ ] **Step 5: Run the harness.**

Run: `node platform/test/run-project-activity-panels-heal.js`
Expected: `PASS N/N`, exit 0.

- [ ] **Step 6: Register in preflight.** In `package.json`, in the `release:preflight` value, append after `node platform/test/run-v0127-project-hub-heal.js`:

```
 && node platform/test/run-project-activity-panels-heal.js
```

- [ ] **Step 7: Commit**

```bash
git add platform/install.js platform/test/run-project-activity-panels-heal.js package.json
git commit -m "feat(project): applyProjectActivityPanelsHeal + behavioral harness"
```

---

## Task 6: Harden project enumerators to prefer `name:` (WS2a)

**Files:**
- Modify: `platform/blueprints/meetings/helpers/meeting-leaf-actions.js` (`_listProjects`, `_projectTodoPath`)
- Modify: `platform/blueprints/project/helpers/project-nav-buttons.js` (~line 272 basename resolver)

- [ ] **Step 1: Harden `_listProjects`.** Change the `.map(...)` so the display name prefers frontmatter `name:`:

```js
        .map((p) => ({ slug: p.project_slug || String(p.name || p.file.name).toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: p.name || p.file.name }))
```

- [ ] **Step 2: Harden `_projectTodoPath` match.** Change `p.file.name === name` to:

```js
      const hubs = dv.pages('"spice/projects"').where((p) => p && p.type === "project" && (p.name || p.file.name) === name).array();
```

- [ ] **Step 3: Harden the nav-buttons basename resolver.** Read `project-nav-buttons.js` around line 272. Change `if (fm && fm.type === "project") return f.basename;` to:

```js
                if (fm && fm.type === "project") return (fm.name || f.basename);
```

- [ ] **Step 4: Verify contract still holds.**

Run: `node platform/test/run-customjs-contract.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/meetings/helpers/meeting-leaf-actions.js platform/blueprints/project/helpers/project-nav-buttons.js
git commit -m "fix(project): project enumerators prefer frontmatter name: over file.name"
```

---

## Task 7: Backfill → repair + name-aware resolver (WS2b)

**Files:**
- Modify: `platform/install.js` (`_resolveProjectDisplayName` ~4048, `_injectProjectNameFrontmatter` ~4071, exports ~14228)
- Create: `platform/test/run-project-name-conformance.js`
- Modify: `package.json` (`release:preflight`)

- [ ] **Step 1: Make `_resolveProjectDisplayName` name-aware.** Replace the function body so it prefers frontmatter `name:` over the basename:

```js
async function _resolveProjectDisplayName(adapter, projectDir, candidateFiles) {
  const prefix = projectDir + "/";
  for (const fpath of candidateFiles) {
    if (!fpath.startsWith(prefix)) continue;
    if (fpath.slice(prefix.length).includes("/")) continue;
    let body;
    try { body = await adapter.read(fpath); } catch (_e) { continue; }
    if (_noteChromeFrontmatterType(body) === "project") {
      const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (fm) {
        const nm = fm[1].match(/^name:\s*(.+?)\s*$/m);
        if (nm) {
          const v = nm[1].trim().replace(/^["']|["']$/g, "");
          if (v) return v;
        }
      }
      const base = fpath.split("/").pop();
      return base.endsWith(".md") ? base.slice(0, -3) : base;
    }
  }
  return null;
}
```

- [ ] **Step 2: Make `_injectProjectNameFrontmatter` a backfill→repair.** Replace the entire function:

```js
function _injectProjectNameFrontmatter(body, name) {
  if (typeof body !== "string") return body;
  const fmMatch = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return body;
  const fmText = fmMatch[1];
  const typeMatch = fmText.match(/^type:\s*["']?([A-Za-z0-9_-]+)["']?\s*$/m);
  if (!typeMatch) return body;
  if (!["map", "kanban", "task-note"].includes(typeMatch[1])) return body;
  const escaped = String(name).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const existing = fmText.match(/^project_name:\s*(.*)\s*$/m);
  if (existing) {
    const curVal = existing[1].trim().replace(/^["']|["']$/g, "");
    if (curVal === String(name)) return body;        // idempotent no-op
    const fmStart = body.indexOf(fmText);
    const lineIdxInFm = fmText.indexOf(existing[0]);
    const head = body.slice(0, fmStart + lineIdxInFm);
    const tail = body.slice(fmStart + lineIdxInFm + existing[0].length);
    return head + `project_name: "${escaped}"` + tail;  // repair
  }

  const insert = `\nproject_name: "${escaped}"`;
  const fmStart = body.indexOf(fmText);
  const typeLineFull = typeMatch[0];
  const typeIdxInFm = fmText.indexOf(typeLineFull);
  const absIdx = fmStart + typeIdxInFm + typeLineFull.length;
  return body.slice(0, absIdx) + insert + body.slice(absIdx);
}
```

- [ ] **Step 3: Export the two functions + the backfill** for the harness. After the `applyProjectActivityPanelsHeal` export line add:

```js
    module.exports.applyProjectNameBackfill = applyProjectNameBackfill;
    module.exports._resolveProjectDisplayName = _resolveProjectDisplayName;
    module.exports._injectProjectNameFrontmatter = _injectProjectNameFrontmatter;
```

(Check first — if any are already exported, skip the duplicate.)

- [ ] **Step 4: Write the harness.** Create `platform/test/run-project-name-conformance.js` (zero-dep; reuse the `ok`/run scaffold shape from `run-v0127-project-hub-heal.js`, plus the in-memory `makeAdapter`/`makeTp`):

```js
"use strict";
const path = require("path");
const install = require(path.join(__dirname, "..", "install.js"));
const { _injectProjectNameFrontmatter, _resolveProjectDisplayName } = install;
// ... ok()/pass/fail scaffold + makeAdapter/makeTp copied from run-v0127 ...

// PNC-1: pure _injectProjectNameFrontmatter — insert when absent
//   body type:map without project_name → gains project_name: "Denali"
// PNC-2: repair — project_name: "Project" → "Denali"
// PNC-3: idempotent — project_name: "Denali" + name "Denali" → unchanged (===)
// PNC-4: non-target type (doc-note) → unchanged
// PNC-5: _resolveProjectDisplayName prefers frontmatter name: over basename
//   adapter: spice/projects/x/Project.md with `type: project` + `name: "Claude CoWork"`
//   → resolves "Claude CoWork", NOT "Project"
// PNC-6: _resolveProjectDisplayName falls back to basename when name: absent
//   adapter: spice/projects/y/Sauce.md type:project, no name → resolves "Sauce"
```

Implement each as concrete asserts, e.g.:
```js
ok("PNC-2.repair",
   _injectProjectNameFrontmatter('---\ntype: map\nproject_name: "Project"\n---\n', "Denali")
     .includes('project_name: "Denali"'));
ok("PNC-3.idempotent",
   _injectProjectNameFrontmatter('---\ntype: map\nproject_name: "Denali"\n---\n', "Denali")
     === '---\ntype: map\nproject_name: "Denali"\n---\n');
```
For PNC-5/6 build an adapter with `makeAdapter({...})`, list the dir's files, and call `await _resolveProjectDisplayName(adapter, "spice/projects/x", ["spice/projects/x/Project.md"])`.

- [ ] **Step 5: Run the harness.**

Run: `node platform/test/run-project-name-conformance.js`
Expected: `PASS N/N`, exit 0.

- [ ] **Step 6: Register in preflight.** In `package.json` `release:preflight`, append after the activity-panels harness:

```
 && node platform/test/run-project-name-conformance.js
```

- [ ] **Step 7: Commit**

```bash
git add platform/install.js platform/test/run-project-name-conformance.js package.json
git commit -m "fix(project): name backfill repairs mis-stamped project_name; resolver prefers name:"
```

---

## Task 8: Full preflight + PR

**Files:** none (verification + integration)

- [ ] **Step 1: Run the full preflight.**

Run: `npm run release:preflight`
Expected: every harness PASS, exit 0. If anything is red, fix it before proceeding (do NOT edit version literals/snapshots to make a check pass — investigate the real cause).

- [ ] **Step 2: Push the branch.**

```bash
git push -u origin feature/projects-hub-discoverability
```

- [ ] **Step 3: Open the PR** to `main` with a body summarizing both workstreams, linking the spec + this plan, and noting the post-merge manual rename step (WS2c).

- [ ] **Step 4: Watch CI to green.** If CI is red, read logs, fix on the branch, push, re-watch.

---

## Post-merge (operator — not a code task)

After the feature PR merges and the auto-release pipeline ships the `project` bump to brew:

1. Validate the brew-tap release PR auto-merged and the bottle is published.
2. Per consumer vault (`headspace-sauce`, `accuris-sauce`, `ero-sauce`): `sauce update --bump-pins` → confirm `sauce status` → `Drift: none` + the `project_activity_panels_heal` / `project_name_backfill` history summaries.
3. `Cmd+R` in each vault.
4. **WS2c renames** (link-safe, in Obsidian) per the spec's 6-row table; then `sauce update --bump-pins` once more per affected vault to let the backfill→repair clear residual `project_name: "Project"`.
5. Manual QA per the spec's Testing section + rollout verification (pickers show real names, panels render in order on all variants).
