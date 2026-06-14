// section-hub.js — v1.19.0 helper (sauce v0.105.0 S2).
//
// v0.105.0 S2 — docs-system-fixes brief:
//   • Issue 6 (P0): DocSearch refactored to a permanent strip + transient
//     resultsContainer; SectionHub now writes ALL post-strip rendering into
//     the resultsContainer via a synthetic dv-proxy. The strip's input element
//     survives keystrokes (no full re-render).
//   • Issue 7: dropped the docs H3 heading (was a redundant label above the
//     card row — the file H1 + the strip of cards are self-evident).
//   • Issue 8: EntityCreate buttons rendered into a `display: flex` row with
//     `flex: 1` per child for full-width layout.
//   • Issue 10: docs query sorted by `file.mtime?.ts` desc for newest-first.
//
// v0.104.0 S2.2 (carry-over): consumes the v0.104.0 DocSearch helper. The
// filter UI mounts above the + New Doc / + New Sub-Section buttons. Scope is
// THIS section's folder; recursive: true at depth 1 (covers sub-section docs in
// the count), recursive: false at depth 2 (leaf). The docs query + (depth-1)
// sub-section card count both gate on customJS.DocSearch.matches.
//
// Renders any section-hub note — depth 1 (section) OR depth 2 (sub-section).
// Reads its own frontmatter (type, project, project_slug, section,
// section_slug, parent_section, depth) and dispatches the correct render shape.
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

    // v0.105.0 Issue 6: re-render callback now wipes ONLY the resultsContainer
    // (not dv.container). Without this, the strip's input element would be
    // destroyed mid-keystroke and lose focus + value.
    const filterCtx = customJS.DocSearch.render(dv, {
      projectSlug,
      scopePath,
      recursive: depth === 1,
      onChange: (ctx) => {
        this._currentCtx = ctx;
        ctx.resultsContainer.empty();
        this._renderResults(dv, cur, depth, projectSlug, sectionSlug, sectionName, ctx);
      },
    });
    if (this._currentCtx) {
      Object.assign(filterCtx, this._currentCtx);
    }

    // First-render results into the freshly-created resultsContainer.
    this._renderResults(dv, cur, depth, projectSlug, sectionSlug, sectionName, filterCtx);
  }

  // _renderResults writes ALL of the post-strip rendering (buttons + sub-sections
  // + docs cards) into filterCtx.resultsContainer via a synthetic dv-proxy so
  // BeaconCards + EntityCreate + dv.header/paragraph all flow into the right
  // target. The strip itself is rendered by DocSearch.render() and lives outside
  // this container — the strip is never re-rendered.
  async _renderResults(dv, cur, depth, projectSlug, sectionSlug, sectionName, filterCtx) {
    const container = filterCtx.resultsContainer;
    const proxyDv = this._makeProxyDv(dv, container);

    // 1. + New Doc + (depth 1) + New Sub-Section — wrapped in a flex row so the
    //    buttons span full width. Issue 8.
    const btnRow = container.createEl("div");
    btnRow.style.cssText = "display: flex; gap: 8px; margin: 6px 0;";
    const btnRowProxy = this._makeProxyDv(dv, btnRow);

    if (depth === 1) {
      await customJS.EntityCreate.render(btnRowProxy, {
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
      await customJS.EntityCreate.render(btnRowProxy, {
        instance: "doc-note",
        presetPrompts: {
          section: parentName,
          section_slug: parentSlug,
          sub_section: sectionName,
          sub_section_slug: sectionSlug,
        },
      });
    }

    if (depth === 1) {
      await customJS.EntityCreate.render(btnRowProxy, {
        instance: "sub-section-hub",
        presetPrompts: { parent_slug: sectionSlug },
      });
    }

    // Stretch each EntityCreate-rendered button to fill its share of the row.
    for (const btn of btnRow.querySelectorAll("button")) {
      btn.style.flex = "1";
    }

    // 2. Sub-sections list — depth === 1 only.
    if (depth === 1) {
      const sectionPath = `spice/projects/${projectSlug}/docs/${sectionSlug}`;
      const subHubs = dv.pages(`"${sectionPath}"`)
        .where((p) => p.type === "section-hub" && p.depth === 2);
      if (subHubs.length > 0) {
        proxyDv.header(3, "Sub-sections");
        const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
        await customJS.BeaconCards.render(proxyDv, {
          pages: subHubs,
          layout: "row",
          title: (p) => p.section || p.file.name,
          icon: () => folderIcon,
          meta: (p) => {
            const subSlug = p.section_slug || this._slugify(p.section || p.file.name);
            const subFolder = `${sectionPath}/${subSlug}`;
            const count = dv.pages(`"${subFolder}"`)
              .where((q) => q.type === "doc-note" && q.file.folder === subFolder
                && customJS.DocSearch.matches(q, filterCtx))
              .length;
            return `${count} doc${count === 1 ? "" : "s"}`;
          },
        });
      }
    }

    // 3. Docs in THIS folder — strict folder match (does NOT recurse).
    //    depth 1: spice/projects/<slug>/docs/<sectionSlug>
    //    depth 2: spice/projects/<slug>/docs/<parentSlug>/<sectionSlug>
    const docsPath = depth === 1
      ? `spice/projects/${projectSlug}/docs/${sectionSlug}`
      : `spice/projects/${projectSlug}/docs/${this._slugify(this._stripLink(cur.parent_section))}/${sectionSlug}`;

    // v0.105.0 Issue 10: sort docs by file.mtime desc — newest-first card row.
    const docs = dv.pages(`"${docsPath}"`)
      .where((p) => p.type === "doc-note" && p.file.folder === docsPath
        && customJS.DocSearch.matches(p, filterCtx))
      .sort((p) => p.file.mtime?.ts || 0, "desc");

    // v0.106.0.1 — empty-state callout removed entirely (was visual noise on
    // every fresh-section render). When no docs, render nothing.
    if (docs.length === 0) {
      return;
    }

    // v0.106.0.1 — when this section ALSO has sub-sections (depth-1 only),
    // emit a small "Docs" header so the docs row is visually separated from
    // the sub-sections row above. When no sub-sections, the docs cards stand
    // alone and need no header.
    if (depth === 1) {
      try {
        const sectionPath = `spice/projects/${projectSlug}/docs/${sectionSlug}`;
        const hasSubSections = dv.pages(`"${sectionPath}"`)
          .where((p) => p.type === "section-hub" && p.depth === 2)
          .length > 0;
        if (hasSubSections) proxyDv.header(3, "Docs");
      } catch (_e) {}
    }

    const fileIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

    await customJS.BeaconCards.render(proxyDv, {
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

  // v0.105.0 Issue 6 helper — synthetic dv-proxy that routes dv.container +
  // dv.el + dv.header + dv.paragraph into a target container. Forwards
  // dv.current + dv.pages to the real dv (no rebind beyond what BeaconCards /
  // EntityCreate touch on the proxy).
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
