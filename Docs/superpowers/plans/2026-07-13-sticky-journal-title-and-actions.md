# Sticky + Journal — Title, ⋯ Actions, Hub Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle sticky-note + journal-entry leaf titles to a subtle SectionLabel-look sourced from `frontmatter.title`, wire a real ⋯ menu (rename, delete on both; add-link + move-day on sticky), remove the duplicate H1 from both hub templates, flip the hub default toggle to "All", and heal existing consumer hubs.

**Architecture:** Blueprints-only work. `StickyChromeBar` restyles its existing banner, calls `SectionExplorer.renderNoteLinks` for parity with wiki/project, and grows three new dialogs (rename kept; move-day + delete added). `JournalChromeBar` mirrors the styling and gets rename + delete. Both hub-cards helpers flip their default mode. Two new install heals (`applyStickyHubTitleHeal`, `applyJournalHubTitleHeal`) strip the redundant `# H1` line from already-deployed hubs.

**Tech Stack:** CustomJS classes (vanilla JS, no build), Node test harness (`platform/test/run-*.js`), install-time heals in `platform/install.js`.

**Design doc:** `Docs/superpowers/specs/2026-07-13-sticky-journal-title-and-actions-design.md`

---

## Task 1: Sticky title banner — restyle + frontmatter.title fallback

**Files:**
- Modify: `platform/blueprints/sticky-notes/helpers/sticky-chrome-bar.js` — `_bannerText`, `_headingStyle` (delete), `_renderTitleBanner`
- Test: `platform/test/run-sticky-notes-chrome-bar.js` — STCB-BANNER-* tests

**Behavior:**
- `_bannerText(page)` fallback: `frontmatter.title` (trimmed) → `page.file.name` (filename stem) → `null` (placeholder path).
- Label style: SectionLabel-style `font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 600;`.
- Placeholder (only when neither title nor filename resolve): `font-style: italic; text-transform: none; letter-spacing: 0;` with same size/color/weight.
- Hairline BELOW the label (child-order): `border: none; border-top: 1px solid var(--background-modifier-border-hover); margin: 0 0 12px 0;`.
- Dedupe rule preserved: `.sticky-title-banner` container is removed before append.

- [ ] **Step 1: Update the STCB-BANNER tests to lock the new behavior**

Replace the STCB-BANNER test block in `platform/test/run-sticky-notes-chrome-bar.js` (roughly lines 96–153) with:

```js
// STCB-BANNER-1 — _bannerText fallback: title → filename → null
{
  ok('STCB-BANNER-1a title used', inst._bannerText({ title: 'Grocery list', file: { name: 'Sticky-2026-07-06-14-30' } }) === 'Grocery list');
  ok('STCB-BANNER-1b whitespace title → filename', inst._bannerText({ title: '  ', file: { name: 'Sticky-X' } }) === 'Sticky-X');
  ok('STCB-BANNER-1c missing title → filename', inst._bannerText({ file: { name: 'Sticky-Y' } }) === 'Sticky-Y');
  ok('STCB-BANNER-1d nothing → null', inst._bannerText({}) === null);
}

// STCB-BANNER-2/3 — _renderTitleBanner: dedupes, label + hairline BELOW, correct order
{
  const makeNode = (tag, opts) => {
    const node = {
      tag, cls: (opts && opts.cls) || '', textContent: (opts && opts.text) || '',
      title: '', style: { cssText: '' }, children: [], _removed: false,
      createEl(t, o) { const c = makeNode(t, o); this.children.push(c); return c; },
      addEventListener() {}, remove() { this._removed = true; },
    };
    return node;
  };
  const makeContainer = () => {
    const container = makeNode('div', {});
    container.querySelectorAll = (sel) => {
      const cls = sel.replace(/^\./, '');
      return container.children.filter((c) => !c._removed && c.cls === cls);
    };
    return container;
  };

  const titledPage = { title: 'Grocery list', file: { path: 'x.md', name: 'Sticky-X' } };
  const untitledPage = { file: { path: 'y.md', name: 'Sticky-Y' } };
  const emptyPage = { file: { path: 'z.md' } };
  const fileStub = { path: 'x.md' };

  const c1 = makeContainer();
  inst._renderTitleBanner(c1, titledPage, fileStub);
  inst._renderTitleBanner(c1, titledPage, fileStub);
  const live1 = c1.children.filter((n) => !n._removed && n.cls === 'sticky-title-banner');
  ok('STCB-BANNER-2 exactly one banner after double render (dedup)', live1.length === 1);
  const kids1 = live1[0].children;
  ok('STCB-BANNER-3a titled banner shows title text',
    kids1.some((h) => h.textContent === 'Grocery list'));
  ok('STCB-BANNER-3b banner has SectionLabel-style label (uppercase + 0.78em)',
    kids1.some((h) => /text-transform:\s*uppercase/.test(h.style.cssText) && /font-size:\s*0\.78em/.test(h.style.cssText)));
  const labelIdx1 = kids1.findIndex((n) => n.tag === 'div' && n.textContent === 'Grocery list');
  const hrIdx1 = kids1.findIndex((n) => n.tag === 'hr');
  ok('STCB-BANNER-4 hairline is BELOW label (hr appears after label in child order)',
    labelIdx1 >= 0 && hrIdx1 > labelIdx1);
  ok('STCB-BANNER-5 hairline uses border-hover var',
    kids1[hrIdx1].style.cssText.includes('border-modifier-border-hover') || kids1[hrIdx1].style.cssText.includes('background-modifier-border-hover'));

  const c2 = makeContainer();
  inst._renderTitleBanner(c2, untitledPage, { path: 'y.md' });
  const kids2 = c2.children.filter((n) => !n._removed && n.cls === 'sticky-title-banner')[0].children;
  ok('STCB-BANNER-6 no-title falls back to filename stem',
    kids2.some((h) => h.textContent === 'Sticky-Y'));

  const c3 = makeContainer();
  inst._renderTitleBanner(c3, emptyPage, { path: 'z.md' });
  const kids3 = c3.children.filter((n) => !n._removed && n.cls === 'sticky-title-banner')[0].children;
  ok('STCB-BANNER-7 no title AND no filename → placeholder',
    kids3.some((h) => /Untitled/i.test(h.textContent) && /italic/.test(h.style.cssText)));
}
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
node platform/test/run-sticky-notes-chrome-bar.js
```
Expected: STCB-BANNER-1b/1c/3b/4/5/6/7 FAIL.

- [ ] **Step 3: Rewrite `_bannerText`, delete `_headingStyle`, rewrite `_renderTitleBanner`**

In `platform/blueprints/sticky-notes/helpers/sticky-chrome-bar.js`:

Replace `_bannerText` with:
```js
  _bannerText(page) {
    const t = page && page.title != null ? String(page.title).trim() : "";
    if (t.length > 0) return t;
    const fn = page && page.file && page.file.name ? String(page.file.name).trim() : "";
    return fn.length > 0 ? fn : null;
  }
```

Delete `_headingStyle` entirely.

Replace `_renderTitleBanner` with:
```js
  _renderTitleBanner(container, page, file) {
    if (!container || typeof container.createEl !== "function") return;
    try {
      if (typeof container.querySelectorAll === "function") {
        (container.querySelectorAll(".sticky-title-banner") || []).forEach((e) => { try { e.remove(); } catch (_e) {} });
      }
    } catch (_e) {}
    const banner = container.createEl("div", { cls: "sticky-title-banner" });
    banner.style.cssText = "margin: 6px 0 0 0;";
    const text = this._bannerText(page);
    const placeholder = "Untitled — click to name";
    const labelBase = "font-size: 0.78em; color: var(--text-muted); font-weight: 600; margin: 4px 0 6px 0; cursor: pointer;";
    const labelWhenText = "text-transform: uppercase; letter-spacing: 0.05em;";
    const labelWhenPlaceholder = "font-style: italic;";
    const h = banner.createEl("div", { text: text || placeholder });
    h.style.cssText = labelBase + " " + (text ? labelWhenText : labelWhenPlaceholder);
    h.title = "Click to rename";
    const hr = banner.createEl("hr");
    hr.style.cssText = "border: none; border-top: 1px solid var(--background-modifier-border-hover); margin: 0 0 12px 0;";
    h.addEventListener("click", () => this._openRenameDialog(file, text || "", (newTitle) => {
      const nt = newTitle && String(newTitle).trim();
      h.textContent = nt || placeholder;
      h.style.cssText = labelBase + " " + (nt ? labelWhenText : labelWhenPlaceholder);
    }));
  }
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
node platform/test/run-sticky-notes-chrome-bar.js
```
Expected: all STCB-BANNER-* PASS.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/sticky-notes/helpers/sticky-chrome-bar.js platform/test/run-sticky-notes-chrome-bar.js
git commit -m "feat(sticky-notes): SectionLabel-style title banner + filename fallback"
```

---

## Task 2: Sticky pinned-links row (renderNoteLinks parity)

**Files:**
- Modify: `platform/blueprints/sticky-notes/helpers/sticky-chrome-bar.js` — `render()` tail
- Modify: `platform/blueprints/sticky-notes/manifest.json` — add `section-explorer` dep

**Behavior:** On leaf `sticky-note` context, call `customJS.SectionExplorer.renderNoteLinks(dv)` after `_maybeRenderBanner`. The banner already gates by page.type internally, so `_maybeRenderBanner` no-ops on hub/day; the pinned-links call must ALSO gate by leaf context.

- [ ] **Step 1: Add SCB-LINKS test to `run-sticky-notes-chrome-bar.js`**

Append after the STCB-BANNER block, before the `console.log` summary line:

```js
// SCB-LINKS — pinned-links row called on leaf, not on hub/day
{
  const prevCJS = global.customJS;
  const calls = [];
  global.customJS = {
    ChromeBar: {
      makeAdapter: (c) => c,
      render: () => {},
      openNavTarget: () => {},
    },
    RenderSafe: { page: (dv) => (dv && dv._page) || null },
    SectionExplorer: { renderNoteLinks: (dv) => { calls.push({ links: (dv && dv._page && dv._page.type) || 'unknown' }); } },
  };
  const container = { createEl: () => ({ style: {}, addEventListener: () => {}, createEl: () => ({ style: {} }) }), querySelectorAll: () => [] };

  const leafDv = { container, current: () => ({ type: 'sticky-note', file: { path: 'x.md', name: 'X' } }), _page: { type: 'sticky-note', file: { path: 'x.md', name: 'X' } } };
  inst.render(leafDv);
  ok('SCB-LINKS-1 renderNoteLinks called on sticky-note leaf', calls.some((c) => c.links === 'sticky-note'));

  const hubDv = { container, current: () => ({ type: 'sticky-hub', file: { path: 'Sticky.md' } }), _page: { type: 'sticky-hub', file: { path: 'Sticky.md' } } };
  calls.length = 0;
  inst.render(hubDv);
  ok('SCB-LINKS-2 renderNoteLinks NOT called on sticky-hub', calls.length === 0);

  const dayDv = { container, current: () => ({ type: 'sticky-day', file: { path: 'D.md' }, day: '2026-07-13' }), _page: { type: 'sticky-day', file: { path: 'D.md' } } };
  calls.length = 0;
  inst.render(dayDv);
  ok('SCB-LINKS-3 renderNoteLinks NOT called on sticky-day', calls.length === 0);

  global.customJS = prevCJS;
}
```

- [ ] **Step 2: Run test, confirm SCB-LINKS-1/2/3 FAIL**

```bash
node platform/test/run-sticky-notes-chrome-bar.js
```
Expected: SCB-LINKS-1 FAIL (not called), SCB-LINKS-2/3 PASS trivially (also not called).

- [ ] **Step 3: Add a leaf-gated pinned-links call in `render()`**

In `platform/blueprints/sticky-notes/helpers/sticky-chrome-bar.js`, extract the leaf-check helper and wire the call. Replace the current `render(dv)` with:

```js
  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      const out = customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
      this._maybeRenderBanner(dv);
      this._maybeRenderPinnedLinks(dv);
      return out;
    } catch (_e) { /* never throw */ }
  }

  _maybeRenderPinnedLinks(dv) {
    try {
      const page = customJS && customJS.RenderSafe && typeof customJS.RenderSafe.page === "function"
        ? customJS.RenderSafe.page(dv)
        : (dv && dv.current ? dv.current() : null);
      if (!page || page.type !== "sticky-note") return;
      if (customJS && customJS.SectionExplorer && typeof customJS.SectionExplorer.renderNoteLinks === "function") {
        customJS.SectionExplorer.renderNoteLinks(dv);
      }
    } catch (_e) { /* never throw */ }
  }
```

- [ ] **Step 4: Add the section-explorer dependency to `sticky-notes/manifest.json`**

Insert into the `depends_on` array (after the `breadcrumb` entry, before `render-safe`):

```json
    {
      "name": "section-explorer",
      "range": ">=0.5.4"
    },
```

- [ ] **Step 5: Run tests and confirm they pass**

```bash
node platform/test/run-sticky-notes-chrome-bar.js
```
Expected: all SCB-LINKS-* PASS.

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/sticky-notes/helpers/sticky-chrome-bar.js platform/blueprints/sticky-notes/manifest.json platform/test/run-sticky-notes-chrome-bar.js
git commit -m "feat(sticky-notes): reuse SectionExplorer.renderNoteLinks for pinned links"
```

---

## Task 3: Sticky ⋯ menu — extend surfaceSpec with 4 new IDs + icons

**Files:**
- Modify: `platform/blueprints/sticky-notes/helpers/sticky-chrome-bar.js` — `ICON` getter, `_config().surfaceSpec` for `sticky-note`

**Behavior:** Leaf context grows 4 overflow entries in order: `rename`, `add-link`, `move-day`, `delete`. Existing `back-day` (currently overflow[0]) + `hub` (currently overflow[1]) stay first — new IDs append after.

- [ ] **Step 1: Update SCB-SPEC-3 in the test to lock the new overflow shape**

Replace the SCB-SPEC-3 line inside the SCB-SPEC block with:

```js
  ok('SCB-SPEC-3 note: no primary + overflow back-day,hub,rename,add-link,move-day,delete + leaf',
    l.primary === null && l.overflow.length === 6
    && l.overflow[0].id === 'back-day' && l.overflow[1].id === 'hub'
    && l.overflow[2].id === 'rename' && l.overflow[3].id === 'add-link'
    && l.overflow[4].id === 'move-day' && l.overflow[5].id === 'delete');
```

- [ ] **Step 2: Run test, confirm SCB-SPEC-3 FAIL**

```bash
node platform/test/run-sticky-notes-chrome-bar.js
```
Expected: SCB-SPEC-3 FAIL.

- [ ] **Step 3: Add the four ICON entries + extend surfaceSpec**

In the `ICON` getter object in `sticky-chrome-bar.js`, add these entries (comma-terminated where needed):

```js
      link: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
      trash: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>`,
```

In `_config().surfaceSpec`, replace the `sticky-note` branch with:

```js
        if (ctx.context === "sticky-note") {
          return {
            primary: null,
            overflow: [
              { id: "back-day", label: "Back to Day", icon: ICON.back },
              { id: "hub", label: "Hub", icon: ICON.home },
              { id: "rename", label: "Change title…", icon: ICON.pencilPlus },
              { id: "add-link", label: "Add link…", icon: ICON.link },
              { id: "move-day", label: "Move to another day…", icon: ICON.today },
              { id: "delete", label: "Delete sticky note…", icon: ICON.trash },
            ],
            leaf: true,
          };
        }
```

- [ ] **Step 4: Run test and confirm SCB-SPEC-3 passes**

```bash
node platform/test/run-sticky-notes-chrome-bar.js
```
Expected: all SCB-SPEC-* PASS.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/sticky-notes/helpers/sticky-chrome-bar.js platform/test/run-sticky-notes-chrome-bar.js
git commit -m "feat(sticky-notes): grow leaf ⋯ menu with rename/add-link/move-day/delete"
```

---

## Task 4: Sticky new dialogs — `_openMoveDayDialog`, `_openDeleteDialog`

**Files:**
- Modify: `platform/blueprints/sticky-notes/helpers/sticky-chrome-bar.js`

**Behavior:** Two new dialog methods, structured like `_openRenameDialog`. Never-throw. Best-effort each step. See design §S4.

- [ ] **Step 1: Add SCB-DIALOG-* tests to `run-sticky-notes-chrome-bar.js`**

Append (before `console.log`):

```js
// SCB-DIALOG — new dialog methods present, honor guards
{
  ok('SCB-DIALOG-1 _openMoveDayDialog is a function', typeof inst._openMoveDayDialog === 'function');
  ok('SCB-DIALOG-2 _openDeleteDialog is a function', typeof inst._openDeleteDialog === 'function');

  // Guard: no throw when app/document missing.
  const prevApp = global.app, prevDoc = global.document;
  delete global.app; delete global.document;
  let threw = false;
  try {
    inst._openMoveDayDialog({}, { context: 'sticky-note', path: 'x.md', day: '2026-07-06' });
    inst._openDeleteDialog(null, 'spice/sticky-notes/Sticky.md', 'sticky note');
  } catch (_e) { threw = true; }
  ok('SCB-DIALOG-3 dialogs are never-throw when app/document missing', !threw);
  global.app = prevApp; global.document = prevDoc;
}
```

- [ ] **Step 2: Run test, confirm SCB-DIALOG-1/2 FAIL**

```bash
node platform/test/run-sticky-notes-chrome-bar.js
```
Expected: SCB-DIALOG-1/2 FAIL.

- [ ] **Step 3: Add the two dialog methods**

Insert after `_openRenameDialog` in `sticky-chrome-bar.js`:

```js
  _openMoveDayDialog(dv, ctx) {
    try {
      const filePath = ctx && ctx.path;
      if (!filePath || typeof app === "undefined" || !app.vault || !app.fileManager
        || typeof app.vault.getAbstractFileByPath !== "function"
        || typeof app.fileManager.renameFile !== "function"
        || typeof app.fileManager.processFrontMatter !== "function") return;
      if (typeof document === "undefined" || !document.body || typeof document.body.createEl !== "function") return;
      const file = app.vault.getAbstractFileByPath(filePath);
      if (!file) return;
      const currentDay = this._resolveDay(dv, ctx) || window.moment().format("YYYY-MM-DD");

      const overlay = document.body.createEl("div");
      overlay.style.cssText = "position: fixed; inset: 0; z-index: 999; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center;";
      const box = overlay.createEl("div");
      box.style.cssText = "background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 16px; width: min(360px, 90vw); display: flex; flex-direction: column; gap: 10px;";
      box.createEl("div", { text: "Move to day" }).style.cssText = "font-weight: 600;";
      const input = box.createEl("input", { type: "date", value: currentDay });
      input.style.cssText = "padding: 6px 8px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal);";
      const row = box.createEl("div");
      row.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";
      const close = () => { try { overlay.remove(); } catch (_e) {} };
      const save = async () => {
        const newDay = (input.value || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(newDay)) {
          if (typeof Notice === "function") new Notice("StickyChromeBar: invalid date.", 6000);
          return;
        }
        if (newDay === currentDay) { close(); return; }
        const mo = window.moment(newDay, "YYYY-MM-DD", true);
        if (!mo.isValid()) { if (typeof Notice === "function") new Notice("StickyChromeBar: invalid date.", 6000); return; }
        const newFolder = `spice/sticky-notes/${mo.format("YYYY/MM-MMMM")}/${newDay}`;
        try {
          if (!app.vault.getAbstractFileByPath(newFolder)) {
            try { await app.vault.createFolder(newFolder); }
            catch (e) { if (!/already exists|exists/i.test((e && e.message) || "")) throw e; }
          }
          const dayHubPath = `${newFolder}/Sticky-Day-${newDay}.md`;
          if (!app.vault.getAbstractFileByPath(dayHubPath)) {
            try {
              const tpPlugin = app.plugins && app.plugins.plugins && app.plugins.plugins["templater-obsidian"];
              const templateFile = app.vault.getAbstractFileByPath("ranch/templates/Sticky Day Hub.md");
              if (tpPlugin && tpPlugin.templater && templateFile) {
                await tpPlugin.templater.create_new_note_from_template(templateFile, newFolder, `Sticky-Day-${newDay}`, false);
              }
            } catch (_e) { /* best-effort; sticky still moves */ }
          }
          await app.fileManager.processFrontMatter(file, (fm) => { fm.day = newDay; });
          const newPath = `${newFolder}/${file.name}`;
          await app.fileManager.renameFile(file, newPath);
          try { app.workspace.openLinkText(newPath, ""); } catch (_e) {}
          close();
        } catch (e) {
          if (typeof Notice === "function") new Notice("StickyChromeBar: move failed — " + ((e && e.message) || e), 8000);
        }
      };
      const cancelBtn = row.createEl("button", { text: "Cancel" });
      cancelBtn.addEventListener("click", close);
      const saveBtn = row.createEl("button", { text: "Save" });
      saveBtn.style.cssText = "background: var(--interactive-accent); color: var(--text-on-accent); border: none; border-radius: 6px; padding: 6px 12px; cursor: pointer;";
      saveBtn.addEventListener("click", () => { save(); });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); save(); }
        else if (e.key === "Escape") { e.preventDefault(); close(); }
      });
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
      setTimeout(() => { try { input.focus(); } catch (_e) {} }, 0);
    } catch (_e) { /* never throw */ }
  }

  _openDeleteDialog(file, hubPath, entityLabel) {
    try {
      if (!file || typeof app === "undefined" || !app.vault || typeof app.vault.delete !== "function") return;
      if (typeof document === "undefined" || !document.body || typeof document.body.createEl !== "function") return;
      const overlay = document.body.createEl("div");
      overlay.style.cssText = "position: fixed; inset: 0; z-index: 999; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center;";
      const box = overlay.createEl("div");
      box.style.cssText = "background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 16px; width: min(380px, 90vw); display: flex; flex-direction: column; gap: 10px;";
      box.createEl("div", { text: `Delete this ${entityLabel}?` }).style.cssText = "font-weight: 600;";
      box.createEl("div", { text: "This cannot be undone." }).style.cssText = "color: var(--text-muted); font-size: 0.9em;";
      const row = box.createEl("div");
      row.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";
      const close = () => { try { overlay.remove(); } catch (_e) {} };
      const cancelBtn = row.createEl("button", { text: "Cancel" });
      cancelBtn.addEventListener("click", close);
      const delBtn = row.createEl("button", { text: "Delete" });
      delBtn.style.cssText = "background: var(--interactive-accent); color: var(--text-on-accent); border: none; border-radius: 6px; padding: 6px 12px; cursor: pointer;";
      delBtn.addEventListener("click", async () => {
        try { await app.vault.delete(file); } catch (_e) {}
        try { if (hubPath) app.workspace.openLinkText(hubPath, ""); } catch (_e) {}
        close();
      });
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    } catch (_e) { /* never throw */ }
  }
```

- [ ] **Step 4: Run test, confirm all SCB-DIALOG-* pass**

```bash
node platform/test/run-sticky-notes-chrome-bar.js
```
Expected: all SCB-DIALOG-* PASS.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/sticky-notes/helpers/sticky-chrome-bar.js platform/test/run-sticky-notes-chrome-bar.js
git commit -m "feat(sticky-notes): add _openMoveDayDialog + _openDeleteDialog"
```

---

## Task 5: Sticky dispatch — wire rename/add-link/move-day/delete

**Files:**
- Modify: `platform/blueprints/sticky-notes/helpers/sticky-chrome-bar.js` — `_config().dispatch`

- [ ] **Step 1: Add SCB-DISPATCH-4/5/6/7 to `run-sticky-notes-chrome-bar.js`**

Extend the existing SCB-DISPATCH block. Add these test cases inside the same `{ … }` block (right after SCB-DISPATCH-3, before restoring globals):

```js
  // extend the stubs to catch the new dispatches
  const calls2 = [];
  global.customJS.SectionExplorer = {
    _openAddLinkForm: (dv, adapter, target) => calls2.push({ addLink: target === null }),
    _noteSelfAdapter: (p) => ({ getLinks: () => [], writeLinks: () => Promise.resolve() }),
    renderNoteLinks: () => {},
  };
  global.customJS.RenderSafe = { page: () => ({ type: 'sticky-note', file: { path: 'x.md', name: 'X' }, title: 'T' }) };
  global.app.vault.getAbstractFileByPath = () => ({ path: 'x.md', name: 'X' });
  let renameCalled = false, moveCalled = false, deleteCalled = false;
  inst._openRenameDialog = () => { renameCalled = true; };
  inst._openMoveDayDialog = () => { moveCalled = true; };
  inst._openDeleteDialog = () => { deleteCalled = true; };

  cfg.dispatch({ current: () => ({}) }, { context: 'sticky-note', path: 'x.md' }, 'rename');
  cfg.dispatch({ current: () => ({}) }, { context: 'sticky-note', path: 'x.md' }, 'add-link');
  cfg.dispatch({ current: () => ({}) }, { context: 'sticky-note', path: 'x.md', day: '2026-07-06' }, 'move-day');
  cfg.dispatch({ current: () => ({}) }, { context: 'sticky-note', path: 'x.md' }, 'delete');

  ok('SCB-DISPATCH-4 rename → _openRenameDialog', renameCalled);
  ok('SCB-DISPATCH-5 add-link → SectionExplorer._openAddLinkForm', calls2.some((c) => c.addLink === true));
  ok('SCB-DISPATCH-6 move-day → _openMoveDayDialog', moveCalled);
  ok('SCB-DISPATCH-7 delete → _openDeleteDialog', deleteCalled);
```

- [ ] **Step 2: Run test, confirm SCB-DISPATCH-4/5/6/7 FAIL**

```bash
node platform/test/run-sticky-notes-chrome-bar.js
```
Expected: SCB-DISPATCH-4/5/6/7 FAIL.

- [ ] **Step 3: Extend `_config().dispatch` with the four new IDs**

Inside `_config().dispatch` in `sticky-chrome-bar.js`, add these four branches (before the closing `}` of dispatch):

```js
        if (id === "rename") {
          const file = ctx && ctx.path && typeof app !== "undefined" && app.vault
            ? app.vault.getAbstractFileByPath(ctx.path) : null;
          if (!file) return;
          const page = customJS && customJS.RenderSafe && typeof customJS.RenderSafe.page === "function"
            ? customJS.RenderSafe.page(dv) : (dv && dv.current ? dv.current() : null);
          const current = page && page.title != null ? String(page.title).trim() : "";
          this._openRenameDialog(file, current, () => {});
          return;
        }
        if (id === "add-link") {
          if (customJS && customJS.SectionExplorer && typeof customJS.SectionExplorer._openAddLinkForm === "function"
            && typeof customJS.SectionExplorer._noteSelfAdapter === "function") {
            const page = customJS.RenderSafe && typeof customJS.RenderSafe.page === "function"
              ? customJS.RenderSafe.page(dv) : (dv && dv.current ? dv.current() : null);
            if (page && page.file && page.file.path) {
              customJS.SectionExplorer._openAddLinkForm(dv, customJS.SectionExplorer._noteSelfAdapter(page), null);
            }
          } else if (typeof Notice === "function") {
            new Notice("StickyChromeBar: SectionExplorer unavailable.", 6000);
          }
          return;
        }
        if (id === "move-day") {
          this._openMoveDayDialog(dv, ctx);
          return;
        }
        if (id === "delete") {
          const file = ctx && ctx.path && typeof app !== "undefined" && app.vault
            ? app.vault.getAbstractFileByPath(ctx.path) : null;
          this._openDeleteDialog(file, "spice/sticky-notes/Sticky.md", "sticky note");
          return;
        }
```

- [ ] **Step 4: Run test, confirm all SCB-DISPATCH-* pass**

```bash
node platform/test/run-sticky-notes-chrome-bar.js
```

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/sticky-notes/helpers/sticky-chrome-bar.js platform/test/run-sticky-notes-chrome-bar.js
git commit -m "feat(sticky-notes): wire ⋯ dispatch for rename/add-link/move-day/delete"
```

---

## Task 6: Journal title banner — restyle + fallback

**Files:**
- Modify: `platform/blueprints/journal/helpers/journal-chrome-bar.js` — `_bannerText`, `_headingStyle` (delete), `_renderTitleBanner`
- Test: `platform/test/run-journal-chrome-bar.js`

**Behavior:** Same style/fallback as Task 1, applied to journal (banner class `journal-title-banner`, placeholder text `"Untitled journal entry — click to name"`).

- [ ] **Step 1: Read the existing test file to understand its shape**

```bash
node platform/test/run-journal-chrome-bar.js
```
Skim the output to see what's currently covered.

- [ ] **Step 2: Add JCB-BANNER tests**

Append this block to `platform/test/run-journal-chrome-bar.js` (before its final results-log line):

```js
// JCB-BANNER — mirrors STCB-BANNER: SectionLabel-style label, filename fallback, hairline below
{
  const inst = new JournalChromeBar();
  ok('JCB-BANNER-1a title used', inst._bannerText({ title: 'Morning notes', file: { name: 'Journal-X' } }) === 'Morning notes');
  ok('JCB-BANNER-1b whitespace → filename', inst._bannerText({ title: '  ', file: { name: 'Journal-Y' } }) === 'Journal-Y');
  ok('JCB-BANNER-1c missing title → filename', inst._bannerText({ file: { name: 'Journal-Z' } }) === 'Journal-Z');
  ok('JCB-BANNER-1d nothing → null', inst._bannerText({}) === null);

  const makeNode = (tag, opts) => {
    const node = {
      tag, cls: (opts && opts.cls) || '', textContent: (opts && opts.text) || '',
      title: '', style: { cssText: '' }, children: [], _removed: false,
      createEl(t, o) { const c = makeNode(t, o); this.children.push(c); return c; },
      addEventListener() {}, remove() { this._removed = true; },
    };
    return node;
  };
  const makeContainer = () => {
    const container = makeNode('div', {});
    container.querySelectorAll = (sel) => {
      const cls = sel.replace(/^\./, '');
      return container.children.filter((c) => !c._removed && c.cls === cls);
    };
    return container;
  };

  const c = makeContainer();
  inst._renderTitleBanner(c, { title: 'Morning notes', file: { path: 'x.md', name: 'Journal-X' } }, { path: 'x.md' });
  inst._renderTitleBanner(c, { title: 'Morning notes', file: { path: 'x.md', name: 'Journal-X' } }, { path: 'x.md' });
  const live = c.children.filter((n) => !n._removed && n.cls === 'journal-title-banner');
  ok('JCB-BANNER-2 exactly one banner after double render (dedup)', live.length === 1);
  const kids = live[0].children;
  const labelIdx = kids.findIndex((n) => n.tag === 'div' && n.textContent === 'Morning notes');
  const hrIdx = kids.findIndex((n) => n.tag === 'hr');
  ok('JCB-BANNER-3 SectionLabel-style label', kids[labelIdx] && /text-transform:\s*uppercase/.test(kids[labelIdx].style.cssText) && /0\.78em/.test(kids[labelIdx].style.cssText));
  ok('JCB-BANNER-4 hairline BELOW label', labelIdx >= 0 && hrIdx > labelIdx);
}
```

- [ ] **Step 3: Run test, confirm JCB-BANNER-* FAIL**

```bash
node platform/test/run-journal-chrome-bar.js
```

- [ ] **Step 4: Update `_bannerText`, delete `_headingStyle`, rewrite `_renderTitleBanner`**

In `journal-chrome-bar.js`:

Replace `_bannerText` with:
```js
  _bannerText(page) {
    const t = page && page.title != null ? String(page.title).trim() : "";
    if (t.length > 0) return t;
    const fn = page && page.file && page.file.name ? String(page.file.name).trim() : "";
    return fn.length > 0 ? fn : null;
  }
```

Delete `_headingStyle` entirely.

Replace `_renderTitleBanner` with:
```js
  _renderTitleBanner(container, page, file) {
    if (!container || typeof container.createEl !== "function") return;
    try {
      if (typeof container.querySelectorAll === "function") {
        (container.querySelectorAll(".journal-title-banner") || []).forEach((e) => { try { e.remove(); } catch (_e) {} });
      }
    } catch (_e) {}
    const banner = container.createEl("div", { cls: "journal-title-banner" });
    banner.style.cssText = "margin: 6px 0 0 0;";
    const text = this._bannerText(page);
    const placeholder = "Untitled journal entry — click to name";
    const labelBase = "font-size: 0.78em; color: var(--text-muted); font-weight: 600; margin: 4px 0 6px 0; cursor: pointer;";
    const labelWhenText = "text-transform: uppercase; letter-spacing: 0.05em;";
    const labelWhenPlaceholder = "font-style: italic;";
    const h = banner.createEl("div", { text: text || placeholder });
    h.style.cssText = labelBase + " " + (text ? labelWhenText : labelWhenPlaceholder);
    h.title = "Click to rename";
    const hr = banner.createEl("hr");
    hr.style.cssText = "border: none; border-top: 1px solid var(--background-modifier-border-hover); margin: 0 0 12px 0;";
    h.addEventListener("click", () => this._openRenameDialog(file, text || "", (newTitle) => {
      const nt = newTitle && String(newTitle).trim();
      h.textContent = nt || placeholder;
      h.style.cssText = labelBase + " " + (nt ? labelWhenText : labelWhenPlaceholder);
    }));
  }
```

- [ ] **Step 5: Run test, confirm JCB-BANNER-* PASS**

```bash
node platform/test/run-journal-chrome-bar.js
```

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/journal/helpers/journal-chrome-bar.js platform/test/run-journal-chrome-bar.js
git commit -m "feat(journal): SectionLabel-style title banner + filename fallback"
```

---

## Task 7: Journal ⋯ menu + delete dialog + dispatch

**Files:**
- Modify: `platform/blueprints/journal/helpers/journal-chrome-bar.js`

**Behavior:** Leaf overflow becomes `[back-day, hub, rename, delete]`. Add `_openDeleteDialog` (byte-parity with sticky's) and add `link`/`trash` are not needed — only `trash` for delete. Wire dispatch for `rename` (existing dialog) + `delete`.

- [ ] **Step 1: Add JCB-SPEC-DISPATCH tests**

Append to `platform/test/run-journal-chrome-bar.js` (before final results-log):

```js
// JCB-SPEC — journal-entry overflow shape
{
  const inst = new JournalChromeBar();
  const cfg = inst._config();
  const l = cfg.surfaceSpec({ context: 'journal-entry' });
  ok('JCB-SPEC-1 leaf overflow includes back-day,hub,rename,delete',
    l.overflow.length === 4
    && l.overflow[0].id === 'back-day' && l.overflow[1].id === 'hub'
    && l.overflow[2].id === 'rename' && l.overflow[3].id === 'delete');
}

// JCB-DIALOG — _openDeleteDialog exists + never-throws under empty globals
{
  const inst = new JournalChromeBar();
  ok('JCB-DIALOG-1 _openDeleteDialog is a function', typeof inst._openDeleteDialog === 'function');
  const prevApp = global.app, prevDoc = global.document;
  delete global.app; delete global.document;
  let threw = false;
  try { inst._openDeleteDialog(null, 'spice/journal/Journal.md', 'journal entry'); } catch (_e) { threw = true; }
  ok('JCB-DIALOG-2 never throws under missing app/document', !threw);
  global.app = prevApp; global.document = prevDoc;
}

// JCB-DISPATCH — rename + delete route correctly
{
  const inst = new JournalChromeBar();
  const cfg = inst._config();
  let renameCalled = false, deleteCalled = false;
  inst._openRenameDialog = () => { renameCalled = true; };
  inst._openDeleteDialog = () => { deleteCalled = true; };
  const prevApp = global.app; const prevCJS = global.customJS;
  global.app = { vault: { getAbstractFileByPath: () => ({ path: 'x.md' }) }, workspace: { openLinkText: () => {} } };
  global.customJS = { RenderSafe: { page: () => ({ title: 'T', file: { path: 'x.md' } }) } };
  cfg.dispatch({ current: () => ({}) }, { context: 'journal-entry', path: 'x.md' }, 'rename');
  cfg.dispatch({ current: () => ({}) }, { context: 'journal-entry', path: 'x.md' }, 'delete');
  ok('JCB-DISPATCH-1 rename → _openRenameDialog', renameCalled);
  ok('JCB-DISPATCH-2 delete → _openDeleteDialog', deleteCalled);
  global.app = prevApp; global.customJS = prevCJS;
}
```

- [ ] **Step 2: Run test, confirm JCB-SPEC-1/JCB-DIALOG-1/JCB-DISPATCH-* FAIL**

```bash
node platform/test/run-journal-chrome-bar.js
```

- [ ] **Step 3: Add `trash` ICON, extend surfaceSpec, add `_openDeleteDialog`, wire dispatch**

Add `trash` to `ICON` getter:

```js
      trash: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>`,
```

Replace the `journal-entry` surfaceSpec branch:

```js
        if (ctx.context === "journal-entry") {
          return {
            primary: null,
            overflow: [
              { id: "back-day", label: "Back to Day", icon: ICON.back },
              { id: "hub", label: "Hub", icon: ICON.home },
              { id: "rename", label: "Change title…", icon: ICON.pencilPlus },
              { id: "delete", label: "Delete journal entry…", icon: ICON.trash },
            ],
            leaf: true,
          };
        }
```

Add `_openDeleteDialog` after `_openRenameDialog` (byte-parity with sticky's — copy from Task 4 Step 3, no changes needed).

Extend the dispatch function with two new branches (before closing `}`):

```js
        if (id === "rename") {
          const file = ctx && ctx.path && typeof app !== "undefined" && app.vault
            ? app.vault.getAbstractFileByPath(ctx.path) : null;
          if (!file) return;
          const page = customJS && customJS.RenderSafe && typeof customJS.RenderSafe.page === "function"
            ? customJS.RenderSafe.page(dv) : (dv && dv.current ? dv.current() : null);
          const current = page && page.title != null ? String(page.title).trim() : "";
          this._openRenameDialog(file, current, () => {});
          return;
        }
        if (id === "delete") {
          const file = ctx && ctx.path && typeof app !== "undefined" && app.vault
            ? app.vault.getAbstractFileByPath(ctx.path) : null;
          this._openDeleteDialog(file, "spice/journal/Journal.md", "journal entry");
          return;
        }
```

- [ ] **Step 4: Run test, confirm all JCB-* PASS**

```bash
node platform/test/run-journal-chrome-bar.js
```

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/journal/helpers/journal-chrome-bar.js platform/test/run-journal-chrome-bar.js
git commit -m "feat(journal): grow leaf ⋯ menu with rename/delete + _openDeleteDialog"
```

---

## Task 8: Hub cards — flip default toggle to "all"

**Files:**
- Modify: `platform/blueprints/sticky-notes/helpers/sticky-hub-cards.js` — `_mode`
- Modify: `platform/blueprints/journal/helpers/journal-hub-cards.js` — `_mode`

- [ ] **Step 1: Locate + read journal-hub-cards.js `_mode`**

```bash
grep -n "_mode\|__journalHubMode" platform/blueprints/journal/helpers/journal-hub-cards.js
```

- [ ] **Step 2: Flip `_mode` in sticky-hub-cards.js**

In `platform/blueprints/sticky-notes/helpers/sticky-hub-cards.js`, replace:
```js
  _mode(container) {
    return container && container.__stickyHubMode === "all" ? "all" : "days";
  }
```
with:
```js
  _mode(container) {
    return container && container.__stickyHubMode === "days" ? "days" : "all";
  }
```

- [ ] **Step 3: Flip `_mode` in journal-hub-cards.js**

Same shape flip using `__journalHubMode`. Locate the current `_mode` and invert the ternary.

- [ ] **Step 4: Verify by running any hub-card test if present**

```bash
grep -rn "StickyHubCards\|JournalHubCards" platform/test/ | head
```
Run any hits; otherwise verify no test regresses via preflight in Task 12.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/sticky-notes/helpers/sticky-hub-cards.js platform/blueprints/journal/helpers/journal-hub-cards.js
git commit -m "fix(sticky-notes,journal): default hub toggle to All view"
```

---

## Task 9: Hub templates — strip redundant `# H1`

**Files:**
- Modify: `platform/blueprints/sticky-notes/templates/Sticky Hub.md`
- Modify: `platform/blueprints/journal/templates/Journal Hub.md`

- [ ] **Step 1: Rewrite `Journal Hub.md`**

Replace file contents with:
```markdown
---
type: journal-hub
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "JournalChromeBar" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "JournalHubCards" });
```
```

- [ ] **Step 2: Rewrite `Sticky Hub.md`**

Same shape, JournalChromeBar → StickyChromeBar, JournalHubCards → StickyHubCards, type: sticky-hub.

- [ ] **Step 3: Commit**

```bash
git add "platform/blueprints/sticky-notes/templates/Sticky Hub.md" "platform/blueprints/journal/templates/Journal Hub.md"
git commit -m "fix(sticky-notes,journal): drop redundant H1 from hub templates"
```

---

## Task 10: Install heals for existing consumer hubs

**Files:**
- Modify: `platform/install.js` — add two heal functions + call-site + module exports
- Test: `platform/test/run-sticky-hub-title-heal.js` (new)

**Behavior:** For each hub file (`spice/sticky-notes/Sticky.md`, `spice/journal/Journal.md`), if frontmatter `type` matches the expected hub type, strip a line matching `/^# (Sticky Notes|Journal)\s*$/` and collapse resulting triple-newlines to double. Backup-first, idempotent, never-throw.

- [ ] **Step 1: Write a Node test asserting the pure-function heal transform**

Create `platform/test/run-sticky-hub-title-heal.js`:

```js
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const install = require(path.join(ROOT, 'platform/install.js'));

// Force expose the two heals: install.js re-exports them at module-level.
const stripHubH1 = install._stripHubH1;

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

const stickyBefore = `---\ntype: sticky-hub\n---\n\n# Sticky Notes\n\n\`\`\`dataviewjs\nawait dv.view("x", { class: "StickyChromeBar" });\n\`\`\`\n`;
const stickyAfter = stripHubH1(stickyBefore, 'Sticky Notes');
ok('SHTH-1 removes \`# Sticky Notes\` line', !/^# Sticky Notes\s*$/m.test(stickyAfter));
ok('SHTH-2 idempotent', stripHubH1(stickyAfter, 'Sticky Notes') === stickyAfter);

const journalBefore = `---\ntype: journal-hub\n---\n\n# Journal\n\n\`\`\`dataviewjs\nawait dv.view("x", { class: "JournalChromeBar" });\n\`\`\`\n`;
const journalAfter = stripHubH1(journalBefore, 'Journal');
ok('SHTH-3 removes \`# Journal\` line', !/^# Journal\s*$/m.test(journalAfter));
ok('SHTH-4 no run of 3+ blank lines after strip', !/\n\n\n/.test(journalAfter));

// No matching H1 → passthrough
const noH1 = stickyAfter;
ok('SHTH-5 no-H1 passthrough returns identity', stripHubH1(noH1, 'Sticky Notes') === noH1);

console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
```

- [ ] **Step 2: Run test, confirm all SHTH-* FAIL (function not exported)**

```bash
node platform/test/run-sticky-hub-title-heal.js
```

- [ ] **Step 3: Add `_stripHubH1`, two heals, wire dispatch + exports**

Insert next to the existing hub heals in `platform/install.js` (locate `applyMeetingsHubChromeBarHeal` around line 7338 and add these after it):

```js
// _stripHubH1 — pure transform. Removes a `# {label}` line from a hub body,
// collapses any triple-newline run left behind. Idempotent.
function _stripHubH1(body, label) {
  if (typeof body !== 'string' || typeof label !== 'string' || label.length === 0) return body;
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^# ${esc}\\s*\\n?`, 'm');
  let out = body.replace(re, '');
  if (out === body) return body;
  out = out.replace(/\n{3,}/g, '\n\n');
  return out;
}

async function applyStickyHubTitleHeal(tp, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const fpath = 'spice/sticky-notes/Sticky.md';
  if (!(await adapter.exists(fpath))) return;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    const before = await adapter.read(fpath);
    if (!/^type:\s*sticky-hub\s*$/m.test(before)) return;
    const after = _stripHubH1(before, 'Sticky Notes');
    if (after === before) return;
    const backupPath = `.sauce-backup/${ts}/${fpath}`;
    const backupParent = backupPath.substring(0, backupPath.lastIndexOf('/'));
    try { await adapter.mkdir(backupParent); } catch (_e) {}
    try { await adapter.write(backupPath, before); } catch (_e) {}
    await adapter.write(fpath, after);
    history?.push({ event: 'info', step: 'sticky_hub_title_heal', target: fpath, action: 'healed',
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
  } catch (e) {
    history?.push({ event: 'warning', step: 'sticky_hub_title_heal',
      reason: `${fpath}: ${e && e.message ? e.message : String(e)}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
  }
}

async function applyJournalHubTitleHeal(tp, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const fpath = 'spice/journal/Journal.md';
  if (!(await adapter.exists(fpath))) return;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    const before = await adapter.read(fpath);
    if (!/^type:\s*journal-hub\s*$/m.test(before)) return;
    const after = _stripHubH1(before, 'Journal');
    if (after === before) return;
    const backupPath = `.sauce-backup/${ts}/${fpath}`;
    const backupParent = backupPath.substring(0, backupPath.lastIndexOf('/'));
    try { await adapter.mkdir(backupParent); } catch (_e) {}
    try { await adapter.write(backupPath, before); } catch (_e) {}
    await adapter.write(fpath, after);
    history?.push({ event: 'info', step: 'journal_hub_title_heal', target: fpath, action: 'healed',
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
  } catch (e) {
    history?.push({ event: 'warning', step: 'journal_hub_title_heal',
      reason: `${fpath}: ${e && e.message ? e.message : String(e)}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
  }
}
```

Wire the calls right after `applyMeetingsHubChromeBarHeal` call (around line 547):
```js
    await applyStickyHubTitleHeal(tp, installedNow.history, git);
    await applyJournalHubTitleHeal(tp, installedNow.history, git);
```

Add module exports (in the module.exports block near line 21552, right after `applyMeetingsHubChromeBarHeal` export):
```js
    module.exports.applyStickyHubTitleHeal = applyStickyHubTitleHeal;
    module.exports.applyJournalHubTitleHeal = applyJournalHubTitleHeal;
    module.exports._stripHubH1 = _stripHubH1;
```

- [ ] **Step 4: Run new heal test + confirm all SHTH-* PASS**

```bash
node platform/test/run-sticky-hub-title-heal.js
```

- [ ] **Step 5: Register the new test in `release:preflight` script**

Add `&& node platform/test/run-sticky-hub-title-heal.js` to the `release:preflight` script line in `package.json` (append near the end of the chain).

- [ ] **Step 6: Commit**

```bash
git add platform/install.js platform/test/run-sticky-hub-title-heal.js package.json
git commit -m "feat(install): heal existing hubs by stripping redundant H1"
```

---

## Task 11: Version bumps

**Files:**
- Modify: `platform/blueprints/sticky-notes/manifest.json` — `version: "0.10.2"` → `"0.11.0"`
- Modify: `platform/blueprints/journal/manifest.json` — `version: "0.4.2"` → `"0.5.0"`

**Note:** The release pipeline (per repo CLAUDE.md) computes per-component + umbrella bumps automatically. **DO NOT** touch `workshop_version`, `package.json` root version, `ranch` pins, or seed-vault manifests — the bumper owns those.

- [ ] **Step 1: Bump sticky-notes**

```bash
sed -i '' 's/"version": "0.10.2"/"version": "0.11.0"/' platform/blueprints/sticky-notes/manifest.json
```

- [ ] **Step 2: Bump journal**

```bash
sed -i '' 's/"version": "0.4.2"/"version": "0.5.0"/' platform/blueprints/journal/manifest.json
```

- [ ] **Step 3: Verify with grep**

```bash
grep '"version"' platform/blueprints/sticky-notes/manifest.json platform/blueprints/journal/manifest.json
```
Expected: sticky-notes 0.11.0, journal 0.5.0.

- [ ] **Step 4: Commit**

```bash
git add platform/blueprints/sticky-notes/manifest.json platform/blueprints/journal/manifest.json
git commit -m "chore(sticky-notes,journal): bump component versions"
```

---

## Task 12: Preflight + PR

**Files:** none (validation only)

- [ ] **Step 1: Run full preflight**

```bash
npm run release:preflight 2>&1 | tail -60
```
Expected: all green. If a test fails, read its output, fix, re-run.

- [ ] **Step 2: Push branch + open PR**

```bash
git push -u origin feat/sticky-journal-title-actions
gh pr create --title "feat: sticky+journal title styling, ⋯ actions, hub cleanup" --body "$(cat <<'EOF'
## Summary
- Restyle sticky-note + journal-entry leaf titles as SectionLabel-style (subtle uppercase muted + hairline below), sourced from \`frontmatter.title\` with filename fallback.
- Sticky ⋯ menu grows Change title / Add link / Move to another day / Delete. Journal ⋯ menu grows Change title / Delete.
- Sticky reuses \`SectionExplorer.renderNoteLinks\` — pinned-links parity with wiki/project.
- Drop redundant \`# H1\` from both hub templates (Obsidian already renders the filename inline title).
- Flip both hub views to default to "All" instead of "Days".
- Install heals \`applyStickyHubTitleHeal\` + \`applyJournalHubTitleHeal\` strip the H1 from already-deployed consumer hubs.

Design: \`Docs/superpowers/specs/2026-07-13-sticky-journal-title-and-actions-design.md\`

## Test plan
- [x] \`npm run release:preflight\` green
- [ ] Verify banner + ⋯ menu render on live vault after brew upgrade
- [ ] Move a sticky note between days
- [ ] Delete a sticky note + a journal entry
- [ ] Confirm hub H1 is gone on all three consumer vaults
EOF
)"
```

- [ ] **Step 3: Watch CI + merge when green**

```bash
gh pr view --json number,url | jq -r '.url'
```
Poll `gh pr checks <num>` until all pass, then:
```bash
gh pr merge --squash --auto
```

- [ ] **Step 4: Wait for release + tap PRs to auto-merge**

Per repo CLAUDE.md, both are fully automatic. After the feature PR merges to `main`:
1. Release PR opens on the workshop repo — auto-merges once CI is green.
2. Tap PR opens on the brew tap — auto-merges once its CI is green.

Monitor with:
```bash
gh pr list --state open --json number,title,url
gh -R "$(git remote -v | awk '/origin.*fetch/ {print $2}' | sed 's/.*[:/]\([^/]*\/[^/]*\)\.git/\1/' | head -1 | sed 's|-tap$||')-tap" pr list --state open --json number,title,url 2>/dev/null || true
```

- [ ] **Step 5: Bump brew + deploy to all three consumer vaults**

Once tap PR is merged:
```bash
brew update && brew upgrade sauce
```

For each vault (paths per `Docs/agent-guides/vault-paths.md`), run:
```bash
bash -c 'cd <vault-path> && sauce update --bump-pins'
```

Vaults: accuris, headspace, ero. Verify each finishes with `allOk`.

- [ ] **Step 6: Live verify + report**

Verify on each vault:
- Open a sticky note leaf → SectionLabel-style title + ⋯ menu present.
- Open a journal entry → same styling, ⋯ has rename + delete only.
- Open `spice/sticky-notes/Sticky.md` and `spice/journal/Journal.md` → no duplicate title; toggle defaults to All.
- Confirm `.sauce-backup/<ts>/spice/{sticky-notes/Sticky.md,journal/Journal.md}` exists on any vault that had the legacy H1.

Report back only after all three vaults verified live.

---

## Self-Review (post-write)

**Spec coverage:**
- §S1 title restyle → Task 1. ✓
- §S2 pinned links → Task 2. ✓
- §S3 sticky ⋯ menu → Task 3 (surface) + Task 5 (dispatch). ✓
- §S4 new dialogs → Task 4. ✓
- §J1 journal banner → Task 6. ✓
- §J2 journal ⋯ menu → Task 7. ✓
- §J3 journal dialogs → Task 7. ✓
- §H1 toggle default → Task 8. ✓
- §H2 hub template H1 removal → Task 9. ✓
- §M1 install heals → Task 10. ✓
- §V version bumps → Task 11. ✓
- Preflight + PR + release + deploy → Task 12. ✓

**Placeholder scan:** None. Every step names exact files, exact commands, and shows the exact code to write.

**Type consistency:** `_openMoveDayDialog`, `_openDeleteDialog`, `_openRenameDialog`, `_maybeRenderPinnedLinks`, `_maybeRenderBanner`, `_stripHubH1`, `applyStickyHubTitleHeal`, `applyJournalHubTitleHeal` — all method/function names consistent across tasks. Version strings 0.11.0 / 0.5.0 consistent across §V and Task 11.
