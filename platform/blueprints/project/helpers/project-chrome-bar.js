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
 * the complete action router: a single switch on the surface-action id that
 * delegates each case to the EXACT helper the old action-row button fired
 * (EntityCreate.create for new-doc/-section/-project, TaskDialog.open for
 * new-task, ProjectNavButtons' create methods for task notes/boards, the
 * Doc/Link/Workstream managers for move/link/workstream actions), so behavior is
 * byte-faithful. Every branch is cold-load-guarded → a graceful Notice, never a
 * throw. ProjectCommandsInit reuses the same _dispatch + navTarget so the command
 * palette mirror stays in lockstep with the buttons.
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

  // Slugify a name the way TaskDialog / ToDoLeafActions do (lowercase, runs of
  // non-alphanumerics → single dash, trimmed). Used to derive a task's
  // project.slug when the note lacks a project_slug frontmatter.
  _slugify(name) {
    return String(name == null ? "" : name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  // Resolve a project's display name from its hub note basename (mirrors
  // ProjectNavButtons._resolveProjectName): the project dir holds exactly one
  // note with frontmatter type:project; its filename (sans .md) IS the display
  // name. Returns null when projectDir is falsy or no type:project note is found.
  _resolveProjectName(projectDir) {
    if (!projectDir) return null;
    try {
      const prefix = projectDir + "/";
      for (const f of app.vault.getMarkdownFiles()) {
        if (!f.path.startsWith(prefix)) continue;
        if (f.path.slice(prefix.length).includes("/")) continue;
        const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter;
        if (fm && fm.type === "project") return (fm.name || f.basename);
      }
    } catch (_e) { /* best-effort — fall back to slug */ }
    return null;
  }

  // Open an ABSOLUTE vault path safely: resolve to the TFile and openFile it
  // (bypasses the link resolver, which can double an absolute path against the
  // current note's folder on a cold cache — the doubled-path bug). Falls back
  // to openLinkText only when the file isn't in the vault index yet. Copied from
  // ProjectNavButtons._openNavTarget; keep the two in sync.
  _openNavTarget(path, dv) {
    try {
      const f = app.vault.getAbstractFileByPath(path);
      if (f && app.workspace && typeof app.workspace.getLeaf === "function") {
        app.workspace.getLeaf(false).openFile(f);
        return;
      }
    } catch (_e) { /* fall through to openLinkText */ }
    try { app.workspace.openLinkText(path, ""); } catch (_err) { /* never throw */ }
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

  // Resolve the project's atlas (type:project) + map (type:map) notes by scanning
  // the project dir — mirrors ProjectNavButtons.render(). Best-effort: a cold
  // index simply yields nulls. Shared by _navEntries + navTarget so both agree on
  // which files back the Map / atlas destinations.
  _resolveProjectNotes(projectDir) {
    let mainNote = null;
    let mapNote = null;
    if (!projectDir) return { mainNote, mapNote };
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
    return { mainNote, mapNote };
  }

  // ── navTarget — resolve ONE project destination path by key ─────────────────
  // key ∈ board | docs | map | todo | links. Returns the absolute vault path for
  // that destination, gated on existence exactly where _navEntries gates it, or
  // null when the destination can't be resolved (missing map note / no To-Do note
  // / no Links Hub / cold index). Public so both _navEntries and the command
  // mirror (ProjectCommandsInit) compute paths from the SAME logic. Never throws.
  navTarget(dv, ctx, key) {
    try {
      const projectDir = ctx && ctx.projectDir;
      const projectSlug = ctx && ctx.projectSlug;
      if (!projectDir) return null;
      const exists = (p) => {
        try { return !!(app && app.vault && app.vault.getAbstractFileByPath(p)); }
        catch (_e) { return false; }
      };
      switch (key) {
        case "board":
          return projectSlug ? `${projectDir}/${projectSlug}-board.md` : null;
        case "docs":
          return `${projectDir}/docs/Docs.md`;
        case "links": {
          const linksHubPath = `${projectDir}/Links Hub.md`;
          return exists(linksHubPath) ? linksHubPath : null;
        }
        case "map": {
          const { mapNote } = this._resolveProjectNotes(projectDir);
          return mapNote ? mapNote.path : null;
        }
        case "todo": {
          const { mainNote } = this._resolveProjectNotes(projectDir);
          if (!mainNote) return null;
          const mainDir = mainNote.path.slice(0, mainNote.path.lastIndexOf("/"));
          const toDoPath = `${mainDir}/${mainNote.basename} To-Do.md`;
          return exists(toDoPath) ? toDoPath : null;
        }
        default:
          return null;
      }
    } catch (_e) { return null; }
  }

  // ── _navEntries — the Go ▾ launcher entries ────────────────────────────────
  // Builds [{ section:'This project' }, ...project dests, { section:'Vault' },
  // ...vault dests]. Project destinations mirror the exact paths
  // ProjectNavButtons.render() computes from ctx.projectDir/projectSlug (Project,
  // Board, Docs, Map, To-Do, Helpful Links); each is gated on existence where the
  // source gates, and the destination equal to the CURRENT surface is omitted.
  // Vault destinations are the pinned registry sources (home/to-do/sticky-notes/
  // project/meetings order) read from ranch/nav-buttons-registry.json. Never
  // throws: a missing helper / registry / vault index degrades to fewer entries.
  async _navEntries(dv, ctx) {
    const ICON = ProjectChromeBar.ICON;
    const entries = [];
    const projectDir = ctx && ctx.projectDir;
    const context = (ctx && ctx.context) || "";

    // Resolve the current file path so we can omit the current surface.
    let currentPath = "";
    try {
      const cur = dv && typeof dv.current === "function" ? dv.current() : null;
      currentPath = (cur && cur.file && cur.file.path) || "";
    } catch (_e) { currentPath = ""; }

    const open = (p) => {
      try { this._openNavTarget(p, dv); } catch (_e) { /* never throw */ }
    };

    // ── This project ────────────────────────────────────────────────────────
    if (projectDir) {
      // Resolve the atlas (type:project) + map (type:map) notes once; the map /
      // to-do / docs / board / links destination PATHS come from navTarget so the
      // launcher and the command mirror agree by construction.
      const { mainNote } = this._resolveProjectNotes(projectDir);

      const projDests = [];
      // Project (atlas) hub — not a navTarget key (label is the note basename).
      if (mainNote) projDests.push({ label: mainNote.basename, icon: ICON.project, path: mainNote.path });
      // Project Board.
      const boardPath = this.navTarget(dv, ctx, "board");
      if (boardPath) projDests.push({ label: "Project Board", icon: ICON.board, path: boardPath });
      // Map.
      const mapPath = this.navTarget(dv, ctx, "map");
      if (mapPath) projDests.push({ label: "Map", icon: ICON.map, path: mapPath });
      // Docs.
      const docsPath = this.navTarget(dv, ctx, "docs");
      if (docsPath) projDests.push({ label: "Docs", icon: ICON.docs, path: docsPath });
      // To-Do — derived from mainNote.path (source of truth), gated on existence.
      const toDoPath = this.navTarget(dv, ctx, "todo");
      if (toDoPath) projDests.push({ label: "To-Do", icon: ICON.todo, path: toDoPath });
      // Helpful Links — gated on the Links Hub note existing.
      const linksHubPath = this.navTarget(dv, ctx, "links");
      if (linksHubPath) projDests.push({ label: "Helpful Links", icon: ICON.links, path: linksHubPath });

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

    // ── Vault ── delegated to the shared ChromeBar mechanism, which owns the
    // all-registry-sources + ordering (via SpaceNavButtons.firstEntryPerSource) +
    // { section:"Vault", layout:"grid" } marker logic. Kept in one place so every
    // blueprint's Go ▾ launcher lists the same vault destinations identically.
    try {
      if (customJS && customJS.ChromeBar && typeof customJS.ChromeBar.vaultEntries === "function") {
        const vault = await customJS.ChromeBar.vaultEntries(dv, open);
        for (const e of vault) entries.push(e);
      }
    } catch (_e) { /* never throw */ }

    return entries;
  }

  // ── _dispatch — route each surface-action id to its existing helper ─────────
  // A single switch on the surface-action id. Every case delegates to the SAME
  // helper the old action-row button did, so behavior is byte-faithful. All
  // branches are cold-load-guarded: a helper that hasn't registered yet degrades
  // to a graceful Notice instead of throwing (the whole method is wrapped so a
  // missing global can never abort a render's button click).
  //
  // Reuse strategy (documented for future maintainers):
  //   • entity-create ids (new-doc / new-section / new-subsection / new-project)
  //     route through customJS.EntityCreate.create({ instance, dv, presetPrompts })
  //     — the directly-callable create() runs the EXACT prompt→create flow that
  //     EntityCreate.render()'s button onClick fires (render() just wraps create()
  //     in an AccentButton). So no button re-render is needed.
  //   • new-task opens TaskDialog with surface:'project' + project:{ name, slug }
  //     — the same shape ToDoLeafActions uses (slug prefers the note's
  //     project_slug frontmatter; name is the resolved project display name).
  _dispatch(dv, ctx, id) {
    try {
      const missing = (label) => { if (typeof Notice === "function") new Notice(label + " unavailable — reinstall the project blueprint.", 6000); };
      switch (id) {
        case "new-task": {
          const TD = (typeof customJS !== "undefined") && customJS.TaskDialog;
          if (!TD || typeof TD.open !== "function") { missing("TaskDialog"); return; }
          // Project identity for the task note (mirrors ToDoLeafActions): prefer
          // the note's own project_slug frontmatter, then the display name from
          // the project hub note, falling back to the path-derived slug.
          let cur = null;
          try { cur = dv && typeof dv.current === "function" ? dv.current() : null; } catch (_e) { cur = null; }
          const name = this._resolveProjectName(ctx && ctx.projectDir) || (ctx && ctx.projectSlug) || "";
          const slug = (cur && cur.project_slug) || (ctx && ctx.projectSlug) || (name ? this._slugify(name) : "");
          TD.open({ surface: "project", project: { name, slug } });
          return;
        }
        case "new-doc": {
          // On a docs-hub the user picks the section (options_source), so NO
          // presets. On a section-hub, seed the section (and, for depth-2, the
          // sub-section) so the doc lands in the CURRENT section without a
          // re-prompt — mirroring section-hub.js's New Doc button exactly.
          const presets = (ctx && ctx.context === "section-hub") ? this._docPresetsForSection(dv) : null;
          this._entityCreate(dv, "doc-note", presets);
          return;
        }
        case "new-section": {
          this._entityCreate(dv, "section-hub");
          return;
        }
        case "new-subsection": {
          // sub-section-hub seeds parent_slug from the current section's slug so
          // the sub-section nests under it (mirrors section-hub.js's presetPrompts).
          this._entityCreate(dv, "sub-section-hub", { parent_slug: (ctx && ctx.sectionSlug) || "" });
          return;
        }
        case "new-project": {
          this._entityCreate(dv, "project");
          return;
        }
        case "move-docs": {
          // Leaf doc-note → the single-doc Move tree dialog (DocMoveDialog,
          // fallback DocLeafActions._onMove). Hub (docs-hub / section-hub) → the
          // multi-select bulk-move dialog (DocBulkMoveActions._onBulkMove).
          const context = (ctx && ctx.context) || "";
          if (context === "doc-note") {
            const DMD = (typeof customJS !== "undefined") && customJS.DocMoveDialog;
            if (DMD && typeof DMD._openMoveDialog === "function") {
              let currentPath = "";
              try {
                const cur = dv && typeof dv.current === "function" ? dv.current() : null;
                currentPath = (cur && cur.file && cur.file.path) || "";
              } catch (_e) { currentPath = ""; }
              DMD._openMoveDialog(dv, currentPath);
              return;
            }
            const DLA = (typeof customJS !== "undefined") && customJS.DocLeafActions;
            if (DLA && typeof DLA._onMove === "function") { DLA._onMove(dv); return; }
            missing("DocMoveDialog");
            return;
          }
          const BM = (typeof customJS !== "undefined") && customJS.DocBulkMoveActions;
          if (BM && typeof BM._onBulkMove === "function") { BM._onBulkMove(dv); return; }
          missing("DocBulkMoveActions");
          return;
        }
        case "add-link": {
          const PLM = (typeof customJS !== "undefined") && customJS.ProjectLinksManager;
          if (PLM && typeof PLM._onAdd === "function") { PLM._onAdd(dv); return; }
          missing("ProjectLinksManager");
          return;
        }
        case "manage-links": {
          const PLM = (typeof customJS !== "undefined") && customJS.ProjectLinksManager;
          if (PLM && typeof PLM._onManage === "function") { PLM._onManage(dv); return; }
          missing("ProjectLinksManager");
          return;
        }
        case "add-workstream": {
          const WM = (typeof customJS !== "undefined") && customJS.ProjectWorkstreamManager;
          if (WM && typeof WM.addWorkstream === "function") { WM.addWorkstream(dv); return; }
          missing("ProjectWorkstreamManager");
          return;
        }
        case "remove-workstream": {
          const WM = (typeof customJS !== "undefined") && customJS.ProjectWorkstreamManager;
          if (WM && typeof WM.removeWorkstream === "function") { WM.removeWorkstream(dv); return; }
          missing("ProjectWorkstreamManager");
          return;
        }
        case "new-note": {
          // task-hub "New Note" — reuse ProjectNavButtons' prompt + create.
          this._createTaskNoteFlow(dv, ctx);
          return;
        }
        case "task-board": {
          // task-hub "Create/Open Board" — reuse ProjectNavButtons._createTaskBoard;
          // open the board if it already exists.
          this._taskBoardFlow(dv, ctx);
          return;
        }
        case "sort": {
          // projects-hub "Sort A–Z / Recent" — flip the ProjectsHubCards persisted
          // sort mode + re-render the hub. ProjectsHubCards owns the localStorage
          // key + the render; toggling the persisted mode then forcing a Dataview
          // refresh reruns its render with the new order.
          this._toggleProjectsSort();
          return;
        }
        default:
          if (typeof Notice === "function") new Notice("ProjectChromeBar action: " + id);
          return;
      }
    } catch (_e) { /* never throw */ }
  }

  // Delegate an entity-create id to the directly-callable EntityCreate.create()
  // (runs the exact prompt→create flow EntityCreate.render()'s button fires).
  // Guarded: a cold-loading EntityCreate degrades to a Notice.
  _entityCreate(dv, instance, presetPrompts) {
    try {
      const EC = (typeof customJS !== "undefined") && customJS.EntityCreate;
      if (!EC || typeof EC.create !== "function") {
        if (typeof Notice === "function") new Notice("EntityCreate unavailable — reinstall the project blueprint.", 6000);
        return;
      }
      const opts = { instance, dv };
      if (presetPrompts) opts.presetPrompts = presetPrompts;
      EC.create(opts);
    } catch (_e) { /* never throw */ }
  }

  // Build the doc-note presetPrompts for a "New Doc" fired on a SECTION-HUB, so
  // the new doc lands in the current section (depth 1) or sub-section (depth 2)
  // without re-prompting. Byte-for-byte mirrors section-hub.js's _renderActionRow
  // presets: depth 1 → section=this section; depth 2 → section=parent,
  // sub_section=this section. Reads the live frontmatter via dv.current().
  // Returns null on cold-load (the doc-note picker then prompts, a safe fallback).
  _docPresetsForSection(dv) {
    try {
      const cur = dv && typeof dv.current === "function" ? dv.current() : null;
      if (!cur || !cur.file) return null;
      const depth = Number(cur.depth) || 1;
      const sectionSlug = cur.section_slug;
      const sectionName = cur.section || cur.file.name;
      if (!sectionSlug) return null;
      if (depth === 2) {
        const parentName = this._stripLinkBrackets(cur.parent_section);
        const parentSlug = this._slugify(parentName);
        return { section: parentName, section_slug: parentSlug, sub_section: sectionName, sub_section_slug: sectionSlug };
      }
      return { section: sectionName, section_slug: sectionSlug, sub_section: "", sub_section_slug: "" };
    } catch (_e) { return null; }
  }

  // task-hub "New Note": prompt for a title + create the task note, reusing the
  // existing ProjectNavButtons methods (_promptForTitle / _createTaskNote). The
  // notes folder + task-hub path are derived from ctx (the task-hub note is the
  // current file). On success, open the new note. Guarded end-to-end.
  async _createTaskNoteFlow(dv, ctx) {
    try {
      const PNB = (typeof customJS !== "undefined") && customJS.ProjectNavButtons;
      if (!PNB || typeof PNB._promptForTitle !== "function" || typeof PNB._createTaskNote !== "function") {
        if (typeof Notice === "function") new Notice("ProjectNavButtons unavailable — reinstall the project blueprint.", 6000);
        return;
      }
      const projectDir = ctx && ctx.projectDir;
      const projectSlug = ctx && ctx.projectSlug;
      const taskFolder = ctx && ctx.taskFolder;
      if (!projectDir || !taskFolder) return;
      const notesFolder = `${projectDir}/tasks/${taskFolder}/notes`;
      // The task-hub note itself is the parent path stamped into the new note.
      let taskHubPath = `${projectDir}/tasks/${taskFolder}/${taskFolder}.md`;
      try {
        const cur = dv && typeof dv.current === "function" ? dv.current() : null;
        if (cur && cur.file && cur.file.path) taskHubPath = cur.file.path;
      } catch (_e) { /* keep the derived path */ }
      const title = await PNB._promptForTitle(notesFolder);
      if (!title) return;
      const targetPath = await PNB._createTaskNote(notesFolder, title, projectSlug, taskFolder, taskHubPath, projectDir);
      if (targetPath) {
        try { if (typeof Notice === "function") new Notice(`Created: ${title}`); } catch (_e) {}
        try { app.workspace.openLinkText(targetPath, ""); } catch (_e) {}
      }
    } catch (_e) { /* never throw */ }
  }

  // task-hub "Create/Open Board": open the board if it already exists, else
  // create it via ProjectNavButtons._createTaskBoard, then open it. Guarded.
  async _taskBoardFlow(dv, ctx) {
    try {
      const projectDir = ctx && ctx.projectDir;
      const taskFolder = ctx && ctx.taskFolder;
      if (!projectDir || !taskFolder) return;
      const boardPath = `${projectDir}/tasks/${taskFolder}/board/${taskFolder}-board.md`;
      let exists = false;
      try { exists = !!(app && app.vault && app.vault.getAbstractFileByPath(boardPath)); } catch (_e) { exists = false; }
      if (exists) { try { app.workspace.openLinkText(boardPath, ""); } catch (_e) {} return; }
      const PNB = (typeof customJS !== "undefined") && customJS.ProjectNavButtons;
      if (!PNB || typeof PNB._createTaskBoard !== "function") {
        if (typeof Notice === "function") new Notice("ProjectNavButtons unavailable — reinstall the project blueprint.", 6000);
        return;
      }
      const created = await PNB._createTaskBoard(projectDir, taskFolder);
      if (created) {
        try { if (typeof Notice === "function") new Notice("Task board created."); } catch (_e) {}
        try { app.workspace.openLinkText(created, ""); } catch (_e) {}
      }
    } catch (_e) { /* never throw */ }
  }

  // projects-hub "Sort A–Z / Recent": flip the persisted ProjectsHubCards sort
  // mode (localStorage key "sauce.projects-hub.sort") then force a Dataview
  // refresh so ProjectsHubCards.render() reruns with the new order. The hub
  // reads the persisted mode on render, so persisting + refreshing is enough.
  _toggleProjectsSort() {
    try {
      const KEY = "sauce.projects-hub.sort";
      let mode = "mtime";
      try {
        if (typeof localStorage !== "undefined") {
          const raw = localStorage.getItem(KEY);
          if (raw === "alpha" || raw === "mtime") mode = raw;
        }
      } catch (_e) { mode = "mtime"; }
      const next = mode === "alpha" ? "mtime" : "alpha";
      try { if (typeof localStorage !== "undefined") localStorage.setItem(KEY, next); } catch (_e) {}
      try {
        if (app && app.commands && typeof app.commands.executeCommandById === "function") {
          app.commands.executeCommandById("dataview:dataview-force-refresh-views");
        }
      } catch (_e) { /* best-effort re-render */ }
    } catch (_e) { /* never throw */ }
  }

  // ── _adapter — the ChromeBar adapter for the project blueprint ──────────────
  // Supplies the blueprint-specific parts (classify + surface-spec, the Go ▾
  // launcher entries, action dispatch, cold-cache-safe open, and the project's
  // own marker classes) to the shared ChromeBar.render, which owns the generic
  // bar. Feeding back "pcb-root"/"pcb-btn pcb-btn-<variant>" keeps the rendered
  // DOM byte-identical to the pre-extraction bar.
  _adapter() {
    return {
      resolve: (dv, page) => {
        const filePath = (page && page.file && page.file.path) || "";
        const ctx = this.detectContext(filePath, dv);
        // Non-project surfaces render nothing.
        if (ctx.context === "non-project" || ctx.context === "unknown") return null;
        return { ctx, spec: this._surfaceSpec(ctx.context) };
      },
      navEntries: (dv, ctx) => this._navEntries(dv, ctx),
      dispatch: (dv, ctx, id) => this._dispatch(dv, ctx, id),
      openNavTarget: (path, dv) => this._openNavTarget(path, dv),
      rootClass: "pcb-root",
      btnClass: (v) => `pcb-btn pcb-btn-${v}`,
    };
  }

  // ── render — delegate the shared bar to the ChromeBar mechanism ─────────────
  async render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.render !== "function") return;
      const result = await customJS.ChromeBar.render(dv, this._adapter());
      this._renderNoteLinks(dv);
      return result;
    } catch (_e) { /* never throw */ }
  }

  // Leaf-note pinned links (v0.210): doc-notes get their links[] strip +
  // "＋ Add link" pill right under the bar via the shared SectionExplorer helper.
  _renderNoteLinks(dv) {
    try {
      let page = null;
      try { page = dv && dv.current ? dv.current() : null; } catch (_e) { page = null; }
      if (!page || page.type !== "doc-note") return;
      if (typeof customJS === "undefined" || !customJS.SectionExplorer
        || typeof customJS.SectionExplorer.renderNoteLinks !== "function") return;
      customJS.SectionExplorer.renderNoteLinks(dv);
    } catch (_e) { /* never throw */ }
  }
}
