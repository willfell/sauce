/**
 * SectionExplorer (CustomJS) — shared two-pane section/page navigator.
 *
 * The blueprint-agnostic extraction of "render a hub/section's child sections
 * (rail) and pages (page pane)", replacing WikiTree's and
 * ProjectDocsIndex/SectionHub's independent card-list renderers. Any blueprint
 * gets the identical rail + page pane + rename/delete/add-link actions by
 * handing render(dv, adapter) an adapter built by makeAdapter(config) that
 * supplies the blueprint-specific parts (how to list child sections/pages,
 * icons, and how to rename/delete/add-link).
 *
 * customJS class — NO imports/exports; loaded by the filesystem scan; the
 * plugin stores it as an INSTANCE, so every method is an INSTANCE method.
 * Every method is never-throw + cold-load-safe.
 */
class SectionExplorer {
  // Reuse established platform/blueprints/to-do/helpers/todo-daily-project-groups.js
  // precedent: only these schemes get a live href; anything else (incl.
  // javascript:) renders as plain non-clickable text, never silently dropped.
  static SAFE_URL_SCHEMES = ['http:', 'https:', 'mailto:', 'obsidian:', 'file:'];

  // ── makeAdapter — build a render(dv, adapter)-ready adapter from a per-
  // blueprint config. config = {
  //   resolveContext(dv) -> ctx|null,
  //   listSections(dv, ctx) -> [{ title, hubPath, folder, pageCount,
  //     subSectionCount, maxMtime, materialized }],
  //   listPages(dv, ctx, section|null) -> Dataview-page-like[],
  //   getLinks(section|ctx) -> [{url, text}],
  //   writeLinks(section|ctx, links) -> Promise<void>,
  //   canDelete(section) -> boolean,
  //   deleteSection(section) -> Promise<void>,
  //   renameSection(section, newTitle) -> Promise<void>,
  //   icons: { folder, file },
  //   rootClass,
  // }
  makeAdapter(config) {
    return {
      resolveContext: (dv) => config.resolveContext(dv),
      listSections: (dv, ctx) => config.listSections(dv, ctx) || [],
      listPages: (dv, ctx, section) => config.listPages(dv, ctx, section) || [],
      getLinks: (target) => config.getLinks(target) || [],
      writeLinks: (target, links) => config.writeLinks(target, links),
      canDelete: (section) => !!(config.canDelete && config.canDelete(section)),
      deleteSection: (section) => config.deleteSection(section),
      renameSection: (section, newTitle) => config.renameSection(section, newTitle),
      icons: config.icons || { folder: "", file: "" },
      rootClass: config.rootClass || "se-root",
    };
  }

  // ── render — entry point. Resolves context, lists sections, renders the
  // rail. (Page pane + mobile drawer + animation land in later tasks.)
  render(dv, adapter) {
    if (!adapter || typeof adapter.resolveContext !== "function") return;
    const container0 = (dv && dv.container) ? dv.container : dv;
    if (!container0 || typeof container0.createEl !== "function") return;
    const ctx = adapter.resolveContext(dv);
    if (!ctx) return;

    const root = container0.createEl("div", { cls: adapter.rootClass });
    const sections = adapter.listSections(dv, ctx);
    this._renderRail(dv, adapter, ctx, sections, root);

    const pane = root.createEl("div", { cls: "se-page-pane" });
    const pages = adapter.listPages(dv, ctx, null);
    this._renderPagePane(dv, adapter, ctx, null, pages, pane);
  }

  _renderPagePane(dv, adapter, ctx, section, pages, pane) {
    const links = adapter.getLinks(section || ctx);
    if (Array.isArray(links) && links.length > 0) {
      const linksRow = pane.createEl("div", { cls: "se-links-row" });
      for (const link of links) {
        const a = linksRow.createEl("a", { cls: "se-link-chip" });
        a.textContent = link.text || link.url;
        if (this._isSafeUrl(link.url)) {
          a.href = link.url;
          a.target = "_blank";
          a.rel = "noopener";
        }
        // Unsafe/malformed URLs: no href set — chip stays visible as plain
        // text instead of a live link, and is never silently dropped.
      }
    }

    if (typeof customJS === "undefined" || !customJS.BeaconCards || typeof customJS.BeaconCards.render !== "function") return;
    const proxyDv = this._makeProxyDv(dv, pane);
    const fileIcon = adapter.icons.file || "";
    customJS.BeaconCards.render(proxyDv, {
      pages,
      layout: "stacked",
      columns: 2,
      title: (p) => p.title || (p.file && p.file.name),
      icon: () => fileIcon,
      target: (p) => p.file && p.file.path,
    });
  }

  _isSafeUrl(url) {
    try {
      // v0.119.0 PATCH (C1 from code review, ported from
      // todo-daily-project-groups.js): trim before scheme detection.
      // Browsers strip leading whitespace from href attrs at resolution
      // time, so " javascript:alert(1)" executes as javascript: — but the
      // scheme regex doesn't match leading whitespace, falling through the
      // "relative URL" allow-path. Trim first.
      const trimmed = String(url == null ? '' : url).trim();
      // Allow relative URLs (no scheme) too — they're treated as same-origin.
      if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return true;
      const lower = trimmed.toLowerCase();
      return SectionExplorer.SAFE_URL_SCHEMES.some(s => lower.startsWith(s));
    } catch (_e) { return false; }
  }

  _makeProxyDv(dv, container) {
    return {
      container,
      current: dv.current ? dv.current.bind(dv) : (() => null),
      pages: dv.pages ? dv.pages.bind(dv) : (() => []),
    };
  }

  _renderRail(dv, adapter, ctx, sections, root) {
    if (!Array.isArray(sections) || sections.length === 0) return;
    const rail = root.createEl("div", { cls: "se-rail" });
    const sortRecent = (list) => [...list].sort((a, b) => (b.maxMtime || 0) - (a.maxMtime || 0));
    const sortAlpha = (list) => [...list].sort((a, b) => String(a.title).localeCompare(String(b.title)));
    const cardsWrap = rail.createEl("div", { cls: "se-rail-cards" });

    const paint = (mode) => {
      cardsWrap.empty();
      const ordered = mode === "alpha" ? sortAlpha(sections) : sortRecent(sections);
      for (const section of ordered) this._renderRailRow(dv, adapter, ctx, section, cardsWrap);
    };

    if (sections.length >= 2) {
      const toggle = rail.createEl("div", { cls: "se-rail-toggle" });
      const modes = [{ key: "recent", label: "Recent" }, { key: "alpha", label: "A–Z" }];
      let current = "recent";
      for (const m of modes) {
        const pill = toggle.createEl("span", { cls: "se-rail-toggle-pill" });
        pill.textContent = m.label;
        pill.onclick = () => { current = m.key; paint(current); };
      }
    }
    paint("recent");
  }

  _railMeta(section) {
    const parts = [];
    if (section.subSectionCount) parts.push(section.subSectionCount + " section" + (section.subSectionCount === 1 ? "" : "s"));
    parts.push((section.pageCount || 0) + " doc" + (section.pageCount === 1 ? "" : "s"));
    return parts.join(" · ");
  }

  _renderRailRow(dv, adapter, ctx, section, host) {
    const row = host.createEl("div", { cls: "se-rail-row" });
    const iconHtml = adapter.icons.folder || "";
    row.innerHTML = iconHtml + `<span>${this._escape(section.title)}</span>`;
    const meta = row.createEl("span", { cls: "se-rail-meta" });
    meta.textContent = this._railMeta(section);
    row.onclick = () => {
      if (section.hubPath) app.workspace.openLinkText(section.hubPath, "");
    };

    const dots = row.createEl("span", { cls: "se-rail-dots" });
    dots.innerHTML = adapter.icons.dots || "";
    dots.onclick = (ev) => {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      const canDelete = adapter.canDelete(section);
      const entries = [
        { label: "Rename", onSelect: () => this._openRenameDialog(dv, adapter, section) },
        { label: "Add link", onSelect: () => this._openAddLinkForm(dv, adapter, section) },
        { label: "Delete", danger: true, disabled: !canDelete, onSelect: () => { if (canDelete) this._openDeleteConfirm(dv, adapter, section); } },
      ];
      customJS.MenuPopover.open(entries, { anchor: dots });
    };
  }

  // ── Stubs wired up in Task 6/7 ──────────────────────────────────────────
  _openRenameDialog(dv, adapter, section) { /* Task 6 */ }
  _openAddLinkForm(dv, adapter, section) { /* Task 7 */ }
  _openDeleteConfirm(dv, adapter, section) {
    if (!adapter.canDelete(section)) return;
    try { adapter.deleteSection(section); } catch (_e) { /* never-throw */ }
  }

  _escape(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  }
}
