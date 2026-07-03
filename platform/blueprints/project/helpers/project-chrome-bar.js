/**
 * ProjectChromeBar (CustomJS) — the single per-surface chrome renderer.
 *
 * One dv.view call per project template replaces the old stack of Breadcrumb +
 * SpaceNavButtons + ProjectNavButtons + the per-surface action-row helper. The
 * bar is a single flex row:
 *   • LEFT  — the breadcrumb trail (from customJS.Breadcrumb.buildSegments),
 *             rendered as `/`-joined clickable crumbs (muted project-breadcrumb
 *             look). Ancestor crumbs link; the current crumb is plain muted text.
 *   • RIGHT — the controls, margin-left:auto:
 *               1. `Go ▾`   — opens a MenuPopover launcher listing the project's
 *                            OTHER destinations (This project) + the pinned vault
 *                            destinations (Vault). The current surface is omitted.
 *               2. primary  — a single AccentButton (New Doc / New Task / Add
 *                            workstream / …) shown only on non-leaf surfaces.
 *               3. `⋯`      — opens a MenuPopover of the surface's overflow
 *                            actions (Move / Sort / Manage links / …).
 *
 * Per-surface config lives in the pure, Node-testable _surfaceSpec(context); the
 * context classifier detectContext(filePath, dv) is copied verbatim from
 * ProjectNavButtons so the 15 project contexts classify identically. _dispatch is
 * a STUB in this task (a single switch on id emitting a Notice) — Task 4 wires
 * each case to its real helper.
 *
 * customJS class — NO imports/exports; loaded by the filesystem scan. Every
 * method is never-throw + cold-load-safe (customJS.RenderSafe.page guards render;
 * missing helpers / DOM / registry degrade to no-ops).
 */
class ProjectChromeBar {
  // ── ICON — the shared SVG glyph set ────────────────────────────────────────
  // Reuses the exact glyphs already shipped in the project helpers so the bar's
  // icons match the buttons they replace by construction:
  //   project/map/board/task/docs/todo/links  — project-nav-buttons.js:547-555
  //   plus                                     — project-links-manager.js / -workstream-manager.js
  //   minus                                    — project-workstream-manager.js
  //   gear                                     — project-links-manager.js
  //   move                                     — project-docs-index.js (Move docs)
  //   sort                                     — Lucide "arrow-down-a-z"
  static get ICON() {
    return {
      project: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
      map: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4c0 1.1.9 2 2 2h3"/><path d="M3 10v6c0 1.1.9 2 2 2h3"/></svg>`,
      board: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`,
      task: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>`,
      docs: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>`,
      todo: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
      links: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
      plus: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`,
      minus: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>`,
      gear: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4h2l.4 2.3a7 7 0 0 1 2 1.2l2.2-.9 1 1.7-1.7 1.5a7 7 0 0 1 0 2.4l1.7 1.5-1 1.7-2.2-.9a7 7 0 0 1-2 1.2L13 20h-2l-.4-2.3a7 7 0 0 1-2-1.2l-2.2.9-1-1.7 1.7-1.5a7 7 0 0 1 0-2.4L3.4 8.3l1-1.7 2.2.9a7 7 0 0 1 2-1.2z"/><circle cx="12" cy="12" r="3"/></svg>`,
      move: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="12 11 12 17"/><polyline points="9 14 12 11 15 14"/></svg>`,
      sort: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M20 8h-5"/><path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10"/><path d="M15 14h5l-5 6h5"/></svg>`,
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // detectContext + its two private helpers are COPIED VERBATIM from
  // ProjectNavButtons (project-nav-buttons.js) so the 15 project contexts
  // classify identically. Do not edit here without mirroring there.
  // ────────────────────────────────────────────────────────────────────────────

  _isMapNote(type, basename) {
    return type === "map"
      || (typeof basename === "string" && basename.endsWith("- Map"));
  }

  detectContext(filePath, dv) {
    const pathParts = filePath.split("/");
    const planningIdx = pathParts.indexOf("projects");
    if (planningIdx < 0 || planningIdx + 1 >= pathParts.length) return { context: "non-project", pathParts, planningIdx };

    const slugIndex = planningIdx + 1;
    const projectSlug = pathParts[slugIndex];
    const projectDir = pathParts.slice(0, planningIdx + 2).join("/");
    const tasksIdx = planningIdx + 2;

    const page = customJS.RenderSafe.page(dv);
    const basename = page.file.name;
    const isMap = this._isMapNote(page.type, basename);

    // Project board: <slug>-board.md directly under project dir
    if (basename.endsWith("-board") && pathParts.length === planningIdx + 3) {
      return { context: "project-board", pathParts, planningIdx, projectSlug, projectDir };
    }

    // Project map
    if (isMap && pathParts.length === planningIdx + 3) {
      return { context: "project-map", pathParts, planningIdx, projectSlug, projectDir };
    }

    // Inside tasks/?
    if (pathParts[tasksIdx] === "tasks" && pathParts.length > tasksIdx + 2) {
      const taskFolder = pathParts[tasksIdx + 1];
      const afterTask = pathParts.slice(tasksIdx + 2);

      // task hub: tasks/<X>/<X>.md
      if (afterTask.length === 1 && basename === taskFolder) {
        return { context: "task-hub", pathParts, planningIdx, projectSlug, projectDir, taskFolder };
      }

      // task-note: tasks/<X>/notes/<Y>.md
      if (afterTask.length === 2 && afterTask[0] === "notes") {
        return { context: "task-note", pathParts, planningIdx, projectSlug, projectDir, taskFolder };
      }

      // task-board: tasks/<X>/board/<X>-board.md
      if (afterTask.length === 2 && afterTask[0] === "board" && basename.endsWith("-board")) {
        return { context: "task-board", pathParts, planningIdx, projectSlug, projectDir, taskFolder };
      }

      // task-board-card: tasks/<X>/board/<Y>/<Y>.md
      if (afterTask.length === 3 && afterTask[0] === "board" && basename === afterTask[1].replace(/\.md$/, "")) {
        return { context: "task-board-card", pathParts, planningIdx, projectSlug, projectDir, taskFolder, cardName: afterTask[1] };
      }

      // legacy sub-note: tasks/<X>/<other>.md (peer to task hub)
      if (afterTask.length === 1 && basename !== taskFolder) {
        return { context: "legacy-sub-note", pathParts, planningIdx, projectSlug, projectDir, taskFolder };
      }
    }

    // v0.52.0 — Inside docs/?
    // docs-hub:  spice/projects/<slug>/docs/Docs.md
    // doc-note:  spice/projects/<slug>/docs/<Title>.md
    if (pathParts[tasksIdx] === "docs" && pathParts.length === planningIdx + 4) {
      if (basename === "Docs") {
        return { context: "docs-hub", pathParts, planningIdx, projectSlug, projectDir };
      }
      return { context: "doc-note", pathParts, planningIdx, projectSlug, projectDir };
    }

    // v0.103.0 S3.2 — section-hub branches (depth 1 + 2). Frontmatter is
    // authoritative: type === "section-hub" + depth ∈ {1, 2} fully describes
    // the node. We still read the path to fish out parent_slug for depth-2
    // back-navigation (frontmatter `parent_section` is the human label;
    // the folder slug carries the URL).
    //   depth 1: spice/projects/<slug>/docs/<section_slug>/<Section Name>.md
    //   depth 2: spice/projects/<slug>/docs/<parent_slug>/<sub_slug>/<Sub Name>.md
    if (pathParts[tasksIdx] === "docs" && pathParts.length >= planningIdx + 5) {
      const fcache = app.metadataCache.getFileCache(page.file);
      const ffm = fcache?.frontmatter || {};
      if (ffm.type === "section-hub") {
        const depth = Number(ffm.depth) || 1;
        if (depth === 1 && pathParts.length === planningIdx + 5) {
          const sectionSlug = pathParts[planningIdx + 3];
          return { context: "section-hub", depth: 1, pathParts, planningIdx, projectSlug, projectDir, sectionSlug };
        }
        if (depth === 2 && pathParts.length === planningIdx + 6) {
          const parentSlug = pathParts[planningIdx + 3];
          const sectionSlug = pathParts[planningIdx + 4];
          // parent_section frontmatter label drives the button text;
          // the path-derived parentSlug drives the URL.
          const parentSectionLabel = this._stripLinkBrackets(ffm.parent_section) || parentSlug;
          return { context: "section-hub", depth: 2, pathParts, planningIdx, projectSlug, projectDir, sectionSlug, parentSlug, parentSectionLabel };
        }
      }
      // v0.104.0.2 PATCH — doc-notes that live INSIDE section folders
      // (docs/<section_slug>/<title>.md) or sub-section folders
      // (docs/<section_slug>/<sub_section_slug>/<title>.md) have the
      // same path shape as section-hub notes but a different frontmatter
      // type. Pre-patch this branch only caught type:section-hub and
      // doc-notes fell through to context:"unknown" → zero nav buttons.
      // 28 doc-notes in accuris global-k8s knowledge/ surfaced the bug.
      if (ffm.type === "doc-note") {
        return { context: "doc-note", pathParts, planningIdx, projectSlug, projectDir };
      }
    }

    // Project hub: lives directly under project dir, has canonical type:project
    // OR (legacy compat) #project tag. v0.56.1 PATCH (FA-3 fallout): the
    // post-canonical-vocab atlas notes have type:project but no longer carry
    // the 'project' tag — checking tag-only previously left atlas pages in
    // unknown context with zero rendered buttons.
    const cache = app.metadataCache.getFileCache(page.file);
    const fm = cache?.frontmatter || {};
    const tags = fm.tags || [];
    const isAtlasShape = fm.type === "project"
      || (Array.isArray(tags) && tags.includes("project"));
    if (isAtlasShape && pathParts.length === planningIdx + 3) {
      return { context: "project-hub", pathParts, planningIdx, projectSlug, projectDir };
    }

    // v0.116.1 — project-todo context: type:project-todo file at the project root
    // (e.g. spice/projects/sauce/Sauce To-Do.md).
    if (fm.type === "project-todo" && pathParts.length === planningIdx + 3) {
      return { context: "project-todo", pathParts, planningIdx, projectSlug, projectDir };
    }

    // Project Links, PR1 — Link Hub note: "Links Hub.md" directly under the
    // project dir. Basename-based (mirrors the map/board detection above) so
    // it does not depend on the metadata cache being warm; the nav row +
    // breadcrumb render on the hub note, and the "Helpful Links" button
    // self-hides here.
    if (basename === "Links Hub" && pathParts.length === planningIdx + 3) {
      return { context: "links-hub", pathParts, planningIdx, projectSlug, projectDir };
    }

    // Projects hub: spice/projects/Projects.md (single fixed-path hub note)
    if (pathParts.length === planningIdx + 2 && basename === "Projects") {
      return { context: "projects-hub", pathParts, planningIdx };
    }

    return { context: "unknown", pathParts, planningIdx, projectSlug, projectDir };
  }

  // Copied verbatim from ProjectNavButtons — strip Obsidian link brackets off a
  // frontmatter value, returning the displayable label.
  _stripLinkBrackets(v) {
    if (!v) return "";
    if (typeof v === "string") return v.replace(/^\[\[|\]\]$/g, "").split("|")[0];
    if (v.display) return v.display;
    if (v.path) return v.path.split("/").pop().replace(/\.md$/, "");
    return "";
  }

  // ── _surfaceSpec — pure per-surface config ─────────────────────────────────
  // Returns { primary, overflow, leaf }. `primary` is the single AccentButton on
  // a non-leaf surface ({ id, label, icon }), or null. `overflow` is the list of
  // `⋯` menu actions ([{ id, label, icon, danger? }]). `leaf` = true when the
  // surface is a read-only leaf (no primary, empty overflow → no right-zone
  // action buttons; only the Go ▾ launcher). Pure + Node-testable.
  _surfaceSpec(context) {
    const ICON = ProjectChromeBar.ICON;
    switch (context) {
      case "projects-hub":
        return { primary: { id: "new-project", label: "New Project", icon: ICON.plus },
          overflow: [{ id: "sort", label: "Sort A–Z / Recent", icon: ICON.sort }], leaf: false };
      case "project-hub":
      case "project-todo":
        return { primary: { id: "new-task", label: "New Task", icon: ICON.plus },
          overflow: [{ id: "new-doc", label: "New Doc", icon: ICON.docs }], leaf: false };
      case "docs-hub":
        return { primary: { id: "new-doc", label: "New Doc", icon: ICON.plus },
          overflow: [{ id: "new-section", label: "New Section", icon: ICON.docs },
            { id: "move-docs", label: "Move docs", icon: ICON.move }], leaf: false };
      case "section-hub":
        return { primary: { id: "new-doc", label: "New Doc", icon: ICON.plus },
          overflow: [{ id: "new-subsection", label: "New Sub-Section", icon: ICON.docs },
            { id: "move-docs", label: "Move docs", icon: ICON.move }], leaf: false };
      case "project-map":
        return { primary: { id: "add-workstream", label: "Add workstream", icon: ICON.plus },
          overflow: [{ id: "remove-workstream", label: "Remove workstream", icon: ICON.minus, danger: true }], leaf: false };
      case "task-hub":
        return { primary: { id: "new-note", label: "New Note", icon: ICON.plus },
          overflow: [{ id: "task-board", label: "Create/Open Board", icon: ICON.board }], leaf: false };
      case "links-hub":
        return { primary: { id: "add-link", label: "Add link", icon: ICON.plus },
          overflow: [{ id: "manage-links", label: "Manage links", icon: ICON.gear }], leaf: false };
      case "doc-note":
        return { primary: null, overflow: [{ id: "move-docs", label: "Move", icon: ICON.move }], leaf: true };
      // project-board / task-board / task-board-card / task-note / legacy-sub-note /
      // unknown / non-project / default — bare leaf: no primary, no overflow.
      default:
        return { primary: null, overflow: [], leaf: true };
    }
  }

  // ── _navEntries — the Go ▾ launcher entries ────────────────────────────────
  // Builds [{ section:'This project' }, ...project dests, { section:'Vault' },
  // ...vault dests]. Project destinations mirror the exact paths
  // ProjectNavButtons.render() computes from ctx.projectDir/projectSlug (Project,
  // Board, Docs, Map, To-Do, Helpful Links); each is gated on existence where the
  // source gates, and the destination equal to the CURRENT surface is omitted.
  // Vault destinations are the pinned registry sources (home/to-do/scratch/
  // project/meetings order) read from ranch/nav-buttons-registry.json. Never
  // throws: a missing helper / registry / vault index degrades to fewer entries.
  async _navEntries(dv, ctx) {
    const ICON = ProjectChromeBar.ICON;
    const entries = [];
    const projectDir = ctx && ctx.projectDir;
    const projectSlug = ctx && ctx.projectSlug;
    const context = (ctx && ctx.context) || "";

    // Resolve the current file path so we can omit the current surface.
    let currentPath = "";
    try {
      const cur = dv && typeof dv.current === "function" ? dv.current() : null;
      currentPath = (cur && cur.file && cur.file.path) || "";
    } catch (_e) { currentPath = ""; }

    const exists = (p) => {
      try { return !!(app && app.vault && app.vault.getAbstractFileByPath(p)); }
      catch (_e) { return false; }
    };
    const open = (p) => {
      try { app.workspace.openLinkText(p, ""); } catch (_e) { /* never throw */ }
    };

    // ── This project ────────────────────────────────────────────────────────
    if (projectDir) {
      // Resolve the atlas (type:project) + map (type:map) notes by scanning the
      // project dir — mirrors ProjectNavButtons.render(). Best-effort; on a cold
      // index the scan simply yields fewer destinations.
      let mainNote = null;
      let mapNote = null;
      try {
        const files = (app.vault.getMarkdownFiles ? app.vault.getMarkdownFiles() : app.vault.getFiles())
          .filter((f) => f.path.startsWith(projectDir + "/") && !f.basename.endsWith("-board"));
        for (const f of files) {
          const ffm = (app.metadataCache.getFileCache(f) || {}).frontmatter || {};
          const ftags = ffm.tags || [];
          if (!mainNote && (ffm.type === "project" || (Array.isArray(ftags) && ftags.includes("project")))) mainNote = f;
          if (!mapNote && this._isMapNote(ffm.type, f.basename)) mapNote = f;
        }
      } catch (_e) { /* best-effort */ }

      const projDests = [];
      // Project (atlas) hub.
      if (mainNote) projDests.push({ label: mainNote.basename, icon: ICON.project, path: mainNote.path });
      // Project Board.
      if (projectSlug) projDests.push({ label: "Project Board", icon: ICON.board, path: `${projectDir}/${projectSlug}-board.md` });
      // Map.
      if (mapNote) projDests.push({ label: "Map", icon: ICON.map, path: mapNote.path });
      // Docs.
      projDests.push({ label: "Docs", icon: ICON.docs, path: `${projectDir}/docs/Docs.md` });
      // To-Do — derived from mainNote.path (source of truth), gated on existence.
      if (mainNote) {
        const mainDir = mainNote.path.slice(0, mainNote.path.lastIndexOf("/"));
        const toDoPath = `${mainDir}/${mainNote.basename} To-Do.md`;
        if (exists(toDoPath)) projDests.push({ label: "To-Do", icon: ICON.todo, path: toDoPath });
      }
      // Helpful Links — gated on the Links Hub note existing.
      const linksHubPath = `${projectDir}/Links Hub.md`;
      if (exists(linksHubPath)) projDests.push({ label: "Helpful Links", icon: ICON.links, path: linksHubPath });

      // Omit the destination equal to the current surface (self-nav).
      const projMarkerPushed = { done: false };
      for (const d of projDests) {
        if (d.path === currentPath) continue;
        // Also self-hide by context: docs-hub → Docs, links-hub → Helpful Links,
        // project-hub → its atlas, project-map → Map, project-board → Project Board.
        if (context === "docs-hub" && d.label === "Docs") continue;
        if (context === "links-hub" && d.label === "Helpful Links") continue;
        if (context === "project-map" && d.label === "Map") continue;
        if (context === "project-board" && d.label === "Project Board") continue;
        if ((context === "project-hub" || context === "project-todo") && mainNote && d.path === mainNote.path) continue;
        if (!projMarkerPushed.done) { entries.push({ section: "This project" }); projMarkerPushed.done = true; }
        const dest = d.path;
        entries.push({ label: d.label, icon: d.icon, _navTarget: dest, onSelect: () => open(dest) });
      }
    }

    // ── Vault ─────────────────────────────────────────────────────────────────
    // Pinned registry sources, in the SpaceNavButtons PINNED_SOURCES order. Read
    // ranch/nav-buttons-registry.json; openLink actions resolve to openLinkText,
    // everything else delegates to SpaceNavButtons._dispatchAction so Templater /
    // command actions behave identically to the vault nav bar.
    let registry = null;
    try {
      const raw = await app.vault.adapter.read("ranch/nav-buttons-registry.json");
      registry = JSON.parse(raw);
    } catch (_e) { registry = null; }

    const PINNED = ["home", "to-do", "scratch", "project", "meetings"];
    const vaultDests = [];
    if (registry && registry.contributions && typeof registry.contributions === "object") {
      const iconFor = (name) => {
        try { return (customJS.Icons && customJS.Icons.resolve && customJS.Icons.resolve(name)) || ""; }
        catch (_e) { return ""; }
      };
      for (const src of PINNED) {
        const list = registry.contributions[src];
        if (!Array.isArray(list) || list.length === 0) continue;
        const entry = list[0]; // first entry per source claims the pin slot
        const action = (entry && entry.action) || {};
        const label = entry.label || src;
        const icon = iconFor(entry.icon);
        if (action.type === "openLink" && action.target) {
          const target = action.target;
          vaultDests.push({ label, icon, onSelect: () => open(target) });
        } else {
          const dispatchEntry = { ...entry, _source: src };
          vaultDests.push({ label, icon, onSelect: () => {
            try {
              if (customJS && customJS.SpaceNavButtons && typeof customJS.SpaceNavButtons._dispatchAction === "function") {
                customJS.SpaceNavButtons._dispatchAction(dispatchEntry, dv);
              }
            } catch (_e) { /* never throw */ }
          } });
        }
      }
    }
    if (vaultDests.length > 0) {
      entries.push({ section: "Vault" });
      for (const d of vaultDests) entries.push(d);
    }

    return entries;
  }

  // ── _dispatch — STUB for Task 3 ────────────────────────────────────────────
  // A single switch on the surface-action id. Task 4 fills each case with its
  // real helper call; for now every branch emits a Notice so the wiring is
  // observable in-vault. Guarded so a missing Notice global can't throw.
  _dispatch(dv, ctx, id) {
    try {
      switch (id) {
        case "new-project":
        case "new-task":
        case "new-doc":
        case "new-section":
        case "new-subsection":
        case "new-note":
        case "move-docs":
        case "sort":
        case "add-workstream":
        case "remove-workstream":
        case "task-board":
        case "add-link":
        case "manage-links":
        default:
          if (typeof Notice === "function") new Notice("ProjectChromeBar action: " + id);
          return;
      }
    } catch (_e) { /* never throw */ }
  }

  // ── render — the single chrome bar ─────────────────────────────────────────
  async render(dv) {
    // Cold-load guard (mirror doc-leaf-actions.js): bail on missing page/file or
    // an embedded render context.
    const page = customJS.RenderSafe.page(dv);
    if (!page || !page.file) return;
    const container0 = (dv && dv.container) ? dv.container : dv;
    if (!container0 || typeof container0.createEl !== "function") return;
    if (container0.closest && container0.closest(".markdown-embed")) return;

    const filePath = page.file.path;
    const ctx = this.detectContext(filePath, dv);
    // Non-project surfaces render nothing.
    if (ctx.context === "non-project" || ctx.context === "unknown") return;

    const spec = this._surfaceSpec(ctx.context);

    // Dedupe: Dataview can re-fire a block without clearing the container. Wrap
    // all output in a single removable root so a re-render replaces prior output.
    try {
      const prev = container0.querySelector && container0.querySelector(":scope > .pcb-root");
      if (prev && prev.remove) prev.remove();
    } catch (_e) { /* best-effort */ }
    const root = container0.createEl("div", { cls: "pcb-root" });

    // Single flex bar: breadcrumb left, controls right.
    const bar = root.createEl("div");
    bar.style.cssText = "display: flex; align-items: center; gap: 10px; flex-wrap: wrap;";

    // ── LEFT — breadcrumb crumbs ──────────────────────────────────────────────
    let segments = [];
    try {
      if (customJS && customJS.Breadcrumb && typeof customJS.Breadcrumb.buildSegments === "function") {
        segments = await customJS.Breadcrumb.buildSegments(dv);
      }
    } catch (_e) { segments = []; }
    if (Array.isArray(segments) && segments.length > 0) {
      const left = bar.createEl("div", { cls: "project-breadcrumb" });
      left.style.cssText = "font-size: 0.85em; color: var(--text-muted); display: flex; align-items: center; flex-wrap: wrap; gap: 2px; min-width: 0;";
      segments.forEach((seg, i) => {
        if (i > 0) {
          const sep = left.createEl("span");
          sep.textContent = " / ";
          sep.style.cssText = "opacity: 0.5; margin: 0 2px;";
        }
        if (seg && seg.link) {
          const a = left.createEl("a");
          a.textContent = seg.label;
          a.style.cssText = "color: var(--text-muted); cursor: pointer; text-decoration: none;";
          const target = seg.link;
          a.onclick = (e) => {
            if (e && e.preventDefault) e.preventDefault();
            try { app.workspace.openLinkText(target, ""); } catch (_err) { /* never throw */ }
          };
        } else {
          const cur = left.createEl("span");
          cur.textContent = (seg && seg.label) || "";
          cur.style.cssText = "color: var(--text-muted);";
        }
      });
    }

    // ── RIGHT — controls (Go ▾ · primary · ⋯), pushed right via margin-left:auto ─
    const right = bar.createEl("div");
    right.style.cssText = "margin-left: auto; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;";

    // Touch-target sizing: every control ≥44px tall (padding). Applied after the
    // AccentButton base so it wins.
    const touch = (btn) => {
      if (btn && btn.style) {
        btn.style.minHeight = "44px";
        btn.style.padding = "9px 14px";
      }
      return btn;
    };

    // 1. Go ▾ launcher.
    const chevronDown = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
    let goBtn = null;
    goBtn = touch(customJS.AccentButton.render(right, {
      label: "Go",
      icon: chevronDown,
      onClick: async () => {
        try {
          const navEntries = await this._navEntries(dv, ctx);
          if (customJS && customJS.MenuPopover && typeof customJS.MenuPopover.open === "function") {
            customJS.MenuPopover.open(navEntries, { anchor: goBtn, title: "Go to" });
          }
        } catch (_e) { /* never throw */ }
      },
    }));

    // 2. Primary AccentButton — non-leaf surfaces only.
    if (!spec.leaf && spec.primary) {
      const p = spec.primary;
      touch(customJS.AccentButton.render(right, {
        label: p.label,
        icon: p.icon,
        onClick: () => this._dispatch(dv, ctx, p.id),
      }));
    }

    // 3. ⋯ overflow menu — when the surface declares overflow actions.
    if (Array.isArray(spec.overflow) && spec.overflow.length > 0) {
      let dotsBtn = null;
      dotsBtn = touch(customJS.AccentButton.render(right, {
        label: "⋯",
        icon: "",
        onClick: () => {
          try {
            const menu = spec.overflow.map((o) => ({
              label: o.label,
              icon: o.icon,
              danger: o.danger,
              onSelect: () => this._dispatch(dv, ctx, o.id),
            }));
            if (customJS && customJS.MenuPopover && typeof customJS.MenuPopover.open === "function") {
              customJS.MenuPopover.open(menu, { anchor: dotsBtn });
            }
          } catch (_e) { /* never throw */ }
        },
      }));
    }
  }
}
