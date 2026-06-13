// section-hub.js — v1.18.0 helper (sauce v0.104.0 S2.2).
//
// v0.104.0 S2.2: consumes the v0.104.0 DocSearch helper. The filter UI mounts
// above the + New Doc / + New Sub-Section buttons. Scope is THIS section's
// folder; recursive: true at depth 1 (covers sub-section docs in the count),
// recursive: false at depth 2 (leaf). The docs query + (depth-1) sub-section
// card count both gate on customJS.DocSearch.matches. onChange triggers a full
// re-render via dv.container.empty() + this.render(dv); _currentCtx stash is
// the same pattern ProjectDocsIndex uses.
//
// Renders any section-hub note — depth 1 (section) OR depth 2 (sub-section).
// Reads its own frontmatter (type, project, project_slug, section,
// section_slug, parent_section, depth) and dispatches the correct render shape:
//
//   • depth 1 (section)
//       + New Doc          → presetPrompts: { section, section_slug,
//                                              sub_section: "", sub_section_slug: "" }
//       + New Sub-Section  → instance: "sub-section-hub",
//                              presetPrompts: { parent_slug: <slug> }
//       ## Sub-sections    → BeaconCards row of child section-hubs (depth 2).
//       ## Docs            → BeaconCards row of docs in THIS folder ONLY
//                            (strict folder match — does NOT recurse into
//                            sub-section folders, since those docs live under
//                            the depth-2 hub).
//
//   • depth 2 (sub-section)
//       + New Doc          → presetPrompts: { section: <parent_section>,
//                                              section_slug: <parent_slug>,
//                                              sub_section: <this section>,
//                                              sub_section_slug: <this slug> }
//       (no + New Sub-Section button — 2-level nesting cap.)
//       (no sub-section list — nothing nests below depth 2.)
//       ## Docs            → BeaconCards row of docs in THIS folder.
//
// Strict folder match (p.file.folder === docsPath): the depth-1 hub MUST NOT
// list docs that actually live under one of its sub-section folders — those
// belong to the depth-2 hub. Without strict match, depth-1 docs would
// double-count in both Docs sections (depth-1 hub via recursive query, depth-2
// hub via the sub-folder query). Mirror the v0.102.0 ProjectDocsSections
// folder-wins-on-conflict guard.
//
// Empty-state language: `> [!example]+ No docs in **<section>** yet — use
// **+ New Doc** above.` — matches the in-section "create something" hint
// pattern used by ProjectDocsSections._renderBucket.
class SectionHub {
  async render(dv, opts = {}) {
    const cur = dv.current();
    if (!cur || !cur.file) return;
    if (cur.type !== "section-hub") return;

    const depth = Number(cur.depth) || 1;
    const projectSlug = cur.project_slug;
    const sectionSlug = cur.section_slug;
    const sectionName = cur.section || cur.file.name;
    if (!projectSlug || !sectionSlug) return;

    // v0.104.0 S2.2: DocSearch filter strip — scoped to THIS section's folder.
    // depth 1: recursive (covers sub-section docs in count). depth 2: leaf.
    // Compute scopePath up-front so DocSearch + the docsPath below stay in sync.
    const parentSlugForScope = depth === 2
      ? this._slugify(this._stripLink(cur.parent_section))
      : null;
    const scopePath = depth === 1
      ? `spice/projects/${projectSlug}/docs/${sectionSlug}`
      : `spice/projects/${projectSlug}/docs/${parentSlugForScope}/${sectionSlug}`;
    const filterCtx = customJS.DocSearch.render(dv, {
      projectSlug,
      scopePath,
      recursive: depth === 1,
      onChange: (ctx) => {
        this._currentCtx = ctx;
        dv.container.empty();
        this.render(dv);
      },
    });
    if (this._currentCtx) {
      Object.assign(filterCtx, this._currentCtx);
    }

    // 1. + New Doc — presetPrompts depend on depth.
    //    At depth 1, the new doc lives directly in this section's folder
    //    (sub_section empty). At depth 2, it lives one level deeper — section
    //    is the PARENT, sub_section is this hub.
    if (depth === 1) {
      await customJS.EntityCreate.render(dv, {
        instance: "doc-note",
        presetPrompts: {
          section: sectionName,
          section_slug: sectionSlug,
          sub_section: "",
          sub_section_slug: "",
        },
      });
    } else {
      const parentName = this._stripLink(cur.parent_section);
      const parentSlug = this._slugify(parentName);
      await customJS.EntityCreate.render(dv, {
        instance: "doc-note",
        presetPrompts: {
          section: parentName,
          section_slug: parentSlug,
          sub_section: sectionName,
          sub_section_slug: sectionSlug,
        },
      });
    }

    // 2. + New Sub-Section — depth === 1 only (2-level nesting cap).
    //    presetPrompts.parent_slug carries this section's slug so the new
    //    sub-section-hub frontmatter wires correctly back to us.
    if (depth === 1) {
      await customJS.EntityCreate.render(dv, {
        instance: "sub-section-hub",
        presetPrompts: { parent_slug: sectionSlug },
      });
    }

    // 3. Sub-sections list — depth === 1 only. Query child section-hubs
    //    (depth === 2) living under this section's folder.
    if (depth === 1) {
      const sectionPath = `spice/projects/${projectSlug}/docs/${sectionSlug}`;
      const subHubs = dv.pages(`"${sectionPath}"`)
        .where((p) => p.type === "section-hub" && p.depth === 2);
      if (subHubs.length > 0) {
        dv.header(3, "Sub-sections");
        const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
        await customJS.BeaconCards.render(dv, {
          pages: subHubs,
          layout: "row",
          title: (p) => p.section || p.file.name,
          icon: () => folderIcon,
          meta: (p) => {
            const subSlug = p.section_slug || this._slugify(p.section || p.file.name);
            const subFolder = `${sectionPath}/${subSlug}`;
            // v0.104.0 S2.2: sub-section card count also gates on the active
            // filter so the meta line matches what the user sees inside.
            const count = dv.pages(`"${subFolder}"`)
              .where((q) => q.type === "doc-note" && q.file.folder === subFolder
                && customJS.DocSearch.matches(q, filterCtx))
              .length;
            return `${count} doc${count === 1 ? "" : "s"}`;
          },
        });
      }
    }

    // 4. Docs in THIS folder — strict folder match (does NOT recurse).
    //    depth 1: spice/projects/<slug>/docs/<sectionSlug>
    //    depth 2: spice/projects/<slug>/docs/<parentSlug>/<sectionSlug>
    const docsPath = depth === 1
      ? `spice/projects/${projectSlug}/docs/${sectionSlug}`
      : `spice/projects/${projectSlug}/docs/${this._slugify(this._stripLink(cur.parent_section))}/${sectionSlug}`;

    const docs = dv.pages(`"${docsPath}"`)
      .where((p) => p.type === "doc-note" && p.file.folder === docsPath
        && customJS.DocSearch.matches(p, filterCtx));

    dv.header(3, "Docs");
    if (docs.length === 0) {
      dv.paragraph(`> [!example]+ No docs in **${sectionName}** yet — use **+ New Doc** above.`);
      return;
    }

    const fileIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

    await customJS.BeaconCards.render(dv, {
      pages: docs,
      layout: "row",
      title: (p) => p.file.name,
      icon: () => fileIcon,
      meta: (p) => {
        const created = this._formatCreated(p);
        const edited = moment(p.file.mtime.ts).fromNow();
        return created ? `created ${created} · edited ${edited}` : `edited ${edited}`;
      },
    });
  }

  // Strip wikilink markup or Dataview Link object into a plain label string.
  // parent_section arrives here as either an unparsed "[[Knowledge]]" string
  // (templater write) or a parsed Dataview Link object (in-vault read).
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

  // created_at is canonical ISO frontmatter; Dataview parses it into a Luxon
  // DateTime (has .toISO()), but unparsed strings can reach here too. Pre-canonical
  // notes have no created_at at all → fall back to file ctime. Mirrors
  // ProjectDocsSections._formatCreated for consistency.
  _formatCreated(p) {
    const raw = p.created_at;
    let m = null;
    if (raw && typeof raw.toISO === "function") m = moment(raw.toISO());
    else if (raw) m = moment(String(raw));
    if (!m || !m.isValid()) m = (p.file.ctime && p.file.ctime.ts) ? moment(p.file.ctime.ts) : null;
    return (m && m.isValid()) ? m.format("MMM D") : "";
  }
}
