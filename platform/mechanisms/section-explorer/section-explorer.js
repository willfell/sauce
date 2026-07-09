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
    // CSS `@media (max-width)` reads the WINDOW viewport, not the actual
    // rendering pane — in Obsidian's multi-pane desktop layout a narrow note
    // pane in a wide window would otherwise still get the desktop two-column
    // layout. Drive the mobile/desktop switch from Obsidian's own platform
    // flag (same source BeaconCards/MenuPopover already use) via a class, and
    // keep the CSS media query only as a defensive fallback.
    try {
      if (typeof app !== "undefined" && app && app.isMobile) root.classList.add("se-mobile");
    } catch (_e) { /* never-throw */ }
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

    // Header row: "Sections" group label (left) + Recent/A–Z toggle (right).
    const header = rail.createEl("div", { cls: "se-rail-header" });
    header.createEl("span", { cls: "se-group-label", text: "Sections" });

    const sortRecent = (list) => [...list].sort((a, b) => (b.maxMtime || 0) - (a.maxMtime || 0));
    const sortAlpha = (list) => [...list].sort((a, b) => String(a.title).localeCompare(String(b.title)));
    const cardsWrap = rail.createEl("div", { cls: "se-rail-cards" });

    const paint = (mode) => {
      cardsWrap.empty();
      const ordered = mode === "alpha" ? sortAlpha(sections) : sortRecent(sections);
      for (const section of ordered) this._renderRailRow(dv, adapter, ctx, section, cardsWrap);
    };

    if (sections.length >= 2) {
      const toggle = header.createEl("div", { cls: "se-rail-toggle" });
      const modes = [{ key: "recent", label: "Recent" }, { key: "alpha", label: "A–Z" }];
      let current = "recent";
      const pills = [];
      const paintActive = () => {
        for (const p of pills) p.el.classList.toggle("is-active", p.key === current);
      };
      for (const m of modes) {
        const pill = toggle.createEl("span", { cls: "se-rail-toggle-pill" });
        pill.textContent = m.label;
        pill.onclick = () => { current = m.key; paintActive(); paint(current); };
        pills.push({ key: m.key, el: pill });
      }
      paintActive();
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
    const title = row.createEl("span", { cls: "se-rail-title" });
    title.innerHTML = iconHtml + `<span class="se-rail-title-text">${this._escape(section.title)}</span>`;
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

  // Pure link-mutation — mirrors ProjectLinksManager.addLink exactly (same
  // {url, text} shape, same empty/duplicate rejection) so the two dialogs stay
  // behaviorally identical without a cross-mechanism dependency.
  _addLinkPure(links, entry) {
    const list = Array.isArray(links) ? links.slice() : [];
    const url = String((entry && entry.url) || "").trim();
    const text = String((entry && entry.text) || "").trim();
    if (!url) return { links: list, changed: false, reason: "empty-url" };
    if (list.some((l) => l.url === url)) return { links: list, changed: false, reason: "duplicate" };
    list.push({ url, text: text || url });
    return { links: list, changed: true };
  }

  // Shared modal chassis for _openAddLinkForm/_openRenameDialog — mirrors
  // MenuPopover.open's overlay/panel/close pattern: dedupe by className,
  // single teardown fn for ALL dismiss paths (backdrop, Escape), and the
  // same ~400ms openedAt/withinOpeningGesture() ghost-click guard on the
  // backdrop handler (these modals are opened from INSIDE a MenuPopover
  // row's onSelect — the exact trigger shape that caused v0.194.1's
  // mobile self-dismiss incident; see lesson_mobile_chrome_ghostclick_and_coldload_page).
  // buildFn(panel, close) populates panel with whatever inputs/buttons the
  // caller needs and may call close() itself (e.g. on Save).
  _openModal(className, buildFn) {
    const doc = (typeof document !== "undefined") ? document : null;
    if (!doc || !doc.body) return null;
    const existing = doc.body.querySelector ? doc.body.querySelector("." + className) : null;
    if (existing && existing.remove) existing.remove();

    const overlay = doc.createElement("div");
    overlay.className = className;
    overlay.style.cssText = "position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;";
    const panel = doc.createElement("div");
    panel.style.cssText = "background:var(--background-primary);border-radius:12px;padding:16px;width:min(420px,90vw);box-shadow:0 8px 30px rgba(0,0,0,0.3);";

    // Single teardown for ALL dismiss paths (backdrop, Escape) — removes
    // overlay AND the keydown listener so a stale Escape handler can never
    // swallow keys elsewhere (mirrors MenuPopover.open's close()).
    const escListener = (e) => { if (e && e.key === "Escape") close(); };
    const close = () => {
      if (overlay.remove) overlay.remove();
      else if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (doc.removeEventListener) doc.removeEventListener("keydown", escListener);
    };

    // Opening-gesture ghost-click guard — mirrors MenuPopover.open exactly.
    // A menu-row tap can bleed through to this just-mounted full-screen
    // backdrop and self-dismiss it on mobile before the user ever sees it.
    // Reads overlay.__seOpenedAt (not a closed-over var) so tests can
    // fast-forward past the guard window by mutating the returned overlay.
    overlay.__seOpenedAt = (typeof Date !== "undefined" && Date.now) ? Date.now() : 0;
    const withinOpeningGesture = () => {
      if (!overlay.__seOpenedAt) return false;
      const now = (typeof Date !== "undefined" && Date.now) ? Date.now() : 0;
      return now - overlay.__seOpenedAt < 400;
    };

    overlay.onclick = (e) => {
      if (e && e.target === overlay && !withinOpeningGesture()) close();
    };
    if (doc.addEventListener) doc.addEventListener("keydown", escListener);

    if (typeof buildFn === "function") buildFn(panel, close, doc);
    overlay.appendChild(panel);
    doc.body.appendChild(overlay);
    return overlay;
  }

  // Real add-link modal — pure mutation this calls (_addLinkPure) is
  // covered directly by tests; the DOM shell is exercised via _openModal's
  // Escape/ghost-click guard tests (dogfood-only for the rest, matching the
  // established precedent for this kind of dialog).
  _openAddLinkForm(dv, adapter, section) {
    this._openModal("se-link-modal-overlay", (panel, close, doc) => {
      const urlInput = doc.createElement("input");
      urlInput.placeholder = "https://…";
      urlInput.style.cssText = "width:100%;margin-bottom:8px;";
      const textInput = doc.createElement("input");
      textInput.placeholder = "Label (optional)";
      textInput.style.cssText = "width:100%;margin-bottom:12px;";
      const addBtn = doc.createElement("button");
      addBtn.textContent = "Add link";
      addBtn.onclick = () => {
        const current = adapter.getLinks(section) || [];
        const result = this._addLinkPure(current, { url: urlInput.value, text: textInput.value });
        if (result.changed) { try { adapter.writeLinks(section, result.links); } catch (_e) { /* never-throw */ } }
        close();
      };
      panel.appendChild(urlInput);
      panel.appendChild(textInput);
      panel.appendChild(addBtn);
    });
  }

  // Real rename modal — calls adapter.renameSection (where wiki-vs-project
  // rename mechanics diverge; see Task 9). Same testability rationale above.
  _openRenameDialog(dv, adapter, section) {
    this._openModal("se-rename-modal-overlay", (panel, close, doc) => {
      const nameInput = doc.createElement("input");
      nameInput.value = section.title || "";
      nameInput.style.cssText = "width:100%;margin-bottom:12px;";
      const saveBtn = doc.createElement("button");
      saveBtn.textContent = "Rename";
      saveBtn.onclick = () => {
        const newTitle = String(nameInput.value || "").trim();
        if (newTitle && newTitle !== section.title) {
          try { adapter.renameSection(section, newTitle); } catch (_e) { /* never-throw */ }
        }
        close();
      };
      panel.appendChild(nameInput);
      panel.appendChild(saveBtn);
    });
  }

  _openDeleteConfirm(dv, adapter, section) {
    if (!adapter.canDelete(section)) return;
    try { adapter.deleteSection(section); } catch (_e) { /* never-throw */ }
  }

  _escape(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  }
}
