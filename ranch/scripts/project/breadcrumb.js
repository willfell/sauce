// breadcrumb.js — v1.17.0 helper (sauce v0.103.0 S1).
//
// Emits a clickable Project / Section / Sub-section / Doc trail at the top of
// any project-related note. Reads the current note's frontmatter (type, project,
// project_slug, section, sub_section, parent_section, depth) and walks the
// parent chain to construct the wikilink trail.
//
// Consumed by Docs.md, Section Hub (depth 1 + 2), and Doc Note templates. The
// foundational helper of v0.103.0's hierarchical navigation tree.
//
// Type branches (dispatch on p.type — see below):
//   • project       → just the project label (no trail).
//   • docs-hub      → Project / Docs.
//   • section-hub   → Project / Docs / [Section /] CurrentSection (depth-aware).
//   • doc-note      → Project / Docs / Section [/ Sub-section] / Doc.
//
// Each prior segment renders as an Obsidian wikilink (`[[${vaultPath}|${label}]]`
// markdown form) so hover-preview, click-to-open, and graph-view all wire
// through natively; the final segment renders as a bold un-clickable label
// for the current note. We dispatch via dv.el to mount the trail as a single
// inline span at the top of the rendering view.
class Breadcrumb {
  async render(dv) {
    const cur = dv.current();
    if (!cur || !cur.file) return;
    const projectName = this._stripLink(cur.project) || cur.project_name;
    const projectSlug = cur.project_slug;
    if (!projectName || !projectSlug) return;

    const parts = [];
    parts.push(this._link(projectName, `spice/projects/${projectSlug}/${projectName}.md`));

    // Dispatch on p.type (`cur.type` here; the type-branch labels echo the
    // p.type values listed in the header docstring above):
    //   - project / docs-hub / section-hub / doc-note.
    if (cur.type === "project") { /* just project */ }
    else if (cur.type === "docs-hub") {
      parts.push(this._currentLabel("Docs"));
    } else if (cur.type === "section-hub") {
      parts.push(this._link("Docs", `spice/projects/${projectSlug}/docs/Docs.md`));
      if (cur.depth === 2 && cur.parent_section) {
        const parentName = this._stripLink(cur.parent_section);
        const parentSlug = this._slugify(parentName);
        parts.push(this._link(parentName, `spice/projects/${projectSlug}/docs/${parentSlug}/${parentName}.md`));
      }
      parts.push(this._currentLabel(cur.section || cur.file.name));
    } else if (cur.type === "doc-note") {
      parts.push(this._link("Docs", `spice/projects/${projectSlug}/docs/Docs.md`));
      if (cur.section) {
        const secName = this._stripLink(cur.section);
        const secSlug = this._slugify(secName);
        parts.push(this._link(secName, `spice/projects/${projectSlug}/docs/${secSlug}/${secName}.md`));
        if (cur.sub_section) {
          const subName = this._stripLink(cur.sub_section);
          const subSlug = this._slugify(subName);
          parts.push(this._link(subName, `spice/projects/${projectSlug}/docs/${secSlug}/${subSlug}/${subName}.md`));
        }
      }
      parts.push(this._currentLabel(cur.file.name));
    }

    const wrap = dv.el("div", "", { cls: "project-breadcrumb" });
    wrap.style.cssText = "font-size: 0.85em; color: var(--text-muted); margin-bottom: 8px;";
    wrap.innerHTML = parts.join(' <span style="opacity:0.5;"> / </span> ');
  }

  // Emit an Obsidian-native wikilink as an anchor with the canonical
  // `[[${vaultPath}|${label}]]` data-href shape — click + hover-preview wire
  // through Obsidian's openLinkText + internal-link handlers natively.
  _link(label, vaultPath) {
    const wikilink = `[[${vaultPath}|${this._escape(label)}]]`;
    return `<a class="internal-link" data-href="${vaultPath}" href="${vaultPath}" target="_blank" rel="noopener" aria-label="${wikilink}">${this._escape(label)}</a>`;
  }
  _currentLabel(label) { return `<span style="font-weight:600; color: var(--text-normal);">${this._escape(label)}</span>`; }
  _stripLink(v) {
    if (!v) return "";
    if (typeof v === "string") return v.replace(/^\[\[|\]\]$/g, "").split("|")[0];
    if (v.display) return v.display;
    if (v.path) return v.path.split("/").pop().replace(/\.md$/, "");
    return "";
  }
  _slugify(s) {
    return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  _escape(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
}
