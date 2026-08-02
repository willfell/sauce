/**
 * Project Dashboard (CustomJS)
 *
 * Single compact "at-a-glance" card at the top of every project atlas note,
 * immediately below ProjectChromeBar.
 *
 * Layout:
 *   • Top card (transparent + hairline border):
 *       – Header — status pill (click → MenuPopover picker, writes back via
 *         processFrontMatter).
 *       – Tiles — a 3×2 grid of six clickable nav tiles: Docs / Board / To-Do /
 *         Map / Meetings / Helpful Links. Tile targets are resolved through
 *         ProjectChromeBar.navTarget so they navigate to exactly where the
 *         Go ▾ launcher goes (with a hardcoded fallback for cold-load / stub).
 *       – Links — chips parsed from frontmatter `links[]` (quick-launch).
 *   • Below the card (siblings inside .project-dashboard-root):
 *       – Open Tasks — SectionLabel + card of open board + To-Do items (cap 6).
 *       – Recent Docs / Recent Meetings / Recent Tasks — one SectionLabel + card
 *         per non-empty group (cap 4 each, newest-first). Empty groups hide.
 *
 * Reuses MenuPopover + RenderSafe + SectionLabel + ProjectChromeBar. Icons are
 * an inlined static ICON map (the shared glyph set). No new mechanism.
 *
 * Usage in DataviewJS:
 *   await dv.view("ranch/views/customjs-guard", { class: "ProjectDashboard" });
 */
class ProjectDashboard {
  static get ICON() {
    return {
      project: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
      map: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4c0 1.1.9 2 2 2h3"/><path d="M3 10v6c0 1.1.9 2 2 2h3"/></svg>`,
      board: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`,
      task: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>`,
      docs: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>`,
      todo: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
      links: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
      planning:   `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
      progress:   `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/></svg>`,
      blocked:    `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>`,
      completed:  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
    };
  }

  async render(dv) {
    try {
      // Cold-load safe current-page resolve.
      let cur = null;
      try {
        const RS = (typeof customJS !== "undefined" && customJS.RenderSafe) ? customJS.RenderSafe : null;
        cur = (RS && RS.page) ? RS.page(dv) : dv.current();
      } catch (_e) { cur = null; }
      if (!cur || !cur.file) return;

      const currentPath = String(cur.file.path || "");
      const projectName = String(cur.file.name || "").replace(/\.md$/, "");
      // spice/projects/<slug>/<Name>.md → folder = spice/projects/<slug>
      const parts = currentPath.split("/");
      const slug = parts[2] || "";
      const folder = parts.slice(0, 3).join("/");

      const realApp = (typeof app !== "undefined") ? app : global.app;
      const file = (realApp && realApp.vault && realApp.vault.getAbstractFileByPath)
        ? (realApp.vault.getAbstractFileByPath(currentPath) || cur.file)
        : cur.file;

      // Resolve a ChromeBar context ONCE so every tile navigates to exactly the
      // same destination as the Go ▾ launcher (fixes Docs/Map drift).
      let bar = null, barCtx = null;
      try {
        bar = (typeof customJS !== "undefined") ? customJS.ProjectChromeBar : null;
        if (bar && bar.detectContext) barCtx = bar.detectContext(currentPath, dv);
      } catch (_e) {}

      const ctx = {
        app: realApp,
        file,
        currentPage: cur,
        currentPath,
        projectName,
        slug,
        folder,
        dv,
        bar,
        barCtx,
      };

      const c = dv.container;
      // Dedupe re-renders (whole root, incl. below-card sections).
      const prev = c.querySelector && c.querySelector(":scope > .project-dashboard-root");
      if (prev) prev.remove();

      const root = c.createEl("div");
      root.className = "project-dashboard-root";

      // Top card — subtle inset (transparent + hairline), tiles raised inside.
      const card = root.createEl("div");
      card.style.cssText = "background:transparent; border:1px solid var(--background-modifier-border); border-radius:10px; padding:12px; max-width:720px; margin: 4px 0;";

      this._renderHeader(card, ctx);
      const counts = await this._counts(dv, ctx);
      this._renderTiles(card, ctx, counts);
      const boardStats = await this._boardStats(ctx);
      this._renderBoardStats(card, ctx, boardStats);
      this._renderLinks(card, ctx, cur.links);

      // Below the card — Open Tasks + grouped Recent, as sibling sections.
      const tasks = await this._openTasks(ctx);
      this._renderOpenTasks(root, ctx, tasks);

      const groups = this._recentByKind(dv, ctx);
      // Enrich recent meetings with attendees + badges (SpaceDailyDashboard parity).
      try {
        const realAppRef = ctx.app;
        for (const m of (groups.meetings || [])) {
          m.enriched = await this._enrichMeeting(realAppRef, m.page || {});
        }
      } catch (_e) {}
      this._renderRecentGroups(root, ctx, groups);
    } catch (_e) {
      // Never throw — cold-load / stub environments.
    }
  }

  // ── Static helpers ─────────────────────────────────────────────────────

  static get STATUSES() {
    return ["idea", "planning", "in-progress", "blocked", "superseded", "cancelled", "done", "archived"];
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
      archived:      "var(--text-faint)",
    };
  }

  static _applyStatusChange(fm, newStatus, todayStr) {
    if (!fm || typeof fm !== "object") return fm;
    const prior = String(fm.status == null ? "" : fm.status).trim();
    if (newStatus === "archived") {
      if (prior && prior !== "archived") fm.pre_archive_status = prior;
    } else if ("pre_archive_status" in fm) {
      delete fm.pre_archive_status;
    }
    fm.status = newStatus;
    fm.status_changed_at = todayStr;
    return fm;
  }

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

  // Scaffold-aware notes detector — strips frontmatter, fenced blocks, HTML
  // comments, horizontal rules, task lines, lone bullets, headings; true iff
  // real prose remains. Ported verbatim from SpaceDailyDashboard so meeting
  // "Notes" badges agree across dashboards.
  static _bodyHasNotes(content) {
    if (typeof content !== "string" || !content) return false;
    let body = content;
    const fmEnd = body.indexOf("\n---", 4);
    if (body.indexOf("---") === 0 && fmEnd >= 0) body = body.slice(fmEnd + 4);
    body = body.replace(/```[\s\S]*?```/g, "");
    body = body.replace(/<!--[\s\S]*?-->/g, "");
    body = body
      .split("\n")
      .filter((l) => !/^\s*---+\s*$/.test(l))
      .filter((l) => !/^\s*[-*+]\s*\[[ xX]\]/.test(l))
      .filter((l) => !/^\s*[-*+]\s*$/.test(l))
      .filter((l) => !/^#+\s/.test(l))
      .join("\n");
    return body.replace(/\s/g, "").length > 5;
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
      if (md) { out.push({ label: md[1], target: md[2], kind: "external" }); continue; }
      // [[WikiLink]] or [[WikiLink|Label]]
      const wl = s.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
      if (wl) { out.push({ label: wl[2] || wl[1], target: wl[1], kind: "internal" }); continue; }
      // Bare URL
      try {
        if (/^https?:/.test(s)) {
          const u = new URL(s);
          out.push({ label: u.hostname, target: u.toString(), kind: "external" });
          continue;
        }
      } catch (_e) {}
      out.push({ label: s, target: s, kind: "internal" });
    }
    return out;
  }

  // Resolve a tile's navigation target through ProjectChromeBar.navTarget so the
  // dashboard can never drift from the Go ▾ launcher; fall back to a hardcoded
  // path when the bar / context is unavailable (cold index, node harness).
  _tileTarget(ctx, key, fallback) {
    try {
      if (ctx && ctx.bar && ctx.barCtx && ctx.bar.navTarget) {
        const t = ctx.bar.navTarget(ctx.dv, ctx.barCtx, key);
        if (t) return t;
      }
    } catch (_e) {}
    return fallback;
  }

  // ── queries ───────────────────────────────────────────────────────

  async _counts(dv, ctx) {
    const { app: realApp, folder, projectName, currentPath } = ctx;
    const counts = { docs: 0, board: 0, todo: 0, map: 0, meetings: 0 };

    // Docs — count doc-note under folder/docs.
    try {
      counts.docs = dv.pages(`"${folder}/docs"`).where(p => p && p.type === "doc-note").length || 0;
    } catch (_e) {}

    // Board — count unchecked `- [ ] …` outside the "## Completed" lane.
    try {
      const boardPath = `${folder}/${ctx.slug}-board.md`;
      const boardFile = realApp && realApp.vault && realApp.vault.getAbstractFileByPath
        ? realApp.vault.getAbstractFileByPath(boardPath) : null;
      if (boardFile) {
        const content = await realApp.vault.read(boardFile);
        let lane = "";
        for (const line of String(content || "").split("\n")) {
          if (line.startsWith("## ")) { lane = line.replace("## ", "").trim(); continue; } // lint-display-markers:allow
          if (/^- \[ \] /.test(line) && lane !== "Completed") counts.board += 1;
        }
      }
    } catch (_e) {}

    // To-Do — count unchecked in `<ProjectName> To-Do.md`.
    try {
      const todoPath = `${folder}/${projectName} To-Do.md`;
      const todoFile = realApp && realApp.vault && realApp.vault.getAbstractFileByPath
        ? realApp.vault.getAbstractFileByPath(todoPath) : null;
      if (todoFile) {
        const content = await realApp.vault.read(todoFile);
        for (const line of String(content || "").split("\n")) {
          if (/^- \[ \] /.test(line)) counts.todo += 1;
        }
      }
    } catch (_e) {}

    // Map — workstreams array on current-page frontmatter.
    try {
      const c = dv.current() || {};
      counts.map = Array.isArray(c.workstreams) ? c.workstreams.length : 0;
    } catch (_e) {}

    // Meetings — dv.pages meetings/notes filtered by project match.
    try {
      counts.meetings = dv.pages('"spice/meetings/notes"')
        .where(p => p && p.type === "meeting" && ProjectDashboard._projectMatches(p.project, currentPath, projectName))
        .length || 0;
    } catch (_e) {}

    return counts;
  }

  // Open task-notes for THIS project → [{ title, path }], cap 6.
  // Mirrors TaskProjectList's query EXACTLY: spice/tasks, type==='task',
  // status==='open', project_slug matches, source!=='meeting', excluding
  // _trash/ + _done/. Single source of truth with the To-Do note's
  // "Project Tasks" section — no more raw board/To-Do checkbox parsing.
  async _openTasks(ctx) {
    const { dv, currentPage, projectSlug, slug } = ctx;
    const ourSlug = String(
      (currentPage && currentPage.project_slug) || projectSlug || slug || ""
    ).trim();
    if (!ourSlug || !dv || typeof dv.pages !== "function") return [];

    const out = [];
    try {
      const rows = dv.pages('"spice/tasks"').where(p =>
        p && p.type === "task" && p.status === "open"
        && p.file && p.file.path
        && !p.file.path.includes("/_trash/")
        && !p.file.path.includes("/_done/")
        && String(p.project_slug == null ? "" : p.project_slug).trim() === ourSlug
        && String(p.source == null ? "" : p.source).trim() !== "meeting");
      for (const p of rows) {
        const title = String((p.title && p.title) || (p.file && p.file.name) || "").trim();
        out.push({ title, path: p.file.path });
      }
    } catch (_e) {}

    return out.slice(0, 6);
  }

  // Parse the project's kanban board lanes → per-lane card counts.
  // Counts BOTH `- [ ]` and `- [x]` under each `## <Lane>` header. Never throws.
  async _boardStats(ctx) {
    const { app: realApp, folder, slug } = ctx;
    const stats = { planning: 0, inProgress: 0, blocked: 0, completed: 0 };
    const laneKey = {
      "In Planning": "planning",
      "In Progress": "inProgress",
      "Blocked": "blocked",
      "Completed": "completed",
    };
    try {
      const boardPath = `${folder}/${slug}-board.md`;
      const boardFile = realApp && realApp.vault && realApp.vault.getAbstractFileByPath
        ? realApp.vault.getAbstractFileByPath(boardPath) : null;
      if (!boardFile) return stats;
      const content = await realApp.vault.read(boardFile);
      let key = "";
      for (const line of String(content || "").split("\n")) {
        if (line.startsWith("## ")) { key = laneKey[line.replace("## ", "").trim()] || ""; continue; } // lint-display-markers:allow
        if (key && /^- \[[ xX]\] /.test(line)) stats[key] += 1;
      }
    } catch (_e) {}
    return stats;
  }

  // Recent per-kind → { docs:[], meetings:[], tasks:[] }, newest-first, cap 4.
  _recentByKind(dv, ctx) {
    const { folder, projectName, currentPath } = ctx;
    const groups = { docs: [], meetings: [], tasks: [] };
    const take = (arr) => arr.filter(r => r.mtime > 0).sort((a, b) => b.mtime - a.mtime).slice(0, 4);

    try {
      const rows = [];
      for (const p of dv.pages(`"${folder}/docs"`).where(p => p && p.type === "doc-note")) {
        rows.push({ page: p, kind: "doc", mtime: (p && p.file && p.file.mtime && p.file.mtime.ts) || 0 });
      }
      groups.docs = take(rows);
    } catch (_e) {}

    try {
      const rows = [];
      for (const p of dv.pages('"spice/meetings/notes"')
          .where(p => p && p.type === "meeting" && ProjectDashboard._projectMatches(p.project, currentPath, projectName))) {
        rows.push({ page: p, kind: "meeting", mtime: (p && p.file && p.file.mtime && p.file.mtime.ts) || 0 });
      }
      groups.meetings = take(rows);
    } catch (_e) {}

    try {
      const rows = [];
      for (const p of dv.pages(`"${folder}/tasks"`).where(p => p && p.type === "task-note")) {
        rows.push({ page: p, kind: "task", mtime: (p && p.file && p.file.mtime && p.file.mtime.ts) || 0 });
      }
      groups.tasks = take(rows);
    } catch (_e) {}

    return groups;
  }

  // Enrich a meeting page → { file, attendees[], hasNotes, openTasks }.
  // Attendees: frontmatter `attendees` first, else `## Attendees` body bullets.
  // Never throws; on read failure returns empty attendees / false / 0.
  async _enrichMeeting(realApp, p) {
    let content = "";
    try {
      if (realApp && realApp.vault && p && p.file && p.file.path) {
        const f = realApp.vault.getAbstractFileByPath(p.file.path);
        if (f && typeof realApp.vault.read === "function") content = await realApp.vault.read(f);
      }
    } catch (_e) {}

    const stripWikilink = (s) => {
      const m = String(s).match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
      return m ? (m[2] || m[1]) : String(s);
    };

    let attendees = [];
    if (p && p.attendees && typeof p.attendees.length === "number" && p.attendees.length > 0) {
      for (let i = 0; i < p.attendees.length; i++) {
        const name = stripWikilink(p.attendees[i]).trim();
        if (name) attendees.push(name);
      }
    } else if (content) {
      const m = content.match(/## Attendees\s*([\s\S]*?)(?=\n---|\n##|$)/); // lint-display-markers:allow
      if (m) {
        const lines = m[1].match(/- \[\[[^\]]+\]\]|- [^\n]+/g) || [];
        for (const l of lines) {
          const name = stripWikilink(l.replace(/^- /, "")).trim();
          if (name) attendees.push(name);
        }
      }
    }

    const openTasks = (content.match(/^\s*[-*+]\s*\[ \]/gm) || []).length;
    const hasNotes = ProjectDashboard._bodyHasNotes(content);
    return { file: p.file, attendees, hasNotes, openTasks };
  }

  // ── rendering ─────────────────────────────────────────────────────

  _renderHeader(container, ctx) {
    const { currentPage, app: realApp, file } = ctx;
    const status = String((currentPage && currentPage.status) || "idea");
    const color = ProjectDashboard.STATUS_COLORS[status] || "var(--text-muted)";

    const row = container.createEl("div");
    row.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom:12px;";

    const pill = row.createEl("div");
    pill.__isStatusPill = true;
    pill.textContent = status;
    pill.style.cssText =
      "display:inline-block; padding:2px 10px; border-radius:999px; " +
      "font-size:0.75em; font-weight:600; text-transform:lowercase; " +
      `color:var(--text-on-accent); background:${color}; cursor:pointer;`;

    pill.addEventListener("click", () => {
      const entries = ProjectDashboard.STATUSES.map(s => ({
        label: s,
        onSelect: async () => {
          const renderSafe = globalThis.customJS?.RenderSafe;
          if (!renderSafe || typeof renderSafe.mutateStructure !== "function") return false;
          const hadStatus = Object.prototype.hasOwnProperty.call(currentPage, "status");
          const priorStatus = currentPage.status;
          const priorText = pill.textContent;
          const priorStyle = pill.style.cssText;
          const focusTarget = (typeof document !== "undefined") ? document.activeElement : null;
          const result = await renderSafe.mutateStructure({
            app: realApp,
            dv: ctx.dv,
            path: file && file.path,
            failureMessage: "Failed to update project status",
            apply: () => {
              currentPage.status = s;
              pill.textContent = s;
              pill.style.background = ProjectDashboard.STATUS_COLORS[s] || "var(--text-muted)";
              return { hadStatus, priorStatus, priorText, priorStyle, focusTarget };
            },
            rollback: (receipt) => {
              if (receipt.hadStatus) currentPage.status = receipt.priorStatus;
              else delete currentPage.status;
              pill.textContent = receipt.priorText;
              pill.style.cssText = receipt.priorStyle;
              try { receipt.focusTarget && receipt.focusTarget.focus?.(); } catch (_e) {}
            },
            write: () => realApp.fileManager.processFrontMatter(file, fm => {
              ProjectDashboard._applyStatusChange(fm, s, new Date().toISOString().split("T")[0]);
            }),
          });
          return result.ok === true;
        },
      }));
      try {
        if (typeof customJS !== "undefined" && customJS.MenuPopover && customJS.MenuPopover.open) {
          customJS.MenuPopover.open(entries, { anchor: pill, title: "Set status" });
        }
      } catch (_e) {}
    });
  }

  _renderTiles(container, ctx, counts) {
    const { folder, slug, projectName } = ctx;
    const ICON = ProjectDashboard.ICON;

    const tiles = [
      { key: "docs",     label: "Docs",          icon: ICON.docs,    count: counts.docs,     fallback: `${folder}/docs/Docs.md` },
      { key: "board",    label: "Board",         icon: ICON.board,   count: counts.board,    fallback: `${folder}/${slug}-board.md` },
      { key: "todo",     label: "To-Do",         icon: ICON.todo,    count: counts.todo,     fallback: `${folder}/${projectName} To-Do.md` },
      { key: "map",      label: "Map",           icon: ICON.map,     count: counts.map,      fallback: `${folder}/Project Map.md` },
      { key: "meetings", label: "Meetings",      icon: ICON.project, count: counts.meetings, fallback: "spice/meetings/Meetings.md", noNav: true },
      { key: "links",    label: "Helpful Links", icon: ICON.links,   noCount: true,          fallback: `${folder}/Links Hub.md` },
    ];

    const grid = container.createEl("div");
    grid.style.cssText = "display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:8px; margin-top:0;";

    for (const t of tiles) {
      const target = t.noNav ? t.fallback : this._tileTarget(ctx, t.key, t.fallback);

      const tile = grid.createEl("div");
      tile.__isTile = true;
      tile.__label = t.label;
      if (!t.noCount) tile.__count = t.count;
      tile.style.cssText =
        "display:flex; flex-direction:column; align-items:flex-start; gap:4px; " +
        "min-width:0; padding:10px 12px; border-radius:8px; " +
        "background:var(--background-secondary); " +
        "border:1px solid var(--background-modifier-border); cursor:pointer;";

      const iconWrap = tile.createEl("div");
      iconWrap.style.cssText = "color:var(--text-muted); font-size:0;"; // SVG-only
      if (t.icon && typeof t.icon === "string") iconWrap.innerHTML = t.icon;

      const lbl = tile.createEl("div");
      lbl.textContent = t.label;
      lbl.style.cssText = "text-transform:uppercase; letter-spacing:0.03em; font-size:0.72em; color:var(--text-muted);";

      if (!t.noCount) {
        const chip = tile.createEl("div");
        chip.textContent = String(t.count);
        const chipColor = t.count > 0 ? "var(--interactive-accent)" : "var(--text-faint)";
        chip.style.cssText = `font-size:1.4em; font-weight:600; color:${chipColor};`;
      }

      tile.addEventListener("click", () => {
        try {
          const cp = (typeof app !== "undefined") ? app : global.app;
          if (cp && cp.workspace && cp.workspace.openLinkText) {
            cp.workspace.openLinkText(target, ctx.currentPath, false);
          }
        } catch (_e) {}
      });
    }
  }

  // Compact icon+count chip row (below the tile grid) for the 4 kanban lanes.
  // Zero-count lanes are dropped silently. Colors mirror status semantics.
  _renderBoardStats(container, ctx, stats) {
    if (!stats) return;
    const ICON = ProjectDashboard.ICON;
    const chips = [
      { key: "planning",   label: "Planning",    icon: ICON.planning,  color: "var(--color-blue)",   n: stats.planning },
      { key: "inProgress", label: "In Progress", icon: ICON.progress,  color: "var(--color-green)",  n: stats.inProgress },
      { key: "blocked",    label: "Blocked",     icon: ICON.blocked,   color: "var(--color-red)",    n: stats.blocked },
      { key: "completed",  label: "Completed",   icon: ICON.completed, color: "var(--color-purple)", n: stats.completed },
    ].filter(c => c.n > 0);
    if (chips.length === 0) return;

    const row = container.createEl("div");
    row.__isBoardStatsRow = true;
    row.style.cssText = "display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;";

    for (const c of chips) {
      const chip = row.createEl("div");
      chip.__isBoardStatChip = true;
      chip.__laneKey = c.key;
      chip.style.cssText =
        `display:inline-flex; align-items:center; gap:5px; padding:2px 9px; border-radius:999px; ` +
        `font-size:0.75em; font-weight:600; color:${c.color}; ` +
        `background:color-mix(in srgb, ${c.color} 12%, transparent); ` +
        `border:1px solid color-mix(in srgb, ${c.color} 35%, transparent);`;
      const ic = chip.createEl("span");
      ic.style.cssText = "display:inline-flex; font-size:0;";
      if (c.icon) ic.innerHTML = c.icon;
      const txt = chip.createEl("span");
      txt.textContent = `${c.label} ${c.n}`;
    }
  }

  _renderOpenTasks(container, ctx, tasks) {
    if (!tasks || tasks.length === 0) return;
    const { currentPath } = ctx;
    const ICON = ProjectDashboard.ICON;

    try {
      if (typeof customJS !== "undefined" && customJS.SectionLabel && customJS.SectionLabel.render) {
        customJS.SectionLabel.render({ container }, { text: "Open Tasks" });
      }
    } catch (_e) {}

    const card = container.createEl("div");
    card.style.cssText = "background:var(--background-secondary); border:1px solid var(--background-modifier-border); border-radius:8px; padding:6px 10px; margin-top:6px;";

    for (const t of tasks) {
      const row = card.createEl("div");
      row.__isOpenTaskRow = true;
      row.style.cssText = "display:flex; align-items:center; gap:8px; padding:5px 0; cursor:pointer;";

      const ic = row.createEl("div");
      ic.style.cssText = "color:var(--text-muted); font-size:0;";
      if (ICON.todo) ic.innerHTML = ICON.todo;

      const title = row.createEl("div");
      title.textContent = String(t.title || "");
      title.style.cssText = "flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.9em;";

      row.addEventListener("click", () => {
        try {
          const cp = (typeof app !== "undefined") ? app : global.app;
          if (cp && cp.workspace && cp.workspace.openLinkText) {
            cp.workspace.openLinkText(t.path, currentPath, false);
          }
        } catch (_e) {}
      });
    }
  }

  _renderRecentGroups(container, ctx, groups) {
    if (!groups) return;
    const { currentPath } = ctx;
    const ICON = ProjectDashboard.ICON;
    const iconFor = (k) => (k === "meeting" ? ICON.project : (k === "task" ? ICON.task : ICON.docs));

    const sections = [
      { key: "docs",     label: "Recent Docs" },
      { key: "meetings", label: "Recent Meetings" },
      { key: "tasks",    label: "Recent Tasks" },
    ];

    for (const sec of sections) {
      const items = groups[sec.key] || [];
      if (items.length === 0) continue;

      try {
        if (typeof customJS !== "undefined" && customJS.SectionLabel && customJS.SectionLabel.render) {
          customJS.SectionLabel.render({ container }, { text: sec.label });
        }
      } catch (_e) {}

      const card = container.createEl("div");
      card.style.cssText = "background:var(--background-secondary); border:1px solid var(--background-modifier-border); border-radius:8px; padding:6px 10px; margin-top:6px;";

      for (const item of items) {
        const row = card.createEl("div");
        row.__isRecentRow = true;
        row.style.cssText = "display:flex; align-items:center; gap:8px; padding:5px 0; cursor:pointer;";

        const ic = row.createEl("div");
        ic.style.cssText = "color:var(--text-muted); font-size:0;";
        const iconSrc = iconFor(item.kind);
        if (iconSrc && typeof iconSrc === "string") ic.innerHTML = iconSrc;

        const title = row.createEl("div");
        title.textContent = String((item.page && item.page.file && item.page.file.name) || "");
        title.style.cssText = "flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.9em;";

        // Meeting parity: attendees subtitle + Notes / N-open badges.
        if (item.kind === "meeting" && item.enriched) {
          const en = item.enriched;
          const att = Array.isArray(en.attendees) ? en.attendees : [];
          if (att.length > 0) {
            const sub = row.createEl("div");
            const max = 3;
            sub.textContent = att.length <= max ? att.join(", ") : `${att.slice(0, max - 1).join(", ")}, +${att.length - (max - 1)}`;
            sub.style.cssText = "font-size:0.72em; color:var(--text-muted); margin-left:6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:40%;";
          }
          const badge = (label, color) => {
            const b = row.createEl("span");
            b.textContent = label;
            b.style.cssText = `margin-left:6px; padding:0 7px; border-radius:999px; font-size:0.68em; font-weight:600; white-space:nowrap; color:${color}; background:color-mix(in srgb, ${color} 13%, transparent); border:1px solid color-mix(in srgb, ${color} 45%, transparent);`;
          };
          if (en.hasNotes) badge("Notes", "var(--interactive-accent)");
          if (en.openTasks > 0) badge(`${en.openTasks} open`, "var(--color-orange)");
        }

        const time = row.createEl("div");
        time.textContent = ProjectDashboard._relTime(item.mtime);
        time.style.cssText = "margin-left:auto; font-size:0.75em; color:var(--text-muted);";

        row.addEventListener("click", () => {
          try {
            const cp = (typeof app !== "undefined") ? app : global.app;
            if (cp && cp.workspace && cp.workspace.openLinkText) {
              cp.workspace.openLinkText(item.page.file.path, currentPath, false);
            }
          } catch (_e) {}
        });
      }
    }
  }

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
            const cp = (typeof app !== "undefined") ? app : global.app;
            if (cp && cp.workspace && cp.workspace.openLinkText) {
              cp.workspace.openLinkText(link.target, currentPath, false);
            }
          }
        } catch (_e) {}
      });
    }
  }
}

// NOTE: do NOT append `module.exports` / `if (typeof module …)` here.
// CustomJS loads the file via `eval("(" + fileBody + ")")` then `new()`, which
// parses the WHOLE file as ONE expression. Any trailing statement after the
// class expression is a SyntaxError. The Node harness loads via
// `new Function(src + "\nreturn ProjectDashboard;")` so no export is needed.
// Enforced by platform/test/run-customjs-loadable.js.
