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

    // Wiki parity (2026-07-02): the action row uses the wiki centered container
    // style, but WITHOUT flex-wrap — New Doc · New Section · Move stay on ONE row
    // (the wiki leaf action bar). Each button sized by _styleLeafBtn.
    const row = container.createEl("div");
    row.style.cssText = "display: flex; gap: 10px; margin: 0 auto; justify-content: center; align-items: stretch; max-width: 640px;";
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

  // Wiki-parity leaf-button sizing (mirrors WikiLeafActions._styleLeafBtn): each
  // button takes an equal share of the centered one-row action bar (flex: 1 1 0)
  // with a readable label + tap target; overflow hidden + nowrap so labels never
  // wrap the row to two lines.
  _styleLeafBtn(btn) {
    if (!btn || !btn.style) return btn;
    btn.style.flex = "1 1 0";
    btn.style.minWidth = "0";
    btn.style.fontSize = "0.9em";
    btn.style.padding = "8px 14px";
    btn.style.overflow = "hidden";
    btn.style.whiteSpace = "nowrap";
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
    const { projectSlug, projectPath, docsFolder, scopePath } = ctx;

    // Tier 2 — search strip: a text input + scoped "Search" button (wiki parity,
    // 2026-07-02: hideNativeSearch dropped so the scoped-search button shows, just
    // like the wiki). No tag chips (hideTags), never persisted (starts empty on
    // every visit). Leading hairline owns the tier boundary.
    if (customJS?.SectionLabel?.divider) customJS.SectionLabel.divider(dv);

    const filterCtx = customJS.DocSearch.render(dv, {
      projectSlug,
      scopePath,
      recursive: true,
      hideTags: true,
      persist: false,
      entityType: "doc-note",
      onChange: (c) => {
        this._currentCtx = c;
        c.resultsContainer.empty();
        this._renderResults(dv, projectSlug, projectPath, docsFolder, c);
      },
    });
    // Wiki parity: normalize the shared search strip's top gap to 12px (it ships
    // a 2px top margin) so the space above the search matches the divider grammar.
    try { const strip = dv.container.querySelector(".doc-search-strip"); if (strip && strip.style) strip.style.marginTop = "12px"; } catch (_e) {}
    if (this._currentCtx) {
      Object.assign(filterCtx, this._currentCtx);
    }

    // Tier 3 — the sections + docs list, rendered into the search strip's
    // resultsContainer so the input survives keystrokes.
    await this._renderResults(dv, projectSlug, projectPath, docsFolder, filterCtx);
  }

  async _renderResults(dv, projectSlug, projectPath, docsFolder, filterCtx) {
    const container = filterCtx.resultsContainer;
    const proxyDv = this._makeProxyDv(dv, container);

    // SEARCH MODE — with an active query, search the WHOLE docs subtree
    // recursively (mirrors WikiTree._renderResults): a flat most-recent-first
    // list of every matching doc-note, each tagged with the section it lives in.
    // The empty-query path falls through to the normal sections/browse view.
    if (filterCtx && filterCtx.hasActiveFilter) {
      this._renderSearchResults(dv, proxyDv, docsFolder, filterCtx);
      return;
    }

    // Leading hairline for the list tier.
    if (customJS?.SectionLabel?.divider) customJS.SectionLabel.divider(container);

    // Sections discovery: query filesystem for section-hub notes at depth 1
    // inside docs/ (union with declared sections[] for resilience). Filesystem
    // is the source of truth — sections created via "+ New Section" surface
    // without editing the project note.
    const project = this._projectPage(dv, projectPath);
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

    // Filtered docs, newest-first.
    const allDocs = dv.pages(`"${docsFolder}"`)
      .where((p) => p.type === "doc-note" && customJS.DocSearch.matches(p, filterCtx))
      .sort((p) => p.file.mtime?.ts || 0, "desc");

    // Section cards. SectionLabel heads the strip; sections sorted by maxMtime
    // DESC (active sections first), alphabetic tie-break, empty sections last.
    customJS.SectionLabel.render(proxyDv, { text: "Sections" });
    const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;

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
        file: { name: label, path: hubPath, folder: sectionFolder },
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
