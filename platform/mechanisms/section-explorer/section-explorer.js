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

  // Inline 3-dot glyph — fallback for the per-doc ⋯ control when the adapter
  // doesn't supply an icons.dots (the section rail is always handed one).
  static _DOTS_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>';

  // customJS exposes the INSTANCE (`customJS.SectionExplorer`), not the class —
  // so `static` methods (pagesUnder, sectionTargets, planBulkMove, …) are NOT
  // reachable as `customJS.SectionExplorer.pagesUnder(...)` from blueprint move
  // blocks; that call throws "not a function", the enumerator's try/catch
  // swallows it, and every move picker (bulk / section / single-doc, both
  // blueprints) opens with an EMPTY destination list. Mirror every static onto
  // the instance here so external callers reach them. Instance (prototype)
  // methods already resolve, so we never clobber them (the `undefined` guard).
  constructor() {
    this._structuralRoots = new Map();
    try {
      const Ctor = SectionExplorer;
      for (const key of Object.getOwnPropertyNames(Ctor)) {
        if (key === 'prototype' || key === 'length' || key === 'name') continue;
        const val = Ctor[key];
        if (this[key] === undefined) {
          this[key] = (typeof val === 'function') ? val.bind(Ctor) : val;
        }
      }
    } catch (_e) { /* never-throw: a cold-load instance still works for statics via class name */ }
  }

  // One project Docs action-row implementation. ProjectDocsIndex and SectionHub
  // supply only the ordered entity/custom actions; this mechanism owns the
  // divider, row-scoped Dataview proxy, bounded EntityCreate wait, sequencing,
  // and final shared-button normalization. ProjectChromeBar is intentionally
  // not a caller: GA-C7a2 already replaced that historical standalone row.
  async renderActionRow(dv, actions) {
    try {
      const container = (dv && dv.container) ? dv.container : dv;
      if (!container || typeof container.createEl !== "function" || !Array.isArray(actions)) return null;

      const cjs = globalThis.customJS;
      if (cjs?.SectionLabel?.divider) cjs.SectionLabel.divider(container);
      const row = container.createEl("div", { cls: "sauce-action-row" });

      const proxyDv = Object.create((dv && typeof dv === "object") ? dv : null);
      Object.defineProperty(proxyDv, "container", { value: row, enumerable: true });

      const needsEntityCreate = actions.some((action) => action && action.kind === "entity");
      for (let i = 0; i < 40 && needsEntityCreate && !globalThis.customJS?.EntityCreate; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      for (const action of actions) {
        if (!action || typeof action !== "object") continue;
        if (action.kind === "entity") {
          const entityCreate = globalThis.customJS?.EntityCreate;
          if (!entityCreate || typeof entityCreate.render !== "function" || !action.instance) continue;
          const options = { instance: action.instance };
          if (action.presetPrompts !== undefined) options.presetPrompts = action.presetPrompts;
          options.structuralLifecycle = this.entityCreateLifecycle(dv);
          await entityCreate.render(proxyDv, options);
        } else if (action.kind === "custom" && typeof action.render === "function") {
          await action.render(row, dv);
        }
      }

      const buttons = (typeof row.querySelectorAll === "function") ? row.querySelectorAll("button") : [];
      for (const btn of buttons) {
        if (btn.classList?.add) btn.classList.add("sauce-btn");
        else btn.className = `${btn.className || ""} sauce-btn`.trim();
        if (btn.style) btn.style.cssText = "";
        btn.onmouseenter = null;
        btn.onmouseleave = null;
      }
      return row;
    } catch (_e) { return null; }
  }

  // Receipt-bound optimistic preview for project document/section creation.
  // EntityCreate owns persistence and calls these hooks only when a genuinely
  // new target is about to be created (existing-file navigation stays inert).
  entityCreateLifecycle(dv, adapter) {
    return {
      apply: (ctx) => {
        const root = this._structuralRoot(dv, adapter);
        if (!root || typeof root.createEl !== "function") return { focusTarget: null };
        const focusTarget = (typeof document !== "undefined") ? document.activeElement : null;
        const parent = (root.querySelector && (
          root.querySelector(".se-doc-grid") || root.querySelector(".se-rail-cards")
        )) || root;
        const node = parent.createEl("div", { cls: "se-entity-preview is-optimistic" });
        const targetPath = String(ctx && ctx.targetPath || "");
        const basename = targetPath.slice(targetPath.lastIndexOf("/") + 1).replace(/\.md$/i, "") || "New item";
        node.textContent = `Creating ${basename}…`;
        try { node.setAttr?.("tabindex", "-1"); node.focus?.(); } catch (_e) {}
        return { parent, node, nextSibling: node.nextSibling || null, focusTarget };
      },
      rollback: (receipt) => {
        const active = (typeof document !== "undefined") ? document.activeElement : null;
        const focusTarget = receipt?.focusTarget;
        const previewOwnedFocus = active === receipt?.node || receipt?.node?.contains?.(active);
        if (receipt?.node?.remove) receipt.node.remove();
        else receipt?.parent?.removeChild?.(receipt.node);
        const userMovedFocus = active && active !== focusTarget
          && active !== document.body && active.isConnected !== false && !previewOwnedFocus;
        if (!userMovedFocus) {
          try { focusTarget?.focus?.(); } catch (_e) {}
        }
      },
    };
  }

  // Receipt-bound lifecycle for structural edits owned by this explorer. Wiki
  // opts in through adapter.structural; project adapters retain their existing
  // behavior until they explicitly adopt the same contract. Nodes carry
  // mechanism-owned identity properties so rollback restores the exact object
  // at its exact parent/sibling position without selector escaping or a stale
  // Dataview reconstruction.
  _ownedNode(root, key, value) {
    if (!root || value == null) return null;
    if (root[key] === value) return root;
    for (const child of Array.from(root.children || [])) {
      const found = this._ownedNode(child, key, value);
      if (found) return found;
    }
    return null;
  }

  // Wiki chrome and WikiTree are separate Dataview blocks. Bind structural
  // gestures to the explorer-owned container for the same note/view instead
  // of assuming the dispatching ChromeBar container owns the visible rows.
  _pruneStructuralRoots() {
    for (const [key, roots] of Array.from(this._structuralRoots.entries())) {
      for (const root of Array.from(roots || [])) {
        if (!root || root.isConnected === false) roots.delete(root);
      }
      if (!roots || roots.size === 0) this._structuralRoots.delete(key);
    }
  }

  _registerStructuralRoot(adapter, root) {
    const key = adapter && adapter.structuralOwnerKey;
    if (!key || !root) return;
    // customJS exposes a session singleton. Sweep every owner key before a new
    // registration so navigating through unique notes cannot retain their
    // detached Dataview trees and closures for the rest of the app session.
    this._pruneStructuralRoots();
    const prior = this._structuralRoots.get(key) || new Set();
    prior.add(root);
    this._structuralRoots.set(key, prior);
  }

  _structuralRoot(dv, adapter) {
    const fallback = (dv && dv.container) ? dv.container : dv;
    const key = adapter && adapter.structuralOwnerKey;
    this._pruneStructuralRoots();
    const roots = key && this._structuralRoots.get(key);
    if (!roots || roots.size === 0) return fallback;
    const candidates = Array.from(roots).filter((root) => root && root.isConnected !== false);
    if (!candidates.length) return fallback;
    const scopeOf = (node) => {
      try { return node?.closest?.(".markdown-preview-view, .markdown-reading-view, .markdown-embed") || null; }
      catch (_e) { return null; }
    };
    const dispatchScope = scopeOf(fallback);
    if (dispatchScope) {
      const scoped = candidates.find((root) => scopeOf(root) === dispatchScope);
      if (scoped) return scoped;
      // A known view scope is authoritative. Never redirect its gesture into
      // the sole surviving tree for another pane of the same note.
      return fallback;
    }
    return candidates.length === 1 ? candidates[0] : fallback;
  }

  _applyStructuralReceipt(dv, spec, adapter) {
    const root = this._structuralRoot(dv, adapter);
    const focusTarget = (typeof document !== "undefined") ? document.activeElement : null;
    const node = this._ownedNode(root, spec.identityKey, spec.identityValue);
    if (spec.kind === "rename" && node) {
      const title = node.querySelector?.(".se-rail-title-text")
        || this._ownedNode(node, "__seTitle", true)
        || node;
      const text = title.textContent;
      title.textContent = spec.nextTitle;
      return { kind: "rename", node, title, text, focusTarget };
    }
    if (node && node.parentNode) {
      const parent = node.parentNode;
      const nextSibling = node.nextSibling || null;
      parent.removeChild(node);
      return { kind: "remove", parent, node, nextSibling, focusTarget };
    }
    if (!root || typeof root.createEl !== "function") return { kind: "none", focusTarget };
    const parent = (root.querySelector && (
      root.querySelector(".se-doc-grid") || root.querySelector(".se-rail-cards")
    )) || root;
    const preview = parent.createEl("div", { cls: "se-entity-preview is-optimistic" });
    preview.textContent = spec.preview || "Updating…";
    return { kind: "preview", parent, node: preview, nextSibling: preview.nextSibling || null, focusTarget };
  }

  _rollbackStructuralReceipt(receipt) {
    if (!receipt) return;
    if (receipt.kind === "rename" && receipt.title) receipt.title.textContent = receipt.text;
    if (receipt.kind === "remove" && receipt.parent && receipt.node) {
      const anchor = receipt.nextSibling && receipt.nextSibling.parentNode === receipt.parent
        ? receipt.nextSibling : null;
      if (anchor && typeof receipt.parent.insertBefore === "function") receipt.parent.insertBefore(receipt.node, anchor);
      else if (typeof receipt.parent.appendChild === "function") receipt.parent.appendChild(receipt.node);
    }
    if (receipt.kind === "preview" && receipt.node) {
      if (typeof receipt.node.remove === "function") receipt.node.remove();
      else if (receipt.parent && typeof receipt.parent.removeChild === "function") receipt.parent.removeChild(receipt.node);
    }
    try {
      const doc = (typeof document !== "undefined") ? document : null;
      const active = doc && doc.activeElement;
      const userMoved = active && active !== receipt.focusTarget && active !== doc.body
        && active.isConnected !== false;
      if (!userMoved) receipt.focusTarget?.focus?.();
    } catch (_e) {}
  }

  async _mutateStructure(dv, adapter, spec, write) {
    const cjs = (typeof globalThis !== "undefined" && globalThis.customJS) || null;
    const renderSafe = cjs && cjs.RenderSafe;
    if (!renderSafe || typeof renderSafe.mutateStructure !== "function") {
      return { ok: false, error: new Error("SectionExplorer: RenderSafe unavailable") };
    }
    return renderSafe.mutateStructure({
      app: (typeof globalThis !== "undefined" && globalThis.app) || null,
      dv,
      failureMessage: spec.failureMessage || "Could not update item",
      apply: () => this._applyStructuralReceipt(dv, spec, adapter),
      rollback: (receipt) => this._rollbackStructuralReceipt(receipt),
      write,
    });
  }

  // ── Shared move/bulk/delete pure logic (Task C) ───────────────────────────
  // These are STATIC (referenced by class name internally + mirrored onto the
  // instance by the constructor above so blueprint adapters can reach them via
  // customJS.SectionExplorer.X). They unify the retired WikiMove / DocMove /
  // DocMoveDialog / DocBulkMoveActions implementations into one Node-testable
  // surface. Every one is total (never throws) so a cold-loading adapter can
  // call them safely.

  // Folder slug: lowercase, trim, non-alnum → single dash, no edge dashes.
  static _slugify(s) {
    return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  // Build depth-ordered move targets for a blueprint's section tree. Unifies
  // WikiMove.sectionTargets (root spice/wiki, type wiki-section) and
  // DocMoveDialog.sectionTargets (root <proj>/docs, type section-hub). Returns
  // [{ folder, label, depth }] with the root first (depth 0) then every
  // sectionType page under root+"/", sorted lexically by folder so each parent
  // precedes its children. `opts.labelOf(page)` supplies the human label;
  // blank falls back to the folder basename.
  static sectionTargets(pages, opts) {
    const o = opts || {};
    const root = String(o.root == null ? "" : o.root).replace(/\/+$/, "");
    const rootSegs = root ? root.split("/").length : 0;
    const prefix = root + "/";
    const rootEntry = { folder: root, label: o.rootLabel || "(root)", depth: 0 };
    const labelOf = typeof o.labelOf === "function" ? o.labelOf : () => "";
    const sections = (Array.isArray(pages) ? pages : Array.from(pages || []))
      .filter((p) => p && p.type === o.sectionType && p.file && p.file.path &&
        String(p.file.path).indexOf(prefix) === 0)
      .map((p) => {
        const path = String(p.file.path);
        const folder = path.slice(0, path.lastIndexOf("/"));
        const label = (String(labelOf(p) || "").trim()) || folder.split("/").pop();
        const depth = folder.split("/").length - rootSegs;
        return { folder, label, depth };
      })
      .sort((a, b) => a.folder.localeCompare(b.folder));
    return [rootEntry, ...sections];
  }

  // Destination path for a note moved into targetFolder (folder + basename).
  static targetPath(targetFolder, currentPath) {
    const basename = String(currentPath).slice(String(currentPath).lastIndexOf("/") + 1);
    return targetFolder + "/" + basename;
  }

  // True when the note already lives directly in targetFolder (no-op guard).
  static isNoop(targetFolder, currentPath) {
    const folder = String(currentPath).slice(0, String(currentPath).lastIndexOf("/"));
    return targetFolder === folder;
  }

  // Plan a batch move of selectedPaths into targetFolder. Self-contained (uses
  // the statics above, no docMove instance). Returns { moves:[{from,to}],
  // skipped:[{path,reason}] } with reasons already-there / no-dest / collision.
  // Destinations are de-duplicated via a Set (a second doc whose basename lands
  // on an earlier move's destination is a collision).
  static planBulkMove(selectedPaths, targetFolder) {
    const moves = [];
    const skipped = [];
    const destSeen = new Set();
    const dest = String(targetFolder == null ? "" : targetFolder);
    for (const raw of (selectedPaths || [])) {
      const from = (raw && typeof raw === "object") ? String(raw.path || "") : String(raw || "");
      // Empty source path or missing destination → no computable destination.
      if (!from || !dest) { skipped.push({ path: from, reason: "no-dest" }); continue; }
      if (SectionExplorer.isNoop(dest, from)) { skipped.push({ path: from, reason: "already-there" }); continue; }
      const to = SectionExplorer.targetPath(dest, from);
      if (destSeen.has(to)) { skipped.push({ path: from, reason: "collision" }); continue; }
      destSeen.add(to);
      moves.push({ from, to });
    }
    return { moves, skipped };
  }

  // Count pages of docType whose folder === folder or is a descendant of it.
  static subtreeDocCount(pages, folder, docType) {
    const f = String(folder == null ? "" : folder);
    const pre = f + "/";
    let n = 0;
    for (const p of (Array.isArray(pages) ? pages : Array.from(pages || []))) {
      if (!p || p.type !== docType || !p.file) continue;
      const pf = p.file.folder != null ? String(p.file.folder)
        : String(p.file.path || "").slice(0, String(p.file.path || "").lastIndexOf("/"));
      if (pf === f || pf.indexOf(pre) === 0) n++;
    }
    return n;
  }

  // Section-hub folders STRICTLY under `folder` (the folder itself excluded).
  static childSectionFolders(pages, folder, sectionType) {
    const f = String(folder == null ? "" : folder);
    const pre = f + "/";
    const out = new Set();
    for (const p of (Array.isArray(pages) ? pages : Array.from(pages || []))) {
      if (!p || p.type !== sectionType || !p.file || !p.file.path) continue;
      const path = String(p.file.path);
      const pf = path.slice(0, path.lastIndexOf("/"));
      if (pf !== f && pf.indexOf(pre) === 0) out.add(pf);
    }
    return [...out].sort((a, b) => a.localeCompare(b));
  }

  // Mobile-robust page enumeration: read the metadata cache directly instead of a
  // captured render-time dv.pages() (which throws / returns empty at dispatch time
  // on mobile — the dataviewjs block that created `dv` is torn down by the time a
  // ⋯-menu action fires). Returns Dataview-page-like objects for every markdown
  // file under `root/`, carrying frontmatter type/title/section/depth + file path.
  static pagesUnder(root) {
    const out = [];
    try {
      if (typeof app === "undefined" || !app.vault || !app.metadataCache) return out;
      const files = (typeof app.vault.getMarkdownFiles === "function") ? app.vault.getMarkdownFiles() : [];
      const prefix = String(root == null ? "" : root).replace(/\/+$/, "") + "/";
      for (const f of files) {
        if (!f || !f.path || String(f.path).indexOf(prefix) !== 0) continue;
        let fm = {};
        try { const c = app.metadataCache.getFileCache(f); fm = (c && c.frontmatter) || {}; } catch (_e) { fm = {}; }
        const path = String(f.path);
        const folder = path.slice(0, path.lastIndexOf("/"));
        out.push({
          type: fm.type, title: fm.title, section: fm.section, sub_section: fm.sub_section,
          depth: fm.depth, links: fm.links,
          file: { path, folder, name: f.name || path.slice(path.lastIndexOf("/") + 1) },
        });
      }
    } catch (_e) { /* never-throw */ }
    return out;
  }

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
      pageLabel: config.pageLabel || "Docs",
      listRecent: config.listRecent ? ((dv, ctx) => config.listRecent(dv, ctx) || []) : null,
      // Forward the move block + delete-confirm helper so the rail-row Move and
      // both blueprints' section-⋯ routes (_openMovePickerForSection /
      // _openDeleteConfirm) read them straight off makeAdapter's output rather
      // than needing an external overlay. Null-safe: absent config leaves them
      // undefined and the consuming methods no-op.
      move: config.move || null,
      emptySubsectionCount: (typeof config.emptySubsectionCount === "function")
        ? ((section) => config.emptySubsectionCount(section))
        : undefined,
      structural: config.structural === true,
      structuralOwnerKey: config.structuralOwnerKey || null,
    };
  }

  // ── render — entry point. Resolves context, lists sections, renders the
  // rail. (Page pane + mobile drawer + animation land in later tasks.)
  render(dv, adapter) {
    if (!adapter || typeof adapter.resolveContext !== "function") return;
    const container0 = (dv && dv.container) ? dv.container : dv;
    if (!container0 || typeof container0.createEl !== "function") return;
    if (adapter.structural === true) this._registerStructuralRoot(adapter, container0);
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

    // No docs at this level but real sections in the rail — fill the pane
    // with the subtree's recently-updated docs when the adapter provides
    // them; otherwise (no listRecent / nothing recent) suppress the pane —
    // an empty "Nothing here yet." box next to a populated rail is noise.
    // A truly-empty leaf (0 sections AND 0 pages) keeps the pane so its
    // empty message means something.
    const pages = adapter.listPages(dv, ctx, null);
    const pageCount = Array.isArray(pages) ? pages.length : (pages && pages.length) || 0;
    if (pageCount === 0 && Array.isArray(sections) && sections.length > 0) {
      const recent = adapter.listRecent ? adapter.listRecent(dv, ctx) : [];
      if (!Array.isArray(recent) || recent.length === 0) return;
      const recentPane = root.createEl("div", { cls: "se-page-pane" });
      this._renderRecentPane(dv, adapter, ctx, recent, recentPane);
      return;
    }

    const pane = root.createEl("div", { cls: "se-page-pane" });
    this._renderPagePane(dv, adapter, ctx, null, pages, pane);
  }

  // Recent mode — a hub/section with zero direct docs shows the subtree's
  // recently-updated docs instead of an empty pane. Links row still renders
  // (the hub's own pinned links stay reachable), then the recent card grid.
  _renderRecentPane(dv, adapter, ctx, recent, pane) {
    this._renderLinksRow(adapter, ctx, pane);
    pane.createEl("div", { cls: "se-group-label se-pane-label", text: "Recently updated" });
    const cards = (Array.isArray(recent) ? recent : Array.from(recent || [])).map((p) => this._docCardModel(p));
    this._renderDocCards(dv, pane, adapter, cards);
  }

  // Pinned-links chips row — shared by the normal page pane and recent mode.
  _renderLinksRow(adapter, target, pane) {
    const links = adapter.getLinks(target);
    if (!Array.isArray(links) || links.length === 0) return;
    const linksRow = pane.createEl("div", { cls: "se-links-row" });
    for (const link of links) {
      const a = linksRow.createEl("a", { cls: "se-link-chip" });
      a.textContent = link.text || link.url;
      const href = this._normalizeUrl(link.url);
      if (this._isSafeUrl(href)) {
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener";
      }
      // Unsafe/malformed URLs: no href set — chip stays visible as plain
      // text instead of a live link, and is never silently dropped.
    }
  }

  _renderPagePane(dv, adapter, ctx, section, pages, pane) {
    this._renderLinksRow(adapter, section || ctx, pane);
    pane.createEl("div", { cls: "se-group-label se-pane-label", text: adapter.pageLabel || "Docs" });
    const cards = (Array.isArray(pages) ? pages : Array.from(pages || [])).map((p) => this._docCardModel(p));
    this._renderDocCards(dv, pane, adapter, cards);
  }

  // Normalize a Dataview page into the doc-card model {title, path, mtime, where}.
  _docCardModel(p) {
    const rawName = (p && p.file && p.file.name) || "";
    return {
      // title fallback: basename without .md (explicit title still wins)
      title: (p && p.title) || String(rawName).replace(/\.md$/, "") || "",
      path: (p && p.file && p.file.path) || (p && p.path) || "",
      mtime: (p && p.file && p.file.mtime && p.file.mtime.ts) || (p && p.mtime) || 0,
      where: (p && p.where) || null,
    };
  }

  // Mechanism-owned doc cards — the pane's visual language lives here (not in
  // BeaconCards) so docs read distinctly from rail section rows: each card
  // carries a bordered accent icon BADGE (the "this is a document" mark),
  // where rail rows use a flat inline folder icon.
  // `select` (optional) = { selected:Set<path>, onToggle(path,checked) } flips
  // cards into bulk-select mode: a leading checkbox (stopPropagation so a check
  // never opens the note) and no navigation onclick.
  _renderDocCards(dv, pane, adapter, cards, select) {
    if (!Array.isArray(cards) || cards.length === 0) {
      const empty = pane.createEl("div", { cls: "se-doc-empty" });
      empty.textContent = "Nothing here yet.";
      return;
    }
    const grid = pane.createEl("div", { cls: "se-doc-grid" });
    for (const c of cards) {
      const card = grid.createEl("div", { cls: select ? "se-doc-card is-selectable" : "se-doc-card" });
      card.__sePath = c.path;
      if (select) {
        const cb = card.createEl("input", { cls: "se-doc-check" });
        try { cb.type = "checkbox"; } catch (_e) { /* stub */ }
        cb.checked = !!(select.selected && select.selected.has(c.path));
        cb.onclick = (ev) => { if (ev && ev.stopPropagation) ev.stopPropagation(); };
        cb.onchange = () => { if (typeof select.onToggle === "function") select.onToggle(c.path, !!cb.checked); };
      }
      const icon = card.createEl("span", { cls: "se-doc-icon" });
      icon.innerHTML = adapter.icons.file || "";
      const body = card.createEl("div", { cls: "se-doc-body" });
      const title = body.createEl("div", { cls: "se-doc-title" });
      title.__seTitle = true;
      title.textContent = c.title;
      const sub = body.createEl("div", { cls: "se-doc-sub" });
      sub.textContent = this._docCardSub(c);
      if (!select) {
        card.onclick = () => {
          if (c.path) { try { app.workspace.openLinkText(c.path, "", false); } catch (_e) { /* never-throw */ } }
        };
        // Per-doc ⋯ menu (Rename · Move · Add link · Delete) — generic file ops
        // on the individual doc FILE, blueprint-agnostic. stopPropagation so the
        // dots click never triggers the card's open-note handler above.
        const dots = card.createEl("span", { cls: "se-doc-dots" });
        dots.innerHTML = (adapter.icons && adapter.icons.dots) || SectionExplorer._DOTS_SVG;
        dots.onclick = (ev) => {
          if (ev && ev.stopPropagation) ev.stopPropagation();
          let file = null;
          try { file = app.vault.getAbstractFileByPath(c.path); } catch (_e) { file = null; }
          if (!file) return;
          const entries = [
            { label: "Rename", onSelect: () => this._openRenameDocDialog(dv, adapter, file) },
            { label: "Move", onSelect: () => this._openMovePickerForDoc(dv, adapter, file) },
            { label: "Add link", onSelect: () => this._openAddLinkForDoc(dv, adapter, file) },
            { label: "Delete", danger: true, onSelect: () => this._openDeleteDocConfirm(dv, adapter, file) },
          ];
          try { customJS.MenuPopover.open(entries, { anchor: dots }); } catch (_e) { /* never-throw */ }
        };
      }
    }
  }

  // "in <section> · 2 hours ago" (recent mode) / "edited 2 hours ago" (docs mode).
  _docCardSub(c) {
    let ago = "";
    try {
      if (c.mtime && typeof window !== "undefined" && window.moment) ago = window.moment(c.mtime).fromNow();
    } catch (_e) { /* cosmetic */ }
    if (c.where) return ago ? ("in " + c.where + " · " + ago) : ("in " + c.where);
    return ago ? ("edited " + ago) : "";
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
    row.__seFolder = section && section.folder;
    const iconHtml = adapter.icons.folder || "";
    // Stacked layout: title on its own line, meta below it — long section
    // names truncate instead of colliding with the counts.
    const main = row.createEl("div", { cls: "se-rail-main" });
    const title = main.createEl("span", { cls: "se-rail-title" });
    title.__seTitle = true;
    title.innerHTML = iconHtml + `<span class="se-rail-title-text">${this._escape(section.title)}</span>`;
    const meta = main.createEl("span", { cls: "se-rail-meta" });
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
        { label: "Move", onSelect: () => this._openMovePickerForSection(dv, adapter, section) },
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
    const url = this._normalizeUrl(String((entry && entry.url) || ""));
    const text = String((entry && entry.text) || "").trim();
    if (!url) return { links: list, changed: false, reason: "empty-url" };
    // Compare NORMALIZED forms so "google.com" duplicates "https://google.com".
    if (list.some((l) => this._normalizeUrl(l && l.url) === url)) return { links: list, changed: false, reason: "duplicate" };
    list.push({ url, text: text || url });
    return { links: list, changed: true };
  }

  // Schemeless URLs ("google.com") stored/rendered as-is become RELATIVE hrefs
  // that resolve against the app origin — clicking one opens whatever the
  // webview decides, not the site the user meant. These links are web links by
  // design (the dialog placeholder is https://…), so default the scheme.
  _normalizeUrl(url) {
    const trimmed = String(url == null ? "" : url).trim();
    if (!trimmed) return "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
    return "https://" + trimmed;
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
    panel.className = "se-modal-panel";
    panel.style.cssText = "background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:12px;padding:18px;width:min(420px,90vw);box-shadow:0 8px 30px rgba(0,0,0,0.3);";

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

  // ── Shared modal chrome — title, styled input, Cancel + primary button row.
  // Classes are styled by the section-explorer.css snippet; light inline
  // styles keep the dialog readable even if the snippet is disabled.
  _modalTitle(doc, panel, text) {
    const t = doc.createElement("div");
    t.className = "se-modal-title";
    t.textContent = text;
    t.style.cssText = "font-weight:600;font-size:1.05em;margin-bottom:12px;color:var(--text-normal);";
    panel.appendChild(t);
    return t;
  }

  _modalInput(doc, panel, opts) {
    const input = doc.createElement("input");
    input.className = "se-modal-input";
    if (opts && opts.placeholder) input.placeholder = opts.placeholder;
    if (opts && opts.value != null) input.value = opts.value;
    input.style.cssText = "width:100%;box-sizing:border-box;margin-bottom:8px;padding:8px 10px;border-radius:8px;border:1px solid var(--background-modifier-border);background:var(--background-modifier-form-field, var(--background-primary));color:var(--text-normal);font-size:0.95em;outline:none;";
    if (opts && typeof opts.onEnter === "function") {
      input.onkeydown = (e) => { if (e && e.key === "Enter") opts.onEnter(); };
    }
    panel.appendChild(input);
    return input;
  }

  _modalButtons(doc, panel, close, primaryLabel, onPrimary) {
    const row = doc.createElement("div");
    row.className = "se-modal-btns";
    row.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-top:8px;";
    const cancel = doc.createElement("button");
    cancel.className = "se-modal-btn";
    cancel.textContent = "Cancel";
    cancel.style.cssText = "padding:7px 14px;border-radius:8px;border:1px solid var(--background-modifier-border);background:transparent;color:var(--text-muted);cursor:pointer;font-size:0.9em;";
    cancel.onclick = () => close();
    const primary = doc.createElement("button");
    primary.className = "se-modal-btn se-modal-btn-primary";
    primary.textContent = primaryLabel;
    primary.style.cssText = "padding:7px 14px;border-radius:8px;border:none;background:var(--interactive-accent);color:var(--text-on-accent);cursor:pointer;font-weight:600;font-size:0.9em;";
    primary.onclick = () => onPrimary();
    row.appendChild(cancel);
    row.appendChild(primary);
    panel.appendChild(row);
    return { cancel, primary };
  }

  // Real add-link modal — pure mutation this calls (_addLinkPure) is
  // covered directly by tests; Cancel/primary/Enter wiring is covered by the
  // modal-chrome tests against the doc stub.
  _openAddLinkForm(dv, adapter, section) {
    this._openModal("se-link-modal-overlay", (panel, close, doc) => {
      this._modalTitle(doc, panel, "Add link");
      let submitting = false;
      const submit = async () => {
        if (submitting) return false;
        const current = adapter.getLinks(section) || [];
        const result = this._addLinkPure(current, { url: urlInput.value, text: textInput.value });
        if (!result.changed) { try { urlInput.focus?.(); } catch (_e) {} return false; }
        submitting = true;
        try {
          const persisted = await adapter.writeLinks(section, result.links);
          if (persisted && persisted.ok === false) { try { urlInput.focus?.(); } catch (_e) {} return false; }
          close();
          return true;
        } catch (_e) {
          try { urlInput.focus?.(); } catch (_err) {}
          return false;
        } finally { submitting = false; }
      };
      const urlInput = this._modalInput(doc, panel, { placeholder: "https://…", onEnter: () => submit() });
      const textInput = this._modalInput(doc, panel, { placeholder: "Label (optional)", onEnter: () => submit() });
      this._modalButtons(doc, panel, close, "Add link", submit);
    });
  }

  // Real rename modal — calls adapter.renameSection (where wiki-vs-project
  // rename mechanics diverge). Same chrome as the add-link modal.
  _openRenameDialog(dv, adapter, section) {
    this._openModal("se-rename-modal-overlay", (panel, close, doc) => {
      this._modalTitle(doc, panel, "Rename section");
      let submitting = false;
      const submit = async () => {
        if (submitting) return false;
        const newTitle = String(nameInput.value || "").trim();
        if (!newTitle || newTitle === section.title) { try { nameInput.focus?.(); } catch (_e) {} return false; }
        submitting = true;
        try {
          const persisted = adapter.structural === true
            ? await this._mutateStructure(dv, adapter, {
                kind: "rename", identityKey: "__seFolder", identityValue: section.folder,
                nextTitle: newTitle, preview: `Renaming ${section.title || "section"}…`,
                failureMessage: `Could not rename ${section.title || "section"}`,
              }, () => adapter.renameSection(section, newTitle))
            : await adapter.renameSection(section, newTitle);
          if (persisted && persisted.ok === false) { try { nameInput.focus?.(); } catch (_e) {} return false; }
          close();
          return true;
        } catch (_e) {
          try { nameInput.focus?.(); } catch (_err) {}
          return false;
        } finally { submitting = false; }
      };
      const nameInput = this._modalInput(doc, panel, { value: section.title || "", onEnter: () => submit() });
      this._modalButtons(doc, panel, close, "Rename", submit);
    });
  }

  // Recursive confirmed delete (Task E3). Guards canDelete, then a confirm modal
  // whose wording reflects the empty-sub-section count (no docs are ever lost —
  // canDelete already gated on a zero doc-note subtree). deleteSection trashes
  // the folder, which is recursive in Obsidian.
  _openDeleteConfirm(dv, adapter, section) {
    if (!adapter || typeof adapter.canDelete !== "function" || !adapter.canDelete(section)) return;
    const title = (section && section.title) || "this section";
    let n = 0;
    try { n = adapter.emptySubsectionCount ? Number(adapter.emptySubsectionCount(section)) || 0 : 0; } catch (_e) { n = 0; }
    const msg = n > 0
      ? "Delete '" + title + "' and " + n + " empty sub-section" + (n === 1 ? "" : "s") + "? No docs will be lost."
      : "Delete '" + title + "'?";
    this._openModal("se-delete-modal-overlay", (panel, close, doc) => {
      this._modalTitle(doc, panel, "Delete section");
      const body = doc.createElement("div");
      body.className = "se-modal-body";
      body.textContent = msg;
      body.style.cssText = "margin-bottom:12px;color:var(--text-muted);font-size:0.92em;line-height:1.4;";
      panel.appendChild(body);
      let submitting = false;
      const onConfirm = async () => {
        if (submitting) return false;
        submitting = true;
        try {
          const persisted = adapter.structural === true
            ? await this._mutateStructure(dv, adapter, {
                kind: "remove", identityKey: "__seFolder", identityValue: section.folder,
                preview: `Deleting ${title}…`, failureMessage: `Could not delete ${title}`,
              }, () => adapter.deleteSection(section))
            : await adapter.deleteSection(section);
          if (persisted && persisted.ok === false) { try { btns?.primary?.focus?.(); } catch (_e) {} return false; }
          close();
          return true;
        } catch (_e) {
          try { btns?.primary?.focus?.(); } catch (_err) {}
          return false;
        } finally { submitting = false; }
      };
      const btns = this._modalButtons(doc, panel, close, "Delete", onConfirm);
      // Style the primary as danger (red) — this is a destructive confirm.
      if (btns && btns.primary) {
        btns.primary.style.cssText = "padding:7px 14px;border-radius:8px;border:none;background:var(--color-red, #e5484d);color:#fff;cursor:pointer;font-weight:600;font-size:0.9em;";
      }
    });
  }

  // ── Per-doc ⋯ menu dialogs (feature a) ───────────────────────────────────
  // Generic file operations on an individual doc FILE, shared by both wiki and
  // project doc cards. Blueprint-agnostic (app.* + adapter.move); every helper
  // never-throws and mirrors the section-level dialog idiom.

  // Folder that a file lives in, derived from its path (parent.path fallback).
  _fileFolder(file) {
    if (file && file.parent && file.parent.path != null) return String(file.parent.path);
    const p = (file && file.path) ? String(file.path) : "";
    const i = p.lastIndexOf("/");
    return i >= 0 ? p.slice(0, i) : "";
  }

  // Rename the doc FILE: text input defaulting to current basename (no .md);
  // on confirm, sanitize to a safe filename and renameFile to sameFolder/<safe>.md.
  _openRenameDocDialog(dv, adapter, file) {
    try {
      if (!file || !file.path) return;
      const base = String(file.path).split("/").pop().replace(/\.md$/i, "");
      const folder = this._fileFolder(file);
      this._openModal("se-rename-modal-overlay", (panel, close, doc) => {
        this._modalTitle(doc, panel, "Rename doc");
        let submitting = false;
        const submit = async () => {
          if (submitting) return false;
          const raw = String(nameInput.value || "").trim();
          // Strip path separators + control chars → keep a safe single filename.
          const safe = raw.replace(/[\\/:*?"<>|]+/g, "").replace(/^\.+/, "").trim();
          if (safe && safe !== base) {
            const newPath = (folder ? folder + "/" : "") + safe + ".md";
            submitting = true;
            try {
              const persisted = adapter && adapter.structural === true
                ? await this._mutateStructure(dv, adapter, {
                    kind: "rename", identityKey: "__sePath", identityValue: file.path,
                    nextTitle: safe, preview: `Renaming ${base}…`, failureMessage: `Could not rename ${base}`,
                  }, () => app.fileManager.renameFile(file, newPath))
                : await app.fileManager.renameFile(file, newPath);
              if (persisted && persisted.ok === false) { try { nameInput.focus?.(); } catch (_e) {} return false; }
            } catch (_e) { try { nameInput.focus?.(); } catch (_err) {} return false; }
            finally { submitting = false; }
          }
          close();
          return true;
        };
        const nameInput = this._modalInput(doc, panel, { value: base, onEnter: () => submit() });
        this._modalButtons(doc, panel, close, "Rename", submit);
      });
    } catch (_e) { /* never-throw */ }
  }

  // Move the doc via the SAME machinery as section-move: enumerate folder
  // targets from the adapter's move block (fallback to move.root), open the
  // collapsible picker, and on pick delegate to applyDocMove (project
  // frontmatter-rewrite + wiki folder-only both flow through there).
  _openMovePickerForDoc(dv, adapter, file) {
    try {
      if (!file || !file.path) return;
      const mv = adapter && adapter.move;
      let targets = [];
      try {
        if (mv && typeof mv.enumerateSectionTargets === "function") targets = mv.enumerateSectionTargets(dv) || [];
      } catch (_e) { targets = []; }
      if ((!targets || targets.length === 0) && mv && mv.root) {
        targets = [{ folder: String(mv.root), label: "(root)", depth: 0 }];
      }
      const currentFolder = this._fileFolder(file);
      this.openMovePicker({
        targets,
        currentFolder,
        title: "Move doc",
        onPick: (folder) => this.applyDocMove(dv, file, folder, adapter),
      });
    } catch (_e) { /* never-throw */ }
  }

  // Add a link to the DOC's OWN frontmatter (not a section). Reuses the
  // add-link form shape + _addLinkPure normalization, then writes fm.links
  // via processFrontMatter on the doc file itself.
  _openAddLinkForDoc(dv, adapter, file) {
    try {
      if (!file || !file.path) return;
      this._openModal("se-link-modal-overlay", (panel, close, doc) => {
        this._modalTitle(doc, panel, "Add link");
        const submit = () => {
          let current = [];
          try {
            if (typeof app !== "undefined" && app.metadataCache && typeof app.metadataCache.getFileCache === "function") {
              const c = app.metadataCache.getFileCache(file);
              current = (c && c.frontmatter && Array.isArray(c.frontmatter.links)) ? c.frontmatter.links : [];
            }
          } catch (_e) { current = []; }
          const result = this._addLinkPure(current, { url: urlInput.value, text: textInput.value });
          if (result.changed) {
            try {
              app.fileManager.processFrontMatter(file, (fm) => {
                const cur = Array.isArray(fm.links) ? fm.links : [];
                fm.links = [...cur, result.links[result.links.length - 1]];
              });
            } catch (_e) { /* never-throw */ }
          }
          close();
        };
        const urlInput = this._modalInput(doc, panel, { placeholder: "https://…", onEnter: () => submit() });
        const textInput = this._modalInput(doc, panel, { placeholder: "Label (optional)", onEnter: () => submit() });
        this._modalButtons(doc, panel, close, "Add link", submit);
      });
    } catch (_e) { /* never-throw */ }
  }

  // Danger-styled confirm; on confirm trashFile (recoverable trash, never a
  // hard delete). Mirrors _openDeleteConfirm's chrome.
  _openDeleteDocConfirm(dv, adapter, file) {
    try {
      if (!file || !file.path) return;
      const name = String(file.path).split("/").pop().replace(/\.md$/i, "");
      this._openModal("se-delete-modal-overlay", (panel, close, doc) => {
        this._modalTitle(doc, panel, "Delete doc");
        const body = doc.createElement("div");
        body.className = "se-modal-body";
        body.textContent = "Delete '" + name + "'? It moves to trash and can be recovered.";
        body.style.cssText = "margin-bottom:12px;color:var(--text-muted);font-size:0.92em;line-height:1.4;";
        panel.appendChild(body);
        let submitting = false;
        const btns = this._modalButtons(doc, panel, close, "Delete", async () => {
          if (submitting) return false;
          submitting = true;
          try {
            const persisted = adapter && adapter.structural === true
              ? await this._mutateStructure(dv, adapter, {
                  kind: "remove", identityKey: "__sePath", identityValue: file.path,
                  preview: `Deleting ${name}…`, failureMessage: `Could not delete ${name}`,
                }, () => app.fileManager.trashFile(file))
              : await app.fileManager.trashFile(file);
            if (persisted && persisted.ok === false) { try { btns?.primary?.focus?.(); } catch (_e) {} return false; }
            close();
            return true;
          } catch (_e) { try { btns?.primary?.focus?.(); } catch (_err) {} return false; }
          finally { submitting = false; }
        });
        if (btns && btns.primary) {
          btns.primary.style.cssText = "padding:7px 14px;border-radius:8px;border:none;background:var(--color-red, #e5484d);color:#fff;cursor:pointer;font-weight:600;font-size:0.9em;";
        }
      });
    } catch (_e) { /* never-throw */ }
  }

  // ── Collapsible move picker (Task D) ──────────────────────────────────────
  // A tree dialog, collapsed by default, that auto-expands the branch containing
  // currentFolder. Node-with-children rows get a ▸/▾ toggle; the header offers
  // Expand all / Collapse all + a filter input (non-empty query → flat matching
  // rows ignoring collapse; cleared → restore). The current-folder row is greyed
  // and non-clickable. Test seams (__seExpandAll/__seCollapseAll/__seSetFilter/
  // __seVisibleFolders) let the harness drive/assert without synthetic events.
  openMovePicker(opts) {
    const o = opts || {};
    const targets = Array.isArray(o.targets) ? o.targets : [];
    const onPick = typeof o.onPick === "function" ? o.onPick : () => {};
    const currentFolder = o.currentFolder != null ? String(o.currentFolder) : "";
    const byFolder = new Map();
    for (const t of targets) if (t && t.folder != null) byFolder.set(String(t.folder), t);
    // Folders that have at least one child among the targets.
    const hasChildren = (folder) => targets.some((t) => t && t.folder && t.folder !== folder && String(t.folder).indexOf(folder + "/") === 0);
    // Direct parent folder of a target within this target set (nearest ancestor
    // that is itself a target). null = a top-level row (always visible).
    const parentOf = (folder) => {
      let best = null;
      for (const t of targets) {
        const f = t && t.folder;
        if (!f || f === folder) continue;
        if (String(folder).indexOf(f + "/") === 0) {
          if (best === null || f.length > best.length) best = f;
        }
      }
      return best;
    };
    // Seed expanded set with the ancestors of currentFolder (+ currentFolder
    // itself, so its own row is revealed) — auto-expand the current branch.
    const branchSeed = () => {
      const set = new Set();
      if (byFolder.has(currentFolder)) {
        set.add(currentFolder);
        let p = parentOf(currentFolder);
        while (p) { set.add(p); p = parentOf(p); }
      }
      return set;
    };
    // Open FULLY EXPANDED: seed with every parent folder so all descendants
    // (deep siblings included) are visible on open. Collapse-all re-collapses
    // to the current branch (branchSeed) — see doCollapseAll below.
    const expandAllSeed = () => {
      const set = new Set();
      for (const folder of byFolder.keys()) {
        if (hasChildren(folder)) set.add(folder);
      }
      return set;
    };
    let expanded = expandAllSeed();
    let filterQuery = "";
    // Seams captured in-closure, then promoted onto the returned overlay below
    // (the overlay isn't in the DOM yet while buildFn runs, so we can't find it
    // from inside buildFn — see _openModal ordering).
    const seams = {};

    const overlayEl = this._openModal("se-move-modal-overlay", (panel, close, doc) => {
      // Widen this modal only (the shared _openModal default is min(420px,90vw)).
      if (panel.style) panel.style.width = "min(560px, 92vw)";
      this._modalTitle(doc, panel, o.title || "Move to section");

      const header = doc.createElement("div");
      header.className = "se-move-header";
      header.style.cssText = "display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap;";
      const filter = this._modalInput(doc, panel, { placeholder: "Filter sections…" });
      // Move the filter input into the header row (it was appended to panel).
      if (panel.children && panel.children.indexOf) {
        const idx = panel.children.indexOf(filter);
        if (idx >= 0) panel.children.splice(idx, 1);
      }
      filter.style.cssText = "flex:1 1 auto;min-width:140px;margin-bottom:0;padding:6px 10px;border-radius:8px;border:1px solid var(--background-modifier-border);background:var(--background-modifier-form-field, var(--background-primary));color:var(--text-normal);font-size:0.9em;outline:none;";
      header.appendChild(filter);
      const mkTextBtn = (label, fn) => {
        const b = doc.createElement("span");
        b.className = "se-move-headbtn";
        b.textContent = label;
        b.style.cssText = "font-size:0.8em;color:var(--text-muted);cursor:pointer;user-select:none;padding:2px 6px;border-radius:6px;";
        b.onclick = fn;
        header.appendChild(b);
        return b;
      };
      mkTextBtn("Expand all", () => { doExpandAll(); renderTree(); });
      mkTextBtn("Collapse all", () => { doCollapseAll(); renderTree(); });
      panel.appendChild(header);

      const list = doc.createElement("div");
      list.className = "se-move-list";
      list.style.cssText = "max-height:62vh;overflow-y:auto;margin-bottom:12px;";
      panel.appendChild(list);

      // doc.createElement returns bare nodes (no createEl); this helper mirrors
      // the createEl(tag,{cls}) shape used elsewhere so tree rows can nest.
      const mkChild = (parent, tag, cls) => {
        const el = doc.createElement(tag);
        if (cls) el.className = cls;
        if (!el.children) el.children = [];
        if (!el.classList) {
          const set = new Set(String(cls || "").split(/\s+/).filter(Boolean));
          el.classList = {
            add: (c) => { set.add(c); el.className = [...set].join(" "); },
            remove: (c) => { set.delete(c); el.className = [...set].join(" "); },
            contains: (c) => set.has(c),
          };
        }
        el.createEl = (t, opts) => mkChild(el, t, opts && opts.cls);
        parent.appendChild(el);
        return el;
      };

      const doExpandAll = () => { expanded = new Set(targets.filter((t) => t && t.folder && hasChildren(t.folder)).map((t) => String(t.folder))); };
      const doCollapseAll = () => { expanded = branchSeed(); };

      // A row is visible (in tree mode) when every ancestor of it is expanded.
      const isVisible = (folder) => {
        let p = parentOf(folder);
        while (p) { if (!expanded.has(p)) return false; p = parentOf(p); }
        return true;
      };

      let visibleFolders = [];
      const renderTree = () => {
        if (list.empty) list.empty(); else list.children = [];
        visibleFolders = [];
        const q = String(filterQuery || "").trim().toLowerCase();
        const rows = q
          // Filter mode: flat matching rows, ignoring collapse.
          ? targets.filter((t) => t && String(t.label || "").toLowerCase().indexOf(q) >= 0)
          // Tree mode: only rows whose ancestors are all expanded.
          : targets.filter((t) => t && isVisible(String(t.folder)));
        for (const t of rows) {
          const folder = String(t.folder);
          const isCurrent = folder === currentFolder;
          const row = mkChild(list, "div", isCurrent ? "se-move-row is-current" : "se-move-row");
          if (row.classList && isCurrent) row.classList.add("is-current");
          row.__seFolder = folder;
          const indent = 8 + (Number(t.depth) || 0) * 20;
          row.style.cssText = "display:flex;align-items:center;gap:6px;padding:9px 12px;padding-left:" + indent + "px;border-radius:6px;cursor:" + (isCurrent ? "default" : "pointer") + ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:" + (isCurrent ? "var(--text-faint)" : "var(--text-normal)") + ";";
          // Toggle (tree mode only) for nodes with children.
          if (!q && hasChildren(folder)) {
            const tog = mkChild(row, "span", "se-move-toggle");
            tog.textContent = expanded.has(folder) ? "▾" : "▸";
            tog.style.cssText = "cursor:pointer;color:var(--text-muted);width:1em;flex:0 0 auto;";
            tog.onclick = (ev) => {
              if (ev && ev.stopPropagation) ev.stopPropagation();
              if (expanded.has(folder)) expanded.delete(folder); else expanded.add(folder);
              renderTree();
            };
          }
          const label = row.createEl("span", { cls: "se-move-label" });
          label.innerHTML = ((Number(t.depth) || 0) === 0) ? ("<b>" + this._escape(t.label) + "</b>") : this._escape(t.label);
          if (!isCurrent) {
            row.onclick = () => { close(); onPick(folder); };
          }
          visibleFolders.push(folder);
        }
      };
      renderTree();

      // Test seams (mirror the overlay.__seOpenedAt precedent) — captured here,
      // promoted onto the overlay after _openModal returns it.
      seams.expandAll = () => { doExpandAll(); renderTree(); };
      seams.collapseAll = () => { doCollapseAll(); renderTree(); };
      seams.setFilter = (str) => { filterQuery = String(str == null ? "" : str); renderTree(); };
      seams.visibleFolders = () => visibleFolders.slice();
      filter.oninput = () => seams.setFilter(filter.value);
    });
    if (overlayEl) {
      overlayEl.__seExpandAll = () => seams.expandAll && seams.expandAll();
      overlayEl.__seCollapseAll = () => seams.collapseAll && seams.collapseAll();
      overlayEl.__seSetFilter = (str) => seams.setFilter && seams.setFilter(str);
      overlayEl.__seVisibleFolders = () => (seams.visibleFolders ? seams.visibleFolders() : []);
    }
    return overlayEl;
  }

  // Move a single doc into destFolder (Task E1). No-op guarded; renames the file
  // then, when the adapter's move block supplies a frontmatter patch, applies it
  // best-effort (wiki → null; project → { section, sub_section }).
  async applyDocMove(dv, file, destFolder, adapter) {
    try {
      if (!file || !file.path) return { ok: false };
      if (SectionExplorer.isNoop(destFolder, file.path)) return { ok: true, no_op: true };
      const oldPath = file.path;
      const newPath = SectionExplorer.targetPath(destFolder, oldPath);
      const persist = async () => {
        await app.fileManager.renameFile(file, newPath);
        const mv = adapter && adapter.move;
        if (mv && typeof mv.rewriteOnDocMove === "function") {
          let patch = null;
          try { patch = mv.rewriteOnDocMove(destFolder, oldPath); } catch (_e) { patch = null; }
          if (patch) {
            const moved = app.vault.getAbstractFileByPath(newPath) || file;
            try {
              await app.fileManager.processFrontMatter(moved, (fm) => Object.assign(fm, patch));
            } catch (error) {
              try { await app.fileManager.renameFile(moved, oldPath); } catch (_e) {}
              throw error;
            }
          }
        }
        return newPath;
      };
      if (adapter && adapter.structural === true) {
        return await this._mutateStructure(dv, adapter, {
          kind: "remove", identityKey: "__sePath", identityValue: oldPath,
          preview: `Moving ${oldPath.split("/").pop().replace(/\.md$/i, "")}…`,
          failureMessage: "Could not move doc",
        }, persist);
      }
      // Backwards-compatible non-structural rail: retain the historical
      // synchronous dispatch shape used by project adapters while their
      // returned promises settle independently.
      app.fileManager.renameFile(file, newPath);
      const mv = adapter && adapter.move;
      if (mv && typeof mv.rewriteOnDocMove === "function") {
        let patch = null;
        try { patch = mv.rewriteOnDocMove(destFolder, oldPath); } catch (_e) { patch = null; }
        if (patch) {
          const moved = app.vault.getAbstractFileByPath(newPath) || file;
          app.fileManager.processFrontMatter(moved, (fm) => Object.assign(fm, patch));
        }
      }
      return { ok: true, value: newPath };
    } catch (_e) { return { ok: false, error: _e }; }
  }

  // Move a section folder under destParentFolder (Task E2). Renames the folder
  // to destParentFolder/<slug(title)>, then applies the adapter's section-move
  // cascade (hub patch + child patches) best-effort. Wiki → null (folder-only).
  // ASYNC: builds the patch plan BEFORE the rename (while child paths still
  // point at the OLD folder), awaits the folder rename so the vault index
  // reflects the new paths, remaps every old-folder path onto the new folder,
  // and patches frontmatter only on real TFiles resolved from the vault at
  // their NEW path — never on a fabricated { path } object (which would read
  // an old/renamed path off disk → ENOENT). Wiki → null plan (folder-only).
  async moveSection(dv, section, destParentFolder, adapter) {
    try {
      if (!section || !section.folder) return { ok: false };
      const oldFolder = String(section.folder).replace(/\/+$/, "");
      const newFolder = String(destParentFolder).replace(/\/+$/, "") + "/" + SectionExplorer._slugify(section.title);
      let folderFile = null;
      try { folderFile = app.vault.getAbstractFileByPath(oldFolder); } catch (_e) { folderFile = null; }
      if (!folderFile) return { ok: false }; // can't move a folder we can't resolve to a real file
      const mv = adapter && adapter.move;
      // Build the plan while child paths still point at the OLD folder.
      let plan = null;
      if (mv && typeof mv.rewriteOnSectionMove === "function") {
        try { plan = mv.rewriteOnSectionMove(section, destParentFolder); } catch (_e) { plan = null; }
      }
      const persist = async () => {
        await app.fileManager.renameFile(folderFile, newFolder);
        if (!plan) return newFolder;
        const remap = (p) => {
          const s = (p == null) ? "" : String(p);
          return (s === oldFolder || s.indexOf(oldFolder + "/") === 0) ? newFolder + s.slice(oldFolder.length) : s;
        };
        if (plan.hubPatch && section.hubPath) {
          try {
            const hubFile = app.vault.getAbstractFileByPath(remap(section.hubPath));
            if (hubFile) await app.fileManager.processFrontMatter(hubFile, (fm) => Object.assign(fm, plan.hubPatch));
          } catch (_e) { /* cascade remains best-effort after the folder move commits */ }
        }
        for (const cp of (plan.childPatches || [])) {
          try {
            if (!cp || !cp.path) continue;
            const cf = app.vault.getAbstractFileByPath(remap(cp.path));
            if (cf) await app.fileManager.processFrontMatter(cf, (fm) => Object.assign(fm, cp.patch || {}));
          } catch (_e) { /* one bad child must not strand every later patch */ }
        }
        return newFolder;
      };
      if (adapter && adapter.structural === true) {
        return await this._mutateStructure(dv, adapter, {
          kind: "remove", identityKey: "__seFolder", identityValue: oldFolder,
          preview: `Moving ${section.title || "section"}…`, failureMessage: "Could not move section",
        }, persist);
      }
      await persist();
      return { ok: true, value: newFolder };
    } catch (_e) { return { ok: false, error: _e }; }
  }

  // Open the move picker for a SECTION (rail ⋯ → Move). Targets come from the
  // adapter's move block, filtered by canAcceptSection and excluding the
  // section's own folder + its current parent (a no-op move).
  _openMovePickerForSection(dv, adapter, section) {
    try {
      const mv = adapter && adapter.move;
      if (!mv || typeof mv.enumerateSectionTargets !== "function") return;
      let targets = [];
      try { targets = mv.enumerateSectionTargets(dv) || []; } catch (_e) { targets = []; }
      const ownFolder = section && section.folder;
      const currentParent = ownFolder ? String(ownFolder).slice(0, String(ownFolder).lastIndexOf("/")) : "";
      const canAccept = typeof mv.canAcceptSection === "function" ? mv.canAcceptSection : () => true;
      const usable = targets.filter((t) => {
        if (!t || !t.folder) return false;
        if (t.folder === ownFolder) return false;         // can't move into itself
        if (t.folder === currentParent) return false;     // already there (no-op)
        try { return !!canAccept(section, t.folder); } catch (_e) { return false; }
      });
      this.openMovePicker({
        targets: usable,
        currentFolder: currentParent,
        title: "Move section",
        onPick: (folder) => this.moveSection(dv, section, folder, adapter),
      });
    } catch (_e) { /* never-throw */ }
  }

  // ── Select docs (modal picker) ────────────────────────────────────────────
  // Bulk-select the docs directly under a surface and move the checked set.
  // Replaces the old in-place pane flip (Task F select mode), which mutated a
  // pane owned by a DIFFERENT dataviewjs block than the chrome bar dispatching the
  // click, and so silently no-op'd. Enumeration is dv-independent (pagesUnder →
  // metadataCache), so it is mobile-safe at dispatch time.
  openSelectDocsPicker(dv, adapter, section) {
    try {
      const mv = adapter && adapter.move;
      if (!mv) return;
      const folder = (section && section.folder) ? String(section.folder) : String(mv.root || "");
      if (!folder) return;
      const docType = mv.docType;
      // Direct doc children of the folder only (matches the page pane's scope).
      const norm = String(folder).replace(/\/+$/, "");
      let docs = [];
      try {
        docs = SectionExplorer.pagesUnder(norm).filter((p) => {
          if (!p || !p.file || p.file.folder !== norm) return false;
          if (docType && p.type !== docType) return false;
          return true;
        });
      } catch (_e) { docs = []; }
      const cards = docs.map((p) => this._docCardModel(p));
      const selected = new Set();

      this._openModal("se-select-modal-overlay", (panel, close, doc) => {
        this._modalTitle(doc, panel, "Select docs to move");
        const list = doc.createElement("div");
        list.className = "se-select-list";
        list.style.cssText = "max-height:55vh;overflow-y:auto;margin-bottom:12px;";
        panel.appendChild(list);
        if (cards.length === 0) {
          const empty = doc.createElement("div");
          empty.className = "se-select-empty";
          empty.textContent = "No docs directly in this section.";
          empty.style.cssText = "color:var(--text-muted);font-size:0.92em;padding:8px 2px;";
          list.appendChild(empty);
        }
        let moveBtn = null;
        const refresh = () => {
          if (!moveBtn) return;
          const n = selected.size;
          moveBtn.textContent = n ? ("Move " + n + " doc" + (n === 1 ? "" : "s") + " →") : "Move docs →";
          moveBtn.disabled = n === 0;
          try { moveBtn.style.opacity = n ? "1" : "0.5"; } catch (_e) { /* stub */ }
        };
        for (const c of cards) {
          const row = doc.createElement("label");
          row.className = "se-select-row";
          row.style.cssText = "display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:6px;cursor:pointer;color:var(--text-normal);";
          const cb = doc.createElement("input");
          try { cb.type = "checkbox"; } catch (_e) { /* stub */ }
          cb.className = "se-select-check";
          cb.onchange = () => { if (cb.checked) selected.add(c.path); else selected.delete(c.path); refresh(); };
          const name = doc.createElement("span");
          name.className = "se-select-title";
          const base = String(c.path || "").split("/").pop().replace(/\.md$/, "");
          name.textContent = c.title || base;
          name.style.cssText = "flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
          row.appendChild(cb);
          row.appendChild(name);
          list.appendChild(row);
        }
        const btns = this._modalButtons(doc, panel, close, "Move docs →", () => {
          if (selected.size === 0) return;
          close();
          let targets = [];
          try { targets = (typeof mv.enumerateSectionTargets === "function") ? (mv.enumerateSectionTargets(dv) || []) : []; } catch (_e) { targets = []; }
          this.openMovePicker({
            targets,
            currentFolder: norm,
            title: "Move docs to section",
            onPick: async (dest) => {
              try {
                const { moves, skipped } = SectionExplorer.planBulkMove([...selected], dest);
                let moved = 0;
                if (adapter && adapter.structural === true) {
                  for (const m of moves) {
                    const file = app.vault.getAbstractFileByPath(m.from);
                    if (!file) continue;
                    const result = await this.applyDocMove(dv, file, dest, adapter);
                    if (result && result.ok === true) moved += 1;
                  }
                } else {
                  for (const m of moves) {
                    const file = app.vault.getAbstractFileByPath(m.from);
                    if (!file) continue;
                    this.applyDocMove(dv, file, dest, adapter);
                    moved += 1;
                  }
                }
                try {
                  const bits = ["Moved " + moved + " doc" + (moved === 1 ? "" : "s")];
                  const skippedTotal = skipped.length + (moves.length - moved);
                  if (skippedTotal) bits.push(skippedTotal + " skipped");
                  if (typeof Notice === "function") new Notice(bits.join("; "), 5000);
                } catch (_e) { /* notice best-effort */ }
              } catch (_e) { /* never-throw */ }
            },
          });
        });
        moveBtn = btns.primary;
        refresh();
      });
    } catch (_e) { /* never-throw */ }
  }

  // ── renderNoteLinks — pinned links on a LEAF note (wiki-page / doc-note).
  // Called by WikiChromeBar/ProjectChromeBar right after the bar renders, so
  // every existing note gets the feature with zero body migration. Renders the
  // note's frontmatter links[] as clickable cards plus an always-present
  // "＋ Add link" pill that reuses the existing add-link modal, writing back to
  // THIS note via processFrontMatter (creates the links key on first write).
  renderNoteLinks(dv) {
    try {
      const container = (dv && dv.container) ? dv.container : dv;
      if (!container || typeof container.createEl !== "function") return;
      // RenderSafe overlays partial cold-load pages when available (v0.200.1).
      let page = null;
      try {
        if (typeof customJS !== "undefined" && customJS.RenderSafe && typeof customJS.RenderSafe.page === "function") {
          page = customJS.RenderSafe.page(dv);
        }
      } catch (_e) { page = null; }
      if (!page) { try { page = dv.current ? dv.current() : null; } catch (_e) { page = null; } }
      if (!page || !page.file || !page.file.path) return;

      const strip = container.createEl("div", { cls: "se-note-links" });
      const links = Array.isArray(page.links) ? page.links : [];
      const linkIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
      for (const link of links) {
        if (!link || !link.url) continue;
        const a = strip.createEl("a", { cls: "se-note-link-card" });
        a.innerHTML = linkIcon + `<span class="se-note-link-text">${this._escape(link.text || link.url)}</span>`;
        const href = this._normalizeUrl(link.url);
        if (this._isSafeUrl(href)) {
          a.href = href;
          a.target = "_blank";
          a.rel = "noopener";
        }
        // Unsafe/malformed URLs: no href — the card stays visible as dead
        // text, never silently dropped (same rule as the pane link chips).
      }
      const add = strip.createEl("span", { cls: "se-note-link-add" });
      add.textContent = "＋ Add link";
      const noteAdapter = this._noteSelfAdapter(page);
      add.onclick = () => this._openAddLinkForm(dv, noteAdapter, null);
    } catch (_e) { /* never-throw */ }
  }

  // Self-adapter for the CURRENT note — the minimal getLinks/writeLinks surface
  // _openAddLinkForm needs, bound to this note's own frontmatter.
  _noteSelfAdapter(page) {
    const notePath = page.file.path;
    return {
      getLinks: () => (Array.isArray(page.links) ? page.links : []),
      writeLinks: (_target, links) => {
        try {
          const f = app.vault.getAbstractFileByPath(notePath);
          if (!f) return Promise.resolve();
          return app.fileManager.processFrontMatter(f, (fm) => { fm.links = links; });
        } catch (_e) { return Promise.resolve(); }
      },
    };
  }

  _escape(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  }
}
