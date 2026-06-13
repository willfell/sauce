// project-docs-sections.js — v1.16.0 helper (sauce v0.102.0 S2 + S4 carry-forwards).
//
// Renders the project Docs Hub as Confluence-style buckets — one labeled card
// group per section declared on the parent project's `sections[]` frontmatter,
// followed by an optional "Unfiled" bucket for orphans.
//
// Replaces the v0.100.0 ProjectDocsCards single-list rendering on the Docs Hub
// (manifest + template rewrite to consume this helper lands in v0.102.0 S4).
//
// Per-bucket rendering:
//   • <h3>{{section}}</h3> header.
//   • + New <Section> button: EntityCreate.render with
//     presetPrompts: { section: <label> } so the picker is skipped and the new
//     doc lands directly in this bucket's folder + carries the right section
//     frontmatter.
//   • Card row via BeaconCards (layout: "row", default-sort by file.mtime desc).
//   • Empty-state stub when no docs match this bucket.
//
// Folder-wins-on-conflict (v0.102.0 S4 I-1 fix): when a doc's folder slug matches
// a DECLARED section, that membership wins — its `section:` frontmatter is
// ignored for bucket-assignment purposes (so a moved file doesn't show up in
// two buckets at once). When the folder slug is NOT a declared section, we fall
// back to the frontmatter `section:` value. Orphans (neither match) flow into
// the trailing "Unfiled" bucket.
class ProjectDocsSections {
  async render(dv, opts = {}) {
    const currentFile = dv.current()?.file;
    if (!currentFile) return;
    const docsFolder = currentFile.folder;                 // e.g. "spice/projects/global-k8s/docs"
    if (!docsFolder) return;

    // Resolve sections[] from the parent project note. Docs Hub frontmatter
    // (project_slug, project_name) carries the slug for fallback queries, but
    // the actual sections array lives on the project note itself.
    //
    // M-4 fix (v0.102.0 S4): tighten the parent-project resolution. The prior
    // form did a naive suffix-strip on the docs-folder path, which would
    // silently follow a misplaced Docs Hub anywhere ending in the docs
    // basename. Anchor strictly on the canonical layout
    // `spice/projects/<slug>/docs` via a regex match — if the hub isn't
    // there, bail and let the canonical-vocab rule_fragment flag the
    // misplacement.
    const folderMatch = (docsFolder || "").match(/^spice\/projects\/([^/]+)\/docs$/);
    if (!folderMatch) return;
    const projectPath = `spice/projects/${folderMatch[1]}`; // "spice/projects/global-k8s"
    const projectPages = dv.pages(`"${projectPath}"`).where((p) => p.type === "project");
    const project = projectPages.length ? projectPages[0] : null;
    const declared = (project && Array.isArray(project.sections) && project.sections.length > 0)
      ? project.sections.map(String)
      : ["Knowledge", "Notes"];

    // One vault-wide query for all doc-notes under this project's docs folder.
    // BeaconCards consumes a dataview proxy; we re-where it per bucket.
    const allDocs = dv.pages(`"${docsFolder}"`).where((p) => p.type === "doc-note");

    // I-1 fix (v0.102.0 S4): pre-build the set of ALL declared section slugs
    // up front so each per-section query can ask "is the doc's folder slug a
    // declared section?" before deciding which rule wins. Folder-wins-on-conflict
    // means a doc in docs/notes/ shows up under Notes even if its `section:`
    // frontmatter says "Knowledge" — eliminating the double-count from the prior
    // OR-match form. Aliased as renderedSlugs for the orphan-detection downstream
    // (folder slugs and explicitly-declared section slugs are identical).
    const allSectionSlugs = new Set(declared.map((s) => this._slugify(s)));
    const renderedSlugs = allSectionSlugs;

    for (const section of declared) {
      const slug = this._slugify(section);
      const inSection = allDocs.where((p) => {
        const docFolderSlug = String((p.file.folder || "").split("/").pop() || "");
        const folderIsDeclared = allSectionSlugs.has(docFolderSlug);
        return folderIsDeclared
          ? docFolderSlug === slug          // folder wins when folder is a declared section
          : p.section === section;          // else fall back to frontmatter
      });
      await this._renderBucket(dv, section, slug, inSection);
    }

    // Trailing Unfiled bucket — docs whose section frontmatter doesn't match
    // any declared label AND whose folder slug doesn't match any declared slug.
    // Skip entirely (no header, no stub) when there are no orphans.
    const orphans = allDocs.where((p) => {
      const folderSlug = String((p.file.folder || "").split("/").pop() || "");
      const sectionSlug = this._slugify(p.section || "");
      const folderMatches = renderedSlugs.has(folderSlug);
      const sectionMatches = p.section && declared.indexOf(p.section) !== -1;
      // Also accept slugified section match (defensive against case/whitespace drift).
      const sectionSlugMatches = sectionSlug && renderedSlugs.has(sectionSlug);
      return !folderMatches && !sectionMatches && !sectionSlugMatches;
    });
    if (orphans.length > 0) {
      await this._renderUnfiledBucket(dv, orphans);
    }
  }

  async _renderBucket(dv, label, slug, pages) {
    dv.header(3, label);
    // Per-section + New button — presetPrompts skips the section picker so the
    // new doc lands directly in this bucket.
    await customJS.EntityCreate.render(dv, {
      instance: "doc-note",
      presetPrompts: { section: label },
    });

    if (pages.length === 0) {
      dv.paragraph(`> [!example]+ No docs in **${label}** yet — use **+ New ${label}** above to create one.`);
      return;
    }

    const fileIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

    // Ordering: BeaconCards' default sort (file.mtime.ts desc) — most recently
    // edited first, matching ProjectDocsCards aesthetic.
    await customJS.BeaconCards.render(dv, {
      pages,
      layout: "row",
      title: (p) => p.file.name,
      icon: () => fileIcon,
      meta: (p) => {
        const created = this._formatCreated(p);
        const edited = moment(p.file.mtime.ts).fromNow();
        return created ? `created ${created} · edited ${edited}` : `edited ${edited}`;
      },
      // No target override — BeaconCards' default (p.file.path as string) is
      // what openLinkText expects. See ProjectDocsCards v0.100.1 fix.
    });
  }

  async _renderUnfiledBucket(dv, orphans) {
    dv.header(3, "Unfiled");
    dv.paragraph(`> [!warning]+ ${orphans.length} doc(s) below have a section that isn't declared in this project's \`sections[]\`. Edit the project's frontmatter or move the file into a declared bucket to reconcile.`);

    // Distinct alert-triangle icon so orphans visually pop in the row.
    const alertIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-warning)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>`;

    await customJS.BeaconCards.render(dv, {
      pages: orphans,
      layout: "row",
      title: (p) => p.file.name,
      icon: () => alertIcon,
      meta: (p) => `section: ${p.section || "(none)"} · folder: ${p.file.folder || "(root)"}`,
    });
  }

  // Slugify a section label for folder-match comparisons. Mirrors the entity-create
  // path-slugification convention (lowercase, ascii-words separated by hyphens).
  _slugify(label) {
    return String(label || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  // created_at is canonical ISO frontmatter; Dataview parses it into a Luxon
  // DateTime (has .toISO()), but unparsed strings can reach here too. Pre-canonical
  // notes have no created_at at all → fall back to file ctime. Mirrors
  // ProjectDocsCards._formatCreated for consistency.
  _formatCreated(p) {
    const raw = p.created_at;
    let m = null;
    if (raw && typeof raw.toISO === "function") m = moment(raw.toISO());
    else if (raw) m = moment(String(raw));
    if (!m || !m.isValid()) m = (p.file.ctime && p.file.ctime.ts) ? moment(p.file.ctime.ts) : null;
    return (m && m.isValid()) ? m.format("MMM D") : "";
  }
}
