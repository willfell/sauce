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

    if (customJS?.SectionLabel?.divider) customJS.SectionLabel.divider(container);

    // Sub-sections list — depth === 1 only.
    if (depth === 1) {
      const sectionPath = `spice/projects/${projectSlug}/docs/${sectionSlug}`;
      const subHubs = dv.pages(`"${sectionPath}"`)
        .where((p) => p.type === "section-hub" && p.depth === 2);
      if (subHubs.length > 0) {
        customJS.SectionLabel.render(proxyDv, { text: "Sub-sections" });
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

    // Docs in THIS folder — strict folder match (does NOT recurse).
    const docsPath = depth === 1
      ? `spice/projects/${projectSlug}/docs/${sectionSlug}`
      : `spice/projects/${projectSlug}/docs/${this._slugify(this._stripLink(cur.parent_section))}/${sectionSlug}`;

    const docs = dv.pages(`"${docsPath}"`)
      .where((p) => p.type === "doc-note" && p.file.folder === docsPath
        && customJS.DocSearch.matches(p, filterCtx))
      .sort((p) => p.file.mtime?.ts || 0, "desc");

    // No docs → render nothing more (the hairline + sections above stand alone).
    if (docs.length === 0) {
      return;
    }

    // When this section ALSO has sub-sections (depth-1 only), emit a "Docs"
    // SectionLabel so the docs row is visually separated from the sub-sections
    // row above.
    if (depth === 1) {
      try {
        const sectionPath = `spice/projects/${projectSlug}/docs/${sectionSlug}`;
        const hasSubSections = dv.pages(`"${sectionPath}"`)
          .where((p) => p.type === "section-hub" && p.depth === 2)
          .length > 0;
        if (hasSubSections) customJS.SectionLabel.render(proxyDv, { text: "Docs" });
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

  // created_at is canonical ISO frontmatter; Dataview parses it into a Luxon
  // DateTime (has .toISO()), but unparsed strings can reach here too. Pre-canonical
  // notes have no created_at at all → fall back to file ctime.
  _formatCreated(p) {
    const raw = p.created_at;
    let m = null;
    if (raw && typeof raw.toISO === "function") m = moment(raw.toISO());
    else if (raw) m = moment(String(raw));
    if (!m || !m.isValid()) m = (p.file.ctime && p.file.ctime.ts) ? moment(p.file.ctime.ts) : null;
    return (m && m.isValid()) ? m.format("MMM D") : "";
  }
}
