/**
 * WikiChromeBar (CustomJS) — the wiki blueprint's ChromeBar adapter config.
 *
 * Renders the shared Go ▾ / primary / ⋯ bar on wiki surfaces via
 * customJS.ChromeBar.makeAdapter(this._config()). Reuses the EXISTING wiki
 * helpers for actions (EntityCreate for New Page/New Section, WikiLeafActions
 * for Move + parent-section resolution) — no new action code. Instance methods;
 * never-throw; cold-load-safe.
 */
class WikiChromeBar {
  get ICON() {
    return {
      folderPlus: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`,
      filePlus: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 18v-6"/></svg>`,
      move: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`,
    };
  }

  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      const result = customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
      this._renderNoteLinks(dv);
      return result;
    } catch (_e) { /* never throw */ }
  }

  // Leaf-note pinned links (v0.210): wiki-page notes get their links[] strip +
  // "＋ Add link" pill right under the bar, via the shared SectionExplorer
  // helper. Cold-load-guarded; hubs/sections render theirs in the explorer pane.
  _renderNoteLinks(dv) {
    try {
      let page = null;
      try { page = dv && dv.current ? dv.current() : null; } catch (_e) { page = null; }
      if (!page || page.type !== "wiki-page") return;
      if (typeof customJS === "undefined" || !customJS.SectionExplorer
        || typeof customJS.SectionExplorer.renderNoteLinks !== "function") return;
      customJS.SectionExplorer.renderNoteLinks(dv);
    } catch (_e) { /* never throw */ }
  }

  // Build the shared SectionExplorer adapter + a minimal section descriptor for
  // the CURRENT wiki-section note, so the ⋯ Move/Delete routes can drive the
  // shared move picker / delete confirm. Returns null (never-throw) when the
  // required helpers or an active section note are unavailable.
  //
  // NOTE: SectionExplorer.makeAdapter intentionally does NOT forward the config's
  // `move` / `emptySubsectionCount` blocks (they're not part of the render
  // adapter it produces), but _openMovePickerForSection/_openDeleteConfirm read
  // them off `adapter.*`. We overlay them from the config here so the section
  // routes behave identically to the rail ⋯ menu.
  _wikiAdapterAndSection(dv) {
    try {
      let cur = null;
      try {
        cur = (customJS && customJS.RenderSafe && typeof customJS.RenderSafe.page === "function")
          ? customJS.RenderSafe.page(dv)
          : (dv && dv.current ? dv.current() : null);
      } catch (_e) { cur = null; }
      if (!cur || !cur.file) return null;
      if (!customJS || !customJS.WikiTree || !customJS.SectionExplorer) return null;
      if (typeof customJS.WikiTree._buildConfig !== "function" || typeof customJS.SectionExplorer.makeAdapter !== "function") return null;
      const config = customJS.WikiTree._buildConfig(dv, cur);
      const adapter = customJS.SectionExplorer.makeAdapter(config);
      // Overlay the move + empty-sub-section-count hooks the shared section
      // routes read directly off the adapter (makeAdapter drops them).
      if (adapter && config) {
        if (config.move && adapter.move == null) adapter.move = config.move;
        if (typeof config.emptySubsectionCount === "function" && typeof adapter.emptySubsectionCount !== "function") {
          adapter.emptySubsectionCount = config.emptySubsectionCount;
        }
      }
      const folder = cur.file.path.slice(0, cur.file.path.lastIndexOf("/"));
      const section = {
        folder,
        hubPath: cur.file.path,
        title: (cur.title && String(cur.title).trim()) || cur.file.name.replace(/\.md$/, ""),
      };
      return { adapter, section };
    } catch (_e) { return null; }
  }

  _config() {
    const ICON = this.ICON;
    const ROOT = "spice/wiki";
    return {
      // Classify by frontmatter type; null → not a wiki surface (render nothing).
      detect: (dv, page) => {
        const t = page && page.type;
        if (t !== "wiki-hub" && t !== "wiki-section" && t !== "wiki-page") return null;
        return { context: t, path: (page.file && page.file.path) || "" };
      },
      surfaceSpec: (ctx) => {
        if (ctx.context === "wiki-page") {
          return { primary: null, overflow: [{ id: "move", label: "Move", icon: ICON.move }], leaf: true };
        }
        // wiki-hub / wiki-section — New Page primary, then the shared
        // section-management overflow: New Section, (section only) Move section,
        // Select docs, (section only) Delete section.
        const isSection = ctx.context === "wiki-section";
        const overflow = [{ id: "new-section", label: "New Section", icon: ICON.folderPlus }];
        if (isSection) overflow.push({ id: "move-section", label: "Move section", icon: ICON.move });
        overflow.push({ id: "select-docs", label: "Select docs", icon: ICON.filePlus });
        if (isSection) overflow.push({ id: "delete-section", label: "Delete section", icon: ICON.folderPlus });
        return {
          primary: { id: "new-page", label: "New Page", icon: ICON.filePlus },
          overflow,
          leaf: false,
        };
      },
      dispatch: (dv, ctx, id) => {
        if (id === "new-page" || id === "new-section") {
          const instance = id === "new-page" ? "wiki-page" : "wiki-section";
          if (customJS && customJS.EntityCreate && typeof customJS.EntityCreate.create === "function") {
            const structuralLifecycle = customJS.SectionExplorer
              && typeof customJS.SectionExplorer.entityCreateLifecycle === "function"
              ? customJS.SectionExplorer.entityCreateLifecycle(dv) : null;
            return customJS.EntityCreate.create({ instance, dv, structuralLifecycle });
          } else if (typeof Notice === "function") { new Notice("WikiChromeBar: EntityCreate unavailable — reinstall wiki blueprint.", 6000); }
          return;
        }
        // Leaf-note Move → the shared collapsible move picker (folder-is-truth:
        // a pure folder rename, no frontmatter rewrite).
        if (id === "move") {
          try {
            if (!customJS || !customJS.SectionExplorer || typeof customJS.SectionExplorer.openMovePicker !== "function") return;
            const file = (typeof app !== "undefined") ? app.workspace.getActiveFile() : null;
            if (!file || !file.path) return;
            // dv-independent enumeration (mobile: the captured dv is torn down by
            // click time, so dv.pages() throws / returns empty).
            const arr = customJS.SectionExplorer.pagesUnder("spice/wiki");
            const targets = customJS.SectionExplorer.sectionTargets(arr, {
              root: "spice/wiki", sectionType: "wiki-section", rootLabel: "Wiki (root)",
              labelOf: (p) => (p.title && String(p.title).trim()) || "",
            });
            const currentFolder = file.path.slice(0, file.path.lastIndexOf("/"));
            const adapter = { structural: true, move: { rewriteOnDocMove: () => null } };
            customJS.SectionExplorer.openMovePicker({
              targets, currentFolder, title: "Move to section",
              onPick: (folder) => customJS.SectionExplorer.applyDocMove(dv, file, folder, adapter),
            });
          } catch (_e) { /* never-throw */ }
          return;
        }
        // Bulk-select docs to move (modal picker; enumeration is
        // mechanism-owned + mobile-safe). Hub + section surfaces.
        if (id === "select-docs") {
          try {
            const a = this._wikiAdapterAndSection(dv);
            if (a && customJS.SectionExplorer && typeof customJS.SectionExplorer.openSelectDocsPicker === "function") {
              customJS.SectionExplorer.openSelectDocsPicker(dv, a.adapter, a.section);
            }
          } catch (_e) { /* never-throw */ }
          return;
        }
        // Move THIS section under another section (section surface only).
        if (id === "move-section") {
          try {
            const a = this._wikiAdapterAndSection(dv);
            if (a && customJS.SectionExplorer && typeof customJS.SectionExplorer._openMovePickerForSection === "function") {
              customJS.SectionExplorer._openMovePickerForSection(dv, a.adapter, a.section);
            }
          } catch (_e) { /* never-throw */ }
          return;
        }
        // Delete THIS section (recursive-confirm; gated on an empty doc subtree).
        if (id === "delete-section") {
          try {
            const a = this._wikiAdapterAndSection(dv);
            if (a && customJS.SectionExplorer && typeof customJS.SectionExplorer._openDeleteConfirm === "function") {
              customJS.SectionExplorer._openDeleteConfirm(dv, a.adapter, a.section);
            }
          } catch (_e) { /* never-throw */ }
          return;
        }
      },
      // The Go ▾ "This wiki" section: Wiki home + (on section/page) the parent
      // section hub. Reuses WikiLeafActions._resolveSectionHub. The current surface
      // omits its own self-link.
      destinations: (dv, ctx) => {
        const out = [{ section: "This wiki" }];
        let curPath = ctx && ctx.path;
        if (!curPath) { try { const c = dv && dv.current ? dv.current() : null; curPath = (c && c.file && c.file.path) || ""; } catch (_e) { curPath = ""; } }
        const wikiHome = ROOT + "/Wiki.md";
        const open = (p) => { try { customJS.ChromeBar.openNavTarget(p, dv); } catch (_e) {} };
        // Wiki home — omit when we ARE the root hub.
        if (curPath !== wikiHome) {
          out.push({ label: "Wiki", icon: ICON.filePlus, _navTarget: wikiHome, onSelect: () => open(wikiHome) });
        }
        // Up to parent section (section/page only), via the existing resolver.
        if (ctx.context !== "wiki-hub" && curPath) {
          const folder = curPath.slice(0, curPath.lastIndexOf("/"));
          const parent = ctx.context === "wiki-section" ? folder.slice(0, folder.lastIndexOf("/")) : folder;
          if (parent && parent !== ROOT && parent.startsWith(ROOT + "/")
            && customJS && customJS.WikiLeafActions && typeof customJS.WikiLeafActions._resolveSectionHub === "function") {
            try {
              const hub = customJS.WikiLeafActions._resolveSectionHub(dv, parent);
              if (hub && hub.path && hub.path !== curPath) {
                out.push({ label: hub.label, icon: ICON.folderPlus, _navTarget: hub.path, onSelect: () => open(hub.path) });
              }
            } catch (_e) { /* best-effort up-nav */ }
          }
        }
        return out;
      },
      rootClass: "wiki-chrome-root",
      btnClass: (v) => `wiki-chrome-btn wiki-chrome-btn-${v}`,
    };
  }
}
