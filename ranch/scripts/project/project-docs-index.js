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

    const rawSections = (project && Array.isArray(project.sections) && project.sections.length > 0)
      ? project.sections
      : ["[[Knowledge]]", "[[Notes]]"];
    const sections = rawSections.map((v) => this._stripLink(v)).filter(Boolean);

    // 1. Dashboard chip strip — total docs (filtered) + open meetings + status.
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
    this._renderChips(proxyDv, { docCount, openMeetings, projectStatus });

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

    const sectionPages = sections.map((label) => {
      const slug = this._slugify(label);
      const sectionFolder = `${docsFolder}/${slug}`;
      const count = allDocs.where((p) => {
        const folder = String(p.file.folder || "");
        return folder === sectionFolder || folder.startsWith(`${sectionFolder}/`);
      }).length;
      const hubPath = `${sectionFolder}/${label}.md`;
      return {
        file: {
          name: label,
          path: hubPath,
          folder: sectionFolder,
        },
        section_label: label,
        section_slug: slug,
        doc_count: count,
      };
    });

    await customJS.BeaconCards.render(proxyDv, {
      pages: sectionPages,
      layout: "row",
      title: (p) => p.section_label || p.file.name,
      icon: () => folderIcon,
      meta: (p) => {
        const count = p.doc_count || 0;
        return `${count} doc${count === 1 ? "" : "s"}`;
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

  // Dashboard chip strip — three inline-styled spans inside one dv.el("div").
  _renderChips(dv, { docCount, openMeetings, projectStatus }) {
    const wrap = dv.el("div", "", { cls: "project-docs-index-chips" });
    wrap.style.cssText = "display: flex; gap: 8px; margin: 8px 0; flex-wrap: wrap;";
    const chipStyle = "display: inline-block; padding: 2px 10px; border-radius: 12px; "
                    + "background: var(--background-secondary); color: var(--text-muted); "
                    + "font-size: 0.85em; border: 1px solid var(--background-modifier-border);";
    const status = projectStatus || "(no status)";
    wrap.innerHTML = ""
      + `<span style="${chipStyle}">${this._escape(String(docCount))} doc${docCount === 1 ? "" : "s"}</span>`
      + `<span style="${chipStyle}">${this._escape(String(openMeetings))} open meeting${openMeetings === 1 ? "" : "s"}</span>`
      + `<span style="${chipStyle}">status: ${this._escape(status)}</span>`;
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
