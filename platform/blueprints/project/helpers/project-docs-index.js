// project-docs-index.js — v1.17.0 helper (sauce v0.103.0 S2.1).
//
// Renders the project Docs.md landing as a sections-index card row + dashboard
// chip strip + quick "+ New Doc" shortcut + "+ New Section" button.
//
// Replaces v0.102.0's ProjectDocsSections (Confluence-style buckets with docs
// embedded). In v0.103.0 each section is a first-class section-hub note — so
// Docs.md now shows ONE card per section (with doc count), and the user
// navigates INTO a section to see its docs.
//
// Order on Docs.md:
//   1. Dashboard chip strip (doc total · open meetings · project status).
//   2. Quick + New Doc shortcut (no presetPrompts — user picks the section).
//   3. + New Section button (no presetPrompts — user types the name).
//   4. Section card row via BeaconCards (one card per declared section).
//   5. Empty-state stub when no sections declared (defaults to Knowledge+Notes
//      apply automatically — see below).
//
// sections[] schema (v0.103.0): list of WIKILINK strings like
//   sections:
//     - "[[Knowledge]]"
//     - "[[Notes]]"
// (was bare strings "Knowledge" / "Notes" in v0.102.0 — installer migration
// applyProjectSectionsHubMigration rewrites in-place; this helper accepts
// either shape via _stripLink.)
//
// Defaults: if the parent project's sections[] is absent OR empty, we fall
// back to ["[[Knowledge]]", "[[Notes]]"] so a fresh project still renders
// two cards. The installer also materializes Knowledge.md / Notes.md hubs
// out-of-box (per Task 4 in the v0.103.0 plan).
class ProjectDocsIndex {
  async render(dv, opts = {}) {
    const currentFile = dv.current()?.file;
    if (!currentFile) return;
    const docsFolder = currentFile.folder;                  // e.g. "spice/projects/global-k8s/docs"
    if (!docsFolder) return;

    // Anchor strictly on the canonical layout `spice/projects/<slug>/docs` —
    // same M-4 guard from ProjectDocsSections. If the hub isn't there, bail.
    const folderMatch = docsFolder.match(/^spice\/projects\/([^/]+)\/docs$/);
    if (!folderMatch) return;
    const projectSlug = folderMatch[1];
    const projectPath = `spice/projects/${projectSlug}`;

    const projectPages = dv.pages(`"${projectPath}"`).where((p) => p.type === "project");
    const project = projectPages.length ? projectPages[0] : null;
    const projectName = project ? project.file.name : projectSlug;
    const projectStatus = project && project.status ? String(project.status) : "";

    // sections[] may be wikilink (v0.103.0+) or bare string (pre-migration);
    // _stripLink normalizes to plain label. Default to Knowledge + Notes when
    // absent/empty.
    const rawSections = (project && Array.isArray(project.sections) && project.sections.length > 0)
      ? project.sections
      : ["[[Knowledge]]", "[[Notes]]"];
    const sections = rawSections.map((v) => this._stripLink(v)).filter(Boolean);

    // 1. Dashboard chip strip — total docs across all sections, open meetings
    //    linked to this project, project status.
    const allDocs = dv.pages(`"${docsFolder}"`).where((p) => p.type === "doc-note");
    const docCount = allDocs.length;
    const meetingsRoot = "spice/meetings/notes";
    const projectNotePath = project ? project.file.path : null;
    const meetings = dv.pages(`"${meetingsRoot}"`)
      .where((p) => p.type === "meeting" && this._projectMatches(p.project, projectNotePath, projectName));
    const openMeetings = meetings.length;
    this._renderChips(dv, { docCount, openMeetings, projectStatus });

    // 2. Quick + New Doc shortcut — user picks the section at create time.
    await customJS.EntityCreate.render(dv, {
      instance: "doc-note",
    });

    // 3. + New Section button — user types the section name at create time.
    await customJS.EntityCreate.render(dv, {
      instance: "section-hub",
    });

    // 4. Section card row. Build a synthetic page list for BeaconCards: one
    //    pseudo-page per declared section. We can't pass raw dataview pages
    //    here because the section hub may not yet exist (defaults case), so
    //    we use BeaconCards' plain-object support — title/icon/meta callbacks
    //    receive the synthetic object verbatim.
    dv.header(3, "Sections");
    const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;

    const sectionPages = sections.map((label) => {
      const slug = this._slugify(label);
      const sectionFolder = `${docsFolder}/${slug}`;
      const count = allDocs.where((p) => {
        const folder = String(p.file.folder || "");
        return folder === sectionFolder || folder.startsWith(`${sectionFolder}/`);
      }).length;
      // Synthetic page-like shape — BeaconCards.render walks .file.name + .file.path.
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

    await customJS.BeaconCards.render(dv, {
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

  // Dashboard chip strip — three inline-styled spans inside one dv.el("div").
  // Mirrors the lightweight "small row of pill chips" pattern used elsewhere
  // (e.g. weekly hub status row).
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
  // sections[] entries arrive here as parsed Dataview Link objects (after the
  // v0.103.0 frontmatter migration) — .display is the inner label.
  _stripLink(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") {
      // Bare string OR unparsed "[[Label]]" / "[[Label|Alias]]"
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
