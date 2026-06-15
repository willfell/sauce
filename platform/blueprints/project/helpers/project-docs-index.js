// project-docs-index.js — v1.19.0 helper (sauce v0.105.0 S2).
//
// v0.105.0 S2 — docs-system-fixes brief:
//   • Issue 6 (P0): DocSearch refactored to permanent strip + transient
//     resultsContainer; ProjectDocsIndex now writes ALL post-strip rendering
//     (dashboard chips, + New buttons, section cards) into the resultsContainer
//     via a synthetic dv-proxy. The strip's input survives keystrokes.
//   • Issue 8: + New Doc / + New Section buttons wrapped in a `display: flex`
//     row with `flex: 1` per child for full-width layout.
//   • Issue 10: docs query sorted by `file.mtime?.ts` desc for newest-first.
//
// Renders the project Docs.md landing as a sections-index card row + dashboard
// chip strip + DocSearch filter strip + quick "+ New Doc" shortcut +
// "+ New Section" button.
//
// Replaces v0.102.0's ProjectDocsSections (Confluence-style buckets with docs
// embedded). In v0.103.0 each section is a first-class section-hub note — so
// Docs.md now shows ONE card per section (with doc count), and the user
// navigates INTO a section to see its docs.
//
// Order on Docs.md:
//   1. DocSearch filter strip — PERMANENT (text + tag chips + scoped-search button).
//   2. [resultsContainer] Dashboard chip strip.
//   3. [resultsContainer] + New Doc / + New Section buttons (flex row).
//   4. [resultsContainer] Section card row via BeaconCards.
//
// sections[] schema (v0.103.0): list of WIKILINK strings like
//   sections:
//     - "[[Knowledge]]"
//     - "[[Notes]]"
// Defaults: if the parent project's sections[] is absent OR empty, we fall
// back to ["[[Knowledge]]", "[[Notes]]"] so a fresh project still renders
// two cards.
class ProjectDocsIndex {
  async render(dv, opts = {}) {
    const currentFile = dv.current()?.file;
    if (!currentFile) return;
    const docsFolder = currentFile.folder;
    if (!docsFolder) return;

    const folderMatch = docsFolder.match(/^spice\/projects\/([^/]+)\/docs$/);
    if (!folderMatch) return;
    const projectSlug = folderMatch[1];
    const projectPath = `spice/projects/${projectSlug}`;
    const scopePath = `spice/projects/${projectSlug}/docs`;

    // v0.105.0 Issue 6: DocSearch strip is permanent; onChange clears ONLY
    // resultsContainer + re-renders into it.
    const filterCtx = customJS.DocSearch.render(dv, {
      projectSlug,
      scopePath,
      recursive: true,
      onChange: (ctx) => {
        this._currentCtx = ctx;
        ctx.resultsContainer.empty();
        this._renderResults(dv, projectSlug, projectPath, docsFolder, ctx);
      },
    });
    if (this._currentCtx) {
      Object.assign(filterCtx, this._currentCtx);
    }

    // First-render results into resultsContainer.
    await this._renderResults(dv, projectSlug, projectPath, docsFolder, filterCtx);
  }

  async _renderResults(dv, projectSlug, projectPath, docsFolder, filterCtx) {
    const container = filterCtx.resultsContainer;
    const proxyDv = this._makeProxyDv(dv, container);

    const projectPages = dv.pages(`"${projectPath}"`).where((p) => p.type === "project");
    const project = projectPages.length ? projectPages[0] : null;
    const projectName = project ? project.file.name : projectSlug;
    const projectStatus = project && project.status ? String(project.status) : "";

    // v0.105.0.3 — sections discovery: query filesystem for section-hub notes
    // at depth 1 inside docs/ (union with declared sections[] for resilience).
    // Pre-patch, only project.sections[] was consulted; newly-created sections
    // (via + New Section button) didn't surface on Docs.md until the project
    // note was manually updated. Filesystem is source of truth.
    const discoveredSet = new Set();
    try {
      const hubs = dv.pages(`"${docsFolder}"`)
        .where((p) => p && p.type === "section-hub" && Number(p.depth) === 1);
      for (const h of hubs) {
        const label = this._stripLink(h.section || (h.file && h.file.name) || "");
        if (label) discoveredSet.add(label);
      }
    } catch (_e) {}
    if (project && Array.isArray(project.sections)) {
      for (const v of project.sections) {
        const label = this._stripLink(v);
        if (label) discoveredSet.add(label);
      }
    }
    if (discoveredSet.size === 0) {
      discoveredSet.add("Knowledge");
      discoveredSet.add("Notes");
    }
    const sections = Array.from(discoveredSet).sort();

    // 1. Dashboard chip strip — total docs (filtered) + open meetings + status
    //    + v0.106.0 S4 widgets: task count, recent activity (7d), top tags.
    // v0.105.0 Issue 10: sort docs by mtime desc to match the section cards
    // ordering. The dashboard chip count is order-insensitive but we keep it
    // consistent.
    const allDocs = dv.pages(`"${docsFolder}"`)
      .where((p) => p.type === "doc-note" && customJS.DocSearch.matches(p, filterCtx))
      .sort((p) => p.file.mtime?.ts || 0, "desc");
    const docCount = allDocs.length;
    const meetingsRoot = "spice/meetings/notes";
    const projectNotePath = project ? project.file.path : null;
    const meetings = dv.pages(`"${meetingsRoot}"`)
      .where((p) => p.type === "meeting" && this._projectMatches(p.project, projectNotePath, projectName));
    const openMeetings = meetings.length;

    // v0.106.0 S4 (a) — task count. Reads spice/projects/<slug>/tasks/ for
    // task-note frontmatter. If no task-notes exist, skip the chip silently.
    let taskCount = 0;
    try {
      const tasks = dv.pages(`"${projectPath}/tasks"`).where((p) => p && p.type === "task-note");
      taskCount = tasks.length;
    } catch (_e) {}

    // v0.106.0 S4 (b) — recent activity. Count docs whose file.mtime is within
    // the last 7 days. mtime is unfiltered (raw allDocs ignoring filterCtx is
    // already filtered — `allDocs` IS the filtered set; that's the intended
    // semantic: "recent within current filter").
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentCount = allDocs.where((p) => (p.file.mtime?.ts || 0) >= sevenDaysAgo).length;

    // v0.106.0 S4 (c) — top tags across all docs (filtered). Reuses DocSearch's
    // _countTags semantic locally: doc-note tag excluded. Top 3 by frequency.
    const topTags = this._topTags(allDocs, 3);

    this._renderChips(proxyDv, { docCount, openMeetings, projectStatus, taskCount, recentCount, topTags });

    // 2. + New Doc / + New Section buttons — wrapped in flex row, each child
    //    stretched to fill its column (Issue 8).
    const btnRow = container.createEl("div");
    btnRow.style.cssText = "display: flex; gap: 8px; margin: 6px 0;";
    const btnRowProxy = this._makeProxyDv(dv, btnRow);

    await customJS.EntityCreate.render(btnRowProxy, {
      instance: "doc-note",
    });

    await customJS.EntityCreate.render(btnRowProxy, {
      instance: "section-hub",
    });

    for (const btn of btnRow.querySelectorAll("button")) {
      btn.style.flex = "1";
    }

    // 3. Section card row.
    proxyDv.header(3, "Sections");
    const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;

    // v0.109.0 S4 — each section card carries last-updated meta + most-recent-doc
    // subtitle. Sections are sorted by maxMtime DESC so active sections surface
    // first; ties break alphabetically for stability across re-renders. Empty
    // sections fall to the bottom (maxMtime = 0).
    const sectionPages = sections.map((label) => {
      const slug = this._slugify(label);
      const sectionFolder = `${docsFolder}/${slug}`;
      const docsInSection = allDocs.where((p) => {
        const folder = String(p.file.folder || "");
        return folder === sectionFolder || folder.startsWith(`${sectionFolder}/`);
      });
      let maxMtime = 0;
      let mostRecentDoc = null;
      for (const d of docsInSection) {
        const ts = d.file.mtime?.ts || 0;
        if (ts > maxMtime) {
          maxMtime = ts;
          mostRecentDoc = String(d.file.name || "");
        }
      }
      const hubPath = `${sectionFolder}/${label}.md`;
      return {
        file: {
          name: label,
          path: hubPath,
          folder: sectionFolder,
        },
        section_label: label,
        section_slug: slug,
        doc_count: docsInSection.length,
        maxMtime,
        mostRecentDoc,
      };
    });

    sectionPages.sort((a, b) => {
      if ((b.maxMtime || 0) !== (a.maxMtime || 0)) return (b.maxMtime || 0) - (a.maxMtime || 0);
      return String(a.section_label).localeCompare(String(b.section_label));
    });

    await customJS.BeaconCards.render(proxyDv, {
      pages: sectionPages,
      layout: "row",
      title: (p) => p.section_label || p.file.name,
      icon: () => folderIcon,
      subtitle: (p) => {
        if (!p.mostRecentDoc) return null;
        const s = String(p.mostRecentDoc);
        return s.length > 60 ? s.slice(0, 57) + "…" : s;
      },
      meta: (p) => {
        const count = p.doc_count || 0;
        const parts = [`${count} doc${count === 1 ? "" : "s"}`];
        if (p.maxMtime) parts.push(`updated ${moment(p.maxMtime).fromNow()}`);
        return parts.join(" · ");
      },
      target: (p) => p.file.path,
    });
  }

  // v0.105.0 Issue 6 helper — synthetic dv-proxy routing dv.container + dv.el +
  // dv.header + dv.paragraph into a target container. Forwards dv.current +
  // dv.pages to the real dv.
  _makeProxyDv(dv, container) {
    return {
      container,
      current: dv.current.bind(dv),
      pages: dv.pages.bind(dv),
      el: (tag, txt, opts) => {
        const el = container.createEl(tag, { ...(opts || {}) });
        if (txt !== undefined && txt !== null && txt !== "") el.textContent = String(txt);
        return el;
      },
      header: (lvl, txt) => container.createEl(`h${lvl}`, { text: String(txt) }),
      paragraph: (txt) => {
        const p = container.createEl("p");
        p.innerHTML = String(txt);
        return p;
      },
    };
  }

  // Dashboard chip strip — original three chips (docs / meetings / status) plus
  // v0.106.0 S4 expansion: task count, recent activity (7d), top-3 tag chips.
  // All chips share the same chipStyle for visual consistency. flex-wrap lets
  // the strip flow to a second row on narrow viewports.
  _renderChips(dv, { docCount, openMeetings, projectStatus, taskCount, recentCount, topTags }) {
    const wrap = dv.el("div", "", { cls: "project-docs-index-chips" });
    wrap.style.cssText = "display: flex; gap: 8px; margin: 8px 0; flex-wrap: wrap;";
    const chipStyle = "display: inline-block; padding: 2px 10px; border-radius: 12px; "
                    + "background: var(--background-secondary); color: var(--text-muted); "
                    + "font-size: 0.85em; border: 1px solid var(--background-modifier-border);";
    const status = projectStatus || "(no status)";
    const parts = [
      `<span style="${chipStyle}">${this._escape(String(docCount))} doc${docCount === 1 ? "" : "s"}</span>`,
      `<span style="${chipStyle}">${this._escape(String(openMeetings))} open meeting${openMeetings === 1 ? "" : "s"}</span>`,
      `<span style="${chipStyle}">status: ${this._escape(status)}</span>`,
    ];
    // v0.106.0 S4 (a) — task count chip. Skip silently when no task-notes exist.
    if (typeof taskCount === "number" && taskCount > 0) {
      parts.push(`<span style="${chipStyle}">${this._escape(String(taskCount))} task${taskCount === 1 ? "" : "s"}</span>`);
    }
    // v0.106.0 S4 (b) — recent activity chip (last 7 days).
    if (typeof recentCount === "number" && recentCount > 0) {
      parts.push(`<span style="${chipStyle}">${this._escape(String(recentCount))} updated this week</span>`);
    }
    // v0.106.0 S4 (c) — top-tag chips (top 3 by frequency). Inline after the
    // status chip so they share a row when space allows; flex-wrap handles the
    // overflow case.
    if (Array.isArray(topTags)) {
      for (const tag of topTags) {
        parts.push(`<span style="${chipStyle}">#${this._escape(String(tag))}</span>`);
      }
    }
    wrap.innerHTML = parts.join("");
  }

  // v0.106.0 S4 (c) helper — top N tags by frequency across the supplied pages.
  // Mirrors DocSearch._countTags semantics: doc-note (universal tag) excluded.
  _topTags(pages, n) {
    const counts = {};
    for (const p of pages) {
      const tags = Array.isArray(p.tags) ? p.tags : (p.file?.tags || []);
      for (const t of tags) {
        const clean = String(t).replace(/^#/, "");
        if (!clean || clean === "doc-note") continue;
        counts[clean] = (counts[clean] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map((e) => e[0]);
  }

  // Same project-match shapes as ProjectMeetingsPanel — Dataview Link object,
  // raw string (parsed or unparsed wikilink), or empty.
  _projectMatches(field, currentPath, projectName) {
    if (!field) return false;
    if (typeof field === "string") {
      return field.includes(`[[${projectName}]]`)
          || field.includes(`[[${projectName}|`)
          || field === projectName;
    }
    if (field.path) return currentPath ? field.path === currentPath : (field.display === projectName);
    if (field.display) return field.display === projectName;
    return false;
  }

  // Strip wikilink markup or Dataview Link object into a plain label string.
  _stripLink(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") {
      const s = v.trim();
      const m = s.match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
      return m ? m[1].trim() : s;
    }
    if (v.display) return String(v.display);
    if (v.path) return String(v.path).split("/").pop().replace(/\.md$/, "");
    return "";
  }

  _slugify(label) {
    return String(label || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  _escape(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
