// section-hub.js — depth-aware section + sub-section renderer.
//
// WS4 chrome overhaul (S3 order + simple search):
//   Every Section hub follows the vault-wide S3 chrome grammar. After the
//   template's chrome (Breadcrumb → SpaceNavButtons → ProjectNavButtons, the
//   last of which renders its own leading hairline), SectionHub.render lays out
//   three tiers, each preceded by its own helper-owned hairline
//   (SectionLabel.divider):
//     1. action row — New Doc · New Sub-Section (depth-1 only) · Move docs, a
//        single full-width row.
//     2. search — a text input + scoped "Search" button (hideTags +
//        persist:false, wiki-aligned); starts empty on every visit, re-renders
//        on input.
//     3. list — sub-sections (depth-1 only) + docs cards.
//   The Section Hub template ships NO entity-create marker blocks (retired at
//   v0.124.1) — the create buttons are rendered inline here.
//
//   "Move docs" opens the shipped multi-select bulk-move dialog
//   (DocBulkMoveActions._onBulkMove) — a hub isn't a single doc, so the
//   single-doc DocMoveDialog tree doesn't fit; the bulk dialog (checkbox list of
//   docs + destination picker) is the right affordance. Retrofitting the bulk
//   destination picker to the DocMoveDialog tree is out of scope for WS4.
//
// Reads its own frontmatter (type, project, project_slug, section, section_slug,
// parent_section, depth) and dispatches the correct render shape.
//
// This file MUST stay a bare class expression with NO trailing statements — the
// customJS loader evals the whole file as one expression `("+file+")`; a
// module.exports / if / const trailer would make it "Unexpected token" and the
// class would silently never register (lesson: customjs-no-trailing-statements).
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

    // ── Tier 1: action row (leading hairline + full-width row) ────────────────
    // contentOnly (v0.191 chrome-bar refactor): the Section Hub template's chrome
    // bar (ProjectChromeBar) now owns New Doc / New Sub-Section / Move docs as its
    // primary + ⋯ overflow actions, so the template calls this helper in
    // { contentOnly: true } mode to render ONLY the search strip + list and
    // suppress the redundant action row.
    if (!(opts && opts.contentOnly)) {
      await this._renderActionRow(dv, cur, depth, projectSlug, sectionSlug, sectionName);
    }

    // ── Tier 2: simple search strip (leading hairline + bare text input) ──────
    const parentSlugForScope = depth === 2
      ? this._slugify(this._stripLink(cur.parent_section))
      : null;
    const scopePath = depth === 1
      ? `spice/projects/${projectSlug}/docs/${sectionSlug}`
      : `spice/projects/${projectSlug}/docs/${parentSlugForScope}/${sectionSlug}`;

    if (customJS?.SectionLabel?.divider) customJS.SectionLabel.divider(dv);

    // Search strip: text input + scoped "Search" button (wiki parity, 2026-07-02:
    // hideNativeSearch dropped so the scoped-search button shows). No tag chips,
    // never persisted (starts empty on every visit).
    const filterCtx = customJS.DocSearch.render(dv, {
      projectSlug,
      scopePath,
      recursive: true,
      hideTags: true,
      persist: false,
      entityType: "doc-note",
      onChange: (ctx) => {
        this._currentCtx = ctx;
        ctx.resultsContainer.empty();
        this._renderResults(dv, cur, depth, projectSlug, sectionSlug, sectionName, ctx);
      },
    });
    // Wiki parity: normalize the shared search strip's top gap to 12px.
    try { const strip = dv.container.querySelector(".doc-search-strip"); if (strip && strip.style) strip.style.marginTop = "12px"; } catch (_e) {}
    if (this._currentCtx) {
      Object.assign(filterCtx, this._currentCtx);
    }

    this._config = this._buildConfig(cur, depth, projectSlug, sectionSlug, sectionName);

    // ── Tier 3: list (leading hairline + sub-sections + docs) ─────────────────
    this._renderResults(dv, cur, depth, projectSlug, sectionSlug, sectionName, filterCtx);
  }

  // Tier 1 — the create/move action row. Leading hairline + one full-width row:
  // New Doc · New Sub-Section (depth-1 only) · Move docs.
  async _renderActionRow(dv, cur, depth, projectSlug, sectionSlug, sectionName) {
    const container = (dv && dv.container) ? dv.container : dv;
    if (!container || typeof container.createEl !== "function") return;

    if (customJS?.SectionLabel?.divider) customJS.SectionLabel.divider(container);

    // Wiki parity: centered container WITH flex-wrap so the create/move buttons
    // break 2-up on a phone (mirrors the core nav row) instead of clipping their
    // labels. Each button sized by _styleLeafBtn (the shared _mobilize sizing).
    const btnRow = container.createEl("div");
    btnRow.style.cssText = "display: flex; gap: 10px; margin: 0 auto; justify-content: center; align-items: stretch; max-width: 640px; flex-wrap: wrap;";
    const btnRowProxy = this._makeProxyDv(dv, btnRow);

    // Cold-load race: poll for EntityCreate.
    for (let i = 0; i < 40 && !window.customJS?.EntityCreate; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (window.customJS?.EntityCreate) {
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
    }

    // Move docs — reuses the shipped bulk-move dialog (project-scoped).
    this._renderMoveDocsButton(dv, btnRow);

    // Wiki parity: each button stretches to an equal share of the centered row
    // (flex: 1 1 0), sized to match the wiki leaf action bar.
    for (const btn of btnRow.querySelectorAll("button")) {
      this._styleLeafBtn(btn);
    }
  }

  // Wiki hub-button sizing (matches ProjectNavButtons._mobilize + the core nav
  // row): min-width 128 + 50% flex-basis so the container's flex-wrap breaks the
  // buttons 2-up on a phone instead of clipping their labels. Readable + consistent.
  _styleLeafBtn(btn) {
    if (!btn || !btn.style) return btn;
    btn.style.flex = "1 1 calc(50% - 6px)";
    btn.style.minWidth = "128px";
    btn.style.fontSize = "0.92em";
    btn.style.padding = "9px 14px";
    return btn;
  }

  // The "Move docs" button — dispatches the shipped DocBulkMoveActions bulk-move
  // dialog. That handler resolves the project's docs folder from the current
  // note; on a Section hub it walks up to the project's Docs.md-equivalent docs
  // root. Guard against a cold-loading helper (no-op until registered).
  _renderMoveDocsButton(dv, row) {
    const moveIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="12 11 12 17"/><polyline points="9 14 12 11 15 14"/></svg>`;
    const onClick = () => {
      const bm = window.customJS?.DocBulkMoveActions;
      if (bm && typeof bm._onBulkMove === "function") { bm._onBulkMove(dv); return; }
      if (typeof Notice === "function") new Notice("DocBulkMoveActions unavailable — reinstall the project blueprint.", 6000);
    };
    if (customJS?.AccentButton?.render) {
      customJS.AccentButton.render(row, { label: "Move docs", icon: moveIcon, onClick, flex: true });
    } else {
      const btn = row.createEl("button", { text: "Move docs" });
      btn.onclick = onClick;
    }
  }

  // Tier 3 — writes the sub-sections + docs cards into filterCtx.resultsContainer
  // via a synthetic dv-proxy so BeaconCards + dv.header/paragraph flow into the
  // right target. A leading hairline heads the tier. The strip itself is rendered
  // by DocSearch.render() and lives outside this container.
  async _renderResults(dv, cur, depth, projectSlug, sectionSlug, sectionName, filterCtx) {
    const container = filterCtx.resultsContainer;
    const proxyDv = this._makeProxyDv(dv, container);

    // SEARCH MODE — with an active query, search THIS section's whole subtree
    // recursively (mirrors WikiTree._renderResults): a flat most-recent-first
    // list of every matching doc-note, each tagged with the sub-section it lives
    // in. Empty query falls through to the normal browse (sub-sections + docs).
    if (filterCtx && filterCtx.hasActiveFilter) {
      const scopePath = depth === 1
        ? `spice/projects/${projectSlug}/docs/${sectionSlug}`
        : `spice/projects/${projectSlug}/docs/${this._slugify(this._stripLink(cur.parent_section))}/${sectionSlug}`;
      this._renderSearchResults(dv, proxyDv, scopePath, filterCtx);
      return;
    }

    // No-filter browse view — delegate the rail (sub-sections, depth-1 only)
    // + page pane (this section's docs + pinned links) to the shared
    // SectionExplorer mechanism. Cold-load-guarded exactly like WikiTree /
    // ProjectDocsIndex — a not-yet-loaded customJS.SectionExplorer is a no-op,
    // not a throw.
    if (!customJS || !customJS.SectionExplorer || typeof customJS.SectionExplorer.makeAdapter !== "function"
      || typeof customJS.SectionExplorer.render !== "function") return;
    if (!this._config) this._config = this._buildConfig(cur, depth, projectSlug, sectionSlug, sectionName);
    const adapter = customJS.SectionExplorer.makeAdapter(this._config);
    customJS.SectionExplorer.render({ ...dv, container }, adapter);
  }

  // ── SectionExplorer adapter config — depth-aware. A depth-1 hub's
  // listSections returns its depth-2 sub-hubs (materialized-only, section-hub
  // notes always exist as real files); a depth-2 hub is a LEAF — no further
  // nesting, listSections returns []. Rename on a depth-1 hub must ALSO patch
  // every depth-2 child's parent_section (a display-name string, not derived
  // from the folder path) via _childHubsForRename.
  _buildConfig(cur, depth, projectSlug, sectionSlug, sectionName) {
    const parentSlugForScope = depth === 2 ? this._slugify(this._stripLink(cur.parent_section)) : null;
    const sectionPath = depth === 1
      ? `spice/projects/${projectSlug}/docs/${sectionSlug}`
      : `spice/projects/${projectSlug}/docs/${parentSlugForScope}/${sectionSlug}`;
    const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
    const fileIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    const dotsIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`;
    return {
      resolveContext: () => ({ sectionPath }),
      listSections: (dv2, c) => {
        if (depth !== 1) return []; // depth-2 (sub-section) is a leaf — no further nesting
        try {
          return dv2.pages(`"${c.sectionPath}"`)
            .where((p) => p.type === "section-hub" && p.depth === 2)
            .map((p) => ({
              title: p.section || p.file.name,
              hubPath: p.file.path,
              folder: p.file.folder,
              materialized: true,
              pageCount: 0,
              subSectionCount: 0,
              maxMtime: p.file.mtime?.ts || 0,
            }));
        } catch (_e) { return []; }
      },
      listPages: (dv2, c) => {
        try {
          return dv2.pages(`"${c.sectionPath}"`).where((p) => p.type === "doc-note" && p.file.folder === c.sectionPath);
        } catch (_e) { return []; }
      },
      getLinks: (target) => {
        const path2 = (target && target.hubPath) || cur.file.path;
        const page = dv.page ? dv.page(path2) : null;
        return (page && Array.isArray(page.links)) ? page.links : [];
      },
      writeLinks: (target, links) => {
        const path2 = (target && target.hubPath) || cur.file.path;
        const f = app.vault.getAbstractFileByPath(path2);
        if (!f) return Promise.resolve();
        return app.fileManager.processFrontMatter(f, (fm) => { fm.links = links; });
      },
      canDelete: (section) => !!(section && section.materialized) && !section.pageCount && !section.subSectionCount,
      deleteSection: (section) => {
        if (!section || !section.materialized) return Promise.resolve();
        const f = app.vault.getAbstractFileByPath(section.folder);
        return f && app.fileManager.trashFile ? app.fileManager.trashFile(f) : Promise.resolve();
      },
      renameSection: (section, newTitle) => {
        if (!section || !section.materialized) return Promise.resolve();
        const newSlug = this._slugify(newTitle);
        const parentOfSection = section.folder.slice(0, section.folder.lastIndexOf("/"));
        const newFolder = `${parentOfSection}/${newSlug}`;
        const folderFile = app.vault.getAbstractFileByPath(section.folder);
        const renamePromise = folderFile ? app.fileManager.renameFile(folderFile, newFolder) : Promise.resolve();
        const hubFile = app.vault.getAbstractFileByPath(section.hubPath);
        const fmPromise = hubFile ? app.fileManager.processFrontMatter(hubFile, (fm) => { fm.section = newTitle; fm.section_slug = newSlug; }) : Promise.resolve();
        // Depth-1 rename must also patch every depth-2 child's parent_section
        // (a display-name string, not derived from the folder path).
        const childHubs = this._childHubsForRename ? (this._childHubsForRename(section) || []) : [];
        const childPromises = childHubs.map((childHub) => {
          const cf = app.vault.getAbstractFileByPath(childHub.path);
          return cf ? app.fileManager.processFrontMatter(cf, (fm) => { fm.parent_section = newTitle; }) : Promise.resolve();
        });
        return Promise.all([renamePromise, fmPromise, ...childPromises]);
      },
      icons: { folder: folderIcon, file: fileIcon, dots: dotsIcon },
      rootClass: "se-root",
    };
  }

  // Depth-2 children of a depth-1 section, for renameSection's parent_section
  // cascade. Never-throw (defensive against a cold-load / query error).
  _childHubsForRename(section) {
    try {
      const rows = dv.pages(`"${section.folder}"`).where((p) => p.type === "section-hub" && p.depth === 2);
      const arr = rows.array ? rows.array() : Array.from(rows);
      return arr.map((p) => ({ path: p.file.path }));
    } catch (_e) { return []; }
  }

  // SEARCH MODE renderer — a flat, most-recent-first list of every matching
  // doc-note across THIS section's whole subtree (scopePath), each captioned
  // with the sub-section it lives in. Replaces the browse view while a query is
  // active. Mirrors WikiTree._renderSearchResults + ProjectDocsIndex._renderSearchResults.
  _renderSearchResults(dv, proxyDv, scopePath, filterCtx) {
    const rawPages = dv.pages(`"${scopePath}"`);
    const pages = rawPages.array ? rawPages.array() : Array.from(rawPages);

    // folder → section display title, for the "in <trail>" subtitle. Built from
    // the section-hub notes in the subtree (their own folder → their `section`).
    const sectionByFolder = {};
    for (const p of pages) {
      if (p && p.type === "section-hub" && p.file && p.file.path) {
        const f = String(p.file.folder != null ? p.file.folder : p.file.path.slice(0, p.file.path.lastIndexOf("/")));
        const label = this._stripLink(p.section) || (p.file.name ? String(p.file.name).replace(/\.md$/, "") : "");
        if (label) sectionByFolder[f] = label;
      }
    }

    const matches = pages
      .filter((p) => p && p.type === "doc-note" && p.file && p.file.path && customJS.DocSearch.matches(p, filterCtx))
      .sort((a, b) => {
        const at = a.file.mtime && a.file.mtime.ts != null ? a.file.mtime.ts : 0;
        const bt = b.file.mtime && b.file.mtime.ts != null ? b.file.mtime.ts : 0;
        return bt - at;
      });

    customJS.SectionLabel.render(proxyDv, { text: `Results (${matches.length})` });
    if (!matches.length) {
      const empty = proxyDv.container.createEl("div");
      empty.style.cssText = "padding: 16px; text-align: center; color: var(--text-faint); font-style: italic; border: 1px dashed var(--background-modifier-border); border-radius: 8px; margin-top: 8px;";
      empty.textContent = "No matching docs in this section or below.";
      return;
    }
    const fileIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    customJS.BeaconCards.render(proxyDv, {
      pages: matches,
      layout: "stacked",
      columns: 2,
      sort: () => 0,   // keep OUR most-recent-first order
      title: (p) => p.file.name,
      icon: () => fileIcon,
      target: (p) => p.file.path,
      subtitle: (p) => {
        const where = this._sectionTrail(p, scopePath, sectionByFolder);
        const ago = (p.file.mtime && window.moment) ? window.moment(p.file.mtime.ts).fromNow() : "";
        if (where) return ago ? `${where} · ${ago}` : where;
        return ago ? `edited ${ago}` : "";
      },
    });
  }

  // "in <sub-section> / ..." trail for a doc-note, relative to the search root
  // (scopePath). Uses each folder's section-hub display title, falling back to
  // the folder slug. A doc directly in scopePath reads "here".
  // Mirrors WikiTree._sectionTrail.
  _sectionTrail(p, scopePath, sectionByFolder) {
    const folder = String(p.file.folder != null ? p.file.folder : p.file.path.slice(0, p.file.path.lastIndexOf("/")));
    if (folder === scopePath) return "here";
    if (!folder.startsWith(scopePath + "/")) return "";
    const rel = folder.slice(scopePath.length + 1).split("/");
    const parts = [];
    let acc = scopePath;
    for (const seg of rel) {
      acc = acc + "/" + seg;
      parts.push((sectionByFolder && sectionByFolder[acc]) || seg);
    }
    return "in " + parts.join(" / ");
  }

  // synthetic dv-proxy that routes dv.container + dv.el + dv.header +
  // dv.paragraph into a target container. Forwards dv.current + dv.pages to the
  // real dv.
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
}
