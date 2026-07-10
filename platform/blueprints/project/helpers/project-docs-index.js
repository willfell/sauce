// project-docs-index.js — Docs.md landing renderer.
//
// WS4 chrome overhaul (S3 order + simple search):
//   The Docs hub now follows the vault-wide S3 chrome grammar. The template
//   dispatches TWO ProjectDocsIndex methods (both guard-routed, cold-load-safe):
//     • renderActionRow(dv) — from the `// entity-create:doc-note` marker block.
//       A single full-width action row: New Doc · New Section · Move docs,
//       bracketed above by a helper-owned hairline (SectionLabel.divider).
//     • render(dv) — the search tier (a text input + scoped "Search" button:
//       hideTags + persist:false, wiki-aligned) and the sections + docs list,
//       each preceded by its own leading hairline.
//   The dashboard chip strip (docs/meetings/status/task/recent/tag chips) was
//   REMOVED — it isn't part of the requested S3 layout.
//
//   The action row's "Move docs" button reuses the SHIPPED bulk-move flow
//   (customJS.DocBulkMoveActions._onBulkMove) — a multi-select docs dialog with
//   a destination <select>. (Single-doc Move already uses the DocMoveDialog
//   wiki-style tree via DocLeafActions; retrofitting the bulk flow to the tree
//   is out of scope for WS4.)
//
// sections[] schema (v0.103.0): list of WIKILINK strings like
//   sections:
//     - "[[Knowledge]]"
//     - "[[Notes]]"
// Defaults: if the parent project's sections[] is absent OR empty, we fall
// back to ["[[Knowledge]]", "[[Notes]]"] so a fresh project still renders
// two cards.
//
// This file MUST stay a bare class expression with NO trailing statements — the
// customJS loader evals the whole file as one expression `("+file+")`; a
// module.exports / if / const trailer would make it "Unexpected token" and the
// class would silently never register (lesson: customjs-no-trailing-statements).
class ProjectDocsIndex {
  // Pure action-row spec — the ordered list of buttons rendered in the Docs hub
  // action row. Each entry: { id, kind }. kind "entity" → an EntityCreate button
  // (instance = id); kind "move" → the bulk Move-docs button. Node-unit-testable
  // (no DOM / customJS). The renderer maps this to actual buttons.
  _actionRowSpec() {
    return [
      { id: "doc-note", kind: "entity" },
      { id: "section-hub", kind: "entity" },
      { id: "move-docs", kind: "move" },
    ];
  }

  // Resolve the project slug + docs folder from the current docs-hub note.
  // Returns null when the current note isn't a project Docs.md.
  _resolveContext(dv) {
    const currentFile = dv.current()?.file;
    if (!currentFile) return null;
    const docsFolder = currentFile.folder;
    if (!docsFolder) return null;
    const folderMatch = docsFolder.match(/^spice\/projects\/([^/]+)\/docs$/);
    if (!folderMatch) return null;
    const projectSlug = folderMatch[1];
    return {
      projectSlug,
      projectPath: `spice/projects/${projectSlug}`,
      docsFolder,
      scopePath: `spice/projects/${projectSlug}/docs`,
    };
  }

  // ── Tier 1: action row (dispatched from the entity-create:doc-note marker) ──
  // Leading hairline + one full-width row: New Doc · New Section · Move docs.
  async renderActionRow(dv) {
    const ctx = this._resolveContext(dv);
    if (!ctx) return;
    const container = (dv && dv.container) ? dv.container : dv;
    if (!container || typeof container.createEl !== "function") return;

    if (customJS?.SectionLabel?.divider) customJS.SectionLabel.divider(container);

    // Wiki parity: the action row uses the wiki centered container style WITH
    // flex-wrap so the buttons break 2-up on a phone (mirrors the core nav row)
    // instead of shrinking below their label width and clipping ("+ New Section"
    // → "+ New S…"). Each button sized by _styleLeafBtn (the shared _mobilize
    // sizing: min-width 128 + 50% flex-basis).
    const row = container.createEl("div");
    row.style.cssText = "display: flex; gap: 10px; margin: 0 auto; justify-content: center; align-items: stretch; max-width: 640px; flex-wrap: wrap;";
    const rowProxy = this._makeProxyDv(dv, row);

    // Cold-load race: poll for EntityCreate (mirrors section-hub.js).
    for (let i = 0; i < 40 && !window.customJS?.EntityCreate; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }

    // _actionRowSpec drives the order; render each entry with a LITERAL instance
    // so the source is greppable + the create buttons are explicit.
    for (const entry of this._actionRowSpec()) {
      if (entry.kind === "move") { this._renderMoveDocsButton(dv, row); continue; }
      if (!window.customJS?.EntityCreate) continue;
      if (entry.id === "doc-note") {
        await customJS.EntityCreate.render(rowProxy, { instance: "doc-note" });
      } else if (entry.id === "section-hub") {
        await customJS.EntityCreate.render(rowProxy, { instance: "section-hub" });
      }
    }

    // Wiki parity: each button stretches to an equal share of the centered row
    // (flex: 1 1 0), sized to match the wiki leaf action bar.
    for (const btn of row.querySelectorAll("button")) {
      this._styleLeafBtn(btn);
    }
  }

  // Wiki hub-button sizing (matches ProjectNavButtons._mobilize + the core nav
  // row above): min-width 128 + 50% flex-basis so the container's flex-wrap
  // breaks the buttons 2-up on a phone instead of shrinking each below its label
  // width (which clipped "+ New Section" → "+ New S…"). Readable + consistent.
  _styleLeafBtn(btn) {
    if (!btn || !btn.style) return btn;
    btn.style.flex = "1 1 calc(50% - 6px)";
    btn.style.minWidth = "128px";
    btn.style.fontSize = "0.92em";
    btn.style.padding = "9px 14px";
    return btn;
  }

  // The "Move docs" button — reuses the shipped bulk-move dialog. Rendered via
  // AccentButton so it visually matches the EntityCreate buttons; on click it
  // dispatches DocBulkMoveActions._onBulkMove(dv) (multi-select + destination
  // picker). Guard against a cold-loading helper (no-op until it's registered).
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

  // ── Tier 2 + 3: search + list ───────────────────────────────────────────────
  async render(dv, opts = {}) {
    const ctx = this._resolveContext(dv);
    if (!ctx) return;
    const { projectSlug, docsFolder, scopePath } = ctx;

    // Tier 2 — search strip: a text input + scoped "Search" button (wiki parity,
    // 2026-07-02: hideNativeSearch dropped so the scoped-search button shows, just
    // like the wiki). No tag chips (hideTags), never persisted (starts empty on
    // every visit). Leading hairline owns the tier boundary.
    if (customJS?.SectionLabel?.divider) customJS.SectionLabel.divider(dv);

    this._config = this._buildConfig(dv, dv.current(), ctx);

    const filterCtx = customJS.DocSearch.render(dv, {
      projectSlug,
      scopePath,
      recursive: true,
      hideTags: true,
      persist: false,
      entityType: "doc-note",
      onChange: (c) => {
        c.resultsContainer.empty();
        this._renderTerminal(dv, docsFolder, c);
      },
    });
    // Wiki parity: normalize the shared search strip's top gap to 12px (it ships
    // a 2px top margin) so the space above the search matches the divider grammar.
    try { const strip = dv.container.querySelector(".doc-search-strip"); if (strip && strip.style) strip.style.marginTop = "12px"; } catch (_e) {}
    // Tier 3 — either the search-mode results list, or (no active filter) the
    // browse view rendered by the shared SectionExplorer mechanism.
    this._renderTerminal(dv, docsFolder, filterCtx);
  }

  // Dispatch the search strip's resultsContainer: search-mode keeps the
  // existing flat cross-section results list (UNCHANGED, out of scope for the
  // SectionExplorer extraction); the empty-query browse view delegates the
  // rail (sections) + page pane (this folder's docs + pinned links) to the
  // shared SectionExplorer mechanism, cold-load-guarded exactly like WikiTree.
  _renderTerminal(dv, docsFolder, filterCtx) {
    const container = filterCtx.resultsContainer;
    const proxyDv = this._makeProxyDv(dv, container);

    if (filterCtx && filterCtx.hasActiveFilter) {
      this._renderSearchResults(dv, proxyDv, docsFolder, filterCtx);
      return;
    }

    if (!customJS || !customJS.SectionExplorer || typeof customJS.SectionExplorer.makeAdapter !== "function"
      || typeof customJS.SectionExplorer.render !== "function") return;
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

  // ── SectionExplorer adapter config — builds the project-docs-hub-specific
  // resolveContext/listSections/listPages/getLinks/writeLinks/canDelete/
  // deleteSection/renameSection/icons that SectionExplorer.render needs.
  //
  // Sections can be VIRTUAL: declared in the parent project's sections[] array
  // with no real folder/hub note yet (hubPath: null, materialized: false).
  // Rename/Delete/Add-link must only ever be offered for a MATERIALIZED
  // section (a real section-hub note exists) — gated via `section.materialized`
  // in addition to the existing zero-children guard on delete.
  _buildConfig(dv, cur, ctx) {
    const { projectSlug, projectPath, docsFolder } = ctx;
    const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
    const fileIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    const dotsIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`;
    return {
      resolveContext: () => ctx,
      listSections: (dv2) => {
        // Union of declared project.sections[] (virtual, may lack a hub note
        // yet) + discovered depth-1 section-hub notes (materialized). Ported
        // from the pre-adapter _renderResults sections discovery.
        const project = this._projectPage(dv2, projectPath);
        const discoveredSet = new Set();
        const hubByLabel = {};
        try {
          const hubs = dv2.pages(`"${docsFolder}"`)
            .where((p) => p && p.type === "section-hub" && Number(p.depth) === 1);
          for (const h of hubs) {
            const label = this._stripLink(h.section || (h.file && h.file.name) || "");
            if (label) { discoveredSet.add(label); hubByLabel[label] = h; }
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
        return Array.from(discoveredSet).sort().map((label) => {
          const slug = this._slugify(label);
          const sectionFolder = `${docsFolder}/${slug}`;
          const hub = hubByLabel[label];
          let docsInSection;
          try {
            docsInSection = dv2.pages(`"${docsFolder}"`)
              .where((p) => p.type === "doc-note" && String(p.file.folder || "").startsWith(sectionFolder));
          } catch (_e) { docsInSection = []; }
          let maxMtime = 0;
          for (const d of docsInSection) {
            const ts = d.file.mtime?.ts || 0;
            if (ts > maxMtime) maxMtime = ts;
          }
          return {
            title: label,
            folder: sectionFolder,
            hubPath: hub ? hub.file.path : null,
            materialized: !!hub,
            pageCount: docsInSection.length,
            subSectionCount: 0,
            maxMtime,
          };
        });
      },
      listPages: (dv2) => {
        try {
          return dv2.pages(`"${docsFolder}"`).where((p) => p.type === "doc-note" && p.file.folder === docsFolder);
        } catch (_e) { return []; }
      },
      getLinks: (target) => {
        const path2 = (target && target.hubPath) || (cur && cur.file && cur.file.path);
        if (!path2) return [];
        const page = dv.page ? dv.page(path2) : null;
        return (page && Array.isArray(page.links)) ? page.links : [];
      },
      writeLinks: (target, links) => {
        const path2 = (target && target.hubPath) || (cur && cur.file && cur.file.path);
        if (!path2) return Promise.resolve();
        const f = app.vault.getAbstractFileByPath(path2);
        if (!f) return Promise.resolve();
        return app.fileManager.processFrontMatter(f, (fm) => { fm.links = links; });
      },
      // Delete/rename/add-link ALL require a materialized section — a virtual,
      // declared-only section (project.sections[] entry with no folder/hub
      // note yet) has nothing to mutate.
      canDelete: (section) => !!(section && section.materialized) && !section.pageCount && !section.subSectionCount,
      deleteSection: (section) => {
        if (!section || !section.materialized) return Promise.resolve();
        const f = app.vault.getAbstractFileByPath(section.folder);
        if (!f) return Promise.resolve();
        return app.fileManager.trashFile ? app.fileManager.trashFile(f) : Promise.resolve();
      },
      renameSection: (section, newTitle) => {
        if (!section || !section.materialized) return Promise.resolve();
        const newSlug = this._slugify(newTitle);
        const newFolder = `${docsFolder}/${newSlug}`;
        const folderFile = app.vault.getAbstractFileByPath(section.folder);
        const renamePromise = folderFile ? app.fileManager.renameFile(folderFile, newFolder) : Promise.resolve();
        const hubFile = app.vault.getAbstractFileByPath(section.hubPath);
        const fmPromise = hubFile ? app.fileManager.processFrontMatter(hubFile, (fm) => { fm.section = newTitle; fm.section_slug = newSlug; }) : Promise.resolve();
        return Promise.all([renamePromise, fmPromise]);
      },
      icons: { folder: folderIcon, file: fileIcon, dots: dotsIcon },
      rootClass: "se-root",
      // Recent mode: recent doc-notes across the whole docs subtree, each
      // tagged with its section-hub display title.
      listRecent: (dv2) => {
        try {
          const rawPages = dv2.pages(`"${docsFolder}"`);
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
                where: (f !== docsFolder ? (sectionByFolder[f] || f.slice(f.lastIndexOf("/") + 1)) : null),
              };
            });
        } catch (_e) { return []; }
      },
    };
  }

  _projectPage(dv, projectPath) {
    const projectPages = dv.pages(`"${projectPath}"`).where((p) => p.type === "project");
    return projectPages.length ? projectPages[0] : null;
  }

  // SEARCH MODE renderer — a flat, most-recent-first list of every matching
  // doc-note across the WHOLE docs subtree, each captioned with the section it
  // lives in. Replaces the sections/browse view while a query is active.
  // Mirrors WikiTree._renderSearchResults.
  _renderSearchResults(dv, proxyDv, docsFolder, filterCtx) {
    const rawPages = dv.pages(`"${docsFolder}"`);
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
        const where = this._sectionTrail(p, docsFolder, sectionByFolder);
        const ago = (p.file.mtime && window.moment) ? window.moment(p.file.mtime.ts).fromNow() : "";
        if (where) return ago ? `${where} · ${ago}` : where;
        return ago ? `edited ${ago}` : "";
      },
    });
  }

  // "in <section> / <sub-section>" trail for a doc-note, relative to the search
  // root (docsFolder). Uses each folder's section-hub display title, falling back
  // to the folder slug. A doc directly in docsFolder reads "here".
  // Mirrors WikiTree._sectionTrail.
  _sectionTrail(p, docsFolder, sectionByFolder) {
    const folder = String(p.file.folder != null ? p.file.folder : p.file.path.slice(0, p.file.path.lastIndexOf("/")));
    if (folder === docsFolder) return "here";
    if (!folder.startsWith(docsFolder + "/")) return "";
    const rel = folder.slice(docsFolder.length + 1).split("/");
    const parts = [];
    let acc = docsFolder;
    for (const seg of rel) {
      acc = acc + "/" + seg;
      parts.push((sectionByFolder && sectionByFolder[acc]) || seg);
    }
    return "in " + parts.join(" / ");
  }

  // synthetic dv-proxy routing dv.container + dv.el + dv.header + dv.paragraph
  // into a target container. Forwards dv.current + dv.pages to the real dv.
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
