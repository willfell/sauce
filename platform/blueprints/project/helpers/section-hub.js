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
    // Folder-is-truth: the note already knows its own folder. Derive the scope
    // from cur.file.folder — NOT reconstructed from parent_section frontmatter,
    // which can be stale/wrong (live bug: parent_section:"Misc-Subsection" pointed
    // at a folder that doesn't exist → 0 docs). Depth-1 is unaffected because the
    // real folder equals the depth-1 reconstruction.
    const scopePath = String(
      (cur.file && cur.file.folder != null)
        ? cur.file.folder
        : cur.file.path.slice(0, cur.file.path.lastIndexOf("/"))
    );

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
        ctx.resultsContainer.empty();
        this._renderResults(dv, cur, depth, projectSlug, sectionSlug, sectionName, ctx);
      },
    });
    // Wiki parity: normalize the shared search strip's top gap to 12px.
    try { const strip = dv.container.querySelector(".doc-search-strip"); if (strip && strip.style) strip.style.marginTop = "12px"; } catch (_e) {}
    this._config = this._buildConfig(dv, cur, depth, projectSlug, sectionSlug, sectionName);

    // ── Tier 3: list (leading hairline + sub-sections + docs) ─────────────────
    this._renderResults(dv, cur, depth, projectSlug, sectionSlug, sectionName, filterCtx);
  }

  // Tier 1 — the create/move action row. Leading hairline + one full-width row:
  // New Doc · New Sub-Section (depth-1 only) · Move docs.
  async _renderActionRow(dv, cur, depth, projectSlug, sectionSlug, sectionName) {
    if (!globalThis.customJS?.SectionExplorer?.renderActionRow) return;
    const docPrompts = depth === 1
      ? {
          section: sectionName,
          section_slug: sectionSlug,
          sub_section: "",
          sub_section_slug: "",
        }
      : {
          section: this._stripLink(cur.parent_section),
          section_slug: this._slugify(this._stripLink(cur.parent_section)),
          sub_section: sectionName,
          sub_section_slug: sectionSlug,
        };
    const actions = [
      { kind: "entity", instance: "doc-note", presetPrompts: docPrompts },
    ];
    if (depth === 1) {
      actions.push({ kind: "entity", instance: "sub-section-hub", presetPrompts: { parent_slug: sectionSlug } });
    }
    actions.push({ kind: "custom", render: (row) => this._renderMoveDocsButton(dv, row) });
    return customJS.SectionExplorer.renderActionRow(dv, actions);
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
      customJS.AccentButton.render(row, { label: "Move docs", icon: moveIcon, onClick });
    } else {
      const btn = row.createEl("button", { cls: "sauce-btn", text: "Move docs" });
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
      // Folder-is-truth (see render): derive the recursive scope from the note's
      // real folder, not from parent_section frontmatter.
      const scopePath = String(
        (cur.file && cur.file.folder != null)
          ? cur.file.folder
          : cur.file.path.slice(0, cur.file.path.lastIndexOf("/"))
      );
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
    if (!this._config) this._config = this._buildConfig(dv, cur, depth, projectSlug, sectionSlug, sectionName);
    const adapter = customJS.SectionExplorer.makeAdapter(this._config);
    // NOTE: do NOT use `{ ...dv, container }` here — Obsidian's real `dv` is
    // a class instance; `pages`/`current` live on its prototype, not as own
    // enumerable properties, so a plain object-spread silently drops them
    // (adapter.listSections/listPages then throw or no-op, rendering an
    // empty rail even though matching pages exist). Rebuild explicitly,
    // matching the _makeProxyDv idiom used everywhere else in this codebase.
    customJS.SectionExplorer.render({
      container,
      current: dv.current.bind(dv),
      pages: dv.pages.bind(dv),
    }, adapter);
  }

  // ── SectionExplorer adapter config — depth-aware. A depth-1 hub's
  // listSections returns its depth-2 sub-hubs (materialized-only, section-hub
  // notes always exist as real files); a depth-2 hub is a LEAF — no further
  // nesting, listSections returns []. Rename on a depth-1 hub must ALSO patch
  // every depth-2 child's parent_section (a display-name string, not derived
  // from the folder path) via _childHubsForRename.
  _buildConfig(dv, cur, depth, projectSlug, sectionSlug, sectionName) {
    // Folder-is-truth (see render): the hub's docs folder IS its own folder.
    // Reconstructing from parent_section frontmatter breaks when that value is
    // stale — the real folder is authoritative.
    const sectionPath = String(
      (cur.file && cur.file.folder != null)
        ? cur.file.folder
        : cur.file.path.slice(0, cur.file.path.lastIndexOf("/"))
    );
    const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
    const fileIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    const dotsIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`;
    const docsRoot = `spice/projects/${projectSlug}/docs`;
    return {
      resolveContext: () => ({ sectionPath }),
      // ── move block (shared SectionExplorer wiring) ──────────────────────────
      // The mechanism reads this to drive the collapsible move picker, the
      // in-place select-mode bulk move, and section-move. Project docs are a
      // frontmatter cascade capped at 2 levels (section + sub-section).
      move: this._buildMoveBlock(dv, docsRoot),
      // Count of child section-hubs directly/recursively under a section (for the
      // delete-confirm "N empty sub-section(s)" wording).
      emptySubsectionCount: (section) => {
        try {
          const arr = customJS.SectionExplorer.pagesUnder(section.folder);
          return customJS.SectionExplorer.childSectionFolders(arr, section.folder, "section-hub").length;
        } catch (_e) { return 0; }
      },
      listSections: (dv2, c) => {
        if (depth !== 1) return []; // depth-2 (sub-section) is a leaf — no further nesting
        try {
          const all = dv2.pages(`"${c.sectionPath}"`);
          const allArr = all.array ? all.array() : Array.from(all);
          return all
            .where((p) => p.type === "section-hub" && p.depth === 2)
            .map((p) => {
              const subFolder = String(p.file.folder != null ? p.file.folder : p.file.path.slice(0, p.file.path.lastIndexOf("/")));
              // Real recursive doc count for the sub-section (was hardcoded 0 —
              // every card read "0 docs" and Delete was wrongly enabled).
              let pageCount = 0;
              let maxMtime = p.file.mtime?.ts || 0;
              for (const d of allArr) {
                if (!d || d.type !== "doc-note" || !d.file || !d.file.path) continue;
                const df = String(d.file.folder != null ? d.file.folder : d.file.path.slice(0, d.file.path.lastIndexOf("/")));
                if (df === subFolder || df.startsWith(subFolder + "/")) {
                  pageCount += 1;
                  const ts = d.file.mtime?.ts || 0;
                  if (ts > maxMtime) maxMtime = ts;
                }
              }
              return {
                title: p.section || p.file.name,
                hubPath: p.file.path,
                folder: subFolder,
                materialized: true,
                pageCount,
                subSectionCount: 0,
                maxMtime,
              };
            });
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
      canDelete: (section) => {
        if (!section || !section.hubPath) return false;
        try {
          const arr = customJS.SectionExplorer.pagesUnder(section.folder);
          return customJS.SectionExplorer.subtreeDocCount(arr, section.folder, "doc-note") === 0;
        } catch (_e) { return false; }
      },
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
        const childHubs = this._childHubsForRename ? (this._childHubsForRename(dv, section) || []) : [];
        const childPromises = childHubs.map((childHub) => {
          const cf = app.vault.getAbstractFileByPath(childHub.path);
          return cf ? app.fileManager.processFrontMatter(cf, (fm) => { fm.parent_section = newTitle; }) : Promise.resolve();
        });
        return Promise.all([renamePromise, fmPromise, ...childPromises]);
      },
      icons: { folder: folderIcon, file: fileIcon, dots: dotsIcon },
      rootClass: "se-root",
      // Recent mode: recent doc-notes across THIS section's subtree.
      listRecent: (dv2) => {
        try {
          const rawPages = dv2.pages(`"${sectionPath}"`);
          const all = rawPages.array ? rawPages.array() : Array.from(rawPages);
          const sectionByFolder = {};
          for (const p of all) {
            if (p && p.type === "section-hub" && p.file && p.file.path) {
              const f = String(p.file.folder != null ? p.file.folder : p.file.path.slice(0, p.file.path.lastIndexOf("/")));
              const label = this._stripLink(p.section) || (p.file.name ? String(p.file.name).replace(/\.md$/, "") : "");
              if (label) sectionByFolder[f] = label;
            }
          }
          return all
            .filter((p) => p && p.type === "doc-note" && p.file && p.file.path)
            .sort((a, b) => ((b.file.mtime && b.file.mtime.ts) || 0) - ((a.file.mtime && a.file.mtime.ts) || 0))
            .slice(0, 8)
            .map((p) => {
              const f = String(p.file.folder != null ? p.file.folder : p.file.path.slice(0, p.file.path.lastIndexOf("/")));
              return {
                title: p.title || p.file.name,
                path: p.file.path,
                mtime: (p.file.mtime && p.file.mtime.ts) || 0,
                where: (f !== sectionPath ? (sectionByFolder[f] || f.slice(f.lastIndexOf("/") + 1)) : null),
              };
            });
        } catch (_e) { return []; }
      },
    };
  }

  // ── move block (shared SectionExplorer wiring) ────────────────────────────
  // Extracted verbatim from _buildConfig so the Docs atlas ROOT can reuse the
  // SAME move semantics (root/sectionType/rootLabel/enumerateSectionTargets/
  // rewriteOnDocMove/rewriteOnSectionMove/canAcceptSection) without drift. The
  // mechanism reads this to drive the collapsible move picker, the in-place
  // select-mode bulk move, and section-move. Project docs are a frontmatter
  // cascade capped at 2 levels (section + sub-section). `dv` is only used by the
  // section-move cascade helpers (child-hub enumeration); select-docs at the
  // root uses `root` + `rewriteOnDocMove` only.
  _buildMoveBlock(dv, docsRoot) {
    return {
      root: docsRoot,
      sectionType: "section-hub",
      docType: "doc-note",
      rootLabel: "Docs (root)",
      // All section-hub folders under docsRoot as move targets (root first).
      enumerateSectionTargets: () => {
        try {
          // dv-independent: dispatch-time query via metadataCache (mobile-safe).
          const arr = customJS.SectionExplorer.pagesUnder(docsRoot);
          return customJS.SectionExplorer.sectionTargets(arr, {
            root: docsRoot, sectionType: "section-hub", rootLabel: "Docs (root)",
            labelOf: (p) => this._stripLink(p.section) || (p.title ? this._stripLink(p.title) : "") || "",
          });
        } catch (_e) { return []; }
      },
      // Derive {section, sub_section} from the destination folder relative to
      // docsRoot (port of DocMoveDialog._destSection): root → both ""; depth-1
      // → {section:<seg>, sub_section:""}; depth≥2 → {parent, leaf}.
      rewriteOnDocMove: (destFolder) => {
        const rel = String(destFolder).replace(/\/+$/, "");
        if (rel === docsRoot || rel.indexOf(docsRoot + "/") !== 0) return { section: "", sub_section: "" };
        const segs = rel.slice((docsRoot + "/").length).split("/").filter(Boolean);
        if (segs.length <= 1) return { section: segs[0] || "", sub_section: "" };
        return { section: segs[segs.length - 2], sub_section: segs[segs.length - 1] };
      },
      // Section-move cascade: patch the moved hub's depth + parent_section from
      // the destination parent folder, and retarget each child sub-section's
      // parent_section display-name to the moved section's title. Out of the
      // docs tree → null (no-op).
      rewriteOnSectionMove: (section, destParentFolder) => {
        const rel = String(destParentFolder).replace(/\/+$/, "");
        const underDocs = rel === docsRoot
          ? []
          : (rel.indexOf(docsRoot + "/") === 0 ? rel.slice((docsRoot + "/").length).split("/").filter(Boolean) : null);
        if (underDocs === null) return null;
        const newDepth = underDocs.length + 1;
        const parentSection = underDocs.length >= 1 ? underDocs[underDocs.length - 1] : "";
        const hubPatch = { depth: newDepth, parent_section: parentSection };
        const kids = this._childHubsForRename ? (this._childHubsForRename(dv, section) || []) : [];
        const movedTitle = this._stripLink(section && section.title) || (section && section.title) || "";
        const childPatches = kids.map((k) => ({ path: k.path, patch: { parent_section: movedTitle } }));
        return { hubPatch, childPatches };
      },
      // 2-level cap: the moved section lands at destDepth+1; if it has children,
      // its deepest child would be one level below that. Cap the deepest at 2.
      // (The shared picker already excludes own-folder + current-parent no-ops.)
      canAcceptSection: (section, destFolder) => {
        const rel = String(destFolder).replace(/\/+$/, "");
        const destDepth = rel === docsRoot
          ? 0
          : (rel.indexOf(docsRoot + "/") === 0 ? rel.slice((docsRoot + "/").length).split("/").filter(Boolean).length : 99);
        let hasChildren = false;
        try {
          // dv-independent (dispatch-time): metadataCache, mobile-safe.
          const arr = customJS.SectionExplorer.pagesUnder(section.folder);
          hasChildren = customJS.SectionExplorer.childSectionFolders(arr, section.folder, "section-hub").length > 0;
        } catch (_e) { hasChildren = false; }
        const resultDepth = destDepth + 1;
        const deepest = hasChildren ? resultDepth + 1 : resultDepth;
        return deepest <= 2;
      },
    };
  }

  // ── docs-ROOT adapter config — for the Docs atlas root's "Select docs" ─────
  // The Docs atlas root (docs/Docs.md, type:project — NOT a section-hub) needs a
  // SectionExplorer adapter whose `move` block targets the docs root folder so
  // openSelectDocsPicker(dv, adapter, null) enumerates docs sitting directly at
  // the root. Reuses _buildMoveBlock so root + rewriteOnDocMove stay in lockstep
  // with the section-hub config. Supplies just the extra keys makeAdapter needs
  // (rootClass/icons/listSections/listPages) so it doesn't choke; the picker
  // itself only reads adapter.move.
  _buildDocsRootConfig(dv, projectSlug) {
    const docsRoot = `spice/projects/${projectSlug}/docs`;
    const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
    const fileIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    return {
      resolveContext: () => ({ sectionPath: docsRoot }),
      move: this._buildMoveBlock(dv, docsRoot),
      listSections: () => [],
      listPages: (dv2) => {
        try {
          return dv2.pages(`"${docsRoot}"`).where((p) => p.type === "doc-note" && p.file.folder === docsRoot);
        } catch (_e) { return []; }
      },
      getLinks: () => [],
      writeLinks: () => Promise.resolve(),
      icons: { folder: folderIcon, file: fileIcon },
      rootClass: "se-root",
    };
  }

  // Depth-2 children of a depth-1 section, for renameSection's parent_section
  // cascade. Never-throw (defensive against a cold-load / query error).
  _childHubsForRename(dv, section) {
    try {
      // dv-independent (called from rewriteOnSectionMove at dispatch time, where a
      // torn-down mobile dv would throw): enumerate via the metadataCache.
      const arr = customJS.SectionExplorer.pagesUnder(section.folder);
      return arr.filter((p) => p.type === "section-hub" && Number(p.depth) === 2).map((p) => ({ path: p.file.path }));
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
